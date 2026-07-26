// Fitness function: acd-active-runs-frozen-string-array
// (milestone 38 / ADR-004 AS-BUILT AMENDMENT + ADR-008)
//
// THE INVARIANT. `presence.activeRuns` on the wire is the FROZEN m23 `string[]` of
// bare run ids (23/ADR-002) — it carries NO per-run attribution (no `ref`, no
// `title`, no `workspaceId`). EVERY surface that consumes it — the JS render helper
// (ui/src/fleet/runs.mjs), the TS type surface (ui/src/fleet/api.ts), the RUST
// desktop view-model (app/desktop/crates/core/src) — must therefore treat an element
// as a bare STRING and MUST NOT index it as an object.
//
// WHY IT EXISTS. Two of milestone 38's verify findings are the SAME defect in two
// languages, both born of a consumer shaped to its own convenience instead of to the
// producer:
//   - F1 (JS)   — the first `acd-session-run-reconciliation` fed `fleetCurrentWorkLines`
//                 ATTRIBUTED RUN OBJECTS (`{ runId, workspaceId }`) and keyed the
//                 ADR-004 subsumption off `run.workspaceId`; the producer emits a bare
//                 `string[]`, so the collapse rule could never have fired in production.
//                 (Fixed by relocating subsumption upstream into
//                 `assembleCurrentPresenceRecord`, src/mesh-launcher.mjs.)
//   - F8 (Rust) — `view_model.rs` read the same key as objects (`.get("ref")` /
//                 `.get("title")`), so the desktop's current-work cell silently read
//                 empty against every real payload.
// A green suite proved nothing in either case: both consumers were exercised against a
// fixture only they produced.
//
// PROOFS (each detector is a PURE function over source text / a producer payload, so
// the real inputs and the planted violations go through the IDENTICAL code path):
//  1. PRODUCER (behavioural, real seam) — the REAL producer (`startSession` +
//     `assembleCurrentPresenceRecord` via `startLauncher`) emits `activeRuns` whose
//     every element is a `string`, inside the frozen five-key record. The shape is
//     read OFF THE PRODUCER, never asserted from a doc.
//  2. DECLARATION SITES (structural, cross-language) — every declared type of the key,
//     in every language, is a bare string array: TS `activeRuns: string[]`, Rust
//     `active_runs: Vec<String>`. A `Vec<Value>` / `{ ref, title }[]` declaration fails.
//  3. ELEMENT ACCESS (structural, cross-language) — no source binds an element of
//     `activeRuns`/`active_runs` (via map/filter/find/for-of/index, or Rust's
//     `.iter()` closure) and then reads an OBJECT FIELD off it (`.ref`, `.title`,
//     `.runId`, `.workspaceId`, `.get("ref")`, `["title"]`). This is the exact shape of
//     BOTH F1 and F8.
//  4. SELF-CHECK (non-vacuous) — planted violations in each language (a TS decl of
//     `{ ref: string }[]`, a Rust `Vec<serde_json::Value>` field, the verbatim F1 JS
//     line, the verbatim F8 Rust line) are each FLAGGED by the same detectors that
//     return zero violations for the real tree — and the real tree is proven non-empty
//     (declaration sites and consumer files actually exist), so the pass is not vacuous.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../src/work.mjs";
import { startLauncher } from "../../src/mesh-launcher.mjs";
import { startSession } from "../../src/mesh-session.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const NODE_ID = "node-a";
const NOW = "2026-07-12T12:00:00.000Z";

// The object fields a run element would carry IF it were (wrongly) an attributed
// object — the F1 fixture's `{ runId, workspaceId }`, the F8 read's `ref`/`title`.
const RUN_OBJECT_FIELDS = ["ref", "title", "runId", "itemRef", "workspaceId"];
const FIELD_ALT = RUN_OBJECT_FIELDS.join("|");

// ─────────────────────────────────────────────────────────── detectors (pure) ──

// Strip line/block comments so a comment that NAMES the forbidden shape (every fixed
// file now carries one — "never `{ ref, title }` objects") is not itself a violation.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/^[ \t]*\/\/\/.*$/gm, " ");
}

