// Fitness function: acd-memory-index-never-on-mesh (milestone 38 / ADR-016; fitness
// fn 19, SPEC + armed at BUILD)
//
// Arms ADR-016's THREE structural invariants (ARCHITECTURE.md, "Structural invariants
// (each testable; armed by acd-memory-index-never-on-mesh)"):
//  1. No index/graph bytes on any mesh stream — no source places graphify-out/,
//     graph.json, or a normalized-index payload onto a relay frame / directive /
//     status frame / any mesh transport.
//  2. graphify-out/ stays gitignored + derived (rebuildable from the .md, m10/ADR-005).
//  3. Syncback is a re-ingest of the control node's OWN checkout — it never fetches a
//     remote index or a peer's cache.
//
// Proofs: (a) STRUCTURAL, WHOLE-FILE — every mesh-transport module this milestone
// ships (control-stream-server.mjs, worker-stream-client.mjs, mesh-relay.mjs,
// mesh-relay-client.mjs, mesh-terminal-relay-bridge.mjs [story 06's NEW terminal-frame
// kind], mesh-terminal-mirror.mjs) carries NO reference to a graph/index artifact
// ANYWHERE in the file — not scoped to a named function, so a leak hidden outside a
// "builder" span is caught too; (b) STRUCTURAL, PER-BUILDER — the EXHAUSTIVE real
// frame-builder enumeration (incl. story 06's buildTerminalFrameEnvelope and story 07's
// buildWriteCredentialFrame — the milestone's own recurring F1/F4 "stale enumeration"
// failure class this guards against) each scanned individually for traceable per-frame-
// kind failure messages; (c) STRUCTURAL — the real aof-gitignore.mjs baseline
// (ensureGraphifyOutGitignore) + this repo's own root .gitignore keep graphify-out/
// ignored; (d) STRUCTURAL — the memory ingest modules (local-indexing.mjs,
// graphify-backend.mjs) import NO mesh-transport module (never fetch a peer's cache);
// (e) SELF-CHECK — the THREE plants ADR-016's own fitness-fn text names (an index
// payload on a mesh frame builder; a de-gitignored index; a remote-index fetch), each
// PROVEN TO LAND (assert.notEqual against its clean baseline) before asserting the
// detector trips; the real (correct) source stays clean under every detector.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureGraphifyOutGitignore, GRAPHIFY_OUT_DIR, GRAPHIFY_OUT_GITIGNORE } from "../../src/aof-gitignore.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// lf(source) — the tree is CRLF (measured: src/control-stream-server.mjs etc.); every
// synthesized plant below is built with explicit "\n" joins so it is IMMUNE to that
// convention (mirrors acd-write-token-scoped-to-push.test.mjs's own lf() discipline).
function lf(source) {
  return source.replace(/\r\n/g, "\n");
}

function sliceBalanced(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

// functionBodyByName(source, functionName) — locates `function <functionName>(` and
// returns its balanced BODY text, depth-aware across the parameter list too (mirrors
// acd-write-token-scoped-to-push.test.mjs's own anchor — a naive "first { after the
// name" scan would stop at a destructured/defaulted parameter's OWN brace).
function functionBodyByName(source, functionName) {
  const idx = source.indexOf(`function ${functionName}(`);
  if (idx === -1) return null;
  const parenOpen = source.indexOf("(", idx);
  if (parenOpen === -1) return null;
  let depth = 0;
  let i = parenOpen;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0 && ch === ")") break;
    }
  }
  const braceIdx = source.indexOf("{", i + 1);
  if (braceIdx === -1) return null;
  return sliceBalanced(source, braceIdx);
}

// ---------------------------------------------------------------------------------
// Invariant 1 — no index/graph bytes on ANY mesh stream.
// ---------------------------------------------------------------------------------

// The index/graph literal-reference detector: a mesh-transport source (or a frame
// builder's own span) must name none of these. `normalizedindex`/`graph-index` guard
// against a renamed-but-equivalent slot; `graph.json`/`graphify-out` are the two
// concrete on-disk artifacts ADR-016 forbids from ever riding a frame.
const INDEX_LEAK_RE = /graphify-out|graph\.json|normalizedindex|graph-index/i;

function indexLeakProblems(label, source) {
  return INDEX_LEAK_RE.test(source)
    ? [`${label}: references a graph/index artifact — the derived recall index must never ride a mesh frame`]
    : [];
}

