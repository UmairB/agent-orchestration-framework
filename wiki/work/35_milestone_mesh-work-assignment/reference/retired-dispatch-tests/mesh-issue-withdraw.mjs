// Traceability wiring for milestone 27 / story 01 — withdrawing an issued directive
// (tasks/01_directive-withdraw.feature, ADR-001.3).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 01_directive-withdraw.feature. Withdraw is driven via the registered mesh:issue
// command's `--withdraw` flag (input.withdraw), which orchestrates
// mesh-issuance.mjs's own-path withdrawDirective. The routing-consequence row
// (a withdrawn directive stops being offered) drives commands/next.mjs's unified
// candidacy view directly over a planted directive tree — the SAME lever task
// 02's routing feature depends on.
//
//   01_directive-withdraw.feature —
//     - withdraw flips the own directive's state to "withdrawn" without deleting;
//     - a withdrawn directive no longer targets the item — routing offers it
//       normally;
//     - withdrawing this node's directive leaves a peer's directive untouched;
//     - withdraw is idempotent-safe on an already-withdrawn or never-issued
//       directive.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { issuanceDirectivePath, nodeRecordPath } from "../src/mesh-store.mjs";
import { writeText } from "../src/fs.mjs";

const NOW = "2026-07-03T10:00:00.000Z";

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function makeWorkRepo({ mesh } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-withdraw-"));
  const workDir = path.join(repo, "wiki", "work");
  const mDir = path.join(workDir, "27_milestone_issuance");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "27", slug: "issuance", status: "in-progress", created: "2026-01-01", updated: "2026-01-02" })
  );
  const storyDir = path.join(mDir, "stories", "00_story_issue");
  await mkdir(storyDir, { recursive: true });
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter({ type: "story", number: "00", slug: "issue", status: "not-started", created: "2026-01-01", updated: "2026-01-02", parent: "27" })
  );
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (mesh !== undefined) config.mesh = mesh;
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir };
}

const ctxFor = async (repo, extra = {}) => ({ workspace: await loadWorkspace(repo), ...extra });

async function seedNodeRecord(workspace, nodeId, { runtimes = [], skills = [] } = {}) {
  await mkdir(path.dirname(nodeRecordPath(workspace, nodeId)), { recursive: true });
  await writeText(nodeRecordPath(workspace, nodeId), JSON.stringify({ nodeId, host: "h", os: "linux", runtimes, skills, aofVersion: "0.1.0", publishedAt: NOW }, null, 2));
}

async function writeDirective(workspace, issuer, itemRef, directive) {
  await writeText(issuanceDirectivePath(workspace, issuer, itemRef), JSON.stringify(directive, null, 2));
}

const CLEAN_SYNC = { committed: true, pushed: [], pulled: [], noop: false };
const noopRunner = async () => CLEAN_SYNC;

