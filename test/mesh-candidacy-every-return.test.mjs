// Traceability wiring for milestone 27 / story 01 — the candidacy lookup at EVERY
// nextWork ready-return (tasks/03_candidacy-every-return.feature, ADR-004.3, the
// m26/ADR-007 fold-in).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 03_candidacy-every-return.feature. Driven directly against the REAL nextWork
// with hand-built candidacyView Maps (the work-next-lease-view.test.mjs precedent) —
// a uat driver, a zero-story (needs-break-down) milestone driver, and the
// milestone-accept fallthrough tree.
//
//   03_candidacy-every-return.feature —
//     - the uat driver return honours the candidacy view (offer / skip-elsewhere /
//       skip-live / offer-reclaimable);
//     - the zero-story driver return honours the candidacy view identically;
//     - a stale-peer lease on a driver ref surfaces ready + reclaimable, naming the
//       holder, and next writes nothing;
//     - the milestone-accept fallthrough ignores any candidacy entry — a done
//       milestone is always offered for acceptance;
//     - a peer's next no longer double-offers a uat driver ref a live peer is
//       working (the m26/ADR-007 headline fix).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nextWork } from "../src/work.mjs";

function frontmatter(fields) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

async function buildStream(drivers) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-candidacy-return-"));
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

const view = (entries) => new Map(entries);

// The four candidacy-row shapes the feature's Scenario Outlines name.
const CANDIDACY_ROWS = {
  "no entry (offer)": null,
  "targeted-elsewhere": { routed: "elsewhere" },
  'leased-live by peer "node-b"': { state: "leased-live", holder: "node-b" },
  'leased-stale by peer "node-b"': { state: "leased-stale", holder: "node-b" },
};

export const meshCandidacyEveryReturnTests = [
  // ══ Scenario Outline: the uat driver return honours the candidacy view ══
  {
    name: "candidacy-every-return/03 the uat driver return honours the candidacy view — offer / skip-elsewhere / skip-live / offer-reclaimable",
    async run() {
      const drivers = [{ number: "27", type: "uat", status: "not-started" }];
      for (const [label, entry] of Object.entries(CANDIDACY_ROWS)) {
        await withStream(drivers, async (work) => {
          const candidacyView = entry ? view([["27", entry]]) : new Map();
          const result = await nextWork(work, undefined, { candidacyView });
          if (label === "no entry (offer)" || label.startsWith("leased-stale")) {
            assert.equal(result.ref, "27", `"${label}": the uat ref is offered`);
            if (label.startsWith("leased-stale")) {
              assert.equal(result.reclaimable, true, `"${label}": reclaimable true`);
              assert.equal(result.leasedBy, "node-b", `"${label}": leasedBy node-b`);
            } else {
              assert.ok(!("reclaimable" in result), `"${label}": no reclaimable annotation`);
            }
          } else {
            assert.notEqual(result.ref, "27", `"${label}": the uat ref is skipped`);
            assert.deepEqual(result, { state: "done" }, `"${label}": nothing else to offer — the honest done shape`);
          }
        });
      }
    },
  },

  // ══ Scenario Outline: the zero-story (needs-break-down) driver return honours the candidacy view ══
  {
    name: "candidacy-every-return/03 the zero-story (needs-break-down) driver return honours the candidacy view identically to the uat return",
    async run() {
      const drivers = [{ number: "27", status: "not-started" }]; // milestone, zero stories
      for (const [label, entry] of Object.entries(CANDIDACY_ROWS)) {
        await withStream(drivers, async (work) => {
          const candidacyView = entry ? view([["27", entry]]) : new Map();
          const result = await nextWork(work, undefined, { candidacyView });
          if (label === "no entry (offer)" || label.startsWith("leased-stale")) {
            assert.equal(result.ref, "27", `"${label}": the milestone ref is offered as needs-break-down`);
            if (label.startsWith("leased-stale")) {
              assert.equal(result.reclaimable, true, `"${label}": reclaimable true`);
              assert.equal(result.leasedBy, "node-b", `"${label}": leasedBy node-b`);
            }
          } else {
            assert.deepEqual(result, { state: "done" }, `"${label}": skipped — the honest done shape`);
          }
        });
      }
    },
  },

  // ══ Scenario: a stale-peer lease on a uat driver ref surfaces ready + reclaimable, and next writes nothing ══
  {
    name: "candidacy-every-return/03 a stale-peer lease on a uat driver ref surfaces the ref ready and reclaimable, naming the holder — next writes nothing",
    async run() {
      const drivers = [{ number: "27", type: "uat", status: "not-started" }];
      await withStream(drivers, async (work) => {
        const meshSnapshotBefore = await snapshotTree(path.join(path.dirname(work), "wiki"));
        const candidacyView = view([["27", { state: "leased-stale", holder: "node-b" }]]);
        const result = await nextWork(work, undefined, { candidacyView });
        assert.equal(result.ref, "27", "a stale lease never demotes the walk");
        assert.equal(result.reclaimable, true);
        assert.equal(result.leasedBy, "node-b");
        assert.deepEqual(await snapshotTree(path.join(path.dirname(work), "wiki")), meshSnapshotBefore, "next wrote nothing under the work tree");
      });
    },
  },

  // ══ Scenario Outline: the milestone-accept fallthrough ignores any candidacy entry ══
  {
    name: "candidacy-every-return/03 the milestone-accept fallthrough ignores any candidacy entry — a done milestone is always offered for acceptance",
    async run() {
      const drivers = [
        {
          number: "27",
          status: "in-progress",
          stories: [{ number: "00", slug: "story-a", status: "done" }],
        },
      ];
      for (const [label, entry] of Object.entries(CANDIDACY_ROWS)) {
        await withStream(drivers, async (work) => {
          const candidacyView = entry ? view([["27", entry]]) : new Map();
          const result = await nextWork(work, undefined, { candidacyView });
          assert.equal(result.ref, "27", `"${label}": milestone 27 is offered for acceptance — the fallthrough is candidacy-blind`);
          assert.equal(result.state, "ready");
        });
      }
    },
  },

  // ══ Scenario: a peer's next no longer double-offers a uat driver ref that a live peer is working ══
  {
    name: "candidacy-every-return/03 a peer's next no longer double-offers a uat driver ref that a live peer is working (the m26/ADR-007 fold-in closes the gap)",
    async run() {
      const drivers = [{ number: "27", type: "uat", status: "not-started" }];
      await withStream(drivers, async (work) => {
        // Before the fold-in (no candidacy view at all): the uat ref would be
        // offered regardless of a live peer's lease — the double-offer gap.
        const blind = await nextWork(work, undefined, {});
        assert.equal(blind.ref, "27", "before the fold-in this ref would double-offer (no view supplied)");

        // With the shared candidacy view (post-fold-in): node-a's next SKIPS it.
        const candidacyView = view([["27", { state: "leased-live", holder: "node-b" }]]);
        const result = await nextWork(work, undefined, { candidacyView });
        assert.notEqual(result.ref, "27", "node-a does NOT offer 27 — it is being worked by a live peer");
        assert.deepEqual(result, { state: "done" }, "nothing else to offer");
      });
    },
  },
];

async function snapshotTree(dir) {
  const snap = {};
  async function walk(d, rel) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(d, entry.name);
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) await walk(abs, r);
      else snap[r] = await readFile(abs, "utf8");
    }
  }
  await walk(dir, "");
  return snap;
}