// (a) WHOLE-FILE scan — every mesh-transport module this milestone ships, scanned in
// full (not scoped to a single function), so a leak hidden in connection/dispatch code
// OUTSIDE a named "builder" is caught too.
const MESH_TRANSPORT_FILES = [
  "src/control-stream-server.mjs",
  "src/worker-stream-client.mjs",
  "src/mesh-relay.mjs",
  "src/mesh-relay-client.mjs",
  "src/mesh-terminal-relay-bridge.mjs", // story 06 — the NEW terminal-frame kind
  "src/mesh-terminal-mirror.mjs",
];

// (b) PER-BUILDER scan — the EXHAUSTIVE real frame-builder enumeration (grepped from
// the real tree: `grep -rnE "kind:|type:|buildDirectiveFrame|Envelope|Frame"
// src/*stream*.mjs src/mesh-relay.mjs src/mesh-terminal-*.mjs`). Every function that
// BUILDS a frame object placed onto ANY mesh transport — the down-frames
// (control-stream-server.mjs), the up-frames (worker-stream-client.mjs), the relay
// envelope (mesh-relay-client.mjs), story 06's NEW terminal-frame
// (mesh-terminal-relay-bridge.mjs), and mesh-relay.mjs's own frozen control-frame
// builder (sendControl). Deliberately INCLUDES buildWriteCredentialFrame (story 07) and
// buildTerminalFrameEnvelope (story 06, built moments before this story) — a stale/
// incomplete enumeration is exactly this milestone's own recurring F1/F4 failure class.
const FRAME_BUILDER_SITES = [
  { file: "src/control-stream-server.mjs", fn: "buildDirectiveFrame" },
  { file: "src/control-stream-server.mjs", fn: "buildCloneCredentialFrame" },
  { file: "src/control-stream-server.mjs", fn: "buildCloneUrlFrame" },
  { file: "src/control-stream-server.mjs", fn: "buildWriteCredentialFrame" }, // story 07
  { file: "src/worker-stream-client.mjs", fn: "buildSnapshotFrame" },
  { file: "src/worker-stream-client.mjs", fn: "buildDeltaFrame" },
  { file: "src/worker-stream-client.mjs", fn: "buildPresenceFrame" },
  { file: "src/worker-stream-client.mjs", fn: "buildAssignmentStatusFrame" },
  { file: "src/worker-stream-client.mjs", fn: "buildCloneCredentialRequestFrame" },
  { file: "src/worker-stream-client.mjs", fn: "buildCloneUrlRequestFrame" },
  { file: "src/worker-stream-client.mjs", fn: "buildWriteCredentialRequestFrame" }, // story 07
  { file: "src/mesh-relay-client.mjs", fn: "relayEnvelope" },
  // leaseRelayEnvelope DELETED (m42 item 0 — the lease era's dead wire kind).
  { file: "src/mesh-terminal-relay-bridge.mjs", fn: "buildTerminalFrameEnvelope" }, // story 06
  { file: "src/mesh-relay.mjs", fn: "sendControl" },
];

// ---------------------------------------------------------------------------------
// Invariant 2 — graphify-out/ stays gitignored + derived.
// ---------------------------------------------------------------------------------
function gitignoreMissingProblems(content) {
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  return lines.includes("graphify-out/") ? [] : ["graphify-out/ is missing from the ignore content — the derived index would be committed"];
}

// ---------------------------------------------------------------------------------
// Invariant 3 — syncback re-ingests the control's OWN checkout; never fetches a peer's
// cache. The ingest/records modules import NO mesh-transport module.
// ---------------------------------------------------------------------------------
const MESH_TRANSPORT_IMPORT_RE = /from\s+["'][^"']*(mesh-relay-client|mesh-relay|control-stream-server|worker-stream-client|mesh-terminal-relay-bridge|mesh-terminal-mirror)(?:\.mjs)?["']/;

function remoteFetchProblems(source) {
  return MESH_TRANSPORT_IMPORT_RE.test(source)
    ? ["imports a mesh-transport module — the ingest/records path must re-ingest the control's OWN checkout, never reach across the mesh for a peer's index/cache"]
    : [];
}

const MEMORY_INGEST_FILES = ["src/memory/local-indexing.mjs", "src/memory/graphify-backend.mjs"];

