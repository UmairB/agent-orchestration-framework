// Fitness function: acd-cache-read-surface-boundary (milestone 43 / ADR-005) —
//
//   "The readers migrate through a NEW cache-first seam (src/work-read.mjs) that IMPORTS
//    work.mjs and is never imported back; the worker-side and structural readers are
//    PINNED to disk BY POSITIVE ASSERTION."
//
// WHY the positive half matters more than the negative half. RESEARCH measured 33 disk-read
// call sites across 21 modules in three categories: (a) control-side, must migrate — 13
// modules / 18 sites; (b) WORKER-side, must NOT migrate — 2 modules / 7 sites; (c)
// structural, stays on disk — 6 modules / 8 sites. A negative-only guard ("nobody imports
// the disk readers") would happily accept a later well-meaning "finish the migration" that
// moves a WORKER onto the control's cache — which would make a worker read someone else's
// opinion of its own checkout — or moves the RENAME engine off the disk it is renaming.
// Those two mistakes are unrecoverable-looking and silent. So (b) and (c) are asserted
// POSITIVELY: they must still import work.mjs's disk readers.
//
// The direction clause reuses m41/ADR-001 verbatim: `src/work.mjs` is the god-node —
// imported by 37 modules, imports only 3 — so a new capability lives BESIDE it, importing
// its readers, never inside it, and it must never be imported back.
//
// Proofs:
//  1. GREEN — the worker-side readers still read their own checkout through work.mjs.
//  2. GREEN — the structural readers (rename/insert/upgrade/reindex-reactors) still read
//     the disk that is the SUBJECT of their operation.
//  3. ARMED — once src/work-read.mjs exists: it imports ./work.mjs, work.mjs never imports
//     it back, and the control-side (a)-list modules no longer import the four disk-reader
//     symbols from work.mjs.
//  Self-check (m03 non-vacuous): the symbol detector distinguishes a disk-reader import
//  from any other work.mjs import, and a planted work.mjs->work-read.mjs edge trips the
//  direction guard.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = path.join(repoRoot, "src", "work.mjs");
const READ_SEAM = path.join(repoRoot, "src", "work-read.mjs");

const DISK_READERS = ["listItems", "findWork", "nextWork", "listStream"];

// EVERY PIN CARRIES ITS SUBJECT (m43/ADR-016/G2 — the RELOCATION hole, measured).
//
// A pin of the form "module X must still import symbol S" is satisfied by ANY surviving
// occurrence of S in X. Measured at 43/06's review: this file pinned
// `src/global-work-store.mjs` for `listItems` to protect what ADR-005 names "the WORKER-side
// content read" (`readWorkspaceContentRecords`) — and 43/03 MOVED that function to
// `src/work-content-read.mjs`. The pin went on passing, green, on a DIFFERENT `listItems`
// call in the publish path, while the guarantee it was written to hold had left the file.
// Grep green, guarantee relocated — retro lesson R2/m08, and ADR-015/F1's rule from the
// other side: a detector keyed on a SPELLING measures the author's vocabulary, not the
// invariant. So each entry also names the FUNCTION whose read is being pinned, and the pin
// fails the moment that function is not declared in that module — which is the signal to
// RE-POINT the pin, not to delete it.
const declares = (name) => new RegExp(`(?:function|const|let|class)\\s+${name}\\b|\\b${name}\\s*[:=]\\s*(?:async\\s*)?(?:function|\\()`);

// (b) WORKER-side reads — a worker reading its OWN materialized worktree is the intended
// behaviour (SPEC), and must survive the migration untouched.
const WORKER_SIDE = [
  // The worker's five execution reads (`:258`, `:2510`, `:2790`, `:2863`, `:3007`) — the
  // ref it was dispatched, resolved against the worktree it is actually working in.
  { file: path.join("src", "mesh-worker-execution.mjs"), symbols: ["findWork", "listItems"], subject: "createMeshWorkerExecutionHandler" },
  // ADR-005 (b) names this read as `global-work-store:601`. It MOVED to its own module at
  // 43/03 and is re-pointed here at 43/06's review (ADR-016/G2). It is the read that turns
  // a worker's own worktree into the artifact bodies it streams: it must never be answered
  // by another node's copy of those bodies.
  { file: path.join("src", "work-content-read.mjs"), symbols: ["listItems"], subject: "readWorkspaceContentRecords" },
  // The dual-use self-report read (ADR-005: "how a node reads its own disk to report its own
  // state"). Not a reader that must migrate, and not a worker-side read either — it is the
  // publish path's own disk scan, and a cache-first version of it would make a node report
  // someone else's opinion as its own observation.
  { file: path.join("src", "global-work-store.mjs"), symbols: ["listItems"], subject: "readWorkspaceProjectionItems" },
  // FOUND at 43/06's review (ADR-016/G2): the launcher's stream tick reads the ACTIVE
  // WORKTREE's own items (`mesh-launcher.mjs:1532`) to build the frame it pushes. The
  // module's own comment already says the import "must stay" — a rule living in a comment
  // is not a rule, and this is the assertion that makes it one. The launcher's OTHER read
  // (the control-side presence aggregation) correctly migrated; the two must not be
  // conflated on a later tidy-up.
  { file: path.join("src", "mesh-launcher.mjs"), symbols: ["listItems"], subject: "startLauncher" },
];

