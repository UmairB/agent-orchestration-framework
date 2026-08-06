// Traceability wiring for milestone 43 / story 01 (the exclusive item lock), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/01_story_item-lock/
//     tasks/04_next-skips-held-items-and-reports-the-holder.feature
//
// AC6: `work next` consults the SAME predicate the mint door does and renders it the
// other way round — it returns the next UNHELD item and REPORTS the ones it stepped
// over, each naming its holder. The two failure modes the criterion names are both
// closed: an item is never silently omitted (invisible), and never handed out to be
// refused a step later (a bad seam).
//
// The envelope is the additive shape ADR-010/R1.5 pins: `skipped: [{ ref, scopeRef,
// holderNode, assignmentId, state }]` — the same five facts the refusal payload carries
// — plus the new state `held`, explicitly NOT `done`.
//
// ONE FIXTURE DIVERGENCE, recorded rather than papered over. The last scenario ("an
// item stops being skipped the moment its assignment settles") requires `work next` to
// return "42" itself once the lock releases. Under `nextWork`'s pre-existing drill-down
// (untouched by this story), a not-started milestone WITH not-started stories resolves
// to its first story, never to itself — so that scenario is exercised over a
// story-less "42", the minimal stream in which its own Then can be true. Every other
// scenario uses the Background stream verbatim.
import assert from "node:assert/strict";
import path from "node:path";
import { invoke } from "../src/command-core.mjs";
import { nextCommand } from "../src/commands/next.mjs";
import { withItemLockFixture, seedActive, settle, refuse } from "./support/item-lock-fixture.mjs";

const HOLDER = "aof-wsl";

// Background: milestones 42, 43 and 44, each not-started and none blocked by `depends`;
// milestone 42 has stories 42/01, 42/02 and 42/03.
const NEXT_STREAM = [
  { number: "42", stories: ["01", "02", "03"] },
  { number: "43", stories: [] },
  { number: "44", stories: [] },
];

const next = (fx, scope) => invoke("work:next", scope ? { scope } : {}, fx.ctx);

