// Fitness function for milestone 40 / ADR-004 — the migration-scoped frontmatter writer
// touches ONLY the frontmatter block; the authored body prose is byte-identical around
// the change; and it is a SEPARATE writer, never a widening of `rollbackItemStatus`.
//
// The bound the migration writer must mirror already exists and is exercised here
// ALWAYS-LIVE over the real `rollbackItemStatus` export (work.mjs:375, 20/ADR-005): it
// rewrites only the `status:` line inside the leading `---…---` block and reassembles
// every other byte — the body and every other key — unchanged. ADR-004 forbids widening
// this bounded writer into a general mutator; the migration writer is a NEW, distinct
// export that widens the SCOPE to the whole frontmatter block while keeping the body
// byte-identical. The second proof is GUARD-IF-PRESENT: once that writer lands it must
// be a separate function from `rollbackItemStatus`.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as work from "../../src/work.mjs";

// Candidate names for the ADR-004 transform-scoped writer (exact name is a story-01
// decision); the guard probes this set.
const MIGRATION_WRITER_NAMES = [
  "applyItemFrontmatter",
  "writeItemFrontmatter",
  "applyFrontmatterTransform",
  "migrateItemFrontmatter",
  "rewriteItemFrontmatter",
];

async function buildStoryFixture(bodyProse) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "aof-arch-m40-writer-"));
  const dir = path.join(workDir, "00_milestone_host", "stories", "00_story_subject");
  await mkdir(dir, { recursive: true });
  const frontmatter =
    "---\n" +
    "type: story\n" +
    "number: 00\n" +
    "slug: subject\n" +
    "status: in-progress\n" +
    'title: "Subject"\n' +
    "owner: developer\n" +
    "created: 2026-07-17\n" +
    "updated: 2026-07-17\n" +
    "depends: []\n" +
    "---\n";
  const doc = path.join(dir, "STORY.md");
  await (await import("node:fs/promises")).writeFile(doc, frontmatter + bodyProse, "utf8");
  return { workDir, item: { type: "story", ref: "00/00", dir } };
}

export const archTests = [
  {
    name: "arch/ADR-004(m40): the bounded frontmatter writer (rollbackItemStatus) preserves the authored body BYTE-IDENTICALLY — the bound the migration writer mirrors",
    run: async () => {
      // A body carrying real authored prose, including a line that LOOKS like frontmatter
      // (`status: still here`) to prove the writer edits the block, not a body echo.
      const body =
        "# 00 · Subject\n\nAs a maintainer I want the upgrade to run.\n\n" +
        "Note: status: still here — this body line must survive verbatim.\n\n" +
        "## Acceptance\n- [ ] a thing\n";
      const { workDir, item } = await buildStoryFixture(body);
      try {
        const before = await readFile(path.join(item.dir, "STORY.md"), "utf8");
        await work.rollbackItemStatus(item, "not-started");
        const after = await readFile(path.join(item.dir, "STORY.md"), "utf8");

        // The body (everything after the closing `---`) is byte-identical.
        const bodyOf = (text) => text.slice(text.indexOf("\n---", 3) + "\n---".length);
        assert.equal(bodyOf(after), bodyOf(before), "the authored body is byte-identical after the frontmatter write");

        // The status line DID change (a real write happened — non-vacuity).
        assert.ok(/^status:\s*not-started\s*$/m.test(after), "the status frontmatter key was rewritten to not-started");
        assert.ok(!/^status:\s*in-progress\s*$/m.test(after), "the prior status value is gone");
        // The body's decoy `status: still here` line is untouched.
        assert.ok(after.includes("Note: status: still here — this body line must survive verbatim."), "a body line that resembles frontmatter is NOT rewritten");
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/ADR-004(m40): GUARD-IF-PRESENT — the migration writer is a SEPARATE export, NOT a widening of rollbackItemStatus (the bounded status writer stays bounded)",
    run: async () => {
      const writerName = MIGRATION_WRITER_NAMES.find((name) => typeof work[name] === "function");
      if (writerName === undefined) return; // guard-if-present: the migration writer has not landed
      assert.equal(typeof work.rollbackItemStatus, "function", "rollbackItemStatus still exists as its own bounded writer");
      assert.notEqual(writerName, "rollbackItemStatus", "the migration writer is a distinct export, not the rollback writer widened");
      assert.notEqual(
        work[writerName],
        work.rollbackItemStatus,
        `the migration writer (${writerName}) and rollbackItemStatus are two separate functions — the status writer's hard bound is untouched (ADR-004)`,
      );
    },
  },
];
