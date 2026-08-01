// Steps for effects-ledger.feature (m42 wave (d) leg d2). The execution and
// status assertions are the shared grammar; the journal steps are the ONE
// sanctioned grey-box seam — they verify at the real data store (the per-node
// journal.sqlite under the context's isolated AOF_GLOBAL_HOME), because "the
// cascade is durable" is a claim about the store, not about stdout.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createStepRegistry } from "../support/step-registry.mjs";
import { registerCommonSteps } from "../support/common-steps.mjs";
import { readFile as readTextFile, writeFile } from "node:fs/promises";
import {
  openEffectsJournal,
  effectsJournalPath,
  appendEvent,
  pendingSteps,
  readEvents,
  readEventSteps,
} from "../../../src/effects/journal.mjs";
import { applicableReactors } from "../../../src/effects/table.mjs";

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

// Opt the fixture workspace into Notion sync (m42 wave (d) leg d4, port 4) —
// record-only (no autoSync), so the scenario needs ZERO egress: the point is the
// owed step, not the sync. Merges the block into the fixture's real config.
registry.define("the workspace config enables Notion sync", async (context) => {
  const configPath = path.join(context.projectDir, ".aof", "aof.config.json");
  const config = JSON.parse(await readTextFile(configPath, "utf8"));
  config.work = {
    ...(config.work ?? {}),
    integrations: {
      notion: {
        dataSourceId: "ds-bdd",
        tokenEnv: "AOF_BDD_NOTION_TOKEN",
        statusProperty: "Status",
        statusMap: {
          "not-started": "Not started",
          "in-progress": "In progress",
          "in-review": "In review",
          done: "Done",
        },
        relationProperty: "Sub-tasks",
      },
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
});

// The crash simulation: the fact happened and the event was journaled, but the
// process died BEFORE draining — exactly the window the ledger exists to close.
// Written with the real appendEvent against the context's own journal, through
// the SAME append-time applicability resolution the seams use (port 4) — so the
// simulated crash owes exactly what a real one would have.
registry.define(
  /^a journaled "([^"]+)" event with pending steps for a failed run on "([^"]+)"$/,
  async (context, name, ref) => {
    const item = context.items.get(ref);
    assert.ok(item, `fixture item "${ref}" exists`);
    const payload = {
      ref,
      runId: "20260101T000000000Z-0000",
      outcome: "failed",
      failureReason: "timeout",
      itemDir: item.dir,
      itemType: item.type,
      workspaceRoot: context.projectDir,
    };
    const reactors = await applicableReactors(name, payload);
    assert.ok(reactors.length > 0, `"${name}" is a declared event with applicable reactors`);
    await withJournal(context, (journal) => {
      appendEvent(journal, { name, source: "bdd-crash-simulation", payload }, reactors);
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

// The event's own EVIDENCE (m42 wave (d) leg d4, port 1): an event is a past-tense
// fact carrying what its reactors need, never a ping that forces a racing re-read.
// Reading it out of the real journal is the same grey-box seam as the steps above.
registry.define(
  /^the journaled event should carry "([^"]+)" as "([^"]*)"$/,
  async (context, field, expected) => {
    assert.ok(context.lastEventId, "a journaled event was located first");
    await withJournal(context, (journal) => {
      const event = readEvents(journal, { limit: 200 }).find((row) => row.eventId === context.lastEventId);
      assert.ok(event, "the located event is readable");
      assert.equal(String(event.payload?.[field] ?? ""), expected, `payload.${field}`);
    });
  },
);

// The record-doc fact itself — the bullet the seam appended, read off disk.
registry.define(
  /^item "([^"]+)" STATE\.md should contain "([^"]+)"$/,
  async (context, ref, text) => {
    const item = context.items.get(ref);
    assert.ok(item, `fixture item "${ref}" exists`);
    const body = await readFile(path.join(item.dir, "STATE.md"), "utf8");
    assert.ok(body.includes(text), `STATE.md contains "${text}"`);
  },
);

// The per-reactor outcome read from the JOURNAL rather than the result envelope.
// The verbs ported in m42 wave (d) leg d4 (port 1) deliberately did NOT grow an
// `effects` key — the port is invisible on their wire — so their cascade is
// asserted where it is actually recorded.
registry.define(
  /^the journaled step "([^"]+)" should be "([^"]+)"$/,
  async (context, key, status) => {
    assert.ok(context.lastEventId, "a journaled event was located first");
    await withJournal(context, (journal) => {
      const step = readEventSteps(journal, context.lastEventId).find((row) => row.key === key);
      assert.ok(step, `the event materialised a "${key}" step`);
      assert.equal(step.status, status, `step "${key}" is "${status}" (got "${step.status}")`);
    });
  },
);

// The applicability predicate's negative half (port 4): an event that owes a
// step it can never pay would be the permanent-leak class — assert it was never
// materialised at all.
registry.define(
  /^the journaled event should not materialise a "([^"]+)" step$/,
  async (context, key) => {
    assert.ok(context.lastEventId, "a journaled event was located first");
    await withJournal(context, (journal) => {
      const step = readEventSteps(journal, context.lastEventId).find((row) => row.key === key);
      assert.equal(step, undefined, `the event materialised no "${key}" step`);
    });
  },
);

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
