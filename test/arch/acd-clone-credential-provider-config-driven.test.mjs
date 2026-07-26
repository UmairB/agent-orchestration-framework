// Fitness function: acd-clone-credential-provider-config-driven (milestone 38 /
// ADR-010 §6.1 / fitness #13; SECURITY T10 backstop — architect/developer-owned, F7)
//
// ARMED AT BUILD, per ADR-008's hard lesson (the SAME deferral discipline SECURITY's
// F5/F6 and this milestone's earlier arch-tests already keep): the
// `resolveCloneCredentialProvider` seam + the launcher's literal-key wiring did not
// exist before story 02 built — a detector authored earlier would have scanned an
// absent call-site shape, a VACUOUS real-tree assertion. Now that the source exists
// (src/mesh-clone-credential-provider.mjs, src/mesh-launcher.mjs,
// src/control-stream-server.mjs), this test arms the FOUR self-check plants ADR-010
// names verbatim:
//   (1) a hard-coded single provider (the selector ignores config and always returns
//       the github-app OR always the env-token provider);
//   (2) the F12 shape — mintCloneCredential reachable ONLY through the
//       controlStreamServerOptions test spread, no literal key at the production
//       startServer({...}) call site;
//   (3) a github-app-fault catch that silently returns defaultMintCloneCredential at
//       SELECTION time (the T10 fall-through);
//   (4) a mutation of the env-token default so the unconfigured path is no longer
//       byte-identical (reads a different env var / hard-codes a token).
// Negative control that MUST stay clean: the config-driven selector (env-token
// unconfigured / github-app configured) passed as a literal key at the production
// site.
//
// Non-negotiable plant discipline (this milestone's own hard lesson, ADR-008): the
// tree is CRLF. Every plant below is a SYNTHESIZED snippet built with explicit "\n"
// joins (Array#join("\n")) — never a string-replace on a real file, which would
// silently no-op against CRLF source and leave the self-check VACUOUS. The real
// source is asserted clean under every detector FIRST; each plant is asserted to
// actually DIFFER from its own clean synthesized baseline before asserting it trips.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const providerSourcePath = path.join(repoRoot, "src", "mesh-clone-credential-provider.mjs");
const launcherSourcePath = path.join(repoRoot, "src", "mesh-launcher.mjs");
const controlSourcePath = path.join(repoRoot, "src", "control-stream-server.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// lf(source) — normalise CRLF -> LF for the REAL files read below (the repo's own
// checkout convention on this platform; see module doc above).
function lf(source) {
  return source.replace(/\r\n/g, "\n");
}

// sliceBalanced(source, openIndex) — the substring INSIDE the `{...}` whose opening
// brace is at `openIndex`, brace-depth-balanced (verbatim idiom from
// acd-clone-credential-pull-not-pushed.test.mjs) so a nested object literal or arrow
// body never truncates the slice early.
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

// topLevelEntries(objectBody) -> { keys, spreads } — the DEPTH-0 entries of an object
// literal (verbatim idiom from acd-clone-credential-pull-not-pushed.test.mjs).
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
    const named = /^([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(trimmed);
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
// the first function whose declaration the anchor text names — finds the FIRST `{`
// that follows the parameter list's balanced-closing `)`, so a default `= {}` inside
// the parameter list is never mistaken for the body's opening brace.
function functionBody(source, anchorText) {
  const code = stripComments(source);
  const anchor = code.indexOf(anchorText);
  if (anchor === -1) return null;
  const parenOpen = code.indexOf("(", anchor);
  if (parenOpen === -1) return null;
  let depth = 0;
  let parenClose = -1;
  for (let i = parenOpen; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        parenClose = i;
        break;
      }
    }
  }
  if (parenClose === -1) return null;
  const bodyOpen = code.indexOf("{", parenClose);
  return bodyOpen === -1 ? null : sliceBalanced(code, bodyOpen);
}

const RAW_PROVIDER_READ = /config\s*\?\.\s*mesh\s*\?\.\s*repo\s*\?\.\s*credential\s*\?\.\s*provider/;

// selectorConfigDrivenProblems(selectorSource) — PLANT (1): a hard-coded single
// provider. The selector's body must (a) genuinely READ
// `config.mesh.repo.credential.provider` (the raw optional-chain idiom), and (b)
// genuinely be ABLE to return EITHER `defaultMintCloneCredential` OR
// `createGithubAppMintProvider(...)` — a body naming only one of the two can never
// change its outcome no matter what `config` says.
function selectorConfigDrivenProblems(selectorSource) {
  const body = functionBody(selectorSource, "export function resolveCloneCredentialProvider");
  const problems = [];
  if (body == null) {
    problems.push("could not locate resolveCloneCredentialProvider's function body");
    return problems;
  }
  if (!RAW_PROVIDER_READ.test(body)) {
    problems.push("the selector does not read config.mesh.repo.credential.provider via the raw optional-chain — it may be ignoring config entirely");
  }
  const namesDefault = body.includes("defaultMintCloneCredential");
  const namesGithubApp = body.includes("createGithubAppMintProvider");
  if (!namesDefault || !namesGithubApp) {
    problems.push(`the selector is a HARD-CODED single provider — it never returns ${!namesDefault ? "defaultMintCloneCredential" : "createGithubAppMintProvider(...)"} on any branch, so config selection cannot change the outcome`);
  }
  return problems;
}

// selectorFallThroughProblems(selectorSource) — PLANT (3): a github-app selection
// fault caught at SELECTION time and silently degraded to `defaultMintCloneCredential`
// (the T10 fall-through). Detector: a `try { ... createGithubAppMintProvider ... }
// catch { ... defaultMintCloneCredential ... }` shape anywhere in the selector body.
function selectorFallThroughProblems(selectorSource) {
  const body = functionBody(selectorSource, "export function resolveCloneCredentialProvider");
  if (body == null) return [];
  const tryIdx = body.search(/\btry\b/);
  if (tryIdx === -1) return [];
  const tryOpenBrace = body.indexOf("{", tryIdx);
  if (tryOpenBrace === -1) return [];
  const tryBody = sliceBalanced(body, tryOpenBrace);
  if (tryBody == null) return [];
  const afterTryClose = tryOpenBrace + 1 + tryBody.length + 1;
  const rest = body.slice(afterTryClose);
  const catchMatch = /\bcatch\b[^{]*\{/.exec(rest);
  if (catchMatch == null) return [];
  const catchOpenBraceRel = catchMatch.index + catchMatch[0].length - 1;
  const catchBody = sliceBalanced(rest, catchOpenBraceRel);
  if (catchBody == null) return [];
  if (tryBody.includes("createGithubAppMintProvider") && catchBody.includes("defaultMintCloneCredential")) {
    return ["a github-app selection fault is caught at SELECTION time and silently falls through to defaultMintCloneCredential (env-token) — SECURITY T10 forbids this fall-through"];
  }
  return [];
}

// envTokenByteIdentityProblems(controlServerSource) — PLANT (4): the `env-token`
// default must stay BYTE-IDENTICAL — it reads `process.env.AOF_MESH_CLONE_TOKEN` and
// nothing else, never a hard-coded literal.
function envTokenByteIdentityProblems(controlServerSource) {
  const body = functionBody(controlServerSource, "export function defaultMintCloneCredential");
  const problems = [];
  if (body == null) {
    problems.push("could not locate defaultMintCloneCredential's function body");
    return problems;
  }
  if (!body.includes("AOF_MESH_CLONE_TOKEN")) {
    problems.push("defaultMintCloneCredential no longer reads process.env.AOF_MESH_CLONE_TOKEN — the env-token default's byte-identical behaviour has drifted");
  }
  if (/return\s+["'`][^"'`]+["'`]\s*;/.test(body)) {
    problems.push("defaultMintCloneCredential returns a HARD-CODED literal token — never the operator-provisioned env value");
  }
  return problems;
}

// productionMintKeyProblems(launcherSource) — PLANT (2): the F12 shape re-armed for
// the provider. `mintCloneCredential` must be a LITERAL key at the production
// `startServer({...})` call site (mesh-launcher.mjs's control block) — never
// reachable ONLY through the `controlStreamServerOptions` test-injection spread.
function productionMintKeyProblems(launcherSource) {
  const code = stripComments(launcherSource);
  const anchor = code.indexOf("await startServer({");
  const problems = [];
  if (anchor === -1) {
    problems.push("could not locate the production startServer({...}) call site in mesh-launcher.mjs");
    return problems;
  }
  const open = code.indexOf("{", anchor);
  const body = sliceBalanced(code, open);
  if (body == null) {
    problems.push("could not balance the production startServer({...}) call site's argument object");
    return problems;
  }
  const { keys } = topLevelEntries(body);
  if (!keys.includes("mintCloneCredential")) {
    problems.push("mintCloneCredential is not a LITERAL key at the production startServer({...}) call site — it is reachable only through the controlStreamServerOptions TEST-INJECTION spread (the F12 shape), so it is null in production unless a test happens to override it");
  }
  return problems;
}

// ---------------------------------------------------------------------------------
// SELF-CHECK PLANT PLUMBING — SYNTHESIZED sources (see acd-clone-credential-pull-
// not-pushed.test.mjs's own plant-plumbing block for the rationale this mirrors
// verbatim): never a string-replace on the real files, so a correct future refactor
// of the real files can never silently turn a plant into a vacuous no-op.
function synthesizeSelector({ hardCoded = null, fallThrough = false } = {}) {
  if (hardCoded === "github-app") {
    return [
      "export function resolveCloneCredentialProvider(config, deps = {}) {",
      "  return { mintCloneCredential: createGithubAppMintProvider({ ...deps }), provider: \"github-app\" };",
      "}",
    ].join("\n");
  }
  if (hardCoded === "env-token") {
    return [
      "export function resolveCloneCredentialProvider(config, deps = {}) {",
      "  return { mintCloneCredential: defaultMintCloneCredential, provider: \"env-token\" };",
      "}",
    ].join("\n");
  }
  return [
    "export function resolveCloneCredentialProvider(config, deps = {}) {",
    "  const provider = config?.mesh?.repo?.credential?.provider;",
    "  if (provider === undefined || provider === \"env-token\") {",
    "    return { mintCloneCredential: defaultMintCloneCredential, provider: \"env-token\" };",
    "  }",
    "  if (provider === \"github-app\") {",
    ...(fallThrough
      ? [
        "    try {",
        "      return { mintCloneCredential: createGithubAppMintProvider({ ...deps, config }), provider: \"github-app\" };",
        "    } catch {",
        "      return { mintCloneCredential: defaultMintCloneCredential, provider: \"env-token\" };",
        "    }",
      ]
      : ["    return { mintCloneCredential: createGithubAppMintProvider({ ...deps, config }), provider: \"github-app\" };"]),
    "  }",
    "  const error = new Error(`unknown clone-credential provider ${JSON.stringify(provider)}`);",
    "  throw error;",
    "}",
  ].join("\n");
}

function synthesizeDefaultMintCloneCredential({ envVar = "AOF_MESH_CLONE_TOKEN", hardCodedLiteral = null } = {}) {
  if (hardCodedLiteral != null) {
    return [
      "export function defaultMintCloneCredential(/* workspaceId, assignmentId */) {",
      `  return "${hardCodedLiteral}";`,
      "}",
    ].join("\n");
  }
  return [
    "export function defaultMintCloneCredential(/* workspaceId, assignmentId */) {",
    `  const token = process.env.${envVar};`,
    "  return typeof token === \"string\" && token.length > 0 ? token : null;",
    "}",
  ].join("\n");
}

function synthesizeControlBlockCallSite({ literalMintKey = true } = {}) {
  return [
    "if (role === \"control\" && options?.streamServer !== false) {",
    "  const startServer = options?.startControlStreamServer ?? startControlStreamServer;",
    "  const { mintCloneCredential: resolvedMintCloneCredential } = resolveCloneCredentialProvider(config, {});",
    "  streamServer = await startServer({",
    "    peerNodeIds: peerNodeIdsFrom(peers),",
    "    peersByAddress: peers,",
    "    httpHandler: createEnrollmentHttpHandler({ config, workspace: ws, now: options?.now ?? null }),",
    ...(literalMintKey ? ["    mintCloneCredential: resolvedMintCloneCredential,"] : []),
    "    ...(options?.controlStreamServerOptions ?? {}),",
    "  });",
    "}",
  ].join("\n");
}

export const archTests = [
  {
    name: "arch/38 ADR-010 (acd-clone-credential-provider-config-driven): the REAL selector genuinely reads config.mesh.repo.credential.provider and can return EITHER provider — no hard-coded single provider",
    run: async () => {
      const source = lf(await readFile(providerSourcePath, "utf8"));
      assert.deepEqual(selectorConfigDrivenProblems(source), [], "the real selector is config-driven");
    },
  },
  {
    name: "arch/38 ADR-010 (acd-clone-credential-provider-config-driven): the REAL selector never catches a github-app selection fault and falls through to the env-token default (T10)",
    run: async () => {
      const source = lf(await readFile(providerSourcePath, "utf8"));
      assert.deepEqual(selectorFallThroughProblems(source), [], "the real selector has no selection-time fall-through");
    },
  },
  {
    name: "arch/38 ADR-010 (acd-clone-credential-provider-config-driven): the REAL env-token default stays byte-identical — reads AOF_MESH_CLONE_TOKEN, never a hard-coded literal",
    run: async () => {
      const source = lf(await readFile(controlSourcePath, "utf8"));
      assert.deepEqual(envTokenByteIdentityProblems(source), [], "the real env-token default is unchanged");
    },
  },
  {
    name: "arch/38 ADR-010 (acd-clone-credential-provider-config-driven): the REAL production wiring passes mintCloneCredential as a LITERAL key at the control startServer({...}) call site (the F12 discipline re-armed)",
    run: async () => {
      const source = lf(await readFile(launcherSourcePath, "utf8"));
      assert.deepEqual(productionMintKeyProblems(source), [], "the real production call site wires the provider literally");
    },
  },
  {
    name: "arch/38 ADR-010 (acd-clone-credential-provider-config-driven): self-check — a hard-coded single provider (either direction), the F12 shape at the production call site, a selection-time env-token fall-through, and an env-token default mutation ALL trip their detector; the correct config-driven, literally-wired selector stays clean",
    run: async () => {
      const realProviderSource = lf(await readFile(providerSourcePath, "utf8"));
      const realLauncherSource = lf(await readFile(launcherSourcePath, "utf8"));
      const realControlSource = lf(await readFile(controlSourcePath, "utf8"));

      // The real tree is clean under every detector (re-asserted here alongside the
      // plants, so a reader sees the FULL non-vacuity story in one place).
      assert.deepEqual(selectorConfigDrivenProblems(realProviderSource), [], "sanity: the real selector is clean");
      assert.deepEqual(selectorFallThroughProblems(realProviderSource), [], "sanity: the real selector has no fall-through");
      assert.deepEqual(envTokenByteIdentityProblems(realControlSource), [], "sanity: the real env-token default is clean");
      assert.deepEqual(productionMintKeyProblems(realLauncherSource), [], "sanity: the real production wiring is clean");

      // PLANT (1a) — hard-coded, ALWAYS github-app.
      const cleanSelector = synthesizeSelector();
      const hardCodedGithubApp = synthesizeSelector({ hardCoded: "github-app" });
      assert.notEqual(hardCodedGithubApp, cleanSelector, "the plant actually differs from the clean synthesized selector");
      assert.ok(selectorConfigDrivenProblems(hardCodedGithubApp).length > 0, "a hard-coded ALWAYS-github-app selector trips the detector");

      // PLANT (1b) — hard-coded, ALWAYS env-token.
      const hardCodedEnvToken = synthesizeSelector({ hardCoded: "env-token" });
      assert.notEqual(hardCodedEnvToken, cleanSelector, "the plant actually differs from the clean synthesized selector");
      assert.ok(selectorConfigDrivenProblems(hardCodedEnvToken).length > 0, "a hard-coded ALWAYS-env-token selector trips the detector");

      // PLANT (3) — a github-app selection fault silently falls through to env-token.
      const fallThroughSelector = synthesizeSelector({ fallThrough: true });
      assert.notEqual(fallThroughSelector, cleanSelector, "the plant actually differs from the clean synthesized selector");
      assert.deepEqual(selectorConfigDrivenProblems(fallThroughSelector), [], "sanity: the fall-through plant is otherwise config-driven (isolates the fall-through detector)");
      assert.ok(selectorFallThroughProblems(fallThroughSelector).length > 0, "a selection-time env-token fall-through trips the detector");

      // PLANT (4a) — a different env var.
      const cleanDefault = synthesizeDefaultMintCloneCredential();
      const differentEnvVar = synthesizeDefaultMintCloneCredential({ envVar: "AOF_MESH_OTHER_TOKEN" });
      assert.notEqual(differentEnvVar, cleanDefault, "the plant actually differs from the clean synthesized default");
      assert.ok(envTokenByteIdentityProblems(differentEnvVar).length > 0, "a default reading a DIFFERENT env var trips the detector");

      // PLANT (4b) — a hard-coded literal token.
      const hardCodedToken = synthesizeDefaultMintCloneCredential({ hardCodedLiteral: "always-this-token" });
      assert.notEqual(hardCodedToken, cleanDefault, "the plant actually differs from the clean synthesized default");
      assert.ok(envTokenByteIdentityProblems(hardCodedToken).length > 0, "a hard-coded literal token trips the detector");

      // PLANT (2) — THE F12 SHAPE: mintCloneCredential reachable ONLY through the
      // controlStreamServerOptions test spread, no literal key at the production site.
      const cleanCallSite = synthesizeControlBlockCallSite();
      const f12CallSite = synthesizeControlBlockCallSite({ literalMintKey: false });
      assert.notEqual(f12CallSite, cleanCallSite, "the plant actually differs from the clean synthesized call site");
      assert.ok(productionMintKeyProblems(f12CallSite).length > 0, "the F12 shape (no literal mintCloneCredential key) trips the detector");

      // NEGATIVE CONTROL — the CORRECT ADR-010 wiring: config-driven selector
      // (env-token unconfigured / github-app configured), passed as a literal key at
      // the production site. Clean under every detector.
      assert.deepEqual(selectorConfigDrivenProblems(cleanSelector), []);
      assert.deepEqual(selectorFallThroughProblems(cleanSelector), []);
      assert.deepEqual(envTokenByteIdentityProblems(cleanDefault), []);
      assert.deepEqual(productionMintKeyProblems(cleanCallSite), []);
    },
  },
];
