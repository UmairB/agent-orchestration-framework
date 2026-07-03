// Traceability wiring for milestone 26 / story 00 — the sync root-set (task 01).
//
// Covers EVERY @executable scenario in tasks/01_sync-root-set.feature over a REAL
// LOCAL bare-remote git fixture (the m22 mesh-git-sync-transport pattern: bare +
// clone, identity + gpgsign false + autocrlf false + eol lf, fixture-level
// `* -text` .gitattributes so byte-for-byte assertions are EOL-stable on Windows —
// the REAL R3 pin is asserted separately by acd-runs-eol-pinned against THIS repo's
// .gitattributes). Every git spawn routes through spawnSyncHardened (22/R3). One
// test object per @executable scenario (Scenario-Outline rows folded), each name
// tracing to feature + scenario. node:assert/strict.
//
//   01_sync-root-set.feature —
//     - the DEFAULT-root scope matrix: only a partition-root write is committed; a
//       run record / a record-doc edit / a source edit are clean no-ops, files
//       uncommitted + byte-intact (today's behaviour byte-for-byte);
//     - the WIDENED scope: [meshDir, runsPathspec] commits + pushes a pending run
//       record, reported in pushed, on the remote byte-for-byte;
//     - the operator-safety invariant SURVIVES the widening (record docs + source
//       files in NO root set);
//     - the pull half is branch-wide: a peer's run record lands ON DISK under either
//       root set; only the mesh-aware set REPORTS it in pulled;
//     - the clean no-op is identical under either set;
//     - the honest failure envelopes are UNCHANGED in both modes ("push-failed" /
//       "pull-failed", pushed EMPTY) — the pull breakage is the LOCKED mechanism:
//       `git remote set-url origin <tmp>/does-not-exist.git` (the fetch-url sibling
//       of breakPushRemote; hasRemote stays true; deterministic, offline);
//     - content-agnostic over the widened scope: unknown-shape JSON + non-JSON
//       binary bytes ride the runs pathspec byte-for-byte.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncMesh, runsPathspec } from "../src/mesh-sync.mjs";
import { meshDir, nodeRecordPath } from "../src/mesh-store.mjs";
import { runNodeRecordPath } from "../src/run-store.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

// ---- the local bare-remote git fixture (the m22 transport pattern) ----------

function git(cwd, args) {
  const result = spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
  return { status: typeof result.status === "number" ? result.status : 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function configIdentity(repo) {
  git(repo, ["config", "user.email", "fixture@aof.local"]);
  git(repo, ["config", "user.name", "aof fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  // EOL neutralisation (the m22 harness, LOCKED by the task-02 QA resolution):
  // autocrlf off + eol lf; the fixture .gitattributes below adds `* -text`.
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "core.eol", "lf"]);
  // Divergent-branch determinism: a tick that commits locally then pulls a peer's
  // commit is a genuine merge — pin merge (not rebase) regardless of the host's
  // global git config, so the fixture behaves identically on any machine/CI.
  git(repo, ["config", "pull.rebase", "false"]);
}

function record(nodeId) {
  return `${JSON.stringify({ nodeId, host: nodeId, os: "linux", aofVersion: "0.1.0" }, null, 2)}`;
}

function runRecordBytes(runId, node) {
  return `${JSON.stringify({
    runId, itemRef: "26", state: "running", attempt: 1, outcome: null, sessionId: null,
    brief: {}, createdAt: "2026-07-02T10:00:00.000Z", updatedAt: "2026-07-02T10:00:00.000Z",
    failureReason: null, heartbeatAt: null, retryOf: null, reclaimedAt: null, node,
  }, null, 2)}`;
}

// Build: a BARE remote + one working clone. The baseline tip carries a published
// mesh record under the partition root, a work item with a STORY.md record doc, and
// an unrelated source file — all committed and pushed (a clean baseline).
async function buildFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-sync-rootset-"));
  const bare = path.join(tmp, "remote.git");
  await mkdir(bare, { recursive: true });
  let r = git(bare, ["init", "--bare", "-q", "-b", "main"]);
  if (r.error || r.status !== 0) {
    git(bare, ["init", "--bare", "-q"]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }

  const clone = path.join(tmp, "node-a");
  r = git(tmp, ["clone", "-q", bare, "node-a"]);
  if (r.status !== 0) throw new Error(`git clone failed: ${r.stderr}`);
  configIdentity(clone);
  git(clone, ["checkout", "-q", "-b", "main"]);

  const workDir = path.join(clone, "wiki", "work");
  const workspace = { workDir, projectRoot: clone };
  const itemDir = path.join(workDir, "26_milestone_root-set");
  const item = { ref: "26", dir: itemDir };
  await mkdir(path.join(meshDir(workspace), "nodes"), { recursive: true });
  await mkdir(itemDir, { recursive: true });
  await writeFile(path.join(clone, ".gitattributes"), "* -text\n", "utf8");
  await writeFile(path.join(clone, "README.md"), "fixture\n", "utf8");
  await writeFile(path.join(clone, "tool.mjs"), "export const answer = 42;\n", "utf8");
  await writeFile(path.join(itemDir, "STORY.md"), "# 26/00 baseline story record\n", "utf8");
  // The published baseline mesh record under the partition root.
  await writeFile(nodeRecordPath(workspace, "node-a"), record("node-a"), "utf8");
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "-q", "-m", "baseline"]);
  git(clone, ["push", "-q", "-u", "origin", "main"]);

  return { tmp, bare, clone, workDir, workspace, item, itemDir };
}

