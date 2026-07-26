// Traceability wiring for milestone 41 / story 03 (insert-story), task
//   wiki/work/41_milestone_work-item-insertion/stories/03_story_insert-story/
//     tasks/02_stories-checklist-best-effort-update.feature
// Every @executable scenario below is wired against the REAL registered
// command `work:insert-story`, invoked in-process through the command core.
// LITMUS: every Then is confirmable by reading the milestone's SPEC.md
// `## Stories` section text after the command runs, and from the command's
// own exit code / --json success field. TIER BOUNDARY: the Tier-1
// validate-green guarantee lives in work-insert-story-nested-validate.test.mjs
// and is never coupled to this best-effort update — asserted directly in
// scenario 4 below (a stale bullet never fails validate).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { invoke } from "../src/command-core.mjs";
import { findWork, validateWork } from "../src/work.mjs";
import { withInsertFixture, buildMilestone, writeStoryItem, SLUGS } from "./support/work-insert-fixture.mjs";

const STORIES_BODY = [
  "## Stories",
  "",
  "<!-- populated at refine -->",
  "",
  "- [ ] `05/00` — `00_story_alpha` — Alpha.",
  "- [ ] `05/01` — `01_story_bravo` — Bravo.",
  "- [ ] `05/02` — `02_story_charlie` — Charlie.",
  "",
  "## Dependencies",
  "",
  "- none",
  "",
].join("\n");

const NO_STORIES_SECTION_BODY = ["## Dependencies", "", "- none", ""].join("\n");

// The REAL convention every shipped milestone template/SPEC actually writes
// (`.aof/templates/work/milestone/SPEC.md`, and milestones 00-40's own
// SPECs): `- [ ] `NN_story_<slug>` — <one-line outcome>` — NO milestone-number
// prefix. Regression fixture for review fix 4 ("falsely reports success on
// the dominant bullet convention") — `STORIES_BODY` above is feature 02's own
// FIXTURE-ONLY `NN/SS` convention, which never appears on a real milestone.
const TEMPLATE_CONVENTION_STORIES_BODY = [
  "## Stories",
  "",
  "<!-- populated at refine -->",
  "",
  "- [ ] `00_story_alpha` — Alpha.",
  "- [ ] `01_story_bravo` — Bravo.",
  "- [ ] `02_story_charlie` — Charlie.",
  "",
  "## Dependencies",
  "",
  "- none",
  "",
].join("\n");

// A convention this command does not recognize at all (a markdown-link-style
// bullet, seen on some real historical SPECs) — the honest-skip fixture.
const UNRECOGNIZED_CONVENTION_STORIES_BODY = [
  "## Stories",
  "",
  "- [ ] **00 · [alpha](stories/00_story_alpha/STORY.md)** — Alpha.",
  "- [ ] **01 · [bravo](stories/01_story_bravo/STORY.md)** — Bravo.",
  "- [ ] **02 · [charlie](stories/02_story_charlie/STORY.md)** — Charlie.",
  "",
  "## Dependencies",
  "",
  "- none",
  "",
].join("\n");

// The Background: milestone "05"'s SPEC.md `## Stories` section lists bullets
// for "05/00", "05/01", "05/02" — plus the matching nested story items so a
// scaffolded insert (and validate) has real folders to resolve against.
async function buildBackground(workDir, { body = STORIES_BODY } = {}) {
  const milestoneDir = await buildMilestone(workDir, "05", "quintet", body);
  await writeStoryItem(milestoneDir, "00", "05", { slug: SLUGS[0] });
  await writeStoryItem(milestoneDir, "01", "05", { slug: SLUGS[1] });
  await writeStoryItem(milestoneDir, "02", "05", { slug: SLUGS[2] });
  return milestoneDir;
}

async function readSpec(milestoneDir) {
  return readFile(path.join(milestoneDir, "SPEC.md"), "utf8");
}

