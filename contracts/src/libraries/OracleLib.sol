// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SeedixConstants as C} from "./SeedixConstants.sol";

/// @notice Timestamp-gated ring buffer. At most one observation per `OBS_CADENCE` seconds.
///         64 slots at 30s cover 31.5 minutes, so a 30-minute window fits once the pool is old enough.
///         The cumulative uses the pre-swap tick that held during the elapsed interval.
library OracleLib {
    error WindowNotCovered();

    struct Observation {
        uint32 timestamp;
        int56 tickCumulative;
        int24 tick;
    }

    struct State {
        Observation[64] obs;
        uint16 index;
        uint16 count;
    }

    function init(State storage s, uint32 time, int24 tick) internal {
        s.obs[0] = Observation({timestamp: time, tickCumulative: 0, tick: tick});
        s.index = 0;
        s.count = 1;
    }

    /// @dev Writes only when `nowT >= last + cadence`. Returns whether a new slot was written.
    function maybeWrite(State storage s, uint32 nowT, int24 tickNow) internal returns (bool wrote) {
        Observation memory last = s.obs[s.index];
        if (nowT < last.timestamp + C.OBS_CADENCE) return false;
        uint32 dt = nowT - last.timestamp;
        int56 cum = last.tickCumulative + int56(tickNow) * int56(uint56(dt));
        uint16 next = (s.index + 1) % C.OBS_CARDINALITY;
        s.obs[next] = Observation({timestamp: nowT, tickCumulative: cum, tick: tickNow});
        s.index = next;
        if (s.count < C.OBS_CARDINALITY) s.count += 1;
        return true;
    }

    /// @dev Reverts when no stored observation is at or before `now - window`.
    function consult(State storage s, uint32 nowT, uint32 window) internal view returns (int24 twapTick) {
        if (s.count == 0 || nowT < window) revert WindowNotCovered();
        uint32 target = nowT - window;
        bool found;
        Observation memory atTime;
        uint16 n = s.count;
        for (uint16 i; i < n; ++i) {
            Observation memory o = s.obs[i];
            if (o.timestamp == 0) continue;
            if (o.timestamp <= target && (!found || o.timestamp > atTime.timestamp)) {
                found = true;
                atTime = o;
            }
        }
        if (!found) revert WindowNotCovered();
        Observation memory last = s.obs[s.index];
        if (nowT < last.timestamp) revert WindowNotCovered();
        int56 cumNow = last.tickCumulative + int56(last.tick) * int56(uint56(nowT - last.timestamp));
        int56 cumThen = atTime.tickCumulative + int56(atTime.tick) * int56(uint56(target - atTime.timestamp));
        twapTick = int24((cumNow - cumThen) / int56(uint56(window)));
    }
}
