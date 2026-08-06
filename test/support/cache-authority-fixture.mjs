// test/support/cache-authority-fixture.mjs — the shared fixture for milestone 43 /
// story 02 (the authority cut: work_items becomes a provenance-stamped, row-upserted
// FACT).
//
// It is `item-lock-fixture.mjs` (story 01's) reused verbatim for everything the two
// stories share — a hermetic AOF_GLOBAL_HOME, a real workspace carrying an ARBITRARY
// work stream, and the "Given an ACTIVE assignment held by <node>" seeds — plus the
// three things only this story needs:
//
//   (a) THE FRAME DOOR. A worker's snapshot/delta frame is refused unless the control
//       already holds a registered `global_workspace_descriptors` row for its
//       workspaceId, so a fixture that wants to stream anything must register one —
//       mirroring what a real `mesh:join` / `mesh repo publish` has already done.
//   (b) A SECOND WORKSPACE ("beta"), because retraction is workspace-scoped and two
//       workspaces can carry the same ref string.
//   (c) DISK EDITS. The control node's own stream has to move under the cache (an item
//       edited, deleted, its frontmatter broken, the whole stream removed), because the
//       disease this story cures is the control's disk republishing over live truth.
//
// Everything here drives the REAL doors: `publishGlobalWorkSnapshot` is the tick's own
// body (the launcher's capturePropagation calls exactly this), and `applyStreamFrame`
// is the control-stream server's own frame dispatch. Nothing pokes work_items directly
// except the provenance READ (`authorOf`), which reads the column this story writes and
// 43/04 will map onto the wire.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { publishGlobalWorkSnapshot } from "../../src/global-work-publisher.mjs";
import { readWorkspaceItems } from "../../src/global-work-store.mjs";
import { applyStreamFrame } from "../../src/control-stream-server.mjs";
import { withItemLockFixture, seedActive, settle, withStore, seedWorker, refuse } from "./item-lock-fixture.mjs";

export { withItemLockFixture, seedActive, settle, withStore, seedWorker, refuse };

export const CONTROL = "control-1";
export const WORKER_A = "worker-a";
export const WORKER_B = "worker-b";

// The stream the story's features describe: milestone "43" with stories 01, 02 and 03.
export const CACHE_STREAM = [{ number: "43", stories: ["01", "02", "03"] }];

// withCacheFixture(body, options) — the fixture with this story's node id pinned and the
// workspace descriptor already registered, so a frame door resolves it.
export async function withCacheFixture(body, { stream = CACHE_STREAM, nodeId = CONTROL } = {}) {
  return withItemLockFixture(async (fx) => {
    await registerDescriptor(fx, fx.workspaceId, fx.root, fx.workDir);
    return body(fx);
  }, { stream, nodeId });
}

// registerDescriptor(fx, workspaceId, projectRoot, workDir) — the ADR-010 registration
// gate every row frame is checked against.
export async function registerDescriptor(fx, workspaceId, projectRoot, workDir) {
  await withStore(fx, (store) => {
    store.db.prepare(`
      INSERT OR REPLACE INTO global_workspace_descriptors
        (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path)
      VALUES (?, ?, ?, ?, 1, ?, '[]', '2026-08-01T09:00:00.000Z', ?)
    `).run(workspaceId, projectRoot, workDir, workspaceId, CONTROL, `${projectRoot}/descriptor.json`);
  });
}

// ---------------------------------------------------------------- the two writers --

// tick(fx, options) — ONE beat of the control node's periodic publish. This is the
// tick's whole body: mesh-launcher's capturePropagation calls exactly this.
export async function tick(fx, { workspace = fx.workspace, ...options } = {}) {
  return publishGlobalWorkSnapshot(workspace, { ...fx.ctx, ...options });
}

// stream(fx, node, rows, options) — a worker frame arriving on `node`'s AUTHENTICATED
// connection. `options.selfReports` is the node id the frame CLAIMS to be, which is not
// necessarily the one its connection authenticated as (the impostor case).
// `now` is the SERVER-side clock the door is handed; passing `null` withholds it, so the
// frame's own `at` is the only candidate (the malformed-timestamp case).
export async function stream(fx, node, rows, { kind = "delta", at = "2026-08-02T10:00:00.000Z", now = at, selfReports, workspaceId } = {}) {
  return withStore(fx, (store) => applyStreamFrame(
    store,
    {
      kind,
      nodeId: selfReports === undefined ? node : selfReports,
      workspaceId: workspaceId ?? fx.workspaceId,
      items: rows,
      at,
    },
    { nodeId: node, ...(now == null ? {} : { now }) },
  ));
}

// itemRow(ref, fields) — a complete, storable frame row for `ref`.
export function itemRow(ref, fields = {}) {
  const story = ref.includes("/");
  return {
    ref,
    type: story ? "story" : "milestone",
    slug: story ? `s${ref.replace("/", "-")}` : `m${ref}`,
    status: "not-started",
    title: `Item ${ref}`,
    parent: story ? ref.split("/")[0] : null,
    sourcePath: `/repo/wiki/work/${ref}/DOC.md`,
    ...fields,
  };
}

// ------------------------------------------------------------------- the readouts --

// rows(fx, workspaceId) — the workspace's cached rows through the store's PUBLIC read
// surface, by ref. This is the same accessor `/api/mesh/status` renders as `items[]` and
// the board's mesh overlay reads.
export async function rows(fx, workspaceId = fx.workspaceId) {
  return withStore(fx, (store) => new Map(readWorkspaceItems(store, workspaceId).map((row) => [row.ref, row])));
}

