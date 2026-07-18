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
//
// MILESTONE 38 / STORY 07 (ADR-015, task 02) — a THIRD export, `createGithubAppPushMintProvider(deps)`:
// the write-scoped mint minted ONLY at the push seam (SECURITY T15, RE-OPENS T9). THE
// BUILD-OWED DECISION (aof-qa flag at refine): this is a SEPARATE exported
// function/module, NOT a widened branch of `createGithubAppMintProvider` — a FULLY
// INDEPENDENT implementation, sharing NO internal helper with the clone mint (the
// identity/JWT/installation-resolution STEPS mirror it closely but are written
// inline, separately, in each function's own closure). Two reasons, both load-
// bearing: (1) the `access_tokens` request BODY — the one thing SECURITY T15/T9 cares
// about — is then structurally unreachable from `createGithubAppMintProvider`'s own
// closure by construction, never merely "unreachable in practice"; (2) the
// pre-existing `acd-cross-org-key-isolation` fitness function (story 03, ADR-011)
// scans `createGithubAppMintProvider`'s OWN function body for specific literal
// patterns (`resolveWorkspaceAppIdentity(workspaceId)`, the `identity == null` throw,
// no outer-scope identity cache) — factoring that logic out from under it would
// silently make that detector vacuous, this milestone's own repeated lesson. The
// clone mint's OWN body stays BYTE-IDENTICAL to its pre-story-07 shape (single-repo
// `contents:read`, never widened) — see the rewritten two-seam
// `test/arch/acd-minted-token-scoped-single-repo.test.mjs` (SECURITY T15) that anchors
// on this exact function-name split.
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

