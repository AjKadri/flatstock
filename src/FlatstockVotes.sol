pragma solidity ^0.8.24;

import {FlatstockEIP712} from "./FlatstockEIP712.sol";

interface IVoteWif {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
}

interface IVoteLock {
    function isLocked(address account) external view returns (bool);
}

/// @notice Vote contract with direct wallet voting and signature-authorized
/// relayed voting for locked WIF wallets.
contract FlatstockVotes is FlatstockEIP712 {
    uint256 public constant VOTE_COST = 1 ether;
    uint8 public constant MAX_ASSETS = 8;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_WEIGHT_BPS = 5_000;
    uint16 public constant DEFAULT_VOTE_SHARE_BPS = 5_000;
    bytes32 public constant VOTE_TYPEHASH =
        keccak256("Vote(address voter,uint256 roundId,uint8 assetIndex,uint256 nonce,uint256 deadline)");

    IVoteWif public immutable wif;
    IVoteLock public immutable lockContract;
    address public immutable owner;
    uint256 public latestRoundId;

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
    mapping(uint256 => uint16) public voteShareBps;
    mapping(uint256 => mapping(uint8 => uint256)) public finalWeightBps;
    mapping(address => uint256) public voteNonces;

    event RoundOpened(uint256 indexed roundId, uint8 assetCount, uint64 opensAt, uint64 closesAt, uint16 voteShareBps);
    event VoteCast(uint256 indexed roundId, address indexed voter, uint8 indexed assetIndex);
    event RoundClosed(uint256 indexed roundId, uint256 totalVotes);

    error InvalidWif();
    error InvalidLock();
    error NotOwner();
    error RoundExists();
    error RoundMissing();
    error InvalidAssets();
    error InvalidBlendRatio();
    error InvalidCloseTime();
    error RoundNotOpen();
    error RoundClosedAlready();
    error InvalidAsset();
    error AlreadyVoted();
    error TransferFailed();
    error BurnFailed();
    error NotLocked();
    error SignatureExpired();
    error InvalidNonce();

    constructor(address wif_, address lockContract_) FlatstockEIP712("Flatstock Votes", "1") {
        if (wif_ == address(0)) revert InvalidWif();
        if (lockContract_ == address(0)) revert InvalidLock();
        wif = IVoteWif(wif_);
        lockContract = IVoteLock(lockContract_);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function openRound(uint256 roundId, uint8 assetCount, uint64 closesAt) external onlyOwner {
        _openRound(roundId, assetCount, closesAt, DEFAULT_VOTE_SHARE_BPS);
    }

    function openRound(uint256 roundId, uint8 assetCount, uint64 closesAt, uint16 voteShareBps_) external onlyOwner {
        _openRound(roundId, assetCount, closesAt, voteShareBps_);
    }

    function _openRound(uint256 roundId, uint8 assetCount, uint64 closesAt, uint16 voteShareBps_) internal {
        Round storage current = rounds[roundId];
        if (current.assetCount != 0) revert RoundExists();
        if (assetCount < 2 || assetCount > MAX_ASSETS) revert InvalidAssets();
        if (closesAt <= block.timestamp) revert InvalidCloseTime();
        if (voteShareBps_ > BPS) revert InvalidBlendRatio();

        current.opensAt = uint64(block.timestamp);
        current.closesAt = closesAt;
        current.assetCount = assetCount;
        voteShareBps[roundId] = voteShareBps_;
        if (roundId > latestRoundId) latestRoundId = roundId;
        emit RoundOpened(roundId, assetCount, current.opensAt, closesAt, voteShareBps_);
    }

    function vote(uint256 roundId, uint8 assetIndex) external {
        _vote(msg.sender, roundId, assetIndex);
    }

    function voteBySig(
        address voter,
        uint256 roundId,
        uint8 assetIndex,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (!lockContract.isLocked(voter)) revert NotLocked();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (nonce != voteNonces[voter]) revert InvalidNonce();
        bytes32 structHash = keccak256(abi.encode(VOTE_TYPEHASH, voter, roundId, assetIndex, nonce, deadline));
        if (_recover(_hashTypedData(structHash), signature) != voter) revert InvalidSignature();
        voteNonces[voter] = nonce + 1;
        _vote(voter, roundId, assetIndex);
    }

    function _vote(address voter, uint256 roundId, uint8 assetIndex) internal {
        Round storage current = rounds[roundId];
        if (current.assetCount == 0) revert RoundMissing();
        if (current.closed || block.timestamp >= current.closesAt) revert RoundNotOpen();
        if (assetIndex >= current.assetCount) revert InvalidAsset();
        if (hasVoted[roundId][voter]) revert AlreadyVoted();

        if (!wif.transferFrom(voter, address(this), VOTE_COST)) revert TransferFailed();
        try wif.burn(VOTE_COST) {}
        catch {
            revert BurnFailed();
        }

        hasVoted[roundId][voter] = true;
        votesFor[roundId][assetIndex] += 1;
        current.totalVotes += 1;
        emit VoteCast(roundId, voter, assetIndex);
    }

    function closeRound(uint256 roundId) external {
        Round storage current = rounds[roundId];
        if (current.assetCount == 0) revert RoundMissing();
        if (current.closed) revert RoundClosedAlready();
        if (block.timestamp < current.closesAt) revert InvalidCloseTime();

        uint256[] memory weights = _computedWeights(roundId);
        for (uint8 i; i < current.assetCount; ++i) {
            finalWeightBps[roundId][i] = weights[i];
        }
        current.closed = true;
        emit RoundClosed(roundId, current.totalVotes);
    }

    function weightBps(uint256 roundId, uint8 assetIndex) external view returns (uint256) {
        Round storage current = rounds[roundId];
        if (current.assetCount == 0) revert RoundMissing();
        if (assetIndex >= current.assetCount) revert InvalidAsset();
        if (current.closed) return finalWeightBps[roundId][assetIndex];
        return _computedWeights(roundId)[assetIndex];
    }

    function _computedWeights(uint256 roundId) internal view returns (uint256[] memory weights) {
        Round storage current = rounds[roundId];
        uint8 count = current.assetCount;
        weights = new uint256[](count);
        uint256 equalBase = BPS / count;
        uint256 equalRemainder = BPS % count;
        uint256 totalVotes = current.totalVotes;
        uint256 voteShare = voteShareBps[roundId];
        uint256 equalShare = BPS - voteShare;

        if (totalVotes == 0) {
            for (uint8 i; i < count; ++i) {
                weights[i] = equalBase + (i < equalRemainder ? 1 : 0);
            }
            return weights;
        }

        uint256 voteSum;
        uint256 weightSum;
        for (uint8 i; i < count; ++i) {
            uint256 voteWeight = _voteWeight(roundId, i, count, totalVotes, voteSum);
            weights[i] = ((equalBase + (i < equalRemainder ? 1 : 0)) * equalShare + voteWeight * voteShare) / BPS;
            weightSum += weights[i];
            if (i != count - 1) voteSum += voteWeight;
        }
        if (weightSum < BPS) weights[count - 1] += BPS - weightSum;
        _capAndRedistribute(weights, count);
    }

    function _voteWeight(uint256 roundId, uint8 index, uint8 count, uint256 totalVotes, uint256 previousVoteSum)
        internal
        view
        returns (uint256)
    {
        if (index == count - 1) return BPS - previousVoteSum;
        return votesFor[roundId][index] * BPS / totalVotes;
    }

    function _capAndRedistribute(uint256[] memory weights, uint8 count) internal pure {
        bool[] memory capped = new bool[](count);
        uint256 excess;
        for (uint8 i; i < count; ++i) {
            if (weights[i] > MAX_WEIGHT_BPS) {
                excess += weights[i] - MAX_WEIGHT_BPS;
                weights[i] = MAX_WEIGHT_BPS;
                capped[i] = true;
            }
        }
        while (excess != 0) {
            uint256 eligible;
            for (uint8 i; i < count; ++i) {
                if (!capped[i] && weights[i] < MAX_WEIGHT_BPS) ++eligible;
            }
            if (eligible == 0) revert InvalidAssets();
            uint256 base = excess / eligible;
            uint256 remainder = excess % eligible;
            uint256 seen;
            uint256 nextExcess;
            for (uint8 i; i < count; ++i) {
                if (capped[i] || weights[i] >= MAX_WEIGHT_BPS) continue;
                uint256 addition = base + (seen < remainder ? 1 : 0);
                ++seen;
                uint256 capacity = MAX_WEIGHT_BPS - weights[i];
                if (addition > capacity) {
                    weights[i] = MAX_WEIGHT_BPS;
                    capped[i] = true;
                    nextExcess += addition - capacity;
                } else {
                    weights[i] += addition;
                }
            }
            excess = nextExcess;
        }
    }
}
