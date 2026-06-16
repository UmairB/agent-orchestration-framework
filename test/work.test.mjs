import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listItems, findWork, validateWork, nextWork, parseFrontmatter } from "../src/work.mjs";

const CONFIG = { work: { tags: { layers: ["@backend"], refinements: [], domains: [] } } };

function frontmatter(fields) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

// Build a tiny two-milestone stream in a temp dir; flags toggle each defect.
async function buildFixture(options = {}) {
  const { mismatch, badTag, doubleVerification, danglingDepends, cycle, m0Status = "done", m1Status = "not-started" } = options;
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-work-"));
  const work = path.join(root, "work");

  const milestone0 = path.join(work, "00_milestone_foundation");
  const story = path.join(milestone0, "stories", "00_story_alpha");
  await mkdir(path.join(story, "tasks"), { recursive: true });

  await writeFile(
    path.join(milestone0, "SPEC.md"),
    frontmatter({
      type: "milestone",
      number: "00",
      slug: mismatch ? "wrong-slug" : "foundation",
      status: m0Status,
      created: "2026-01-01",
      updated: "2026-01-02",
      ...(cycle ? { depends: ["01"] } : {}),
    }),
  );
  await writeFile(
    path.join(story, "STORY.md"),
    frontmatter({
      type: "story",
      number: "00",
      slug: "alpha",
      status: "done",
      created: "2026-01-01",
      updated: "2026-01-02",
      parent: "00",
    }),
  );

  const featureTags = badTag ? "@executable @bogus" : "@executable @backend";
  const scenarioTag = doubleVerification ? "  @manual\n" : "";
  await writeFile(
    path.join(story, "tasks", "00_thing.feature"),
    `${featureTags}\nFeature: Thing\n\n${scenarioTag}  Scenario: does a thing\n    When x happens\n    Then y holds\n`,
  );

  const milestone1 = path.join(work, "01_milestone_next");
  await mkdir(milestone1, { recursive: true });
  await writeFile(
    path.join(milestone1, "SPEC.md"),
    frontmatter({
      type: "milestone",
      number: "01",
      slug: "next",
      status: m1Status,
      created: "2026-01-01",
      updated: "2026-01-02",
      depends: danglingDepends ? ["99"] : ["00"],
    }),
  );

  return { root, work };
}

async function withFixture(options, body) {
  const { root, work } = await buildFixture(options);
  try {
    return await body(work);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export const workTests = [
  {
    name: "work: listItems enumerates milestones and nested stories by folder name",
    run: () =>
      withFixture({}, async (work) => {
        const items = await listItems(work);
        assert.deepEqual(items.map((item) => item.ref).sort(), ["00", "00/00", "01"]);
        const story = items.find((item) => item.ref === "00/00");
        assert.equal(story.type, "story");
        assert.equal(story.parent, "00");
      }),
  },
  {
    name: "work: findWork resolves NN, NN/SS, and a slug query",
    run: () =>
      withFixture({}, async (work) => {
        const byNumber = await findWork(work, "01");
        assert.equal(byNumber.length, 1);
        assert.equal(byNumber[0].slug, "next");
        assert.equal(byNumber[0].status, "not-started");

        const byPair = await findWork(work, "00/00");
        assert.equal(byPair.length, 1);
        assert.equal(byPair[0].type, "story");

        const bySlug = await findWork(work, "found");
        assert.equal(bySlug.length, 1);
        assert.equal(bySlug[0].ref, "00");
      }),
  },
  {
    name: "work: validateWork passes a well-formed stream",
    run: () =>
      withFixture({}, async (work) => {
        assert.deepEqual(await validateWork(work, CONFIG), []);
      }),
  },
  {
    name: "work: validateWork flags a folder/frontmatter slug mismatch",
    run: () =>
      withFixture({ mismatch: true }, async (work) => {
        const findings = await validateWork(work, CONFIG);
        assert.ok(findings.some((finding) => /slug/.test(finding.problem)));
      }),
  },
  {
    name: "work: validateWork flags an unknown tag",
    run: () =>
      withFixture({ badTag: true }, async (work) => {
        const findings = await validateWork(work, CONFIG);
        assert.ok(findings.some((finding) => /unknown tag "@bogus"/.test(finding.problem)));
      }),
  },
  {
    name: "work: validateWork flags a scenario with two verification tags",
    run: () =>
      withFixture({ doubleVerification: true }, async (work) => {
        const findings = await validateWork(work, CONFIG);
        assert.ok(findings.some((finding) => /verification tags/.test(finding.problem)));
      }),
  },
  {
    name: "work: validateWork flags a dangling depends reference",
    run: () =>
      withFixture({ danglingDepends: true }, async (work) => {
        const findings = await validateWork(work, CONFIG);
        assert.ok(findings.some((finding) => /depends "99" does not resolve/.test(finding.problem)));
      }),
  },
  {
    name: "work: validateWork detects a depends cycle",
    run: () =>
      withFixture({ cycle: true }, async (work) => {
        const findings = await validateWork(work, CONFIG);
        assert.ok(findings.some((finding) => /depends cycle/.test(finding.problem)));
      }),
  },
  {
    name: "work: parseFrontmatter reads an inline depends list",
    run() {
      const parsed = parseFrontmatter("---\ntype: milestone\ndepends: [00, 02]\n---\nbody");
      assert.deepEqual(parsed.depends, ["00", "02"]);
    },
  },
  {
    name: "work: nextWork returns the next not-done milestone (its dependency is done)",
    run: () =>
      withFixture({}, async (work) => {
        const next = await nextWork(work);
        assert.equal(next.state, "ready");
        assert.equal(next.ref, "01");
        assert.equal(next.type, "milestone");
      }),
  },
  {
    name: "work: nextWork reports blocked when a scoped milestone's dependency is not done",
    run: () =>
      withFixture({ m0Status: "in-progress" }, async (work) => {
        const next = await nextWork(work, "01");
        assert.equal(next.state, "blocked");
        assert.equal(next.ref, "01");
        assert.deepEqual(next.waitingOn, ["00"]);
      }),
  },
  {
    name: "work: nextWork returns done when every milestone is done",
    run: () =>
      withFixture({ m1Status: "done" }, async (work) => {
        const next = await nextWork(work);
        assert.equal(next.state, "done");
      }),
  },
];
