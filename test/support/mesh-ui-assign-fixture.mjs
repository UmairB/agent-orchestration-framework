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
import { updateAssignmentState } from "../../src/assignment-record.mjs";

export {
  seedTargetNode,
  seedAssignment,
  readAssignmentRows,
} from "./mesh-assign-fixture.mjs";

// countAllAssignmentRows({ home }) — the WHOLE table, unfiltered. A per-(workspace,
// ref) read can only prove "nothing landed where I looked"; F21 was precisely a
// mint landing somewhere nobody was looking, so a refusal lane asserts the total
// row count is unchanged as well.
export async function countAllAssignmentRows({ home }) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return store.db.prepare("SELECT COUNT(*) AS n FROM global_assignments").get().n;
  } finally {
    store.close();
  }
}

// advanceAssignmentState({ home }, assignmentId, state) — move a minted record
// along the m35 §4 ramp through its OWN sanctioned writer (assignment-record
// .mjs's `updateAssignmentState`, which validates the state against the frozen
// enum), never a raw UPDATE. Used to reproduce the soak's "sent, then failed
// 1.5s later" and prove the affordance never mirrors a lifecycle it no longer
// owns.
export async function advanceAssignmentState({ home }, assignmentId, state, options = {}) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return updateAssignmentState(store, assignmentId, state, options);
  } finally {
    store.close();
  }
}

// dropNodeFromRoster({ home }, nodeId) — make a published node LEAVE the picker
// while it stays ASSIGN-ELIGIBLE, by removing its registry DESCRIPTOR file at
// the exact path the real publisher recorded in `global_nodes.descriptor_path`
// (read back from the store — never a path this fixture rebuilds itself).
//
// This is the codebase's own documented asymmetry, not an invented one:
// `queryGlobalRegistry` (src/global-node-registry.mjs) silently SKIPS a
// `global_nodes` row whose descriptor does not resolve, so the node vanishes
// from GET /api/mesh/status.nodes — the roster the picker is fed — while
// `assignWork`'s node-known gate reads `global_nodes` DIRECTLY and still accepts
// it. That is what lets a long-lived monitor's picker change under a mounted
// row, and it is the producer for the QA-a regression (a row that NAMES one
// target and POSTs another).
export async function dropNodeFromRoster({ home }, nodeId) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    const row = store.db.prepare("SELECT descriptor_path FROM global_nodes WHERE node_id = ?").get(nodeId);
    if (!row?.descriptor_path) throw new Error(`dropNodeFromRoster: "${nodeId}" has no global_nodes descriptor_path to remove`);
    await rm(row.descriptor_path, { force: true });
    return row.descriptor_path;
  } finally {
    store.close();
  }
}

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

// ── the wire's workspaceId, per running fixture server ───────────────────────
//
// milestone 38 / story 04 — ADR-012 AMENDMENT (2026-07-24, BLOCKER F21): the
// assign wire is `{ ref, nodeId, workspaceId }`, all three REQUIRED. Every
// fixture below registers, against its server's origin, the workspaceId of the
// workspace IT stood up — so a caller can SAY "this fixture's own workspace"
// without knowing the id.
//
// REVIEW FIX F-C (architect, 2026-07-24) — it is a SENTINEL a test spells out,
// `workspaceId: "OWN"`, NEVER a default. The earlier default inverted the
// convention: `undefined` (the natural spelling of "don't send it") meant "send
// the right one" and `null` meant "omit", so a future author probing the
// anti-fallback case with the intuitive spelling would have got a PASSING
// assign. The correct idiom already shipped two arguments over (`origin:
// "SAME"`); `workspaceId` now reads the same way. Omission means omission.
const OWN_WORKSPACE = "OWN";
const workspaceIdByOrigin = new Map();

function rememberFixtureWorkspace(url, workspaceId) {
  workspaceIdByOrigin.set(new URL(url).origin, workspaceId);
}

function forgetFixtureWorkspace(url) {
  try { workspaceIdByOrigin.delete(new URL(url).origin); } catch { /* the server never listened */ }
}

