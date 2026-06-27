// src/notion/cli.mjs — the REAL Notion CLI spawn + auth resolution (17/ADR-004,
// story 02). This is the apply layer's egress: the provisioned `ntn` binary
// (the npx-lane NOTION_DESCRIPTOR), reached through the m12 store-then-PATH
// resolver, with the operator's token supplied ONLY through the spawn ENVIRONMENT.
//
// AUTH IS AN ENV-VAR REFERENCE (ADR-004 / RESEARCH §A2): the config carries
// `tokenEnv` — the env-var NAME (default "NOTION_API_TOKEN"), NEVER the secret.
// At run time the token is read from `env[<tokenEnv>]` and passed through the
// spawned CLI's ENVIRONMENT, alongside NOTION_KEYRING=0 to keep `ntn` head-less
// (off the OS keychain). The token is NEVER placed in the argv — the secret
// travels by environment only.
//
// FAIL HONESTLY (ADR-004 / STATE §Opt-in no-op): an absent/empty token is a
// STRUCTURED configured-but-unreachable failure — no page is written, no silent
// success. resolveNotionAuth computes that verdict BEFORE any spawn.
//
// SEAMS: every external dependency is injectable so the @executable rows run
// hermetically (no live binary, no live token) — `env`, `resolveBinary` (the m12
// resolver), and `spawn` (the child-process spawn). The live `ntn api` round-trip
// is the @manual row (no token on the dev host).
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { existsSync, readdirSync } from "node:fs";
import { descriptorFor } from "../tool-store.mjs";

// The default env-var NAME the token is read from when the config omits `tokenEnv`
// (RESEARCH §A2 — Notion's own NOTION_API_TOKEN convention). The config's
// `tokenEnv` default in the schema matches this.
export const DEFAULT_TOKEN_ENV = "NOTION_API_TOKEN";

// The head-less keychain opt-out passed into the spawned CLI's environment so
// `ntn` never reaches for the OS keychain (RESEARCH §A2). A constant so the
// spawn-env builder and the tests share one source of truth.
export const NOTION_KEYRING_OFF = "0";

// resolveNotionAuth({ config, env }) → a STRUCTURED auth verdict, computed with
// ZERO Notion calls (ADR-004). Reads the secret from the named env var:
//   { reachable:true,  token, tokenEnv }                       // token present
//   { reachable:false, token:null, tokenEnv, reason }          // unset / empty
// An absent/empty token is an HONEST configured-but-unreachable verdict — never a
// throw, never a silent pass. The CALLER (the spawn / the doctor advisory) decides
// what to do with an unreachable verdict; this function only reports it honestly.
export function resolveNotionAuth({ config = {}, env = process.env } = {}) {
  const tokenEnv = typeof config.tokenEnv === "string" && config.tokenEnv.length > 0
    ? config.tokenEnv
    : DEFAULT_TOKEN_ENV;
  const raw = env?.[tokenEnv];
  const token = typeof raw === "string" ? raw : "";
  if (token.length > 0) {
    // TOKEN mode: an explicit env token OVERRIDES ntn's keychain (per ntn's own docs,
    // NOTION_API_TOKEN "overrides keychain"). The headless / CI lane.
    return { reachable: true, token, tokenEnv, mode: "token" };
  }
  // KEYCHAIN mode: no env token → ntn authenticates from its OWN session (`ntn login`
  // → OS keychain). The env var is ONLY an override, so its ABSENCE is NOT
  // "unreachable" — a browser-logged-in ntn reaches Notion with no env token at all.
  // Reachability is the keychain session's to prove (the spawn / `ntn whoami`), never
  // the env var's presence. We inject NO token and do NOT disable the keyring.
  return { reachable: true, token: null, tokenEnv, mode: "keychain" };
}

// buildSpawnEnv({ token, tokenEnv, baseEnv }) → the environment the spawned CLI
// runs under. TWO modes (mirrors resolveNotionAuth):
//   - TOKEN mode (a non-empty token): carry the token under its NAMED env var + force
//     NOTION_KEYRING=0 so ntn uses the injected token, never the OS keychain. The
//     secret lives ONLY here — never in the argv.
//   - KEYCHAIN mode (no token): inject NOTHING and DO NOT disable the keyring — ntn
//     authenticates from its own `ntn login` session (the OS keychain). Pass the base
//     env through unchanged.
export function buildSpawnEnv({ token, tokenEnv = DEFAULT_TOKEN_ENV, baseEnv = process.env } = {}) {
  if (typeof token === "string" && token.length > 0) {
    return {
      ...baseEnv,
      [tokenEnv]: token,
      NOTION_KEYRING: NOTION_KEYRING_OFF,
    };
  }
  return { ...baseEnv };
}

