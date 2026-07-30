// `aof mesh recover-push <assignmentId>` — the CONTROL-DRIVEN recovery push (VERIFICATION,
// live two-machine soak 2026-07-25). Run on the CONTROL node to rescue a stalled/terminal
// assignment whose worker output never reached origin (the worker parked at an idle prompt
// so its `done` push seam never fired, or the assignment was reclaimed with its diff
// stranded UNCOMMITTED in the worktree). A CLI-only nested verb (a sibling of `mesh assign`
// / `mesh repo publish`), kept out of cli.mjs so it is unit-testable without spawning the
// CLI (the mesh-assign.mjs precedent).
//
// It does NOT reach the worker itself (the CLI process holds no fabric socket — only the
// always-on control daemon does). Like every other dispatch in this system it is
// STORE-FIRST: this writes a `requested` row (mesh-recovery-push.mjs) that the daemon's
// control tick drains — minting a one-shot write credential and dispatching a recovery-push
// DOWN-frame to the assignment's target worker (resolved from the assignment record's OWN
// target_node_id, so the operator names only the assignmentId). The worker commits + pushes
// its worktree and reports back; this then polls the row to a terminal state and prints
// pushed / failed. The write credential is NEVER persisted — it rides the fabric one-shot;
// the store only ever holds the request + its status.
import { openGlobalWorkProjectionStore } from "../global-work-store.mjs";
import { globalMeshPaths } from "../workspace.mjs";
import {
  requestRecoveryPush,
  readRecoveryPush,
  RECOVERY_PUSH_PUSHED,
  RECOVERY_PUSH_FAILED,
} from "../mesh-recovery-push.mjs";
import { commandError } from "./errors.mjs";

const DEFAULT_POLL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 90000;

