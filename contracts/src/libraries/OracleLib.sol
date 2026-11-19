// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SeedixConstants as C} from "./SeedixConstants.sol";

/// @notice Cumulative tick oracle. Every swap accrues `preSwapTick * elapsed`.
///         Ring writes stay on the 30 second cadence. `consult` extrapolates the tail
///         after the latest accrual with the live tick, and rounds the mean toward −∞.
library OracleLib {
    error WindowNotCovered();
    error CumulativeOverflow();

    struct Observation {
        uint32 timestamp;
        int56 tickCumulative;
        int24 tick;
    }

    struct State {
        Observation[64] obs;
        uint16 index;
        uint16 count;
        uint32 lastAccrual;
        int56 tickCumulative;
        int24 lastTick;
    }

    function init(State storage s, uint32 time, int24 tick) internal {
        s.obs[0] = Observation({timestamp: time, tickCumulative: 0, tick: tick});
        s.index = 0;
        s.count = 1;
        s.lastAccrual = time;
        s.tickCumulative = 0;
        s.lastTick = tick;
    }

    /// @dev Accrue the pre-swap tick across the elapsed time, then maybe snapshot the ring.
    function onSwap(State storage s, uint32 nowT, int24 preSwapTick) internal returns (bool wrote) {
        if (nowT < s.lastAccrual) revert WindowNotCovered();
        if (nowT > s.lastAccrual) {
            s.tickCumulative = _add(s.tickCumulative, int256(preSwapTick) * int256(uint256(nowT - s.lastAccrual)));
            s.lastAccrual = nowT;
        }
        Observation memory last = s.obs[s.index];
        if (nowT < last.timestamp + C.OBS_CADENCE) return false;
        uint16 next = (s.index + 1) % C.OBS_CARDINALITY;
        s.obs[next] = Observation({timestamp: nowT, tickCumulative: s.tickCumulative, tick: preSwapTick});
        s.index = next;
        if (s.count < C.OBS_CARDINALITY) s.count += 1;
        s.lastTick = preSwapTick;
        return true;
    }

    /// @dev Accrue the previously stored tick across the idle gap, then remember `newTick` for the
    ///      next gap. A poke must not stamp the live tick over time when nobody was trading.
    function accrueStored(State storage s, uint32 nowT, int24 newTick) internal returns (bool wrote) {
        wrote = onSwap(s, nowT, s.lastTick);
        s.lastTick = newTick;
    }

    /// @dev Reverts unless an observation exists at or before `now - window`.
    function consult(State storage s, uint32 nowT, uint32 window, int24 liveTick)
        internal
        view
        returns (int24 twapTick)
    {
        return _consult(s, nowT, window, liveTick, false);
    }

    /// @dev Same quote, but the observation at the start of the window cannot be more than one
    ///      cadence late. The ZRO harvest uses this so a quiet pool cannot be interpolated.
    function consultDense(State storage s, uint32 nowT, uint32 window, int24 liveTick)
        internal
        view
        returns (int24 twapTick)
    {
        return _consult(s, nowT, window, liveTick, true);
    }

    function _consult(State storage s, uint32 nowT, uint32 window, int24 liveTick, bool dense)
        private
        view
        returns (int24 twapTick)
    {
        if (s.count == 0 || window == 0 || nowT < window || nowT < s.lastAccrual) {
            revert WindowNotCovered();
        }
        uint32 target = nowT - window;
        int256 cumNow = _cumulativeAt(s, nowT, liveTick);

        uint16 n = s.count;
        uint16 start = n < C.OBS_CARDINALITY ? 0 : (s.index + 1) % C.OBS_CARDINALITY;
        bool foundBefore;
        Observation memory beforeOrAt;
        bool foundAfter;
        Observation memory atOrAfter;
        for (uint16 i; i < n; ++i) {
            Observation memory o = s.obs[(start + i) % C.OBS_CARDINALITY];
            if (o.timestamp <= target) {
                beforeOrAt = o;
                foundBefore = true;
            } else {
                atOrAfter = o;
                foundAfter = true;
                break;
            }
        }
        if (!foundBefore) revert WindowNotCovered();
        if (dense && target > beforeOrAt.timestamp && target - beforeOrAt.timestamp > C.OBS_CADENCE) {
            revert WindowNotCovered();
        }

        int256 cumThen;
        if (beforeOrAt.timestamp == target) {
            cumThen = beforeOrAt.tickCumulative;
        } else if (!foundAfter) {
            cumThen = _cumulativeAt(s, target, liveTick);
        } else {
            uint32 dt = atOrAfter.timestamp - beforeOrAt.timestamp;
            uint32 span = target - beforeOrAt.timestamp;
            int256 delta = int256(atOrAfter.tickCumulative) - int256(beforeOrAt.tickCumulative);
            cumThen = int256(beforeOrAt.tickCumulative) + _mulDivFloor(delta, span, dt);
        }
        twapTick = _meanFloor(cumNow - cumThen, window);
    }

    function _cumulativeAt(State storage s, uint32 time, int24 liveTick) private view returns (int256) {
        if (time < s.lastAccrual) {
            Observation memory newest = s.obs[s.index];
            if (time <= newest.timestamp || s.lastAccrual == newest.timestamp) return newest.tickCumulative;
            uint32 dt = s.lastAccrual - newest.timestamp;
            uint32 span = time - newest.timestamp;
            int256 delta = int256(s.tickCumulative) - int256(newest.tickCumulative);
            return int256(newest.tickCumulative) + _mulDivFloor(delta, span, dt);
        }
        int256 cum = s.tickCumulative;
        if (time > s.lastAccrual) {
            cum = _add(int56(cum), int256(liveTick) * int256(uint256(time - s.lastAccrual)));
        }
        return cum;
    }

    function _add(int56 cur, int256 delta) private pure returns (int56) {
        int256 next = int256(cur) + delta;
        if (next > type(int56).max || next < type(int56).min) revert CumulativeOverflow();
        return int56(next);
    }

    /// @dev floor(num * span / dt), toward −∞.
    function _mulDivFloor(int256 num, uint32 span, uint32 dt) private pure returns (int256) {
        if (dt == 0) revert WindowNotCovered();
        int256 den = int256(uint256(dt));
        int256 prod = num * int256(uint256(span));
        int256 q = prod / den;
        if (prod < 0 && prod % den != 0) q -= 1;
        return q;
    }

    /// @dev floor(delta / window), toward −∞.
    function _meanFloor(int256 delta, uint32 window) private pure returns (int24) {
        int256 den = int256(uint256(window));
        int256 q = delta / den;
        if (delta < 0 && delta % den != 0) q -= 1;
        if (q > type(int24).max || q < type(int24).min) revert CumulativeOverflow();
        return int24(q);
    }
}