// mintFailure(message, code) — every thrown fault in this module goes through here.
// The message is ALWAYS a fixed, hand-written string naming the FAILING STEP — never
// an interpolation of `privateKey`, the signed JWT, or a minted `token` value
// (SECURITY F5's redaction-by-construction: there is no code path in this module that
// could place a secret into an error message, because no error-message template below
// ever references one). `code` defaults to the clone mint's existing coded fault; the
// push mint (below) passes its OWN distinct code so a caller can tell which seam
// failed without parsing the message text.
function mintFailure(message, code = "github-app-mint-failed") {
  const error = new Error(message);
  error.code = code;
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

    // RESEARCH §3.2 / SECURITY F6/T9 (unchanged by story 07/T15 — this clause is the
    // NEVER-WIDENED clone half of the rewritten two-seam
    // acd-minted-token-scoped-single-repo detector, which anchors on THIS literal
    // object). Never omit `repositories`, never more than the ONE assigned repo,
    // never a permission set broader than `{ contents: "read" }`.
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

// createGithubAppPushMintProvider(deps) — milestone 38 / story 07 (ADR-015 decision 3;
// SECURITY T15, RE-OPENS T9). THE BUILD-OWED DECISION (aof-qa flag at refine): a
// SEPARATE exported function/module, NOT a widened branch of
// `createGithubAppMintProvider` above — deliberately a FULLY INDEPENDENT
// implementation (no shared internal helper with the clone mint, even though the
// identity/JWT/installation-resolution STEPS mirror it closely) so (a) the write
// body can never be produced by any code path the clone mint's own closure reaches,
// and (b) the pre-existing acd-cross-org-key-isolation fitness function (story 03,
// ADR-011) — which scans `createGithubAppMintProvider`'s OWN function body for the
// literal `resolveWorkspaceAppIdentity(workspaceId)` call, the `identity == null`
// throw, and no outer-scope identity cache — keeps finding those patterns INSIDE that
// function, exactly where it already expects them; factoring shared plumbing out from
// under it would silently make that detector vacuous (this milestone's own repeated
// lesson). ADR-011/T12's per-workspace-fresh discipline is honoured identically here
// — a write grant is MORE dangerous to leak across workspaces than a read one, never
// less. `deps` mirrors `createGithubAppMintProvider`'s shape verbatim; the returned
// `mintWriteCredential(workspaceId, assignmentId, { autoPr })` takes a PER-CALL
// `autoPr` flag (default `false`, the DOCUMENTED DEFAULT — "done" is a pushed branch,
// opening a PR is optional/manual, ADR-015). A fault at ANY step THROWS (never
// `null`, never a fallback) — the SAME loud-failure discipline the clone mint keeps,
// coded `github-app-push-mint-failed` (distinct from the clone mint's own code, so a
// caller can tell the two seams apart without parsing the message text).
export function createGithubAppPushMintProvider({
  resolveWorkspaceAppIdentity,
  resolveWorkspaceCloneUrl,
  config = null,
  signAppJwt = defaultSignAppJwt,
  httpRequest = defaultHttpRequest,
  now = () => new Date(),
} = {}) {
  const mintWriteCredential = async function mintWriteCredential(workspaceId, /* assignmentId, unused — kept for signature symmetry with the clone mint */ _assignmentId, { autoPr = false } = {}) {
    // ADR-011 / SECURITY T12, mirrored (never shared) from the clone mint above — the
    // App IDENTITY is resolved FRESH, keyed by THIS mint's OWN workspaceId, through
    // the injected seam. A write grant is MORE dangerous to leak across workspaces
    // than a read one, never less — the identical discipline applies unchanged.
    if (typeof resolveWorkspaceAppIdentity !== "function") {
      throw mintFailure("github-app push mint: no resolveWorkspaceAppIdentity seam was supplied", "github-app-push-mint-failed");
    }
    const identity = await resolveWorkspaceAppIdentity(workspaceId);
    if (
      identity == null
      || typeof identity.appId !== "string" || identity.appId.length === 0
      || typeof identity.privateKey !== "string" || identity.privateKey.length === 0
    ) {
      throw mintFailure(`github-app push mint: no usable App identity resolved for workspace "${workspaceId}"`, "github-app-push-mint-failed");
    }
    const { appId, privateKey } = identity;
    const configuredInstallationId = identity.installationId ?? null;

    if (typeof resolveWorkspaceCloneUrl !== "function") {
      throw mintFailure("github-app push mint: no resolveWorkspaceCloneUrl seam was supplied", "github-app-push-mint-failed");
    }
    const cloneUrl = await resolveWorkspaceCloneUrl(workspaceId);
    if (typeof cloneUrl !== "string" || cloneUrl.trim().length === 0) {
      throw mintFailure(`github-app push mint: no cloneUrl resolved for workspace "${workspaceId}"`, "github-app-push-mint-failed");
    }
    const parsed = parseRepoFromCloneUrl(cloneUrl, config);
    if (parsed == null) {
      throw mintFailure(`github-app push mint: cloneUrl for workspace "${workspaceId}" does not parse to an owner/repo`, "github-app-push-mint-failed");
    }
    const { owner, repo, apiBaseUrl } = parsed;

    let jwt;
    try {
      jwt = signAppJwt({ appId, privateKey, now: now() });
    } catch {
      throw mintFailure("github-app push mint: JWT signing failed", "github-app-push-mint-failed");
    }
    if (typeof jwt !== "string" || jwt.length === 0) {
      throw mintFailure("github-app push mint: JWT signer returned no token", "github-app-push-mint-failed");
    }

    const authHeaders = {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    let installationIdToUse = configuredInstallationId;
    if (installationIdToUse == null) {
      let installationResponse;
      try {
        installationResponse = await httpRequest(`${apiBaseUrl}/repos/${owner}/${repo}/installation`, {
          method: "GET",
          headers: authHeaders,
        });
      } catch {
        throw mintFailure("github-app push mint: installation lookup unreachable", "github-app-push-mint-failed");
      }
      if (!installationResponse?.ok) {
        throw mintFailure(`github-app push mint: installation lookup failed (status ${installationResponse?.status ?? "unknown"})`, "github-app-push-mint-failed");
      }
      let installationBody;
      try {
        installationBody = await installationResponse.json();
      } catch {
        throw mintFailure("github-app push mint: installation lookup returned a malformed response body", "github-app-push-mint-failed");
      }
      installationIdToUse = installationBody?.id ?? null;
      if (installationIdToUse == null) {
        throw mintFailure("github-app push mint: installation lookup returned no id", "github-app-push-mint-failed");
      }
    }

    // SECURITY T15/T9 — the SINGLE-repo, WRITE-scoped request body. This is the ONLY
    // `access_tokens` call in this whole module that may ever request a write scope —
    // the rewritten acd-minted-token-scoped-single-repo detector anchors on THIS
    // function's own text span to prove that (never reachable from
    // createGithubAppMintProvider's closure above). `permissions` is EXACTLY
    // `{ contents: "write" }` when auto-PR is off (the default), widening ONLY to ALSO
    // carry `pull_requests: "write"` when the caller opts in — never anything
    // broader, never a second repo, never omitted.
    let exchangeResponse;
    try {
      exchangeResponse = await httpRequest(`${apiBaseUrl}/app/installations/${installationIdToUse}/access_tokens`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          repositories: [repo],
          permissions: autoPr
            ? { contents: "write", pull_requests: "write" }
            : { contents: "write" },
        }),
      });
    } catch {
      throw mintFailure("github-app push mint: token exchange unreachable", "github-app-push-mint-failed");
    }
    if (!exchangeResponse?.ok) {
      throw mintFailure(`github-app push mint: token exchange failed (status ${exchangeResponse?.status ?? "unknown"})`, "github-app-push-mint-failed");
    }
    let exchangeBody;
    try {
      exchangeBody = await exchangeResponse.json();
    } catch {
      throw mintFailure("github-app push mint: token exchange returned a malformed response body", "github-app-push-mint-failed");
    }
    const token = exchangeBody?.token;
    if (typeof token !== "string" || token.length === 0) {
      throw mintFailure("github-app push mint: token exchange returned a blank/absent token", "github-app-push-mint-failed");
    }
    return token;
  };
  mintWriteCredential.providerName = "github-app-write";
  return mintWriteCredential;
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

// resolveWriteCredentialProvider(config, deps) — milestone 38 / story 07 (ADR-015
// decision 3). Reads the SAME `config.mesh.repo.credential.provider` key the clone
// selector above reads (one configured provider, two seams) — `deps` mirrors
// `resolveCloneCredentialProvider`'s shape (`resolveWorkspaceCloneUrl`,
// `resolveWorkspaceAppIdentity`). Unlike the clone selector, `env-token` (or
// unconfigured) has NO write-mint equivalent — a static, standing PAT is exactly the
// broad, run-long credential story 07 (T15) exists to NOT hand out for a write grant —
// so that path resolves `mintWriteCredential: undefined`, and
// `applyWriteCredentialRequestFrame`'s own default (`defaultMintWriteCredential`,
// control-stream-server.mjs) resolves to `null` — an honest "no write credential
// configured", exactly mirroring the clone path's OWN "no credential configured for
// this workspace" default (an unauthenticated push, never a silently-broadened
// fallback). Only `"github-app"` has a write mint: `createGithubAppPushMintProvider`
// (this module, task 02) — a SEPARATE function/module from the clone mint, per the
// BUILD-OWED DECISION.
export function resolveWriteCredentialProvider(config, deps = {}) {
  const provider = config?.mesh?.repo?.credential?.provider;
  if (provider === "github-app") {
    return { mintWriteCredential: createGithubAppPushMintProvider({ ...deps, config }), provider: "github-app" };
  }
  return { mintWriteCredential: undefined, provider: provider === undefined ? "env-token" : provider };
}
