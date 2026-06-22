// Traceability wiring for milestone 12 / story 00, task 01 —
// tasks/01_provider-registry-and-uv-lane.feature.
//
// Covers every @executable scenario (Scenario-Outline rows folded into one entry)
// against the REAL in-process code: src/tool-store.mjs's provider registry —
// planProvision dispatching on descriptor.provider, the uv lane (uv venv + uv pip
// install --python into the version dir), the npx lane delegating to the untouched
// frameworks.mjs, and the unknown/absent-provider rejection (ADR-002). One test
// object per @executable scenario, each name tracing to feature + scenario.
//
// HERMETIC: every assertion is over the dryRun PLAN (the argv each lane would run,
// no spawn). The uv lane is a pure plan emitter; the npx lane delegates to
// planFrameworkInstall (a pure plan emitter too) — so no binary is spawned. The
// version dir in the expected plan is DERIVED via toolVersionDir, never hardcoded.
import assert from "node:assert/strict";
import { planProvision, PROVIDERS } from "../src/tool-store.mjs";
import { toolVersionDir } from "../src/paths.mjs";

export const toolProviderRegistryTests = [
  // ═══════════ 01_provider-registry-and-uv-lane.feature ═══════════════════════

  {
    // @executable: the uv lane plans `uv venv` then `uv pip install --python` into
    // the version dir — the two deterministic commands that build the version-keyed
    // venv, targeting the version dir the resolver later reads. No binary is spawned
    // (dryRun emits commands only).
    name: "tool-registry/01 the uv lane plans uv venv then uv pip install --python into the version dir",
    run() {
      const descriptor = { name: "graphify", provider: "uv", packageSpec: "graphifyy", version: "0.8.44" };
      const versionDir = toolVersionDir("graphify", "0.8.44");
      const plan = planProvision(descriptor, { dryRun: true });

      assert.equal(plan.provider, "uv", "the plan is on the uv lane");
      assert.ok(Array.isArray(plan.commands), "the uv plan is a command list (argv arrays)");
      assert.equal(plan.commands.length, 2, "the uv plan is the two version-keyed-venv commands");

      // First command: `uv venv <verDir>`.
      const [first, second] = plan.commands;
      assert.deepEqual(first, ["uv", "venv", versionDir], "first command is `uv venv` targeting the graphify 0.8.44 version dir");

      // Second command: `uv pip install --python <verDir> graphifyy==0.8.44`.
      assert.deepEqual(
        second,
        ["uv", "pip", "install", "--python", versionDir, "graphifyy==0.8.44"],
        "second command is `uv pip install --python` into that version dir installing graphifyy==0.8.44"
      );

      // No graphify binary is spawned: the plan is data only. (Both lanes are pure
      // plan emitters; nothing in this call path spawns under dryRun.)
      assert.equal(typeof plan.commands[0][0], "string", "the plan is structured argv data, not a spawn result");
    },
  },

  {
    // @executable Scenario Outline: the uv lane threads extras into the install spec.
    // Three rows: no extras (bare spec), a single extra (headroom-ai[all]), multiple
    // extras (the comma-joined form). The version pin is always appended with "==".
    name: "tool-registry/01 the uv lane threads extras into the install spec",
    run() {
      const rows = [
        { extras: undefined, v: "0.26.0", spec: "headroom-ai==0.26.0" },
        { extras: ["all"], v: "0.26.0", spec: "headroom-ai[all]==0.26.0" },
        { extras: ["mcp", "proxy"], v: "0.26.0", spec: "headroom-ai[mcp,proxy]==0.26.0" },
      ];
      for (const { extras, v, spec } of rows) {
        const descriptor = { name: "headroom", provider: "uv", packageSpec: "headroom-ai", version: v, extras };
        const plan = planProvision(descriptor, { dryRun: true });
        // The install spec is the LAST element of the `uv pip install` command.
        const installCmd = plan.commands[1];
        const installSpec = installCmd[installCmd.length - 1];
        assert.equal(installSpec, spec, `extras ${JSON.stringify(extras)} → install spec "${spec}"`);
        // Also surfaced directly on the plan for the command face to report.
        assert.equal(plan.spec, spec, `plan.spec is "${spec}"`);
      }
    },
  },

  {
    // @executable: the npx lane delegates to frameworks.mjs with the npx argv shape
    // intact — the re-home, not a rewrite. The plan carries the frameworks.mjs items
    // and the planned command's argv[0] is "npx".
    name: "tool-registry/01 the npx lane delegates to frameworks.mjs with the npx argv shape intact",
    run() {
      // A node-framework descriptor on the npx lane (gsd is the FRAMEWORKS entry the
      // planner knows; any name works since planFrameworkInstall falls back to a
      // default runtime map).
      const descriptor = { name: "gsd", provider: "npx", packageSpec: "get-shit-done-cc@latest" };
      const plan = planProvision(descriptor, { dryRun: true });

      assert.equal(plan.provider, "npx", "the plan is on the npx lane");
      // It delegates to the frameworks.mjs planner: the plan carries the planner's
      // structured items (with argv/command/installEnvironment/lock machinery).
      assert.ok(Array.isArray(plan.items) && plan.items.length > 0, "the plan delegates to the frameworks.mjs planner (its items)");
      const item = plan.items[0];
      assert.ok(Array.isArray(item.argv), "the delegated item carries an argv");
      assert.equal(item.argv[0], "npx", "the planned command's argv[0] is `npx` (the argv shape is intact)");
      // The re-home preserves the npx env (SAFE_NPM_EXEC_ENV) — a marker that this is
      // the untouched frameworks.mjs planner, not a rewrite.
      assert.ok(item.installEnvironment, "the delegated item carries the npx exec env (frameworks.mjs preserved)");

      // The npx lane NEVER shells uv: no argv in the plan starts with "uv".
      for (const planned of plan.items) {
        assert.notEqual(planned.argv[0], "uv", "the npx lane never shells uv");
      }
    },
  },

  {
    // @executable Scenario Outline: planProvision dispatches on the provider and
    // rejects an unresolvable one. Two rows: an unknown provider ("wat") and a
    // descriptor missing its provider (absent) — neither is guessed; both throw an
    // unknown-provider error naming the bad provider (or null for absent).
    name: "tool-registry/01 planProvision dispatches on the provider and rejects an unresolvable one",
    run() {
      const rows = [
        { provider: "wat", named: "wat" },
        { provider: undefined, named: null },
      ];
      for (const { provider, named } of rows) {
        const descriptor = provider === undefined ? { name: "x" } : { name: "x", provider };
        let thrown;
        assert.throws(
          () => planProvision(descriptor, { dryRun: true }),
          (error) => {
            thrown = error;
            return error.code === "unknown-provider";
          },
          `provider ${JSON.stringify(provider)} → an unknown-provider error`
        );
        // The error NAMES the bad provider (or null for absent), never guesses.
        assert.equal(thrown.provider, named, `the error names the bad provider: ${JSON.stringify(named)}`);
        if (provider !== undefined) {
          assert.ok(thrown.message.includes(provider), `the message names "${provider}"`);
        }
      }

      // Dispatch is BY descriptor.provider: a known provider routes to its lane.
      assert.equal(typeof PROVIDERS.uv, "function", "the registry keys the uv lane by provider id");
      assert.equal(typeof PROVIDERS.npx, "function", "the registry keys the npx lane by provider id");
    },
  },
];
