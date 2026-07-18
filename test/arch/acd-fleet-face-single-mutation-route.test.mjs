// Fitness function: acd-fleet-face-single-mutation-route (milestone 38 / story
// 04; ARCHITECTURE ADR-012; SECURITY T13).
//
// "The fleet face (mesh-ui-serve.mjs) exposes EXACTLY ONE mutation route,
// POST /api/mesh/assign, and it mints only through the existing assignWork
// verb (no insertAssignment/global_assignments write reachable except through
// the gated verb); a gate miss maps to a coded non-200, never a 200; the face
// keeps its ONE loopback http.createServer, no low-level writer import."
//
// Arms all FOUR ADR-012 structural invariants:
//   1. EXACTLY ONE mutation route, and it is POST /api/mesh/assign.
//   2. The write route mints through assignWork and no other path (no
//      insertAssignment/global_assignments write reachable except via the verb).
//   3. A gate miss is a coded non-200 — never a 200, never swallowed.
//   4. The face stays otherwise read-only: one loopback http.createServer, no
//      low-level writer import, no /ws/terminal.
//
// STRUCTURAL half: source-analysis over the REAL src/mesh-ui-serve.mjs (comments
// discounted, CRLF-normalised — the repo's tree is CRLF; an "\n"-only needle
// would silently no-op against the checked-out file and leave a self-check
// vacuous). Every plant below is a HAND-WRITTEN synthesized snippet (never a
// string-replace on the real file, the acd-clone-credential-pull-not-pushed
// convention) — each plant asserts it LANDED (`notEqual(planted, clean)`)
// before asserting the detector trips on it and stays quiet on `clean`.
//
// BEHAVIOURAL half: the REAL serveMeshUi stood up over an isolated
// AOF_GLOBAL_HOME v3 store proves invariant #1 (every OTHER path/method is
// refused, never 2xx) and invariant #3 (a real gate miss is a real coded
// non-200 that mints nothing) against the ACTUAL running handler, not just its
// source text.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withAssignRouteFixture, sameOriginAssign, seedTargetNode, readAssignmentRows } from "../support/mesh-ui-assign-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// lf(source) — normalise CRLF → LF before every regex probe. The tree is
// checked out with CRLF line endings on this platform (core.autocrlf=true);
// a plant/detector written against "\n" boundaries would silently no-op on a
// raw CRLF read and make the self-check vacuous — the exact failure class this
// milestone was repeatedly burned by (F1/F4/F6/F7/F8).
function lf(source) {
  return source.replace(/\r\n/g, "\n");
}

async function realSource() {
  return lf(stripComments(await readFile(MESH_UI_SERVE, "utf8")));
}

// --- detector #1 — EXACTLY ONE mutation route, and it is POST /api/mesh/assign ---

