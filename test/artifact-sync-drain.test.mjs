// milestone 43 / story 03 — task 01: the DRAIN
// (`tasks/01_daemon-drains-queue-into-one-batched-frame.feature`, AC5, ADR-001).
//
// Every scenario drives the REAL worker daemon: `startLauncher` with an injected
// `streamSyncTicker` and a fake transport, firing the production `pushStreamSnapshot`
// (mesh-launcher.mjs). There is no "drain seam" being tested in isolation — the drain,
// the reconciliation read, the content hash and the frame all run exactly as they do
// on a worker, and the CONTROL side answers through the real `work:doc` / `work:tasks`
// commands after the real `applyWorktreeContentFrame` door has admitted the frame.
//
// THE FOUR CHANNELS the contract's litmus allows:
//   (a) the batched frame on the wire (which artifacts, how many frames per tick),
//   (b) the control node's answers through `work doc` / `work tasks`,
//   (c) the control row's own `updatedAt` / `reportedBy` (a row NOT re-sent is
//       observable as a stamp that did not move),
//   (d) `aof mesh logs --node <worker> --json`, run for REAL against the control's
//       node_logs ring. The fixture forwards each launcher warning through the exact
//       mapping `mesh serve` uses (commands/mesh-serve.mjs:58-65) and lands it with the
//       control's own `applyLogEntriesFrame`, so a degrade assertion is made on the
//       channel the contract names rather than one hop short of it.
//
// The `@uat` scenario at the foot of the feature (an operator reading a live remote
// agent's freshly authored features mid-run) is a human gate at the milestone verify
// and is NOT attempted here.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { withArtifactSyncFixture, writeArtifact, enqueueLine, WORKER_ID, ITEM_REF, ASSIGNMENT_WORKSPACE_ID } from "./support/artifact-sync-fixture.mjs";
import { artifactSyncBatchPath, drainArtifactQueue } from "../src/artifact-sync.mjs";
import { readWorkspaceContentRecords } from "../src/work-content-read.mjs";
import { buildWorktreeContentFrame } from "../src/worker-stream-client.mjs";
import { loadWorkspace } from "../src/work.mjs";

// prime(fx) — the Background's "a control node that already holds this item's
// PREVIOUSLY STREAMED artifact rows". One real tick delivers everything the worktree
// holds; from then on only what CHANGES rides the wire, which is the state every
// scenario below starts from.
async function prime(fx) {
  await fx.tick();
  await fx.deliver();
}

function docsOf(frame) {
  return (frame?.docs ?? []).map((doc) => doc.doc).sort();
}

