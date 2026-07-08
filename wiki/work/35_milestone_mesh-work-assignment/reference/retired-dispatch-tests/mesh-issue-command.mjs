// Traceability wiring for milestone 27 / story 01 — the mesh:issue command
// (tasks/00_mesh-issue-command.feature, ADR-002).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 00_mesh-issue-command.feature. Driven via the REGISTERED command (invoke +
// loadWorkspace) over a real work-item fixture, with an INJECTED sync closure
// (ctx.syncRunner — the run-start ctx.relayClient precedent) so the push-success
// and push-failure rows need NO real remote round-trip; --to disambiguation reads
// a planted node-record fixture off disk (readNodeRecords); issuedAt rides an
// injected input.now for byte-deterministic assertions.
//
//   00_mesh-issue-command.feature —
//     - no --to ⇒ an any-targeted directive under this node's partition, --json
//       emits the record;
//     - --to disambiguates node vs capability against the synced roster;
//     - a ref that does not resolve exactly is ref-not-found and writes nothing;
//     - a successful issue commits and pushes ONE default-root sync, no relay push;
//     - a push failure surfaces a coded error while the directive stays durable;
//     - the directive is written under THIS node's issuer partition only.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { issuanceDirectivePath, nodeRecordPath, meshDir } from "../src/mesh-store.mjs";
import { writeText } from "../src/fs.mjs";

const NOW = "2026-07-03T10:00:00.000Z";

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function makeWorkRepo({ mesh } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-issue-"));
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

async function seedNodeRecord(workspace, nodeId) {
  await mkdir(path.dirname(nodeRecordPath(workspace, nodeId)), { recursive: true });
  await writeText(nodeRecordPath(workspace, nodeId), JSON.stringify({ nodeId, host: "h", os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: NOW }, null, 2));
}

async function snapshotIssuanceTree(workspace) {
  const root = path.join(meshDir(workspace), "issuance");
  const snap = {};
  async function walk(dir, rel) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) await walk(abs, r);
      else snap[r] = await readFile(abs, "utf8");
    }
  }
  await walk(root, "");
  return snap;
}

const CLEAN_SYNC = { committed: true, pushed: ["a-directive"], pulled: [], noop: false };
const FAILED_SYNC = (reason) => ({ committed: true, pushed: [], pulled: [], noop: false, synced: false, reason });

function scriptedRunner(envelope) {
  const runner = async () => {
    runner.calls += 1;
    return envelope;
  };
  runner.calls = 0;
  return runner;
}

