import React from "react";
import { useWallet } from "../wallet/WalletContext";
import { useAsync } from "../hooks/useAsync";
import { useTx } from "../tx/useTx";
import { TxStatus, TxSummary } from "../tx/TxStatus";
import { AppConfig } from "../types";
import { EdgeRow } from "../../../indexer/src/types";

/**
 * Challenge / finalize actions for one pending lineage edge —
 * docs/frontend.md §6's "clearly display required amount, affected
 * edge, challenge window, economic consequence" requirement. The
 * required challenge bond is always a LIVE read
 * (`client.read.getCascadeRegistryParameters()`), never a hardcoded or
 * client-typed number — a challenger cannot send less than what the
 * contract will actually accept because this component only ever
 * offers the live value, not an editable amount field.
 */
export function EdgeActions({ edge, config }: { edge: EdgeRow; config: AppConfig }) {
  const { client, account } = useWallet();
  const paramsState = useAsync(() => client.read.getCascadeRegistryParameters(), [client]);

  const challengeTx = useTx((edgeId: string, bond: bigint) => client.write.challengeEdge(edgeId, bond));
  const finalizeTx = useTx((edgeId: string) => client.write.finalizeEdge(edgeId));

  if (edge.status === "Finalized" || edge.status === "Rejected") return null;
  if (!account) return null;

  return (
    <div className="edge-actions">
      {edge.status === "Pending" && paramsState.status === "ready" && (
        <>
          <TxSummary>
            Challenge edge {edge.edgeId.slice(0, 10)}… by posting the required bond of{" "}
            {paramsState.data.challengeBondAmount.toString()} wei. If the challenge succeeds, this bond and the
            registrant's stake go to you; if it fails, they go to the registrant.
          </TxSummary>
          <button type="button" onClick={() => challengeTx.run(edge.edgeId, paramsState.data.challengeBondAmount)} disabled={challengeTx.state.status === "pending"}>
            Challenge (bond: {paramsState.data.challengeBondAmount.toString()} wei)
          </button>
          <TxStatus state={challengeTx.state} config={config} />
        </>
      )}
      {edge.status === "Pending" && (
        <>
          <TxSummary>
            Finalize edge {edge.edgeId.slice(0, 10)}… (only possible once its challenge window has closed
            unchallenged) and return the registrant's stake.
          </TxSummary>
          <button type="button" onClick={() => finalizeTx.run(edge.edgeId)} disabled={finalizeTx.state.status === "pending"}>
            Finalize (if window has closed)
          </button>
          <TxStatus state={finalizeTx.state} config={config} />
        </>
      )}
    </div>
  );
}
