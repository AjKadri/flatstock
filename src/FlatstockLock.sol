pragma solidity ^0.8.24;

interface ILockWif {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Minimal self-custody eligibility lock for sponsored buys.
/// @dev The contract holds only the user's explicitly locked WIF. It has no
/// owner and cannot move one user's balance to another account.
contract FlatstockLock {
    ILockWif public immutable wif;
    uint256 public immutable minimumLock;
    mapping(address => uint256) public locked;

    error InvalidWif();
    error InvalidMinimum();
    error InvalidAmount();
    error BelowMinimum();
    error TransferFailed();

    event Locked(address indexed account, uint256 amount, uint256 totalLocked);
    event Unlocked(address indexed account, uint256 amount, uint256 totalLocked);

    constructor(address wif_, uint256 minimumLock_) {
        if (wif_ == address(0)) revert InvalidWif();
        if (minimumLock_ == 0) revert InvalidMinimum();
        wif = ILockWif(wif_);
        minimumLock = minimumLock_;
    }

    function lock(uint256 amount) external {
        if (amount < minimumLock) revert BelowMinimum();
        if (!wif.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint256 total = locked[msg.sender] + amount;
        locked[msg.sender] = total;
        emit Locked(msg.sender, amount, total);
    }

    function unlock(uint256 amount) external {
        uint256 total = locked[msg.sender];
        if (amount == 0 || amount > total) revert InvalidAmount();
        uint256 remaining = total - amount;
        if (remaining != 0 && remaining < minimumLock) revert BelowMinimum();
        locked[msg.sender] = remaining;
        if (!wif.transfer(msg.sender, amount)) revert TransferFailed();
        emit Unlocked(msg.sender, amount, remaining);
    }

    function isLocked(address account) external view returns (bool) {
        return locked[account] >= minimumLock;
    }
}
