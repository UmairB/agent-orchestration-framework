// notion:associate — record (or clear) a milestone's Notion routing (board + parent)
// in the milestone's own committed `.integrations.json` descriptor (milestone 18 /
// story 00 — the AUTHORING SPINE; ADR-003/004/006).
//
//   input  { ref: string, board?: string, parent?: string }   // required: ["ref"]
//                                                              // board === "none" ⇒ clear the whole notion block
//                                                              // parent === "none" ⇒ clear only the parent
//   result AssociateResult { ref, board: string|null, parent: string|null, action: "set"|"unset"|"unchanged" }
//
// The routing is AUTHORED intent (ADR-006): the ONLY mutation `associate` makes is a
// single, idempotent write of the milestone's COMMITTED `.integrations.json` descriptor
// (via the routing module's writeRouting helper). It writes NEITHER the git-ignored
// `.aof/notion.work-map.json` sidecar NOR Notion — there is no spawn seam imported here
// and no Notion call. PURE / NO-READ (ADR-006): `--board <key>` must be a key in the
// committed `boards` registry (or the implicit `default` of a flat m17 config); a
// `--parent <key>` must resolve in the CHOSEN board's `parents` map. A page-id parent is
// shape-checked (ADR-001) and accepted verbatim. An unknown board/parent key is an
// HONEST command error naming the available keys — never a dangling write.
//
// CLI face: `aof work integrations notion associate <ref> --board <key> --parent <id|key|none> [--json]`
// (a verb on the `integrations notion` namespace; 17/ADR-002). Refs are not paths, so
// `json` returns the envelope verbatim — no relativise step.
import { commandError } from "../command-error.mjs";
// m43 / story 06 (ADR-005) — a STAGE-2 LEAF. Associating a milestone with a Notion parent
// is a DESCRIPTOR write, not a record-doc write, so a milestone another node authored is
// legitimately associable here: it resolves from the cache rather than dead-ending on
// ref-not-found the way it did while this read was the local disk alone.
import { listItemsCacheFirst } from "../work-read.mjs";
import { requireLocalCheckout } from "./resolve.mjs";
import {
  readRouting,
  writeRouting,
  hasRouting,
  isPageId,
  asBoardsRegistry,
  resolveMilestoneFolderByRef,
} from "../integrations/routing.mjs";

// The reserved sentinel that CLEARS (ADR-004): `--parent none` clears only the parent
// (keeps the board); `--board none` clears the whole notion routing block. A board /
// parent key is a slug; `none` is never a real key.
export const CLEAR_SENTINEL = "none";

// Format an available-key list for an honest error ("ops","growth"), or a clear
// "(none configured)" when the set is empty.
function formatKeys(keys) {
  return keys.length ? keys.map((k) => `"${k}"`).join(",") : "(none configured)";
}

