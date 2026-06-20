// Traceability wiring for story 00/01 `validate-stream`.
//
// Each test below proves one @executable scenario (or one example-table row)
// from the three task features under
//   wiki/work/00_milestone_work-cli/stories/01_story_validate-stream/tasks/
// against the LOCKED engine `validateWork(workDir, config, scopeRef)` in
// ../src/work.mjs. We assert on `finding.problem` substrings using the exact
// wording the engine emits — we never change the engine or the contract.
//
// Mirrors the temp-dir fixture style of test/work.test.mjs.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateWork } from "../src/work.mjs";

// The config supplies the closed vocabulary. @validate is the configured domain
// tag the features lean on; @backend is a layer some fixtures decorate with.
const CONFIG = { work: { tags: { layers: ["@backend"], refinements: [], domains: ["@validate"] } } };

function frontmatter(fields) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

// A fresh temp work dir. The body receives the work path; the dir is removed
// afterwards. Each scenario builds exactly the items it needs so only the
// finding under test can appear.
async function withWork(body) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-validate-"));
  const work = path.join(root, "work");
  await mkdir(work, { recursive: true });
  try {
    return await body(work);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// Write a milestone folder `NN_milestone_slug/SPEC.md` with the given frontmatter
// fields. Pass fields verbatim so a test can omit/break a single field.
async function writeMilestone(work, { folderNumber, folderSlug, fields }) {
  const dir = path.join(work, `${folderNumber}_milestone_${folderSlug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SPEC.md"), frontmatter(fields));
  return dir;
}

// A complete, valid milestone field set — tests override one field to isolate a
// defect.
function milestoneFields(overrides = {}) {
  return {
    type: "milestone",
    number: "00",
    slug: "foundation",
    status: "done",
    created: "2026-01-01",
    updated: "2026-01-02",
    ...overrides,
  };
}

// Write a story under a milestone, plus an optional single task feature. The
// `feature` string, if given, is written to tasks/00_thing.feature verbatim.
async function writeStory(milestoneDir, { folderNumber = "00", folderSlug = "alpha", fields, feature } = {}) {
  const storyDir = path.join(milestoneDir, "stories", `${folderNumber}_story_${folderSlug}`);
  await mkdir(path.join(storyDir, "tasks"), { recursive: true });
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter(
      fields ?? {
        type: "story",
        number: folderNumber,
        slug: folderSlug,
        status: "done",
        created: "2026-01-01",
        updated: "2026-01-02",
        parent: "00",
      },
    ),
  );
  if (feature != null) {
    await writeFile(path.join(storyDir, "tasks", "00_thing.feature"), feature);
  }
  return storyDir;
}

const has = (findings, substr) => findings.some((f) => f.problem.includes(substr));

export const validateStreamTests = [
  // ===================================================================
  // Feature 00 — folder-frontmatter
  // ===================================================================

  // Scenario: a well-formed stream passes with a clean report and exits 0
  {
    name: "work/validate: a well-formed stream passes with [] (exit 0)",
    run: () =>
      withWork(async (work) => {
        await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        const findings = await validateWork(work, CONFIG);
        assert.deepEqual(findings, []);
      }),
  },

  // Scenario: a malformed stream reports findings and exits non-zero for CI
  {
    name: "work/validate: a frontmatter slug differing from the folder slug yields at least one finding (exit non-zero)",
    run: () =>
      withWork(async (work) => {
        // folder slug is "foundation"; frontmatter says "wrong-slug".
        await writeMilestone(work, {
          folderNumber: "00",
          folderSlug: "foundation",
          fields: milestoneFields({ slug: "wrong-slug" }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(findings.length >= 1, "expected at least one finding");
      }),
  },

  // Scenario Outline row: type differs from the folder type
  {
    name: "work/validate: frontmatter type ≠ folder type is flagged (type ≠ folder type)",
    run: () =>
      withWork(async (work) => {
        await writeMilestone(work, {
          folderNumber: "00",
          folderSlug: "foundation",
          fields: milestoneFields({ type: "story" }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "≠ folder type"), `missing 'type ≠ folder type': ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario Outline row: number differs from the folder number
  {
    name: "work/validate: frontmatter number ≠ folder number is flagged (number ≠ folder)",
    run: () =>
      withWork(async (work) => {
        await writeMilestone(work, {
          folderNumber: "00",
          folderSlug: "foundation",
          fields: milestoneFields({ number: "07" }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, '≠ folder "00"'), `missing 'number ≠ folder': ${JSON.stringify(findings)}`);
        assert.ok(findings.some((f) => /number .* ≠ folder/.test(f.problem)), "expected a number finding");
      }),
  },

  // Scenario Outline row: slug differs from the folder slug
  {
    name: "work/validate: frontmatter slug ≠ folder slug is flagged (slug ≠ folder)",
    run: () =>
      withWork(async (work) => {
        await writeMilestone(work, {
          folderNumber: "00",
          folderSlug: "foundation",
          fields: milestoneFields({ slug: "wrong-slug" }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(findings.some((f) => /slug .* ≠ folder/.test(f.problem)), `missing 'slug ≠ folder': ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario Outline row: status is not a valid status value
  {
    name: "work/validate: an invalid status value is flagged (invalid status)",
    run: () =>
      withWork(async (work) => {
        await writeMilestone(work, {
          folderNumber: "00",
          folderSlug: "foundation",
          fields: milestoneFields({ status: "almost-there" }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "invalid status"), `missing 'invalid status': ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario Outline row: created is missing
  {
    name: "work/validate: a missing created date is flagged (missing created date)",
    run: () =>
      withWork(async (work) => {
        const fields = milestoneFields();
        delete fields.created;
        await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "missing created date"), `missing 'missing created date': ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario Outline row: updated is missing
  {
    name: "work/validate: a missing updated date is flagged (missing updated date)",
    run: () =>
      withWork(async (work) => {
        const fields = milestoneFields();
        delete fields.updated;
        await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "missing updated date"), `missing 'missing updated date': ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario Outline row: parent names a non-milestone
  {
    name: "work/validate: a parent that names a non-milestone is flagged (parent does not resolve to a milestone)",
    run: () =>
      withWork(async (work) => {
        // A milestone exists at 00. The story's parent points at 99 — no such
        // milestone — so the parent check fires for the story.
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          folderNumber: "00",
          folderSlug: "alpha",
          fields: {
            type: "story",
            number: "00",
            slug: "alpha",
            status: "done",
            created: "2026-01-01",
            updated: "2026-01-02",
            parent: "99",
          },
          feature: "@executable\nFeature: Thing\n\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(
          has(findings, "does not resolve to a milestone"),
          `missing 'parent does not resolve to a milestone': ${JSON.stringify(findings)}`,
        );
      }),
  },

  // Scenario: a record doc with no parseable frontmatter is flagged whole, and
  // no per-field findings are reported for that item.
  {
    name: "work/validate: a record doc with no parseable frontmatter is flagged whole, no per-field findings",
    run: () =>
      withWork(async (work) => {
        const dir = path.join(work, "00_milestone_foundation");
        await mkdir(dir, { recursive: true });
        // No `---` block at all -> parseFrontmatter returns {} -> whole-record.
        await writeFile(path.join(dir, "SPEC.md"), "# Foundation\n\nNo frontmatter here.\n");
        const findings = await validateWork(work, CONFIG);
        assert.ok(
          has(findings, "missing or empty record doc (SPEC.md)"),
          `missing whole-record finding: ${JSON.stringify(findings)}`,
        );
        // No per-field findings should be emitted for that item.
        assert.ok(!has(findings, "≠ folder type"), "unexpected type finding");
        assert.ok(!has(findings, "invalid status"), "unexpected status finding");
        assert.ok(!has(findings, "missing created date"), "unexpected created finding");
        assert.ok(!has(findings, "missing updated date"), "unexpected updated finding");
        assert.ok(!findings.some((f) => /≠ folder/.test(f.problem)), "unexpected per-field ≠ finding");
      }),
  },

  // ===================================================================
  // Feature 01 — tag-vocabulary
  //
  // checkFeatureTags runs BOTH the vocab gate AND the verification-count check
  // on every scenario. To isolate a vocab finding, each scenario inherits a
  // single verification lane from a feature-level @executable so the count is
  // exactly 1 (no spurious count finding). To isolate a count finding, the
  // tags involved are all valid vocabulary.
  // ===================================================================

  // Feature header used for vocab tests: feature carries @executable (one lane),
  // so a bare scenario inherits exactly one verification tag.
  // Helper to build a story whose single feature has the given feature-line tags
  // and a scenario with the given scenario-line tags.
  // (Defined inline per test for clarity.)

  // Scenario: a tag outside the closed vocabulary is flagged (@bogus)
  {
    name: "work/validate: a tag outside the closed vocabulary is flagged (@bogus)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        // Feature @executable gives one verification lane; scenario adds @bogus.
        await writeStory(m, {
          feature: "@executable\nFeature: Thing\n\n  @bogus\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(
          has(findings, 'unknown tag "@bogus"'),
          `missing 'unknown tag "@bogus"': ${JSON.stringify(findings)}`,
        );
        // No spurious count finding: effective verification = [@executable] = 1.
        assert.ok(!has(findings, "verification tags"), `unexpected count finding: ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario: a milestone-membership tag is rejected as structural (@milestone-03)
  {
    name: "work/validate: a milestone-membership tag is rejected as structural (@milestone-03)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "@executable\nFeature: Thing\n\n  @milestone-03\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(
          has(findings, "milestone membership is structural, not a tag"),
          `missing structural finding: ${JSON.stringify(findings)}`,
        );
        assert.ok(has(findings, 'tag "@milestone-03"'), "expected the tag named in the finding");
        assert.ok(!has(findings, "verification tags"), `unexpected count finding: ${JSON.stringify(findings)}`);
      }),
  },

  // ---- vocabulary accept/reject matrix (Scenario Outline) ----
  // Each row: a scenario carrying <tag>; the feature supplies @executable so the
  // verification count is exactly 1 (or 2 when the tag itself is a lane — see
  // note below). We assert presence/absence of the vocab finding only.

  // Row: @validate — accepted (a configured domain tag)
  {
    name: "work/validate: vocab row @validate accepted (configured domain tag)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "@executable\nFeature: Thing\n\n  @validate\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "unknown tag"), `@validate should be accepted: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "structural"), "@validate is not structural");
        assert.ok(!has(findings, "verification tags"), "no count finding expected");
      }),
  },

  // Row: @bug — accepted (a universal lifecycle tag)
  {
    name: "work/validate: vocab row @bug accepted (universal lifecycle tag)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "@executable\nFeature: Thing\n\n  @bug\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "unknown tag"), `@bug should be accepted: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "structural"), "@bug is not structural");
        // @bug is not a verification lane; feature @executable keeps count at 1.
        assert.ok(!has(findings, "verification tags"), "no count finding expected");
      }),
  },

  // Row: @wip — accepted (a universal lifecycle tag)
  {
    name: "work/validate: vocab row @wip accepted (universal lifecycle tag)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "@executable\nFeature: Thing\n\n  @wip\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "unknown tag"), `@wip should be accepted: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "structural"), "@wip is not structural");
        assert.ok(!has(findings, "verification tags"), "no count finding expected");
      }),
  },

  // Row: @finding-K12 — accepted (a finding-lineage tag)
  {
    name: "work/validate: vocab row @finding-K12 accepted (finding-lineage tag)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "@executable\nFeature: Thing\n\n  @finding-K12\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "unknown tag"), `@finding-K12 should be accepted: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "structural"), "@finding-K12 is not structural");
        assert.ok(!has(findings, "verification tags"), "no count finding expected");
      }),
  },

  // Row: @bogus — flagged: unknown tag outside the vocabulary
  {
    name: "work/validate: vocab row @bogus flagged as unknown tag outside the vocabulary",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "@executable\nFeature: Thing\n\n  @bogus\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, 'unknown tag "@bogus" (outside the closed vocabulary)'), `missing @bogus finding: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "verification tags"), "no count finding expected");
      }),
  },

  // Row: @milestone-03 — flagged: milestone membership is structural
  {
    name: "work/validate: vocab row @milestone-03 flagged as structural membership",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "@executable\nFeature: Thing\n\n  @milestone-03\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "milestone membership is structural, not a tag"), `missing structural finding: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "verification tags"), "no count finding expected");
      }),
  },

  // ---- verification-count matrix (Scenario Outline) ----
  // <tags> is the scenario's EFFECTIVE tag set. We avoid a feature-level lane and
  // place all tags directly on the scenario so the effective set is exactly the
  // row. We assert presence/absence of the count finding. Any vocab tags used
  // are valid (@bug, @finding-K12) so no vocab finding interferes.

  // Row: @executable -> accepted (exactly 1)
  {
    name: "work/validate: count row @executable accepted (exactly 1 lane)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "Feature: Thing\n\n  @executable\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "verification tags"), `@executable should be accepted: ${JSON.stringify(findings)}`);
      }),
  },

  // Row: @manual -> accepted (exactly 1)
  {
    name: "work/validate: count row @manual accepted (exactly 1 lane)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "Feature: Thing\n\n  @manual\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "verification tags"), `@manual should be accepted: ${JSON.stringify(findings)}`);
      }),
  },

  // Row: @uat -> accepted (exactly 1)
  {
    name: "work/validate: count row @uat accepted (exactly 1 lane)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "Feature: Thing\n\n  @uat\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "verification tags"), `@uat should be accepted: ${JSON.stringify(findings)}`);
      }),
  },

  // Row: @executable @bug -> accepted (still exactly 1; @bug is not a lane)
  {
    name: "work/validate: count row @executable @bug accepted (still exactly 1 lane)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "Feature: Thing\n\n  @executable @bug\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "verification tags"), `@executable @bug should be accepted: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "unknown tag"), "both tags are valid vocab");
      }),
  },

  // Row: @uat @finding-K12 -> accepted (still exactly 1; finding tag is not a lane)
  {
    name: "work/validate: count row @uat @finding-K12 accepted (still exactly 1 lane)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "Feature: Thing\n\n  @uat @finding-K12\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "verification tags"), `@uat @finding-K12 should be accepted: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "unknown tag"), "both tags are valid vocab");
      }),
  },

  // Row: (none) -> flagged: needs exactly 1, has 0
  {
    name: "work/validate: count row (none) flagged (needs exactly 1, has 0)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "Feature: Thing\n\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "carries 0 verification tags (need exactly 1)"), `expected 0-lane finding: ${JSON.stringify(findings)}`);
      }),
  },

  // Row: @bug -> flagged: needs exactly 1, has 0 (valid vocab, but not a lane)
  {
    name: "work/validate: count row @bug flagged (needs exactly 1, has 0 — not a lane)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "Feature: Thing\n\n  @bug\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "carries 0 verification tags (need exactly 1)"), `expected 0-lane finding: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "unknown tag"), "@bug is valid vocab");
      }),
  },

  // Row: @wip -> flagged: needs exactly 1, has 0
  {
    name: "work/validate: count row @wip flagged (needs exactly 1, has 0 — not a lane)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "Feature: Thing\n\n  @wip\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "carries 0 verification tags (need exactly 1)"), `expected 0-lane finding: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "unknown tag"), "@wip is valid vocab");
      }),
  },

  // Row: @executable @manual -> flagged: needs exactly 1, has 2
  {
    name: "work/validate: count row @executable @manual flagged (needs exactly 1, has 2)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "Feature: Thing\n\n  @executable @manual\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "carries 2 verification tags (need exactly 1)"), `expected 2-lane finding: ${JSON.stringify(findings)}`);
      }),
  },

  // Row: @manual @uat -> flagged: needs exactly 1, has 2
  {
    name: "work/validate: count row @manual @uat flagged (needs exactly 1, has 2)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "Feature: Thing\n\n  @manual @uat\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "carries 2 verification tags (need exactly 1)"), `expected 2-lane finding: ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario: a feature-level verification tag is inherited by a bare scenario
  {
    name: "work/validate: a feature-level @executable is inherited by a bare scenario (no count finding)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "@executable\nFeature: Thing\n\n  Scenario: bare scenario\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "verification tags"), `inherited lane should satisfy the count: ${JSON.stringify(findings)}`);
        assert.deepEqual(findings, [], "a clean inherited-lane stream should pass entirely");
      }),
  },

  // Scenario: a feature lane plus a scenario lane sums to two and is flagged
  {
    name: "work/validate: a feature @executable plus a scenario @manual sums to 2 and is flagged",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeStory(m, {
          feature: "@executable\nFeature: Thing\n\n  @manual\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "carries 2 verification tags (need exactly 1)"), `expected 2-lane finding: ${JSON.stringify(findings)}`);
      }),
  },

  // ===================================================================
  // Feature 02 — depends-graph
  // ===================================================================

  // Scenario: a depends edge that resolves to no item is flagged
  {
    name: "work/validate: a depends edge resolving to no item is flagged (depends \"99\" does not resolve)",
    run: () =>
      withWork(async (work) => {
        // A single milestone at 00 with depends:[99]; no item numbered 99.
        await writeMilestone(work, {
          folderNumber: "00",
          folderSlug: "foundation",
          fields: milestoneFields({ depends: ["99"] }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(
          has(findings, 'depends "99" does not resolve'),
          `missing dangling depends finding: ${JSON.stringify(findings)}`,
        );
      }),
  },

  // Scenario: a dependency cycle is detected (00<->01)
  {
    name: "work/validate: a 2-cycle 00->01,01->00 is detected (depends cycle)",
    run: () =>
      withWork(async (work) => {
        await writeMilestone(work, {
          folderNumber: "00",
          folderSlug: "foundation",
          fields: milestoneFields({ depends: ["01"] }),
        });
        await writeMilestone(work, {
          folderNumber: "01",
          folderSlug: "next",
          fields: milestoneFields({ number: "01", slug: "next", status: "not-started", depends: ["00"] }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "depends cycle"), `missing cycle finding: ${JSON.stringify(findings)}`);
      }),
  },

  // ---- resolve matrix (Scenario Outline) ----

  // Row: dep 00 -> accepted (milestone). A driver depends on milestone 00.
  {
    name: "work/validate: resolve row dep 00 accepted (resolves to a milestone)",
    run: () =>
      withWork(async (work) => {
        // milestone 00 (the target) + milestone 01 depending on 00.
        await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeMilestone(work, {
          folderNumber: "01",
          folderSlug: "next",
          fields: milestoneFields({ number: "01", slug: "next", status: "not-started", depends: ["00"] }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "does not resolve"), `dep 00 should resolve: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "depends cycle"), "acyclic stream");
      }),
  },

  // Row: dep 02 -> accepted (uat session). A driver depends on uat session 02.
  {
    name: "work/validate: resolve row dep 02 accepted (resolves to a uat session)",
    run: () =>
      withWork(async (work) => {
        // milestone 01 depends on uat session 02; uat 02 exists as a driver.
        await writeMilestone(work, {
          folderNumber: "01",
          folderSlug: "next",
          fields: milestoneFields({ number: "01", slug: "next", status: "not-started", depends: ["02"] }),
        });
        const sessionDir = path.join(work, "02_uat_acceptance");
        await mkdir(sessionDir, { recursive: true });
        await writeFile(
          path.join(sessionDir, "SESSION.md"),
          frontmatter({
            type: "uat",
            number: "02",
            slug: "acceptance",
            status: "not-started",
            created: "2026-01-01",
            updated: "2026-01-02",
          }),
        );
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "does not resolve"), `dep 02 (uat) should resolve: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "depends cycle"), "acyclic stream");
      }),
  },

  // Row: dep 99 -> flagged: does not resolve.
  {
    name: "work/validate: resolve row dep 99 flagged (does not resolve)",
    run: () =>
      withWork(async (work) => {
        await writeMilestone(work, {
          folderNumber: "00",
          folderSlug: "foundation",
          fields: milestoneFields({ depends: ["99"] }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, 'depends "99" does not resolve'), `dep 99 should be flagged: ${JSON.stringify(findings)}`);
      }),
  },

  // ---- cycle matrix (Scenario Outline) ----

  // Row: 00 -> 01, 01 -> 00 -> flagged: depends cycle
  {
    name: "work/validate: cycle row 00->01,01->00 flagged (depends cycle)",
    run: () =>
      withWork(async (work) => {
        await writeMilestone(work, {
          folderNumber: "00",
          folderSlug: "foundation",
          fields: milestoneFields({ depends: ["01"] }),
        });
        await writeMilestone(work, {
          folderNumber: "01",
          folderSlug: "next",
          fields: milestoneFields({ number: "01", slug: "next", status: "not-started", depends: ["00"] }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "depends cycle"), `expected cycle: ${JSON.stringify(findings)}`);
      }),
  },

  // Row: 00 -> 00 (self-edge) -> flagged: depends cycle
  {
    name: "work/validate: cycle row 00->00 self-edge flagged (depends cycle)",
    run: () =>
      withWork(async (work) => {
        await writeMilestone(work, {
          folderNumber: "00",
          folderSlug: "foundation",
          fields: milestoneFields({ depends: ["00"] }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(has(findings, "depends cycle"), `expected self-edge cycle: ${JSON.stringify(findings)}`);
      }),
  },

  // Row: 01 -> 00, 02 -> 00 (diamond, no loop) -> accepted: acyclic
  {
    name: "work/validate: cycle row diamond 01->00,02->00 accepted (acyclic)",
    run: () =>
      withWork(async (work) => {
        // milestone 00 is the shared target; 01 and 02 both depend on 00.
        await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        await writeMilestone(work, {
          folderNumber: "01",
          folderSlug: "next",
          fields: milestoneFields({ number: "01", slug: "next", status: "not-started", depends: ["00"] }),
        });
        await writeMilestone(work, {
          folderNumber: "02",
          folderSlug: "later",
          fields: milestoneFields({ number: "02", slug: "later", status: "not-started", depends: ["00"] }),
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "depends cycle"), `diamond is acyclic: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "does not resolve"), "all deps resolve");
      }),
  },

  // Scenario: a story-level depends edge is not part of the graph.
  {
    name: "work/validate: a story-level depends:[99] is not part of the graph (no resolve/cycle finding)",
    run: () =>
      withWork(async (work) => {
        const m = await writeMilestone(work, { folderNumber: "00", folderSlug: "foundation", fields: milestoneFields() });
        // Story carries depends:[99] in its frontmatter; stories are not drivers
        // so the graph never reads it.
        await writeStory(m, {
          folderNumber: "00",
          folderSlug: "alpha",
          fields: {
            type: "story",
            number: "00",
            slug: "alpha",
            status: "done",
            created: "2026-01-01",
            updated: "2026-01-02",
            parent: "00",
            depends: ["99"],
          },
          feature: "@executable\nFeature: Thing\n\n  Scenario: does a thing\n    When x\n    Then y\n",
        });
        const findings = await validateWork(work, CONFIG);
        assert.ok(!has(findings, "does not resolve"), `story depends must not dangle: ${JSON.stringify(findings)}`);
        assert.ok(!has(findings, "depends cycle"), `story depends must not cycle: ${JSON.stringify(findings)}`);
        // And the whole stream is otherwise clean.
        assert.deepEqual(findings, [], "story-level depends is invisible to the graph");
      }),
  },
];
