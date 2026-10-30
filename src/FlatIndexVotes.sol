pragma solidity ^0.8.24;

interface IWifVotes {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
}

/// @notice One-WIF-per-wallet weekly stock-choice voting for the M1 check.
/// @dev The vote contract receives exactly one WIF and burns it in the same
/// transaction. Counts remain immutable after a round is closed.
contract FlatIndexVotes {
    uint256 public constant VOTE_COST = 1 ether;
    uint8 public constant MAX_ASSETS = 8;

    IWifVotes public immutable wif;
    address public immutable owner;

    struct Round {
        uint64 opensAt;
        uint64 closesAt;
        uint8 assetCount;
        uint256 totalVotes;
        bool closed;
    }

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(uint8 => uint256)) public votesFor;

    event RoundOpened(uint256 indexed roundId, uint8 assetCount, uint64 opensAt, uint64 closesAt);
    event VoteCast(uint256 indexed roundId, address indexed voter, uint8 indexed assetIndex);
    event RoundClosed(uint256 indexed roundId, uint256 totalVotes);

    error InvalidWif();
    error NotOwner();
    error RoundExists();
    error RoundMissing();
    error InvalidAssets();
    error InvalidCloseTime();
    error RoundNotOpen();
    error RoundClosedAlready();
    error InvalidAsset();
    error AlreadyVoted();
    error TransferFailed();
    error BurnFailed();

    constructor(address wif_) {
        if (wif_ == address(0)) revert InvalidWif();
        wif = IWifVotes(wif_);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function openRound(uint256 roundId, uint8 assetCount, uint64 closesAt) external onlyOwner {
        Round storage current = rounds[roundId];
        if (current.assetCount != 0) revert RoundExists();
        if (assetCount == 0 || assetCount > MAX_ASSETS) revert InvalidAssets();
        if (closesAt <= block.timestamp) revert InvalidCloseTime();

        current.opensAt = uint64(block.timestamp);
        current.closesAt = closesAt;
        current.assetCount = assetCount;
        emit RoundOpened(roundId, assetCount, current.opensAt, closesAt);
    }

    function vote(uint256 roundId, uint8 assetIndex) external {
        Round storage current = rounds[roundId];
        if (current.assetCount == 0) revert RoundMissing();
        if (current.closed || block.timestamp >= current.closesAt) revert RoundNotOpen();
        if (assetIndex >= current.assetCount) revert InvalidAsset();
        if (hasVoted[roundId][msg.sender]) revert AlreadyVoted();

        if (!wif.transferFrom(msg.sender, address(this), VOTE_COST)) revert TransferFailed();
        try wif.burn(VOTE_COST) {}
        catch {
            revert BurnFailed();
        }

        hasVoted[roundId][msg.sender] = true;
        votesFor[roundId][assetIndex] += 1;
        current.totalVotes += 1;
        emit VoteCast(roundId, msg.sender, assetIndex);
    }

    function closeRound(uint256 roundId) external {
        Round storage current = rounds[roundId];
        if (current.assetCount == 0) revert RoundMissing();
        if (current.closed) revert RoundClosedAlready();
        if (block.timestamp < current.closesAt) revert InvalidCloseTime();

        current.closed = true;
        emit RoundClosed(roundId, current.totalVotes);
    }

    function weightBps(uint256 roundId, uint8 assetIndex) external view returns (uint256) {
        Round storage current = rounds[roundId];
        if (current.assetCount == 0) revert RoundMissing();
        if (assetIndex >= current.assetCount) revert InvalidAsset();
        if (current.totalVotes == 0) return 0;
        return votesFor[roundId][assetIndex] * 10_000 / current.totalVotes;
    }
}