async function openStore(ctx) {
  const storeOptions = ctx.globalWorkStoreOptions ?? {};
  const paths = storeOptions.paths ?? globalMeshPaths(storeOptions);
  const openFn = ctx.openGlobalWorkProjectionStore ?? openGlobalWorkProjectionStore;
  return openFn({ ...storeOptions, paths });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// recoverPush(assignmentId, ctx) — the recover-push core. Resolves the assignment record
// (its OWN target_node_id/workspace_id/item_ref determine everything — the operator supplies
// only the assignmentId), writes the recovery request, and polls the row to a terminal
// state. Returns a structured result — never throws for an expected refusal (an unknown
// assignment is a coded { ok:false }); a genuine fault (the store failing to open) still
// throws.
//
//   ctx.now         — injected clock (ISO string / () => string) for the request stamp.
//   ctx.pollMs      — poll interval (default 1s); ctx.timeoutMs — overall wait (default 90s).
//   ctx.sleep       — injected delay (tests pass an instant resolver; production waits real).
export async function recoverPush(assignmentId, ctx = {}) {
  if (typeof assignmentId !== "string" || assignmentId.length === 0) {
    return { ok: false, code: "recovery-assignment-required", error: "An assignmentId is required." };
  }

  const store = await openStore(ctx);
  try {
    const assignment = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(assignmentId);
    if (!assignment) {
      return {
        ok: false,
        code: "recovery-unknown-assignment",
        error: `No assignment resolves for id "${assignmentId}" — it has never appeared in the global assignment record.`,
      };
    }

    const now = typeof ctx.now === "function" ? ctx.now() : (ctx.now ?? new Date().toISOString());
    requestRecoveryPush(store, {
      assignmentId,
      itemRef: assignment.item_ref,
      workspaceId: assignment.workspace_id,
      targetNodeId: assignment.target_node_id,
      now,
    });

    const pollMs = typeof ctx.pollMs === "number" && ctx.pollMs > 0 ? ctx.pollMs : DEFAULT_POLL_MS;
    const timeoutMs = typeof ctx.timeoutMs === "number" && ctx.timeoutMs >= 0 ? ctx.timeoutMs : DEFAULT_TIMEOUT_MS;
    const sleep = typeof ctx.sleep === "function" ? ctx.sleep : defaultSleep;

    let waited = 0;
    // Poll the row (the daemon on this same node, a separate process, flips it) until a
    // terminal state or the timeout. The FIRST read happens before any sleep, so a
    // ctx.timeoutMs of 0 still returns the current state once (the CLI never blocks a
    // fixture that has already settled the row).
    for (;;) {
      const row = readRecoveryPush(store, assignmentId);
      if (row?.state === RECOVERY_PUSH_PUSHED) {
        return { ok: true, code: "recovery-pushed", assignmentId, targetNodeId: assignment.target_node_id, itemRef: assignment.item_ref, detail: row.detail ?? null };
      }
      if (row?.state === RECOVERY_PUSH_FAILED) {
        return { ok: false, code: "recovery-push-failed", assignmentId, targetNodeId: assignment.target_node_id, itemRef: assignment.item_ref, detail: row.detail ?? null };
      }
      if (waited >= timeoutMs) {
        return {
          ok: false,
          code: "recovery-pending",
          assignmentId,
          targetNodeId: assignment.target_node_id,
          itemRef: assignment.item_ref,
          state: row?.state ?? "requested",
          error: `Recovery push for "${assignmentId}" is still ${row?.state ?? "requested"} after ${Math.round(timeoutMs / 1000)}s — the worker may be offline. Re-run to retry once it reconnects.`,
        };
      }
      await sleep(pollMs);
      waited += pollMs;
    }
  } finally {
    store.close?.();
  }
}

// mesh:recover-push — the registered Command over the core above (m42 wave (d)
// leg d1, wave-3 tail): `aof mesh recover-push <assignmentId>` rides the route
// table + the ONE generic face; cli.mjs's meshRecoverPushCommand face copy is
// deleted. Two contracts carried over verbatim: the run RETURNS coded outcomes
// (ok:false included) rather than throwing, and the `--json` face prints that
// result VERBATIM at exit 0 — the retired face's shape, deliberately (a caller
// reads `ok`/`code` off the document). The non-json face turns ok:false into
// the coded stderr refusal (thrown from render — the read-miss idiom).
// `spec.workspace: false` — the verb is global-store oriented and runs from
// anywhere (the retired face never called loadWorkspace).
export const meshRecoverPushCommand = {
  id: "mesh:recover-push",
  input: {
    type: "object",
    properties: { assignmentId: { type: "string" } },
    required: ["assignmentId"],
    additionalProperties: false,
  },

  async run(input) {
    return await recoverPush(input.assignmentId, {});
  },

  cli: {
    route: ["mesh", "recover-push"],
    spec: {
      usage: "aof mesh recover-push <assignmentId> [--json]",
      workspace: false,
      flags: {},
    },

    // The refusal matrix the retired cli.mjs face owned, byte-identical text.
    argv: (positionals) => {
      const assignmentId = positionals[0];
      if (typeof assignmentId !== "string" || assignmentId.length === 0) {
        throw commandError(
          "`aof mesh recover-push` needs an assignmentId.\n\nUsage:\n  aof mesh recover-push <assignmentId>   commit + push a stalled assignment's stranded worktree home",
          "invalid-input",
          400,
        );
      }
      if (positionals.length > 1) {
        throw commandError(`"mesh recover-push" takes exactly one positional assignmentId (got "${positionals[1]}").`, "invalid-input", 400);
      }
      return { assignmentId };
    },

    render(result) {
      if (!result.ok) {
        throw commandError(
          result.error ?? `Recovery push ${result.code}${result.detail ? ` (${result.detail})` : ""}.`,
          result.code,
        );
      }
      return `Pushed "${result.itemRef}" home from "${result.targetNodeId}" (assignment ${result.assignmentId}${result.detail ? `, ${result.detail}` : ""}).`;
    },

    json: (result) => result,
  },
};
