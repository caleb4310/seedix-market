# Add a pre-IPO pair

No contract change, no rebuild, and no redeploy. The token shows up when the timelock lists it and a WHYPE route exists. The token is a backing asset. Launch pools stay coin/WHYPE. The web reads the backing registry from the API at runtime.

Do this on a fork or a local Anvil first. Mainnet (chain 99901) stays empty until every check below is true.

## Checks before the timelock

The pair is an ERC-20 the issuer actually controls. Record the issuer, the bridge, and the contract page you read.

- Code is present at the address. A lookalike with a similar name is not the token.
- `name`, `symbol`, and `decimals` read back. Decimals are from 6 to 18.
- A transfer of a small amount increases the recipient balance by exactly that amount. A shortfall is fee-on-transfer. Reject it.
- Balances do not change when nobody transfers. Unwrapped xStocks rebase. A `w`-prefixed wrapper is not non-rebasing until you have watched `balanceOf` across a rebase window and it stayed still. Rebasing pairs are unsafe in the v4 pool and in Kickback: the PoolManager's reserves and the distributor's `liabilities` assume the balance only moves on transfer. `recoverSurplus` can return a surplus. It cannot repay a shortfall, and it cannot repair reserves inside the PoolManager.
- The WHYPE pool is the hookless pool you will register. Its WHYPE inside one tick spacing of the current price is at least `minRouteDepth`. On 99801 that value is 0.15 WHYPE. The documented mainnet value is 10,000 WHYPE (`SeedixConstants.MAINNET_MIN_ROUTE_DEPTH`). The timelock can set a different number with `setMinRouteDepth`.
- Reject the hook, the locker, the vault, the executor, the distributor, the pool manager, the launcher, and any Seedix launch token.

## Timelock

The delay is 48 hours. Replace the placeholders. `STATUS_VETTED` is 1. `CATEGORY_PREIPO` is 2.

Schedule, from the timelock proposer:

```text
Launcher.setPair(PAIR, 1, 2)
BuybackExecutor.registerExternal(POOL_KEY)
```

`POOL_KEY` is the hookless pool whose currencies are exactly the pair and WHYPE, sorted by address, fee 3000, tick spacing 60, hooks `address(0)`.

Wait 48 hours. Execute the same calldata, values, and salts. The guardian can refuse the pair immediately with `setPairAllowed(PAIR, false)` if the check was wrong. A refusal does not relabel it as a stock.

## Token list

Add one object to the runtime list the API reads from disk (`services/api/token-list.json`). Editing that file does not require a rebuild.

```json
{
  "address": "PAIR",
  "symbol": "wSPACEx",
  "name": "TEST Wrapped SpaceX",
  "category": "preipo",
  "logo": "ipfs://CID"
}
```

Logos and descriptions live in that file or in the coin's IPFS document. They are not compiled into the web app.

## See it

- `Launcher.categoryOf(PAIR)` is 2 and `pairAllowed(PAIR)` is true.
- `BuybackExecutor.routeOk(PAIR)` is true.
- The API `GET /pairs?category=preipo` includes the address after the indexer sees `PairClassified`.
- The launch picker and the home Pre-IPO chip list it. A coin launched against it appears on the coin page.
- A platform buyback sells the pair for WHYPE on the registered pool, then WHYPE for the platform coin. Both hops use the 30-minute TWAP and the 2% band.

Until a pair is listed this way, the Pre-IPO chip says "No pre-IPO tokens on Elysium yet".
