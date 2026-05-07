import assert from "node:assert/strict";
import { executeFrameworkInstallPlan, frameworkPlanFromLock, gsdPackageFromConfig, planFrameworkInstall } from "../src/frameworks.mjs";

export const frameworkTests = [
  {
    name: "plans gsd commands from package source",
    run: plansGsdCommands
  },
  {
    name: "skips successful matching prior install unless forced",
    run: skipsSuccessfulPriorInstall
  },
  {
    name: "records simulated framework install attempts",
    run: recordsSimulatedAttempts
  },
  {
    name: "plans replay from framework lock intent",
    run: plansReplayFromLock
  },
  {
    name: "plans dry-run and filters unsupported selected runtimes",
    run: plansDryRunAndFiltering
  },
  {
    name: "force reruns successful prior framework attempts",
    run: forceRerunsPriorAttempts
  }
];

function plansGsdCommands() {
  const plan = planFrameworkInstall("gsd", {
    source: "npm:get-shit-done-cc@1.2.3",
    runtimes: ["claude", "codex"],
    global: true
  });
  assert.equal(plan[0].command, "npx get-shit-done-cc@1.2.3 --claude --global");
  assert.equal(plan[1].command, "npx get-shit-done-cc@1.2.3 --codex --global");
  assert.equal(gsdPackageFromConfig({ packages: [{ id: "gsd", source: "npm:get-shit-done-cc@latest" }] }).id, "gsd");
}

function skipsSuccessfulPriorInstall() {
  const previousLock = {
    frameworkInstallAttempts: [
      {
        framework: "gsd",
        runtime: "codex",
        scope: "local",
        status: "success",
        packageSource: "npm:get-shit-done-cc@latest"
      }
    ]
  };
  const skipped = planFrameworkInstall("gsd", { runtimes: ["codex"], previousLock });
  assert.equal(skipped[0].skipped, true);

  const forced = planFrameworkInstall("gsd", { runtimes: ["codex"], previousLock, force: true });
  assert.equal(forced[0].skipped, false);
}

function recordsSimulatedAttempts() {
  const previous = process.env.AOF_TEST_FRAMEWORK_INSTALL_STATUS;
  process.env.AOF_TEST_FRAMEWORK_INSTALL_STATUS = "claude=0,codex=1";
  try {
    const plan = planFrameworkInstall("gsd", { runtimes: ["claude", "codex"] });
    const attempts = executeFrameworkInstallPlan(plan, { generatedAt: "2026-05-07T00:00:00.000Z" });
    assert.equal(attempts[0].status, "success");
    assert.equal(attempts[1].status, "failed");
    assert.equal(attempts[1].exitStatus, 1);
  } finally {
    restoreEnv("AOF_TEST_FRAMEWORK_INSTALL_STATUS", previous);
  }
}

function plansReplayFromLock() {
  const plan = frameworkPlanFromLock({
    frameworks: [
      { id: "gsd", source: "npm:get-shit-done-cc@latest", runtimes: ["codex"], scope: "local" }
    ]
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].command, "npx get-shit-done-cc@latest --codex --local");
}

function plansDryRunAndFiltering() {
  const plan = planFrameworkInstall("gsd", {
    runtimes: ["codex"],
    global: false
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].runtime, "codex");
  assert.equal(plan[0].scope, "local");
  assert.equal(plan[0].command, "npx get-shit-done-cc@latest --codex --local");
}

function forceRerunsPriorAttempts() {
  const previousLock = {
    frameworkInstallAttempts: [
      {
        framework: "gsd",
        runtime: "claude",
        scope: "global",
        status: "success",
        packageSource: "npm:get-shit-done-cc@latest"
      }
    ]
  };
  const plan = planFrameworkInstall("gsd", {
    runtimes: ["claude"],
    global: true,
    force: true,
    previousLock
  });
  assert.equal(plan[0].skipped, false);
  assert.equal(plan[0].packageSource, "npm:get-shit-done-cc@latest");
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
