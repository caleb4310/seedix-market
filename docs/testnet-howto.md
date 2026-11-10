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
3. Enter the name and ticker. The coin always trades against HYPE. Pick a stock, a pre-IPO token, or paste a contract: that token is the backing asset, not the pool pair. Kickback is only offered when that backing token is vetted on chain. Keep works for an unvetted backing token. Burn hides the picker and has no backing token; fees buy the coin back and burn it.
4. Description, website, X, and Telegram are optional. A description that is a metadata id (10 to 128 letters and numbers) is pinned with `CoinMetadata.pin` when that contract is in `deployments/99801.json`.
5. Hold the launch button until it fills. The wallet asks you to sign `launch`. After it is mined, a confirmation opens and the page moves to the new coin. The form resets.
6. The starting market cap is about $2,500. That is 34 WHYPE at the $74.6 HYPE quote used to pick the default (`Launcher.startMcap`). The launch sends that WHYPE amount as `startMcapInPair`. The timelock can change it with `setStartMcap`. The launch page and the preview show the cap in USD only. If the CoinGecko quote is down, they say "USD price unavailable" and do not print a token amount.
7. Other dollar amounts use the API's CoinGecko `hyperliquid` quote, cached for about 60 seconds. If that feed is down, the last price is kept and then those other figures fall back to HYPE. The footer names the source. Logos are served at `/api/logos/` and at `/logos/` (nginx proxies `/logos/` to the API).

## Buy and sell

Open the coin. Choose buy or sell, and spend-exact or receive-exact.

- Spend exact sends a negative `amountSpecified`. Slippage sets `minOut`.
- Receive exact sends a positive `amountSpecified`. Slippage sets `maxIn`.

The quote comes from V4Quoter before the wallet opens. The deadline is now plus the minutes you enter (default 10, at most 60). If the token allowance is short, the next transaction approves the router for that exact amount. It does not approve unlimited. Permit2 is not the spender. SeedixRouter pulls the token itself.

## Claim

On a Kickback coin, Claim lists merkle proofs from the API (`/coins/<pool>/claims?account=<wallet>`). Claim sends `KickbackDistributor.claim` with that proof. If a push to your wallet failed, the same card shows the credit from `claimable` and Claim failed credit sends `claimFailed`.

## Fork test

`npm run test:e2e:fork -w @seedix/web` forks 99801 with Anvil and runs launch, buy, sell, and claim in a browser. It needs Foundry on `PATH` and the public RPC. It is not in CI.
