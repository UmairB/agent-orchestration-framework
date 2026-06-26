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
import { resolveManagedBinary, descriptorFor } from "../tool-store.mjs";

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
  if (token.length === 0) {
    return {
      reachable: false,
      token: null,
      tokenEnv,
      reason: `Notion auth is configured but the ${tokenEnv} environment variable is unset or empty — export it to reach Notion.`,
    };
  }
  return { reachable: true, token, tokenEnv };
}

// buildSpawnEnv({ token, tokenEnv, baseEnv }) → the environment the spawned CLI
// runs under. It carries the token under its NAMED env var plus NOTION_KEYRING=0
// (the head-less opt-out). The secret lives ONLY here — never in the argv.
export function buildSpawnEnv({ token, tokenEnv = DEFAULT_TOKEN_ENV, baseEnv = process.env } = {}) {
  return {
    ...baseEnv,
    [tokenEnv]: token,
    NOTION_KEYRING: NOTION_KEYRING_OFF,
  };
}

// The Notion CLI binary name (the NOTION_DESCRIPTOR's sole binary). Resolved via
// the m12 store-then-PATH resolver — for an npx-lane tool that means the PATH
// fallback (it is never in the version-keyed store; 12/ADR-002, 17/ADR-004).
function notionBinary() {
  const descriptor = descriptorFor("notion");
  return { name: descriptor.name, version: descriptor.version, binary: descriptor.binaries[0] };
}

// makeNotionSpawn({ config, env, resolveBinary, spawn }) → the spawn SEAM the apply
// layer (src/notion/sync.mjs) calls as `notionSpawn(argv)`. It:
//   1. resolves auth honestly — an unreachable token throws a STRUCTURED error
//      (code "notion-unreachable") BEFORE any spawn, so no page is half-written;
//   2. resolves the `ntn` binary via the m12 resolver (store-then-PATH); an absent
//      binary is a STRUCTURED error (code "notion-cli-absent"), never a silent pass;
//   3. spawns `<ntn> <...argv>` with the token in the ENVIRONMENT (NOTION_KEYRING=0),
//      NEVER in the argv;
//   4. returns the parsed stdout JSON (the created/updated page) to the apply layer.
// The token is NEVER appended to argv — only the operation argv the apply layer
// constructed is passed through.
export function makeNotionSpawn({
  config = {},
  env = process.env,
  resolveBinary = resolveManagedBinary,
  spawn = spawnSync,
} = {}) {
  return async function notionSpawn(argv) {
    // 1. AUTH — honest, before any spawn. An unreachable token never half-writes.
    const auth = resolveNotionAuth({ config, env });
    if (!auth.reachable) {
      const error = new Error(auth.reason);
      error.code = "notion-unreachable";
      error.status = 502;
      throw error;
    }

    // 2. BINARY — the m12 store-then-PATH resolver (npx-lane ⇒ the PATH leg).
    const { name, version, binary } = notionBinary();
    const cli = resolveBinary({ name, version, binary, env });
    if (!cli || !cli.found) {
      const error = new Error(
        cli?.hint ?? `The Notion CLI (${binary}) is not installed. Run \`aof project provision notion\`.`
      );
      error.code = "notion-cli-absent";
      error.status = 502;
      throw error;
    }

    // 3. SPAWN — the token lives in the env (+ NOTION_KEYRING=0), NEVER in the argv.
    const spawnEnv = buildSpawnEnv({ token: auth.token, tokenEnv: auth.tokenEnv, baseEnv: env });
    const ntnPath = cli.path;
    const result = spawn(ntnPath, argv, { env: spawnEnv, encoding: "utf8" });

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
