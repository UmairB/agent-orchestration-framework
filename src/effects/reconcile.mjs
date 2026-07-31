// src/effects/reconcile.mjs — the FILE-STORE RECONCILER SCAN (m42 wave (d) leg
// d5; PRD "the file-store reconciler scan closing the write-vs-append crash
// window"). run-transitions.mjs is write-then-append by design — the fact first,
// the event second, chosen over 2PC knowingly — so a crash BETWEEN them leaves a
// run record whose cascade was never owed: the rollback never fires, the publish
// never happens, the Notion step is never recorded. This scan re-derives the
// missing event from the record itself, which is only honest because a run
// record carries a UNIQUE join key (runId) — the journal can answer "does this
// fact's event exist?" exactly (journal.hasEventForRun).
//
// Two deliberate bounds, both against re-announcing history as if it were news:
//   1. ONLY each item's LATEST run record is reconciled. A superseded record's
//      missing event is not a crash to heal — the stream has moved on, and
//      appending its `run.completed` now would fire rollback-status against an
//      item legitimately in progress on a NEWER run.
//   2. ONLY records stamped at/after the ledger's birth (the journal's oldest
//      event, else the journal file's own birthtime). A record that completed
//      before the journal existed has no missing event — it predates events.
//
// The scan APPENDS and returns; it never drains. Its caller (work:doctor
// --converge) owns the drain, so the paid/left report comes from one place.
import { stat } from "node:fs/promises";
import { listItems } from "../work.mjs";
import { readRuns } from "../run-store.mjs";
import { applicableReactors } from "./table.mjs";
import {
  openEffectsJournal,
  appendEvent,
  hasEventForRun,
  oldestEventAt,
  effectsJournalPath,
} from "./journal.mjs";
import { reportDegrade } from "../degrade.mjs";

const TERMINAL_STATES = new Set(["done", "failed", "cancelled"]);

// The latest record of an item — by updatedAt (falling back to createdAt), the
// record's own clock. The union read (readRuns) is unordered by contract.
function latestRecord(records) {
  let latest = null;
  for (const record of records) {
    const stamp = record.updatedAt ?? record.createdAt ?? "";
    const latestStamp = latest ? latest.updatedAt ?? latest.createdAt ?? "" : "";
    if (latest == null || stamp > latestStamp) latest = record;
  }
  return latest;
}

// reconcileRunRecords(workspace, { journalOptions, now }) — scan every item's
// latest run record and append the event a crash ate. Returns
// { scanned, appended: [{ ref, runId, event, eventId }] } — or a coded skip when
// the journal itself is unavailable (behaviour never gates on the ledger's
// health, and a reconciler with no ledger has nothing to reconcile INTO).
export async function reconcileRunRecords(workspace, { journalOptions = {}, now } = {}) {
  let journal = null;
  try {
    journal = await openEffectsJournal(journalOptions);
  } catch (error) {
    reportDegrade("effects-journal-open", error);
    return { scanned: 0, appended: [], skipped: true, reason: "journal-unavailable" };
  }

  try {
    // The ledger's birth floor: the oldest event, else the journal file itself.
    let floor = oldestEventAt(journal);
    if (floor == null) {
      try {
        floor = (await stat(effectsJournalPath(journalOptions))).birthtime.toISOString();
      } catch {
        floor = null; // no floor derivable — reconcile nothing rather than everything
      }
    }
    if (floor == null) return { scanned: 0, appended: [], skipped: true, reason: "no-ledger-birth" };

    const items = await listItems(workspace.workDir);
    const appended = [];
    let scanned = 0;
    for (const item of items) {
      const record = latestRecord(await readRuns(item));
      if (!record?.runId) continue;
      scanned += 1;
      const stamp = record.updatedAt ?? record.createdAt ?? "";
      if (stamp < floor) continue;

      if (TERMINAL_STATES.has(record.state)) {
        if (hasEventForRun(journal, "run.completed", record.runId)) continue;
        const payload = {
          ref: record.itemRef ?? item.ref,
          runId: record.runId,
          outcome: record.state,
          failureReason: record.failureReason ?? null,
          node: record.node ?? null,
          itemDir: item.dir,
          itemType: item.type ?? null,
          workspaceRoot: workspace.projectRoot ?? null,
          reconciled: true,
        };
        const reactors = await applicableReactors("run.completed", payload, { workspace });
        const { eventId } = appendEvent(journal, { name: "run.completed", payload, source: "reconciler", now }, reactors);
        appended.push({ ref: payload.ref, runId: record.runId, event: "run.completed", eventId });
        continue;
      }

      if (record.state === "running") {
        if (hasEventForRun(journal, "run.started", record.runId)) continue;
        const payload = {
          ref: record.itemRef ?? item.ref,
          runId: record.runId,
          mode: record.retryOf ? "retry" : "start",
          attempt: record.attempt ?? null,
          retryOf: record.retryOf ?? null,
          node: record.node ?? null,
          itemDir: item.dir,
          itemType: item.type ?? null,
          workspaceRoot: workspace.projectRoot ?? null,
          reconciled: true,
        };
        const reactors = await applicableReactors("run.started", payload, { workspace });
        const { eventId } = appendEvent(journal, { name: "run.started", payload, source: "reconciler", now }, reactors);
        appended.push({ ref: payload.ref, runId: record.runId, event: "run.started", eventId });
      }
    }
    return { scanned, appended };
  } finally {
    journal.close();
  }
}
