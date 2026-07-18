// Fitness function: acd-cross-org-key-isolation (milestone 38 / story 03, ADR-011;
// SECURITY T12 — architect/developer-owned)
//
// ARMED AT BUILD, now that the per-workspace App-identity seam exists
// (src/mesh-clone-credential-provider.mjs, src/mesh-launcher.mjs) — a detector
// authored earlier would have scanned absent production wiring (the ADR-008 /
// SECURITY-F5/F6 deferral precedent this milestone's own lesson pins). Arms ALL FOUR
// ADR-011 structural invariants:
//   1. App identity is per-workspace, keyed by the mint's workspaceId — a
//      `resolveWorkspaceAppIdentity`-shaped seam, consulted with EXACTLY the mint's
//      own `workspaceId`; the provider does not close over a single static
//      `appId`/`privateKey` applied to every mint.
//   2. No cross-org borrow. No code path mints workspace A's token with an identity
//      resolved from a workspace whose id != A; a null-resolved identity THROWS the
//      loud coded refusal, never falls back to a sibling's identity or the launch
//      workspace's App.
//   3. The default private-key directory is `<meshRoot>/credentials/`, code-composed
//      via `globalMeshPaths` — never a config-supplied default that could point at a
//      synced tree, never a `homedir()` + sync-folder path.
//   4. The mint seam signature and the F15 worker-frame-drops-cloneUrl posture are
//      preserved — identity is keyed by the F15-bound `workspaceId`, not by the
//      worker's frame.
//
// Non-negotiable plant discipline (this milestone's own hard lesson, ADR-008): the
// tree is CRLF. Every plant below is a SYNTHESIZED snippet built with explicit "\n"
// joins (Array#join("\n")) — never a string-replace on a real file, which would
// silently no-op against CRLF source and leave the self-check VACUOUS. The real
// source is asserted clean under every detector FIRST; each plant is asserted to
// actually DIFFER from its own clean synthesized baseline (`notEqual`) BEFORE
// asserting it trips the detector — a plant that silently no-ops makes the check
// vacuous. Invariant #2 names TWO distinct secrets/identities (a SIBLING workspace's
// App, and the LAUNCH workspace's App) — enumerated as two separate plants, never
// combined into one.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const providerSourcePath = path.join(repoRoot, "src", "mesh-clone-credential-provider.mjs");
const launcherSourcePath = path.join(repoRoot, "src", "mesh-launcher.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// lf(source) — normalise CRLF -> LF for the REAL files read below (the repo's own
// checkout convention on this platform; see module doc above).
function lf(source) {
  return source.replace(/\r\n/g, "\n");
}

function sliceBalanced(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

function sliceBalancedParens(source, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, i);
    }
  }
  return null;
}

// topLevelEntries(objectBody) -> { keys, spreads } — the DEPTH-0 entries of an object
// literal / destructuring pattern (extends the sibling ADR-010 arch tests' idiom with
// an `=` terminator too — this module inspects DESTRUCTURED PARAMETER lists, where a
// `key = defaultValue` shorthand is common, not only `key: value` object-literal
// entries).
function topLevelEntries(objectBody) {
  const keys = [];
  const spreads = [];
  let depth = 0;
  let segment = "";
  const flush = () => {
    const trimmed = segment.trim();
    segment = "";
    if (trimmed.length === 0) return;
    if (trimmed.startsWith("...")) {
      spreads.push(trimmed);
      return;
    }
    const named = /^([A-Za-z_$][\w$]*)\s*(?::|=|$)/.exec(trimmed);
    if (named) keys.push(named[1]);
  };
  for (const ch of objectBody) {
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      flush();
      continue;
    }
    segment += ch;
  }
  flush();
  return { keys, spreads };
}

// functionBody(source, anchorText) — the BODY (brace-balanced, params excluded) of
// the first function whose declaration the anchor text names.
function functionBody(source, anchorText) {
  const code = stripComments(source);
  const anchor = code.indexOf(anchorText);
  if (anchor === -1) return null;
  const parenOpen = code.indexOf("(", anchor);
  if (parenOpen === -1) return null;
  const paramsText = sliceBalancedParens(code, parenOpen);
  if (paramsText == null) return null;
  const bodyOpen = code.indexOf("{", parenOpen + paramsText.length + 2);
  return bodyOpen === -1 ? null : sliceBalanced(code, bodyOpen);
}

