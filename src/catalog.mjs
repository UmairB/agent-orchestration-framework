import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaultDbPath } from "./paths.mjs";

export const BUILTIN_ITEMS = [
  {
    id: "project-context",
    kind: "skill",
    name: "project-context",
    description: "Shared project context for assistant coding sessions.",
    body: "Read the repository before changing code. Prefer existing project patterns, keep edits scoped, and verify behavior with the narrowest meaningful checks.",
    runtimes: ["claude", "codex"],
    defaultEnabled: true
  },
  {
    id: "prime",
    kind: "command",
    name: "prime",
    description: "Prime the assistant with repository context.",
    body: "Inspect the repository structure, identify the stack, summarize the main modules, and call out anything risky before making changes.",
    runtimes: ["claude", "codex"],
    defaultEnabled: true
  },
  {
    id: "code-reviewer",
    kind: "agent",
    name: "code-reviewer",
    description: "Reviews changes for bugs, regressions, and missing verification.",
    body: "Review the diff from a senior engineering perspective. Lead with concrete findings using file and line references, then summarize residual risk.",
    runtimes: ["claude", "codex"],
    defaultEnabled: false
  },
  {
    id: "gsd",
    kind: "framework",
    name: "GSD",
    description: "Install GSD's current assistant framework package through its npm installer.",
    body: "",
    source: "npm:get-shit-done-cc@latest",
    runtimes: ["claude", "codex"],
    defaultEnabled: false
  }
];

export async function openCatalog(options = {}) {
  const dbPath = defaultDbPath(options);
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  migrate(db);
  return new Catalog(db, dbPath);
}

class Catalog {
  constructor(db, dbPath) {
    this.db = db;
    this.path = dbPath;
  }

  close() {
    this.db.close();
  }

  seedBuiltins() {
    const insert = this.db.prepare(`
      INSERT INTO catalog_items
        (id, kind, name, description, body, source, runtimes_json, default_enabled)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        name = excluded.name,
        description = excluded.description,
        body = excluded.body,
        source = excluded.source,
        runtimes_json = excluded.runtimes_json,
        default_enabled = excluded.default_enabled,
        updated_at = datetime('now')
    `);

    this.db.exec("BEGIN");
    try {
      for (const item of BUILTIN_ITEMS) {
        insert.run(
          item.id,
          item.kind,
          item.name,
          item.description,
          item.body,
          item.source ?? "builtin",
          JSON.stringify(item.runtimes),
          item.defaultEnabled ? 1 : 0
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listItems() {
    return this.db.prepare(`
      SELECT id, kind, name, description, body, source, runtimes_json, default_enabled
      FROM catalog_items
      ORDER BY kind, id
    `).all().map(rowToItem);
  }

  getItems(ids) {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    return this.db.prepare(`
      SELECT id, kind, name, description, body, source, runtimes_json, default_enabled
      FROM catalog_items
      WHERE id IN (${placeholders})
      ORDER BY kind, id
    `).all(...ids).map(rowToItem);
  }

  upsertItem(item) {
    this.db.prepare(`
      INSERT INTO catalog_items
        (id, kind, name, description, body, source, runtimes_json, default_enabled)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        name = excluded.name,
        description = excluded.description,
        body = excluded.body,
        source = excluded.source,
        runtimes_json = excluded.runtimes_json,
        default_enabled = excluded.default_enabled,
        updated_at = datetime('now')
    `).run(
      item.id,
      item.kind,
      item.name ?? item.id,
      item.description ?? "",
      item.body ?? "",
      item.source ?? "user",
      JSON.stringify(item.runtimes ?? ["claude", "codex"]),
      item.defaultEnabled ? 1 : 0
    );
  }

  defaultItems() {
    return this.db.prepare(`
      SELECT id, kind, name, description, body, source, runtimes_json, default_enabled
      FROM catalog_items
      WHERE default_enabled = 1
      ORDER BY kind, id
    `).all().map(rowToItem);
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('skill', 'command', 'agent', 'framework')),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'builtin',
      runtimes_json TEXT NOT NULL DEFAULT '["claude","codex"]',
      default_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile_items (
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (profile_id, item_id)
    );
  `);
}

function rowToItem(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    body: row.body,
    source: row.source,
    runtimes: JSON.parse(row.runtimes_json),
    defaultEnabled: Boolean(row.default_enabled)
  };
}

export function itemsToConfig(items) {
  return {
    name: "catalog-selection",
    resources: items.filter((item) => item.kind !== "framework").map((item) => ({
      kind: item.kind,
      id: item.id,
      name: item.name,
      description: item.description,
      runtimes: item.runtimes,
      body: item.body
    })),
    packages: items.filter((item) => item.kind === "framework").map((item) => ({
      id: item.id,
      source: item.source,
      runtimes: item.runtimes
    }))
  };
}
