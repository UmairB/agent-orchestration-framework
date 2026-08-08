// Fitness function: acd-rendered-component-fed-by-route (milestone 38 / ADR-008)
//
// THE INVARIANT (ADR-008, the mounted-component half). A component must be tested
// through the component PRODUCTION ACTUALLY RENDERS for the payload its route
// returns — never a convenient stand-in. Concretely, for the fleet page: EVERY
// component that renders a per-node card from a `/api/mesh/status` payload must derive
// its current-work line from the ONE shared projection (`fleetCurrentWorkLines` /
// its `nodeCurrentWork` wrapper). No branch of the page may render a node card with no
// current-work line — and no branch may fork its own collapse rule.
//
// WHY IT EXISTS — finding F9 (aof:verify 38, BLOCKER). `ui/src/fleet/Fleet.tsx`
// branches `isGlobalStatus(status) ? <GlobalScopeView/> : <NodesRegion/>`. Milestone
// 38's session render went into `NodesRegion → NodeCard`. But `src/mesh-ui-serve.mjs`
// serves BOTH scopes from `queryGlobalMeshStatus` (its ONE data source), whose payload
// ALWAYS carries `workspaces` — so `isGlobalStatus` is ALWAYS true and the app ALWAYS
// mounts `GlobalScopeView → GlobalNodePanel`, which had NO current-work line at all.
// `NodeCard` was DEAD CODE in production, and its fixture-fed green test hid the bug
// for the whole milestone. A suite can be entirely green about a component the user
// never sees.
//
// PROOFS:
//  1. PRODUCER-FED (behavioural) — the REAL route data source (`queryGlobalMeshStatus`,
//     the only module `mesh-ui-serve.mjs` imports for `/api/mesh/status`) returns, for
//     BOTH scopes, a payload carrying the `workspaces` array Fleet.tsx narrows on. The
//     mounted branch is therefore the GLOBAL one — established from the producer, not
//     assumed.
//  2. STRUCTURAL — in Fleet.tsx, every component that maps over `nodes` (i.e. renders
//     a per-node card) derives its current-work line from the shared projection, either
//     itself or in the card component it renders. Pre-F9 `GlobalNodePanel` fails this.
//  3. STRUCTURAL — the route keeps ONE data source (no second status query slipping in
//     behind the page's narrowing), so the payload shape the components are held to is
//     the only one production can serve.
//  4. SELF-CHECK (non-vacuous) — the analyzer, run over a PLANTED Fleet source that is
//     the real one with the F9 defect re-introduced (the global panel's projection call
//     removed), reports exactly `GlobalNodePanel`; run over the real source it reports
//     nothing.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryGlobalMeshStatus } from "../../src/global-mesh-query.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FLEET_TSX = "ui/src/fleet/Fleet.tsx";
const MESH_UI_SERVE = "src/mesh-ui-serve.mjs";

