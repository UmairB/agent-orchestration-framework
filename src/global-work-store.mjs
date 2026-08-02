import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { globalMeshPaths } from "./workspace.mjs";
import { listItems, parseFrontmatter, recordDoc } from "./work.mjs";
// schema v5 (TECH_DEBT item 6 — finish the board bridge): the worker-side content
// reader (readWorkspaceContentRecords, below) reuses the run store's own reader so a
// streamed run record is byte-identical to what `work:run-status` reads locally.
// run-store.mjs imports no store/mesh module — no cycle.
import { readRuns } from "./run-store.mjs";

export const GLOBAL_WORK_SCHEMA_VERSION = 7;

// The record docs a board/CLI face may request by NAME (work:doc's input contract)
// and therefore exactly the doc bodies a worker streams for its active worktree —
// ONE home for the set, imported by commands/doc.mjs and the content reader below,
// so the streamed set and the requestable set can never drift.
export const WORK_ITEM_DOC_FILES = {
  SPEC: "SPEC.md",
  STORY: "STORY.md",
  VERIFICATION: "VERIFICATION.md",
  RETROSPECTIVE: "RETROSPECTIVE.md",
};

export function globalStoreError(message, code, status = 500, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

// m42 wave (b) / item 4 — the derivation moved to its ONE home
// (workspace-identity.mjs); re-exported here so every existing import keeps
// working byte-identically. New callers use resolveWorkspaceId (the one
// precedence), never a hand-spelled `?? workspaceIdFor(...)` fallback.
import { workspaceIdFromPath, resolveWorkspaceId } from "./workspace-identity.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";
// m42 wave (d) leg d5 — the store classification (fact | projection | meta) is
// executable data, not a warning comment: the wholesale-delete guard below and
// the ref-remap table derivation both read it.
import { tableClass, refRemapTables } from "./effects/stores.mjs";
// m43 / ADR-003 — the AUTOMATIC half of the item lock. An operator verb onto a held
// item is refused, coded, loud; this periodic tick asked nothing, so it steps over the
// rows it does not own and COUNTS the skips in its result. Read from the leaf that owns
// every `global_assignments` read (assignment-record.mjs imports 0 — no cycle back
// through the lock module or the publisher seam).
import { activeScopeHolders, executionScopeRef } from "./assignment-record.mjs";
export const workspaceIdFor = workspaceIdFromPath;

// wholesaleDelete(db, table, workspaceId) — the ONLY sanctioned way this module
// sweeps a workspace's rows from a table (m42 wave (d) leg d5). A wholesale
// DELETE is a projection-rebuild move: on a fact table it would destroy
// unrecoverable dispatch/streamed state (the exact accident the old "MUST NEVER
// touch" comments warned about), so a misclassified call throws BEFORE the
// statement runs — schema-level gating, not prose.
function wholesaleDelete(db, table, workspaceId) {
  const cls = tableClass(table);
  if (cls !== "projection") {
    throw globalStoreError(
      `Refusing wholesale delete of ${table} — classified "${cls}" (only projection tables are rebuilt by sweep).`,
      "fact-table-wholesale-delete",
      500,
    );
  }
  db.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).run(workspaceId);
}

// applyConcurrencyPragmas(db) — m42, the measured `database is locked` residual
// (STATE 2026-07-27: CONTINUOUS, every ~5s post-restart). This store is opened by
// several processes at once — the desktop's status poll, the board's in-flight
// re-poll, the serve daemon's write ticks and every CLI invocation — and it was
// opened with NO pragmas at all: `journal_mode: delete`, where one writer locks
// out every reader and a colliding tick fails IMMEDIATELY rather than waiting.
// Write ticks retried on the next cycle so nothing was lost, but any tick could
// silently skip a beat.
//
// Two pragmas, addressing the two halves:
//   WAL          — readers no longer block the writer and the writer no longer
//                  blocks readers, which is the collision itself. Persistent in
//                  the file header (an older aof build opening it reads WAL fine),
//                  and this database is always on a local filesystem — the mesh
//                  root under AOF_GLOBAL_HOME — which is WAL's one requirement.
//   busy_timeout — the residual case WAL cannot remove (two WRITERS). 2s of
//                  waiting instead of an instant throw; the effects journal
//                  (effects/journal.mjs) has had exactly this from birth, and the
//                  projection it sits beside never did.
//
// Deliberately NOT hoisted into a shared helper with the journal's: the value is
// a per-store tuning decision, not one fact with two homes.
function applyConcurrencyPragmas(db) {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 2000");
}

