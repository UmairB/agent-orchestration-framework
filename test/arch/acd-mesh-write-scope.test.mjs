// Fitness function: acd-mesh-write-scope (milestone 22, ADR-002/004 / fitness #2).
//
// The write-scope guard: every filesystem write the mesh-store performs joins
// meshDir(...)/nodeRecordPath(...) and routes through the atomic writeText seam
// (19/R2) — NOT a bare writeFile; NO write targets an item record doc
// (SPEC.md/STORY.md/STATE.md/SESSION.md) or its frontmatter (record-doc resolution
// lives in work.mjs, never the store). Mirrors 19's acd-run-write-scope (the
// stripComments + collectCalls/firstArgument source-analysis helpers).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const MESH_STORE = new URL("../../src/mesh-store.mjs", import.meta.url);
// The mesh:* command modules the write-scope guard ALSO scans (ARCHITECTURE.md fitness
// #2 — "source-grep src/mesh-store.mjs (+ the mesh:* command modules)"): a mesh command
// must not write a record doc and must route every write through the atomic writeText
// seam. mesh-identity.mjs legitimately persists the config via writeText(configPath, …)
// (the mesh.nodeId/mesh.salt persist) — that is allowed; the gate forbids record-doc
// writes + bare writeFile/appendFile.
const MESH_COMMAND_MODULES = [
  new URL("../../src/commands/mesh-identity.mjs", import.meta.url),
  new URL("../../src/commands/mesh-sync.mjs", import.meta.url),
];
const RECORD_DOCS = ["SPEC.md", "STORY.md", "STATE.md", "SESSION.md"];
// The fs write verbs the store could call directly. writeText is the atomic seam;
// a bare writeFile/appendFile would bypass it (forbidden). mkdir is a directory
// write — its target must still join the partition seam.
const DIRECT_WRITE_VERBS = ["writeFile", "appendFile"];
const SEAM_WRITE_VERBS = ["mkdir", "writeText"];

