# Fee paths

All rates are in pips where `1e6 = 100%`. The hook fee starts at `800_000` (80%) and falls by `79_000` each whole second, reaching `10_000` (1%) at 10 seconds. The platform fee is `10_000` (1%) on every non-exempt swap, including the first 10 seconds. The LP fee is the pool's static `1000` (0.1%) and is not taken by the hook.

`gross` is the amount the trader specifies, or the amount reconstructed so the trader pays the designed rate. Exact-in rounds each line down (`floor(gross * pips / 1e6)`). Exact-out is the one place that rounds up: `gross = ceil(net * 1e6 / (1e6 - pips))` and `fee = gross - net`. Wei left over goes to the trader on exact-in, and the exact-out path charges at least the designed rate.

The hook returns a positive delta for currency it takes. It mints ERC-6909 claims for the same amount in the same callback. `beforeSwap` can only change the specified side. `afterSwap` can only change the unspecified side.

| Case | Callback | Fee line | Currency | Rounding |
|---|---|---|---|---|
| Buy, exact-in | `beforeSwap` specified | Hook and platform | Pair (input) | Floor each line on the specified gross |
| Buy, exact-out | `afterSwap` unspecified | Hook and platform | Pair (input) | Gross-up on `hookPips + 10_000`. Split the fee in proportion to the rates. Remainder to the platform line so the parts sum to the fee |
| Sell, exact-in | `beforeSwap` specified | Hook | Coin (input) | Floor on the specified coin gross |
| Sell, exact-in | `afterSwap` unspecified | Platform | Pair (output) | Floor on the pool's pair output |
| Sell, exact-out | `beforeSwap` specified | Platform | Pair (output) | Gross-up so the pool produces `ceil(X * 1e6 / 990_000)` and the trader receives exactly X |
| Sell, exact-out | `afterSwap` unspecified | Hook | Coin (input) | Gross-up on the hook rate alone |

A buy is a swap whose input is the pair token. A sell is a swap whose input is the coin.

## Where the hook fee goes

While the decay is running, the hook fee is split into a 1% base and the remainder:

```
base = hookAmt * 10_000 / hookPips
excess = hookAmt - base
```

After 10 seconds `hookPips` is `10_000`, so the base is the whole fee and the excess is zero. The creator's mode then receives 100% of that 1%.

| Portion | Keep | Kick back | Burn | Platform token |
|---|---|---|---|---|
| Base, pair side | Creator pair pot | Kickback pot | Burn-pair pot | Platform burn pot |
| Base, coin side | Creator coin pot | Creator coin pot | Burn-coin pot | Burn-coin pot |
| Excess, either side, during the 10s | Burn pot of that side, in every mode | same | same | same |

The excess is what buys the coin back (pair token, via `burnPair`) or is burned directly (coin, via `burnCoin`). `burnCoinSide` calls `LaunchToken.burn`, which reduces `totalSupply`. Pair-side buyback swaps are guarded and currently revert with `BuybackSwapDeferred` after the guard; the pots still account the tokens.

The platform fee is always in the pair token. On a normal pool it splits `burn = plat/2`, `wallet = plat - burn`. On the platform token the wallet share is zero and the whole platform fee is burned.

Swaps whose PoolManager sender is the buyback executor pay neither fee.

## Launch transaction

`Launcher.launch` deploys the coin, initialises the pool, and seeds it in one call. It arms a transient guard for that pool. Any swap in the same transaction reverts with `SwapDuringLaunch`, so the creator cannot buy inside the launch transaction. The guard clears when the transaction ends.

## Oracle

Observations are written at most once per 30 seconds, from the pre-swap tick. Sixty-four slots cover 31.5 minutes. `consult(30 minutes)` reverts with `OracleLib.WindowNotCovered` until an observation is at least 30 minutes old. Buybacks revert while the pool is younger than 30 minutes, or when spot is more than 198 ticks (about 2%) from that TWAP.

## Known limit

Exact-in fees are taken on the full specified amount. A swap that stops early because of `sqrtPriceLimitX96` can pay a fee on input that never reached the pool (review L-02). The router used by the app sends a limit at the edge of the price range, so a normal swap fills.