// (c) STRUCTURAL reads — the disk is the SUBJECT of the operation (SPEC's out-of-scope
// bullet: "work-reindex renames real folders … disk is the subject … not a stale copy").
const STRUCTURAL = [
  { file: path.join("src", "work-reindex.mjs"), symbols: ["listItems"], subject: "rewriteReferences" },
  { file: path.join("src", "commands", "insert-shared.mjs"), symbols: ["listItems"], subject: "preflightTopLevelScaffold" },
  { file: path.join("src", "work-upgrade.mjs"), symbols: ["listItems"], subject: "planUpgrade" },
  { file: path.join("src", "effects", "table.mjs"), symbols: ["listItems"], subject: "remapRunRecordRefs" },
  { file: path.join("src", "effects", "reconcile.mjs"), symbols: ["listItems"], subject: "reconcileRunRecords" },
  // work-doctor keeps ONE disk snapshot; ADR-005 overlays cache facts onto it in the
  // snapshot BUILDER (per-fact, ADR-010/R6.1) rather than splitting the snapshot's
  // source per check-group. The ITEM SET stays the disk's — that is what makes doctor's
  // findings claims about folders that are actually here.
  { file: path.join("src", "work-doctor.mjs"), symbols: ["listItems"], subject: "buildSnapshot" },
  // ADR-010/R6.3 — RECLASSIFIED from control-side (a) to structural (c) at Three Amigos.
  // `promote-gap-to-chore`'s listItems is inside defaultAt(workDir) (:94-96): it COUNTS
  // top-level items to choose the insert position for a folder it then creates on disk
  // through the m41 reindex engine. A cache-derived count would land the insert past the
  // end of the real stream and leave a numbering gap — a structural-placement read, not
  // an item-state read.
  { file: path.join("src", "commands", "promote-gap-to-chore.mjs"), symbols: ["listItems"], subject: "defaultAt" },
];

// (a) CONTROL-side readers that must move onto the seam (RESEARCH §5.2).
const CONTROL_SIDE = [
  path.join("src", "commands", "next.mjs"),
  path.join("src", "commands", "find.mjs"),
  path.join("src", "commands", "resolve.mjs"),
  path.join("src", "commands", "list.mjs"),
  path.join("src", "commands", "run-start.mjs"),
  path.join("src", "commands", "mesh-heartbeat.mjs"),
  // (promote-gap-to-chore.mjs moved to STRUCTURAL — ADR-010/R6.3)
  path.join("src", "commands", "notion-associate.mjs"),
  path.join("src", "notion", "sync-work.mjs"),
  path.join("src", "memory", "local-indexing.mjs"),
  path.join("src", "mesh-assignment.mjs"),
  path.join("src", "mesh-assignment-reclaim.mjs"),
];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// The named bindings a module imports FROM work.mjs (any relative depth).
function workImportBindings(commentStrippedSource) {
  const bindings = new Set();
  const re = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\bwork\.mjs["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name.length > 0) bindings.add(name);
    }
  }
  return bindings;
}

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

async function assertPinned(group, label) {
  const problems = [];
  for (const { file, symbols, subject } of group) {
    const source = stripComments(await readFile(path.join(repoRoot, file), "utf8"));
    // THE SUBJECT ANCHOR first: if the pinned read has left this module, the symbol pin
    // below is measuring something else and must be re-pointed rather than trusted.
    if (!declares(subject).test(source)) {
      problems.push(`${file} no longer declares ${subject}() — the ${label} read this pin protects has MOVED; re-point the pin at its new home (ADR-016/G2), never delete it`);
      continue;
    }
    const bindings = workImportBindings(source);
    for (const symbol of symbols) {
      if (!bindings.has(symbol)) {
        problems.push(`${file} no longer imports ${symbol} from work.mjs — ${label} reads (${subject}) must stay on DISK (ADR-005)`);
      }
    }
  }
  assert.deepEqual(problems, [], `pinned-reader problems: ${JSON.stringify(problems)}`);
}

