// Fitness function for milestone 12 / ADR-005 inv. 4 (npx lane preserved — the
// regression guard; ADR-002):
// "frameworks.mjs's framework-install behaviour + lock/attempt/--force/
//  SAFE_NPM_EXEC_ENV semantics are unchanged — the registry's npx provider
//  DELEGATES to the untouched planner; the npx argv shape stays
//  [`npx`, pkg, runtimeFlag, scopeFlag]."
//
// This is GREEN NOW (frameworks.mjs is intact) and must STAY green — the registry
// re-homes the npx lane, it does NOT rewrite it. The existing test/frameworks.test.mjs
// is the byte-for-byte net (noted below); this adds a focused structural +
// behavioural guard so a frameworks.mjs edit that drops an export or changes the
// argv shape fails HERE too.
//
// Two proofs:
//   (a) SOURCE-GREP src/frameworks.mjs (comments discounted): planFrameworkInstall,
//       executeFrameworkInstallPlan, frameworkPlanFromLock, SAFE_NPM_EXEC_ENV are
//       still present/exported, and the npx argv shape `argv = ["npx", ...]` is
//       intact (the `["npx",` literal present, with runtimeFlag + scopeFlag).
//   (b) BEHAVIOURAL: planFrameworkInstall plans an item whose argv[0] === "npx"
//       (full argv [`npx`, pkg, runtimeFlag, scopeFlag]) and whose
//       installEnvironment IS the SAFE_NPM_EXEC_ENV shape — proving the delegation
//       target is unchanged.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  planFrameworkInstall,
  executeFrameworkInstallPlan,
  frameworkPlanFromLock,
} from "../../src/frameworks.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FRAMEWORKS = path.join(repoRoot, "src", "frameworks.mjs");

// Strip ONLY comments (keep string literals) — the `export`/argv-literal/SAFE env
// key tokens we assert are live code or string literals we WANT to see.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// The npm supply-chain-safety env keys SAFE_NPM_EXEC_ENV is contracted to carry
// (the hardening the npx lane's exec env applies). Their presence proves the env
// shape was not silently emptied.
const SAFE_ENV_KEYS = [
  "npm_config_ignore_scripts",
  "npm_config_audit_level",
  "npm_config_engine_strict",
  "npm_config_yes",
];

export const archTests = [
  {
    name: "arch/ADR-005 inv.4: src/frameworks.mjs still exports planFrameworkInstall / executeFrameworkInstallPlan / frameworkPlanFromLock / SAFE_NPM_EXEC_ENV",
    run: async () => {
      const text = stripComments(await readFile(FRAMEWORKS, "utf8"));
      for (const name of ["planFrameworkInstall", "executeFrameworkInstallPlan", "frameworkPlanFromLock"]) {
        assert.ok(
          new RegExp(`export\\s+function\\s+${name}\\b`).test(text),
          `frameworks.mjs still exports function ${name}`
        );
      }
      // SAFE_NPM_EXEC_ENV is a const (the npx lane's hardening env) — still defined
      // and carrying its safety keys (not silently emptied).
      assert.ok(/SAFE_NPM_EXEC_ENV\s*=/.test(text), "frameworks.mjs still defines SAFE_NPM_EXEC_ENV");
      for (const key of SAFE_ENV_KEYS) {
        assert.ok(new RegExp(`\\b${key}\\b`).test(text), `SAFE_NPM_EXEC_ENV still carries ${key}`);
      }
    },
  },
  {
    name: "arch/ADR-005 inv.4: the npx argv shape `[\"npx\", pkg, runtimeFlag, scopeFlag]` is intact in frameworks.mjs",
    run: async () => {
      const text = stripComments(await readFile(FRAMEWORKS, "utf8"));
      // The exact build form the npx lane uses: argv = ["npx", packageName,
      // runtimeFlag, scopeFlag] — the `["npx",` literal followed by the four-element
      // shape (the package + the two flags).
      assert.ok(
        /argv\s*=\s*\[\s*["']npx["']\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\]/.test(text),
        "planFrameworkInstall builds argv = [\"npx\", packageName, runtimeFlag, scopeFlag] (four-element npx shape)"
      );
    },
  },
  {
    name: "arch/ADR-005 inv.4: planFrameworkInstall plans an item with argv[0] \"npx\" and the SAFE_NPM_EXEC_ENV install env (delegation target unchanged)",
    run: () => {
      // Plan the gsd framework (the known framework) for both runtimes — the
      // delegated planner the registry's npx lane calls.
      const plan = planFrameworkInstall("gsd", {
        source: "npm:get-shit-done-cc@1.2.3",
        runtimes: ["claude", "codex"],
        global: true,
      });
      assert.ok(Array.isArray(plan) && plan.length === 2, "the plan carries one item per runtime");

      const first = plan[0];
      assert.ok(Array.isArray(first.argv) && first.argv.length === 4, "the item argv is the four-element npx shape");
      assert.equal(first.argv[0], "npx", "argv[0] is the `npx` literal");
      assert.equal(first.argv[1], "get-shit-done-cc@1.2.3", "argv[1] is the package spec");
      assert.equal(first.argv[2], "--claude", "argv[2] is the runtime flag");
      assert.equal(first.argv[3], "--global", "argv[3] is the scope flag");
      assert.equal(first.command, "npx get-shit-done-cc@1.2.3 --claude --global", "the rendered command matches the npx argv");

      // The install env IS the SAFE_NPM_EXEC_ENV hardening shape (the npx lane owns
      // its own exec env — ADR-002). Assert the safety keys are present on it.
      assert.ok(first.installEnvironment && typeof first.installEnvironment === "object", "the item carries an installEnvironment");
      for (const key of SAFE_ENV_KEYS) {
        assert.ok(key in first.installEnvironment, `the install env carries the safety key ${key}`);
      }
      assert.equal(first.installEnvironment.npm_config_ignore_scripts, "true", "ignore-scripts hardening is on");
    },
  },
  {
    name: "arch/ADR-005 inv.4: frameworkPlanFromLock replays an npx plan from a lock (lock/attempt machinery intact)",
    run: () => {
      // The lock-replay path (frameworkPlanFromLock) — its existence + npx-shape
      // output proves the lock/attempt machinery the milestone-01/GSD tests depend
      // on is the same delegation target the registry re-homes.
      const plan = frameworkPlanFromLock({
        packages: [{ id: "gsd", source: "npm:get-shit-done-cc@1.2.3", runtimes: ["claude"], scope: "global" }],
      });
      assert.ok(Array.isArray(plan) && plan.length >= 1, "the lock replays into a plan");
      assert.equal(plan[0].argv[0], "npx", "the replayed item argv[0] is `npx`");

      // executeFrameworkInstallPlan is the spawner the lane delegates to — assert
      // it is a function (its byte-for-byte behaviour is covered by the existing
      // test/frameworks.test.mjs net; here we confirm the symbol is intact).
      assert.equal(typeof executeFrameworkInstallPlan, "function", "executeFrameworkInstallPlan is exported and callable");
    },
  },
];
