// work:orchestrator / work:delegation / work:delegation-model — the project's
// two model decisions as registered Commands (m42 wave (d) leg d1; formerly
// cli.mjs's CLI-only workOrchestratorCommand / workDelegationCommand /
// workDelegationModelCommand, the last prompting/printing faces on
// parseOptions). One module: the three verbs are one config surface (the
// aof:delegate skill drives them together).
//
// The migration's two moves, per the wave-d ritual:
//   - PROMPTS move face-ward into the async cli.argv adapters (the assets:add
//     precedent): the orchestrator-model picker fires pre-invoke, so run()
//     stays headless for every other face. A bad `--model` is now refused in
//     argv BEFORE any write (the input-contract-precedes-write policy the
//     spine pins) — previously the toggle flipped first and the model error
//     followed.
//   - PRINTS move into renders via the collector idiom (the headroom
//     precedent): the cores' injectable `log` collects `notes`, the render
//     reproduces the retired transcript in order, and the NEW --json face is
//     one structured document (these verbs previously ignored --json).
import path from "node:path";
import {
  ORCHESTRATOR_IDS,
  promptOrchestratorModel,
  resolveOrchestratorModel,
  selectOrchestratorModel,
  showOrchestratorModel,
} from "../work-orchestrator.mjs";
import {
  setDelegationCommand,
  setDelegationModelCommand,
  showDelegation,
} from "../work-delegation.mjs";
import { updateWork } from "../work-update.mjs";
import { commandError } from "../command-error.mjs";

// The retired faces' shared targetDir resolution: --dir/--target win, else the
// SECOND positional (the first is the model/state), else cwd.
function targetDirFrom(positionals, options) {
  return path.resolve(options.dir ?? options.target ?? (positionals.length > 1 ? positionals[1] : process.cwd()));
}

const DIR_FLAGS = Object.freeze({
  dir: { type: "string", description: "project directory (default: cwd)" },
  target: { type: "string", description: "project directory (alias of --dir)" },
});

// Resolve an explicit --model / positional to a canonical choice id, refusing
// in the FACE (before any write) with the core's exact message.
function resolveModelOrRefuse(model) {
  const resolved = resolveOrchestratorModel(model);
  if (!resolved) {
    throw commandError(
      `"${model}" is not a supported orchestrator model. Choose one of: ${ORCHESTRATOR_IDS.join(", ")} (Fable 5 or Opus 4.8).`,
      "invalid-input",
      400,
    );
  }
  return resolved;
}

// The re-render both delegation verbs owe after a config write: force-update so
// the installed codex-* skills track the config (toggle → disable-model-invocation,
// model → the baked {{delegationModel}} recipes). Returns the note line the
// retired faces printed; a not-yet-initialised project is a plain outcome.
async function reRenderNote(targetDir, notInitializedLine, renderedLine, notes) {
  const update = await updateWork({ targetDir, force: true });
  notes.push(update.notInitialized ? notInitializedLine : renderedLine);
  return Boolean(update.notInitialized);
}

export const workOrchestratorCommand = {
  id: "work:orchestrator",
  input: {
    type: "object",
    properties: {
      targetDir: { type: "string" },
      show: { type: "boolean" },
      model: { type: "string" },
    },
    required: ["targetDir"],
    additionalProperties: false,
  },

  async run(input) {
    const notes = [];
    const log = (line) => notes.push(line);
    if (input.show) {
      const result = await showOrchestratorModel({ targetDir: input.targetDir, log });
      return { mode: "show", model: result.model, configPath: result.configPath, notes };
    }
    const result = await selectOrchestratorModel({ targetDir: input.targetDir, model: input.model, log });
    return { mode: "set", model: result.model, previous: result.previous, changed: result.changed, configPath: result.configPath, notes };
  },

  cli: {
    route: ["work", "orchestrator"],
    spec: {
      usage: "aof work orchestrator [fable|opus] [dir] [--model fable|opus] [--show] [--json]",
      workspace: false,
      flags: {
        ...DIR_FLAGS,
        model: { type: "string", description: "the orchestrator model (fable | opus); skips the prompt" },
        show: { type: "boolean", description: "report the current model without mutating" },
      },
    },

    // ASYNC by design: a missing model completes interactively (the
    // AOF_ORCHESTRATOR_INPUT seam or the TTY picker), never inside run().
    async argv(positionals, options) {
      const targetDir = targetDirFrom(positionals, options);
      if (options.show) return { targetDir, show: true };
      const model = options.model ?? positionals[0];
      if (model !== undefined) return { targetDir, model: resolveModelOrRefuse(model) };
      return { targetDir, model: await promptOrchestratorModel() };
    },

    render: (result) => result.notes.join("\n"),

    json({ notes, ...rest }) {
      return rest;
    },
  },
};

