// Traceability wiring for milestone 22 / story 02 — the mesh:sync git transport (the
// one-shot, PAYLOAD-AGNOSTIC engine that moves records over git, ADR-004).
//
// Covers EVERY @executable scenario in tasks/00_git-sync-transport.feature over a REAL
// LOCAL bare-remote git fixture (mirroring import-recovery / roundtrip-harness:
// spawnSync("git", …) + git config user.email/user.name + commit.gpgsign false,
// offline in a mkdtemp temp dir). One test object per @executable scenario, each name
// tracing to feature + scenario. node:assert/strict.
//
//   00_git-sync-transport.feature —
//     - mesh:sync commits this node's published records and pushes (the publish half);
//     - a clean no-op when no staged mesh changes (HEAD + tree byte-unchanged, --json
//       reports no-op);
//     - pull a peer's record without touching this node's own;
//     - the payload-agnostic Scenario Outline (unknown-shape JSON + non-JSON .bin move
//       byte-for-byte unchanged);
//     - the concurrent-peer add-only merge (both records present, neither content-
//       merged, no conflict).
//
// The transport runs in-process via syncMesh(workspace) (the registered mesh:sync's
// run body), exercising the real git binary against the local fixture — the same git
// the import-recovery harness drives. The add-only merge is safe to assert in CI
// because the partition convention guarantees the two nodes wrote DIFFERENT paths (a
// fast-forward / disjoint-file union, never a three-way content merge).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncMesh } from "../src/mesh-sync.mjs";
import { nodeRecordPath, meshDir } from "../src/mesh-store.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

const TRANSPORT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TRANSPORT_CLI = path.join(TRANSPORT_REPO_ROOT, "bin", "aof.mjs");

// ---- the local bare-remote git fixture (the import-recovery / roundtrip pattern) ----

function git(cwd, args) {
  const result = spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
  return { status: typeof result.status === "number" ? result.status : 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function configIdentity(repo) {
  git(repo, ["config", "user.email", "fixture@aof.local"]);
  git(repo, ["config", "user.name", "aof fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  // Pin line endings so git does not renormalize record bytes on Windows (the m01/R2
  // lesson: a cross-platform byte-for-byte assertion must pin EOL). autocrlf off + eol
  // lf keep the payload-agnostic "moves bytes" property honest under git's text
  // normalization — the engine moves bytes; this stops the FIXTURE's git from rewriting
  // them on commit/checkout/show.
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "core.eol", "lf"]);
}

// A node record's pretty JSON (the store's opaque persist format).
function record(nodeId, extra = {}) {
  return `${JSON.stringify({
    nodeId, host: nodeId, os: "linux", runtimes: ["claude"], skills: [],
    aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z", ...extra,
  }, null, 2)}`;
}

// Build: a BARE remote + one working clone for THIS node. The clone is the git repo
// root; wiki/work is inside it, and the partition root is wiki/work/.mesh. Returns the
// roots + a `workspace` shaped like loadWorkspace's result ({ workDir, projectRoot }).
// `branch` is the default branch the clone publishes on (main).
async function buildFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-sync-"));
  const bare = path.join(tmp, "remote.git");
  await mkdir(bare, { recursive: true });
  let r = git(bare, ["init", "--bare", "-q", "-b", "main"]);
  if (r.error || r.status !== 0) {
    // Older git without -b on init --bare: init then set HEAD.
    git(bare, ["init", "--bare", "-q"]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }

  const clone = path.join(tmp, "node-a");
  r = git(tmp, ["clone", "-q", bare, "node-a"]);
  if (r.status !== 0) throw new Error(`git clone failed: ${r.stderr}`);
  configIdentity(clone);
  git(clone, ["checkout", "-q", "-b", "main"]);

  // The work stream + partition root. An initial commit so HEAD exists (the no-op
  // scenario records HEAD; pull needs an upstream).
  const workDir = path.join(clone, "wiki", "work");
  await mkdir(path.join(workDir, ".mesh", "nodes"), { recursive: true });
  // Pin EVERY path as -text (no EOL conversion) so git moves record bytes verbatim
  // across commit/checkout/merge on Windows (the m01/R2 lesson) — the engine is
  // payload-agnostic; this stops the fixture's git from renormalizing line endings.
  await writeFile(path.join(clone, ".gitattributes"), "* -text\n", "utf8");
  await writeFile(path.join(clone, "README.md"), "fixture\n", "utf8");
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "-q", "-m", "initial"]);
  git(clone, ["push", "-q", "-u", "origin", "main"]);

  const workspace = { workDir, projectRoot: clone };
  return { tmp, bare, clone, workDir, workspace };
}

