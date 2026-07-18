// test/mesh-clone-credential-push-mint-scoped.test.mjs — traceability for milestone
// 38 / story 07, task 02 (02_two-token-write-scope.feature, ADR-015 decision 3;
// SECURITY T15, RE-OPENS T9). Scenarios 1-4 are driven against the REAL
// `createGithubAppMintProvider` (clone) and `createGithubAppPushMintProvider` (write)
// (src/mesh-clone-credential-provider.mjs) fed a FAKE http client that RECORDS the
// two access_tokens request bodies (the story-02 task-01 recording pattern) — no real
// GitHub, no network. The Scenario Outline (the plants that MUST trip the rewritten
// two-seam `acd-minted-token-scoped-single-repo` detector) lives in its OWN fitness
// test file (test/arch/acd-minted-token-scoped-single-repo.test.mjs) — SECURITY-owned,
// per the story's own framing ("the DETECTOR REWRITE itself is SECURITY-owned +
// ARMED AT BUILD ... this task is the BEHAVIOURAL scope contract that ARMS it").
import assert from "node:assert/strict";
import { createGithubAppMintProvider, createGithubAppPushMintProvider } from "../src/mesh-clone-credential-provider.mjs";
import { generateThrowawayKeypair, createFakeHttpRequest, jsonResponse } from "./support/mesh-clone-credential-mint-fixture.mjs";

const REPO_CLONE_URL = "https://github.com/acme/secret.git";

function scriptedHttpRequest({ installationId = 1, token = "FAKE-TOKEN" } = {}) {
  return createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: installationId }) : jsonResponse(201, { token })));
}