// The Notion CLI descriptor identity (package name + pinned version), for hints.
function notionBinary() {
  const descriptor = descriptorFor("notion");
  return { name: descriptor.name, version: descriptor.version, binary: descriptor.binaries[0] };
}

// Resolve the `ntn` package's `bin/ntn` JS LAUNCHER (NOT the PATH `.cmd`/`.ps1` shim).
// `ntn` is distributed as a Node launcher that selects the platform-native `.exe`
// (`dist/ntn-<platform>-<arch>/ntn.exe`); the npm-created PATH shim is a `.cmd`/`.ps1`
// that cannot be spawned directly on Windows without a shell — and a shell mangles the
// JSON `-d` body. So we run the launcher with `node` (always spawnable, no shell, JSON
// intact). Searches: every PATH dir's `node_modules/ntn/bin/ntn` (the global-install
// layout) + the npx cache (`<npm-cache>/_npx/*/node_modules/ntn/bin/ntn`). Returns the
// launcher path or null. (12-style store→PATH resolution, corrected for the npx lane.)
export function resolveNtnLauncher(env = process.env) {
  const candidates = [];
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir, "node_modules", "ntn", "bin", "ntn"));
  }
  // The npx cache lane: <npm-cache>/_npx/<hash>/node_modules/ntn/bin/ntn.
  const npmCache = env.npm_config_cache || path.join(env.LOCALAPPDATA || os.homedir(), "npm-cache");
  const npxRoot = path.join(npmCache, "_npx");
  try {
    for (const hash of readdirSync(npxRoot)) {
      candidates.push(path.join(npxRoot, hash, "node_modules", "ntn", "bin", "ntn"));
    }
  } catch {
    // No npx cache — fine, the PATH lane may still resolve.
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// makeNotionSpawn({ config, env, resolveLauncher, node, spawn }) → the spawn SEAM the
// apply layer (src/notion/sync.mjs) calls as `notionSpawn(argv)`. It:
//   1. resolves auth honestly — keychain mode (ntn login) reaches Notion with no env
//      token; an explicit-but-unreachable token throws a STRUCTURED error before any spawn;
//   2. resolves the `ntn` bin/ntn JS launcher; an absent install is a STRUCTURED error
//      (code "notion-cli-absent"), never a silent pass;
//   3. spawns `node <bin/ntn> <...argv>` with the token (TOKEN mode) or nothing
//      (KEYCHAIN mode) in the ENVIRONMENT, NEVER in the argv;
//   4. returns the parsed stdout JSON (the created/updated page) to the apply layer.
export function makeNotionSpawn({
  config = {},
  env = process.env,
  resolveLauncher = resolveNtnLauncher,
  node = process.execPath,
  spawn = spawnSync,
} = {}) {
  return async function notionSpawn(argv) {
    // 1. AUTH — honest, before any spawn. An unreachable explicit token never half-writes.
    const auth = resolveNotionAuth({ config, env });
    if (!auth.reachable) {
      const error = new Error(auth.reason);
      error.code = "notion-unreachable";
      error.status = 502;
      throw error;
    }

    // 2. BINARY — the ntn bin/ntn JS launcher (run via node; the npx-lane reality).
    const { version } = notionBinary();
    const launcher = resolveLauncher(env);
    if (!launcher) {
      const error = new Error(
        `The Notion CLI (ntn) is not installed. Install it with \`npm i -g ntn@${version}\` (or run \`npx ntn login\` once), then re-run.`
      );
      error.code = "notion-cli-absent";
      error.status = 502;
      throw error;
    }

    // 3. SPAWN — `node <bin/ntn> <...argv>`. The token (TOKEN mode) lives in the env
    // (+ NOTION_KEYRING=0), NEVER in the argv; KEYCHAIN mode injects nothing.
    const spawnEnv = buildSpawnEnv({ token: auth.token, tokenEnv: auth.tokenEnv, baseEnv: env });
    const result = spawn(node, [launcher, ...argv], { env: spawnEnv, encoding: "utf8" });

    if (!result || result.status !== 0) {
      const error = new Error(
        `The Notion CLI exited ${result?.status ?? "(no status)"}: ${result?.stderr ?? ""}`.trim()
      );
      error.code = "notion-cli-failed";
      error.status = 502;
      throw error;
    }

    // 4. RESULT — parse the CLI's stdout JSON (the created/updated page). A
    // non-JSON / empty stdout degrades to null (the apply layer's pageIdFromSpawn
    // handles a null result honestly).
    return parseStdout(result.stdout);
  };
}

// Parse the CLI's stdout into the page object the apply layer reads (pageIdFromSpawn).
// Non-JSON / empty stdout → null (never throws).
function parseStdout(stdout) {
  if (typeof stdout !== "string" || stdout.trim().length === 0) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
