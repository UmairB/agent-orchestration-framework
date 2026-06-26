// Fitness function for milestone 15 / ADR-001 (the doctor finding-envelope
// contract). "Every work:doctor finding is exactly { code, severity, path,
// message }: code a non-empty string, severity ∈ {warn, error} (no other value —
// NO ok/info), path present, message present. run emits RAW ABSOLUTE paths
// (basis-neutral — each finding.path is path.isAbsolute, NOT cwd-/projectRoot-
// relativised, NOT forward-slashed by run — the 08/ADR-002 keystone)."
//
// Proof: import getCommand("work:doctor"); invoke it over a fixture stream wired
// to trigger ≥1 finding of EACH severity (a warn via orphan-folder, an error via
// duplicate-driver-number — the two seeded groups), then assert every finding has
// EXACTLY the four keys, severity is one of the two literals, and path is
// path.isAbsolute(p) and equals its on-disk OS form (no projection).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../../src/work.mjs";
import { getCommand } from "../../src/command-core.mjs";

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// A fixture that triggers both severities: a warn (an orphan folder under a
// milestone's stories/) AND an error (two top-level drivers sharing number 07).
async function buildFixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-doctor-envelope-"));
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
  // an orphan story folder → a warn finding
  await mkdir(path.join(workDir, "07_milestone_alpha", "stories", "not-a-valid-folder"), { recursive: true });
  return { repo, workDir };
}

const SEVERITIES = new Set(["warn", "error"]);

export const archTests = [
  {
    name: "arch/15 ADR-001: every work:doctor finding is exactly { code, severity, path, message } with severity ∈ {warn, error}",
    run: async () => {
      const { repo } = await buildFixture();
      try {
        const command = getCommand("work:doctor");
        assert.ok(command, "work:doctor is registered");
        const ctx = { workspace: await loadWorkspace(repo) };
        const result = await command.run({}, ctx);

        assert.ok(Array.isArray(result.findings), "run returns a findings array");
        assert.ok(result.findings.length >= 2, `the fixture triggers ≥2 findings (got ${result.findings.length})`);
        assert.ok(result.findings.some((f) => f.severity === "warn"), "at least one warn finding");
        assert.ok(result.findings.some((f) => f.severity === "error"), "at least one error finding");

        for (const finding of result.findings) {
          // EXACTLY the four keys, no more, no fewer.
          assert.deepEqual(
            Object.keys(finding).sort(),
            ["code", "message", "path", "severity"],
            `finding has exactly the four keys (got ${Object.keys(finding).join(",")})`
          );
          assert.ok(typeof finding.code === "string" && finding.code.length > 0, "code is a non-empty string");
          assert.ok(SEVERITIES.has(finding.severity), `severity ∈ {warn, error} (got "${finding.severity}")`);
          assert.ok(typeof finding.message === "string" && finding.message.length > 0, "message is present");
          assert.ok(typeof finding.path === "string" && finding.path.length > 0, "path is present");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/15 ADR-001: run emits RAW ABSOLUTE paths (basis-neutral — no projection by run)",
    run: async () => {
      const { repo } = await buildFixture();
      try {
        const ctx = { workspace: await loadWorkspace(repo) };
        const result = await getCommand("work:doctor").run({}, ctx);
        for (const finding of result.findings) {
          assert.ok(path.isAbsolute(finding.path), `finding.path is absolute (got ${finding.path})`);
          // NOT projectRoot-relativised — it contains the project root prefix.
          assert.ok(finding.path.startsWith(ctx.workspace.projectRoot), "path is NOT projectRoot-relative (it contains the root)");
          // NOT forward-slashed by run on Windows — it is the OS-native form.
          if (path.sep === "\\") {
            assert.ok(finding.path.includes("\\"), "on Windows the raw path contains backslashes (run did NOT forward-slash)");
          }
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