export const meshIssueWithdrawTests = [
  // ══ Scenario: withdrawing flips the own directive's state to "withdrawn" without deleting the file ══
  {
    name: "mesh-issue-withdraw/01 withdrawing flips the own directive's state to withdrawn without deleting the file — the other five keys unchanged",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo, { syncRunner: noopRunner });
        const original = { itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, state: "issued", issuedAt: NOW, aofVersion: "0.1.0" };
        await writeDirective(ctx.workspace, "node-a", "27/00", original);

        const result = await invoke("mesh:issue", { ref: "27/00", withdraw: true }, ctx);

        assert.equal(result.state, "withdrawn");
        const onDisk = JSON.parse(await readFile(issuanceDirectivePath(ctx.workspace, "node-a", "27/00"), "utf8"));
        assert.equal(onDisk.state, "withdrawn", "the file still exists with state withdrawn");
        assert.equal(onDisk.itemRef, original.itemRef);
        assert.equal(onDisk.issuer, original.issuer);
        assert.deepEqual(onDisk.target, original.target);
        assert.equal(onDisk.issuedAt, original.issuedAt);
        assert.equal(onDisk.aofVersion, original.aofVersion);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a withdrawn directive no longer targets the item — routing offers it in its normal walk position ══
  {
    name: "mesh-issue-withdraw/01 a withdrawn directive contributes no routing verdict — the routed candidacy view no longer skips it",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo, { syncRunner: noopRunner });
        await seedNodeRecord(ctx.workspace, "node-a", { runtimes: [], skills: [] });
        // Targeted at a capability this node does NOT advertise — targeted-elsewhere.
        await writeDirective(ctx.workspace, "node-a", "27/00", {
          itemRef: "27/00", issuer: "node-a", target: { kind: "capability", value: "codex" }, state: "issued", issuedAt: NOW, aofVersion: "0.1.0",
        });

        const before = await invoke("work:next", { now: NOW }, ctx);
        assert.notEqual(before.ref, "27/00", "before withdrawal the item is skipped here (targeted elsewhere)");

        await invoke("mesh:issue", { ref: "27/00", withdraw: true }, ctx);

        const after = await invoke("work:next", { now: NOW }, ctx);
        assert.equal(after.ref, "27/00", "after withdrawal the item is offered in its normal walk position");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: withdrawing this node's directive leaves a peer's directive for the same item untouched ══
  {
    name: "mesh-issue-withdraw/01 withdrawing this node's directive leaves a peer's directive for the same item byte-unchanged",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo, { syncRunner: noopRunner });
        await writeDirective(ctx.workspace, "node-a", "27/00", { itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, state: "issued", issuedAt: NOW, aofVersion: "0.1.0" });
        await writeDirective(ctx.workspace, "build-server", "27/00", { itemRef: "27/00", issuer: "build-server", target: { kind: "any" }, state: "issued", issuedAt: NOW, aofVersion: "0.1.0" });
        const peerBefore = await readFile(issuanceDirectivePath(ctx.workspace, "build-server", "27/00"), "utf8");

        await invoke("mesh:issue", { ref: "27/00", withdraw: true }, ctx);

        const own = JSON.parse(await readFile(issuanceDirectivePath(ctx.workspace, "node-a", "27/00"), "utf8"));
        assert.equal(own.state, "withdrawn");
        assert.equal(await readFile(issuanceDirectivePath(ctx.workspace, "build-server", "27/00"), "utf8"), peerBefore, "the peer's directive is byte-unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: withdraw is safe on an already-withdrawn or a never-issued directive ══
  {
    name: "mesh-issue-withdraw/01 withdraw is idempotent-safe on an already-withdrawn directive and absence-tolerant on a never-issued one",
    async run() {
      // issued -> flipped to withdrawn
      {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
        try {
          const ctx = await ctxFor(repo, { syncRunner: noopRunner });
          await writeDirective(ctx.workspace, "node-a", "27/00", { itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, state: "issued", issuedAt: NOW, aofVersion: "0.1.0" });
          const result = await invoke("mesh:issue", { ref: "27/00", withdraw: true }, ctx);
          assert.equal(result.state, "withdrawn");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // withdrawn -> re-written withdrawn (idempotent no-op flip)
      {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
        try {
          const ctx = await ctxFor(repo, { syncRunner: noopRunner });
          await writeDirective(ctx.workspace, "node-a", "27/00", { itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, state: "withdrawn", issuedAt: NOW, aofVersion: "0.1.0" });
          const result = await invoke("mesh:issue", { ref: "27/00", withdraw: true }, ctx);
          assert.equal(result.state, "withdrawn", "an already-withdrawn directive re-writes withdrawn (no-op flip)");
          assert.ok(await fileExists(issuanceDirectivePath(ctx.workspace, "node-a", "27/00")), "the file was not deleted");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // never issued (absent) -> a benign not-issued signal (nothing fabricated)
      {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
        try {
          const ctx = await ctxFor(repo, { syncRunner: noopRunner });
          const result = await invoke("mesh:issue", { ref: "27/00", withdraw: true }, ctx);
          assert.equal(result, null, "a never-issued directive yields a benign null — nothing fabricated");
          assert.ok(!(await fileExists(issuanceDirectivePath(ctx.workspace, "node-a", "27/00"))), "no directive file was fabricated");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
];

async function fileExists(p) {
  try {
    await readFile(p, "utf8");
    return true;
  } catch {
    return false;
  }
}
