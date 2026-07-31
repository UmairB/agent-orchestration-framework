// Fitness function: acd-run-reclaim-stale-only (milestone 20, ADR-004).
//
// reclaimStaleRuns force-fails ONLY stale `running` runs (via the legal running →
// failed edge), setting failureReason = runtime_offline + reclaimedAt; it leaves every
// live / queued / terminal run BYTE-UNCHANGED (19/R4); it takes the item LIST as an
// argument (no single-node assumption — the 26 → 20 path-walk seam) and transitions via
// applyTransition (a legal 19/ADR-001 edge). Behavioural over a controlled runs/ mix
// plus a source-grep of the scan's signature + transition call.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RUN_STORE = new URL("../../src/run-store.mjs", import.meta.url);

async function makeItem(slug = "20_milestone_autonomous-run-resilience", ref = "20") {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-reclaim-stale-"));
  const dir = path.join(repo, "wiki", "work", slug);
  await mkdir(path.join(dir, "runs"), { recursive: true });
  return { repo, item: { ref, dir } };
}

// Write a run record DIRECTLY (bypassing the dedup'd mint) so a single item can carry
// a mix of running/queued/terminal runs the scan must discriminate.
async function writeRecord(item, overrides) {
  const record = {
    runId: overrides.runId,
    itemRef: item.ref,
    state: overrides.state,
    attempt: 1,
    outcome: overrides.outcome ?? null,
    sessionId: overrides.sessionId ?? null,
    brief: {},
    createdAt: overrides.createdAt ?? "2026-06-30T08:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-30T08:00:00.000Z",
    failureReason: overrides.failureReason ?? null,
    heartbeatAt: overrides.heartbeatAt ?? null,
    retryOf: null,
    reclaimedAt: null,
  };
  await writeFile(path.join(item.dir, "runs", `${record.runId}.json`), JSON.stringify(record, null, 2), "utf8");
  return record.runId;
}

async function bytes(item, runId) {
  return readFile(path.join(item.dir, "runs", `${runId}.json`), "utf8");
}

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function functionBody(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  if (!match) return "";
  // Walk past the parameter list (balanced parens) so a destructured-object param
  // like ({ now, stalenessThreshold } = {}) is not mistaken for the body brace.
  let i = source.indexOf("(", match.index);
  let parenDepth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        i += 1;
        break;
      }
    }
  }
  const open = source.indexOf("{", i);
  let depth = 1;
  let out = "";
  for (let j = open + 1; j < source.length && depth > 0; j += 1) {
    const ch = source[j];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    out += ch;
  }
  return out;
}