export async function openGlobalWorkProjectionStore(options = {}) {
  const paths = options.paths ?? globalMeshPaths(options);
  const sqlite = await resolveSqlite(options);

  await mkdir(paths.workRoot, { recursive: true });
  const db = new sqlite.DatabaseSync(paths.databasePath);
  try {
    applyConcurrencyPragmas(db);
    const existing = readSchemaVersion(db);
    if (existing != null && existing > GLOBAL_WORK_SCHEMA_VERSION) {
      throw globalStoreError(
        `Global work projection schema ${existing} is newer than this AOF build supports (${GLOBAL_WORK_SCHEMA_VERSION}) at ${paths.databasePath}.`,
        "global-store-schema-unsupported",
        409,
        { path: paths.databasePath, schemaVersion: existing },
      );
    }

    migrateSchema(db, existing);
    return {
      db,
      paths,
      schemaVersion: GLOBAL_WORK_SCHEMA_VERSION,
      close: () => db.close(),
      publishWorkspaceSnapshot: (workspace, publishOptions = {}) => publishWorkspaceSnapshot({ db, paths }, workspace, publishOptions),
      query: (queryOptions = {}) => queryGlobalWorkProjection({ db, paths }, queryOptions),
    };
  } catch (error) {
    try {
      db.close();
    } catch (error) {
      // Closing a failed open is best-effort; the original error is the contract.
      reportDegrade("global-work-store", error); }
    throw error;
  }
}

async function resolveSqlite(options) {
  if (options.sqlite === false) {
    throw globalStoreError(
      "The global work projection requires a supported SQLite runtime.",
      "sqlite-unavailable",
      501,
    );
  }
  if (options.sqlite) return options.sqlite;
  try {
    const sqlite = await import("node:sqlite");
    if (typeof sqlite.DatabaseSync !== "function") throw new Error("DatabaseSync unavailable");
    return sqlite;
  } catch {
    throw globalStoreError(
      "The global work projection requires a supported SQLite runtime.",
      "sqlite-unavailable",
      501,
    );
  }
}

function readSchemaVersion(db) {
  const hasSchema = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'aof_schema'").get();
  if (!hasSchema) return null;
  const row = db.prepare("SELECT value FROM aof_schema WHERE key = 'version'").get();
  if (row == null) return 0;
  const version = Number.parseInt(String(row.value), 10);
  return Number.isFinite(version) ? version : 0;
}

