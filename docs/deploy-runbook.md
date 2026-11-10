# Deploy runbook

The web image is built by Compose. Next.js copies `NEXT_PUBLIC_*` into the browser bundle while `npm run build` runs. A container restart does not pick up a new value.

## Env file

On the server the file is `/etc/seedix/app.env`. It is not in git. Put the real WalletConnect project id there:

```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<project id from Reown>
NEXT_PUBLIC_API_URL=/api
```

`.env.example` has the placeholder `replace-with-walletconnect-project-id`. That placeholder is not a project id. Do not replace it with a real id in the repository.

## Build

From the repo root:

```bash
docker compose --env-file /etc/seedix/app.env -f infra/docker-compose.yml build web
docker compose --env-file /etc/seedix/app.env -f infra/docker-compose.yml up -d
```

Compose reads `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` from that env file and passes it to `infra/Dockerfile.web` as a build arg. The Dockerfile sets the same name in the environment for the Next.js build. An empty value leaves WalletConnect out of the wallet list. Injected wallets (MetaMask, Rabby) still connect.

`NEXT_PUBLIC_API_URL` is passed the same way. The default is `/api`, which nginx proxies to the API container.

Changing the project id, or the API URL, means running `build web` again and recreating the web container. `docker compose up -d` without a rebuild keeps the old bundle.

## WHYPE for the seed

The script spends exactly 1.05 WHYPE (7 pools × 0.15). If the deployer holds 0.05 WHYPE, wrap 1.00 HYPE into WHYPE before broadcasting. Native HYPE left after that wrap pays gas. Pools are coin/WHYPE. The stock and pre-IPO tokens are backing assets, not the pool pair.

## Indexer and keeper

Pass the same env file on every Compose command. The indexer and keeper services interpolate these names from it, so a separate override file is not required. An empty value leaves the process on the address compiled into `deployments/99801.json`.

```
LAUNCHER_ADDRESS=
HOOK_ADDRESS=
POOL_MANAGER_ADDRESS=
BUYBACK_EXECUTOR=
KICKBACK_DISTRIBUTOR=
METADATA_ADDRESS=
INDEXER_START_BLOCK=
INDEXER_POLL_MS=12000
INDEXER_CONFIRMATIONS=12
RPC_URL=https://testnet-rpc.elysium.kinetiq.xyz
```

`METADATA_ADDRESS` is CoinMetadata. The indexer reads it from the env file when set, and otherwise from `contracts.coinMetadata` in `deployments/99801.json`.

Recreate the containers after an address change. The indexer and keeper are not baked into an image, so `docker compose --env-file /etc/seedix/app.env -f infra/docker-compose.yml up -d` is enough. The web image still needs `build web` when a `NEXT_PUBLIC_*` value changes, including `NEXT_PUBLIC_LAUNCHER`, `NEXT_PUBLIC_HOOK`, `NEXT_PUBLIC_ROUTER`, `NEXT_PUBLIC_QUOTER`, and `NEXT_PUBLIC_STATE_VIEW`. Those five are compiled into the source deployment and are not Compose build args. A new broadcast that changes them means updating the source and rebuilding the web image.
