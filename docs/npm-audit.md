# npm audit

Recorded after the recheck-2 web dependencies (`npm audit`, 9 Nov 2026).

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 17 |
| Moderate | 13 |
| Low | 2 |

Every high is transitive. `npm audit` offers a fix only by jumping to `wagmi@3.7.11` or `next@16.4.5`. Both are major upgrades. RainbowKit 2.2 is built on wagmi 2, and the app is on Next 15, so those jumps are not a safe upgrade for this tree. `npm audit fix` without `--force` does not clear the highs. Do not run `npm audit fix --force`.

| Package | Why it is high | How it is reached | Safe upgrade |
|---|---|---|---|
| `ws` 8.0.0–8.20.1 | Uninitialized memory disclosure; memory exhaustion from tiny fragments | nested `viem` pulled by wagmi / RainbowKit | No. The suggested fix is wagmi 3 |
| `zod` <4.6.6 | Memory exhaustion on oversized constrained collections | `abitype`, `@coinbase/cdp-sdk`, `@reown/appkit-wallet` | No. Suggested fix is wagmi 3 |
| `abitype` through 1.0.9 | Reaches the `zod` issue above | wagmi / viem | No |
| `viem` through 2.49.3 | Reaches `abitype` and `ws` | direct dependency, also nested under wagmi | No. Pinned with wagmi 2 |
| `@walletconnect/utils` | Reaches `query-string` and `viem` | RainbowKit / Reown | No |
| `query-string` 5.0.0–9.4.1 | Reaches `decode-uri-component` | `@walletconnect/utils` | No |
| `decode-uri-component` <=0.5.0 | Denial of service on malformed percent-encoding | `query-string` | No |
| `@walletconnect/ethereum-provider` | Reaches Reown and sign-client | RainbowKit | No |
| `@reown/appkit` and its `controllers`, `pay`, `scaffold-ui`, `ui`, `utils`, `wallet` packages | Reaches WalletConnect, `zod`, and the packages above | RainbowKit | No |
| `@coinbase/cdp-sdk` >=1.0.0 | Reaches `abitype` and `zod` | `@wagmi/connectors` base-account connector, imported by RainbowKit | No. The web build stubs `@x402/*` so those modules are not bundled |
| `postcss` <=8.5.22 | XSS in CSS stringify; source-map path read | Next 15 | No. The suggested fix is Next 16 |

Direct dependencies stay on the pinned ranges in `apps/web/package.json` (`next` ^15.1.3, `viem` ^2.22.9, `wagmi` ^2.14.6, `@rainbow-me/rainbowkit` ^2.2.11). The indexer also depends on `viem` ^2.22.9 and `pg`. That does not add an advisory; the counts above are unchanged. Revisit this list when RainbowKit supports wagmi 3, or when Next 15 ships a `postcss` release that clears GHSA-6g55-p6wh-862q without a major bump.
