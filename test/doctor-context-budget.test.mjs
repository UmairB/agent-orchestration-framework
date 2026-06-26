// Traceability wiring for milestone 16 / story 00 — the doc-bloat / context-budget
// check-group (`budgetGroup`). Covers EVERY @executable scenario across the story's two
// task features, exercising the REAL engine (src/work-doctor.mjs's snapshot + the
// budgetGroup) over temp fixture repos. Runs ONLY the budget group via
// doctorWork(..., { groups: [budgetGroup] }) so each assertion isolates the doc-bloat
// behaviour from every other check-group. One test object per @executable scenario
// (Scenario-Outline rows folded into one entry, looped).
//
//   00_doc-over-budget.feature   — the clean baseline, the per-kind boundary outline
//        (SPEC 300 / ARCHITECTURE 700 / STORY 150, strictly-greater), non-context
//        artifacts exempt, two over-budget artifacts in one milestone ⇒ two findings
//   01_configurable-budget.feature — the SPEC flip across configured budgets.spec,
//        absent budgets ⇒ defaults, partial config leaves unset kinds on defaults
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { doctorWork } from "../src/work-doctor.mjs";
import { budgetGroup } from "../src/work-doctor-budget.mjs";

// --- fixture builders --------------------------------------------------------

async function makeRepo(doctorConfig = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-doctor-budget-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work", doctor: doctorConfig } }, null, 2),
    "utf8"
  );
  return { repo, workDir };
}

// Text whose splitLines count is EXACTLY n (the milestone-16 convention:
// text.split(/\r?\n/) with a single trailing empty element dropped). n joined "lN"
// lines plus a terminating newline ⇒ the trailing empty is dropped ⇒ exactly n lines.
// n === 0 ⇒ the empty string (0 lines).
function linesText(n) {
  if (n <= 0) return "";
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

// A milestone folder whose SPEC.md / ARCHITECTURE.md (and any extra files) carry the
// given exact line counts. `extra` is a { filename: lines } map for non-context
// artifacts (STATE.md, a .feature, …) that must NOT be budgeted.
async function milestone(workDir, { number = "16", slug = "m" + number, specLines, archLines, extra = {} } = {}) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  if (specLines != null) await writeFile(path.join(dir, "SPEC.md"), linesText(specLines), "utf8");
  if (archLines != null) await writeFile(path.join(dir, "ARCHITECTURE.md"), linesText(archLines), "utf8");
  for (const [name, lines] of Object.entries(extra)) {
    await writeFile(path.join(dir, name), linesText(lines), "utf8");
  }
  return dir;
}

// A story folder under a milestone's stories/ whose STORY.md carries exactly storyLines.
async function story(workDir, { milestoneNumber = "16", milestoneSlug = "m16", number = "00", slug = "s" + number, storyLines } = {}) {
  const dir = path.join(workDir, `${milestoneNumber}_milestone_${milestoneSlug}`, "stories", `${number}_story_${slug}`);
  await mkdir(dir, { recursive: true });
  if (storyLines != null) await writeFile(path.join(dir, "STORY.md"), linesText(storyLines), "utf8");
  return dir;
}

// Run ONLY the budget group (isolates doc-bloat from every other check-group).
async function runBudget(repo, workDir, scope) {
  const { config } = await loadWorkspace(repo);
  return doctorWork(workDir, config, scope, { groups: [budgetGroup] });
}

const overBudget = (findings) => findings.filter((f) => f.code === "doc-over-budget");
const overBudgetFor = (findings, file) =>
  overBudget(findings).filter((f) => f.path.endsWith(path.sep + file) || f.path.endsWith("/" + file));

// Map an Examples `kind` (a filename) to the milestone/story fixture that owns it.
async function fixtureForKind(workDir, kind, lines) {
  if (kind === "SPEC.md") return milestone(workDir, { specLines: lines });
  if (kind === "ARCHITECTURE.md") return milestone(workDir, { specLines: 10, archLines: lines });
  if (kind === "STORY.md") {
    await milestone(workDir, { specLines: 10 });
    return story(workDir, { storyLines: lines });
  }
  throw new Error(`unknown kind ${kind}`);
}