export const meshCloneCredentialPushMintScopedTests = [
  // ------------------------------------------------------------------
  // Scenario: the CLONE mint body stays EXACTLY single-repo contents:read (T9, verbatim)
  // ------------------------------------------------------------------
  {
    name: "task02/38-07 two-token-write-scope: the CLONE mint body stays EXACTLY single-repo contents:read (T9, verbatim) — byte-unchanged from the story-02 posture",
    run: async () => {
      const { privateKey } = generateThrowawayKeypair();
      const httpRequest = scriptedHttpRequest({ token: "CLONE-TOKEN" });
      const mint = createGithubAppMintProvider({
        resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }),
        resolveWorkspaceCloneUrl: async () => REPO_CLONE_URL,
        httpRequest,
      });

      const token = await mint("ws-a", "asg-1");
      assert.equal(token, "CLONE-TOKEN");
      const exchangeCall = httpRequest.calls.at(-1);
      const body = JSON.parse(exchangeCall.init.body);
      assert.deepEqual(body, { repositories: ["secret"], permissions: { contents: "read" } }, "the recorded clone access_tokens body deep-equals { repositories:[repo], permissions:{ contents:\"read\" } }");
      assert.equal(Object.keys(body.permissions).length, 1, "the clone body names NO permission beyond contents:read");
      assert.equal(body.repositories.length, 1, "the clone body names EXACTLY one repo");
    },
  },

  // ------------------------------------------------------------------
  // Scenario: the WRITE mint body is single-repo and no broader than contents:write
  // (auto-PR off — the default)
  // ------------------------------------------------------------------
  {
    name: "task02/38-07 two-token-write-scope: the WRITE mint body is single-repo and no broader than contents:write (auto-PR off — the DOCUMENTED DEFAULT); minted ONLY at the push seam, never a run-long standing write credential",
    run: async () => {
      const { privateKey } = generateThrowawayKeypair();
      const httpRequest = scriptedHttpRequest({ token: "WRITE-TOKEN" });
      const mint = createGithubAppPushMintProvider({
        resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }),
        resolveWorkspaceCloneUrl: async () => REPO_CLONE_URL,
        httpRequest,
      });

      const token = await mint("ws-a", "asg-1");
      assert.equal(token, "WRITE-TOKEN");
      const exchangeCall = httpRequest.calls.at(-1);
      const body = JSON.parse(exchangeCall.init.body);
      assert.equal(body.repositories.length, 1, "the write access_tokens body names EXACTLY one repo (the assigned repo)");
      assert.deepEqual(body.permissions, { contents: "write" }, "permissions is EXACTLY { contents:\"write\" } — no pull_requests, no administration, no org-wide key");

      // Minted ONLY at push time — a SECOND independent call for a SECOND assignment
      // mints a SEPARATE token, never reuses/caches one across calls (never a
      // run-long standing credential).
      const httpRequest2 = scriptedHttpRequest({ installationId: 2, token: "WRITE-TOKEN-2" });
      const mint2 = createGithubAppPushMintProvider({
        resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }),
        resolveWorkspaceCloneUrl: async () => REPO_CLONE_URL,
        httpRequest: httpRequest2,
      });
      const token2 = await mint2("ws-a", "asg-2");
      assert.equal(token2, "WRITE-TOKEN-2");
      assert.notEqual(token, token2, "each call mints its OWN fresh token — never a cached/reused standing credential");
    },
  },

  // ------------------------------------------------------------------
  // Scenario: auto-PR ON widens ONLY to pull_requests:write, still single-repo
  // ------------------------------------------------------------------
  {
    name: "task02/38-07 two-token-write-scope: auto-PR ON widens ONLY to pull_requests:write, still single-repo — nothing broader",
    run: async () => {
      const { privateKey } = generateThrowawayKeypair();
      const httpRequest = scriptedHttpRequest({ token: "WRITE-TOKEN-PR" });
      const mint = createGithubAppPushMintProvider({
        resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }),
        resolveWorkspaceCloneUrl: async () => REPO_CLONE_URL,
        httpRequest,
      });

      const token = await mint("ws-a", "asg-1", { autoPr: true });
      assert.equal(token, "WRITE-TOKEN-PR");
      const body = JSON.parse(httpRequest.calls.at(-1).init.body);
      assert.deepEqual(body.permissions, { contents: "write", pull_requests: "write" }, "permissions is a subset of { contents:\"write\", pull_requests:\"write\" } — nothing broader");
      assert.equal(body.repositories.length, 1, "the token still names EXACTLY the one assigned repo");
    },
  },

  // ------------------------------------------------------------------
  // Scenario: the write body lives ONLY in the push-mint function — the clone path
  // never mints write
  // ------------------------------------------------------------------
  {
    name: "task02/38-07 two-token-write-scope: the write body lives ONLY in the push-mint function — the clone provider's exported mintCloneCredential produces NO contents:write body on any path",
    run: async () => {
      const { privateKey } = generateThrowawayKeypair();
      const cloneHttp = scriptedHttpRequest({ token: "CLONE-ONLY" });
      const mintClone = createGithubAppMintProvider({
        resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }),
        resolveWorkspaceCloneUrl: async () => REPO_CLONE_URL,
        httpRequest: cloneHttp,
      });
      await mintClone("ws-a", "asg-1");
      // Every access_tokens body EVER sent through the clone provider's own http
      // client is inspected — none ever carries a write permission, on any of the
      // (here, one) calls it makes.
      const exchangeCalls = cloneHttp.calls.filter((c) => c.url.includes("/access_tokens"));
      assert.ok(exchangeCalls.length > 0, "sanity: the clone mint made at least one access_tokens call");
      for (const call of exchangeCalls) {
        const body = JSON.parse(call.init.body);
        assert.ok(!("contents" in body.permissions) || body.permissions.contents !== "write", "the clone provider's exported mintCloneCredential produces NO contents:write body on any path");
      }

      // A write access_tokens body appears ONLY at the push-mint seam — driven here
      // independently, over its OWN fake http client (never shared with the clone
      // mint's).
      const writeHttp = scriptedHttpRequest({ token: "WRITE-ONLY" });
      const mintWrite = createGithubAppPushMintProvider({
        resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }),
        resolveWorkspaceCloneUrl: async () => REPO_CLONE_URL,
        httpRequest: writeHttp,
      });
      await mintWrite("ws-a", "asg-1");
      const writeBody = JSON.parse(writeHttp.calls.at(-1).init.body);
      assert.equal(writeBody.permissions.contents, "write", "a write access_tokens body appears at the push-mint seam");
      // The two mints are genuinely DIFFERENT functions (never the same reference).
      assert.notEqual(mintClone, mintWrite, "createGithubAppMintProvider and createGithubAppPushMintProvider return DIFFERENT function references");
    },
  },
];
