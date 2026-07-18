// src/mesh-clone-credential-provider.mjs — milestone 38 / story 02 (ADR-010),
// extended by story 03 (ADR-011): the config-selected clone-credential-mint PROVIDER
// at the ADR-009 `mintCloneCredential` seam (control-stream-server.mjs). Two exports:
//
//   resolveCloneCredentialProvider(config, deps) — the SELECTOR. Reads
//   `config.mesh.repo.credential.provider` via the RAW optional-chain idiom (never
//   the config-editor whitelist, which would drop an unknown sibling `mesh` key on
//   rewrite — the m22/ADR-005 lesson):
//     - absent, or `"env-token"` -> returns control-stream-server.mjs's OWN
//       `defaultMintCloneCredential`, the EXACT function reference — byte-identical
//       behaviour to today, never a re-implementation.
//     - `"github-app"` -> `createGithubAppMintProvider({ ...deps, config })`.
//     - anything else (a blank string, an unrecognised name, a non-string value) ->
//       THROWS LOUDLY, coded `CLONE_CREDENTIAL_PROVIDER_UNKNOWN` — never a silent
//       degrade to `env-token` (SECURITY T10 applied to selection itself).
//
//   createGithubAppMintProvider(deps) — the `github-app` mint. Given a `workspaceId`,
//   resolves the App IDENTITY PER-ASSIGNED-WORKSPACE via `deps.resolveWorkspaceAppIdentity(workspaceId)`
//   (ADR-011, story 03 — mirrors `resolveWorkspaceCloneUrl` verbatim; the provider
//   closes over NO static `appId`/`privateKey` reused across every mint), resolves
//   the repo (`deps.resolveWorkspaceCloneUrl`, CONTROL-trusted — ADR-010 Gap A, never
//   the worker's frame), signs an App JWT (RS256 via `node:crypto`, RESEARCH §3.1 —
//   zero new dependency), auto-resolves the installation id (or uses the resolved
//   identity's own `installationId` override, RESEARCH §3.3), and exchanges it for a
//   SINGLE-repo `contents:read` installation access token (RESEARCH §3.2 — the
//   code-enforcement that closes SECURITY T4/T9, F6). A fault at ANY step THROWS
//   (never `null`, never a fallback) — ADR-010 decision 5 / SECURITY T10: the
//   caller's existing `try/catch` (`applyCloneCredentialRequestFrame`,
//   control-stream-server.mjs) converts any throw into the loud coded
//   `clone-credential-mint-failed`. A `resolveWorkspaceAppIdentity(workspaceId)` that
//   resolves to `null` (no usable `appId` + readable `privateKey` for THIS workspace)
//   is the SAME loud-throw fault (ADR-011 invariant #2, SECURITY T12) — never a
//   fallback to a sibling workspace's or the launch workspace's already-resolved
//   identity; nothing in this closure ever reads any identity but the ONE this ONE
//   call resolved for this ONE `workspaceId`.
//
// SECURITY F5 (`acd-clone-app-key-not-relayed`, T8): the App private key flows ONLY
// into `defaultSignAppJwt`'s `createSign(...).sign(privateKey)` call — never a frame,
// never a log/warn/error sink, never assigned onto `process.env`. Every thrown error
// message in this module is a FIXED, key/token-free string (never string-interpolates
// `privateKey`/`jwt`/the minted `token`) — the redaction discipline SECURITY requires
// holds BY CONSTRUCTION, not by a post-hoc scrub.
import { createSign } from "node:crypto";
import { defaultMintCloneCredential } from "./control-stream-server.mjs";
import { parseRepoFromCloneUrl } from "./mesh-worker-execution.mjs";