// A SECOND independent clone (a peer node) cloned from the same bare remote, with its
// own identity. Used to simulate a peer publishing concurrently.
async function clonePeer(fixture, name) {
  const peer = path.join(fixture.tmp, name);
  const r = git(fixture.tmp, ["clone", "-q", fixture.bare, name]);
  if (r.status !== 0) throw new Error(`peer clone failed: ${r.stderr}`);
  configIdentity(peer);
  git(peer, ["checkout", "-q", "main"]);
  const peerWorkDir = path.join(peer, "wiki", "work");
  await mkdir(path.join(peerWorkDir, ".mesh", "nodes"), { recursive: true });
  return { peer, peerWorkDir, workspace: { workDir: peerWorkDir, projectRoot: peer } };
}

const headSha = (repo) => git(repo, ["rev-parse", "HEAD"]).stdout.trim();

// Break ONLY the clone's PUSH url (origin's pushurl → a non-existent bare path) while
// leaving the FETCH url intact. So `git pull` (the read-back half) still succeeds and
// the transport reaches the push step, but `git push` fails DETERMINISTICALLY (the push
// destination does not exist — no network, no flakiness). This isolates the push-failed
// path: the pull half is fine; only the push is rejected. Returns nothing.
function breakPushRemote(fixture) {
  const missing = path.join(fixture.tmp, "does-not-exist.git");
  git(fixture.clone, ["remote", "set-url", "--push", "origin", missing]);
}

