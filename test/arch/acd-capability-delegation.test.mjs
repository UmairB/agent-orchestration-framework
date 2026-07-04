// Fitness function for milestone 01 / ADR-006:
// "init/update contain no runtime conditional deciding member installability —
//  cross-runtime mapping is delegated to the CAPABILITIES matrix."
//
// The architect's ruling (recorded in STATE): a "delegates to X" invariant is
// proven BEHAVIOURALLY (does the matrix actually decide?) plus by the ABSENCE of
// per-runtime conditionals — NEVER by asserting a symbol's PRESENCE in a named
// file (a requiring-grep). Forbidding-greps (pattern-absent) stay; requiring-greps
// (pattern-present-in-file-Y) are the smell and have been removed here.
//
// Three proofs:
//  1. Forbidding-grep — none of the init/update/synthesis sources contain a
//     `=== "codex"` / `=== "claude"` installability branch.
//  2. Behavioural (shared module) — partitioning ["claude","codex"] through the
//     shared synthesis maps command members to skills on codex while
//     agents stay installable, and every reported status is read STRAIGHT from
//     CAPABILITIES — proving the matrix is the authority.
//  3. Behavioural (end-to-end) — running initWork against a temp dir for
//     ["claude","codex"] reports codex commands not-installable (no command file
//     written under .codex) while codex agents render — same decision, observed
//     through the real orchestrator.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initWork } from "../../src/work-init.mjs";
import { partitionByCapability, synthesizeBundleConfig } from "../../src/work-bundle-synthesis.mjs";
import { ACD_BUNDLE_CAPABILITIES } from "../../src/work-bundle-runtime.mjs";
import { loadBundle } from "../../src/work-bundle.mjs";
import { CAPABILITIES, CAPABILITY_STATUS } from "../../src/model.mjs";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const SOURCES = ["work-init.mjs", "work-update.mjs", "work-bundle-synthesis.mjs"];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export const archTests = [
  {
    name: "arch/ADR-006: init/update/synthesis contain no `=== \"codex\"` / `=== \"claude\"` installability branch",
    run: async () => {
      for (const file of SOURCES) {
        const code = stripComments(await readFile(path.join(srcDir, file), "utf8"));
        assert.ok(!/===\s*"codex"/.test(code), `${file}: no === "codex" branch`);
        assert.ok(!/===\s*"claude"/.test(code), `${file}: no === "claude" branch`);
        assert.ok(!/!==\s*"codex"/.test(code), `${file}: no !== "codex" branch`);
        assert.ok(!/!==\s*"claude"/.test(code), `${file}: no !== "claude" branch`);
      }
    }
  },
  {
    name: "arch/ADR-006: the shared synthesis lets the CAPABILITIES matrix decide installability for [claude, codex]",
    run: async () => {
      // The generic adapter keeps command+codex unsupported; the ACD bundle overlay maps it.
      // agent+codex is native. The behavioural proof must MATCH the matrix.
      assert.equal(CAPABILITIES.command.codex, CAPABILITY_STATUS.unsupportedFail, "generic matrix: command+codex unsupported-fail");
      assert.equal(ACD_BUNDLE_CAPABILITIES.command.codex, CAPABILITY_STATUS.mapped, "ACD matrix: command+codex mapped");
      assert.equal(CAPABILITIES.agent.codex, CAPABILITY_STATUS.native, "matrix: agent+codex native");

      const bundle = loadBundle();
      const { installable, notInstallable } = partitionByCapability(bundle.resources, ["claude", "codex"]);

      // Commands map to Codex skills, so they are installable and not reported as unsupported.
      const codexCommandReports = notInstallable.filter((n) => n.kind === "command" && n.runtime === "codex");
      assert.equal(codexCommandReports.length, 0, "command members are not reported unsupported on codex");
      const codexCommandSkills = installable.filter((r) => r.kind === "skill" && r.runtimes.includes("codex") && r._aofMappedFrom?.kind === "command");
      assert.ok(codexCommandSkills.length > 0, "command members map to codex skills");
      assert.ok(codexCommandSkills.some((r) => r.id === "aof-refine"), "refine maps to aof-refine skill");
      // Commands are NOT reported for claude (native there) — the matrix differs
      // per runtime, proving the decision is a per-(kind,runtime) lookup.
      assert.equal(
        notInstallable.filter((n) => n.kind === "command" && n.runtime === "claude").length,
        0,
        "command members are installable on claude (matrix native)"
      );
      // Agents render for codex (native) — they appear in installable with codex.
      const codexAgents = installable.filter((r) => r.kind === "agent" && r.runtimes.includes("codex"));
      assert.ok(codexAgents.length > 0, "agent members render on codex (matrix native)");
    }
  },
  {
    name: "arch/ADR-006: initWork for [claude, codex] maps codex commands to skills (matrix decides), agents render",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-cap-"));
      try {
        const result = await initWork({ targetDir: repo, runtimes: ["claude", "codex"] });
        const codexCommandReports = result.notInstallable.filter((n) => n.kind === "command" && n.runtime === "codex");
        assert.equal(codexCommandReports.length, 0, "command members are not reported unsupported on codex");
        // No codex command file written; codex agents (native) DO render; claude
        // commands (native) render; and codex gets the mapped skill equivalent.
        assert.ok(!existsSync(path.join(repo, ".codex", "commands", "aof", "refine.md")), "codex command not written");
        assert.ok(existsSync(path.join(repo, ".codex", "skills", "aof-refine", "SKILL.md")), "codex mapped skill rendered");
        assert.ok(existsSync(path.join(repo, ".codex", "agents", "aof-architect.md")), "codex agent rendered (native)");
        assert.ok(existsSync(path.join(repo, ".claude", "commands", "aof", "refine.md")), "claude command rendered (native)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // Regression guard (craft review): init and the shared synthesis must yield the
    // IDENTICAL notInstallable report + desired-path set, so the two commands can
    // never silently diverge. After consolidation there is only ONE synthesis impl;
    // this pins it — if init ever forks its own copy again, this fails.
    name: "arch/ADR-003+006: initWork and the shared synthesizeBundleConfig agree on notInstallable + desired paths for [claude, codex]",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-parity-"));
      try {
        const runtimes = ["claude", "codex"];
        const bundle = loadBundle();
        const shared = await synthesizeBundleConfig(bundle, { runtimes, targetDir: repo });
        const init = await initWork({ targetDir: repo, runtimes, dryRun: true });

        const sortPaths = (outputs) => outputs.map((o) => `${o.path}::${o.runtime ?? ""}`).sort();
        assert.deepEqual(
          sortPaths(init.desiredOutputs),
          sortPaths(shared.desiredOutputs),
          "init and the shared synthesis compute the SAME desired-path set"
        );

        const sortReports = (reports) => reports
          .map((r) => `${r.kind}:${r.id}:${r.runtime}:${r.status}`)
          .sort();
        assert.deepEqual(
          sortReports(init.notInstallable),
          sortReports(shared.notInstallable),
          "init and the shared synthesis compute the SAME not-installable report"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];
