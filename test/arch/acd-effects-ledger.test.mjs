// Fitness functions for m42 wave (d) leg d2 (PRD-command-spine-effects-ledger):
// the effects ledger's structural invariants.
//
//   (1) CLOSED VOCABULARY, WELL-FORMED TABLE: every EFFECTS entry maps an event
//       name to a frozen reactor list; every reactor carries { key, locus,
//       apply } with a KNOWN locus and an async apply — the table is executable,
//       not prose.
//   (2) ONE EVENT-RAISER: `appendEvent(` is called in src/ ONLY by the
//       transition seam(s) (run-transitions.mjs, assignment-transitions.mjs) — no command or module may
//       append events beside the fact-writer (the "no event append outside
//       transition()" rule).
//   (3) THE CRASH WINDOW CLOSES: a transition whose process dies before the
//       drain (simulated with drain:false) leaves PENDING journal steps that a
//       later drainEffects pays in full — the wave-(d) exit-criterion property,
//       pinned at the unit level (the BDD feature proves it through the CLI).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EFFECTS, isKnownLocus } from "../../src/effects/table.mjs";
import { openEffectsJournal, pendingSteps, readEventSteps } from "../../src/effects/journal.mjs";
import { drainEffects } from "../../src/effects/dispatch.mjs";
import { transitionRunComplete } from "../../src/effects/run-transitions.mjs";
import { startRun } from "../../src/run-store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(repoRoot, "src");

// The sanctioned appendEvent CALLERS (repo-relative, forward-slashed): the
// journal module (the definition) and the transition seam(s) — nothing else in
// src/ may append events.
const APPEND_EVENT_ALLOWED = new Set([
  "src/effects/journal.mjs",
  "src/effects/run-transitions.mjs",
  // m42 wave (d) leg d3 — the assignment store's transition seam, the second
  // event-raiser. The set is the LIST OF SEAMS, not an amnesty: a command or a
  // module appending its own event still trips.
  "src/effects/assignment-transitions.mjs",
  // m42 wave (d) leg d4 (port 1) — the RECORD-DOC store's transition seam, the
  // third. Same rule, not an amnesty: it owns the one fs write it raises for.
  "src/effects/doc-transitions.mjs",
  // m42 wave (d) leg d3 — the BRIDGE fact door. A worker cannot write the control
  // node's store, so it ships the owed step here and this handler appends it into
  // CONTROL's own journal before executing it (the PRD's "apply-handlers reduce to
  // guard + append into control's own journal"). It appends ONLY a reactor the
  // closed vocabulary declares for the named event, and the work itself still runs
  // through a transition seam.
  "src/control-stream-server.mjs",
]);

// The sanctioned completeRun CALLERS (m42 wave (d) leg d2, THE SWEEP): the store
// itself (definition + its internal reclaim) and the transition seam. Every
// other caller — the 8 sites the PRD measured, 7 of them in
// mesh-worker-execution.mjs — now settles through transitionRunComplete, so the
// fact can never again land without its event.
const COMPLETE_RUN_ALLOWED = new Set(["src/run-store.mjs", "src/effects/run-transitions.mjs"]);

// The sanctioned run-MINT callers (m42 wave (d) leg d4, port 1 — the same
// discipline applied to the second run-store fact). `startRun`/`retryRun` were
// called from four places, and whether the mint propagated its workspace was a
// per-call-site import decision; now every mint goes through transitionRunStart,
// which raises `run.started` and lets the ledger own the consequence. The store
// itself is exempt (definition + its internal reclaim/retry composition).
const MINT_RUN_ALLOWED = new Set(["src/run-store.mjs", "src/effects/run-transitions.mjs"]);

