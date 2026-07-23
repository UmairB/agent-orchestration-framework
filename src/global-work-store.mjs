import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { globalMeshPaths } from "./workspace.mjs";
import { listItems, parseFrontmatter, recordDoc } from "./work.mjs";

export const GLOBAL_WORK_SCHEMA_VERSION = 4;

export function globalStoreError(message, code, status = 500, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

export function workspaceIdFor(projectRoot) {
  const resolved = path.resolve(projectRoot ?? "");
  return createHash("sha256").update(resolved.toLowerCase()).digest("hex").slice(0, 16);
}

export async function openGlobalWorkProjectionStore(options = {}) {
  const paths = options.paths ?? globalMeshPaths(options);
  const sqlite = await resolveSqlite(options);

  await mkdir(paths.workRoot, { recursive: true });
  const db = new sqlite.DatabaseSync(paths.databasePath);
  try {
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
    } catch {
      // Closing a failed open is best-effort; the original error is the contract.
    }
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
        session_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_global_assignments_item ON global_assignments(workspace_id, item_ref);
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
    const hasSessionIdColumn = db.prepare("PRAGMA table_info(global_assignments)").all()
      .some((column) => column.name === "session_id");
    if (!hasSessionIdColumn) {
      db.exec("ALTER TABLE global_assignments ADD COLUMN session_id TEXT");
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

export async function publishWorkspaceSnapshot(store, workspace, options = {}) {
  const db = store.db;
  const now = options.now ?? new Date().toISOString();
  const projectRoot = path.resolve(workspace.projectRoot);
  const workDir = path.resolve(workspace.workDir);
  const workspaceId = options.workspaceId ?? workspace.config?.mesh?.workspaceId ?? workspaceIdFor(projectRoot);
  // review fix P2.10: readWorkspaceProjectionItems(workspace) takes ONE argument
  // (its own doc-comment: "signature UNCHANGED") — the dead `{ now }` 2nd arg was
  // never read by the function and is dropped here to match.
  const items = options.items ?? await readWorkspaceProjectionItems(workspace);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO workspaces (workspace_id, project_root, work_dir, name, last_published_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        project_root = excluded.project_root,
        work_dir = excluded.work_dir,
        name = excluded.name,
        last_published_at = excluded.last_published_at
    `).run(workspaceId, projectRoot, workDir, workspace.config?.name ?? null, now);

    db.prepare("DELETE FROM work_items WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM projection_errors WHERE workspace_id = ?").run(workspaceId);

    const insertItem = db.prepare(`
      INSERT INTO work_items (workspace_id, ref, type, slug, status, title, parent, source_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items.rows) {
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
    skipped: items.errors.length,
    publishedAt: now,
  };
}

export function recordWorkspaceProjectionError(store, workspace, error, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const projectRoot = path.resolve(workspace.projectRoot);
  const workDir = path.resolve(workspace.workDir);
  const workspaceId = options.workspaceId ?? workspace.config?.mesh?.workspaceId ?? workspaceIdFor(projectRoot);
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
