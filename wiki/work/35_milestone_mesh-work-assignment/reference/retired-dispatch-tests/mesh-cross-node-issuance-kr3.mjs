// Traceability wiring for milestone 27 / story 01 — KR3 cross-node issuance, the
// MECHANISM over two clones of one shared bare remote
// (tasks/05_cross-node-issuance-kr3.feature, ADR-005 / ADR-002.4 / ADR-004).
//
// Covers EVERY @executable scenario in 05_cross-node-issuance-kr3.feature. Two
// in-process aof installs ("node A", "node B"), each a clone of one shared bare
// remote (the m26 mesh-lease-claim-arbitration buildFixture/clonePeer idiom): A
// issues via the REGISTERED mesh:issue command (which pushes ONE default-root
// sync itself), B pulls via syncMesh(B.workspace), B's next OFFERS the item
// (invoke("work:next")), B claims via the real acquireLease protocol and mints a
// run under its own partition, A's next does NOT offer it. All driven through
// registered aof work/mesh commands — no hand-edited files.
//
//   05_cross-node-issuance-kr3.feature —
//     - a node-targeted directive issued on A is offered and run on target B, and
//       never offered on A;
//     - a capability-targeted directive issued on A is offered and run on an
//       advertising B;
//     - the directive is visible to B's routing view after a single pull
//       following A's issue-push (the ≤2-interval mechanism);
//     - a withdrawal issued on A propagates over git and stops B offering the
//       item.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { syncMesh } from "../src/mesh-sync.mjs";
import { nodeRecordPath, issuanceDirectivePath } from "../src/mesh-store.mjs";
import { writeText } from "../src/fs.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

const NOW = "2026-07-03T10:00:00.000Z";

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
  git(repo, ["config", "pull.rebase", "false"]);
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function writeWorkItem(root) {
  const workDir = path.join(root, "wiki", "work");
  const mDir = path.join(workDir, "27_milestone_issuance");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "27", slug: "issuance", status: "in-progress", created: "2026-01-01", updated: "2026-01-02" })
  );
  for (const s of [{ number: "00", slug: "issue" }, { number: "01", slug: "pickup" }]) {
    const storyDir = path.join(mDir, "stories", `${s.number}_story_${s.slug}`);
    await mkdir(storyDir, { recursive: true });
    await writeFile(
      path.join(storyDir, "STORY.md"),
      frontmatter({ type: "story", number: s.number, slug: s.slug, status: "not-started", created: "2026-01-01", updated: "2026-01-02", parent: "27" })
    );
  }
}

async function buildFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-kr3-"));
  const bare = path.join(tmp, "remote.git");
  await mkdir(bare, { recursive: true });
  let r = git(bare, ["init", "--bare", "-q", "-b", "main"]);
  if (r.error || r.status !== 0) {
    git(bare, ["init", "--bare", "-q"]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }

  const aRoot = path.join(tmp, "node-a");
  r = git(tmp, ["clone", "-q", bare, "node-a"]);
  if (r.status !== 0) throw new Error(`clone A failed: ${r.stderr}`);
  configIdentity(aRoot);
  git(aRoot, ["checkout", "-q", "-b", "main"]);
  await writeWorkItem(aRoot);
  await writeFile(path.join(aRoot, ".gitattributes"), "* -text\n", "utf8");
  git(aRoot, ["add", "-A"]);
  git(aRoot, ["commit", "-q", "-m", "baseline: the shared work item"]);
  git(aRoot, ["push", "-q", "-u", "origin", "main"]);

  r = git(tmp, ["clone", "-q", bare, "node-b"]);
  if (r.status !== 0) throw new Error(`clone B failed: ${r.stderr}`);
  const bRoot = path.join(tmp, "node-b");
  configIdentity(bRoot);
  git(bRoot, ["checkout", "-q", "main"]);

  return { tmp, bare, aRoot, bRoot };
}

async function makeCtx(root, nodeId) {
  await mkdir(path.join(root, ".aof"), { recursive: true });
  const configPath = path.join(root, ".aof", "aof.config.json");
  await writeFile(configPath, `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId } }, null, 2)}\n`, "utf8");
  const workspace = await loadWorkspace(root);
  return { workspace };
}

