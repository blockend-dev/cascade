import { EdgeRow, ModelRow } from "../../../indexer/src/types";
import { IndexerClient } from "../api/indexerClient";

const MAX_HOPS = 6; // UI-level display bound, not a protocol limit — see docs/frontend.md §11

/** Bounded breadth-first expansion of a model's local lineage
 *  neighborhood via the indexer's per-model lineage endpoint — never a
 *  whole-protocol graph load into the browser (docs/frontend.md /
 *  brief's performance section). */
export async function fetchLineageSubgraph(
  indexer: IndexerClient,
  focalModelId: string
): Promise<{ models: Map<string, ModelRow>; edges: EdgeRow[] }> {
  const models = new Map<string, ModelRow>();
  const edgesById = new Map<string, EdgeRow>();
  const visited = new Set<string>();
  let frontier = [focalModelId];

  const focal = await indexer.getModel(focalModelId);
  if (focal) models.set(focalModelId, focal);

  for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const modelId of frontier) {
      if (visited.has(modelId)) continue;
      visited.add(modelId);
      const { parents, children } = await indexer.getModelLineage(modelId);
      for (const edge of [...parents, ...children]) {
        edgesById.set(edge.edgeId, edge);
        for (const neighborId of [edge.parentModelId, edge.childModelId]) {
          if (!visited.has(neighborId)) next.push(neighborId);
        }
      }
    }
    frontier = Array.from(new Set(next));
  }

  await Promise.all(
    Array.from(visited).map(async (modelId) => {
      if (models.has(modelId)) return;
      const model = await indexer.getModel(modelId);
      if (model) models.set(modelId, model);
    })
  );

  return { models, edges: Array.from(edgesById.values()) };
}