export const artifactSyncDrainTests = [
  {
    // HEADLINE (AC5 as superseded by ADR-013/C8) — one tick, one frame of only what
    // CHANGED, plus the one thing only the queue could know.
    //
    // THE ORIGINAL FORM OF THIS SCENARIO WAS VACUOUS, measured by QA: with the worktree
    // and the writes held constant, the frame was byte-identical whether the queue held
    // the right names, the wrong names, nothing, or did not exist — because the wire is
    // decided by the content hash and the queue feeds only the reporting channels. The
    // replacement asserts on a channel the backstop CANNOT reproduce: a re-scan sees
    // only that a file is absent, never that an agent had just written it.
    name: "artifact-sync/01 one tick drains the queue, sends one frame of only what changed, and reports what only the queue could know",
    run: async () => withArtifactSyncFixture(async (fx) => {
      const story = await writeArtifact(fx.itemDir, "STORY.md", "the body the agent wrote before deleting it\n");
      await prime(fx);
      const before = fx.contentFrames().length;

      const featureA = await writeArtifact(fx.itemDir, "tasks/00_a.feature", "@executable\nFeature: a\n  Scenario: one\n");
      const featureB = await writeArtifact(fx.itemDir, "tasks/01_b.feature", "@executable\nFeature: b\n  Scenario: two\n");
      await fx.enqueue([enqueueLine("Write", story), enqueueLine("Write", featureA), enqueueLine("Write", featureB)]);
      // …and STORY.md is deleted since the line naming it was written.
      await rm(story, { force: true });

      await fx.tick();
      const frames = fx.contentFrames().slice(before);
      assert.equal(frames.length, 1, "exactly ONE artifact frame is sent for the item in that tick");
      assert.deepEqual(docsOf(frames[0]), ["TASKS/00_a.feature", "TASKS/01_b.feature"], "the frame carries bodies for exactly the two feature files");
      assert.equal(frames[0].itemRef, ITEM_REF);
      assert.equal(frames[0].docs.some((doc) => doc.doc === "STORY"), false, "no body for an artifact whose bytes did not change (and none for the deleted one)");

      await fx.deliver();
      // THE CHANNEL ONLY THE QUEUE CAN FEED: `aof mesh logs --node <worker> --json`.
      const logs = await fx.meshLogs();
      const missing = logs.entries.filter((entry) => entry.code === "artifact-sync-artifact-missing");
      assert.equal(missing.length, 1, "exactly one coded artifact-sync-artifact-missing degrade");
      assert.match(missing[0].message, /STORY/, "…naming STORY — which no re-scan could produce");

      // …and the consumed batch is gone, so a subsequent tick re-offers none of the lines.
      assert.equal(existsSync(artifactSyncBatchPath(fx.worktree)), false, "the consumed batch file no longer exists");
      const after = fx.contentFrames().length;
      const logsBefore = (await fx.meshLogs()).count;
      await fx.tick();
      await fx.deliver();
      assert.equal(fx.contentFrames().length, after, "a subsequent tick re-offers none of the three lines");
      assert.equal((await fx.meshLogs()).count, logsBefore, "…and re-reports none of them either");

      const tasks = await fx.tasks(ITEM_REF);
      assert.deepEqual(tasks.tasks.map((task) => task.file), ["00_a.feature", "01_b.feature"], "`work tasks 43/03 --json` lists both feature files");
    }),
  },
  {
    // DE-DUPLICATION BY PATH (AC5). The separator row is not academic: the Windows
    // control node and the WSL worker spell the same path differently, and a
    // de-duplication keyed on raw bytes would send the same file twice.
    name: "artifact-sync/01 the batch carries one body per distinct artifact, whatever the queue held",
    run: async () => withArtifactSyncFixture(async (fx) => {
      const rows = [
        {
          name: "one line for STORY.md",
          setup: async () => {
            const p = await writeArtifact(fx.itemDir, "STORY.md", "story v2\n");
            await fx.enqueue([enqueueLine("Write", p)]);
          },
          bodies: ["STORY"],
        },
        {
          name: "five lines for STORY.md (edited five times in one tick window)",
          setup: async () => {
            let p = null;
            for (let i = 0; i < 5; i += 1) p = await writeArtifact(fx.itemDir, "STORY.md", `story v${i + 3}\n`);
            await fx.enqueue(Array.from({ length: 5 }, () => enqueueLine("Edit", p)));
          },
          bodies: ["STORY"],
          // …and the body carried is the file's CURRENT content, never a replay of an
          // intermediate state.
          currentIs: { doc: "STORY", body: "story v7\n" },
        },
        {
          name: "three lines for STORY.md and two for STATE.md",
          setup: async () => {
            const story = await writeArtifact(fx.itemDir, "STORY.md", "story v8\n");
            const state = await writeArtifact(fx.itemDir, "STATE.md", "state v1\n");
            await fx.enqueue([enqueueLine("Write", story), enqueueLine("Edit", story), enqueueLine("Edit", story), enqueueLine("Write", state), enqueueLine("Edit", state)]);
          },
          bodies: ["STATE", "STORY"],
        },
        {
          name: "two lines for the same file spelled with / and with \\",
          setup: async () => {
            const p = await writeArtifact(fx.itemDir, "STORY.md", "story v9\n");
            const slash = p.replaceAll("\\", "/");
            const back = p.replaceAll("/", "\\");
            assert.notEqual(slash, back, "the two spellings are genuinely different strings (non-vacuous)");
            await fx.enqueue([enqueueLine("Write", slash), enqueueLine("Write", back)]);
          },
          bodies: ["STORY"],
          // THE BODY COUNT ALONE CANNOT PROVE THIS ROW, and saying so is the point: the
          // drain names ARTIFACTS and the content read is per-artifact, so a duplicate
          // name could not produce a duplicate body even with the normalisation removed
          // (measured — this row stayed green against a planted defect). The observable
          // that genuinely moves is the NAMED set, which reaches an operator through the
          // coded degrade channel; it is asserted directly here, on the same two lines
          // the row describes.
          named: async () => {
            const p = path.join(fx.itemDir, "STORY.md");
            const items = [{ ref: ITEM_REF, dir: fx.itemDir }];
            const entries = [{ tool: "Write", path: p.replaceAll("\\", "/") }, { tool: "Write", path: p.replaceAll("/", "\\") }];
            const { resolveDrainedArtifacts } = await import("../src/artifact-sync.mjs");
            const resolved = resolveDrainedArtifacts(entries, { items });
            assert.deepEqual(resolved.named.map((entry) => entry.docKey), ["STORY"], "the same file is named ONCE despite the two path separators");
          },
        },
        {
          name: "two lines for STORY.md, the file deleted before the tick ran",
          setup: async () => {
            const p = path.join(fx.itemDir, "STORY.md");
            await fx.enqueue([enqueueLine("Write", p), enqueueLine("Edit", p)]);
            await rm(p, { force: true });
          },
          bodies: [],
          // the deletion is REPORTED, never sent as an empty body
          warns: "artifact-sync-artifact-missing",
        },
        {
          name: "one line naming a file outside the item's artifact manifest",
          setup: async () => {
            const p = await writeArtifact(fx.itemDir, "notes.md", "not in the manifest\n");
            await fx.enqueue([enqueueLine("Write", p)]);
          },
          bodies: [],
        },
      ];

      await prime(fx);
      for (const row of rows) {
        const beforeFrames = fx.contentFrames().length;
        const beforeWarnings = fx.warnings().length;
        await row.setup();
        await fx.tick();
        await fx.deliver();
        const frames = fx.contentFrames().slice(beforeFrames);
        const carried = frames.flatMap((frame) => frame.docs.map((doc) => doc.doc)).sort();
        assert.deepEqual(carried, row.bodies, `${row.name}: the frame carries ${row.bodies.length} artifact body/bodies`);
        if (row.currentIs != null) {
          const sent = frames.flatMap((frame) => frame.docs).find((doc) => doc.doc === row.currentIs.doc);
          assert.equal(sent.body, row.currentIs.body, `${row.name}: the body is the file's CURRENT content at the moment of the drain`);
        }
        if (row.named != null) await row.named();
        if (row.warns != null) {
          const fresh = fx.warnings().slice(beforeWarnings);
          assert.ok(fresh.some((warning) => warning.code === row.warns), `${row.name}: the outcome is reported as ${row.warns}`);
          const doc = await fx.doc(ITEM_REF, "STORY");
          assert.notEqual(doc.body, "", `${row.name}: the last streamed body still answers — never overwritten with an empty one`);
        }
      }
    }),
  },
  {
    // ONLY WHAT CHANGED RIDES THE WIRE (AC5 as superseded by ADR-013/C8), asserted in
    // the direction that can FAIL. The previous form claimed the unnamed artifacts were
    // "not read" and was vacuous — the outcome was byte-identical whether the queue
    // named DESIGN, named all fourteen, or was empty. Restated: an UNCHANGED artifact
    // does not ride EVEN WHEN THE QUEUE NAMES IT, and a CHANGED one rides EVEN WHEN IT
    // DOES NOT — which is precisely why a `Bash`-written file and a hookless codex
    // worker still converge on the very next tick.
    name: "artifact-sync/01 an unchanged artifact does not ride and its control-side row does not move, whatever the queue named",
    run: async () => withArtifactSyncFixture(async (fx) => {
      for (const file of ["SPEC.md", "STORY.md", "VERIFICATION.md", "RETROSPECTIVE.md", "ARCHITECTURE.md", "DESIGN.md", "RESEARCH.md", "STATE.md"]) {
        await writeArtifact(fx.itemDir, file, `${file} v1\n`);
      }
      for (let i = 0; i < 6; i += 1) {
        await writeArtifact(fx.itemDir, `tasks/0${i}_t.feature`, `@executable\nFeature: t${i}\n  Scenario: s\n`);
      }
      await prime(fx);
      const before = fx.stamps(ITEM_REF);
      assert.equal(Object.keys(before).length, 14, "the control holds all fourteen artifacts (8 record docs + 6 features)");

      // The queue names DESIGN.md, whose bytes are UNCHANGED; STATE.md is edited on
      // disk and named by nothing.
      await fx.enqueue([enqueueLine("Edit", path.join(fx.itemDir, "DESIGN.md"))]);
      await writeArtifact(fx.itemDir, "STATE.md", "STATE.md v2 — edited, and named by nothing\n");
      const beforeFrames = fx.contentFrames().length;
      await fx.tick();
      await fx.deliver();

      const frames = fx.contentFrames().slice(beforeFrames);
      assert.deepEqual(frames.flatMap((frame) => frame.docs.map((doc) => doc.doc)), ["STATE"], "the frame carries exactly one artifact body, for STATE");
      const after = fx.stamps(ITEM_REF);
      assert.notEqual(after.STATE.updatedAt, before.STATE.updatedAt, "the STATE row carries a NEW updatedAt");
      assert.equal(after.STATE.reportedBy, WORKER_ID, "…and this worker as reportedBy");
      assert.equal(after.DESIGN.updatedAt, before.DESIGN.updatedAt, "the DESIGN row carries the updatedAt it had before the tick, THOUGH THE QUEUE NAMED IT");
      for (const key of Object.keys(before)) {
        if (key === "STATE") continue;
        assert.equal(after[key].updatedAt, before[key].updatedAt, `${key} keeps the updatedAt it had before the tick`);
        assert.equal(after[key].body, before[key].body, `${key}'s body is byte-identical to before the tick`);
      }
      assert.equal(Object.keys(after).length - 2, 12, "the other twelve artifacts are all accounted for");
    }),
  },
  {
    // LOSS-AVERSION IS BEHAVIOURAL AND MUST BE PROVEN (AC5). Rename-then-read is the
    // mechanism; the CONTRACT is that an interruption at any point RE-SENDS rather than
    // loses. Each row leaves the world in the state a kill at that point would leave it
    // (the real drain / the real read / the real frame builder + door), then runs the
    // real tick.
    name: "artifact-sync/01 a drain interrupted at any point re-sends on the next tick and loses nothing",
    run: async () => {
      const rows = [
        { name: "after the batch is consumed, before any file read", upTo: "consumed" },
        { name: "after the files are read, before the frame is sent", upTo: "read" },
        { name: "after the frame is sent, before the batch is discarded", upTo: "sent" },
        { name: "while the hook is appending, leaving a torn final line", upTo: "torn" },
      ];
      for (const row of rows) {
        await withArtifactSyncFixture(async (fx) => {
          const story = await writeArtifact(fx.itemDir, "STORY.md", "story body\n");
          const architecture = await writeArtifact(fx.itemDir, "ARCHITECTURE.md", "architecture body\n");
          const feature = await writeArtifact(fx.itemDir, "tasks/00_a.feature", "@executable\nFeature: a\n  Scenario: one\n");
          // The batch also carries a DEGRADE line. It is what makes the re-send claim
          // falsifiable at all: the three artifact bodies would converge on the
          // reconciliation backstop even if the interrupted batch were dropped, but a
          // coded `unresolved-path` line exists ONLY in the queue — lose the batch and
          // the operator never hears about it.
          await fx.enqueue([enqueueLine("Write", story), JSON.stringify({ tool: "NotebookEdit", code: "unresolved-path" }), enqueueLine("Write", architecture), enqueueLine("Write", feature)]);
          if (row.upTo === "torn") await fx.enqueueRaw('{"tool":"Write","path":"');

          // The control holds NONE of the three bodies yet.
          assert.equal(fx.stamp(ITEM_REF, "STORY"), null, `${row.name}: nothing streamed yet (non-vacuous)`);

          // …the crash, at the named point.
          if (row.upTo !== "torn") {
            const drained = await drainArtifactQueue(fx.worktree);
            assert.ok(drained.entries.length >= 3, `${row.name}: the batch was genuinely consumed`);
            if (row.upTo === "read" || row.upTo === "sent") {
              const worktreeWs = await loadWorkspace(fx.worktree, undefined, { env: fx.env });
              const content = await readWorkspaceContentRecords(worktreeWs, { itemRef: ITEM_REF });
              if (row.upTo === "sent") {
                // The REAL frame builder through the REAL control door — then the
                // process dies before the batch is discarded.
                const frame = buildWorktreeContentFrame(WORKER_ID, ASSIGNMENT_WORKSPACE_ID, { itemRef: ITEM_REF, docs: content.docs, runs: content.runs }, "2026-08-02T12:00:00.000Z");
                await fx.applyFrame(frame);
                assert.notEqual(fx.stamp(ITEM_REF, "STORY"), null, `${row.name}: the pre-crash send genuinely landed`);
              }
            }
          }

          const beforeFrames = fx.contentFrames().length;
          const beforeWarnings = fx.warnings().length;
          const firstSend = fx.stamp(ITEM_REF, "STORY");
          await fx.tick();
          await fx.deliver();

          assert.ok(
            fx.warnings().slice(beforeWarnings).some((warning) => warning.code === "artifact-sync-unresolved-path"),
            `${row.name}: the interrupted batch's degrade line is re-offered and reported — the batch was re-sent, not lost`,
          );

          for (const [ref, docKey, body] of [[ITEM_REF, "STORY", "story body\n"], [ITEM_REF, "ARCHITECTURE", "architecture body\n"], [ITEM_REF, "TASKS/00_a.feature", "@executable\nFeature: a\n  Scenario: one\n"]]) {
            const stamp = fx.stamp(ref, docKey);
            assert.notEqual(stamp, null, `${row.name}: ${docKey} is on the control node — no artifact named in the queue is missing`);
            assert.equal(stamp.body, body, `${row.name}: ${docKey} holds the CURRENT body`);
          }
          const carried = fx.contentFrames().slice(beforeFrames).flatMap((frame) => frame.docs.map((doc) => doc.doc));
          for (const docKey of ["ARCHITECTURE", "STORY", "TASKS/00_a.feature"]) {
            assert.ok(carried.includes(docKey), `${row.name}: ${docKey} is (re-)sent in the next tick's frame`);
          }
          if (row.upTo === "sent") {
            assert.equal(fx.stamp(ITEM_REF, "STORY").body, firstSend.body, `${row.name}: the control-side row is unchanged by the repeat`);
            assert.equal(Object.keys(fx.stamps(ITEM_REF)).filter((key) => key === "STORY").length, 1, `${row.name}: exactly one row per artifact`);
          }
          if (row.upTo === "torn") {
            assert.ok(fx.warnings().some((warning) => warning.code === "artifact-sync-torn-line"), `${row.name}: the torn line is reported as a coded degrade, never silently dropped`);
          }
        });
      }
    },
  },
  {
    // IDEMPOTENCE. Draining the SAME consumed batch a second time leaves the control
    // node in the same state — no duplicate rows, no duplicate bodies, no growth.
    name: "artifact-sync/01 re-draining an already-sent batch leaves the control node's state unchanged",
    run: async () => withArtifactSyncFixture(async (fx) => {
      const story = await writeArtifact(fx.itemDir, "STORY.md", "story once\n");
      const state = await writeArtifact(fx.itemDir, "STATE.md", "state once\n");
      await fx.enqueue([enqueueLine("Write", story), enqueueLine("Write", state)]);
      await fx.tick();
      await fx.deliver();
      const first = fx.stamps(ITEM_REF);
      const sentFrame = fx.contentFrames().at(-1);
      assert.ok(sentFrame.docs.length >= 2, "the first send genuinely carried the batch (non-vacuous)");

      // THE SAME BATCH, SENT A SECOND TIME — a real duplicate delivery, not a second
      // tick. Re-enqueuing would prove nothing: the content hash suppresses the second
      // send, so every Then would hold trivially (QA's F-3). A redelivery is what a
      // reconnect really does — the client re-sends by construction — so the identical
      // frame goes through the control's own door again.
      await fx.applyFrame(sentFrame);
      const second = fx.stamps(ITEM_REF);

      assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort(), "exactly one row per artifact — no duplicates, no growth");
      for (const key of Object.keys(first)) {
        assert.equal(second[key].body, first[key].body, `${key}'s body is byte-identical to what the first send delivered`);
      }
      const doc = await fx.doc(ITEM_REF, "STORY");
      assert.equal(doc.body, "story once\n", "`work doc 43/03 STORY` returns exactly one body, not a concatenation");
    }),
  },
  {
    // THE CODED DEGRADE (AC3's other half). An `unresolved-path` line reaches the drain
    // and the drain REPORTS it — silence here would restore the exact failure mode the
    // trigger exists to remove — and the well-formed artifacts in the same batch still
    // arrive, so one degraded line can never cost a whole tick.
    name: "artifact-sync/01 an unresolved-path line is reported as a coded degrade and does not cost the rest of the batch",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await prime(fx);
      await fx.deliver();
      assert.equal((await fx.meshLogs()).entries.filter((entry) => entry.code === "artifact-sync-unresolved-path").length, 0, "no such entry before the line arrives (non-vacuous)");

      const story = await writeArtifact(fx.itemDir, "STORY.md", "story with a degraded sibling\n");
      await fx.enqueue([JSON.stringify({ tool: "NotebookEdit", code: "unresolved-path" }), enqueueLine("Write", story)]);
      await fx.tick();
      await fx.deliver();

      const doc = await fx.doc(ITEM_REF, "STORY");
      assert.equal(doc.body, "story with a degraded sibling\n", "the control holds the current STORY.md body");
      // THE CHANNEL THE `Then` NAMES, not one hop short of it: `aof mesh logs --node
      // <worker> --json`, read through the real command against the control's node_logs
      // ring — where `mesh serve` forwards every launcher warning.
      const logs = await fx.meshLogs();
      const coded = logs.entries.filter((entry) => entry.code === "artifact-sync-unresolved-path");
      assert.equal(coded.length, 1, "a coded warning naming unresolved-path");
      assert.match(coded[0].message, /unresolved-path/);
      assert.equal(logs.node, WORKER_ID, "…attributed to the worker that reported it");

      // The tick completed and the next tick runs on schedule.
      const framesBefore = fx.contentFrames().length;
      await fx.tick();
      assert.ok(fx.contentFrames().length >= framesBefore, "the next tick ran");
    }),
  },
  {
    // THE DEGRADE CHANNEL IS SELF-LIMITING (QA F-5). Measured before the fix: ONE
    // enqueued `unresolved-path` line produced TEN copies over ten ticks with the
    // transport down, because an undelivered batch is re-drained every tick. This is
    // the class this repo has already paid for once — the Mac's remote log ring held
    // 259 copies of one code, drowning every other line — so a degrade is reported once
    // per BATCH, and the signature set is cleared only when the batch is confirmed away.
    name: "artifact-sync/01 a degrade is reported once per batch, not once per tick, even while the transport is down",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await prime(fx);
      await fx.deliver();
      fx.transport.setDown(true);
      await writeArtifact(fx.itemDir, "STORY.md", "a body that cannot be delivered yet\n");
      await fx.enqueue([JSON.stringify({ tool: "NotebookEdit", code: "unresolved-path" })]);

      for (let i = 0; i < 10; i += 1) await fx.tick();
      fx.transport.setDown(false);
      await fx.deliver();

      const coded = (await fx.meshLogs()).entries.filter((entry) => entry.code === "artifact-sync-unresolved-path");
      assert.equal(coded.length, 1, "exactly ONE copy after ten ticks — not one per tick");

      // …and a genuinely NEW occurrence still reports once the batch is confirmed: the
      // throttle is per batch, never a mute.
      await fx.tick();
      await fx.deliver();
      await fx.enqueue([JSON.stringify({ tool: "Write", code: "unresolved-path" })]);
      await fx.tick();
      await fx.deliver();
      const after = (await fx.meshLogs()).entries.filter((entry) => entry.code === "artifact-sync-unresolved-path");
      assert.equal(after.length, 2, "a new occurrence in a new batch is reported");
    }),
  },
  {
    // AN UNATTRIBUTABLE PATH IS A CODED DEGRADE, NOT A SILENT DROP (QA F-6). The hook is
    // CONTRACTUALLY required to carry the payload's path verbatim, so the drain owns
    // every spelling that arrives: a relative path, a lower-cased drive letter, a
    // case-different segment — all the same file on Windows and three different strings
    // here. Dropping them silently is how an artifact stops being streamed with nobody
    // learning why. The report is bounded by the MANIFEST — a path that NAMES an
    // artifact is reported, `src/foo.mjs` is not — so the channel cannot become spam.
    name: "artifact-sync/01 a path that names an artifact but cannot be attributed is reported, coded — and an ordinary source file is not",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await prime(fx);
      await fx.deliver();
      const itemDir = fx.itemDir.replaceAll("\\", "/");
      const spellings = [
        { name: "a relative path the hook carried verbatim", value: "./wiki/work/43_milestone_mesh-artifact-authority/stories/03_story_artifact-sync/STORY.md" },
        { name: "a lower-cased drive letter", value: `${itemDir.replace(/^([A-Za-z]):/, (all, letter) => `${letter.toLowerCase()}:`)}/STORY.md` },
        { name: "a case-different segment", value: `${itemDir.replace("/stories/", "/STORIES/")}/STORY.md` },
      ];
      await fx.enqueue([
        ...spellings.map((spelling) => enqueueLine("Write", spelling.value)),
        // …and an ordinary source file, which must stay silent.
        enqueueLine("Write", `${fx.worktree.replaceAll("\\", "/")}/src/some-module.mjs`),
      ]);
      await fx.tick();
      await fx.deliver();

      const coded = (await fx.meshLogs()).entries.filter((entry) => entry.code === "artifact-sync-unattributable-path");
      assert.equal(coded.length, spellings.length, "every unattributable spelling is reported exactly once");
      for (const spelling of spellings) {
        assert.ok(coded.some((entry) => entry.message.includes(spelling.value)), `${spelling.name} is named in the report`);
      }
      assert.equal(coded.some((entry) => entry.message.includes("some-module.mjs")), false, "an ordinary source file is NOT reported — the manifest bounds the channel");
    }),
  },
  {
    // ONE LOOP DOES BOTH JOBS (AC5 / STATE): the reconciliation backstop is retained,
    // so a file the hook does not cover — anything written by `Bash`, deliberately
    // outside the matcher — still converges.
    name: "artifact-sync/01 an artifact written outside the hook's matcher still converges on the reconciliation backstop",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await prime(fx);
      const before = fx.frames().length;
      // The agent writes RESEARCH.md through a `Bash` command: no hook fires, so NO
      // line is enqueued at all.
      await writeArtifact(fx.itemDir, "RESEARCH.md", "written by bash, never named by the hook\n");
      assert.equal(await readFile(fx.queuePath, "utf8").catch(() => ""), "", "the queue is empty — the matcher does not cover Bash");

      await fx.tick();
      await fx.deliver();
      const doc = await fx.doc(ITEM_REF, "RESEARCH");
      assert.equal(doc.body, "written by bash, never named by the hook\n", "the control answers `work doc 43/03 RESEARCH` with the new body");

      // …and it was delivered over the connection that already exists: the fake
      // transport is the ONLY socket in this fixture, and no second one was opened.
      assert.ok(fx.frames().length > before, "the body rode the existing stream connection");
    }),
  },
  {
    // THE DRAIN RIDES THE EXISTING TICK — no new timer, no new transport. A worker with
    // no live transport enqueues without ever draining, and loses nothing when the
    // transport returns.
    name: "artifact-sync/01 the batch rides the existing stream connection and survives a disconnected window",
    run: async () => withArtifactSyncFixture(async (fx) => {
      await prime(fx);
      const before = fx.contentFrames().length;
      fx.transport.setDown(true);

      const story = await writeArtifact(fx.itemDir, "STORY.md", "written while the transport was down\n");
      const state = await writeArtifact(fx.itemDir, "STATE.md", "state written while down\n");
      await fx.enqueue([enqueueLine("Write", story), enqueueLine("Write", state)]);
      await fx.tick();
      await fx.tick();
      assert.equal(fx.contentFrames().length, before, "two ticks with no transport send nothing");
      assert.equal(fx.stamp(ITEM_REF, "STATE"), null, "nothing reached the control node");
      // …and NOTHING WAS DISCARDED. The batch the two ticks consumed is still on disk,
      // holding both lines: an undelivered batch is never confirmed away. (Asserted on
      // the queue's own bytes, because the artifact bodies alone cannot show it — the
      // reconciliation backstop would re-read them regardless, which is exactly how a
      // "nothing is discarded" assertion becomes worthless if it is only made through
      // the frame.)
      const batch = await readFile(artifactSyncBatchPath(fx.worktree), "utf8");
      assert.equal(batch.split("\n").filter((line) => line.trim().length > 0).length, 2, "both queued lines survive the disconnected window");

      fx.transport.setDown(false);
      await fx.tick();
      await fx.deliver();
      const frames = fx.contentFrames().slice(before);
      assert.equal(frames.length, 1, "both artifacts arrive in ONE batched frame when the transport returns");
      assert.deepEqual(docsOf(frames[0]), ["STATE", "STORY"], "nothing was discarded while the transport was down");
      assert.equal((await fx.doc(ITEM_REF, "STATE")).body, "state written while down\n");
    }),
  },
];
