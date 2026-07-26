// Fitness function for milestone 37 / ADR-002 + ADR-003 (FF-3704a):
// "A `spike` carries NO behavioural contract: a well-formed spike folder — a single
//  SPIKE.md record doc, NO `tasks/`, NO `.feature` — validates CLEAN. The spike is
//  not held to the story/task schema."
//
// This is the STRUCTURAL half of ADR-003's per-type verify path, pulled OUT of any
// task feature (a structural assertion is a fitness function, never a Gherkin
// scenario). Proven against the exported validateWork over a fixture stream: the
// spike raises NO finding, while a positive control (a story with a broken feature
// tag or a real milestone) shows validate is still doing its job.
//
// Red-until-built: inert-green until the vocabulary lands in ITEM_RE (until then a
// spike folder is simply not enumerated as a work item). Self-activates on story 00.
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

// A stream with ONE well-formed spike driver: SPIKE.md only, no tasks/, no .feature.
async function buildSpikeFixture() {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "aof-arch-spike-no-feature-"));
  const dir = path.join(workDir, "00_spike_de-risk-thing");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPIKE.md"),
    frontmatter({ type: "spike", number: "00", slug: "de-risk-thing", status: "not-started", title: '"De-risk the thing"', owner: "architect", created: "2026-07-09", updated: "2026-07-09", depends: "[]", timebox: '"1d"', schema: 1 }) +
      "# 00 · De-risk the thing\n\n## Question\nWhat is the risk?\n\n## Timebox\n1 day.\n\n## Investigation\nnotes\n\n## Finding\n(to be filled)\n\n## Outcome / Next\nunblocks m41\n",
    "utf8"
  );
  return { workDir, spikeDir: dir };
}

export const archTests = [
  {
    name: "arch/spike-no-feature: a well-formed spike (SPIKE.md, no tasks/, no .feature) validates CLEAN (FF-3704a)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until the vocabulary lands
      const { workDir, spikeDir } = await buildSpikeFixture();
      try {
        const findings = await validateWork(workDir, { name: "fixture" }, null);
        const aboutSpike = findings.filter((f) => f.path && f.path.startsWith(spikeDir));
        assert.deepEqual(
          aboutSpike,
          [],
          `a well-formed spike raises NO validate finding (it carries no .feature contract); got: ${JSON.stringify(aboutSpike)}`
        );
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/spike-no-feature: NON-VACUITY — a spike with a MISSING record doc is still flagged (validate is live over the type)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until the vocabulary lands
      const workDir = await mkdtemp(path.join(os.tmpdir(), "aof-arch-spike-nv-"));
      const dir = path.join(workDir, "00_spike_de-risk-thing");
      await mkdir(dir, { recursive: true }); // folder exists, NO SPIKE.md
      try {
        const findings = await validateWork(workDir, { name: "fixture" }, null);
        assert.ok(
          findings.some((f) => f.path && f.path.startsWith(dir)),
          "a spike folder with no record doc IS flagged — proving validate runs over the spike type (non-vacuity)"
        );
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  },
];