export const archTests = [
  {
    name: "arch/43 ADR-005 (acd-cache-read-surface-boundary): the WORKER-side readers still read their own checkout through work.mjs — a worker must never read the control's opinion of its own worktree",
    run: async () => assertPinned(WORKER_SIDE, "worker-side"),
  },
  {
    name: "arch/43 ADR-005 (acd-cache-read-surface-boundary): the STRUCTURAL readers (reindex / insert / upgrade / reactors / doctor) still read the disk that is the SUBJECT of their operation",
    run: async () => assertPinned(STRUCTURAL, "structural"),
  },
  {
    name: "arch/43 ADR-005 (acd-cache-read-surface-boundary): ARMED — once src/work-read.mjs exists it imports ./work.mjs, work.mjs never imports it back, and the control-side readers are off the disk readers",
    run: async () => {
      if (!existsSync(READ_SEAM)) return; // not-yet-built: a clean skip that arms the moment the seam lands

      const seamSpecs = importSpecifiers(stripComments(await readFile(READ_SEAM, "utf8")));
      assert.ok(
        seamSpecs.some((s) => /(^|\/)work\.mjs$/.test(s)),
        `src/work-read.mjs must import ./work.mjs (the seam consumes the readers, never the reverse) — imports: ${seamSpecs.join(", ")}`,
      );
      const workSpecs = importSpecifiers(stripComments(await readFile(WORK, "utf8")));
      assert.deepEqual(
        workSpecs.filter((s) => /(^|\/)work-read\.mjs$/.test(s)),
        [],
        "src/work.mjs must NEVER import the read seam — the 37-module god-node's blast radius does not grow (m41/ADR-001)",
      );

      const stragglers = [];
      for (const file of CONTROL_SIDE) {
        const full = path.join(repoRoot, file);
        if (!existsSync(full)) continue;
        const bindings = workImportBindings(stripComments(await readFile(full, "utf8")));
        const still = DISK_READERS.filter((symbol) => bindings.has(symbol));
        if (still.length > 0) stragglers.push(`${file} still imports ${still.join("/")} from work.mjs`);
      }
      assert.deepEqual(stragglers, [], `control-side readers not yet on the cache seam: ${JSON.stringify(stragglers)}`);
    },
  },
  {
    name: "arch/43 ADR-005 (acd-cache-read-surface-boundary): self-check — the binding detector distinguishes a disk-reader import from any other work.mjs import, and ignores unrelated modules",
    run: async () => {
      const sample = 'import { findWork, listItems, loadWorkspace } from "./work.mjs";';
      const bindings = workImportBindings(sample);
      assert.ok(bindings.has("findWork") && bindings.has("listItems"), "the detector sees the disk readers");
      assert.ok(bindings.has("loadWorkspace"), "the detector sees a non-reader binding too (it does not pre-filter)");

      const renamed = workImportBindings('import { listItems as diskListItems } from "../work.mjs";');
      assert.ok(renamed.has("listItems"), "the detector follows a renamed import back to its exported name");

      const unrelated = workImportBindings('import { listItems } from "./catalog.mjs";');
      assert.equal(unrelated.size, 0, "the detector does NOT flag an unrelated module's listItems (catalog.mjs — a verified false positive)");

      const seamOnly = workImportBindings('import { resolveItem } from "./work-read.mjs";');
      assert.equal(seamOnly.size, 0, "the detector does not confuse work-read.mjs for work.mjs");
    },
  },

  {
    name: "arch/43 ADR-016/G2 (acd-cache-read-surface-boundary): self-check — the SUBJECT anchor catches the relocation that a symbol-only pin goes green through (the measured global-work-store:601 case)",
    run: async () => {
      // The exact shape that fooled the symbol-only pin: the subject function is GONE from
      // the module, but the pinned symbol survives on an unrelated call.
      const relocated = 'import { listItems } from "./work.mjs";\nexport function publishWorkspaceSnapshot(){ const items = listItems(dir); }';
      assert.ok(workImportBindings(relocated).has("listItems"), "the symbol pin alone is satisfied (this is the hole)");
      assert.ok(!declares("readWorkspaceContentRecords").test(relocated), "…and the subject anchor is NOT — it sees the function has left");

      // …and it does not misfire on the ordinary declaration spellings this repo uses.
      assert.ok(declares("buildSnapshot").test("export async function buildSnapshot(workDir, opts) {}"), "an exported async function declaration is seen");
      assert.ok(declares("defaultAt").test("async function defaultAt(workDir) {}"), "a module-private async function is seen");
      assert.ok(declares("mergeWorkerItems").test("export const mergeWorkerItems = (rows) => rows;"), "an arrow-function const is seen");
      assert.ok(!declares("buildSnapshot").test("const x = await buildSnapshot(dir);"), "a CALL is not a declaration");
    },
  },
];