// functionParams(source, anchorText) — the raw parameter-list TEXT (brace/paren
// content between the anchor's `(` and its balanced `)`), for inspecting the
// destructured parameter NAMES a function declares.
function functionParams(source, anchorText) {
  const code = stripComments(source);
  const anchor = code.indexOf(anchorText);
  if (anchor === -1) return null;
  const parenOpen = code.indexOf("(", anchor);
  if (parenOpen === -1) return null;
  return sliceBalancedParens(code, parenOpen);
}

function destructuredKeys(paramsText) {
  if (paramsText == null) return [];
  const braceOpen = paramsText.indexOf("{");
  if (braceOpen === -1) return [];
  const inner = sliceBalanced(paramsText, braceOpen);
  if (inner == null) return [];
  return topLevelEntries(inner).keys;
}

// ---------------------------------------------------------------------------------
// INVARIANT #1 — App identity is per-workspace, keyed by the mint's workspaceId; no
// static appId/privateKey applied to every mint.
// ---------------------------------------------------------------------------------
function staticIdentityProblems(providerSource) {
  const problems = [];
  const anchor = "export function createGithubAppMintProvider";
  const paramsText = functionParams(providerSource, anchor);
  const body = functionBody(providerSource, anchor);
  if (paramsText == null || body == null) {
    problems.push("could not locate createGithubAppMintProvider's declaration");
    return problems;
  }
  const keys = destructuredKeys(paramsText);
  if (!keys.includes("resolveWorkspaceAppIdentity")) {
    problems.push("createGithubAppMintProvider's parameter list does not destructure resolveWorkspaceAppIdentity — the provider has no per-workspace identity seam to consult");
  }
  if (keys.includes("appId")) {
    problems.push("createGithubAppMintProvider destructures a STATIC appId parameter — a single appId could be applied to every mint");
  }
  if (keys.includes("privateKey")) {
    problems.push("createGithubAppMintProvider destructures a STATIC privateKey parameter — a single privateKey could be applied to every mint");
  }
  if (!/resolveWorkspaceAppIdentity\s*\(\s*workspaceId\s*\)/.test(body)) {
    problems.push("the provider body never calls resolveWorkspaceAppIdentity(workspaceId) — identity is not genuinely resolved per mint");
  }
  return problems;
}

// ---------------------------------------------------------------------------------
// INVARIANT #2 (provider half) — a null/incomplete identity THROWS; no ??/|| fallback
// chained onto the resolve call; no cross-call cache in the provider's own scope.
// ---------------------------------------------------------------------------------
function providerBorrowProblems(providerSource) {
  const problems = [];
  const body = functionBody(providerSource, "export function createGithubAppMintProvider");
  if (body == null) {
    problems.push("could not locate createGithubAppMintProvider's body");
    return problems;
  }
  if (/resolveWorkspaceAppIdentity\s*\(\s*workspaceId\s*\)\s*\)?\s*(\?\?|\|\|)/.test(body)) {
    problems.push("the resolveWorkspaceAppIdentity(workspaceId) result is chained onto a ?? / || fallback — a null/incomplete identity could silently default instead of throwing");
  }
  const nullCheckIdx = body.search(/identity\s*==\s*null/);
  if (nullCheckIdx === -1) {
    problems.push("no `identity == null` check found — a null-resolved identity is never distinguished from a usable one");
  } else {
    const after = body.slice(nullCheckIdx, nullCheckIdx + 400);
    if (!/throw\s+mintFailure/.test(after)) {
      problems.push("a null-resolved identity is not followed by `throw mintFailure(...)` — the provider may proceed with an unusable identity instead of refusing loudly");
    }
  }
  const closureIdx = body.search(/mintCloneCredential\s*=\s*async\s+function/);
  const outerScope = closureIdx === -1 ? "" : body.slice(0, closureIdx);
  if (/\b(let|var)\s+\w*(identity|appId|privateKey)\w*/i.test(outerScope)) {
    problems.push("createGithubAppMintProvider's OUTER scope declares a mutable identity-shaped variable — a cross-call cache could carry one mint's identity into the next");
  }
  return problems;
}

