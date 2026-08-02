// Traceability wiring for milestone 43 / story 01 (the exclusive item lock), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/01_story_item-lock/
//     tasks/05_operator-refused-automatic-skipped-and-counted.feature
//
// AC7: ONE predicate, TWO renderings, and the choice between them is decided once —
// inside the lock — rather than at each call site. An OPERATOR VERB (a mint, a second
// assignment, a control-side mutation) is refused: coded, loud, non-zero. An AUTOMATIC
// PERIODIC TICK (the control's publish, ADR-004) skips the rows it does not own, COUNTS
// the skips in its own result, and emits no refusal at all — a coded refusal per held
// item per tick is log spam, and the tick asked nothing.
//
// THE TICK'S CHANNEL. `publishGlobalWorkSnapshot` IS the tick's body: the control
// launcher's `capturePropagation` (mesh-launcher.mjs) calls exactly this and nothing
// else, so driving it drives the tick without standing a daemon up. Its result is the
// envelope the launcher reports.
//
// THE COUNTER IS ADDITIVE AND DISTINCT (ADR-010/D1a): `publishWorkspaceSnapshot` has
// always returned `skipped: items.errors.length` — a PROJECTION-ERROR count. The
// held-skip counter is `heldSkipped`, with `heldRefs` beside it so the count is
// explainable, and it is never summed into `skipped`.
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { invoke } from "../src/command-core.mjs";
import { publishGlobalWorkSnapshot } from "../src/global-work-publisher.mjs";
import { readWorkspaceItems } from "../src/global-work-store.mjs";
import { reportDegrade, setDegradeSinkForTest } from "../src/degrade.mjs";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { withItemLockFixture, seedActive, seedWorker, settle, withStore, refuse } from "./support/item-lock-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");
const HOLDER = "aof-wsl";
const TARGET = "worker-b";
const CONTROL = "control-a";

const TICK_STREAM = [
  { number: "42", stories: ["01", "02", "03"] },
  { number: "43", stories: [] },
  { number: "44", stories: [] },
];

// ONE tick of the control node's periodic publish.
const tick = (fx) => publishGlobalWorkSnapshot(fx.workspace, fx.ctx);

async function rowsByRef(fx) {
  return withStore(fx, (store) => new Map(readWorkspaceItems(store, fx.workspaceId).map((row) => [row.ref, row])));
}

async function retitle(fx, number, slug, title) {
  const dir = path.join(fx.workDir, `${number}_milestone_${slug}`);
  await writeFile(
    path.join(dir, "SPEC.md"),
    `---\ntype: milestone\nnumber: ${number}\nslug: ${slug}\nstatus: in-progress\ntitle: ${title}\ncreated: 2026-08-01\nupdated: 2026-08-02\nschema: 1\n---\n`,
    "utf8",
  );
}

// captureTickOutput(fx, body) — EVERY channel a line could come out of while `body`
// runs, as one string: the process console (all four levels), the durable degrade sink
// (`reportDegrade`'s injectable factory — src/degrade.mjs), and afterwards both
// operator-readable log reads (`aof mesh logs` local + `--node <control>`).
//
// The `mesh logs` reads ALONE are not a falsifiable channel in-process: no daemon runs,
// so they are `{count:0,entries:[]}` whatever the code does, and the AC7 clause they
// were meant to prove ("zero refusal lines however many ticks elapse") would be
// vacuous. The console + degrade capture is what makes it real, and the self-check
// below proves the harness catches a planted line on both.
async function captureTickOutput(fx, body) {
  const captured = [];
  const original = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  setDegradeSinkForTest(() => ({ write: (entry) => captured.push(JSON.stringify(entry)) }));
  for (const key of Object.keys(original)) {
    console[key] = (...args) => captured.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  }
  try {
    await body();
  } finally {
    for (const [key, fn] of Object.entries(original)) console[key] = fn;
    setDegradeSinkForTest(undefined);
  }
  const remote = await invoke("mesh:logs", { node: CONTROL }, fx.ctx);
  const local = await invoke("mesh:logs", {}, fx.ctx);
  return [captured.join("\n"), JSON.stringify(remote.entries), JSON.stringify(local.entries)].join("\n");
}

// Background: "an isolated global mesh store holding one PUBLISHED workspace" — the
// tick's skip protects rows that exist; a workspace that has never published has
// nothing for the holder to own yet, and the first tick is what creates its rows.
async function background(fx) {
  await tick(fx);
  await seedWorker(fx, TARGET);
  await seedActive(fx, { assignmentId: "asg-42", itemRef: "42", node: HOLDER, state: "running" });
  await seedActive(fx, { assignmentId: "asg-43", itemRef: "43", node: HOLDER, state: "running" });
}

