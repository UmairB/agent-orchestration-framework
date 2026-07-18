// Fitness function: acd-write-token-scoped-to-push (milestone 38 / ADR-015; SECURITY
// T9 re-opened, co-owned with the acd-minted-token-scoped-single-repo T15 rewrite)
//
// Arms ADR-015's FOUR structural invariants (ARCHITECTURE.md, "Structural invariants
// (each testable; armed by acd-write-token-scoped-to-push)"):
//  1. The clone mint stays contents:read — no contents:write on the CLONE credential
//     path (the write scope appears ONLY at the push seam).
//  2. The write token is minted ONLY at push time, single-repo, holder-authorized —
//     never a run-long standing write credential, never widened onto the clone.
//  3. The worktree is NOT removed until the push succeeds — a failed push retains,
//     never force-removes over unpushed commits.
//  4. The push reuses the ADR-009 buildAskpassShim — no new credential wire; the
//     token never persists into .git/config, process.env, or a log.
//
// Proofs: (a) STRUCTURAL — source-order + anchor-presence checks over the REAL
// mesh-worker-execution.mjs / mesh-clone-credential-provider.mjs / control-stream-
// server.mjs (the producers this story built); (b) BEHAVIOURAL — the real
// createGithubAppPushMintProvider mints fresh per call (never caches), and the real
// applyWriteCredentialRequestFrame refuses a non-holder before ever minting; (c)
// SELF-CHECK — synthesized plants (never a string-replace on the real files, CRLF-safe
// explicit "\n" joins) for each of the three ARCHITECTURE-named attacks: a contents:write
// on the clone mint, a force-remove before a successful push, and a standing (cached)
// write token — plus a fourth, the askpass-bypass — each MUST trip; the real (correct)
// source stays clean under every detector.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGithubAppPushMintProvider } from "../../src/mesh-clone-credential-provider.mjs";
import { applyWriteCredentialRequestFrame, WRITE_CREDENTIAL_NOT_HOLDER } from "../../src/control-stream-server.mjs";
import { generateThrowawayKeypair, createFakeHttpRequest, jsonResponse } from "../support/mesh-clone-credential-mint-fixture.mjs";
import { seedAssignment } from "../support/mesh-assign-fixture.mjs";
import { openGlobalWorkProjectionStore } from "../../src/global-work-store.mjs";
import { globalMeshPaths } from "../../src/workspace.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerExecutionSourcePath = path.join(repoRoot, "src", "mesh-worker-execution.mjs");
const cloneProviderSourcePath = path.join(repoRoot, "src", "mesh-clone-credential-provider.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// lf(source) — the tree is CRLF (mesh-worker-execution.mjs); every synthesized plant
// below is built with explicit "\n" joins so it is IMMUNE to that convention rather
// than accidentally matching/not-matching it — the real file is normalized to \n
// before scanning, mirroring the milestone's OTHER detectors.
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

// functionBodyByName(source, functionName) — locates `function <functionName>(` and
// returns its balanced BODY text (mirrors the T15 two-seam detector's OWN anchor).
// Depth-aware across the PARAMETER LIST too (`(`/`{`/`[` all count) — a naive "find
// the first { after the name" would stop at a destructured/defaulted parameter's OWN
// brace (e.g. `function f({ a, b } = {}) {`), never reaching the function body at all
// (a silently-vacuous scan — exactly this milestone's own recurring lesson).
function functionBodyByName(source, functionName) {
  const idx = source.indexOf(`function ${functionName}(`);
  if (idx === -1) return null;
  const parenOpen = source.indexOf("(", idx);
  if (parenOpen === -1) return null;
  let depth = 0;
  let i = parenOpen;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0 && ch === ")") break;
    }
  }
  const braceIdx = source.indexOf("{", i + 1);
  if (braceIdx === -1) return null;
  return sliceBalanced(source, braceIdx);
}

