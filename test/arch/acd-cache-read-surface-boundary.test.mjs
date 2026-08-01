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

// (b) WORKER-side reads — a worker reading its OWN materialized worktree is the intended
// behaviour (SPEC), and must survive the migration untouched.
const WORKER_SIDE = [
  { file: path.join("src", "mesh-worker-execution.mjs"), symbols: ["findWork", "listItems"] },
  { file: path.join("src", "global-work-store.mjs"), symbols: ["listItems"] },
];

// (c) STRUCTURAL reads — the disk is the SUBJECT of the operation (SPEC's out-of-scope
// bullet: "work-reindex renames real folders … disk is the subject … not a stale copy").
const STRUCTURAL = [
  { file: path.join("src", "work-reindex.mjs"), symbols: ["listItems"] },
  { file: path.join("src", "commands", "insert-shared.mjs"), symbols: ["listItems"] },
  { file: path.join("src", "work-upgrade.mjs"), symbols: ["listItems"] },
  { file: path.join("src", "effects", "table.mjs"), symbols: ["listItems"] },
  { file: path.join("src", "effects", "reconcile.mjs"), symbols: ["listItems"] },
  // work-doctor keeps ONE disk snapshot; ADR-005 overlays cache facts onto it in the
  // snapshot BUILDER (per-fact, ADR-010/R6.1) rather than splitting the snapshot's
  // source per check-group.
  { file: path.join("src", "work-doctor.mjs"), symbols: ["listItems"] },
  // ADR-010/R6.3 — RECLASSIFIED from control-side (a) to structural (c) at Three Amigos.
  // `promote-gap-to-chore`'s listItems is inside defaultAt(workDir) (:94-96): it COUNTS
  // top-level items to choose the insert position for a folder it then creates on disk
  // through the m41 reindex engine. A cache-derived count would land the insert past the
  // end of the real stream and leave a numbering gap — a structural-placement read, not
  // an item-state read.
  { file: path.join("src", "commands", "promote-gap-to-chore.mjs"), symbols: ["listItems"] },
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
  for (const { file, symbols } of group) {
    const bindings = workImportBindings(stripComments(await readFile(path.join(repoRoot, file), "utf8")));
    for (const symbol of symbols) {
      if (!bindings.has(symbol)) {
        problems.push(`${file} no longer imports ${symbol} from work.mjs — ${label} reads must stay on DISK (ADR-005)`);
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
];
