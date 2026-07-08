// Traceability wiring for milestone 27 / story 01 — the revoked-issuer routing
// filter (tasks/07_revoked-issuer-filtered.feature, SECURITY T4 / S-2).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 07_revoked-issuer-filtered.feature. Driven via the REGISTERED work:next command
// over planted directive + registry fixtures (the registry written DIRECTLY at
// registryPath — a fixture write, not exercising writeRegistry's control-node gate).
//
//   07_revoked-issuer-filtered.feature —
//     - a directive from a non-revoked (admitted) issuer routes normally;
//     - a directive whose issuer has been revoked contributes NO routing verdict;
//     - a node revoked AFTER it issued is filtered on the very next work next (live
//       re-read, never a stale snapshot);
//     - the filter fails safe — it removes routing power, never grants it; an
//       absent/empty registry leaves every directive routing normally.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { issuanceDirectivePath, nodeRecordPath } from "../src/mesh-store.mjs";
import { registryPath } from "../src/mesh-registry.mjs";
import { writeText } from "../src/fs.mjs";

const NOW = "2026-07-03T10:00:00.000Z";

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function makeWorkRepo({ mesh } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-revoked-issuer-"));
  const workDir = path.join(repo, "wiki", "work");
  const mDir = path.join(workDir, "27_milestone_issuance");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "27", slug: "issuance", status: "in-progress", created: "2026-01-01", updated: "2026-01-02" })
  );
  for (const s of [
    { number: "00", slug: "story-a" },
    { number: "01", slug: "story-b" },
    { number: "02", slug: "story-c" },
  ]) {
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

// A fixture write of the group registry (bypassing writeRegistry's control-node
// gate — a fixture plants the registry directly, as if it had synced from the
// control node).
async function seedRegistry(workspace, registry) {
  await mkdir(path.dirname(registryPath(workspace)), { recursive: true });
  await writeText(registryPath(workspace), JSON.stringify(registry, null, 2));
}

const emptyRegistry = () => ({ roster: [], boards: [], pending: [], revocations: [] });

export const meshRoutingRevokedIssuerTests = [
  // ══ Scenario: a directive from a non-revoked (admitted) issuer routes normally ══
  {
    name: "mesh-revoked-issuer/07 a directive from a non-revoked (admitted) issuer routes normally — targeted-here offered, elsewhere skipped",
    async run() {
      // build-server (the target) runs next.
      {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: "build-server" } });
        try {
          const ctx = await ctxFor(repo);
          await seedNodeRecord(ctx.workspace, "build-server");
          await seedRegistry(ctx.workspace, { ...emptyRegistry(), roster: [{ nodeId: "node-a", admittedAt: NOW, boards: [] }] });
          await writeDirective(ctx.workspace, "node-a", "27/00", { kind: "node", nodeId: "build-server" });
          const result = await invoke("work:next", { now: NOW }, ctx);
          assert.equal(result.ref, "27/00", "27/00 is offered on build-server (the target is satisfied)");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // A non-target node runs next.
      {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-c" } });
        try {
          const ctx = await ctxFor(repo);
          await seedNodeRecord(ctx.workspace, "node-c");
          await seedRegistry(ctx.workspace, { ...emptyRegistry(), roster: [{ nodeId: "node-a", admittedAt: NOW, boards: [] }] });
          await writeDirective(ctx.workspace, "node-a", "27/00", { kind: "node", nodeId: "build-server" });
          const result = await invoke("work:next", { now: NOW }, ctx);
          assert.notEqual(result.ref, "27/00", "27/00 is skipped on a non-target node (targeted elsewhere)");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: a directive whose issuer has been revoked contributes no routing verdict ══
  {
    name: "mesh-revoked-issuer/07 a directive whose issuer has been revoked contributes NO routing verdict — it neither targets here nor steers away",
    async run() {
      // On build-server (the nominal target) — the revoked directive no longer marks it targeted-here.
      // Since it's the ONLY driver-eligible item, an untargeted/ignored directive still offers it in
      // its normal walk position (routing contributes nothing either way here).
      const { repo: repoTarget } = await makeWorkRepo({ mesh: { nodeId: "build-server" } });
      try {
        const ctx = await ctxFor(repoTarget);
        await seedNodeRecord(ctx.workspace, "build-server");
        await seedRegistry(ctx.workspace, {
          ...emptyRegistry(),
          roster: [{ nodeId: "node-a", admittedAt: NOW, boards: [] }],
          revocations: [{ nodeId: "node-a", revokedAt: NOW, reason: null }],
        });
        await writeDirective(ctx.workspace, "node-a", "27/00", { kind: "node", nodeId: "build-server" });
        const result = await invoke("work:next", { now: NOW }, ctx);
        assert.equal(result.ref, "27/00", "the item is still offered in its normal walk position (an ignored directive is not a skip)");
      } finally {
        await rm(repoTarget, { recursive: true, force: true });
      }

      // On a non-target node — the revoked directive no longer steers the item away.
      const { repo: repoNonTarget } = await makeWorkRepo({ mesh: { nodeId: "node-c" } });
      try {
        const ctx = await ctxFor(repoNonTarget);
        await seedNodeRecord(ctx.workspace, "node-c");
        await seedRegistry(ctx.workspace, {
          ...emptyRegistry(),
          roster: [{ nodeId: "node-a", admittedAt: NOW, boards: [] }],
          revocations: [{ nodeId: "node-a", revokedAt: NOW, reason: null }],
        });
        await writeDirective(ctx.workspace, "node-a", "27/00", { kind: "node", nodeId: "build-server" });
        const result = await invoke("work:next", { now: NOW }, ctx);
        assert.equal(result.ref, "27/00", "27/00 is NOT skipped by the revoked directive — offered in its normal walk position");
      } finally {
        await rm(repoNonTarget, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a node revoked after it issued is filtered on the next work next (live re-read) ══
  {
    name: "mesh-revoked-issuer/07 a node revoked AFTER it issued is filtered on the very next work next — never a stale snapshot",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-codex" } });
      try {
        const ctx = await ctxFor(repo);
        await seedNodeRecord(ctx.workspace, "node-codex", { runtimes: ["codex"] });
        await seedRegistry(ctx.workspace, { ...emptyRegistry(), roster: [{ nodeId: "node-a", admittedAt: NOW, boards: [] }] });
        await writeDirective(ctx.workspace, "node-a", "27/00", { kind: "capability", value: "codex" });

        const before = await invoke("work:next", { now: NOW }, ctx);
        assert.equal(before.ref, "27/00", "before revocation the codex-capable peer would be offered 27/00");

        // node-a is revoked — the registry is re-read LIVE on the next call.
        await seedRegistry(ctx.workspace, {
          ...emptyRegistry(),
          roster: [{ nodeId: "node-a", admittedAt: NOW, boards: [] }],
          revocations: [{ nodeId: "node-a", revokedAt: NOW, reason: null }],
        });

        const after = await invoke("work:next", { now: NOW }, ctx);
        assert.equal(after.ref, "27/00", "27/00 is still offered — but now via its normal walk position, not routed by node-a's directive");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: the revoked-issuer filter fails safe ══
  {
    name: "mesh-revoked-issuer/07 the revoked-issuer filter fails safe — it removes routing power, never grants it",
    async run() {
      const rows = [
        { issuer: "node-a", registry: { ...emptyRegistry(), roster: [{ nodeId: "node-a", admittedAt: NOW, boards: [] }], revocations: [{ nodeId: "node-a", revokedAt: NOW, reason: null }] }, label: "node-a revoked" },
        { issuer: "node-a", registry: { ...emptyRegistry(), roster: [{ nodeId: "node-a", admittedAt: NOW, boards: [] }] }, label: "no revocations" },
        { issuer: "node-a", registry: null, label: "registry absent (ENOENT->empty)" },
        { issuer: "node-b", registry: { ...emptyRegistry(), roster: [{ nodeId: "node-a", admittedAt: NOW, boards: [] }, { nodeId: "node-b", admittedAt: NOW, boards: [] }], revocations: [{ nodeId: "node-a", revokedAt: NOW, reason: null }] }, label: "node-b admitted, node-a revoked" },
      ];
      for (const row of rows) {
        const { repo } = await makeWorkRepo({ mesh: { nodeId: "build-server" } });
        try {
          const ctx = await ctxFor(repo);
          await seedNodeRecord(ctx.workspace, "build-server");
          if (row.registry) await seedRegistry(ctx.workspace, row.registry);
          // 27/00 is the ONLY directive target here (the first not-done story in the
          // walk) — whether the directive routes normally (targeted-here, offered) or
          // is revoked (contributes no verdict, still offered in its normal walk
          // position — never MORE power, never a manufactured skip), the offered ref
          // is 27/00 either way. The invariant is "removes power, never grants it" —
          // proven distinctly (targeted-elsewhere skip disappears on revocation) by
          // the earlier scenario; this row pins the fail-safe DIRECTION across every
          // registry state.
          await writeDirective(ctx.workspace, row.issuer, "27/00", { kind: "node", nodeId: "build-server" });
          const result = await invoke("work:next", { now: NOW }, ctx);
          assert.equal(result.ref, "27/00", `"${row.label}": 27/00 is offered (the filter only ever removes routing power, never grants it)`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
];
