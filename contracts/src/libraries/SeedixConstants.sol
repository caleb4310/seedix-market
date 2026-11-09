// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Protocol constants. Changing any of these changes the hook bytecode and the mined address.
library SeedixConstants {
    uint256 internal constant PIPS = 1_000_000;
    uint256 internal constant START_FEE = 800_000;
    uint256 internal constant END_FEE = 10_000;
    uint256 internal constant DECAY_SECONDS = 10;
    uint256 internal constant PLATFORM_FEE = 10_000;
    uint24 internal constant LP_FEE = 1000;
    int24 internal constant TICK_SPACING = 60;
    /// @dev Width of the near single-sided range. 120_000 ticks is a multiple of the spacing.
    int24 internal constant NEAR_WIDTH = 120_000;
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint16 internal constant MAX_TEAM_BPS = 500;
    uint16 internal constant NEAR_BPS = 9910;
    uint32 internal constant OBS_CADENCE = 30;
    uint16 internal constant OBS_CARDINALITY = 64;
    uint32 internal constant TWAP_WINDOW = 30 minutes;
    uint256 internal constant REVIEW_WINDOW = 1 hours;
    uint256 internal constant BUYBACK_INTERVAL = 5 minutes;
    /// @dev ln(1.02) / ln(1.0001) ≈ 198. A spot this far from TWAP is about 2%.
    int24 internal constant BAND_TICKS = 198;
    uint256 internal constant MIN_OUT_PIPS = 990_000;
    uint160 internal constant HOOK_FLAGS = uint160((1 << 13) | (1 << 11) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2));
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address internal constant FEE_WALLET = 0xf4383D1Ecfb525294A266929c7D4796314a764F9;

    /// @dev Low 14 bits must equal this mask. See contracts/docs/fees.md.
    function hookFlags() internal pure returns (uint160) {
        return HOOK_FLAGS;
    }
}