// A SECOND independent clone (a peer) from the same bare remote.
async function clonePeer(fixture, name) {
  const peer = path.join(fixture.tmp, name);
  const r = git(fixture.tmp, ["clone", "-q", fixture.bare, name]);
  if (r.status !== 0) throw new Error(`peer clone failed: ${r.stderr}`);
  configIdentity(peer);
  git(peer, ["checkout", "-q", "main"]);
  const peerWorkDir = path.join(peer, "wiki", "work");
  const peerItem = { ref: "26", dir: path.join(peerWorkDir, "26_milestone_root-set") };
  return { peer, peerWorkDir, peerItem, workspace: { workDir: peerWorkDir, projectRoot: peer } };
}

const headSha = (repo) => git(repo, ["rev-parse", "HEAD"]).stdout.trim();
// -uall so an untracked file inside a new directory is listed by its FILE path
// (plain porcelain collapses it to the directory entry).
const porcelain = (repo) => git(repo, ["status", "--porcelain", "-uall"]).stdout;

// The mesh-aware root set: the partition root PLUS the runs pathspec (26/ADR-002 —
// injected at the ENGINE seam; stories 01/02 pass it in production).
const meshAwareRoots = (workspace) => [meshDir(workspace), runsPathspec(workspace)];

// Break ONLY the PUSH url (the proven m22 seam) — pull succeeds, push fails.
function breakPushRemote(fixture) {
  git(fixture.clone, ["remote", "set-url", "--push", "origin", path.join(fixture.tmp, "does-not-exist.git")]);
}

// Break the FETCH url (the LOCKED pull-failure mechanism — the set-url sibling):
// `git remote` still lists origin (hasRemote stays true), the pull fails
// immediately + deterministically, and the engine returns pull-failed BEFORE any
// push. The push url is re-set to the real bare as belt-and-braces.
function breakFetchRemote(fixture) {
  git(fixture.clone, ["remote", "set-url", "origin", path.join(fixture.tmp, "does-not-exist.git")]);
  git(fixture.clone, ["remote", "set-url", "--push", "origin", fixture.bare]);
}

// The bytes of a path on the bare remote's branch tip (null when absent).
function remoteShow(bare, relPath) {
  const r = git(bare, ["show", `main:${relPath.split(path.sep).join("/")}`]);
  return r.status === 0 ? r.stdout : null;
}

const rel = (repo, abs) => path.relative(repo, abs).split(path.sep).join("/");
const cleanup = (fixture) => rm(fixture.tmp, { recursive: true, force: true });

