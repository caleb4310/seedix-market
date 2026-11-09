# Seedix

Seedix is a Longbow-style memecoin launchpad for Kinetiq Elysium. This repository is the week-1 foundation: Foundry contracts with a real fee engine, a testnet deploy script, an indexer and API, and a web app wired to chain 99801.

It is testnet only. The deploy script reverts on every chain except Elysium testnet (`99801`) and local Anvil (`31337`). Do not broadcast it to a public RPC.

## Layout

| Path | What it is |
|---|---|
| `contracts/` | Foundry contracts, tests, and the deploy script |
| `apps/web/` | Next.js app. Wallet connect uses a custom chain for 99801 |
| `services/` | Indexer, API, Kickback publisher, and keeper. Postgres migrations live with the indexer |
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

- **Admin** comes from `ADMIN`, or from the deployer address when `ADMIN` is unset. The deploy key hands admin, guardian, timelock proposer, and timelock executor to that wallet, then renounces them. When `ADMIN` is the deployer address, those three timelock roles are kept and only the timelock default admin is renounced. Admin queues the 48-hour fee-wallet change and the one-time platform-token launch. It cannot move pots. On this testnet, `setKeeper` is an immediate admin call so buybacks and Kickback pushes can be turned on after deploy. Mainnet must send that grant through the timelock. Revoking the keeper stays immediate.
- **Keeper** comes from `KEEPER`. Deploy grants that address the buyback keeper and the Kickback keeper, then burns the deploy-time grant. An empty `KEEPER` grants nobody. The deployer cannot call the grant afterwards.
- **Guardian** is a separate role in `SeedixRoles`. Deploy assigns it to the same admin address, so pause and Kickback cancel are immediate. `queueSetGuardian` moves it later through the timelock, without a new deployment.

## Deploy dry-run

The script deploys a local v4 stack (PoolManager, PositionManager, StateView, V4Quoter, and `SeedixRouter`), five mock xStocks, and the Seedix contracts. It does not deploy Universal Router. `SeedixRouter` is the minimal router; Universal Router is GPL-3.0 and is left unmodified for a later testnet install.

```bash
# terminal 1. Anvil's default chain id is 31337. Do not pass --chain-id 99801:
# that id expects canonical WHYPE, USDC, and Permit2 code, and the script reverts MissingCode.
anvil --port 8545

# terminal 2, from contracts/. Simulation only: no --broadcast.
# Set PRIVATE_KEY to the Anvil account printed at startup. Do not point this at a public RPC.
PRIVATE_KEY=$ANVIL_ACCOUNT_0 forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545
```

The script reverts if `block.chainid` is anything other than 99801 or 31337. Add `--broadcast` only when the RPC is local Anvil and you want the deployment kept.

Dry-run against Elysium testnet. This does not broadcast. `ADMIN` is the wallet that receives the roles. `PRIVATE_KEY` is only the deployer key used for the simulation. `KEEPER` receives both keeper roles.

```bash
cd contracts
ADMIN=0xYourAdminAddress \
KICKBACK_PUBLISHER=0xYourPublisherAddress \
KEEPER=0xYourKeeperAddress \
PRIVATE_KEY=0xDeployerSimulationKey \
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.elysium.kinetiq.xyz
```

Do not pass `--broadcast`. Mainnet (99901) is not this script.

On Anvil, Permit2 is not at the canonical address, so the script deploys a stand-in and points PositionManager at it. On 99801 the real Permit2 is reused.

## Redeploy Kickback auto-push

`LaunchHook.kickbackDistributor` is immutable. The live auto-push deployment is in [`deployments/99801.json`](deployments/99801.json): hook `0x2FD55b6d1fAe64f156CF6e14b03775B1F781e8cC`, distributor `0xB023F3b7D35420d98fB205C0B96BC25Ed3e60a0E`, indexer start block `26841592`. The previous hook `0x11250C2cD56d4E37a3f8390570A99703848768cC` is retired. This repository does not broadcast deploys.

From `contracts/`, simulation only:

```bash
ADMIN=0xYourAdminAddress \
KICKBACK_PUBLISHER=0xYourPublisherAddress \
KEEPER=0xYourKeeperAddress \
PRIVATE_KEY=0xDeployerSimulationKey \
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.elysium.kinetiq.xyz
```

| Variable | Required | What it does |
|---|---|---|
| `PRIVATE_KEY` | yes | Deployer key used for the simulation. Do not commit it |
| `ADMIN` | no | Admin, guardian, and timelock proposer, executor, and canceller. Defaults to the deployer address. If it equals the deployer, those three timelock roles are kept and the timelock default admin is still renounced |
| `KICKBACK_PUBLISHER` | no | The only key that can fund a Kickback round and post its root. Defaults to `ADMIN` |
| `KEEPER` | no | Buyback keeper and Kickback keeper. Empty means no keeper is granted and the deploy-time grant is burned |

