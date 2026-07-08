// `aof mesh repo publish` — the explicit "publish THIS repo into the mesh" verb
// (milestone 34 / story 06, ADR-010). Until this landed, a repo only appeared in the
// machine-wide global store as a SIDE EFFECT of a work-mutating command (run
// start/complete, feedback) or the launcher's converge tick — there was no operator
// verb to say "make this repo visible in the mesh now". This module is that verb's
// core, kept out of cli.mjs so it is unit-testable without spawning the CLI.
//
// It does two things, in order:
//   (1) writes a per-repo PUBLISHED MARKER into the LOCAL .aof/aof.config.json
//       (`mesh.repo = { published, publishedAt, workspaceId }`) via a read-merge-write
//       that preserves every other key — the durable record that this repo is a mesh
//       repo (and, via ADR-010's gate extension in global-work-publisher.mjs, the signal
//       that its FUTURE work mutations auto-propagate). The marker is written to the
//       LOCAL on-disk config, never the global-merged in-memory view, so the global
//       mesh subtree (enabled/relay/credential) is not copied down into the repo.
//   (2) publishes a snapshot NOW through the ONE publisher seam
//       (global-work-publisher.mjs's publishGlobalWorkSnapshot — the acd-global-
//       publisher-single-seam boundary), with the marker applied in-memory so the
//       propagation gate treats this repo as mesh-enabled for the immediate publish.
//
// A failed snapshot write is non-fatal (ADR-004): the marker is still written and the
// caller gets a warning — canonical local work records already succeeded.
import { readJson, writeText } from "../fs.mjs";
import { publishGlobalWorkSnapshot, workspaceIdFor } from "../global-work-publisher.mjs";

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

// Read-merge-write the local per-repo published marker. Only mesh.repo is set; every
// other key — mesh.nodeId/salt/relay, the non-mesh top level — survives byte-equivalent
// (the mesh-join.mjs writeGlobalMeshConfig precedent, aimed at the LOCAL config path).
export async function writeRepoPublishedMarker({ configPath, workspaceId, now }) {
  let onDisk = {};
  try {
    onDisk = await readJson(configPath);
  } catch {
    onDisk = {};
  }
  if (!isPlainObject(onDisk)) onDisk = {};

  const existingMesh = isPlainObject(onDisk.mesh) ? onDisk.mesh : {};
  const existingRepo = isPlainObject(existingMesh.repo) ? existingMesh.repo : {};
  onDisk.mesh = {
    ...existingMesh,
    repo: { ...existingRepo, published: true, publishedAt: now, workspaceId },
  };
  await writeText(configPath, `${JSON.stringify(onDisk, null, 2)}\n`);
  return configPath;
}

// Overlay the published marker onto a loaded workspace's IN-MEMORY config so the
// immediate publishGlobalWorkSnapshot sees mesh.repo.published === true (the ADR-010
// gate arm) without a second loadWorkspace. Never mutates the argument.
function withRepoMarker(ws, { workspaceId, now }) {
  const mesh = isPlainObject(ws.config?.mesh) ? ws.config.mesh : {};
  const repo = isPlainObject(mesh.repo) ? mesh.repo : {};
  return {
    ...ws,
    config: {
      ...ws.config,
      mesh: { ...mesh, repo: { ...repo, published: true, publishedAt: now, workspaceId } },
    },
  };
}

// publishRepoToMesh(ws, ctx) — write the marker, then publish a snapshot now. `ctx`
// carries the publisher options (globalWorkStoreOptions for a hermetic AOF_GLOBAL_HOME
// in tests, now for a fixed clock); production passes {} and the store resolves to
// ~/.aof/mesh. Returns a structured result for the CLI render/--json face.
export async function publishRepoToMesh(ws, ctx = {}) {
  const now = ctx.now ?? new Date().toISOString();
  const projectRoot = ws.projectRoot;
  const workspaceId = ws.config?.mesh?.workspaceId ?? workspaceIdFor(projectRoot);
  const configPath = ws.configPath;

  await writeRepoPublishedMarker({ configPath, workspaceId, now });

  const propagation = await publishGlobalWorkSnapshot(withRepoMarker(ws, { workspaceId, now }), ctx);

  return {
    published: propagation.published === true,
    workspaceId,
    projectRoot,
    configPath,
    publishedAt: now,
    warning: propagation.warning ?? null,
  };
}