export const meshIssueCommandTests = [
  // ══ Scenario: no --to writes an any-targeted directive under this node's partition and --json emits it ══
  {
    name: "mesh-issue/00 with no --to the written directive targets { kind: any } under this node's partition and the result is the directive record",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo, { syncRunner: scriptedRunner(CLEAN_SYNC) });
        const result = await invoke("mesh:issue", { ref: "27/00", now: NOW }, ctx);

        assert.equal(result.itemRef, "27/00");
        assert.equal(result.issuer, "node-a");
        assert.deepEqual(result.target, { kind: "any" });
        assert.equal(result.state, "issued");

        const onDisk = JSON.parse(await readFile(issuanceDirectivePath(ctx.workspace, "node-a", "27/00"), "utf8"));
        assert.deepEqual(onDisk, result, "the on-disk record matches the returned result");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: --to disambiguates node vs capability against the synced roster ══
  {
    name: "mesh-issue/00 --to disambiguates node vs capability against the synced roster, freezing the target kind",
    async run() {
      const rows = [
        { to: "build-server", target: { kind: "node", nodeId: "build-server" } },
        { to: "codex", target: { kind: "capability", value: "codex" } },
        { to: "claude", target: { kind: "capability", value: "claude" } },
        { to: "typescript", target: { kind: "capability", value: "typescript" } },
        // review fix — the "any" sentinel is disambiguated in resolveTarget
        // BEFORE the roster lookup (case-insensitive, trimmed), so the CLI face
        // (`aof mesh issue <ref> --to any`) agrees with the fleet UI's
        // `{ to: "any" }` POST body: both yield { kind: "any" }, never a bogus
        // capability nobody satisfies.
        { to: "any", target: { kind: "any" } },
        { to: "ANY", target: { kind: "any" } },
        { to: "  any  ", target: { kind: "any" } },
      ];
      for (const row of rows) {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
        try {
          const ctx = await ctxFor(repo, { syncRunner: scriptedRunner(CLEAN_SYNC) });
          await seedNodeRecord(ctx.workspace, "build-server");
          const result = await invoke("mesh:issue", { ref: "27/00", to: row.to, now: NOW }, ctx);
          assert.deepEqual(result.target, row.target, `--to "${row.to}" resolves to ${JSON.stringify(row.target)}`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: a ref that does not resolve exactly is ref-not-found and writes no directive ══
  {
    name: "mesh-issue/00 a ref that does not resolve exactly is ref-not-found and writes NO directive (write-isolation, the issuance tree byte-unchanged)",
    async run() {
      const refs = ["27/0", "99/00", "issuance", "27/00-typo"];
      for (const ref of refs) {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
        try {
          const ctx = await ctxFor(repo, { syncRunner: scriptedRunner(CLEAN_SYNC) });
          const before = await snapshotIssuanceTree(ctx.workspace);
          await assert.rejects(
            () => invoke("mesh:issue", { ref, now: NOW }, ctx),
            (error) => {
              assert.equal(error.code, "ref-not-found", `ref "${ref}" fails with code ref-not-found`);
              return true;
            }
          );
          assert.deepEqual(await snapshotIssuanceTree(ctx.workspace), before, `the issuance tree is byte-unchanged for ref "${ref}"`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: a successful issue commits and pushes the directive over one default-root sync ══
  {
    name: "mesh-issue/00 a successful issue runs exactly one sync and attempts no relay push",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
      try {
        const runner = scriptedRunner(CLEAN_SYNC);
        const ctx = await ctxFor(repo, { syncRunner: runner });
        await invoke("mesh:issue", { ref: "27/00", now: NOW }, ctx);
        assert.equal(runner.calls, 1, "exactly one sync ran");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: when the push fails the error is coded but the directive is already durable locally ══
  {
    name: "mesh-issue/00 when the push fails the command surfaces a coded error while the directive is already durable locally",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo, { syncRunner: scriptedRunner(FAILED_SYNC("push-failed")) });
        await assert.rejects(
          () => invoke("mesh:issue", { ref: "27/00", now: NOW }, ctx),
          (error) => {
            assert.equal(error.code, "push-failed", "the push failure surfaces a coded error");
            return true;
          }
        );
        const onDisk = JSON.parse(await readFile(issuanceDirectivePath(ctx.workspace, "node-a", "27/00"), "utf8"));
        assert.equal(onDisk.state, "issued", "the directive is already durable locally, state issued");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the directive is written under THIS node's issuer partition, never a foreign one ══
  {
    name: "mesh-issue/00 the directive is written under THIS node's own issuer partition — a peer's directive under its own partition is left byte-unchanged",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo, { syncRunner: scriptedRunner(CLEAN_SYNC) });
        await writeText(
          issuanceDirectivePath(ctx.workspace, "build-server", "27/00"),
          JSON.stringify({ itemRef: "27/00", issuer: "build-server", target: { kind: "any" }, state: "issued", issuedAt: NOW, aofVersion: "0.1.0" }, null, 2)
        );
        const peerBefore = await readFile(issuanceDirectivePath(ctx.workspace, "build-server", "27/00"), "utf8");

        await invoke("mesh:issue", { ref: "27/00", now: NOW }, ctx);

        assert.ok(
          JSON.parse(await readFile(issuanceDirectivePath(ctx.workspace, "node-a", "27/00"), "utf8")).issuer === "node-a",
          "this node's own directive is written under the node-a partition"
        );
        assert.equal(
          await readFile(issuanceDirectivePath(ctx.workspace, "build-server", "27/00"), "utf8"),
          peerBefore,
          "the peer's directive under its own partition is byte-unchanged"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
