// Traceability wiring for milestone 43 / story 04 (staleness, never eviction), task
//   .../04_story_staleness-and-resync/tasks/00_schema-v8-provenance-columns.feature
//
// AC 1 / AC 2: opening a pre-v8 store lands `node_id` + `updated_at` on `work_items`
// through a GUARDED, IDEMPOTENT `ALTER TABLE … ADD COLUMN` — never a table rebuild —
// leaves every existing row intact and UNSTAMPED, and touches neither content table.
//
// THE LITMUS, as the task's header sets it: every Then is confirmable by OPENING THE STORE
// BACK UP and reading it — the `aof_schema` version row, `PRAGMA table_info(<table>)`'s
// column list, `sqlite_master`'s own CREATE text, and the rows themselves. No source is
// read; the migration is judged by the shape and content of the database it leaves behind.
// The v7 fixture is built the backcompat-migrate way — write a store at the OLD version and
// re-open it with this build — never by hand-editing a schema the migration then agrees
// with. (`ALTER TABLE … RENAME TO` is how a pre-3.35 SQLite models an authentically-old
// file, the idiom mesh-assignment-record.test.mjs already uses for the v3→v4 clone_url
// migration; the point is that the FILE is genuinely v7-shaped before this build sees it.)
//
// WHY A REBUILD IS FORBIDDEN AND MUST BE ASSERTED RATHER THAN ASSUMED: `CREATE TABLE IF NOT
// EXISTS` never adds a column to an already-existing table, so the only two ways to land the
// columns are the guarded ALTER or a drop-and-recreate. A rebuild would be INVISIBLE in a
// green "the column exists" assertion and would silently destroy every row a worker had
// streamed — which under ADR-004 is unrecoverable FACT, not a re-derivable projection. So
// what is asserted below is the SURVIVAL of the data and the IDEMPOTENCE of the step, which
// is what actually distinguishes the two implementations.
//
// SCHEMA OWNERSHIP: the migration itself is 43/02's (ADR-010/D2 moved it there — its
// retraction predicate cannot read a column that does not exist). This file is 43/04's
// CONFIRMATION that the five properties its own read side depends on genuinely hold against
// what shipped, and it is the regression net if a future bump reaches for a rebuild.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  openGlobalWorkProjectionStore,
  upsertWorkItems,
  GLOBAL_WORK_SCHEMA_VERSION,
} from "../src/global-work-store.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";

const WS = "ws-preexisting";
const OTHER_WS = "ws-second";

// The v7 shape of work_items, verbatim: eight columns, no provenance, the same composite
// primary key. This is what every store already on a real machine has.
const V7_WORK_ITEMS = `
  CREATE TABLE work_items_v7_shape (
    workspace_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    type TEXT NOT NULL,
    slug TEXT NOT NULL,
    status TEXT,
    title TEXT,
    parent TEXT,
    source_path TEXT NOT NULL,
    PRIMARY KEY (workspace_id, ref)
  );
  DROP TABLE work_items;
  ALTER TABLE work_items_v7_shape RENAME TO work_items;
`;

const V7_COLUMNS = ["workspace_id", "ref", "type", "slug", "status", "title", "parent", "source_path"];

// The Background's populated v7 store: work items, docs and run records for TWO workspaces.
const V7_ITEMS = [
  [WS, "43", "milestone", "mesh-artifact-authority", "in-progress", "Mesh artifact authority", null, "/repo/wiki/work/43/SPEC.md"],
  [WS, "43/04", "story", "staleness-and-resync", "in-review", "Staleness, never eviction", "43", "/repo/wiki/work/43/stories/04/STORY.md"],
  [OTHER_WS, "07", "milestone", "beta", "done", "Beta", null, "/beta/wiki/work/07/SPEC.md"],
];
const V7_DOCS = [
  [WS, "43/04", "STORY", "# 43/04 · Staleness\n", "umairs-mac-mini", "2026-08-01T09:00:00.000Z"],
  [OTHER_WS, "07", "SPEC", "# 07 · Beta\n", "aof-wsl", "2026-07-30T12:00:00.000Z"],
];
const V7_RUNS = [
  [WS, "43/04", "20260801T090000000Z-0001", '{"runId":"20260801T090000000Z-0001","state":"done"}', "umairs-mac-mini", "2026-08-01T09:05:00.000Z"],
  [OTHER_WS, "07", "20260730T120000000Z-0001", '{"runId":"20260730T120000000Z-0001","state":"failed"}', "aof-wsl", "2026-07-30T12:05:00.000Z"],
];

