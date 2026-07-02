// Traceability wiring for milestone 02 / story 00 `planning-init`.
//
// Every @executable scenario AND every Scenario-Outline Examples row across the
// story's four task features is covered here, exercised against the REAL
// implementation (`initPlanning` in ../src/planning-init.mjs). The sha is injected
// (offline, RESEARCH A3) and the runtime install is simulated, so no test touches
// the network or spawns a real process.
//
//   00_dry-run-install-plan.feature  — --dry-run previews the plan + writes
//        nothing; default plan registers pm-skills then installs the 3 core;
//        pm-ai-shipping never appears; --with-optional adds pm-market-research;
//        the recommended-set + per-plugin presence matrices
//   01_pin-marketplace-sha.feature   — a 40-hex sha is recorded as the pin; a
//        floating ref is refused before any write; the accept/reject + manifest
//        matrices (the exact Examples rows, incl. D384.../d384f0c/42-char)
//   02_execute-and-write-provenance.feature — network-boundary warning precedes
//        each step; the frozen manifest schema; the recorded plugins list matrix;
//        each plugin entry names its plugin + marketplace
//   03_codex-degrade-and-guard.feature — codex registers but installs nothing
//        (honest degrade: marketplaceRegistered true / pluginsInstalled false /
//        plugins empty / manual fallback emitted / no install claim); the re-run
//        guard + --force + dry-run-regardless decision table
//   04_https-marketplace-source.feature — (ADR-007, Finding F1) the marketplace-add
//        source is an HTTPS git URL pinned by a `#<sha>` ref, never the SSH-able
//        `phuryn/pm-skills@<sha>` shorthand; the per-plugin install still targets
//        the marketplace by its manifest name `<plugin>@pm-skills`
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initPlanning,
  planPlanningInstall,
  planningLockPath,
  parseTagSha,
  CORE_PLUGINS,
  MARKETPLACE_GIT_URL,
  MARKETPLACE_REF
} from "../src/planning-init.mjs";
import { createRenderPlan, createLockManifest, planApplyActions, executeApplyActions } from "../src/render-plan.mjs";
import { readLock, writeLock } from "../src/lock.mjs";

const FIXTURE_SHA = "d384f0c9eb81fe74656a4f6da168587836939edb";
// v2.0.0 → this commit (architect-established fact; the lightweight tag → commit).
const TAG_COMMIT_SHA = "5042ff6169e0df49086c846f69bf7b6cdb67a6de";
const SHA_RE = /^[0-9a-f]{40}$/;
const SHA_REF_RE = /#[0-9a-f]{40}$/; // a bare 40-hex sha pinned as the ref — F2

