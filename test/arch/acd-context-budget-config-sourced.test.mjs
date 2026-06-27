// Fitness function for milestone 16 / ADR-005 (config-sourced budget / NO baked-in
// literal). (a) The budgetGroup body in src/work-doctor-budget.mjs holds NO
// budget-magnitude integer literal — defaults live ONLY in the budgetsFromConfig
// resolver (source-grep the group module, comments stripped per the house
// strip-comments discipline). (b) BEHAVIOURALLY, the SAME over-length artifact flips
// finding↔no-finding across two configs — a LOW budget yields a doc-over-budget
// finding, a HIGH budget yields none — proving the budget is read from config, not baked.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../src/work.mjs";
import { doctorWork } from "../../src/work-doctor.mjs";
import { budgetGroup } from "../../src/work-doctor-budget.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUDGET_MODULE = path.join(repoRoot, "src", "work-doctor-budget.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function linesText(n) {
  if (n <= 0) return "";
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

// A 400-line SPEC.md fixture; the resolved spec budget is the only thing that varies.
async function buildFixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-budget-sourced-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  return { repo, workDir };
}

async function writeConfig(repo, budgets) {
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work", doctor: { budgets } } }, null, 2),
    "utf8"
  );
}

export const archTests = [
  {
    name: "arch/16 ADR-005: the budgetGroup body holds no budget-magnitude integer literal (defaults live only in the resolver)",
    run: async () => {
      const source = stripComments(await readFile(BUDGET_MODULE, "utf8"));
      // The three default magnitudes (300/700/150) must NOT appear as standalone
      // integer literals in the group body — the resolver owns them.
      assert.ok(!/\b300\b/.test(source), "no 300 literal in the group body");
      assert.ok(!/\b700\b/.test(source), "no 700 literal in the group body");
      assert.ok(!/\b150\b/.test(source), "no 150 literal in the group body");
      // More robustly: no standalone multi-digit integer literal at all (a budget
      // magnitude would necessarily be one). The group's only numbers come from
      // ctx.budgets / the snapshot, never a literal.
      assert.ok(
        !/(^|[^.\w])\d{2,}(?![.\w])/.test(source),
        `the group body contains no multi-digit integer literal (all budgets come from ctx.budgets)`
      );
    },
  },
  {
    name: "arch/16 ADR-005: the SAME over-length SPEC flips finding↔no-finding across a low vs high configured budget",
    run: async () => {
      const { repo, workDir } = await buildFixture();
      try {
        const m = path.join(workDir, "16_milestone_alpha");
        await mkdir(m, { recursive: true });
        await writeFile(path.join(m, "SPEC.md"), linesText(400), "utf8");

        // LOW budget (300 < 400) → the doc-over-budget finding appears.
        await writeConfig(repo, { spec: 300 });
        const low = await doctorWork(workDir, (await loadWorkspace(repo)).config, undefined, { groups: [budgetGroup] });
        assert.ok(
          low.some((f) => f.code === "doc-over-budget" && /SPEC\.md$/.test(f.path)),
          "a low spec budget (300) flags the 400-line SPEC"
        );

        // HIGH budget (500 > 400) → the finding disappears (no FS change).
        await writeConfig(repo, { spec: 500 });
        const high = await doctorWork(workDir, (await loadWorkspace(repo)).config, undefined, { groups: [budgetGroup] });
        assert.ok(
          !high.some((f) => f.code === "doc-over-budget"),
          "a high spec budget (500) leaves the same 400-line SPEC silent"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
