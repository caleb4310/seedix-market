# Slither triage

Accepted high and medium findings. `contracts/script/check-slither.py` fails the CI job on any high or medium that is not listed here. The id is `check path:line` from the Slither JSON. Low and informational findings stay in the log and do not fail the job. `setKeeper(address(0))` is one of those lows: the zero address revokes the keeper on purpose.

## Accepted

- arbitrary-send-erc20 src/hook/LaunchHook.sol:520 | The from address is the swap payer or the hook's own encoded pull, not a caller-chosen token owner.
- arbitrary-send-erc20 src/router/SeedixRouter.sol:87 | The from address is the swap payer or the hook's own encoded pull, not a caller-chosen token owner.
- weak-prng src/kickback/KickbackDistributor.sol:103 | block.timestamp snaps the Kickback epoch to the hour grid. It is not used as randomness.
- divide-before-multiply src/libraries/LaunchCurve.sol:99 | Tick alignment floors to the spacing and multiplies back. The truncation is the alignment.
- incorrect-equality src/hook/LaunchHook.sol:695 | The comparison is a zero sentinel for an unset timestamp or a zero amount, not a token balance.
- incorrect-equality src/kickback/KickbackDistributor.sol:103 | The comparison is a zero sentinel for an unset timestamp or a zero amount, not a token balance.
- incorrect-equality src/hook/LaunchHook.sol:591 | The comparison is a zero sentinel for an unset timestamp or a zero amount, not a token balance.
- incorrect-equality src/hook/LaunchHook.sol:172 | The comparison is a zero sentinel for an unset timestamp or a zero amount, not a token balance.
- incorrect-equality src/hook/LaunchHook.sol:211 | The comparison is a zero sentinel for an unset timestamp or a zero amount, not a token balance.
- reentrancy-no-eth src/buyback/BuybackExecutor.sol:146 | Each flush zeros its own recorded balance before the hook call. The pool currencies are the platform token and WHYPE.
- uninitialized-local src/libraries/OracleLib.sol:68 | The local is assigned on every path that reads it, or it is a memory struct filled before use. Slither misses the later assignment.
- uninitialized-local src/hook/LaunchHook.sol:403 | The local is assigned on every path that reads it, or it is a memory struct filled before use. Slither misses the later assignment.
- uninitialized-local src/launch/LiquidityLocker.sol:141 | The local is assigned on every path that reads it, or it is a memory struct filled before use. Slither misses the later assignment.
- uninitialized-local src/libraries/OracleLib.sol:65 | The local is assigned on every path that reads it, or it is a memory struct filled before use. Slither misses the later assignment.
- uninitialized-local src/libraries/OracleLib.sol:66 | The local is assigned on every path that reads it, or it is a memory struct filled before use. Slither misses the later assignment.
- uninitialized-local src/libraries/OracleLib.sol:67 | The local is assigned on every path that reads it, or it is a memory struct filled before use. Slither misses the later assignment.
- uninitialized-local src/hook/LaunchHook.sol:367 | The local is assigned on every path that reads it, or it is a memory struct filled before use. Slither misses the later assignment.
- unused-return src/buyback/BuybackExecutor.sol:146 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/launch/Launcher.sol:173 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/router/SeedixRouter.sol:87 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/launch/LiquidityLocker.sol:157 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/launch/LiquidityLocker.sol:110 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/hook/LaunchHook.sol:337 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/vault/FeeVault.sol:45 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/launch/LiquidityLocker.sol:126 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/vault/FeeVault.sol:45 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/buyback/BuybackExecutor.sol:117 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/hook/LaunchHook.sol:704 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/kickback/KickbackDistributor.sol:150 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/buyback/BuybackExecutor.sol:227 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/buyback/BuybackExecutor.sol:211 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/hook/LaunchHook.sol:700 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/buyback/BuybackExecutor.sol:153 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/buyback/BuybackExecutor.sol:222 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/launch/LiquidityLocker.sol:149 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/hook/LaunchHook.sol:520 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/hook/LaunchHook.sol:556 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/kickback/KickbackDistributor.sol:166 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/kickback/KickbackDistributor.sol:103 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/buyback/BuybackExecutor.sol:237 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/buyback/BuybackExecutor.sol:153 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/launch/LiquidityLocker.sol:170 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/vault/FeeVault.sol:45 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/kickback/KickbackDistributor.sol:103 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/launch/LiquidityLocker.sol:65 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/hook/LaunchHook.sol:211 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/hook/LaunchHook.sol:337 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
- unused-return src/hook/LaunchHook.sol:337 | The ignored value is an unused tuple field or a PoolManager delta the caller does not need.
