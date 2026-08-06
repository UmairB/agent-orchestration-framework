// `aof work orchestrator` — pick the model the main ACD (orchestrating) session
// runs on (Fable 5 or Opus 4.8).
//
// Asserted against the REAL surface (src/work-orchestrator.mjs): the config-only
// read-merge-write of settings.claude.model, the arg + interactive (env-stubbed)
// resolution, sibling preservation, and that the choice renders into
// .claude/settings.json through the real runtime-config projection.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ORCHESTRATOR_IDS,
  resolveOrchestratorModel,
  setOrchestratorModel,
  readOrchestratorModel,
  selectOrchestratorModel,
  showOrchestratorModel
} from "../src/work-orchestrator.mjs";
// m43 / ADR-002 AC11: the whole-file `claudeSettingsJson` renderer is GONE (a
// co-authored file gets a surgical merge, never a whole-file render). The orchestrator
// model still lands in `.claude/settings.json` — through the merge PATCH, which is what
// this test now proves is functional.
import { claudeSettingsPatch } from "../src/claude-settings.mjs";

async function fixture(config) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-orchestrator-"));
  await mkdir(path.join(dir, ".aof"), { recursive: true });
  await writeFile(path.join(dir, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return dir;
}

async function readConfigFile(dir) {
  return JSON.parse(await readFile(path.join(dir, ".aof", "aof.config.json"), "utf8"));
}

const silent = () => {};

export const workOrchestratorTests = [
  {
    name: "work-orchestrator: the two offered choices are exactly Fable 5 and Opus 4.8",
    run: async () => {
      assert.deepEqual([...ORCHESTRATOR_IDS].sort(), ["fable", "opus"], "only fable and opus are offered");
    }
  },

  {
    name: "work-orchestrator: resolveOrchestratorModel accepts id/label/leading-token, rejects anything else",
    run: async () => {
      assert.equal(resolveOrchestratorModel("fable"), "fable");
      assert.equal(resolveOrchestratorModel("Fable 5"), "fable");
      assert.equal(resolveOrchestratorModel("fable-5"), "fable");
      assert.equal(resolveOrchestratorModel("opus"), "opus");
      assert.equal(resolveOrchestratorModel("Opus 4.8"), "opus");
      assert.equal(resolveOrchestratorModel("opus-4.8"), "opus");
      assert.equal(resolveOrchestratorModel("sonnet"), null, "a non-offered model resolves to null");
      assert.equal(resolveOrchestratorModel(""), null);
      assert.equal(resolveOrchestratorModel(42), null);
    }
  },

  {
    name: "work-orchestrator: setOrchestratorModel writes ONLY settings.claude.model, preserving every sibling",
    run: async () => {
      const config = {
        name: "x",
        settings: { model: "keep-top", claude: { autoCompact: true }, codex: { foo: 1 } },
        work: { agents: { models: { "aof-qa": "opus" }, mode: "orchestrated" } }
      };
      setOrchestratorModel(config, "fable");
      assert.equal(config.settings.claude.model, "fable", "orchestrator model set");
      assert.equal(config.settings.claude.autoCompact, true, "settings.claude sibling preserved");
      assert.equal(config.settings.model, "keep-top", "settings.* sibling preserved");
      assert.deepEqual(config.settings.codex, { foo: 1 }, "settings.codex preserved");
      assert.deepEqual(config.work.agents.models, { "aof-qa": "opus" }, "work.agents.models untouched");
      assert.equal(config.work.agents.mode, "orchestrated", "work.agents.mode untouched");
    }
  },

  {
    name: "work-orchestrator: selecting by arg persists the model and reports the change (fresh project)",
    run: async () => {
      const dir = await fixture({ name: "x" });
      try {
        const result = await selectOrchestratorModel({ targetDir: dir, model: "Fable 5", log: silent });
        assert.equal(result.model, "fable");
        assert.equal(result.previous, null);
        assert.equal(result.changed, true);
        const written = await readConfigFile(dir);
        assert.equal(written.settings.claude.model, "fable", "persisted to settings.claude.model");
        assert.equal(readOrchestratorModel(written), "fable", "accessor reads it back");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work-orchestrator: the interactive prompt is exercised via the AOF_ORCHESTRATOR_INPUT test seam",
    run: async () => {
      const dir = await fixture({ name: "x" });
      const previousEnv = process.env.AOF_ORCHESTRATOR_INPUT;
      process.env.AOF_ORCHESTRATOR_INPUT = "opus-4.8";
      try {
        const result = await selectOrchestratorModel({ targetDir: dir, log: silent });
        assert.equal(result.model, "opus", "the stubbed choice is honoured");
        const written = await readConfigFile(dir);
        assert.equal(written.settings.claude.model, "opus");
      } finally {
        if (previousEnv === undefined) delete process.env.AOF_ORCHESTRATOR_INPUT;
        else process.env.AOF_ORCHESTRATOR_INPUT = previousEnv;
        await rm(dir, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work-orchestrator: an unsupported model arg is rejected without writing the config",
    run: async () => {
      const dir = await fixture({ name: "x", settings: { claude: { model: "opus" } } });
      try {
        await assert.rejects(
          () => selectOrchestratorModel({ targetDir: dir, model: "sonnet", log: silent }),
          /not a supported orchestrator model/,
          "sonnet is rejected"
        );
        const written = await readConfigFile(dir);
        assert.equal(written.settings.claude.model, "opus", "config is untouched on rejection");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work-orchestrator: --show reports the current model and mutates nothing",
    run: async () => {
      const dir = await fixture({ name: "x", settings: { claude: { model: "fable" } } });
      try {
        const before = await readFile(path.join(dir, ".aof", "aof.config.json"), "utf8");
        const result = await showOrchestratorModel({ targetDir: dir, log: silent });
        assert.equal(result.model, "fable");
        const after = await readFile(path.join(dir, ".aof", "aof.config.json"), "utf8");
        assert.equal(after, before, "show does not rewrite the config");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work-orchestrator: the chosen model reaches .claude/settings.json as { model } — through the ADR-002 merge",
    run: async () => {
      // Prove the choice is FUNCTIONAL: the same field the surface writes is the
      // one runtime-config projects into settings.json.
      const config = {};
      setOrchestratorModel(config, "fable");
      const patch = claudeSettingsPatch({ settings: config.settings }, { targetDir: process.cwd() });
      assert.equal(patch.settings.model, "fable", "settings.claude.model is spliced into settings.json as `model`");
    }
  }
];
