// Traceability wiring for milestone 36 / story 03, task
// 00_verb-dispatch.feature — `aof mesh desktop install` / `aof mesh desktop run`
// dispatch. REWORKED with m42 wave (d) leg d1's wave-3 tail: the verbs are the
// registered mesh:desktop-install / mesh:desktop-run commands riding THREE-WORD
// routes through the registry-derived route table + the ONE generic face; only
// the no-verb/unknown-verb SHIM remains in meshCommand (the repo-shim
// precedent). Documented contract change carried by the migration: an unknown
// flag is now the face's loud `Unknown flag "--x" for mesh:<verb>` refusal
// (code `unknown-flag`), replacing the retired nested face's
// `Unknown option "--x".` / `invalid-input`.
//
// Spawns the REAL CLI via spawnCliSync (the mesh-face-skeleton / mesh-bijection
// precedent). Dispatch + arg-parse only — no fixture install dir is needed for
// this task (pure routing/arg-parse assertions; a bare `aof mesh desktop install`
// with no artifacts configured degrades to a coded refusal, which is itself part
// of what these scenarios assert under the single --json envelope discipline).
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCommands } from "../src/command-core.mjs";
import { spawnCliSync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

function runCli(args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const meshDesktopDispatchTests = [
  // Scenario Outline: `aof mesh desktop <verb>` dispatches through its
  // registered three-word route (Examples: install, run).
  {
    name: "mesh-desktop-dispatch/00 `aof mesh desktop install` and `aof mesh desktop run` dispatch through their registered three-word routes (never the shim's unknown-verb envelope)",
    async run() {
      const registryMeshIds = new Set(listCommands().filter((c) => c.id.startsWith("mesh:")).map((c) => c.id));
      for (const verb of ["install", "run"]) {
        assert.ok(registryMeshIds.has(`mesh:desktop-${verb}`), `mesh:desktop-${verb} IS a registered command id (the three-word route)`);
        const result = runCli(["mesh", "desktop", verb, "--json"]);
        // It reaches the routed command (never the shim's unknown-verb envelope
        // a route-miss would produce) — it may still refuse (no artifacts
        // configured / nothing installed), but that refusal is the DESKTOP
        // core's own coded refusal, not a routing miss.
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `[${verb}] stdout is a single parseable JSON document (got: ${result.stdout.slice(0, 300)})`);
        assert.equal(typeof parsed.ok, "boolean", `[${verb}] the envelope carries a boolean ok`);
        if (!parsed.ok) {
          assert.notEqual(parsed.code, "unknown-subcommand", `[${verb}] a real verb never falls through to the shim's unknown-verb envelope`);
        }
      }
    },
  },
  // Scenario Outline: the --json face emits exactly one { ok, ... } document.
  {
    name: "mesh-desktop-dispatch/00 `--json` emits exactly one { ok, ... } document, no second document, no stray non-JSON line (install, run)",
    async run() {
      for (const verb of ["install", "run"]) {
        const result = runCli(["mesh", "desktop", verb, "--json"]);
        const trimmed = result.stdout.trim();
        assert.ok(trimmed.length > 0, `[${verb}] stdout is non-empty`);
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(trimmed); }, `[${verb}] stdout parses as ONE JSON document (got: ${trimmed.slice(0, 300)})`);
        assert.equal(typeof parsed, "object", `[${verb}] the document is an object`);
        assert.equal(typeof parsed.ok, "boolean", `[${verb}] carries ok:true|false`);
        if (parsed.ok === false) {
          assert.equal(typeof parsed.error, "string", `[${verb}] ok:false carries an error string`);
          assert.equal(typeof parsed.code, "string", `[${verb}] ok:false carries a code string`);
        }
      }
    },
  },
  // Scenario Outline: an unknown flag on a desktop verb is rejected before any
  // work — the generic face's spec-parse refusal (the documented contract
  // change: `Unknown flag "--x" for mesh:<verb>`, code `unknown-flag`).
  {
    name: "mesh-desktop-dispatch/00 an unknown flag on a desktop verb is rejected before any work (exit non-zero, single --json envelope, no install/launch)",
    async run() {
      for (const verb of ["install", "run"]) {
        const plain = runCli(["mesh", "desktop", verb, "--bogus"]);
        assert.match(plain.stderr, /Unknown flag "--bogus" for mesh:desktop-/, `[${verb}] plain-text rejection names --bogus with the face's vocabulary`);
        assert.notEqual(plain.status, 0, `[${verb}] exit is non-zero`);

        const json = runCli(["mesh", "desktop", verb, "--bogus", "--json"]);
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(json.stdout); }, `[${verb}] --json rejection is a single parseable document`);
        assert.equal(parsed.ok, false, `[${verb}] ok:false`);
        assert.match(parsed.error, /--bogus/, `[${verb}] the error names the unknown flag`);
        assert.equal(parsed.code, "unknown-flag", `[${verb}] the face's spec-parse refusal code`);
        assert.notEqual(json.status, 0, `[${verb}] exit is non-zero under --json too`);
      }
    },
  },
  // Scenario: an unknown inner verb under `desktop` is refused with a coded
  // envelope, never a crash.
  {
    name: "mesh-desktop-dispatch/00 `aof mesh desktop frobnicate` is refused with a coded unknown-verb envelope, never a stack trace",
    async run() {
      const result = runCli(["mesh", "desktop", "frobnicate", "--json"]);
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `stdout is a single parseable JSON document (got: ${result.stdout.slice(0, 300)})`);
      assert.equal(parsed.ok, false, "ok:false");
      assert.match(parsed.error, /frobnicate/, "the error names the rejected inner verb");
      assert.equal(typeof parsed.code, "string", "carries a code");
      assert.notEqual(result.status, 0, "exit is non-zero");
      assert.doesNotMatch(result.stderr, /at\s+\S+\s+\(.*:\d+:\d+\)/, "no stack trace on stderr");

      const plain = runCli(["mesh", "desktop", "frobnicate"]);
      assert.match(plain.stderr, /frobnicate/, "the plain-text rejection also names the rejected inner verb");
      assert.notEqual(plain.status, 0, "plain-text exit is non-zero");
      assert.doesNotMatch(plain.stderr, /at\s+\S+\s+\(.*:\d+:\d+\)/, "no stack trace on stderr (plain face)");
    },
  },
  // Scenario: a still-unknown `aof mesh` sub falls through to the existing
  // unknown-subcommand envelope unchanged.
  {
    name: "mesh-desktop-dispatch/00 `aof mesh wibble` still falls through to the existing meshCommand unknown-sub envelope, unintercepted by the desktop branch",
    async run() {
      const result = runCli(["mesh", "wibble", "--json"]);
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `stdout is a single parseable JSON document (got: ${result.stdout.slice(0, 300)})`);
      assert.equal(parsed.ok, false, "ok:false");
      assert.equal(parsed.code, "unknown-subcommand", "the existing unknown-subcommand code, unchanged");
      assert.match(parsed.error, /wibble/, "the error names the rejected sub \"wibble\"");
      assert.notEqual(result.status, 0, "exit is non-zero");
    },
  },
  // Scenario: the desktop verbs register ONLY their three-word-route ids — never
  // a bare mesh:desktop (the shim's name) or an ambiguous mesh:install/mesh:run.
  {
    name: "mesh-desktop-dispatch/00 the desktop verbs register exactly mesh:desktop-install / mesh:desktop-run; no bare mesh:desktop / mesh:install / mesh:run id exists",
    async run() {
      const registryIds = new Set(listCommands().map((c) => c.id));
      assert.ok(registryIds.has("mesh:desktop-install"), "mesh:desktop-install is registered");
      assert.ok(registryIds.has("mesh:desktop-run"), "mesh:desktop-run is registered");
      assert.ok(!registryIds.has("mesh:install"), "no mesh:install registry id exists");
      assert.ok(!registryIds.has("mesh:run"), "no mesh:run registry id exists");
      assert.ok(!registryIds.has("mesh:desktop"), "no mesh:desktop registry id exists (the shim is a refusal door, never a command)");
    },
  },
];
