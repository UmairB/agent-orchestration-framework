// work:resync — "ask the node that reported this cached row to push a fresh copy"
// (m43 / story 04, ADR-006 + ADR-010/R4.2).
//
// THE DOOR DESIGN SPECIFIES EXHAUSTIVELY AND NAMES NOWHERE. The board renders a Resync
// control on a stale item's provenance line; this is what it calls, and `aof work resync
// <ref>` is the same act from the CLI. It is the milestone's ONE sanctioned pull — every
// other flow here is a periodic push or a dispatch of WORK — and it is operator-initiated
// by construction, which is directive 4's "unless something is wrong" carve-out.
//
// IT REPORTS THE CALL, NEVER THE DATA. `ok: true` means the request reached the owning
// node; it does NOT mean a fresh copy has landed. Only a fresher `syncedAt` arriving on the
// list response proves that, which is why there is no success toast on the surface and no
// "refreshed" claim here. This is the m38 F22 rule ("it reports the CALL; region 5 reports
// the ASSIGNMENT") applied one milestone on.
//
// EVERY REFUSAL IS A RETURNED, CODED OUTCOME — never a throw. The offline owner is the
// LIKELY case (the row is stale precisely because its owner stopped reporting), so it is a
// designed state rather than an error path; a throw would make the honest answer look like
// a fault. Only a genuine infrastructure failure (the store refusing to open) still throws.
// This is `mesh:recover-push`'s contract verbatim, for the same reason.
import { commandError } from "../command-error.mjs";
import { openGlobalWorkProjectionStore, readWorkspaceItemProvenance } from "../global-work-store.mjs";
import { resolveWorkspaceId } from "../workspace-identity.mjs";
import { globalMeshPaths } from "../workspace.mjs";
// The cadence the CONTROL DAEMON'S DRAIN actually runs at — the same
// `mesh.sync.cadenceSeconds` resolver the launcher starts its tick from, so the bound below
// cannot drift from the mechanism it waits on (ADR-014/E5).
import { syncCadenceFromConfig } from "../mesh-sync-cadence.mjs";
import {
  requestResync,
  readResync,
  RESYNC_DISPATCHED,
  RESYNC_PUSHED,
  RESYNC_FAILED,
  RESYNC_OK,
  RESYNC_NO_OWNER,
  RESYNC_OWNER_NOT_CONNECTED,
  RESYNC_OWNER_UNREACHABLE,
  RESYNC_OWNER_IS_SELF,
  RESYNC_PENDING,
} from "../mesh-resync.mjs";

// THE REQUEST-LEG BOUND IS DERIVED FROM THE CADENCE IT WAITS ON, never pinned to a literal
// (ADR-014/E5). DESIGN asked for "no indefinite spinner … design default 10s for the request
// round trip", and 10s was written against an assumed-INSTANT dispatch. The mechanism that
// was actually built is TICK-DRAINED: the request is a store row that the control daemon's
// dispatch tick picks up on `mesh.sync.cadenceSeconds` (documented default 15s). A request
// arrives at a uniformly random point inside that tick, so a 10s bound reported "no answer"
// for roughly one healthy request in THREE while the dispatch landed seconds later — and on
// the CLI face that is a non-zero exit on a working system. A bound shorter than the cadence
// it waits on does not measure the world; it measures the clock.
//
// So: TWO cadences of headroom, floored at DESIGN's 10s. Two rather than one because one
// covers only the perfectly-aligned case — a request landing just after a tick waits nearly a
// full cadence before the first drain even looks at it, and the row must then be re-read by
// the poll below. It scales with the knob, so an operator who slows the tick to a minute gets
// a bound that still measures the world rather than a deadline they did not know they moved.
//
// The WATCH WINDOW for the pushed copy itself is the UI's (3 poll intervals) and is
// deliberately a different leg — a slow-but-successful push must not be swallowed by the
// request leg's deadline.
const MIN_REQUEST_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_CADENCES = 2;
const DEFAULT_POLL_MS = 200;