export const notionAssociateCommand = {
  id: "notion:associate",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      board: { type: "string" },
      parent: { type: "string" },
    },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = input.ref;
    const board = input.board;
    const parent = input.parent;

    if (typeof ref !== "string" || ref.length === 0) {
      throw commandError(
        "Usage: aof work integrations notion associate <ref> --board <key> --parent <id|key|none>",
        "missing-ref",
        400
      );
    }

    const clearingBoard = board === CLEAR_SENTINEL;
    const clearingParent = parent === CLEAR_SENTINEL;

    // Reduce the committed config to the uniform { default, boards } view (ADR-002): a
    // boards registry as-is, a flat m17 block synthesised into the implicit default
    // board. Validation is PURELY against this committed config — no Notion read (ADR-006).
    const notionConfig = ctx?.workspace?.config?.work?.integrations?.notion;
    const { default: defaultKey, boards } = asBoardsRegistry(notionConfig);
    const availableBoards = Object.keys(boards);

    // VALIDATE --board against the committed registry (ADR-004). `none` is the reserved
    // clear sentinel and is exempt; an absent `--board` (only `--parent` given) falls to
    // the configured default board for the parent-scoping check below.
    let boardKey;
    if (clearingBoard) {
      boardKey = null;
    } else if (board != null) {
      if (!Object.prototype.hasOwnProperty.call(boards, board)) {
        throw commandError(
          `Unknown board key "${board}". Available boards: ${formatKeys(availableBoards)}.`,
          "unknown-board-key",
          400
        );
      }
      boardKey = board;
    } else {
      boardKey = defaultKey ?? null;
    }

    // VALIDATE --parent (ADR-001/004). A page-id is shape-checked and accepted verbatim;
    // a key must resolve in the CHOSEN board's `parents` map (scoped to that board, not
    // the default's). `none` clears; an absent `--parent` leaves the parent untouched.
    // When `--board none` clears the WHOLE block, `--parent` is moot — skip the check so
    // a valid key is not mis-rejected against the (now nonexistent) chosen board.
    if (!clearingBoard && !clearingParent && parent != null && parent.length > 0 && !isPageId(parent)) {
      const chosen = boardKey != null ? boards[boardKey] : undefined;
      const parents = (chosen && chosen.parents) || {};
      if (!Object.prototype.hasOwnProperty.call(parents, parent)) {
        const scope = boardKey != null ? `the "${boardKey}" board's` : "the chosen board's";
        throw commandError(
          `Unknown parent key "${parent}". ${scope} parent keys: ${formatKeys(Object.keys(parents))}.`,
          "unknown-parent-key",
          400
        );
      }
    }

    // Resolve the milestone via the SHARED listItems traversal (NO new traversal,
    // 17/ADR-002). Routing is associated on a TOP-LEVEL milestone only.
    const all = await listItemsCacheFirst(ctx.workspace, { globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {} });
    // Match the ref ANYWHERE (top-level or a story NN/SS) so a non-milestone ref gets
    // the specific not-a-milestone message rather than a bare ref-not-found.
    let item = all.find((entry) => entry.ref === String(ref));
    // Fallback: a GSD `NN-slug` milestone folder (not the aof `NN_milestone_slug`
    // form) is not in listItems; resolve it tolerantly so a GSD-managed repo's
    // milestones are associable without a rename ([[aof-import-milestone-naming]]).
    if (!item) item = resolveMilestoneFolderByRef(ctx.workspace.workDir, ref);
    if (!item) {
      throw commandError(`No item "${ref}" found in the work stream.`, "ref-not-found", 404);
    }
    if (item.type !== "milestone" || item.parent != null) {
      throw commandError(
        `"${ref}" is a ${item.type}; routing is associated on a top-level MILESTONE.`,
        "not-a-milestone",
        400
      );
    }

    // m43 / story 06 (ADR-010/R6.4) — the descriptor is a file INSIDE the milestone's own
    // folder, so a ref that resolves from the cache alone has nowhere here to hold it.
    // Refuse coded rather than scaffolding a folder for another node's milestone.
    requireLocalCheckout(item, ref);

    // Read the CURRENT descriptor (absent ⇒ {}). The associate verb's ONLY mutation is
    // the rewrite of this descriptor (ADR-004) — no sidecar, no Notion.
    const before = readRouting(item);
    const beforeNotion = before && typeof before.notion === "object" ? before.notion : {};

    // Compute the NEXT notion block from the flags:
    //   --board none           ⇒ clear the whole notion block (round-trips to defaults)
    //   --board K              ⇒ set board K (keep an existing parent unless --parent given)
    //   --parent none          ⇒ clear only the parent (keep the board)
    //   --parent P             ⇒ set parent P
    let nextNotion;
    if (clearingBoard) {
      nextNotion = undefined; // remove the whole notion routing block
    } else {
      nextNotion = { ...beforeNotion };
      if (board != null) nextNotion.board = boardKey;
      if (clearingParent) {
        delete nextNotion.parent;
      } else if (parent != null && parent.length > 0) {
        nextNotion.parent = parent;
      }
      // An empty notion block (no board, no parent) is no routing — drop it.
      if (nextNotion.board == null && nextNotion.parent == null) nextNotion = undefined;
    }

    // Assemble the NEXT descriptor: replace the `notion` block, preserving any unknown
    // peer provider blocks (FF-E: a future jira/linear block is additive, untouched).
    const next = { ...before };
    if (nextNotion === undefined) delete next.notion;
    else next.notion = nextNotion;

    // Idempotence (ADR-004): a write that changes nothing is reported `unchanged` and
    // makes NO disk write (the file is byte-for-byte unchanged; a clear of an
    // already-clear item creates no file). Compare the canonical serialisations of the
    // notion blocks.
    const unchanged = serialiseNotion(beforeNotion) === serialiseNotion(nextNotion ?? {});
    const reportBoard = nextNotion?.board ?? null;
    const reportParent = nextNotion?.parent ?? null;

    if (unchanged) {
      // A clear of an item that has no descriptor at all is still `unchanged` and writes
      // no file. (hasRouting distinguishes "no file" from "file with an empty notion".)
      return { ref: item.ref, board: reportBoard, parent: reportParent, action: "unchanged" };
    }

    writeRouting(item, next);

    // `unset` when the resulting notion block is gone or has no parent where one was
    // cleared; `set` otherwise. The action mirrors whether routing was reduced or written.
    const cleared = nextNotion === undefined || (clearingParent && beforeNotion.parent != null);
    return {
      ref: item.ref,
      board: reportBoard,
      parent: reportParent,
      action: cleared ? "unset" : "set",
    };
  },

  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs notionAssociateCli copy is deleted. The
    // usage refusal (missing ref, or neither --board nor --parent) moved into
    // the argv adapter — thrown BEFORE invoke, nothing written.
    route: ["work", "integrations", "notion", "associate"],
    spec: {
      usage: "aof work integrations notion associate <ref> --board <key|none> --parent <id|key|none> [--json]",
      flags: {
        board: { type: "string", description: "the board key to route through (or none)" },
        parent: { type: "string", description: "the Notion parent page id/key (or none)" },
      },
    },

    // `aof work integrations notion associate <ref> --board <key> --parent <id|key|none> [--json]`.
    argv: (positionals, options = {}) => {
      if (positionals[0] == null || (options.board == null && options.parent == null)) {
        throw commandError(
          "Usage: aof work integrations notion associate <ref> --board <key|none> --parent <id|key|none> [--json]",
          "usage",
          400,
        );
      }
      return {
        ref: positionals[0],
        board: options.board,
        parent: options.parent,
      };
    },

    // Human render: a one-line confirmation of what was written / cleared.
    render(result) {
      if (result.action === "unset") {
        return result.board
          ? `Cleared milestone ${result.ref} Notion parent (board ${result.board}).`
          : `Cleared milestone ${result.ref} Notion routing.`;
      }
      if (result.action === "unchanged") {
        return `Milestone ${result.ref} routing unchanged.`;
      }
      const parentNote = result.parent ? ` parent ${result.parent}` : "";
      return `Associated milestone ${result.ref} → board ${result.board}${parentNote}.`;
    },

    // --json face: the envelope verbatim (refs are not paths — no relativise step).
    json: (result) => result,
  },
};

// Canonical serialisation of a notion routing block for the idempotence compare — a
// stable key order so `{ board, parent }` and `{ parent, board }` compare equal.
function serialiseNotion(notion) {
  const board = notion?.board ?? null;
  const parent = notion?.parent ?? null;
  return JSON.stringify({ board, parent });
}
