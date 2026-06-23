// Fitness function for milestone 13 / ADR-001 + ADR-005:
// "Derived-index invariant for imports (+ no fabrication, clean snapshot). A fresh
//  re-import + reindex reproduces the IDENTICAL imported record set; every imported
//  record's source:line resolves to live text WITHIN the git-ignored, re-derivable
//  import store; the index holds no imported fact absent from that .md; and no record is
//  produced that the materialized .md does not contain."
//
// Mirrors 05's acd-memory-derived-index (records resolve + reindex idempotent), extended
// to the import store as a NEW derived source — resolving the import leg via the
// leg-aware resolveRecordSourcePath (import records base on the import-store root, not
// workDir; 13/ADR-005). Halves, all CI-able offline:
//   (a) SOURCE-RESOLVES-IN-STORE: materialize a fixture import + reindex; for EACH
//       imported record, resolveRecordSourcePath bases it on the import-store root and the
//       resolved file's line is the record's OWN heading (R<n>/ADR-NNN) — a per-entry line
//       that traces to live materialized text (no fact absent from the .md).
//   (b) CLEAN-SNAPSHOT: a SECOND import over the SAME fixture recovery yields the IDENTICAL
//       artifact set (same files, byte-identical) AND the IDENTICAL imported record set —
//       no growth, no accretion (the one-time-snapshot invariant, ADR-005).
//   (c) GIT-IGNORED: the import store is git-ignored via the nested .aof/imports/.gitignore
//       (re-derivable, never an authoritative second copy), never the repo root.
//
// Non-vacuous: (a) goes RED if an imported record's source pointed outside the store /
// to a non-heading line (a fabricated or mis-based fact); (b) goes RED if a re-import
// accreted records or changed an artifact's bytes; (c) goes RED if the store stopped
// being git-ignored.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  reindex,
  resolveRecordSourcePath,
  isImportRecord,
} from "../../src/memory/local-indexing.mjs";
import { materializeImport } from "../../src/import/materialize.mjs";
import { importStoreRoot, importMilestoneDir } from "../../src/import/store.mjs";

const SOURCE_SLUG = "fixture-src";
const MILESTONE_REF = "00";

// A FIXED recovery — two decisions (→ two adr records) + two outcomes (→ two lessons) +
// a recovered intent (→ SPEC.md, never indexed). Fixed, so a re-import over it is a
// byte-identical re-materialize (the clean-snapshot proof).
function fixtureRecovered() {
  return {
    intent: { objective: "Recover the beacon milestone faithfully.", scope: "In: snapshot. Out: live sync." },
    decisions: [
      { id: "ADR-001", title: "Beacon routing reuses the existing seam", status: "Accepted", body: "**Decision.** The beacon reuses the existing routing seam." },
      { id: "ADR-002", title: "Beacon is read-only on the source", status: "Accepted", body: "**Decision.** The beacon reads the source read-only." },
    ],
    outcomes: [
      { id: "R1", title: "Freezing the beacon seam first unblocked the siblings", body: "- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** dev\n\n- **Lesson:** freeze the beacon seam before fanning out." },
      { id: "R2", title: "The clean re-import kept the snapshot honest", body: "- **Kind:** insight · **Area:** process · **Stage:** verify · **Owner:** dev\n\n- **Lesson:** a re-import re-materializes fresh; nothing accretes." },
    ],
  };
}

async function tempProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-arch-import-derived-"));
  const workDir = path.join(projectRoot, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  return { projectRoot, workDir, ctx: { workDir, projectRoot, configMemory: {} } };
}

// A stable key for a MemoryRecord (every frozen field joined) — for set equality.
const RECORD_KEYS = ["recordType", "id", "item", "itemSlug", "title", "area", "stage", "kind", "owner", "status", "summary", "text", "source"];
const recordKey = (r) => RECORD_KEYS.map((k) => r[k]).join("");

// Read a per-import folder's artifact files + bytes, for the byte-identical snapshot proof.
async function readArtifactSet(dir) {
  const out = {};
  for (const entry of (await readdir(dir)).sort()) {
    out[entry] = await readFile(path.join(dir, entry), "utf8");
  }
  return out;
}