// ---------------------------------------------------------------------------------
// Synthesized plants (self-check) — the THREE attacks ADR-016's own fitness-fn text
// names, each built with explicit "\n" joins (CRLF-immune).
// ---------------------------------------------------------------------------------
function synthesizeDirectiveSnippet({ leaksIndex }) {
  const lines = [
    "export function buildDirectiveFrame(to, { assignmentId, itemRef, workspaceId, at, command }) {",
    "  const frame = { kind: \"directive\", to, assignmentId, itemRef, workspaceId, at };",
    "  if (typeof command === \"string\" && command.length > 0) frame.command = command;",
  ];
  if (leaksIndex) lines.push("  frame.graphPath = graphJsonPath(workspaceId) + \"/graphify-out/graph.json\";");
  lines.push("  return frame;", "}");
  return lines.join("\n");
}

function synthesizeGitignoreContent({ includesGraphifyOut }) {
  const lines = ["node_modules/", "coverage/"];
  if (includesGraphifyOut) lines.push("graphify-out/");
  lines.push(".DS_Store");
  return `${lines.join("\n")}\n`;
}

function synthesizeIngestImportSnippet({ fetchesPeer }) {
  const lines = fetchesPeer
    ? ["import { listItems } from \"../work.mjs\";", "import { relayEnvelope } from \"../mesh-relay-client.mjs\";"]
    : ["import { listItems } from \"../work.mjs\";", "import { readJson, writeText } from \"../fs.mjs\";"];
  lines.push("export async function buildRecords(only, ctx) { /* ... */ }");
  return lines.join("\n");
}

