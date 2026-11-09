# Invariant and fuzz coverage

Handlers live in `test/invariant/handlers/FeeHandler.sol`. `FeeHandler._afterAction` is virtual so a reviewer can record more ghost state without rewriting the swaps.

| Id | Status | Where |
|---|---|---|
| F-1, F-3, F-5, F-9 | Done | `FeeMath.t.sol`, `SwapFees.t.sol`, solvency invariant |
| F-2 | Done | `invariant_platformFeeNotInCoin`, sell test |
| F-6 | Done, within 0.3% | `ExactOutTest.test_exactOutBuyIsCloseToExactIn` on two fresh pools |
| F-7 | Partial | Exact-in sell is tested to the wei. Exact-out sell checks pot conservation, not 1-wei parity |
| F-4 exempt | Stubbed | The check is `sender == buybackExecutor`. The executor does not swap yet (`BuybackSwapDeferred`) |
| F-8 quoter parity | Stubbed | V4Quoter is deployed by the script. No differential test yet |
| F-10 partial fill | Documented | `docs/fees.md`. Not changed |
| F-11, F-12 | Partial | Safe casts. Dust is allowed to round to zero |
| M-1, M-2, M-3 | Done | `ModeTest` after decay. During decay the excess is burned in every mode |
| M-5, M-6, M-8, M-9 | Done | `Launch.t.sol` |
| M-7 | Done | `test_platformTokenOnceAndBurn` |
| M-4 LP collect | Implemented, light test | `LiquidityLocker.collect` |
| M-10 self-snipe | Done | Excess is burned. Same-transaction buy reverts |
| P-1, P-6 | Done | `FeeInvariantTest`, `test_noOperator` |
| P-2, P-3, P-5, P-7 | Partial | Solvency covers P-1. No reentrant-token test yet |
| P-4 | Done | Creator claim pays the fee recipient |
| B-1, B-2, B-4 | Done | `Oracle.t.sol` |
| B-3 | Partial | Spam over 40 seconds cannot flush a 30-minute window. No 1-hour organic soak |
| B-5, B-6 | Partial | Band and min-out are pure-tested. The swap that would use them is deferred |
| B-7, B-8, B-9, B-10, B-12 | Stubbed | Interval storage exists. No per-period cap. No profitability fuzz |
| B-11 | Done as fail-closed | Unregistered xStock to WHYPE routes revert |
| K-1, K-6, K-7, K-8, K-9, K-12 | Done | `Kickback.t.sol` |
| K-2, K-3, K-4 | Partial | Single-leaf claims, double-claim, domain-separated leaf. No multi-leaf fuzz |
| K-5, K-10, K-11, K-13, K-14 | Stubbed | Sweep reverts `SweepNotEnabled`. No FFI tree parity |
| T-1, T-4, T-6 | Done | 48h fee wallet. Guardian pause is instant. Unpause is timelocked |
| T-3 | Done as one key | Guardian address equals admin at deploy and can be moved with the timelock |
| S-1, S-3 | Done | Supply and 5% team cap |
| S-2 | Done for coin-side burns | `burn()` reduces total supply |
| D-1 | Done | `test_hookFlags` |
| D-5 | Done | CI job `block-number-ban` |

CI invariant profile is 16 runs and depth 12 so the job finishes. `foundry.toml` `[profile.ci.invariant]` is the knob to raise toward the review's 512/200.
