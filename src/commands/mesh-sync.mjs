// mesh:sync — the one-shot git-sync transport command (milestone 22 / story 02 /
// ADR-004). Thin over story 02's src/mesh-sync.mjs `syncMesh` (the payload-agnostic
// git transport), carrying the frozen { id, input, run, cli } contract (08/ADR-002).
//
// A node is "just another thin face": MOVING records over git is a command-core
// capability, not a parallel subsystem. This is the ONE-SHOT testable transport unit;
// the background loop (src/mesh-sync.mjs startSyncLoop) is a thin TIMER over THIS
// command and holds no git logic.
//
//   mesh:sync — stage + commit this node's published records under the partition
//               root, pull peers' (add-only by ADR-002's partitioning), push. No
//               staged mesh changes ⇒ a clean no-op (no empty commit, HEAD unmoved).
//               PAYLOAD-AGNOSTIC: it moves FILES, never parsing or re-authoring
//               record content; it imports NO node-record schema.
//
// The --json shape is the stable sync-result envelope syncMesh returns:
//   { committed: bool, pushed: string[], pulled: string[], noop: bool, reason?: string }
import { syncMesh } from "../mesh-sync.mjs";

export const meshSyncCommand = {
  id: "mesh:sync",
  input: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },

  async run(_input, ctx) {
    // Thin over the one-shot transport. syncMesh resolves the repo root + the
    // partition root itself; the command adds no git logic of its own.
    return await syncMesh(ctx.workspace);
  },

  cli: {
    // `aof mesh sync` — no args; a stray positional is rejected by the face.
    argv: () => ({}),

    // A human one-liner over the sync-result envelope: what committed+pushed / pulled,
    // or an explicit nothing-to-sync line for the no-op.
    render(result) {
      if (result.noop) {
        return result.reason === "no-git-repo"
          ? "Nothing to sync (no git repo)."
          : "Nothing to sync.";
      }
      const pushedN = result.pushed.length;
      const pulledN = result.pulled.length;
      const committedPart = result.committed ? `committed + pushed ${pushedN}` : "nothing committed";
      return `${committedPart}, pulled ${pulledN}.`;
    },

    // The stable sync-result envelope passes through unchanged.
    json: (result) => result,
  },
};