export const archTests = [
  // ------------------------------------------------------------------
  // Invariant 1a — WHOLE-FILE structural scan, real source
  // ------------------------------------------------------------------
  {
    name: "arch/38 ADR-016 (acd-memory-index-never-on-mesh): invariant 1 — no mesh-transport module carries ANY reference to a graph/index artifact, anywhere in the file (structural, whole-file, real source)",
    run: async () => {
      for (const rel of MESH_TRANSPORT_FILES) {
        const source = lf(await readFile(path.join(repoRoot, rel), "utf8"));
        assert.deepEqual(indexLeakProblems(rel, source), [], `${rel} carries no graph/index reference anywhere in the file`);
      }
    },
  },
  // ------------------------------------------------------------------
  // Invariant 1b — PER-BUILDER structural scan, the EXHAUSTIVE real enumeration
  // ------------------------------------------------------------------
  {
    name: "arch/38 ADR-016 (acd-memory-index-never-on-mesh): invariant 1 — the EXHAUSTIVE per-frame-kind builder enumeration (incl. story 06's terminal-frame + story 07's write-credential) each carries no graph/index reference in its own span (structural, real source)",
    run: async () => {
      const fileCache = new Map();
      for (const { file, fn } of FRAME_BUILDER_SITES) {
        if (!fileCache.has(file)) fileCache.set(file, lf(await readFile(path.join(repoRoot, file), "utf8")));
        const source = fileCache.get(file);
        const body = functionBodyByName(source, fn);
        assert.ok(body != null, `${file}: ${fn}( is found (the enumeration stays current against the real tree)`);
        assert.deepEqual(indexLeakProblems(`${file}::${fn}`, body), [], `${file}::${fn} carries no graph/index reference in its own span`);
      }
    },
  },
  // ------------------------------------------------------------------
  // Invariant 2 — graphify-out/ stays gitignored + derived
  // ------------------------------------------------------------------
  {
    name: "arch/38 ADR-016 (acd-memory-index-never-on-mesh): invariant 2 — graphify-out/ stays gitignored + derived (this repo's own root .gitignore, and the real ensureGraphifyOutGitignore baseline over a fresh temp project) (structural + behavioural, real source)",
    run: async () => {
      const rootIgnore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
      assert.deepEqual(gitignoreMissingProblems(rootIgnore), [], "this repo's own root .gitignore still names graphify-out/ (.gitignore:4)");

      assert.equal(GRAPHIFY_OUT_DIR, "graphify-out", "the derived graph artifact's directory name is graphify-out");
      assert.deepEqual([...GRAPHIFY_OUT_GITIGNORE].sort(), ["!.gitignore", "*"].sort(), "the nested ignore baseline ignores everything in the directory except the ignore file itself");

      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-memory-index-gitignore-"));
      try {
        await ensureGraphifyOutGitignore(tmp);
        const nested = await readFile(path.join(tmp, GRAPHIFY_OUT_DIR, ".gitignore"), "utf8");
        assert.deepEqual(gitignoreMissingProblems(`${nested}\ngraphify-out/\n`), [], "sanity: the composed check itself recognises a present entry");
        assert.ok(nested.includes("*"), "the REAL ensureGraphifyOutGitignore writes the wildcard-ignore line");
        assert.ok(nested.includes("!.gitignore"), "the REAL ensureGraphifyOutGitignore keeps the ignore file itself out of the ignore set");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
  // ------------------------------------------------------------------
  // Invariant 3 — syncback re-ingests the control's OWN checkout
  // ------------------------------------------------------------------
  {
    name: "arch/38 ADR-016 (acd-memory-index-never-on-mesh): invariant 3 — the memory ingest/records modules import NO mesh-transport module — syncback re-ingests the control's OWN checkout, never a peer's cache (structural, real source)",
    run: async () => {
      for (const rel of MEMORY_INGEST_FILES) {
        const source = lf(await readFile(path.join(repoRoot, rel), "utf8"));
        assert.deepEqual(remoteFetchProblems(source), [], `${rel} imports no mesh-transport module`);
      }
    },
  },
  // ------------------------------------------------------------------
  // Self-check — the THREE ADR-016-named plants, each PROVEN TO LAND before its
  // detector is asserted to trip; the real (correct) source stays clean under every one.
  // ------------------------------------------------------------------
  {
    name: "arch/38 ADR-016 (acd-memory-index-never-on-mesh): self-check — an index payload on a mesh frame builder, a de-gitignored index, and a remote-index fetch EACH trip their detector; the real source stays clean under every one",
    run: async () => {
      // Sanity — the real tree is clean under every detector first.
      const directiveSource = lf(await readFile(path.join(repoRoot, "src/control-stream-server.mjs"), "utf8"));
      assert.deepEqual(indexLeakProblems("buildDirectiveFrame", functionBodyByName(directiveSource, "buildDirectiveFrame")), [], "sanity: the real buildDirectiveFrame is clean");
      const rootIgnore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
      assert.deepEqual(gitignoreMissingProblems(rootIgnore), [], "sanity: the real root .gitignore is clean");
      const localIndexingSource = lf(await readFile(path.join(repoRoot, "src/memory/local-indexing.mjs"), "utf8"));
      assert.deepEqual(remoteFetchProblems(localIndexingSource), [], "sanity: the real local-indexing.mjs is clean");

      // PLANT 1 — an index payload on a mesh frame builder.
      const cleanDirective = synthesizeDirectiveSnippet({ leaksIndex: false });
      const plantedDirective = synthesizeDirectiveSnippet({ leaksIndex: true });
      assert.notEqual(plantedDirective, cleanDirective, "the plant actually differs from its clean baseline");
      assert.deepEqual(indexLeakProblems("clean", cleanDirective), [], "the clean synthesized directive builder stays clean");
      assert.ok(indexLeakProblems("planted", plantedDirective).length > 0, "an index payload attached to a frame builder trips the detector");

      // PLANT 2 — a de-gitignored index (graphify-out/ missing from the ignore content).
      const cleanIgnore = synthesizeGitignoreContent({ includesGraphifyOut: true });
      const plantedIgnore = synthesizeGitignoreContent({ includesGraphifyOut: false });
      assert.notEqual(plantedIgnore, cleanIgnore, "the plant actually differs from its clean baseline");
      assert.deepEqual(gitignoreMissingProblems(cleanIgnore), [], "the clean synthesized ignore content stays clean");
      assert.ok(gitignoreMissingProblems(plantedIgnore).length > 0, "a de-gitignored index (graphify-out/ missing) trips the detector");

      // PLANT 3 — a remote-index fetch (the ingest path importing a mesh-transport module).
      const cleanImport = synthesizeIngestImportSnippet({ fetchesPeer: false });
      const plantedImport = synthesizeIngestImportSnippet({ fetchesPeer: true });
      assert.notEqual(plantedImport, cleanImport, "the plant actually differs from its clean baseline");
      assert.deepEqual(remoteFetchProblems(cleanImport), [], "the clean synthesized ingest import stays clean");
      assert.ok(remoteFetchProblems(plantedImport).length > 0, "a remote-index fetch (a mesh-transport import in the ingest path) trips the detector");
    },
  },
];
