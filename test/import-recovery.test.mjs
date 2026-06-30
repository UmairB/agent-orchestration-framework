// Traceability wiring for milestone 13 / story 01 — source-shape recovery (the
// REAL heuristics behind story 00's frozen recoverMilestone seam).
//
// One test object per @executable scenario across the three task features
// (Scenario-Outline rows folded into one entry; each name traces to feature +
// scenario). The @manual real-world-repo row of 01 is DEFERRED (it needs a real
// external repo the user supplies at build; tracked in the feature as @manual).
//
//   00_recovers-aof-structured-milestone.feature — recover an aof-structured
//        source's SPEC intent → SPEC.md, its `## ADR-NNN` blocks → ARCHITECTURE.md
//        (parseArchitecture yields one adr per block, titles preserved), its
//        `## R<n>` entries → RETROSPECTIVE.md (parseRetrospective yields one lesson
//        per entry); exact record counts; no fabrication; the
//        section-present→artifact-present Scenario Outline (incl. SPEC-absent →
//        intent recorded "not recoverable").
//   01_recovers-arbitrary-repo.feature — @executable rows over a SMALL LOCAL
//        arbitrary fixture (README overview → intent; docs/ + ADR-style files →
//        decisions written INTO `## ADR-NNN`; git log → outcomes written INTO
//        `## R<n>`); existing parsers yield records matching the frozen
//        MemoryRecord shape; the signals→artifacts Scenario Outline. (@manual
//        real-world row DEFERRED.)
//   02_absence-is-information.feature — the 2³ truth table: present is recovered,
//        absent is MARKED (the canonical not-recoverable marker, 0 records of the
//        absent kind), never invented; a thin/empty source yields 0 records total.
//
// Recovery is driven over LOCAL fixture source repos built in temp dirs
// (aof-shaped + arbitrary-with-git-history + thin/empty). The round-trip
// assertions call recoverMilestone → materializeImport → parse the materialized
// `.md` with the EXISTING parseArchitecture/parseRetrospective (imported from
// src/memory/local-indexing.mjs) and assert record counts/types/titles + the
// frozen MemoryRecord field set.
import assert from "node:assert/strict";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recoverMilestone } from "../src/import/recovery.mjs";
import { materializeImport, INTENT_NOT_RECOVERABLE } from "../src/import/materialize.mjs";
import { parseArchitecture, parseRetrospective } from "../src/memory/local-indexing.mjs";
import { MEMORY_RECORD_FIELDS } from "../src/memory/local-retrieval.mjs";

// --- fixture builders -----------------------------------------------------------

// A throwaway project root the materialize writer writes its import store under.
async function makeProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), "aof-recovery-proj-"));
}

// Build an aof-STRUCTURED source: a `wiki/work/<ref>_milestone_demo/` folder whose
// own SPEC/ARCHITECTURE/RETROSPECTIVE are present per the `docs` selection. Each doc
// is only written when requested (so absence is real, not a stub). Returns the
// source dir. `adrCount` / `rCount` control how many ADR blocks / R entries.
async function makeAofSource({
  spec = true,
  arch = false,
  retro = false,
  adrCount = 2,
  rCount = 3,
  ref = "07",
  intentHeading = "Objective", // the heading the intent prose sits under (a source it
                               // didn't run may use a synonym like "Goal")
} = {}) {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-recovery-aof-src-"));
  const dir = path.join(src, "wiki", "work", `${ref}_milestone_demo`);
  await mkdir(dir, { recursive: true });

  if (spec) {
    await writeFile(
      path.join(dir, "SPEC.md"),
      [
        "---",
        "doc: spec",
        "---",
        `# ${ref} Demo Milestone`,
        "",
        `## ${intentHeading}`,
        "",
        "Deliver the demo capability end to end so the agents can recall it.",
        "",
        "## Scope",
        "",
        "In scope: the demo flow. Out of scope: live sync.",
        "",
      ].join("\n"),
      "utf8"
    );
  }
  if (arch) {
    const blocks = [];
    for (let i = 1; i <= adrCount; i += 1) {
      blocks.push(
        `## ADR-${String(i).padStart(3, "0")}: Decision number ${i} title`,
        "",
        "**Status:** Accepted",
        "",
        `**Decision.** We chose option ${i} for reason ${i}.`,
        ""
      );
    }
    await writeFile(
      path.join(dir, "ARCHITECTURE.md"),
      ["---", "doc: architecture", "---", `# ${ref} — Architecture Decisions`, "", ...blocks].join("\n"),
      "utf8"
    );
  }
  if (retro) {
    const entries = [];
    for (let i = 1; i <= rCount; i += 1) {
      entries.push(
        `## R${i} — Retro entry number ${i} title`,
        "",
        "- **Kind:** insight · **Area:** delivery · **Stage:** build · **Owner:** dev",
        "",
        `- **Lesson:** lesson learned number ${i}.`,
        ""
      );
    }
    await writeFile(
      path.join(dir, "RETROSPECTIVE.md"),
      ["---", "doc: retrospective", "---", `# ${ref} — Retrospective`, "", ...entries].join("\n"),
      "utf8"
    );
  }
  return src;
}

