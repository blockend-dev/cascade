// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CascadeRegistry} from "./CascadeRegistry.sol";
import {ExecutionRegistry} from "./ExecutionRegistry.sol";

/// @title AttributionSettlement
/// @notice Distributes a verified execution's fee proportionally across a
///         model's finalized lineage graph via pull payments.
/// @dev Funds each settlement with a protocol-configured flat fee
///      (docs/adr/0008), never a relayer-chosen amount. Traversal walks a
///      model's finalized parent edges, bounded by
///      `CascadeRegistry.maxDepth()` and `maxAncestorsPerSettlement`,
///      splitting the fee multiplicatively at each hop by that edge's
///      registered `royaltyBps`; those shares come from `CascadeRegistry`
///      and are not recomputed here.
///
///      Each traversed edge emits `effectiveConfidence = min(edge
///      confidence, the triggering usage proof's serving confidence)`
///      (docs/adr/0006) as an audit signal — it does not gate payment. A
///      Declared (Level 3) ancestor is paid its full registered share
///      regardless of confidence; that tier's security is economic
///      (stake and challenge window), not cryptographic.
///
///      Balances are credited to each model's current registered owner
///      at settlement time, not a cached or historical owner.
///
///      Out of scope: establishing model identity (that boundary belongs
///      to `ExecutionRegistry`, to the extent it establishes it at all —
///      see docs/trust-model.md), verifying a 0G TEE quote, or any
///      integration with 0G's own settlement contract (docs/adr/0003).
contract AttributionSettlement is Ownable, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @dev Mirrors CascadeRegistry.BPS_DENOMINATOR. Kept as a local
    ///      constant rather than an external view call so that a hot loop
    ///      over many edges doesn't pay a STATICCALL per multiplication —
    ///      10,000 basis points is a fixed protocol-wide convention, not a
    ///      configurable parameter, in both contracts alike.
    uint256 private constant BPS_DENOMINATOR = 10_000;

    CascadeRegistry public immutable cascadeRegistry;
    ExecutionRegistry public immutable executionRegistry;

    /// @notice Flat fee required to settle one execution (docs/adr/0008) —
    ///         the only economically relevant value a settler supplies, and
    ///         it must match this exactly or the call reverts.
    uint256 public attributionFeePerExecution = 0.001 ether;

    /// @notice The only epoch `settleExecution` currently accepts proofs
    ///         for. Advances only via `advanceEpoch`.
    uint64 public currentEpoch = 1;

    /// @dev Hard cap on total graph nodes visited per settlement call,
    ///      independent of `CascadeRegistry.maxDepth()` (which bounds depth,
    ///      not breadth). Ancestors beyond this cap receive no credit for
    ///      that settlement rather than reverting the whole call — a large
    ///      but legitimately registered graph must still be able to settle.
    uint32 public maxAncestorsPerSettlement = 64;

    mapping(address => uint256) public claimable;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ExecutionSettled(
        bytes32 indexed executionId,
        bytes32 indexed modelId,
        address indexed provider,
        uint64 epoch,
        uint256 amount,
        CascadeRegistry.ConfidenceLevel servingConfidence
    );

    /// @dev One per traversed, finalized edge. `effectiveConfidence` is the
    ///      audit-trail value from docs/adr/0006 — informational, not a
    ///      payment gate (see contract-level NatSpec).
    event EdgeAttributed(
        bytes32 indexed executionId,
        bytes32 indexed edgeId,
        bytes32 childModelId,
        bytes32 parentModelId,
        uint256 amount,
        CascadeRegistry.ConfidenceLevel effectiveConfidence
    );

    /// @dev One per node in the traversal (including the served model
    ///      itself) — the residual credited to that node's current owner
    ///      after its own direct parents were paid.
    event OwnerCredited(bytes32 indexed executionId, bytes32 indexed modelId, address indexed owner, uint256 amount);

    event Claimed(address indexed recipient, uint256 amount);
    event EpochAdvanced(uint64 newEpoch);
    event ParameterUpdated(string name, uint256 value);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error IncorrectFunding();
    error InvalidEpoch();
    error NothingToClaim();
    error TransferFailed();
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address cascadeRegistryAddress, address executionRegistryAddress) Ownable(msg.sender) {
        if (cascadeRegistryAddress == address(0) || executionRegistryAddress == address(0)) revert ZeroAddress();
        cascadeRegistry = CascadeRegistry(cascadeRegistryAddress);
        executionRegistry = ExecutionRegistry(executionRegistryAddress);
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Settles one verified execution: consumes its UsageProof via
    ///         `ExecutionRegistry` (the sole source of replay protection
    ///         and execution identity), then distributes the attached fee
    ///         across the model's finalized lineage graph.
    /// @dev Callable by anyone holding a valid (proof, signature) pair —
    ///      the caller is liveness-only and controls none of the
    ///      economically relevant inputs: the recipient is derived from
    ///      `CascadeRegistry` state, the amount is fixed by
    ///      `attributionFeePerExecution`, and the ancestry used is derived
    ///      from the verified proof, not calldata.
    function settleExecution(ExecutionRegistry.UsageProof calldata proof, bytes calldata signature)
        external
        payable
        nonReentrant
        returns (bytes32 executionId)
    {
        if (proof.epoch != currentEpoch) revert InvalidEpoch();
        if (msg.value != attributionFeePerExecution) revert IncorrectFunding();

        // Reverts on an invalid signature, unregistered signer, model
        // commitment mismatch, expiry, or replay — all ExecutionRegistry's
        // own checks, not reimplemented here.
        ExecutionRegistry.VerifiedUsage memory usage = executionRegistry.consumeUsageProof(proof, signature);

        emit ExecutionSettled(
            usage.executionId, usage.modelId, usage.provider, proof.epoch, msg.value, usage.servingConfidence
        );

        _distribute(usage.modelId, msg.value, usage.servingConfidence, cascadeRegistry.maxDepth(), 0, usage.executionId);

        return usage.executionId;
    }

    /// @dev Multiplicative cascade: `amount` is what flowed into `modelId`
    ///      at this hop. Each finalized direct-parent edge takes its
    ///      registered `royaltyBps` share of that amount, not the original
    ///      top-level amount — matching `CascadeRegistry.totalParentBps`,
    ///      which is scoped per-child, not global. Each parent's share is
    ///      itself recursively subject to that parent's own parent edges.
    ///      Whatever remains after all finalized direct parents are paid
    ///      is credited to `modelId`'s current owner.
    ///
    ///      Uses floor-division integer arithmetic throughout:
    ///      `residual = amount - sum(floor-divided parent shares)`, so
    ///      fractional-bps rounding dust enlarges the residual credited to
    ///      the nearest owner rather than requiring a separate dust pool.
    ///      Conservation — the sum of every `OwnerCredited` amount in one
    ///      settlement equals the funded amount — is exact, not
    ///      approximate.
    function _distribute(
        bytes32 modelId,
        uint256 amount,
        CascadeRegistry.ConfidenceLevel servingConfidence,
        uint8 depthRemaining,
        uint32 visited,
        bytes32 executionId
    ) internal returns (uint32) {
        visited++;
        if (visited > maxAncestorsPerSettlement) {
            // Truncate silently past the breadth cap — see the storage
            // comment on maxAncestorsPerSettlement. Nothing was credited
            // for this node; the amount that would have flowed here stays
            // with whichever ancestor's residual it was already folded
            // into by the caller.
            return visited;
        }

        CascadeRegistry.Model memory model = cascadeRegistry.getModel(modelId);
        uint256 distributed = 0;

        if (depthRemaining > 0) {
            bytes32[] memory parentEdgeIds = cascadeRegistry.getParentEdgeIds(modelId);
            for (uint256 i = 0; i < parentEdgeIds.length; i++) {
                if (visited >= maxAncestorsPerSettlement) break;

                CascadeRegistry.LineageEdge memory edge = cascadeRegistry.getEdge(parentEdgeIds[i]);
                // INV: only finalized lineage receives attribution —
                // pending, challenged, or rejected edges are skipped.
                if (edge.status != CascadeRegistry.EdgeStatus.Finalized) continue;

                uint256 parentShare = (amount * edge.royaltyBps) / BPS_DENOMINATOR;
                distributed += parentShare;

                CascadeRegistry.ConfidenceLevel effective = _min(edge.confidenceLevel, servingConfidence);
                emit EdgeAttributed(
                    executionId, parentEdgeIds[i], modelId, edge.parentModelId, parentShare, effective
                );

                visited = _distribute(
                    edge.parentModelId, parentShare, servingConfidence, depthRemaining - 1, visited, executionId
                );
            }
        }

        uint256 residual = amount - distributed;
        claimable[model.owner] += residual;
        emit OwnerCredited(executionId, modelId, model.owner, residual);

        return visited;
    }

    function _min(CascadeRegistry.ConfidenceLevel a, CascadeRegistry.ConfidenceLevel b)
        internal
        pure
        returns (CascadeRegistry.ConfidenceLevel)
    {
        return uint8(a) < uint8(b) ? a : b;
    }

    // ---------------------------------------------------------------------
    // Claims (pull payment)
    // ---------------------------------------------------------------------

    /// @notice Withdraws the caller's entire claimable balance.
    /// @dev Checks-effects-interactions: balance is zeroed before the
    ///      external call. `nonReentrant` as defense in depth on top of
    ///      that ordering.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimable[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Claimed(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function advanceEpoch() external onlyOwner {
        currentEpoch++;
        emit EpochAdvanced(currentEpoch);
    }

    function setAttributionFeePerExecution(uint256 value) external onlyOwner {
        attributionFeePerExecution = value;
        emit ParameterUpdated("attributionFeePerExecution", value);
    }

    function setMaxAncestorsPerSettlement(uint32 value) external onlyOwner {
        maxAncestorsPerSettlement = value;
        emit ParameterUpdated("maxAncestorsPerSettlement", value);
    }
}