Chain id must be 99801. The script reverts on every other chain except local Anvil (31337). Do not add `--broadcast` against the public RPC. Do not point `PRIVATE_KEY` at a key you use anywhere else.

A new broadcast replaces the addresses in `deployments/99801.json`, `services/shared/src/index.ts`, and the `NEXT_PUBLIC_*` / service variables in `.env`. The committed values are the live 99801 deployment.

## Web

A production build lists coins from `Launcher` `CoinLaunched` logs. Set `NEXT_PUBLIC_LAUNCHER` and `NEXT_PUBLIC_HOOK` (and the router, quoter, and state view) or the board is empty: "No coins yet. Launch the first one." Mock coins in `apps/web/lib/mock.ts` load only in `next dev`, and only when `NEXT_PUBLIC_LAUNCHER` is empty.

`NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE` is the transaction link, with `{hash}` replaced by the hash. The live default is `https://explorer-elysium-testnet.t.conduit.xyz/tx/{hash}`. Addresses and the indexer start block (`26841592`, the block of deploy tx `0xe60b64d6…8609`) are in `deployments/99801.json`.

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

`/coin/kiln` is still inside the 10 second decay, so the buy panel asks you to confirm the hook fee. Add `?side=sell` to see the sell receipt. Add `?theme=dark` for the dark palette. With no browser wallet, Connect explains that and links to a wallet install. Nothing is marked confirmed until a transaction hash comes back.

Set `NEXT_PUBLIC_API_URL` to read the board, the price chart, Kickback history, and the portfolio from the API. Leave it empty and the board still reads `CoinLaunched` from the chain. Trades still quote with the extreme sqrt price limit, not a band around the spot price.

Wallet connection uses RainbowKit on wagmi and viem. Elysium testnet (99801) is registered as a custom chain. The modal colors come from `apps/web/lib/tokens.ts`, and they follow the Seedix light and dark toggle. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (see `.env.example`) to add WalletConnect. If that variable is empty, the modal offers injected wallets only.

## Services and infra

The indexer follows chain 99801 from the deploy block and writes launches, swaps, fees, buybacks, holder balances, and Kickback payouts into the host `launchpad` database. Migrations are `services/indexer/migrations/0001_init.sql`, `0002_activity.sql`, and `0003_reorg.sql`. The API listens on port 3001 and serves `/coins`, charts, holders, swaps, kickbacks, buybacks, and `/portfolio/:address`. The keeper signs buybacks and Kickback pushes. `KEEPER_PRIVATE_KEY` is a file path, not the key. Set `DATABASE_URL` to the host database. No private key belongs in the indexer or the API.

`infra/docker-compose.yml` is project `launchpad` on network `launchpad_net`. It uses the host Postgres socket and does not start a database. Nginx stays the host's: install `infra/nginx/sites-available/launchpad.conf` as its own site and do not edit the others. Ports are `127.0.0.1` in the 18400 range. Kubo API 5001 is not published. The keeper reads `/run/secrets/keeper_key` through `KEEPER_PRIVATE_KEY`, mounted from `SEEDIX_KEEPER_KEY_FILE` (default `/etc/seedix/keeper.key`). That file is mode 600, owned by root, and it is not in the repo. Build the web on the host with `NEXT_PUBLIC_API_URL=/api` before `docker compose up`, so the browser calls the API through nginx.

Nginx: copy `infra/nginx/sites-available/launchpad.conf` to `/etc/nginx/sites-available/launchpad.conf`, symlink it, replace `SEEDIX_DOMAIN`, then `nginx -t` and `systemctl reload nginx`. Certificate: `certbot --nginx -d SEEDIX_DOMAIN`. Do not edit other site files.

Backups: `infra/backup/nightly-pg-dump.sh` dumps only the `launchpad` database to `/srv/backups/launchpad`.

## What is real this week, and what is a skeleton

Real: fee math, pot accounting, 6909 debits, oracle cadence, launch and seed, creator and wallet claims, Kickback fund / root / claim / cancel, Kickback auto-push, buyback swap and burn, the indexer, the read API, the keeper, coin `burn()`, timelocked fee wallet, guardian pause.

The keeper signs buybacks on the 5 minute interval and Kickback pushes in batches of 32, then seals the round. Set `KEEPER_PRIVATE_KEY` to a path. That file is mode 600 and owned by root, or a Docker secret under `/run/secrets`. The key is not an environment value and it is never logged. A transaction whose fee or gas estimate is above `KEEPER_MAX_FEE_GWEI` or `KEEPER_MAX_GAS` is skipped. Manifests for `push` are JSON files in `KICKBACK_MANIFEST_DIR`. The keeper rebuilds the tree and skips a file whose root does not match the posted root.

Skeleton: the Kickback publisher. The web trade card quotes with V4Quoter when `NEXT_PUBLIC_ROUTER`, `NEXT_PUBLIC_QUOTER`, and `NEXT_PUBLIC_STATE_VIEW` are set, and refuses to sign without that quote.