// withAssignRouteFixture(fn, opts) — stands up the REAL fleet face over an
// isolated AOF_GLOBAL_HOME v3 store + a resolvable "38/04" work item. Yields
// { server, url, home, root, workspaceId, globalStoreOptions }; `fn` gets the
// live server, torn down (+ every temp dir removed) once `fn` settles either way.
//
// The workspace snapshot is PUBLISHED into the projection here (not left to a
// later seedTargetNode) because the ADR-012 AMENDMENT route resolves the posted
// workspaceId through `queryGlobalMeshStatus → status.workspaces[] →
// projectRoot`: a fixture whose `workspaces` row carries no real project_root
// would be refused `workspace-not-local` before the verb's own gates ever ran.
// A published row is also the honest shape — the fleet face can only render a
// card for a workspace the projection carries. (seedTargetNode's later
// ON CONFLICT only touches last_published_at, so a `published:false` seed still
// expresses "never published" exactly as before.)
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
    const workspace = await loadWorkspace(root, undefined, globalStoreOptions);
    const store = await openGlobalWorkProjectionStore(globalStoreOptions);
    try {
      await store.publishWorkspaceSnapshot(workspace, { now: "2026-07-18T09:05:00.000Z" });
    } finally {
      store.close();
    }

    const { server, url } = await serveMeshUi({ projectDir: root, port: 0, repoRoot: distRoot, scope, globalStoreOptions });
    rememberFixtureWorkspace(url, workspaceId);
    try {
      return await fn({ server, url, home, root, distRoot, workspaceId, globalStoreOptions });
    } finally {
      forgetFixtureWorkspace(url);
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
    rememberFixtureWorkspace(url, workspaceId);
    try {
      return await fn({ server, url, home, root, distRoot, workspaceId, globalStoreOptions });
    } finally {
      forgetFixtureWorkspace(url);
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// ── the TWO-workspace fleet face (milestone 38 / story 04 / task 05) ─────────
//
// BLOCKER F21's fixture. A single-workspace fixture STRUCTURALLY cannot express
// the failure: the server's own workspace is the only workspace there is, so the
// right answer and the wrong answer are the SAME value (STATE.md's F21 lesson —
// "producer-fed constrains the DATA, not the CONFIGURATION"). This fixture
// therefore stands the REAL fleet face on workspace A while workspace B — a
// DIFFERENT repo, on the same machine, in the SAME global projection — carries
// an item at the SAME ref, exactly as the live soak did (`ref 18` existed in
// both the control's `aof` repo and `let-shield-portal`). A mis-target therefore
// returns a plausible `200` and mints, instead of erroring.
//
// A third workspace (`gone`) is published and then DELETED from disk — the
// ordinary shape of a row another machine published into a synced projection.
async function writeCollidingRepo(root, { name, milestones }) {
  const workDir = path.join(root, "wiki", "work");
  for (const milestone of milestones) {
    const milestoneDir = path.join(workDir, `${milestone.number}_milestone_${milestone.slug}`);
    await mkdir(milestoneDir, { recursive: true });
    await writeFile(
      path.join(milestoneDir, "SPEC.md"),
      `---\ntype: milestone\nnumber: ${milestone.number}\nslug: ${milestone.slug}\nstatus: in-progress\ntitle: ${milestone.title}\n---\n`,
      "utf8",
    );
  }
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name, work: { dir: "./wiki/work" }, mesh: { nodeId: "control-a" } }, null, 2)}\n`,
    "utf8",
  );
}

// withTwoWorkspaceAssignFixture(fn) — the REAL serveMeshUi bound to workspace A
// (the DAEMON's own launch dir) with workspace B + a vanished workspace live in
// the SAME global projection the face reads. `worker-a` is published from BOTH A
// and B, so it is VISIBLE on the read side (GET /api/mesh/status.nodes — what the
// picker is fed) and ELIGIBLE on the write side for EITHER workspace: a
// mis-targeted assign is not caught incidentally by the repo gate, it succeeds.
//
// Yields { url, home, root, workspaceIdA, workspaceIdB, workspaceIdGone, titles }.
export async function withTwoWorkspaceAssignFixture(fn, { scope = "global" } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-assign-two-ws-"));
  const home = path.join(tmp, "home");
  const rootA = path.join(tmp, "control-repo");
  const rootB = path.join(tmp, "portal-repo");
  const rootGone = path.join(tmp, "vanished-repo");
  const rootRekeyed = path.join(tmp, "rekeyed-repo");
  const distRoot = path.join(tmp, "dist");
  const titles = {
    // The soak's REAL collision, kept verbatim so the regression reads as what
    // actually happened: ref 18 is a DIFFERENT milestone in each workspace.
    A: "Per-folder integration descriptor",
    B: "Homedata Live Property Data",
  };
  try {
    await writeCollidingRepo(rootA, {
      name: "control",
      milestones: [
        { number: 18, slug: "integration-descriptor", title: titles.A },
        { number: 31, slug: "control-only", title: "Control Only" },
      ],
    });
    await writeCollidingRepo(rootB, {
      name: "portal",
      milestones: [
        { number: 18, slug: "homedata-live", title: titles.B },
        { number: 44, slug: "portal-only", title: "Portal Only" },
      ],
    });
    await writeCollidingRepo(rootGone, {
      name: "elsewhere",
      milestones: [{ number: 18, slug: "published-by-another-machine", title: "Published Elsewhere" }],
    });
    await writeCollidingRepo(rootRekeyed, {
      name: "rekeyed",
      milestones: [{ number: 18, slug: "re-keyed-checkout", title: "Re-keyed Checkout" }],
    });
    await writeDist(meshUiDist(distRoot));

    const globalStoreOptions = { env: { AOF_GLOBAL_HOME: home } };
    const workspaceA = await loadWorkspace(rootA, undefined, globalStoreOptions);
    const workspaceB = await loadWorkspace(rootB, undefined, globalStoreOptions);
    const workspaceGone = await loadWorkspace(rootGone, undefined, globalStoreOptions);
    const workspaceRekeyed = await loadWorkspace(rootRekeyed, undefined, globalStoreOptions);
    for (const workspace of [workspaceA, workspaceB]) {
      await publishNodeRecord(workspace, "worker-a", {
        nodeId: "worker-a",
        host: "worker-a",
        os: "linux",
        runtimes: [],
        skills: [],
        aofVersion: "0.1.0",
        publishedAt: "2026-07-24T09:00:00.000Z",
      });
    }

    const store = await openGlobalWorkProjectionStore(globalStoreOptions);
    try {
      for (const workspace of [workspaceA, workspaceB, workspaceGone, workspaceRekeyed]) {
        await store.publishWorkspaceSnapshot(workspace, { now: "2026-07-24T12:00:00.000Z" });
        await publishGlobalRegistryDescriptorsToStore(store, workspace, { now: "2026-07-24T12:00:00.000Z" });
      }
    } finally {
      store.close();
    }

    const workspaceIdA = workspaceIdFor(rootA);
    const workspaceIdB = workspaceIdFor(rootB);
    const workspaceIdGone = workspaceIdFor(rootGone);
    const workspaceIdRekeyed = workspaceIdFor(rootRekeyed);

    // The vanished workspace's projection row survives its checkout; the path
    // does not — `workspace-not-local`'s producer, never a hand-built row.
    await rm(rootGone, { recursive: true, force: true });

    // The RE-KEYED checkout: its projection row still carries the path-derived
    // id it was published under, but the checkout now declares an explicit
    // `mesh.workspaceId` override. Resolution succeeds and the path exists — yet
    // the workspace object assignWork would be handed identifies itself as
    // something ELSE, so the mint would stamp a DIFFERENT id than the operator
    // clicked. That is F21's exact shape one level down, and it is what the
    // pre-mint identity assertion (inv.6) exists to make impossible. Produced by
    // re-writing the real config after the real publish — never a hand-built row.
    const rekeyedAs = "ffffffffffffffff";
    await writeFile(
      path.join(rootRekeyed, ".aof", "aof.config.json"),
      `${JSON.stringify({ name: "rekeyed", work: { dir: "./wiki/work" }, mesh: { nodeId: "control-a", workspaceId: rekeyedAs } }, null, 2)}\n`,
      "utf8",
    );

    const { server, url } = await serveMeshUi({ projectDir: rootA, port: 0, repoRoot: distRoot, scope, globalStoreOptions });
    // The DEFAULT for this fixture is deliberately the DAEMON's own workspace A:
    // a caller that forgets to name a workspace gets exactly the value F21 used
    // to assume, so a test that means "assign B's card" must SAY so.
    rememberFixtureWorkspace(url, workspaceIdA);
    try {
      return await fn({
        server, url, home, distRoot, globalStoreOptions, titles,
        rootA, rootB, rootGone, rootRekeyed,
        workspaceIdA, workspaceIdB, workspaceIdGone, workspaceIdRekeyed, rekeyedAs,
      });
    } finally {
      forgetFixtureWorkspace(url);
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
// { ref, nodeId, workspaceId } body entirely (a malformed/non-JSON-body probe).
//
// `workspaceId` (ADR-012 AMENDMENT — the REQUIRED third wire field; REVIEW FIX
// F-C — a sentinel, never a default):
//   - "OWN"    ⇒ this fixture server's OWN workspace id (the value a real card
//                carries for an item that belongs to it) — the caller SAYS it,
//                exactly as `origin: "SAME"` is said;
//   - a string ⇒ ridden verbatim, including "" (the blank-field probe);
//   - omitted / null ⇒ the field is left OFF the body entirely (the stale-client
//                / anti-fallback probe — it must be a coded 400, never a silent
//                fallback to the daemon's own workspace).
export async function postAssign(url, { ref, nodeId, workspaceId, origin, contentType = "application/json", rawBody } = {}) {
  const headers = {};
  if (origin !== undefined) headers.origin = origin === "SAME" ? new URL(url).origin : origin;
  if (contentType !== undefined) headers["content-type"] = contentType;
  const resolvedWorkspaceId = workspaceId === OWN_WORKSPACE
    ? workspaceIdByOrigin.get(new URL(url).origin)
    : workspaceId;
  if (workspaceId === OWN_WORKSPACE && resolvedWorkspaceId == null) {
    throw new Error(`postAssign: no fixture workspace is registered for ${url} — "OWN" cannot resolve`);
  }
  const payload = { ref, nodeId };
  if (resolvedWorkspaceId != null) payload.workspaceId = resolvedWorkspaceId;
  const body = rawBody !== undefined ? rawBody : JSON.stringify(payload);
  return fetch(new URL("/api/mesh/assign", url), { method: "POST", headers, body });
}

// sameOriginAssign(url, ref, nodeId, workspaceId) — the convenience happy-path
// caller: a same-origin, application/json POST carrying { ref, nodeId,
// workspaceId }. `workspaceId` is spelled out at every call site — "OWN" for
// this fixture's own workspace, or a real id (F-C: the fixture's own workspace
// is something a test SAYS, not something an omitted field means).
export function sameOriginAssign(url, ref, nodeId, workspaceId) {
  return postAssign(url, { ref, nodeId, workspaceId, origin: "SAME", contentType: "application/json" });
}