// Build a small ARBITRARY (non-aof) source repo: optionally a README overview,
// optional docs/ADR-style decision files, and — when `commits` is given — a REAL
// git history (`git init` + scripted commits, offline-feasible) so the git-log →
// outcomes lane has real subjects to recover. Returns the source dir.
async function makeArbitrarySource({
  readme = false,
  decisions = false,
  commits = null, // array of commit subjects (oldest first); null ⇒ not a git repo
} = {}) {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-recovery-arb-src-"));

  if (readme) {
    await writeFile(
      path.join(src, "README.md"),
      [
        "# Widget Engine",
        "",
        "[![build](https://example.test/badge.svg)](https://example.test)",
        "",
        "Widget Engine is a fast renderer that set out to make widgets composable and cheap to ship.",
        "",
        "## Install",
        "",
        "npm install widget-engine",
        "",
      ].join("\n"),
      "utf8"
    );
  }
  if (decisions) {
    const adrDir = path.join(src, "docs", "adr");
    await mkdir(adrDir, { recursive: true });
    await writeFile(
      path.join(adrDir, "0001-use-a-renderer.md"),
      ["# Use a streaming renderer", "", "We chose a streaming renderer to keep memory flat.", ""].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(adrDir, "0002-cache-widgets.md"),
      ["# Cache compiled widgets", "", "Compiled widgets are cached on first render.", ""].join("\n"),
      "utf8"
    );
  }
  if (Array.isArray(commits)) {
    // No shell: a shell would word-split a multi-word commit subject on Windows
    // (it silently leaves zero commits), and the recovered outcome titles ARE the
    // commit subjects — they must survive verbatim.
    const git = (args) => spawnSyncHardened("git", args, { cwd: src, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "fixture@aof.local"]);
    git(["config", "user.name", "aof fixture"]);
    git(["config", "commit.gpgsign", "false"]);
    for (let i = 0; i < commits.length; i += 1) {
      await writeFile(path.join(src, `file-${i}.txt`), `content ${i}\n`, "utf8");
      git(["add", "-A"]);
      git(["commit", "-q", "-m", commits[i]]);
    }
  }
  return src;
}

// A thin/empty source: a temp dir with nothing recoverable (no README, no docs, no
// git history, no aof work dir).
async function makeEmptySource() {
  return mkdtemp(path.join(os.tmpdir(), "aof-recovery-empty-src-"));
}