export const meshSyncRootSetTests = [
  // ── Scenario Outline: a default-root sync tick commits a partition-root write and nothing else ──
  {
    name: "mesh-sync-root-set/01 a default-root sync tick commits a partition-root write and nothing else (run record / record-doc edit / source edit stay uncommitted, byte-intact)",
    async run() {
      const rows = [
        {
          label: "a mesh record under the partition root",
          committedRow: true,
          async pend(fx) {
            const p = nodeRecordPath(fx.workspace, "node-b");
            await writeFile(p, record("node-b"), "utf8");
            return { abs: p, bytes: record("node-b") };
          },
        },
        {
          label: "a run record under the item's runs tree",
          committedRow: false,
          async pend(fx) {
            const p = runNodeRecordPath(fx.item, "node-a", "20260702T100000000Z-0000");
            await mkdir(path.dirname(p), { recursive: true });
            const bytes = runRecordBytes("20260702T100000000Z-0000", "node-a");
            await writeFile(p, bytes, "utf8");
            return { abs: p, bytes };
          },
        },
        {
          label: "an operator's record-doc edit (a STORY.md)",
          committedRow: false,
          async pend(fx) {
            const p = path.join(fx.itemDir, "STORY.md");
            const bytes = "# 26/00 baseline story record\n\nan in-flight operator edit\n";
            await writeFile(p, bytes, "utf8");
            return { abs: p, bytes };
          },
        },
        {
          label: "an unrelated source-file edit",
          committedRow: false,
          async pend(fx) {
            const p = path.join(fx.clone, "tool.mjs");
            const bytes = "export const answer = 43; // edited\n";
            await writeFile(p, bytes, "utf8");
            return { abs: p, bytes };
          },
        },
      ];
      for (const row of rows) {
        const fx = await buildFixture();
        try {
          const { abs, bytes } = await row.pend(fx);
          const result = await syncMesh(fx.workspace);

          if (row.committedRow) {
            // The tick commits and pushes it, reporting its path in pushed; the
            // remote branch tip contains the mesh record.
            assert.equal(result.committed, true, `[${row.label}] the tick commits`);
            assert.ok(
              result.pushed.map((p) => p.replace(/\\/g, "/")).includes(rel(fx.clone, abs)),
              `[${row.label}] the envelope's pushed names report its path (got ${JSON.stringify(result.pushed)})`
            );
            assert.equal(remoteShow(fx.bare, rel(fx.clone, abs)), bytes, `[${row.label}] the remote branch tip contains the mesh record`);
          } else {
            // A clean no-op: nothing committed, nothing pushed; the pending file
            // stays uncommitted in the working tree AND byte-intact.
            assert.equal(result.committed, false, `[${row.label}] nothing is committed`);
            assert.equal(result.noop, true, `[${row.label}] the tick is a clean no-op`);
            assert.deepEqual(result.pushed, [], `[${row.label}] nothing is pushed`);
            assert.ok(
              porcelain(fx.clone).includes(rel(fx.clone, abs)),
              `[${row.label}] the pending write stays uncommitted in the working tree`
            );
            assert.equal(await readFile(abs, "utf8"), bytes, `[${row.label}] the pending write is byte-intact`);
            // The remote tip never received the pending write: an untracked file is
            // absent from the tip; a tracked file's tip content is still the baseline.
            const onRemote = remoteShow(fx.bare, rel(fx.clone, abs));
            assert.notEqual(onRemote, bytes, `[${row.label}] the remote branch tip does NOT contain the pending write`);
          }
        } finally {
          await cleanup(fx);
        }
      }
    },
  },
  // ── Scenario: a mesh-aware root set commits and pushes a pending run record and reports it in pushed ──
  {
    name: "mesh-sync-root-set/01 a mesh-aware root set commits and pushes a pending run record, reports it in pushed, and it lands on the remote byte-for-byte",
    async run() {
      const fx = await buildFixture();
      try {
        const runPath = runNodeRecordPath(fx.item, "node-a", "20260702T100000000Z-0000");
        await mkdir(path.dirname(runPath), { recursive: true });
        const bytes = runRecordBytes("20260702T100000000Z-0000", "node-a");
        await writeFile(runPath, bytes, "utf8");

        const result = await syncMesh(fx.workspace, { roots: meshAwareRoots(fx.workspace) });

        assert.equal(result.committed, true, "the tick commits");
        assert.notEqual(result.synced, false, "the tick pushes (no failure envelope)");
        assert.ok(
          result.pushed.map((p) => p.replace(/\\/g, "/")).includes(rel(fx.clone, runPath)),
          `the envelope's pushed names include the run record's path (got ${JSON.stringify(result.pushed)})`
        );
        assert.equal(remoteShow(fx.bare, rel(fx.clone, runPath)), bytes, "the remote branch tip contains the run record byte-for-byte as written");
      } finally {
        await cleanup(fx);
      }
    },
  },
  // ── Scenario: a mesh-aware tick carries the run record but never sweeps an operator's unrelated edits ──
  {
    name: "mesh-sync-root-set/01 a mesh-aware tick carries the run record but never sweeps an operator's record-doc or source edits (root-set paths only, in the commit and on the remote)",
    async run() {
      const fx = await buildFixture();
      try {
        const runPath = runNodeRecordPath(fx.item, "node-a", "20260702T100000000Z-0000");
        await mkdir(path.dirname(runPath), { recursive: true });
        const runBytes = runRecordBytes("20260702T100000000Z-0000", "node-a");
        await writeFile(runPath, runBytes, "utf8");
        const storyPath = path.join(fx.itemDir, "STORY.md");
        const storyBytes = "# 26/00 baseline story record\n\nan in-flight operator edit\n";
        await writeFile(storyPath, storyBytes, "utf8");
        const sourcePath = path.join(fx.clone, "tool.mjs");
        const sourceBytes = "export const answer = 43; // edited\n";
        await writeFile(sourcePath, sourceBytes, "utf8");

        const result = await syncMesh(fx.workspace, { roots: meshAwareRoots(fx.workspace) });

        assert.equal(result.committed, true, "the tick commits the run record");
        // The tick's commit contains the run record and ONLY root-set paths.
        const committedPaths = git(fx.clone, ["show", "--name-only", "--format="]).stdout
          .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        assert.ok(committedPaths.includes(rel(fx.clone, runPath)), "the tick's commit contains the run record");
        for (const p of committedPaths) {
          assert.ok(
            p.startsWith(".aof/mesh/") || /^wiki\/work\/.+\/runs\//.test(p),
            `every committed path is a root-set path (partition root or runs tree) — got "${p}"`
          );
        }
        assert.ok(!committedPaths.includes(rel(fx.clone, storyPath)), "the record-doc edit is NOT in the commit");
        assert.ok(!committedPaths.includes(rel(fx.clone, sourcePath)), "the source-file edit is NOT in the commit");

        // Both operator edits stay uncommitted in the working tree, byte-intact.
        const status = porcelain(fx.clone);
        assert.ok(status.includes(rel(fx.clone, storyPath)), "the record-doc edit stays uncommitted in the working tree");
        assert.ok(status.includes(rel(fx.clone, sourcePath)), "the source-file edit stays uncommitted in the working tree");
        assert.equal(await readFile(storyPath, "utf8"), storyBytes, "the record-doc edit is byte-intact");
        assert.equal(await readFile(sourcePath, "utf8"), sourceBytes, "the source-file edit is byte-intact");

        // The remote branch tip contains the run record and NEITHER operator edit.
        assert.equal(remoteShow(fx.bare, rel(fx.clone, runPath)), runBytes, "the remote branch tip contains the run record");
        assert.equal(remoteShow(fx.bare, rel(fx.clone, storyPath)), "# 26/00 baseline story record\n", "the remote STORY.md is the baseline (the edit was not swept)");
        assert.equal(remoteShow(fx.bare, rel(fx.clone, sourcePath)), "export const answer = 42;\n", "the remote source file is the baseline (the edit was not swept)");
      } finally {
        await cleanup(fx);
      }
    },
  },
  // ── Scenario Outline: a peer's run record on the remote arrives on disk under either root set and is reported only by the mesh-aware set ──
  {
    name: "mesh-sync-root-set/01 a peer's run record on the remote arrives ON DISK under either root set (durability never depends on scope) and is reported in pulled only by the mesh-aware set",
    async run() {
      const rows = [
        { label: "the default root set", roots: null, reported: false },
        { label: "the mesh-aware root set", roots: meshAwareRoots, reported: true },
      ];
      for (const row of rows) {
        const fx = await buildFixture();
        try {
          // A peer pushes a run record this clone has not seen.
          const peer = await clonePeer(fx, "node-peer");
          const peerRunPath = runNodeRecordPath(peer.peerItem, "node-peer", "20260702T110000000Z-0000");
          await mkdir(path.dirname(peerRunPath), { recursive: true });
          const bytes = runRecordBytes("20260702T110000000Z-0000", "node-peer");
          await writeFile(peerRunPath, bytes, "utf8");
          git(peer.peer, ["add", "-A"]);
          git(peer.peer, ["commit", "-q", "-m", "peer run record"]);
          git(peer.peer, ["push", "-q"]);

          const result = await syncMesh(fx.workspace, row.roots ? { roots: row.roots(fx.workspace) } : undefined);

          assert.notEqual(result.synced, false, `[${row.label}] the tick does not fail`);
          const localRunPath = runNodeRecordPath(fx.item, "node-peer", "20260702T110000000Z-0000");
          assert.ok(existsSync(localRunPath), `[${row.label}] the peer's run record is present in the working tree`);
          assert.equal(await readFile(localRunPath, "utf8"), bytes, `[${row.label}] the peer's run record arrived byte-for-byte`);
          const pulledRel = result.pulled.map((p) => p.replace(/\\/g, "/"));
          if (row.reported) {
            assert.ok(
              pulledRel.includes(rel(fx.clone, localRunPath)),
              `[${row.label}] the envelope's pulled names list the run record's path (got ${JSON.stringify(result.pulled)})`
            );
          } else {
            assert.ok(
              !pulledRel.includes(rel(fx.clone, localRunPath)),
              `[${row.label}] the envelope's pulled names do NOT list the run record's path (the envelope never claims scope it was not given; got ${JSON.stringify(result.pulled)})`
            );
          }
        } finally {
          await cleanup(fx);
        }
      }
    },
  },
  // ── Scenario Outline: a tick with nothing pending anywhere is the same clean no-op under either root set ──
  {
    name: "mesh-sync-root-set/01 a tick with nothing pending anywhere is the same clean no-op under either root set (no commit, HEAD unmoved, tree byte-unchanged)",
    async run() {
      const fx = await buildFixture();
      try {
        for (const row of [
          { label: "the default root set", roots: null },
          { label: "the mesh-aware root set", roots: meshAwareRoots(fx.workspace) },
        ]) {
          const headBefore = headSha(fx.clone);
          const statusBefore = porcelain(fx.clone);

          const result = await syncMesh(fx.workspace, row.roots ? { roots: row.roots } : undefined);

          assert.equal(result.committed, false, `[${row.label}] nothing committed`);
          assert.deepEqual(result.pushed, [], `[${row.label}] nothing pushed`);
          assert.deepEqual(result.pulled, [], `[${row.label}] nothing pulled`);
          assert.equal(result.noop, true, `[${row.label}] the envelope is the clean no-op shape`);
          assert.equal(headSha(fx.clone), headBefore, `[${row.label}] no commit is created and HEAD is the same commit as before`);
          assert.equal(porcelain(fx.clone), statusBefore, `[${row.label}] the working tree is byte-unchanged`);
        }
      } finally {
        await cleanup(fx);
      }
    },
  },
  // ── Scenario Outline: a failed network half returns the same honest failure envelope under either root set ──
  {
    name: "mesh-sync-root-set/01 a failed network half returns the same honest failure envelope under either root set (push-failed / pull-failed, pushed EMPTY, the pending write never lost)",
    async run() {
      const rows = [
        { pending: "mesh", failing: "push", roots: null, reason: "push-failed" },
        { pending: "run", failing: "push", roots: meshAwareRoots, reason: "push-failed" },
        { pending: "mesh", failing: "pull", roots: null, reason: "pull-failed" },
        { pending: "run", failing: "pull", roots: meshAwareRoots, reason: "pull-failed" },
      ];
      for (const row of rows) {
        const fx = await buildFixture();
        try {
          let abs;
          let bytes;
          if (row.pending === "mesh") {
            abs = nodeRecordPath(fx.workspace, "node-b");
            bytes = record("node-b");
          } else {
            abs = runNodeRecordPath(fx.item, "node-a", "20260702T100000000Z-0000");
            await mkdir(path.dirname(abs), { recursive: true });
            bytes = runRecordBytes("20260702T100000000Z-0000", "node-a");
          }
          await writeFile(abs, bytes, "utf8");
          if (row.failing === "push") breakPushRemote(fx);
          else breakFetchRemote(fx);

          const result = await syncMesh(fx.workspace, row.roots ? { roots: row.roots(fx.workspace) } : undefined);

          const label = `${row.pending} record / ${row.failing} fails / ${row.roots ? "mesh-aware" : "default"} roots`;
          assert.equal(result.synced, false, `[${label}] the envelope reports synced false`);
          assert.equal(result.reason, row.reason, `[${label}] the reason literal is exactly "${row.reason}"`);
          assert.deepEqual(result.pushed, [], `[${label}] the envelope's pushed names are empty (a failed sync never claims it moved records)`);
          // The pending write is still safe in the local tree (committed locally at
          // most — never lost).
          assert.ok(existsSync(abs), `[${label}] the pending write still exists in the local tree`);
          assert.equal(await readFile(abs, "utf8"), bytes, `[${label}] the pending write's bytes are intact`);
        } finally {
          await cleanup(fx);
        }
      }
    },
  },
  // ── Scenario Outline: a mesh-aware tick moves a runs-tree file byte-for-byte whatever its content ──
  {
    name: "mesh-sync-root-set/01 a mesh-aware tick moves a runs-tree file byte-for-byte whatever its content (unknown JSON shape + non-JSON binary bytes)",
    async run() {
      const rows = [
        { file: "future-shape.json", sub: null, bytes: '{"runs":{"beat":7,"nested":[true,null,1.5]},"unknown":"shape"}' },
        // Non-JSON binary-ish bytes (NUL + non-UTF-friendly) under a node subdir —
        // latin1 round-trips the raw bytes exactly.
        { file: "opaque.bin", sub: "node-x", bytes: "\x00\x01\x02\xff\xfe binary\x00payload" },
      ];
      for (const { file, sub, bytes } of rows) {
        const fx = await buildFixture();
        try {
          const dir = sub ? path.join(fx.itemDir, "runs", sub) : path.join(fx.itemDir, "runs");
          await mkdir(dir, { recursive: true });
          const target = path.join(dir, file);
          await writeFile(target, Buffer.from(bytes, "latin1"));

          const result = await syncMesh(fx.workspace, { roots: meshAwareRoots(fx.workspace) });

          assert.equal(result.committed, true, `${file} was committed`);
          assert.notEqual(result.synced, false, `${file} was pushed (no failure envelope)`);
          assert.ok(
            result.pushed.map((p) => p.replace(/\\/g, "/")).includes(rel(fx.clone, target)),
            `${file} appears in the pushed set (got ${JSON.stringify(result.pushed)})`
          );
          const onDisk = await readFile(target);
          assert.equal(onDisk.equals(Buffer.from(bytes, "latin1")), true, `${file} on disk is byte-for-byte unchanged (the engine never rewrote it)`);
          // The remote branch tip contains the file with IDENTICAL bytes — raw
          // Buffer capture (no encoding) so binary bytes are not mangled.
          const r = spawnSyncHardened("git", ["show", `main:${rel(fx.clone, target)}`], { cwd: fx.bare });
          assert.equal(r.status, 0, `${file} is on the remote branch tip`);
          assert.equal(r.stdout.equals(Buffer.from(bytes, "latin1")), true, `the remote ${file} has identical bytes`);
        } finally {
          await cleanup(fx);
        }
      }
    },
  },
];
