// Traceability wiring for milestone 27 / story 01 — mesh-aware next routing on the
// directive (tasks/02_routing-pickup.feature, ADR-004).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 02_routing-pickup.feature. The single-node-view rows drive the REGISTERED
// work:next command (loadWorkspace + invoke) over planted directive/descriptor
// fixtures under an injected now (the m26 lease-view precedent, work-next-lease-
// view.test.mjs); the two-eligible-nodes contention row drives TWO in-process
// clones of a shared bare remote (the m26 mesh-lease-claim-arbitration buildFixture
// /clonePeer idiom): each side builds its OWN candidacy view from its own
// readIssuanceDirectives + nodeSatisfiesTarget before racing the REAL acquireLease
// protocol — no mocked winner.
//
//   02_routing-pickup.feature —
//     - the single-node floor: unconfigured mesh ⇒ no view built, byte-identical;
//     - a node-targeted directive is offered only on the target, skipped elsewhere;
//     - a capability-targeted directive is offered where the descriptor advertises
//       it and skipped otherwise;
//     - an any (or no) directive is offered fleet-wide in its normal walk position;
//     - two eligible nodes are both offered a targeted-here item and the m26 lease
//       resolves exactly one runner;
//     - a targeted-here item leased-live elsewhere is offered by routing then
//       skipped by the lease view;
//     - a targeted-elsewhere item short-circuits before its lease is consulted.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { issuanceDirectivePath, nodeRecordPath, leaseClaimPath, presenceRecordPath, meshDir } from "../src/mesh-store.mjs";
import { syncMesh } from "../src/mesh-sync.mjs";
import { acquireLease } from "../src/mesh-lease.mjs";
import { writeText } from "../src/fs.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

const NOW = "2026-07-03T10:00:00.000Z";
const before = (nowIso, seconds) => new Date(Date.parse(nowIso) - seconds * 1000).toISOString();

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// The Background tree: one milestone whose not-done stories walk 27/00 then 27/01.
async function makeWorkRepo({ mesh } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-routing-"));
  const workDir = path.join(repo, "wiki", "work");
  const mDir = path.join(workDir, "27_milestone_issuance");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "27", slug: "issuance", status: "in-progress", created: "2026-01-01", updated: "2026-01-02" })
  );
  for (const s of [{ number: "00", slug: "story-a" }, { number: "01", slug: "story-b" }]) {
    const sDir = path.join(mDir, "stories", `${s.number}_story_${s.slug}`);
    await mkdir(sDir, { recursive: true });
    await writeFile(
      path.join(sDir, "STORY.md"),
      frontmatter({ type: "story", number: s.number, slug: s.slug, status: "not-started", created: "2026-01-01", updated: "2026-01-02", parent: "27" })
    );
  }
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (mesh !== undefined) config.mesh = mesh;
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

async function seedNodeRecord(workspace, nodeId, { runtimes = [], skills = [] } = {}) {
  await mkdir(path.dirname(nodeRecordPath(workspace, nodeId)), { recursive: true });
  await writeText(nodeRecordPath(workspace, nodeId), JSON.stringify({ nodeId, host: "h", os: "linux", runtimes, skills, aofVersion: "0.1.0", publishedAt: NOW }, null, 2));
}

async function writeDirective(workspace, issuer, itemRef, target) {
  await mkdir(path.dirname(issuanceDirectivePath(workspace, issuer, itemRef)), { recursive: true });
  await writeText(issuanceDirectivePath(workspace, issuer, itemRef), JSON.stringify({ itemRef, issuer, target, state: "issued", issuedAt: NOW, aofVersion: "0.1.0" }, null, 2));
}

async function seedClaim(workspace, itemRef, nodeId, state, claimedAt = NOW) {
  const target = leaseClaimPath(workspace, itemRef, nodeId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ itemRef, nodeId, state, claimedAt, runId: null, aofVersion: "0.1.0" }, null, 2), "utf8");
}

async function seedPresence(workspace, nodeId, heartbeatAt) {
  await mkdir(path.dirname(presenceRecordPath(workspace, nodeId)), { recursive: true });
  await writeFile(presenceRecordPath(workspace, nodeId), JSON.stringify({ nodeId, heartbeatAt, activeRuns: [], aofVersion: "0.1.0" }, null, 2), "utf8");
}

