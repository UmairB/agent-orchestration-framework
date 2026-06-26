// Traceability wiring for milestone 17 / story 02, task 02 —
// tasks/02_auth-env-reference.feature (@executable rows; the @manual live `ntn api`
// row is deferred to verify).
//
// The Notion CLI spawn reads process.env[<tokenEnv>] at run time and passes the
// token (plus NOTION_KEYRING=0) through the spawned CLI's ENVIRONMENT, never the
// argv; an absent/empty token is an honest configured-but-unreachable failure. The
// spawn seam is injected (resolveBinary + spawn) so each row captures the constructed
// env + argv hermetically — no live binary, no live token.
import assert from "node:assert/strict";
import { makeNotionSpawn, resolveNotionAuth, buildSpawnEnv } from "../src/notion/cli.mjs";

const FIXTURE_TOKEN = "ntn_fixture_secret_value_123";

// An injected resolver that reports the `ntn` binary present on PATH (the npx-lane
// reality) so the spawn proceeds without a live install.
const RESOLVE_PRESENT = () => ({ found: true, source: "path", binary: "ntn", path: "/usr/local/bin/ntn", version: "0.17.0" });

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
  const spawn = makeNotionSpawn({ config, env, resolveBinary: RESOLVE_PRESENT, spawn: spy.fn });
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
    // Scenario Outline: an absent or empty token fails honestly, never half-writes or
    // silently succeeds. (token set → reachable/proceeds; unset/empty → honest fail.)
    name: "notion-auth/02 an absent or empty token fails honestly (matrix)",
    async run() {
      const config = { tokenEnv: "NOTION_API_TOKEN" };

      // Row: a fixture token → reachable, proceeds to the spawn with the token in env.
      const setAuth = resolveNotionAuth({ config, env: { NOTION_API_TOKEN: FIXTURE_TOKEN } });
      assert.equal(setAuth.reachable, true, "a set token is reachable");
      assert.equal(setAuth.token, FIXTURE_TOKEN, "the resolved token is the env value");
      const proceedEnv = buildSpawnEnv({ token: setAuth.token, tokenEnv: setAuth.tokenEnv, baseEnv: {} });
      assert.equal(proceedEnv.NOTION_API_TOKEN, FIXTURE_TOKEN, "proceeds with the token in the env");

      // Row: unset → unreachable, a structured honest failure, no page written.
      const unsetAuth = resolveNotionAuth({ config, env: {} });
      assert.equal(unsetAuth.reachable, false, "an unset token is unreachable");
      assert.equal(unsetAuth.token, null, "no token is fabricated");
      assert.ok(/unset or empty/i.test(unsetAuth.reason), "the unreachable verdict is structured (carries a reason)");

      // Row: set to empty → unreachable, a structured honest failure.
      const emptyAuth = resolveNotionAuth({ config, env: { NOTION_API_TOKEN: "" } });
      assert.equal(emptyAuth.reachable, false, "an empty token is unreachable");
      assert.equal(emptyAuth.token, null, "no token is fabricated for an empty value");

      // And: an unreachable token never reaches the spawn — the spawn throws a
      // STRUCTURED error BEFORE any page write (no silent success).
      const spy = spawnSpy();
      const spawn = makeNotionSpawn({ config, env: {}, resolveBinary: RESOLVE_PRESENT, spawn: spy.fn });
      await assert.rejects(
        () => spawn(["api", "pages", "create"]),
        (e) => e.code === "notion-unreachable",
        "an absent token throws a structured notion-unreachable error"
      );
      assert.equal(spy.calls.length, 0, "no page was written (the spawn was never invoked) — never half-writes");
    },
  },
];
