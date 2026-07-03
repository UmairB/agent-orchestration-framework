// Fitness function: acd-run-store-mesh-free (milestone 26 / story 00 / ADR-001 /
// fitness #4) — "Single-node zero mesh coupling (the store half)."
//
//   "src/run-store.mjs imports NO mesh module (mesh-store / mesh-presence /
//    mesh-lease / mesh-relay*) and reads no config — the node id arrives as DATA
//    (a record key / mint argument)."
//
// GREEN-able at story 00 and kept armed for the future: stories 01/02 add lease and
// command mechanics AROUND the store; this gate is what keeps the single-node
// install's spine mesh-free forever (08/ADR-002 basis-neutral). Source-discipline
// grep modelled on acd-mesh-sync-record-neutral (comment-stripped for import
// specifiers; comment-AND-string-stripped for live-code identifiers), with the m03
// non-vacuous self-checks.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN_STORE = path.join(repoRoot, "src", "run-store.mjs");

function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Comment-AND-string-stripped — live-code identifiers only (a documenting mention
// of "config" in a comment or string never trips the guard).
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

const MESH_MODULE = /(^|\/)mesh-[^/]+\.mjs$/;

export const archTests = [
  {
    name: "arch/run-store-mesh-free: src/run-store.mjs imports NO mesh module (mesh-store/mesh-presence/mesh-lease/mesh-relay*) — the single-node spine stays mesh-free",
    run: async () => {
      const specs = importSpecifiers(stripCommentsOnly(await readFile(RUN_STORE, "utf8")));
      const meshImports = specs.filter((s) => MESH_MODULE.test(s));
      assert.deepEqual(
        meshImports,
        [],
        `src/run-store.mjs imports no mesh module — imports: ${specs.join(", ")}`
      );
      // Self-check (non-vacuous): the matcher catches every mesh-module form.
      for (const bad of ["./mesh-store.mjs", "./mesh-presence.mjs", "./mesh-lease.mjs", "./mesh-relay-client.mjs"]) {
        assert.ok(MESH_MODULE.test(bad), `the matcher catches a real ${bad} import`);
      }
      assert.ok(!MESH_MODULE.test("./fs.mjs"), "the matcher does NOT flag the store's one legitimate dependency (./fs.mjs)");
    },
  },
  {
    name: "arch/run-store-mesh-free: src/run-store.mjs reads no config (no `config` identifier, no loadWorkspace) — the node id arrives as data",
    run: async () => {
      const liveCode = stripCommentsAndStrings(await readFile(RUN_STORE, "utf8"));
      assert.ok(
        !/\bconfig\b/i.test(liveCode),
        "src/run-store.mjs's live code carries no `config` identifier (the store never reads config — 08/ADR-002 basis-neutral)"
      );
      assert.ok(!/\bloadWorkspace\b/.test(liveCode), "src/run-store.mjs never loads a workspace (it is handed items and data)");
      // Self-checks (non-vacuous): the guard fires on a real config read and does
      // NOT fire on a documented mention.
      assert.ok(/\bconfig\b/i.test("const node = workspace.config.mesh.nodeId;"), "the guard catches a real config read");
      assert.ok(
        !/\bconfig\b/i.test(stripCommentsAndStrings("// the store reads no config")),
        "the guard does NOT fire on a comment mention"
      );
    },
  },
  {
    name: "arch/run-store-mesh-free: the mint's node is PARAMETER-sourced — startRun/mintRun accept `node` in their options and thread it as data",
    run: async () => {
      const code = stripCommentsOnly(await readFile(RUN_STORE, "utf8"));
      // Balanced-paren extraction of a function's PARAMETER LIST (the options
      // destructuring contains `brief = {}`, so a naive [^}]* regex would cut short).
      const paramsOf = (name) => {
        const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(code);
        if (!m) return null;
        const open = code.indexOf("(", m.index);
        let depth = 0;
        for (let i = open; i < code.length; i += 1) {
          const ch = code[i];
          if (ch === "(" || ch === "{" || ch === "[") depth += 1;
          else if (ch === ")" || ch === "}" || ch === "]") {
            depth -= 1;
            if (depth === 0) return code.slice(open + 1, i);
          }
        }
        return null;
      };
      const startParams = paramsOf("startRun");
      assert.ok(startParams != null, "startRun is defined");
      assert.ok(
        /\bnode\s*=\s*null\b/.test(startParams),
        `startRun's options destructuring carries \`node = null\` (the injected-data seam the commands fill in story 02) — got: (${startParams})`
      );
      const mintParams = paramsOf("mintRun");
      assert.ok(mintParams != null, "mintRun is defined");
      assert.ok(
        /\bnode\s*=\s*null\b/.test(mintParams),
        `mintRun's options destructuring carries \`node = null\` (no mesh config ⇒ the flat legacy record) — got: (${mintParams})`
      );
      // Self-check (non-vacuous): the extractor sees through a nested `brief = {}`.
      assert.ok(
        /\bnode\s*=\s*null\b/.test("item, { sessionId = null, brief = {}, now, node = null } = {}".replace(/^item,\s*/, "")),
        "the parameter matcher fires on the real destructured-options form"
      );
    },
  },
];