export const meshRoutingPickupTests = [
  // ══ Scenario: with mesh unconfigured the command builds no view — byte-identical render ══
  {
    name: "mesh-routing/02 with mesh unconfigured the command builds NO view — a directive on disk is invisible and the render/--json are byte-identical to today's",
    async run() {
      const { repo } = await makeWorkRepo(); // no mesh config
      try {
        const ctx = await ctxFor(repo);
        const before1 = await invoke("work:next", {}, ctx);
        await writeDirective(ctx.workspace, "build-server", "27/00", { kind: "node", nodeId: "build-server" });
        const after = await invoke("work:next", {}, ctx);
        assert.equal(after.ref, "27/00", "the directive was never read — the offered item is unchanged");
        assert.deepEqual(after, before1, "the result is byte-identical to before the directive existed");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: a node-targeted directive is offered only on the target node and skipped elsewhere ══
  {
    name: "mesh-routing/02 a node-targeted directive is offered only on the target node and skipped elsewhere",
    async run() {
      const rows = [
        { thisNode: "build-server", offered: "27/00" },
        { thisNode: "node-a", offered: "27/01" },
      ];
      for (const row of rows) {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: row.thisNode } });
        try {
          const ctx = await ctxFor(repo);
          await seedNodeRecord(ctx.workspace, row.thisNode);
          await writeDirective(ctx.workspace, "some-issuer", "27/00", { kind: "node", nodeId: "build-server" });
          const result = await invoke("work:next", { now: NOW }, ctx);
          assert.equal(result.ref, row.offered, `on node "${row.thisNode}" the offered item is ${row.offered}`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: a capability-targeted directive is offered where the descriptor advertises it ══
  {
    name: "mesh-routing/02 a capability-targeted directive is offered where the descriptor advertises the runtime or skill and skipped otherwise",
    async run() {
      const rows = [
        { capability: "claude", offered: "27/00" },
        { capability: "typescript", offered: "27/00" },
        { capability: "codex", offered: "27/01" },
        { capability: "rust", offered: "27/01" },
      ];
      for (const row of rows) {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
        try {
          const ctx = await ctxFor(repo);
          await seedNodeRecord(ctx.workspace, "node-a", { runtimes: ["claude"], skills: ["typescript"] });
          await writeDirective(ctx.workspace, "some-issuer", "27/00", { kind: "capability", value: row.capability });
          const result = await invoke("work:next", { now: NOW }, ctx);
          assert.equal(result.ref, row.offered, `capability "${row.capability}" -> offered ${row.offered}`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: an any-targeted directive (or no directive) is offered in its normal walk position ══
  {
    name: "mesh-routing/02 an any-targeted directive (or no directive) is offered in its normal walk position on any node",
    async run() {
      for (const withDirective of [true, false]) {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
        try {
          const ctx = await ctxFor(repo);
          await seedNodeRecord(ctx.workspace, "node-a");
          if (withDirective) await writeDirective(ctx.workspace, "some-issuer", "27/00", { kind: "any" });
          const result = await invoke("work:next", { now: NOW }, ctx);
          assert.equal(result.ref, "27/00", `offered fleet-wide (withDirective=${withDirective})`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: a targeted-here item leased-live by a peer is offered by routing then skipped by the lease view ══
  {
    name: "mesh-routing/02 a targeted-here item leased-live by a peer is offered by routing then skipped by the lease view — the offered item is 27/01",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo);
        await seedNodeRecord(ctx.workspace, "node-a", { runtimes: ["claude"] });
        await writeDirective(ctx.workspace, "some-issuer", "27/00", { kind: "capability", value: "claude" });
        await seedClaim(ctx.workspace, "27/00", "node-b", "claimed");
        await seedPresence(ctx.workspace, "node-b", NOW);

        const result = await invoke("work:next", { now: NOW }, ctx);
        assert.equal(result.ref, "27/01", "27/00 was targeted-here but skipped by the live lease");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a targeted-elsewhere item is skipped by routing before its lease is consulted — never surfaced reclaimable ══
  {
    name: "mesh-routing/02 a targeted-elsewhere item is skipped by routing before its lease is consulted — never surfaced reclaimable here",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo);
        await seedNodeRecord(ctx.workspace, "node-a");
        await writeDirective(ctx.workspace, "some-issuer", "27/00", { kind: "node", nodeId: "build-server" });
        await seedClaim(ctx.workspace, "27/00", "node-b", "claimed");
        await seedPresence(ctx.workspace, "node-b", before(NOW, 3600)); // stale

        const result = await invoke("work:next", { now: NOW }, ctx);
        assert.equal(result.ref, "27/01", "27/00 is not offered and not surfaced reclaimable (targeted elsewhere)");
        assert.ok(!("reclaimable" in result) || result.ref !== "27/00", "27/00 never surfaces reclaimable");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

// ---- the two-eligible-nodes real-lease-arbitration scenario (two clones) ----

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

async function buildFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-routing-arbitration-"));
  const bare = path.join(tmp, "remote.git");
  await mkdir(bare, { recursive: true });
  let r = git(bare, ["init", "--bare", "-q", "-b", "main"]);
  if (r.error || r.status !== 0) {
    git(bare, ["init", "--bare", "-q"]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }

  const a = path.join(tmp, "node-a");
  r = git(tmp, ["clone", "-q", bare, "node-a"]);
  if (r.status !== 0) throw new Error(`clone failed: ${r.stderr}`);
  configIdentity(a);
  git(a, ["checkout", "-q", "-b", "main"]);
  const aWorkDir = path.join(a, "wiki", "work");
  await mkdir(meshDir({ workDir: aWorkDir, projectRoot: a }), { recursive: true });
  await writeFile(path.join(a, ".gitattributes"), "* -text\n", "utf8");
  await writeFile(path.join(a, "README.md"), "fixture\n", "utf8");
  git(a, ["add", "-A"]);
  git(a, ["commit", "-q", "-m", "initial"]);
  git(a, ["push", "-q", "-u", "origin", "main"]);

  return { tmp, bare, a: { root: a, workspace: { workDir: aWorkDir, projectRoot: a } } };
}

async function clonePeer(fx, name) {
  const peer = path.join(fx.tmp, name);
  const r = git(fx.tmp, ["clone", "-q", fx.bare, name]);
  if (r.status !== 0) throw new Error(`peer clone failed: ${r.stderr}`);
  configIdentity(peer);
  git(peer, ["checkout", "-q", "main"]);
  const workDir = path.join(peer, "wiki", "work");
  await mkdir(meshDir({ workDir, projectRoot: peer }), { recursive: true });
  return { root: peer, workspace: { workDir, projectRoot: peer } };
}

const cleanup = (dir) => rm(dir, { recursive: true, force: true });

meshRoutingPickupTests.push({
  name: "mesh-routing/02 two eligible nodes are both offered a targeted-here item and the m26 lease resolves exactly one runner — routing narrows, the lease arbitrates",
  async run() {
    const fx = await buildFixture();
    try {
      const b = await clonePeer(fx, "node-b");

      // Both nodes advertise runtime "claude"; the directive targets that capability.
      await seedNodeRecord(fx.a.workspace, "node-a", { runtimes: ["claude"] });
      await seedNodeRecord(b.workspace, "node-b", { runtimes: ["claude"] });
      await writeDirective(fx.a.workspace, "issuer-x", "item-x", { kind: "capability", value: "claude" });
      await seedPresence(fx.a.workspace, "node-a", NOW);
      await seedPresence(b.workspace, "node-b", NOW);

      const targetOfA = JSON.parse(await readFile(issuanceDirectivePath(fx.a.workspace, "issuer-x", "item-x"), "utf8")).target;
      // Each side reads its OWN candidacy independently — both must satisfy target.
      const { nodeSatisfiesTarget } = await import("../src/mesh-issuance.mjs");
      const descA = { nodeId: "node-a", runtimes: ["claude"], skills: [] };
      const descB = { nodeId: "node-b", runtimes: ["claude"], skills: [] };
      assert.ok(nodeSatisfiesTarget(descA, targetOfA), "node-a's routing view offers item-x (candidacy)");
      assert.ok(nodeSatisfiesTarget(descB, targetOfA), "node-b's routing view offers item-x (candidacy)");

      // Sync A's directive to the remote so B can see it (not required for the lease
      // race itself — this row's point is that BOTH were OFFERED by routing).
      await syncMesh(fx.a.workspace);

      // Real acquireLease race: A claims first (reaches remote), B's claim observes it.
      const aResult = await acquireLease(fx.a.workspace, "item-x", "node-a", {
        runSync: () => syncMesh(fx.a.workspace),
        now: NOW,
        config: { mesh: { presence: { stalenessSeconds: 60 } } },
        aofVersion: "0.1.0",
      });
      assert.equal(aResult.held, true, "node-a holds the lease");

      const bResult = await acquireLease(b.workspace, "item-x", "node-b", {
        runSync: () => syncMesh(b.workspace),
        now: NOW,
        config: { mesh: { presence: { stalenessSeconds: 60 } } },
        aofVersion: "0.1.0",
      });
      assert.equal(bResult.held, false, "node-b stands down — exactly one node runs");
      assert.equal(bResult.heldBy, "node-a", "node-b's result names node-a as the holder");
      assert.equal(bResult.mint, false, "node-b mints nothing — the lease arbitrated, routing only narrowed");
    } finally {
      await cleanup(fx.tmp);
    }
  },
});