// Recover a source → materialize into a fresh project → read back the materialized
// artifact bodies + parse them with the EXISTING parsers. Returns the recovered
// shape, the materialized paths, and the parsed adr/lesson record arrays. Cleans up
// both temp roots via the caller's try/finally (returns paths for assertion).
async function recoverAndMaterialize(sourceDir, selector) {
  const projectRoot = await makeProjectRoot();
  const recovered = await recoverMilestone(sourceDir, selector);
  const out = await materializeImport({
    projectRoot,
    sourceSlug: "fixture",
    milestoneRef: String(selector ?? "00"),
    recovered,
  });

  const specPath = path.join(out.dir, "SPEC.md");
  const archPath = path.join(out.dir, "ARCHITECTURE.md");
  const retroPath = path.join(out.dir, "RETROSPECTIVE.md");

  const specBody = existsSync(specPath) ? await readFile(specPath, "utf8") : null;
  const archBody = existsSync(archPath) ? await readFile(archPath, "utf8") : null;
  const retroBody = existsSync(retroPath) ? await readFile(retroPath, "utf8") : null;

  const meta = { item: "00", itemSlug: "import-fixture" };
  const adrs = archBody ? parseArchitecture(archBody, { ...meta, workRelPath: "ARCHITECTURE.md" }) : [];
  const lessons = retroBody
    ? parseRetrospective(retroBody, { ...meta, workRelPath: "RETROSPECTIVE.md" })
    : [];

  return {
    projectRoot,
    recovered,
    dir: out.dir,
    specPath,
    archPath,
    retroPath,
    specBody,
    archBody,
    retroBody,
    adrs,
    lessons,
  };
}

// Assert every record carries EXACTLY the frozen MemoryRecord field set (ADR-005:
// absent-type fields present-as-"" — never omitted).
function assertFrozenRecordShape(record, label) {
  assert.deepEqual(
    Object.keys(record).sort(),
    [...MEMORY_RECORD_FIELDS].sort(),
    `${label}: record carries exactly the frozen MemoryRecord fields`
  );
  for (const field of MEMORY_RECORD_FIELDS) {
    assert.equal(typeof record[field], "string", `${label}: field "${field}" is a string (present-as-"" when absent)`);
  }
}