// PROOF 2 — every DECLARED type of the key is a bare string array.
// TS/d.mts: `activeRuns: string[]` / `activeRuns?: string[]`.
// Rust:     `active_runs: Vec<String>` (a struct field, never the accessor fn).
// Only TYPE-declaring files are in scope (.ts/.d.mts/.rs) — a `.mjs` has no type
// declarations to check (its element handling is proof 3's job).
function declaresTypes(file) {
  return /\.(?:ts|d\.mts|rs)$/.test(file);
}

function declarationViolations(file, source) {
  const violations = [];
  if (!declaresTypes(file)) return violations;
  const code = stripComments(source);
  if (/\.rs$/.test(file)) {
    for (const match of code.matchAll(/\bactive_runs\s*:\s*([^,\n]+?)\s*,/g)) {
      const declared = match[1].trim();
      if (declared !== "Vec<String>") {
        violations.push(`${file}: active_runs declared as \`${declared}\` — the frozen wire shape is Vec<String> (bare run ids)`);
      }
    }
    return violations;
  }
  for (const match of code.matchAll(/\bactiveRuns\??\s*:\s*([^;\n]+);/g)) {
    const declared = match[1].trim();
    if (declared !== "string[]") {
      violations.push(`${file}: activeRuns declared as \`${declared}\` — the frozen wire shape is string[] (bare run ids)`);
    }
  }
  return violations;
}

// PROOF 3 — no source binds an ELEMENT of activeRuns and then reads an object field
// off it. Binding forms covered: `.map/.filter/.find/.forEach/.some/.every/.flatMap`
// callbacks, `for (const x of …activeRuns)`, a direct `activeRuns[i].field`, and
// Rust's `.iter().map(|x| …)` closure — INCLUDING through a LOCAL ALIAS of the array
// (`let runs = node.active_runs();` … `runs.iter().map(|run| run.get("ref"))` is
// exactly how F8 was written, and an alias must not launder the violation).
//
// NB the deliberately narrow scope: only an element bound FROM the wire's
// activeRuns/active_runs is forbidden to be object-indexed. A RUN RECORD on disk
// genuinely IS an object (`readActiveRuns` reads `run.runId` off one to BUILD the
// string array) — that is the producer's business, and correctly not flagged.
function runArrayIdentifiers(code, key) {
  const identifiers = new Set([key]);
  const aliasRe = /\.rs$/.test(key)
    ? null
    : new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*[^;\\n]*\\b${key}\\b`, "g");
  for (const match of code.matchAll(aliasRe ?? new RegExp(`(?:const|let|var|let mut)\\s+(\\w+)\\s*=\\s*[^;\\n]*\\b${key}\\b`, "g"))) {
    identifiers.add(match[1]);
  }
  // Rust `let runs = node.active_runs();`
  for (const match of code.matchAll(new RegExp(`let\\s+(?:mut\\s+)?(\\w+)\\s*=\\s*[^;\\n]*\\b${key}\\b`, "g"))) {
    identifiers.add(match[1]);
  }
  return [...identifiers];
}

function elementAccessViolations(file, source) {
  const code = stripComments(source);
  const violations = [];
  const key = /\.rs$/.test(file) ? "active_runs" : "activeRuns";
  const fieldRead = (param) =>
    new RegExp(
      `\\b${param}\\s*\\.\\s*(?:${FIELD_ALT})\\b` + // x.ref
        `|\\b${param}\\s*\\.\\s*get\\(\\s*"(?:${FIELD_ALT})"` + // x.get("ref")  (Rust serde_json::Value)
        `|\\b${param}\\s*\\[\\s*"(?:${FIELD_ALT})"\\s*\\]`, // x["ref"]
    );

  for (const identifier of runArrayIdentifiers(code, key)) {
    // direct index: activeRuns[0].ref
    const indexed = new RegExp(`\\b${identifier}\\s*\\[[^\\]]*\\]\\s*\\.\\s*(?:${FIELD_ALT})\\b`, "g");
    for (const match of code.matchAll(indexed)) {
      violations.push(`${file}: \`${match[0].trim()}\` indexes a run element as an OBJECT — the wire's ${key} is a bare string array`);
    }

    // iterator/closure bindings: capture the element param, then read its body window.
    const binders = [
      new RegExp(`\\b${identifier}\\b[^\\n]{0,40}?\\.(?:map|filter|find|forEach|some|every|flatMap|reduce)\\(\\s*\\(?\\s*(\\w+)`, "g"),
      new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+(\\w+)\\s+of\\s+[^)\\n]*\\b${identifier}\\b`, "g"),
      // Rust: runs.iter().map(|run| …) / for run in node.active_runs()
      new RegExp(`\\b${identifier}\\b[^\\n]{0,60}?\\|\\s*(\\w+)\\s*\\|`, "g"),
      new RegExp(`for\\s+(\\w+)\\s+in\\s+[^\\n]*\\b${identifier}\\b`, "g"),
    ];
    for (const binder of binders) {
      for (const match of code.matchAll(binder)) {
        const param = match[1];
        const window = code.slice(match.index, match.index + 400);
        if (fieldRead(param).test(window)) {
          violations.push(`${file}: element \`${param}\` bound from ${key} (via \`${identifier}\`) is read as an OBJECT (\`${param}.<${RUN_OBJECT_FIELDS.join("|")}>\`) — the wire's ${key} is a bare string array`);
        }
      }
    }
  }
  return [...new Set(violations)];
}

