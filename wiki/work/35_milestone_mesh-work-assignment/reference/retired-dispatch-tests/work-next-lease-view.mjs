// Traceability wiring for milestone 26 / story 01 — mesh-aware work:next through an
// optional injected lease view (tasks/02_mesh-aware-next.feature, ADR-005).
//
// RIPPLE (milestone 27 / story 01, ADR-004): `nextWork`'s third argument was
// RENAMED/WIDENED from `{ leaseView }` to `{ candidacyView }` (the m27 unified
// candidacy view — lease state + routing verdict on ONE Map). This file's direct
// `nextWork(work, scope, { leaseView })` calls are updated to `{ candidacyView }`
// so the SAME hand-built Maps still reach the walk (the shape they carry —
// { state, holder } — is byte-identical; m27 only adds an OPTIONAL `routed` key
// this file never sets, so every assertion below is unperturbed).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 02_mesh-aware-next.feature. The core-walk rows drive the REAL nextWork over the
// work-next buildStream temp fixture with HAND-BUILT view Maps (the resolved QA
// flag: the view crosses the seam as PLAIN DATA — Map<itemRef, { state, holder }>,
// absence = unleased); the hint rows drive the PURE buildLeaseView with a
// cache-shaped hint injected as data (disk-first, add-skip-only); the config-gate
// rows drive the REGISTERED work:next command (loadWorkspace + invoke) over disk
// claim/presence fixtures under an injected now.
//
//   02_mesh-aware-next.feature —
//     - THE SINGLE-NODE FLOOR: no lease view ⇒ byte-identical results across
//       ready/blocked/done, zero lease-derived keys;
//     - leased-live ⇒ skipped exactly as not-actionable, the following candidate
//       offered, no reclaim annotation;
//     - ALL LEASED ⇒ the honest nothing-actionable shape — never a false
//       milestone-accept;
//     - leased-stale ⇒ offered ready + { reclaimable: true, leasedBy } in its
//       normal walk position, next writing NOTHING;
//     - the hint matrix: silence never unleases (git wins) / the hint adds a skip /
//       the null row offers;
//     - THE CONFIG GATE: unconfigured ⇒ no view built, lease files invisible,
//       render + --json byte-identical; configured ⇒ the same tree's leased item
//       is skipped.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nextWork, loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { nextCommand } from "../src/commands/next.mjs";
import { meshDir, leaseClaimPath, presenceRecordPath } from "../src/mesh-store.mjs";
import { buildLeaseView } from "../src/mesh-lease.mjs";

const NOW = "2026-07-02T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const before = (nowIso, seconds) => new Date(Date.parse(nowIso) - seconds * 1000).toISOString();

// ---- the work-next buildStream fixture (test/work-next.test.mjs verbatim) ----

function frontmatter(fields) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

async function buildStream(drivers) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-next-lease-"));
  const work = path.join(root, "work");
  for (const d of drivers) {
    const type = d.type ?? "milestone";
    const slug = d.slug ?? `${type}-${d.number}`;
    const dir = path.join(work, `${d.number}_${type}_${slug}`);
    await mkdir(dir, { recursive: true });
    const doc = type === "uat" ? "SESSION.md" : "SPEC.md";
    await writeFile(
      path.join(dir, doc),
      frontmatter({
        type, number: d.number, slug, status: d.status,
        created: "2026-01-01", updated: "2026-01-02",
        ...(d.depends ? { depends: d.depends } : {}),
      })
    );
    if (type === "milestone" && Array.isArray(d.stories)) {
      for (const s of d.stories) {
        const sSlug = s.slug ?? `story-${s.number}`;
        const sDir = path.join(dir, "stories", `${s.number}_story_${sSlug}`);
        await mkdir(sDir, { recursive: true });
        await writeFile(
          path.join(sDir, "STORY.md"),
          frontmatter({
            type: "story", number: s.number, slug: sSlug, status: s.status,
            created: "2026-01-01", updated: "2026-01-02", parent: d.number,
          })
        );
      }
    }
  }
  return { root, work };
}

async function withStream(drivers, body) {
  const { root, work } = await buildStream(drivers);
  try {
    return await body(work);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// The Background tree: one milestone whose not-done stories walk story-a then story-b.
const TWO_STORY_TREE = [
  {
    number: "00",
    status: "in-progress",
    stories: [
      { number: "00", slug: "story-a", status: "not-started" },
      { number: "01", slug: "story-b", status: "not-started" },
    ],
  },
];

// ---- the command-row fixture: a real repo (loadWorkspace + invoke) ----

async function makeWorkRepo({ mesh } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-next-cmd-"));
  const workDir = path.join(repo, "wiki", "work");
  const mDir = path.join(workDir, "00_milestone_m0");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "00", slug: "m0", status: "in-progress", created: "2026-01-01", updated: "2026-01-02" })
  );
  for (const s of [{ number: "00", slug: "story-a" }, { number: "01", slug: "story-b" }]) {
    const sDir = path.join(mDir, "stories", `${s.number}_story_${s.slug}`);
    await mkdir(sDir, { recursive: true });
    await writeFile(
      path.join(sDir, "STORY.md"),
      frontmatter({ type: "story", number: s.number, slug: s.slug, status: "not-started", created: "2026-01-01", updated: "2026-01-02", parent: "00" })
    );
  }
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (mesh !== undefined) config.mesh = mesh;
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

