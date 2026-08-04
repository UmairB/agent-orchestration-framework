// Traceability wiring for milestone 43 / story 04 (staleness, never eviction), task
//   .../04_story_staleness-and-resync/tasks/01_cached-rows-carry-provenance.feature
//
// AC 3 / AC 5 / AC 6: every cached row and artifact carries WHO reported it and WHEN, under
// the STORAGE names in the store (`node_id`/`updated_at`) and the WIRE names on the response
// (`reportedBy`/`syncedAt`), with the configured staleness window on the list response
// exactly once.
//
// THE LITMUS, as the task's header sets it: every Then is confirmable from two observable
// artefacts and nothing else — (a) a store row read back out of an isolated global store,
// and (b) the JSON the board's `/api/work/list` route actually serialises (and the JSON
// `aof work list --json` prints). No source is read. "One mapper" is asserted only where it
// has an OBSERVABLE consequence: the row and the artifact produce the SAME key names and the
// SAME unknown-shape for the same underlying fact.
//
// THE MEASURED GAP THIS CLOSES: the board's per-item wire shape carried no `syncedAt` at
// all, and `reportedBy` was set ONLY on the child rows the worker merge INSERTS — never on
// the rows it MERGES. So attribution was accidental and partial: the item you are actually
// looking at was the one least likely to say who reported it.
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CACHE_STALENESS_SECONDS } from "../src/cache-provenance.mjs";
import {
  withStalenessFixture,
  setStalenessWindow,
  listResponse,
  listRows,
  rowFor,
  docResponse,
  streamDoc,
  storeRow,
  plantRow,
  tick,
  stream,
  itemRow,
  withStore,
  seedActive,
  at,
  CONTROL_NODE,
  WORKER_NODE,
} from "./support/staleness-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

const REF = "43/04";
// A story the worker reports that this checkout does not have AT ALL — the merge's insert
// path. It sits under the executing milestone because that is the unit of mesh execution
// (ADR-003's execution scope), which is also how the board asks for a worker's view.
const NEW_CHILD = "43/07";