// Every surface that consumes the key: the producer + JS/TS render surfaces + the
// Rust desktop. (The Rust `target/` build dir is NOT source and is excluded.)
const CONSUMER_FILES = [
  "src/mesh-presence.mjs",
  "src/mesh-launcher.mjs",
  "src/control-stream-server.mjs",
  "src/global-node-registry.mjs",
  "src/commands/mesh-identity.mjs",
  "src/commands/mesh-heartbeat.mjs",
  "ui/src/fleet/runs.mjs",
  "ui/src/fleet/runs.d.mts",
  "ui/src/fleet/scope.mjs",
  "ui/src/fleet/api.ts",
  "app/desktop/crates/core/src/status.rs",
  "app/desktop/crates/core/src/view_model.rs",
];

async function readConsumers() {
  const files = [];
  for (const rel of CONSUMER_FILES) {
    const source = await readFile(path.join(REPO, rel), "utf8");
    files.push({ file: rel, source });
  }
  return files;
}

// ─────────────────────────────────────────────────── the real producer (proof 1) ─

function manualTicker() {
  return {
    start(intervalSeconds, onTick) {
      return { intervalSeconds, onTick, stopped: false };
    },
    stop(handle) {
      handle.stopped = true;
    },
  };
}

async function producePresenceRecord() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-acd-active-runs-frozen-"));
  const root = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(root, ".aof"), { recursive: true });
  const workspaceId = "ws-A";
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId: NODE_ID, fabric: "tailscale", workspaceId } }, null, 2)}\n`,
    "utf8",
  );

  // A REAL running run record, read by the REAL readActiveRuns inside the assembler.
  const milestoneDir = path.join(workDir, "38_milestone_demo");
  await mkdir(path.join(milestoneDir, "runs"), { recursive: true });
  await writeFile(path.join(milestoneDir, "SPEC.md"), "---\ntype: milestone\nnumber: 99\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n", "utf8");
  await writeFile(
    path.join(milestoneDir, "runs", "run-a1.json"),
    JSON.stringify({ runId: "run-a1", itemRef: "99", state: "running", attempt: 1, outcome: null, sessionId: null, brief: {}, createdAt: NOW, updatedAt: NOW, failureReason: null, heartbeatAt: null, retryOf: null, reclaimedAt: null }, null, 2),
    "utf8",
  );

  const env = { AOF_GLOBAL_HOME: home };
  const ws = await loadWorkspace(root, undefined, { env });
  // A REAL live session, minted by the REAL producer verb — on a DIFFERENT workspace
  // so it survives ADR-004's upstream subsumption and the record carries BOTH keys.
  await startSession(ws, { nodeId: NODE_ID, workspaceId: "ws-B", repo: "beta", assistant: "claude-code", now: NOW });

  const handle = await startLauncher(ws, {
    exec: async () => ({ stdout: JSON.stringify({ BackendState: "Running", Self: { HostName: NODE_ID, DNSName: `${NODE_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true }, Peer: {} }), status: 0 }),
    platform: "linux",
    peerPollTicker: manualTicker(),
    propagationTicker: manualTicker(),
    streamServer: false,
    streamClient: false,
    now: () => NOW,
    globalWorkStoreOptions: { env },
  });
  handle.stop?.();
  return { record: handle.record, tmp };
}