export const importRecoveryTests = [
  // ═════════════ 00_recovers-aof-structured-milestone.feature ════════════════
  {
    name: "recovery/00 the recovered SPEC.md carries the source SPEC's Objective and Scope",
    async run() {
      const src = await makeAofSource({ spec: true });
      let r;
      try {
        r = await recoverAndMaterialize(src, "07");
        assert.ok(r.specBody, "SPEC.md is materialized");
        assert.ok(
          /Deliver the demo capability end to end/.test(r.specBody),
          "the materialized SPEC.md carries the recovered Objective from the source"
        );
        assert.ok(
          /In scope: the demo flow/.test(r.specBody),
          "the materialized SPEC.md carries the recovered Scope from the source"
        );
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/00 an intent headed `## Goal` (a real-world SPEC synonym, not aof's `## Objective`) is recovered as the Objective",
    async run() {
      // The voice-vox testbed surfaced this: every source SPEC headed its intent
      // `## Goal`, so an Objective-only match recorded "not recoverable" despite a
      // clear goal. recoverAofIntent matches `Objective|Goal` — the Goal prose is
      // recovered verbatim (no fabrication), materialized under the SPEC's Objective.
      const src = await makeAofSource({ spec: true, intentHeading: "Goal" });
      let r;
      try {
        r = await recoverAndMaterialize(src, "07");
        assert.ok(r.specBody, "SPEC.md is materialized");
        assert.ok(
          !r.specBody.includes(INTENT_NOT_RECOVERABLE),
          "the intent is recovered (not marked not-recoverable) even though the heading is `## Goal`"
        );
        assert.ok(
          /Deliver the demo capability end to end/.test(r.specBody),
          "the `## Goal` prose is recovered as the materialized SPEC.md Objective"
        );
        assert.ok(
          /In scope: the demo flow/.test(r.specBody),
          "the Scope is still recovered alongside the Goal-headed intent"
        );
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/00 the source's ADR decisions appear in the materialized ARCHITECTURE.md as adr records",
    async run() {
      const src = await makeAofSource({ spec: true, arch: true, adrCount: 2 });
      let r;
      try {
        r = await recoverAndMaterialize(src, "07");
        assert.ok(r.archBody, "ARCHITECTURE.md is materialized");
        assert.ok(/^## ADR-001\b/m.test(r.archBody), "materialized ARCHITECTURE.md contains a ## ADR-001 block");
        assert.ok(/^## ADR-002\b/m.test(r.archBody), "materialized ARCHITECTURE.md contains a ## ADR-002 block");
        assert.equal(r.adrs.length, 2, "parseArchitecture yields one adr record per block");
        assert.ok(r.adrs.every((rec) => rec.recordType === "adr"), "each yielded record is an adr");
        // The recovered ADR title from the source is preserved on each record.
        assert.ok(
          r.adrs.some((rec) => /Decision number 1 title/.test(rec.title)),
          "each yielded adr record's title is the recovered ADR title from the source"
        );
        assert.ok(
          r.adrs.some((rec) => /Decision number 2 title/.test(rec.title)),
          "the second adr record's title is recovered from the source"
        );
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/00 the source's retro entries appear in the materialized RETROSPECTIVE.md as lesson records",
    async run() {
      const src = await makeAofSource({ spec: true, retro: true, rCount: 2 });
      let r;
      try {
        r = await recoverAndMaterialize(src, "07");
        assert.ok(r.retroBody, "RETROSPECTIVE.md is materialized");
        assert.ok(/^## R1\b/m.test(r.retroBody), "materialized RETROSPECTIVE.md contains a ## R1 entry");
        assert.ok(/^## R2\b/m.test(r.retroBody), "materialized RETROSPECTIVE.md contains a ## R2 entry");
        assert.equal(r.lessons.length, 2, "parseRetrospective yields one lesson record per entry");
        assert.ok(r.lessons.every((rec) => rec.recordType === "lesson"), "each yielded record is a lesson");
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/00 every recovered record traces back to recovered source content (2 ADRs, 3 R-entries)",
    async run() {
      const src = await makeAofSource({ spec: true, arch: true, retro: true, adrCount: 2, rCount: 3 });
      let r;
      try {
        r = await recoverAndMaterialize(src, "07");
        assert.equal(r.adrs.length, 2, "the materialized ARCHITECTURE.md yields exactly 2 adr records");
        assert.equal(r.lessons.length, 3, "the materialized RETROSPECTIVE.md yields exactly 3 lesson records");
        // No record is present that the source did not contain: each recovered title
        // corresponds to a source-authored block/entry (no fabrication, ADR-005).
        assert.ok(
          r.adrs.every((rec) => /Decision number \d+ title/.test(rec.title)),
          "no adr record is present that the source did not contain"
        );
        assert.ok(
          r.lessons.every((rec) => /Retro entry number \d+ title/.test(rec.title)),
          "no lesson record is present that the source did not contain"
        );
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/00 a present source section is recovered; a missing one is not invented (Scenario Outline, folded)",
    async run() {
      const cases = [
        // SPEC + ARCHITECTURE (2 ADRs) + RETROSPECTIVE (3 R) → Objective, 2, 3.
        {
          label: "all three present",
          source: { spec: true, arch: true, retro: true, adrCount: 2, rCount: 3 },
          specObjective: true,
          arch: 2,
          retro: 3,
        },
        // SPEC only → Objective, 0, 0.
        { label: "SPEC only", source: { spec: true }, specObjective: true, arch: 0, retro: 0 },
        // SPEC absent, ARCHITECTURE (1 ADR) + RETROSPECTIVE (1 R) → not-recoverable, 1, 1.
        {
          label: "SPEC absent, ARCH + RETRO present",
          source: { spec: false, arch: true, retro: true, adrCount: 1, rCount: 1 },
          specObjective: false,
          arch: 1,
          retro: 1,
        },
      ];
      for (const c of cases) {
        const src = await makeAofSource(c.source);
        let r;
        try {
          r = await recoverAndMaterialize(src, "07");
          assert.ok(r.specBody, `[${c.label}] SPEC.md is always materialized`);
          if (c.specObjective) {
            assert.ok(
              /Deliver the demo capability end to end/.test(r.specBody),
              `[${c.label}] the materialized SPEC.md carries the recovered Objective`
            );
          } else {
            assert.ok(
              r.specBody.includes(INTENT_NOT_RECOVERABLE),
              `[${c.label}] the materialized SPEC.md records the intent as not recoverable`
            );
          }
          assert.equal(r.adrs.length, c.arch, `[${c.label}] parseArchitecture yields ${c.arch} adr records`);
          assert.equal(r.lessons.length, c.retro, `[${c.label}] parseRetrospective yields ${c.retro} lesson records`);
        } finally {
          await rm(src, { recursive: true, force: true });
          if (r) await rm(r.projectRoot, { recursive: true, force: true });
        }
      }
    },
  },

  // ═════════════ 01_recovers-arbitrary-repo.feature ═══════════════════════════
  {
    name: "recovery/01 a README's overview is recovered into the materialized SPEC.md intent",
    async run() {
      const src = await makeArbitrarySource({ readme: true });
      let r;
      try {
        r = await recoverAndMaterialize(src, null);
        assert.ok(r.specBody, "SPEC.md is materialized");
        assert.ok(
          /set out to make widgets composable/.test(r.specBody),
          "the materialized SPEC.md recovers the README overview as its Objective"
        );
        // Legible intent, NOT an index record source: SPEC.md is never parsed into
        // adr/lesson records (only ARCHITECTURE/RETROSPECTIVE are). README-only ⇒ 0 records.
        assert.equal(r.adrs.length, 0, "SPEC.md is legible intent, not an index record source (no adr records)");
        assert.equal(r.lessons.length, 0, "SPEC.md is legible intent, not an index record source (no lesson records)");
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/01 decisions in docs/ or ADR-style files are recovered into the ARCHITECTURE.md shape",
    async run() {
      const src = await makeArbitrarySource({ decisions: true });
      let r;
      try {
        r = await recoverAndMaterialize(src, null);
        assert.ok(r.archBody, "ARCHITECTURE.md is materialized");
        assert.ok(/^## ADR-\d+/m.test(r.archBody), "materialized ARCHITECTURE.md contains the recovered decisions as ## ADR-NNN blocks");
        assert.equal(r.adrs.length, 2, "parseArchitecture yields one adr record per recovered decision");
        assert.ok(r.adrs.every((rec) => rec.recordType === "adr"), "each yielded record is an adr");
        assert.ok(
          r.adrs.some((rec) => /streaming renderer/i.test(rec.title) || /Cache compiled widgets/i.test(rec.title)),
          "the recovered decision titles come from the source ADR files"
        );
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/01 outcomes in the commit history are recovered into the RETROSPECTIVE.md shape",
    async run() {
      const src = await makeArbitrarySource({
        commits: ["initial scaffold", "add the renderer", "ship caching"],
      });
      let r;
      try {
        r = await recoverAndMaterialize(src, null);
        assert.ok(r.retroBody, "RETROSPECTIVE.md is materialized");
        assert.ok(/^## R1\b/m.test(r.retroBody), "materialized RETROSPECTIVE.md contains the recovered outcomes as ## R<n> entries");
        assert.equal(r.lessons.length, 3, "parseRetrospective yields one lesson record per recovered commit subject");
        assert.ok(r.lessons.every((rec) => rec.recordType === "lesson"), "each yielded record is a lesson");
        // The commit subjects are the recovered outcome titles (read-only git log).
        assert.ok(
          r.lessons.some((rec) => /add the renderer/.test(rec.title)),
          "a commit subject is recovered as a lesson title"
        );
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/01 the recovered artifacts use the 05 heading conventions so the existing parsers index them",
    async run() {
      const src = await makeArbitrarySource({
        readme: true,
        decisions: true,
        commits: ["initial scaffold", "ship the engine"],
      });
      let r;
      try {
        r = await recoverAndMaterialize(src, null);
        assert.ok(r.adrs.length >= 1, "parseArchitecture over the materialized ARCHITECTURE.md yields at least one adr record");
        assert.ok(r.lessons.length >= 1, "parseRetrospective over the materialized RETROSPECTIVE.md yields at least one lesson record");
        // Every yielded record matches the frozen MemoryRecord shape (ADR-005).
        for (const rec of r.adrs) assertFrozenRecordShape(rec, "arbitrary adr");
        for (const rec of r.lessons) assertFrozenRecordShape(rec, "arbitrary lesson");
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/01 which arbitrary signals are present determines which artifacts carry records (Scenario Outline, folded)",
    async run() {
      const cases = [
        // README only → Objective, 0, 0.
        { label: "README only", source: { readme: true }, objective: true, arch: 0, retro: 0 },
        // docs/ADRs only → not-recoverable, >0, 0.
        { label: "docs/ADRs only", source: { decisions: true }, objective: false, arch: ">0", retro: 0 },
        // git log only → not-recoverable, 0, >0.
        { label: "git log only", source: { commits: ["a", "b"] }, objective: false, arch: 0, retro: ">0" },
        // README + docs + git log → Objective, >0, >0.
        {
          label: "all three",
          source: { readme: true, decisions: true, commits: ["a", "b"] },
          objective: true,
          arch: ">0",
          retro: ">0",
        },
      ];
      for (const c of cases) {
        const src = await makeArbitrarySource(c.source);
        let r;
        try {
          r = await recoverAndMaterialize(src, null);
          assert.ok(r.specBody, `[${c.label}] SPEC.md is always materialized`);
          if (c.objective) {
            assert.ok(
              !r.specBody.includes(INTENT_NOT_RECOVERABLE) || /set out to/.test(r.specBody),
              `[${c.label}] the materialized SPEC.md recovers the intent as Objective`
            );
            assert.ok(/set out to/.test(r.specBody), `[${c.label}] the SPEC.md Objective is the recovered README overview`);
          } else {
            assert.ok(
              r.specBody.includes(INTENT_NOT_RECOVERABLE),
              `[${c.label}] the materialized SPEC.md records the intent as not recoverable`
            );
          }
          if (c.arch === ">0") assert.ok(r.adrs.length > 0, `[${c.label}] parseArchitecture yields >0 adr records`);
          else assert.equal(r.adrs.length, c.arch, `[${c.label}] parseArchitecture yields ${c.arch} adr records`);
          if (c.retro === ">0") assert.ok(r.lessons.length > 0, `[${c.label}] parseRetrospective yields >0 lesson records`);
          else assert.equal(r.lessons.length, c.retro, `[${c.label}] parseRetrospective yields ${c.retro} lesson records`);
        } finally {
          await rm(src, { recursive: true, force: true });
          if (r) await rm(r.projectRoot, { recursive: true, force: true });
        }
      }
    },
  },

  // ═════════════ 02_absence-is-information.feature ════════════════════════════
  {
    name: "recovery/02 a source with no recoverable intent records the absence and invents no Objective",
    async run() {
      const src = await makeEmptySource(); // no README, no SPEC
      let r;
      try {
        r = await recoverAndMaterialize(src, null);
        assert.equal(r.recovered.intent, null, "recovery records intent as null (no recoverable intent)");
        assert.ok(r.specBody, "SPEC.md is always materialized");
        assert.ok(
          r.specBody.includes(INTENT_NOT_RECOVERABLE),
          "the materialized SPEC.md records the intent as explicitly not recoverable"
        );
        // It states no Objective the source did not contain: the Objective section is
        // exactly the not-recoverable marker, no fabricated prose.
        const objectiveSection = r.specBody.split(/^## Scope/m)[0];
        assert.ok(
          objectiveSection.includes(INTENT_NOT_RECOVERABLE),
          "the SPEC.md Objective section is the not-recoverable marker, not a fabricated Objective"
        );
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/02 a source with no recoverable decisions emits no fabricated ADR record",
    async run() {
      const src = await makeArbitrarySource({ readme: true }); // README but no docs/ADRs
      let r;
      try {
        r = await recoverAndMaterialize(src, null);
        assert.deepEqual(r.recovered.decisions, [], "recovery records no decisions (none to recover)");
        assert.ok(
          r.archBody === null || !/^## ADR-/m.test(r.archBody),
          "the materialized ARCHITECTURE.md is absent or carries no ## ADR-NNN block"
        );
        assert.equal(r.adrs.length, 0, "parseArchitecture over the materialized artifact set yields 0 adr records");
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/02 a source with no recoverable outcomes emits no fabricated lesson record",
    async run() {
      const src = await makeArbitrarySource({ readme: true }); // no git history, no retro
      let r;
      try {
        r = await recoverAndMaterialize(src, null);
        assert.deepEqual(r.recovered.outcomes, [], "recovery records no outcomes (none to recover)");
        assert.ok(
          r.retroBody === null || !/^## R\d+/m.test(r.retroBody),
          "the materialized RETROSPECTIVE.md is absent or carries no ## R<n> entry"
        );
        assert.equal(r.lessons.length, 0, "parseRetrospective over the materialized artifact set yields 0 lesson records");
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/02 a thin source yields zero index records, not invented ones",
    async run() {
      const src = await makeEmptySource();
      let r;
      try {
        r = await recoverAndMaterialize(src, null);
        assert.equal(r.adrs.length + r.lessons.length, 0, "the existing parsers over the materialized artifact set yield 0 records in total");
        assert.ok(
          r.specBody.includes(INTENT_NOT_RECOVERABLE),
          "the materialized SPEC.md records the intent as explicitly not recoverable"
        );
      } finally {
        await rm(src, { recursive: true, force: true });
        if (r) await rm(r.projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "recovery/02 present is recovered, absent is marked — the 2^3 no-fabrication truth table (Scenario Outline, folded)",
    async run() {
      // The truth table is driven over an aof-structured source where we control the
      // presence of each half precisely (SPEC ⇒ intent, ARCHITECTURE ⇒ decisions,
      // RETROSPECTIVE ⇒ outcomes). present ⇒ recovered (>0 records / Objective);
      // absent ⇒ marked (0 records / the not-recoverable marker), never invented.
      const rows = [
        { intent: true, decisions: true, outcomes: true, spec: "objective", adr: ">0", lesson: ">0" },
        { intent: false, decisions: true, outcomes: true, spec: "absent", adr: ">0", lesson: ">0" },
        { intent: true, decisions: false, outcomes: true, spec: "objective", adr: 0, lesson: ">0" },
        { intent: true, decisions: true, outcomes: false, spec: "objective", adr: ">0", lesson: 0 },
        { intent: true, decisions: false, outcomes: false, spec: "objective", adr: 0, lesson: 0 },
        { intent: false, decisions: true, outcomes: false, spec: "absent", adr: ">0", lesson: 0 },
        { intent: false, decisions: false, outcomes: true, spec: "absent", adr: 0, lesson: ">0" },
        { intent: false, decisions: false, outcomes: false, spec: "absent", adr: 0, lesson: 0 },
      ];
      for (const row of rows) {
        const label = `intent=${row.intent} decisions=${row.decisions} outcomes=${row.outcomes}`;
        const src = await makeAofSource({
          spec: row.intent,
          arch: row.decisions,
          retro: row.outcomes,
          adrCount: 2,
          rCount: 2,
        });
        let r;
        try {
          r = await recoverAndMaterialize(src, "07");
          if (row.spec === "objective") {
            assert.ok(
              /Deliver the demo capability end to end/.test(r.specBody),
              `[${label}] the materialized SPEC.md carries the recovered Objective`
            );
          } else {
            assert.ok(
              r.specBody.includes(INTENT_NOT_RECOVERABLE),
              `[${label}] the materialized SPEC.md records the intent as not recoverable`
            );
          }
          if (row.adr === ">0") assert.ok(r.adrs.length > 0, `[${label}] parseArchitecture yields >0 adr records`);
          else assert.equal(r.adrs.length, 0, `[${label}] parseArchitecture yields 0 adr records`);
          if (row.lesson === ">0") assert.ok(r.lessons.length > 0, `[${label}] parseRetrospective yields >0 lesson records`);
          else assert.equal(r.lessons.length, 0, `[${label}] parseRetrospective yields 0 lesson records`);
        } finally {
          await rm(src, { recursive: true, force: true });
          if (r) await rm(r.projectRoot, { recursive: true, force: true });
        }
      }
    },
  },
];
