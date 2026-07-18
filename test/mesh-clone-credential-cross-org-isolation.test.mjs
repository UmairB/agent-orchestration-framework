// test/mesh-clone-credential-cross-org-isolation.test.mjs — traceability for
// milestone 38 / story 03, task 01 (01_cross-org-key-isolation.feature, ADR-011
// structural invariant #2, SECURITY T12). Every @executable scenario / Scenario
// Outline row is driven against the REAL `createGithubAppMintProvider`
// (src/mesh-clone-credential-provider.mjs) fed the REAL, LAUNCHER-EXPORTED
// `createResolveWorkspaceAppIdentity`/`createResolveWorkspaceCloneUrl`
// (src/mesh-launcher.mjs) over REAL committed multi-org workspace configs — no
// hand-built stand-in for either resolver (ADR-008). The "recording signer" the
// feature's Background names WRAPS the REAL default `node:crypto` RS256 signer
// (`defaultSignAppJwt`) — it records every `{ appId, privateKey }` pair a mint signs
// with, without replacing the real signing step; a "recording reader" similarly wraps
// the real file read so a test can assert WHICH key files were ever opened. NO real
// GitHub, no network (the HTTP client is a scripted fake).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGithubAppMintProvider, defaultSignAppJwt } from "../src/mesh-clone-credential-provider.mjs";
import { createResolveWorkspaceAppIdentity, createResolveWorkspaceCloneUrl } from "../src/mesh-launcher.mjs";
import { createFakeHttpRequest, jsonResponse } from "./support/mesh-clone-credential-mint-fixture.mjs";
import { withPerOrgAppIdentityFixture, generateThrowawayPrivateKeyPem } from "./support/mesh-per-org-app-identity-fixture.mjs";

async function withThrowawayKeyFiles(names, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-cross-org-keys-"));
  try {
    const paths = {};
    for (const name of names) {
      const keyPath = path.join(dir, `${name}.pem`);
      await mkdir(path.dirname(keyPath), { recursive: true });
      await writeFile(keyPath, generateThrowawayPrivateKeyPem(), "utf8");
      paths[name] = keyPath;
    }
    return await fn(paths);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// recordingSignAppJwt(calls) — a SPY, not a stand-in: WRAPS the REAL default signer
// (defaultSignAppJwt, node:crypto RS256) and records every { appId, privateKey } pair
// it was called with — the "recording signer" the feature's Background names.
function recordingSignAppJwt(calls) {
  return (args) => {
    calls.push({ appId: args.appId, privateKey: args.privateKey });
    return defaultSignAppJwt(args);
  };
}

function scriptedHttpRequest() {
  return createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 1 }) : jsonResponse(201, { token: "TOKEN" })));
}

const MISSING_KEY_PATH = path.join(os.tmpdir(), "aof-cross-org-missing-key-never-written.pem");

// withCrossOrgHarness(fn) — the ONE shared fixture this whole file's scenarios drive:
// workspace "ws-a" (org A) with its OWN committed App "app-a" + key-a; workspace
// "ws-b" (org B) with its OWN committed App "app-b" + key-b; the LAUNCH workspace
// configures NO credential at all (so the "no override -> launch default" fallback
// ALSO resolves to nothing — the defect rows genuinely have no App anywhere to
// borrow, never merely "the wrong one"); three DEFECT workspaces
// (ws-noapp/ws-badkey/ws-empty) for the Scenario Outline. `readAttempts` records
// every key-file PATH the real reader was ever asked to open.
async function withCrossOrgHarness(fn) {
  return withThrowawayKeyFiles(["app-a", "app-b"], (keys) => withPerOrgAppIdentityFixture(async (fx) => {
    const readAttempts = [];
    const recordingReader = (keyPath, encoding) => {
      readAttempts.push(keyPath);
      return readFileSync(keyPath, encoding);
    };
    const options = { globalWorkStoreOptions: { env: fx.env }, readPrivateKeyFile: recordingReader };
    const resolveWorkspaceAppIdentity = createResolveWorkspaceAppIdentity(fx.ws, options);
    const resolveWorkspaceCloneUrl = createResolveWorkspaceCloneUrl(fx.ws, options);
    return fn({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl, keys, readAttempts });
  }, {
    launch: {
      workspaceId: "ws-launch",
      cloneUrl: "https://github.com/launch-org/launch-repo.git",
      // NO credential configured at all — the fallback default ITSELF resolves to
      // nothing, so a workspace with no override of its own has genuinely no App to
      // borrow (never merely "borrows the wrong one").
    },
    others: [
      { workspaceId: "ws-a", cloneUrl: "https://github.com/org-a/repo-a.git", credential: { githubApp: { appId: "app-a", privateKeyPath: keys["app-a"] } } },
      { workspaceId: "ws-b", cloneUrl: "https://github.com/org-b/repo-b.git", credential: { githubApp: { appId: "app-b", privateKeyPath: keys["app-b"] } } },
      { workspaceId: "ws-noapp", cloneUrl: "https://github.com/org-noapp/repo.git" }, // no credential block at all
      { workspaceId: "ws-badkey", cloneUrl: "https://github.com/org-badkey/repo.git", credential: { githubApp: { appId: "app-badkey", privateKeyPath: MISSING_KEY_PATH } } },
      { workspaceId: "ws-empty", cloneUrl: "https://github.com/org-empty/repo.git", credential: { githubApp: {} } },
    ],
  }));
}

