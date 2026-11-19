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
///         `onTransfer` accepts only coins this registry has recorded. The launcher registers a coin
///         before its mint, and graduation can register one later. Exclusion of an address that
///         already holds a coin is per token: one balance, one supply update, no token list.
///
///         Checkpoints are append-only. A claim reads two points with a binary search. It does not
///         loop over holders.
contract ZroWeightTracker {
    error NotOwner();
    error NotTimelock();
    error NotRegistrar();
    error NotCoin();
    error ZeroAddress();
    error Time();
    error Short();
    error Overflow();
    error PerToken();
    error GlobalClosed();
    error LauncherLocked();

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
    /// @notice The launcher. It may register a coin in the same transaction that mints it.
    address public launcher;
    mapping(address account => bool) public excluded;
    /// @notice Per-token exclusion. Graduation uses this for the adapter. There is no token list.
    mapping(address token => mapping(address account => bool)) public excludedFrom;
    mapping(address coin => bool) public isCoin;
    /// @notice How many coins have been registered. Global exclusion closes once this is non-zero.
    uint256 public registeredCoins;
    mapping(address token => mapping(address account => Point[])) internal _points;
    mapping(address token => Point[]) internal _supplyPoints;
    mapping(address token => uint256) public eligibleSupply;

    event ExcludedSet(address indexed account, bool excluded);
    event ExcludedFromSet(address indexed token, address indexed account, bool excluded);
    event ExcluderSet(address indexed previous, address indexed next);
    event OwnerSet(address indexed previous, address indexed next);
    event LauncherSet(address indexed previous, address indexed next);
    event CoinRegistered(address indexed coin);

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

    /// @notice One shot. The owner or the timelock names the launcher before the first launch.
    ///         A later call cannot point this at another launcher and halt new coins.
    function setLauncher(address next) external {
        if (msg.sender != owner && msg.sender != timelock) revert NotOwner();
        if (next == address(0) || launcher != address(0)) revert LauncherLocked();
        emit LauncherSet(launcher, next);
        launcher = next;
    }

    /// @notice Records a Seedix coin. The launcher calls this before the coin's first mint.
    ///         Graduation may call it when the launcher that created the coin predates this registry.
    function registerCoin(address coin) external {
        if (msg.sender != launcher && msg.sender != owner && msg.sender != timelock && msg.sender != excluder) {
            revert NotRegistrar();
        }
        if (coin == address(0)) revert ZeroAddress();
        if (isCoin[coin]) return;
        isCoin[coin] = true;
        registeredCoins += 1;
        emit CoinRegistered(coin);
    }

    /// @notice Global exclusion for the hook, the router, the pool, the locker, and the launcher.
    ///         It is only available before any coin is registered, so it cannot leave an existing
    ///         balance inside `eligibleSupply`. After that, use `setExcluded(account, token, bool)`.
    ///         Turning a global exclusion off is per token, so an excluded interval is not credited later.
    function setExcluded(address account, bool isExcluded) external {
        if (msg.sender != owner && msg.sender != excluder) revert NotOwner();
        if (!isExcluded) revert PerToken();
        if (registeredCoins != 0) revert GlobalClosed();
        if (account == address(0)) revert ZeroAddress();
        if (excluded[account]) return;
        _setExcluded(account, true);
    }

    /// @notice Exclude or include `account` for one registered coin. The account is checkpointed
    ///         at the old status before the flag flips, so the excluded interval is not weight.
    ///         The team wallet was never in `eligibleSupply`, so this does not subtract it again.
    function setExcluded(address account, address token, bool isExcluded) external {
        if (msg.sender != owner && msg.sender != excluder) revert NotOwner();
        if (account == address(0)) revert ZeroAddress();
        if (!isCoin[token]) revert NotCoin();
        if (excludedFrom[token][account] == isExcluded) return;
        if (_isTeam(token, account)) return;
        _checkpoint(token, account);
        uint256 bal = _lastBalance(_points[token][account]);
        if (bal > 0 && !excluded[account]) {
            uint256 supply = eligibleSupply[token];
            if (isExcluded) {
                if (supply < bal) revert Short();
                supply -= bal;
            } else {
                supply += bal;
            }
            eligibleSupply[token] = supply;
            _push(_supplyPoints[token], uint64(block.timestamp), _asUint128(supply), true);
        }
        excludedFrom[token][account] = isExcluded;
        emit ExcludedFromSet(token, account, isExcluded);
    }

    /// @notice Called by a registered coin after its own balances move. `msg.sender` is the coin.
    ///         A self-transfer is ignored, so it cannot reset or inflate weight.
    function onTransfer(address from, address to, uint256 amount) external {
        if (amount == 0 || from == to) return;
        address token = msg.sender;
        if (!isCoin[token]) revert NotCoin();
        uint64 t = uint64(block.timestamp);
        uint128 amt = _asUint128(amount);
        bool fromTeam = _isTeam(token, from);
        bool toTeam = _isTeam(token, to);
        bool fromCounts = _counts(token, from, fromTeam);
        bool toCounts = _counts(token, to, toTeam);

        if (from != address(0)) {
            uint128 bal = _lastBalance(_points[token][from]);
            if (bal < amt) revert Short();
            _push(_points[token][from], t, bal - amt, fromCounts);
        }
        if (to != address(0)) {
            uint128 bal = _lastBalance(_points[token][to]);
            _push(_points[token][to], t, bal + amt, toCounts);
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
        if (
            end <= start || excluded[account] || excludedFrom[token][account] || account == address(0)
                || _isTeam(token, account)
        ) return 0;
        return _between(_points[token][account], start, end);
    }

    function totalWeight(address token, uint64 start, uint64 end) external view returns (uint256) {
        if (end <= start) return 0;
        return _between(_supplyPoints[token], start, end);
    }

    function balanceOf(address token, address account) external view returns (uint128) {
        return _lastBalance(_points[token][account]);
    }

    function _counts(address token, address account, bool team) internal view returns (bool) {
        return account != address(0) && !excluded[account] && !excludedFrom[token][account] && !team;
    }

    function _setExcluded(address account, bool isExcluded) internal {
        excluded[account] = isExcluded;
        emit ExcludedSet(account, isExcluded);
    }

    /// @dev Close the integral up to now using the status from before a flag change.
    function _checkpoint(address token, address account) internal {
        uint128 bal = _lastBalance(_points[token][account]);
        bool accrue = _counts(token, account, _isTeam(token, account));
        _push(_points[token][account], uint64(block.timestamp), bal, accrue);
    }

    /// @dev The team allocation is excluded at the mint itself. `teamWallet` is set before that mint.
    function _isTeam(address token, address account) internal view returns (bool) {
        if (account == address(0)) return false;
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("teamWallet()"));
        if (!ok || data.length < 32) return false;
        address team = abi.decode(data, (address));
        return team != address(0) && team == account;
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
