import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nextWork } from "../src/work.mjs";

// ----------------------------------------------------------- fixture builder ----
//
// Mirrors test/work.test.mjs: a `frontmatter()` helper with status flags and
// inline `depends` lists, building a temp-dir stream whose folder NAMES carry
// identity (NN_type_slug) and whose record docs carry status + depends.

function frontmatter(fields) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

// A driver spec: { number, type?, slug?, status, depends?, stories? }.
// `stories` is an array of { number, slug?, status } authored under stories/.
async function buildStream(drivers) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-next-"));
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
        type,
        number: d.number,
        slug,
        status: d.status,
        created: "2026-01-01",
        updated: "2026-01-02",
        ...(d.depends ? { depends: d.depends } : {}),
      }),
    );

    if (type === "milestone" && Array.isArray(d.stories)) {
      for (const s of d.stories) {
        const sSlug = s.slug ?? `story-${s.number}`;
        const sDir = path.join(dir, "stories", `${s.number}_story_${sSlug}`);
        await mkdir(sDir, { recursive: true });
        await writeFile(
          path.join(sDir, "STORY.md"),
          frontmatter({
            type: "story",
            number: s.number,
            slug: sSlug,
            status: s.status,
            created: "2026-01-01",
            updated: "2026-01-02",
            parent: d.number,
          }),
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

// ------------------------------------------------------------------- tests ----

export const orderWorkTests = [
  // ============================================================================
  // 00_next-actionable.feature
  // ============================================================================

  // Scenario: the next item is the first not-done milestone whose dependency is done
  {
    name: "work/next: next is the first not-done milestone whose dependency is done (m00 done, m01 ready)",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "not-started", depends: ["00"] },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "01");
          assert.equal(next.type, "milestone");
        },
      ),
  },

  // Scenario: a not-done milestone is drilled into its first not-done story
  {
    name: "work/next: a not-done milestone is drilled into its first not-done story (00/00)",
    run: () =>
      withStream(
        [
          {
            number: "00",
            status: "in-progress",
            stories: [{ number: "00", status: "not-started" }],
          },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "00/00");
          assert.equal(next.type, "story");
        },
      ),
  },

  // Scenario: a milestone is drilled to its first not-done story, skipping done ones
  {
    name: "work/next: drilling skips done stories (00/00 done, 00/01 not done -> 00/01)",
    run: () =>
      withStream(
        [
          {
            number: "00",
            status: "in-progress",
            stories: [
              { number: "00", status: "done" },
              { number: "01", status: "not-started" },
            ],
          },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "00/01");
          assert.equal(next.type, "story");
        },
      ),
  },

  // Scenario: a milestone whose stories are all done is itself actionable, to accept
  {
    name: "work/next: milestone in-review with all stories done is itself ready to accept",
    run: () =>
      withStream(
        [
          {
            number: "00",
            status: "in-review",
            stories: [
              { number: "00", status: "done" },
              { number: "01", status: "done" },
            ],
          },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "00");
          assert.equal(next.type, "milestone");
        },
      ),
  },

  // Scenario: a not-done milestone that has no stories is itself actionable, to break down
  {
    name: "work/next: a not-started milestone with no stories is itself ready to break down",
    run: () =>
      withStream([{ number: "00", status: "not-started" }], async (work) => {
        const next = await nextWork(work);
        assert.equal(next.state, "ready");
        assert.equal(next.ref, "00");
        assert.equal(next.type, "milestone");
      }),
  },

  // Scenario: a ready uat session is itself the actionable item
  {
    name: "work/next: a ready uat session is itself the item, not drilled into stories",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "done" },
          { number: "02", type: "uat", status: "not-started", depends: ["00", "01"] },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "02");
          assert.equal(next.type, "uat");
        },
      ),
  },

  // Scenario: selection is strictly by number — earlier not-done driver chosen over a later one
  {
    name: "work/next: selection is strictly by number (both not-started, deps done -> 00)",
    run: () =>
      withStream(
        [
          { number: "00", status: "not-started" },
          { number: "01", status: "not-started" },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "00");
          assert.equal(next.type, "milestone");
        },
      ),
  },

  // Scenario: a done driver is skipped and the next not-done driver is selected
  {
    name: "work/next: a done driver is skipped, the next not-done driver is selected (m01 in-progress -> 01)",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "in-progress", depends: ["00"] },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "01");
          assert.equal(next.type, "milestone");
        },
      ),
  },

  // Scenario: the stream is done when every driver is done
  {
    name: "work/next: the stream is done when every driver is done",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "done", depends: ["00"] },
          { number: "02", type: "uat", status: "done", depends: ["00", "01"] },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "done");
        },
      ),
  },

  // --- Scenario Outline: the verdict and reported ref follow the selection rule ---

  // Row: m00 done, m01 not-started (deps done) -> ready 01 milestone
  {
    name: "work/next: outline row [m00 done, m01 not-started] -> ready 01 milestone",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "not-started", depends: ["00"] },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "01");
          assert.equal(next.type, "milestone");
        },
      ),
  },

  // Row: m00 in-progress, story 00/00 not done -> ready 00/00 story
  {
    name: "work/next: outline row [m00 in-progress, 00/00 not done] -> ready 00/00 story",
    run: () =>
      withStream(
        [
          {
            number: "00",
            status: "in-progress",
            stories: [{ number: "00", status: "not-started" }],
          },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "00/00");
          assert.equal(next.type, "story");
        },
      ),
  },

  // Row: m00 in-progress, 00/00 done, 00/01 not done -> ready 00/01 story
  {
    name: "work/next: outline row [m00 in-progress, 00/00 done, 00/01 not done] -> ready 00/01 story",
    run: () =>
      withStream(
        [
          {
            number: "00",
            status: "in-progress",
            stories: [
              { number: "00", status: "done" },
              { number: "01", status: "not-started" },
            ],
          },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "00/01");
          assert.equal(next.type, "story");
        },
      ),
  },

  // Row: m00 in-review, all its stories done -> ready 00 milestone
  {
    name: "work/next: outline row [m00 in-review, all stories done] -> ready 00 milestone",
    run: () =>
      withStream(
        [
          {
            number: "00",
            status: "in-review",
            stories: [{ number: "00", status: "done" }],
          },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "00");
          assert.equal(next.type, "milestone");
        },
      ),
  },

  // Row: m00 not-started, no stories -> ready 00 milestone
  {
    name: "work/next: outline row [m00 not-started, no stories] -> ready 00 milestone",
    run: () =>
      withStream([{ number: "00", status: "not-started" }], async (work) => {
        const next = await nextWork(work);
        assert.equal(next.state, "ready");
        assert.equal(next.ref, "00");
        assert.equal(next.type, "milestone");
      }),
  },

  // Row: uat 02 ready, the milestones it accepts done -> ready 02 uat
  {
    name: "work/next: outline row [uat 02 ready, milestones it accepts done] -> ready 02 uat",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "done" },
          { number: "02", type: "uat", status: "not-started", depends: ["00", "01"] },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "02");
          assert.equal(next.type, "uat");
        },
      ),
  },

  // Row: every driver done -> done
  {
    name: "work/next: outline row [every driver done] -> done",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "done", depends: ["00"] },
        ],
        async (work) => {
          const next = await nextWork(work);
          assert.equal(next.state, "done");
        },
      ),
  },

  // ============================================================================
  // 01_blocked-and-range.feature
  // ============================================================================

  // Scenario: a scoped item whose dependency is unmet is reported blocked
  {
    name: "work/next: scoped 01 with m00 in-progress reports blocked, names 00 in waitingOn",
    run: () =>
      withStream(
        [
          { number: "00", status: "in-progress" },
          { number: "01", status: "not-started", depends: ["00"] },
        ],
        async (work) => {
          const next = await nextWork(work, "01");
          assert.equal(next.state, "blocked");
          assert.equal(next.ref, "01");
          assert.ok(next.waitingOn.includes("00"));
        },
      ),
  },

  // Scenario: a blocked driver lists every unmet dependency in waitingOn
  {
    name: "work/next: blocked driver lists every unmet dependency (m02 deps 00&01 both not done -> [00,01])",
    run: () =>
      withStream(
        [
          { number: "00", status: "not-started" },
          { number: "01", status: "not-started" },
          { number: "02", status: "not-started", depends: ["00", "01"] },
        ],
        async (work) => {
          const next = await nextWork(work, "02");
          assert.equal(next.state, "blocked");
          assert.equal(next.ref, "02");
          assert.deepEqual(next.waitingOn, ["00", "01"]);
        },
      ),
  },

  // Scenario: waitingOn names only the unmet dependencies, not the satisfied ones
  {
    name: "work/next: waitingOn names only unmet deps (00 done, 01 not done -> [01])",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "not-started" },
          { number: "02", status: "not-started", depends: ["00", "01"] },
        ],
        async (work) => {
          const next = await nextWork(work, "02");
          assert.equal(next.state, "blocked");
          assert.equal(next.ref, "02");
          assert.deepEqual(next.waitingOn, ["01"]);
        },
      ),
  },

  // Scenario: a dependency outside the scope is still checked when reporting blocked
  {
    name: "work/next: a dependency outside scope is still checked when reporting blocked (next 01, dep 00)",
    run: () =>
      withStream(
        [
          { number: "00", status: "in-progress" },
          { number: "01", status: "not-started", depends: ["00"] },
        ],
        async (work) => {
          const next = await nextWork(work, "01");
          assert.equal(next.state, "blocked");
          assert.equal(next.ref, "01");
          assert.ok(next.waitingOn.includes("00"));
        },
      ),
  },

  // Scenario: a range that contains only done work reports done
  {
    name: "work/next: a range with only done work reports done (next 00-01)",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "done", depends: ["00"] },
        ],
        async (work) => {
          const next = await nextWork(work, "00-01");
          assert.equal(next.state, "done");
        },
      ),
  },

  // Scenario: a range whose only in-scope item is blocked reports blocked
  {
    name: "work/next: a range whose only in-scope item is blocked reports blocked (next 01-01)",
    run: () =>
      withStream(
        [
          { number: "00", status: "in-progress" },
          { number: "01", status: "not-started", depends: ["00"] },
        ],
        async (work) => {
          const next = await nextWork(work, "01-01");
          assert.equal(next.state, "blocked");
          assert.equal(next.ref, "01");
        },
      ),
  },

  // --- Scenario Outline: a range scope limits which drivers are considered ---
  // Stream: milestones 00..04, where 00 done and 01..04 not-started with deps done.
  // Row: 02 -> ready 02
  {
    name: "work/next: range outline row [02] -> ready 02",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "not-started" },
          { number: "02", status: "not-started" },
          { number: "03", status: "not-started" },
          { number: "04", status: "not-started" },
        ],
        async (work) => {
          const next = await nextWork(work, "02");
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "02");
        },
      ),
  },

  // Row: 04 -> ready 04
  {
    name: "work/next: range outline row [04] -> ready 04",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "not-started" },
          { number: "02", status: "not-started" },
          { number: "03", status: "not-started" },
          { number: "04", status: "not-started" },
        ],
        async (work) => {
          const next = await nextWork(work, "04");
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "04");
        },
      ),
  },

  // Row: 01-03 -> ready 01
  {
    name: "work/next: range outline row [01-03] -> ready 01 (first in span)",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "not-started" },
          { number: "02", status: "not-started" },
          { number: "03", status: "not-started" },
          { number: "04", status: "not-started" },
        ],
        async (work) => {
          const next = await nextWork(work, "01-03");
          assert.equal(next.state, "ready");
          assert.equal(next.ref, "01");
        },
      ),
  },

  // Row: 00 -> done (the only in-scope driver is done)
  {
    name: "work/next: range outline row [00] -> done (only in-scope driver is done)",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "not-started" },
          { number: "02", status: "not-started" },
          { number: "03", status: "not-started" },
          { number: "04", status: "not-started" },
        ],
        async (work) => {
          const next = await nextWork(work, "00");
          assert.equal(next.state, "done");
        },
      ),
  },

  // Row: 00-00 -> done
  {
    name: "work/next: range outline row [00-00] -> done",
    run: () =>
      withStream(
        [
          { number: "00", status: "done" },
          { number: "01", status: "not-started" },
          { number: "02", status: "not-started" },
          { number: "03", status: "not-started" },
          { number: "04", status: "not-started" },
        ],
        async (work) => {
          const next = await nextWork(work, "00-00");
          assert.equal(next.state, "done");
        },
      ),
  },
];
