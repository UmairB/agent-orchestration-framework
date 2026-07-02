// Fitness function: acd-registry-write-scope (milestone 24, ADR-001 / structural fitness
// — the architect's; the crypto counterpart acd-enrollment-code-hashed-at-rest is
// SECURITY.md's). "Registry write-scope + single-writer."
//
//   "The group registry — the group-level, control-node-owned SINGLE-WRITER second
//    git-of-record (roster + registered boards + pending invites + revocations) — has
//    EXACTLY ONE write seam (writeRegistry in src/mesh-registry.mjs). That write (a)
//    joins the registryPath/registryDir/meshDir partition seam, never a record doc; (b)
//    routes through the atomic writeText temp+rename seam (19/R2), never a bare
//    writeFile/appendFile; (c) is guarded by a control-node predicate (the relayMode /
//    controlNode === nodeId gate) — a non-authority invocation never writes (the single-
//    writer discipline that resolves 22/ADR-002's 'no aggregate roster two nodes
//    co-write' tension); and (d) NO OTHER src/**.mjs module writes the registry/ subtree."
//
// This is the STRUCTURAL residue of the 22/ADR-002 tension-resolution: a roster IS
// allowed (unlike m22's per-node partition) BECAUSE it is single-writer (one control
// node), so there is no multi-writer three-way merge. This gate proves the single-writer
// discipline holds structurally. Modelled on acd-presence-write-scope (the collectCalls /
// firstArgument source-analysis) + acd-relay-stateless (the comment/string stripping).
//
// Per the m03 lesson (a fitness function asserts the PRESENCE of what should exist, not
// only the absence of what shouldn't), each proof pairs a positive assertion (a real
// write IS routed through the seam under the control-node guard) with a negative one (no
// record doc; no bare write; no other module writes registry/) AND a non-vacuous
// self-check (the detector fires on a planted violation).
//
// State: RED until src/mesh-registry.mjs exists — readFile rejects on the absent module,
// so the gate fails cleanly (module-not-found), the RED-until-built discipline.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY_MODULE = path.join(repoRoot, "src", "mesh-registry.mjs");
const SRC = path.join(repoRoot, "src");

const RECORD_DOCS = ["SPEC.md", "STORY.md", "STATE.md", "SESSION.md"];
// A bare writeFile/appendFile would bypass the atomic writeText seam (forbidden).
// mkdir is a directory write — its target must still join the partition seam.
const DIRECT_WRITE_VERBS = ["writeFile", "appendFile", "writeFileSync", "appendFileSync"];
const SEAM_WRITE_VERBS = ["mkdir", "writeText"];
// The control-node single-writer guard: the write path must be gated by the same
// control-node predicate relayMode uses (controlNode === nodeId), or an equivalent
// control-node / authority guard. Accept any of these forms — the invariant is that the
// write is NOT unconditional.
const CONTROL_NODE_GUARD = /\brelayMode\b|\bcontrolNode\b|\bisControlNode\b|\bisEnrollmentAuthority\b|\bassertControlNode\b/;

// --- source-analysis helpers (mirroring acd-presence-write-scope) ----------------

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Comment-AND-string-stripped — for live-code identifier matchers, so a documented /
// string mention is discounted and only a real call survives.
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

function collectCalls(code, verbs) {
  const calls = [];
  for (const verb of verbs) {
    const re = new RegExp(`\\b${verb}\\s*\\(`, "g");
    let match;
    while ((match = re.exec(code))) {
      const start = match.index + match[0].length;
      calls.push({ verb, firstArg: firstArgument(code, start) });
    }
  }
  return calls;
}

