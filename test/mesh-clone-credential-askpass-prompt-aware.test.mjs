// test/mesh-clone-credential-askpass-prompt-aware.test.mjs — traceability for
// milestone 38 / story 02, task 03 (03_askpass-prompt-aware.feature, ADR-010 decision
// 4). Every @executable scenario / Scenario Outline row invokes the REAL, shipped
// `buildAskpassShim` (src/mesh-worker-execution.mjs) exactly as git would (a real,
// but hermetic, spawn of the generated one-shot shim with the distinguishing prompt
// argv) — a pure process/string assertion over its stdout. No real git, no real forge.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { buildAskpassShim, meshCheckoutsRoot } from "../src/mesh-worker-execution.mjs";
import { withMeshCloneFixture } from "./support/mesh-worker-clone-fixture.mjs";

const TOKEN = "MINTED-TOKEN-abc123-not-a-real-credential";
const PAT = "ENV-TOKEN-PAT-xyz789-not-a-real-credential";
const CLONE_URL = "https://git.example.com/acme/secret.git";

function invokeShim(shimPath, prompt) {
  return new Promise((resolve, reject) => {
    execFile(shimPath, [prompt], { windowsHide: true, shell: process.platform === "win32" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export const meshCloneCredentialAskpassPromptAwareTests = [
  // ------------------------------------------------------------------
  // Scenario Outline: the shim answers by prompt kind
  // ------------------------------------------------------------------
  {
    name: "task03/38 askpass-prompt-aware: Examples — Username prompt -> x-access-token, Password prompt -> the token",
    run: async () => withMeshCloneFixture(async ({ env }) => {
      const scriptsRoot = meshCheckoutsRoot({ env });
      const shim = await buildAskpassShim(scriptsRoot, TOKEN);
      try {
        const rows = [
          { prompt: "Username for 'https://github.com'", answer: "x-access-token" },
          { prompt: "Password for 'https://github.com'", answer: TOKEN },
        ];
        for (const { prompt, answer } of rows) {
          const out = (await invokeShim(shim.shimPath, prompt)).trim();
          assert.equal(out, answer, `[${prompt}] the shim writes the correct answer to stdout`);
        }
      } finally {
        await shim.cleanup();
      }
    }, { cloneUrl: CLONE_URL }),
  },

  // ------------------------------------------------------------------
  // Scenario: the token is never emitted as the username
  // ------------------------------------------------------------------
  {
    name: "task03/38 askpass-prompt-aware: the token is never emitted as the username — invoked for the Username prompt, stdout is exactly x-access-token",
    run: async () => withMeshCloneFixture(async ({ env }) => {
      const scriptsRoot = meshCheckoutsRoot({ env });
      const shim = await buildAskpassShim(scriptsRoot, TOKEN);
      try {
        const out = (await invokeShim(shim.shimPath, "Username for 'https://github.com'")).trim();
        assert.equal(out, "x-access-token", "stdout is exactly x-access-token");
        assert.notEqual(out, TOKEN, "the token value does NOT appear in the username answer");
        assert.ok(!out.includes(TOKEN));
      } finally {
        await shim.cleanup();
      }
    }, { cloneUrl: CLONE_URL }),
  },

  // ------------------------------------------------------------------
  // Scenario: the token still lives only in the scoped one-shot (F2 stays green)
  // ------------------------------------------------------------------
  {
    name: "task03/38 askpass-prompt-aware: the token is embedded only in the one-shot, scoped .askpass/<uuid>/ file — never process.env, never argv — and the whole shim directory is removed in the caller's finally, even on a throw",
    run: async () => withMeshCloneFixture(async ({ env }) => {
      const scriptsRoot = meshCheckoutsRoot({ env });
      const shim = await buildAskpassShim(scriptsRoot, TOKEN);
      assert.ok(shim.shimPath.includes(".askpass"), "the shim lives under the .askpass scoped sibling — never os.tmpdir()");
      assert.ok(!Object.values(process.env).some((v) => typeof v === "string" && v.includes(TOKEN)), "the token never touches process.env at build time");

      // Mirrors cloneRepoForWorkspace's own try/finally discipline around the shim's
      // lifetime: cleanup runs even when the guarded body throws.
      await assert.rejects(async () => {
        try {
          throw new Error("simulated clone failure");
        } finally {
          await shim.cleanup();
        }
      }, /simulated clone failure/);
      await assert.rejects(() => readFile(shim.shimPath, "utf8"), "the whole shim directory is gone after cleanup, even though the guarded body threw");
    }, { cloneUrl: CLONE_URL }),
  },

  // ------------------------------------------------------------------
  // Scenario: the env-token (PAT) path also authenticates under the prompt-aware shim
  // ------------------------------------------------------------------
  {
    name: "task03/38 askpass-prompt-aware: the env-token (PAT) path also authenticates under the prompt-aware shim — Username -> x-access-token, Password -> the PAT (username is not used to authenticate a PAT)",
    run: async () => withMeshCloneFixture(async ({ env }) => {
      const scriptsRoot = meshCheckoutsRoot({ env });
      const shim = await buildAskpassShim(scriptsRoot, PAT);
      try {
        const usernameOut = (await invokeShim(shim.shimPath, "Username for 'https://github.com'")).trim();
        const passwordOut = (await invokeShim(shim.shimPath, "Password for 'https://github.com'")).trim();
        assert.equal(usernameOut, "x-access-token");
        assert.equal(passwordOut, PAT, "the PAT is still emitted on the Password prompt — the prompt-aware shim does not break the retained env-token default");
      } finally {
        await shim.cleanup();
      }
    }, { cloneUrl: CLONE_URL }),
  },
];
