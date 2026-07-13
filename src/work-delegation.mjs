// The gpt-5.6 delegation toggle SURFACE — one on/off switch for whether the ACD
// agents lean on gpt-5.6 (via the Codex CLI) for bulk/mechanical work.
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

export const DELEGATION_STATES = ["off", "on"];
export const DEFAULT_DELEGATION = "off";

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

// `aof work delegation [on|off]` — flip the toggle (config-only; never the lock).
// opts: { targetDir, state, log? }. Returns { configPath, config, state, previous, changed }.
export async function setDelegationCommand({ targetDir = process.cwd(), state, log = console.log } = {}) {
  const resolved = resolveDelegation(state);
  if (!resolved) {
    throw new Error(`"${state ?? ""}" is not a valid delegation state. Use one of: ${DELEGATION_STATES.join(", ")}.`);
  }

  const { configPath, config } = await readConfig(targetDir);
  const previous = readDelegation(config);
  setDelegation(config, resolved);
  await writeConfig(configPath, config);

  if (resolved === "on") {
    log(`gpt-5.6 delegation is ON (work.agents.delegation = "on") in ${configPath}`);
    log("The codex-* skills become auto-invocable and the ACD agents may hand bulk/mechanical work to gpt-5.6-sol when the Codex CLI is available.");
  } else {
    log(`gpt-5.6 delegation is OFF (work.agents.delegation = "off") in ${configPath}`);
    log("Claude does everything itself — the codex-* skills won't auto-fire. Invoke `/codex-…` by hand for a one-off.");
  }

  return { configPath, config, state: resolved, previous, changed: previous !== resolved };
}

// `aof work delegation --show` — report the current state without mutating.
export async function showDelegation({ targetDir = process.cwd(), log = console.log } = {}) {
  const { configPath, config } = await readConfig(targetDir);
  const state = readDelegation(config);
  log(`gpt-5.6 delegation: ${state}${state === DEFAULT_DELEGATION ? " (default)" : ""}`);
  return { configPath, config, state };
}
