// Shared fixture builder for the milestone 38 / story 04 fleet-face
// POST /api/mesh/assign suite (tasks 00-02) — the REAL serveMeshUi stood up on a
// loopback port over an isolated global-store seam (a temp AOF_GLOBAL_HOME v3
// projection), mirroring test/support/mesh-assign-fixture.mjs's CLI-verb fixture
// but wired through the HTTP face instead of calling assignWork directly.
//
// A resolvable work item "38/04" lives under a temp "38_milestone_demo"
// workspace (an isolated fixture, unrelated to the REAL milestone 38 folder in
// this repo's own wiki/work — the same convention the existing "35_milestone_
// demo" mesh-assign fixture already uses for milestone 35).
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveMeshUi, meshUiDist } from "../../src/mesh-ui-serve.mjs";
import { workspaceIdFor, openGlobalWorkProjectionStore } from "../../src/global-work-store.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "../../src/global-node-registry.mjs";
import { publishNodeRecord } from "../../src/mesh-store.mjs";

export {
  seedTargetNode,
  seedAssignment,
  readAssignmentRows,
} from "./mesh-assign-fixture.mjs";

async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/assets/index-abc123.js\"></script></head><body><div id=\"root\"></div></body></html>\n",
    "utf8",
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
}

async function writeWorkItem(root) {
  const workDir = path.join(root, "wiki", "work");
  const milestoneDir = path.join(workDir, "38_milestone_demo");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 38\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n",
    "utf8",
  );
  const storyDir = path.join(milestoneDir, "stories", "04_story_ui-driven-assignment");
  await mkdir(storyDir, { recursive: true });
  await writeFile(
    path.join(storyDir, "STORY.md"),
    "---\ntype: story\nnumber: 04\nslug: ui-driven-assignment\nparent: 38\nstatus: not-started\ntitle: UI Driven Assignment\n---\n",
    "utf8",
  );
}

// withAssignRouteFixture(fn, opts) — stands up the REAL fleet face over an
// isolated AOF_GLOBAL_HOME v3 store + a resolvable "38/04" work item. Yields
// { server, url, home, root, workspaceId, globalStoreOptions }; `fn` gets the
// live server, torn down (+ every temp dir removed) once `fn` settles either way.
export async function withAssignRouteFixture(fn, { scope = "global" } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-assign-route-"));
  const home = path.join(tmp, "home");
  const root = path.join(tmp, "repo");
  const distRoot = path.join(tmp, "dist");
  try {
    await writeWorkItem(root);
    await mkdir(path.join(root, ".aof"), { recursive: true });
    await writeFile(
      path.join(root, ".aof", "aof.config.json"),
      `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" }, mesh: { nodeId: "control-a" } }, null, 2)}\n`,
      "utf8",
    );
    await writeDist(meshUiDist(distRoot));

    const globalStoreOptions = { env: { AOF_GLOBAL_HOME: home } };
    const workspaceId = workspaceIdFor(root);
    const { server, url } = await serveMeshUi({ projectDir: root, port: 0, repoRoot: distRoot, scope, globalStoreOptions });
    try {
      return await fn({ server, url, home, root, distRoot, workspaceId, globalStoreOptions });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// withPublishedAssignFixture(fn, { nodes }) — task 03's fixture: a REAL end-to-end
// publish (workspace snapshot + node registry), so a node seeded here is VISIBLE
// through the REAL GET /api/mesh/status registry read (unlike seedTargetNode's
// direct-SQL rows above, which the assignWork VERB's own gates read directly but
// which carry no real registry descriptor file — queryGlobalRegistry silently
// drops a `global_nodes` row whose descriptor file does not resolve). Publishing
// this way ALSO satisfies assignWork's own repo-availability gate (membership +
// `workspaces.last_published_at`) for free — a seeded node here is both VISIBLE
// on the read side and ELIGIBLE on the write side, no seedTargetNode needed.
// `nodes` is a list of nodeIds to publish local node records for before the
// registry snapshot runs; an empty/absent list publishes the workspace with a
// bare (node-less) registry snapshot — the empty-roster case.
export async function withPublishedAssignFixture(fn, { nodes = [], scope = "global" } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-assign-published-"));
  const home = path.join(tmp, "home");
  const root = path.join(tmp, "repo");
  const distRoot = path.join(tmp, "dist");
  try {
    await writeWorkItem(root);
    await mkdir(path.join(root, ".aof"), { recursive: true });
    await writeFile(
      path.join(root, ".aof", "aof.config.json"),
      `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" }, mesh: { nodeId: "control-a" } }, null, 2)}\n`,
      "utf8",
    );
    await writeDist(meshUiDist(distRoot));

    const globalStoreOptions = { env: { AOF_GLOBAL_HOME: home } };
    const workspace = await loadWorkspace(root, undefined, globalStoreOptions);
    for (const nodeId of nodes) {
      await publishNodeRecord(workspace, nodeId, {
        nodeId,
        host: nodeId,
        os: "linux",
        runtimes: [],
        skills: [],
        aofVersion: "0.1.0",
        publishedAt: "2026-07-18T09:00:00.000Z",
      });
    }

    let workspaceId;
    const store = await openGlobalWorkProjectionStore(globalStoreOptions);
    try {
      const published = await store.publishWorkspaceSnapshot(workspace, { now: "2026-07-18T09:05:00.000Z" });
      workspaceId = published.workspaceId;
      await publishGlobalRegistryDescriptorsToStore(store, workspace, { now: "2026-07-18T09:05:00.000Z" });
    } finally {
      store.close();
    }

    const { server, url } = await serveMeshUi({ projectDir: root, port: 0, repoRoot: distRoot, scope, globalStoreOptions });
    try {
      return await fn({ server, url, home, root, distRoot, workspaceId, globalStoreOptions });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// postAssign(url, opts) — the REAL same-origin JSON POST helper. `origin: "SAME"`
// resolves to this server's OWN origin (the exact string a same-origin browser
// fetch sends); any other string rides through verbatim (a cross-origin probe);
// `origin: undefined` (the default) sends NO Origin header at all (the bare/
// no-origin case). `rawBody`, when supplied, overrides the JSON-encoded
// { ref, nodeId } body entirely (a malformed/non-JSON-body probe).
export async function postAssign(url, { ref, nodeId, origin, contentType = "application/json", rawBody } = {}) {
  const headers = {};
  if (origin !== undefined) headers.origin = origin === "SAME" ? new URL(url).origin : origin;
  if (contentType !== undefined) headers["content-type"] = contentType;
  const body = rawBody !== undefined ? rawBody : JSON.stringify({ ref, nodeId });
  return fetch(new URL("/api/mesh/assign", url), { method: "POST", headers, body });
}

// sameOriginAssign(url, ref, nodeId) — the convenience happy-path caller: a
// same-origin, application/json POST carrying exactly { ref, nodeId }.
export function sameOriginAssign(url, ref, nodeId) {
  return postAssign(url, { ref, nodeId, origin: "SAME", contentType: "application/json" });
}