export const itemLockNextSkipsHeldTests = [
  // ==========================================================================
  // Scenario: the first candidate being held moves next on to the following
  // item and names the holder
  // ==========================================================================
  {
    name: "item-lock/04 next: a held \"42\" is stepped over — next returns 43 and reports exactly one skipped entry for 42, naming its holder, scope, assignment and state",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });

        const envelope = await next(fx);
        assert.equal(envelope.state, "ready");
        assert.equal(envelope.ref, "43");
        assert.notEqual(envelope.ref, "42", "\"42\" is NOT the returned ref");
        assert.equal(envelope.skipped.length, 1, "exactly one skipped entry");
        assert.deepEqual(envelope.skipped[0], {
          ref: "42",
          scopeRef: "42",
          holderNode: HOLDER,
          assignmentId: "asg-1",
          state: "running",
        });
      }, { stream: NEXT_STREAM }),
  },

  // ==========================================================================
  // Scenario Outline: next skips by execution scope, upward and downward
  // ==========================================================================
  ...[
    { label: "the scope itself is held", holder: "42", candidate: "42", verdict: "contains" },
    { label: "a child of the held scope", holder: "42", candidate: "42/01", verdict: "contains" },
    { label: "the scope is held by a child", holder: "42/03", candidate: "42", verdict: "contains" },
    { label: "a sibling of the holding child", holder: "42/03", candidate: "42/01", verdict: "contains" },
    { label: "an unrelated scope is held", holder: "43", candidate: "42", verdict: "does not contain" },
  ].map(({ label, holder, candidate, verdict }) => ({
    name: `item-lock/04 next: with "${holder}" held, \`work next 42\` ${verdict} a skipped entry for "${candidate}" (${label})`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { assignmentId: "asg-1", itemRef: holder, node: HOLDER, state: "running" });

        const envelope = await next(fx, "42");
        const refs = envelope.skipped.map((entry) => entry.ref);
        if (verdict === "contains") {
          assert.ok(refs.includes(candidate), `the skipped list contains ${candidate} (got ${refs.join(", ") || "nothing"})`);
          assert.notEqual(envelope.ref, candidate, "the returned ready ref, if any, is never the skipped candidate");
        } else {
          assert.equal(refs.includes(candidate), false, `the skipped list does NOT contain ${candidate} (got ${refs.join(", ") || "nothing"})`);
        }
      }, { stream: NEXT_STREAM }),
  })),

  // ==========================================================================
  // Scenario: whatever next returns, run-start accepts — the two renderings
  // cannot disagree
  // ==========================================================================
  {
    name: "item-lock/04 next: the seam property — run-start accepts whatever next hands out, and is never refused item-locked-by-assignment",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });

        const envelope = await next(fx);
        assert.equal(envelope.state, "ready");
        const record = await invoke("work:run-start", { ref: envelope.ref }, fx.ctx);
        assert.equal(record.state, "running", "the mint door accepts the ref next handed out");
        assert.equal(record.itemRef, envelope.ref);
      }, { stream: NEXT_STREAM }),
  },

  // ==========================================================================
  // Scenario: when EVERY candidate is held, next says so and names every holder
  // — it never reports done
  // ==========================================================================
  {
    name: "item-lock/04 next: when every candidate is held, the state is \"held\" (never \"done\"), no ready ref is returned, every holder is named, and the human render distinguishes the two",
    run: () =>
      withItemLockFixture(async (fx) => {
        for (const ref of ["42", "43", "44"]) {
          await seedActive(fx, { assignmentId: `asg-${ref}`, itemRef: ref, node: HOLDER, state: "running" });
        }

        const envelope = await next(fx);
        assert.notEqual(envelope.state, "done", "everything-held is NOT everything-done");
        assert.equal(envelope.state, "held");
        assert.equal(envelope.ref, undefined, "no ready ref is carried");
        const byRef = new Map(envelope.skipped.map((entry) => [entry.ref, entry]));
        for (const ref of ["42", "43", "44"]) {
          assert.ok(byRef.has(ref), `the skipped list contains an entry for ${ref}`);
          assert.equal(byRef.get(ref).holderNode, HOLDER, `${ref} names ${HOLDER} as its holder`);
        }

        const human = nextCommand.cli.render(envelope, { positionals: [] });
        assert.match(human, /being worked/i, "the human render says the work is being done elsewhere");
        assert.doesNotMatch(human, /everything is done/i, "…and never says everything is done");
        assert.match(human, new RegExp(HOLDER), "…naming the holder");
      }, { stream: NEXT_STREAM }),
  },

  // ==========================================================================
  // Scenario: no candidate is silently dropped — returned, skipped and blocked
  // account for all of them
  // ==========================================================================
  {
    name: "item-lock/04 next: with 42 held and 44 depends-blocked, next returns 43, names 42 and ONLY 42 as skipped, and 44 is accounted for as blocked",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });

        const envelope = await next(fx);
        assert.equal(envelope.ref, "43", "the ready ref is 43");
        assert.deepEqual(envelope.skipped.map((entry) => entry.ref), ["42"], "the skipped list names 42 and only 42");

        // 44 is a DIFFERENT answer — blocked, not skipped.
        const blocked = await next(fx, "44");
        assert.equal(blocked.state, "blocked");
        assert.deepEqual(blocked.waitingOn, ["43"]);
        assert.equal(blocked.skipped.some((entry) => entry.ref === "44"), false, "44 is never reported as skipped");
      }, {
        stream: [
          { number: "42", stories: ["01", "02", "03"] },
          { number: "43", stories: [] },
          { number: "44", stories: [], depends: ["43"] },
        ],
      }),
  },

  // ==========================================================================
  // Scenario Outline: with no active assignment, next answers exactly as it did
  // before the lock existed
  // ==========================================================================
  {
    name: "item-lock/04 next: no assignments, an ordinary ready item — state ready, ref 42, a cwd-relative path, and an empty skipped list",
    run: () =>
      withItemLockFixture(async (fx) => {
        const envelope = await next(fx);
        assert.equal(envelope.state, "ready");
        assert.equal(envelope.ref, "42");
        assert.deepEqual(envelope.skipped, []);
        const json = nextCommand.cli.json(envelope);
        assert.equal(path.isAbsolute(json.path), false, "the --json face relativises path to cwd");
      }, { stream: [{ number: "42", stories: [] }, { number: "43", stories: [] }] }),
  },
  {
    name: "item-lock/04 next: no assignments, a depends-blocked item — state blocked, waitingOn names the unmet driver, and an empty skipped list",
    run: () =>
      withItemLockFixture(async (fx) => {
        const envelope = await next(fx, "43");
        assert.equal(envelope.state, "blocked");
        assert.deepEqual(envelope.waitingOn, ["42"]);
        assert.deepEqual(envelope.skipped, []);
      }, { stream: [{ number: "42", stories: [], status: "in-progress" }, { number: "43", stories: [], depends: ["42"] }] }),
  },
  {
    name: "item-lock/04 next: no assignments, a finished stream — state done, no ref returned, and an empty skipped list",
    run: () =>
      withItemLockFixture(async (fx) => {
        const envelope = await next(fx);
        assert.equal(envelope.state, "done");
        assert.equal(envelope.ref, undefined);
        assert.deepEqual(envelope.skipped, []);
      }, { stream: [{ number: "42", stories: [], status: "done" }, { number: "43", stories: [], status: "done" }] }),
  },

  // ==========================================================================
  // Scenario: an item stops being skipped the moment its assignment settles
  // ==========================================================================
  {
    name: "item-lock/04 next: the moment the assignment settles, 42 is handable again on the very next call — ready ref 42, skipped list empty",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });

        const held = await next(fx);
        assert.equal(held.ref, "43");
        assert.deepEqual(held.skipped.map((entry) => entry.ref), ["42"]);

        await settle(fx, "asg-1", "done");

        const released = await next(fx);
        assert.equal(released.ref, "42", "the item is handable again with no intervening command");
        assert.deepEqual(released.skipped, [], "the skipped list is empty");
      }, { stream: [{ number: "42", stories: [] }, { number: "43", stories: [] }, { number: "44", stories: [] }] }),
  },

  // ==========================================================================
  // The invisible-item failure, closed at the SEAM as well: a held milestone
  // whose stories are all done reaches `nextWork`'s deliberately candidacy-blind
  // accept-fallthrough — it must still never be handed out to be refused.
  // ==========================================================================
  {
    name: "item-lock/04 next: a held milestone at its accept-fallthrough is reported held, never handed out for a mint the lock would refuse",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });

        const envelope = await next(fx, "42");
        assert.equal(envelope.state, "held");
        assert.equal(envelope.ref, undefined);
        const error = await refuse(() => invoke("work:run-start", { ref: "42" }, fx.ctx));
        assert.equal(error.code, "item-locked-by-assignment", "…which is exactly what a mint on it would have been told");
      }, {
        stream: [{ number: "42", status: "in-review", stories: [{ number: "01", status: "done" }] }],
      }),
  },
];
