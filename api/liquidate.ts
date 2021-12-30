import { ethers } from "ethers";
const weiroll = require("@weiroll/weiroll.js");
import tokens from "../src/lib/tokens";
import readerJSON from "../src/contracts/facets/Reader/ReaderFacet.sol/ReaderFacet.json";
import vaultJSON from "../src/contracts/facets/Vault/VaultFacet.sol/VaultFacet.json";
import testableVMJSON from "../src/contracts/weiroll/TestableVM.sol/TestableVM.json";
import TokenJSON from "../src/contracts/tokens/Token.sol/Token.json";
import getPositionQuery from "../src/lib/getPositionQuery";
import { bufferCount, catchError, concatMap, delay, from, of, tap } from "rxjs";

const handler = async function () {
    try {
        console.info("*** Liquidate handler ***");
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
        const token = new ethers.Contract(
            process.env.EXCHANGE_DIAMOND_ADDRESS,
            TokenJSON.abi,
            signer
        );
        //
        const balance = await provider.getBalance(signer.address);
        const tokenBalancePromises = tokens.map(async (token) => {
            if (token.address === ethers.constants.AddressZero) {
                return;
            }
            const tokenInstance = new ethers.Contract(
                token.address,
                TokenJSON.abi,
                signer
            );
            return await tokenInstance.balanceOf(signer.address);
        });

        const currentBlock = await provider.getBlockNumber();
        console.log({ currentBlock });

        const tokenBalances = await Promise.all(tokenBalancePromises);
        console.log("Token Balances: ");
        const tokenBalancesMap = tokens.map((token, index) => {
            if (tokenBalances[index]) {
                return {
                    [token.address]: tokenBalances[index]?.toString(),
                };
            } else {
                return {
                    [ethers.constants.AddressZero]: balance?.toString(),
                };
            }
        });
        console.log(JSON.stringify(tokenBalancesMap));

        // weiroll

        const fromBlock = process.env.FROM_BLOCK
            ? Number(process.env.FROM_BLOCK)
            : "latest";
        const ipEventFilter = vault.filters.IncreasePosition();
        const ipEvents = await vault.queryFilter(
            ipEventFilter,
            currentBlock - 60000,
            "latest"
        );

        const addresses = ipEvents.map((o) => o?.args?.account);
        const uniqueAddresses = ipEvents
            .filter(
                ({ args: { account } }, index) =>
                    !addresses.includes(account, index + 1)
            )
            .map(({ args: { account } }) => account);

        console.info("uniqueAddresses.length: " + uniqueAddresses.length);

        await from(uniqueAddresses)
            .pipe(
                bufferCount(15),
                concatMap((txn) => of(txn).pipe(delay(8000))),
                tap(async (chunk) => {
                    try {
                        const planner = new weiroll.Planner();
                        const testableVM = new ethers.Contract(
                            process.env.TESTABLE_VM_ADDRESS,
                            testableVMJSON.abi,
                            signer
                        );
                        const wrVault = weiroll.Contract.createContract(vault);
                        const positionQuery = getPositionQuery(tokens);
                        const positionPromises = chunk.map(async (_account) => {
                            return await reader.getPositions(
                                vault.address,
                                _account,
                                positionQuery.collateralTokens,
                                positionQuery.indexTokens,
                                positionQuery.isLong
                            );
                        });

                        const uniqueAddressPositions = await Promise.all(
                            positionPromises
                        );
                        console.info({
                            uniqueAddressPositionsLength:
                                uniqueAddressPositions.length,
                        });
                        // console.log(uniqueAddressPositions?.[0]);

                        // [
                        // uniqueAddress1: [position1 properties], ...[positionN properties],
                        // ...uniqueAddressN: [..., ...]
                        // ]
                        const positionPropsLength = 9;
                        const uniqueAddressPositionsToValidate =
                            uniqueAddressPositions.map(
                                (positionsForAddress, uniqueAddressIndex) => {
                                    const validateLiquidationPositionsForUniqueAddress =
                                        [];
                                    for (
                                        let i = 0;
                                        i <
                                        positionQuery.collateralTokens.length;
                                        i++
                                    ) {
                                        // no position size so ignore
                                        if (
                                            positionsForAddress[
                                                positionPropsLength * i
                                            ]?.toString() == "0"
                                        ) {
                                            continue;
                                        }
                                        const account =
                                            chunk[uniqueAddressIndex];
                                        const collateralToken =
                                            positionQuery.collateralTokens[i];
                                        const indexToken =
                                            positionQuery.indexTokens[i];
                                        const isLong = positionQuery.isLong[i];
                                        const isRaise = false;

                                        const positionToValidateForLiquidation =
                                            [
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
                                .map(
                                    async (
                                        uniqueAddressPositions,
                                        uniqueAddressIndex
                                    ) => {
                                        const validationPromises =
                                            uniqueAddressPositions.map(
                                                async (positionToValidate) => {
                                                    try {
                                                        const [
                                                            liquidationState,
                                                        ] = await vault.validateLiquidation(
                                                            ...positionToValidate
                                                        );

                                                        console.log({
                                                            liquidationState,
                                                        });
                                                        if (
                                                            liquidationState.gt(
                                                                0
                                                            )
                                                        ) {
                                                            const result =
                                                                await positionToValidate;
                                                            return result;
                                                        }
                                                    } catch (err) {}
                                                }
                                            );

                                        const validationResults =
                                            await Promise.all(
                                                validationPromises
                                            );
                                        return validationResults;
                                    }
                                )
                                .flat();

                        const uniqueAddressesPositionsToLiquidateUnflattened =
                            await Promise.all(
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
                            return;
                        }

                        uniqueAddressesPositionsToLiquidate.map(
                            (liquidablePosition) => {
                                // remove isRaise boolean since not needed in liquidatePosition
                                liquidablePosition.pop();
                                planner.add(
                                    wrVault.liquidatePosition(
                                        ...liquidablePosition,
                                        process.env.LIQUIDATOR_ADDRESS
                                    )
                                );
                            }
                        );

                        // Execute weiroll plan with deployed VM with user2 who is the liquidation fee receiver

                        const { commands, state } = planner.plan();
                        const tx = await testableVM.execute(commands, state);
                        const receipt = await tx.wait();
                        const { gasUsed, transactionHash } =
                            await provider.getTransactionReceipt(tx.hash);
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
                    } catch (err) {
                        console.error(err.message);
                    }
                })
            )
            .toPromise();
    } catch (err) {
        console.error("Error occured in liquidate.ts:handler");
        console.error(err);
    }
};

export default handler;
