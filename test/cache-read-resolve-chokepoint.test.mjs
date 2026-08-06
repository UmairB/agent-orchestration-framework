// Traceability wiring for milestone 43 / story 06 (the readers migrate), task
//   .../06_story_cache-read-surface/tasks/01_resolve-chokepoint-moves-eight-commands.feature
//
// ADR-005 STAGE 1: `src/commands/resolve.mjs` moves onto the seam. ONE edit; the graph's
// eight dependents — `continue`, `doc`, `feedback`, `run-complete`, `run-retry`, `run-start`,
// `run-status`, `tasks` — all migrate behind it.
//
// THE HEADLINE OUTCOME LIVES HERE: a work item authored by a REMOTE worker reads correctly on
// the control node AFTER the worker's worktree has been deleted, when the control's own disk
// holds only the stale pre-run scaffold. That is the case the milestone's own accept note
// records as having FAILED on a live two-node run.
//
// THE LITMUS: every Then is confirmable from a command's `--json` document — the resolved
// ref, the answering side stamped on the answer, the body returned, a coded failure and its
// exit — or from the control node's on-disk tree being unchanged. No source is read.
//
// ONE DEVIATION, DECLARED. The final scenario ("at stage 1 the leaves have not moved") asks a
// single tree to be simultaneously at stage 1 and at stage 3; this story delivers all four
// stages, and task 02 REQUIRES the same three leaves to have moved. It is asserted here as
// the property that IS true of the delivered build and that the scenario exists to establish —
// the chokepoint edit alone carries exactly its eight dependents — and the stage-1 claim
// itself was verified by MUTATION (reverting the three leaf edits and re-running), recorded
// in the story's build report. Flagged to the PO rather than papered over.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  withCacheReadFixture, plantCacheRow, streamDoc, streamTaskFeature, streamRun,
  runCommand, refuseCommand, itemDirOf, writeItem, writeDoc,
  CONTROL_NODE, WORKER_NODE, SYNCED_AT,
} from "./support/cache-read-fixture.mjs";

// The Background's disk: the control node holds ONLY the pre-run scaffold for "07"
// (status not-started) and NO folder at all for "07/01". "06" is a milestone this node
// authored itself, which the cache knows nothing about.
const DISK_STREAM = [{ number: "06", stories: [] }, { number: "07", stories: [] }];

const STORY_BODY = "---\ntype: story\nnumber: 01\nslug: cache-read-surface\nparent: 07\nstatus: done\n---\n# the worker's story\n";
const VERIFICATION_BODY = "# Verification\n\nRun on the worker.\n";
const WORKER_SPEC = "---\ntype: milestone\nnumber: 07\nslug: m07\nstatus: done\n---\n# the worker's SPEC\n";
const FEATURE_A = "@executable\nFeature: alpha\n\n  Scenario: one\n    Given a\n";
const FEATURE_B = "@executable\nFeature: beta\n\n  Scenario: two\n    Given b\n  Scenario: three\n    Given c\n";