// The sanctioned RECLAIM callers (m42 wave (d) leg d4, port 2 — the two reclaim
// halves unified). A reclaim IS a run completion (failed/runtime_offline), but
// neither half went through the completion seam, so neither raised its event: the
// restart scan's caller looped `rollbackItemStatus` inline, and the control tick
// rolled nothing back at all. `reclaimRun` is now the one edge and
// `transitionRunReclaimed` the one door to it, so both halves inherit the SAME
// declared cascade. `reclaimStaleRuns` (the store's own scan over that edge) is
// listed with it: reachable from the store and the seam, never a command.
const RECLAIM_RUN_ALLOWED = new Set(["src/run-store.mjs", "src/effects/run-transitions.mjs"]);

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

// A minimal story fixture whose run the transition can complete.
async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-effects-ledger-"));
  const dir = path.join(root, "wiki", "work", "20_milestone_ledger");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPEC.md"),
    '---\ntype: milestone\nnumber: "20"\nslug: ledger\nstatus: in-progress\ntitle: "Ledger"\ncreated: 2026-07-28\nupdated: 2026-07-28\n---\n# Ledger\n',
    "utf8",
  );
  const item = { ref: "20", dir, type: "milestone" };
  const run = await startRun(item, { sessionId: null, brief: {} });
  return { root, dir, item, run };
}