// ---------------------------------------------------------------------------------
// INVARIANT #2 (launcher half) — resolution reads ONLY the target workspace's own
// descriptor-resolved config, or the launch workspace's own config; never a
// sibling's; never a cross-call cache/registry.
// ---------------------------------------------------------------------------------
function launcherBorrowProblems(launcherSource) {
  const problems = [];
  const anchor = "export function createResolveWorkspaceAppIdentity";
  const body = functionBody(launcherSource, anchor);
  if (body == null) {
    problems.push("could not locate createResolveWorkspaceAppIdentity's body");
    return problems;
  }
  if (!/workspaceId\s*===\s*ownWorkspaceId/.test(body)) {
    problems.push("no `workspaceId === ownWorkspaceId` branch found — the launch workspace's own identity is not distinguished from an assigned workspace's own");
  }
  if (!/resolveWorkspaceProjectRoot\s*\(\s*workspaceId/.test(body)) {
    problems.push("the non-launch branch never resolves the TARGET workspace's OWN descriptor via resolveWorkspaceProjectRoot(workspaceId, ...) — it cannot be reading that workspace's own committed config");
  }
  const returnIdx = body.search(/return\s+async\s+function\s+resolveWorkspaceAppIdentity/);
  const builderScope = returnIdx === -1 ? body : body.slice(0, returnIdx);
  if (/new\s+Map\s*\(|\bcache\b/i.test(builderScope)) {
    problems.push("createResolveWorkspaceAppIdentity's builder scope declares a cache/registry — a cross-workspace identity could be reused instead of resolved fresh per call");
  }
  return problems;
}

// ---------------------------------------------------------------------------------
// INVARIANT #3 — the default private-key directory is <meshRoot>/credentials/,
// code-composed via globalMeshPaths — never a homedir()+sync-folder guess.
// ---------------------------------------------------------------------------------
function defaultKeyDirProblems(launcherSource) {
  const problems = [];
  const body = functionBody(launcherSource, "function defaultGithubAppPrivateKeyPath");
  if (body == null) {
    problems.push("could not locate defaultGithubAppPrivateKeyPath's body");
    return problems;
  }
  if (!/globalMeshPaths\s*\(/.test(body)) {
    problems.push("the default key path is not composed via globalMeshPaths(...) — it may be a homedir()+sync-folder guess instead");
  }
  if (!/["'`]credentials["'`]/.test(body)) {
    problems.push('the default key path never joins a literal "credentials" segment');
  }
  if (/\bhomedir\s*\(/.test(body)) {
    problems.push("the default key path calls homedir() directly — never a globalMeshPaths-composed path");
  }
  for (const syncSegment of ["Dropbox", "OneDrive", "iCloud", "Mobile Documents"]) {
    if (body.includes(syncSegment)) {
      problems.push(`the default key path literally references a sync-scoped segment (${syncSegment})`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------
// INVARIANT #4 — the mint seam signature stays keyed by workspaceId (the F15-bound
// value), not by the worker's frame.
// ---------------------------------------------------------------------------------
function mintSeamSignatureProblems(providerSource) {
  const code = stripComments(providerSource);
  const problems = [];
  const sigMatch = /mintCloneCredential\s*=\s*async\s+function\s+mintCloneCredential\s*\(([^)]*)\)/.exec(code);
  if (sigMatch == null) {
    problems.push("could not locate the mintCloneCredential closure's declared signature");
  } else {
    const firstParam = sigMatch[1].split(",")[0].trim();
    if (firstParam !== "workspaceId") {
      problems.push(`the mintCloneCredential closure's FIRST parameter is "${firstParam}", not "workspaceId" — the mint seam signature has drifted from the frozen ADR-009/010 shape`);
    }
  }
  if (!/resolveWorkspaceAppIdentity\s*\(\s*workspaceId\s*\)/.test(code)) {
    problems.push("resolveWorkspaceAppIdentity is never called with EXACTLY the mint's own workspaceId parameter — the F15-bound key may not be what identity resolution is keyed by");
  }
  return problems;
}

// ---------------------------------------------------------------------------------
// SELF-CHECK PLANT PLUMBING — SYNTHESIZED sources (Array#join("\n"), CRLF-safe by
// construction): never a string-replace on the real files.
// ---------------------------------------------------------------------------------
function synthesizeCleanProvider() {
  return [
    "export function createGithubAppMintProvider({",
    "  resolveWorkspaceAppIdentity,",
    "  resolveWorkspaceCloneUrl,",
    "  signAppJwt = defaultSignAppJwt,",
    "  httpRequest = defaultHttpRequest,",
    "  now = () => new Date(),",
    "} = {}) {",
    "  const mintCloneCredential = async function mintCloneCredential(workspaceId) {",
    "    const identity = await resolveWorkspaceAppIdentity(workspaceId);",
    "    if (identity == null) {",
    "      throw mintFailure(`no usable App identity resolved for workspace \"${workspaceId}\"`);",
    "    }",
    "    const { appId, privateKey } = identity;",
    "    const cloneUrl = await resolveWorkspaceCloneUrl(workspaceId);",
    "    const jwt = signAppJwt({ appId, privateKey, now: now() });",
    "    return jwt;",
    "  };",
    "  return mintCloneCredential;",
    "}",
  ].join("\n");
}

function synthesizeStaticIdentityProvider() {
  return [
    "export function createGithubAppMintProvider({",
    "  appId = null,",
    "  privateKey = null,",
    "  resolveWorkspaceCloneUrl,",
    "  signAppJwt = defaultSignAppJwt,",
    "  httpRequest = defaultHttpRequest,",
    "  now = () => new Date(),",
    "} = {}) {",
    "  const mintCloneCredential = async function mintCloneCredential(workspaceId) {",
    "    const cloneUrl = await resolveWorkspaceCloneUrl(workspaceId);",
    "    const jwt = signAppJwt({ appId, privateKey, now: now() });",
    "    return jwt;",
    "  };",
    "  return mintCloneCredential;",
    "}",
  ].join("\n");
}

// PLANT (2a) — a SIBLING'S already-resolved identity rescues a null resolution (a `??
// fallbackIdentity` chained directly onto the resolve call).
function synthesizeSiblingFallbackProvider() {
  return [
    "export function createGithubAppMintProvider({",
    "  resolveWorkspaceAppIdentity,",
    "  fallbackIdentity,",
    "  resolveWorkspaceCloneUrl,",
    "  signAppJwt = defaultSignAppJwt,",
    "  httpRequest = defaultHttpRequest,",
    "  now = () => new Date(),",
    "} = {}) {",
    "  const mintCloneCredential = async function mintCloneCredential(workspaceId) {",
    "    const identity = (await resolveWorkspaceAppIdentity(workspaceId)) ?? fallbackIdentity;",
    "    const { appId, privateKey } = identity;",
    "    const cloneUrl = await resolveWorkspaceCloneUrl(workspaceId);",
    "    const jwt = signAppJwt({ appId, privateKey, now: now() });",
    "    return jwt;",
    "  };",
    "  return mintCloneCredential;",
    "}",
  ].join("\n");
}

// PLANT (2b) — the LAUNCH workspace's own already-resolved identity is CACHED and
// reused across every subsequent mint (a distinct borrow shape from 2a's sibling
// fallback: here it is THIS closure's own prior successful resolution that leaks
// forward, never re-resolved fresh per workspaceId).
function synthesizeCachedLaunchIdentityProvider() {
  return [
    "export function createGithubAppMintProvider({",
    "  resolveWorkspaceAppIdentity,",
    "  resolveWorkspaceCloneUrl,",
    "  signAppJwt = defaultSignAppJwt,",
    "  httpRequest = defaultHttpRequest,",
    "  now = () => new Date(),",
    "} = {}) {",
    "  let lastResolvedIdentity = null;",
    "  const mintCloneCredential = async function mintCloneCredential(workspaceId) {",
    "    const identity = (await resolveWorkspaceAppIdentity(workspaceId)) ?? lastResolvedIdentity;",
    "    if (identity == null) { throw mintFailure(\"no identity\"); }",
    "    lastResolvedIdentity = identity;",
    "    const { appId, privateKey } = identity;",
    "    const cloneUrl = await resolveWorkspaceCloneUrl(workspaceId);",
    "    const jwt = signAppJwt({ appId, privateKey, now: now() });",
    "    return jwt;",
    "  };",
    "  return mintCloneCredential;",
    "}",
  ].join("\n");
}

function synthesizeCleanResolver() {
  return [
    "export function createResolveWorkspaceAppIdentity(ws, options = {}) {",
    "  const ownWorkspaceId = ws.config?.mesh?.workspaceId ?? workspaceIdFor(ws.projectRoot ?? ws.workDir);",
    "  return async function resolveWorkspaceAppIdentity(workspaceId) {",
    "    if (workspaceId === ownWorkspaceId) {",
    "      return identityFromConfig(ws.config ?? {}, { ...options, allowEnvOverride: true });",
    "    }",
    "    let targetConfig = null;",
    "    try {",
    "      const projectRoot = await resolveWorkspaceProjectRoot(workspaceId, options);",
    "      if (projectRoot != null) {",
    "        const otherWs = await loadWorkspace(projectRoot, undefined, { env: options?.globalWorkStoreOptions?.env });",
    "        targetConfig = otherWs.config ?? {};",
    "      }",
    "    } catch {",
    "      targetConfig = null;",
    "    }",
    "    const ownOverrideAppId = targetConfig?.mesh?.repo?.credential?.githubApp?.appId;",
    "    if (typeof ownOverrideAppId === \"string\" && ownOverrideAppId.length > 0) {",
    "      return identityFromConfig(targetConfig, { ...options, allowEnvOverride: false });",
    "    }",
    "    return identityFromConfig(ws.config ?? {}, { ...options, allowEnvOverride: true });",
    "  };",
    "}",
  ].join("\n");
}

// PLANT (2c) — the launcher's OWN resolver caches every resolved identity in a
// registry and, for a workspace it cannot resolve fresh, hands back a PREVIOUSLY
// resolved SIBLING'S identity from that registry instead of resolveWorkspaceProjectRoot
// ever being consulted for THIS workspace.
function synthesizeSiblingRegistryResolver() {
  return [
    "export function createResolveWorkspaceAppIdentity(ws, options = {}) {",
    "  const ownWorkspaceId = ws.config?.mesh?.workspaceId ?? workspaceIdFor(ws.projectRoot ?? ws.workDir);",
    "  const resolvedRegistry = new Map();",
    "  return async function resolveWorkspaceAppIdentity(workspaceId) {",
    "    if (workspaceId === ownWorkspaceId) {",
    "      const identity = identityFromConfig(ws.config ?? {}, { ...options, allowEnvOverride: true });",
    "      resolvedRegistry.set(workspaceId, identity);",
    "      return identity;",
    "    }",
    "    const anySiblingIdentity = [...resolvedRegistry.values()][0] ?? null;",
    "    return anySiblingIdentity;",
    "  };",
    "}",
  ].join("\n");
}

function synthesizeDefaultKeyPath({ variant = "clean" } = {}) {
  if (variant === "sync-folder") {
    return [
      "function defaultGithubAppPrivateKeyPath(config, options = {}) {",
      "  const appId = config?.mesh?.repo?.credential?.githubApp?.appId ?? null;",
      "  return path.join(homedir(), \"Dropbox\", \"aof-keys\", githubAppPrivateKeyFilename(appId));",
      "}",
    ].join("\n");
  }
  if (variant === "no-credentials-segment") {
    return [
      "function defaultGithubAppPrivateKeyPath(config, options = {}) {",
      "  const appId = config?.mesh?.repo?.credential?.githubApp?.appId ?? null;",
      "  return path.join(globalMeshPaths(options).meshRoot, githubAppPrivateKeyFilename(appId));",
      "}",
    ].join("\n");
  }
  return [
    "function defaultGithubAppPrivateKeyPath(config, options = {}) {",
    "  const appId = config?.mesh?.repo?.credential?.githubApp?.appId ?? null;",
    "  return path.join(globalMeshPaths(options).meshRoot, \"credentials\", githubAppPrivateKeyFilename(appId));",
    "}",
  ].join("\n");
}

function synthesizeCleanMintSignature() {
  return [
    "export function createGithubAppMintProvider({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl } = {}) {",
    "  const mintCloneCredential = async function mintCloneCredential(workspaceId) {",
    "    const identity = await resolveWorkspaceAppIdentity(workspaceId);",
    "    return identity;",
    "  };",
    "  return mintCloneCredential;",
    "}",
  ].join("\n");
}

// PLANT (4) — identity keyed by a worker-supplied FRAME object instead of the
// F15-bound workspaceId parameter — the seam signature has drifted.
function synthesizeFrameKeyedMintSignature() {
  return [
    "export function createGithubAppMintProvider({ resolveWorkspaceAppIdentity, resolveWorkspaceCloneUrl } = {}) {",
    "  const mintCloneCredential = async function mintCloneCredential(frame) {",
    "    const identity = await resolveWorkspaceAppIdentity(frame.workspaceId);",
    "    return identity;",
    "  };",
    "  return mintCloneCredential;",
    "}",
  ].join("\n");
}

export const archTests = [
  // ---- invariant #1 -----------------------------------------------------------
  {
    name: "arch/38 ADR-011 (acd-cross-org-key-isolation, invariant #1): the REAL provider destructures resolveWorkspaceAppIdentity (no static appId/privateKey param) and calls it with EXACTLY the mint's own workspaceId",
    run: async () => {
      const source = lf(await readFile(providerSourcePath, "utf8"));
      assert.deepEqual(staticIdentityProblems(source), [], "the real provider resolves identity per-workspace, never a single static App");
    },
  },
  // ---- invariant #2 -------------------------------------------------------------
  {
    name: "arch/38 ADR-011 (acd-cross-org-key-isolation, invariant #2): the REAL provider throws on a null-resolved identity, never chains a ??/|| fallback onto the resolve call, and carries no cross-call identity cache",
    run: async () => {
      const source = lf(await readFile(providerSourcePath, "utf8"));
      assert.deepEqual(providerBorrowProblems(source), [], "the real provider never silently borrows a fallback identity");
    },
  },
  {
    name: "arch/38 ADR-011 (acd-cross-org-key-isolation, invariant #2): the REAL launcher resolver reads ONLY the target workspace's own descriptor-resolved config or the launch workspace's own config — never a sibling's, never a cross-call cache",
    run: async () => {
      const source = lf(await readFile(launcherSourcePath, "utf8"));
      assert.deepEqual(launcherBorrowProblems(source), [], "the real resolver never reaches for a sibling workspace's identity");
    },
  },
  // ---- invariant #3 -------------------------------------------------------------
  {
    name: "arch/38 ADR-011 (acd-cross-org-key-isolation, invariant #3): the REAL default private-key directory is composed via globalMeshPaths + a literal \"credentials\" segment — never homedir()/a sync-scoped literal",
    run: async () => {
      const source = lf(await readFile(launcherSourcePath, "utf8"));
      assert.deepEqual(defaultKeyDirProblems(source), [], "the real default key directory is code-enforced and non-sync");
    },
  },
  // ---- invariant #4 -------------------------------------------------------------
  {
    name: "arch/38 ADR-011 (acd-cross-org-key-isolation, invariant #4): the REAL mint seam signature stays keyed by workspaceId (the F15-bound value), never a worker-supplied frame",
    run: async () => {
      const source = lf(await readFile(providerSourcePath, "utf8"));
      assert.deepEqual(mintSeamSignatureProblems(source), [], "the real mint seam signature and F15 posture are preserved");
    },
  },

  // ---- self-check: every plant trips its detector; the clean shape stays clean --
  {
    name: "arch/38 ADR-011 (acd-cross-org-key-isolation): self-check — a static appId/privateKey provider, a sibling-fallback mint, a cached-launch-identity mint, a sibling-registry resolver, a sync-scoped default key dir, and a frame-keyed mint signature ALL trip their detector; the correct per-workspace, non-caching, non-sync, workspaceId-keyed shapes stay clean",
    run: async () => {
      const realProviderSource = lf(await readFile(providerSourcePath, "utf8"));
      const realLauncherSource = lf(await readFile(launcherSourcePath, "utf8"));

      // The real tree is clean under every detector (re-asserted here alongside the
      // plants, so a reader sees the FULL non-vacuity story in one place).
      assert.deepEqual(staticIdentityProblems(realProviderSource), [], "sanity: the real provider has no static identity");
      assert.deepEqual(providerBorrowProblems(realProviderSource), [], "sanity: the real provider never borrows a fallback identity");
      assert.deepEqual(launcherBorrowProblems(realLauncherSource), [], "sanity: the real resolver never reaches for a sibling's identity");
      assert.deepEqual(defaultKeyDirProblems(realLauncherSource), [], "sanity: the real default key dir is code-enforced and non-sync");
      assert.deepEqual(mintSeamSignatureProblems(realProviderSource), [], "sanity: the real mint seam signature is preserved");

      // PLANT (1) — a HARD-CODED, STATIC appId/privateKey provider (the pre-ADR-011
      // story-02 shape) — enumerates BOTH secrets ADR-011 invariant #1 names.
      const cleanProvider = synthesizeCleanProvider();
      const staticProvider = synthesizeStaticIdentityProvider();
      assert.notEqual(staticProvider, cleanProvider, "the plant actually differs from the clean synthesized provider");
      const staticProblems = staticIdentityProblems(staticProvider);
      assert.ok(staticProblems.length > 0, "a static appId/privateKey provider trips the detector");
      assert.ok(staticProblems.some((p) => p.includes("appId")), "the detector names the static appId secret");
      assert.ok(staticProblems.some((p) => p.includes("privateKey")), "the detector names the static privateKey secret");

      // PLANT (2a) — a SIBLING workspace's fallback identity rescues a null
      // resolution (secret #1 of invariant #2's "sibling OR launch" pair).
      const siblingFallback = synthesizeSiblingFallbackProvider();
      assert.notEqual(siblingFallback, cleanProvider, "the plant actually differs from the clean synthesized provider");
      assert.ok(providerBorrowProblems(siblingFallback).length > 0, "a sibling-fallback ?? chain trips the provider-borrow detector");

      // PLANT (2b) — the LAUNCH workspace's own PRIOR resolution is cached and reused
      // across every subsequent mint (secret #2 of invariant #2's pair — a DISTINCT
      // borrow shape from 2a's sibling fallback).
      const cachedLaunch = synthesizeCachedLaunchIdentityProvider();
      assert.notEqual(cachedLaunch, cleanProvider, "the plant actually differs from the clean synthesized provider");
      assert.ok(providerBorrowProblems(cachedLaunch).length > 0, "a cached-launch-identity cross-call reuse trips the provider-borrow detector");

      // PLANT (2c) — the LAUNCHER's own resolver hands a workspace a PREVIOUSLY
      // resolved SIBLING's identity from a registry, instead of ever consulting that
      // workspace's own descriptor.
      const cleanResolver = synthesizeCleanResolver();
      const siblingRegistry = synthesizeSiblingRegistryResolver();
      assert.notEqual(siblingRegistry, cleanResolver, "the plant actually differs from the clean synthesized resolver");
      assert.ok(launcherBorrowProblems(siblingRegistry).length > 0, "a sibling-registry resolver trips the launcher-borrow detector");

      // PLANT (3a) — the default key dir points into a Dropbox-synced homedir tree.
      const cleanKeyPath = synthesizeDefaultKeyPath({ variant: "clean" });
      const syncKeyPath = synthesizeDefaultKeyPath({ variant: "sync-folder" });
      assert.notEqual(syncKeyPath, cleanKeyPath, "the plant actually differs from the clean synthesized default key path");
      assert.ok(defaultKeyDirProblems(syncKeyPath).length > 0, "a Dropbox-synced homedir() default trips the detector");

      // PLANT (3b) — the default key dir omits the "credentials" segment.
      const noSegmentKeyPath = synthesizeDefaultKeyPath({ variant: "no-credentials-segment" });
      assert.notEqual(noSegmentKeyPath, cleanKeyPath, "the plant actually differs from the clean synthesized default key path");
      assert.ok(defaultKeyDirProblems(noSegmentKeyPath).length > 0, "a default key path missing the credentials segment trips the detector");

      // PLANT (4) — a FRAME-keyed mint signature (identity keyed by a worker-supplied
      // object instead of the F15-bound workspaceId).
      const cleanSignature = synthesizeCleanMintSignature();
      const frameKeyed = synthesizeFrameKeyedMintSignature();
      assert.notEqual(frameKeyed, cleanSignature, "the plant actually differs from the clean synthesized mint signature");
      assert.ok(mintSeamSignatureProblems(frameKeyed).length > 0, "a frame-keyed mint signature trips the detector");

      // NEGATIVE CONTROLS — the CORRECT ADR-011 shapes stay clean under every
      // detector (re-asserted here, alongside every plant, for a single legible
      // self-check).
      assert.deepEqual(staticIdentityProblems(cleanProvider), []);
      assert.deepEqual(providerBorrowProblems(cleanProvider), []);
      assert.deepEqual(launcherBorrowProblems(cleanResolver), []);
      assert.deepEqual(defaultKeyDirProblems(cleanKeyPath), []);
      assert.deepEqual(mintSeamSignatureProblems(cleanSignature), []);
    },
  },
];