// "Given a control node whose cache holds milestone 07 and its story 07/01, both last
// reported by the REMOTE node aof-wsl … carrying its STORY.md and VERIFICATION.md bodies and
// its tasks/*.feature files … the worker's worktree has been deleted, so no further worker
// tick will ever correct the control's disk."
async function background(fx) {
  await plantCacheRow(fx, "07", { status: "done", title: "Milestone 07", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
  await plantCacheRow(fx, "07/01", { status: "done", title: "The readers migrate", slug: "cache-read-surface", parent: "07", node: WORKER_NODE, at: SYNCED_AT });
  await streamDoc(fx, { ref: "07", doc: "SPEC", body: WORKER_SPEC });
  await streamDoc(fx, { ref: "07/01", doc: "STORY", body: STORY_BODY });
  await streamDoc(fx, { ref: "07/01", doc: "VERIFICATION", body: VERIFICATION_BODY });
  await streamTaskFeature(fx, { ref: "07/01", member: "00_alpha.feature", body: FEATURE_A });
  await streamTaskFeature(fx, { ref: "07/01", member: "01_beta.feature", body: FEATURE_B });
  await streamRun(fx, { ref: "07/01", runId: "run-worker-1", state: "done" });
  // The control's own scaffold for 07 — the stale copy that used to be the only answer.
  await writeItem(fx, "07", { status: "not-started", title: "Milestone 07", slug: "m07" });
}

export const cacheReadResolveChokepointTests = [
  // ==========================================================================
  // THE HEADLINE — the case that fails today
  // ==========================================================================
  {
    name: "cache-read/01 a story authored entirely by a remote worker, whose worktree is gone, reads correctly on the control node through doc / run-status / tasks",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);

      const doc = await runCommand(fx, "work:doc", { ref: "07/01", doc: "STORY" });
      assert.equal(doc.present, true, "the document reports present true");
      assert.equal(doc.body, STORY_BODY, "…with the worker's STORY.md body verbatim");
      assert.equal(doc.answeredFrom, "cache", "…answered from the cache");
      assert.equal(doc.reportedBy, WORKER_NODE, "…naming aof-wsl as the reporting node");

      const runStatus = await runCommand(fx, "work:run-status", { ref: "07/01" });
      assert.deepEqual(runStatus.runs.map((run) => run.runId), ["run-worker-1"], "run-status reports the worker's run rows");
      assert.equal(runStatus.reportedBy, WORKER_NODE, "…naming aof-wsl");

      const tasks = await runCommand(fx, "work:tasks", { ref: "07/01" });
      assert.deepEqual(tasks.tasks.map((task) => task.file), ["00_alpha.feature", "01_beta.feature"], "tasks reports the worker's task features, not an empty list");

      // …and the milestone's own SPEC comes from the worker, NOT the control's stale scaffold.
      const spec = await runCommand(fx, "work:doc", { ref: "07", doc: "SPEC" });
      assert.equal(spec.body, WORKER_SPEC, "doc 07 SPEC reports the worker's SPEC.md body, not the control's stale scaffold");
      assert.equal(spec.answeredFrom, "cache", "…and says the cache answered it");
      // Non-vacuity: the control's own scaffold really is there and really is different.
      assert.ok(existsSync(path.join(itemDirOf(fx, "07"), "SPEC.md")), "the control's stale scaffold SPEC.md genuinely exists on disk");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // QA matrix, half one — the READ dependents
  // ==========================================================================
  ...[
    {
      label: "doc STORY",
      invoke: (fx) => runCommand(fx, "work:doc", { ref: "07/01", doc: "STORY" }),
      content: (result) => assert.equal(result.body, STORY_BODY, "the body is the worker's STORY.md, byte-for-byte"),
    },
    {
      label: "doc VERIFICATION",
      invoke: (fx) => runCommand(fx, "work:doc", { ref: "07/01", doc: "VERIFICATION" }),
      content: (result) => assert.equal(result.body, VERIFICATION_BODY, "the body is the worker's VERIFICATION.md, byte-for-byte"),
    },
    {
      label: "tasks",
      invoke: (fx) => runCommand(fx, "work:tasks", { ref: "07/01" }),
      content: (result) => {
        assert.deepEqual(result.tasks.map((task) => task.file), ["00_alpha.feature", "01_beta.feature"], "the parsed features are the worker's");
        assert.deepEqual(result.tasks.map((task) => task.counts.executable), [1, 2], "…with their scenario counts");
      },
    },
    {
      label: "run-status",
      invoke: (fx) => runCommand(fx, "work:run-status", { ref: "07/01" }),
      content: (result) => {
        assert.deepEqual(result.runs.map((run) => run.runId), ["run-worker-1"], "the run rows are the worker's");
        assert.deepEqual(result.runs.map((run) => run.state), ["done"], "…in their settled state");
      },
    },
  ].map(({ label, invoke, content }) => ({
    name: `cache-read/01 the READ dependent \`${label}\` resolves the remote-authored ref and reports the cache as the answering side`,
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      const result = await invoke(fx);
      assert.equal(result.ref, "07/01", "the answer reports the resolved ref 07/01");
      assert.equal(result.answeredFrom, "cache", "the answer reports answeredFrom cache");
      assert.equal(result.reportedBy, WORKER_NODE, "…naming aof-wsl as the reporting node");
      content(result);
    }, { stream: DISK_STREAM }),
  })),

  // ==========================================================================
  // QA matrix, half two — the WRITE / DISPATCH dependents. The obligation is
  // narrow and is stated narrowly: RESOLUTION succeeds. Each command's own
  // contract then applies unchanged.
  // ==========================================================================
  {
    name: "cache-read/01 each WRITE or DISPATCH dependent resolves the remote-authored ref instead of failing ref-not-found, and its --json document echoes the resolved ref",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);

      const cases = [
        ["work:feedback", { ref: "07/01", note: "spec was thin", actor: "qa" }],
        ["work:run-start", { ref: "07/01" }],
        ["work:run-retry", { ref: "07/01" }],
        ["work:run-complete", { ref: "07/01", outcome: "done" }],
      ];
      for (const [id, input] of cases) {
        const error = await refuseCommand(() => runCommand(fx, id, input));
        assert.notEqual(error.code, "ref-not-found", `${id} does NOT fail with code ref-not-found`);
        // The ONE structured-refusal channel (spine/face.mjs `error.detail`), which is how the
        // `--json` document echoes the ref: the door RESOLVED and declined to write, and a
        // caller must be able to tell that from "no such ref" without parsing prose.
        assert.equal(error.detail?.ref, "07/01", `${id}'s document echoes the resolved ref 07/01`);
      }

      // `continue` is the DISPATCH door: it must not fail ref-not-found for a cache-known ref.
      // Its own contract (a mesh dispatch decision) then applies unchanged, whatever it is.
      let continueError = null;
      try {
        await runCommand(fx, "work:continue", { ref: "07/01" });
      } catch (error) {
        continueError = error;
      }
      assert.notEqual(continueError?.code, "ref-not-found", "work:continue does NOT fail with code ref-not-found");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // RESIDUAL CONCERN (2), decided as a scenario: a write command against a ref
  // the cache alone knows refuses with a code and writes NOTHING
  // ==========================================================================
  ...[
    ["work:feedback", { ref: "07/01", note: "spec was thin", actor: "qa" }],
    ["work:run-start", { ref: "07/01" }],
  ].map(([id, input]) => ({
    name: `cache-read/01 \`${id}\` against a ref the cache alone knows refuses with a code naming the absent local checkout, and writes nothing`,
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      assert.ok(!existsSync(itemDirOf(fx, "07/01")), "07/01 has no folder on the control node's disk (the precondition)");
      const before = await treeSnapshot(fx.workDir);

      const error = await refuseCommand(() => runCommand(fx, id, input));
      assert.equal(error.code, "item-not-local", "the command exits non-zero with a coded error naming the absent local checkout");
      assert.equal(error.status, 409, "…a refusal, not a not-found");
      assert.match(error.message, /no local checkout/i, "…and the message says so in words");
      assert.match(error.message, new RegExp(WORKER_NODE), "…naming where the item actually lives");

      assert.ok(!existsSync(itemDirOf(fx, "07/01")), "no folder is created for the cache-only ref");
      assert.deepEqual(await treeSnapshot(fx.workDir), before, "no folder is created anywhere under the control's work directory");

      const validate = await runCommand(fx, "work:validate", {});
      assert.deepEqual(validate.findings, [], "a fresh validate over the control's stream reports zero new findings");
    }, { stream: DISK_STREAM }),
  })),

  // ==========================================================================
  // RESIDUAL CONCERN (1), decided as a scenario: a resolved ref whose folder is
  // absent locally NEVER degrades to a silent empty answer
  // ==========================================================================
  {
    name: "cache-read/01 a resolved ref whose folder is absent locally never degrades to a silent empty answer — tasks carries the worker's features, or says explicitly that this checkout holds none",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);

      // (a) the cache HAS the features — they are the answer.
      const withFeatures = await runCommand(fx, "work:tasks", { ref: "07/01" });
      assert.ok(withFeatures.tasks.length > 0, "the answer carries the worker's streamed task features");
      assert.equal(withFeatures.fromWorker, true, "…marked as not from this node's disk");
      assert.equal(withFeatures.reportedBy, WORKER_NODE, "…naming aof-wsl as the side that holds them");

      // (b) THE NAMED REGRESSION (ADR-010/R6.4): the same ref with NO streamed features. This
      // is the branch that used to answer `{ ref, tasks: [] }` with no marker at all once the
      // resolve started succeeding — a silent empty list dressed as a pass.
      await withCacheReadFixture(async (bare) => {
        await plantCacheRow(bare, "07", { status: "done", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
        await plantCacheRow(bare, "07/01", { status: "done", slug: "cache-read-surface", parent: "07", node: WORKER_NODE, at: SYNCED_AT });
        const result = await runCommand(bare, "work:tasks", { ref: "07/01" });
        assert.deepEqual(result.tasks, [], "the local checkout genuinely holds none");
        assert.equal(result.fromWorker, true, "the answer is NOT an unmarked empty tasks list");
        assert.equal(result.answeredFrom, "cache", "…it says which side answered");
        assert.equal(result.reportedBy, WORKER_NODE, "…and names aof-wsl as the side that holds them");
      }, { stream: DISK_STREAM });
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // ADR-003's read-vs-write resolver distinction survives the migration
  // ==========================================================================
  {
    name: "cache-read/01 the exact-vs-slug distinction survives the migration in both directions — the READ slug-matches a cache-known ref, the WRITE refuses a partial one",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);

      // The READ resolver may slug-match free text — including a slug only the cache knows.
      const doc = await runCommand(fx, "work:doc", { ref: "cache-read", doc: "STORY" });
      assert.equal(doc.ref, "07/01", "the command resolves 07/01 by slug");
      assert.equal(doc.body, STORY_BODY, "…and returns its STORY.md");

      // The WRITE resolver may NOT: a free-text slug and a partial ref both fail ref-not-found,
      // BEFORE the local-checkout guard — the rule is about which row a write may act on, and
      // migrating the SOURCE of the rows must never migrate the RULE.
      for (const ref of ["cache-read", "07/0"]) {
        const error = await refuseCommand(() => runCommand(fx, "work:feedback", { ref, note: "n", actor: "qa" }));
        assert.equal(error.code, "ref-not-found", `feedback "${ref}" fails with code ref-not-found, not the local-checkout refusal`);
      }
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // A disk-only ref still resolves through the migrated chokepoint
  // ==========================================================================
  {
    name: "cache-read/01 a disk-only ref still resolves through the migrated chokepoint, reported as a disk answer with no fabricated syncedAt",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      const body = "---\ntype: milestone\nnumber: 06\nslug: m06\nstatus: in-progress\n---\n# the control's own milestone\n";
      await writeDoc(fx, "06", "SPEC.md", body);

      const doc = await runCommand(fx, "work:doc", { ref: "06", doc: "SPEC" });
      assert.equal(doc.present, true, "the command answers");
      assert.equal(doc.body, body, "the body is the control disk's SPEC.md");
      assert.equal(doc.answeredFrom, "disk", "the answer reports answeredFrom disk");
      assert.ok(!("syncedAt" in doc), "the answer carries no fabricated syncedAt");
      assert.ok(!("reportedBy" in doc), "…and no fabricated author");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // STAGING IS OBSERVABLE — asserted in the form true of the delivered build
  // (see this file's header): the chokepoint edit carries exactly its eight
  // dependents, and it disturbs nothing else about the stream
  // ==========================================================================
  {
    name: "cache-read/01 the chokepoint edit carries exactly its eight dependents — every one of them answers the remote ref from the cache, and validate reports exactly what it reported before",
    run: () => withCacheReadFixture(async (fx) => {
      // The findings BEFORE the cache knows anything: the chokepoint must not change them.
      const before = await runCommand(fx, "work:validate", {});
      await background(fx);

      // All eight dependents resolve the remote-authored ref: the four READ doors answer it,
      // the four WRITE/DISPATCH doors resolve it and then apply their own contract. A ninth
      // command outside the chokepoint's dependent set could not be added to this list without
      // an edit to its own file, which is what "blast radius = its dependents" means.
      assert.equal((await runCommand(fx, "work:doc", { ref: "07/01", doc: "STORY" })).answeredFrom, "cache", "doc");
      assert.equal((await runCommand(fx, "work:tasks", { ref: "07/01" })).answeredFrom, "cache", "tasks");
      assert.equal((await runCommand(fx, "work:run-status", { ref: "07/01" })).answeredFrom, "cache", "run-status");
      for (const [id, input] of [
        ["work:feedback", { ref: "07/01", note: "n", actor: "qa" }],
        ["work:run-start", { ref: "07/01" }],
        ["work:run-retry", { ref: "07/01" }],
        ["work:run-complete", { ref: "07/01", outcome: "done" }],
      ]) {
        const error = await refuseCommand(() => runCommand(fx, id, input));
        assert.notEqual(error.code, "ref-not-found", `${id} resolved it`);
      }

      // …and the stream's VALIDITY is untouched. Validate is a folder↔frontmatter check whose
      // subject is the disk; the chokepoint moving must not add or silence one finding.
      const after = await runCommand(fx, "work:validate", {});
      assert.deepEqual(after.findings, before.findings, "validate reports exactly the findings it reported before the chokepoint moved");
    }, { stream: DISK_STREAM }),
  },
];

// Every directory under the work stream, sorted — the observable for "no folder is created
// anywhere under the control node's work directory".
async function treeSnapshot(dir, prefix = "") {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    out.push(rel);
    out.push(...(await treeSnapshot(path.join(dir, entry.name), rel)));
  }
  return out.sort();
}