// ---------------------------------------------------------------------------------
// Invariant 1 — the clone mint stays contents:read. Scoped to
// createGithubAppMintProvider's OWN span (never the whole file, which also legitimately
// contains createGithubAppPushMintProvider's contents:write body) — a "write" value
// found ANYWHERE inside the clone mint's span is the attack.
// ---------------------------------------------------------------------------------
function cloneMintStaysReadProblems(source) {
  const problems = [];
  const code = stripComments(source);
  const span = functionBodyByName(code, "createGithubAppMintProvider");
  if (span == null) {
    problems.push("could not locate createGithubAppMintProvider's function body");
    return problems;
  }
  if (/contents\s*:\s*["'`]write["'`]/.test(span)) {
    problems.push("the clone mint's own span contains a contents:\"write\" value — the clone credential must NEVER widen to write");
  }
  return problems;
}

// ---------------------------------------------------------------------------------
// Invariant 3 — the worktree is NOT removed until the push succeeds. In
// mesh-worker-execution.mjs's handler, on the `done` outcome branch, pushWorktreeBranch(
// must appear STRICTLY BEFORE the force-remove removeWorktree(...{ force: true }) call
// — and NEVER as a sibling/independent branch that could race it.
// ---------------------------------------------------------------------------------
function pushBeforeRemoveProblems(source) {
  const problems = [];
  const code = stripComments(source);
  const pushOffset = code.search(/pushWorktreeBranch\s*\(/);
  const removeOffset = code.search(/removeWorktree\s*\([^)]*force:\s*true/s);
  if (pushOffset === -1) problems.push("no pushWorktreeBranch( call found");
  if (removeOffset === -1) problems.push("no force-remove removeWorktree(...{ force: true }) call found");
  if (pushOffset !== -1 && removeOffset !== -1 && !(pushOffset < removeOffset)) {
    problems.push("the force-remove removeWorktree call does not come AFTER pushWorktreeBranch in source order — the worktree could be removed before the push runs");
  }
  return problems;
}

// ---------------------------------------------------------------------------------
// Invariant 4 — the push reuses buildAskpassShim (no new credential wire mechanism).
// pushWorktreeBranch's OWN function body must call buildAskpassShim( — never build its
// own separate askpass/credential-wire mechanism.
// ---------------------------------------------------------------------------------
function pushReusesAskpassProblems(source) {
  const problems = [];
  const code = stripComments(source);
  const span = functionBodyByName(code, "pushWorktreeBranch");
  if (span == null) {
    problems.push("could not locate pushWorktreeBranch's function body");
    return problems;
  }
  if (!/buildAskpassShim\s*\(/.test(span)) {
    problems.push("pushWorktreeBranch does not call buildAskpassShim( — a new credential-wire mechanism, never the reused ADR-009 one");
  }
  if (!/credential\.helper=/.test(span)) {
    problems.push("pushWorktreeBranch does not reset the ambient credential.helper (-c credential.helper=) for the push");
  }
  return problems;
}

function synthesizeCloneMintSnippet(bodyPermissions) {
  return [
    "export function createGithubAppMintProvider(deps) {",
    "  const mintCloneCredential = async function mintCloneCredential(workspaceId) {",
    "    return httpRequest(url, {",
    "      method: \"POST\",",
    `      body: JSON.stringify({ repositories: [repo], permissions: ${bodyPermissions} }),`,
    "    });",
    "  };",
    "  return mintCloneCredential;",
    "}",
  ].join("\n");
}

function synthesizePushOrderingSnippet({ pushFirst }) {
  const pushLine = "await pushWorktreeBranch(ws.projectRoot, worktreePath, branch, { credential: writeCredential, pushExec });";
  const removeLine = "await removeWorktree(ws.projectRoot, assignmentId, { exec, force: true });";
  const lines = pushFirst ? [pushLine, removeLine] : [removeLine, pushLine];
  return [
    "if (completed.state === \"done\") {",
    `  ${lines[0]}`,
    `  ${lines[1]}`,
    "}",
  ].join("\n");
}

// standingTokenProblems(tokenA, tokenB) — the "never a run-long standing credential"
// detector: TWO SEPARATE mint calls that hand out the IDENTICAL token value is exactly
// the attack (a cached/reused write credential rather than one freshly minted per
// push) — a plain equality check, the simplest correct detector for this invariant.
function standingTokenProblems(tokenA, tokenB) {
  return tokenA === tokenB ? ["two separate write-mint calls returned the SAME token value — a standing/cached credential, never freshly minted per push"] : [];
}

function synthesizePushFunctionSnippet({ reusesAskpass, resetsHelper }) {
  return [
    "export async function pushWorktreeBranch(projectRoot, worktreePath, branch, options = {}) {",
    "  const exec = resolvePushExec(options);",
    "  let askpass = null;",
    reusesAskpass ? "  askpass = await buildAskpassShim(meshWorktreesRoot(projectRoot), options.credential);" : "  askpass = await buildOwnCredentialShim(options.credential);",
    resetsHelper ? "  const result = await exec([\"-c\", \"credential.helper=\", \"push\", \"origin\", branch], { cwd: worktreePath, env: pushEnv });" : "  const result = await exec([\"push\", \"origin\", branch], { cwd: worktreePath, env: pushEnv });",
    "  return result;",
    "}",
  ].join("\n");
}

export const archTests = [
  // ------------------------------------------------------------------
  // Invariant 1 — structural, over the real source
  // ------------------------------------------------------------------
  {
    name: "arch/38 ADR-015 (acd-write-token-scoped-to-push): invariant 1 — the clone mint's own function span never carries a contents:write value (structural, real source)",
    run: async () => {
      const source = lf(await readFile(cloneProviderSourcePath, "utf8"));
      assert.deepEqual(cloneMintStaysReadProblems(source), [], "the clone mint stays contents:read");
    },
  },
  // ------------------------------------------------------------------
  // Invariant 2 — behavioural, over the real push-mint provider + the real
  // control-side authorization gate
  // ------------------------------------------------------------------
  {
    name: "arch/38 ADR-015 (acd-write-token-scoped-to-push): invariant 2 — the write token is minted FRESH on every call (never a run-long standing/cached credential), single-repo, and NEVER minted for a non-holder (behavioural, real producers)",
    run: async () => {
      const { privateKey } = generateThrowawayKeypair();
      const httpRequest = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 1 }) : jsonResponse(201, { token: `TOKEN-${httpRequest.calls.length}` })));
      const mint = createGithubAppPushMintProvider({
        resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }),
        resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git",
        httpRequest,
      });
      const tokenA = await mint("ws-a", "asg-a");
      const tokenB = await mint("ws-a", "asg-b");
      assert.notEqual(tokenA, tokenB, "each mint call produces a FRESH token — never a cached/reused standing write credential");
      const exchangeCalls = httpRequest.calls.filter((c) => c.url.includes("/access_tokens"));
      assert.equal(exchangeCalls.length, 2, "each call genuinely re-mints (two calls, never one cached response reused)");
      for (const call of exchangeCalls) {
        const body = JSON.parse(call.init.body);
        assert.equal(body.repositories.length, 1, "single-repo-scoped on every mint");
      }

      // Holder-authorized: applyWriteCredentialRequestFrame refuses a non-holder
      // BEFORE ever invoking the mint (the SAME SECURITY T6 discipline the clone
      // credential PULL already enforces).
      const home = `${process.env.AOF_GLOBAL_HOME}-invariant2`;
      const env = { AOF_GLOBAL_HOME: home };
      const store = await openGlobalWorkProjectionStore({ env, paths: globalMeshPaths({ env }) });
      try {
        await seedAssignment({ home }, { assignmentId: "asg-holder-check", itemRef: "38/07", workspaceId: "ws-x", targetNodeId: "worker-REAL-HOLDER", issuer: "control-a", state: "accepted", assignedAt: "2026-07-18T09:00:00.000Z" });
        let minted = 0;
        const applied = await applyWriteCredentialRequestFrame(store, { kind: "write-credential-request", nodeId: "worker-IMPOSTER", assignmentId: "asg-holder-check", workspaceId: "ws-x", at: "2026-07-18T09:00:00.000Z" }, {
          nodeId: "worker-IMPOSTER",
          directiveTargets: { get: () => null, set: () => {} },
          mintWriteCredential: async () => { minted += 1; return "SHOULD-NEVER-MINT"; },
          now: "2026-07-18T09:00:00.000Z",
        });
        assert.equal(applied.code, WRITE_CREDENTIAL_NOT_HOLDER, "a non-holder is refused");
        assert.equal(minted, 0, "the mint is NEVER invoked for a non-holder — authorized BEFORE minting");
      } finally {
        store.close();
      }
    },
  },
  // ------------------------------------------------------------------
  // Invariants 3 + 4 — structural, over the real source
  // ------------------------------------------------------------------
  {
    name: "arch/38 ADR-015 (acd-write-token-scoped-to-push): invariants 3+4 — the force-remove removeWorktree call comes AFTER pushWorktreeBranch in source order, and pushWorktreeBranch reuses buildAskpassShim + resets the ambient credential.helper (structural, real source)",
    run: async () => {
      const source = lf(await readFile(workerExecutionSourcePath, "utf8"));
      assert.deepEqual(pushBeforeRemoveProblems(source), [], "the worktree is not force-removed before the push");
      assert.deepEqual(pushReusesAskpassProblems(source), [], "the push reuses buildAskpassShim and resets the ambient credential.helper");
    },
  },
  // ------------------------------------------------------------------
  // Self-check — the three ARCHITECTURE-named attacks + the askpass-bypass, each
  // MUST trip; the real (correct) source stays clean under every detector.
  // ------------------------------------------------------------------
  {
    name: "arch/38 ADR-015 (acd-write-token-scoped-to-push): self-check — a contents:write on the clone mint, a force-remove BEFORE a successful push, a standing/uncorrelated write token, and an askpass-bypassing push EACH trip the detector; the real source stays clean under every one",
    run: async () => {
      const workerSource = lf(await readFile(workerExecutionSourcePath, "utf8"));
      const cloneSource = lf(await readFile(cloneProviderSourcePath, "utf8"));
      // Sanity — the real tree is clean under every detector first.
      assert.deepEqual(cloneMintStaysReadProblems(cloneSource), [], "sanity: the real clone mint is clean");
      assert.deepEqual(pushBeforeRemoveProblems(workerSource), [], "sanity: the real push-then-remove ordering is clean");
      assert.deepEqual(pushReusesAskpassProblems(workerSource), [], "sanity: the real askpass reuse is clean");

      // PLANT 1 — attack (a): a contents:write on the CLONE mint.
      const cleanCloneSnippet = synthesizeCloneMintSnippet('{ contents: "read" }');
      const plantedCloneWrite = synthesizeCloneMintSnippet('{ contents: "write" }');
      assert.notEqual(plantedCloneWrite, cleanCloneSnippet, "the plant actually differs from its clean baseline");
      assert.deepEqual(cloneMintStaysReadProblems(cleanCloneSnippet), [], "the clean synthesized clone body stays clean");
      assert.ok(cloneMintStaysReadProblems(plantedCloneWrite).length > 0, "a contents:write on the clone mint trips the detector");

      // PLANT 2 — a force-remove BEFORE a successful push (the worktree could be
      // destroyed before the push ever runs).
      const cleanOrderingSnippet = synthesizePushOrderingSnippet({ pushFirst: true });
      const plantedOrdering = synthesizePushOrderingSnippet({ pushFirst: false });
      assert.notEqual(plantedOrdering, cleanOrderingSnippet, "the plant actually differs from its clean baseline");
      assert.deepEqual(pushBeforeRemoveProblems(cleanOrderingSnippet), [], "the clean synthesized push-then-remove ordering stays clean");
      assert.ok(pushBeforeRemoveProblems(plantedOrdering).length > 0, "a force-remove BEFORE a successful push trips the detector");

      // PLANT 3 — a "standing" write token: a mint that returns the SAME token on
      // every call (never re-mints) is exactly the exposure-window widening T15
      // exists to forbid. Both mints below drive the SAME REAL
      // createGithubAppPushMintProvider — only the SCRIPTED http backend differs
      // (varying vs a fixed, cached token) — so this proves the DETECTOR
      // (standingTokenProblems) trips on a caching backend while staying clean
      // against the real provider's own genuine per-call minting (invariant 2, above).
      const { privateKey } = generateThrowawayKeypair();
      const varyingHttp = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 1 }) : jsonResponse(201, { token: `FRESH-${varyingHttp.calls.length}` })));
      const varyingMint = createGithubAppPushMintProvider({ resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }), resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git", httpRequest: varyingHttp });
      const cleanTokenA = await varyingMint("ws-a", "asg-a");
      const cleanTokenB = await varyingMint("ws-a", "asg-b");
      assert.deepEqual(standingTokenProblems(cleanTokenA, cleanTokenB), [], "the real provider's own genuine per-call minting stays clean under the standing-token detector");

      const cachedHttp = createFakeHttpRequest(async ({ url }) => (url.endsWith("/installation") ? jsonResponse(200, { id: 1 }) : jsonResponse(201, { token: "STANDING-TOKEN" })));
      const cachingMint = createGithubAppPushMintProvider({ resolveWorkspaceAppIdentity: async () => ({ appId: "app-1", privateKey }), resolveWorkspaceCloneUrl: async () => "https://github.com/acme/secret.git", httpRequest: cachedHttp });
      const plantedTokenA = await cachingMint("ws-a", "asg-a");
      const plantedTokenB = await cachingMint("ws-a", "asg-b");
      assert.equal(plantedTokenA, plantedTokenB, "the plant actually landed — the caching backend genuinely handed out the same value twice");
      assert.ok(standingTokenProblems(plantedTokenA, plantedTokenB).length > 0, "a standing (reused) write token trips the 'never a run-long standing credential' invariant");

      // PLANT 4 — an askpass-bypassing push (a new, separate credential-wire
      // mechanism instead of the reused ADR-009 shim).
      const cleanPushSnippet = synthesizePushFunctionSnippet({ reusesAskpass: true, resetsHelper: true });
      const plantedNoAskpass = synthesizePushFunctionSnippet({ reusesAskpass: false, resetsHelper: true });
      const plantedNoHelperReset = synthesizePushFunctionSnippet({ reusesAskpass: true, resetsHelper: false });
      assert.notEqual(plantedNoAskpass, cleanPushSnippet, "the plant actually differs from its clean baseline");
      assert.notEqual(plantedNoHelperReset, cleanPushSnippet, "the plant actually differs from its clean baseline");
      assert.deepEqual(pushReusesAskpassProblems(cleanPushSnippet), [], "the clean synthesized push function stays clean");
      assert.ok(pushReusesAskpassProblems(plantedNoAskpass).length > 0, "a push function that never calls buildAskpassShim trips the detector");
      assert.ok(pushReusesAskpassProblems(plantedNoHelperReset).length > 0, "a push function that never resets the ambient credential.helper trips the detector");
    },
  },
];