// authorOf(fx, ref) — the node recorded as having reported a row (schema v8's `node_id`).
// The WIRE rendering of this column (`reportedBy` on the read surface) belongs to 43/04
// by ADR-010/D2, which keeps everything read-side; this story writes the column, so the
// column itself is where its stamp is provable today.
export async function authorOf(fx, ref, workspaceId = fx.workspaceId) {
  return withStore(fx, (store) => store.db
    .prepare("SELECT node_id FROM work_items WHERE workspace_id = ? AND ref = ?")
    .get(workspaceId, ref)?.node_id ?? null);
}

export async function projectionErrors(fx, workspaceId = fx.workspaceId) {
  return withStore(fx, (store) => store.db
    .prepare("SELECT source_path, message, code FROM projection_errors WHERE workspace_id = ?")
    .all(workspaceId)
    .map((row) => ({ sourcePath: row.source_path, message: row.message, code: row.code })));
}

// ------------------------------------------------------- the control node's DISK --

function itemDir(workDir, ref, slug) {
  const [milestone, story] = ref.split("/");
  const milestoneDir = path.join(workDir, `${milestone}_milestone_m${milestone}`);
  return story == null
    ? milestoneDir
    : path.join(milestoneDir, "stories", `${story}_story_${slug ?? `s${milestone}-${story}`}`);
}

function docNameFor(ref) {
  return ref.includes("/") ? "STORY.md" : "SPEC.md";
}

// writeItem(fx, ref, fields) — create or edit an item on the CONTROL NODE'S OWN DISK,
// in the folder layout the fixture's stream uses. The frontmatter keys are exactly the
// ones the own-disk read projects into a row.
export async function writeItem(fx, ref, { status = "not-started", title, slug, workDir = fx.workDir } = {}) {
  const [milestone, story] = ref.split("/");
  const dir = itemDir(workDir, ref, slug);
  await mkdir(dir, { recursive: true });
  const fields = story == null
    ? { type: "milestone", number: milestone, slug: slug ?? `m${milestone}` }
    : { type: "story", number: story, slug: slug ?? `s${milestone}-${story}`, parent: milestone };
  const body = Object.entries({ ...fields, status, title: title ?? `Item ${ref}`, created: "2026-08-01", updated: "2026-08-02", schema: 1 })
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  await writeFile(path.join(dir, docNameFor(ref)), `---\n${body}\n---\n`, "utf8");
}

// writeItemRaw(fx, ref, titleLine) — the item's record doc with a VERBATIM frontmatter
// line for `title`, so a test can write what an operator can actually type. `title:
// [alpha, beta]` is ordinary YAML-ish input that `parseFrontmatter` deliberately turns
// into an ARRAY — the value the row writer cannot bind.
export async function writeItemRaw(fx, ref, titleLine, { status = "not-started", workDir = fx.workDir } = {}) {
  const [milestone, story] = ref.split("/");
  const dir = itemDir(workDir, ref);
  await mkdir(dir, { recursive: true });
  const head = story == null
    ? `type: milestone\nnumber: ${milestone}\nslug: m${milestone}`
    : `type: story\nnumber: ${story}\nslug: s${milestone}-${story}\nparent: ${milestone}`;
  await writeFile(path.join(dir, docNameFor(ref)), `---\n${head}\nstatus: ${status}\n${titleLine}\n---\n`, "utf8");
}

// deleteItem(fx, ref) — the item genuinely leaves the control node's stream.
export async function deleteItem(fx, ref, { workDir = fx.workDir } = {}) {
  await rm(itemDir(workDir, ref), { recursive: true, force: true });
}

// breakItem(fx, ref) — the record doc stops parsing (a momentarily-broken frontmatter),
// which is a READ FAULT and must never read as "the item is gone".
export async function breakItem(fx, ref, { workDir = fx.workDir } = {}) {
  await writeFile(path.join(itemDir(workDir, ref), docNameFor(ref)), "no frontmatter at all\n", "utf8");
}

// removeStream(fx) — the whole work stream disappears from under the publisher (the
// read FAILS, which is not the same fact as "the stream is empty").
export async function removeStream(fx, { workDir = fx.workDir } = {}) {
  await rm(workDir, { recursive: true, force: true });
}

// workerWorktree(fx, refs) — a SECOND, GENUINELY SEPARATE work dir standing in for the
// worker's own worktree: a different directory on disk, speaking for the SAME workspace
// id (which is what a real per-assignment worktree does — the mesh checkout lives at a
// different path and reports under the assignment's workspace). Returned in the workspace
// shape `readWorkspaceProjectionItems` takes, so a test can build the worker's frame the
// way the launcher does: from the WORKER's disk, never the control's.
export async function workerWorktree(fx, refs = ["43", "43/02"], name = "worktree") {
  const root = path.join(fx.tmp, name);
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  for (const ref of refs) await writeItem(fx, ref, { workDir, title: `worktree ${ref}` });
  return { workspace: { config: { name, work: { dir: "./wiki/work" } }, projectRoot: root, workDir }, root, workDir };
}

// otherWorkspace(fx, name) — a SECOND registered workspace ("beta"), with its own
// project root, its own id and its own copy of a ref string.
export async function otherWorkspace(fx, name = "beta", refs = ["43", "43/02"]) {
  const root = path.join(fx.tmp, name);
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name, work: { dir: "./wiki/work" }, mesh: { enabled: true, nodeId: fx.nodeId, workspaceId: `ws-${name}` } }, null, 2)}\n`,
    "utf8",
  );
  for (const ref of refs) await writeItem(fx, ref, { workDir, title: `${name} ${ref}` });
  const workspace = { config: { name, work: { dir: "./wiki/work" }, mesh: { enabled: true, nodeId: fx.nodeId, workspaceId: `ws-${name}` } }, projectRoot: root, workDir };
  await registerDescriptor(fx, `ws-${name}`, root, workDir);
  return { workspace, workspaceId: `ws-${name}`, root, workDir };
}
