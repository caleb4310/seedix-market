# Mainnet checklist

- [ ] User to provide or confirm the production WalletConnect project ID (domain allowlisted in Reown) before mainnet.
- [ ] HYPE/USD comes from CoinGecko `simple/price?ids=hyperliquid` (`services/api/src/routes.ts`, `hypeQuote`). The API caches it for 60 seconds and serves the last good price if the next fetch fails. CoinGecko's free tier is roughly 5–15 calls a minute; one process refreshing every minute stays inside that. Do not call CoinGecko from the browser. If the quote is missing, the UI shows HYPE and says the price is unavailable.
- [ ] Backing tokens (stocks, pre-IPO, pasted contracts) are the registry in `Launcher.setPair`. They are not the Uniswap pair. Every pool is coin/WHYPE. A pre-IPO listing is still the timelock in `docs/runbooks/add-preipo-token.md`: `setPair` plus `registerExternal` on the WHYPE route.
