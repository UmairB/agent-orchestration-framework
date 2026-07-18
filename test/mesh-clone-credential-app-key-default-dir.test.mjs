// test/mesh-clone-credential-app-key-default-dir.test.mjs — traceability for
// milestone 38 / story 03, task 02
// (02_default-private-key-directory.feature, ADR-011 decision 5 / structural
// invariant #3, SECURITY T8/T12(b)). Every @executable scenario / Scenario Outline
// row is driven against the REAL, EXPORTED `resolveGithubAppPrivateKey`
// (src/mesh-launcher.mjs) over an injected file-reader (records the PATH it is asked
// to read — no real fs read of a secret, no real key) and a temp `AOF_GLOBAL_HOME`
// (via `options.env`, never the real machine's `~/.aof`). NO real GitHub, no network.
//
// BUILD-OWED DECISION (flagged by aof-qa at refine, STATE.md): task 02's own
// scenarios assert only the non-sync PREFIX (`<meshRoot>/credentials/`) — the exact
// key FILENAME convention within it is pinned here: `github-app-<appId>.pem`, appId
// sanitized to a filesystem-safe slug (so two orgs' keys coexist as DISTINCT files in
// the SAME shared default directory, never overwriting one another); absent an appId,
// the bare `github-app.pem` (the pre-multi-org singular default, unchanged). Covered
// by this file's own additional (beyond-the-locked-contract) scenarios below.
import assert from "node:assert/strict";
import path from "node:path";
import { resolveGithubAppPrivateKey } from "../src/mesh-launcher.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";

const SYNC_SCOPED_SEGMENTS = ["Dropbox", "OneDrive", "iCloud", "Library/Mobile Documents", "Library\\Mobile Documents"];

// recordingReader() — the injected `options.readPrivateKeyFile` seam: records every
// PATH it is asked to read and returns a FIXED, harmless placeholder — never a real
// fs read of a secret, never a real key.
function recordingReader() {
  const calls = [];
  const reader = (keyPath) => {
    calls.push(keyPath);
    return "FAKE-KEY-CONTENTS";
  };
  reader.calls = calls;
  return reader;
}

function tempGlobalHome(name) {
  return path.join(path.resolve(process.cwd(), ".tmp-aof-app-key-default-dir"), name);
}

