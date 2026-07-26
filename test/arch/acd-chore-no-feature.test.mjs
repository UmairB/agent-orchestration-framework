// Fitness function for milestone 37 / ADR-002 + ADR-003 (FF-3704b):
// "A `chore` carries NO behavioural contract: a well-formed chore folder — a single
//  CHORE.md record doc, NO `tasks/`, NO `.feature` — validates CLEAN. The chore is
//  not held to the story/task schema; a chore having no `tasks/` is valid."
//
// The structural half of ADR-003's chore verify path (checklist + validate-green),
// pulled OUT of any task feature. Proven against the exported validateWork over a
// fixture. Red-until-built: inert-green until the vocabulary lands in ITEM_RE;
// self-activates on story 00.
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateWork } from "../../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workSrc = path.join(repoRoot, "src", "work.mjs");

async function itemTypeAlternation() {
  const src = await readFile(workSrc, "utf8");
  const m = src.match(/const\s+ITEM_RE\s*=\s*\/\^\(\\d\+\)_\(([^)]+)\)_/);
  if (!m) return null;
  return new Set(m[1].split("|").map((t) => t.trim()));
}
async function vocabularyLanded() {
  const types = await itemTypeAlternation();
  return types != null && types.has("spike") && types.has("chore");
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// A stream with ONE well-formed chore driver: CHORE.md only, no tasks/, no .feature.
async function buildChoreFixture() {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "aof-arch-chore-no-feature-"));
  const dir = path.join(workDir, "00_chore_tidy-config");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "CHORE.md"),
    frontmatter({ type: "chore", number: "00", slug: "tidy-config", status: "not-started", title: '"Tidy config"', owner: "developer", created: "2026-07-09", updated: "2026-07-09", depends: "[]", schema: 1 }) +
      "# 00 · Tidy config\n\n## Intent\nHousekeeping — normalise the config files.\n\n## Definition of Done\n- [ ] configs formatted\n- [ ] `aof work validate` green\n\n## Notes\n(optional)\n",
    "utf8"
  );
  return { workDir, choreDir: dir };
}

export const archTests = [
  {
    name: "arch/chore-no-feature: a well-formed chore (CHORE.md, no tasks/, no .feature) validates CLEAN (FF-3704b)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until the vocabulary lands
      const { workDir, choreDir } = await buildChoreFixture();
      try {
        const findings = await validateWork(workDir, { name: "fixture" }, null);
        const aboutChore = findings.filter((f) => f.path && f.path.startsWith(choreDir));
        assert.deepEqual(
          aboutChore,
          [],
          `a well-formed chore raises NO validate finding (a chore having no tasks/ is valid); got: ${JSON.stringify(aboutChore)}`
        );
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/chore-no-feature: NON-VACUITY — a chore with a MISSING record doc is still flagged (validate is live over the type)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until the vocabulary lands
      const workDir = await mkdtemp(path.join(os.tmpdir(), "aof-arch-chore-nv-"));
      const dir = path.join(workDir, "00_chore_tidy-config");
      await mkdir(dir, { recursive: true }); // folder exists, NO CHORE.md
      try {
        const findings = await validateWork(workDir, { name: "fixture" }, null);
        assert.ok(
          findings.some((f) => f.path && f.path.startsWith(dir)),
          "a chore folder with no record doc IS flagged — proving validate runs over the chore type (non-vacuity)"
        );
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  },
];
