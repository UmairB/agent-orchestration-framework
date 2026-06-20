// Fitness function for milestone 05 / ADR-005:
// "The local index is written only to .aof/aof.memory.index.json, that path is
//  git-ignored, and every record matches the frozen MemoryRecord shape."
//
// Behavioural proof: reindex into a temp project; assert the ONLY memory file
// written under .aof/ is aof.memory.index.json; assert it is git-ignored via the
// SELF-CONTAINED nested .aof/.gitignore (milestone 04 finding F-02 — never the
// repo-root .gitignore; a nested ignore is applied by git relative to its own dir);
// validate each record against the frozen MemoryRecord shape (required keys present;
// absent-type fields present as "").
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { reindex, memoryIndexPath } from "../../src/memory/local-indexing.mjs";

const FIXED_NAME = "aof.memory.index.json";
// F-02: ignored via the nested .aof/.gitignore, so the entry is relative to .aof/.
const GITIGNORE_ENTRY = "aof.memory.index.json";

const MEMORY_RECORD_KEYS = [
  "recordType", "id", "item", "itemSlug", "title",
  "area", "stage", "kind", "owner", "status", "summary", "text", "source",
];

const FIXTURE_RETRO = `# 01 · Fixture — Retrospective

## R1 — A fixture lesson

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** developer
- **What happened:** something.
- **Why:** reasons.
- **Lesson:** the fixture lesson gist.
`;

const FIXTURE_ARCH = `# 01 · Fixture — Architecture Decisions

## ADR-001: A fixture decision

**Status:** Accepted
**Date:** 2026-06-19

**Decision.** the fixture decision gist.

**Invariant.** the fixture invariant.
`;

async function tempProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-arch-location-"));
  const workDir = path.join(projectRoot, "wiki", "work");
  const milestone = path.join(workDir, "01_milestone_fixture");
  await mkdir(milestone, { recursive: true });
  await writeFile(path.join(milestone, "RETROSPECTIVE.md"), FIXTURE_RETRO, "utf8");
  await writeFile(path.join(milestone, "ARCHITECTURE.md"), FIXTURE_ARCH, "utf8");
  // .aof/ exists (and is "tracked" — mirroring the real repo's reality).
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  return { projectRoot, workDir, ctx: { workDir, projectRoot, configMemory: {} } };
}

export const archTests = [
  {
    name: "arch/ADR-005: the only memory file written under .aof/ is aof.memory.index.json",
    run: async () => {
      const { projectRoot, ctx } = await tempProject();
      try {
        await reindex(null, ctx);
        const aofDir = path.join(projectRoot, ".aof");
        const memoryFiles = (await readdir(aofDir)).filter((name) => /memory/i.test(name));
        assert.deepEqual(memoryFiles, [FIXED_NAME], `the only memory file under .aof/ is ${FIXED_NAME} (found: ${memoryFiles.join(", ")})`);
        assert.ok(existsSync(memoryIndexPath(projectRoot)), "the fixed-path index exists");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/ADR-005: no memory index is written anywhere outside the fixed path",
    run: async () => {
      const { projectRoot, ctx } = await tempProject();
      try {
        await reindex(null, ctx);
        const allowed = memoryIndexPath(projectRoot);
        const stray = [];
        async function walk(dir) {
          let entries;
          try {
            entries = await readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (/memory.*index\.json$/i.test(entry.name) && full !== allowed) stray.push(full);
          }
        }
        await walk(projectRoot);
        assert.deepEqual(stray, [], `no memory index outside the fixed path (found: ${stray.join(", ")})`);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/ADR-005: the index is git-ignored via the nested .aof/.gitignore after reindex (F-02)",
    run: async () => {
      const { projectRoot, ctx } = await tempProject();
      try {
        await reindex(null, ctx);
        const gitignorePath = path.join(projectRoot, ".aof", ".gitignore");
        assert.ok(existsSync(gitignorePath), ".aof/.gitignore exists after reindex");
        assert.ok(!existsSync(path.join(projectRoot, ".gitignore")), "the repo-root .gitignore is left untouched (F-02)");
        const lines = (await readFile(gitignorePath, "utf8")).split(/\r?\n/).map((l) => l.trim());
        assert.ok(lines.includes(GITIGNORE_ENTRY), `.aof/.gitignore ignores ${GITIGNORE_ENTRY}`);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/ADR-005: every record matches the frozen MemoryRecord shape (keys present, absent-type fields as \"\")",
    run: async () => {
      const { projectRoot, ctx } = await tempProject();
      try {
        const result = await reindex(null, ctx);
        assert.ok(result.records.length >= 2, "fixture produced a lesson and an adr");
        for (const record of result.records) {
          // exactly the frozen key set, all strings.
          assert.deepEqual(
            Object.keys(record).sort(),
            [...MEMORY_RECORD_KEYS].sort(),
            `record ${record.id} has exactly the frozen MemoryRecord keys`,
          );
          for (const key of MEMORY_RECORD_KEYS) {
            assert.equal(typeof record[key], "string", `record ${record.id} field "${key}" is a string`);
          }
          assert.ok(["lesson", "adr"].includes(record.recordType), `record ${record.id} recordType is lesson|adr`);

          if (record.recordType === "lesson") {
            // adr-only field present-as-"".
            assert.equal(record.status, "", `lesson ${record.id} has status ""`);
          } else {
            // lesson-only fields present-as-"" and area hard-fixed.
            assert.equal(record.area, "architecture", `adr ${record.id} area is "architecture"`);
            assert.equal(record.stage, "", `adr ${record.id} has stage ""`);
            assert.equal(record.kind, "", `adr ${record.id} has kind ""`);
            assert.equal(record.owner, "", `adr ${record.id} has owner ""`);
          }
        }
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
];
