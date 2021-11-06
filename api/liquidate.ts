import { VercelRequest, VercelResponse } from "@vercel/node";
import { ethers } from "ethers";
const weiroll = require("@weiroll/weiroll.js");
import tokens from "../src/lib/tokens";
import readerJSON from "../src/contracts/facets/Reader/ReaderFacet.sol/ReaderFacet.json";
import vaultJSON from "../src/contracts/facets/Vault/VaultFacet.sol/VaultFacet.json";
import testableVMJSON from "../src/contracts/weiroll/TestableVM.sol/TestableVM.json";
import getPositionQuery from "../src/lib/getPositionQuery";

export default async function (req: VercelRequest, res: VercelResponse) {
    // const { name = "World" } = req.query;
    // res.send(`Hello ${name}!`);
    const provider = new ethers.providers.JsonRpcBatchProvider(
        process.env.RPC_URL
    );
    const signer = new ethers.Wallet(
        process.env.LIQUIDATOR_PRIVATE_KEY,
        provider
    );
    const vault = new ethers.Contract(
        process.env.EXCHANGE_DIAMOND_ADDRESS,
        vaultJSON.abi,
        signer
    );
    const reader = new ethers.Contract(
        process.env.EXCHANGE_DIAMOND_ADDRESS,
        readerJSON.abi,
        signer
    );

    // weiroll
    const planner = new weiroll.Planner();
    const testableVM = new ethers.Contract(
        process.env.TESTABLE_VM_ADDRESS,
        testableVMJSON.abi,
        signer
    );
    const wrVault = weiroll.Contract.createContract(vault);

    const ipEventFilter = vault.filters.IncreasePosition();
    const ipEvents = await vault.queryFilter(
        ipEventFilter,
        process.env.FROM_BLOCK,
        "latest"
    );

    const addresses = ipEvents.map((o) => o?.args?.account);
    const uniqueAddresses = ipEvents
        .filter(
            ({ args: { account } }, index) =>
                !addresses.includes(account, index + 1)
        )
        .map(({ args: { account } }) => account);

    const positionQuery = getPositionQuery(tokens);
    const positionPromises = uniqueAddresses.map(async (_account) => {
        return await reader.getPositions(
            vault.address,
            _account,
            positionQuery.collateralTokens,
            positionQuery.indexTokens,
            positionQuery.isLong
        );
    });

    const uniqueAddressPositions = await Promise.all(positionPromises);
    // console.log({ positionQuery });
    console.log({
        uniqueAddressPositionsLength: uniqueAddressPositions.length,
    });
    // console.log(uniqueAddressPositions?.[0]);

    // [
    // uniqueAddress1: [position1 properties], ...[positionN properties],
    // ...uniqueAddressN: [..., ...]
    // ]
    const positionPropsLength = 9;
    const uniqueAddressPositionsToValidate = uniqueAddressPositions.map(
        (positionsForAddress, uniqueAddressIndex) => {
            const validateLiquidationPositionsForUniqueAddress = [];
            for (let i = 0; i < positionQuery.collateralTokens.length; i++) {
                // no position size so ignore
                if (
                    positionsForAddress[positionPropsLength * i]?.toString() ==
                    "0"
                ) {
                    continue;
                }
                const account = uniqueAddresses[uniqueAddressIndex];
                const collateralToken = positionQuery.collateralTokens[i];
                const indexToken = positionQuery.indexTokens[i];
                const isLong = positionQuery.isLong[i];
                const isRaise = false;

                const positionToValidateForLiquidation = [
                    account,
                    collateralToken,
                    indexToken,
                    isLong,
                    isRaise,
                ];

                validateLiquidationPositionsForUniqueAddress.push(
                    positionToValidateForLiquidation
                );
            }

            return validateLiquidationPositionsForUniqueAddress;
        }
    );
    /*
    uniqueAddressPositionsToValidate ===
    [
      address 1 => [[ position1 ], ...[]],
      address n => [[ position1 ], ...[]],
    ]
    */
    const uniqueAddressPositionsToValidatePromises =
        uniqueAddressPositionsToValidate
            .map(async (uniqueAddressPositions, uniqueAddressIndex) => {
                const validationPromises = uniqueAddressPositions.map(
                    async (positionToValidate) => {
                        const [liquidationState] =
                            await vault.validateLiquidation(
                                ...positionToValidate
                            );

                        if (liquidationState.gt(0)) {
                            const result = await positionToValidate;
                            return result;
                        }
                    }
                );

                const validationResults = await Promise.all(validationPromises);
                return validationResults;
            })
            .flat();

    const uniqueAddressesPositionsToLiquidateUnflattened = await Promise.all(
        uniqueAddressPositionsToValidatePromises
    );

    const uniqueAddressesPositionsToLiquidate =
        uniqueAddressesPositionsToLiquidateUnflattened
            .flat()
            .filter((x) => !!x);

    // console.log({
    //     uniqueAddressesPositionsToLiquidateUnflattened,
    //     uniqueAddressPositionsToValidatePromises,
    //     uniqueAddressPositionsToValidate,
    //     uniqueAddressesPositionsToLiquidate,
    // });

    if (uniqueAddressesPositionsToLiquidate.length === 0) {
        console.info("OK, nothing liquidated.");
        res.send("OK, nothing liquidated.");
    }

    uniqueAddressesPositionsToLiquidate.map((liquidablePosition) => {
        // remove isRaise boolean since not needed in liquidatePosition
        liquidablePosition.pop();
        planner.add(
            wrVault.liquidatePosition(
                ...liquidablePosition,
                process.env.LIQUIDATOR_ADDRESS
            )
        );
    });

    // Execute weiroll plan with deployed VM with user2 who is the liquidation fee receiver

    const { commands, state } = planner.plan();
    const tx = await testableVM.execute(commands, state);
    const receipt = await tx.wait();
    const { gasUsed, transactionHash } = await provider.getTransactionReceipt(
        tx.hash
    );
    console.info(
        uniqueAddressesPositionsToLiquidate.length +
            " * liquidatePosition gas used: ",
        gasUsed.toString()
    );

    const blockNumber = await provider.getBlockNumber();
    const block = await provider.getBlock(blockNumber);
    console.info("blockNumber: ", blockNumber);
    console.info("block.timestamp: ", block.timestamp);
    console.info("transactionHash: ", transactionHash);
    res.send("OK, " + transactionHash);
}