export const meshCloneCredentialAppKeyDefaultDirTests = [
  // ------------------------------------------------------------------
  // Scenario: neither env nor config set -> the code-enforced <meshRoot>/credentials/
  // default
  // ------------------------------------------------------------------
  {
    name: "task02/38 default-private-key-directory: neither env nor config set -> the key path resolved is UNDER <meshRoot>/credentials/, composed via the globalMeshPaths seam, with no sync-scoped segment",
    run: async () => {
      const home = tempGlobalHome("row1");
      const reader = recordingReader();
      const config = { mesh: { repo: { credential: { githubApp: { appId: "app-1" } } } } };
      const result = resolveGithubAppPrivateKey(config, { env: { AOF_GLOBAL_HOME: home }, readPrivateKeyFile: reader });
      assert.equal(result, "FAKE-KEY-CONTENTS", "the reader's return value is threaded straight through");
      assert.equal(reader.calls.length, 1, "the reader is consulted exactly once");
      const resolvedPath = reader.calls[0];
      const meshRoot = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).meshRoot;
      const credentialsDir = path.join(meshRoot, "credentials");
      assert.ok(
        resolvedPath === credentialsDir || resolvedPath.startsWith(credentialsDir + path.sep),
        `the resolved path (${resolvedPath}) is UNDER <meshRoot>/credentials/ (${credentialsDir})`,
      );
      for (const segment of SYNC_SCOPED_SEGMENTS) {
        assert.ok(!resolvedPath.includes(segment), `the resolved path contains no sync-scoped segment (${segment})`);
      }
    },
  },

  // ------------------------------------------------------------------
  // Scenario: an explicit env path overrides the default entirely
  // ------------------------------------------------------------------
  {
    name: "task02/38 default-private-key-directory: an explicit env path overrides the default entirely — the key is read from EXACTLY that path, the <meshRoot>/credentials/ default is never consulted",
    run: async () => {
      const home = tempGlobalHome("row2");
      const reader = recordingReader();
      const config = { mesh: { repo: { credential: { githubApp: { appId: "app-1", privateKeyPath: "/keys/config.pem" } } } } };
      const result = resolveGithubAppPrivateKey(config, {
        env: { AOF_GLOBAL_HOME: home, AOF_MESH_GITHUB_APP_PRIVATE_KEY_PATH: "/keys/app.pem" },
        readPrivateKeyFile: reader,
      });
      assert.equal(result, "FAKE-KEY-CONTENTS");
      assert.deepEqual(reader.calls, ["/keys/app.pem"], "the reader is consulted EXACTLY once, with the env path — the config path and the code default are never consulted");
    },
  },

  // ------------------------------------------------------------------
  // Scenario Outline: env > config > code-enforced default (the resolution
  // precedence)
  // ------------------------------------------------------------------
  {
    name: "task02/38 default-private-key-directory: Examples — env > config > code-enforced default (the resolution precedence)",
    run: async () => {
      const home = tempGlobalHome("row3");
      const meshRoot = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).meshRoot;
      const credentialsDir = path.join(meshRoot, "credentials");
      const rows = [
        { envPath: "/keys/env.pem", configPath: "/keys/config.pem", expect: (p) => assert.equal(p, "/keys/env.pem") },
        { envPath: undefined, configPath: "/keys/config.pem", expect: (p) => assert.equal(p, "/keys/config.pem") },
        { envPath: undefined, configPath: undefined, expect: (p) => assert.ok(p === credentialsDir || p.startsWith(credentialsDir + path.sep), `expected ${p} under ${credentialsDir}`) },
      ];
      for (const row of rows) {
        const reader = recordingReader();
        const config = { mesh: { repo: { credential: { githubApp: { appId: "app-1", ...(row.configPath ? { privateKeyPath: row.configPath } : {}) } } } } };
        const envObj = { AOF_GLOBAL_HOME: home, ...(row.envPath ? { AOF_MESH_GITHUB_APP_PRIVATE_KEY_PATH: row.envPath } : {}) };
        resolveGithubAppPrivateKey(config, { env: envObj, readPrivateKeyFile: reader });
        assert.equal(reader.calls.length, 1, `[env=${row.envPath} config=${row.configPath}] exactly one read attempt`);
        row.expect(reader.calls[0]);
      }
    },
  },

  // ------------------------------------------------------------------
  // Build-owed coverage: the pinned FILENAME convention within the shared default
  // directory — keyed by appId, so two orgs' keys coexist as DISTINCT files.
  // ------------------------------------------------------------------
  {
    name: "task02/38 default-private-key-directory (build-owed filename convention): the default filename is keyed by appId (github-app-<appId>.pem) — two orgs' keys resolve to DISTINCT files in the SAME shared default directory, never colliding",
    run: async () => {
      const home = tempGlobalHome("row4");
      const meshRoot = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).meshRoot;
      const credentialsDir = path.join(meshRoot, "credentials");

      const readerA = recordingReader();
      resolveGithubAppPrivateKey(
        { mesh: { repo: { credential: { githubApp: { appId: "app-a" } } } } },
        { env: { AOF_GLOBAL_HOME: home }, readPrivateKeyFile: readerA },
      );
      const readerB = recordingReader();
      resolveGithubAppPrivateKey(
        { mesh: { repo: { credential: { githubApp: { appId: "app-b" } } } } },
        { env: { AOF_GLOBAL_HOME: home }, readPrivateKeyFile: readerB },
      );

      assert.equal(readerA.calls[0], path.join(credentialsDir, "github-app-app-a.pem"), "org A's default key filename is keyed by ITS OWN appId");
      assert.equal(readerB.calls[0], path.join(credentialsDir, "github-app-app-b.pem"), "org B's default key filename is keyed by ITS OWN appId");
      assert.notEqual(readerA.calls[0], readerB.calls[0], "two orgs' default key files are DISTINCT — they coexist in the SAME shared credentials/ directory without colliding");
    },
  },
  {
    name: "task02/38 default-private-key-directory (build-owed filename convention): an appId is sanitized to a filesystem-safe slug — no path-separator/traversal segment escapes the credentials directory",
    run: async () => {
      const home = tempGlobalHome("row5");
      const meshRoot = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).meshRoot;
      const credentialsDir = path.join(meshRoot, "credentials");
      const reader = recordingReader();
      resolveGithubAppPrivateKey(
        { mesh: { repo: { credential: { githubApp: { appId: "../../evil app/id" } } } } },
        { env: { AOF_GLOBAL_HOME: home }, readPrivateKeyFile: reader },
      );
      const resolvedPath = reader.calls[0];
      assert.ok(resolvedPath.startsWith(credentialsDir + path.sep), `a hostile appId still resolves UNDER the credentials directory (${resolvedPath})`);
      assert.equal(path.dirname(resolvedPath), credentialsDir, "the sanitized filename carries no path separator that could escape into a subdirectory or a parent directory");
    },
  },
  {
    name: "task02/38 default-private-key-directory (build-owed filename convention): absent an appId, the default filename falls back to the bare github-app.pem (the pre-multi-org singular default, unchanged)",
    run: async () => {
      const home = tempGlobalHome("row6");
      const meshRoot = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).meshRoot;
      const credentialsDir = path.join(meshRoot, "credentials");
      const reader = recordingReader();
      resolveGithubAppPrivateKey({ mesh: { repo: { credential: {} } } }, { env: { AOF_GLOBAL_HOME: home }, readPrivateKeyFile: reader });
      assert.equal(reader.calls[0], path.join(credentialsDir, "github-app.pem"));
    },
  },
];
