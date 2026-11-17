# ZRO Kickback, phase 1

Holder rewards on Seedix's own Uniswap v4 pools can be paid in ZRO. The creator sets a tax. The hook escrows it in the pair token. A keeper swaps that tax to ZRO outside the swap callback and funds an hourly round. Holders pull their share from the vault.

The default Seedix protocol fee is **1% ON_TOP**: it is added to the creator tax. The other mode, `FROM_CREATOR_TAX`, takes that 1% out of the creator tax instead. Only the owner or the timelock can switch the mode or change the protocol rate, and the protocol rate cannot exceed 1%.

This phase is testnet only. The live Elysium deployment is not changed and is not a target of the new scripts. Zero mainnet is the intended later home, so every chain address lives in `contracts/config/chains/<chainId>.json` or in the environment.

## Formula

Rates are in basis points. `10_000 = 100%`. The protocol fee defaults to `100` (1%). The creator rate has to be above zero and cannot exceed `900` (9%). A zero rate reverts `CreatorTaxZero` from `launchWithZroTax`, `setCreatorTax`, and `setCreatorTaxFromLauncher`. The trader's effective rate cannot exceed `1_000` (10%).

`ON_TOP` (default, mode `1`):

```
holder    = floor(notional * creatorBps / 10_000)
protocol  = floor(notional * protocolBps / 10_000)
trader    = holder + protocol
effective = creatorBps + protocolBps
```

A creator tax of 5% shows as **6%**: 5% swapped to ZRO for holders, plus 1% Seedix.

`FROM_CREATOR_TAX` (mode `0`):

```
tax       = floor(notional * creatorBps / 10_000)
protocol  = min(tax, floor(notional * protocolBps / 10_000))
holder    = tax - protocol
trader    = tax
effective = creatorBps
```

Exact-out grosses the effective rate up so the trader still receives the amount they asked for. The fee is then split so the holder and protocol lines sum to the fee taken.

A round is one hour, `[epoch * 3600, epoch * 3600 + 3600)`.

```
weight(account) = ∫ balance(account, t) dt
totalWeight     = ∫ eligibleSupply(t) dt
payout          = floor(weight * fundedZro / totalWeight)
```

A transfer or a sell changes the balance at that timestamp. The sender stops accruing on the tokens that left. The receiver's new tokens start at zero accrued time, so a buy in the last second of the hour earns about `balance * 1` against a full hour of `balance * 3600`. A self-transfer does not change the balance or the integral. A buy and a sell in the same timestamp add `balance * 0`.

The zero address, the hook, the router, and the pool (the PoolManager that holds the reserves) are excluded. Their balances are not in `eligibleSupply` and their weight is zero. The owner can exclude more addresses, such as the locker and the launcher, before trading starts.

Rounding dust is `funded - sum(payouts)`. It stays in the vault. When the last unit of weight is claimed, the dust moves to `pendingDust` and the next round pays it. A round with zero weight rolls the whole deposit into `pendingDust` immediately. `totalClaimed <= totalFunded`.

The hook records the holder and protocol tax on the hour it was taken. `harvest` settles at most 8 closed hours. ZRO out is split by each hour's accrued holder tax, and the rounding remainder stays on the last hour in that batch. Call `harvest` again to continue. An hour with no tax is skipped and does not consume a ZRO fund. The open hour is never settled.

## Where the swap runs

`harvest` is a keeper transaction. It is not called from `beforeSwap` or `afterSwap`. The hook's move lock reverts if a debit is attempted inside a user swap. The swapper is also non-reentrant.

Before the swap, spot must be inside the 198-tick TWAP band (about 2%). The keeper's `minOut` must sit within `maxDeviationBps` of the TWAP quote (default 1%, and never above 5%) and cannot be below the TWAP floor, which is 1% worse than the quote. The price limit is the far side of the band. The ZRO/WETH pool is hookless, so the fill is not the Seedix hook's swap path.

## Contracts

| Contract | Role |
|---|---|
| `LaunchHook` | Optional per-pool creator tax. Default off, so existing pools are unchanged. Escrows the holder and protocol lines |
| `ZroFeeMath` | Both fee modes and the 10% cap |
| `ZroWeightTracker` | Balance-seconds. Append-only checkpoints, binary search on claim |
| `ZroTaxSwapper` | Keeper swap of the holder pot into ZRO, protocol pot paid in the pair token |
| `ZroRewardVault` | Pull claims, pause, dust. `owner` and `delegate` are constructor arguments |
| `MockZRO` | oft-evm 4.0.1 OFT. `mint` is testnet-only. Owner and delegate are the multisig |

