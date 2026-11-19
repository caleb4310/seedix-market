// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Time-weighted coin balances for ZRO Kickback.
///
///         For a round covering `[start, end)`:
///         `weight(account) = ∫ balance(account, t) dt`
///         `totalWeight = ∫ eligibleSupply(t) dt`
///
///         A transfer or a sell changes the balance at that timestamp. The sender stops accruing on
///         the tokens that left. The receiver starts at zero accrued time for the tokens that arrived,
///         so a buy immediately before the round ends earns about nothing. A self-transfer does not
///         change the balance or the integral. A buy and a sell in the same timestamp add
///         `balance * 0`.
///
///         The zero address, the hook, the router, and the pool (the PoolManager) are excluded.
///         Excluded balances are not part of `eligibleSupply` and their weight is zero.
///
///         Checkpoints are append-only. A claim reads two points with a binary search. It does not
///         loop over holders.
contract ZroWeightTracker {
    error NotOwner();
    error NotTimelock();
    error ZeroAddress();
    error Time();
    error Short();
    error Overflow();

    struct Point {
        uint64 t;
        uint128 balance;
        uint256 integral;
    }

    address public owner;
    /// @notice The only caller that may set `excluder`.
    address public timelock;
    /// @notice May exclude addresses, which is how graduation keeps a locked OFT adapter out of the weight.
    address public excluder;
    mapping(address account => bool) public excluded;
    mapping(address account => address[] tokens) private _tokensOf;
    mapping(address account => mapping(address token => bool seen)) private _tokenSeen;
    mapping(address token => mapping(address account => Point[])) internal _points;
    mapping(address token => Point[]) internal _supplyPoints;
    mapping(address token => uint256) public eligibleSupply;

    event ExcludedSet(address indexed account, bool excluded);
    event ExcluderSet(address indexed previous, address indexed next);
    event OwnerSet(address indexed previous, address indexed next);

    constructor(address owner_, address hook_, address router_, address poolManager_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        _setExcluded(address(0), true);
        if (hook_ != address(0)) _setExcluded(hook_, true);
        if (router_ != address(0)) _setExcluded(router_, true);
        if (poolManager_ != address(0)) _setExcluded(poolManager_, true);
    }

    function setOwner(address next) external {
        if (msg.sender != owner || next == address(0)) revert NotOwner();
        emit OwnerSet(owner, next);
        owner = next;
    }

    /// @notice One-time. The owner points this at the timelock. After that, only the timelock sets the excluder.
    function setTimelock(address next) external {
        if (msg.sender != owner || next == address(0) || timelock != address(0)) revert NotOwner();
        timelock = next;
    }

    /// @notice One extra caller that may exclude addresses. Only the timelock can set it.
    function setExcluder(address next) external {
        if (timelock == address(0) || msg.sender != timelock) revert NotTimelock();
        emit ExcluderSet(excluder, next);
        excluder = next;
    }

    /// @notice The zero address stays excluded. A balance already in `eligibleSupply` is moved out
    ///         or back in, so a late exclusion cannot double-count the next transfer.
    function setExcluded(address account, bool isExcluded) external {
        if (msg.sender != owner && msg.sender != excluder) revert NotOwner();
        if (account == address(0) && !isExcluded) revert ZeroAddress();
        if (excluded[account] == isExcluded) return;
        _moveSupply(account, isExcluded);
        _setExcluded(account, isExcluded);
    }

    /// @notice Called by the coin after its own balances move. `msg.sender` is the coin.
    ///         A self-transfer is ignored, so it cannot reset or inflate weight.
    function onTransfer(address from, address to, uint256 amount) external {
        if (amount == 0 || from == to) return;
        address token = msg.sender;
        uint64 t = uint64(block.timestamp);
        uint128 amt = _asUint128(amount);
        bool fromTeam = _isTeam(token, from);
        bool toTeam = _isTeam(token, to);
        bool fromCounts = from != address(0) && !excluded[from] && !fromTeam;
        bool toCounts = to != address(0) && !excluded[to] && !toTeam;
        if (from != address(0)) _note(from, token);
        if (to != address(0)) _note(to, token);

        if (from != address(0)) {
            uint128 bal = _lastBalance(_points[token][from]);
            if (bal < amt) revert Short();
            _push(_points[token][from], t, bal - amt, !_excludedOrZero(from) && !fromTeam);
        }
        if (to != address(0)) {
            uint128 bal = _lastBalance(_points[token][to]);
            _push(_points[token][to], t, bal + amt, !_excludedOrZero(to) && !toTeam);
        }
        if (fromCounts != toCounts) {
            uint256 supply = eligibleSupply[token];
            if (fromCounts) {
                if (supply < amount) revert Short();
                supply -= amount;
            }
            if (toCounts) supply += amount;
            eligibleSupply[token] = supply;
            _push(_supplyPoints[token], t, _asUint128(supply), true);
        }
    }

    function weight(address token, address account, uint64 start, uint64 end) external view returns (uint256) {
        if (end <= start || excluded[account] || account == address(0) || _isTeam(token, account)) return 0;
        return _between(_points[token][account], start, end);
    }

    function totalWeight(address token, uint64 start, uint64 end) external view returns (uint256) {
        if (end <= start) return 0;
        return _between(_supplyPoints[token], start, end);
    }

    function balanceOf(address token, address account) external view returns (uint128) {
        return _lastBalance(_points[token][account]);
    }

    function _setExcluded(address account, bool isExcluded) internal {
        excluded[account] = isExcluded;
        emit ExcludedSet(account, isExcluded);
    }

    function _excludedOrZero(address account) internal view returns (bool) {
        return account == address(0) || excluded[account];
    }

    /// @dev The team allocation is excluded at the mint itself. `teamWallet` is set before that mint.
    function _isTeam(address token, address account) internal view returns (bool) {
        if (account == address(0)) return false;
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("teamWallet()"));
        if (!ok || data.length < 32) return false;
        address team = abi.decode(data, (address));
        return team != address(0) && team == account;
    }

    function _note(address account, address token) internal {
        if (_tokenSeen[account][token]) return;
        _tokenSeen[account][token] = true;
        _tokensOf[account].push(token);
    }

    function _moveSupply(address account, bool isExcluded) internal {
        address[] memory tokens = _tokensOf[account];
        uint64 t = uint64(block.timestamp);
        for (uint256 i; i < tokens.length; ++i) {
            address token = tokens[i];
            uint256 bal = _lastBalance(_points[token][account]);
            if (bal == 0) continue;
            uint256 supply = eligibleSupply[token];
            if (isExcluded) {
                if (supply < bal) revert Short();
                supply -= bal;
            } else {
                supply += bal;
            }
            eligibleSupply[token] = supply;
            _push(_supplyPoints[token], t, _asUint128(supply), true);
        }
    }

    function _push(Point[] storage pts, uint64 t, uint128 balance, bool accrue) internal {
        uint256 integral = 0;
        uint256 n = pts.length;
        if (n > 0) {
            Point memory prev = pts[n - 1];
            if (t < prev.t) revert Time();
            integral = prev.integral;
            if (accrue && prev.balance > 0 && t > prev.t) {
                integral += uint256(prev.balance) * (t - prev.t);
            }
        }
        pts.push(Point({t: t, balance: balance, integral: integral}));
    }

    function _lastBalance(Point[] storage pts) internal view returns (uint128) {
        uint256 n = pts.length;
        if (n == 0) return 0;
        return pts[n - 1].balance;
    }

    function _between(Point[] storage pts, uint64 start, uint64 end) internal view returns (uint256) {
        uint256 hi = _at(pts, end);
        uint256 lo = _at(pts, start);
        return hi - lo;
    }

    /// @dev Latest checkpoint at or before `t`, then `balance * seconds` after it. Binary search.
    function _at(Point[] storage pts, uint64 t) internal view returns (uint256) {
        uint256 n = pts.length;
        if (n == 0 || t < pts[0].t) return 0;
        uint256 lo = 0;
        uint256 hi = n - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) >> 1;
            if (pts[mid].t <= t) lo = mid;
            else hi = mid - 1;
        }
        Point memory p = pts[lo];
        return p.integral + uint256(p.balance) * (t - p.t);
    }

    function _asUint128(uint256 v) internal pure returns (uint128) {
        if (v > type(uint128).max) revert Overflow();
        return uint128(v);
    }
}
