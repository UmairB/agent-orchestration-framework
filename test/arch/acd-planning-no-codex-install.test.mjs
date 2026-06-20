// Fitness function for milestone 02 / ADR-004:
// "The planning-init source contains no `codex plugin install` / `codex plugin add`
//  literal (the absent Codex verb is never emitted); Codex provenance records
//  pluginsInstalled: false rather than claiming success."
//
// Proofs:
//  1. Source — grep the planning-init source: no `codex plugin install` and no
//     `codex plugin add` string anywhere (comments included — the verb must not
//     appear even as a constructed literal).
//  2. Behavioural — build the codex plan → assert only `codex plugin marketplace
//     add` is present (zero per-plugin install items), and the produced manifest's
//     codex.pluginsInstalled === false.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initPlanning, planPlanningInstall, planningLockPath, MARKETPLACE_REF } from "../../src/planning-init.mjs";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const planningSourcePath = path.join(srcDir, "planning-init.mjs");
const FIXTURE_SHA = "d384f0c9eb81fe74656a4f6da168587836939edb";

export const archTests = [
  {
    name: "arch/ADR-004: the planning-init source contains no `codex plugin install` / `codex plugin add` literal",
    run: async () => {
      const code = await readFile(planningSourcePath, "utf8");
      assert.ok(!/codex plugin install/.test(code), "no `codex plugin install` literal");
      assert.ok(!/codex plugin add/.test(code), "no `codex plugin add` literal");
    }
  },
  {
    name: "arch/ADR-004: the codex plan registers only the marketplace (no per-plugin install step)",
    run: async () => {
      const plan = planPlanningInstall({ runtime: "codex", sha: FIXTURE_SHA, withOptional: true });
      assert.ok(plan.some((item) => item.kind === "marketplace"), "codex plan registers the marketplace");
      assert.equal(
        plan.find((item) => item.kind === "marketplace").command,
        `codex plugin marketplace add https://github.com/phuryn/pm-skills.git#${MARKETPLACE_REF}`,
        "the only codex command is `codex plugin marketplace add <HTTPS git URL>#v2.0.0` — the shared marketplace-add argv pins the clonable tag for BOTH runtimes (ADR-008)"
      );
      assert.ok(!plan.some((item) => item.kind === "install"), "no per-plugin install step on codex");
      for (const item of plan) {
        assert.ok(!/\bplugin install\b/.test(item.command), "no `plugin install` in any codex command");
        assert.ok(!/codex plugin add\b/.test(item.command), "no `codex plugin add` in any codex command");
      }
    }
  },
  {
    name: "arch/ADR-004: the produced codex manifest records codex.pluginsInstalled === false",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-planning-codex-"));
      try {
        const result = await initPlanning({
          targetDir: repo,
          runtime: "codex",
          sha: FIXTURE_SHA,
          simulateInstall: true,
          log: () => {}
        });
        assert.equal(result.manifestWritten, true);
        // ADR-009: provenance is the `planning` SECTION of the unified lock.
        const manifest = JSON.parse(await readFile(planningLockPath(repo), "utf8")).planning;
        assert.equal(manifest.codex.marketplaceRegistered, true, "marketplace registered");
        assert.equal(manifest.codex.pluginsInstalled, false, "pluginsInstalled is false (never claims success)");
        assert.deepEqual(manifest.plugins, [], "no installed plugin recorded");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];
