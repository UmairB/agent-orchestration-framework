import path from "node:path";
import { existsSync } from "node:fs";
import { globalMeshPaths } from "./workspace.mjs";
import {
  openGlobalWorkProjectionStore,
  publishWorkspaceSnapshot,
  recordWorkspaceProjectionError,
  workspaceIdFor,
  readWorkspaceProjectionItems,
} from "./global-work-store.mjs";
// m43 / ADR-012/B4 — the WORKER-side content read moved OUT of the single-writer store
// module into its own home when this story widened it to the artifact manifest. Same
// function, same shapes; imported from where it now lives.
import { readWorkspaceContentRecords } from "./work-content-read.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "./global-node-registry.mjs";
// m43 / ADR-003 + ADR-011/A1 — the ONE derivation of "which execution scopes are held",
// read on the DISK-DERIVED publish path (this module) and handed to the row writer as
// data. assignment-record.mjs imports 0, so there is no cycle back through this seam.
import { activeScopeHolders } from "./assignment-record.mjs";
import { resolveWorkspaceId } from "./workspace-identity.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

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
export const MESH_WORKSPACE_UNCONFIGURED_CODE = "mesh-workspace-unconfigured";

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
  if (mesh?.enabled === true || mesh?.repo?.published === true) {
    // …but a DIRECTORY is not a workspace just because a daemon was launched from it
    // (measured 2026-07-26: Task Scheduler's default cwd published C:\WINDOWS\system32
    // — and an installer-dir launch published ~/.aof/bin — as fleet "workspaces": the
    // machine-wide mesh.enabled merges into ANY cwd, so the enable arm alone cannot
    // gate). When the caller supplies a real workspace (it has a projectRoot),
    // propagation additionally requires the workspace's OWN config on disk — the
    // committed .aof/aof.config.json (or the legacy root aof.config.json). A pure
    // config-shaped argument (no projectRoot to check) keeps the enable-arm behaviour.
    const projectRoot = typeof workspaceOrConfig?.projectRoot === "string" ? workspaceOrConfig.projectRoot : null;
    if (projectRoot != null && projectRoot.length > 0) {
      const hasOwnConfig = existsSync(path.join(projectRoot, ".aof", "aof.config.json"))
        || existsSync(path.join(projectRoot, "aof.config.json"));
      if (!hasOwnConfig) {
        return {
          enabled: false,
          code: MESH_WORKSPACE_UNCONFIGURED_CODE,
          guidance: `Not publishing ${projectRoot}: it has no aof config — a launch directory is not a workspace.`,
        };
      }
    }
    return { enabled: true };
  }

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
      // THE HELD-SCOPE READ LIVES HERE (m43 / ADR-011/A1, and it REPLACES 43/01's
      // interim carry rather than extending it).
      //
      // `publishWorkspaceSnapshot` is not the tick — it is the shared row-writer, whose
      // other callers are the WORKER's two frame doors. A lock filter placed inside it
      // fires for the worker's own frames, which was measured to discard the holder's
      // authored delta (its completion frame included) for a whole phase. THIS function
      // is the tick: the one path that reads the calling node's OWN local disk slice
      // (the control's periodic publish and publish-on-mutate), and the only one
      // entitled to step over execution scopes an active assignment holds. So it reads
      // the lock and hands the answer DOWN as data; a frame door reads its own and hands
      // down its own. The store module queries the assignment table for nobody.
      //
      // 43/01's read-carry-reinsert dance is gone with the rebuild that forced it: a row
      // upsert simply does not write a held ref, so there is nothing to carry back over.
      const workspaceId = resolveWorkspaceId(workspace);
      const result = await publishWorkspaceSnapshot(store, workspace, {
        now: ctx.now,
        heldScopes: activeScopeHolders(store, workspaceId),
        // The OPERATOR door (ADR-010/D1): the refs a control-side verb just mutated take
        // authorship, because a gate is where authorship legitimately changes hands. It
        // is a REF SET, not a flag on the whole publish — publish-on-mutate carries every
        // row in the workspace, and the operator touched one item, not all of them.
        operatorRefs: ctx.operatorRefs,
      });
      const registry = await publishGlobalRegistryDescriptorsToStore(store, workspace, {
        now: ctx.now,
        fabricPeers: ctx.fabricPeers,
        ...(ctx.globalRegistryOptions ?? {}),
      });
      return { published: true, result: { ...result, registry } };
    } catch (error) {
      try {
        recordWorkspaceProjectionError(store, workspace, error, { now: ctx.now });
      } catch (error) {
        // Recording the projection failure is best-effort; the caller gets the warning.
      reportDegrade("global-work-publisher", error); }
      return { published: false, warning: propagationWarning(error, paths) };
    } finally {
      store.close?.();
    }
  } catch (error) {
    return { published: false, warning: propagationWarning(error, paths) };
  }
}

// threadPropagationWarnings(result, effects) — the ONE home for putting the
// publish reactor's warning back on a command result (m42 wave (d) leg d4, port
// 1, replacing `withGlobalWorkPropagation`).
//
// THE DECISION THIS ENCODES. Publish-on-mutate is now a `local`-locus reactor, so
// its warning arrives in the effects OUTCOMES rather than from a wrapper around
// the command's own return value. The face threads it back — deliberately —
// rather than letting the two ported verbs' `--json` change shape: the
// `propagationWarnings` key is the established contract of `work:run-start` /
// `work:feedback` / `work:run-complete`, and a warning about THIS command's own
// consequence belongs on its result. The threading is a shared function, not a
// re-remembered `.find()` at each call site, because that copy-per-caller is the
// very disease the port cures.
export function threadPropagationWarnings(result, effects = []) {
  let threaded = result;
  for (const outcome of effects) {
    if (outcome?.key !== "publish-projection") continue;
    const warning = outcome.detail?.warning;
    if (warning) threaded = appendPropagationWarning(threaded, warning);
  }
  return threaded;
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