export const meshCloneCredentialCrossOrgIsolationTests = [
  // ------------------------------------------------------------------
  // Scenario: a mint for ws-a uses ONLY app-a/key-a — org B's App is never touched
  // ------------------------------------------------------------------
  {
    name: "task01/38 cross-org-key-isolation: a mint for ws-a uses ONLY app-a/key-a — org B's App is never touched",
    run: async () => withCrossOrgHarness(async ({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl, keys, readAttempts }) => {
      const calls = [];
      const mint = createGithubAppMintProvider({
        resolveWorkspaceAppIdentity,
        resolveWorkspaceCloneUrl,
        signAppJwt: recordingSignAppJwt(calls),
        httpRequest: scriptedHttpRequest(),
      });

      await mint("ws-a", "asg-a");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].appId, "app-a");
      const keyAContent = await readFile(keys["app-a"], "utf8");
      const keyBContent = await readFile(keys["app-b"], "utf8");
      assert.equal(calls[0].privateKey, keyAContent, "the App JWT signs with ws-a's OWN key-a");
      assert.notEqual(calls[0].privateKey, keyBContent, "the signed key is not org B's key-b");
      assert.ok(!readAttempts.includes(keys["app-b"]), "app-b/key-b is NEVER read for this mint — the recording reader sees only org A's material");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: sequential mints do not carry one workspace's identity into the next
  // ------------------------------------------------------------------
  {
    name: "task01/38 cross-org-key-isolation: sequential mints do not carry one workspace's identity into the next (no cross-workspace cache)",
    run: async () => withCrossOrgHarness(async ({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl, keys }) => {
      const calls = [];
      const mint = createGithubAppMintProvider({
        resolveWorkspaceAppIdentity,
        resolveWorkspaceCloneUrl,
        signAppJwt: recordingSignAppJwt(calls),
        httpRequest: scriptedHttpRequest(),
      });

      await mint("ws-a", "asg-a");
      await mint("ws-b", "asg-b");
      assert.equal(calls.length, 2);
      assert.equal(calls[0].appId, "app-a");
      assert.equal(calls[1].appId, "app-b", "the App JWT iss is app-b — never app-a — for the SECOND mint");
      const keyAContent = await readFile(keys["app-a"], "utf8");
      const keyBContent = await readFile(keys["app-b"], "utf8");
      assert.equal(calls[0].privateKey, keyAContent);
      assert.equal(calls[1].privateKey, keyBContent, "identity is resolved FRESH per mint keyed by workspaceId; ws-b's mint reuses NO previously-resolved identity");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario Outline: a workspace whose OWN config resolves no usable App/key fails
  // LOUD — never borrows a sibling
  // ------------------------------------------------------------------
  {
    name: "task01/38 cross-org-key-isolation: Examples — a workspace whose OWN config resolves no usable App/key fails LOUD — never borrows a sibling",
    run: async () => withCrossOrgHarness(async ({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl, keys, readAttempts }) => {
      const rows = [
        { workspaceId: "ws-noapp", label: "has no githubApp.appId at all" },
        { workspaceId: "ws-badkey", label: "names an appId but its key file is unreadable" },
        { workspaceId: "ws-empty", label: "has neither an appId nor a key" },
      ];
      for (const row of rows) {
        // Direct proof that resolveWorkspaceAppIdentity ITSELF resolves to null (the
        // REAL launcher-exported seam, not inferred from the mint's throw alone).
        const identity = await resolveWorkspaceAppIdentity(row.workspaceId);
        assert.equal(identity, null, `[${row.label}] resolveWorkspaceAppIdentity resolves to a null identity`);

        const calls = [];
        const mint = createGithubAppMintProvider({
          resolveWorkspaceAppIdentity,
          resolveWorkspaceCloneUrl,
          signAppJwt: recordingSignAppJwt(calls),
          httpRequest: scriptedHttpRequest(),
        });
        await assert.rejects(
          () => mint(row.workspaceId, "asg-defect"),
          (error) => {
            assert.equal(error.code, "github-app-mint-failed", `[${row.label}] the provider THROWS a coded mint failure`);
            return true;
          },
          `[${row.label}] mint rejects`,
        );
        assert.equal(calls.length, 0, `[${row.label}] no App JWT is signed, no token exchange is attempted`);
      }
      assert.ok(!readAttempts.includes(keys["app-a"]), "app-a/key-a is NEVER read to mint for any defect workspace (no borrow)");
      assert.ok(!readAttempts.includes(keys["app-b"]), "app-b/key-b is NEVER read to mint for any defect workspace (no borrow)");
    }),
  },
];
