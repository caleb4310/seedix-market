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

`Deploy.s.sol` still refuses chain 84532. `DeployBaseSepoliaSeedix.s.sol` deploys the launch stack on the PoolManager and WETH from the chain file and leaves the deployer as the hook initializer. Then `DeployBaseSepoliaZro.s.sol` deploys the test owner, the timelock, MockZRO, and the ZRO/WETH pool. If the Safe factory in the chain file has code, the owner is a 1-of-1 Safe whose only signer is the deployer. Otherwise it is `TestOwner`, which is labeled TEST and is not a multisig. The timelock delay defaults to 60 seconds. The deployer is the proposer and the executor. The admin of the timelock is the owner contract. The same owner is the ZRO delegate.

The live testnet addresses, transaction hashes, and the ZRO/WETH pool id are in `deployments/base-sepolia.json`.

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
SEED_WIDTH_STEPS=1 \
forge script script/DeployBaseSepoliaZro.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

`HOOK_ADDRESS` is optional for this script. Without it, MockZRO and the pool are deployed and the vault waits until a new hook exists. The broadcaster needs enough ETH to wrap `SEED_WETH_AMOUNT`. `seedWide` is owner-only and pulls WETH and ZRO in that same call. Spend is the liquidity delta, not a balance drop. `SEED_WIDTH_STEPS` defaults to 1. The script logs `owner`, `timelock`, and `zro`. It does not log the key. `safe 1` means a Safe was created. `safe 0` means `TestOwner`. `SafeRegisterZroPool.s.sol` then registers the pool from the 1-of-1 Safe. `SmokeLaunch`, `SmokeSwap`, and `SmokeHarvest` are the testnet checks.

The separate scripts are the same steps with addresses you already have:

1. Confirm `contracts/config/chains/84532.json` still matches the docs above, including the Safe v1.4.1 factory from https://github.com/safe-global/safe-deployments/tree/main/src/assets/v1.4.1.
2. Deploy the launch stack with `forge script script/DeployBaseSepoliaSeedix.s.sol`. The deployer key has to remain the hook initializer until the wiring calls below. Do not reuse the 99801 hook.
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
SEED_WIDTH_STEPS=1 \
forge script script/SeedZroWethPool.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

The broadcaster must hold both tokens. The script transfers them to the seeder before `seedWide`. The pool is hookless ZRO/WETH on the configured PoolManager.

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
| `SEED_WETH_AMOUNT` | seed script | WETH wei `seedWide` pulls from the owner in the same call |
| `SEED_WIDTH_STEPS` | no | Tick spacings each side of zero. Defaults to 1 |
| `BASE_SEPOLIA_RPC_URL` | script invocation | Public Base Sepolia RPC. No key |

## Phase 2

A holder calls `quoteRemote(to, amount, dstEid, options)` and then `claimRemote(poolId, epoch, dstEid, to, options)` with at least that native fee in `msg.value`. `to` is a `bytes32`. Zero and any value with the top 96 bits set are rejected. `ZroPayout` pulls the claimed ZRO, calls `OFT.send`, and refunds `msg.value` above the quote to the holder. The OFT names the same holder as the endpoint refund address. The vault marks the claim before the send. A revert, including a short fee, rolls that mark back, so the claim cannot be taken twice and a failed send does not burn it. The vault is non-reentrant, and the module refuses a reentrant `payout`.

`LaunchToken` stays a clone. A clone cannot run an OFT constructor, so the home chain gets one `ZroCoinAdapter` lockbox and every other chain gets a mint/burn `ZroRemoteOFT`. Locked coins on the home adapter equal the remote OFT's supply. The adapter constructor reads the launcher from the graduation contract that is creating it. A caller cannot pass a graduation address of their own. Peers, enforced options, `setDelegate`, and `sweep` are timelock calls on both the adapter and the remote OFT. The OApp owner is the timelock, which is what makes `setDelegate` timelock-only. `SetOFTPeers` writes one Safe batch for one chain. Run it on the home chain, then again on the remote chain with the addresses swapped. `VerifyOFTPeer` reads `peers` on that chain.

