// Traceability wiring for milestone 43 / story 01 (the exclusive item lock), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/01_story_item-lock/
//     tasks/02_one-coded-refusal-at-every-door.feature
//
// AC3 + AC5: every door onto a held item — a second assignment, a local `run-start`, a
// `run-retry`, and a control-side mutation (an insert, which RENUMBERS FOLDERS while a
// worker holds a worktree full of the old refs) — refuses with the same code and the
// same five-key payload, minting nothing and renaming nothing, and all of them open
// again at the gate. This task varies the DOOR; task 01 varies the ref pair.
//
// NOT ASSERTED HERE: that the check sits INSIDE `transitionRunStart` rather than at its
// five call sites. That is a PLACEMENT invariant and lives in
// test/arch/acd-item-lock-single-door.test.mjs.
//
// ONE ROW IS RULED, NOT CHOSEN. The headline table's "a second assignment, scope ref"
// row carries the feature's own NOTE: it is the one contested code, and if the
// architect keeps the exact-ref gate first it reports `assignment-already-active` and
// moves to task 01's table. ADR-010/R1.1 (quoted in the story's `## Notes`) ruled
// exactly that, so the row is wired to `assignment-already-active` here and its
// scope-lock twin lives in task 01.
//
// The three scenarios that assert a PROCESS EXIT STATUS and a stderr render drive the
// REAL `aof` CLI as a child process (the work-insert-cli-confirm-envelope harness);
// everything else goes in-process through the registry, where a command's `run` result
// IS the `--json` payload.
import assert from "node:assert/strict";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { invoke } from "../src/command-core.mjs";
import { applyDeltaFrame } from "../src/control-stream-server.mjs";
import { publishGlobalWorkSnapshot } from "../src/global-work-publisher.mjs";
import { readWorkspaceItems } from "../src/global-work-store.mjs";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import {
  withItemLockFixture,
  seedActive,
  seedWorker,
  countAssignments,
  assignmentRow,
  settle,
  withStore,
  refuse,
} from "./support/item-lock-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");
const HOLDER = "aof-wsl";
const TARGET = "worker-b";

const INSERT_INPUT = { slug: "lock-probe", at: 1, under: 42, yes: true };

// The four doors, as in-process invocations of the REAL registered commands.
const DOORS = {
  "a second assignment, child ref": (fx) => invoke("mesh:assign", { ref: "42/03", to: TARGET }, fx.ctx),
  "a second assignment, scope ref": (fx) => invoke("mesh:assign", { ref: "42", to: TARGET }, fx.ctx),
  "a local mint, child ref": (fx) => invoke("work:run-start", { ref: "42/03" }, fx.ctx),
  "a local mint, scope ref": (fx) => invoke("work:run-start", { ref: "42" }, fx.ctx),
  "a retry, scope ref": (fx) => invoke("work:run-retry", { ref: "42" }, fx.ctx),
  "a retry, child ref": (fx) => invoke("work:run-retry", { ref: "42/03" }, fx.ctx),
  "a control-side mutation (insert)": (fx) => invoke("work:insert-story", INSERT_INPUT, fx.ctx),
};

async function folderNames(fx) {
  const names = await readdir(fx.workDir);
  return names.sort();
}

function cli(fx, args) {
  return spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: fx.root,
    encoding: "utf8",
    env: { ...process.env, AOF_GLOBAL_HOME: fx.home, NODE_NO_WARNINGS: "1" },
  });
}

async function background(fx) {
  await seedWorker(fx, TARGET);
  await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });
}

