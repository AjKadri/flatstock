pragma solidity ^0.8.24;

interface IERC20Minimal {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Small EIP-7702 delegate used only for the M1 evidence check.
/// @dev The immutable relayer is embedded in the delegated runtime code. The
/// user signs the delegation and typed policy messages off-chain. The relayer
/// pays native gas and the delegated EOA remains the token owner.
contract M1RelayerDelegate {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CONFIG_TYPEHASH = keccak256(
        "Configure(address router,address sellToken,address buyToken,uint256 weeklyLimit,uint256 expiresAt,uint256 nonce)"
    );
    bytes32 private constant REVOKE_TYPEHASH = keccak256("Revoke(uint256 nonce)");
    bytes32 private constant NAME_HASH = keccak256("M1 Relayer Policy");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 private constant SECP256K1N_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public immutable relayer;
    uint256 public policyNonce;

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    struct Policy {
        address router;
        address sellToken;
        address buyToken;
        uint256 weeklyLimit;
        uint256 expiresAt;
        uint256 weekStart;
        uint256 spent;
        bool active;
    }

    Policy public policy;

    event Executed(address indexed target, uint256 value, bytes data);
    event PolicyConfigured(
        address indexed router,
        address indexed sellToken,
        address indexed buyToken,
        uint256 weeklyLimit,
        uint256 expiresAt,
        uint256 nonce
    );
    event PolicyRevoked(uint256 nonce);
    event BuyExecuted(address indexed router, address indexed sellToken, uint256 amountIn, uint256 spentThisWeek);

    error NotRelayer();
    error InvalidSignature();
    error InvalidPolicy();
    error PolicyInactive();
    error PolicyExpired();
    error WrongRouter();
    error WrongToken();
    error WeeklyLimitExceeded();
    error CallFailed(bytes reason);

    constructor(address relayer_) {
        relayer = relayer_;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    function execute(address target, uint256 value, bytes calldata data) external onlyRelayer returns (bytes memory) {
        return _call(target, value, data);
    }

    function executeBatch(Call[] calldata calls) external onlyRelayer {
        for (uint256 i; i < calls.length; ++i) {
            _call(calls[i].target, calls[i].value, calls[i].data);
        }
    }

    function configurePolicy(
        address router,
        address sellToken,
        address buyToken,
        uint256 weeklyLimit,
        uint256 expiresAt,
        bytes calldata signature
    ) external onlyRelayer {
        if (router == address(0) || sellToken == address(0) || buyToken == address(0) || weeklyLimit == 0) {
            revert InvalidPolicy();
        }
        if (expiresAt <= block.timestamp) revert InvalidPolicy();

        uint256 nonce = policyNonce;
        bytes32 structHash =
            keccak256(abi.encode(CONFIG_TYPEHASH, router, sellToken, buyToken, weeklyLimit, expiresAt, nonce));
        _requireUserSignature(structHash, signature);

        policy = Policy({
            router: router,
            sellToken: sellToken,
            buyToken: buyToken,
            weeklyLimit: weeklyLimit,
            expiresAt: expiresAt,
            weekStart: block.timestamp,
            spent: 0,
            active: true
        });
        policyNonce = nonce + 1;
        emit PolicyConfigured(router, sellToken, buyToken, weeklyLimit, expiresAt, nonce);
    }

    function revokePolicy(bytes calldata signature) external onlyRelayer {
        uint256 nonce = policyNonce;
        _requireUserSignature(keccak256(abi.encode(REVOKE_TYPEHASH, nonce)), signature);
        policy.active = false;
        policyNonce = nonce + 1;
        emit PolicyRevoked(nonce);
    }

    /// @notice Executes a router call after enforcing the signed weekly policy.
    /// @dev The caller supplies the exact input amount used by the router calldata.
    /// The selected router and token pair are checked on-chain before the call.
    function executeBuy(address router, address sellToken, address buyToken, uint256 amountIn, bytes calldata swapData)
        external
        onlyRelayer
        returns (bytes memory)
    {
        Policy storage current = policy;
        if (!current.active) revert PolicyInactive();
        if (block.timestamp > current.expiresAt) revert PolicyExpired();
        if (router != current.router) revert WrongRouter();
        if (sellToken != current.sellToken || buyToken != current.buyToken) revert WrongToken();
        if (amountIn == 0 || amountIn > current.weeklyLimit - current.spent) revert WeeklyLimitExceeded();

        if (block.timestamp >= current.weekStart + 7 days) {
            current.weekStart = block.timestamp;
            current.spent = 0;
        }
        if (amountIn > current.weeklyLimit - current.spent) revert WeeklyLimitExceeded();

        current.spent += amountIn;
        _call(sellToken, 0, abi.encodeCall(IERC20Minimal.approve, (router, amountIn)));
        bytes memory result = _call(router, 0, swapData);
        emit BuyExecuted(router, sellToken, amountIn, current.spent);
        return result;
    }

    function _call(address target, uint256 value, bytes memory data) internal returns (bytes memory result) {
        (bool ok, bytes memory returned) = target.call{value: value}(data);
        if (!ok) revert CallFailed(returned);
        emit Executed(target, value, data);
        return returned;
    }

    function _requireUserSignature(bytes32 structHash, bytes calldata signature) internal view {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        if (_recover(digest, signature) != address(this)) revert InvalidSignature();
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if ((v != 27 && v != 28) || uint256(s) > SECP256K1N_HALF) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}