export const archTests = [
  {
    name: "arch/m42-d2: EFFECTS is a well-formed executable table — frozen entries, known loci, async reactors",
    run: async () => {
      const names = Object.keys(EFFECTS);
      assert.ok(names.length >= 1, "the vocabulary is non-empty");
      assert.ok(Object.isFrozen(EFFECTS), "EFFECTS is frozen (the vocabulary is closed at runtime)");
      for (const [name, reactors] of Object.entries(EFFECTS)) {
        assert.match(name, /^[a-z][a-z-]*\.[a-z][a-z-]*$/, `event "${name}" is a past-tense dotted fact name`);
        assert.ok(Array.isArray(reactors) && reactors.length >= 1, `"${name}" declares at least one reactor`);
        const keys = new Set();
        for (const reactor of reactors) {
          assert.equal(typeof reactor.key, "string", `"${name}" reactor has a key`);
          assert.ok(!keys.has(reactor.key), `"${name}" reactor keys are unique (${reactor.key})`);
          keys.add(reactor.key);
          assert.ok(isKnownLocus(reactor.locus), `"${name}"/${reactor.key} locus "${reactor.locus}" is known`);
          assert.equal(typeof reactor.apply, "function", `"${name}"/${reactor.key} apply is a function`);
        }
      }
    },
  },
  {
    name: "arch/m42-d2: appendEvent is called in src/ only by the transition seam (no event append outside transition)",
    run: async () => {
      const files = await listSourceFiles(SRC_DIR);
      const offenders = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        if (APPEND_EVENT_ALLOWED.has(rel)) continue;
        const code = stripComments(await readFile(file, "utf8"));
        if (/appendEvent\s*\(/.test(code)) {
          offenders.push(rel);
        }
      }
      assert.deepEqual(offenders, [], `only the transition seam appends events (offenders: ${offenders.join(", ")})`);
    },
  },
  {
    name: "arch/m42-d2: completeRun is reachable only through the store + the transition seam (the fact never lands without its event)",
    run: async () => {
      const files = await listSourceFiles(SRC_DIR);
      const offenders = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        if (COMPLETE_RUN_ALLOWED.has(rel)) continue;
        const code = stripComments(await readFile(file, "utf8"));
        // The bare store call — transitionRunComplete callers are the sanctioned door.
        if (/(?<![A-Za-z])completeRun\s*\(/.test(code)) {
          offenders.push(rel);
        }
      }
      assert.deepEqual(offenders, [], `completeRun is called only by the store + the transition seam (offenders: ${offenders.join(", ")})`);
    },
  },
  {
    name: "arch/m42-d4-port1: the run MINT is reachable only through the store + the transition seam (no mint without its event)",
    run: async () => {
      const files = await listSourceFiles(SRC_DIR);
      const offenders = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        if (MINT_RUN_ALLOWED.has(rel)) continue;
        const code = stripComments(await readFile(file, "utf8"));
        // The bare store calls — transitionRunStart is the sanctioned door. The
        // negative lookbehind keeps `transitionRunStart(` from matching itself.
        if (/(?<![A-Za-z])(startRun|retryRun)\s*\(/.test(code)) offenders.push(rel);
      }
      assert.deepEqual(offenders, [], `startRun/retryRun are called only by the store + the transition seam (offenders: ${offenders.join(", ")})`);
    },
  },
  {
    name: "arch/m42-d4-port2: both reclaim halves reach the run fact only through the shared edge + the transition seam",
    run: async () => {
      const files = await listSourceFiles(SRC_DIR);
      const offenders = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        if (RECLAIM_RUN_ALLOWED.has(rel)) continue;
        const code = stripComments(await readFile(file, "utf8"));
        if (/(?<![A-Za-z])(reclaimRun|reclaimStaleRuns|applyTransition)\s*\(/.test(code)) offenders.push(rel);
      }
      assert.deepEqual(
        offenders,
        [],
        `no caller force-fails a run outside the shared edge (offenders: ${offenders.join(", ")})`,
      );
      // …and the edge the seam settles on raises a completion, so the reclaim
      // inherits the declared cascade rather than a per-call-site copy of it.
      const seam = stripComments(await readFile(path.join(SRC_DIR, "effects", "run-transitions.mjs"), "utf8"));
      const reclaimDoor = seam.slice(seam.indexOf("export async function transitionRunReclaimed"));
      assert.ok(reclaimDoor.length > 0, "transitionRunReclaimed is the reclaim door");
      assert.ok(/reclaimRun\s*\(/.test(reclaimDoor.slice(0, 2000)), "…writing the fact through the shared edge");
      assert.ok(/raise\s*\(\s*"run\.completed"/.test(reclaimDoor.slice(0, 2000)), "…and raising run.completed for it");
    },
  },
  {
    name: "arch/m42-d2: a transition that dies before its drain leaves pending steps a later drain pays in full",
    run: async () => {
      const { root, dir, item } = await buildFixture();
      const globalHome = await mkdtemp(path.join(os.tmpdir(), "aof-effects-gh-"));
      const journalOptions = { env: { ...process.env, AOF_GLOBAL_HOME: globalHome } };
      try {
        // The "crash": complete the fact + append the event, but never drain.
        const { record, eventId, effects } = await transitionRunComplete(
          item,
          { outcome: "failed", failureReason: "timeout" },
          { journalOptions, drain: false },
        );
        assert.equal(record.state, "failed", "the fact is written");
        assert.ok(eventId, "the event rode the journal (not the ephemeral fallback)");
        assert.deepEqual(effects, [], "nothing drained yet — the process 'died' first");

        const journal = await openEffectsJournal(journalOptions);
        try {
          const owed = pendingSteps(journal, { eventId });
          assert.ok(owed.length >= 2, "the cascade's steps are journaled PENDING (owed, not lost)");
          assert.ok(!(await readFile(path.join(dir, "SPEC.md"), "utf8")).includes("status: not-started"), "the rollback has NOT happened yet");

          // The next drain — any process, any face — pays what is owed.
          const outcomes = await drainEffects({ journal, eventId });
          for (const outcome of outcomes) {
            assert.equal(outcome.status, "done", `${outcome.key} paid (got ${outcome.status}${outcome.error ? `: ${outcome.error}` : ""})`);
          }
          const steps = readEventSteps(journal, eventId);
          assert.ok(steps.every((step) => step.status === "done"), "every journaled step is done after the drain");
          const spec = await readFile(path.join(dir, "SPEC.md"), "utf8");
          assert.ok(spec.includes("status: not-started"), "the rolled-back status landed on the record doc via the drain");
        } finally {
          journal.close();
        }
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(globalHome, { recursive: true, force: true });
      }
    },
  },
];