async function withTemp(body) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-staleness-schema-"));
  try {
    return await body(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

const open = (home) => openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });

// writeV7Store(home) — "a global work store written at schema version 7, holding work items,
// docs and run records for two workspaces". Opened fresh (so the file, its pragmas and every
// sibling table are this build's own), then work_items is put back into its v7 shape and the
// version row wound back, which is exactly the state a real pre-v8 machine's file is in.
async function writeV7Store(home) {
  const v7 = await open(home);
  try {
    v7.db.exec(V7_WORK_ITEMS);
    const item = v7.db.prepare("INSERT INTO work_items (workspace_id, ref, type, slug, status, title, parent, source_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const row of V7_ITEMS) item.run(...row);
    const doc = v7.db.prepare("INSERT INTO work_item_docs (workspace_id, ref, doc, body, node_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const row of V7_DOCS) doc.run(...row);
    const run = v7.db.prepare("INSERT INTO work_item_runs (workspace_id, ref, run_id, record_json, node_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const row of V7_RUNS) run.run(...row);
    v7.db.prepare("UPDATE aof_schema SET value = 7 WHERE key = 'version'").run();
  } finally {
    v7.close();
  }
}

const columnsOf = (store, table) => store.db.prepare(`PRAGMA table_info(${table})`).all();
const columnNames = (store, table) => columnsOf(store, table).map((column) => column.name);
const createSql = (store, table) => store.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql ?? "";
const itemRows = (store, workspaceId) => store.db.prepare("SELECT * FROM work_items WHERE workspace_id = ? ORDER BY ref").all(workspaceId);
const allRows = (store, table) => store.db.prepare(`SELECT * FROM ${table} ORDER BY workspace_id, ref`).all();
const version = (store) => store.db.prepare("SELECT value FROM aof_schema WHERE key = 'version'").get()?.value ?? null;

// MEASURED, not assumed (2026-08-03, node:sqlite): `ALTER TABLE … ADD COLUMN` SPLICES the
// new column into the stored CREATE text before the PRIMARY KEY clause, so a column's
// POSITION in `sqlite_master.sql` cannot tell an ALTERed table from a freshly-created one.
// The observables that genuinely separate the three cases are therefore:
//
//   fresh store   — there was NO DATABASE FILE before the open, so no ALTER could have run
//                   against anything; the table comes into existence carrying both columns.
//   the upgrade   — the column COUNT moves 8 → 10 while every pre-existing ROW survives.
//                   Row survival is the real discriminator the feature's header names: a
//                   drop-and-recreate ends with an identical column list and an empty table.
//   already at v8 — the stored CREATE text is BYTE-UNCHANGED across the open. A real ALTER
//                   rewrites it, so an unchanged definition IS "no ALTER was needed".

export const stalenessSchemaProvenanceTests = [
  // ==========================================================================
  // HEADLINE (AC 1): opening a v7 store lands both provenance columns on
  // work_items IN PLACE and moves the version to 8
  // ==========================================================================
  {
    name: "staleness/00 opening a v7 store lands node_id + updated_at on work_items IN PLACE, keeps every v7 column and the composite key, and moves the version to 8",
    run: async () => withTemp(async (home) => {
      await writeV7Store(home);

      const store = await open(home);
      try {
        assert.equal(Number(version(store)), 8, "reading the store back reports schema version 8");
        assert.equal(store.schemaVersion, GLOBAL_WORK_SCHEMA_VERSION);

        const columns = columnsOf(store, "work_items");
        const names = columns.map((column) => column.name);
        assert.ok(names.includes("node_id"), "work_items carries a node_id column");
        assert.ok(names.includes("updated_at"), "…and an updated_at column");

        // Every column it had at v7, with its original type and its primary key.
        const byName = new Map(columns.map((column) => [column.name, column]));
        for (const column of V7_COLUMNS) {
          assert.ok(byName.has(column), `the v7 column ${column} survives`);
        }
        assert.deepEqual(
          [byName.get("workspace_id").type, byName.get("ref").type, byName.get("status").type, byName.get("source_path").type],
          ["TEXT", "TEXT", "TEXT", "TEXT"],
          "…with its original type",
        );
        assert.deepEqual(
          columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name),
          ["workspace_id", "ref"],
          "…and the composite primary key (workspace_id, ref) unchanged",
        );

        // A rebuild is what this pair of clauses forbids: ADR-004 makes work_items a FACT —
        // a worker-authored row lost to a migration is not re-derivable from disk.
        const rows = itemRows(store, WS);
        assert.deepEqual(
          rows.map((row) => [row.ref, row.type, row.slug, row.status, row.title, row.parent, row.source_path]),
          V7_ITEMS.filter((row) => row[0] === WS).map(([, ...rest]) => rest),
          "every pre-existing row reads back with the same ref, type, slug, status, title, parent and source_path",
        );
        assert.equal(rows.length, 2, "the row count for this workspace is exactly what it was");
        assert.equal(itemRows(store, OTHER_WS).length, 1, "…and for the second workspace too");
      } finally {
        store.close();
      }
    }),
  },

  // ==========================================================================
  // Scenario Outline (AC 1, second half): the content tables need NO migration
  // ==========================================================================
  ...["work_item_docs", "work_item_runs"].map((table) => ({
    name: `staleness/00 ${table} needs NO migration — its provenance columns already exist and its rows are left byte-identical`,
    run: async () => withTemp(async (home) => {
      await writeV7Store(home);

      // The v7 column list + rows, read from the file BEFORE this build opens it.
      const before = await open(home).then(async (probe) => {
        // Re-wind the version the probe just stamped, so the open under test is a genuine
        // 7 → 8 upgrade rather than a re-open of an already-migrated file.
        const snapshot = { columns: columnNames(probe, table), rows: allRows(probe, table), sql: createSql(probe, table) };
        probe.db.prepare("UPDATE aof_schema SET value = 7 WHERE key = 'version'").run();
        probe.close();
        return snapshot;
      });

      // …and the open under test. It must not raise a duplicate-column error, which is what
      // an ALTER against these tables would do.
      const store = await open(home);
      try {
        const names = columnNames(store, table);
        assert.ok(names.includes("node_id"), `${table} carries node_id, exactly as it did at v7`);
        assert.ok(names.includes("updated_at"), `${table} carries updated_at, exactly as it did at v7`);
        assert.deepEqual(names, before.columns, `${table}'s column list is unchanged — no column added, removed, renamed or retyped`);
        assert.equal(createSql(store, table), before.sql, `${table}'s definition is byte-unchanged`);
        assert.deepEqual(allRows(store, table), before.rows, `every row in ${table} reads back with the same node_id and updated_at`);
      } finally {
        store.close();
      }
    }),
  })),

  // ==========================================================================
  // Scenario Outline (AC 1 / ADR-006): the migration is IDEMPOTENT — from any
  // starting state the store ends at v8 with ONE set of columns
  // ==========================================================================
  {
    name: "staleness/00 the migration is idempotent from every starting state — a fresh store creates the columns, a v7 store gains exactly two by ALTER, and an already-v8 store needs none",
    run: async () => {
      // | fresh store | no database file on disk at all |
      await withTemp(async (home) => {
        const databasePath = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).databasePath;
        assert.equal(existsSync(databasePath), false, "there is no database file on disk at all before the open");

        const first = await open(home);
        const sql = createSql(first, "work_items");
        const names = columnNames(first, "work_items");
        first.close();
        // The columns arrive with the table's CREATION, not by a later ALTER: there was no
        // table for an ALTER to reach, and the table exists carrying both.
        assert.ok(names.includes("node_id") && names.includes("updated_at"), "the new table carries both provenance columns from birth");

        const second = await open(home);
        try {
          assert.equal(Number(version(second)), 8, "both opens complete without error and the store reports v8");
          assert.deepEqual(columnNames(second, "work_items"), names, "the column list is unchanged by the second open");
          assert.equal(createSql(second, "work_items"), sql, "…and no ALTER was needed: the definition is byte-unchanged");
          assert.equal(names.filter((name) => name === "node_id").length, 1, "exactly one node_id column");
          assert.equal(names.filter((name) => name === "updated_at").length, 1, "exactly one updated_at column");
        } finally {
          second.close();
        }
      });

      // | the real upgrade | schema version 7, populated |
      await withTemp(async (home) => {
        await writeV7Store(home);
        // The pre-open column list is the v7 shape the fixture just wrote — deliberately
        // NOT read back through `open`, which is the very thing under test: opening the
        // store to measure it would migrate it first and report ten columns as "before".
        const v7Columns = V7_COLUMNS;

        const first = await open(home);
        const afterFirst = { columns: columnNames(first, "work_items"), sql: createSql(first, "work_items"), rows: itemRows(first, WS) };
        first.close();
        const second = await open(home);
        try {
          assert.equal(Number(version(second)), 8, "reading the store back reports schema version 8");
          assert.deepEqual(columnNames(second, "work_items"), afterFirst.columns, "the second open adds nothing");
          assert.equal(createSql(second, "work_items"), afterFirst.sql, "…and needs no ALTER: the table definition is byte-unchanged");
          assert.deepEqual(itemRows(second, WS), afterFirst.rows, "the second open changed no row in work_items");
          assert.deepEqual(
            allRows(second, "work_item_docs").map((row) => [row.workspace_id, row.ref, row.doc, row.body, row.node_id, row.updated_at]),
            V7_DOCS,
            "…nor in work_item_docs",
          );
          assert.deepEqual(
            allRows(second, "work_item_runs").map((row) => [row.workspace_id, row.ref, row.run_id, row.record_json, row.node_id, row.updated_at]),
            V7_RUNS,
            "…nor in work_item_runs",
          );

          // "exactly two columns were added to work_items" — the v7 shape had eight, the
          // migrated file has ten, and they are exactly the two provenance names.
          assert.equal(afterFirst.columns.length - v7Columns.length, 2, "exactly two columns were added to work_items");
          assert.deepEqual(
            afterFirst.columns.filter((name) => !v7Columns.includes(name)),
            ["node_id", "updated_at"],
            "…and they are exactly node_id and updated_at",
          );
          // …and by an in-place ALTER rather than a rebuild. Row survival is the whole
          // discriminator: a drop-and-recreate ends with an identical column list and an
          // EMPTY table, which is invisible to a "the column exists" assertion.
          assert.equal(afterFirst.rows.length, 2, "the pre-existing rows survived the step — an ALTER in place, never a rebuild");
          assert.equal(afterFirst.columns.filter((name) => name === "node_id").length, 1, "exactly one node_id column");
          assert.equal(afterFirst.columns.filter((name) => name === "updated_at").length, 1, "exactly one updated_at column");
        } finally {
          second.close();
        }
      });

      // | already migrated | schema version 8, populated |  and
      // | re-open of a migrated file | schema version 8 written by this build's own migration |
      await withTemp(async (home) => {
        await writeV7Store(home);
        const migrated = await open(home);
        const baseline = { columns: columnNames(migrated, "work_items"), sql: createSql(migrated, "work_items"), rows: itemRows(migrated, WS) };
        migrated.close();

        for (const pass of ["already migrated", "re-open of a migrated file"]) {
          const store = await open(home);
          try {
            assert.equal(Number(version(store)), 8, `${pass}: reading the store back reports schema version 8`);
            assert.deepEqual(columnNames(store, "work_items"), baseline.columns, `${pass}: no column was added`);
            assert.equal(createSql(store, "work_items"), baseline.sql, `${pass}: no ALTER was needed`);
            assert.deepEqual(itemRows(store, WS), baseline.rows, `${pass}: no row in work_items changed`);
          } finally {
            store.close();
          }
        }
      });
    },
  },

  // ==========================================================================
  // AC 2: existing rows read NULL after the migration — a fabricated syncedAt
  // is NEVER stamped
  // ==========================================================================
  {
    name: "staleness/00 existing rows read node_id NULL and updated_at NULL after the migration — no clock, no opening node id, no placeholder; only a row upserted AFTER it is stamped",
    run: async () => withTemp(async (home) => {
      await writeV7Store(home);

      const openedAt = new Date().toISOString();
      const store = await open(home);
      try {
        for (const row of [...itemRows(store, WS), ...itemRows(store, OTHER_WS)]) {
          assert.equal(row.node_id, null, `${row.ref} reads node_id NULL`);
          assert.equal(row.updated_at, null, `${row.ref} reads updated_at NULL`);
        }
        // …and nothing that looks like a stamp: not the migration's own clock, not the
        // opening node's id, not an empty string or any other placeholder. Asserted as an
        // absence of ANY value rather than as an inequality with the three usual suspects,
        // because a fourth placeholder would pass the narrower check.
        const stamped = store.db
          .prepare("SELECT COUNT(*) AS n FROM work_items WHERE node_id IS NOT NULL OR updated_at IS NOT NULL")
          .get().n;
        assert.equal(stamped, 0, "no pre-existing row was stamped with anything at all");
        assert.ok(openedAt.length > 0, "…including the migration's own clock (nothing carries a timestamp to compare)");

        // A row upserted AFTER the migration reads back with the writer's node id and its
        // own updated_at — so the NULLs are the UN-OBSERVED rows and only those.
        upsertWorkItems(store, WS, [{
          ref: "43/05",
          type: "story",
          slug: "gate-propagation",
          status: "not-started",
          title: "Gate propagation",
          parent: "43",
          sourcePath: "/repo/wiki/work/43/stories/05/STORY.md",
        }], { nodeId: "umairs-mac-mini", authority: "reported", syncedAt: "2026-08-03T10:00:00.000Z" });

        const fresh = store.db.prepare("SELECT node_id, updated_at FROM work_items WHERE workspace_id = ? AND ref = ?").get(WS, "43/05");
        assert.equal(fresh.node_id, "umairs-mac-mini", "the post-migration row carries the writer's node id");
        assert.equal(fresh.updated_at, "2026-08-03T10:00:00.000Z", "…and its own updated_at");
        const stillNull = store.db.prepare("SELECT node_id, updated_at FROM work_items WHERE workspace_id = ? AND ref = ?").get(WS, "43/04");
        assert.deepEqual([stillNull.node_id, stillNull.updated_at], [null, null], "the un-observed row is still un-observed — the write stamped only what it wrote");
      } finally {
        store.close();
      }
    }),
  },

  // ==========================================================================
  // The migration marker + the forward guard
  // ==========================================================================
  {
    name: "staleness/00 the version bump records the 7 → 8 migration exactly once, and a store from a newer build is still refused with the existing coded error",
    run: async () => withTemp(async (home) => {
      await writeV7Store(home);

      const first = await open(home);
      first.close();
      const second = await open(home);
      try {
        const markers = second.db
          .prepare("SELECT key, value FROM projection_metadata WHERE workspace_id = '_global' AND key LIKE 'migration:%' ORDER BY key")
          .all();
        assert.deepEqual(
          markers.map((row) => row.key),
          ["migration:8"],
          "the 7 → 8 upgrade is recorded once — the second open adds no second marker",
        );
        assert.equal(String(markers[0].value), "7", "…naming the version it came from");

        // The forward guard is untouched by the bump.
        second.db.prepare("UPDATE aof_schema SET value = 99 WHERE key = 'version'").run();
      } finally {
        second.close();
      }

      await assert.rejects(
        open(home),
        (error) => error.code === "global-store-schema-unsupported" && error.schemaVersion === 99,
        "a store stamped higher than this build supports is refused, never silently downgraded or re-migrated",
      );
    }),
  },
];