export const itemLockOperatorVsAutomaticTests = [
  // ==========================================================================
  // Scenario Outline: an OPERATOR verb against a held item is refused, coded
  // and loud — exactly once
  // ==========================================================================
  ...[
    { verb: "a mint", args: ["work", "run-start", "42/03", "--json"] },
    { verb: "a second assignment", args: ["mesh", "assign", "42/03", "--to", TARGET, "--json"] },
    { verb: "a control-side mutation", args: ["work", "insert-story", "lock-probe", "--at", "1", "--under", "42", "--yes", "--json"] },
  ].map(({ verb, args }) => ({
    name: `item-lock/05 operator-vs-automatic: ${verb} against held "42" exits non-zero, reports item-locked-by-assignment naming aof-wsl, exactly once`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);

        const result = spawnCliSync(process.execPath, [cliPath, ...args], {
          cwd: fx.root,
          encoding: "utf8",
          env: { ...process.env, AOF_GLOBAL_HOME: fx.home, NODE_NO_WARNINGS: "1" },
        });
        assert.notEqual(result.status, 0, `the process exit status is non-zero (stdout: ${result.stdout}; stderr: ${result.stderr})`);
        const envelope = JSON.parse(result.stdout);
        assert.equal(envelope.code, "item-locked-by-assignment");
        assert.equal(envelope.holderNode, HOLDER);
        // Exactly ONE refusal for the one command: one JSON document on stdout, and
        // the code appears once in it.
        assert.equal(result.stdout.trim().split(/\n\}\s*\n/).length, 1, "exactly one envelope on stdout");
        assert.equal(result.stdout.split("item-locked-by-assignment").length - 1, 1, "the code is reported exactly once");
      }, { stream: TICK_STREAM }),
  })),

  // ==========================================================================
  // Scenario: the control node's periodic publish tick skips the held rows,
  // counts them, and succeeds
  // ==========================================================================
  {
    name: "item-lock/05 operator-vs-automatic: one publish tick completes successfully, counts 2 held rows skipped naming 42 and 43, keeps that count separate from the projection-error count, and logs no refusal",
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);

        const propagation = await tick(fx);
        assert.equal(propagation.published, true, "the tick completes successfully — not refused, not failed");
        assert.equal(propagation.warning, undefined, "…and reports no warning");
        assert.equal(propagation.result.heldSkipped, 2, "its result counts 2 held rows skipped");
        assert.deepEqual(propagation.result.heldRefs, ["42", "43"], "…naming 42 and 43");
        assert.equal(propagation.result.skipped, 0, "the pre-existing PROJECTION-ERROR count is reported separately and is untouched");
      }, { stream: TICK_STREAM }),
  },

  // The tick's SILENCE, on a channel that can actually carry a line.
  {
    name: "item-lock/05 operator-vs-automatic: a tick over two held scopes emits NO line carrying the refusal code on any channel — console, the degrade sink, or either mesh-logs read (harness self-checked non-vacuous)",
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);

        // NON-VACUITY FIRST: the harness catches a planted line on both live
        // channels. Without this the assertion below could pass over a dead channel.
        const planted = await captureTickOutput(fx, async () => {
          console.error("probe item-locked-by-assignment on the console");
          reportDegrade("item-locked-by-assignment", new Error("probe on the degrade sink"));
        });
        assert.equal(planted.split("item-locked-by-assignment").length - 1, 2, `the harness sees BOTH planted lines — got ${JSON.stringify(planted).slice(0, 300)}`);

        const emitted = await captureTickOutput(fx, () => tick(fx));
        assert.doesNotMatch(emitted, /item-locked-by-assignment/, "the tick refused nothing and said nothing about refusing");
      }, { stream: TICK_STREAM }),
  },

  // ==========================================================================
  // Scenario: the same tick still publishes every UNHELD row
  // ==========================================================================
  {
    name: "item-lock/05 operator-vs-automatic: the tick is surgical — 44's edit lands, 42's and 43's rows are left exactly as they were, and the held-skip count is 2",
    run: () =>
      withItemLockFixture(async (fx) => {
        // A first tick with nothing held gives every row its baseline.
        await tick(fx);
        const before = await rowsByRef(fx);
        await background(fx);

        // The control node's local disk moves under BOTH a held item and an unheld one.
        await retitle(fx, "44", "m44", "Edited on the control node");
        await retitle(fx, "42", "m42", "A stale control-side scaffold");

        const propagation = await tick(fx);
        const after = await rowsByRef(fx);

        assert.equal(after.get("44").title, "Edited on the control node", "the unheld row reflects the edit");
        assert.deepEqual(after.get("42"), before.get("42"), "the held row is unchanged by that tick");
        assert.deepEqual(after.get("43"), before.get("43"), "…as is the other held row");
        assert.equal(propagation.result.heldSkipped, 2, "the tick's held-skip count is 2");
      }, { stream: TICK_STREAM }),
  },

  // ==========================================================================
  // Scenario: three consecutive ticks produce three counted results and ZERO
  // refusal log lines
  // ==========================================================================
  {
    name: "item-lock/05 operator-vs-automatic: three ticks each count 2 held rows (never a running total), the log carries zero refusal lines, and an operator mint in between still gets exactly one coded refusal",
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);

        const counts = [];
        let operatorRefusals = 0;
        const emitted = await captureTickOutput(fx, async () => {
          for (let n = 0; n < 3; n += 1) {
            if (n === 1) {
              // An operator asks, mid-tick-sequence: a human gets an answer. The
              // refusal is a THROWN coded error, never a log line — which is exactly
              // why the tick's silence below stays measurable while it happens.
              const error = await refuse(() => invoke("work:run-start", { ref: "42" }, fx.ctx));
              assert.equal(error.code, "item-locked-by-assignment");
              operatorRefusals += 1;
            }
            counts.push((await tick(fx)).result.heldSkipped);
          }
        });

        assert.deepEqual(counts, [2, 2, 2], "each of the three results counts 2 — per tick, never a running total");
        assert.equal(operatorRefusals, 1, "the operator got exactly ONE coded refusal");
        assert.doesNotMatch(emitted, /item-locked-by-assignment/, "ZERO lines carrying the refusal code across three ticks, on any channel");
      }, { stream: TICK_STREAM }),
  },

  // ==========================================================================
  // Scenario: when the phase ends, the operator verb succeeds and the tick
  // stops counting a skip
  // ==========================================================================
  {
    name: "item-lock/05 operator-vs-automatic: at the gate the tick's held-skip count falls to 1 (only 43 remains held) and the refused insert now succeeds, validate-clean",
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);

        const refused = await refuse(() => invoke("work:insert-story", { slug: "lock-probe", at: 1, under: 42, yes: true }, fx.ctx));
        assert.equal(refused.code, "item-locked-by-assignment");

        await settle(fx, "asg-42", "done");

        const propagation = await tick(fx);
        assert.equal(propagation.result.heldSkipped, 1, "only 43 remains held");
        assert.deepEqual(propagation.result.heldRefs, ["43"]);

        const inserted = await invoke("work:insert-story", { slug: "lock-probe", at: 1, under: 42, yes: true }, fx.ctx);
        assert.equal(inserted.created.ref, "42/01");
        const validate = await invoke("work:validate", {}, fx.ctx);
        assert.deepEqual(validate.findings, [], "a fresh work validate reports zero findings");
      }, { stream: TICK_STREAM }),
  },

  // ==========================================================================
  // Scenario: with no active assignment, the tick's result is shaped exactly as
  // it was before the lock existed
  // ==========================================================================
  {
    name: "item-lock/05 operator-vs-automatic: with no assignments the tick reports heldSkipped 0 and no held refs, its projection-error count still counts projection errors, and every row is published",
    run: () =>
      withItemLockFixture(async (fx) => {
        // A record doc with no parseable frontmatter — the projection error the
        // pre-existing `skipped` counter has always counted.
        const brokenDir = path.join(fx.workDir, "45_milestone_broken");
        await mkdir(brokenDir, { recursive: true });
        await writeFile(path.join(brokenDir, "SPEC.md"), "no frontmatter at all\n", "utf8");

        const propagation = await tick(fx);
        assert.equal(propagation.result.heldSkipped, 0, "its held-skip count is 0");
        assert.deepEqual(propagation.result.heldRefs, [], "…and it names no held refs");
        assert.equal(propagation.result.skipped, 1, "the pre-existing projection-error count still reports the projection error, unchanged");

        const rows = await rowsByRef(fx);
        for (const ref of ["42", "42/01", "42/02", "42/03", "43", "44"]) {
          assert.ok(rows.has(ref), `every row in the workspace is published (${ref})`);
        }
      }, { stream: TICK_STREAM }),
  },
];
