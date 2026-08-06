// Traceability wiring for milestone 43 / story 02 (the authority cut), task
//   .../02_story_cache-authority/tasks/04_contention-is-decided-by-the-assignment-lock.feature
//
// AC3: contention at the upsert seam is decided by the ADR-003 assignment lock, never by
// a timestamp race. While an assignment covers a ref's execution scope, an upsert for
// that ref is accepted ONLY from the holder — in the ONE rule's two renderings:
//   AUTOMATIC (the control's periodic publish tick) -> skip the ref and COUNT the skip
//     in the tick's result; a coded refusal per held item per tick is log spam and the
//     tick asked nothing;
//   OPERATOR-INITIATED (a human-driven control-side verb) -> refuse, coded and loud,
//     with `item-locked-by-assignment`.
//
// SCOPE BOUNDARY, honoured: the lock PREDICATE (which assignments are active, what
// execution scope covers, the shape of the refusal payload) is 43/01's contract and is
// not re-specified here. This file specifies only what the UPSERT SEAM does when the
// predicate says a ref is held — and it is the same ground 43/01's task 05 covers from
// the other side, so `test/item-lock-operator-vs-automatic.test.mjs` is its sibling and
// stays green against this story's replacement mechanism, not a forked one.
//
// THE OPERATOR DOOR used below is `work:run-start` — ADR-003's own first example of an
// operator verb, and the one control-side door that both (a) sits behind the item lock
// and (b) propagates the control's disk through publish-on-mutate, so "the operator's
// value" is observable in the cached row. Which verb is 43/01's choice, not this
// story's; what this file pins is what the SEAM does on either side of it.
import assert from "node:assert/strict";
import { invoke } from "../src/command-core.mjs";
import {
  withCacheFixture,
  seedActive,
  settle,
  refuse,
  tick,
  stream,
  rows,
  authorOf,
  itemRow,
  writeItem,
  withStore,
  CONTROL,
  WORKER_A,
  WORKER_B,
} from "./support/cache-authority-fixture.mjs";
import { upsertWorkItems } from "../src/global-work-store.mjs";

const STREAM = [{ number: "43", stories: ["01", "02", "03"] }];
const HELD_SCOPE = "43";
const ASSIGNMENT = "asg-43";

// Background: an ACTIVE assignment held by worker-a covering 43/02's execution scope,
// and 43/02 cached with status in-progress as worker-a last reported it.
const withHeld = (body) => () => withCacheFixture(async (fx) => {
  await tick(fx);
  await seedActive(fx, { assignmentId: ASSIGNMENT, itemRef: HELD_SCOPE, node: WORKER_A, state: "running" });
  await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress" })], { at: "2026-08-02T09:00:00.000Z" });
  return body(fx);
}, { stream: STREAM });

const skippedRef = (result, ref) => (result.skippedRefs ?? []).find((entry) => entry.ref === ref);