export const archTests = [
  {
    name: "arch/import-derived-index: every imported record's source:line resolves (leg-aware) to live text in the import store whose heading NAMES the record",
    run: async () => {
      const { projectRoot, ctx } = await tempProject();
      try {
        await materializeImport({ projectRoot, sourceSlug: SOURCE_SLUG, milestoneRef: MILESTONE_REF, recovered: fixtureRecovered() }, {});
        const result = await reindex(null, ctx);
        const imported = result.records.filter(isImportRecord);
        assert.equal(imported.length, 4, "the fixture yields four imported records (2 adr + 2 lesson)");

        for (const record of imported) {
          // LEG-AWARE resolution: an import record bases its source on the import-store
          // ROOT (13/ADR-005), NOT workDir. The helper keys off the `import:` item prefix.
          const { absPath, line } = resolveRecordSourcePath(record, { workDir: ctx.workDir, projectRoot });
          // The resolved file is INSIDE the import store (never workDir, never outside it).
          const root = importStoreRoot(projectRoot);
          const relToRoot = path.relative(root, absPath);
          assert.ok(!relToRoot.startsWith(".."), `record ${record.id} resolves WITHIN the import store (got: ${absPath})`);
          assert.ok(existsSync(absPath), `record ${record.id} source file exists in the store: ${relToRoot}`);

          const lines = (await readFile(absPath, "utf8")).split(/\r?\n/);
          assert.ok(Number.isInteger(line) && line >= 1 && line <= lines.length, `record ${record.id} line ${line} is within the file`);
          // The recorded line is the record's OWN heading — a per-entry line that proves
          // the record traces to live materialized text (no fact absent from the .md).
          assert.ok(
            lines[line - 1].includes(record.id),
            `record ${record.id}'s source line is its own heading (got: "${lines[line - 1]}")`
          );
        }
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-derived-index: a SECOND import over the same fixture yields the IDENTICAL artifact set + record set (clean one-time snapshot, no accretion)",
    run: async () => {
      const { projectRoot, ctx } = await tempProject();
      try {
        const dir = importMilestoneDir(projectRoot, SOURCE_SLUG, MILESTONE_REF);

        await materializeImport({ projectRoot, sourceSlug: SOURCE_SLUG, milestoneRef: MILESTONE_REF, recovered: fixtureRecovered() }, {});
        const firstArtifacts = await readArtifactSet(dir);
        const firstRecords = (await reindex(null, ctx)).records.filter(isImportRecord).map(recordKey).sort();

        // Re-import the SAME source (a clean re-materialize replacing the prior snapshot).
        await materializeImport({ projectRoot, sourceSlug: SOURCE_SLUG, milestoneRef: MILESTONE_REF, recovered: fixtureRecovered() }, {});
        const secondArtifacts = await readArtifactSet(dir);
        const secondRecords = (await reindex(null, ctx)).records.filter(isImportRecord).map(recordKey).sort();

        // Byte-identical artifact set — same files, same content (no growth across runs).
        assert.deepEqual(Object.keys(secondArtifacts).sort(), Object.keys(firstArtifacts).sort(), "the artifact FILE set is identical across imports");
        for (const file of Object.keys(firstArtifacts)) {
          assert.equal(secondArtifacts[file], firstArtifacts[file], `${file} is byte-identical across imports (clean re-materialize)`);
        }
        // Identical imported record set — nothing accreted.
        assert.equal(secondRecords.length, firstRecords.length, "the imported record COUNT is stable across re-imports (no accretion)");
        assert.deepEqual(secondRecords, firstRecords, "the imported record SET is identical across re-imports (clean snapshot)");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-derived-index: the import store is git-ignored via the nested .aof/imports/.gitignore (re-derivable, never an authoritative second copy)",
    run: async () => {
      const { projectRoot } = await tempProject();
      try {
        await materializeImport({ projectRoot, sourceSlug: SOURCE_SLUG, milestoneRef: MILESTONE_REF, recovered: fixtureRecovered() }, {});
        const nestedGitignore = path.join(importStoreRoot(projectRoot), ".gitignore");
        assert.ok(existsSync(nestedGitignore), ".aof/imports/.gitignore exists (the store is git-ignored)");
        assert.ok(!existsSync(path.join(projectRoot, ".gitignore")), "the repo-root .gitignore is left untouched (F-02 nested discipline)");
        const lines = (await readFile(nestedGitignore, "utf8")).split(/\r?\n/).map((l) => l.trim());
        assert.ok(lines.includes("*"), "the nested ignore ignores everything under the store (`*`)");
        assert.ok(lines.includes("!.gitignore"), "the nested ignore keeps the ignore file itself tracked (`!.gitignore`)");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
];
