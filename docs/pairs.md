# Pairs

Vetted pairs are listed by the timelock with a category: crypto, stock, or pre-IPO. The guardian can refuse a pair and cannot relabel one into a stock. Kickback requires a vetted pair. Keep and Burn are allowed for a pasted pair that passes the launch checks.

Those checks are code, readable name and symbol, decimals from 6 to 18, a balance-delta fee-on-transfer probe, and a rejection of Seedix launch tokens and the protocol contracts. Every pair except WHYPE also needs a registered WHYPE pool whose one-spacing depth is at least `minRouteDepth`.

`minRouteDepth` is timelock-set. The documented mainnet value is 10,000 WHYPE. Chain 99801 is deployed at 0.15 WHYPE so seven mock pools fit under 1.5 WHYPE. A suggested 0.5 WHYPE per pool would be 3.5 WHYPE across seven pools, which does not fit that cap.

## Rebasing

Unwrapped xStocks rebase. The testnet `MockXStock` does not: `multiplier` is display-only and balances stay put. The mainnet `w`-prefixed addresses in `deployments/99901.pairs.json` are unverified. Do not assume they are non-rebasing.

A rebasing pair is unsafe for the v4 pool. The PoolManager's token balance is the reserve, and a rebase changes it without a swap. It is also unsafe for Kickback: `liabilities` is a nominal amount. A negative rebase means holders cannot be paid in full. `recoverSurplus` sends a balance above `liabilities` to a timelocked recipient. It does not reduce `liabilities`, and it cannot repair reserves sitting in the PoolManager. The hook can sweep stray ERC-20 sent to the hook itself. That is not the pool's reserve.

## Adding a pre-IPO token

See `docs/runbooks/add-preipo-token.md`. The web and the indexer learn the list from `PairClassified` events. No rebuild.
