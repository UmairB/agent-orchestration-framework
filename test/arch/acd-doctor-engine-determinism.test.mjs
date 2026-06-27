// Fitness function for milestone 15 / ADR-003 (engine determinism). "Same fixture
// + same injected `now` ⇒ byte-identical findings (JSON.stringify equal across two
// runs); AND the engine source reads NO wall-clock — no Date.now( / new Date( in
// the engine module (comments discounted per the house strip-comments discipline).
// Time enters ONLY via the injected now/staleWindow."
//
// Proof: call doctorWork(workDir, config, undefined, { now: FIXED, staleWindow:
// FIXED }) TWICE over the same fixture → assert byte-equal serialisation; then
// source-grep the engine module (comments stripped) → assert no Date.now( /
// new Date( call form. The engine's only FS time read is the snapshot's stat pass
// (data handed to the groups, not a clock the checks call).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../src/work.mjs";
import { doctorWork } from "../../src/work-doctor.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(repoRoot, "src");

// Every doctor module — the spine + the appended GROUP modules (coherence,
// freshness) and any future m16 group. ADR-003's no-wall-clock invariant covers ALL
// of them, not just the spine, so the source grep spans the whole `work-doctor*.mjs`
// family (glob the src dir), never a hard-coded list.
async function doctorModules() {
  const names = await readdir(SRC_DIR);
  return names
    .filter((name) => /^work-doctor.*\.mjs$/.test(name))
    .map((name) => path.join(SRC_DIR, name));
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// A fixture with both a warn (orphan) and an error (duplicate driver 07) so the
// determinism check spans multiple findings + both severities.
async function buildFixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-doctor-determinism-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  for (const slug of ["alpha", "beta"]) {
    const dir = path.join(workDir, `07_milestone_${slug}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SPEC.md"),
      frontmatter({ type: "milestone", number: "07", slug, status: "in-progress", title: `"${slug}"`, created: "2026-06-19", updated: "2026-06-19" }),
      "utf8"
    );
  }
  await mkdir(path.join(workDir, "08_milestone_gamma"), { recursive: true });
  await writeFile(
    path.join(workDir, "08_milestone_gamma", "SPEC.md"),
    frontmatter({ type: "milestone", number: "08", slug: "gamma", status: "in-progress", title: '"gamma"', created: "2026-06-19", updated: "2026-06-19" }),
    "utf8"
  );
  await mkdir(path.join(workDir, "08_milestone_gamma", "stories", "orphan-typo"), { recursive: true });
  return { repo, workDir };
}

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const FIXED_NOW = Date.parse("2026-06-25T00:00:00Z");
const FIXED_WINDOW = 7 * 24 * 60 * 60 * 1000;

export const archTests = [
  {
    name: "arch/15 ADR-003: doctorWork is byte-identical across two runs with the same fixture + injected now",
    run: async () => {
      const { repo, workDir } = await buildFixture();
      try {
        const { config } = await loadWorkspace(repo);
        const first = await doctorWork(workDir, config, undefined, { now: FIXED_NOW, staleWindow: FIXED_WINDOW });
        const second = await doctorWork(workDir, config, undefined, { now: FIXED_NOW, staleWindow: FIXED_WINDOW });
        assert.ok(first.length >= 2, `the fixture yields ≥2 findings (got ${first.length})`);
        assert.deepEqual(first, second, "two runs are deep-equal");
        assert.equal(JSON.stringify(first), JSON.stringify(second), "two runs serialise byte-identically");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/15 ADR-003: NO doctor module reads the wall-clock (no Date.now( / argless new Date() across the work-doctor* family)",
    run: async () => {
      const modules = await doctorModules();
      assert.ok(
        modules.some((m) => /work-doctor-freshness\.mjs$/.test(m)) &&
          modules.some((m) => /work-doctor-coherence\.mjs$/.test(m)) &&
          modules.some((m) => /[\\/]work-doctor\.mjs$/.test(m)),
        "the grep spans the spine + the freshness/coherence group modules",
      );
      for (const module of modules) {
        const source = stripComments(await readFile(module, "utf8"));
        // Ban only the WALL-CLOCK forms: `Date.now(` and an ARGLESS `new Date()`
        // (no argument → reads the host clock). PURE conversions that TAKE arguments
        // — `new Date(Date.UTC(...))`, `new Date(ms)` — are deterministic and allowed
        // (freshness legitimately uses `new Date(Date.UTC(...))` + `Date.parse(...)`).
        assert.ok(!/Date\.now\s*\(/.test(source), `${path.basename(module)} contains no Date.now( call`);
        assert.ok(
          !/new\s+Date\s*\(\s*\)/.test(source),
          `${path.basename(module)} contains no argless new Date() (host-clock) call`,
        );
      }
    },
  },
];