async function tempRepo(prefix = "aof-planning-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

// Drive initPlanning offline: inject the sha, simulate the install, capture every
// printed line into `lines` (so we never write to the real console and can assert
// on output). Returns { result, lines, output }.
async function runInit(repo, options = {}) {
  const lines = [];
  const result = await initPlanning({
    targetDir: repo,
    sha: options.sha ?? FIXTURE_SHA,
    simulateInstall: true,
    log: (line) => lines.push(String(line)),
    ...options
  });
  return { result, lines, output: lines.join("\n") };
}

function flagToOptions(flag) {
  return flag === "--with-optional" ? { withOptional: true } : {};
}

// ADR-009: provenance is the `planning` SECTION of the unified lock. "exists" means
// the unified lock exists AND carries a `planning` section; "readManifest" returns
// that section (so every `manifest.*` assertion reads `lock.planning.*`).
async function manifestExists(repo) {
  if (!existsSync(planningLockPath(repo))) return false;
  const lock = JSON.parse(await readFile(planningLockPath(repo), "utf8"));
  return Boolean(lock && lock.planning);
}

async function readManifest(repo) {
  const lock = JSON.parse(await readFile(planningLockPath(repo), "utf8"));
  return lock.planning;
}

// Read/overwrite the whole unified lock (for seeding foreign sections + asserting
// section isolation).
async function readUnifiedLock(repo) {
  return JSON.parse(await readFile(planningLockPath(repo), "utf8"));
}

async function writeUnifiedLock(repo, lock) {
  await mkdir(path.dirname(planningLockPath(repo)), { recursive: true });
  await writeFile(planningLockPath(repo), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

// Drive the asset-apply lock-write path exactly as `aof assets apply` does: build
// the render plan, plan actions against the current lock, run createLockManifest,
// then writeLock to the unified lockPath. Used to prove asset-apply preserves the
// `planning` section (task 00 @executable).
async function runAssetApply(repo) {
  const config = { resources: [], workflows: [], packages: [] };
  const runtimes = ["claude"];
  const lockPath = planningLockPath(repo);
  const desiredOutputs = await createRenderPlan(config, { targetDir: repo, runtimes });
  const previousLock = await readLock(lockPath);
  const actions = await planApplyActions(desiredOutputs, previousLock, { targetDir: repo, force: false });
  await executeApplyActions(actions);
  const manifest = createLockManifest({ actions, desiredOutputs, previousLock, config, runtimes });
  await writeLock(lockPath, manifest);
}

const ASSET_SEED = {
  version: 2,
  generatedAt: "2026-06-19T00:00:00.000Z",
  runtimes: ["claude"],
  files: [
    {
      path: ".claude/agents/own-resource.md",
      runtime: "claude",
      resource: { id: "own-resource", kind: "agent" },
      hash: "sha256:" + "a".repeat(64),
      generatedAt: "2026-06-19T00:00:00.000Z"
    }
  ],
  packages: [],
  frameworks: [],
  frameworkInstallAttempts: []
};

const WORK_SEED = {
  generatedAt: "2026-06-19T00:00:00.000Z",
  bundle: { version: "1.0.0" },
  runtimes: ["claude"],
  files: [],
  packages: [],
  frameworks: [],
  frameworkInstallAttempts: []
};

export const planningInitTests = [
  // ====================================================================
  // 00_dry-run-install-plan.feature
  // ====================================================================
  {
    name: "planning-init/dry-run: previews the plan without acting on it (exit 0, reports commands, no manifest)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result, output } = await runInit(repo, { dryRun: true });
        assert.equal(result.guarded, false);
        assert.equal(result.shaRejected, false);
        assert.equal(result.manifestWritten, false);
        assert.ok(result.planCommands.length > 0, "the output reports the runtime commands it would run");
        assert.ok(/marketplace add/.test(output) && /plugin install/.test(output), "preview prints the commands");
        assert.equal(await manifestExists(repo), false, "no planning section written to .aof/aof.lock.json");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "planning-init/dry-run: default plan registers pm-skills before any plugin install, then installs the three core",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { dryRun: true });
        const items = result.plan;
        const marketplaceIndex = items.findIndex((item) => item.kind === "marketplace");
        const firstInstallIndex = items.findIndex((item) => item.kind === "install");
        assert.ok(marketplaceIndex >= 0, "the plan registers the pm-skills marketplace");
        assert.ok(marketplaceIndex < firstInstallIndex, "marketplace registration precedes any install");
        assert.match(items[marketplaceIndex].command, /marketplace add --scope project https:\/\/github\.com\/phuryn\/pm-skills\.git#/);
        for (const plugin of ["pm-execution", "pm-product-discovery", "pm-product-strategy"]) {
          assert.ok(
            items.some((item) => item.kind === "install" && item.plugin === plugin && /@pm-skills$/.test(item.command)),
            `plan installs ${plugin} from the pm-skills marketplace`
          );
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "planning-init/dry-run: the avoided plugin pm-ai-shipping never appears in the plan",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { dryRun: true });
        assert.ok(!result.plan.some((item) => item.plugin === "pm-ai-shipping"), "pm-ai-shipping is never in the plan");
        const withOpt = await runInit(repo, { dryRun: true, withOptional: true });
        assert.ok(!withOpt.result.plan.some((item) => item.plugin === "pm-ai-shipping"), "pm-ai-shipping absent even with --with-optional");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "planning-init/dry-run: --with-optional adds pm-market-research; without it the optional plugin is absent",
    run: async () => {
      const repo = await tempRepo();
      try {
        const withOpt = await runInit(repo, { dryRun: true, withOptional: true });
        assert.ok(
          withOpt.result.plan.some((item) => item.kind === "install" && item.plugin === "pm-market-research"),
          "--with-optional installs pm-market-research from pm-skills"
        );
        const without = await runInit(repo, { dryRun: true });
        assert.ok(
          !without.result.plan.some((item) => item.plugin === "pm-market-research"),
          "without --with-optional pm-market-research is absent"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: the previewed plan installs the recommended set for the flag
  ...[
    { flag: "", plugins: ["pm-execution", "pm-product-discovery", "pm-product-strategy"] },
    { flag: "--with-optional", plugins: ["pm-execution", "pm-product-discovery", "pm-product-strategy", "pm-market-research"] }
  ].map((row) => ({
    name: `planning-init/dry-run matrix: plan installs exactly [${row.plugins.join(", ")}] for flag "${row.flag}"`,
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { dryRun: true, ...flagToOptions(row.flag) });
        const installed = result.plan.filter((item) => item.kind === "install").map((item) => item.plugin);
        assert.deepEqual(installed, row.plugins, "plan installs exactly the recommended set");
        assert.ok(!installed.includes("pm-ai-shipping"), "pm-ai-shipping absent");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  })),
  // Scenario Outline: a given plugin is present or absent in the plan for the flag
  ...[
    { flag: "", plugin: "pm-execution", presence: "present" },
    { flag: "", plugin: "pm-product-discovery", presence: "present" },
    { flag: "", plugin: "pm-product-strategy", presence: "present" },
    { flag: "", plugin: "pm-market-research", presence: "absent" },
    { flag: "", plugin: "pm-ai-shipping", presence: "absent" },
    { flag: "--with-optional", plugin: "pm-market-research", presence: "present" },
    { flag: "--with-optional", plugin: "pm-ai-shipping", presence: "absent" }
  ].map((row) => ({
    name: `planning-init/dry-run matrix: "${row.plugin}" is "${row.presence}" in the plan for flag "${row.flag}"`,
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { dryRun: true, ...flagToOptions(row.flag) });
        const present = result.plan.some((item) => item.kind === "install" && item.plugin === row.plugin);
        assert.equal(present, row.presence === "present", `${row.plugin} should be ${row.presence}`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  })),

  // ====================================================================
  // 01_pin-marketplace-sha.feature
  // ====================================================================
  {
    name: "planning-init/sha: a resolved commit sha is recorded as the pin (40-hex lowercase)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { sha: FIXTURE_SHA });
        const manifest = await readManifest(repo);
        assert.equal(manifest.sha, FIXTURE_SHA, "manifest records that resolved commit (ADR-002/008: provenance sha, decoupled from the clone ref)");
        assert.match(manifest.sha, SHA_RE, "the recorded sha is a 40-character lowercase-hex commit id");
        // ADR-008: the COMMAND pins the clonable tag `#v2.0.0`, never the bare sha.
        assert.match(result.plan[0].command, new RegExp(`#${MARKETPLACE_REF}$`), "the plan pins the clonable release tag `#v2.0.0` on the HTTPS git URL");
        assert.ok(!SHA_REF_RE.test(result.plan[0].command), "the marketplace command never pins a bare 40-hex sha as the ref (F2)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "planning-init/sha: a floating ref (main) is refused and nothing is recorded (non-zero, message, no manifest)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result, output } = await runInit(repo, { sha: "main" });
        assert.equal(result.shaRejected, true, "command refuses (maps to non-zero exit)");
        assert.equal(result.manifestWritten, false);
        assert.match(result.message, /40-character commit sha/i, "reports the resolved ref is not a 40-char commit sha");
        assert.equal(await manifestExists(repo), false, "no planning section written to .aof/aof.lock.json");
        assert.ok(!/network-boundary/.test(output), "no boundary/spawn on refusal");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: the candidate pin is accepted only when it is a full commit sha
  ...[
    { ref: "d384f0c9eb81fe74656a4f6da168587836939edb", outcome: "accepted" },
    { ref: "0123456789abcdef0123456789abcdef01234567", outcome: "accepted" },
    { ref: "main", outcome: "rejected" },
    { ref: "HEAD", outcome: "rejected" },
    { ref: "v2.0.0", outcome: "rejected" },
    { ref: "2.0.0", outcome: "rejected" },
    { ref: "d384f0c", outcome: "rejected" },
    { ref: "D384F0C9EB81FE74656A4F6DA168587836939EDB", outcome: "rejected" },
    { ref: "d384f0c9eb81fe74656a4f6da168587836939edbXX", outcome: "rejected" }
  ].map((row) => ({
    name: `planning-init/sha matrix: ref "${row.ref}" is "${row.outcome}"`,
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { sha: row.ref });
        if (row.outcome === "accepted") {
          assert.equal(result.shaRejected, false, `${row.ref} accepted`);
          assert.equal(result.manifestWritten, true, "manifest written on accept");
          assert.match(result.manifest.sha, SHA_RE);
        } else {
          assert.equal(result.shaRejected, true, `${row.ref} rejected`);
          assert.equal(result.manifestWritten, false, "no manifest on reject");
          assert.equal(await manifestExists(repo), false, "manifest not written");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  })),
  // Scenario Outline: the manifest records the sha only when the pin is accepted
  ...[
    { ref: "d384f0c9eb81fe74656a4f6da168587836939edb", state: "records that sha as the pin" },
    { ref: "main", state: "is not written" },
    { ref: "v2.0.0", state: "is not written" }
  ].map((row) => ({
    name: `planning-init/sha matrix: manifest for ref "${row.ref}" — ${row.state}`,
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { sha: row.ref });
        if (row.state.startsWith("records")) {
          const manifest = await readManifest(repo);
          assert.equal(manifest.sha, row.ref, "manifest records that sha as the pin");
        } else {
          assert.equal(await manifestExists(repo), false, "manifest is not written");
          assert.equal(result.manifestWritten, false);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  })),

  // ====================================================================
  // 02_execute-and-write-provenance.feature
  // ====================================================================
  {
    name: "planning-init/execute: each executing step is preceded by a network-boundary warning (network + plugin/marketplace code)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result, lines } = await runInit(repo);
        // A boundary line precedes each command, and a warning naming network +
        // plugin/marketplace code follows it.
        for (const item of result.plan) {
          const boundaryIdx = lines.findIndex((line) => line === `network-boundary: ${item.command}`);
          assert.ok(boundaryIdx >= 0, `a network-boundary line printed for ${item.command}`);
          const warning = lines[boundaryIdx + 1] ?? "";
          assert.match(warning, /access(es)? the network/i, "warning states it accesses the network");
          assert.match(warning, /plugin\/marketplace code/i, "warning states it executes plugin/marketplace code");
          assert.ok(!/npm package code/i.test(warning), "not the npm wording");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "planning-init/execute: a successful run writes the provenance under the planning section of the unified lock (exit 0)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo);
        assert.equal(result.guarded, false);
        assert.equal(result.shaRejected, false);
        assert.equal(result.manifestWritten, true);
        assert.equal(await manifestExists(repo), true, ".aof/aof.lock.json carries a planning section");
        // ADR-009: the provenance lives in the unified lock, not a per-vertical file.
        assert.equal(path.basename(planningLockPath(repo)), "aof.lock.json");
        assert.ok(!existsSync(path.join(repo, ".aof", "aof.planning.lock.json")), "no separate aof.planning.lock.json");
        assert.equal(result.manifestPath, planningLockPath(repo), "result.manifestPath is the unified lock");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "planning-init/execute: the manifest carries the frozen provenance schema for a default claude run",
    run: async () => {
      const repo = await tempRepo();
      try {
        await runInit(repo);
        const manifest = await readManifest(repo);
        assert.equal(manifest.source, "phuryn/pm-skills", "source");
        assert.equal(manifest.marketplaceName, "pm-skills", "marketplaceName");
        assert.equal(manifest.runtime, "claude", "runtime");
        assert.ok(typeof manifest.marketplaceVersion === "string" && manifest.marketplaceVersion.length > 0, "marketplaceVersion present");
        assert.match(manifest.sha, SHA_RE, "sha is a 40-char lowercase-hex commit id");
        // ADR-009: the `planning` section has no own `version` (the unified lock
        // carries ONE top-level version) — the frozen section schema is exactly
        // { generatedAt, source, marketplaceName, marketplaceVersion, sha, runtime, plugins, codex }.
        assert.equal(manifest.version, undefined, "the planning section carries no own version (ADR-009)");
        assert.equal(manifest.codex, null, "codex null for claude");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: the recorded plugins list is exactly the recommended set for the flag
  ...[
    { flag: "", plugins: ["pm-execution", "pm-product-discovery", "pm-product-strategy"] },
    { flag: "--with-optional", plugins: ["pm-execution", "pm-product-discovery", "pm-product-strategy", "pm-market-research"] }
  ].map((row) => ({
    name: `planning-init/execute matrix: recorded plugins is exactly [${row.plugins.join(", ")}] for flag "${row.flag}"`,
    run: async () => {
      const repo = await tempRepo();
      try {
        await runInit(repo, { ...flagToOptions(row.flag) });
        const manifest = await readManifest(repo);
        assert.deepEqual(manifest.plugins.map((entry) => entry.name), row.plugins, "plugins lists exactly the set");
        assert.ok(!manifest.plugins.some((entry) => entry.name === "pm-ai-shipping"), "plugins does not list pm-ai-shipping");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  })),
  {
    name: "planning-init/execute: each recorded plugin entry names its plugin and a marketplace of pm-skills",
    run: async () => {
      const repo = await tempRepo();
      try {
        await runInit(repo);
        const manifest = await readManifest(repo);
        assert.ok(manifest.plugins.length > 0);
        for (const entry of manifest.plugins) {
          assert.ok(typeof entry.name === "string" && entry.name.length > 0, "entry has a name");
          assert.equal(entry.marketplace, "pm-skills", "entry marketplace is pm-skills");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },

  // ====================================================================
  // 03_codex-degrade-and-guard.feature
  // ====================================================================
  {
    name: "planning-init/codex: the codex plan registers the marketplace but contains no per-plugin install step",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { runtime: "codex", dryRun: true });
        assert.ok(result.plan.some((item) => item.kind === "marketplace"), "plan registers the pm-skills marketplace");
        assert.ok(!result.plan.some((item) => item.kind === "install"), "plan contains no per-plugin install step");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "planning-init/codex: the codex run records an honest degrade in the manifest (registered true / installed false / plugins empty)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { runtime: "codex" });
        assert.equal(result.shaRejected, false);
        assert.equal(result.manifestWritten, true);
        const manifest = await readManifest(repo);
        assert.equal(manifest.codex.marketplaceRegistered, true, "codex.marketplaceRegistered true");
        assert.equal(manifest.codex.pluginsInstalled, false, "codex.pluginsInstalled false");
        assert.deepEqual(manifest.plugins, [], "plugins lists no installed plugin");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "planning-init/codex: emits a manual fallback and claims no plugin install success",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result, output } = await runInit(repo, { runtime: "codex" });
        assert.ok(!/plugins (were )?installed\b(?!.*not)/i.test(output), "does not claim plugins were installed");
        assert.ok(/NOT installed/i.test(output), "states plugins were NOT installed");
        // The exact manual fallback commands the user must run — carrying the project
        // scope (ADR-010), since the user runs them through the claude CLI.
        for (const plugin of CORE_PLUGINS) {
          assert.ok(output.includes(`claude plugin install --scope project ${plugin}@pm-skills`), `emits manual fallback for ${plugin}`);
          assert.ok(result.manualFallback.includes(`claude plugin install --scope project ${plugin}@pm-skills`), `manualFallback includes ${plugin}`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: the plan's install behaviour differs by runtime
  ...[
    { runtime: "claude", installs: "scripts the plugins" },
    { runtime: "codex", installs: "not attempted" }
  ].map((row) => ({
    name: `planning-init/runtime matrix: ${row.runtime} — per-plugin install is "${row.installs}"`,
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { runtime: row.runtime, dryRun: true });
        assert.ok(result.plan.some((item) => item.kind === "marketplace"), "both register the marketplace");
        const scriptsInstalls = result.plan.some((item) => item.kind === "install");
        assert.equal(scriptsInstalls, row.installs === "scripts the plugins", `install behaviour: ${row.installs}`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  })),
  {
    name: "planning-init/guard: re-running without --force refuses, writes nothing, points to --force, manifest unchanged",
    run: async () => {
      const repo = await tempRepo();
      try {
        await runInit(repo); // first install
        const before = await readFile(planningLockPath(repo), "utf8");
        const { result, output } = await runInit(repo); // re-run, no --force
        assert.equal(result.guarded, true, "command refuses (non-zero)");
        assert.equal(result.manifestWritten, false);
        assert.match(result.message, /--force/, "points the user to --force");
        assert.ok(!/network-boundary/.test(output), "no spawn/network on refusal");
        assert.equal(await readFile(planningLockPath(repo), "utf8"), before, "existing manifest unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "planning-init/guard: --force re-pins and rewrites the manifest (exit 0)",
    run: async () => {
      const repo = await tempRepo();
      try {
        await runInit(repo);
        // Seed a distinguishable existing `planning` section so a rewrite is
        // observable — read-merge-write it back so the foreign sections (none here)
        // and the section wrapper are preserved.
        const lock = await readUnifiedLock(repo);
        const seededPlanning = { ...lock.planning, generatedAt: "2000-01-01T00:00:00.000Z", sha: "0".repeat(40) };
        await writeUnifiedLock(repo, { ...lock, planning: seededPlanning });
        const before = await readFile(planningLockPath(repo), "utf8");

        const { result } = await runInit(repo, { force: true, sha: FIXTURE_SHA });
        assert.equal(result.guarded, false, "force bypasses the guard (exit 0)");
        assert.equal(result.manifestWritten, true, "manifest rewritten");
        const after = await readFile(planningLockPath(repo), "utf8");
        assert.notEqual(after, before, "the provenance manifest is rewritten");
        assert.equal((await readManifest(repo)).sha, FIXTURE_SHA, "re-pinned to the resolved sha");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "planning-init/guard: --dry-run previews regardless of the guard (exit 0, reports commands, manifest unchanged)",
    run: async () => {
      const repo = await tempRepo();
      try {
        await runInit(repo);
        const before = await readFile(planningLockPath(repo), "utf8");
        const { result, output } = await runInit(repo, { dryRun: true });
        assert.equal(result.guarded, false, "dry-run previews regardless of the guard");
        assert.ok(result.planCommands.length > 0, "reports the runtime commands it would run");
        assert.ok(/marketplace add/.test(output), "preview prints the commands");
        assert.equal(await readFile(planningLockPath(repo), "utf8"), before, "existing manifest unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: the re-run guard maps the precondition to an outcome
  ...[
    { precondition: "no planning manifest", flag: "", outcome: "install + write manifest" },
    { precondition: "planning manifest", flag: "", outcome: "refuse, exit non-zero, no writes" },
    { precondition: "planning manifest", flag: "--force", outcome: "re-pin + rewrite manifest" },
    { precondition: "planning manifest", flag: "--dry-run", outcome: "preview only, manifest unchanged" }
  ].map((row) => ({
    name: `planning-init/guard matrix: "${row.precondition}" + "${row.flag}" => ${row.outcome}`,
    run: async () => {
      const repo = await tempRepo();
      try {
        let before = null;
        if (row.precondition === "planning manifest") {
          await runInit(repo); // seed an existing manifest
          before = await readFile(planningLockPath(repo), "utf8");
        }
        const opts = {};
        if (row.flag === "--force") opts.force = true;
        if (row.flag === "--dry-run") opts.dryRun = true;
        const { result } = await runInit(repo, opts);

        if (row.outcome === "install + write manifest") {
          assert.equal(result.guarded, false);
          assert.equal(result.manifestWritten, true);
          assert.equal(await manifestExists(repo), true);
        } else if (row.outcome === "refuse, exit non-zero, no writes") {
          assert.equal(result.guarded, true, "refuse");
          assert.equal(result.manifestWritten, false, "no writes");
          assert.equal(await readFile(planningLockPath(repo), "utf8"), before, "manifest unchanged");
        } else if (row.outcome === "re-pin + rewrite manifest") {
          assert.equal(result.guarded, false);
          assert.equal(result.manifestWritten, true, "rewrite");
        } else if (row.outcome === "preview only, manifest unchanged") {
          assert.equal(result.guarded, false);
          assert.equal(result.manifestWritten, false, "preview only");
          assert.equal(await readFile(planningLockPath(repo), "utf8"), before, "manifest unchanged");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  })),
  // Review fix (honesty gate): a failed runtime step must NOT be recorded as a
  // successful pin. With a real (non-simulated) spawn that exits non-zero, the run
  // refuses to write the provenance manifest and surfaces the failure.
  {
    name: "planning-init/honesty: a failed install step writes no manifest and reports the failure",
    run: async () => {
      const repo = await tempRepo();
      const lines = [];
      try {
        // Non-simulated: inject a spawn that fails the first plugin install but
        // succeeds the marketplace add, so we exercise the per-step status path.
        let call = 0;
        const spawnStub = (bin, argv) => {
          call += 1;
          const isInstall = argv.includes("install");
          return { status: isInstall ? 1 : 0, stdout: "" };
        };
        const result = await initPlanning({
          targetDir: repo,
          sha: FIXTURE_SHA,
          simulateInstall: false,
          spawn: spawnStub,
          log: (line) => lines.push(String(line))
        });
        assert.equal(result.installFailed, true, "the run reports installFailed");
        assert.equal(result.manifestWritten, false, "no manifest written on failure");
        assert.equal(await manifestExists(repo), false, "the provenance manifest is absent");
        assert.match(result.message, /fail/i, "the message surfaces the failed step");
        assert.ok(call > 0, "the injected spawn was actually exercised (a real, non-simulated run)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },

  // ====================================================================
  // 04_https-marketplace-source.feature  (ADR-007 / Finding F1)
  // 05_clonable-marketplace-ref.feature  (ADR-008 / Finding F2)
  // The marketplace-add command must register over HTTPS, not SSH (F1): its source
  // is an HTTPS git URL — never the `owner/repo@<ref>` shorthand (SSH clone). AND
  // the `#<ref>` pin must be a CLONABLE branch/tag name, never a bare 40-hex commit
  // sha (F2): `claude plugin marketplace add <url>#<ref>` runs `git clone --branch
  // <ref>`, which cannot resolve a bare commit. So the ref is the immutable release
  // tag `v2.0.0` (= MARKETPLACE_REF). The per-plugin install token is unchanged.
  // ====================================================================
  {
    // @executable Scenario (task 05): the marketplace-add command pins a clonable
    // ref, never a bare commit sha — over HTTPS, not the SSH-able shorthand.
    name: "planning-init/clonable-ref: marketplace-add is an HTTPS git URL pinned by the clonable tag #v2.0.0 (never a bare sha, never the SSH shorthand)",
    run: async () => {
      const repo = await tempRepo();
      try {
        // Drive the REAL planPlanningInstall via initPlanning (offline: injected sha,
        // simulated install) — the claude plan for the recommended set.
        const { result } = await runInit(repo, { sha: FIXTURE_SHA });
        const marketplace = result.plan.find((item) => item.kind === "marketplace");
        assert.ok(marketplace, "the plan contains a marketplace-add step");

        // ADR-008: the full command is exactly the HTTPS `.git#v2.0.0` tag form —
        // the clone ref is the release TAG, decoupled from the provenance sha.
        assert.equal(
          marketplace.command,
          `claude plugin marketplace add --scope project ${MARKETPLACE_GIT_URL}#${MARKETPLACE_REF}`,
          "marketplace add declares at PROJECT scope (ADR-010) and uses the HTTPS git URL with the immutable tag pinned as the #<ref>"
        );

        // The source token (the argv tail) is an `https://` URL for phuryn/pm-skills,
        // a `.git#v2.0.0` URL — the ref pinned on it is a clonable branch/tag name.
        const source = marketplace.argv[marketplace.argv.length - 1];
        assert.ok(source.startsWith("https://"), 'the marketplace source is an "https://" git URL');
        assert.match(source, /github\.com\/phuryn\/pm-skills/, "the source is for phuryn/pm-skills");
        assert.match(source, new RegExp(`\\.git#${MARKETPLACE_REF}$`), "the clonable tag is pinned as a .git#<ref> ref");

        // F2 guard: the emitted `#<ref>` is NOT a bare 40-hex sha (a clone-by-branch
        // cannot resolve it) — neither when injecting FIXTURE_SHA nor the tag commit.
        const ref = source.slice(source.lastIndexOf("#") + 1);
        assert.ok(!/^[0-9a-f]{40}$/.test(ref), `the ref "${ref}" is a clonable name, not a bare 40-hex commit sha (F2)`);
        assert.ok(!SHA_REF_RE.test(marketplace.command), "the command never pins a bare 40-hex sha as the ref (F2)");

        // F1 guard: it does NOT pass the bare `phuryn/pm-skills@<ref>` shorthand
        // (which clones over SSH).
        assert.ok(
          !/\bphuryn\/pm-skills@/.test(marketplace.command),
          "the SSH-able `phuryn/pm-skills@<ref>` shorthand appears nowhere in the command"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // @executable Scenario (task 05): provenance still records the exact 40-hex
    // commit the clonable tag resolves to — the planning-section shape is unchanged
    // (ADR-002/003 survive; ADR-009 only moves storage into the unified lock).
    name: "planning-init/clonable-ref: provenance records the 40-hex commit the tag resolves to (planning section of .aof/aof.lock.json, shape unchanged)",
    run: async () => {
      const repo = await tempRepo();
      try {
        // Simulate the tag→commit resolution offline: an injected ls-remote payload
        // (the `refs/tags/v2.0.0` line of a lightweight tag → the commit directly).
        const lsRemoteStdout = `${TAG_COMMIT_SHA}\trefs/tags/${MARKETPLACE_REF}\n`;
        const resolved = parseTagSha(lsRemoteStdout, MARKETPLACE_REF);
        assert.equal(resolved, TAG_COMMIT_SHA, "parseTagSha extracts the commit from the refs/tags/v2.0.0 line");

        // Feed that resolved commit through as the provenance sha (the resolveSha
        // injection seam) — the manifest records the 40-hex commit, not the tag.
        // sha:undefined so the resolveSha callback (not the default FIXTURE_SHA) wins.
        const { result } = await runInit(repo, { sha: undefined, resolveSha: () => resolved });
        assert.equal(result.manifestWritten, true);
        const manifest = await readManifest(repo);
        assert.equal(manifest.sha, TAG_COMMIT_SHA, "manifest.sha is the 40-hex commit the tag points at (ADR-002 unchanged)");
        assert.match(manifest.sha, SHA_RE, "the recorded sha is a 40-char lowercase-hex commit id");

        // ADR-009: provenance is the `planning` section of the unified lock; the
        // section's shape (source/marketplaceName/marketplaceVersion/sha/…) is
        // unchanged from ADR-003, only its storage location moved.
        assert.equal(path.basename(planningLockPath(repo)), "aof.lock.json", "the unified lock path");
        assert.ok(!existsSync(path.join(repo, ".aof", "aof.planning.lock.json")), "no separate aof.planning.lock.json");
        assert.equal(manifest.source, "phuryn/pm-skills", "manifest shape: source unchanged");
        assert.equal(manifest.marketplaceName, "pm-skills", "manifest shape: marketplaceName unchanged");
        assert.equal(manifest.marketplaceVersion, "2.0.0", "manifest shape: marketplaceVersion is the semver, unchanged");

        // The command that produced it pinned the clonable tag, not this sha.
        assert.equal(
          result.plan[0].command,
          `claude plugin marketplace add --scope project ${MARKETPLACE_GIT_URL}#${MARKETPLACE_REF}`,
          "the clone ref is the tag, decoupled from the recorded provenance sha (declared at project scope, ADR-010)"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // ADR-008: parseTagSha prefers the peeled `^{}` line for an annotated tag (its
    // sha is the underlying COMMIT), else falls back to the plain tag line.
    name: "planning-init/clonable-ref: parseTagSha dereferences an annotated tag via its peeled ^{} line, falls back to a lightweight tag line",
    run: async () => {
      const annotatedTagObject = "1111111111111111111111111111111111111111";
      const annotated =
        `${annotatedTagObject}\trefs/tags/${MARKETPLACE_REF}\n` +
        `${TAG_COMMIT_SHA}\trefs/tags/${MARKETPLACE_REF}^{}\n`;
      assert.equal(parseTagSha(annotated, MARKETPLACE_REF), TAG_COMMIT_SHA, "annotated → peeled ^{} commit");

      const lightweight = `${TAG_COMMIT_SHA}\trefs/tags/${MARKETPLACE_REF}\n`;
      assert.equal(parseTagSha(lightweight, MARKETPLACE_REF), TAG_COMMIT_SHA, "lightweight → the tag line commit");

      assert.equal(parseTagSha("", MARKETPLACE_REF), "", "no matching ref → empty (caller's 40-hex gate refuses)");
    }
  },
  {
    // QA behavioural review (F2 fix): a MIS-RESOLVED tag — an ls-remote payload that
    // matches no v2.0.0 ref — resolves to "" and must REFUSE before any write, never
    // mis-pin. Proves the "never mis-pin" intent end-to-end through resolveSha + the
    // 40-hex gate, not just parseTagSha in isolation.
    name: "planning-init/clonable-ref: a tag that resolves to no commit refuses (shaRejected, no manifest) — never mis-pins",
    run: async () => {
      const repo = await tempRepo();
      try {
        // Payload carries only an unrelated ref → parseTagSha finds no v2.0.0 line → "".
        const miss = `${TAG_COMMIT_SHA}\trefs/tags/v9.9.9\n`;
        const { result } = await runInit(repo, { sha: undefined, resolveSha: () => parseTagSha(miss, MARKETPLACE_REF) });
        assert.equal(result.shaRejected, true, "an unresolved tag refuses before any write");
        assert.equal(result.manifestWritten, false, "no manifest on a mis-resolved tag");
        assert.equal(await manifestExists(repo), false, "no manifest file left on disk");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // @executable Scenario: the per-plugin install still targets the marketplace by its manifest name
    name: "planning-init/https: each plugin-install command still uses <plugin>@pm-skills (manifest name, unchanged)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { sha: FIXTURE_SHA });
        const installs = result.plan.filter((item) => item.kind === "install");
        assert.ok(installs.length > 0, "the plan contains per-plugin install steps");
        for (const item of installs) {
          // The install token is the marketplace MANIFEST NAME (pm-skills), not the
          // HTTPS clone source — only the marketplace-add source needed to change.
          assert.equal(
            item.command,
            `claude plugin install --scope project ${item.plugin}@pm-skills`,
            `${item.plugin} install still targets the marketplace by its manifest name @pm-skills (at project scope, ADR-010)`
          );
          // The install token is `<plugin>@pm-skills` — ends with the manifest name.
          assert.match(item.command, new RegExp(`${item.plugin}@pm-skills$`), "install command is <plugin>@pm-skills");
          // The HTTPS URL must NOT leak into the install token.
          assert.ok(!item.command.includes("https://"), "the install token is not the HTTPS clone source");
          assert.ok(!item.command.includes(".git#"), "the install token carries no #<sha> ref");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },

  // ====================================================================
  // Story 02 / task 00 — 00_planning-provenance-section.feature (@executable)
  // ADR-009: provenance is the `planning` SECTION of the unified lock; the separate
  // aof.planning.lock.json file is eliminated and the writer preserves foreign
  // sections (read-merge-write).
  // ====================================================================
  {
    // @executable: provenance is written to the planning section of the unified
    // lock; no separate aof.planning.lock.json; the section carries the frozen schema.
    name: "planning-init/section: provenance is the `planning` section of aof.lock.json (no separate file; frozen schema)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const { result } = await runInit(repo, { sha: FIXTURE_SHA });
        assert.equal(result.manifestWritten, true);

        // Exactly one lock file under .aof/ — the unified lock.
        const entries = (await readdir(path.join(repo, ".aof"))).filter((n) => n.endsWith(".lock.json"));
        assert.deepEqual(entries, ["aof.lock.json"], "only the unified aof.lock.json under .aof/");
        assert.ok(!existsSync(path.join(repo, ".aof", "aof.planning.lock.json")), "no separate aof.planning.lock.json written");

        const lock = await readUnifiedLock(repo);
        const planning = lock.planning;
        assert.ok(planning && typeof planning === "object", "provenance recorded under the `planning` section");
        // The frozen schema: source, marketplaceName, marketplaceVersion, sha, runtime, plugins, codex.
        assert.equal(planning.source, "phuryn/pm-skills", "planning.source");
        assert.equal(planning.marketplaceName, "pm-skills", "planning.marketplaceName");
        assert.equal(planning.marketplaceVersion, "2.0.0", "planning.marketplaceVersion");
        assert.match(planning.sha, SHA_RE, "planning.sha is 40-hex (ADR-002)");
        assert.equal(planning.runtime, "claude", "planning.runtime");
        assert.ok(Array.isArray(planning.plugins) && planning.plugins.length > 0, "planning.plugins[]");
        assert.equal(planning.codex, null, "planning.codex null on claude");
        assert.ok(typeof planning.generatedAt === "string", "planning.generatedAt");
        assert.equal(planning.version, undefined, "the section carries no own version (ADR-009)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // @executable: writing planning provenance preserves the other lock sections —
    // a pre-existing asset/package/framework set survives unchanged; only `planning`
    // is added.
    name: "planning-init/section: writing provenance preserves the pre-existing asset/package/framework sections",
    run: async () => {
      const repo = await tempRepo();
      try {
        // Seed the unified lock with the flat asset fields populated (no planning).
        const seeded = { ...ASSET_SEED };
        await writeUnifiedLock(repo, seeded);

        const { result } = await runInit(repo, { sha: FIXTURE_SHA });
        assert.equal(result.manifestWritten, true);

        const lock = await readUnifiedLock(repo);
        assert.ok(lock.planning && lock.planning.sha === FIXTURE_SHA, "the `planning` section is added/updated");
        // The pre-existing asset/package/framework sections survive byte-intact.
        assert.deepEqual(lock.files, seeded.files, "asset files[] preserved unchanged");
        assert.deepEqual(lock.packages, seeded.packages, "asset packages preserved");
        assert.deepEqual(lock.frameworks, seeded.frameworks, "asset frameworks preserved");
        assert.deepEqual(lock.frameworkInstallAttempts, seeded.frameworkInstallAttempts, "asset frameworkInstallAttempts preserved");
        assert.equal(lock.version, seeded.version, "top-level asset version preserved");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // @executable: the asset-lock writer (`aof assets apply`) preserves the planning
    // section — it rewrites the flat asset fields from the render plan but carries
    // the `planning` section through unchanged.
    name: "planning-init/section: `aof assets apply` carries the `planning` section through unchanged",
    run: async () => {
      const repo = await tempRepo();
      try {
        // First write a planning section into a lock that also has asset fields.
        await writeUnifiedLock(repo, { ...ASSET_SEED });
        await runInit(repo, { sha: FIXTURE_SHA });
        const planningBefore = (await readUnifiedLock(repo)).planning;

        // Now run the asset-apply lock-write path; it must preserve `planning`.
        await runAssetApply(repo);

        const lock = await readUnifiedLock(repo);
        assert.ok(Array.isArray(lock.files), "asset files[] reflects the new render plan");
        assert.deepEqual(lock.planning, planningBefore, "the `planning` section is carried through unchanged");
        const entries = (await readdir(path.join(repo, ".aof"))).filter((n) => n.endsWith(".lock.json"));
        assert.deepEqual(entries, ["aof.lock.json"], "still only the unified aof.lock.json");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // @executable: the re-run guard keys off the `planning` SECTION (not a separate
    // file). A bare re-run with an existing `planning` section refuses + writes
    // nothing; --force re-pins the `planning` section while preserving the others.
    name: "planning-init/section: the re-run guard keys off the `planning` section; --force re-pins while preserving the other sections",
    run: async () => {
      const repo = await tempRepo();
      try {
        // Seed asset + work sections, then a planning section.
        await writeUnifiedLock(repo, { ...ASSET_SEED, work: { ...WORK_SEED } });
        await runInit(repo, { sha: FIXTURE_SHA });
        const before = await readUnifiedLock(repo);

        // Bare re-run → guarded refusal, writes nothing.
        const bare = await runInit(repo);
        assert.equal(bare.result.guarded, true, "a bare re-run with a present `planning` section refuses");
        assert.equal(bare.result.manifestWritten, false, "the bare re-run writes nothing");
        assert.deepEqual(await readUnifiedLock(repo), before, "the lock is byte-intact after the refused re-run");

        // --force re-pins the planning section while preserving the others.
        const repinSha = "0".repeat(40);
        const forced = await runInit(repo, { force: true, sha: repinSha });
        assert.equal(forced.result.guarded, false, "--force bypasses the guard");
        assert.equal(forced.result.manifestWritten, true, "--force rewrites the planning section");
        const after = await readUnifiedLock(repo);
        assert.equal(after.planning.sha, repinSha, "the `planning` section was re-pinned");
        // The asset + work sections survive byte-intact.
        assert.deepEqual(after.files, before.files, "asset files[] preserved across --force");
        assert.deepEqual(after.work, before.work, "the `work` section preserved across --force");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];