export const itemLockCodedRefusalTests = [
  // ==========================================================================
  // Scenario Outline: every door onto the held scope is refused with the same
  // code, and changes nothing
  // ==========================================================================
  ...Object.entries(DOORS).map(([door, run]) => ({
    name: `item-lock/02 every-door: ${door} onto held "42" is refused, names the holder, and changes nothing`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);
        const foldersBefore = await folderNames(fx);

        const error = await refuse(() => run(fx));
        if (door === "a second assignment, scope ref") {
          // ADR-010/R1.1 — the EXACT-ref duplicate keeps its own pinned code; the
          // scope-lock twin of this row is task 01's first table.
          assert.equal(error.code, "assignment-already-active");
        } else {
          assert.equal(error.code, "item-locked-by-assignment");
          assert.equal(error.holderNode, HOLDER, "the payload's holderNode is the holder");
          assert.equal(error.scopeRef, "42", "the payload's scopeRef is the execution scope that is held");
        }

        assert.equal(await countAssignments(fx), 1, "the store still holds EXACTLY one assignment row");
        const row = await assignmentRow(fx, "asg-1");
        assert.equal(row.state, "running", "…and it is asg-1, still running");

        assert.deepEqual((await invoke("work:run-status", { ref: "42" }, fx.ctx)).runs, [], "zero local runs for 42");
        assert.deepEqual((await invoke("work:run-status", { ref: "42/03" }, fx.ctx)).runs, [], "zero local runs for 42/03");

        assert.deepEqual(await folderNames(fx), foldersBefore, "the work stream's folder names are unchanged");
        const validate = await invoke("work:validate", {}, fx.ctx);
        assert.deepEqual(validate.findings, [], "a fresh work validate reports zero findings");
      }),
  })),

  // ==========================================================================
  // Scenario: the refusal payload carries the five keys a face renders from
  // ==========================================================================
  {
    name: "item-lock/02 every-door: the refusal payload carries itemRef, scopeRef, assignmentId, holderNode and state — and the human render names both \"42\" and \"aof-wsl\"",
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);

        const json = cli(fx, ["work", "run-start", "42/03", "--json"]);
        assert.equal(json.status, 1, `the CLI exits non-zero (stdout: ${json.stdout}; stderr: ${json.stderr})`);
        const envelope = JSON.parse(json.stdout);
        assert.equal(envelope.code, "item-locked-by-assignment");
        assert.equal(envelope.itemRef, "42/03", "the ref the operator asked for, not the scope");
        assert.equal(envelope.scopeRef, "42", "the execution scope that is actually held");
        assert.equal(envelope.assignmentId, "asg-1");
        assert.equal(envelope.holderNode, HOLDER);
        assert.equal(envelope.state, "running");

        const human = cli(fx, ["work", "run-start", "42/03"]);
        assert.notEqual(human.status, 0, "the human form is loud too");
        assert.match(human.stderr, /42/, "the human render names the item on stderr");
        assert.match(human.stderr, /aof-wsl/, "…and the holder");
      }),
  },

  // ==========================================================================
  // Scenario Outline: the refusal is loud at every door — a non-zero exit,
  // never a success envelope
  // ==========================================================================
  ...[
    { door: "mint", args: ["work", "run-start", "42/03", "--json"] },
    { door: "retry", args: ["work", "run-retry", "42", "--json"] },
    { door: "assignment", args: ["mesh", "assign", "42/03", "--to", TARGET, "--json"] },
  ].map(({ door, args }) => ({
    name: `item-lock/02 every-door: the ${door} door exits non-zero with ok:false and leaves no partial work behind`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);
        const foldersBefore = await folderNames(fx);

        const result = cli(fx, args);
        assert.notEqual(result.status, 0, `the process exit status is non-zero (stdout: ${result.stdout}; stderr: ${result.stderr})`);
        const envelope = JSON.parse(result.stdout);
        assert.equal(envelope.ok, false, "the envelope's ok is false — never a success envelope carrying a warning");
        assert.equal(envelope.code, "item-locked-by-assignment");

        assert.deepEqual((await invoke("work:run-status", { ref: "42/03" }, fx.ctx)).runs, [], "no run record");
        assert.equal(await countAssignments(fx), 1, "no assignment row");
        assert.deepEqual(await folderNames(fx), foldersBefore, "no renamed folder");
      }),
  })),

  // ==========================================================================
  // Scenario: refusing three times in a row leaves the item exactly as it was
  // ==========================================================================
  {
    name: "item-lock/02 every-door: three refusals in a row leave zero runs, zero attempts and asg-1's updatedAt unchanged",
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);
        const before = await assignmentRow(fx, "asg-1");

        for (let attempt = 0; attempt < 3; attempt += 1) {
          const error = await refuse(() => invoke("work:run-start", { ref: "42/03" }, fx.ctx));
          assert.equal(error.code, "item-locked-by-assignment", `refusal ${attempt + 1} of 3 is coded`);
        }

        const status = await invoke("work:run-status", { ref: "42/03" }, fx.ctx);
        assert.deepEqual(status.runs, [], "zero runs and zero attempts");
        const after = await assignmentRow(fx, "asg-1");
        assert.equal(after.state, "running");
        assert.equal(after.updated_at, before.updated_at, "the assignment's updatedAt is unchanged — refusing is side-effect free");
      }),
  },

  // ==========================================================================
  // Scenario Outline: an EARLIER gate still reports its own cause even while
  // the scope is held
  // ==========================================================================
  ...[
    { label: "a ref that resolves to nothing", run: (fx) => invoke("work:run-start", { ref: "42/99" }, fx.ctx), code: "ref-not-found" },
    { label: "a non-canonically-padded ref", run: (fx) => invoke("work:run-start", { ref: "042" }, fx.ctx), code: "ref-not-found" },
    { label: "an assign to an unregistered node", run: (fx) => invoke("mesh:assign", { ref: "43", to: "ghost" }, fx.ctx), code: "assignment-target-unknown" },
    { label: "an assign to a node without the repo", run: (fx) => invoke("mesh:assign", { ref: "43", to: "no-repo" }, fx.ctx), code: "assignment-repo-unavailable" },
  ].map(({ label, run, code }) => ({
    name: `item-lock/02 every-door: gate order — ${label} still reports ${code}, not item-locked-by-assignment`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);
        // A registered node that does NOT hold this workspace's published repo — the
        // fourth row's own trigger, flipped while every other gate stays valid.
        await seedWorker(fx, "no-repo");
        const { withStore } = await import("./support/item-lock-fixture.mjs");
        await withStore(fx, (store) => {
          store.db.prepare("DELETE FROM global_node_workspaces WHERE node_id = 'no-repo'").run();
        });

        const error = await refuse(() => run(fx));
        assert.equal(error.code, code);
      }),
  })),

  // ==========================================================================
  // Scenario Outline: the lock OUTRANKS the store's own refusals for a held
  // item, and changes none of them for an unheld one
  // ==========================================================================
  ...[
    {
      label: "retry, nothing retryable, scope HELD",
      setup: async () => {},
      run: (fx) => invoke("work:run-retry", { ref: "42" }, fx.ctx),
      code: "item-locked-by-assignment",
    },
    {
      label: "retry, nothing retryable, scope UNHELD",
      setup: async () => {},
      run: (fx) => invoke("work:run-retry", { ref: "43" }, fx.ctx),
      code: "no-retryable-run",
    },
    {
      label: "mint over a live local run, scope HELD",
      // "42" already has a local run in state running: minted BEFORE the lock is
      // seeded, so the store's own duplicate-run refusal is genuinely available.
      setup: async (fx) => { await invoke("work:run-start", { ref: "42" }, fx.ctx); },
      run: (fx) => invoke("work:run-start", { ref: "42" }, fx.ctx),
      code: "item-locked-by-assignment",
      preSeed: true,
    },
    {
      label: "mint over a live local run, scope UNHELD",
      setup: async (fx) => { await invoke("work:run-start", { ref: "43" }, fx.ctx); },
      run: (fx) => invoke("work:run-start", { ref: "43" }, fx.ctx),
      code: "duplicate-run",
      preSeed: true,
    },
  ].map(({ label, setup, run, code, preSeed }) => ({
    name: `item-lock/02 every-door: ${label} reports ${code}`,
    run: () =>
      withItemLockFixture(async (fx) => {
        if (preSeed) await setup(fx);
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });
        if (!preSeed) await setup(fx);

        const error = await refuse(() => run(fx));
        assert.equal(error.code, code);
      }),
  })),

  // ==========================================================================
  // Scenario (CONTRACT EXTENSION, PO-sanctioned 2026-08-02; ADR-011/A1): the
  // control node never discards the holder's own reported rows
  //
  // The regression THIS STORY introduced and therefore owes a test for. The
  // lock's carry was first placed inside `publishWorkspaceSnapshot` — which is
  // not the tick but the SHARED ROW-WRITER, whose other two callers are the
  // worker's own frame doors. It therefore filtered the holder's authored rows:
  // measured, `heldSkipped:1` reported as success while the delta read back
  // `not-started`. A placement assertion cannot see which caller supplied the
  // rows; only this can.
  // ==========================================================================
  {
    name: "item-lock/02 every-door: the control never discards the holder's OWN reported rows — a delta lands, its completion lands, heldSkipped is 0 for a frame, and the next disk tick still carries them",
    run: () =>
      withItemLockFixture(async (fx) => {
        // "one published workspace" — the first tick creates the rows AND the
        // workspace descriptor the frame doors resolve against.
        await publishGlobalWorkSnapshot(fx.workspace, fx.ctx);
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });

        const rowFor = async (ref) => withStore(fx, (store) => readWorkspaceItems(store, fx.workspaceId).find((row) => row.ref === ref));
        assert.equal((await rowFor("42")).status, "not-started", "the control's cache carries 42 as not-started");

        // m43/43/02 (the authority cut) — the frame now IDENTIFIES its reporter, and
        // that is what makes this test's own claim checkable: "the holder's own voice"
        // is only recognisable as the holder's if the frame says (and the connection
        // authenticates) whose it is. A frame with no resolvable node id is refused
        // outright rather than written as an unattributable row.
        const frame = (rows) => ({
          nodeId: HOLDER,
          workspaceId: fx.workspaceId,
          at: "2026-08-02T10:00:00.000Z",
          items: rows,
        });
        const itemRow = (ref, status) => ({
          ref,
          type: ref.includes("/") ? "story" : "milestone",
          slug: ref.includes("/") ? `s${ref.replace("/", "-")}` : `m${ref}`,
          status,
          title: `Item ${ref}`,
          parent: ref.includes("/") ? ref.split("/")[0] : null,
          sourcePath: `wiki/work/${ref}/DOC.md`,
        });

        await withStore(fx, async (store) => {
          const progressed = await applyDeltaFrame(store, frame([itemRow("42", "in-progress")]), { now: "2026-08-02T10:00:00.000Z", nodeId: HOLDER });
          // 43/02 moved this channel from the publish envelope onto the frame apply's
          // own result (a frame no longer routes through publishWorkspaceSnapshot at
          // all). Same claim, one grain finer: not "no scope was stepped over" but "not
          // one ROW of the holder's frame was refused, for any reason".
          assert.deepEqual(progressed.skippedRows, [], "a frame is not a tick — the holder's own voice is never filtered");
          assert.equal(progressed.upserted, 1, "…the row it carried was written");
        });
        assert.equal((await rowFor("42")).status, "in-progress", "the worker's delta landed");

        await withStore(fx, async (store) => {
          const completed = await applyDeltaFrame(
            store,
            frame([itemRow("42", "done"), itemRow("42/01", "done")]),
            { now: "2026-08-02T10:05:00.000Z", nodeId: HOLDER },
          );
          assert.deepEqual(completed.skippedRows, [], "…and neither is the completion frame");
          assert.equal(completed.upserted, 2, "…both of its rows were written");
        });
        assert.equal((await rowFor("42")).status, "done", "the completion frame landed for the scope");
        assert.equal((await rowFor("42/01")).status, "done", "…and for its story");
        assert.equal((await assignmentRow(fx, "asg-1")).state, "running", "…while the assignment is still active");

        // The disk tick still steps over the scope — and now leaves the WORKER's
        // rows alone rather than the control's stale scaffold.
        const propagation = await publishGlobalWorkSnapshot(fx.workspace, fx.ctx);
        assert.equal(propagation.result.heldSkipped, 1, "a subsequent control publish tick still counts 42 as held");
        assert.deepEqual(propagation.result.heldRefs, ["42"]);
        assert.equal((await rowFor("42")).status, "done", "…and leaves the holder's rows alone");
        assert.equal((await rowFor("42/01")).status, "done");
      }),
  },

  // ==========================================================================
  // Scenario Outline: an earlier gate still reports its own cause — the HELD
  // rows (ADR-011/A2 pins the order: ref-not-found → assignment-target-unknown →
  // assignment-repo-unavailable → assignment-already-active →
  // item-locked-by-assignment). The feature's own rows target the UNHELD "43" on
  // purpose and so constrain nothing about the lock's position; these two close
  // that, over the HELD scope.
  // ==========================================================================
  ...[
    { label: "an assign of a HELD child to an unregistered node", to: "ghost", code: "assignment-target-unknown" },
    { label: "an assign of a HELD child to a node without the repo", to: "no-repo", code: "assignment-repo-unavailable" },
  ].map(({ label, to, code }) => ({
    name: `item-lock/02 every-door: gate order over a HELD ref — ${label} reports ${code}, not item-locked-by-assignment`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);
        await seedWorker(fx, "no-repo");
        await withStore(fx, (store) => {
          store.db.prepare("DELETE FROM global_node_workspaces WHERE node_id = 'no-repo'").run();
        });

        const error = await refuse(() => invoke("mesh:assign", { ref: "42/03", to }, fx.ctx));
        assert.equal(error.code, code, "a request-validity gate precedes the item-state gate: a typo'd target must not be told to wait for a holder");
        assert.equal(await countAssignments(fx), 1, "…and nothing was minted either way");
      }),
  })),

  // ==========================================================================
  // Scenario: when the assignment settles, the same refused commands succeed —
  // the gate is the release
  // ==========================================================================
  {
    name: "item-lock/02 every-door: at the gate the refused insert succeeds — the new story takes 42/01, the old 42/01 becomes 42/02, validate is clean, and run-start mints",
    run: () =>
      withItemLockFixture(async (fx) => {
        await background(fx);

        const refused = await refuse(() => invoke("work:insert-story", INSERT_INPUT, fx.ctx));
        assert.equal(refused.code, "item-locked-by-assignment");

        await settle(fx, "asg-1", "done");

        const inserted = await invoke("work:insert-story", INSERT_INPUT, fx.ctx);
        assert.equal(inserted.created.ref, "42/01", "the new story occupies slot 42/01");
        const rows = await invoke("work:list", {}, fx.ctx);
        const moved = rows.find((row) => row.slug === "s42-01");
        assert.equal(moved.ref, "42/02", "the story previously at 42/01 is now 42/02");

        const validate = await invoke("work:validate", {}, fx.ctx);
        assert.deepEqual(validate.findings, [], "a fresh work validate reports zero findings");

        const record = await invoke("work:run-start", { ref: "42" }, fx.ctx);
        assert.equal(record.state, "running", "a subsequent run-start mints a run instead of refusing");
      }),
  },
];