export const workDelegationCommand = {
  id: "work:delegation",
  input: {
    type: "object",
    properties: {
      targetDir: { type: "string" },
      show: { type: "boolean" },
      state: { type: "string" },
      gptModel: { type: "string" },
      // The orchestrator-model follow-up the toggle owes (resolved by the argv
      // adapter): set = write the resolved model; skip = --no-model; hint =
      // non-interactive with no --model — print the pointer line only.
      orchestrator: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["set", "skip", "hint"] },
          model: { type: "string" },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    required: ["targetDir"],
    additionalProperties: false,
  },

  async run(input) {
    const notes = [];
    const log = (line) => notes.push(line);
    if (input.show) {
      const result = await showDelegation({ targetDir: input.targetDir, log });
      return { mode: "show", state: result.state, model: result.model, configPath: result.configPath, notes };
    }

    // The retired sequence, verbatim: flip the toggle first, then apply any
    // Codex-model change, then re-render ONCE, then the orchestrator follow-up.
    let toggle = null;
    let modelSet = null;
    if (input.state !== undefined) {
      toggle = await setDelegationCommand({ targetDir: input.targetDir, state: input.state, log });
    }
    if (input.gptModel !== undefined) {
      modelSet = await setDelegationModelCommand({ targetDir: input.targetDir, model: input.gptModel, log });
    }
    const notInitialized = await reRenderNote(
      input.targetDir,
      "Config written. This project isn't ACD-initialised yet — run `aof work init` and it will be applied.",
      "Re-rendered the codex-* skills to match the config. Reload your Claude Code session so it picks up the change.",
      notes,
    );

    const outcome = {
      mode: "set",
      configPath: toggle?.configPath ?? modelSet?.configPath,
      notInitialized,
      ...(toggle ? { state: toggle.state, previous: toggle.previous, changed: toggle.changed } : {}),
      ...(modelSet ? { delegationModel: modelSet.model } : {}),
      notes,
    };

    // A model-only invocation (--gpt-model with no on/off) never touches the
    // orchestrator model — the argv adapter passes no follow-up.
    if (!input.orchestrator) return outcome;

    if (input.orchestrator.action === "skip") {
      notes.push("Orchestrator model left unchanged. Set it anytime with `aof work orchestrator fable|opus`.");
      return outcome;
    }
    if (input.orchestrator.action === "hint") {
      notes.push("Orchestrator model left unchanged. Choose one with `aof work orchestrator fable|opus`, or re-run with `--model fable|opus`.");
      return outcome;
    }
    const orchestrator = await selectOrchestratorModel({ targetDir: input.targetDir, model: input.orchestrator.model, log });
    return { ...outcome, orchestratorModel: orchestrator.model };
  },

  cli: {
    route: ["work", "delegation"],
    spec: {
      usage: "aof work delegation [on|off] [dir] [--model fable|opus] [--gpt-model <id>] [--no-model] [--show] [--json]",
      workspace: false,
      flags: {
        ...DIR_FLAGS,
        model: { type: "string", description: "the orchestrator model to set after the toggle (fable | opus)" },
        gptModel: { type: "string", description: "the Codex delegation model id (sets it without touching the toggle when given alone)" },
        noModel: { type: "boolean", description: "skip the orchestrator-model follow-up" },
        show: { type: "boolean", description: "report the current state and model without mutating" },
      },
    },

    // ASYNC by design: after a toggle, the orchestrator-model choice completes
    // interactively here (pre-invoke) when no --model was given and a prompt is
    // possible — the retired face prompted post-write; the argv adapter keeps
    // the whole input resolved before anything is written.
    async argv(positionals, options) {
      const targetDir = targetDirFrom(positionals, options);
      const gptModel = options.gptModel;
      if (options.show || (positionals.length === 0 && gptModel === undefined)) {
        return { targetDir, show: true };
      }
      const state = positionals[0];
      const input = {
        targetDir,
        ...(state !== undefined ? { state } : {}),
        ...(gptModel !== undefined ? { gptModel } : {}),
      };
      if (state === undefined) return input;
      if (options.noModel) return { ...input, orchestrator: { action: "skip" } };
      if (options.model !== undefined) {
        return { ...input, orchestrator: { action: "set", model: resolveModelOrRefuse(options.model) } };
      }
      const canPrompt = process.stdin.isTTY || process.env.AOF_ORCHESTRATOR_INPUT !== undefined;
      if (canPrompt) return { ...input, orchestrator: { action: "set", model: await promptOrchestratorModel() } };
      return { ...input, orchestrator: { action: "hint" } };
    },

    render: (result) => result.notes.join("\n"),

    json({ notes, ...rest }) {
      return rest;
    },
  },
};

export const workDelegationModelCommand = {
  id: "work:delegation-model",
  input: {
    type: "object",
    properties: {
      targetDir: { type: "string" },
      show: { type: "boolean" },
      model: { type: "string" },
    },
    required: ["targetDir"],
    additionalProperties: false,
  },

  async run(input) {
    const notes = [];
    const log = (line) => notes.push(line);
    if (input.show) {
      const result = await showDelegation({ targetDir: input.targetDir, log });
      return { mode: "show", state: result.state, model: result.model, configPath: result.configPath, notes };
    }
    const result = await setDelegationModelCommand({ targetDir: input.targetDir, model: input.model, log });
    const notInitialized = await reRenderNote(
      input.targetDir,
      "Config written. This project isn't ACD-initialised yet — run `aof work init` and the model will be applied.",
      "Re-rendered the codex-* skills to target the new model. Reload your Claude Code session so it picks up the change.",
      notes,
    );
    return { mode: "set", model: result.model, previous: result.previous, changed: result.changed, notInitialized, configPath: result.configPath, notes };
  },

  cli: {
    route: ["work", "delegation-model"],
    spec: {
      usage: "aof work delegation-model [<id>] [dir] [--show] [--json]",
      workspace: false,
      flags: {
        ...DIR_FLAGS,
        show: { type: "boolean", description: "report the current model without mutating" },
      },
    },

    argv: (positionals, options) => {
      const targetDir = targetDirFrom(positionals, options);
      if (options.show || positionals.length === 0) return { targetDir, show: true };
      return { targetDir, model: positionals[0] };
    },

    render: (result) => result.notes.join("\n"),

    json({ notes, ...rest }) {
      return rest;
    },
  },
};