export const stalenessCachedRowsProvenanceTests = [
  // ==========================================================================
  // HEADLINE (AC 3), Scenario Outline: a row upserted through the shared seam
  // reads back stamped with its author and its instant, whichever node wrote it
  // ==========================================================================
  {
    name: "staleness/01 every writer stamps — the control's own publish, a worker delta, and a worker re-reporting a ref the control already published all read back with their author and instant, on the store AND on the wire",
    run: () => withStalenessFixture(async (fx) => {
      // | control publishes its own row |
      await tick(fx, { now: at(30) });
      const controlStored = await storeRow(fx, REF);
      assert.equal(controlStored.node_id, CONTROL_NODE, "the control's own publish stamps node_id = aof-control");
      assert.ok(Number.isFinite(Date.parse(controlStored.updated_at)), "…and a parseable ISO-8601 instant");
      assert.notEqual(controlStored.updated_at, "", "…not an empty string");
      assert.notEqual(controlStored.updated_at, null, "…and not null");
      let wire = await rowFor(fx, REF);
      assert.equal(wire.reportedBy, CONTROL_NODE, "the same row on the wire carries reportedBy = aof-control");
      assert.equal(wire.syncedAt, controlStored.updated_at, "…and a syncedAt equal to that updated_at");

      // | worker streams a delta | — on the worker's AUTHENTICATED connection. The stamp is
      // the connection's node, never the id the frame self-reports.
      await stream(fx, WORKER_NODE, [itemRow(REF, { status: "in-progress" })], { at: at(20), selfReports: "an-impostor" });
      const deltaStored = await storeRow(fx, REF);
      assert.equal(deltaStored.node_id, WORKER_NODE, "a worker delta stamps the CONNECTION-authenticated node");
      wire = await rowFor(fx, REF);
      assert.equal(wire.reportedBy, WORKER_NODE);
      assert.equal(wire.syncedAt, deltaStored.updated_at);

      // | worker re-reports an existing row | — the ref the control published above.
      // Authorship legitimately moves to the reporting node.
      await stream(fx, WORKER_NODE, [itemRow(REF, { status: "in-review" })], { at: at(10) });
      const reStored = await storeRow(fx, REF);
      assert.equal(reStored.node_id, WORKER_NODE, "a worker re-report takes authorship of a ref the control published");
      assert.equal(reStored.updated_at, at(10), "…stamped at the instant it reported");
      wire = await rowFor(fx, REF);
      assert.equal(wire.reportedBy, WORKER_NODE, "…and the wire says so");
      assert.equal(wire.syncedAt, reStored.updated_at);
    }),
  },

  // ==========================================================================
  // AC 3: the store speaks node_id / updated_at and the wire speaks reportedBy /
  // syncedAt — never the reverse, and never both
  // ==========================================================================
  {
    name: "staleness/01 the STORE exposes node_id/updated_at and no synced_at/reported_by column; the WIRE exposes reportedBy/syncedAt and no node_id/updated_at key; and the two describe the same instant and node",
    run: () => withStalenessFixture(async (fx) => {
      await stream(fx, WORKER_NODE, [itemRow(REF, { status: "in-progress" })], { at: at(30) });

      const columns = await withStore(fx, (store) => store.db.prepare("PRAGMA table_info(work_items)").all().map((column) => column.name));
      assert.ok(columns.includes("node_id") && columns.includes("updated_at"), "the store row exposes node_id and updated_at");
      assert.ok(!columns.includes("synced_at"), "…and exposes no synced_at column");
      assert.ok(!columns.includes("reported_by"), "…and no reported_by column");

      const wire = await rowFor(fx, REF);
      const keys = Object.keys(wire);
      assert.ok(keys.includes("reportedBy") && keys.includes("syncedAt"), "the serialised row exposes reportedBy and syncedAt");
      assert.ok(!keys.includes("node_id"), "…and no node_id key");
      assert.ok(!keys.includes("updated_at"), "…and no updated_at key");

      const stored = await storeRow(fx, REF);
      assert.equal(wire.syncedAt, stored.updated_at, "the wire value round-trips back to the stored value with no reformatting");
      assert.equal(wire.reportedBy, stored.node_id, "…and names the same node");
      assert.equal(Date.parse(wire.syncedAt), Date.parse(stored.updated_at), "…describing the same instant");
    }),
  },

  // ==========================================================================
  // AC 3 / AC 6, Scenario Outline: an artifact carries its OWN provenance under
  // the SAME wire names as the row that names it
  // ==========================================================================
  ...[
    { label: "doc OLDER than the row naming it", rowNode: WORKER_NODE, rowAge: 30, docNode: WORKER_NODE, docAge: 7200 },
    { label: "doc NEWER than the row", rowNode: WORKER_NODE, rowAge: 7200, docNode: WORKER_NODE, docAge: 30 },
    { label: "different nodes, same item", rowNode: CONTROL_NODE, rowAge: 30, docNode: WORKER_NODE, docAge: 300 },
  ].map(({ label, rowNode, rowAge, docNode, docAge }) => ({
    name: `staleness/01 an artifact carries its OWN provenance under the SAME wire names as its row — ${label}`,
    run: () => withStalenessFixture(async (fx) => {
      await plantRow(fx, REF, { node: rowNode, at: at(rowAge) });
      await streamDoc(fx, { ref: REF, doc: "SPEC", node: docNode, at: at(docAge) });

      const row = await rowFor(fx, REF);
      assert.equal(row.reportedBy, rowNode, "the row's serialised provenance names its own node");
      assert.equal(row.syncedAt, at(rowAge), "…at its own instant");

      const doc = await docResponse(fx, REF, "SPEC");
      assert.equal(doc.reportedBy, docNode, "the doc's serialised provenance names ITS node");
      assert.equal(doc.syncedAt, at(docAge), "…at ITS instant");

      // Reported independently — shown by a CHANGE, not by two values the equalities above
      // have already forced apart. Re-report the ARTIFACT, by a different node at a
      // different instant, and the row that names it does not move a byte. An
      // implementation that let a doc write stamp the row it belongs to (or that served one
      // provenance for both subjects) fails here and nowhere else in this scenario.
      await streamDoc(fx, { ref: REF, doc: "SPEC", node: CONTROL_NODE, at: at(1) });
      const docAfter = await docResponse(fx, REF, "SPEC");
      assert.equal(docAfter.reportedBy, CONTROL_NODE, "the artifact's provenance follows the artifact's own re-report");
      assert.equal(docAfter.syncedAt, at(1), "…to its new instant");
      const rowAfter = await rowFor(fx, REF);
      assert.deepEqual(
        { reportedBy: rowAfter.reportedBy, syncedAt: rowAfter.syncedAt },
        { reportedBy: row.reportedBy, syncedAt: row.syncedAt },
        "…and the row's own provenance is untouched by it: the two are independent facts",
      );
      // …and the SAME two key names carry both, which is the observable consequence of one
      // mapper: a reader never has to know whether it is holding a row or an artifact.
      assert.deepEqual(
        ["reportedBy", "syncedAt"].filter((key) => key in row),
        ["reportedBy", "syncedAt"].filter((key) => key in doc),
        "the row and the artifact produce the same key names for the same fact",
      );
    }),
  })),

  // ==========================================================================
  // AC 3 (REGRESSION — the measured gap): a row MERGED from a worker's view
  // carries reportedBy, not only the child rows the merge inserts
  // ==========================================================================
  {
    name: "staleness/01 a row MERGED from a worker's view carries reportedBy + syncedAt — not only the child rows the merge INSERTS — and no cache-sourced row is missing it while a sibling carries it",
    run: () => withStalenessFixture(async (fx) => {
      // The local checkout already has a row for 43/04 (the fixture's own stream, published
      // by this control node)…
      await tick(fx, { now: at(600) });
      assert.equal((await storeRow(fx, REF)).node_id, CONTROL_NODE);

      // …and the worker is executing milestone 43, which is what makes the board ask for its
      // view at all (the execution scope is the top-level item — ADR-003).
      await seedActive(fx, { assignmentId: "asg-resync", itemRef: "43", node: WORKER_NODE });

      // The worker reports its OWN view of 43/04, plus a story this checkout does not have
      // at all — the pair whose attribution used to disagree: the MERGED row lost it, the
      // INSERTED child kept it.
      await stream(fx, WORKER_NODE, [
        itemRow("43", { status: "in-progress" }),
        itemRow(REF, { status: "in-review", title: "Staleness, never eviction" }),
        itemRow(NEW_CHILD, { status: "in-progress" }),
      ], { at: at(60) });

      const rows = await listRows(fx);
      const merged = rows.find((row) => row.ref === REF);
      assert.ok(merged, "the merged row is in the response");
      assert.equal(merged.reportedBy, WORKER_NODE, "the MERGED row names the worker that reported it");
      assert.equal(merged.syncedAt, at(60), "…and carries its syncedAt");

      const child = rows.find((row) => row.ref === NEW_CHILD);
      assert.ok(child, "the inserted child row is in the response");
      assert.equal(child.reportedBy, WORKER_NODE, "the INSERTED child carries the same two fields");
      assert.equal(child.syncedAt, at(60));

      // No row that came from the cache is missing reportedBy while a sibling carries it.
      const cachedRefs = new Set(await withStore(fx, (store) => store.db
        .prepare("SELECT ref FROM work_items WHERE workspace_id = ?").all(fx.workspaceId).map((row) => row.ref)));
      const missing = rows.filter((row) => cachedRefs.has(row.ref) && !("reportedBy" in row));
      assert.deepEqual(missing.map((row) => row.ref), [], "every cache-sourced row in the response carries reportedBy");
    }),
  },

  // ==========================================================================
  // AC 5, Scenario Outline: the list response states the configured staleness
  // window exactly once, and it is the configured value
  // ==========================================================================
  ...[
    { label: "the documented default", configured: undefined, expected: DEFAULT_CACHE_STALENESS_SECONDS },
    { label: "a short window", configured: 60, expected: 60 },
    { label: "a long window", configured: 86400, expected: 86400 },
    { label: "zero — aggressive but valid", configured: 0, expected: 0 },
  ].map(({ label, configured, expected }) => ({
    name: `staleness/01 the board's work-list response states the configured window ONCE — ${label}`,
    run: () => withStalenessFixture(async (fx) => {
      await setStalenessWindow(fx, configured);
      await tick(fx, { now: at(30) });

      const { status, body } = await listResponse(fx);
      assert.equal(status, 200);
      assert.equal(body.stalenessSeconds, expected, `the response carries stalenessSeconds = ${expected}`);
      // …once for the whole response: one key on the envelope, and the rows are an array
      // beside it rather than the response itself.
      //
      // The key set is asserted EXACTLY, and it now names THREE keys: `nodeId` joined the
      // envelope for task 04's `(this node)` clause (AC 11) — the second fact that is ONE
      // fact for the WHOLE response rather than a per-row one, carried by the same face
      // change of the same shape (ADR-010/R4.1). What this scenario pins is unmoved and is
      // re-asserted below: the WINDOW is stated once and no row carries a threshold of its
      // own. The exactness is kept rather than relaxed to a superset check, so a third
      // envelope key still has to be a deliberate edit here.
      assert.deepEqual(
        Object.keys(body).sort(),
        ["items", "nodeId", "stalenessSeconds"],
        "the envelope is exactly { items, stalenessSeconds, nodeId } — the window stated ONCE, beside the rows and the serving node's id",
      );
      assert.ok(Array.isArray(body.items), "the rows ride the envelope's items array");
      assert.ok(body.items.length > 0, "…and there are rows to carry facts (non-vacuous)");

      for (const row of body.items) {
        for (const key of ["stalenessSeconds", "window", "threshold", "stale", "isStale", "freshness"]) {
          assert.ok(!(key in row), `no row carries a window, threshold or pre-computed stale flag of its own (${row.ref} has ${key})`);
        }
      }
      // Every cached row carries only the FACTS the reader needs to apply that one window.
      const cached = body.items.filter((row) => "syncedAt" in row);
      assert.ok(cached.length > 0, "the cached rows carry syncedAt (non-vacuous)");
      for (const row of cached) {
        assert.ok("reportedBy" in row, `${row.ref} carries reportedBy beside its syncedAt`);
      }
    }),
  })),

  // ==========================================================================
  // AC 2, Scenario Outline: an unstamped row serialises its unknowns EXPLICITLY
  // — present and null, never omitted and never fabricated
  // ==========================================================================
  ...[
    { label: "never stamped (pre-v8)", node: null, instant: null, wireNode: null },
    { label: "node known, instant unknown", node: WORKER_NODE, instant: null, wireNode: WORKER_NODE },
    { label: "instant known, node unknown", node: null, instant: at(30), wireNode: null },
  ].map(({ label, node, instant, wireNode }) => ({
    name: `staleness/01 an unstamped row serialises its unknowns EXPLICITLY — present and null, never omitted, never fabricated — ${label}`,
    run: () => withStalenessFixture(async (fx) => {
      await plantRow(fx, REF, { node, at: instant });

      const row = await rowFor(fx, REF);
      assert.ok("syncedAt" in row, "the row carries a syncedAt key");
      assert.ok("reportedBy" in row, "…and a reportedBy key");
      assert.equal(row.syncedAt, instant, instant == null ? "whose value is null" : "…carrying the instant it does have");
      assert.equal(row.reportedBy, wireNode, "…and the node it does or does not have");

      // Neither is filled with the SERVING node's id, the CURRENT time, or an empty string.
      if (wireNode == null) {
        assert.notEqual(row.reportedBy, CONTROL_NODE, "never the serving node's id");
        assert.notEqual(row.reportedBy, "", "never an empty string");
      }
      if (instant == null) {
        assert.notEqual(row.syncedAt, "", "never an empty string");
        assert.equal(row.syncedAt, null, "never the current time");
      }
    }),
  })),

  // ==========================================================================
  // ADR-002's frozen contract: the CLI's own `work list --json` stays a flat
  // array of the frozen contract fields plus additive optional ones
  // ==========================================================================
  {
    name: "staleness/01 `aof work list --json` stays a FLAT ARRAY of the seven frozen contract fields — the provenance ride the board face, and no CLI consumer has to change",
    run: () => withStalenessFixture(async (fx) => {
      // The cache is fully populated and provenance-stamped — the condition under which a
      // leak onto the CLI face would actually happen.
      await tick(fx, { now: at(30) });
      await stream(fx, WORKER_NODE, [itemRow(REF, { status: "in-review" })], { at: at(10) });

      const result = spawnCliSync(process.execPath, [cliPath, "work", "list", "--json"], {
        cwd: fx.root,
        encoding: "utf8",
        env: { ...process.env, NODE_NO_WARNINGS: "1", AOF_GLOBAL_HOME: fx.home },
      });
      assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
      const parsed = JSON.parse(result.stdout ?? "");
      assert.ok(Array.isArray(parsed), "the output is a flat JSON array, as it is today");
      assert.ok(parsed.length > 0, "…and non-empty (non-vacuous)");

      // THE EXACT-KEY FORM, RESTORED AND KEPT (m43 / ADR-016/G1). 43/06 briefly widened this
      // to "the seven plus the answering side"; the milestone's architecture review ruled the
      // other way and stripped the stamp at the CLI `json` adapter instead, so this lane holds
      // the m03/ADR-002 contract EXACTLY, as its own name says. The decisive reason is width:
      // the stamp is ONE key on a disk-answered row and THREE on a cache-answered one, so a
      // widened contract's key set would depend on whether this machine has a mesh cache —
      // and a frozen contract whose width varies by deployment is not frozen. The answering
      // side is asserted where it actually rides: `/api/work/list` (board-face-contract,
      // board-api) and `work find`/`work next` (cache-read-control-leaves).
      const CONTRACT = ["ref", "type", "slug", "status", "title", "parent", "dir"].sort();
      for (const element of parsed) {
        assert.deepEqual(Object.keys(element).sort(), CONTRACT, `element ${element.ref} has exactly the seven contract fields`);
      }
      // No existing key is renamed, retyped or removed, and the window never reaches here.
      assert.ok(!JSON.stringify(parsed).includes("stalenessSeconds"), "the CLI face carries no staleness window");
    }),
  },
];