async function seedClaim(workspace, itemRef, nodeId, state = "claimed") {
  const target = leaseClaimPath(workspace, itemRef, nodeId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify({ itemRef, nodeId, state, claimedAt: before(NOW, 3600), runId: null, aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

async function seedPresence(workspace, nodeId, heartbeatAt) {
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(
    presenceRecordPath(workspace, nodeId),
    JSON.stringify({ nodeId, heartbeatAt, activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

async function snapshotTree(workspace) {
  const root = meshDir(workspace);
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

const liveView = (entries) => new Map(entries);

export const workNextLeaseViewTests = [
  // ══ Scenario Outline: with no lease view the next result is byte-identical to today ══
  {
    name: "work-next-lease/02 with NO lease view the result is byte-identical to today across ready/blocked/done — and carries no lease-derived key",
    async run() {
      const trees = {
        ready: [{ number: "00", status: "in-progress", stories: [{ number: "00", slug: "story-a", status: "not-started" }] }],
        blocked: [
          { number: "00", status: "in-progress" },
          { number: "01", status: "not-started", depends: ["00"] },
        ],
        done: [{ number: "00", status: "done" }],
      };
      const expectedState = { ready: "ready", blocked: "blocked", done: "done" };
      for (const [label, drivers] of Object.entries(trees)) {
        await withStream(drivers, async (work) => {
          // Scope "01" for the blocked tree (the blocked driver), unscoped otherwise.
          const scope = label === "blocked" ? "01" : undefined;
          const twoArg = await nextWork(work, scope);
          const absentView = await nextWork(work, scope, {});
          // JSON.stringify both sides (review QA N3): deepEqual is key-order-blind;
          // the stringified compare pins key order too — byte-identical, literally.
          assert.equal(
            JSON.stringify(absentView),
            JSON.stringify(twoArg),
            `the "${label}" result is byte-identical with the view absent`
          );
          assert.equal(twoArg.state, expectedState[label], `today's next answers "${label}"`);
          assert.ok(!("reclaimable" in twoArg), `no reclaimable key leaks into the "${label}" shape`);
          assert.ok(!("leasedBy" in twoArg), `no leasedBy key leaks into the "${label}" shape`);
        });
      }
    },
  },

  // ══ Scenario: an item leased by a live peer is skipped and the following candidate offered ══
  {
    name: "work-next-lease/02 an item leased by a live peer is skipped exactly as not-actionable — the following candidate is offered with no reclaim annotation",
    run: () =>
      withStream(TWO_STORY_TREE, async (work) => {
        const candidacyView = liveView([["00/00", { state: "leased-live", holder: "node-b" }]]);
        const next = await nextWork(work, undefined, { candidacyView });
        assert.equal(next.state, "ready", "the walk still offers a ready item");
        assert.equal(next.ref, "00/01", "the offered item is story-b (story-a was passed over as not-actionable)");
        assert.equal(next.slug, "story-b", "the offered item is story-b by slug too");
        assert.ok(!("reclaimable" in next), "the offered result carries no reclaimable annotation");
      }),
  },

  // ══ Scenario: with every actionable story leased by live peers next offers nothing ══
  {
    name: "work-next-lease/02 with every actionable story leased by live peers next offers NOTHING — never a false milestone-accept; the honest nothing-actionable shape",
    run: () =>
      withStream(TWO_STORY_TREE, async (work) => {
        const candidacyView = liveView([
          ["00/00", { state: "leased-live", holder: "node-b" }],
          ["00/01", { state: "leased-live", holder: "node-c" }],
        ]);
        const next = await nextWork(work, undefined, { candidacyView });
        assert.notEqual(next.state, "ready", "no leased item is offered");
        assert.notEqual(next.ref, "00", "the milestone is NOT offered as ready-for-acceptance (its stories are being worked, not done)");
        assert.deepEqual(next, { state: "done" }, "the result is the honest nothing-actionable shape");
      }),
  },

  // ══ Scenario: an item leased by a stale peer is offered ready and reclaimable — and next writes nothing ══
  // Driven at the COMMAND face over disk fixtures so the "next writes nothing"
  // byte-unchanged assertion covers the REAL lease/presence tree.
  {
    name: "work-next-lease/02 an item leased by a stale peer is offered ready+reclaimable in its normal walk position, naming the holder — and next writes nothing",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a", presence: { stalenessSeconds: 60 } } });
      try {
        const ctx = await ctxFor(repo);
        // story-a is leased by node-b whose presence is STALE (leased-stale).
        await seedClaim(ctx.workspace, "00/00", "node-b", "claimed");
        await seedPresence(ctx.workspace, "node-b", before(NOW, 600));
        const treeBefore = await snapshotTree(ctx.workspace);

        const result = await invoke("work:next", { now: NOW }, ctx);

        assert.equal(result.state, "ready", "the stale-leased item is offered ready");
        assert.equal(result.ref, "00/00", "the offered item is story-a (a stale lease never demotes the walk order)");
        assert.equal(result.reclaimable, true, "the result carries reclaimable true");
        assert.equal(result.leasedBy, "node-b", "the result carries leasedBy node-b");
        assert.deepEqual(await snapshotTree(ctx.workspace), treeBefore, "the lease and presence tree is byte-unchanged (next is a read — the claim path reclaims, never next)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: a cache-shaped hint can only add a skip ══
  {
    name: "work-next-lease/02 a cache-shaped hint can only ADD a skip — git wins, the hint never unleases (silence keeps the disk skip / the hint adds a skip / the null row offers)",
    async run() {
      const freshPresence = new Map([["node-b", { nodeId: "node-b", heartbeatAt: NOW, activeRuns: [], aofVersion: "0.1.0" }]]);
      const diskClaim = { itemRef: "00/00", nodeId: "node-b", state: "claimed", claimedAt: before(NOW, 3600), runId: null, aofVersion: "0.1.0" };
      const rows = [
        {
          label: "leased-live on disk, hint silent — git wins, still skipped",
          claims: [diskClaim],
          hint: new Map(),
          offered: "00/01",
        },
        {
          label: "unleased on disk, hint names story-a — the hint adds the skip",
          claims: [],
          hint: new Map([["00/00", { itemRef: "00/00", nodeId: "node-b", state: "claimed" }]]),
          offered: "00/01",
        },
        {
          label: "unleased on disk, hint silent — offered",
          claims: [],
          hint: new Map(),
          offered: "00/00",
        },
      ];
      for (const row of rows) {
        await withStream(TWO_STORY_TREE, async (work) => {
          const candidacyView = buildLeaseView(row.claims, freshPresence, {
            nowMs: NOW_MS,
            thresholdMs: 60 * 1000,
            hint: row.hint,
          });
          const next = await nextWork(work, undefined, { candidacyView });
          assert.equal(next.ref, row.offered, `the offered item is ${row.offered} (${row.label})`);
          // The hint direction is fail-safe: a hint-added entry is a SKIP, never a
          // reclaimable offer.
          assert.ok(!("reclaimable" in next), `the hint never marks an item reclaimable (${row.label})`);
        });
      }
    },
  },

  // ══ Scenario: with mesh unconfigured the command builds no view — lease files are invisible ══
  {
    name: "work-next-lease/02 with mesh unconfigured the command builds NO view — lease files on disk are invisible, and render + --json are byte-identical to today's for that tree",
    async run() {
      const { repo } = await makeWorkRepo(); // no mesh config at all
      try {
        const ctx = await ctxFor(repo);
        // Today's baseline for THIS tree — before any lease bytes exist.
        const today = await invoke("work:next", {}, ctx);
        const todayRender = nextCommand.cli.render(today, {});
        const todayJson = JSON.stringify(nextCommand.cli.json(today));

        // The same bytes that skip an item under a configured mesh…
        await seedClaim(ctx.workspace, "00/00", "node-b", "claimed");
        await seedPresence(ctx.workspace, "node-b", NOW);

        const result = await invoke("work:next", {}, ctx);
        assert.equal(result.ref, "00/00", "the offered item is story-a (the lease was never read)");
        assert.equal(nextCommand.cli.render(result, {}), todayRender, "the human render is byte-identical to today's for that tree");
        assert.equal(JSON.stringify(nextCommand.cli.json(result)), todayJson, "the --json result is byte-identical to today's for that tree");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: with mesh configured the same tree's leased item is skipped ══
  {
    name: "work-next-lease/02 with mesh configured the SAME tree's leased item is skipped by the command — the gate is the only difference",
    async run() {
      const { repo } = await makeWorkRepo({ mesh: { nodeId: "node-a", presence: { stalenessSeconds: 60 } } });
      try {
        const ctx = await ctxFor(repo);
        await seedClaim(ctx.workspace, "00/00", "node-b", "claimed");
        await seedPresence(ctx.workspace, "node-b", NOW);

        const result = await invoke("work:next", { now: NOW }, ctx);
        assert.equal(result.ref, "00/01", "the offered item is story-b (story-a is leased by a live peer)");
        assert.equal(result.state, "ready", "story-b is offered ready");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
