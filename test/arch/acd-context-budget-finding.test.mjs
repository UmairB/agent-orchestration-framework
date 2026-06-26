// Fitness function for milestone 16 / ADR-004 (+ inherited m15/ADR-001 envelope). The
// `doc-over-budget` finding is exactly { code, severity, path, message }:
// code === "doc-over-budget", severity === "warn" (the ONLY value this group emits —
// no error tier), path PRESENT and ABSOLUTE (path.isAbsolute, on-disk OS form — NOT
// cwd-/projectRoot-relativised), anchored at the over-budget FILE (ends with the
// SPEC.md / ARCHITECTURE.md / STORY.md that is too long), message present and naming
// the artifact + measured lines + budget.
//
// Proof: call doctorWork(workDir, config, undefined, { groups:[budgetGroup] }) over a
// fixture stream carrying an OVER-budget SPEC + ARCHITECTURE + STORY → assert every
// doc-over-budget finding conforms.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../../src/work.mjs";
import { doctorWork } from "../../src/work-doctor.mjs";
import { budgetGroup } from "../../src/work-doctor-budget.mjs";

// Text whose splitLines count is exactly n (the milestone-16 convention).
function linesText(n) {
  if (n <= 0) return "";
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

// A fixture with an over-budget SPEC (350 > 300) + ARCHITECTURE (780 > 700) in one
// milestone, and an over-budget STORY (200 > 150) under it — so the stream carries one
// doc-over-budget finding of each artifact kind.
async function buildFixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-budget-envelope-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  const m = path.join(workDir, "16_milestone_alpha");
  await mkdir(m, { recursive: true });
  await writeFile(path.join(m, "SPEC.md"), linesText(350), "utf8");
  await writeFile(path.join(m, "ARCHITECTURE.md"), linesText(780), "utf8");
  const s = path.join(m, "stories", "00_story_beta");
  await mkdir(s, { recursive: true });
  await writeFile(path.join(s, "STORY.md"), linesText(200), "utf8");
  return { repo, workDir };
}

export const archTests = [
  {
    name: "arch/16 ADR-004: every doc-over-budget finding is exactly { code, severity, path, message }, severity warn, anchored at the over-budget FILE",
    run: async () => {
      const { repo, workDir } = await buildFixture();
      try {
        const { config } = await loadWorkspace(repo);
        const findings = await doctorWork(workDir, config, undefined, { groups: [budgetGroup] });
        const overBudget = findings.filter((f) => f.code === "doc-over-budget");
        assert.equal(overBudget.length, 3, `the fixture yields one doc-over-budget per artifact kind (got ${overBudget.length})`);

        const anchors = overBudget.map((f) => path.basename(f.path)).sort();
        assert.deepEqual(anchors, ["ARCHITECTURE.md", "SPEC.md", "STORY.md"], "one finding anchored at each over-budget file");

        for (const finding of overBudget) {
          assert.deepEqual(
            Object.keys(finding).sort(),
            ["code", "message", "path", "severity"],
            `finding has exactly the four keys (got ${Object.keys(finding).join(",")})`
          );
          assert.equal(finding.code, "doc-over-budget", "code is doc-over-budget");
          assert.equal(finding.severity, "warn", `severity is warn (got "${finding.severity}")`);
          assert.ok(typeof finding.path === "string" && path.isAbsolute(finding.path), `path is absolute (got ${finding.path})`);
          // anchored at the over-budget FILE, NOT the folder.
          assert.ok(/(SPEC|ARCHITECTURE|STORY)\.md$/.test(finding.path), `path points at the offending FILE (got ${finding.path})`);
          const file = path.basename(finding.path);
          assert.ok(typeof finding.message === "string" && finding.message.length > 0, "message is present");
          // message names the artifact, the measured lines, and the budget.
          assert.ok(finding.message.includes(file), `message names the artifact ${file}`);
          assert.ok(/\b\d+ lines\b/.test(finding.message), `message names the measured lines (got "${finding.message}")`);
          assert.ok(/\b\d+-line budget\b/.test(finding.message), `message names the budget (got "${finding.message}")`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
