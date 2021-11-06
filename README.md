# Necc Liquidator Serverless function

---

## NOTES

To be deployed with vercel, this function will:

1. Check all position increase events
2. Dedupe all the addresses
3. Check all the addresses for their positions
4. If the address has a position, then it will be validated for liquidation if it has size > 0
5. Flatten all the liquidable positions into a single array
6. Use a deployed weiroll VM to liquidate the positions in a single block
7. All liquidation fees will received by the liquidator in the corresponding position collateral token

> The function will need a cron job by approximate block time interval or listen to a Chainlink price feed event

### ENV VARS

-   RPC_URL
-   EXCHANGE_DIAMOND_ADDRESS
-   TESTABLE_VM_ADDRESS
-   LIQUIDATOR_ADDRESS
-   LIQUIDATOR_PRIVATE_KEY
-   FROM_BLOCK

---

TOKEN ENV VARS

-   BTC_ADDRESS
-   WETH_ADDRESS
-   WNEAR_ADDRESS

#### ENV VAR NOTES

-   yarn dev will create a .env file in the root of the project as it pulls the development environment variables from vercel remotely
