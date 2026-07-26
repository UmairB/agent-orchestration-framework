// test/mesh-clone-credential-github-app-mint.test.mjs — traceability for milestone 38
// / story 02, task 01 (01_github-app-mint-scoped.feature, ADR-010 §6.2/§6.3, RESEARCH
// §3, SECURITY T9/F6). Every @executable scenario / Scenario Outline row driven
// directly against the REAL `createGithubAppMintProvider` (src/mesh-clone-credential-
// provider.mjs) and the REAL `parseRepoFromCloneUrl` (src/mesh-worker-execution.mjs):
// an injected fake HTTP client (recording every request body — no real network) and a
// THROWAWAY (test-generated, never a real GitHub App's) RSA keypair, signed with the
// REAL, DEFAULT `node:crypto` RS256 signer (never a fake stand-in for the signer
// itself) — so "signs with node:crypto RS256, no new dependency" is a genuine
// assertion against production code.
import assert from "node:assert/strict";
import { createVerify } from "node:crypto";
import { createGithubAppMintProvider } from "../src/mesh-clone-credential-provider.mjs";
import { parseRepoFromCloneUrl } from "../src/mesh-worker-execution.mjs";
import { generateThrowawayKeypair, createFakeHttpRequest, jsonResponse } from "./support/mesh-clone-credential-mint-fixture.mjs";

function base64urlToBuffer(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function decodeJwt(jwt) {
  const parts = jwt.split(".");
  assert.equal(parts.length, 3, "a JWT is exactly three dot-separated parts");
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64urlToBuffer(headerB64).toString("utf8"));
  const payload = JSON.parse(base64urlToBuffer(payloadB64).toString("utf8"));
  return { header, payload, signingInput: `${headerB64}.${payloadB64}`, signatureBuffer: base64urlToBuffer(signatureB64) };
}