// The ONE shared current-work projection (ui/src/fleet/runs.mjs) and its thin
// node-shaped wrapper (ui/src/fleet/scope.mjs) — the only sanctioned derivations.
const PROJECTION_CALL = /\b(?:fleetCurrentWorkLines|nodeCurrentWork)\s*\(/;
// A component that renders a per-node card maps over the `nodes` array.
const PER_NODE_RENDER = /\bnodes\b[^;\n]{0,40}\.map\s*\(/;

// ─────────────────────────────────────────────────────────── analyzer (pure) ───

// Split a .tsx source into its top-level `function Name(...) { … }` blocks by brace
// matching (no JSX parser in this repo — the house pattern is a source-text analyzer).
// NOTE the two traps this must not fall into: a component's parameter list is itself a
// destructuring OBJECT (`function NodesRegion({ nodes }: { nodes: FleetNode[] })`), and
// its return type may be an object type (`): { chip: string }`) — so the body's opening
// brace is neither "the first `{` after the name" nor "the first `{` after the `)`".
function matchBrace(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchParen(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function bodyOpenBrace(source, afterParams) {
  let i = afterParams + 1;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (source[i] === ":") {
    // a return-type annotation — skip it (including an OBJECT type) to reach the body.
    i += 1;
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (source[i] === "{") {
      const close = matchBrace(source, i);
      if (close === -1) return -1;
      i = close + 1;
    } else {
      while (i < source.length && source[i] !== "{") i += 1;
    }
  }
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return source[i] === "{" ? i : -1;
}

function componentBlocks(source) {
  const blocks = [];
  const re = /\bfunction\s+([A-Z]\w*)\s*\(/g;
  for (const match of source.matchAll(re)) {
    const paramsOpen = source.indexOf("(", match.index);
    const paramsClose = matchParen(source, paramsOpen);
    if (paramsClose === -1) continue;
    const open = bodyOpenBrace(source, paramsClose);
    if (open === -1) continue;
    const end = matchBrace(source, open);
    if (end === -1) continue;
    blocks.push({ name: match[1], body: source.slice(open, end + 1) });
  }
  return blocks;
}

// The JSX components a block renders (`<Name …`).
function renderedChildren(block) {
  return [...block.body.matchAll(/<([A-Z]\w*)/g)].map((match) => match[1]);
}

// Comments are NOT code: every fixed component now carries a comment NAMING the
// projection ("this calls nodeCurrentWork (./scope.mjs), the SAME fleetCurrentWorkLines
// projection NodeCard already calls"). A guard that accepted a comment as the
// derivation would be exactly the vacuous test this milestone is about.
//
// THE ORDER IS LOAD-BEARING AND IT IS LINE-COMMENTS-FIRST (fixed 2026-08-07, architect's
// structural review of 45/03; the same order `acd-mesh-ui-scope-visible.test.mjs` has
// always used). Stripping BLOCK comments first is silently catastrophic: a LINE comment
// that happens to contain the two characters `/*` — an API glob in prose, a path pattern,
// a regex quoted in English — opens a PHANTOM block comment that runs to the next `*/`
// anywhere in the file and deletes everything between.
// Measured, because this is not hypothetical: `src/mesh-ui-serve.mjs:277` gained the line
// comment `// … //api/* dodges the API guard …` in 45/02 (64d471b). Under the old order
// the stripper ate 39,000 characters of that file, every `queryGlobalMeshStatus(` call
// site vanished, and PROOF 3 below started reporting `found []` — a fitness function
// failing for a reason that had nothing to do with its own subject. A guard that can be
// blinded by prose is a guard nobody can trust to stay honest.
// (The wider sweep — ~30 arch suites carry this same idiom — is TECH_DEBT item 24.)
function stripComments(source) {
  return source.replace(/^[ \t]*\/\/.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

// PROOF 2 — the per-node card renderers with NO current-work derivation anywhere in
// the component they actually render. (Pre-F9 this returns ["GlobalNodePanel"].)
function nodeCardsWithoutCurrentWork(source) {
  const blocks = componentBlocks(stripComments(source));
  const byName = new Map(blocks.map((block) => [block.name, block]));
  const violations = [];
  for (const block of blocks) {
    if (!PER_NODE_RENDER.test(block.body)) continue; // not a per-node card renderer
    const derivesItself = PROJECTION_CALL.test(block.body);
    const derivesInChild = renderedChildren(block).some((name) => {
      const child = byName.get(name);
      return child != null && PROJECTION_CALL.test(child.body);
    });
    if (!derivesItself && !derivesInChild) violations.push(block.name);
  }
  return violations;
}

// The set of per-node card renderers the analyzer FOUND (non-vacuity: if a refactor
// renames `nodes`, this empties and the guard would silently stop guarding).
function nodeCardRenderers(source) {
  return componentBlocks(stripComments(source))
    .filter((block) => PER_NODE_RENDER.test(block.body))
    .map((block) => block.name);
}

export const archTests = [
  {
    name: "arch/38 ADR-008 (acd-rendered-component-fed-by-route): the REAL route data source returns a payload carrying `workspaces` for BOTH scopes — so the branch production mounts is the GLOBAL one (producer-fed, not assumed)",
    run: async () => {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-acd-rendered-component-"));
      try {
        const env = { AOF_GLOBAL_HOME: home };
        // The EXACT function `/api/mesh/status` serves both scopes from.
        const globalPayload = await queryGlobalMeshStatus({ env });
        const localPayload = await queryGlobalMeshStatus({ env, workspaceId: "ws-A" });

        for (const [scope, payload] of [["global", globalPayload], ["local", localPayload]]) {
          assert.ok(
            Array.isArray(payload.workspaces),
            `scope=${scope}: the route's payload carries the \`workspaces\` array Fleet.tsx's isGlobalStatus() narrows on — so the GLOBAL branch is what mounts`,
          );
          assert.ok(Array.isArray(payload.nodes), `scope=${scope}: the payload carries the node roster the card renders`);
        }

        // The page's narrowing predicate genuinely keys on that array (if it ever keys
        // on something else, this rule must be re-derived — fail loudly, don't drift).
        const fleet = await readFile(path.join(REPO, FLEET_TSX), "utf8");
        assert.match(
          fleet,
          /function isGlobalStatus[\s\S]{0,300}?Array\.isArray\([\s\S]{0,80}?\.workspaces\)/,
          "Fleet.tsx narrows the payload on `workspaces` — the fact that makes the global branch the mounted one",
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  },

  {
    name: "arch/38 ADR-008 (acd-rendered-component-fed-by-route): every per-node card renderer in Fleet.tsx derives its current-work line from the ONE shared projection — no branch of the page can carry a DEAD current-work path (F9)",
    run: async () => {
      const fleet = await readFile(path.join(REPO, FLEET_TSX), "utf8");
      const renderers = nodeCardRenderers(fleet);
      // Non-vacuity: the analyzer genuinely found the per-node card renderers (BOTH
      // branches' — the global panel and the local nodes region).
      assert.ok(renderers.length >= 2, `the analyzer reaches the page's per-node card renderers (found ${JSON.stringify(renderers)})`);
      assert.ok(renderers.includes("GlobalNodePanel"), "the GLOBAL branch's node panel — the component production actually mounts — is in scope");
      assert.ok(renderers.includes("NodesRegion"), "the LOCAL branch's nodes region is in scope");

      const violations = nodeCardsWithoutCurrentWork(fleet);
      assert.deepEqual(
        violations,
        [],
        `these components render a node card with NO current-work derivation — if the route's payload mounts one of them, the feature is invisible in production (F9): ${violations.join(", ")}`,
      );
    },
  },

  {
    name: "arch/38 ADR-008 (acd-rendered-component-fed-by-route): the fleet route keeps ONE status data source — the payload shape the components are held to is the only one production can serve",
    run: async () => {
      const serve = await readFile(path.join(REPO, MESH_UI_SERVE), "utf8");
      // The SAME stripper as the analyzer above, and for the same reason: this lane read
      // `found []` for a week because it inlined the block-comments-first order and one
      // line comment in the file it reads contains `//api/*`. One home for the rule.
      const code = stripComments(serve);
      const statusQueries = [...code.matchAll(/\b(query\w*MeshStatus|meshStatus|handleMeshStatus)\s*\(/g)].map((match) => match[1]);
      const distinct = [...new Set(statusQueries.filter((name) => /MeshStatus$/.test(name)))];
      // NON-VACUITY: the stripper really did leave the file's code standing. A future
      // regression of the comment order would empty `code` and this assertion would fire
      // FIRST, naming the stripper instead of blaming the subject.
      assert.ok(
        code.includes("http.createServer"),
        "the stripped source still contains the server's own code — if this fails, the comment stripper ate the file (see stripComments' header: line comments FIRST)",
      );
      assert.deepEqual(
        distinct,
        ["queryGlobalMeshStatus"],
        `the fleet face reads its status from exactly ONE query surface (found ${JSON.stringify(distinct)}) — a second, differently-shaped source would resurrect the F9 branch ambiguity`,
      );
    },
  },

  {
    name: "arch/38 ADR-008 (acd-rendered-component-fed-by-route): self-check — the analyzer, run over the real Fleet.tsx with the F9 defect re-planted (the global panel's projection call removed), reports exactly `GlobalNodePanel`; over the real source it reports nothing (non-vacuous)",
    run: async () => {
      const fleet = await readFile(path.join(REPO, FLEET_TSX), "utf8");

      // The REAL source is clean under this analyzer.
      assert.deepEqual(nodeCardsWithoutCurrentWork(fleet), [], "the real Fleet.tsx has no dead current-work path");

      // PLANT the exact F9 defect: the global node panel (the component the route's
      // payload actually mounts) renders its card WITHOUT deriving the current-work
      // line, while the dead NodeCard keeps its (fixture-green) projection call.
      const planted = fleet.replace(
        /const currentWork = nodeCurrentWork\(node\);/,
        "const currentWork = { lines: [], token: \"muted\" };",
      );
      assert.notEqual(planted, fleet, "the plant genuinely removed the global panel's projection call");

      const violations = nodeCardsWithoutCurrentWork(planted);
      assert.deepEqual(
        violations,
        ["GlobalNodePanel"],
        "the analyzer catches the pre-F9 production code — a node card mounted by the route with no current-work derivation",
      );
    },
  },
];
