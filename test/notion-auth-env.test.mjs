// Traceability wiring for milestone 17 / story 02, task 02 —
// tasks/02_auth-env-reference.feature (@executable rows; the @manual live `ntn api`
// row is deferred to verify).
//
// The Notion CLI spawn reads process.env[<tokenEnv>] at run time. With a token set
// (TOKEN mode) it passes the token (plus NOTION_KEYRING=0) through the spawned CLI's
// ENVIRONMENT, never the argv. With NO token (KEYCHAIN mode) it injects nothing and
// leaves the keyring enabled — ntn authenticates from its own `ntn login` session, so
// an absent env token is NOT unreachable (the env token is only an override). The
// spawn seam is injected (resolveBinary + spawn) so each row captures the constructed
// env + argv hermetically — no live binary, no live token.
import assert from "node:assert/strict";
import { makeNotionSpawn, resolveNotionAuth, buildSpawnEnv } from "../src/notion/cli.mjs";

const FIXTURE_TOKEN = "ntn_fixture_secret_value_123";

// An injected resolver that reports the `ntn` bin/ntn JS launcher present (the npx-lane
// reality) so the spawn proceeds hermetically without a live install. makeNotionSpawn
// runs it as `node <launcher> <argv>`.
const FAKE_LAUNCHER = () => "/usr/local/lib/node_modules/ntn/bin/ntn";

// A spawn spy that captures the (file, argv, options) it was called with and returns
// a benign success result.
function spawnSpy() {
  const calls = [];
  const fn = (file, argv, options) => {
    calls.push({ file, argv, options });
    return { status: 0, stdout: JSON.stringify({ id: "page-1" }), stderr: "" };
  };
  return { fn, calls };
}

// Build a spawn seam over a fixed config + env, returning { spawn, spy }.
function makeWith({ config = { tokenEnv: "NOTION_API_TOKEN" }, env }) {
  const spy = spawnSpy();
  const spawn = makeNotionSpawn({ config, env, resolveLauncher: FAKE_LAUNCHER, node: "/usr/bin/node", spawn: spy.fn });
  return { spawn, spy };
}

