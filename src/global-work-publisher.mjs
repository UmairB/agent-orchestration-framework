import { globalMeshPaths } from "./workspace.mjs";
import {
  openGlobalWorkProjectionStore,
  publishWorkspaceSnapshot,
  recordWorkspaceProjectionError,
  workspaceIdFor,
  readWorkspaceProjectionItems,
  readWorkspaceContentRecords,
} from "./global-work-store.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "./global-node-registry.mjs";

// Re-exported so mesh-launcher.mjs (review fix P0.1/P1.7) can derive a workspace's
// canonical id and read its CURRENT item-row set WITHOUT importing global-work-
// store.mjs directly — this module is the ONE seam a mutation caller/the launcher
// is allowed to reach for the global store (fitness acd-global-publisher-single-
// seam: no OTHER caller opens the SQLite store or imports it directly). Re-
// exporting a pure/read helper here does not weaken that invariant — the WRITE
// path (publishWorkspaceSnapshot/openGlobalWorkProjectionStore) still only runs
// inside this module's own publishGlobalWorkSnapshot.
// readWorkspaceContentRecords rides the same re-export rationale: a WORKER-side
// pure read (doc bodies + run records for the worktree-content frame, schema v5) —
// the launcher reaches it through this seam, never the store module directly.
export { workspaceIdFor, readWorkspaceProjectionItems, readWorkspaceContentRecords };

export const MESH_GLOBAL_DISABLED_CODE = "mesh-global-disabled";

export function meshGlobalPropagationDecision(workspaceOrConfig) {
  const config = workspaceOrConfig?.config ?? workspaceOrConfig ?? {};
  const mesh = config?.mesh;
  // A workspace opts into machine-wide propagation EITHER by the global mesh enable
  // (mesh?.enabled === true — set by `aof mesh join` into the global config, merged
  // into every workspace) OR by an explicit per-repo publish marker written by
  // `aof mesh repo publish` (34/story 06, ADR-010): mesh.repo.published === true makes
  // THIS repo a first-class mesh repo whose future work mutations auto-propagate, even
  // on a control node that never "joined". The single-predicate invariant
  // (acd-global-propagation-single-predicate) holds: this ONE function is still the sole
  // decision, and it still literally requires mesh?.enabled === true as one arm.
  if (mesh?.enabled === true || mesh?.repo?.published === true) return { enabled: true };

  const hasMeshHints = mesh != null && Object.keys(mesh).some((key) => key !== "enabled");
  return {
    enabled: false,
    code: MESH_GLOBAL_DISABLED_CODE,
    guidance: hasMeshHints
      ? "Global work propagation is disabled until config.mesh.enabled is true."
      : null,
  };
}

export async function publishGlobalWorkSnapshot(workspace, ctx = {}) {
  const decision = meshGlobalPropagationDecision(workspace);
  if (!decision.enabled) {
    return { published: false, skipped: true, code: decision.code, guidance: decision.guidance };
  }

  const storeOptions = ctx.globalWorkStoreOptions ?? {};
  const paths = storeOptions.paths ?? globalMeshPaths(storeOptions);

  try {
    if (typeof ctx.globalPublisher === "function") {
      const result = await ctx.globalPublisher(workspace, { paths, ctx });
      return { published: true, result };
    }

    const openStore = ctx.openGlobalWorkProjectionStore ?? openGlobalWorkProjectionStore;
    const store = await openStore({ ...storeOptions, paths });
    try {
      const result = await publishWorkspaceSnapshot(store, workspace, { now: ctx.now });
      const registry = await publishGlobalRegistryDescriptorsToStore(store, workspace, {
        now: ctx.now,
        fabricPeers: ctx.fabricPeers,
        ...(ctx.globalRegistryOptions ?? {}),
      });
      return { published: true, result: { ...result, registry } };
    } catch (error) {
      try {
        recordWorkspaceProjectionError(store, workspace, error, { now: ctx.now });
      } catch {
        // Recording the projection failure is best-effort; the caller gets the warning.
      }
      return { published: false, warning: propagationWarning(error, paths) };
    } finally {
      store.close?.();
    }
  } catch (error) {
    return { published: false, warning: propagationWarning(error, paths) };
  }
}

export async function withGlobalWorkPropagation(result, workspace, ctx = {}) {
  const propagation = await publishGlobalWorkSnapshot(workspace, ctx);
  if (!propagation.warning) return result;
  return appendPropagationWarning(result, propagation.warning);
}

export function appendPropagationWarning(result, warning) {
  if (result != null && typeof result === "object" && !Array.isArray(result)) {
    return {
      ...result,
      propagationWarnings: [...(Array.isArray(result.propagationWarnings) ? result.propagationWarnings : []), warning],
    };
  }
  return result;
}

export function renderPropagationWarnings(result) {
  const warnings = result?.propagationWarnings;
  if (!Array.isArray(warnings) || warnings.length === 0) return "";
  return warnings.map((warning) => {
    const pathPart = warning.path ? ` at ${warning.path}` : "";
    return `warning: global work propagation ${warning.code}${pathPart}: ${warning.message}`;
  }).join("\n");
}

export function renderWithPropagationWarnings(base, result) {
  const warningText = renderPropagationWarnings(result);
  return warningText ? `${base}\n${warningText}` : base;
}

function propagationWarning(error, paths) {
  return {
    code: error?.code ?? "global-work-propagation-failed",
    message: error?.message ?? "Global work propagation failed.",
    path: paths?.databasePath ?? null,
  };
}
