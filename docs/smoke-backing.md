# Testnet smoke: backing conversion

Chain 99801. The pool is always coin/WHYPE. The token chosen at launch is the backing asset.

1. Keep. Launch against a seeded stock (wNVDAx). Buy and sell with WHYPE. After 30 minutes, the keeper calls `BuybackExecutor.convertAccrued`. The creator's wNVDAx balance rises. The WHYPE creator pot drops. If the route is outside the TWAP band, `convertAccrued` reverts and the WHYPE stays in the pot.
2. Kickback. Same launch with mode 1 on a vetted backing token. `convertAccrued` sends the backing token to `KickbackDistributor` and records `poolCarry`. The publisher then `fund(poolId, 0)`.
3. Burn. Launch with no backing token. The picker is hidden. Fees stay in WHYPE. `buybackCoin` buys the coin and burns it. `convertAccrued` reverts `Nothing`.

Platform fee, the early-fee burn, the 80% to 1% decay, and the 0.1% LP fee are unchanged. Platform fees are WHYPE because that is the pool pair.