export const archTests = [
  {
    name: "arch/mesh-write-scope: the store references zero record-doc filename (record-doc resolution is not the store's job)",
    async run() {
      const code = stripComments(await readFile(MESH_STORE, "utf8"));
      for (const doc of RECORD_DOCS) {
        assert.ok(
          !code.includes(doc),
          `src/mesh-store.mjs references no record-doc filename "${doc}" — a write can never target one`
        );
      }
    },
  },
  {
    name: "arch/mesh-write-scope: writes route through the atomic writeText seam, never a bare writeFile/appendFile",
    async run() {
      const code = stripComments(await readFile(MESH_STORE, "utf8"));
      // The store persists via writeText (the atomic temp+rename seam) — it must
      // call writeText and must NOT call a bare writeFile/appendFile that bypasses it.
      assert.ok(/\bwriteText\s*\(/.test(code), "the store persists via the atomic writeText seam");
      const bareWrites = collectCalls(code, DIRECT_WRITE_VERBS);
      assert.equal(bareWrites.length, 0, `the store calls no bare ${DIRECT_WRITE_VERBS.join("/")} (every persist routes through writeText) — got: ${bareWrites.map((c) => c.verb).join(", ")}`);
    },
  },
  {
    name: "arch/mesh-write-scope: every write joins meshDir/nodeRecordPath (the partition seam)",
    async run() {
      const code = stripComments(await readFile(MESH_STORE, "utf8"));
      const writeCalls = collectCalls(code, SEAM_WRITE_VERBS);
      assert.ok(writeCalls.length >= 1, "the store performs at least one fs write (it persists node records)");
      for (const call of writeCalls) {
        const joinsSeam = /meshDir\s*\(/.test(call.firstArg) || /nodeRecordPath\s*\(/.test(call.firstArg);
        assert.ok(
          joinsSeam,
          `the ${call.verb}(...) write joins the partition seam (meshDir/nodeRecordPath), not a record doc — got: ${call.firstArg}`
        );
      }
    },
  },
  {
    name: "arch/mesh-write-scope: meshDir is the single partition-root seam and nodeRecordPath is built from it",
    async run() {
      const code = stripComments(await readFile(MESH_STORE, "utf8"));
      assert.ok(/function\s+meshDir\s*\(/.test(code), "meshDir is defined as the single partition-root seam");
      assert.ok(/function\s+nodeRecordPath\s*\(/.test(code), "nodeRecordPath is the single node-record path builder");
      assert.ok(/nodeRecordPath[\s\S]*?meshDir\s*\(/.test(code), "nodeRecordPath is built from meshDir (one seam)");

      // The only path.join into the .aof config home (aofHome) is meshDir's "mesh"
      // leaf — no write joins the config home directly with a non-mesh segment.
      // (Location moved off workDir to .aof/mesh at 28/verify.)
      const aofHomeJoins = [...code.matchAll(/path\.join\s*\(\s*aofHome\s*\(\s*workspace\s*\)\s*,([^)]*)\)/g)];
      assert.ok(aofHomeJoins.length >= 1, "meshDir joins aofHome(workspace) — the partition root is anchored on the .aof config home");
      for (const match of aofHomeJoins) {
        assert.ok(
          /["']mesh["']/.test(match[1]),
          `the only join into aofHome(workspace) is the mesh partition root — got path.join(aofHome(workspace), ${match[1].trim()})`
        );
      }
    },
  },
  {
    name: "arch/mesh-write-scope: the mesh:* command modules reference zero record-doc filename (ARCHITECTURE.md fitness #2 scans them too)",
    async run() {
      for (const moduleUrl of MESH_COMMAND_MODULES) {
        const code = stripComments(await readFile(moduleUrl, "utf8"));
        for (const doc of RECORD_DOCS) {
          assert.ok(
            !code.includes(doc),
            `${moduleUrl.pathname.split("/").pop()} references no record-doc filename "${doc}" — a mesh command can never target one`
          );
        }
      }
      // Self-check (non-vacuous): the guard DOES fire on a record-doc reference.
      assert.ok(
        stripComments('await writeText(path.join(dir, "STATE.md"), body);').includes("STATE.md"),
        "the record-doc scan catches a real STATE.md reference"
      );
    },
  },
  {
    name: "arch/mesh-write-scope: every write verb in the mesh:* command modules routes through the atomic writeText seam, never a bare writeFile/appendFile",
    async run() {
      // At least one mesh command writes (mesh-identity persists config.mesh.salt via
      // writeText) — the scan must observe a writeText AND find no bare write.
      let sawWriteText = false;
      for (const moduleUrl of MESH_COMMAND_MODULES) {
        const code = stripComments(await readFile(moduleUrl, "utf8"));
        if (/\bwriteText\s*\(/.test(code)) sawWriteText = true;
        const bareWrites = collectCalls(code, DIRECT_WRITE_VERBS);
        assert.equal(
          bareWrites.length,
          0,
          `${moduleUrl.pathname.split("/").pop()} calls no bare ${DIRECT_WRITE_VERBS.join("/")} (every persist routes through writeText) — got: ${bareWrites.map((c) => c.verb).join(", ")}`
        );
      }
      // mesh-identity legitimately writes the config via writeText(configPath, …) — so
      // the scan is non-vacuous (it actually observed a routed write, not an empty set).
      assert.ok(sawWriteText, "a mesh:* command persists via the atomic writeText seam (mesh-identity's config persist)");
      // Self-check (non-vacuous): the bare-write detector DOES fire on a real writeFile.
      assert.equal(
        collectCalls(stripComments('await writeFile(configPath, body);'), DIRECT_WRITE_VERBS).length,
        1,
        "the bare-write detector catches a real writeFile call"
      );
    },
  },
];

// --- source-analysis helpers (mirroring acd-run-write-scope) ----------------

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
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
