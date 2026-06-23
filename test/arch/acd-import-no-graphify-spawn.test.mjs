// Fitness function for milestone 13 / ADR-003 (the 10/ADR-002 precedent):
// "Never graphify directly. The import command + materialize + recovery + source
//  modules import NO `src/graphify.mjs` (the SOLE graphify spawn site) and spawn NO
//  graphify — graphify is reached ONLY by the graphify backend, via the registered 09
//  `graph:*` commands. There is no bespoke second graphify integration on the import
//  side."
//
// Mirrors 10's acd-graphify-backend-via-command import-graph + call-form idiom, applied
// to the import surface (which must touch graphify at ALL — neither import nor spawn).
// Halves, both source-only and CI-able (the 09 call-form-not-comment discipline: the
// scan runs over comment-AND-string-stripped code, so the modules' many DOCUMENTING
// mentions of "graphify" — they explain at length they never touch it — do NOT trip):
//   (a) IMPORT-GRAPH: NO import module imports `graphify.mjs` (the spawn site) nor
//       node:child_process FOR graphify (the import surface's only child_process use is
//       the read-only `git` probe — never a graphify spawn).
//   (b) NO-GRAPHIFY-SPAWN: no module spawns a `graphify` binary (no spawn*/exec* whose
//       argv[0] is "graphify"); and no module names the graphify driver in live code.
//
// Non-vacuous: (a)/(b) go RED if any import module added `from "../graphify.mjs"` or a
// `spawnSync("graphify", …)` (the self-checks prove the matchers fire on those exact
// forbidden forms and NOT on the accepted read-only `git` spawn the import legitimately
// uses).
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_IMPORT_DIR = path.join(repoRoot, "src", "import");
const IMPORT_COMMAND = path.join(repoRoot, "src", "commands", "import-milestone.mjs");

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
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

// A spawn/exec of the `graphify` binary — the forbidden form (graphify is reached only
// by the backend via invoke("graph:…"), never spawned from the import side).
const GRAPHIFY_SPAWN = /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\s*\(\s*["'`]graphify/;

async function importSurfaceFiles() {
  const files = [IMPORT_COMMAND];
  for (const entry of await readdir(SRC_IMPORT_DIR)) {
    if (entry.endsWith(".mjs")) files.push(path.join(SRC_IMPORT_DIR, entry));
  }
  return files;
}

export const archTests = [
  {
    name: "arch/import-no-graphify-spawn: NO import module imports ../graphify.mjs (the SOLE graphify spawn site) — graphify is reached only by the backend via the 09 commands",
    run: async () => {
      const files = await importSurfaceFiles();
      assert.ok(files.length >= 4, `the import surface modules are on disk (got ${files.length})`);
      for (const file of files) {
        const specs = importSpecifiers(stripCommentsOnly(await readFile(file, "utf8")));
        const importsDriver = specs.some((s) => /(^|\/)graphify\.mjs$/.test(s) || /(^|\/)graphify-backend\.mjs$/.test(s) || /(^|\/)graph-build\.mjs$/.test(s));
        assert.equal(
          importsDriver,
          false,
          `${path.relative(repoRoot, file)} imports NO graphify driver/backend/graph-build (no bespoke second integration); imports: ${specs.join(", ")}`
        );
      }
      // Self-check (non-vacuous): the specifier reader DOES see a forbidden graphify import.
      assert.ok(
        importSpecifiers('import x from "../graphify.mjs";').some((s) => /graphify\.mjs$/.test(s)),
        "the specifier reader catches a real ../graphify.mjs import"
      );
    },
  },
  {
    name: "arch/import-no-graphify-spawn: NO import module spawns a graphify binary (the import's only child_process use is the read-only git probe)",
    run: async () => {
      for (const file of await importSurfaceFiles()) {
        // The graphify-spawn guard keys off the argv[0] STRING literal ("graphify"), so it
        // must run over comment-stripped-but-string-RETAINED code (else the literal the
        // matcher targets would be stripped to whitespace and the guard would be vacuous).
        const codeWithStrings = stripCommentsOnly(await readFile(file, "utf8"));
        assert.ok(
          !GRAPHIFY_SPAWN.test(codeWithStrings),
          `${path.relative(repoRoot, file)} spawns NO graphify binary (graphify is reached only by the backend via invoke("graph:…"))`
        );
        // No live-CODE reference to the graphify driver module path either (run over the
        // comment-AND-string-stripped code so a documented/string mention is discounted —
        // only a real specifier/identifier survives).
        const liveCode = stripCommentsAndStrings(await readFile(file, "utf8"));
        assert.ok(
          !/graphify\.mjs/.test(liveCode),
          `${path.relative(repoRoot, file)} does not reference src/graphify.mjs in live code`
        );
      }
      // Self-check (non-vacuous): the guard FIRES on a graphify spawn and does NOT fire on
      // the accepted read-only git spawn the import surface legitimately uses.
      assert.ok(GRAPHIFY_SPAWN.test('spawnSync("graphify", ["build"])'), "guard catches a graphify spawn");
      assert.ok(GRAPHIFY_SPAWN.test('spawnSync(`graphify`, args)'), "guard catches a graphify template spawn");
      assert.ok(!GRAPHIFY_SPAWN.test('spawnSync("git", ["ls-remote", repo])'), "guard does NOT catch the read-only git probe");
    },
  },
];