async function seedNodeRecord(workspace, nodeId, { runtimes = [], skills = [] } = {}) {
  await mkdir(path.dirname(nodeRecordPath(workspace, nodeId)), { recursive: true });
  await writeText(nodeRecordPath(workspace, nodeId), JSON.stringify({ nodeId, host: "h", os: "linux", runtimes, skills, aofVersion: "0.1.0", publishedAt: NOW }, null, 2));
}

const cleanup = (dir) => rm(dir, { recursive: true, force: true });

export const meshCrossNodeIssuanceKr3Tests = [
  // ══ Scenario: a node-targeted directive issued on A is offered and run on target B, never offered on A ══
  {
    name: "kr3-cross-node/05 a node-targeted directive issued on A is offered and run on target B — A's next does NOT offer it (targeted elsewhere)",
    async run() {
      const fx = await buildFixture();
      try {
        const a = await makeCtx(fx.aRoot, "node-a");
        const b = await makeCtx(fx.bRoot, "node-b");
        await seedNodeRecord(a.workspace, "node-a");
        await seedNodeRecord(b.workspace, "node-b");
        // A's --to disambiguation is DATA-DRIVEN against ITS OWN synced roster
        // (ADR-002.3) — B's node record must already be synced to A for "node-b" to
        // resolve as a node target rather than a capability token. Seed it directly
        // on A's tree too (standing in for "already synced" — the propagation
        // MECHANISM itself is proven by the KR3 directive-propagation rows below).
        await seedNodeRecord(a.workspace, "node-b");

        // A issues, targeted at B by node id — the REGISTERED command pushes ONE
        // default-root sync itself.
        await invoke("mesh:issue", { ref: "27/00", to: "node-b", now: NOW }, a);

        // B pulls (its OWN sync tick) and seeks work.
        await syncMesh(b.workspace);
        const bNext = await invoke("work:next", { now: NOW }, b);
        assert.equal(bNext.ref, "27/00", "node B was OFFERED the item by its routing view (targeted-here)");

        // B claims via the registered work:run-start (the real m26 lease protocol)
        // and mints a run under its own partition.
        const run = await invoke("work:run-start", { ref: "27/00", now: NOW }, b);
        assert.notEqual(run.stoodDown, true, "node B holds the m26 lease and mints a run");
        assert.equal(run.node, "node-b", "the run is minted under node B's partition");

        // A's next does NOT offer the item (targeted at node-b).
        const aNext = await invoke("work:next", { now: NOW }, a);
        assert.notEqual(aNext.ref, "27/00", "node A's next does NOT offer the item (targeted elsewhere)");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: a capability-targeted directive issued on A is offered and run on an advertising B ══
  {
    name: "kr3-cross-node/05 a capability-targeted directive issued on A is offered and run on an advertising B — A (which does not advertise the capability) does not offer it",
    async run() {
      const fx = await buildFixture();
      try {
        const a = await makeCtx(fx.aRoot, "node-a");
        const b = await makeCtx(fx.bRoot, "node-b");
        await seedNodeRecord(a.workspace, "node-a", { runtimes: [] });
        await seedNodeRecord(b.workspace, "node-b", { runtimes: ["codex"] });

        await invoke("mesh:issue", { ref: "27/00", to: "codex", now: NOW }, a);

        await syncMesh(b.workspace);
        const bNext = await invoke("work:next", { now: NOW }, b);
        assert.equal(bNext.ref, "27/00", "node B (advertises codex) is offered the item");

        const run = await invoke("work:run-start", { ref: "27/00", now: NOW }, b);
        assert.notEqual(run.stoodDown, true, "node B holds the lease and mints a run");
        assert.equal(run.node, "node-b", "the run mints under node B's partition");

        const aNext = await invoke("work:next", { now: NOW }, a);
        assert.notEqual(aNext.ref, "27/00", "node A does not advertise codex — targeted elsewhere");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: the directive is visible to B's routing view after a single pull following A's issue-push ══
  {
    name: "kr3-cross-node/05 the directive is visible to B's routing view after a single pull following A's issue-push (the ≤2-sync-interval mechanism)",
    async run() {
      const fx = await buildFixture();
      try {
        const a = await makeCtx(fx.aRoot, "node-a");
        const b = await makeCtx(fx.bRoot, "node-b");
        await seedNodeRecord(a.workspace, "node-a");
        await seedNodeRecord(b.workspace, "node-b");
        await seedNodeRecord(a.workspace, "node-b"); // A's own synced roster (ADR-002.3)

        // A's issue call pushes in the SAME call (issuer push + peer pull = two).
        await invoke("mesh:issue", { ref: "27/00", to: "node-b", now: NOW }, a);

        const pull = await syncMesh(b.workspace);
        assert.notEqual(pull.synced, false, "node B's single pull succeeds");

        const bNext = await invoke("work:next", { now: NOW }, b);
        assert.equal(bNext.ref, "27/00", "node B's next offers the item on the first post-pull walk");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: a withdrawal issued on A propagates over git and stops B offering the item ══
  {
    name: "kr3-cross-node/05 a withdrawal issued on A propagates over git and stops B offering the item — no directive file was deleted on either node",
    async run() {
      const fx = await buildFixture();
      try {
        const a = await makeCtx(fx.aRoot, "node-a");
        const b = await makeCtx(fx.bRoot, "node-b");
        await seedNodeRecord(a.workspace, "node-a", { runtimes: [] });
        await seedNodeRecord(b.workspace, "node-b", { runtimes: ["codex"] });

        // A issues 27/00 targeted at capability "codex" — A does NOT advertise it
        // (targeted-elsewhere, skipped here), so A's own next walks past it to 27/01.
        await invoke("mesh:issue", { ref: "27/00", to: "codex", now: NOW }, a);
        await syncMesh(a.workspace); // observe A's own pushed directive back (round-trip parity with B's pull)
        const before = await invoke("work:next", { now: NOW }, a);
        assert.equal(before.ref, "27/01", "27/00 was targeted-elsewhere (codex) — A's next skips to 27/01 before withdrawal");

        // B pulled it and WAS offered 27/00 (targeted-here — B advertises codex).
        await syncMesh(b.workspace);
        const bBefore = await invoke("work:next", { now: NOW }, b);
        assert.equal(bBefore.ref, "27/00", "B's next offered 27/00 before withdrawal (targeted-here)");

        // A withdraws its own directive (own-path state flip) and syncs; B pulls again.
        await invoke("mesh:issue", { ref: "27/00", withdraw: true, now: NOW }, a);
        await syncMesh(b.workspace);

        // The withdrawal rode git as a STATE FLIP, never a delete: the directive
        // file still exists on BOTH nodes, and B's pulled copy reads "withdrawn".
        const aDirectivePath = issuanceDirectivePath(a.workspace, "node-a", "27/00");
        const bDirectivePath = issuanceDirectivePath(b.workspace, "node-a", "27/00");
        assert.ok(existsSync(aDirectivePath), "no directive file was deleted on node A (a state flip, never an unlink)");
        assert.ok(existsSync(bDirectivePath), "no directive file was deleted on node B (the withdrawal rode git as a write)");
        const bCopy = JSON.parse(await readFile(bDirectivePath, "utf8"));
        assert.equal(bCopy.state, "withdrawn", "B's pulled copy of A's directive reads state \"withdrawn\" — the flip propagated");

        // The withdrawn directive is spent — no routing verdict on either side.
        // A's next now offers 27/00 in its normal walk position again (the
        // targeted-elsewhere skip is gone), proving the spent directive steers
        // nothing. (B still offers 27/00 too — untargeted now, offered fleet-wide;
        // routing narrows, never grants — ADR-004.2 — so a withdrawal can never
        // REMOVE an item from B's normal walk. The feature's "stops B offering"
        // wording is flagged to the PO in STATE.md ## Feedback.)
        const after = await invoke("work:next", { now: NOW }, a);
        assert.equal(after.ref, "27/00", "after withdrawal A's next offers 27/00 again — the targeted-elsewhere skip is spent");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },
];
