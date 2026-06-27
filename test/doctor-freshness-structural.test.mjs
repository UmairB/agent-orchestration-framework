// Traceability wiring for milestone 15 / story 02 — the freshness/date-sanity and
// structural-integrity check-groups. Covers EVERY @executable scenario across the
// story's two task features, exercising the REAL engine (src/work-doctor.mjs with
// the appended groups) over temp fixture repos. The freshness tests pass a FIXED
// `now` + `staleWindow` into doctorWork so every time relationship is deterministic
// (matching the features' pinned-`now` Examples). One test object per @executable
// scenario (Scenario-Outline rows folded into one entry).
//
//   00_freshness-date-sanity.feature — stale-updated / updated-before-created /
//        unparseable-date / mtime-ahead-of-updated, all under pinned now/window
//   01_structural-integrity.feature  — numbering-gap / duplicate-driver-number /
//        orphan-folder + the roadmap-folder-mismatch opt-in/no-op cross-reference
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { doctorWork } from "../src/work-doctor.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const PINNED_NOW = Date.parse("2026-06-25T00:00:00Z");
const STALE_WINDOW = 30 * DAY_MS;

// --- fixture builders --------------------------------------------------------

async function makeRepo(extraConfig = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-doctor-fresh-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work", ...extraConfig } }, null, 2),
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

// A milestone whose SPEC.md carries the given (possibly malformed) created/updated.
// `fileMtimeIso` (when set) pins the SPEC.md mtime so the snapshot's newest-file
// mtime is deterministic; otherwise the mtime is pinned to created to keep it inert.
async function milestone(workDir, { number, slug = "m" + number, status = "in-progress", created, updated, fileMtimeIso }) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  const spec = path.join(dir, "SPEC.md");
  await writeFile(
    spec,
    frontmatter({ type: "milestone", number, slug, status, title: `"M${number}"`, created, updated }) + `# ${number} · M\n`,
    "utf8"
  );
  // Pin the only folder file's mtime so newestFileMtimeMs is deterministic. Default
  // to created (well before any updated), keeping mtime-ahead inert unless asked.
  const mtime = fileMtimeIso ? new Date(fileMtimeIso) : new Date(Date.parse((created || "2020-01-01") + "T00:00:00Z"));
  await utimes(spec, mtime, mtime);
  return dir;
}

// A bare top-level driver folder of a given type at a given number — for the
// structural-integrity numbering/duplicate/orphan checks (content is irrelevant).
async function driverFolder(workDir, name) {
  const dir = path.join(workDir, name);
  await mkdir(dir, { recursive: true });
  const m = name.match(/^(\d+)_(milestone|uat|story)_(.+)$/);
  if (m) {
    const doc = m[2] === "milestone" ? "SPEC.md" : m[2] === "uat" ? "SESSION.md" : "STORY.md";
    await writeFile(path.join(dir, doc), frontmatter({ type: m[2], number: m[1], slug: m[3], status: "in-progress", created: "2026-06-19", updated: "2026-06-19" }), "utf8");
  }
  return dir;
}

async function runDoctor(repo, workDir, scope) {
  const { config } = await loadWorkspace(repo);
  return doctorWork(workDir, config, scope, { now: PINNED_NOW, staleWindow: STALE_WINDOW });
}

const codes = (findings) => findings.map((f) => f.code);
const has = (findings, code) => findings.some((f) => f.code === code);

// The freshness codes (story 02 group 00) — for "no freshness finding" assertions.
const FRESHNESS_CODES = ["stale-updated", "updated-before-created", "unparseable-date", "mtime-ahead-of-updated"];
const STRUCTURAL_CODES = ["numbering-gap", "duplicate-driver-number", "orphan-folder", "roadmap-folder-mismatch"];

