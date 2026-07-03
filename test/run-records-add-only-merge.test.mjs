// Traceability wiring for milestone 26 / story 00 — the add-only run merge (task 02,
// the outsider-verifiable acceptance).
//
// Covers EVERY @executable scenario in tasks/02_add-only-run-merge.feature over TWO
// real clones of one shared bare remote (the m22 transport-task precedent). Each
// clone mints a run for the SAME item under its OWN node dir through the REAL
// src/run-store.mjs, and the REAL syncMesh root-set tick carries them: the merge is
// ADD-ONLY — no content conflict, no wedged MERGING state — and after convergence
// each clone reads one union carrying BOTH records byte-for-byte.
//
// FIXTURE NOTE (the pre-convergence window is the point): clone B mints BEFORE any
// sync brings A's record to B, so the dedup guard — which spans only the union a
// clone can SEE (task 00) — does not fire on either side. Both mints succeeding in
// that window is exactly the race the add-only partition exists to make safe.
//
// QA resolutions LOCKED in the feature comments, honoured here:
//   - EOL: the PROVEN m22 harness neutralisation (per-clone core.autocrlf false +
//     core.eol lf + a fixture-level `* -text` .gitattributes) — strictly STRONGER
//     than eol=lf for byte-stability, so byte-for-byte assertions hold unweakened on
//     Windows CI. The REAL R3 pin is asserted SEPARATELY by acd-runs-eol-pinned
//     against THIS repo's .gitattributes. No content-equality fallback.
//   - Spawn discipline (22/R3): every git spawn routes through spawnSyncHardened.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncMesh, runsPathspec } from "../src/mesh-sync.mjs";
import { meshDir } from "../src/mesh-store.mjs";
import { startRun, readRuns, runNodeRecordPath } from "../src/run-store.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

// ---- the two-clone bare-remote fixture --------------------------------------

