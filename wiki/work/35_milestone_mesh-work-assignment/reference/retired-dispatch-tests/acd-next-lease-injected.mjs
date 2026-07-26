// Fitness function: acd-next-lease-injected (milestone 26 / story 01, ADR-005 /
// fitness #7) — "Mesh-aware `next` is injected, optional (the work.mjs half)":
//
//   - src/work.mjs imports NO mesh module (the entire work:* read surface stays
//     mesh-free for every single-node install — the lease view arrives as DATA);
//   - nextWork's lease view is an OPTIONAL third argument defaulting ABSENT
//     (`{ candidacyView } = {}` — byte-identical behaviour without it);
//   - src/commands/next.mjs builds the view ONLY under the config.mesh.nodeId gate
//     (the unconfigured floor is the exact two-argument call of today).
//
// RIPPLE (milestone 27 / story 01, ADR-004): the injected view's parameter was
// RENAMED/WIDENED from `leaseView` to `candidacyView` (the m27 unified candidacy
// view — lease state + routing verdict on ONE Map; `nextWork`'s arity stays a
// single optional argument, m26/#7's invariant restated verbatim over the new
// name — fitness #4 in the m27 ARCHITECTURE.md table). This gate is updated
// in-place to assert the CURRENT name, per story 01's Build notes ripple.
//
// Import-grep + signature/source assertions, modelled on acd-run-store-mesh-free,
// with the m03 non-vacuous planted-violation self-checks.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const WORK_MODULE = new URL("../../src/work.mjs", import.meta.url);
const NEXT_COMMAND = new URL("../../src/commands/next.mjs", import.meta.url);

const MESH_MODULE = /(^|\/)mesh-[^/]+\.mjs$/;
// The optional-injected signature: the third parameter is a destructured
// { candidacyView } DEFAULTING to {} — absent by default, plain data when present.
const NEXT_SIGNATURE_RE = /export\s+async\s+function\s+nextWork\s*\(\s*workDir\s*,\s*scopeRef\s*,\s*\{\s*candidacyView\s*\}\s*=\s*\{\}\s*\)/;
// The command-layer config gate: the view is built only when config.mesh.nodeId
// is present (the optional-chain read off the workspace config).
const CONFIG_GATE_RE = /config\s*\?\.\s*mesh\s*\?\.\s*nodeId/;

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

export const archTests = [
  {
    name: "arch/next-lease-injected: src/work.mjs imports NO mesh module — the lease view crosses the seam as data, never a coupling",
    async run() {
      const specs = importSpecifiers(stripComments(await readFile(WORK_MODULE, "utf8")));
      const meshImports = specs.filter((s) => MESH_MODULE.test(s));
      assert.deepEqual(
        meshImports,
        [],
        `src/work.mjs imports no mesh module — imports: ${specs.join(", ")}`
      );
      // Self-check (non-vacuous): the matcher catches every mesh-module form and
      // spares the legitimate dependencies.
      for (const bad of ["./mesh-lease.mjs", "./mesh-store.mjs", "./mesh-presence.mjs", "./mesh-relay-client.mjs"]) {
        assert.ok(MESH_MODULE.test(bad), `the matcher catches a planted ${bad} import`);
      }
      assert.ok(!MESH_MODULE.test("./fs.mjs"), "the matcher does NOT flag ./fs.mjs");
      assert.ok(!MESH_MODULE.test("./workspace.mjs"), "the matcher does NOT flag ./workspace.mjs");
    },
  },
  {
    name: "arch/next-lease-injected: nextWork's candidacy view is an OPTIONAL third argument defaulting absent ({ candidacyView } = {})",
    async run() {
      const code = stripComments(await readFile(WORK_MODULE, "utf8"));
      assert.ok(
        NEXT_SIGNATURE_RE.test(code),
        "nextWork's signature is nextWork(workDir, scopeRef, { candidacyView } = {}) — optional, defaulting absent"
      );
      // The view is consumed as PLAIN DATA: only .get(ref) is touched (the frozen
      // task-02/m27 shape — a hand-built Map drives the walk).
      assert.ok(
        /candidacyView\s*\?\.\s*get\s*\?\.\s*\(|candidacyView\s*\?\.\s*get\s*\(/.test(code),
        "nextWork touches only candidacyView.get(ref) (optional-chained — absent view is a no-op)"
      );
      // Self-checks (non-vacuous): the signature matcher rejects the planted
      // two-argument form, a required third argument, AND the superseded m26 name.
      assert.ok(
        !NEXT_SIGNATURE_RE.test("export async function nextWork(workDir, scopeRef) {"),
        "the matcher rejects the un-extended two-argument signature"
      );
      assert.ok(
        !NEXT_SIGNATURE_RE.test("export async function nextWork(workDir, scopeRef, candidacyView) {"),
        "the matcher rejects a REQUIRED (non-defaulted) candidacy-view argument"
      );
      assert.ok(
        !NEXT_SIGNATURE_RE.test("export async function nextWork(workDir, scopeRef, { leaseView } = {}) {"),
        "the matcher rejects the superseded m26 { leaseView } name"
      );
    },
  },
  {
    name: "arch/next-lease-injected: src/commands/next.mjs builds the view ONLY under the config.mesh.nodeId gate",
    async run() {
      const code = stripComments(await readFile(NEXT_COMMAND, "utf8"));
      // Positive: the gate exists and the view builder is called.
      assert.ok(CONFIG_GATE_RE.test(code), "commands/next.mjs gates on config?.mesh?.nodeId");
      assert.ok(/\bbuildLeaseView\s*\(/.test(code), "commands/next.mjs composes the view via buildLeaseView");
      // The gate PRECEDES the view build in source (the build lives inside the
      // gated branch, so an unconfigured install never pays for the lease read).
      const gateIndex = code.search(CONFIG_GATE_RE);
      const buildIndex = code.indexOf("buildLeaseView(");
      assert.ok(gateIndex >= 0 && buildIndex > gateIndex, "the view build sits after (inside) the config gate");
      // The unconfigured floor is the exact two-argument call of today.
      assert.ok(
        /nextWork\s*\(\s*ws\.workDir\s*,\s*scope\s*\)/.test(code),
        "the unconfigured branch calls the exact two-argument nextWork of today"
      );
      // Self-check (non-vacuous): the gate matcher fires on the real read and not on
      // an unrelated config touch.
      assert.ok(CONFIG_GATE_RE.test("const nodeId = ws.config?.mesh?.nodeId;"), "the gate matcher catches the real config.mesh.nodeId read");
      assert.ok(!CONFIG_GATE_RE.test("const dir = ws.config?.work?.dir;"), "the gate matcher does not fire on an unrelated config read");
    },
  },
];
