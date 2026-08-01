// The Codex delegation toggle SURFACE — one on/off switch for whether the ACD
// agents lean on the configured delegation model (via the Codex CLI) for
// bulk/mechanical work.
//
// The toggle records the operator's intent at `work.agents.delegation`
// ("off" | "on", default off ≡ Claude-only) AND drives what the render emits:
//   - OFF (default): the three bundled `codex-*` skills render WITH
//     `disable-model-invocation: true`, so Claude Code never auto-triggers them —
//     Claude does everything itself. (You can still invoke `/codex-…` by hand.)
//   - ON: that flag is DROPPED at render (applyDelegationToResources), so the
//     codex-* skills become auto-invocable and the ACD agents may hand
//     bulk/mechanical work to `gpt-5.6-sol` when the Codex CLI is available.
// Off is the default so a project with no gpt/Codex subscription behaves
// identically out of the box. The projection is applied by the init/update render
// path (synthesizeBundleConfig); flipping the toggle re-renders to take effect.
//
// Config-only read-merge-write of `.aof/aof.config.json`, following the
// `useHeadroom` idiom: readConfig → mutate ONLY work.agents.delegation →
// writeConfig (2-space + trailing newline). The lock is never touched, and every
// other work.agents.* sibling (models, mode, productOwner) survives byte-intact.
import { existsSync } from "node:fs";
import { readJson, writeText } from "./fs.mjs";
import { findProjectConfig } from "./workspace.mjs";

// A core never prints: it REPORTS through the collector its caller injects, and the
// face turns the collected lines into the one stdout document (m42 wave (d) leg d1,
// the confine-console.log item). This no-op is the default so an un-injected call is
// silent-by-contract rather than a second printer.
const NO_PRINT = () => {};


export const DELEGATION_STATES = ["off", "on"];
export const DEFAULT_DELEGATION = "off";

// The Codex delegation model id targeted by the codex-* skills and ACD agents when
// `work.agents.delegationModel` is absent. A moving variable — set the config field
// to a future Codex model and the render swaps it in; nothing here hardcodes it as
// the only valid value. This string is ALSO the literal the bundled codex-* skills
// and agents ship with, so the canonical (config-agnostic) render — the one the
// shipped manifest catalogues — is a real default install, not a placeholder. Keep
// the two in sync; `applyDelegationModelToResources` only rewrites when the config
// picks a DIFFERENT model (mirroring the off/on toggle: default ≡ no-op).
export const DEFAULT_DELEGATION_MODEL = "gpt-5.6-sol";

export async function readConfig(targetDir) {
  const configPath = await findProjectConfig(targetDir);
  let config = {};
  if (existsSync(configPath)) {
    config = await readJson(configPath);
  }
  return { configPath, config };
}