export const notionAuthEnvTests = [
  {
    // Scenario: the spawn env carries the token from the named env var plus the
    // keychain opt-out.
    name: "notion-auth/02 the spawn env carries the token from the named env var plus NOTION_KEYRING=0",
    async run() {
      const env = { NOTION_API_TOKEN: FIXTURE_TOKEN, PATH: "/usr/local/bin" };
      const { spawn, spy } = makeWith({ env });
      await spawn(["api", "pages", "create", "--title", "Demo"]);
      assert.equal(spy.calls.length, 1, "the CLI was spawned once");
      const captured = spy.calls[0].options.env;
      assert.equal(captured.NOTION_API_TOKEN, FIXTURE_TOKEN, "the spawn env's NOTION_API_TOKEN equals the fixture token");
      assert.equal(captured.NOTION_KEYRING, "0", "the spawn env sets NOTION_KEYRING to 0");
    },
  },

  {
    // Scenario: a custom tokenEnv name is the env var the spawn reads the token from.
    name: "notion-auth/02 a custom tokenEnv name is the env var the spawn reads the token from",
    async run() {
      const env = { MY_NOTION_TOKEN: FIXTURE_TOKEN, PATH: "/usr/local/bin" };
      const { spawn, spy } = makeWith({ config: { tokenEnv: "MY_NOTION_TOKEN" }, env });
      await spawn(["api", "pages", "create"]);
      const captured = spy.calls[0].options.env;
      assert.equal(captured.MY_NOTION_TOKEN, FIXTURE_TOKEN, "the spawn env's MY_NOTION_TOKEN equals the fixture token");
    },
  },

  {
    // Scenario: no token literal appears in the constructed spawn argv.
    name: "notion-auth/02 no token literal appears in the constructed spawn argv",
    async run() {
      const env = { NOTION_API_TOKEN: FIXTURE_TOKEN, PATH: "/usr/local/bin" };
      const { spawn, spy } = makeWith({ env });
      const argv = ["api", "pages", "create", "--title", "Demo", "--status-option", "Done"];
      await spawn(argv);
      const captured = spy.calls[0];
      // argv carries NO occurrence of the token.
      assert.ok(!captured.argv.some((a) => typeof a === "string" && a.includes(FIXTURE_TOKEN)), "the argv contains no occurrence of the fixture token");
      assert.ok(!captured.file.includes(FIXTURE_TOKEN), "the binary path contains no token");
      // The secret is present ONLY in the captured spawn env.
      assert.equal(captured.options.env.NOTION_API_TOKEN, FIXTURE_TOKEN, "the secret is present in the spawn env");
    },
  },

  {
    // Scenario Outline: the env token is an OPTIONAL OVERRIDE of ntn's keychain (per
    // ntn: NOTION_API_TOKEN "overrides keychain"). token set → TOKEN mode (inject token
    // + keyring off); token unset/empty → KEYCHAIN mode (ntn authenticates from its own
    // `ntn login` session — reachable, no token injected, keyring NOT disabled, spawn
    // PROCEEDS). An absent env token is NOT "unreachable".
    name: "notion-auth/02 the env token is an optional override; absent ⇒ keychain mode (ntn login), not unreachable",
    async run() {
      const config = { tokenEnv: "NOTION_API_TOKEN" };

      // Row: a fixture token → TOKEN mode, reachable, token injected + keyring off.
      const setAuth = resolveNotionAuth({ config, env: { NOTION_API_TOKEN: FIXTURE_TOKEN } });
      assert.equal(setAuth.reachable, true, "a set token is reachable");
      assert.equal(setAuth.mode, "token", "a set token is TOKEN mode");
      assert.equal(setAuth.token, FIXTURE_TOKEN, "the resolved token is the env value");
      const tokenEnv = buildSpawnEnv({ token: setAuth.token, tokenEnv: setAuth.tokenEnv, baseEnv: {} });
      assert.equal(tokenEnv.NOTION_API_TOKEN, FIXTURE_TOKEN, "token mode injects the token into the env");
      assert.equal(tokenEnv.NOTION_KEYRING, "0", "token mode forces the keyring off (use the injected token)");

      // Row: unset → KEYCHAIN mode, reachable, no token, keyring NOT disabled.
      const unsetAuth = resolveNotionAuth({ config, env: {} });
      assert.equal(unsetAuth.reachable, true, "an unset token is NOT unreachable — ntn uses its own keychain session");
      assert.equal(unsetAuth.mode, "keychain", "an unset token is KEYCHAIN mode");
      assert.equal(unsetAuth.token, null, "no token is fabricated");
      const keychainEnv = buildSpawnEnv({ token: unsetAuth.token, tokenEnv: unsetAuth.tokenEnv, baseEnv: { PATH: "/x" } });
      assert.ok(!("NOTION_API_TOKEN" in keychainEnv), "keychain mode injects NO token");
      assert.notEqual(keychainEnv.NOTION_KEYRING, "0", "keychain mode does NOT disable the OS keychain");

      // Row: set to empty → KEYCHAIN mode too (an empty string is not a token).
      const emptyAuth = resolveNotionAuth({ config, env: { NOTION_API_TOKEN: "" } });
      assert.equal(emptyAuth.reachable, true, "an empty token falls back to keychain mode (reachable)");
      assert.equal(emptyAuth.mode, "keychain", "an empty token is KEYCHAIN mode");

      // And: in keychain mode the spawn PROCEEDS (ntn authenticates from its own session)
      // — it is NOT blocked on an absent env token, and injects no token into the env.
      const spy = spawnSpy();
      const spawn = makeNotionSpawn({ config, env: {}, resolveLauncher: FAKE_LAUNCHER, node: "/usr/bin/node", spawn: spy.fn });
      await spawn(["api", "pages", "create"]);
      assert.equal(spy.calls.length, 1, "keychain mode reaches the spawn (not blocked on an absent env token)");
      assert.ok(!("NOTION_API_TOKEN" in spy.calls[0].options.env), "no token is injected into the keychain-mode spawn env");
    },
  },
];