export const workInsertStoryChecklistTests = [
  // Headline: a new bullet appears for the inserted story, in position.
  {
    name: "work-insert-story/checklist: insert-story adds a Stories bullet for the new story",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const milestoneDir = await buildBackground(workDir);

        const result = await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });
        assert.equal(result.checklist.updated, true, "the checklist update reports updated:true");

        const spec = await readSpec(milestoneDir);
        assert.ok(spec.includes("`05/01`"), `SPEC.md ## Stories section includes a bullet naming ref "05/01":\n${spec}`);
        assert.ok(spec.includes("auth-guard"), `SPEC.md ## Stories section names slug "auth-guard":\n${spec}`);
      }),
  },

  // Headline: shifted siblings' bullets are renumbered to match their new refs.
  // QA coverage gap F-2 (behavioural review of the review fast-follow,
  // 2026-07-16): the prior assertions only checked that the doc CONTAINS
  // "05/02"/"05/03" SOMEWHERE — not that the renumbered ref lands on the SAME
  // bullet as its renumbered `SS_story_<slug>` folder-mention tail (what the
  // Then actually names: "05/02 FOR THE STORY FORMERLY 05/01"). Strengthened
  // to assert the ref and its slug travel together, on ONE line.
  {
    name: "work-insert-story/checklist: insert-story renumbers the shifted siblings' Stories bullets to match their new refs",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const milestoneDir = await buildBackground(workDir);

        await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });

        const spec = await readSpec(milestoneDir);
        const lines = spec.split(/\r?\n/);

        const bravoLine = lines.find((line) => line.includes("`05/02`"));
        assert.ok(bravoLine, `SPEC.md ## Stories section includes a bullet naming ref "05/02" for the story formerly "05/01" (slug bravo):\n${spec}`);
        assert.ok(
          bravoLine.includes("`02_story_bravo`"),
          `the SAME "05/02" bullet also renumbers its folder-mention tail to "02_story_bravo" (the ref and the slug travel together, not two independent doc-wide substrings): ${bravoLine}`,
        );

        const charlieLine = lines.find((line) => line.includes("`05/03`"));
        assert.ok(charlieLine, `SPEC.md ## Stories section includes a bullet naming ref "05/03" for the story formerly "05/02" (slug charlie):\n${spec}`);
        assert.ok(
          charlieLine.includes("`03_story_charlie`"),
          `the SAME "05/03" bullet also renumbers its folder-mention tail to "03_story_charlie" (the ref and the slug travel together, not two independent doc-wide substrings): ${charlieLine}`,
        );
      }),
  },

  // Tier-2 discipline #1: the command still SUCCEEDS (Tier-1 placement intact)
  // even when the ## Stories section is missing and the bullet update cannot
  // be applied — the best-effort surface is skipped, never gated.
  {
    name: "work-insert-story/checklist: insert-story still succeeds when the milestone's Stories section is missing, logging the skip rather than failing",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildBackground(workDir, { body: NO_STORIES_SECTION_BODY });

        const result = await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });
        assert.ok(result, "the command exits zero and the --json envelope reports success (invoke() resolves rather than rejecting)");

        const auth = (await findWork(workDir, "05/01"))[0];
        assert.ok(auth, "a fresh find 05/01 resolves the new story (Tier-1 placement intact)");
        assert.equal(auth.slug, "auth-guard");

        assert.equal(result.checklist.skipped, true, "the --json envelope notes that the ## Stories checklist update was skipped");
        assert.equal(result.checklist.updated, false, "the --json envelope reports updated:false for the skipped checklist");
      }),
  },

  // Tier-2 discipline #2: a stale/unrenumbered bullet is a human-doc nit, NOT
  // a validate failure — validateWork does not parse this checklist.
  {
    name: "work-insert-story/checklist: a stale Stories bullet left over from before this milestone's refine does not fail aof work validate",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const staleBody = [
          "## Stories",
          "",
          "- [ ] `05/00` — `00_story_alpha` — Alpha.",
          "- [ ] `05/01` — `01_story_bravo` — Bravo.",
          "- [ ] `05/02` — `02_story_charlie` — Charlie.",
          "- [ ] `05/09` — `09_story_ghost` — a bullet whose slug matches no story's folder.",
          "",
          "## Dependencies",
          "",
          "- none",
          "",
        ].join("\n");
        await buildBackground(workDir, { body: staleBody });

        const findings = await validateWork(workDir, workspace.config);
        const mismatchFindings = findings.filter((f) => /Stories|ghost|09/i.test(f.problem));
        assert.deepEqual(mismatchFindings, [], `the report includes no finding about the mismatched Stories bullet: ${JSON.stringify(mismatchFindings)}`);
        assert.deepEqual(findings, [], `aof work validate stays green over milestone "05" despite the stale bullet: ${JSON.stringify(findings)}`);
      }),
  },

  // Regression test for review fix 4 (milestone 41 as-built review,
  // 2026-07-16): "the `## Stories` best-effort updater falsely reports
  // success on the dominant bullet convention." The shipped milestone
  // template (and milestones 00-40's own SPECs) write bullets as
  // `` `NN_story_<slug>` — <one-line outcome> `` — NOT the `NN/SS`
  // fixture-only convention `STORIES_BODY` (above) uses. The updater now
  // recognizes this real convention and renumbers it IN THAT SAME FORM.
  {
    name: "work-insert-story/checklist: insert-story renumbers the milestone's Stories bullets in the REAL template convention (`NN_story_<slug>`, no milestone-number prefix), reporting updated:true honestly",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const milestoneDir = await buildBackground(workDir, { body: TEMPLATE_CONVENTION_STORIES_BODY });

        const result = await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });
        assert.equal(result.checklist.updated, true, "the checklist update honestly reports updated:true");
        assert.equal(result.checklist.skipped, false, "the checklist update reports skipped:false");

        const spec = await readSpec(milestoneDir);
        assert.ok(spec.includes("`01_story_auth-guard`"), `SPEC.md ## Stories section includes a bullet naming the new story in-form ("01_story_auth-guard"):\n${spec}`);
        assert.ok(spec.includes("`02_story_bravo`"), `formerly "01_story_bravo" is renumbered in-form to "02_story_bravo":\n${spec}`);
        assert.ok(spec.includes("`03_story_charlie`"), `formerly "02_story_charlie" is renumbered in-form to "03_story_charlie":\n${spec}`);
        assert.ok(!spec.includes("`05/"), `the section is NOT rewritten into the fixture-only "NN/SS" form — it stays in its own convention:\n${spec}`);

        const findings = await validateWork(workDir, workspace.config);
        assert.deepEqual(findings, [], `aof work validate stays green after the in-form renumber: ${JSON.stringify(findings)}`);
      }),
  },

  // The honest-skip half of the same fix: a `## Stories` section that HAS
  // bullets, but in a convention this command does not recognize at all
  // (e.g. a markdown-link-style bullet), must NEVER be spliced-at-heading and
  // reported `updated:true` — the command honestly reports the skip instead,
  // and the section is left byte-for-byte untouched.
  {
    name: "work-insert-story/checklist: insert-story honestly skips (never falsely reports updated) when the Stories section uses an unrecognized bullet convention",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const milestoneDir = await buildBackground(workDir, { body: UNRECOGNIZED_CONVENTION_STORIES_BODY });
        const before = await readSpec(milestoneDir);

        const result = await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });

        // Tier-1 placement is intact regardless of the Tier-2 skip.
        const auth = (await findWork(workDir, "05/01"))[0];
        assert.ok(auth, "a fresh find 05/01 resolves the new story (Tier-1 placement intact)");
        assert.equal(auth.slug, "auth-guard");

        assert.equal(result.checklist.updated, false, "the checklist update honestly reports updated:false — nothing was renumbered/placed in the unrecognized section");
        assert.equal(result.checklist.skipped, true, "the checklist update reports skipped:true");

        const after = await readSpec(milestoneDir);
        assert.equal(after, before, "the ## Stories section is left byte-for-byte untouched — never a corrupted splice at the heading");

        const findings = await validateWork(workDir, workspace.config);
        assert.deepEqual(findings, [], `aof work validate stays green despite the skipped, unrecognized-convention checklist: ${JSON.stringify(findings)}`);
      }),
  },
];