export async function writeConfig(configPath, config) {
  await writeText(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

// The delegation state recorded in a config object. Absent ≡ the default ("off").
export function readDelegation(config) {
  const value = config?.work?.agents?.delegation;
  return DELEGATION_STATES.includes(value) ? value : DEFAULT_DELEGATION;
}

// The delegation model recorded in a config object. Absent, non-string, or blank ≡
// the default ("gpt-5.6-sol"). Any other non-empty string is honoured verbatim so a
// future Codex model needs only a config edit.
export function readDelegationModel(config) {
  const value = config?.work?.agents?.delegationModel;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : DEFAULT_DELEGATION_MODEL;
}

// Normalize a requested state: accepts on/off (case-insensitive) and the common
// synonyms enable/disable/true/false/yes/no. Returns null when unrecognized.
export function resolveDelegation(requested) {
  if (typeof requested !== "string") return null;
  const value = requested.trim().toLowerCase();
  if (["on", "enable", "enabled", "true", "yes"].includes(value)) return "on";
  if (["off", "disable", "disabled", "false", "no"].includes(value)) return "off";
  return null;
}

// Apply the delegation state onto bundle resources BEFORE render (the config-aware
// projection init/update run). The opt-in codex-* skills ship with
// `disableModelInvocation: true` (the OFF/default state — Claude Code never
// auto-fires them). When delegation is ON we DROP that flag so the rendered skill
// is auto-invocable — i.e. the toggle actually turns the skills on and off. Pure;
// only skill resources that shipped opt-in are touched, and OFF is a no-op because
// the bundle already encodes it.
export function applyDelegationToResources(resources, delegation) {
  if (delegation !== "on") return resources;
  return resources.map((resource) => {
    if (resource.kind !== "skill" || resource.disableModelInvocation !== true) return resource;
    const { disableModelInvocation, ...rest } = resource;
    return rest;
  });
}

// Swap the configured delegation model into resource bodies BEFORE render, replacing
// the shipped default literal (DEFAULT_DELEGATION_MODEL) wherever it appears in the
// codex-* skills and the aof-developer / aof-researcher agents (their `-m <model>`
// recipes and prose). Mirrors applyDelegationToResources: the DEFAULT model is a
// NO-OP — the bundle already encodes it, so the canonical render (and the shipped
// manifest) stays a real default install; only a DIFFERENT configured model rewrites.
// Runs regardless of the on/off toggle, since the skills are still invocable by hand
// when delegation is off. Pure; only resources whose body contains the default
// literal are rewritten.
export function applyDelegationModelToResources(resources, model) {
  const resolved = typeof model === "string" && model.trim() !== "" ? model.trim() : DEFAULT_DELEGATION_MODEL;
  if (resolved === DEFAULT_DELEGATION_MODEL) return resources;
  return resources.map((resource) => {
    if (typeof resource.body !== "string" || !resource.body.includes(DEFAULT_DELEGATION_MODEL)) return resource;
    return { ...resource, body: resource.body.split(DEFAULT_DELEGATION_MODEL).join(resolved) };
  });
}

// Set work.agents.delegation IN PLACE, deep-merging so every work.agents.* sibling
// (models, mode, productOwner) survives. Returns the mutated config.
export function setDelegation(config, state) {
  if (!config.work || typeof config.work !== "object" || Array.isArray(config.work)) {
    config.work = {};
  }
  if (!config.work.agents || typeof config.work.agents !== "object" || Array.isArray(config.work.agents)) {
    config.work.agents = {};
  }
  config.work.agents.delegation = state;
  return config;
}

// Set work.agents.delegationModel IN PLACE, deep-merging so every work.agents.*
// sibling (delegation, models, mode, productOwner) survives. Returns the mutated
// config. Trims the id; callers validate non-emptiness before reaching here.
export function setDelegationModel(config, model) {
  if (!config.work || typeof config.work !== "object" || Array.isArray(config.work)) {
    config.work = {};
  }
  if (!config.work.agents || typeof config.work.agents !== "object" || Array.isArray(config.work.agents)) {
    config.work.agents = {};
  }
  config.work.agents.delegationModel = model.trim();
  return config;
}

// `aof work delegation [on|off]` — flip the toggle (config-only; never the lock).
// opts: { targetDir, state, log? }. Returns { configPath, config, state, previous, changed }.
export async function setDelegationCommand({ targetDir = process.cwd(), state, log = NO_PRINT } = {}) {
  const resolved = resolveDelegation(state);
  if (!resolved) {
    throw new Error(`"${state ?? ""}" is not a valid delegation state. Use one of: ${DELEGATION_STATES.join(", ")}.`);
  }

  const { configPath, config } = await readConfig(targetDir);
  const previous = readDelegation(config);
  setDelegation(config, resolved);
  await writeConfig(configPath, config);

  if (resolved === "on") {
    const model = readDelegationModel(config);
    log(`Codex delegation is ON (work.agents.delegation = "on") in ${configPath}`);
    log(`The codex-* skills become auto-invocable and the ACD agents may hand bulk/mechanical work to ${model} when the Codex CLI is available.`);
  } else {
    log(`Codex delegation is OFF (work.agents.delegation = "off") in ${configPath}`);
    log("Claude does everything itself — the codex-* skills won't auto-fire. Invoke `/codex-…` by hand for a one-off.");
  }

  return { configPath, config, state: resolved, previous, changed: previous !== resolved };
}

// `aof work delegation-model <id>` — set the Codex delegation model (config-only;
// never the lock). opts: { targetDir, model, log? }. Returns
// { configPath, config, model, previous, changed }.
export async function setDelegationModelCommand({ targetDir = process.cwd(), model, log = NO_PRINT } = {}) {
  if (typeof model !== "string" || model.trim() === "") {
    throw new Error(`"${model ?? ""}" is not a valid delegation model. Pass a non-empty model id, e.g. gpt-5.6-sol.`);
  }
  const resolved = model.trim();

  const { configPath, config } = await readConfig(targetDir);
  const previous = readDelegationModel(config);
  setDelegationModel(config, resolved);
  await writeConfig(configPath, config);

  log(`Codex delegation model is ${resolved} (work.agents.delegationModel = "${resolved}") in ${configPath}`);
  log(`The codex-* skills and ACD agents will target ${resolved} via the Codex CLI when delegation is on and Codex is available.`);

  return { configPath, config, model: resolved, previous, changed: previous !== resolved };
}

// `aof work delegation --show` — report the current state (and model) without mutating.
export async function showDelegation({ targetDir = process.cwd(), log = NO_PRINT } = {}) {
  const { configPath, config } = await readConfig(targetDir);
  const state = readDelegation(config);
  const model = readDelegationModel(config);
  const modelIsDefault = readRawDelegationModel(config) === undefined;
  log(`Codex delegation: ${state}${state === DEFAULT_DELEGATION ? " (default)" : ""}`);
  log(`Codex delegation model: ${model}${modelIsDefault ? " (default)" : ""}`);
  return { configPath, config, state, model };
}

// Whether the config carries an explicit delegationModel (vs falling back to the
// default). Kept private — used only to annotate `--show`.
function readRawDelegationModel(config) {
  const value = config?.work?.agents?.delegationModel;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