// resolveRequestTimeoutMs(workspace) — the derivation above, in one place. An explicit
// `ctx.timeoutMs` (tests, and any future face that owns its own deadline) still wins; this is
// what the door uses when nobody said otherwise.
function resolveRequestTimeoutMs(workspace) {
  return Math.max(MIN_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_CADENCES * syncCadenceFromConfig(workspace) * 1000);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openStore(ctx) {
  const storeOptions = ctx.globalWorkStoreOptions ?? {};
  const paths = storeOptions.paths ?? globalMeshPaths(storeOptions);
  const openFn = ctx.openGlobalWorkProjectionStore ?? openGlobalWorkProjectionStore;
  return openFn({ ...storeOptions, paths });
}

// outcome(...) — ONE builder for every answer, so each carries the same five facts and no
// face has to reconstruct any of them: the coded outcome, whether the CALL succeeded, the
// item, the owner it was aimed at, and a human message whose full text a surface can put in
// a `title`.
function outcome({ ok, code, ref, node = null, message }) {
  return { ok, code, ref, node, message };
}

export const resyncCommand = {
  id: "work:resync",
  input: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";
    if (ref === "") throw commandError("A work ref is required.", "missing-ref", 400);

    const workspaceId = resolveWorkspaceId(ctx.workspace, { override: ctx.workspaceId });
    if (workspaceId == null) {
      // No mesh identity at all: this workspace has no cache and therefore no owner. The
      // same answer as an unstamped row, and for the same reason.
      return outcome({
        ok: false,
        code: RESYNC_NO_OWNER,
        ref,
        message: "No owning node recorded — this workspace is not published into a mesh cache.",
      });
    }

    const store = await openStore(ctx);
    try {
      // WHO owns the row is the row's OWN recorded author (`work_items.node_id`), read
      // through the same accessor the read surface maps onto the wire as `reportedBy`. It
      // is never the assignment's target node and never a presence lookup: "ask whoever
      // reported this copy" is the only question a resync can honestly ask.
      const owner = readWorkspaceItemProvenance(store, workspaceId).get(ref)?.nodeId ?? null;
      if (owner == null) {
        // DESIGN's "refused" — the one DESTRUCTIVE outcome, because it is a fault we own
        // rather than a world that did not answer. A pre-v8 row and a row the cache has
        // never held both land here, and both are honestly described by the same sentence.
        return outcome({
          ok: false,
          code: RESYNC_NO_OWNER,
          ref,
          message: `No owning node recorded for "${ref}" — nothing has reported this row, so there is nobody to ask for a fresh copy.`,
        });
      }

      const localNodeId = ctx.workspace?.config?.mesh?.nodeId ?? null;
      if (localNodeId != null && owner === localNodeId) {
        // The row is this node's OWN publication, so NO node→node call is made — which is
        // why this is its own code and not one of the four call-outcome codes (ADR-014/E2).
        // The request is answered immediately rather than written and left to time out, and
        // the message names what actually refreshes the row: this node's own publish tick.
        // That is the honest diagnosis for the common case — a control-authored row goes
        // stale exactly when the control's publish stops, which is a LOCAL condition.
        // Reported MUTED, never destructive: nothing was rejected, nothing failed, and the
        // cached copy is intact — the tone rule DESIGN sets for this whole class.
        return outcome({
          ok: false,
          code: RESYNC_OWNER_IS_SELF,
          ref,
          node: owner,
          message: `"${ref}" was reported by ${owner}, which is this node — its own publish tick is what refreshes it, so there is no peer to ask. The cached copy is unchanged and still readable.`,
        });
      }

      const now = typeof ctx.now === "function" ? ctx.now() : (ctx.now ?? new Date().toISOString());
      requestResync(store, { workspaceId, itemRef: ref, targetNodeId: owner, now });

      // STORE-FIRST, exactly like every other dispatch here: this process holds no fabric
      // socket (only the always-on control daemon does), so the request is a row the
      // daemon's control tick drains. The poll below is bounded, and the FIRST read happens
      // before any sleep so an already-settled row answers without waiting.
      const pollMs = typeof ctx.pollMs === "number" && ctx.pollMs > 0 ? ctx.pollMs : DEFAULT_POLL_MS;
      const timeoutMs = typeof ctx.timeoutMs === "number" && ctx.timeoutMs >= 0 ? ctx.timeoutMs : resolveRequestTimeoutMs(ctx.workspace);
      const sleep = typeof ctx.sleep === "function" ? ctx.sleep : defaultSleep;

      let waited = 0;
      for (;;) {
        const row = readResync(store, workspaceId, ref);
        // `dispatched` IS the answer to the question this door asks — the request reached
        // the owner (DESIGN's "accepted"). `pushed` is the owner's own later confirmation
        // and is equally an accepted call; neither claims the DATA is fresh.
        if (row?.state === RESYNC_DISPATCHED || row?.state === RESYNC_PUSHED) {
          return outcome({
            ok: true,
            code: RESYNC_OK,
            ref,
            node: owner,
            message: `Asked ${owner} to push a fresh copy of "${ref}".`,
          });
        }
        if (row?.state === RESYNC_FAILED) {
          const code = row.detail === RESYNC_OWNER_UNREACHABLE ? RESYNC_OWNER_UNREACHABLE : RESYNC_OWNER_NOT_CONNECTED;
          return outcome({
            ok: false,
            code,
            ref,
            node: owner,
            message: code === RESYNC_OWNER_UNREACHABLE
              ? `Owner ${owner} unreachable — the request could not be delivered. The cached copy is unchanged and still readable.`
              : `Owner ${owner} is not connected — the request could not be delivered. The cached copy is unchanged and still readable.`,
          });
        }
        if (waited >= timeoutMs) {
          return outcome({
            ok: false,
            code: RESYNC_PENDING,
            ref,
            node: owner,
            message: `No answer for "${ref}" within ${Math.round(timeoutMs / 1000)}s — the request is still queued for ${owner}. The cached copy is unchanged and still readable.`,
          });
        }
        await sleep(pollMs);
        waited += pollMs;
      }
    } finally {
      store.close?.();
    }
  },

  cli: {
    route: ["work", "resync"],
    spec: {
      usage: "aof work resync <ref> [--json]",
      flags: {},
    },

    argv: (positionals) => {
      const ref = positionals[0];
      if (typeof ref !== "string" || ref.length === 0) {
        throw commandError(
          "`aof work resync` needs a ref.\n\nUsage:\n  aof work resync <ref>   ask the node that reported this cached row to push a fresh copy",
          "invalid-input",
          400,
        );
      }
      return { ref };
    },

    // The human face turns a coded refusal into a coded stderr message (the read-miss
    // idiom); `--json` prints the outcome document VERBATIM at exit 0, so a caller reads
    // `ok`/`code` off one parseable document whatever the answer was.
    render(result) {
      if (!result.ok) throw commandError(result.message, result.code);
      return result.message;
    },

    json: (result) => result,
  },
};
