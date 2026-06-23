// The headroom plugin's enable/disable SURFACE — milestone 06 / story 01 / ADR-004.
//
// `useHeadroom` / `unuseHeadroom` are a config-only read-merge-write of the
// `work.headroom` block in `.aof/aof.config.json` (developer intent). They follow the
// established `packagesAddCommand`/`packagesRemoveCommand` idiom in cli.mjs:
//   readJson(configPath) → mutate ONLY work.headroom → writeText(2-space + trailing \n).
//
// Frozen contract (ADR-004 / ADR-001):
//   useHeadroom   : work.headroom = { enabled: true, mode: "wrap",
//                                     providers: <existing or default ["claude","codex"]> }
//   unuseHeadroom : work.headroom.enabled = false  (block KEPT; providers preserved;
//                   a never-had-a-block project gets an explicit { enabled: false })
//   BOTH          : write ONLY the work.headroom subtree of aof.config.json — every other
//                   root key and every work.* sibling survives byte-intact — and NEVER
//                   read or write .aof/aof.lock.json. (Enforced by acd-headroom-config-isolation.)
//
// `useHeadroom` PATH-checks headroom via the injectable `which` (the ADR-003 idiom):
// when headroom is ABSENT it STILL writes the config (intent honoured) AND prints a
// one-line install hint pointing at github.com/chopratejas/headroom; when PRESENT it
// writes the config and prints NO hint. It NEVER runs an installer (ADR-005). headroom
// is referenced ONLY as the PATH binary-name string "headroom" — never an aof import of
// the headroom PACKAGE. The relative import of ./headroom.mjs below is aof's OWN module.
//
// milestone-12 / ADR-004 RE-POINT: this advisory PATH-hint lookup now resolves the
// managed store copy first (via resolveHeadroomBinary), falling back to PATH — for
// consistency with headroom.mjs's runtime resolver and graphify (story 02). The
// config read-merge-write is UNCHANGED: useHeadroom writes the config BEFORE and
// INDEPENDENT of the lookup (the lookup only drives whether the install hint prints),
// so the acd-headroom-config-isolation guard stays green.
import { existsSync } from "node:fs";
import { readJson, writeText } from "./fs.mjs";
import { findProjectConfig } from "./workspace.mjs";
import { resolveHeadroomBinary } from "./headroom.mjs";

// The default providers a fresh enable fronts (ADR-001). Independent of `--runtime` —
// the resolver intersects with the routable set at runtime.
const DEFAULT_PROVIDERS = ["claude", "codex"];

// The headroom repo named in the install hint (ADR-004/005). aof never installs it.
const HEADROOM_REPO = "github.com/chopratejas/headroom";

// Default lookup for the "headroom" binary — RE-POINTED STORE-FIRST (ADR-004), the
// same store-first-then-PATH resolution headroom.mjs uses. It DELEGATES to
// resolveHeadroomBinary so a provisioned headroom is reported on the hint path too.
// Its (bin, env) => path|null CONTRACT is preserved (an absent headroom yields null →
// the install hint still prints); injected via the `which` param so tests can stub it.
// `_bin` is intentionally unused — this default lookup is headroom-specific; its sole
// caller (useHeadroom) always passes "headroom". The shape is kept for the `which` seam.
function defaultWhich(_bin, env = process.env) {
  const pathValue = env.PATH ?? env.Path ?? "";
  const resolved = resolveHeadroomBinary({ env, pathValue });
  return resolved.path ?? null;
}

// Read the current config (or {} on a fresh project) WITHOUT touching the lock. The
// config path is resolved with the established idiom (findProjectConfig → .aof/aof.config.json).
// Exported so `init --with-headroom` reuses the IDENTICAL read + path resolution
// (no second, divergent config-path idiom — work-init.mjs imports this).
export async function readConfig(targetDir) {
  const configPath = await findProjectConfig(targetDir);
  let config = {};
  if (existsSync(configPath)) {
    config = await readJson(configPath);
  }
  return { configPath, config };
}

// Write the config back in the project's 2-space + trailing-newline JSON style — the
// SAME write packagesAddCommand/packagesRemoveCommand use. Only ever names the config
// path; the lock is never resolved on this code path. Exported so init reuses it.
export async function writeConfig(configPath, config) {
  await writeText(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

// The shared core both useHeadroom and `init --with-headroom` reuse: set the enabled
// wrap block on a config object IN PLACE, deep-merging so every work.* sibling survives
// (we set ONLY config.work.headroom, never reassign config.work wholesale). Idempotent:
// re-running keeps it enabled with no duplicate keys, and preserves an existing block's
// `providers` choice. Returns the mutated config (same reference).
export function setHeadroomEnabled(config) {
  if (!config.work || typeof config.work !== "object") {
    config.work = {};
  }
  const existing = (config.work.headroom && typeof config.work.headroom === "object")
    ? config.work.headroom
    : {};
  const providers = Array.isArray(existing.providers) ? existing.providers : DEFAULT_PROVIDERS;
  config.work.headroom = { enabled: true, mode: "wrap", providers };
  return config;
}

// `aof work use-headroom` — enable the plugin (config-only). opts:
//   { targetDir, which?, log? }. `which` defaults to the real PATH probe; `log` to
//   console.log. PATH-checks headroom and prints a one-line install hint when absent —
//   but ALWAYS writes the config (intent is honoured) and NEVER installs.
export async function useHeadroom({ targetDir = process.cwd(), which, log = console.log, env = process.env } = {}) {
  const { configPath, config } = await readConfig(targetDir);
  setHeadroomEnabled(config);
  await writeConfig(configPath, config);

  // PATH check: hint when headroom is absent, never install (ADR-004/005). The lookup
  // is the injected `which`, defaulted lazily so callers/tests can stub present/absent.
  const lookup = which ?? defaultWhich;
  const headroomBin = lookup("headroom", env);
  const onPath = headroomBin !== null && headroomBin !== undefined;
  if (!onPath) {
    log(`headroom is not on PATH — the plugin config is written but inactive until you install it: ${HEADROOM_REPO}`);
  }

  return { configPath, config, headroomOnPath: onPath, hintPrinted: !onPath };
}

// `aof work unuse-headroom` — disable the plugin (config-only). Sets
// work.headroom.enabled = false while KEEPING the block (the developer's `providers`
// choice survives — deletion is rejected by ADR-004). On a project that never had a
// block, writes an explicit { enabled: false } (the honest, reversible off-state).
// Never touches the lock. opts: { targetDir, log? }.
export async function unuseHeadroom({ targetDir = process.cwd(), log = console.log } = {}) {
  const { configPath, config } = await readConfig(targetDir);
  if (!config.work || typeof config.work !== "object") {
    config.work = {};
  }
  if (config.work.headroom && typeof config.work.headroom === "object") {
    config.work.headroom.enabled = false;
  } else {
    config.work.headroom = { enabled: false };
  }
  await writeConfig(configPath, config);

  return { configPath, config };
}
