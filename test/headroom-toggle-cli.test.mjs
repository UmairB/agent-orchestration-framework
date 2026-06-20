// Traceability tests (@executable step definitions) for milestone 06 / story 01 —
// headroom-toggle-cli. ONE file covering the @executable scenarios — and every
// Scenario Outline row — of all four task features:
//   - tasks/00_use-headroom-writes-config.feature   → use-headroom writes the enabled block + preserves siblings + idempotent + JSON style
//   - tasks/01_unuse-headroom-disables.feature       → unuse sets enabled:false, keeps the block + providers; re-enable restores; never-had-a-block graceful
//   - tasks/02_use-headroom-install-hint.feature      → config always written; install hint printed iff headroom is NOT on PATH; never installs
//   - tasks/03_init-with-headroom.feature             → init --with-headroom writes the enabled block; without the flag it stays absent; composes with --runtime
//
// Each test name traces to its feature + scenario. Temp dirs via node:fs/promises +
// node:os mirror acd-headroom-config-isolation's seed-project idiom. The injected
// `which` is driven present/absent for the install-hint scenarios; printed output is
// captured via a `log` collector. The init scenarios call initWork directly.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { useHeadroom, unuseHeadroom } from "../src/work-headroom.mjs";
import { initWork } from "../src/work-init.mjs";

const HEADROOM_REPO = "github.com/chopratejas/headroom";
const whichPresent = (bin) => (bin === "headroom" ? "/usr/local/bin/headroom" : null);
const whichAbsent = () => null;

// A config seeded with foreign root keys AND a sibling work.ui — none of which the
// toggle is allowed to disturb. work.headroom may be supplied (or absent).
function seededConfig(headroom) {
  const config = {
    name: "demo",
    resources: [],
    settings: { model: "sonnet" },
    work: {
      dir: "./wiki/work",
      ui: { baseUrl: "https://localhost:1234" }
    }
  };
  if (headroom !== undefined) config.work.headroom = headroom;
  return config;
}

function seededLock() {
  return {
    version: 2,
    generatedAt: "2026-06-20T00:00:00.000Z",
    runtimes: ["claude"],
    files: [],
    work: { generatedAt: "2026-06-20T00:00:00.000Z", bundle: { version: "1.0.0" }, runtimes: ["claude"], files: [] }
  };
}

// Seed a temp project with .aof/aof.config.json (+ lock). `headroom` controls the
// starting work.headroom value (undefined ⇒ absent).
async function seedProject(headroom) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-headroom-cli-"));
  const aofDir = path.join(repo, ".aof");
  await mkdir(aofDir, { recursive: true });
  const configPath = path.join(aofDir, "aof.config.json");
  const lockPath = path.join(aofDir, "aof.lock.json");
  await writeFile(configPath, `${JSON.stringify(seededConfig(headroom), null, 2)}\n`, "utf8");
  await writeFile(lockPath, `${JSON.stringify(seededLock(), null, 2)}\n`, "utf8");
  return { repo, aofDir, configPath, lockPath };
}

// A fresh repo (an .aof dir but NO aof.config.json) for the init scenarios.
async function seedFreshRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-headroom-init-"));
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  return { repo, configPath: path.join(repo, ".aof", "aof.config.json") };
}

const readConfigOf = async (configPath) => JSON.parse(await readFile(configPath, "utf8"));

