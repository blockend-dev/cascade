import { EdgeRow, ModelRow } from "../../../indexer/src/types";

/**
 * Pure layered-DAG layout — ADR 0015 (no graph library). Ancestors
 * (parents) are laid out ABOVE the focal model, descendants (children)
 * BELOW, matching the brief's own ASCII example. Every lineage graph
 * this protocol can produce is bounded by `CascadeRegistry.maxDepth`
 * (8) and `maxParentsPerModel` (16) — small enough that a
 * straightforward generation/order layout is sufficient; see ADR 0015.
 */

export interface GraphNode {
  modelId: string;
  generation: number; // 0 = focal model, negative = ancestor, positive = descendant
  order: number; // position within its generation
  model: ModelRow | null; // null if the indexer hasn't projected this model yet (shouldn't happen, defensive)
}

export interface GraphEdge {
  edge: EdgeRow;
  fromGeneration: number; // parent's generation
  toGeneration: number; // child's generation
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  minGeneration: number;
  maxGeneration: number;
}

export function layoutDag(focalModelId: string, models: Map<string, ModelRow>, edges: EdgeRow[]): GraphLayout {
  const generation = new Map<string, number>();
  generation.set(focalModelId, 0);

  const byChild = new Map<string, EdgeRow[]>(); // childModelId -> edges to its parents
  const byParent = new Map<string, EdgeRow[]>(); // parentModelId -> edges to its children
  for (const e of edges) {
    (byChild.get(e.childModelId) ?? byChild.set(e.childModelId, []).get(e.childModelId)!).push(e);
    (byParent.get(e.parentModelId) ?? byParent.set(e.parentModelId, []).get(e.parentModelId)!).push(e);
  }

  // BFS upward (ancestors) and downward (descendants) from the focal model.
  const queue: string[] = [focalModelId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const gen = generation.get(current)!;
    for (const e of byChild.get(current) ?? []) {
      if (!generation.has(e.parentModelId)) {
        generation.set(e.parentModelId, gen - 1);
        queue.push(e.parentModelId);
      }
    }
    for (const e of byParent.get(current) ?? []) {
      if (!generation.has(e.childModelId)) {
        generation.set(e.childModelId, gen + 1);
        queue.push(e.childModelId);
      }
    }
  }

  const byGeneration = new Map<number, string[]>();
  for (const [modelId, gen] of generation) {
    (byGeneration.get(gen) ?? byGeneration.set(gen, []).get(gen)!).push(modelId);
  }

  const nodes: GraphNode[] = [];
  for (const [gen, ids] of byGeneration) {
    ids.forEach((modelId, order) => {
      nodes.push({ modelId, generation: gen, order, model: models.get(modelId) ?? null });
    });
  }

  const graphEdges: GraphEdge[] = edges
    .filter((e) => generation.has(e.childModelId) && generation.has(e.parentModelId))
    .map((e) => ({ edge: e, fromGeneration: generation.get(e.parentModelId)!, toGeneration: generation.get(e.childModelId)! }));

  const gens = Array.from(generation.values());
  return {
    nodes,
    edges: graphEdges,
    minGeneration: gens.length ? Math.min(...gens) : 0,
    maxGeneration: gens.length ? Math.max(...gens) : 0,
  };
}
