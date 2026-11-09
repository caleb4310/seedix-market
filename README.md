# Seedix

Seedix is a Longbow-style memecoin launchpad for Kinetiq Elysium. This repository is the week-1 foundation: Foundry contracts with a real fee engine, a testnet deploy script, service skeletons, and a static web app wired to chain 99801.

It is testnet only. The deploy script reverts on every chain except Elysium testnet (`99801`) and local Anvil (`31337`). Do not broadcast it to a public RPC.

## Layout

| Path | What it is |
|---|---|
| `contracts/` | Foundry contracts, tests, and the deploy script |
| `apps/web/` | Next.js app. Wallet connect uses a custom chain for 99801 |
| `services/` | Indexer, API, Kickback publisher, and keeper skeletons, plus the Postgres migration |
| `infra/` | Compose project `launchpad`, nginx site file, nightly `pg_dump` |

## Fee model

Three lines on every trade. After the first 10 seconds a trader pays about 2.1%.

| Line | Rate | Currency | Destination |
|---|---|---|---|
| Platform | 1%, including the first 10 seconds | Pair token | Half to the platform-token burn pot, half to `0xf4383D1Ecfb525294A266929c7D4796314a764F9` |
| Hook | 80% at launch, down to 1% over 10 seconds, then 1% | Input token | The 1% base follows Keep / Kick back / Burn. During the decay, everything above 1% buys the coin back or is burned, in every mode |
| LP | 0.1% | Input token | Creator, via the locked position |

The path-by-path table, including exact-out gross-up, is in [`contracts/docs/fees.md`](contracts/docs/fees.md). Coverage against the review is in [`contracts/docs/INVARIANTS.md`](contracts/docs/INVARIANTS.md).

A launch is one transaction. The seeded range sits on the coin side of the starting price, and a swap in that same transaction reverts.

## Pins

| Dependency | Commit |
|---|---|
| Uniswap v4-core `1.0.2` | `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` |
| Uniswap v4-periphery | `c6e4754dab11bd38c6f08ac51c3c868569e93d64` |
| OpenZeppelin contracts `v5.4.0` | `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0` |
| Permit2 | `cc306b601f172c51bc04334a109e98340456620b` |

`v4-core` is BUSL-1.1 and is a git submodule, not copied into `src/`. Mainnet will use Uniswap's deployment (`PoolManager` `0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1` on chain 99901). Addresses stay per chain. `beforeInitialize` on this core commit has no hook data, so the launcher stages the pool config and the hook checks it against the `PoolKey`.

Time uses `block.timestamp` only. CI job `block-number-ban` fails if `block.number` appears under `contracts/src`. An L2 block id, if one is ever required, comes from `ArbSys` at `0x64`.

## Contracts

```bash
cd contracts
forge fmt --check
forge test
```

`forge test` includes the fuzz tests and the invariant suite. The hook runtime is under 24 KB.

Roles:

- **Admin** comes from `ADMIN`, or from the deployer address when `ADMIN` is unset. The deploy key hands admin, guardian, timelock proposer, and timelock executor to that wallet, then renounces them. Admin queues the 48-hour fee-wallet change and the one-time platform-token launch. It cannot move pots.
- **Guardian** is a separate role in `SeedixRoles`. Deploy assigns it to the same admin address, so pause and Kickback cancel are immediate. `queueSetGuardian` moves it later through the timelock, without a new deployment.

## Deploy dry-run

The script deploys a local v4 stack (PoolManager, PositionManager, StateView, V4Quoter, and `SeedixRouter`), five mock xStocks, and the Seedix contracts. It does not deploy Universal Router. `SeedixRouter` is the minimal router; Universal Router is GPL-3.0 and is left unmodified for a later testnet install.

```bash
# terminal 1
anvil --chain-id 99801 --port 8545

# terminal 2, from contracts/. Simulation only: no --broadcast.
# Set PRIVATE_KEY to the Anvil account printed at startup. Do not point this at a public RPC.
PRIVATE_KEY=$ANVIL_ACCOUNT_0 forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545
```

The script reverts if `block.chainid` is anything other than 99801 or 31337. Add `--broadcast` only when the RPC is local Anvil and you want the deployment kept.

On Anvil, Permit2 is not at the canonical address, so the script deploys a stand-in and points PositionManager at it. On 99801 the real Permit2 is reused.

## Web

The pages render from mock coins in `apps/web/lib/mock.ts`. No indexer and no wallet are required to click through Home, Launch, and a coin.

```bash
npm install
npm run dev
```

`npm run dev` starts the Next.js app (the same command as `npm run dev -w @seedix/web`). Open http://localhost:3000.

Check these widths with the browser device toolbar. Nothing should scroll sideways, overlap, or clip:

| Width | What to open |
|---|---|
| 375 | Home, `/launch`, `/coin/kiln` |
| 768 | the same three routes |
| 1024 | the same three routes |
| 1440 | the same three routes |

`/coin/kiln` is still inside the 10 second decay, so the buy panel asks you to confirm the hook fee. Add `?side=sell` to see the sell receipt. Add `?theme=dark` for the dark palette. Signing a trade or finishing the launch hold shows a toast. The swap itself is not broadcast.

The app defines chain 99801 itself. It does not use viem's `elysiumTestnet`, which is a different network. Connect uses the injected wallet and asks for chain 99801.

## Services and infra

Services are TypeScript skeletons with a shared chain config. The indexer migration is `services/indexer/migrations/0001_init.sql`.

`infra/docker-compose.yml` is project `launchpad` on network `launchpad_net`. Ports are `127.0.0.1` in the 18400 range. Kubo API 5001 is not published. There is no Postgres container. API and indexer mount the host socket and use role `launchpad`.

Nginx: copy `infra/nginx/sites-available/launchpad.conf` to `/etc/nginx/sites-available/launchpad.conf`, symlink it, replace `SEEDIX_DOMAIN`, then `nginx -t` and `systemctl reload nginx`. Certificate: `certbot --nginx -d SEEDIX_DOMAIN`. Do not edit other site files.

Backups: `infra/backup/nightly-pg-dump.sh` dumps only the `launchpad` database to `/srv/backups/launchpad`.

## What is real this week, and what is a skeleton

Real: fee math, pot accounting, 6909 debits, oracle cadence, launch and seed, creator and wallet claims, Kickback fund / root / claim / cancel, coin `burn()`, timelocked fee wallet, guardian pause.

Skeleton: buyback swaps (guards run, then `BuybackSwapDeferred`), Kickback sweep, indexer, API, keeper, and the web transaction path.
