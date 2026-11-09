# Elysium testnet

Seedix on this deployment uses chain id **99801**. The native gas token is **HYPE**, 18 decimals.

| | |
|---|---|
| Chain id | 99801 |
| RPC | https://testnet-rpc.elysium.kinetiq.xyz |
| Symbol | HYPE |
| Decimals | 18 |
| Explorer | https://explorer-elysium-testnet.t.conduit.xyz |

Add the network in the wallet. If it is missing, Seedix asks the wallet to switch and, if the wallet does not know the chain, adds it with this RPC, the HYPE symbol, and 18 decimals.

## Test HYPE

Kinetiq's faucet is [https://testnet.elysium.kinetiq.xyz/faucet](https://testnet.elysium.kinetiq.xyz/faucet). Connect the wallet you will use on chain 99801 and request test HYPE. The faucet can require a little HYPE on HyperEVM testnet before it will send. If that page is down, ask the team.

## Wrap to WHYPE

The router moves ERC-20 only. Buys of the WHYPE pair spend WHYPE, not native HYPE. The WHYPE contract is `tokens.whype` in `deployments/99801.json` (currently `0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234`). It accepts `deposit()` payable and mints the same amount of WHYPE. On a buy, Seedix wraps only the amount you are short and then approves the router for the exact spend. You can also wrap from the wallet by sending HYPE to that contract with the `deposit` function.

## Launch

1. Connect an injected wallet (MetaMask or Rabby) or WalletConnect.
2. Open Launch.
3. Enter the name, ticker, pair, and fee mode. Team supply is a whole percent from 0 to 5. The starting market cap is in the pair token.
4. A metadata URI is shown on the form for your notes. `launch` does not take that argument, so it is not written on chain.
5. An optional initial buy is a second transaction after the launch is mined. Slippage defaults to 1% and the deadline defaults to 10 minutes. Both can be changed on the form.
6. Hold the launch button until it fills. The wallet asks you to sign. The page then shows the transaction as pending, with an explorer link, and confirmed after it is mined.

## Buy and sell

Open the coin. Choose buy or sell, and spend-exact or receive-exact.

- Spend exact sends a negative `amountSpecified`. Slippage sets `minOut`.
- Receive exact sends a positive `amountSpecified`. Slippage sets `maxIn`.

The quote comes from V4Quoter before the wallet opens. The deadline is now plus the minutes you enter (default 10, at most 60). If the token allowance is short, the next transaction approves the router for that exact amount. It does not approve unlimited. Permit2 is not the spender. SeedixRouter pulls the token itself.

## Claim

On a Kickback coin, Claim lists merkle proofs from the API (`/coins/<pool>/claims?account=<wallet>`). Claim sends `KickbackDistributor.claim` with that proof. If a push to your wallet failed, the same card shows the credit from `claimable` and Claim failed credit sends `claimFailed`.

## Fork test

`npm run test:e2e:fork -w @seedix/web` forks 99801 with Anvil and runs launch, buy, sell, and claim in a browser. It needs Foundry on `PATH` and the public RPC. It is not in CI.
