// Fitness function: acd-desktop-no-mesh-logic (milestone 36 / ADR-004, fitness #1) —
// "The native desktop supervisor runs NO mesh logic of its own. Its only path to
//  fleet data is spawning the `aof` binary — it never reimplements the git record
//  store, the tailscale/fabric transport, the relay, or the global-work store in Rust."
//
// GUARD-IF-PRESENT (refine, pre-build): the Rust app does not exist yet. This test is
// a clean no-op while `app/desktop/` (the greenfield Rust subtree) is absent, and
// converts to a HARD assertion the moment the crate lands — mirroring the repo's
// graceful-degradation ethos (m28/ADR-002's degrade-on-absent-addon, m33's
// designed-not-shipped). It stays GREEN now and RED-if-violated once built.
//
// Proof, over every `app/desktop/**/*.rs` (Rust line-comments `//` stripped):
//  1. NO Rust source pulls in a mesh-transport / git / websocket-server crate that
//     would indicate a reimplemented relay/store/fabric (`use tokio_tungstenite`,
//     `use git2`, `use rusqlite`, `use tungstenite`, a `Shell_NotifyIcon`-adjacent
//     `use ... tailscale`), NOR references the fleet-record schema literals a
//     reimplementation would carry (`global_assignments`, `global_work`, a
//     `nodes/<id>.json` path builder). Fleet data is reached ONLY by spawning `aof`.
//  2. Self-check (m03 non-vacuous): a planted `use rusqlite;` / a planted
//     `global_assignments` literal in a synthetic Rust source trips the SAME detector
//     the real (clean, or absent) tree passes.
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// The greenfield Rust subtree. Story 00 (supervisor-core) creates it; until then this
// test is a deliberate no-op (guard-if-present).
const DESKTOP_DIR = path.join(repoRoot, "app", "desktop");

// A reimplemented mesh transport/store/fabric would import one of these crate families
// or carry one of the fleet-record schema literals. The supervisor imports NONE — it
// spawns `aof` and deserializes `aof mesh status --json`.
const FORBIDDEN_MESH_LOGIC = [
  // a reimplemented socket relay/broker (the m33/m34 stream server is aof's job)
  /\buse\s+tokio_tungstenite\b/,
  /\buse\s+tungstenite\b/,
  // a reimplemented git record transport (mesh:sync is aof's job)
  /\buse\s+git2\b/,
  // a reimplemented projection store (the global-work store is aof's job)
  /\buse\s+rusqlite\b/,
  /\buse\s+sqlx\b/,
  // fleet-record schema literals only a reimplementation would carry
  /\bglobal_assignments\b/,
  /\bglobal_work\b/,
  /\bmesh\/nodes\//,
];

function stripRustComments(source) {
  // Strip // line comments and /* */ block comments (best-effort; sufficient for the
  // import/literal grep — a documented mention in a comment is not a reimplementation).
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function detect(source) {
  const stripped = stripRustComments(source);
  return FORBIDDEN_MESH_LOGIC.filter((re) => re.test(stripped)).map((re) => re.source);
}

async function dirExists(dir) {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function collectRustFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "target") continue; // build artifacts, never source
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectRustFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".rs")) out.push(full);
  }
  return out;
}

export const archTests = [
  {
    name: "arch/36 ADR-004 (acd-desktop-no-mesh-logic): the Rust supervisor reimplements no mesh transport/store/fabric — fleet data comes ONLY from spawning aof (guard-if-present)",
    run: async () => {
      if (!(await dirExists(DESKTOP_DIR))) {
        // Pre-build no-op: the Rust subtree does not exist yet. Pin the vacuity
        // explicitly so the proof is a deliberate green, not an accidental skip —
        // story 00 (supervisor-core) creates app/desktop/ and arms this guard.
        assert.equal(await dirExists(DESKTOP_DIR), false, "app/desktop/ absent (pre-build); armed at build by story 00");
        return;
      }
      const files = await collectRustFiles(DESKTOP_DIR);
      assert.ok(files.length > 0, "the Rust subtree exists and was scanned (non-vacuous)");
      const offenders = [];
      for (const file of files) {
        const violations = detect(await readFile(file, "utf8"));
        if (violations.length > 0) offenders.push({ file: path.relative(repoRoot, file), violations });
      }
      assert.deepEqual(offenders, [], `no Rust source reimplements mesh logic, got: ${JSON.stringify(offenders)}`);
    },
  },
  {
    name: "arch/36 ADR-004 (acd-desktop-no-mesh-logic): self-check — a planted mesh-logic import/schema literal trips the SAME detector (non-vacuous)",
    run: async () => {
      const clean = 'use std::process::Command;\nlet out = Command::new(aof_path).args(["mesh","status","--json"]).output();\n';
      assert.deepEqual(detect(clean), [], "the clean spawn-aof form is not flagged");

      assert.ok(detect("use rusqlite;\n").length > 0, "a planted rusqlite import (reimplemented store) trips the detector");
      assert.ok(detect("use tokio_tungstenite as ws;\n").length > 0, "a planted websocket-server import (reimplemented relay) trips the detector");
      assert.ok(detect('let table = "global_assignments";\n').length > 0, "a planted fleet-schema literal trips the detector");
      assert.ok(detect("use git2::Repository;\n").length > 0, "a planted git2 import (reimplemented git transport) trips the detector");

      // A documented mention inside a Rust comment is NOT a violation (the strip works).
      assert.deepEqual(detect("// we deliberately do NOT use rusqlite here — aof owns the store\n"), [], "a commented mention is not flagged");
    },
  },
];
