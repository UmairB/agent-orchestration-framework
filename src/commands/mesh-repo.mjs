// `aof mesh repo publish` — the explicit "publish THIS repo into the mesh" verb
// (milestone 34 / story 06, ADR-010). Until this landed, a repo only appeared in the
// machine-wide global store as a SIDE EFFECT of a work-mutating command (run
// start/complete, feedback) or the launcher's converge tick — there was no operator
// verb to say "make this repo visible in the mesh now". This module is that verb's
// core, kept out of cli.mjs so it is unit-testable without spawning the CLI.
//
// It does two things, in order:
//   (1) writes a per-repo PUBLISHED MARKER into the LOCAL .aof/aof.config.json
//       (`mesh.repo = { published, publishedAt, workspaceId, cloneUrl? }`) via a
//       read-merge-write that preserves every other key — the durable record that this
//       repo is a mesh repo (and, via ADR-010's gate extension in
//       global-work-publisher.mjs, the signal that its FUTURE work mutations auto-
//       propagate). The marker is written to the LOCAL on-disk config, never the
//       global-merged in-memory view, so the global mesh subtree (enabled/relay/
//       credential) is not copied down into the repo.
//   (2) publishes a snapshot NOW through the ONE publisher seam
//       (global-work-publisher.mjs's publishGlobalWorkSnapshot — the acd-global-
//       publisher-single-seam boundary), with the marker applied in-memory so the
//       propagation gate treats this repo as mesh-enabled for the immediate publish.
//
// Milestone 38 addition (`2026-07-16`, at the operator's direction — "check if it
// exists first, then add it if it doesn't", rejecting a separate `set-clone-url`
// verb as needless ceremony): if `mesh.repo.cloneUrl` is NOT already configured, this
// verb derives it from the repo's own `git remote get-url origin` and folds it into
// the SAME marker write — no manual JSON edit, no second command. An ALREADY-configured
// `cloneUrl` is never overwritten (git remote is only ever a fallback, never a source
// of truth once a value is committed). Detection failure (not a git repo, no `origin`
// remote, a malformed URL) is silent and non-fatal — the publish still succeeds with no
// `cloneUrl`, exactly today's behaviour when nobody configures one; a later clone-miss
// still fails loud and coded (`assignment-repo-unavailable`), per ADR-005.
import { publishGlobalWorkSnapshot } from "../global-work-publisher.mjs";
import { resolveWorkspaceId } from "../workspace-identity.mjs";
import { isPlainObject, writeRepoPublishedMarker } from "../mesh-repo-marker.mjs";
import { MESH_WORKSPACE_FLAG, guardMeshPositionals } from "./mesh-face-shared.mjs";

// The marker WRITER (`writeRepoPublishedMarker` + its git-remote detection and the
// clone-URL shape rule) moved to mesh-repo-marker.mjs (m42 wave (d) leg d1) — the
// worker's checkout path writes the same marker, and reaching UP into this command
// module for it was the tree's one confirmed import cycle. This file keeps the
// VERB: marker + immediate snapshot, and its face.

// Overlay the published marker onto a loaded workspace's IN-MEMORY config so the
// immediate publishGlobalWorkSnapshot sees mesh.repo.published === true (the ADR-010
// gate arm) without a second loadWorkspace. Never mutates the argument.
function withRepoMarker(ws, { workspaceId, now, cloneUrl }) {
  const mesh = isPlainObject(ws.config?.mesh) ? ws.config.mesh : {};
  const repo = isPlainObject(mesh.repo) ? mesh.repo : {};
  return {
    ...ws,
    config: {
      ...ws.config,
      mesh: {
        ...mesh,
        repo: {
          ...repo,
          ...(cloneUrl != null ? { cloneUrl } : {}),
          published: true,
          publishedAt: now,
          workspaceId,
        },
      },
    },
  };
}

// publishRepoToMesh(ws, ctx) — write the marker, then publish a snapshot now. `ctx`
// carries the publisher options (globalWorkStoreOptions for a hermetic AOF_GLOBAL_HOME
// in tests, now for a fixed clock, gitRemoteExec to inject a fake git-remote reader);
// production passes {} and the store resolves to ~/.aof/mesh. Returns a structured
// result for the CLI render/--json face.
export async function publishRepoToMesh(ws, ctx = {}) {
  const now = ctx.now ?? new Date().toISOString();
  const projectRoot = ws.projectRoot;
  const workspaceId = resolveWorkspaceId(ws);
  const configPath = ws.configPath;

  const { cloneUrl } = await writeRepoPublishedMarker({
    configPath,
    workspaceId,
    now,
    projectRoot,
    gitRemoteExec: ctx.gitRemoteExec,
  });

  const propagation = await publishGlobalWorkSnapshot(withRepoMarker(ws, { workspaceId, now, cloneUrl }), ctx);

  return {
    published: propagation.published === true,
    workspaceId,
    projectRoot,
    configPath,
    publishedAt: now,
    cloneUrl,
    warning: propagation.warning ?? null,
  };
}

// mesh:repo-publish — the registered Command over the core above (m42 wave (d)
// leg d1, wave-3 tail): `aof mesh repo publish` rides its THREE-WORD route
// through the route table + the ONE generic face (the four-word notion routes
// precedent); cli.mjs's meshRepoCommand face copy is deleted, leaving only the
// no-verb/unknown-verb shim the route table cannot express. A failed snapshot
// stays a non-fatal warning line (the marker still lands); only a real fault
// is a thrown, coded error the face envelopes.
export const meshRepoPublishCommand = {
  id: "mesh:repo-publish",
  input: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },

  async run(_input, ctx) {
    return await publishRepoToMesh(ctx.workspace, {});
  },

  cli: {
    route: ["mesh", "repo", "publish"],
    spec: {
      usage: "aof mesh repo publish [--workspace <path|id>] [--json]",
      flags: { ...MESH_WORKSPACE_FLAG },
    },

    argv: (positionals) => {
      guardMeshPositionals("repo publish", positionals);
      return {};
    },

    render(result) {
      const lines = [
        `Published ${result.projectRoot} into the mesh as workspace ${result.workspaceId}.`,
        `Marked as a mesh repo in ${result.configPath}.`,
      ];
      lines.push(
        result.cloneUrl
          ? `Clone URL: ${result.cloneUrl}`
          : "Clone URL: none configured and none detected from `git remote get-url origin` — a worker clone-miss for this workspace will fail loud (assignment-repo-unavailable) until one is set.",
      );
      if (!result.published && result.warning) {
        lines.push(`warning: the snapshot did not land (${result.warning.code}): ${result.warning.message}`);
      } else {
        lines.push("Snapshot written to the global mesh store.");
      }
      return lines.join("\n");
    },

    json: (result) => ({ ok: true, ...result }),
  },
};
