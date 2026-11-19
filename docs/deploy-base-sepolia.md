# Run the site on Base Sepolia

The public site should use the contracts in `deployments/base-sepolia.json`. Elysium (99801) stays in the repo. Point the server at Base Sepolia with `infra/env/base-sepolia.app.env.example`.

## Server steps

1. Copy `infra/env/base-sepolia.app.env.example` to `/etc/seedix/app.env`.
2. Replace the placeholders. Do not put a private key in the env file.
   - `DATABASE_URL` password.
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
   - Create `/etc/seedix/keeper.key` and `/etc/seedix/publisher.key` with `install -m 600 -o root`. Those paths are `SEEDIX_KEEPER_KEY_FILE` and `SEEDIX_PUBLISHER_KEY_FILE`.
3. Create a new Postgres database, for example `seedix_base`. Do not point this stack at the Elysium database. Rows are stored with a chain id, but the indexer cursor, logos, and kickback manifests are easier to keep straight in a fresh database. The indexer starts at block `60147699`, the block of the first launch-stack transaction `0x1c3c23b3…b9a3df9`. It walks 2,000 blocks at a time. The public RPC refuses a log query wider than 50,000 blocks, so the web fallback splits its own reads into 40,000-block windows.
4. Fund the keeper address `0x86d9AB7C8A915DBf9dd2C2ba533d10bdb87801D6` with Base Sepolia ETH. That address pays gas for buybacks and Kickback pushes. The same address is the recorded keeper, admin, and fee wallet. The ZRO tax swapper at `0x877BA6666EAf0cd0755fEA0271d407C86922b780` is a separate contract. This keeper process does not call `harvest`. A harvest still needs ETH on whichever key is set as that swapper's keeper.
5. Rebuild the web image so Next inlines the `NEXT_PUBLIC_*` values, then start the stack:

```bash
docker compose --env-file /etc/seedix/app.env -f infra/docker-compose.yml build web
docker compose --env-file /etc/seedix/app.env -f infra/docker-compose.yml up -d
```

`NEXT_PUBLIC_ZRO_TAX_ENABLED=true` shows the holder-tax field. `NEXT_PUBLIC_ZRO_REMOTE_CLAIM_ENABLED` stays false: the payout module and remote OFT are not in `deployments/base-sepolia.json`.

To run Elysium instead, set `CHAIN_ID=99801`, `NATIVE_CURRENCY_SYMBOL=HYPE`, `PRICE_COINGECKO_ID=hyperliquid`, `NEXT_PUBLIC_ZRO_TAX_ENABLED=false`, and the addresses in `deployments/99801.json`.

## What is already deployed

| Name | Address |
|---|---|
| Launcher | `0xb0F9D152e76D5232A13672EA531aD7BB223e81FB` |
| Hook | `0xF76b84C90c49a785322f110c66d1155bc26228cC` |
| Router | `0xade24CcEb8309b22b9c74D90da93B7A3F1e06239` |
| Buyback executor | `0x1885501719d334A7f193aed6F1038b15b42075d3` |
| Kickback distributor | `0xd6CfAfb4f77F7f62602ea861027eA55667fd4840` |
| WETH | `0x4200000000000000000000000000000000000006` |
| Mock ZRO | `0x6f4A6aA928eaDf287CE3210b5254888dD9407eEd` |
| ZRO/WETH pool | `0x868abca7a21babe90ee2123194ea6c816d357778ccd653a4801ddde070137298` |
| Quoter | `0x5e6B8B8AFA7e5CEF6C09dd2A67aBA9FB12C75623` |
| State view | `0x571291b572ed32ce6751a2cb2486ebee8defb9b4` |

The quoter and state view are the public Uniswap v4 contracts on Base Sepolia, not contracts this repo deployed.
