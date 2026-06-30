// Fitness function: acd-mesh-sync-record-neutral (milestone 22 / story 02 / ADR-004
// / fitness #4) — "Sync is payload-agnostic / git stays the system of record."
//
//   "The git-sync engine (src/mesh-sync.mjs) MOVES files under the partition root
//    WITHOUT parsing or mutating record CONTENT: it never imports node-identity.mjs
//    (the node-record schema) and performs no JSON.parse-then-rewrite of record
//    content (it stages/commits/pulls/pushes FILES, not fields); git stays the single
//    authority. AND the transport is a one-shot unit (mesh:sync / syncMesh) the loop
//    (startSyncLoop) is a thin TIMER over — the loop holds no git logic (no spawnSync
//    git of its own)."
//
// Source-discipline grep modelled on acd-import-no-graphify-spawn (the 09/13 call-form-
// not-comment discipline: scans run over comment-stripped — and where the property is
// about live code, comment-AND-string-stripped — source, so the module's DOCUMENTING
// mentions of "node-identity"/"JSON.parse"/"payload-agnostic" do NOT trip). Four proofs:
//   (a) IMPORT-NEUTRAL: src/mesh-sync.mjs imports NO node-identity.mjs / node-record
//       schema (it never sees the shape it moves).
//   (b) NO PARSE-THEN-REWRITE: no JSON.parse(...) of record content (it moves bytes,
//       not fields) — over comment-AND-string-stripped live code.
//   (c) ONE-SHOT TRANSPORT: syncMesh (the transport) is exported; mesh:sync is thin
//       over it (the command module imports syncMesh).
//   (d) LOOP IS A THIN TIMER: startSyncLoop holds NO git logic — no spawnSync/exec of
//       a "git" binary inside its body; the git spawn lives ONLY in the transport.
//
// Non-vacuous: each matcher is self-checked against the exact forbidden form (a real
// node-identity import, a JSON.parse, a git spawn inside the loop body) and against an
// accepted form (the transport's own git spawn), so the guards demonstrably fire.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_SYNC = path.join(repoRoot, "src", "mesh-sync.mjs");
const MESH_SYNC_COMMAND = path.join(repoRoot, "src", "commands", "mesh-sync.mjs");

// Comment-stripped (strings RETAINED) — for import-specifier reads + string-literal
// matchers (e.g. a spawn's argv[0] "git").
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Comment-AND-string-stripped — for live-code identifier matchers (JSON.parse,
// node-identity references), so a documented/string mention is discounted and only a
// real call/identifier survives. (The exact reader acd-import-no-graphify-spawn uses.)
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i += 1; continue; }
    if (state === "block") { if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i += 1; continue; }
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; i += 1; continue; }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

