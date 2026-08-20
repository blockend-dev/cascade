// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CascadeRegistry
/// @notice Registers AI models and their claimed lineage edges, and adjudicates
///         challenges to those claims.
///
/// @dev This contract does NOT prove that a lineage claim is true. It proves
///      that a claim was registered, by whom, with what stake, and whether it
///      survived its challenge window unchallenged or was upheld/rejected by
///      the resolver. The strength of the underlying claim depends entirely on
///      `ConfidenceLevel` — see docs/protocol-spec.md §5 and docs/trust-model.md
///      before treating any state here as a cryptographic guarantee.
///
///      Enforces INV-1 through INV-11 from docs/security-invariants.md.
///      Challenge/finalization lives here rather than a separate contract —
///      see docs/adr/0004-challenge-mechanism-in-lineage-registry.md.
contract CascadeRegistry is Ownable, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum ModelStatus {
        Active,
        Revoked
    }

    /// @dev Ascending strength on purpose: Declared < AttestedTraining <
    ///      CryptographicallyBound, so "weakest edge on a path" is a plain
    ///      min() over the enum's underlying uint8. In user-facing docs this
    ///      maps to Level 3 / Level 2 / Level 1 respectively — the numbering
    ///      schemes intentionally run in opposite directions; see
    ///      docs/protocol-spec.md §1.
    enum ConfidenceLevel {
        Declared,
        AttestedTraining,
        CryptographicallyBound
    }

    enum EdgeStatus {
        Pending,
        Challenged,
        Finalized,
        Rejected
    }

    struct Model {
        address owner;
        bytes32 modelCommitment;
        string metadataURI;
        ModelStatus status;
        uint64 createdAt;
    }

    struct LineageEdge {
        bytes32 childModelId;
        bytes32 parentModelId;
        ConfidenceLevel confidenceLevel;
        uint16 royaltyBps;
        bytes32 evidenceHash;
        uint256 stake;
        uint64 challengeDeadline;
        EdgeStatus status;
        address challenger;
        uint256 challengeBond;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice INV-3: sum of a child's direct-parent royaltyBps may not exceed this.
    uint16 public maxParentBps = 5_000;
    /// @notice INV-2: bounded ancestor walk depth for cycle detection.
    uint8 public maxDepth = 8;
    /// @dev Caps the number of direct parent edges a single model may have,
    ///      bounding the cost of the cycle-detection walk and closing a
    ///      griefing vector where an attacker inflates a model's parent list
    ///      purely to make future cycle checks expensive.
    uint16 public maxParentsPerModel = 16;
    /// @notice INV-7 floor.
    uint256 public minStake = 0.01 ether;
    /// @notice INV-8 floor.
    uint256 public challengeBondAmount = 0.01 ether;
    uint64 public challengeWindow = 3 days;

    /// @dev MVP challenge resolver. A known, documented centralization point —
    ///      see docs/threat-model.md ("Resolver") and docs/adr/0004. Not a
    ///      decentralized adjudication mechanism yet.
    address public resolver;

    mapping(bytes32 => Model) private _models;
    mapping(bytes32 => bool) public modelExists;

    mapping(bytes32 => LineageEdge) private _edges;
    mapping(bytes32 => bool) public edgeExists;
    mapping(bytes32 => bytes32[]) private _parentEdgesOf; // childModelId => edgeIds
    mapping(bytes32 => uint16) public totalParentBps; // childModelId => sum of active edges' bps

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ModelRegistered(bytes32 indexed modelId, address indexed owner, bytes32 modelCommitment, string metadataURI);
    event ModelMetadataUpdated(bytes32 indexed modelId, string metadataURI);
    event ModelOwnershipTransferred(bytes32 indexed modelId, address indexed previousOwner, address indexed newOwner);
    event ModelRevoked(bytes32 indexed modelId);

    event LineageEdgeRegistered(
        bytes32 indexed edgeId,
        bytes32 indexed childModelId,
        bytes32 indexed parentModelId,
        ConfidenceLevel confidenceLevel,
        uint16 royaltyBps,
        uint256 stake
    );
    event LineageEdgeChallenged(bytes32 indexed edgeId, address indexed challenger, uint256 bond);
    event LineageEdgeResolved(bytes32 indexed edgeId, bool challengeUpheld);
    event LineageEdgeFinalized(bytes32 indexed edgeId);

    event ResolverUpdated(address indexed resolver);
    event ParameterUpdated(string name, uint256 value);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ModelAlreadyExists();
    error ModelNotFound();
    error NotModelOwner();
    error ModelNotActive();
    error EdgeAlreadyExists();
    error EdgeNotFound();
    error SelfParent();
    error CycleDetected();
    error TooManyParents();
    error RoyaltyCapExceeded();
    error InsufficientStake();
    error InsufficientChallengeBond();
    error EdgeNotPending();
    error EdgeNotChallenged();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error NotResolver();
    error TransferFailed();
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address initialResolver) Ownable(msg.sender) {
        if (initialResolver == address(0)) revert ZeroAddress();
        resolver = initialResolver;
    }

    // ---------------------------------------------------------------------
    // Model registration
    // ---------------------------------------------------------------------

    /// @notice Registers a new model. `modelCommitment` should be an immutable,
    ///         content-addressed reference (e.g. a 0G Storage root hash) —
    ///         never a mutable alias. See docs/threat-model.md #19.
    function registerModel(bytes32 modelCommitment, string calldata metadataURI, bytes32 salt)
        external
        returns (bytes32 modelId)
    {
        modelId = keccak256(abi.encodePacked(msg.sender, salt));
        if (modelExists[modelId]) revert ModelAlreadyExists();

        _models[modelId] = Model({
            owner: msg.sender,
            modelCommitment: modelCommitment,
            metadataURI: metadataURI,
            status: ModelStatus.Active,
            createdAt: uint64(block.timestamp)
        });
        modelExists[modelId] = true;

        emit ModelRegistered(modelId, msg.sender, modelCommitment, metadataURI);
    }

    function updateMetadataURI(bytes32 modelId, string calldata metadataURI) external {
        Model storage model = _requireModel(modelId);
        if (model.owner != msg.sender) revert NotModelOwner();
        model.metadataURI = metadataURI;
        emit ModelMetadataUpdated(modelId, metadataURI);
    }

    /// @dev INV-4 note: ownership transfer is a distinct, logged event so
    ///      historical attribution before a transfer remains provable off-chain.
    function transferModelOwnership(bytes32 modelId, address newOwner) external {
        Model storage model = _requireModel(modelId);
        if (model.owner != msg.sender) revert NotModelOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = model.owner;
        model.owner = newOwner;
        emit ModelOwnershipTransferred(modelId, previousOwner, newOwner);
    }

    /// @dev INV-5: revocation only blocks this model from being cited as a
    ///      parent in *future* edge registrations. It never reaches back into
    ///      already-finalized edges or already-settled epochs.
    function revokeModel(bytes32 modelId) external {
        Model storage model = _requireModel(modelId);
        if (model.owner != msg.sender) revert NotModelOwner();
        model.status = ModelStatus.Revoked;
        emit ModelRevoked(modelId);
    }

    // ---------------------------------------------------------------------
    // Lineage edges
    // ---------------------------------------------------------------------

    /// @notice Declares that `childModelId` derives from `parentModelId`, at a
    ///         claimed confidence level, for a claimed royalty share. Callable
    ///         only by the child model's owner. Requires a stake (INV-7),
    ///         forfeit if a challenge against this edge succeeds (INV-11).
    /// @param evidenceHash Commitment to the off-chain evidence manifest backing
    ///        this claim — a signed lineage declaration (Declared), the 0G
    ///        fine-tuning completion record (AttestedTraining), or the
    ///        wrapper's attested measurement reference (CryptographicallyBound).
    ///        This contract does not interpret the evidence; it only records
    ///        the commitment so a challenger or auditor can fetch and check it.
    function registerLineageEdge(
        bytes32 childModelId,
        bytes32 parentModelId,
        ConfidenceLevel confidenceLevel,
        uint16 royaltyBps,
        bytes32 evidenceHash
    ) external payable returns (bytes32 edgeId) {
        Model storage child = _requireModel(childModelId);
        Model storage parent = _requireModel(parentModelId);

        if (child.owner != msg.sender) revert NotModelOwner();
        if (child.status != ModelStatus.Active || parent.status != ModelStatus.Active) revert ModelNotActive();
        if (childModelId == parentModelId) revert SelfParent(); // INV-1
        if (msg.value < minStake) revert InsufficientStake(); // INV-7

        edgeId = keccak256(abi.encodePacked(childModelId, parentModelId));
        if (edgeExists[edgeId]) revert EdgeAlreadyExists();

        if (_parentEdgesOf[childModelId].length >= maxParentsPerModel) revert TooManyParents();

        uint16 newTotal = totalParentBps[childModelId] + royaltyBps;
        if (newTotal > maxParentBps) revert RoyaltyCapExceeded(); // INV-3

        // INV-2: reject if parentModelId is already reachable as an ancestor
        // of childModelId — i.e. childModelId is already an ancestor of
        // parentModelId, so this edge would close a cycle.
        if (_reachableWithinDepth(parentModelId, childModelId, maxDepth)) revert CycleDetected();

        _edges[edgeId] = LineageEdge({
            childModelId: childModelId,
            parentModelId: parentModelId,
            confidenceLevel: confidenceLevel,
            royaltyBps: royaltyBps,
            evidenceHash: evidenceHash,
            stake: msg.value,
            challengeDeadline: uint64(block.timestamp) + challengeWindow,
            status: EdgeStatus.Pending,
            challenger: address(0),
            challengeBond: 0
        });
        edgeExists[edgeId] = true;
        _parentEdgesOf[childModelId].push(edgeId);
        totalParentBps[childModelId] = newTotal;

        emit LineageEdgeRegistered(edgeId, childModelId, parentModelId, confidenceLevel, royaltyBps, msg.value);
    }

    /// @notice Disputes a pending edge before its challenge window closes.
    ///         Requires a bond (INV-8). See docs/threat-model.md #15.
    function challengeEdge(bytes32 edgeId) external payable {
        LineageEdge storage edge = _requireEdge(edgeId);
        if (edge.status != EdgeStatus.Pending) revert EdgeNotPending();
        if (block.timestamp >= edge.challengeDeadline) revert ChallengeWindowClosed(); // INV-9
        if (msg.value < challengeBondAmount) revert InsufficientChallengeBond();

        edge.status = EdgeStatus.Challenged;
        edge.challenger = msg.sender;
        edge.challengeBond = msg.value;

        emit LineageEdgeChallenged(edgeId, msg.sender, msg.value);
    }

    /// @notice Resolves a challenged edge. MVP: role-gated, not decentralized —
    ///         see docs/adr/0004. INV-10: moves to exactly one terminal state.
    ///         INV-11: the losing party's funds go to the winner, never back
    ///         to both.
    function resolveChallenge(bytes32 edgeId, bool challengeUpheld) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver();
        LineageEdge storage edge = _requireEdge(edgeId);
        if (edge.status != EdgeStatus.Challenged) revert EdgeNotChallenged();

        address challenger = edge.challenger;
        address registrant = _models[edge.childModelId].owner;
        uint256 stake = edge.stake;
        uint256 bond = edge.challengeBond;

        edge.stake = 0;
        edge.challengeBond = 0;

        if (challengeUpheld) {
            edge.status = EdgeStatus.Rejected;
            totalParentBps[edge.childModelId] -= edge.royaltyBps;
            _payOut(challenger, stake + bond);
        } else {
            edge.status = EdgeStatus.Finalized;
            _payOut(registrant, stake + bond);
            emit LineageEdgeFinalized(edgeId);
        }

        emit LineageEdgeResolved(edgeId, challengeUpheld);
    }

    /// @notice Finalizes an edge that reached the end of its challenge window
    ///         unchallenged. Callable by anyone (INV-9), returns the
    ///         registrant's stake now that the claim survived its window.
    function finalizeEdge(bytes32 edgeId) external nonReentrant {
        LineageEdge storage edge = _requireEdge(edgeId);
        if (edge.status != EdgeStatus.Pending) revert EdgeNotPending();
        if (block.timestamp < edge.challengeDeadline) revert ChallengeWindowOpen();

        edge.status = EdgeStatus.Finalized;
        uint256 stake = edge.stake;
        edge.stake = 0;

        address registrant = _models[edge.childModelId].owner;
        _payOut(registrant, stake);

        emit LineageEdgeFinalized(edgeId);
    }

    // ---------------------------------------------------------------------
    // Admin (Ownable) — economic parameters kept configurable rather than
    // hardcoded, per design requirement.
    // ---------------------------------------------------------------------

    function setResolver(address newResolver) external onlyOwner {
        if (newResolver == address(0)) revert ZeroAddress();
        resolver = newResolver;
        emit ResolverUpdated(newResolver);
    }

    function setMaxParentBps(uint16 value) external onlyOwner {
        maxParentBps = value;
        emit ParameterUpdated("maxParentBps", value);
    }

    function setMaxDepth(uint8 value) external onlyOwner {
        maxDepth = value;
        emit ParameterUpdated("maxDepth", value);
    }

    function setMaxParentsPerModel(uint16 value) external onlyOwner {
        maxParentsPerModel = value;
        emit ParameterUpdated("maxParentsPerModel", value);
    }

    function setMinStake(uint256 value) external onlyOwner {
        minStake = value;
        emit ParameterUpdated("minStake", value);
    }

    function setChallengeBondAmount(uint256 value) external onlyOwner {
        challengeBondAmount = value;
        emit ParameterUpdated("challengeBondAmount", value);
    }

    function setChallengeWindow(uint64 value) external onlyOwner {
        challengeWindow = value;
        emit ParameterUpdated("challengeWindow", value);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getModel(bytes32 modelId) external view returns (Model memory) {
        return _requireModelView(modelId);
    }

    function getEdge(bytes32 edgeId) external view returns (LineageEdge memory) {
        return _requireEdgeView(edgeId);
    }

    function computeEdgeId(bytes32 childModelId, bytes32 parentModelId) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(childModelId, parentModelId));
    }

    function getParentEdgeIds(bytes32 childModelId) external view returns (bytes32[] memory) {
        return _parentEdgesOf[childModelId];
    }

    /// @notice Weakest-link confidence over a caller-supplied path of edges.
    ///         Off-chain resolution (Phase 9) computes full DAG splits; this
    ///         is exposed for direct inspection of a specific claimed path.
    ///         Reverts if any edge in the path is not Finalized. See
    ///         docs/security-invariants.md INV-6.
    function pathConfidence(bytes32[] calldata edgeIds) external view returns (ConfidenceLevel) {
        require(edgeIds.length > 0, "empty path");
        LineageEdge storage first = _requireEdge(edgeIds[0]);
        if (first.status != EdgeStatus.Finalized) revert EdgeNotPending();
        ConfidenceLevel weakest = first.confidenceLevel;

        for (uint256 i = 1; i < edgeIds.length; i++) {
            LineageEdge storage edge = _requireEdge(edgeIds[i]);
            if (edge.status != EdgeStatus.Finalized) revert EdgeNotPending();
            if (uint8(edge.confidenceLevel) < uint8(weakest)) {
                weakest = edge.confidenceLevel;
            }
        }
        return weakest;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _requireModel(bytes32 modelId) internal view returns (Model storage) {
        if (!modelExists[modelId]) revert ModelNotFound();
        return _models[modelId];
    }

    function _requireModelView(bytes32 modelId) internal view returns (Model storage) {
        if (!modelExists[modelId]) revert ModelNotFound();
        return _models[modelId];
    }

    function _requireEdge(bytes32 edgeId) internal view returns (LineageEdge storage) {
        if (!edgeExists[edgeId]) revert EdgeNotFound();
        return _edges[edgeId];
    }

    function _requireEdgeView(bytes32 edgeId) internal view returns (LineageEdge storage) {
        if (!edgeExists[edgeId]) revert EdgeNotFound();
        return _edges[edgeId];
    }

    /// @dev Bounded upward walk from `start` through its registered parent
    ///      edges, looking for `target`. Used only for cycle detection at
    ///      registration time (INV-2). Depth-bounded by construction and by
    ///      `maxParentsPerModel`, so branching is bounded on both axes.
    ///      Rejected edges are skipped — a rejected claim never counts as a
    ///      real ancestry link.
    function _reachableWithinDepth(bytes32 start, bytes32 target, uint8 depth) internal view returns (bool) {
        if (start == target) return true;
        if (depth == 0) return false;

        bytes32[] storage parentEdgeIds = _parentEdgesOf[start];
        for (uint256 i = 0; i < parentEdgeIds.length; i++) {
            LineageEdge storage edge = _edges[parentEdgeIds[i]];
            if (edge.status == EdgeStatus.Rejected) continue;
            if (_reachableWithinDepth(edge.parentModelId, target, depth - 1)) {
                return true;
            }
        }
        return false;
    }

    function _payOut(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