export const meshCloneCredentialGithubAppMintTests = [
  // ------------------------------------------------------------------
  // Scenario: the mint requests a token for exactly the assigned repo, contents:read
  // ------------------------------------------------------------------
  {
    name: "task01/38 github-app-mint-scoped: the mint signs an App JWT via node:crypto RS256 (exp within the <=10-minute ceiling), the access_tokens POST body names EXACTLY the one repo + contents:read, and returns the fake installation token",
    run: async () => {
      const { privateKey, publicKey } = generateThrowawayKeypair();
      const httpRequest = createFakeHttpRequest(async ({ url, init }) => {
        if (url.endsWith("/installation")) {
          assert.equal(init.method, "GET");
          assert.ok(init.headers.Authorization.startsWith("Bearer "), "the installation lookup carries the App-JWT bearer");
          return jsonResponse(200, { id: 555 });
        }
        assert.ok(url.includes("/access_tokens"));
        assert.equal(init.method, "POST");
        return jsonResponse(201, { token: "FAKE-INSTALLATION-TOKEN-xyz" });
      });
      let resolvedFor = null;
      const mint = createGithubAppMintProvider({
        resolveWorkspaceAppIdentity: async () => ({ appId: "app-123", privateKey }),
        httpRequest,
        resolveWorkspaceCloneUrl: async (workspaceId) => {
          resolvedFor = workspaceId;
          return "https://github.com/acme/secret.git";
        },
      });

      const token = await mint("ws-secret", "asg-1");
      assert.equal(token, "FAKE-INSTALLATION-TOKEN-xyz", "returns the fake installation token, into the (unchanged) ADR-009 pull reply");
      assert.equal(resolvedFor, "ws-secret");
      assert.equal(httpRequest.calls.length, 2);

      const [installCall, exchangeCall] = httpRequest.calls;
      const jwt = installCall.init.headers.Authorization.slice("Bearer ".length);
      const { header, payload, signingInput, signatureBuffer } = decodeJwt(jwt);
      assert.equal(header.alg, "RS256", "the JWT alg header names RS256");
      assert.equal(payload.iss, "app-123", "the JWT iss claim is the App id");
      assert.ok(payload.exp > payload.iat, "exp is after iat");
      assert.ok(payload.exp - payload.iat <= 600, "exp is within the <=10-minute ceiling");

      // Verify the signature with node:crypto's OWN createVerify — proves this JWT is
      // genuinely RS256-signed via node:crypto alone (no jsonwebtoken/jose/octokit
      // anywhere in the call chain), against the throwaway keypair's own public half.
      const verifier = createVerify("RSA-SHA256");
      verifier.update(signingInput);
      assert.ok(verifier.verify(publicKey, signatureBuffer), "the JWT is genuinely RS256-signed via node:crypto");

      const exchangeBody = JSON.parse(exchangeCall.init.body);
      assert.deepEqual(exchangeBody, { repositories: ["secret"], permissions: { contents: "read" } }, "the access_tokens body names EXACTLY the one repo + contents:read");
      assert.equal(exchangeCall.url, "https://api.github.com/app/installations/555/access_tokens");
    },
  },

  // ------------------------------------------------------------------
  // Scenario: the repo is resolved from CONTROL's committed cloneUrl, never the worker's frame
  // ------------------------------------------------------------------
  {
    name: "task01/38 github-app-mint-scoped: the repo is resolved ONLY from resolveWorkspaceCloneUrl(workspaceId) — an assignmentId (or anything resembling a smuggled repo name) never influences the mint scope (F15 stays closed)",
    run: async () => {
      const { privateKey } = generateThrowawayKeypair();
      const httpRequest = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 1 }) : jsonResponse(201, { token: "TOKEN" })));
      let resolvedFor = null;
      const mint = createGithubAppMintProvider({
        resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }),
        httpRequest,
        resolveWorkspaceCloneUrl: async (workspaceId) => {
          resolvedFor = workspaceId;
          return "https://github.com/acme/secret.git";
        },
      });

      await mint("ws-a", "asg-pretend-other/repo-should-never-influence-anything");
      assert.equal(resolvedFor, "ws-a", "the ONLY input to repo resolution is the workspaceId");
      const exchangeCall = httpRequest.calls.at(-1);
      const body = JSON.parse(exchangeCall.init.body);
      assert.deepEqual(body.repositories, ["secret"], "the mint scope is exactly the workspace's own committed repo, unaffected by the assignmentId's content");
    },
  },

  // ------------------------------------------------------------------
  // Scenario Outline: owner/repo parses from every cloneUrl shape, incl. GHES API-base
  // ------------------------------------------------------------------
  {
    name: "task01/38 github-app-mint-scoped: Examples — owner/repo parses from every cloneUrl shape, incl. GHES API-base",
    run: () => {
      const rows = [
        { cloneUrl: "https://github.com/acme/secret.git", owner: "acme", repo: "secret", apiBase: "https://api.github.com" },
        { cloneUrl: "git@github.com:acme/secret.git", owner: "acme", repo: "secret", apiBase: "https://api.github.com" },
        { cloneUrl: "https://ghe.example.com/acme/secret.git", owner: "acme", repo: "secret", apiBase: "https://ghe.example.com/api/v3" },
        // Craft R1 (defensive, additional coverage beyond the locked feature contract) —
        // a NON-http(s) scheme's `:PORT` (the SSH/clone port) must NOT leak into the
        // GHES apiBaseUrl (the mint always talks HTTPS): `ssh://host:22/...` resolves
        // to `https://host/api/v3`, never `https://host:22/api/v3`.
        { cloneUrl: "ssh://git@ghe.example.com:22/acme/repo.git", owner: "acme", repo: "repo", apiBase: "https://ghe.example.com/api/v3" },
        // ...while an EXPLICIT https-scheme clone URL's own port IS preserved (a GHES
        // instance whose API genuinely sits behind a non-default port) — the fix is
        // scheme-gated, not a blanket port-strip.
        { cloneUrl: "https://ghe.example.com:8443/acme/repo.git", owner: "acme", repo: "repo", apiBase: "https://ghe.example.com:8443/api/v3" },
      ];
      for (const row of rows) {
        const parsed = parseRepoFromCloneUrl(row.cloneUrl);
        assert.ok(parsed != null, `[${row.cloneUrl}] parses`);
        assert.equal(parsed.owner, row.owner, `[${row.cloneUrl}] owner`);
        assert.equal(parsed.repo, row.repo, `[${row.cloneUrl}] repo`);
        assert.equal(parsed.apiBaseUrl, row.apiBase, `[${row.cloneUrl}] apiBaseUrl`);
      }
    },
  },

  // ------------------------------------------------------------------
  // Scenario: the installation id is auto-resolved on demand; an override skips it
  // ------------------------------------------------------------------
  {
    name: "task01/38 github-app-mint-scoped: the installation id is auto-resolved via GET .../installation BEFORE the token exchange — AT MOST two sequential HTTP calls, no retry between them; a configured installationId override skips the resolve call",
    run: async () => {
      const { privateKey } = generateThrowawayKeypair();
      // Row A — no override: exactly two calls, in order (resolve, then exchange).
      {
        const httpRequest = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 777 }) : jsonResponse(201, { token: "TOKEN-A" })));
        const mint = createGithubAppMintProvider({ resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }), httpRequest, resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git" });
        const token = await mint("ws-a", "asg-a");
        assert.equal(token, "TOKEN-A");
        assert.equal(httpRequest.calls.length, 2, "at most two sequential HTTP calls");
        assert.ok(httpRequest.calls[0].url.endsWith("/installation"), "the FIRST call resolves the installation");
        assert.ok(httpRequest.calls[1].url.includes("/access_tokens"), "the SECOND call exchanges for the token");
        assert.ok(httpRequest.calls[1].url.includes("/installations/777/"), "the resolved installation id feeds the exchange URL");
      }
      // Row B — an explicit installationId override: exactly ONE call (the exchange);
      // the resolve call is skipped entirely.
      {
        const httpRequest = createFakeHttpRequest(async () => jsonResponse(201, { token: "TOKEN-B" }));
        const mint = createGithubAppMintProvider({ resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey, installationId: 999 }), httpRequest, resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git" });
        const token = await mint("ws-a", "asg-b");
        assert.equal(token, "TOKEN-B");
        assert.equal(httpRequest.calls.length, 1, "the resolve call is skipped when an installationId override is configured");
        assert.ok(httpRequest.calls[0].url.includes("/installations/999/"), "the configured installationId is used instead");
      }
    },
  },
];