// A spawn/exec whose argv[0] string literal is "git" — the transport's legitimate form
// (accepted IN the transport; forbidden INSIDE the loop body, which must hold no git).
const GIT_SPAWN = /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\s*\(\s*["'`]git["'`]/;

// Isolate the startSyncLoop function body so the loop-has-no-git grep cannot be
// satisfied by the transport's own git spawn elsewhere in the module.
function loopBody(source) {
  const start = source.search(/(?:export\s+)?(?:async\s+)?function\s+startSyncLoop\s*\(/);
  if (start === -1) return "";
  const re = /\n(?:export\s+)?(?:async\s+)?function\s/g;
  re.lastIndex = start + 1;
  const next = re.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

// Extract the argument-list array literal of the `git(<cwd>, [ ... ])` call whose first
// array element is the string "commit" — the transport's one commit invocation. Returns
// the bracketed array source (e.g. `["commit", "-q", "-m", "...", "--", root]`) or null.
// Operates on comment-stripped source so a documenting mention never matches.
function commitCallArgsArray(source) {
  // Find a git(...) call whose argv array starts with the "commit" verb.
  const re = /\bgit\s*\(\s*[^,]+,\s*(\[)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const arrStart = m.index + m[0].length - 1; // index of the opening "["
    // Balanced-bracket scan to the matching "]".
    let depth = 0;
    let end = -1;
    for (let i = arrStart; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "[") depth += 1;
      else if (ch === "]") { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) continue;
    const arr = source.slice(arrStart, end + 1);
    if (/^\[\s*["'`]commit["'`]/.test(arr)) return arr;
  }
  return null;
}

export const archTests = [
  {
    name: "arch/mesh-sync-record-neutral: src/mesh-sync.mjs imports NO node-identity.mjs / node-record schema (it never sees the shape it moves — payload-agnostic)",
    run: async () => {
      const specs = importSpecifiers(stripCommentsOnly(await readFile(MESH_SYNC, "utf8")));
      const importsSchema = specs.some(
        (s) => /(^|\/)node-identity\.mjs$/.test(s) || /(^|\/)mesh-identity\.mjs$/.test(s)
      );
      assert.equal(
        importsSchema,
        false,
        `src/mesh-sync.mjs imports NO node-record schema (node-identity.mjs / mesh-identity.mjs); it moves files, not fields. imports: ${specs.join(", ")}`
      );
      // Self-check (non-vacuous): the reader DOES catch a real node-identity import.
      assert.ok(
        importSpecifiers('import { deriveNodeId } from "./node-identity.mjs";').some((s) => /node-identity\.mjs$/.test(s)),
        "the specifier reader catches a real node-identity.mjs import"
      );
    },
  },
  {
    name: "arch/mesh-sync-record-neutral: src/mesh-sync.mjs performs NO JSON.parse-then-rewrite of record content (it stages/commits/pulls/pushes files, not fields — git stays the system of record)",
    run: async () => {
      const liveCode = stripCommentsAndStrings(await readFile(MESH_SYNC, "utf8"));
      assert.ok(
        !/JSON\s*\.\s*parse\s*\(/.test(liveCode),
        "src/mesh-sync.mjs calls NO JSON.parse on record content (the transport moves bytes, never re-authors fields)"
      );
      assert.ok(
        !/JSON\s*\.\s*stringify\s*\(/.test(liveCode),
        "src/mesh-sync.mjs calls NO JSON.stringify on record content (it does not rewrite records)"
      );
      // Self-check (non-vacuous): the matcher FIRES on a real JSON.parse and does NOT
      // fire on plain file movement (the comment/string mention in docs is stripped).
      assert.ok(/JSON\s*\.\s*parse\s*\(/.test("const r = JSON.parse(bytes);"), "guard catches a real JSON.parse");
      assert.ok(!/JSON\s*\.\s*parse\s*\(/.test(stripCommentsAndStrings('// it never does JSON.parse on content')), "guard does NOT fire on a documented mention");
    },
  },
  {
    name: "arch/mesh-sync-record-neutral: the transport is a ONE-SHOT unit (syncMesh) the mesh:sync command is thin over",
    run: async () => {
      const transportSrc = stripCommentsOnly(await readFile(MESH_SYNC, "utf8"));
      assert.ok(
        /export\s+(?:async\s+)?function\s+syncMesh\s*\(/.test(transportSrc),
        "src/mesh-sync.mjs exports the one-shot transport syncMesh"
      );
      const commandSpecs = importSpecifiers(stripCommentsOnly(await readFile(MESH_SYNC_COMMAND, "utf8")));
      assert.ok(
        commandSpecs.some((s) => /(^|\/)mesh-sync\.mjs$/.test(s)),
        `mesh:sync (src/commands/mesh-sync.mjs) is thin over the transport (imports ../mesh-sync.mjs); imports: ${commandSpecs.join(", ")}`
      );
    },
  },
  {
    name: "arch/mesh-sync-record-neutral: the background loop (startSyncLoop) is a thin TIMER — it holds NO git logic (no git spawn of its own)",
    run: async () => {
      const codeWithStrings = stripCommentsOnly(await readFile(MESH_SYNC, "utf8"));
      // The git spawn must live in the TRANSPORT, never in the loop body.
      assert.ok(GIT_SPAWN.test(codeWithStrings), "the transport DOES spawn git (the engine's one-shot git logic)");
      const loop = loopBody(codeWithStrings);
      assert.ok(loop.length > 0, "startSyncLoop is defined in src/mesh-sync.mjs");
      assert.ok(
        !GIT_SPAWN.test(loop),
        "startSyncLoop holds NO git spawn (it is a thin timer over the transport, not a second git site)"
      );
      // Self-check (non-vacuous): the guard FIRES on a git spawn and does NOT fire on a
      // plain runSync() call (the loop's only job).
      assert.ok(GIT_SPAWN.test('spawnSync("git", ["add", "--", root])'), "guard catches a git spawn");
      assert.ok(!GIT_SPAWN.test("const onTick = () => runSync();"), "guard does NOT fire on a plain runSync() invocation");
    },
  },
  {
    name: "arch/mesh-sync-record-neutral: the git commit invocation carries a `-- <partition-root>` pathspec (the commit cannot be unscoped — a concurrent operator's pre-staged change is never folded into the mesh commit)",
    run: async () => {
      const src = stripCommentsOnly(await readFile(MESH_SYNC, "utf8"));
      const commitArgs = commitCallArgsArray(src);
      assert.ok(commitArgs != null, "src/mesh-sync.mjs contains a git(..., [\"commit\", ...]) invocation");
      // The commit argv must contain a `--` end-of-options marker (the pathspec
      // separator) — without it the commit is unscoped and folds the whole index.
      assert.ok(
        /["'`]--["'`]/.test(commitArgs),
        `the commit argv carries a "--" pathspec separator (it is scoped, not unscoped) — got ${commitArgs}`
      );
      // …and the pathspec after the `--` is the partition root (`root` = meshDir(...)),
      // not some other path: the token following the "--" element is the `root` binding.
      assert.ok(
        /["'`]--["'`]\s*,\s*root\b/.test(commitArgs),
        `the commit pathspec scopes to the partition root (\`-- root\`, root = meshDir(...)) — got ${commitArgs}`
      );
      // Non-vacuous self-checks: the extractor FINDS a scoped commit and the assertion
      // FAILS on the old unscoped form (no `--`), so the proof demonstrably fires.
      const scoped = commitCallArgsArray('git(repoRoot, ["commit", "-q", "-m", "mesh: sync node records", "--", root]);');
      assert.ok(scoped != null && /["'`]--["'`]\s*,\s*root\b/.test(scoped), "extractor finds a scoped `-- root` commit");
      const unscoped = commitCallArgsArray('git(repoRoot, ["commit", "-q", "-m", "mesh: sync node records"]);');
      assert.ok(unscoped != null && !/["'`]--["'`]/.test(unscoped), "the proof would FAIL on the old unscoped commit (no `--` pathspec)");
    },
  },
];