export const archTests = [
  {
    name: "arch/run-reclaim-stale-only: reclaim force-fails ONLY the stale running run, leaving every other run byte-identical",
    async run() {
      const { repo, item } = await makeItem();
      try {
        const { reclaimStaleRuns } = await import("../../src/run-store.mjs");
        const now = "2026-06-30T12:00:00.000Z";

        // a mix: stale running (2 min idle) / fresh-heartbeat running (30s) / queued / terminal done
        const staleId = await writeRecord(item, { runId: "20260630T115800000Z-0000", state: "running", sessionId: "sess-stale", heartbeatAt: "2026-06-30T11:58:00.000Z" });
        const freshId = await writeRecord(item, { runId: "20260630T115930000Z-0001", state: "running", heartbeatAt: "2026-06-30T11:59:30.000Z" });
        const queuedId = await writeRecord(item, { runId: "20260630T120000000Z-0002", state: "queued" });
        const doneId = await writeRecord(item, { runId: "20260630T100000000Z-0003", state: "done", outcome: "done" });

        const freshBefore = await bytes(item, freshId);
        const queuedBefore = await bytes(item, queuedId);
        const doneBefore = await bytes(item, doneId);

        const reclaimed = await reclaimStaleRuns([item], { now, stalenessThreshold: 60000 });

        // exactly the stale run was reclaimed
        assert.equal(reclaimed.length, 1, "exactly one run reclaimed");
        assert.equal(reclaimed[0].run.runId, staleId, "the reclaimed run is the stale one");
        const stale = JSON.parse(await bytes(item, staleId));
        assert.equal(stale.state, "failed", "the stale run became failed");
        assert.equal(stale.failureReason, "runtime_offline", "the stale run's failureReason is runtime_offline (retryable)");
        assert.equal(stale.reclaimedAt, now, "the stale run's reclaimedAt is the scan's now");
        assert.equal(stale.sessionId, "sess-stale", "the stale run's sessionId is preserved");

        // every other run byte-identical
        assert.equal(await bytes(item, freshId), freshBefore, "the fresh-heartbeat running run is byte-unchanged");
        assert.equal(await bytes(item, queuedId), queuedBefore, "the queued run is byte-unchanged");
        assert.equal(await bytes(item, doneId), doneBefore, "the terminal done run is byte-unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/run-reclaim-stale-only: the scan walks the supplied item LIST by path — an item not in the list is untouched",
    async run() {
      const { repo: r1, item: a } = await makeItem("20_milestone_autonomous-run-resilience", "20");
      const { repo: r2, item: b } = await makeItem("19_milestone_work-run-lifecycle", "19");
      try {
        const { reclaimStaleRuns } = await import("../../src/run-store.mjs");
        const now = "2026-06-30T12:00:00.000Z";
        const aStale = await writeRecord(a, { runId: "20260630T115000000Z-0000", state: "running", heartbeatAt: "2026-06-30T11:50:00.000Z" });
        const bStale = await writeRecord(b, { runId: "20260630T115000000Z-0000", state: "running", heartbeatAt: "2026-06-30T11:50:00.000Z" });
        const bBefore = await bytes(b, bStale);

        // scan ONLY item a
        await reclaimStaleRuns([a], { now, stalenessThreshold: 60000 });

        assert.equal(JSON.parse(await bytes(a, aStale)).state, "failed", "item 20's stale run was reclaimed");
        assert.equal(await bytes(b, bStale), bBefore, "item 19 — not in the scanned list — is byte-unchanged");
      } finally {
        await rm(r1, { recursive: true, force: true });
        await rm(r2, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/run-reclaim-stale-only: the scan takes an item-LIST arg and transitions via applyTransition (no single-node assumption)",
    async run() {
      const source = stripComments(await readFile(RUN_STORE, "utf8"));
      // the signature takes a LIST argument named `items` (not a single item / dir)
      assert.ok(
        /function\s+reclaimStaleRuns\s*\(\s*items\b/.test(source),
        "reclaimStaleRuns takes an item-LIST argument (items) — the 26 → 20 path-walk seam"
      );
      // it iterates the supplied items and force-fails through the ONE reclaim edge —
      // m42 wave (d) leg d4 (port 2) named that edge `reclaimRun` so the control
      // tick could stop keeping its own copy of it; `reclaimRun` is itself the legal
      // 19/ADR-001 applyTransition edge, so the invariant is unchanged and followed
      // the shape rather than being weakened.
      const body = functionBody(source, "reclaimStaleRuns");
      assert.ok(body.length > 0, "reclaimStaleRuns is defined");
      assert.ok(/for\s*\(.*\bof\s+items\b/.test(body), "the scan iterates the supplied item list by path");
      assert.ok(/reclaimRun\s*\(/.test(body), "the scan force-fails via the shared reclaimRun edge, not a raw write");
      const edge = functionBody(source, "reclaimRun");
      assert.ok(edge.length > 0, "reclaimRun is defined");
      assert.ok(/applyTransition\s*\(/.test(edge), "reclaimRun IS the legal 19/ADR-001 applyTransition edge");
      assert.ok(/failureReason:\s*["']runtime_offline["']/.test(edge), "…force-failing runtime_offline (retryable per ADR-002)");
      assert.ok(/reclaimedAt:/.test(edge), "…and stamping reclaimedAt");
    },
  },
];