function migrateSchema(db, existingVersion) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS aof_schema (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        project_root TEXT NOT NULL,
        work_dir TEXT NOT NULL,
        name TEXT,
        last_published_at TEXT
      );
      CREATE TABLE IF NOT EXISTS work_items (
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
      CREATE INDEX IF NOT EXISTS idx_work_items_workspace ON work_items(workspace_id);
      CREATE TABLE IF NOT EXISTS projection_metadata (
        workspace_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at TEXT,
        PRIMARY KEY (workspace_id, key)
      );
      CREATE TABLE IF NOT EXISTS projection_errors (
        workspace_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        message TEXT NOT NULL,
        code TEXT,
        occurred_at TEXT,
        PRIMARY KEY (workspace_id, source_path)
      );
      CREATE TABLE IF NOT EXISTS global_nodes (
        node_id TEXT PRIMARY KEY,
        role TEXT,
        control_node INTEGER NOT NULL DEFAULT 0,
        host TEXT,
        os TEXT,
        runtimes_json TEXT NOT NULL DEFAULT '[]',
        skills_json TEXT NOT NULL DEFAULT '[]',
        aof_version TEXT,
        published_at TEXT,
        last_seen_at TEXT,
        fabric_address TEXT,
        fabric_online INTEGER,
        record_source TEXT,
        descriptor_path TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS global_workspace_descriptors (
        workspace_id TEXT PRIMARY KEY,
        project_root TEXT NOT NULL,
        work_dir TEXT NOT NULL,
        name TEXT,
        mesh_enabled INTEGER NOT NULL DEFAULT 0,
        control_node TEXT,
        member_node_ids_json TEXT NOT NULL DEFAULT '[]',
        published_at TEXT,
        descriptor_path TEXT NOT NULL,
        clone_url TEXT
      );
      CREATE TABLE IF NOT EXISTS global_node_workspaces (
        node_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        PRIMARY KEY (node_id, workspace_id)
      );
      CREATE INDEX IF NOT EXISTS idx_global_node_workspaces_workspace ON global_node_workspaces(workspace_id);
      -- schema v3 (milestone 35 / story 00, ADR-001) — the assignment record is
      -- operator/worker-CREATED state, never a projection of any doc, so it is a
      -- NEW, ADDITIVE table that publishWorkspaceSnapshot (below) MUST NEVER touch —
      -- that DELETE-ALL-then-reinsert cycle would wipe a dispatch fact on the very
      -- next converge tick. Keyed by assignment_id (PRIMARY KEY); dedicated single-row
      -- writers (insertAssignment/updateAssignmentState, assignment-record.mjs) are the
      -- ONLY mutators. (mining prior-lesson R2/m20: the state column's SOLE producer
      -- per value is enforced by assignment-record.mjs's single source-of-truth enum,
      -- not by this schema — a frozen+classified column with no named writer is a
      -- contract hole; ADR-001 closes it at the enum, this table just carries it.)
      CREATE TABLE IF NOT EXISTS global_assignments (
        assignment_id TEXT PRIMARY KEY,
        item_ref TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        issuer TEXT NOT NULL,
        state TEXT NOT NULL,
        run_id TEXT,
        assigned_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        reclaimed_at TEXT,
        session_id TEXT,
        code TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_global_assignments_item ON global_assignments(workspace_id, item_ref);
      -- schema v5 (TECH_DEBT item 6 — finish the board bridge). Worker-STREAMED
      -- record-doc bodies + run records for items whose truth lives on another
      -- machine's worktree: the board's drill-downs (doc body, RUNS tab) read
      -- these when the ref does not resolve on the local disk, riding the SAME
      -- projection file the item rows already ride — never a git branch, never a
      -- new inter-process route. Like global_assignments, these are STREAM-written
      -- state that publishWorkspaceSnapshot (the DELETE-then-reinsert row publisher)
      -- MUST NEVER touch; applyWorktreeContentFrame's upsert is the only writer.
      CREATE TABLE IF NOT EXISTS work_item_docs (
        workspace_id TEXT NOT NULL,
        ref TEXT NOT NULL,
        doc TEXT NOT NULL,
        body TEXT NOT NULL,
        node_id TEXT,
        updated_at TEXT,
        PRIMARY KEY (workspace_id, ref, doc)
      );
      CREATE TABLE IF NOT EXISTS work_item_runs (
        workspace_id TEXT NOT NULL,
        ref TEXT NOT NULL,
        run_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        node_id TEXT,
        updated_at TEXT,
        PRIMARY KEY (workspace_id, ref, run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_work_item_runs_ref ON work_item_runs(workspace_id, ref);
      -- schema v6 (m42 wave (a) follow-up, TECH_DEBT item 2's REMOTE read): a
      -- worker's log events stream up its existing connection and land here, so
      -- \`aof mesh logs --node <id>\` answers from the control's own store — no SSH,
      -- no request/reply round-trip. Ring-bounded by the applier (newest
      -- NODE_LOG_KEEP rows per node); stream-written, never touched by the row
      -- publisher (the global_assignments discipline).
      CREATE TABLE IF NOT EXISTS node_logs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        at TEXT,
        level TEXT,
        code TEXT,
        message TEXT,
        path TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_node_logs_node ON node_logs(node_id, seq);
    `);

    // schema v4 (milestone 38 / ADR-010 Gap A, extended) — CREATE TABLE IF NOT
    // EXISTS above never adds a column to an ALREADY-EXISTING table (every
    // pre-v4 database on a real machine already has global_workspace_descriptors
    // with no clone_url). An explicit, idempotent ALTER TABLE closes that: a
    // worker that has never checked out a workspace has no local config to read
    // config.mesh.repo.cloneUrl from — clone-on-miss was structurally unable to
    // resolve a clone source for any workspace but the worker's own launch one,
    // found live on the FIRST real cross-machine dispatch this mechanism ever ran.
    const hasCloneUrlColumn = db.prepare("PRAGMA table_info(global_workspace_descriptors)").all()
      .some((column) => column.name === "clone_url");
    if (!hasCloneUrlColumn) {
      db.exec("ALTER TABLE global_workspace_descriptors ADD COLUMN clone_url TEXT");
    }

    // milestone 38 / story 06 / task 04 (BLOCKER F-38.06c; ADR-013 + ADR-014
    // invariant 4) — the SAME idempotent, PRAGMA-checked ALTER TABLE idiom as
    // clone_url above, for the assignment record's `session_id`. ADR-013 says the
    // captured `session_id` is "surfaced on the assignment record"; it was being
    // dropped at the control node (the worker DOES send it on its
    // assignment-status frame), so the fleet had no (nodeId, sessionId) join key
    // to open a terminal-VIEW with. The column is the join key's home.
    //
    // Why an explicit ALTER and not just the CREATE TABLE column above: every
    // pre-v4-era database ALREADY on a real machine has a global_assignments
    // table, and `CREATE TABLE IF NOT EXISTS` never adds a column to an existing
    // table. The migration is IN PLACE — the table is never dropped, recreated,
    // or wiped, so a live fleet's dispatch history survives the upgrade (an
    // assignment row is operator/worker-CREATED state, unrecoverable if lost).
    const assignmentColumns = db.prepare("PRAGMA table_info(global_assignments)").all();
    const hasSessionIdColumn = assignmentColumns.some((column) => column.name === "session_id");
    if (!hasSessionIdColumn) {
      db.exec("ALTER TABLE global_assignments ADD COLUMN session_id TEXT");
    }
    // schema v7 (m42 interactive worker terminals) — the status-refinement `code`
    // a worker's assignment-status frame carries (today: `needs-input`), persisted
    // so the board/fleet can RENDER a session waiting on a human (the code used to
    // ride the frame and die there). Same in-place ALTER discipline as session_id.
    const hasCodeColumn = assignmentColumns.some((column) => column.name === "code");
    if (!hasCodeColumn) {
      db.exec("ALTER TABLE global_assignments ADD COLUMN code TEXT");
    }

    if (existingVersion != null && existingVersion < GLOBAL_WORK_SCHEMA_VERSION) {
      db.prepare(`
        INSERT OR REPLACE INTO projection_metadata (workspace_id, key, value, updated_at)
        VALUES ('_global', ?, ?, ?)
      `).run(`migration:${GLOBAL_WORK_SCHEMA_VERSION}`, String(existingVersion), new Date().toISOString());
    }

    db.prepare("INSERT OR REPLACE INTO aof_schema (key, value) VALUES ('version', ?)").run(GLOBAL_WORK_SCHEMA_VERSION);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// The insert/reindex ref-remap, SPLIT BY LOCUS (m42 wave (d) leg d5 — the split
// port 3 deferred). The table lists derive from the store classification
// (effects/stores.mjs `refRemap` rows — the ONE home): the worker-streamed
// mirrors (`work_item_docs`/`work_item_runs`) are this node's own rows and
// rewrite at `local`; the dispatch facts (`global_assignments`/
// `global_item_branches`) belong to the authoritative mesh store's writer and
// rewrite at `control-store` — paid by the control daemon's converge tick in
// place, or arriving over the d3 bridge when the reindex ran on another machine
// (which is why that reactor keys by the payload's own workspaceId, never a
// path this machine may not have). `work_items` is deliberately in NEITHER
// list: a pure projection is rebuilt by the publish reactor, not patched.
//
// A remap is a PERMUTATION (`{03→04, 04→05}`), so it is applied in the order the
// engine hands it over — descending by the number that moved, so no update ever
// writes onto a ref another entry has yet to vacate — inside ONE transaction, and
// EVENT-ID DEDUPED (the reactor contract's sanctioned alternative to idempotence):
// a redelivered event finds its id already stamped and does nothing, because
// applying the permutation twice would shift every row a second time. The two
// halves stamp SEPARATE watermarks (`lastReindexEventId` / the facts key below)
// because they drain independently — a control tick paying the facts hours after
// the CLI paid the mirrors must not see the other half's stamp and skip.
function remapRefKeyedTables(store, workspaceId, remap, tables, stampKey, { eventId = null, now } = {}) {
  if (!Array.isArray(remap) || remap.length === 0) return { remapped: 0, skipped: true, reason: "empty-remap" };
  const db = store.db;
  const stamp = now ?? new Date().toISOString();

  const applied = db
    .prepare("SELECT value FROM projection_metadata WHERE workspace_id = ? AND key = ?")
    .get(workspaceId, stampKey);
  if (eventId != null && applied?.value === eventId) {
    return { remapped: 0, skipped: true, reason: "already-applied" };
  }

  let remapped = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    const present = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
    );
    for (const { table, column } of tables) {
      // The side tables are created lazily by their own feature module (the
      // self-contained `CREATE TABLE IF NOT EXISTS` idiom), so a store that has
      // never seen a branch/assignment simply has nothing to remap there.
      if (!present.has(table)) continue;
      const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE workspace_id = ? AND ${column} = ?`);
      for (const { from, to } of remap) {
        remapped += update.run(to, workspaceId, from).changes ?? 0;
      }
    }
    if (eventId != null) {
      db.prepare(`
        INSERT OR REPLACE INTO projection_metadata (workspace_id, key, value, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(workspaceId, stampKey, eventId, stamp);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { remapped };
}

// The local half: the streamed-mirror rows of this node's own file. Keeps the
// port-3 stamp key, so a store that already applied a pre-split remap does not
// re-apply its mirror half on redelivery after an upgrade.
export function remapWorkspaceProjectionRefs(store, workspaceId, remap = [], options = {}) {
  return remapRefKeyedTables(store, workspaceId, remap, refRemapTables("local"), "lastReindexEventId", options);
}

// The control-store half: the dispatch facts of the authoritative mesh store.
export function remapWorkspaceFactRefs(store, workspaceId, remap = [], options = {}) {
  return remapRefKeyedTables(store, workspaceId, remap, refRemapTables("control-store"), "lastReindexFactsEventId", options);
}

export async function publishWorkspaceSnapshot(store, workspace, options = {}) {
  const db = store.db;
  const now = options.now ?? new Date().toISOString();
  const projectRoot = path.resolve(workspace.projectRoot);
  const workDir = path.resolve(workspace.workDir);
  const workspaceId = resolveWorkspaceId(workspace, { override: options.workspaceId });
  // review fix P2.10: readWorkspaceProjectionItems(workspace) takes ONE argument
  // (its own doc-comment: "signature UNCHANGED") — the dead `{ now }` 2nd arg was
  // never read by the function and is dropped here to match.
  const items = options.items ?? await readWorkspaceProjectionItems(workspace);

  // THE HELD-SCOPE CARRY (m43/ADR-003, PLACED by ADR-011/A1) — `diskDerived`.
  //
  // This function is NOT the tick: it is the shared row-writer, and its three callers
  // are the control's own publish (`global-work-publisher.mjs`) and the WORKER's two
  // frame doors (`control-stream-server.mjs`'s applySnapshotFrame / applyDeltaFrame).
  // The discriminator is therefore "whose slice is being written", never "what
  // triggered the write": a node publishing its OWN disk-derived slice may be made to
  // step over scopes it does not hold; a writer applying ANOTHER node's reported slice
  // is the holder's own voice and may never be filtered by the lock. Filtering it was
  // measured to discard the holder's authored delta — and its completion frame — for
  // the whole duration of a phase, which is ADR-004/D1's permanent-revert inverted.
  //
  // So the carry is OFF by default and set ONLY by the disk-derived path. A caller
  // supplying `options.items` from a frame is byte-unaffected.
  const diskDerived = options.diskDerived === true;
  const heldScopes = new Set();

  db.exec("BEGIN IMMEDIATE");
  try {
    // Both the held-scope lookup and the carry SELECT read INSIDE the transaction
    // (ADR-011/A1): read before `BEGIN IMMEDIATE` and a frame committing in that
    // window is seen stale and then written back over.
    const held = diskDerived ? activeScopeHolders(store, workspaceId) : new Map();
    const carried = held.size === 0
      ? []
      : db.prepare("SELECT ref, type, slug, status, title, parent, source_path FROM work_items WHERE workspace_id = ?")
        .all(workspaceId)
        .filter((row) => held.has(executionScopeRef(row.ref)));
    const carriedRefs = new Set(carried.map((row) => row.ref));
    for (const row of carried) heldScopes.add(executionScopeRef(row.ref));
    const publishable = [];
    for (const item of items.rows) {
      const scope = executionScopeRef(item.ref);
      // The carry protects a row that EXISTS from being overwritten by this node's own
      // stale disk. A ref the cache has never carried is not the holder's work yet — it
      // is an item nobody has reported, and dropping it would make a held item VANISH
      // from the read surface entirely, which is a worse lie than a stale row.
      if (held.has(scope) && carriedRefs.has(item.ref)) {
        heldScopes.add(scope);
        continue;
      }
      publishable.push(item);
    }

    db.prepare(`
      INSERT INTO workspaces (workspace_id, project_root, work_dir, name, last_published_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        project_root = excluded.project_root,
        work_dir = excluded.work_dir,
        name = excluded.name,
        last_published_at = excluded.last_published_at
    `).run(workspaceId, projectRoot, workDir, workspace.config?.name ?? null, now);

    wholesaleDelete(db, "work_items", workspaceId);
    wholesaleDelete(db, "projection_errors", workspaceId);

    const insertItem = db.prepare(`
      INSERT INTO work_items (workspace_id, ref, type, slug, status, title, parent, source_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // The carried rows first, byte-for-byte as they already were — the disk-derived
    // publish leaves the holder's work exactly as it found it.
    for (const row of carried) {
      insertItem.run(workspaceId, row.ref, row.type, row.slug, row.status, row.title, row.parent, row.source_path);
    }
    for (const item of publishable) {
      insertItem.run(
        workspaceId,
        item.ref,
        item.type,
        item.slug,
        item.status ?? null,
        item.title ?? null,
        item.parent ?? null,
        item.sourcePath,
      );
    }

    const insertError = db.prepare(`
      INSERT INTO projection_errors (workspace_id, source_path, message, code, occurred_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const error of items.errors) {
      insertError.run(workspaceId, error.sourcePath, error.message, error.code ?? null, now);
    }

    db.prepare(`
      INSERT OR REPLACE INTO projection_metadata (workspace_id, key, value, updated_at)
      VALUES (?, 'lastPublishedAt', ?, ?)
    `).run(workspaceId, now, now);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    workspaceId,
    itemCount: items.rows.length,
    // `skipped` counts PROJECTION ERRORS and always has — two different skips summed
    // into one number is a defect, not a variant (ADR-010/D1a), so the held-scope skip
    // gets its own ADDITIVE, distinctly-named counter with the refs listed beside it
    // so the count is explainable. Both count EXECUTION SCOPES stepped over, not rows:
    // held-ness is a scope property (the predicate is symmetric), and `heldRefs` names
    // the scopes so the number is always explainable by the list beside it. A frame
    // caller is never filtered, so both are 0/[] there.
    skipped: items.errors.length,
    heldSkipped: heldScopes.size,
    heldRefs: [...heldScopes].sort(),
    publishedAt: now,
  };
}

export function recordWorkspaceProjectionError(store, workspace, error, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const projectRoot = path.resolve(workspace.projectRoot);
  const workDir = path.resolve(workspace.workDir);
  const workspaceId = resolveWorkspaceId(workspace, { override: options.workspaceId });
  const sourcePath = normalizeSourcePath(options.sourcePath ?? workDir);

  store.db.prepare(`
    INSERT INTO workspaces (workspace_id, project_root, work_dir, name, last_published_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      project_root = excluded.project_root,
      work_dir = excluded.work_dir,
      name = excluded.name
  `).run(workspaceId, projectRoot, workDir, workspace.config?.name ?? null, now);

  store.db.prepare(`
    INSERT INTO projection_errors (workspace_id, source_path, message, code, occurred_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, source_path) DO UPDATE SET
      message = excluded.message,
      code = excluded.code,
      occurred_at = excluded.occurred_at
  `).run(workspaceId, sourcePath, error?.message ?? "Projection write failed.", error?.code ?? "projection-write-failed", now);
}

// readWorkspaceProjectionItems(workspace) — exported additively (milestone 34 / story
// 04) so the worker-stream client can build the SAME item-row shape a snapshot frame
// carries, without a second read/parse of the record docs. Signature/behaviour
// UNCHANGED for publishWorkspaceSnapshot's own internal call below.
export async function readWorkspaceProjectionItems(workspace) {
  const rows = [];
  const errors = [];
  for (const item of await listItems(workspace.workDir)) {
    const doc = recordDoc(item);
    if (!doc) continue;
    const sourcePath = normalizeSourcePath(path.join(item.dir, doc));
    try {
      const text = await readFile(path.join(item.dir, doc), "utf8");
      if (!/^---\r?\n[\s\S]*?\r?\n---/.test(text)) {
        throw globalStoreError(`Record doc has no parseable frontmatter: ${sourcePath}`, "frontmatter-unparseable", 422);
      }
      const meta = parseFrontmatter(text);
      rows.push({
        ref: item.ref,
        type: item.type,
        slug: item.slug,
        status: meta.status ?? null,
        title: meta.title ?? null,
        parent: item.parent,
        sourcePath,
      });
    } catch (error) {
      errors.push({
        sourcePath,
        message: error.message,
        code: error.code ?? "projection-read-failed",
      });
    }
  }
  return { rows, errors };
}

// readWorkspaceItems(store, workspaceId) — a thin accessor over the work_items
// table for exactly ONE workspace, in the { ref, type, slug, status, title,
// parent, sourcePath } row shape (review fix Craft: control-stream-server.mjs's
// applyDeltaFrame used to prepare its OWN raw SELECT against store.db directly;
// this accessor is the ONE read seam instead — still a READ, so it does not
// weaken acd-global-publisher-single-seam, which is scoped to the WRITE path
// (publishWorkspaceSnapshot/openGlobalWorkProjectionStore)).
export function readWorkspaceItems(store, workspaceId) {
  return store.db.prepare("SELECT * FROM work_items WHERE workspace_id = ? ORDER BY ref").all(workspaceId).map((row) => ({
    ref: row.ref,
    type: row.type,
    slug: row.slug,
    status: row.status,
    title: row.title,
    parent: row.parent,
    sourcePath: row.source_path,
  }));
}

// readWorkspaceContentRecords(workspace, { itemRef }) — the WORKER-side content read
// (schema v5, TECH_DEBT item 6): for every item in the workspace that belongs to
// `itemRef`'s subtree (the item, its milestone, the milestone's children — the SAME
// scoping rule the worktree delta rows use), collect the requestable record-doc
// bodies (WORK_ITEM_DOC_FILES) and the item's run records (run-store's own reader,
// so a streamed record is byte-identical to a local read). A missing doc file is
// absent-not-error (skipped); any OTHER read fault lands in `errors` for the caller
// to report — never swallowed, never fatal to the rest of the read.
export async function readWorkspaceContentRecords(workspace, { itemRef } = {}) {
  const docs = [];
  const runs = [];
  const errors = [];
  const milestone = typeof itemRef === "string" && itemRef.length > 0 ? itemRef.split("/")[0] : null;
  for (const item of await listItems(workspace.workDir)) {
    if (milestone != null
      && item.ref !== itemRef
      && item.ref !== milestone
      && String(item.parent ?? "") !== milestone) continue;
    for (const [doc, fileName] of Object.entries(WORK_ITEM_DOC_FILES)) {
      const filePath = path.join(item.dir, fileName);
      try {
        docs.push({ ref: item.ref, doc, body: await readFile(filePath, "utf8") });
      } catch (error) {
        if (error?.code !== "ENOENT") {
          errors.push({ sourcePath: normalizeSourcePath(filePath), message: error.message, code: error.code ?? "content-read-failed" });
        }
      }
    }
    try {
      for (const record of await readRuns(item)) {
        if (typeof record?.runId === "string" && record.runId.length > 0) {
          runs.push({ ref: item.ref, runId: record.runId, record });
        }
      }
    } catch (error) {
      errors.push({ sourcePath: normalizeSourcePath(path.join(item.dir, "runs")), message: error.message, code: error.code ?? "content-read-failed" });
    }
  }
  return { docs, runs, errors };
}

// upsertWorkItemContent(store, workspaceId, { docs, runs, nodeId }, { now }) — the
// ONE writer for the v5 content tables (the control node's applyWorktreeContentFrame
// call site). Upsert-only, per (ref, doc) / (ref, runId): a re-streamed body simply
// refreshes its row, and rows survive the worktree completing — the last streamed
// view keeps answering the board until the work lands locally. Malformed entries are
// screened here (the same completeness discipline applyDeltaFrame keeps for rows) so
// one bad entry can never abort the frame's other writes.
export function upsertWorkItemContent(store, workspaceId, { docs, runs, nodeId } = {}, { now } = {}) {
  const at = now ?? new Date().toISOString();
  const reporter = typeof nodeId === "string" && nodeId.length > 0 ? nodeId : null;
  const docRows = (Array.isArray(docs) ? docs : []).filter((entry) =>
    typeof entry?.ref === "string" && entry.ref.length > 0
    && typeof entry?.doc === "string" && entry.doc.length > 0
    && typeof entry?.body === "string");
  const runRows = (Array.isArray(runs) ? runs : []).filter((entry) =>
    typeof entry?.ref === "string" && entry.ref.length > 0
    && typeof entry?.runId === "string" && entry.runId.length > 0
    && entry?.record != null && typeof entry.record === "object");

  const db = store.db;
  db.exec("BEGIN IMMEDIATE");
  try {
    const upsertDoc = db.prepare(`
      INSERT INTO work_item_docs (workspace_id, ref, doc, body, node_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, ref, doc) DO UPDATE SET
        body = excluded.body,
        node_id = excluded.node_id,
        updated_at = excluded.updated_at
    `);
    for (const entry of docRows) {
      upsertDoc.run(workspaceId, entry.ref, entry.doc.toUpperCase(), entry.body, reporter, at);
    }
    const upsertRun = db.prepare(`
      INSERT INTO work_item_runs (workspace_id, ref, run_id, record_json, node_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, ref, run_id) DO UPDATE SET
        record_json = excluded.record_json,
        node_id = excluded.node_id,
        updated_at = excluded.updated_at
    `);
    for (const entry of runRows) {
      upsertRun.run(workspaceId, entry.ref, entry.runId, JSON.stringify(entry.record), reporter, at);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { published: true, workspaceId, docCount: docRows.length, runCount: runRows.length, skippedEntries: (Array.isArray(docs) ? docs.length : 0) - docRows.length + (Array.isArray(runs) ? runs.length : 0) - runRows.length };
}

// readWorkItemDoc(store, workspaceId, ref, doc) — the board-face read over
// work_item_docs. Null when nothing was ever streamed for that (ref, doc).
export function readWorkItemDoc(store, workspaceId, ref, doc) {
  const row = store.db.prepare(
    "SELECT body, node_id, updated_at FROM work_item_docs WHERE workspace_id = ? AND ref = ? AND doc = ?"
  ).get(workspaceId, ref, String(doc ?? "").toUpperCase());
  return row == null ? null : { ref, doc: String(doc ?? "").toUpperCase(), body: row.body, nodeId: row.node_id, updatedAt: row.updated_at };
}

// readWorkItemRuns(store, workspaceId, ref) — the board-face read over
// work_item_runs. Empty array when nothing was ever streamed; a torn record_json
// row is skipped (the run-store torn-file discipline, carried over).
export function readWorkItemRuns(store, workspaceId, ref) {
  const rows = store.db.prepare(
    "SELECT run_id, record_json, node_id, updated_at FROM work_item_runs WHERE workspace_id = ? AND ref = ? ORDER BY updated_at, run_id"
  ).all(workspaceId, ref);
  const out = [];
  for (const row of rows) {
    try {
      out.push({ record: JSON.parse(row.record_json), nodeId: row.node_id, updatedAt: row.updated_at });
    } catch (error) {
      // Torn/garbage record_json: skip the one bad row, keep the rest — the same
      // tolerance run-store's readRuns applies to a torn file on disk.
      reportDegrade("global-work-store", error); }
  }
  return out;
}

// The node_logs ring bound — newest rows kept per node (m42 / item 2 remote read).
export const NODE_LOG_KEEP = 500;

// appendNodeLogEntries(store, nodeId, entries, { keep }) — the ONE writer for the
// v6 node_logs table (the control's applyLogEntriesFrame call site). Appends, then
// ring-prunes to the newest `keep` rows for that node — bounded store, no reclaim
// job. Malformed entries are screened (the applyDeltaFrame completeness discipline).
export function appendNodeLogEntries(store, nodeId, entries, { keep = NODE_LOG_KEEP } = {}) {
  const rows = (Array.isArray(entries) ? entries : []).filter((entry) => entry != null && typeof entry === "object");
  const db = store.db;
  db.exec("BEGIN IMMEDIATE");
  try {
    const insert = db.prepare("INSERT INTO node_logs (node_id, at, level, code, message, path) VALUES (?, ?, ?, ?, ?, ?)");
    for (const entry of rows) {
      insert.run(
        nodeId,
        typeof entry.at === "string" ? entry.at : null,
        typeof entry.level === "string" ? entry.level : null,
        typeof entry.code === "string" ? entry.code : null,
        typeof entry.message === "string" ? entry.message : null,
        typeof entry.path === "string" ? entry.path : null,
      );
    }
    db.prepare(`
      DELETE FROM node_logs WHERE node_id = ? AND seq NOT IN (
        SELECT seq FROM node_logs WHERE node_id = ? ORDER BY seq DESC LIMIT ?
      )
    `).run(nodeId, nodeId, keep);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { appended: rows.length };
}

// readNodeLogEntries(store, nodeId, { tail }) — the reader half for
// `aof mesh logs --node <id>`: the newest `tail` entries, oldest-first.
export function readNodeLogEntries(store, nodeId, { tail = 200 } = {}) {
  return store.db.prepare(
    "SELECT at, level, code, message, path FROM node_logs WHERE node_id = ? ORDER BY seq DESC LIMIT ?"
  ).all(nodeId, tail).reverse();
}

export function queryGlobalWorkProjection(store, options = {}) {
  const db = store.db;
  const workspaceId = options.workspaceId ?? options.workspace ?? null;
  const workspaces = workspaceId
    ? db.prepare("SELECT * FROM workspaces WHERE workspace_id = ? ORDER BY workspace_id").all(workspaceId)
    : db.prepare("SELECT * FROM workspaces ORDER BY workspace_id").all();
  const items = workspaceId
    ? db.prepare("SELECT * FROM work_items WHERE workspace_id = ? ORDER BY workspace_id, ref").all(workspaceId)
    : db.prepare("SELECT * FROM work_items ORDER BY workspace_id, ref").all();
  const metadata = workspaceId
    ? db.prepare("SELECT * FROM projection_metadata WHERE workspace_id = ? ORDER BY workspace_id, key").all(workspaceId)
    : db.prepare("SELECT * FROM projection_metadata ORDER BY workspace_id, key").all();
  const errors = workspaceId
    ? db.prepare("SELECT * FROM projection_errors WHERE workspace_id = ? ORDER BY workspace_id, source_path").all(workspaceId)
    : db.prepare("SELECT * FROM projection_errors ORDER BY workspace_id, source_path").all();

  return {
    scope: workspaceId == null ? "global" : "workspace",
    workspaceId,
    workspaces: workspaces.map(mapWorkspaceRow),
    items: items.map(mapItemRow),
    metadata: metadata.map(mapMetadataRow),
    errors: errors.map(mapErrorRow),
  };
}

function mapWorkspaceRow(row) {
  return {
    workspaceId: row.workspace_id,
    projectRoot: row.project_root,
    workDir: row.work_dir,
    name: row.name,
    lastPublishedAt: row.last_published_at,
  };
}

function mapItemRow(row) {
  return {
    workspaceId: row.workspace_id,
    ref: row.ref,
    type: row.type,
    slug: row.slug,
    status: row.status,
    title: row.title,
    parent: row.parent,
    sourcePath: row.source_path,
  };
}

function mapMetadataRow(row) {
  return {
    workspaceId: row.workspace_id,
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  };
}

function mapErrorRow(row) {
  return {
    workspaceId: row.workspace_id,
    sourcePath: row.source_path,
    message: row.message,
    code: row.code,
    occurredAt: row.occurred_at,
  };
}

function normalizeSourcePath(sourcePath) {
  return path.resolve(sourcePath).replaceAll("\\", "/");
}