function firstArgument(code, start) {
  let depth = 0;
  let out = "";
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === "," && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

export const archTests = [
  {
    name: "arch/registry-write-scope: the registry mechanic references zero record-doc filename, and every registry write joins the registryPath/registryDir/meshDir partition seam through the atomic writeText",
    run: async () => {
      const raw = await readFile(REGISTRY_MODULE, "utf8");
      const code = stripComments(raw);

      // (a) NO RECORD-DOC filename (record-doc resolution is work.mjs's, never the store).
      for (const doc of RECORD_DOCS) {
        assert.ok(
          !code.includes(doc),
          `src/mesh-registry.mjs references no record-doc filename "${doc}" — a registry write can never target one`
        );
      }

      // (b) NO bare writeFile/appendFile (every persist routes through the atomic writeText).
      const bareWrites = collectCalls(stripCommentsAndStrings(raw), DIRECT_WRITE_VERBS);
      assert.equal(
        bareWrites.length,
        0,
        `src/mesh-registry.mjs calls no bare ${DIRECT_WRITE_VERBS.join("/")} (every persist routes through writeText) — got: ${bareWrites.map((c) => c.verb).join(", ")}`
      );

      // (c) There IS a real write, AND every seam write joins the partition seam.
      const seamWrites = collectCalls(code, SEAM_WRITE_VERBS);
      assert.ok(seamWrites.length >= 1, "src/mesh-registry.mjs performs at least one fs write (it persists the registry)");
      let sawWriteText = false;
      for (const call of seamWrites) {
        if (call.verb === "writeText") sawWriteText = true;
        const joinsSeam =
          /registryPath\s*\(/.test(call.firstArg) ||
          /registryDir\s*\(/.test(call.firstArg) ||
          /meshDir\s*\(/.test(call.firstArg);
        assert.ok(
          joinsSeam,
          `the ${call.verb}(...) write joins the registry partition seam (registryPath/registryDir/meshDir), not a loose path — got: ${call.firstArg}`
        );
      }
      assert.ok(sawWriteText, "the registry persists via the atomic writeText seam (writeRegistry)");

      // Self-checks (non-vacuous): the record-doc scan fires on a real STATE.md reference;
      // the bare-write detector fires on a real writeFile; the seam check rejects an
      // off-seam write.
      assert.ok(stripComments('await writeText(path.join(dir, "STATE.md"), body);').includes("STATE.md"), "the record-doc scan catches a real STATE.md reference");
      assert.equal(collectCalls(stripCommentsAndStrings('await writeFile(registryPath(ws), body);'), DIRECT_WRITE_VERBS).length, 1, "the bare-write detector catches a real writeFile call");
      const offending = collectCalls(stripComments('await writeText(path.join(workDir, "loose.json"), body);'), SEAM_WRITE_VERBS);
      assert.equal(offending.length, 1, "the detector observes the off-seam write");
      assert.ok(
        !(/registryPath\s*\(/.test(offending[0].firstArg) || /registryDir\s*\(/.test(offending[0].firstArg) || /meshDir\s*\(/.test(offending[0].firstArg)),
        "the seam check rejects a write that does not join the registry partition seam"
      );
    },
  },
  {
    name: "arch/registry-write-scope: the registry write is SINGLE-WRITER — it is guarded by a control-node predicate (relayMode/controlNode), never an unconditional write (the 22/ADR-002 no-aggregate-roster tension resolved by single-writer discipline)",
    run: async () => {
      const code = stripCommentsAndStrings(await readFile(REGISTRY_MODULE, "utf8"));
      // The module that persists the registry must reference a control-node guard — the
      // write is an AUTHORITY decision, not an unconditional call every node makes. (The
      // guard may live inline in writeRegistry OR be a re-used relayMode/controlNode read;
      // either satisfies the single-writer discipline.)
      assert.ok(
        CONTROL_NODE_GUARD.test(code),
        "src/mesh-registry.mjs guards its write with a control-node predicate (relayMode/controlNode/isControlNode) — the registry is SINGLE-WRITER (the control node owns it), resolving 22/ADR-002's 'no aggregate roster two nodes co-write' tension. RED until the guarded writeRegistry lands"
      );
      // Self-checks (non-vacuous): the guard matcher fires on a real controlNode read and
      // does NOT fire on an unrelated read.
      assert.ok(CONTROL_NODE_GUARD.test("if (config.mesh.relay.controlNode !== config.mesh.nodeId) return;"), "the guard matcher fires on a real controlNode gate");
      assert.ok(!CONTROL_NODE_GUARD.test("const roster = registry.roster ?? [];"), "the guard matcher does NOT fire on an unrelated roster read");
    },
  },
  {
    name: "arch/registry-write-scope: NO OTHER src/**.mjs module writes the MESH registry subtree — the mesh group registry has exactly one write owner (src/mesh-registry.mjs)",
    run: async () => {
      // Scan every src/**.mjs (excluding the registry module itself): none may write the
      // MESH registry. The discriminator is IMPORT-scoped, so an UNRELATED local
      // `registryPath` (e.g. src/terminal-sessions.mjs's own .aof/terminal-sessions
      // registry — a different artifact entirely) is NOT a false positive: a module is a
      // candidate mesh-registry writer ONLY if it imports src/mesh-registry.mjs (so its
      // registryPath/registryDir symbol IS the mesh one) OR writes a path literal under a
      // `.mesh/registry` mesh-partition segment.
      const offenders = [];
      async function walk(dir) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { await walk(full); continue; }
          if (!entry.name.endsWith(".mjs")) continue;
          if (full === REGISTRY_MODULE) continue; // the one legitimate writer
          const raw = await readFile(full, "utf8");
          const comments = stripComments(raw);
          const importsMeshRegistry = /\bfrom\s+["'][^"']*\bmesh-registry\.mjs["']/.test(comments);
          const code = stripCommentsAndStrings(raw);
          const writes = collectCalls(code, ["writeText", "writeFile", "writeFileSync", "appendFile", "mkdir"]);
          for (const call of writes) {
            // A write of the mesh registry: EITHER the module imports mesh-registry.mjs and
            // the write joins its registryPath/registryDir builder, OR the write joins a
            // mesh-partition `.mesh/registry` path literal. An unrelated `registryPath` in a
            // module that does NOT import mesh-registry.mjs is NOT the mesh registry.
            const joinsMeshBuilder = importsMeshRegistry && (/registryPath\s*\(/.test(call.firstArg) || /registryDir\s*\(/.test(call.firstArg));
            const joinsMeshLiteral = /\.mesh[\\/]+registry/.test(call.firstArg) || /meshDir\s*\([^)]*\)[^,]*registry/.test(call.firstArg);
            if (joinsMeshBuilder || joinsMeshLiteral) {
              offenders.push(`${path.relative(repoRoot, full)}: ${call.verb}(${call.firstArg})`);
            }
          }
        }
      }
      await walk(SRC);
      assert.deepEqual(
        offenders,
        [],
        `no src/**.mjs module other than src/mesh-registry.mjs writes the MESH registry subtree (single write owner) — offenders: ${offenders.join(" | ")}`
      );
      // Self-check (non-vacuous): a module that IMPORTS mesh-registry.mjs and writes
      // registryPath(...) WOULD be flagged; an unrelated local registryPath (no
      // mesh-registry import) is NOT — proving the import-scoped discriminator works.
      const foreignImports = /\bfrom\s+["'][^"']*\bmesh-registry\.mjs["']/.test('import { registryPath } from "../mesh-registry.mjs";');
      const foreignWrite = collectCalls(stripCommentsAndStrings('await writeText(registryPath(ws), body);'), ["writeText"]);
      assert.ok(foreignImports && foreignWrite.length === 1 && /registryPath\s*\(/.test(foreignWrite[0].firstArg), "the scanner WOULD flag a foreign module that imports mesh-registry.mjs and writes registryPath(...)");
      const unrelatedImports = /\bfrom\s+["'][^"']*\bmesh-registry\.mjs["']/.test('function registryPath(projectDir) { return path.join(projectDir, ".aof", "sessions.json"); }');
      assert.ok(!unrelatedImports, "an unrelated local registryPath (no mesh-registry.mjs import) is NOT a mesh-registry write — no false positive");
    },
  },
];
