// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CascadeRegistry} from "./CascadeRegistry.sol";
import {ExecutionRegistry} from "./ExecutionRegistry.sol";

/// @title AttributionSettlement
/// @notice Turns a verified execution into proportional, pull-payment
///         attribution across a model's finalized lineage graph.
///
/// @dev What this contract adds on top of Phase 3, precisely:
///
///      1. Funds a verified execution with a protocol-configured flat fee
///         (see docs/adr/0008) — never a relayer-chosen amount.
///      2. Walks the model's finalized parent edges, bounded by
///         `CascadeRegistry.maxDepth()` and `maxAncestorsPerSettlement`,
///         splitting the fee multiplicatively at each hop per that edge's
///         registered `royaltyBps` — CascadeRegistry's own validated
///         numbers, never recomputed or second-guessed here.
///      3. Records, per edge, `effectiveConfidence = min(edge
///         confidence, the triggering usage proof's serving confidence)`
///         — see docs/adr/0006. This is emitted for transparency; it does
///         NOT gate payment. A Level 3 (Declared) ancestor is still paid
///         according to its registered share — that is the entire point
///         of the optimistic, staked, challengeable design for that tier.
///         Confidence is an audit signal here, not a payment filter.
///      4. Credits pull-payment balances by CURRENT registered owner at
///         settlement time — never a cached or historical owner.
///
///      What this contract does NOT do, and must never be described as
///      doing: prove model identity by itself (that's Phase 3's job, to
///      the extent Phase 3 establishes it at all — see
///      docs/trust-model.md), verify a 0G TEE quote, or integrate with
///      0G's own settlement contract in any way (see docs/adr/0003).
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

    /// @notice Flat attribution fee required to settle one execution. See
    ///         docs/adr/0008 — deliberately the only economically relevant
    ///         number a settler supplies, and it must match this exactly.
    uint256 public attributionFeePerExecution = 0.001 ether;

    /// @notice The only epoch `settleExecution` currently accepts proofs
    ///         for. Advances only via `advanceEpoch`.
    uint64 public currentEpoch = 1;

    /// @dev Hard cap on total graph nodes visited per settlement call,
    ///      independent of `CascadeRegistry.maxDepth()` (which bounds
    ///      depth, not breadth). Ancestors beyond this cap simply receive
    ///      no credit for that settlement — a disclosed limitation
    ///      consistent with how CascadeRegistry already treats
    ///      beyond-maxDepth ancestors, never a revert of the whole
    ///      settlement (that would be a liveness bug: a legitimately
    ///      registered but large graph could never settle at all).
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
    ///      itself) — the residual actually credited to that node's
    ///      current owner after its own direct parents were paid.
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

    /// @notice Settles one verified execution: consumes its UsageProof
    ///         (Phase 3's own replay protection — no second notion of
    ///         execution identity introduced here), then distributes the
    ///         attached fee across the model's finalized lineage graph.
    /// @dev Callable by anyone holding a valid (proof, signature) pair —
    ///      the relayer role stays liveness-only, exactly as Phase 3
    ///      established. It cannot choose the recipient (derived from
    ///      CascadeRegistry state), the amount (fixed by
    ///      `attributionFeePerExecution`), or which model's ancestry is
    ///      used (derived from the verified proof, not calldata).
    function settleExecution(ExecutionRegistry.UsageProof calldata proof, bytes calldata signature)
        external
        payable
        nonReentrant
        returns (bytes32 executionId)
    {
        if (proof.epoch != currentEpoch) revert InvalidEpoch();
        if (msg.value != attributionFeePerExecution) revert IncorrectFunding();

        // Reverts on an invalid signature, unregistered signer, model
        // commitment mismatch, expiry, or replay — all Phase 3's own
        // checks, reused here rather than re-implemented.
        ExecutionRegistry.VerifiedUsage memory usage = executionRegistry.consumeUsageProof(proof, signature);

        emit ExecutionSettled(
            usage.executionId, usage.modelId, usage.provider, proof.epoch, msg.value, usage.servingConfidence
        );

        _distribute(usage.modelId, msg.value, usage.servingConfidence, cascadeRegistry.maxDepth(), 0, usage.executionId);

        return usage.executionId;
    }

    /// @dev Multiplicative cascade: `amount` is what flowed INTO `modelId`
    ///      at this hop. Each finalized direct-parent edge takes its
    ///      registered `royaltyBps` share of THAT amount (not the original
    ///      top-level amount — matching CascadeRegistry's own
    ///      `totalParentBps` semantics, which are scoped per-child, not
    ///      global); the parent's share is itself recursively subject to
    ///      the parent's OWN parent edges. Whatever is left after all
    ///      finalized direct parents are paid is credited to `modelId`'s
    ///      current owner. This is intentionally exact, floor-division
    ///      integer arithmetic: `residual = amount - sum(floor-divided
    ///      parent shares)`, so any fractional-bps rounding dust simply
    ///      enlarges the residual credited to the nearest owner — no
    ///      separate dust pool is needed, and conservation
    ///      (`sum of every OwnerCredited amount across one settlement ==
    ///      the funded amount`) is exact, not approximate.
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
