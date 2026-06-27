// Traceability wiring for milestone 15 / story 01 — the coherence & completeness
// check-groups (status-coherence + lifecycle-completeness). Covers EVERY
// @executable scenario across the story's two task features, exercising the REAL
// engine (src/work-doctor.mjs with the appended groups) over temp fixture repos —
// mirroring doctor-command-core.test.mjs's house style. One test object per
// @executable scenario (Scenario-Outline rows folded into one entry).
//
//   00_status-coherence.feature      — lying-parent / stale-parent /
//        story-done-under-not-started / depends-blocked-in-progress + the
//        coherent-stream / done-all-done / dependency-met negatives
//   01_lifecycle-completeness.feature — missing-verification / missing-retrospective /
//        milestone-no-stories / started-story-no-tasks / missing-architecture + the
//        complete / not-started / in-progress-below-threshold negatives
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { doctorWork } from "../src/work-doctor.mjs";

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-doctor-coh-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  return { repo, workDir };
}

function frontmatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// A milestone folder with a SPEC.md carrying the given status (+ optional depends).
// `docs` toggles convention docs: { verification: "non-empty"|"empty"|undefined,
// retrospective, architecture }. `stories` is unrelated here (built separately).
async function milestone(workDir, { number, slug = number, status = "in-progress", depends, docs = {} }) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPEC.md"),
    frontmatter({ type: "milestone", number, slug, status, title: `"M${number}"`, depends, created: "2026-06-19", updated: "2026-06-19" }) + `# ${number} · M\n`,
    "utf8"
  );
  if (docs.verification === "non-empty") await writeFile(path.join(dir, "VERIFICATION.md"), "# Verification\n\nverified.\n", "utf8");
  if (docs.verification === "empty") await writeFile(path.join(dir, "VERIFICATION.md"), "   \n", "utf8");
  if (docs.retrospective === "present") await writeFile(path.join(dir, "RETROSPECTIVE.md"), "# Retro\n\nlessons.\n", "utf8");
  if (docs.architecture === "present") await writeFile(path.join(dir, "ARCHITECTURE.md"), "# Architecture\n\nadr.\n", "utf8");
  return dir;
}

// A story under a milestone. `withTasks` controls tasks/: "file" (non-empty),
// "empty" (the dir exists but holds no file), or undefined (no tasks/ dir).
async function story(workDir, milestoneFolder, { number, slug = "s" + number, status = "in-progress", parent, withTasks }) {
  const dir = path.join(workDir, milestoneFolder, "stories", `${number}_story_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "STORY.md"),
    frontmatter({ type: "story", number, slug, status, title: `"S${number}"`, parent, created: "2026-06-19", updated: "2026-06-19" }) + `# ${number} · S\n`,
    "utf8"
  );
  if (withTasks === "empty") await mkdir(path.join(dir, "tasks"), { recursive: true });
  if (withTasks === "file") {
    await mkdir(path.join(dir, "tasks"), { recursive: true });
    await writeFile(path.join(dir, "tasks", "00_task.feature"), "@executable\nFeature: x\n", "utf8");
  }
  return dir;
}

// Run the engine over the fixture; pinned now/staleWindow keep freshness inert here
// (story 01 never asserts a freshness code, and the items are well-dated/fresh).
async function runDoctor(repo, workDir, scope) {
  const { config } = await loadWorkspace(repo);
  return doctorWork(workDir, config, scope, {
    now: Date.parse("2026-06-25T00:00:00Z"),
    staleWindow: 30 * 24 * 60 * 60 * 1000,
  });
}

const codes = (findings) => findings.map((f) => f.code);
const has = (findings, code) => findings.some((f) => f.code === code);