`claimRemote` and `setPayoutModule` are already on the vault. Phase 2 sets the module. The vault does not need a new deploy. With the module unset, remote claims revert and local claims transfer ZRO.

## Config per chain

`contracts/config/chains/84532.json` is the Base Sepolia file. Scripts also accept the environment variables below, which override the file. Solidity does not embed the addresses it uses.

Citations, also in `contracts/script/ZroChain.sol`:

- Uniswap v4 Base Sepolia deployments: https://docs.uniswap.org/contracts/v4/deployments
- LayerZero metadata (EndpointV2 `0x6edce65403992e310a62460808c4b910d972f10f`, EID 40245): https://metadata.layerzero-api.com/v1/metadata
- Base WETH predeploy `0x4200000000000000000000000000000000000006`: https://docs.base.org/base-chain/network-information/base-contracts

| Field | Base Sepolia |
|---|---|
| Chain id | 84532 |
| LayerZero EID | 40245 |
| PoolManager | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| PositionManager | `0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80` |
| Universal Router | `0x492e6456d9528771018deb9e87ef7750ef184104` |
| WETH | `0x4200000000000000000000000000000000000006` |
| EndpointV2 | `0x6edce65403992e310a62460808c4b910d972f10f` |
| ZRO | deployed `MockZRO`, then `ZRO_TOKEN` |
| Fee mode | `on_top` |
| Protocol fee | 100 bps |

Pinned npm packages, installed from `contracts/` so Foundry can compile them: `oft-evm` 4.0.1, `oapp-evm` 0.4.1, `lz-evm-protocol-v2` 3.0.148, `lz-evm-messagelib-v2` 3.0.148, `solidity-bytes-utils` 0.8.3.

## Base Sepolia deploy checklist

Do not broadcast to a public RPC with a key you use anywhere else. Do not merge this into a mainnet deploy. The Elysium script still refuses chain 84532.

Right after merge, one script deploys the test owner, the timelock, MockZRO, and the ZRO/WETH pool. If the Safe factory in the chain file has code, the owner is a 1-of-1 Safe whose only signer is the deployer. Otherwise it is `TestOwner`, which is labeled TEST and is not a multisig. The timelock delay defaults to 60 seconds. The deployer is the proposer and the executor. The admin of the timelock is the owner contract. The same owner is the ZRO delegate.

From `contracts/`, simulation first. Add `--broadcast` only for a throwaway testnet key:

```bash
cd contracts
PRIVATE_KEY=0xDeployerSimulationKey \
SEED_ZRO_AMOUNT=1000000000000000000000 \
SEED_WETH_AMOUNT=1000000000000000000000 \
TIMELOCK_DELAY=60 \
HOOK_ADDRESS=0xNewHook \
LAUNCHER_ADDRESS=0xNewLauncher \
LOCKER_ADDRESS=0xNewLocker \
KEEPER=0xKeeper \
forge script script/DeployBaseSepoliaZro.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

`HOOK_ADDRESS` is optional for this script. Without it, MockZRO and the pool are deployed and the vault waits until a new hook exists. The broadcaster needs enough ETH to wrap `SEED_WETH_AMOUNT`. The script logs `owner`, `timelock`, and `zro`. It does not log the key. `safe 1` means a Safe was created. `safe 0` means `TestOwner`.

The separate scripts are the same steps with addresses you already have:

1. Confirm `contracts/config/chains/84532.json` still matches the docs above, including the Safe v1.4.1 factory from https://github.com/safe-global/safe-deployments/tree/main/src/assets/v1.4.1.
2. Deploy a fresh Seedix hook with the new bytecode. The deployer key has to remain the hook initializer until the wiring calls below. Do not reuse the 99801 hook.
3. From `contracts/`, simulation first (no `--broadcast`):

```bash
PRIVATE_KEY=0xDeployerSimulationKey \
ZRO_OWNER=0xMultisig \
ZRO_DELEGATE=0xMultisig \
ZRO_TIMELOCK=0xTimelock \
HOOK_ADDRESS=0xNewHook \
LAUNCHER_ADDRESS=0xNewLauncher \
LOCKER_ADDRESS=0xNewLocker \
KEEPER=0xKeeper \
forge script script/DeployZro.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

