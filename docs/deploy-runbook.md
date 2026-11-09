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
