// test/support/staleness-fixture.mjs — the shared fixture for milestone 43 / story 04
// (staleness, never eviction: the READ side of schema v8's provenance columns).
//
// It is `cache-authority-fixture.mjs` (story 02's) reused verbatim for everything the two
// stories share — a hermetic AOF_GLOBAL_HOME, a real workspace, the registered descriptor a
// worker frame is checked against, and the two REAL writers (the control's own publish tick
// and a worker's authenticated frame) — with this story's own node names and the three
// things only the read side needs:
//
//   (a) THE SERIALISED LIST RESPONSE, taken from the REAL board over HTTP. The features'
//       litmus is "the JSON the board's `/api/work/list` route actually serialises", so
//       `listResponse` stands up the production board (serveSetupUi → board-ui.mjs) and
//       fetches it. Nothing here re-implements the envelope.
//   (b) THE CONFIGURED WINDOW. `setStalenessWindow` rewrites the workspace's own
//       `.aof/aof.config.json`, which is what a real operator edits and what the face reads
//       per request — never an injected constant.
//   (c) AN INJECTED `now`. Freshness is judged at the read boundary against a supplied
//       instant (the 22/R2 discipline the shared predicate keeps), so `at(seconds)` builds
//       an instant a fixed age before a pinned NOW and every verdict is a test rather than a
//       race.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { serveSetupUi } from "../../src/setup-ui.mjs";
import { invoke, loadWorkspace } from "../../src/command-core.mjs";
import { upsertWorkItemContent } from "../../src/global-work-store.mjs";
import { withCacheFixture, withStore, tick, stream, itemRow, rows, registerDescriptor, seedActive, settle } from "./cache-authority-fixture.mjs";

export { withStore, tick, stream, itemRow, rows, registerDescriptor, seedActive, settle };

// The two nodes the story's features name.
export const CONTROL_NODE = "aof-control";
export const WORKER_NODE = "umairs-mac-mini";

// The stream: milestone 43 with story 43/04 — the ref every scenario talks about.
export const STALENESS_STREAM = [{ number: "43", stories: ["04"] }];

// The pinned NOW every injected-clock scenario is judged against, and the window the
// features' Backgrounds configure.
export const NOW = "2026-08-03T12:00:00.000Z";
export const NOW_MS = Date.parse(NOW);
export const WINDOW_SECONDS = 300;

// at(secondsBeforeNow) — an ISO instant exactly N seconds before the pinned NOW. Negative N
// is the clock-skew case (an instant in the FUTURE), which is a real state on a mesh and a
// deliberate row in the freshness table.
export function at(secondsBeforeNow) {
  return new Date(NOW_MS - secondsBeforeNow * 1000).toISOString();
}

export async function withStalenessFixture(body, { stream = STALENESS_STREAM } = {}) {
  return withCacheFixture(body, { stream, nodeId: CONTROL_NODE });
}

