#!/usr/bin/env node
// scripts/prune-projection.mjs — remove garbage rows from the global work projection.
//
// TECH_DEBT item 4 fallout (2026-07-26): daemons launched from a non-workspace cwd
// published phantom "workspaces" (C:\WINDOWS\system32, ~/.aof/bin) into the live
// projection, and past unisolated test runs left fixture node records
// (control-node/worker-node/solo-node, stamped with the tests' fake clock). The
// publish gate now refuses the phantom class at the source
// (meshGlobalPropagationDecision's mesh-workspace-unconfigured arm); this script is
// the RECOVERY tool for rows that already landed.
//
//   node scripts/prune-projection.mjs --workspace <id> [--workspace <id>…]
//                                     --node <id> [--node <id>…]
//                                     [--apply]
//
// DRY-RUN BY DEFAULT: prints exactly what would be deleted, per table. --apply
// performs the deletion in one transaction. Only explicit ids are ever touched —
// there is no pattern matching and no "clean everything" mode.
import path from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import os from "node:os";

const WORKSPACE_TABLES = [
  "workspaces",
  "global_workspace_descriptors",
  "global_node_workspaces",
  "projection_metadata",
  "projection_errors",
  "work_items",
  "work_item_docs",
  "work_item_runs",
];

function parseArgs(argv) {
  const o = { workspaces: [], nodes: [], apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--workspace" && argv[i + 1]) o.workspaces.push(argv[++i]);
    else if (argv[i] === "--node" && argv[i + 1]) o.nodes.push(argv[++i]);
    else if (argv[i] === "--apply") o.apply = true;
    else { console.error(`Unknown argument: ${argv[i]}`); process.exit(1); }
  }
  if (o.workspaces.length === 0 && o.nodes.length === 0) {
    console.error("Nothing to prune — pass --workspace <id> and/or --node <id>.");
    process.exit(1);
  }
  return o;
}

function globalHome() {
  return process.env.AOF_GLOBAL_HOME ? path.resolve(process.env.AOF_GLOBAL_HOME) : path.join(os.homedir(), ".aof");
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const home = globalHome();
  const dbPath = path.join(home, "mesh", "work", "projection.sqlite");
  if (!existsSync(dbPath)) {
    console.error(`No projection database at ${dbPath}.`);
    process.exit(1);
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  const mode = o.apply ? "DELETE" : "DRY-RUN";
  console.log(`${mode} against ${dbPath}`);

  const actions = [];
  for (const ws of o.workspaces) {
    for (const table of WORKSPACE_TABLES) {
      const n = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE workspace_id = ?`).get(ws).c;
      if (n > 0) actions.push({ kind: "sql", table, column: "workspace_id", id: ws, count: n });
    }
    const descriptorFile = path.join(home, "mesh", "workspaces", `${ws}.json`);
    if (existsSync(descriptorFile)) actions.push({ kind: "file", path: descriptorFile, id: ws });
  }
  for (const node of o.nodes) {
    for (const table of ["global_nodes", "global_node_workspaces"]) {
      const n = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE node_id = ?`).get(node).c;
      if (n > 0) actions.push({ kind: "sql", table, column: "node_id", id: node, count: n });
    }
    const presenceFile = path.join(home, "mesh", "nodes", `${node}.json`);
    if (existsSync(presenceFile)) actions.push({ kind: "file", path: presenceFile, id: node });
  }

  if (actions.length === 0) {
    console.log("Nothing matches — the projection holds no rows/files for the given ids.");
    db.close();
    return;
  }
  for (const a of actions) {
    if (a.kind === "sql") console.log(`  ${a.table}: ${a.count} row(s) for ${a.id}`);
    else console.log(`  file: ${a.path}`);
  }

  if (!o.apply) {
    console.log("\nDry-run only. Re-run with --apply to delete the above.");
    db.close();
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const a of actions) {
      if (a.kind !== "sql") continue;
      db.prepare(`DELETE FROM ${a.table} WHERE ${a.column} = ?`).run(a.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  db.close();
  for (const a of actions) {
    if (a.kind === "file") unlinkSync(a.path);
  }
  console.log("\nDeleted.");
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