// Write a real .aof/aof.config.json into the clone so the spawned CLI can loadWorkspace
// it (workDir = ./wiki/work, the clone-relative work stream the partition root sits in).
async function writeCliConfig(fixture) {
  const aofDir = path.join(fixture.clone, ".aof");
  await mkdir(aofDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
}

// The bytes of a path on the bare remote's branch tip (git show <branch>:<relpath>).
function remoteShow(bare, relPath) {
  const r = git(bare, ["show", `main:${relPath.split(path.sep).join("/")}`]);
  return r.status === 0 ? r.stdout : null;
}

// A throwaway-safe teardown.
const cleanup = (fixture) => rm(fixture.tmp, { recursive: true, force: true });

export const meshGitSyncTransportTests = [
  // Scenario: mesh:sync commits this node's published records and pushes.
  {
    name: "feature 22/02/00: mesh:sync commits this node's published record and pushes it to the configured remote",
    run: async () => {
      const fx = await buildFixture();
      try {
        // This node has published its identity record under the partition root.
        await writeFile(nodeRecordPath(fx.workspace, "node-a"), record("node-a"), "utf8");

        const result = await syncMesh(fx.workspace);

        // This node's record under the partition root is committed.
        assert.equal(result.committed, true, "mesh:sync committed the staged mesh record");
        assert.ok(!result.noop, "a sync with staged changes is not a no-op");
        // The --json result reports what was committed and pushed.
        const pushedRel = result.pushed.map((p) => p.replace(/\\/g, "/"));
        assert.ok(
          pushedRel.some((p) => p.endsWith("wiki/work/.mesh/nodes/node-a.json")),
          `--json result reports the committed+pushed record (got ${JSON.stringify(result.pushed)})`
        );
        // The remote's branch tip now contains this node's record file (pushed).
        const onRemote = remoteShow(fx.bare, path.join("wiki", "work", ".mesh", "nodes", "node-a.json"));
        assert.ok(onRemote != null, "the remote's branch tip contains node-a.json");
        assert.equal(onRemote, record("node-a"), "the remote record is byte-identical to what this node wrote");
      } finally {
        await cleanup(fx);
      }
    },
  },

  // Scenario: mesh:sync with no staged mesh changes is a clean no-op (byte-unchanged).
  {
    name: "feature 22/02/00: mesh:sync with no staged mesh changes is a clean no-op that leaves HEAD and the working tree byte-unchanged",
    run: async () => {
      const fx = await buildFixture();
      try {
        // No uncommitted mesh record changes (nothing published since the last sync).
        const headBefore = headSha(fx.clone);
        const status = git(fx.clone, ["status", "--porcelain"]).stdout;

        const result = await syncMesh(fx.workspace);

        // No commit created; HEAD unmoved; the --json result reports a no-op.
        assert.equal(result.committed, false, "no commit is created on a no-staged-change sync");
        assert.equal(result.noop, true, "the --json result reports a no-op");
        assert.deepEqual(result.pushed, [], "nothing was pushed");
        assert.equal(headSha(fx.clone), headBefore, "HEAD is the same commit as before the sync");
        // The working tree is byte-unchanged (no file added, modified, or deleted).
        assert.equal(git(fx.clone, ["status", "--porcelain"]).stdout, status, "the working tree is byte-unchanged");
      } finally {
        await cleanup(fx);
      }
    },
  },

  // Scenario: mesh:sync pulls a peer's record into this node's tree without touching
  // this node's own.
  {
    name: "feature 22/02/00: mesh:sync pulls a peer's record from the remote into this node's tree without touching this node's own",
    run: async () => {
      const fx = await buildFixture();
      try {
        // This node has its own record (already committed + pushed).
        await writeFile(nodeRecordPath(fx.workspace, "node-a"), record("node-a"), "utf8");
        await syncMesh(fx.workspace);
        const ownBytesBefore = await readFile(nodeRecordPath(fx.workspace, "node-a"), "utf8");

        // A peer ("umair-mbp") publishes a record this node has not seen, via a second
        // clone, and pushes it to the shared remote.
        const peer = await clonePeer(fx, "node-peer");
        await writeFile(nodeRecordPath(peer.workspace, "umair-mbp"), record("umair-mbp"), "utf8");
        await syncMesh(peer.workspace);

        // This node syncs — the pull brings in the peer's record.
        const result = await syncMesh(fx.workspace);

        // The peer record "umair-mbp.json" is present under this node's partition root.
        const peerPath = nodeRecordPath(fx.workspace, "umair-mbp");
        assert.ok(existsSync(peerPath), "the peer record umair-mbp.json is present under this node's partition root");
        // This node's own record file is byte-identical to before the pull.
        const ownBytesAfter = await readFile(nodeRecordPath(fx.workspace, "node-a"), "utf8");
        assert.equal(ownBytesAfter, ownBytesBefore, "this node's own record file is byte-identical to before the pull");
        // The --json result reports the peer record was pulled.
        const pulledRel = result.pulled.map((p) => p.replace(/\\/g, "/"));
        assert.ok(
          pulledRel.some((p) => p.endsWith("wiki/work/.mesh/nodes/umair-mbp.json")),
          `--json result reports the peer record was pulled (got ${JSON.stringify(result.pulled)})`
        );
      } finally {
        await cleanup(fx);
      }
    },
  },

  // Scenario Outline: mesh:sync moves an unrecognised record file unchanged (payload-
  // agnostic) — both an unknown-shape JSON and a non-JSON .bin.
  {
    name: "feature 22/02/00: mesh:sync moves an unrecognised record file byte-for-byte unchanged (payload-agnostic: unknown JSON shape + non-JSON binary)",
    run: async () => {
      const examples = [
        { file: "future-shape.json", bytes: '{"presence":{"beat":7,"nested":[true,null,1.5]},"unknown":"shape"}' },
        // A non-JSON, binary-ish payload (NUL + non-UTF-friendly bytes) the engine must
        // move as raw bytes — proving payload-agnostic means "moves bytes", not "moves
        // JSON it can parse". Written + read as latin1 so the bytes round-trip exactly.
        { file: "opaque.bin", bytes: "\x00\x01\x02\xff\xfe binary\x00payload" },
      ];
      for (const { file, bytes } of examples) {
        const fx = await buildFixture();
        try {
          const root = meshDir(fx.workspace);
          await mkdir(root, { recursive: true });
          const target = path.join(root, file);
          await writeFile(target, Buffer.from(bytes, "latin1"));

          const result = await syncMesh(fx.workspace);

          // The file is committed and pushed.
          assert.equal(result.committed, true, `${file} was committed`);
          const pushedRel = result.pushed.map((p) => p.replace(/\\/g, "/"));
          assert.ok(pushedRel.some((p) => p.endsWith(`.mesh/${file}`)), `${file} appears in the pushed set`);
          // The on-disk file is byte-for-byte unchanged (the engine never rewrote it).
          const onDisk = await readFile(target);
          assert.equal(onDisk.equals(Buffer.from(bytes, "latin1")), true, `${file} on disk is byte-for-byte unchanged`);
          // The remote's branch tip contains the file with identical bytes. Capture
          // stdout as a raw Buffer (NO encoding) so binary bytes (\x00\xff…) are not
          // mangled by a utf8 decode — the byte-for-byte proof must compare raw bytes.
          const r = spawnSyncHardened("git", ["show", `main:wiki/work/.mesh/${file}`], { cwd: fx.bare });
          assert.equal(r.status, 0, `${file} is on the remote branch tip`);
          assert.equal(r.stdout.equals(Buffer.from(bytes, "latin1")), true, `the remote ${file} has identical bytes`);
        } finally {
          await cleanup(fx);
        }
      }
    },
  },

  // Scenario: a concurrent peer publish merges add-only with no conflict and no content
  // rewrite (both records present, neither three-way-merged).
  {
    name: "feature 22/02/00: a concurrent peer publish merges add-only with no conflict and no content rewrite (both records arrive byte-for-byte as their owner wrote them)",
    run: async () => {
      const fx = await buildFixture();
      try {
        // A peer clone exists from the same baseline (both at the initial commit).
        const peer = await clonePeer(fx, "node-peer");

        // This node and the peer each publish their OWN distinct node record
        // concurrently (different paths — the partition convention).
        const aBytes = record("node-a", { host: "node-a-host" });
        const bBytes = record("node-b", { host: "node-b-host" });
        await writeFile(nodeRecordPath(fx.workspace, "node-a"), aBytes, "utf8");
        await writeFile(nodeRecordPath(peer.workspace, "node-b"), bBytes, "utf8");

        // The peer pushes first (it has a clean fast-forward from the baseline).
        const peerResult = await syncMesh(peer.workspace);
        assert.equal(peerResult.committed, true, "the peer committed its record");

        // This node now commits its own record, then pulls (the peer's record is on the
        // remote, ahead of this node) and pushes. The pull is add-only: disjoint paths,
        // so git fast-forwards / unions them with NO three-way content merge.
        const result = await syncMesh(fx.workspace);
        assert.equal(result.committed, true, "this node committed its own record");

        // BOTH records are present under this node's partition root.
        const aPath = nodeRecordPath(fx.workspace, "node-a");
        const bPath = nodeRecordPath(fx.workspace, "node-b");
        assert.ok(existsSync(aPath), "this node's own record (node-a.json) is present");
        assert.ok(existsSync(bPath), "the peer's record (node-b.json) is present after the add-only merge");

        // The merge completed add-only with NO conflict (no conflict markers, no
        // unmerged paths in the working tree).
        const conflicts = git(fx.clone, ["diff", "--name-only", "--diff-filter=U"]).stdout.trim();
        assert.equal(conflicts, "", "the merge completed with no unmerged/conflicted paths");
        const aOnDisk = await readFile(aPath, "utf8");
        const bOnDisk = await readFile(bPath, "utf8");
        assert.ok(!aOnDisk.includes("<<<<<<<") && !bOnDisk.includes("<<<<<<<"), "no conflict markers in either record");

        // Neither node's record was content-merged — each arrived byte-for-byte as its
        // owner wrote it.
        assert.equal(aOnDisk, aBytes, "this node's record is byte-for-byte as it wrote it (not content-merged)");
        assert.equal(bOnDisk, bBytes, "the peer's record is byte-for-byte as the peer wrote it (not content-merged)");
      } finally {
        await cleanup(fx);
      }
    },
  },

  // Regression (review Fix 1): a FAILED git push is reported HONESTLY — the transport
  // never returns a success-shaped envelope when records did NOT reach the remote
  // (ADR-004's load-bearing invariant: git stays the system of record; the engine moves
  // records HONESTLY or says it could not). Failure setup is deterministic: origin is
  // repointed at a non-existent bare path, so the push always fails (no network/flake).
  {
    name: "feature 22/02/00 (regression): a failed git push is reported honestly — syncMesh returns NOT a success envelope",
    run: async () => {
      const fx = await buildFixture();
      try {
        // This node publishes a record, then origin's PUSH url is broken (a missing bare
        // path) while fetch stays intact — so the commit + pull succeed, only the push
        // fails, deterministically.
        await writeFile(nodeRecordPath(fx.workspace, "node-a"), record("node-a"), "utf8");
        breakPushRemote(fx);

        const result = await syncMesh(fx.workspace);

        // The transport committed locally but the push FAILED — it must NOT claim success.
        assert.notEqual(result.noop, true, "a failed push is NOT a clean no-op");
        assert.equal(result.synced, false, "the result is marked synced:false (the push did not move records)");
        assert.equal(result.reason, "push-failed", "the failure reason is the structured push-failed");
        assert.deepEqual(result.pushed, [], "pushed is EMPTY — the transport does not report records it failed to push");
      } finally {
        await cleanup(fx);
      }
    },
  },

  // The same honest-failure proof at the CLI ALTITUDE: `aof mesh sync --json` against a
  // repo whose push fails exits NON-ZERO and emits ONE { ok:false, error, code } envelope
  // (a failed sync is a real error, surfaced as one — not a success-shaped result).
  {
    name: "feature 22/02/00 (regression): the CLI face exits non-zero and emits a single { ok:false } envelope when the sync push fails",
    run: async () => {
      const fx = await buildFixture();
      try {
        // A fresh, UNCOMMITTED record so the CLI's OWN run does the commit + failed push
        // (the in-process transport is not run first here). Push url broken, fetch intact.
        await writeFile(nodeRecordPath(fx.workspace, "node-a"), record("node-a"), "utf8");
        breakPushRemote(fx);
        await writeCliConfig(fx);

        const cli = spawnSyncHardened(process.execPath, [TRANSPORT_CLI, "mesh", "sync", "--json"], {
          cwd: fx.clone,
          encoding: "utf8",
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        assert.notEqual(cli.status, 0, `the CLI face exits non-zero on a failed sync (got ${cli.status}; stderr: ${cli.stderr})`);
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(cli.stdout); }, `the failure is ONE parseable JSON envelope (stdout: ${cli.stdout.slice(0, 200)})`);
        assert.equal(parsed.ok, false, "the envelope is { ok:false } (not a success-shaped sync result)");
        assert.equal(parsed.code, "push-failed", "the envelope's code is the structured push-failed reason");
        assert.ok(typeof parsed.error === "string" && parsed.error.length > 0, "the envelope carries a human error message");
      } finally {
        await cleanup(fx);
      }
    },
  },
];