// setStalenessWindow(fx, seconds) — "the cache staleness window is configured as N seconds",
// written where an operator would write it. `undefined` removes the block entirely, which is
// the documented-default case.
export async function setStalenessWindow(fx, seconds) {
  const configPath = path.join(fx.root, ".aof", "aof.config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.mesh = { ...(config.mesh ?? {}) };
  if (seconds === undefined) delete config.mesh.cache;
  else config.mesh.cache = { ...(config.mesh.cache ?? {}), stalenessSeconds: seconds };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

// listResponse(fx) — the JSON the BOARD actually serialises for `/api/work/list`, from the
// real production route on a real server. This is the observable both features' litmus names,
// and it is why nothing below asserts against a hand-built envelope.
export async function listResponse(fx) {
  const { server, url } = await serveSetupUi(null, { projectDir: fx.root, port: 0 });
  try {
    const response = await fetch(new URL("/api/work/list", url));
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// listRows(fx) — the same rows through the command core (the board face's own door), for the
// scenarios whose subject is a ROW rather than the envelope. Re-loads the workspace so a
// config edit is picked up exactly as a fresh HTTP request would pick it up.
export async function listRows(fx) {
  const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
  return invoke("work:list", { mesh: true }, { workspace, globalWorkStoreOptions: { env: fx.env } });
}

// rowFor(fx, ref) — one serialised row off the list response.
export async function rowFor(fx, ref) {
  return (await listRows(fx)).find((row) => row.ref === ref) ?? null;
}

// docResponse(fx, ref, doc) — the serialised ARTIFACT, through the same `work:doc` door the
// board's drill-down uses. The artifact's provenance must arrive under the SAME wire names
// as the row's, which is the whole point of having one mapper.
export async function docResponse(fx, ref, doc = "SPEC") {
  const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
  return invoke("work:doc", { ref, doc }, { workspace, globalWorkStoreOptions: { env: fx.env } });
}

// streamDoc(fx, { ref, doc, body, node, at }) — an ARTIFACT reported by `node` at its own
// instant, written through the store's ONE content writer (the same seam
// applyWorktreeContentFrame calls), so the doc's provenance is genuinely its own and not
// inherited from the row that names it.
export async function streamDoc(fx, { ref, doc = "SPEC", body = "# cached body\n", node = WORKER_NODE, at: instant }) {
  return withStore(fx, (store) => upsertWorkItemContent(
    store,
    fx.workspaceId,
    { docs: [{ ref, doc, body }], nodeId: node },
    { now: instant },
  ));
}

// streamRun(fx, { ref, runId, node, at }) — a cached run record with its own provenance.
export async function streamRun(fx, { ref, runId, node = WORKER_NODE, at: instant }) {
  return withStore(fx, (store) => upsertWorkItemContent(
    store,
    fx.workspaceId,
    { runs: [{ ref, runId, record: { runId, itemRef: ref, state: "done" } }], nodeId: node },
    { now: instant },
  ));
}

// plantRow(fx, ref, { node, at }) — a cached row with EXACTLY the stored provenance the
// scenario names, including the un-stampable states a writer can no longer produce but a
// pre-v8 file genuinely holds: a NULL author, a NULL instant, an empty string, unparseable
// text. The row itself is written through the real seam first so it is a complete, storable
// row; only the two provenance columns are then set to the planted values — which is the
// only way to model a file that predates the columns.
export async function plantRow(fx, ref, { node = null, at: instant = null, fields = {} } = {}) {
  await withStore(fx, (store) => {
    const row = itemRow(ref, fields);
    store.db.prepare(`
      INSERT INTO work_items (workspace_id, ref, type, slug, status, title, parent, source_path, node_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, ref) DO UPDATE SET
        type = excluded.type, slug = excluded.slug, status = excluded.status, title = excluded.title,
        parent = excluded.parent, source_path = excluded.source_path,
        node_id = excluded.node_id, updated_at = excluded.updated_at
    `).run(fx.workspaceId, row.ref, row.type, row.slug, row.status, row.title, row.parent, row.sourcePath, node, instant);
  });
}

// storeRow(fx, ref) — the raw stored row, so a scenario can assert the STORAGE names on one
// side of the mapping and the WIRE names on the other.
export async function storeRow(fx, ref) {
  return withStore(fx, (store) => store.db
    .prepare("SELECT * FROM work_items WHERE workspace_id = ? AND ref = ?")
    .get(fx.workspaceId, ref) ?? null);
}

// counts(fx) — the row counts across the three cache tables, for the never-evict observable.
export async function counts(fx) {
  return withStore(fx, (store) => ({
    items: store.db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE workspace_id = ?").get(fx.workspaceId).n,
    docs: store.db.prepare("SELECT COUNT(*) AS n FROM work_item_docs WHERE workspace_id = ?").get(fx.workspaceId).n,
    runs: store.db.prepare("SELECT COUNT(*) AS n FROM work_item_runs WHERE workspace_id = ?").get(fx.workspaceId).n,
  }));
}