function routeTableProblems(source) {
  const problems = [];
  const declared = [...source.matchAll(/pathname\s*===\s*["'](\/api\/mesh\/[a-zA-Z-]+)["']/g)].map((m) => m[1]);
  const unique = [...new Set(declared)].sort();
  const expected = ["/api/mesh/assign", "/api/mesh/board-url", "/api/mesh/status"].sort();
  if (JSON.stringify(unique) !== JSON.stringify(expected)) {
    problems.push(`route table is ${JSON.stringify(unique)}, expected exactly ${JSON.stringify(expected)}`);
  }
  // the ONE write route guards itself to POST only.
  if (!/pathname\s*===\s*["']\/api\/mesh\/assign["'][\s\S]{0,200}?request\.method\s*!==\s*["']POST["']/.test(source)) {
    problems.push("POST /api/mesh/assign is not guarded to POST-only before dispatch");
  }
  return problems;
}

// --- detector #2 — mints ONLY through assignWork; no low-level writer reachable ---

function mintPathProblems(source) {
  const problems = [];
  if (!/\bassignWork\s*\(/.test(source)) problems.push("no assignWork( call found — nothing mints through the verb");
  if (/\binsertAssignment\s*\(/.test(source)) problems.push("a direct insertAssignment( call bypasses the verb's own gates");
  if (/\bupdateAssignmentState\s*\(/.test(source)) problems.push("a direct updateAssignmentState( call bypasses the verb's own gates");
  if (/from\s*["']\.\/assignment-record\.mjs["']/.test(source)) problems.push("imports ./assignment-record.mjs directly — the low-level table writer");
  return problems;
}

// --- detector #3 — a gate miss (result.ok===false) is a coded non-200, never 200 ---

function gateSwallowProblems(source) {
  const problems = [];
  const okCheck = /if\s*\(\s*!\s*result\.ok\s*\)\s*\{/.exec(source);
  if (!okCheck) {
    problems.push("no `if (!result.ok)` gate found guarding the mint's failure path");
    return problems;
  }
  const guardStart = okCheck.index;
  const braceOpen = source.indexOf("{", guardStart);
  const guardBody = sliceBalanced(source, braceOpen);
  if (guardBody == null) {
    problems.push("the `if (!result.ok)` guard block is not brace-balanced (could not extract it)");
    return problems;
  }
  if (!/sendApiError\s*\(/.test(guardBody)) problems.push("the gate-miss branch does not call sendApiError( — a miss may fall through silently");
  if (/sendJson\s*\(\s*response\s*,\s*200/.test(guardBody)) problems.push("the gate-miss branch itself sends a 200 — a refusal must never be a 200");
  if (!/\breturn\s*;/.test(guardBody)) problems.push("the gate-miss branch does not return — execution could fall through to a success send");
  // the success 200-send must sit OUTSIDE (after) the guard block, never inside it.
  const guardEnd = braceOpen + 1 + guardBody.length;
  const afterGuard = source.slice(guardEnd);
  if (!/sendJson\s*\(\s*response\s*,\s*200\s*,\s*result\s*\)/.test(afterGuard)) {
    problems.push("no unconditional 200-success send found AFTER the gate-miss guard — the success path itself may be missing");
  }
  return problems;
}

// --- detector #4 — the face stays otherwise read-only ---

function readOnlyPostureProblems(source) {
  const problems = [];
  const serverCount = (source.match(/http\.createServer\s*\(/g) ?? []).length;
  if (serverCount !== 1) problems.push(`http.createServer( appears ${serverCount} times, expected exactly 1`);
  if (/["']\/ws\/terminal["']/.test(source)) problems.push("a /ws/terminal path is declared — the face must serve no terminal upgrade");
  if (!/socket\.destroy\s*\(\s*\)/.test(source)) problems.push("no socket.destroy() — an upgrade is not unconditionally refused");
  // deny-list of low-level mesh-core writers, carving out the ONE sanctioned
  // ./commands/mesh-assign.mjs door (ADR-012) and the pre-existing
  // ./global-mesh-query.mjs read door (ADR-006).
  const denyPattern = /from\s*["']\.\/(mesh-(store|presence|registry|sync)|global-(work-store|node-registry))\.mjs["']/;
  if (denyPattern.test(source)) problems.push("imports a low-level mesh-core writer module directly");
  const commandsImports = [...source.matchAll(/from\s*["'](\.\/commands\/[a-zA-Z0-9._-]+)["']/g)].map((m) => m[1]);
  const otherCommands = commandsImports.filter((spec) => spec !== "./commands/mesh-assign.mjs");
  if (otherCommands.length > 0) problems.push(`imports a commands/* module OTHER than the sanctioned door: ${otherCommands.join(", ")}`);
  return problems;
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

export const archTests = [
  // ══ invariant #1 — EXACTLY ONE mutation route, and it is POST /api/mesh/assign ══
  {
    name: "arch/38 ADR-012 inv.1: mesh-ui-serve.mjs declares EXACTLY ONE mutation route — POST /api/mesh/assign — guarded to POST only",
    async run() {
      const source = await realSource();
      assert.deepEqual(routeTableProblems(source), [], "the real source declares exactly the two GET routes + the one guarded POST /api/mesh/assign route");

      // PLANT — a SECOND write route (/api/mesh/route) declared beside the
      // sanctioned exception. Hand-written minimal snippets (never a
      // string-replace on the real file).
      const clean = stripComments(`
        if (pathname === "/api/mesh/status") { if (request.method !== "GET" && request.method !== "HEAD") return; }
        if (pathname === "/api/mesh/board-url") { if (request.method !== "GET" && request.method !== "HEAD") return; }
        if (pathname === "/api/mesh/assign") { if (request.method !== "POST") return; }
      `);
      const planted = stripComments(`
        if (pathname === "/api/mesh/status") { if (request.method !== "GET" && request.method !== "HEAD") return; }
        if (pathname === "/api/mesh/board-url") { if (request.method !== "GET" && request.method !== "HEAD") return; }
        if (pathname === "/api/mesh/assign") { if (request.method !== "POST") return; }
        if (pathname === "/api/mesh/route") { sendJson(response, 200, { ok: true }); }
      `);
      assert.notEqual(planted, clean, "the plant actually differs from the clean synthesized shape");
      assert.deepEqual(routeTableProblems(clean), [], "the clean synthesized shape stays quiet");
      assert.ok(routeTableProblems(planted).length > 0, "self-check: a planted SECOND write route trips the detector");

      // PLANT — the write route is dispatched WITHOUT a method guard (a GET on
      // /api/mesh/assign would reach the mutation).
      const ungatedPlant = stripComments(`
        if (pathname === "/api/mesh/status") { if (request.method !== "GET" && request.method !== "HEAD") return; }
        if (pathname === "/api/mesh/board-url") { if (request.method !== "GET" && request.method !== "HEAD") return; }
        if (pathname === "/api/mesh/assign") { const result = await assignWork(workspace, ref, nodeId, ctx); }
      `);
      assert.notEqual(ungatedPlant, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(routeTableProblems(ungatedPlant).length > 0, "self-check: an ungated (no POST-only guard) assign route trips the detector");
    },
  },

  // ══ invariant #2 — mints ONLY through assignWork; no low-level writer reachable ══
  {
    name: "arch/38 ADR-012 inv.2: mesh-ui-serve.mjs mints ONLY through assignWork — no insertAssignment/updateAssignmentState/assignment-record.mjs reachable",
    async run() {
      const source = await realSource();
      assert.deepEqual(mintPathProblems(source), [], "the real source mints only through assignWork(...)");

      const clean = "const result = await assignWork(assignWorkspace, ref, nodeId, { globalWorkStoreOptions: globalStoreOptions ?? {} });";
      const plantedBypass = 'import { insertAssignment } from "./assignment-record.mjs";\nconst result = insertAssignment(store, { itemRef: ref, targetNodeId: nodeId });';
      assert.notEqual(plantedBypass, clean, "the plant actually differs from the clean synthesized shape");
      assert.deepEqual(mintPathProblems(clean), [], "the clean synthesized shape stays quiet");
      assert.ok(mintPathProblems(plantedBypass).length > 0, "self-check: a planted direct insertAssignment( bypass trips the detector");

      const plantedUpdate = "const result = updateAssignmentState(store, forgedId, \"assigned\", {});";
      assert.notEqual(plantedUpdate, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(mintPathProblems(plantedUpdate).length > 0, "self-check: a planted direct updateAssignmentState( bypass trips the detector");
    },
  },

  // ══ invariant #3 — a gate miss is a coded non-200, never a 200, never swallowed ══
  {
    name: "arch/38 ADR-012 inv.3: mesh-ui-serve.mjs surfaces a gate miss as a coded non-200 — never a 200, never a second success path around the gates",
    async run() {
      const source = await realSource();
      assert.deepEqual(gateSwallowProblems(source), [], "the real source's !result.ok branch sends a coded error and returns, before the unconditional 200 send");

      const clean = stripComments(`
        const result = await assignWork(assignWorkspace, ref, nodeId, ctx);
        if (!result.ok) {
          const { ok: _ok, error: message, code, ...extra } = result;
          sendApiError(response, assignGateStatus(code), message, code, extra);
          return;
        }
        sendJson(response, 200, result);
      `);
      // PLANT — the gate-miss branch is swallowed: it logs but still falls
      // through to the unconditional 200 send (the exact "never a 200 for a
      // refusal" violation this invariant forbids).
      const plantedSwallow = stripComments(`
        const result = await assignWork(assignWorkspace, ref, nodeId, ctx);
        if (!result.ok) {
          console.warn(result.error);
        }
        sendJson(response, 200, result);
      `);
      assert.notEqual(plantedSwallow, clean, "the plant actually differs from the clean synthesized shape");
      assert.deepEqual(gateSwallowProblems(clean), [], "the clean synthesized shape stays quiet");
      assert.ok(gateSwallowProblems(plantedSwallow).length > 0, "self-check: a swallowed gate-miss (falls through to 200) trips the detector");

      // PLANT — the gate-miss branch itself sends a 200 (a "refusal" that is
      // still, somehow, a success envelope).
      const plantedFake200 = stripComments(`
        const result = await assignWork(assignWorkspace, ref, nodeId, ctx);
        if (!result.ok) {
          sendJson(response, 200, { ok: false, code: result.code });
          return;
        }
        sendJson(response, 200, result);
      `);
      assert.notEqual(plantedFake200, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(gateSwallowProblems(plantedFake200).length > 0, "self-check: a gate-miss branch that itself sends 200 trips the detector");
    },
  },

  // ══ invariant #4 — the face stays otherwise read-only ══
  {
    name: "arch/38 ADR-012 inv.4: mesh-ui-serve.mjs stays otherwise read-only — one loopback http.createServer, no low-level writer import, no /ws/terminal",
    async run() {
      const source = await realSource();
      assert.deepEqual(readOnlyPostureProblems(source), [], "the real source keeps exactly one server, no /ws/terminal, no low-level writer import beyond the sanctioned door");

      const clean = 'const server = http.createServer(async (request, response) => {});\nimport { assignWork } from "./commands/mesh-assign.mjs";\nsocket.destroy();';
      const plantedSecondServer = 'const server = http.createServer(async (request, response) => {});\nconst mirror = http.createServer(async (request, response) => {});\nimport { assignWork } from "./commands/mesh-assign.mjs";\nsocket.destroy();';
      assert.notEqual(plantedSecondServer, clean, "the plant actually differs from the clean synthesized shape");
      assert.deepEqual(readOnlyPostureProblems(clean), [], "the clean synthesized shape stays quiet");
      assert.ok(readOnlyPostureProblems(plantedSecondServer).length > 0, "self-check: a planted SECOND http.createServer( trips the detector");

      const plantedTerminal = 'const server = http.createServer(async (request, response) => {});\nimport { assignWork } from "./commands/mesh-assign.mjs";\nif (pathname === "/ws/terminal") { attachTerminalWebSocket(request, socket); }\nsocket.destroy();';
      assert.notEqual(plantedTerminal, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(readOnlyPostureProblems(plantedTerminal).length > 0, "self-check: a planted /ws/terminal path trips the detector");

      const plantedWriterImport = 'const server = http.createServer(async (request, response) => {});\nimport { assignWork } from "./commands/mesh-assign.mjs";\nimport { insertAssignment } from "./assignment-record.mjs";\nimport { deleteWorkItem } from "./commands/mesh-issue.mjs";\nsocket.destroy();';
      assert.notEqual(plantedWriterImport, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(readOnlyPostureProblems(plantedWriterImport).length > 0, "self-check: a planted second commands/* import trips the detector");
    },
  },

  // ══ behavioural — proving invariants #1 + #3 against the REAL running handler ══
  {
    name: "arch/38 ADR-012 (behavioural): the REAL fleet face — every OTHER path/method stays 405/404, and a REAL gate miss is a REAL coded non-200 that mints nothing",
    async run() {
      await withAssignRouteFixture(async ({ url, home, workspaceId }) => {
        // invariant #1 — every other route/method is refused, never a 2xx.
        const rows = [
          { method: "POST", path: "/api/mesh/status" },
          { method: "POST", path: "/api/mesh/board-url" },
          { method: "PUT", path: "/api/mesh/assign" },
          { method: "DELETE", path: "/api/mesh/assign" },
          { method: "GET", path: "/api/mesh/assign" },
          { method: "POST", path: "/api/mesh/issue" },
          { method: "POST", path: "/api/mesh/revoke" },
        ];
        for (const row of rows) {
          const res = await fetch(new URL(row.path, url), {
            method: row.method,
            headers: { origin: new URL(url).origin, "content-type": "application/json" },
          });
          assert.notEqual(res.status, 200, `${row.method} ${row.path} is never a 200`);
          const body = await res.json();
          assert.notEqual(body.ok, true, `${row.method} ${row.path} never succeeds`);
        }

        // invariant #3 — a REAL gate miss (an unregistered node) is a REAL coded
        // non-200 that mints nothing.
        const refused = await sameOriginAssign(url, "38/04", "ghost");
        assert.notEqual(refused.status, 200, "a real gate miss is never a 200");
        assert.ok(refused.status >= 400 && refused.status < 500, `a real gate miss is a coded 4xx — got ${refused.status}`);
        const refusedBody = await refused.json();
        assert.equal(refusedBody.code, "assignment-target-unknown");
        assert.notEqual(refusedBody.ok, true, "a real gate miss never carries an ok:true envelope");
        const minted = await readAssignmentRows({ home }, workspaceId, "38/04");
        assert.equal(minted.length, 0, "a real gate miss mints nothing");

        // …and a REAL eligible assign still mints through the verb (the ONE
        // sanctioned path stays live even after every refusal above).
        await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true });
        const accepted = await sameOriginAssign(url, "38/04", "worker-a");
        assert.equal(accepted.status, 200, "the one sanctioned mutation route still mints for an eligible request");
        const mintedAfter = await readAssignmentRows({ home }, workspaceId, "38/04");
        assert.equal(mintedAfter.length, 1);
      });
    },
  },
];