export const archTests = [
  {
    name: "arch/38 ADR-004+008 (acd-active-runs-frozen-string-array): the REAL producer emits activeRuns as a bare string[] inside the frozen five-key record — the shape is read OFF the producer, never asserted from a doc (behavioural)",
    run: async () => {
      const { record, tmp } = await producePresenceRecord();
      try {
        assert.deepEqual(
          Object.keys(record),
          ["nodeId", "heartbeatAt", "activeRuns", "sessions", "aofVersion", "buildId"],
          "the producer emits the frozen keys in ADR-001 order (buildId is the m42/item-1 sixth additive key)",
        );
        assert.ok(record.activeRuns.length > 0, "the producer genuinely emitted a run (an empty array would make the element check vacuous)");
        for (const run of record.activeRuns) {
          assert.equal(typeof run, "string", `activeRuns element ${JSON.stringify(run)} is a bare run-id STRING — never an attributed object`);
        }
        // The attribution a render layer would need to subsume per workspace does NOT
        // exist on the wire — this is the structural fact that forced ADR-004's
        // reconciliation UPSTREAM into the assembler (F1). Pinning it here means a
        // future "just attribute it in the render helper" refactor fails CI.
        assert.ok(record.sessions.length > 0, "the producer genuinely emitted a live (unsubsumed) session");
        assert.deepEqual(Object.keys(record.sessions[0]), ["workspaceId", "repo", "assistant", "lastPingAt"], "a session entry carries its workspace attribution — a run entry never does");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },

  {
    name: "arch/38 ADR-004+008 (acd-active-runs-frozen-string-array): every DECLARED type of the key, in every language (TS string[] / Rust Vec<String>), is a bare string array (structural, cross-surface)",
    run: async () => {
      const files = await readConsumers();
      const violations = files.flatMap(({ file, source }) => declarationViolations(file, source));
      assert.deepEqual(violations, [], `a consumer declares activeRuns as something other than a bare string array:\n${violations.join("\n")}`);

      // Non-vacuity: the declaration sites this rule governs actually EXIST (the scan
      // is not passing because it found nothing to scan).
      const declared = files.filter(({ file, source }) => declaresTypes(file) && /\bactive(?:Runs\??|_runs)\s*:/.test(stripComments(source)));
      assert.ok(declared.length >= 2, "the scan genuinely reaches declaration sites in BOTH languages");
      assert.ok(declared.some(({ file }) => file.endsWith(".rs")), "the Rust surface's declaration is in scope");
      assert.ok(declared.some(({ file }) => file.endsWith(".ts")), "the TS surface's declaration is in scope");
    },
  },

  {
    name: "arch/38 ADR-004+008 (acd-active-runs-frozen-string-array): no surface binds an activeRuns ELEMENT and reads an object field off it (`.ref`/`.title`/`.runId`/`.workspaceId`/`.get(\"ref\")`) — the F1 (JS) + F8 (Rust) defect shape (structural, cross-surface)",
    run: async () => {
      const files = await readConsumers();
      const violations = files.flatMap(({ file, source }) => elementAccessViolations(file, source));
      assert.deepEqual(violations, [], `a consumer indexes a run element as an object:\n${violations.join("\n")}`);

      // Non-vacuity: the scanned set genuinely contains the surfaces that CONSUME the
      // key (a rename that silently emptied the scan would fail here).
      const consumers = files.filter(({ source }) => /\bactive(Runs|_runs)\b/.test(source));
      assert.ok(consumers.length >= 8, `the scan reaches the real consumer set (found ${consumers.length})`);
    },
  },

  {
    name: "arch/38 ADR-004+008 (acd-active-runs-frozen-string-array): self-check — the verbatim F1 (JS) and F8 (Rust) defect lines, and object-shaped declarations in both languages, are each FLAGGED by the same detectors the real tree passes (non-vacuous)",
    run: async () => {
      // ── planted DECLARATIONS ────────────────────────────────────────────────
      const plantedTsDecl = `export type PresenceRecord = {\n  nodeId: string;\n  activeRuns: { runId: string; workspaceId: string }[];\n};\n`;
      const plantedRustDecl = `pub struct Presence {\n    #[serde(default)]\n    pub active_runs: Vec<serde_json::Value>,\n}\n`;
      assert.equal(declarationViolations("planted/api.ts", plantedTsDecl).length, 1, "an attributed-object TS declaration is flagged");
      assert.equal(declarationViolations("planted/status.rs", plantedRustDecl).length, 1, "a Vec<Value> Rust declaration is flagged");
      // …and the REAL declarations pass the SAME detector.
      assert.deepEqual(declarationViolations("ui/src/fleet/api.ts", "export type P = {\n  activeRuns: string[];\n};\n"), []);
      assert.deepEqual(declarationViolations("status.rs", "pub struct P {\n    pub active_runs: Vec<String>,\n}\n"), []);

      // ── planted ELEMENT ACCESS — F1, verbatim in shape (the collapse rule keyed
      //    off a `workspaceId` the wire never carries) ──────────────────────────
      const plantedF1 = `export function fleetCurrentWorkLines(presence) {\n  const activeRuns = presence.activeRuns ?? [];\n  const workspacesWithRuns = new Set(activeRuns.map((run) => run.workspaceId));\n  return workspacesWithRuns;\n}\n`;
      const f1 = elementAccessViolations("planted/runs.mjs", plantedF1);
      assert.ok(f1.length >= 1, `the F1 defect line is flagged (got ${JSON.stringify(f1)})`);

      // ── planted ELEMENT ACCESS — F8, verbatim in shape (the Rust cell read the
      //    element as a serde_json::Value object, THROUGH a local alias) ─────────
      const plantedF8 = `pub fn current_work(node: &Node) -> CurrentWork {\n    let runs = node.active_runs();\n    let refs: Vec<String> = runs.iter().map(|run| run.get("ref").and_then(|v| v.as_str()).unwrap_or("").to_string()).collect();\n    CurrentWork::Running { refs }\n}\n`;
      const f8 = elementAccessViolations("planted/view_model.rs", plantedF8);
      assert.ok(f8.length >= 1, `the F8 defect line is flagged, alias and all (got ${JSON.stringify(f8)})`);

      // ── planted ELEMENT ACCESS — the index + for-of forms ────────────────────
      assert.ok(elementAccessViolations("planted/a.mjs", "const label = presence.activeRuns[0].title;\n").length >= 1, "an indexed object read is flagged");
      assert.ok(
        elementAccessViolations("planted/b.mjs", "for (const run of presence.activeRuns) {\n  lines.push(`${run.ref} · ${run.title}`);\n}\n").length >= 1,
        "a for-of object read is flagged",
      );

      // ── the CORRECT (real) usages are NOT flagged by the same detector ───────
      assert.deepEqual(
        elementAccessViolations("ui/src/fleet/runs.mjs", "const activeRuns = presence.activeRuns ?? [];\nlines.push(`running ${activeRuns.length} runs`);\n"),
        [],
        "counting a bare string array is not a violation",
      );
      assert.deepEqual(
        elementAccessViolations("src/mesh-launcher.mjs", "const sessions = live.filter((session) => !workspacesWithRuns.has(session.workspaceId));\nconst { activeRuns } = await assemble();\n"),
        [],
        "reading `workspaceId` off a SESSION (which genuinely carries it) is not a violation — only a run element is forbidden",
      );
    },
  },
];
