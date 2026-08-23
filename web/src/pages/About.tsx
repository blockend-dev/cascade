import React from "react";
import { useIndexer } from "../api/IndexerContext";
import { useAsync } from "../hooks/useAsync";
import { Panel, Hex, LoadingState } from "../components/primitives";
import { AppConfig } from "../config";
import { CONFIDENCE_INFO } from "../confidence";

/**
 * Explains Cascade without marketing overreach. Language here is drawn
 * directly from docs/architecture.md, docs/protocol-spec.md, and
 * docs/trust-model.md — never a new marketing claim invented for this
 * page (docs/frontend.md / the brief's explicit instruction).
 */
export function About({ config }: { config: AppConfig }) {
  const indexer = useIndexer();
  const statusState = useAsync(() => indexer.getSyncStatus(), [indexer]);

  return (
    <div className="page page-about">
      <Panel title="What Cascade does" id="what-heading">
        <p>
          Cascade is a settlement layer for AI model lineage on 0G. Every served inference that passes independent
          verification triggers proportional payment up a public ancestry graph.
        </p>
        <p>
          It is not a model marketplace, not an agent identity system, and not a general inference router. Given
          that a model was served, and given a publicly registered ancestry graph for that model, Cascade pays the
          right ancestors the right amount, and makes the strength of that guarantee explicit rather than uniform.
        </p>
      </Panel>

      <Panel title="Three confidence levels" id="levels-heading">
        <p>
          Every lineage edge carries one of three confidence levels — the exact levels below, in the exact wording
          the protocol specification defines. Nothing on this site upgrades or paraphrases these into stronger
          language.
        </p>
        <dl className="identity-grid">
          {Object.values(CONFIDENCE_INFO)
            .sort((a, b) => a.userFacingLevel - b.userFacingLevel)
            .map((info) => (
              <React.Fragment key={info.level}>
                <dt>
                  Level {info.userFacingLevel} — {info.label}
                </dt>
                <dd>
                  {info.establishes} <em>Does not establish:</em> {info.doesNotEstablish}
                </dd>
              </React.Fragment>
            ))}
        </dl>
      </Panel>

      <Panel title="Serving vs. lineage confidence" id="axes-heading">
        <p>
          These are two independent axes. Lineage confidence describes how strongly a parent→child ancestry claim is
          backed. Serving confidence describes how strongly the specific inference that triggered a settlement is
          backed. The effective confidence used for one attribution edge is the weaker of the two — never an
          average, never inherited from a stronger ancestor, and it never gates whether payment happens (a Declared
          edge is still paid its registered share; confidence is an audit signal, not a payment filter).
        </p>
      </Panel>

      <Panel title="Settlement model" id="settlement-heading">
        <p>
          A provider (or anyone holding a valid signed usage proof) submits it to <code>AttributionSettlement</code>,
          funded with a protocol-configured flat fee. The contract verifies the proof, then walks the model's
          finalized lineage edges on-chain, splitting the fee multiplicatively at each hop by that edge's registered
          royalty share. Credited balances are pull-payment — an owner claims their own balance whenever they
          choose.
        </p>
      </Panel>

      <Panel title="Relayer model" id="relayer-heading">
        <p>
          Submission is permissionless and liveness-only: a relayer (or anyone) can submit a valid proof, but cannot
          fabricate one, redirect a payment, or choose an amount — every economically relevant value is derived from
          registered chain state, never relayer-supplied.
        </p>
      </Panel>

      <Panel title="Wrapper model (Level 1)" id="wrapper-heading">
        <p>
          The Cascade-authored serving wrapper verifies a model's content-addressed hash against its registered
          commitment before loading it, inside a measured TEE launch configuration — the only path to
          Cryptographically Bound confidence. A provider's "Cascade Wrapper" mode flag is owner-attested; independent
          verification of a specific running instance uses the reproducible-build and measurement runbook in{" "}
          <code>wrapper/MEASUREMENT.md</code>, not this website.
        </p>
      </Panel>

      <Panel title="Trust assumptions and limitations" id="trust-heading">
        <ul>
          <li>Cascade does not integrate with, or depend on, 0G's own Compute/Serving settlement contracts.</li>
          <li>
            Level 2 (Attested Training) evidence is circumstantial and accountable — a real party is on the hook for
            having signed it — not a cryptographic proof of derivation.
          </li>
          <li>
            Level 1 (Cryptographically Bound) depends on 0G's TEE attestation and hardware guarantees, inherited, not
            independently re-verified by Cascade's contracts or this frontend.
          </li>
          <li>
            This frontend is never a trust boundary: every claim it renders is either copied from indexed/on-chain
            data or explicitly labeled unavailable — see the indexer status below.
          </li>
        </ul>
      </Panel>

      <Panel title="Deployment" id="deployment-heading">
        <dl className="identity-grid">
          <dt>Chain</dt>
          <dd>
            {config.chainName} (chain ID {config.chainId.toString()})
          </dd>
          <dt>CascadeRegistry</dt>
          <dd>
            <Hex value={config.addresses.cascadeRegistry} chars={12} />
          </dd>
          <dt>ExecutionRegistry</dt>
          <dd>
            <Hex value={config.addresses.executionRegistry} chars={12} />
          </dd>
          <dt>AttributionSettlement</dt>
          <dd>
            <Hex value={config.addresses.attributionSettlement} chars={12} />
          </dd>
          <dt>TrainingProvenanceRegistry</dt>
          <dd>
            <Hex value={config.addresses.trainingProvenanceRegistry} chars={12} />
          </dd>
          <dt>Indexer status</dt>
          <dd>
            {statusState.status === "loading" && <LoadingState label="Loading indexer status…" />}
            {statusState.status === "ready" &&
              (statusState.data.lastIndexedBlock === null
                ? "Not yet synced"
                : `Indexed through block ${statusState.data.lastIndexedBlock.toLocaleString()} (${statusState.data.lagBlocks} blocks behind safe head)`)}
            {statusState.status === "error" && "Indexer unavailable"}
          </dd>
        </dl>
      </Panel>
    </div>
  );
}