export const doctorCoherenceCompletenessTests = [
  // ═══════════════════════ 00_status-coherence.feature ══════════════════════
  {
    name: "doctor/15-01/coherence a status contradiction across items is reported with its code and severity",
    async run() {
      // Each Scenario-Outline row: a minimal fixture → the expected code + severity,
      // the finding anchored on the item the contradiction is about, message names
      // the cross-item fact.
      const rows = [
        { build: async (w) => { await milestone(w, { number: "07", status: "done" }); await story(w, "07_milestone_07", { number: "00", parent: "7", status: "in-progress" }); }, code: "lying-parent", severity: "error", anchor: "07_milestone_07" },
        { build: async (w) => { await milestone(w, { number: "07", status: "done" }); await story(w, "07_milestone_07", { number: "00", parent: "7", status: "blocked" }); }, code: "lying-parent", severity: "error", anchor: "07_milestone_07" },
        { build: async (w) => { await milestone(w, { number: "07", status: "not-started" }); await story(w, "07_milestone_07", { number: "00", parent: "7", status: "in-progress" }); }, code: "stale-parent", severity: "warn", anchor: "07_milestone_07" },
        { build: async (w) => { await milestone(w, { number: "07", status: "not-started" }); await story(w, "07_milestone_07", { number: "00", parent: "7", status: "done" }); }, code: "stale-parent", severity: "warn", anchor: "07_milestone_07" },
        { build: async (w) => { await milestone(w, { number: "07", status: "not-started" }); await story(w, "07_milestone_07", { number: "00", parent: "7", status: "done" }); }, code: "story-done-under-not-started", severity: "error", anchor: path.join("07_milestone_07", "stories", "00_story_s00") },
        // an in-progress driver (08) whose depends names a driver (07) that is NOT yet done
        { build: async (w) => { await milestone(w, { number: "07", status: "in-progress" }); await milestone(w, { number: "08", status: "in-progress", depends: "[7]" }); }, code: "depends-blocked-in-progress", severity: "error", anchor: "08_milestone_08" },
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await row.build(workDir);
          const findings = await runDoctor(repo, workDir);
          const match = findings.find((f) => f.code === row.code);
          assert.ok(match, `row ${row.code}: a finding with that code is reported (got ${codes(findings).join(",")})`);
          assert.equal(match.severity, row.severity, `row ${row.code}: severity is ${row.severity}`);
          assert.ok(match.path.includes(row.anchor), `row ${row.code}: anchored on ${row.anchor} (got ${match.path})`);
          assert.ok(typeof match.message === "string" && match.message.length > 0, `row ${row.code}: message names the fact`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/15-01/coherence a coherent stream emits no status-coherence finding",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // milestone in-progress with in-progress child
        await milestone(workDir, { number: "07", status: "in-progress" });
        await story(workDir, "07_milestone_07", { number: "00", parent: "7", status: "in-progress", withTasks: "file" });
        // milestone done whose every child is done (+ docs so lifecycle stays quiet too)
        await milestone(workDir, { number: "08", status: "done", docs: { verification: "non-empty", retrospective: "present", architecture: "present" } });
        await story(workDir, "08_milestone_08", { number: "00", parent: "8", status: "done", withTasks: "file" });
        // a driver in-progress whose depends-named driver is done
        await milestone(workDir, { number: "09", status: "done", docs: { verification: "non-empty", retrospective: "present" } });
        await milestone(workDir, { number: "10", status: "in-progress", depends: "[9]" });
        const findings = await runDoctor(repo, workDir);
        for (const code of ["lying-parent", "stale-parent", "story-done-under-not-started", "depends-blocked-in-progress"]) {
          assert.ok(!has(findings, code), `no ${code} (got ${codes(findings).join(",")})`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/15-01/coherence a done milestone whose every child story is done is not a lying parent",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "07", status: "done", docs: { verification: "non-empty", retrospective: "present", architecture: "present" } });
        await story(workDir, "07_milestone_07", { number: "00", parent: "7", status: "done", withTasks: "file" });
        await story(workDir, "07_milestone_07", { number: "01", parent: "7", status: "done", withTasks: "file" });
        const findings = await runDoctor(repo, workDir);
        assert.ok(!has(findings, "lying-parent"), `no lying-parent (got ${codes(findings).join(",")})`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/15-01/coherence an in-progress driver whose dependency is done is not depends-blocked",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "07", status: "done", docs: { verification: "non-empty", retrospective: "present" } });
        await milestone(workDir, { number: "08", status: "in-progress", depends: "[7]" });
        const findings = await runDoctor(repo, workDir);
        assert.ok(!has(findings, "depends-blocked-in-progress"), `no depends-blocked-in-progress (got ${codes(findings).join(",")})`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ════════════════════ 01_lifecycle-completeness.feature ═══════════════════
  {
    name: "doctor/15-01/lifecycle a status whose required deliverable is absent is reported with its code and severity",
    async run() {
      const rows = [
        // a milestone in-review with no VERIFICATION.md
        { build: async (w) => { await milestone(w, { number: "07", status: "in-review" }); }, code: "missing-verification", anchor: "07_milestone_07" },
        // a milestone done with no VERIFICATION.md (+ a retrospective so only verification fires for the anchor check)
        { build: async (w) => { await milestone(w, { number: "07", status: "done", docs: { retrospective: "present" } }); }, code: "missing-verification", anchor: "07_milestone_07" },
        // a milestone in-review with an EMPTY VERIFICATION.md (empty stub == missing)
        { build: async (w) => { await milestone(w, { number: "07", status: "in-review", docs: { verification: "empty" } }); }, code: "missing-verification", anchor: "07_milestone_07" },
        // a milestone done with no RETROSPECTIVE.md (+ a verification so only retrospective is missing)
        { build: async (w) => { await milestone(w, { number: "07", status: "done", docs: { verification: "non-empty" } }); }, code: "missing-retrospective", anchor: "07_milestone_07" },
        // a milestone in-progress with zero stories
        { build: async (w) => { await milestone(w, { number: "07", status: "in-progress" }); }, code: "milestone-no-stories", anchor: "07_milestone_07" },
        // a milestone done with zero stories (+ docs so only the no-stories code is asserted)
        { build: async (w) => { await milestone(w, { number: "07", status: "done", docs: { verification: "non-empty", retrospective: "present" } }); }, code: "milestone-no-stories", anchor: "07_milestone_07" },
        // a story in-progress with an empty tasks/
        { build: async (w) => { await milestone(w, { number: "07", status: "in-progress", docs: { architecture: "present" } }); await story(w, "07_milestone_07", { number: "00", parent: "7", status: "in-progress", withTasks: "empty" }); }, code: "started-story-no-tasks", anchor: path.join("07_milestone_07", "stories", "00_story_s00") },
        // a milestone with at least one story but no ARCHITECTURE.md
        { build: async (w) => { await milestone(w, { number: "07", status: "in-progress" }); await story(w, "07_milestone_07", { number: "00", parent: "7", status: "in-progress", withTasks: "file" }); }, code: "missing-architecture", anchor: "07_milestone_07" },
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await row.build(workDir);
          const findings = await runDoctor(repo, workDir);
          const match = findings.find((f) => f.code === row.code);
          assert.ok(match, `row ${row.code}: a finding with that code is reported (got ${codes(findings).join(",")})`);
          assert.equal(match.severity, "warn", `row ${row.code}: severity is warn`);
          assert.ok(match.path.includes(row.anchor), `row ${row.code}: anchored on ${row.anchor} (got ${match.path})`);
          assert.ok(typeof match.message === "string" && match.message.length > 0, `row ${row.code}: message names the missing deliverable`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/15-01/lifecycle a milestone complete for its status emits no lifecycle-completeness finding",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "07", status: "done", docs: { verification: "non-empty", retrospective: "present", architecture: "present" } });
        await story(workDir, "07_milestone_07", { number: "00", parent: "7", status: "in-progress", withTasks: "file" });
        const findings = await runDoctor(repo, workDir);
        for (const code of ["missing-verification", "missing-retrospective", "milestone-no-stories", "started-story-no-tasks", "missing-architecture"]) {
          assert.ok(!has(findings, code), `no ${code} (got ${codes(findings).join(",")})`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/15-01/lifecycle a not-started milestone with no deliverables yet emits no lifecycle-completeness finding",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "07", status: "not-started" });
        const findings = await runDoctor(repo, workDir);
        for (const code of ["missing-verification", "missing-retrospective", "milestone-no-stories", "missing-architecture"]) {
          assert.ok(!has(findings, code), `no ${code} (got ${codes(findings).join(",")})`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/15-01/lifecycle an in-progress milestone without VERIFICATION is not missing-verification",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "07", status: "in-progress", docs: { architecture: "present" } });
        await story(workDir, "07_milestone_07", { number: "00", parent: "7", status: "in-progress", withTasks: "file" });
        const findings = await runDoctor(repo, workDir);
        assert.ok(!has(findings, "missing-verification"), `no missing-verification (got ${codes(findings).join(",")})`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
