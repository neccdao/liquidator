require("dotenv").config();
import { ethers } from "ethers";

const tokens = [
    process.env.BTC_ADDRESS && {
        name: "Bitcoin (WBTC)",
        symbol: "BTC",
        decimals: 8,
        address: process.env.BTC_ADDRESS,
    },
    {
        name: "ETH",
        symbol: "ETH",
        decimals: 18,
        address: ethers.constants.AddressZero,
    },
    process.env.WETH_ADDRESS && {
        name: "Wrapped Ethereum",
        symbol: "WETH",
        decimals: 18,
        address: process.env.WETH_ADDRESS,
        isWrapped: true,
    },

    process.env.WNEAR_ADDRESS && {
        name: "Wrapped NEAR",
        symbol: "wNEAR",
        decimals: 24,
        address: process.env.WNEAR_ADDRESS,
    },
];

export default tokens;