export const headroomToggleCliTests = [
  // ───────────────────────────────────────────────────────────────────────────────
  // tasks/00_use-headroom-writes-config.feature
  // ───────────────────────────────────────────────────────────────────────────────
  {
    name: "headroom/00 use-headroom: enables the plugin with the default wrap block",
    async run() {
      const { repo, configPath } = await seedProject();
      try {
        await useHeadroom({ targetDir: repo, which: whichPresent, log: () => {} });
        const config = await readConfigOf(configPath);
        assert.equal(config.work.headroom.enabled, true, "enabled is true");
        assert.equal(config.work.headroom.mode, "wrap", "mode is wrap");
        assert.deepEqual(config.work.headroom.providers, ["claude", "codex"], "default providers");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/00 use-headroom: preserves the sibling config keys (work.dir, work.ui)",
    async run() {
      const { repo, configPath } = await seedProject();
      try {
        await useHeadroom({ targetDir: repo, which: whichPresent, log: () => {} });
        const config = await readConfigOf(configPath);
        assert.equal(config.work.dir, "./wiki/work", "work.dir unchanged");
        assert.deepEqual(config.work.ui, { baseUrl: "https://localhost:1234" }, "work.ui.baseUrl unchanged");
        assert.equal(config.name, "demo", "root name preserved");
        assert.deepEqual(config.settings, { model: "sonnet" }, "settings preserved");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/00 use-headroom: leaves the install lock byte-identical",
    async run() {
      const { repo, lockPath } = await seedProject();
      const lockBefore = await readFile(lockPath, "utf8");
      try {
        await useHeadroom({ targetDir: repo, which: whichPresent, log: () => {} });
        assert.equal(await readFile(lockPath, "utf8"), lockBefore, "aof.lock.json byte-identical");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/00 use-headroom: re-running when already enabled is idempotent (exactly one headroom key)",
    async run() {
      const { repo, configPath } = await seedProject({ enabled: true, mode: "wrap", providers: ["claude", "codex"] });
      try {
        await useHeadroom({ targetDir: repo, which: whichPresent, log: () => {} });
        const config = await readConfigOf(configPath);
        assert.equal(config.work.headroom.enabled, true, "still enabled");
        assert.equal(config.work.headroom.mode, "wrap", "mode stays \"wrap\" across re-runs (the frozen block shape survives)");
        assert.deepEqual(config.work.headroom.providers, ["claude", "codex"], "providers unchanged");
        assert.equal(Object.keys(config.work).filter((k) => k === "headroom").length, 1, "exactly one work.headroom key");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/00 use-headroom: the written config keeps the project's JSON style and round-trips",
    async run() {
      const { repo, configPath } = await seedProject();
      try {
        await useHeadroom({ targetDir: repo, which: whichPresent, log: () => {} });
        const text = await readFile(configPath, "utf8");
        const parsed = JSON.parse(text); // parses as JSON
        assert.ok(text.endsWith("\n") && !text.endsWith("\n\n"), "single trailing newline");
        assert.equal(text, `${JSON.stringify(parsed, null, 2)}\n`, "2-space + trailing-newline; re-serialize is byte-identical");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: use-headroom ends with the plugin enabled regardless of starting state
  ...[
    { label: "absent", start: undefined },
    { label: "disabled block", start: { enabled: false, mode: "wrap", providers: ["claude"] } },
    { label: "already-enabled block", start: { enabled: true, mode: "wrap", providers: ["claude"] } }
  ].map(({ label, start }) => ({
    name: `headroom/00 use-headroom outline: starting ${label} ends enabled:true`,
    async run() {
      const { repo, configPath } = await seedProject(start);
      try {
        await useHeadroom({ targetDir: repo, which: whichPresent, log: () => {} });
        const config = await readConfigOf(configPath);
        assert.equal(config.work.headroom.enabled, true, `${label} → enabled true`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  })),

  // ───────────────────────────────────────────────────────────────────────────────
  // tasks/01_unuse-headroom-disables.feature
  // ───────────────────────────────────────────────────────────────────────────────
  {
    name: "headroom/01 unuse-headroom: disables the plugin and keeps the block with its providers",
    async run() {
      const { repo, configPath } = await seedProject({ enabled: true, mode: "wrap", providers: ["claude"] });
      try {
        await unuseHeadroom({ targetDir: repo, log: () => {} });
        const config = await readConfigOf(configPath);
        assert.equal(config.work.headroom.enabled, false, "enabled flipped to false");
        assert.ok(config.work.headroom, "block still present (not deleted)");
        assert.deepEqual(config.work.headroom.providers, ["claude"], "providers ['claude'] survive");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/01 re-running use-headroom after unuse re-enables with the kept providers",
    async run() {
      const { repo, configPath } = await seedProject({ enabled: false, mode: "wrap", providers: ["claude"] });
      try {
        await useHeadroom({ targetDir: repo, which: whichPresent, log: () => {} });
        const config = await readConfigOf(configPath);
        assert.equal(config.work.headroom.enabled, true, "re-enabled");
        assert.deepEqual(config.work.headroom.providers, ["claude"], "kept providers ['claude'] restored");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/01 unuse-headroom on a project that never had the block leaves the plugin off",
    async run() {
      const { repo, configPath } = await seedProject(); // no work.headroom
      try {
        await unuseHeadroom({ targetDir: repo, log: () => {} });
        const config = await readConfigOf(configPath);
        // plugin is off: an absent block OR enabled:false both satisfy "off" (ADR-001).
        const off = !config.work.headroom || config.work.headroom.enabled === false;
        assert.ok(off, "plugin is off (disabled-or-absent block)");
        // sibling preserved on this path too.
        assert.deepEqual(config.work.ui, { baseUrl: "https://localhost:1234" }, "sibling work.ui preserved");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/01 unuse-headroom leaves the install lock byte-identical",
    async run() {
      const { repo, lockPath } = await seedProject({ enabled: true, mode: "wrap", providers: ["claude"] });
      const lockBefore = await readFile(lockPath, "utf8");
      try {
        await unuseHeadroom({ targetDir: repo, log: () => {} });
        assert.equal(await readFile(lockPath, "utf8"), lockBefore, "aof.lock.json byte-identical");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: unuse-headroom always ends with the plugin off, preserving any chosen providers
  ...[
    { start: { enabled: true, mode: "wrap", providers: ["claude"] }, providers: ["claude"] },
    { start: { enabled: true, mode: "wrap", providers: ["claude", "codex"] }, providers: ["claude", "codex"] },
    { start: { enabled: false, mode: "wrap", providers: ["codex"] }, providers: ["codex"] },
    { start: undefined, providers: null } // absent → (none)
  ].map(({ start, providers }) => ({
    name: `headroom/01 unuse-headroom outline: start ${start ? JSON.stringify(start.providers) : "absent"} → off, providers ${providers ? JSON.stringify(providers) : "(none)"}`,
    async run() {
      const { repo, configPath } = await seedProject(start);
      try {
        await unuseHeadroom({ targetDir: repo, log: () => {} });
        const config = await readConfigOf(configPath);
        const off = !config.work.headroom || config.work.headroom.enabled === false;
        assert.ok(off, "plugin is off");
        if (providers === null) {
          // no chosen providers survive (the never-had-a-block off-state has none).
          assert.ok(!config.work.headroom?.providers, "no surviving providers");
        } else {
          assert.deepEqual(config.work.headroom.providers, providers, "chosen providers survive");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  })),

  // ───────────────────────────────────────────────────────────────────────────────
  // tasks/02_use-headroom-install-hint.feature
  // ───────────────────────────────────────────────────────────────────────────────
  {
    name: "headroom/02 with headroom missing, use-headroom still writes the config and prints the install hint",
    async run() {
      const { repo, configPath } = await seedProject();
      const out = [];
      try {
        await useHeadroom({ targetDir: repo, which: whichAbsent, log: (line) => out.push(line) });
        const config = await readConfigOf(configPath);
        assert.equal(config.work.headroom.enabled, true, "config written + enabled despite missing binary");
        assert.equal(out.length, 1, "exactly one-line install hint");
        assert.ok(out[0].includes(HEADROOM_REPO), `hint names ${HEADROOM_REPO}`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/02 with headroom present, use-headroom writes the config and prints no install hint",
    async run() {
      const { repo, configPath } = await seedProject();
      const out = [];
      try {
        await useHeadroom({ targetDir: repo, which: whichPresent, log: (line) => out.push(line) });
        const config = await readConfigOf(configPath);
        assert.equal(config.work.headroom.enabled, true, "config written + enabled");
        assert.equal(out.length, 0, "no install hint when headroom is on PATH");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/02 use-headroom never runs an installer when headroom is missing (succeeds, binaries unchanged)",
    async run() {
      const { repo } = await seedProject();
      const out = [];
      try {
        // The helper imports no installer and shells out to nothing — a successful
        // return with only a hint printed is the observable no-install guarantee.
        const result = await useHeadroom({ targetDir: repo, which: whichAbsent, log: (line) => out.push(line) });
        assert.equal(result.headroomOnPath, false, "headroom reported absent");
        assert.equal(result.hintPrinted, true, "hint printed (not an install)");
        // The honest no-install shadow: the command succeeded and only WROTE CONFIG
        // (intent honoured) — the enabled block is on disk and exactly one hint line was
        // emitted, never an installer command. (The structural "imports no installer /
        // shells out to nothing" is owned by the arch-test acd-headroom-no-dependency.)
        assert.equal(result.config.work.headroom.enabled, true, "config was written (intent honoured), not an install");
        assert.equal(out.length, 1, "exactly one hint line was printed — no installer output");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: the config is always written; the install hint depends only on PATH presence
  ...[
    { label: "not on PATH", which: whichAbsent, configWritten: true, hintPrinted: true },
    { label: "on PATH", which: whichPresent, configWritten: true, hintPrinted: false }
  ].map(({ label, which, configWritten, hintPrinted }) => ({
    name: `headroom/02 outline: headroom ${label} → configWritten=${configWritten}, hintPrinted=${hintPrinted}`,
    async run() {
      const { repo, configPath } = await seedProject();
      const out = [];
      try {
        await useHeadroom({ targetDir: repo, which, log: (line) => out.push(line) });
        const config = await readConfigOf(configPath);
        assert.equal(config.work.headroom.enabled === true, configWritten, "config written either way");
        assert.equal(out.length === 1 && out[0].includes(HEADROOM_REPO), hintPrinted, `hint printed iff ${label}`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  })),

  // ───────────────────────────────────────────────────────────────────────────────
  // tasks/03_init-with-headroom.feature
  // ───────────────────────────────────────────────────────────────────────────────
  {
    name: "headroom/03 init --with-headroom writes the enabled wrap block on a fresh install",
    async run() {
      const { repo, configPath } = await seedFreshRepo();
      try {
        const result = await initWork({ targetDir: repo, runtimes: ["claude"], withHeadroom: true });
        assert.equal(result.guarded, false, "init succeeded (exit 0 equivalent)");
        assert.ok(existsSync(configPath), "aof.config.json was created");
        const config = await readConfigOf(configPath);
        assert.equal(config.work.headroom.enabled, true, "work.headroom.enabled true");
        assert.equal(config.work.headroom.mode, "wrap", "mode is wrap");
        assert.deepEqual(config.work.headroom.providers, ["claude", "codex"], "default providers");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/03 init without the flag leaves work.headroom absent (plugin off by default)",
    async run() {
      const { repo, configPath } = await seedFreshRepo();
      try {
        const result = await initWork({ targetDir: repo, runtimes: ["claude"] });
        assert.equal(result.guarded, false, "init succeeded");
        // Without --with-headroom, init writes no config at all (it renders the bundle +
        // lock only), so there is no work.headroom block — the off default (ADR-001).
        const hasHeadroom = existsSync(configPath) && Boolean((await readConfigOf(configPath)).work?.headroom);
        assert.equal(hasHeadroom, false, "no work.headroom in the resulting config");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "headroom/03 --with-headroom composes with --runtime without disturbing the runtimes",
    async run() {
      const { repo, configPath } = await seedFreshRepo();
      try {
        const result = await initWork({ targetDir: repo, runtimes: ["claude", "codex"], withHeadroom: true });
        assert.deepEqual(result.runtimes, ["claude", "codex"], "init selected runtimes claude and codex");
        const config = await readConfigOf(configPath);
        assert.deepEqual(config.runtimes, ["claude", "codex"], "the resulting config selects the runtimes claude and codex");
        assert.equal(config.work.headroom.enabled, true, "headroom enabled");
        assert.deepEqual(config.work.headroom.providers, ["claude", "codex"], "providers independent of --runtime");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: the --with-headroom flag decides whether the plugin block is written on init
  ...[
    { label: "--with-headroom", withHeadroom: true, present: true, enabled: true },
    { label: "(no flag)", withHeadroom: false, present: false, enabled: undefined }
  ].map(({ label, withHeadroom, present, enabled }) => ({
    name: `headroom/03 init outline: ${label} → work.headroom present=${present}, enabled=${enabled ?? "(absent)"}`,
    async run() {
      const { repo, configPath } = await seedFreshRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"], withHeadroom });
        const block = existsSync(configPath) ? (await readConfigOf(configPath)).work?.headroom : undefined;
        assert.equal(Boolean(block), present, `work.headroom present=${present}`);
        if (present) assert.equal(block.enabled, enabled, "enabled flag matches");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }))
];