export const CLONE_CREDENTIAL_PROVIDER_UNKNOWN = "clone-credential-provider-unknown";

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// defaultSignAppJwt({ appId, privateKey, now }) — the REAL production signer: RS256
// via `node:crypto` ALONE (RESEARCH §3.1 — no `jsonwebtoken`/`jose`/octokit
// dependency). `now` is a `Date` (injectable — defaults to `new Date()`); `iat` is
// backdated 60s (GitHub's own documented clock-skew recommendation), `exp` = `iat +
// 600` — exactly the measured 10-minute ceiling (RESEARCH §3.1: "9-minute lifetime +
// the docs' recommended 60s backdate = inside the 10-minute ceiling with headroom").
// THE APP PRIVATE KEY REACHES ONLY THIS CALL (SECURITY F5/T8) — never logged, never
// assigned elsewhere, never on a frame.
export function defaultSignAppJwt({ appId, privateKey, now = new Date() } = {}) {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

// defaultHttpRequest(url, init) — the REAL production HTTP seam: native `fetch`
// (Node 22, RESEARCH §3.1 — no new dependency). `@executable` tests ALWAYS override
// this with a fake recording client — no `@executable` test ever reaches the real
// network (the real GitHub mint is task 05's `@manual` soak).
async function defaultHttpRequest(url, init) {
  return fetch(url, init);
}

// mintFailure(message) — every thrown fault in this module goes through here. The
// message is ALWAYS a fixed, hand-written string naming the FAILING STEP — never an
// interpolation of `privateKey`, the signed JWT, or a minted `token` value (SECURITY
// F5's redaction-by-construction: there is no code path in this module that could
// place a secret into an error message, because no error-message template below ever
// references one).
function mintFailure(message) {
  const error = new Error(message);
  error.code = "github-app-mint-failed";
  return error;
}

// createGithubAppMintProvider(deps) — see module doc above for the flow. `deps`:
//   resolveWorkspaceAppIdentity(workspaceId) => Promise<{appId, privateKey,
//     installationId}|null> | {appId, privateKey, installationId}|null — the
//     PER-ASSIGNED-WORKSPACE App identity seam (ADR-011, story 03; mirrors
//     `resolveWorkspaceCloneUrl` verbatim, supplied by the launcher, keyed by the
//     mint's OWN `workspaceId`). REQUIRED — this closure never falls back to a
//     static identity of its own.
//   resolveWorkspaceCloneUrl(workspaceId) => Promise<string|null> | string|null — the
//     CONTROL-trusted repo source (ADR-010 Gap A; supplied by the launcher).
//   config                  — OPTIONAL, threaded ONLY into `parseRepoFromCloneUrl`
//     for its GHES `apiBaseUrl` override.
//   signAppJwt, httpRequest, now — INJECTABLE seams (default: the REAL node:crypto
//     signer above, real `fetch`, real `Date`). `@executable` tests inject a fake
//     `httpRequest` (recording the request bodies, scripting responses) and a
//     THROWAWAY (test-generated, not a real GitHub App's) RSA key alongside the REAL
//     default signer — so "signs with node:crypto RS256" is a genuine assertion
//     against production code, never a vacuous stand-in for it.
export function createGithubAppMintProvider({
  resolveWorkspaceAppIdentity,
  resolveWorkspaceCloneUrl,
  config = null,
  signAppJwt = defaultSignAppJwt,
  httpRequest = defaultHttpRequest,
  now = () => new Date(),
} = {}) {
  const mintCloneCredential = async function mintCloneCredential(workspaceId /*, assignmentId */) {
    // ADR-011 / SECURITY T12 — the App IDENTITY is resolved FRESH, keyed by THIS
    // mint's OWN workspaceId, through the injected seam — never a single static
    // appId/privateKey this closure carries across every mint, and never a fallback
    // to a sibling workspace's or the launch workspace's identity. A null/incomplete
    // resolution (no usable appId + readable privateKey for this workspace) is the
    // SAME loud coded fault every other step on this seam throws.
    if (typeof resolveWorkspaceAppIdentity !== "function") {
      throw mintFailure("github-app mint: no resolveWorkspaceAppIdentity seam was supplied");
    }
    const identity = await resolveWorkspaceAppIdentity(workspaceId);
    if (
      identity == null
      || typeof identity.appId !== "string" || identity.appId.length === 0
      || typeof identity.privateKey !== "string" || identity.privateKey.length === 0
    ) {
      throw mintFailure(`github-app mint: no usable App identity resolved for workspace "${workspaceId}"`);
    }
    const { appId, privateKey } = identity;
    const configuredInstallationId = identity.installationId ?? null;

    if (typeof resolveWorkspaceCloneUrl !== "function") {
      throw mintFailure("github-app mint: no resolveWorkspaceCloneUrl seam was supplied");
    }
    const cloneUrl = await resolveWorkspaceCloneUrl(workspaceId);
    if (typeof cloneUrl !== "string" || cloneUrl.trim().length === 0) {
      throw mintFailure(`github-app mint: no cloneUrl resolved for workspace "${workspaceId}"`);
    }
    const parsed = parseRepoFromCloneUrl(cloneUrl, config);
    if (parsed == null) {
      throw mintFailure(`github-app mint: cloneUrl for workspace "${workspaceId}" does not parse to an owner/repo`);
    }
    const { owner, repo, apiBaseUrl } = parsed;

    let jwt;
    try {
      jwt = signAppJwt({ appId, privateKey, now: now() });
    } catch {
      // The underlying error (e.g. node:crypto rejecting a malformed key) is NEVER
      // forwarded verbatim — some crypto error messages echo back input; a fixed
      // message names only the STEP that failed.
      throw mintFailure("github-app mint: JWT signing failed");
    }
    if (typeof jwt !== "string" || jwt.length === 0) {
      throw mintFailure("github-app mint: JWT signer returned no token");
    }

    const authHeaders = {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // RESEARCH §3.3 — auto-resolve by default (self-healing across an
    // uninstall/reinstall); an explicit `installationId` override short-circuits this
    // ONE call, at the operator's own staleness risk (ADR-010 decision 3).
    let installationIdToUse = configuredInstallationId;
    if (installationIdToUse == null) {
      let installationResponse;
      try {
        installationResponse = await httpRequest(`${apiBaseUrl}/repos/${owner}/${repo}/installation`, {
          method: "GET",
          headers: authHeaders,
        });
      } catch {
        throw mintFailure("github-app mint: installation lookup unreachable");
      }
      if (!installationResponse?.ok) {
        throw mintFailure(`github-app mint: installation lookup failed (status ${installationResponse?.status ?? "unknown"})`);
      }
      // Craft R3 (defensive) — a 2xx response whose body is not valid JSON must still
      // surface the FIXED, coded mint failure, never a raw SyntaxError escaping this
      // function (which the caller's try/catch would still convert to the loud coded
      // refusal, but only via an UNNAMED step — this keeps every fault on this seam
      // naming its own failing step, consistent with every other guard in this mint).
      let installationBody;
      try {
        installationBody = await installationResponse.json();
      } catch {
        throw mintFailure("github-app mint: installation lookup returned a malformed response body");
      }
      installationIdToUse = installationBody?.id ?? null;
      if (installationIdToUse == null) {
        throw mintFailure("github-app mint: installation lookup returned no id");
      }
    }

    // RESEARCH §3.2 / SECURITY F6/T9 — the SINGLE-repo, `contents:read` request body.
    // Never omit `repositories`, never more than the ONE assigned repo, never a
    // permission set broader than `{ contents: "read" }`.
    let exchangeResponse;
    try {
      exchangeResponse = await httpRequest(`${apiBaseUrl}/app/installations/${installationIdToUse}/access_tokens`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ repositories: [repo], permissions: { contents: "read" } }),
      });
    } catch {
      throw mintFailure("github-app mint: token exchange unreachable");
    }
    if (!exchangeResponse?.ok) {
      throw mintFailure(`github-app mint: token exchange failed (status ${exchangeResponse?.status ?? "unknown"})`);
    }
    // Craft R3 (defensive) — same guard as the installation lookup above: a malformed
    // 2xx exchange body is the coded mint failure, never a raw SyntaxError.
    let exchangeBody;
    try {
      exchangeBody = await exchangeResponse.json();
    } catch {
      throw mintFailure("github-app mint: token exchange returned a malformed response body");
    }
    const token = exchangeBody?.token;
    if (typeof token !== "string" || token.length === 0) {
      throw mintFailure("github-app mint: token exchange returned a blank/absent token");
    }
    return token;
  };
  // A diagnostic-only marker (never a secret) — lets a caller (and this story's own
  // task 00 traceability test) confirm the PRODUCTION wiring genuinely selected this
  // provider, not merely "some function", without needing to invoke a real mint.
  mintCloneCredential.providerName = "github-app";
  return mintCloneCredential;
}

// resolveCloneCredentialProvider(config, deps) — the ADR-010 selector, see module doc
// above. Returns `{ mintCloneCredential, provider }` — `provider` is a diagnostic
// label only (the launcher's own `mintCloneCredential:` literal key at the production
// `startServer({...})` call site is what actually wires it, ADR-010 decision 1 / F7).
export function resolveCloneCredentialProvider(config, deps = {}) {
  const provider = config?.mesh?.repo?.credential?.provider;
  if (provider === undefined || provider === "env-token") {
    return { mintCloneCredential: defaultMintCloneCredential, provider: "env-token" };
  }
  if (provider === "github-app") {
    return { mintCloneCredential: createGithubAppMintProvider({ ...deps, config }), provider: "github-app" };
  }
  const error = new Error(
    `unknown clone-credential provider ${JSON.stringify(provider)} at config.mesh.repo.credential.provider — refusing to start with an unresolved mint`,
  );
  error.code = CLONE_CREDENTIAL_PROVIDER_UNKNOWN;
  throw error;
}