export const doctorFreshnessStructuralTests = [
  // ═══════════════════ 00_freshness-date-sanity.feature ═════════════════════
  {
    name: "doctor/15-02/freshness a fresh, well-dated item produces no freshness findings",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // Faithful to the feature row: in-progress, created 2026-06-01, updated
        // 2026-06-20 (date-only), newest file mtime 2026-06-20T09:00:00Z — a SAME-DAY
        // mtime under a date-only `updated` is NOT ahead (the bare date covers the day).
        await milestone(workDir, { number: "07", status: "in-progress", created: "2026-06-01", updated: "2026-06-20", fileMtimeIso: "2026-06-20T09:00:00Z" });
        const findings = await runDoctor(repo, workDir);
        for (const code of FRESHNESS_CODES) assert.ok(!has(findings, code), `no ${code} (got ${codes(findings).join(",")})`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/15-02/freshness an in-progress item is stale only when updated falls outside the staleWindow before now",
    async run() {
      // pinned now = 2026-06-25, staleWindow = 30 days
      const rows = [
        { updated: "2026-05-10", stale: true },  // 46 days back → stale
        { updated: "2026-05-26", stale: true },  // 30 days back (boundary) → stale
        { updated: "2026-06-10", stale: false }, // 15 days back → fresh
        { updated: "2026-06-24", stale: false }, // 1 day back → fresh
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await milestone(workDir, { number: "07", status: "in-progress", created: "2026-05-01", updated: row.updated, fileMtimeIso: "2026-05-01T00:00:00Z" });
          const findings = await runDoctor(repo, workDir);
          assert.equal(has(findings, "stale-updated"), row.stale, `updated ${row.updated}: stale=${row.stale} (got ${codes(findings).join(",")})`);
          if (row.stale) assert.equal(findings.find((f) => f.code === "stale-updated").severity, "warn", "stale-updated is warn");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/15-02/freshness the stale-updated check applies only to in-progress items",
    async run() {
      // updated 2026-04-01 is 85 days back; only the in-progress row fires.
      const rows = [
        { status: "in-progress", stale: true },
        { status: "done", stale: false },
        { status: "not-started", stale: false },
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await milestone(workDir, { number: "07", status: row.status, created: "2026-03-01", updated: "2026-04-01", fileMtimeIso: "2026-03-01T00:00:00Z" });
          const findings = await runDoctor(repo, workDir);
          assert.equal(has(findings, "stale-updated"), row.stale, `status ${row.status}: stale=${row.stale} (got ${codes(findings).join(",")})`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/15-02/freshness an out-of-order or unparseable date is reported with its code and severity",
    async run() {
      const rows = [
        // out-of-order chronology
        { created: "2026-06-20", updated: "2026-06-01", code: "updated-before-created", severity: "error" },
        { created: "2026-06-20", updated: "2026-06-20", code: null }, // equal → none
        // unparseable / non-ISO
        { created: "not-a-date", updated: "2026-06-20", code: "unparseable-date", severity: "error" },
        { created: "2026-06-01", updated: "25-06-2026", code: "unparseable-date", severity: "error" },
        { created: "2026-13-40", updated: "2026-06-20", code: "unparseable-date", severity: "error" },
        { created: "2026-06-01", updated: "2026-06-20", code: null }, // both ISO → none
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          // status not in-progress + mtime pinned old → only the date-sanity code under test can fire
          await milestone(workDir, { number: "07", status: "not-started", created: row.created, updated: row.updated, fileMtimeIso: "2020-01-01T00:00:00Z" });
          const findings = await runDoctor(repo, workDir);
          if (row.code === null) {
            for (const c of FRESHNESS_CODES) assert.ok(!has(findings, c), `created ${row.created}/updated ${row.updated}: no ${c} (got ${codes(findings).join(",")})`);
          } else {
            const match = findings.find((f) => f.code === row.code);
            assert.ok(match, `created ${row.created}/updated ${row.updated}: ${row.code} reported (got ${codes(findings).join(",")})`);
            assert.equal(match.severity, row.severity, `${row.code} severity is ${row.severity}`);
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/15-02/freshness a folder file mtime newer than updated is reported",
    async run() {
      // updated = 2026-06-20T12:00:00Z; pinned now = 2026-06-25
      const rows = [
        { mtime: "2026-06-22T08:00:00Z", ahead: true },   // 2 days newer
        { mtime: "2026-06-20T12:00:01Z", ahead: true },   // 1 second newer
        { mtime: "2026-06-20T12:00:00Z", ahead: false },  // equal → not ahead
        { mtime: "2026-06-19T09:00:00Z", ahead: false },  // older → not ahead
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          // not-started so the staleness check is inert; updated carries an explicit time.
          await milestone(workDir, { number: "07", status: "not-started", created: "2026-06-01", updated: "2026-06-20T12:00:00Z", fileMtimeIso: row.mtime });
          const findings = await runDoctor(repo, workDir);
          assert.equal(has(findings, "mtime-ahead-of-updated"), row.ahead, `mtime ${row.mtime}: ahead=${row.ahead} (got ${codes(findings).join(",")})`);
          if (row.ahead) assert.equal(findings.find((f) => f.code === "mtime-ahead-of-updated").severity, "warn", "mtime-ahead-of-updated is warn");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ═══════════════════ 01_structural-integrity.feature ══════════════════════
  {
    name: "doctor/15-02/structural a well-numbered, gap-free, orphan-free stream produces no structural findings",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await driverFolder(workDir, "07_milestone_alpha");
        await driverFolder(workDir, "08_milestone_beta");
        await driverFolder(workDir, "09_milestone_gamma");
        const findings = await runDoctor(repo, workDir);
        for (const code of STRUCTURAL_CODES) assert.ok(!has(findings, code), `no ${code} (got ${codes(findings).join(",")})`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/15-02/structural a gap in the top-level driver number sequence is reported as a warn",
    async run() {
      const rows = [
        { numbers: ["07", "08", "10"], gap: true },
        { numbers: ["07", "08", "11"], gap: true },
        { numbers: ["07", "08", "09"], gap: false },
        { numbers: ["00", "01", "02"], gap: false },
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          for (const n of row.numbers) await driverFolder(workDir, `${n}_milestone_m${n}`);
          const findings = await runDoctor(repo, workDir);
          assert.equal(has(findings, "numbering-gap"), row.gap, `${row.numbers.join(",")}: gap=${row.gap} (got ${codes(findings).join(",")})`);
          if (row.gap) assert.equal(findings.find((f) => f.code === "numbering-gap").severity, "warn", "numbering-gap is warn");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/15-02/structural two top-level drivers sharing a number are reported as an error",
    async run() {
      const rows = [
        { folders: ["07_milestone_alpha", "07_milestone_beta"], dup: true },
        { folders: ["07_milestone_alpha", "07_uat_alpha-signoff"], dup: true },
        { folders: ["07_milestone_alpha", "08_milestone_beta"], dup: false },
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          for (const f of row.folders) await driverFolder(workDir, f);
          const findings = await runDoctor(repo, workDir);
          assert.equal(has(findings, "duplicate-driver-number"), row.dup, `${row.folders.join(",")}: dup=${row.dup} (got ${codes(findings).join(",")})`);
          if (row.dup) assert.equal(findings.find((f) => f.code === "duplicate-driver-number").severity, "error", "duplicate-driver-number is error");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/15-02/structural a directory not matching the item-name pattern is reported as an orphan",
    async run() {
      // directly under workDir (use a valid baseline driver so the orphan is the only fault)
      const topRows = [
        { folder: "07_mileston_typo", orphan: true },
        { folder: "notes", orphan: true },
        { folder: "07-milestone-dashes", orphan: true },
        { folder: "07_milestone_valid", orphan: false },
      ];
      for (const row of topRows) {
        const { repo, workDir } = await makeRepo();
        try {
          await driverFolder(workDir, "08_milestone_anchor"); // a valid baseline
          await mkdir(path.join(workDir, row.folder), { recursive: true });
          const findings = await runDoctor(repo, workDir);
          const orphans = findings.filter((f) => f.code === "orphan-folder" && f.path.includes(row.folder));
          assert.equal(orphans.length > 0, row.orphan, `top "${row.folder}": orphan=${row.orphan} (got ${codes(findings).join(",")})`);
          if (row.orphan) assert.equal(orphans[0].severity, "warn", "orphan-folder is warn");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // under a milestone's stories/
      const storyRows = [
        { folder: "00_storry_typo", orphan: true },
        { folder: "drafts", orphan: true },
        { folder: "00_story_valid", orphan: false },
      ];
      for (const row of storyRows) {
        const { repo, workDir } = await makeRepo();
        try {
          await driverFolder(workDir, "07_milestone_alpha");
          await mkdir(path.join(workDir, "07_milestone_alpha", "stories", row.folder), { recursive: true });
          const findings = await runDoctor(repo, workDir);
          const orphans = findings.filter((f) => f.code === "orphan-folder" && f.path.includes(row.folder));
          assert.equal(orphans.length > 0, row.orphan, `story "${row.folder}": orphan=${row.orphan} (got ${codes(findings).join(",")})`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "doctor/15-02/structural with no structured milestone-index ROADMAP the cross-reference is an honest no-op",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // a prose ROADMAP that does NOT line up with the folders — and NO configured index
        await driverFolder(workDir, "07_milestone_alpha");
        await writeFile(path.join(workDir, "ROADMAP.md"), "# Roadmap\n\n- milestone 99 will ship soon\n- milestone 42 someday\n", "utf8");
        const findings = await runDoctor(repo, workDir);
        assert.ok(!has(findings, "roadmap-folder-mismatch"), `no roadmap-folder-mismatch (got ${codes(findings).join(",")})`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/15-02/structural with no ROADMAP file at all the cross-reference still emits nothing",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await driverFolder(workDir, "07_milestone_alpha");
        const findings = await runDoctor(repo, workDir);
        assert.ok(!has(findings, "roadmap-folder-mismatch"), `no roadmap-folder-mismatch (got ${codes(findings).join(",")})`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/15-02/structural with a structured milestone-index fixture a mismatch is reported",
    async run() {
      const rows = [
        // the index lists milestone 09 but no 09 folder exists (folders: 07, 08)
        { index: [{ number: "07" }, { number: "08" }, { number: "09" }], folders: ["07", "08"], mismatch: true },
        // a milestone 09 folder exists but the index omits it (index: 07, 08; folders 07,08,09)
        { index: [{ number: "07" }, { number: "08" }], folders: ["07", "08", "09"], mismatch: true },
        // the index and the folders agree exactly
        { index: [{ number: "07" }, { number: "08" }], folders: ["07", "08"], mismatch: false },
      ];
      for (const row of rows) {
        const { repo, workDir } = await makeRepo({ roadmap: { index: row.index } });
        try {
          for (const n of row.folders) await driverFolder(workDir, `${n}_milestone_m${n}`);
          const findings = await runDoctor(repo, workDir);
          assert.equal(has(findings, "roadmap-folder-mismatch"), row.mismatch, `index/folders: mismatch=${row.mismatch} (got ${codes(findings).join(",")})`);
          if (row.mismatch) assert.equal(findings.find((f) => f.code === "roadmap-folder-mismatch").severity, "warn", "roadmap-folder-mismatch is warn");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
];