function git(cwd, args) {
  const result = spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
  return { status: typeof result.status === "number" ? result.status : 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function configIdentity(repo) {
  git(repo, ["config", "user.email", "fixture@aof.local"]);
  git(repo, ["config", "user.name", "aof fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "core.eol", "lf"]);
  // The headline scenario IS a divergent pull (B commits its own record, then pulls
  // A's) — pin merge (never rebase) so the add-only union is deterministic on any
  // host git config.
  git(repo, ["config", "pull.rebase", "false"]);
}

const ITEM_DIRNAME = "26_milestone_shared-item";

function cloneView(cloneRoot) {
  const workDir = path.join(cloneRoot, "wiki", "work");
  return {
    root: cloneRoot,
    workDir,
    workspace: { workDir, projectRoot: cloneRoot },
    item: { ref: "26", dir: path.join(workDir, ITEM_DIRNAME) },
  };
}

const meshAwareRoots = (workspace) => [meshDir(workspace), runsPathspec(workspace)];
const syncTick = (view) => syncMesh(view.workspace, { roots: meshAwareRoots(view.workspace) });

// A shared bare remote + two aof installs ("clone A" / "clone B"), each cloned from
// it over the same work stream: the baseline tip carries the work item both clones
// can mint runs against, plus the `* -text` EOL neutralisation.
async function buildFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-add-only-merge-"));
  const bare = path.join(tmp, "remote.git");
  await mkdir(bare, { recursive: true });
  let r = git(bare, ["init", "--bare", "-q", "-b", "main"]);
  if (r.error || r.status !== 0) {
    git(bare, ["init", "--bare", "-q"]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }

  // Clone A carries the baseline commit up.
  r = git(tmp, ["clone", "-q", bare, "clone-a"]);
  if (r.status !== 0) throw new Error(`clone A failed: ${r.stderr}`);
  const a = cloneView(path.join(tmp, "clone-a"));
  configIdentity(a.root);
  git(a.root, ["checkout", "-q", "-b", "main"]);
  await mkdir(path.join(meshDir(a.workspace), "nodes"), { recursive: true });
  await mkdir(a.item.dir, { recursive: true });
  await writeFile(path.join(a.root, ".gitattributes"), "* -text\n", "utf8");
  await writeFile(path.join(a.item.dir, "STORY.md"), "# the shared work item\n", "utf8");
  git(a.root, ["add", "-A"]);
  git(a.root, ["commit", "-q", "-m", "baseline: the shared work item"]);
  git(a.root, ["push", "-q", "-u", "origin", "main"]);

  // Clone B starts from the SAME baseline.
  r = git(tmp, ["clone", "-q", bare, "clone-b"]);
  if (r.status !== 0) throw new Error(`clone B failed: ${r.stderr}`);
  const b = cloneView(path.join(tmp, "clone-b"));
  configIdentity(b.root);
  git(b.root, ["checkout", "-q", "main"]);

  return { tmp, bare, a, b };
}

// The Background: clone A mints under node-a and syncs (committed + pushed); clone
// B mints under node-b for the SAME item BEFORE any sync brought A's record to B.
// Distinct injected instants keep the runId ordering deterministic (A's < B's).
const NOW_A = "2026-07-02T10:00:00.000Z";
const NOW_B = "2026-07-02T10:01:00.000Z";

async function background(fx) {
  const runA = await startRun(fx.a.item, { node: "node-a", now: NOW_A });
  const tickA = await syncTick(fx.a);
  assert.equal(tickA.committed, true, "background: clone A committed its run record");
  assert.notEqual(tickA.synced, false, "background: clone A's sync pushed cleanly");

  const runB = await startRun(fx.b.item, { node: "node-b", now: NOW_B });
  return {
    runA,
    runB,
    aBytes: await readFile(runNodeRecordPath(fx.a.item, "node-a", runA.runId), "utf8"),
    bBytes: await readFile(runNodeRecordPath(fx.b.item, "node-b", runB.runId), "utf8"),
  };
}

const rel = (repoRoot, abs) => path.relative(repoRoot, abs).split(path.sep).join("/");

// The bytes of a path on the bare remote's branch tip (null when absent).
function remoteShow(bare, relPath) {
  const r = git(bare, ["show", `main:${relPath}`]);
  return r.status === 0 ? r.stdout : null;
}

const cleanup = (fx) => rm(fx.tmp, { recursive: true, force: true });

export const runRecordsAddOnlyMergeTests = [
  // ── Scenario: clone B's sync merges the two nodes' run records add-only with no conflict and no MERGING state ──
  {
    name: "add-only-merge/02 clone B's sync merges the two nodes' run records add-only — no conflict, no wedged MERGING state, both records byte-identical to what their owners wrote, both on the remote tip",
    async run() {
      const fx = await buildFixture();
      try {
        const { runA, runB, aBytes, bBytes } = await background(fx);

        const tick = await syncTick(fx.b);

        // The tick succeeds (no pull-failed, no push-failed).
        assert.notEqual(tick.synced, false, `the tick succeeds (got reason ${tick.reason})`);
        assert.equal(tick.committed, true, "clone B committed its own record");

        // No merge is left in progress in clone B's repo (no wedged MERGING state —
        // the 26/ADR-003 load-bearing negative).
        assert.ok(!existsSync(path.join(fx.b.root, ".git", "MERGE_HEAD")), "no MERGE_HEAD remains (no merge in progress)");
        assert.equal(
          git(fx.b.root, ["diff", "--name-only", "--diff-filter=U"]).stdout.trim(),
          "",
          "no unmerged/conflicted paths in clone B's tree"
        );

        // Clone B's tree holds A's record under runs/node-a/ and its own under
        // runs/node-b/ — each byte-identical to what its owner wrote (add-only means
        // ADDED, never content-merged into a hybrid).
        const aInB = runNodeRecordPath(fx.b.item, "node-a", runA.runId);
        const bInB = runNodeRecordPath(fx.b.item, "node-b", runB.runId);
        assert.ok(existsSync(aInB), "clone B's tree holds A's record under runs/node-a/");
        assert.ok(existsSync(bInB), "clone B's tree holds its own record under runs/node-b/");
        const aInBBytes = await readFile(aInB, "utf8");
        assert.equal(aInBBytes, aBytes, "A's record in clone B's tree is byte-identical to what clone A wrote (never content-merged)");
        assert.ok(!aInBBytes.includes("<<<<<<<"), "A's record carries no conflict markers");
        assert.equal(await readFile(bInB, "utf8"), bBytes, "clone B's own record is byte-identical to what clone B wrote");

        // The shared remote's branch tip carries BOTH records.
        assert.equal(remoteShow(fx.bare, rel(fx.b.root, aInB)), aBytes, "the remote branch tip carries A's record");
        assert.equal(remoteShow(fx.bare, rel(fx.b.root, bInB)), bBytes, "the remote branch tip carries B's record");
      } finally {
        await cleanup(fx);
      }
    },
  },
  // ── Scenario: clone A's second sync converges it on the union without touching its own record ──
  {
    name: "add-only-merge/02 clone A's second sync converges it on the union — B's record arrives (reported in pulled) and A's own record is byte-identical to before the tick",
    async run() {
      const fx = await buildFixture();
      try {
        const { runA, runB, bBytes } = await background(fx);
        // Given: clone B's record has reached the shared remote.
        const tickB = await syncTick(fx.b);
        assert.notEqual(tickB.synced, false, "precondition: clone B's record reached the shared remote");

        // I record the on-disk bytes of clone A's own run record.
        const aOwnPath = runNodeRecordPath(fx.a.item, "node-a", runA.runId);
        const aOwnBefore = await readFile(aOwnPath, "utf8");

        const tick = await syncTick(fx.a);

        assert.notEqual(tick.synced, false, `the tick succeeds (got reason ${tick.reason})`);
        const bInA = runNodeRecordPath(fx.a.item, "node-b", runB.runId);
        assert.ok(existsSync(bInA), "clone B's record is present in clone A's tree under runs/node-b/");
        assert.equal(await readFile(bInA, "utf8"), bBytes, "clone B's record arrived byte-for-byte");
        assert.ok(
          tick.pulled.map((p) => p.replace(/\\/g, "/")).includes(rel(fx.a.root, bInA)),
          `the envelope's pulled names include clone B's record path (got ${JSON.stringify(tick.pulled)})`
        );
        assert.equal(await readFile(aOwnPath, "utf8"), aOwnBefore, "clone A's own record is byte-identical to before the tick (the pull did not touch it)");
      } finally {
        await cleanup(fx);
      }
    },
  },
  // ── Scenario: after convergence both clones read one identical runId-ascending union of both nodes' runs ──
  {
    name: "add-only-merge/02 after convergence both clones read one identical runId-ascending union — two runs, node-a + node-b, the two reads agreeing record-for-record byte-for-byte",
    async run() {
      const fx = await buildFixture();
      try {
        const { runA, runB } = await background(fx);
        // Given: both clones have synced to convergence (each tree carries both).
        assert.notEqual((await syncTick(fx.b)).synced, false, "precondition: clone B synced");
        assert.notEqual((await syncTick(fx.a)).synced, false, "precondition: clone A synced");

        // When each clone reads the item's runs (the task-00 union read, here over
        // records that travelled through git).
        const runsA = await readRuns(fx.a.item);
        const runsB = await readRuns(fx.b.item);

        for (const [label, runs] of [["clone A", runsA], ["clone B", runsB]]) {
          assert.equal(runs.length, 2, `${label}'s read returns exactly two runs`);
          assert.deepEqual(
            runs.map((r) => r.runId),
            [runA.runId, runB.runId],
            `${label}'s read is ordered runId-ascending`
          );
          assert.deepEqual(
            runs.map((r) => r.node),
            ["node-a", "node-b"],
            `${label}: one record carries node "node-a" and the other "node-b"`
          );
        }

        // The two clones' reads agree record-for-record…
        assert.deepEqual(runsA, runsB, "the two clones' reads agree record-for-record");
        // …and the underlying files agree byte-for-byte across machines.
        for (const [node, runId] of [["node-a", runA.runId], ["node-b", runB.runId]]) {
          assert.equal(
            await readFile(runNodeRecordPath(fx.a.item, node, runId), "utf8"),
            await readFile(runNodeRecordPath(fx.b.item, node, runId), "utf8"),
            `the ${node} record's bytes agree across the two clones`
          );
        }
      } finally {
        await cleanup(fx);
      }
    },
  },
];