export const doctorContextBudgetTests = [
  // ═══════════════════════ 00_doc-over-budget.feature ═══════════════════════
  {
    name: "doctor/16-00/budget a milestone and a story all within their default budgets produce no doc-over-budget finding",
    async run() {
      // Clean baseline: SPEC 124 / ARCHITECTURE 631 / STORY 81 — all under 300/700/150.
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { specLines: 124, archLines: 631 });
        await story(workDir, { storyLines: 81 });
        const findings = await runBudget(repo, workDir);
        assert.equal(overBudget(findings).length, 0, `no doc-over-budget (got ${overBudget(findings).map((f) => f.path).join(",")})`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/16-00/budget an artifact over its default budget yields a doc-over-budget finding anchored at that file",
    async run() {
      // The per-kind boundary outline, faithful to the three Examples tables.
      const rows = [
        { kind: "SPEC.md", lines: 412, fires: true },
        { kind: "SPEC.md", lines: 301, fires: true },
        { kind: "SPEC.md", lines: 300, fires: false },
        { kind: "SPEC.md", lines: 299, fires: false },
        { kind: "ARCHITECTURE.md", lines: 820, fires: true },
        { kind: "ARCHITECTURE.md", lines: 701, fires: true },
        { kind: "ARCHITECTURE.md", lines: 700, fires: false },
        { kind: "ARCHITECTURE.md", lines: 699, fires: false },
        { kind: "STORY.md", lines: 210, fires: true },
        { kind: "STORY.md", lines: 151, fires: true },
        { kind: "STORY.md", lines: 150, fires: false },
        { kind: "STORY.md", lines: 149, fires: false },
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await fixtureForKind(workDir, row.kind, row.lines);
          const findings = await runBudget(repo, workDir);
          const anchored = overBudgetFor(findings, row.kind);
          assert.equal(anchored.length > 0, row.fires, `${row.kind} ${row.lines}: fires=${row.fires} (got ${overBudget(findings).length} over-budget)`);
          // No spurious finding anchored at a DIFFERENT artifact.
          assert.equal(overBudget(findings).length, row.fires ? 1 : 0, `${row.kind} ${row.lines}: exactly ${row.fires ? 1 : 0} doc-over-budget`);
          if (row.fires) {
            assert.equal(anchored[0].severity, "warn", "doc-over-budget is warn");
            assert.ok(anchored[0].path.endsWith(row.kind), `anchored at ${row.kind}`);
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/16-00/budget a long non-context artifact is not budgeted",
    async run() {
      // SPEC 120 / ARCHITECTURE 200 (both well within budget) + an over-long
      // non-context artifact that must NOT fire.
      const rows = [
        { artifact: "STATE.md", lines: 900 },
        { artifact: "VERIFICATION.md", lines: 1200 },
        { artifact: "RETROSPECTIVE.md", lines: 800 },
        { artifact: "00_some.feature", lines: 500 },
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await milestone(workDir, { specLines: 120, archLines: 200, extra: { [row.artifact]: row.lines } });
          const findings = await runBudget(repo, workDir);
          assert.equal(overBudget(findings).length, 0, `${row.artifact} ${row.lines} lines: no doc-over-budget (got ${overBudget(findings).map((f) => f.path).join(",")})`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/16-00/budget a milestone whose SPEC.md and ARCHITECTURE.md are both over budget yields two distinct findings",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // SPEC 350 (> 300) + ARCHITECTURE 780 (> 700) in ONE milestone.
        await milestone(workDir, { specLines: 350, archLines: 780 });
        const findings = await runBudget(repo, workDir);
        const all = overBudget(findings);
        assert.equal(all.length, 2, `exactly two doc-over-budget findings (got ${all.length})`);
        assert.equal(overBudgetFor(findings, "SPEC.md").length, 1, "one anchored at SPEC.md");
        assert.equal(overBudgetFor(findings, "ARCHITECTURE.md").length, 1, "one anchored at ARCHITECTURE.md");
        for (const f of all) assert.equal(f.severity, "warn", "each is warn");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ═══════════════════════ 01_configurable-budget.feature ═══════════════════
  {
    name: "doctor/16-00/budget the same over-length SPEC flips finding↔no-finding across configured budgets",
    async run() {
      // ONE 400-line SPEC.md, run against varying configured spec budgets.
      const rows = [
        { budget: 300, fires: true },
        { budget: 399, fires: true },
        { budget: 400, fires: false },
        { budget: 401, fires: false },
        { budget: 500, fires: false },
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo({ budgets: { spec: row.budget } });
        try {
          await milestone(workDir, { specLines: 400 });
          const findings = await runBudget(repo, workDir);
          const anchored = overBudgetFor(findings, "SPEC.md");
          assert.equal(anchored.length > 0, row.fires, `spec budget ${row.budget}: fires=${row.fires} (got ${overBudget(findings).length})`);
          if (row.fires) assert.equal(anchored[0].severity, "warn", "doc-over-budget is warn");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/16-00/budget with no work.doctor.budgets configured the documented default applies",
    async run() {
      // NO budgets config at all → defaults SPEC 300 / ARCHITECTURE 700 / STORY 150.
      const rows = [
        { kind: "SPEC.md", lines: 350, fires: true },
        { kind: "SPEC.md", lines: 250, fires: false },
        { kind: "ARCHITECTURE.md", lines: 750, fires: true },
        { kind: "ARCHITECTURE.md", lines: 650, fires: false },
        { kind: "STORY.md", lines: 200, fires: true },
        { kind: "STORY.md", lines: 120, fires: false },
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo(); // no budgets key
        try {
          await fixtureForKind(workDir, row.kind, row.lines);
          const findings = await runBudget(repo, workDir);
          const anchored = overBudgetFor(findings, row.kind);
          assert.equal(anchored.length > 0, row.fires, `default ${row.kind} ${row.lines}: fires=${row.fires} (got ${overBudget(findings).length})`);
          assert.equal(overBudget(findings).length, row.fires ? 1 : 0, `${row.kind} ${row.lines}: exactly ${row.fires ? 1 : 0}`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/16-00/budget a partial budgets config leaves unset kinds on their defaults",
    async run() {
      // budgets.spec = 1000; architecture (default 700) and story (default 150) unset.
      const rows = [
        { kind: "SPEC.md", lines: 900, fires: false }, // over old 300 but under 1000
        { kind: "SPEC.md", lines: 1001, fires: true }, // over the configured 1000
        { kind: "ARCHITECTURE.md", lines: 800, fires: true }, // default 700 unchanged
        { kind: "STORY.md", lines: 200, fires: true }, // default 150 unchanged
        { kind: "STORY.md", lines: 140, fires: false }, // default 150 unchanged
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo({ budgets: { spec: 1000 } });
        try {
          await fixtureForKind(workDir, row.kind, row.lines);
          const findings = await runBudget(repo, workDir);
          const anchored = overBudgetFor(findings, row.kind);
          assert.equal(anchored.length > 0, row.fires, `partial ${row.kind} ${row.lines}: fires=${row.fires} (got ${overBudget(findings).length})`);
          assert.equal(overBudget(findings).length, row.fires ? 1 : 0, `${row.kind} ${row.lines}: exactly ${row.fires ? 1 : 0}`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
];
