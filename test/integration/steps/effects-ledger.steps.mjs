// Steps for effects-ledger.feature (m42 wave (d) leg d2). The execution and
// status assertions are the shared grammar; the journal steps are the ONE
// sanctioned grey-box seam — they verify at the real data store (the per-node
// journal.sqlite under the context's isolated AOF_GLOBAL_HOME), because "the
// cascade is durable" is a claim about the store, not about stdout.
import assert from "node:assert/strict";
import { createStepRegistry } from "../support/step-registry.mjs";
import { registerCommonSteps } from "../support/common-steps.mjs";
import {
  openEffectsJournal,
  effectsJournalPath,
  appendEvent,
  pendingSteps,
  readEvents,
  readEventSteps,
} from "../../../src/effects/journal.mjs";
import { effectsFor } from "../../../src/effects/table.mjs";

const registry = createStepRegistry();
registerCommonSteps(registry);

function journalOptions(context) {
  return { env: { ...process.env, AOF_GLOBAL_HOME: context.globalDir } };
}

async function withJournal(context, fn) {
  const journal = await openEffectsJournal(journalOptions(context));
  try {
    return await fn(journal);
  } finally {
    journal.close();
  }
}

// The crash simulation: the fact happened and the event was journaled, but the
// process died BEFORE draining — exactly the window the ledger exists to close.
// Written with the real appendEvent against the context's own journal.
registry.define(
  /^a journaled "([^"]+)" event with pending steps for a failed run on "([^"]+)"$/,
  async (context, name, ref) => {
    const item = context.items.get(ref);
    assert.ok(item, `fixture item "${ref}" exists`);
    const reactors = effectsFor(name);
    assert.ok(reactors, `"${name}" is a declared event`);
    await withJournal(context, (journal) => {
      appendEvent(
        journal,
        {
          name,
          source: "bdd-crash-simulation",
          payload: {
            ref,
            runId: "20260101T000000000Z-0000",
            outcome: "failed",
            failureReason: "timeout",
            itemDir: item.dir,
            itemType: item.type,
            workspaceRoot: context.projectDir,
          },
        },
        reactors,
      );
    });
  },
);

registry.define(/^the journal should hold a "([^"]+)" event$/, async (context, name) => {
  await withJournal(context, (journal) => {
    const events = readEvents(journal, { name });
    assert.ok(events.length >= 1, `the journal holds at least one "${name}" event`);
    context.lastEventId = events[0].eventId;
  });
});

registry.define("every journaled step of that event should be terminal", async (context) => {
  assert.ok(context.lastEventId, "a journaled event was located first");
  await withJournal(context, (journal) => {
    const steps = readEventSteps(journal, context.lastEventId);
    assert.ok(steps.length >= 1, "the event materialised at least one step");
    for (const step of steps) {
      assert.ok(
        step.status === "done" || step.status === "failed" || step.status === "skipped",
        `step ${step.key} is terminal (got "${step.status}")`,
      );
    }
  });
});

registry.define("the journal should hold no pending steps", async (context) => {
  const databasePath = effectsJournalPath(journalOptions(context));
  await withJournal(context, (journal) => {
    const pending = pendingSteps(journal, { includeFailed: false });
    assert.deepEqual(
      pending.map((step) => `${step.name}/${step.key}`),
      [],
      `no pending steps remain in ${databasePath}`,
    );
  });
});

export async function runStep(context, step) {
  await registry.run(context, step);
}
