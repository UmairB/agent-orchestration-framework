// Fitness function: acd-next-candidacy-injected (milestone 27 / story 01, ADR-004
// / fitness #4) — "Mesh-aware `next` is injected + optional; `work.mjs` stays
// mesh-free (the m26/#7 invariant restated over the UNIFIED candidacy view)":
//
//   - src/work.mjs imports NO mesh module (the entire work:* read surface stays
//     mesh-free for every single-node install — the candidacy view arrives as
//     DATA);
//   - nextWork's candidacy view is the OPTIONAL third argument defaulting ABSENT
//     (`{ candidacyView } = {}` — byte-identical behaviour without it);
//   - src/commands/next.mjs builds the UNIFIED view (lease + routing filter) ONLY
//     under the config.mesh.nodeId gate (the unconfigured floor is the exact
//     two-argument call of today);
//   - the routing-fold half — the directive read + nodeSatisfiesTarget call under
//     the SAME gate — is existsSync-guarded on the not-yet-built module, tightening
//     once src/mesh-issuance.mjs exists (it does, as of story 00/01).
//
// Extends acd-next-lease-injected's shape (which this story's ripple edit already
// updates to the candidacyView name) with the routing-fold assertion the
// ARCHITECTURE.md table names for fitness #4. Import-grep + signature/source
// assertions, with the m03 non-vacuous planted-violation self-checks.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK_MODULE = path.join(repoRoot, "src", "work.mjs");
const NEXT_COMMAND = path.join(repoRoot, "src", "commands", "next.mjs");
const ISSUANCE_MODULE = path.join(repoRoot, "src", "mesh-issuance.mjs");

const MESH_MODULE = /(^|\/)mesh-[^/]+\.mjs$/;
const NEXT_SIGNATURE_RE = /export\s+async\s+function\s+nextWork\s*\(\s*workDir\s*,\s*scopeRef\s*,\s*\{\s*candidacyView\s*\}\s*=\s*\{\}\s*\)/;
const CONFIG_GATE_RE = /config\s*\?\.\s*mesh\s*\?\.\s*nodeId|ws\.config\s*\?\.\s*mesh\s*\?\.\s*nodeId/;

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
    name: "arch/next-candidacy-injected: src/work.mjs imports NO mesh module — the candidacy view crosses the seam as data, never a coupling",
    async run() {
      const specs = importSpecifiers(stripComments(await readFile(WORK_MODULE, "utf8")));
      const meshImports = specs.filter((s) => MESH_MODULE.test(s));
      assert.deepEqual(meshImports, [], `src/work.mjs imports no mesh module — imports: ${specs.join(", ")}`);
      for (const bad of ["./mesh-lease.mjs", "./mesh-store.mjs", "./mesh-presence.mjs", "./mesh-issuance.mjs", "./mesh-registry.mjs"]) {
        assert.ok(MESH_MODULE.test(bad), `the matcher catches a planted ${bad} import`);
      }
      assert.ok(!MESH_MODULE.test("./fs.mjs"), "the matcher does NOT flag ./fs.mjs");
      assert.ok(!MESH_MODULE.test("./workspace.mjs"), "the matcher does NOT flag ./workspace.mjs");
    },
  },
  {
    name: "arch/next-candidacy-injected: nextWork's candidacy view is an OPTIONAL third argument defaulting absent ({ candidacyView } = {})",
    async run() {
      const code = stripComments(await readFile(WORK_MODULE, "utf8"));
      assert.ok(
        NEXT_SIGNATURE_RE.test(code),
        "nextWork's signature is nextWork(workDir, scopeRef, { candidacyView } = {}) — optional, defaulting absent"
      );
      assert.ok(
        /candidacyView\s*\?\.\s*get\s*\?\.\s*\(|candidacyView\s*\?\.\s*get\s*\(/.test(code),
        "nextWork touches only candidacyView.get(ref) (optional-chained — absent view is a no-op)"
      );
      assert.ok(
        !NEXT_SIGNATURE_RE.test("export async function nextWork(workDir, scopeRef) {"),
        "the matcher rejects the un-extended two-argument signature"
      );
      assert.ok(
        !NEXT_SIGNATURE_RE.test("export async function nextWork(workDir, scopeRef, candidacyView) {"),
        "the matcher rejects a REQUIRED (non-defaulted) candidacy-view argument"
      );
    },
  },
  {
    name: "arch/next-candidacy-injected: src/commands/next.mjs builds the UNIFIED (lease + routing) view ONLY under the config.mesh.nodeId gate",
    async run() {
      const code = stripComments(await readFile(NEXT_COMMAND, "utf8"));
      // Positive: the gate exists and the lease-view builder is called.
      assert.ok(CONFIG_GATE_RE.test(code), "commands/next.mjs gates on config?.mesh?.nodeId");
      assert.ok(/\bbuildLeaseView\s*\(/.test(code), "commands/next.mjs composes the lease half via buildLeaseView");
      // The gate PRECEDES the view build in source (the build lives inside the
      // gated branch, so an unconfigured install never pays for the read).
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
  {
    name: "arch/next-candidacy-injected: the ROUTING-FOLD half — commands/next.mjs consults readIssuanceDirectives + nodeSatisfiesTarget under the SAME config gate (existsSync-guarded on mesh-issuance.mjs)",
    async run() {
      if (!existsSync(ISSUANCE_MODULE)) {
        // Vacuous-safe: the substrate module does not exist yet — no routing fold
        // can be built against it. Pinned explicitly (never an accidental skip).
        assert.ok(true, "src/mesh-issuance.mjs does not exist yet — the routing-fold half is vacuously satisfied");
        return;
      }
      const code = stripComments(await readFile(NEXT_COMMAND, "utf8"));
      assert.ok(/readIssuanceDirectives\s*\(/.test(code), "commands/next.mjs reads the issuance directives for routing");
      assert.ok(/nodeSatisfiesTarget\s*\(/.test(code), "commands/next.mjs applies the pure targeting matcher");
      // The routing read sits under the SAME config gate as the lease-view build
      // (both live inside the one config.mesh.nodeId-gated branch).
      const gateIndex = code.search(CONFIG_GATE_RE);
      const routingIndex = code.indexOf("readIssuanceDirectives(");
      assert.ok(gateIndex >= 0 && routingIndex > gateIndex, "the routing read sits inside (after) the config gate");
      // Self-check (non-vacuous): the routing-consumer matcher fires on the real
      // call-sites and not on an unrelated read.
      assert.ok(/readIssuanceDirectives\s*\(/.test("const directives = await readIssuanceDirectives(ws);"), "the matcher catches the real readIssuanceDirectives call");
      assert.ok(!/readIssuanceDirectives\s*\(/.test("const claims = await readLeaseClaims(ws);"), "the matcher does not fire on an unrelated lease read");
    },
  },
];