The keeper is the only address that may `poke`. The deploy scripts schedule `setKeeper` through the timelock. They cannot execute it in the same broadcast, because the delay has not elapsed. After `TIMELOCK_DELAY`, the proposer runs `ExecuteZroKeeper` with `ZRO_TIMELOCK`, `SWAPPER`, and `KEEPER`. Until that execute lands, `poke` and `harvest` revert. The dense quote needs an observation within 30 seconds of the start of the 30-minute window, so the keeper pokes at least that often. A 40 second gap makes `quote` and `harvest` revert until the next poke. A same-block sandwich around the keeper's own poke can still move the stored tick. A stranger's poke cannot. Base has no public mempool for that sandwich.

`SetUlnConfig` reads `config/uln.json` plus `LZ_ENDPOINT`, `LZ_SEND_LIB`, `LZ_RECEIVE_LIB`, `OAPP`, and `REMOTE_EID`. It refuses a list of fewer than two required DVNs, a list that is only the LayerZero Labs DVN, and a file whose `chainId` is not this chain. It writes a Safe batch and does not broadcast. `VERIFY=1` reads `getConfig` back after the Safe has executed. The committed file is the Ethereum mainnet example. Copy it per chain.

## What already-deployed Base Sepolia contracts can do

These addresses stay in place. Nothing here sends a transaction.

- Launcher `0xb0F9D152e76D5232A13672EA531aD7BB223e81FB` has no `isLaunchedCoin`. A new `ZroGraduation` is constructed with that launcher. The Safe calls `allowCoin(coin, true)` and then `graduate`. The launcher is not redeployed for that.
- Tracker `0x18CAd4686D7864C379cC9A49B926F0c112D3dE1F` has no `excluder()` and no per-token `setExcluded`. Graduation is constructed with `tracker = address(0)`. `SafeGraduateLive` writes one Safe batch: `allowCoin`, `graduate`, and the live tracker's `setExcluded(adapter, true)`. The adapter is the graduation factory's next CREATE address, so the third call names it before `graduate` runs. If another `graduate` lands first, the third call excludes the wrong address. `VerifyGraduateLive` checks the registry afterwards. `VerifyGraduateLive` checks the registry and `excluded` afterwards. The script does not broadcast.
- The live timelock still has the deployer as proposer, executor, and canceller, with a 60 second delay. This branch does not change it. `SafeSetExcluder` writes the batch for a tracker deployed from this code. On the live timelock the schedule has to be submitted by the current proposer.

## What has to be deployed from this code

These behaviors are in new bytecode. A contract that is already on Base Sepolia does not pick them up.

- The weight-tracker registry, per-token exclusion, and the rule that the team wallet is not subtracted from supply a second time. `onTransfer` accepts only a registered coin. The launcher registers the coin before the mint. The live tracker does not have that registry. Using this tracker means deploying it and a launcher that calls `registerCoin`. The live graduation path above does not use this tracker.
- The claim window stored on each round at `fund`. Shortening `claimWindow` later does not expire a round that was already funded. A mainnet window is at least 30 days. `ZroMainnetGuard.assertClaimWindow` checks that. The Base Sepolia deploy does not construct the guard.
- `ZroRemoteOFT`, including `sweep`, and the recipient check on `send`.
- Keeper-only `poke` on a swapper deployed from this branch.

`ZroMainnetGuard.assertReady` reads the deployed timelock: `getMinDelay`, and whether the Safe holds `PROPOSER_ROLE` and the deployer holds proposer, executor, canceller, or admin. It covers chain ids 1, 8453, 42161, and 99901. There is no mainnet deploy script yet. The guard is not deployed on Base Sepolia.

## Phase 3

The send path requires at least two DVNs, including one that is not run by LayerZero Labs. That configuration is on the endpoint. `SetUlnConfig` writes the Safe batch for the delegate and checks the DVN list before it writes. The adapter and the payout module do not need a redeploy for it.

## Open questions

- A gap of many empty hours still has to be walked eight hours at a time. Each empty batch is one transaction and moves no ZRO.
- Exclusion of the locker and the launcher is an owner call. It has to happen before those addresses hold a balance, or `eligibleSupply` and the checkpoints diverge.
- The ZRO pool oracle is the swapper's own 30-minute ring. It is not the Seedix hook oracle. The first harvest has to wait until that window is covered.
- `DeployBaseSepoliaZro` uses `TestOwner` when the Safe factory has no code. That contract is a single key. Replace it with a real multisig before any value that matters.