On chain 84532 the script reverts unless `ZRO_OWNER` and `ZRO_DELEGATE` are contracts (the multisig). It logs addresses only.

4. Put the logged ZRO address in `ZRO_TOKEN`. The multisig mints the seed inventory, or the deploy key mints before ownership moves. Then:

```bash
PRIVATE_KEY=0xDeployerSimulationKey \
ZRO_TOKEN=0xMockZro \
SEED_ZRO_AMOUNT=1000000000000000000000 \
SEED_WETH_AMOUNT=1000000000000000000000 \
forge script script/SeedZroWethPool.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

The broadcaster must hold both tokens. The pool is hookless ZRO/WETH on the configured PoolManager.

5. The owner registers that pool on `ZroTaxSwapper.registerPool` and sets the keeper. `poke` for 30 minutes before the first harvest, then `harvest(poolId, minOut)` once an hour.
6. A creator turns the tax on with `launchWithZroTax` or `setCreatorTax` and a rate above zero. The UI shows creator + 1% and refuses a total above 10%. An empty form field stays on the plain `launch` call.

Environment variables for that deploy:

| Variable | Required | Meaning |
|---|---|---|
| `PRIVATE_KEY` | yes | Deployer key. Never commit it. Never log it |
| `ZRO_OWNER` | yes | Multisig. Vault owner and, after the script, tracker and swapper owner |
| `ZRO_DELEGATE` | yes | Multisig. OFT delegate and the vault's delegate |
| `ZRO_TIMELOCK` | yes | Timelock that can switch the fee mode |
| `HOOK_ADDRESS` | required for `DeployZro` on 84532, optional for `DeployBaseSepoliaZro` | New hook. The deployer key must be its initializer when it is set |
| `TIMELOCK_DELAY` | no | Seconds. `DeployBaseSepoliaZro` uses 60 when this is unset or 0 |
| `LAUNCHER_ADDRESS` | no | Receives the weight tracker. The deployer key must still be the launcher initializer |
| `LOCKER_ADDRESS` | no | Excluded from rewards |
| `KEEPER` | no | Harvest keeper |
| `UNISWAP_V4_POOL_MANAGER` | no | Overrides the config file |
| `UNISWAP_V4_POSITION_MANAGER` | no | Overrides the config file |
| `UNISWAP_V4_ROUTER` | no | Overrides the config file |
| `WETH` | no | Overrides the config file |
| `LZ_ENDPOINT` | no | Overrides the config file. Empty on Anvil deploys a mock endpoint |
| `LZ_EID` | no | Overrides 40245 |
| `ZRO_TOKEN` | seed script | MockZRO from step 3 |
| `SEED_ZRO_AMOUNT` | seed script | ZRO wei to approve |
| `SEED_WETH_AMOUNT` | seed script | WETH wei passed to the seeder |
| `BASE_SEPOLIA_RPC_URL` | script invocation | Public Base Sepolia RPC. No key |

## Phase 2

Claim on any chain. The holder calls `claimRemote(poolId, epoch, dstEid, options)` and pays the LayerZero fee in `msg.value`. The owner sets `payoutModule` to a contract that calls `OFT.send` on MockZRO (or real ZRO later). The vault already approves the module for the claimed amount and clears the allowance after. No vault redeploy. Peers, DVNs, and gas options are configured on the OFT by the delegate, not on the vault.

## Phase 3

A graduated token becomes an OFT. The tax stays only on Seedix's own v4 pools (the hook never runs on other pools). The send path uses at least two DVNs, including one that is not run by LayerZero Labs. Owner and delegate are the same multisig. That wiring is on the OFT and the endpoint, using the delegate already stored on `MockZRO` and on the vault.

## Open questions

- A gap of many empty hours still has to be walked eight hours at a time. Each empty batch is one transaction and moves no ZRO.
- Exclusion of the locker and the launcher is an owner call. It has to happen before those addresses hold a balance, or `eligibleSupply` and the checkpoints diverge.
- The ZRO pool oracle is the swapper's own 30-minute ring. It is not the Seedix hook oracle. The first harvest has to wait until that window is covered.
- `DeployBaseSepoliaZro` uses `TestOwner` when the Safe factory has no code. That contract is a single key. Replace it with a real multisig before any value that matters.