export const cacheAuthorityContentionTests = [
  // ==========================================================================
  // Scenario: the holder's report for a held ref is accepted
  // ==========================================================================
  {
    name: "cache-authority/04 the holder writes freely — worker-a's report for the ref its own assignment holds is accepted, status and title",
    run: withHeld(async (fx) => {
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "done", title: "settled by its holder" })], { at: "2026-08-02T10:00:00.000Z" });
      const row = (await rows(fx)).get("43/02");
      assert.equal(row.status, "done", "the lock protects the holder's work; it does not freeze the row");
      assert.equal(row.title, "settled by its holder");
    }),
  },

  // ==========================================================================
  // Scenario: the control's periodic publish tick skips a held ref and counts the
  // skip in its result
  // ==========================================================================
  {
    name: "cache-authority/04 the AUTOMATIC rendering — the tick skips the held ref, counts it, names it and the node holding it, raises no item-locked-by-assignment, and leaves the row as worker-a reported it",
    run: withHeld(async (fx) => {
      // The control's disk still holds the pre-run scaffold for the held ref, so a tick
      // that did NOT skip would visibly revert the row.
      await writeItem(fx, "43/02", { status: "not-started", title: "a stale control-side scaffold" });

      const propagation = await tick(fx);
      assert.equal(propagation.published, true, "the tick completes successfully");
      assert.equal(propagation.warning, undefined, "the tick raises no error at all — it asked nothing");

      const skip = skippedRef(propagation.result, "43/02");
      assert.ok(skip != null, "the tick's result counts 43/02 among the refs it skipped");
      assert.equal(skip.reason, "held-by-assignment");
      assert.equal(skip.holderNode, WORKER_A, "the skip names the node holding it");
      assert.equal(skip.assignmentId, ASSIGNMENT, "…and the assignment holding it");
      assert.deepEqual(propagation.result.heldRefs, [HELD_SCOPE], "…and the held EXECUTION SCOPE is named beside the count");
      assert.equal(propagation.result.heldSkipped, 1);

      const row = (await rows(fx)).get("43/02");
      assert.equal(row.status, "in-progress", "the cached row still reports what worker-a last reported");
      assert.equal(await authorOf(fx, "43/02"), WORKER_A, "…still attributed to worker-a");
    }),
  },

  // ==========================================================================
  // Scenario: an operator-initiated control-side mutation of a held item is
  // refused with item-locked-by-assignment
  // ==========================================================================
  {
    name: "cache-authority/04 the OPERATOR rendering — a control-side mutation of the held item is refused with item-locked-by-assignment naming the item, the holder and the assignment, and changes nothing",
    run: withHeld(async (fx) => {
      const before = (await rows(fx)).get("43/02");

      const error = await refuse(() => invoke("work:run-start", { ref: "43/02" }, fx.ctx));
      assert.equal(error.code, "item-locked-by-assignment", "coded and loud — a human asked and gets an answer");
      assert.equal(error.itemRef, "43/02", "the refusal names the item");
      assert.equal(error.holderNode, WORKER_A, "…the holding node");
      assert.equal(error.assignmentId, ASSIGNMENT, "…and the assignment");

      assert.deepEqual((await rows(fx)).get("43/02"), before, "the cached row is exactly as worker-a last reported it");
    }),
  },

  // ==========================================================================
  // Scenario: at a gate, with no active assignment, the same operator-initiated
  // mutation is accepted
  // ==========================================================================
  {
    name: "cache-authority/04 at a GATE the same operator verb is accepted, the cached row takes the operator's value, and authorship changes hands — worker-a's later retraction no longer reaches it",
    run: withHeld(async (fx) => {
      await settle(fx, ASSIGNMENT, "done");

      // The operator's own value for the item, on the control node, carried into the
      // cache by the operator-initiated publish the verb raises.
      await writeItem(fx, "43/02", { status: "in-progress", title: "edited on the control at the gate" });
      const started = await invoke("work:run-start", { ref: "43/02" }, fx.ctx);
      assert.ok(started.runId, "it is accepted, and no item-locked-by-assignment error is raised");

      const row = (await rows(fx)).get("43/02");
      assert.equal(row.title, "edited on the control at the gate", "the cached row reports the operator's value");
      assert.equal(await authorOf(fx, "43/02"), CONTROL, "…and the control became the row's author from that write onward");

      await withStore(fx, (store) => upsertWorkItems(store, fx.workspaceId, [], {
        nodeId: WORKER_A,
        authority: "reported",
        syncedAt: "2026-08-02T13:00:00.000Z",
        authoritativeRefs: ["43/01"],
      }));
      assert.ok((await rows(fx)).has("43/02"), "a later publish from worker-a whose ref set omits 43/02 leaves the row in place");
    }),
  },

  // ==========================================================================
  // Scenario: an older report does not overwrite a newer row, whatever order the
  // two arrive in
  // ==========================================================================
  {
    name: "cache-authority/04 a REDELIVERED older report does not undo a newer one — worker-a's done at the later instant survives its own earlier in-progress frame arriving afterwards",
    run: withHeld(async (fx) => {
      await settle(fx, ASSIGNMENT, "done"); // no assignment is active for 43/02's scope

      await stream(fx, WORKER_A, [itemRow("43/02", { status: "done", title: "settled" })], { at: "2026-08-02T12:00:00.000Z" });
      assert.equal((await rows(fx)).get("43/02").status, "done");

      // Frames are re-sent on reconnect by construction: this is a real ordering.
      const redelivered = await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress", title: "mid-phase" })], { at: "2026-08-02T11:00:00.000Z" });
      assert.equal((await rows(fx)).get("43/02").status, "done", "the newer row is not undone by the redelivery");
      assert.equal(
        (redelivered.skippedRows ?? []).find((entry) => entry.ref === "43/02")?.reason,
        "stale-report",
        "…and the redelivery is counted, not silently dropped",
      );

      // …while a genuinely NEWER report from the same node still lands, so the rule is
      // an ordering and not a freeze.
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-review" })], { at: "2026-08-02T13:00:00.000Z" });
      assert.equal((await rows(fx)).get("43/02").status, "in-review");
    }),
  },

  // ==========================================================================
  // Scenario Outline: exactly who may write a ref, and what happens when they may
  // not
  // ==========================================================================
  ...[
    { lock: "held", author: WORKER_A, writer: WORKER_A, initiation: "frame", outcome: "accepts" },
    { lock: "held", author: WORKER_A, writer: WORKER_B, initiation: "frame", outcome: "skips" },
    { lock: "held", author: WORKER_A, writer: CONTROL, initiation: "tick", outcome: "skips" },
    { lock: "held", author: WORKER_A, writer: CONTROL, initiation: "operator", outcome: "refuses" },
    { lock: "free", author: WORKER_A, writer: CONTROL, initiation: "operator", outcome: "accepts" },
    { lock: "free", author: CONTROL, writer: CONTROL, initiation: "tick", outcome: "accepts" },
    { lock: "free", author: WORKER_A, writer: CONTROL, initiation: "tick", outcome: "skips" },
    { lock: "free", author: WORKER_A, writer: WORKER_A, initiation: "frame", outcome: "accepts" },
    // ADDED at 43/02's structural review (PO decision on QA's G3). This feature's header
    // says "outside a lock, last-write-wins by `syncedAt`". Between two NODES that is
    // FALSE as built, deliberately: the never-move-backwards guard is scoped to a single
    // author, because comparing two machines' clocks hands the outcome to skew — and
    // would let a worker whose clock trails the control's have its own holder frames
    // rejected (ADR-011/A1's regression by another route). ADR-010/D1 forbids `syncedAt`
    // as authority between nodes; ADR-012/B7 pins the scoping. Across nodes, outside a
    // lock, ARRIVAL ORDER wins — recorded here rather than left as folklore.
    { lock: "free", author: WORKER_A, writer: WORKER_B, initiation: "frame", outcome: "accepts", crossNode: true },
  ].map(({ lock, author, writer, initiation, outcome, crossNode }) => ({
    name: `cache-authority/04 outline: scope ${lock === "held" ? "held by worker-a" : "free"}, row authored by ${author}, ${writer} writes as ${initiation === "tick" ? "the periodic publish tick" : initiation === "operator" ? "an operator verb" : "a streamed frame"} — the seam ${outcome}`,
    // The Outline sets its OWN two Givens (the lock state and the row's author), so it
    // builds them directly rather than overriding the headline Background — a row
    // "authored by control-1" is one no worker has ever reported, not one a worker
    // reported and the control took back.
    run: () => withCacheFixture(async (fx) => {
      await tick(fx);
      if (author === WORKER_A) await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress" })], { at: "2026-08-02T09:00:00.000Z" });
      if (lock === "held") await seedActive(fx, { assignmentId: ASSIGNMENT, itemRef: HELD_SCOPE, node: WORKER_A, state: "running" });
      assert.equal(await authorOf(fx, "43/02"), author, "the row under test carries the author this row is about (non-vacuous)");

      const before = (await rows(fx)).get("43/02");
      const marker = `written by ${writer} as ${initiation}`;

      if (initiation === "frame") {
        // The cross-node row writes an OLDER stamp than the row already carries, which is
        // the whole point of it: within one author that is refused `stale-report`, and
        // ACROSS authors it is accepted — arrival order wins, and `syncedAt` decides
        // nothing. Same call, opposite outcome, decided only by whose row it is.
        const at = crossNode ? "2026-08-02T08:00:00.000Z" : "2026-08-02T14:00:00.000Z";
        const result = await stream(fx, writer, [itemRow("43/02", { status: "in-review", title: marker })], { at });
        if (crossNode) {
          const sameAuthorRedelivery = await stream(fx, writer, [itemRow("43/02", { status: "blocked", title: "an older redelivery" })], { at: "2026-08-02T07:00:00.000Z" });
          assert.equal(
            (sameAuthorRedelivery.skippedRows ?? []).find((entry) => entry.ref === "43/02")?.reason,
            "stale-report",
            "the SAME node's older report is refused — the rule exists and is live",
          );
          assert.equal((await rows(fx)).get("43/02").title, marker, "…while the other node's older report won, because arrival order decided it");
        }
        if (outcome === "accepts") {
          assert.equal((await rows(fx)).get("43/02").title, marker, "the seam accepts the write");
          assert.equal(await authorOf(fx, "43/02"), writer);
        } else {
          const skip = (result.skippedRows ?? []).find((entry) => entry.ref === "43/02");
          assert.ok(skip != null, "the seam does not accept it, and counts it as a skipped ref");
          assert.equal(skip.reason, "held-by-assignment");
          assert.deepEqual((await rows(fx)).get("43/02"), before, "…and the row is untouched");
        }
        return;
      }

      if (initiation === "tick") {
        await writeItem(fx, "43/02", { status: "not-started", title: marker });
        const propagation = await tick(fx);
        if (outcome === "accepts") {
          assert.equal((await rows(fx)).get("43/02").title, marker, "the seam accepts the write");
        } else {
          assert.ok(skippedRef(propagation.result, "43/02") != null, "the seam does not accept it, and counts it as a skipped ref");
          assert.deepEqual((await rows(fx)).get("43/02"), before, "…and the row is untouched");
        }
        return;
      }

      await writeItem(fx, "43/02", { status: "in-progress", title: marker });
      if (outcome === "refuses") {
        const error = await refuse(() => invoke("work:run-start", { ref: "43/02" }, fx.ctx));
        assert.equal(error.code, "item-locked-by-assignment", 'the seam refuses it with the coded error "item-locked-by-assignment"');
        assert.deepEqual((await rows(fx)).get("43/02"), before, "…and the row is untouched");
      } else {
        await invoke("work:run-start", { ref: "43/02" }, fx.ctx);
        assert.equal((await rows(fx)).get("43/02").title, marker, "the seam accepts the write");
        assert.equal(await authorOf(fx, "43/02"), CONTROL, "…and the operator's node takes authorship");
      }
    }, { stream: STREAM }),
  })),
];
