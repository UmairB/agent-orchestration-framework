// Traceability wiring for milestone 37 / story 00
// tasks/00_admit-and-enumerate.feature — "spike and chore folders are enumerated
// as first-class item types".
//
// Every @executable scenario (and every Scenario Outline Examples row) below is
// asserted against the LOCKED engine `findWork`/`listStream` in ../src/work.mjs —
// the same surface `aof work find`/`list --json` are thin faces over (cli.mjs's
// workFindCommand calls findWork directly; work:list's command wraps listStream).
// Mirrors the temp-dir fixture style of test/work-list.test.mjs / test/work-next.test.mjs.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findWork, listStream } from "../src/work.mjs";

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

const RECORD_DOC = { milestone: "SPEC.md", story: "STORY.md", task: "STORY.md", uat: "SESSION.md", spike: "SPIKE.md", chore: "CHORE.md" };

// Build the Background stream: a milestone (+ a story under it), an adhoc task
// (a story-shaped folder at root — the engine's ITEM_RE treats a root `task` type
// as a top-level item), a uat session, a spike, and a chore — each with a valid
// record doc. Optionally also a NN_widget_<slug> folder outside the vocabulary.
async function buildBackground({ includeWidget = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-spike-chore-enum-"));
  const work = path.join(root, "work");
  await mkdir(work, { recursive: true });

  const mkTop = async (number, type, slug, status = "not-started") => {
    const dir = path.join(work, `${number}_${type}_${slug}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, RECORD_DOC[type]),
      frontmatter({
        type,
        number,
        slug,
        status,
        title: `"${slug}"`,
        created: "2026-07-09",
        updated: "2026-07-09",
      }),
    );
    return dir;
  };

  const milestoneDir = await mkTop("00", "milestone", "alpha");
  const storyDir = path.join(milestoneDir, "stories", "00_story_beta");
  await mkdir(storyDir, { recursive: true });
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter({ type: "story", number: "00", slug: "beta", status: "not-started", parent: "00", title: '"Beta"', created: "2026-07-09", updated: "2026-07-09" }),
  );
  await mkTop("01", "task", "gamma");
  await mkTop("02", "uat", "delta");
  const spikeNum = "03";
  const choreNum = "04";
  await mkTop(spikeNum, "spike", "de-risk-thing");
  await mkTop(choreNum, "chore", "tidy-config");

  if (includeWidget) {
    const widgetDir = path.join(work, "05_widget_gremlin");
    await mkdir(widgetDir, { recursive: true });
    await writeFile(path.join(widgetDir, "WIDGET.md"), frontmatter({ type: "widget", number: "05", slug: "gremlin", status: "not-started", created: "2026-07-09", updated: "2026-07-09" }));
  }

  return { root, work, spikeNum, choreNum };
}

async function withBackground(options, body) {
  const { root, work, spikeNum, choreNum } = await buildBackground(options);
  try {
    return await body({ work, spikeNum, choreNum });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export const workSpikeChoreEnumerateTests = [
  // ============================================================================
  // 00_admit-and-enumerate.feature
  // ============================================================================

  // Scenario: aof work find resolves a spike folder as type spike
  {
    name: "work/spike-chore-enumerate: find resolves a spike folder as type spike, ref = its slot number",
    run: () =>
      withBackground({}, async ({ work, spikeNum }) => {
        const rows = await findWork(work, spikeNum);
        assert.equal(rows.length, 1, "exactly one result row");
        assert.equal(rows[0].type, "spike");
        assert.equal(rows[0].ref, spikeNum);
      }),
  },

  // Scenario: aof work find resolves a chore folder as type chore
  {
    name: "work/spike-chore-enumerate: find resolves a chore folder as type chore, ref = its slot number",
    run: () =>
      withBackground({}, async ({ work, choreNum }) => {
        const rows = await findWork(work, choreNum);
        assert.equal(rows.length, 1, "exactly one result row");
        assert.equal(rows[0].type, "chore");
        assert.equal(rows[0].ref, choreNum);
      }),
  },

  // --- Scenario Outline: the item vocabulary admits the six known types and rejects the unknown one ---

  {
    name: "work/spike-chore-enumerate: outline row [milestone] resolves as type milestone",
    run: () =>
      withBackground({ includeWidget: true }, async ({ work }) => {
        const rows = await findWork(work, "00");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].type, "milestone");
      }),
  },
  {
    name: "work/spike-chore-enumerate: outline row [story] resolves as type story",
    run: () =>
      withBackground({ includeWidget: true }, async ({ work }) => {
        const rows = await findWork(work, "00/00");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].type, "story");
      }),
  },
  {
    name: "work/spike-chore-enumerate: outline row [task] resolves as type task",
    run: () =>
      withBackground({ includeWidget: true }, async ({ work }) => {
        const rows = await findWork(work, "01");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].type, "task");
      }),
  },
  {
    name: "work/spike-chore-enumerate: outline row [uat] resolves as type uat",
    run: () =>
      withBackground({ includeWidget: true }, async ({ work }) => {
        const rows = await findWork(work, "02");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].type, "uat");
      }),
  },
  {
    name: "work/spike-chore-enumerate: outline row [spike] resolves as type spike",
    run: () =>
      withBackground({ includeWidget: true }, async ({ work, spikeNum }) => {
        const rows = await findWork(work, spikeNum);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].type, "spike");
      }),
  },
  {
    name: "work/spike-chore-enumerate: outline row [chore] resolves as type chore",
    run: () =>
      withBackground({ includeWidget: true }, async ({ work, choreNum }) => {
        const rows = await findWork(work, choreNum);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].type, "chore");
      }),
  },
  {
    name: "work/spike-chore-enumerate: outline row [widget] yields zero rows — out-of-vocabulary folder invisible",
    run: () =>
      withBackground({ includeWidget: true }, async ({ work }) => {
        const rows = await findWork(work, "05");
        assert.equal(rows.length, 0, "a NN_widget_<slug> folder is never enumerated");
      }),
  },

  // Scenario: a folder outside the vocabulary is absent from the stream listing
  {
    name: "work/spike-chore-enumerate: list --json omits a NN_widget_<slug> folder entirely",
    run: () =>
      withBackground({ includeWidget: true }, async ({ work }) => {
        const rows = await listStream(work);
        assert.ok(!rows.some((row) => row.slug === "gremlin"), "no element carries the widget folder's slug");
        assert.ok(!rows.some((row) => row.type === "widget"), 'no element carries type "widget"');
      }),
  },

  // --- Scenario Outline: aof work list includes a ready <type> in the stream listing ---

  {
    name: "work/spike-chore-enumerate: list --json includes a ready spike (parent null)",
    run: () =>
      withBackground({}, async ({ work, spikeNum }) => {
        const rows = await listStream(work);
        const spike = rows.find((row) => row.type === "spike");
        assert.ok(spike, "a spike element is present");
        assert.equal(spike.ref, spikeNum);
        assert.equal(spike.slug, "de-risk-thing");
        assert.equal(spike.parent, null);
      }),
  },
  {
    name: "work/spike-chore-enumerate: list --json includes a ready chore (parent null)",
    run: () =>
      withBackground({}, async ({ work, choreNum }) => {
        const rows = await listStream(work);
        const chore = rows.find((row) => row.type === "chore");
        assert.ok(chore, "a chore element is present");
        assert.equal(chore.ref, choreNum);
        assert.equal(chore.slug, "tidy-config");
        assert.equal(chore.parent, null);
      }),
  },
];
