// Fitness function: acd-clone-credential-pull-not-pushed (milestone 38 / ADR-009 —
// arming ADR-005's deferred credential MECHANISM, RESEARCH §1/A4, SECURITY T1–T4, and
// re-arming ADR-008's producer-vs-fixture rule at the wiring seam)
//
// THE DECISION (ADR-009): the clone credential is PULLED by the worker at the moment it
// actually hits a clone miss — never PUSHED down the directive path. Three structural
// consequences, all encoded here:
//
//  (1) THE FROZEN DIRECTIVE FRAME STAYS FROZEN. `buildDirectiveFrame` remains EXACTLY the
//      five keys 35/ADR-002 froze — { kind, to, assignmentId, itemRef, workspaceId, at }.
//      A credential key on the directive is forbidden: ~every directive needs NO clone (the
//      worker usually already holds the repo), so a credential on the directive is the
//      broadest exposure for the least benefit, and it would break a frozen contract.
//
//  (2) NO CREDENTIAL IS MINTED OR SENT ON THE DIRECTIVE DISPATCH PATH. Control CANNOT know
//      whether a clone is even needed: the deciding fact (`localMeshRepoPublished` — the
//      worker's own on-disk `mesh.repo.published` marker) is readable ONLY on the worker
//      ("the control-side gate ... has no filesystem access to a remote worker's config",
//      mesh-worker-execution.mjs:149-152). So any PUSH design must mint SPECULATIVELY, on
//      every directive — which is per-DIRECTIVE, not the "per-clone ... minted for one
//      assignment, not reused" SECURITY T4 requires. The directive send path
//      (buildDirectiveFrame / sendDirective / dispatchDirectiveOverTargets) must therefore
//      name no credential at all.
//
//  (3) THE CREDENTIAL COLLABORATOR MUST BE PRODUCTION-WIRED — THE F12 GUARD (ADR-008).
//      F12: `mesh-worker-execution.mjs` consumed a `cloneCredential` option, but the ONLY
//      production constructor (`mesh-launcher.mjs`'s `createHandler({...})`) never supplied
//      it — every path to it ran through `...(options?.workerExecutionOptions ?? {})`, a
//      documented TEST-INJECTION seam. The GIT_ASKPASS machinery was fully built and fully
//      green, and could still only ever clone a PUBLIC repo in production. This is ADR-008's
//      defect class again: a component validated against a fixture (an injected fake token),
//      never against its real producer (the launcher, which supplied nothing). The guard:
//        (a) the production call site must NEVER supply a STATIC credential (a token value on
//            the handler's options is per-handler, i.e. per-worker-process — the opposite of
//            per-clone; ADR-009 mandates an async per-clone RESOLVER instead); and
//        (b) ANY credential-shaped collaborator the handler consumes must appear as a LITERAL
//            key at the production call site, not merely be reachable through the
//            test-injection spread. The legacy static `cloneCredential` option is DELETED
//            outright (not merely exempted): a static string is per-HANDLER and therefore
//            structurally cannot be per-clone — SECURITY T4's invariant, enforced by the
//            SHAPE of the seam (an async resolver, called fresh on every clone-miss), not a
//            comment asking politely. The detector still names the legacy option (below) as a
//            defensive, permanently-forbidden shape — clause (a) trips on it unconditionally —
//            but nothing in the shipped source destructures it any more.
//      Clause (b) arms the moment the developer lands the resolver: a resolver that exists but
//      is only test-injectable is exactly F12 again, and fails CI.
//
// Proofs:
//  1. Behavioural, against the REAL producer — `buildDirectiveFrame` returns exactly the five
//     frozen keys, order-sensitive, with no credential key (for a directive carrying extra
//     input).
//  2. Structural — the directive build/dispatch path in `control-stream-server.mjs` names no
//     credential/token/secret (no push, no mint on that path).
//  3. Structural — the production wiring guard (3a/3b above), read from the ACTUAL
//     `createHandler({...})` call site in `mesh-launcher.mjs` and the ACTUAL option
//     destructuring in `mesh-worker-execution.mjs`.
//  Self-check (m03 non-vacuous): a SYNTHESIZED credential key on the directive frame, a
//  SYNTHESIZED mint/credential-send on the dispatch path, a SYNTHESIZED static credential at
//  the production call site, and — the F12 shape itself — a SYNTHESIZED resolver that is
//  consumed by the handler but reachable ONLY through the `workerExecutionOptions` test
//  spread, ALL trip the detector; the correct PULL wiring (resolver as a literal key at the
//  production call site) stays clean. Every plant is built from a hand-written minimal
//  snippet (see the "SELF-CHECK PLANT PLUMBING" block below), never a string-replace on the
//  real files — so a correct refactor of the real files (deleting the legacy option, exactly
//  as this ADR mandates) can never silently turn a plant into a no-op again.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDirectiveFrame } from "../../src/control-stream-server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const controlSourcePath = path.join(repoRoot, "src", "control-stream-server.mjs");
const launcherSourcePath = path.join(repoRoot, "src", "mesh-launcher.mjs");
const workerSourcePath = path.join(repoRoot, "src", "mesh-worker-execution.mjs");

// The FROZEN directive down-frame (35/ADR-002) — "a pure projection, exactly five keys".
// ADR-009 does NOT break it: the credential rides its own frame kind, pulled on demand.
// m38/ADR-013 (story 05) adds an ADDITIVE, ABSENT-IS-BENIGN `command` key (the whole slash-command
// typed into the worker PTY) — a directive WITH a command is 7 keys, not a regression; this freeze
// baseline is the no-command shape, and the credential smuggle guard below is unaffected either way.
const FROZEN_DIRECTIVE_KEYS = ["kind", "to", "assignmentId", "itemRef", "workspaceId", "at"];

// The legacy STATIC credential option — the F12 seam itself. ADR-009 mandates DELETING it in
// favour of an async per-clone resolver, and the shipped source now does (proof 3, and the
// self-check's own closing assertion, both verify the REAL worker source no longer
// destructures this name at all). Retained here as a permanently-forbidden NAME clause 3a
// checks for unconditionally (a defensive, belt-and-suspenders shape check — not a "this
// still needs to exist somewhere" exemption).
const LEGACY_STATIC_CREDENTIAL_OPTION = "cloneCredential";

const CREDENTIAL_SHAPED = /credential|token|secret|password/i;

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// lf(source) — normalise CRLF → LF. The tree is checked out with CRLF endings on this
// platform, so a multi-line plant needle written with "\n" would silently NO-OP against the
// raw source and leave the self-check vacuous (a planted violation that never actually lands
// proves nothing). Applied to every REAL file read below (proofs 1-3, and the self-check's
// own "the real tree is clean" baseline).
function lf(source) {
  return source.replace(/\r\n/g, "\n");
}

// sliceBalanced(source, openIndex) — the substring INSIDE the object/params literal whose
// opening brace is at `openIndex`, brace-depth-balanced (so a nested object/arrow body does
// not truncate the slice early).
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

// topLevelEntries(objectBody) → { keys, spreads } — the DEPTH-0 entries of an object literal.
// Depth-aware across {}, [] and () so that `sendAssignmentStatus: (...args) => f(...args)` is
// read as the KEY `sendAssignmentStatus` (its `...args` are inside parens, depth > 0), and a
// genuine top-level `...(options?.workerExecutionOptions ?? {})` is read as a SPREAD.
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

// productionHandlerCallEntries(launcherSource) — the LITERAL keys the ONE production
// constructor passes to createMeshWorkerExecutionHandler. `mesh-launcher.mjs` is (graph-
// confirmed) the SOLE importer of mesh-worker-execution.mjs, so this call site is the ONLY
// production path into the handler — anything not a literal key here is reachable ONLY
// through the `workerExecutionOptions` test-injection spread.
function productionHandlerCallEntries(launcherSource) {
  const code = stripComments(launcherSource);
  const anchor = code.indexOf("createHandler(");
  if (anchor === -1) return null;
  const open = code.indexOf("{", anchor);
  if (open === -1) return null;
  const body = sliceBalanced(code, open);
  return body == null ? null : topLevelEntries(body);
}

// handlerOptionKeys(workerSource) — the option names createMeshWorkerExecutionHandler
// DESTRUCTURES from its `options` argument (its consumed collaborator set).
function handlerOptionKeys(workerSource) {
  const code = stripComments(workerSource);
  const anchor = code.indexOf("export function createMeshWorkerExecutionHandler");
  if (anchor === -1) return null;
  const destructure = code.indexOf("const {", anchor);
  if (destructure === -1) return null;
  const body = sliceBalanced(code, code.indexOf("{", destructure));
  return body == null ? null : topLevelEntries(body).keys;
}

// assertDirectivePathCarriesNoCredential(controlSource) — proof 2: the directive BUILD and
// SEND path names no credential. Scoped to the directive region of control-stream-server.mjs
// (buildDirectiveFrame → dispatchDirectiveOverTargets), so an unrelated credential mention
// elsewhere in the module (e.g. the docstring's "never imports mesh-registry's credential
// gate") is not a false positive — comments are stripped regardless.
function directivePathProblems(controlSource) {
  const code = stripComments(controlSource);
  const start = code.indexOf("export function buildDirectiveFrame");
  const end = code.indexOf("// ---", start) === -1 ? code.indexOf("export function createStreamRegistry") : code.indexOf("export function createStreamRegistry");
  const region = code.slice(start, end === -1 ? code.length : end);
  const problems = [];
  if (CREDENTIAL_SHAPED.test(region)) {
    problems.push("the directive build/dispatch path names a credential/token/secret — ADR-009: the credential is PULLED on a clone miss, never pushed down the directive path (a directive that never clones must carry no secret; SECURITY T4 per-clone)");
  }
  return problems;
}

function productionWiringProblems(launcherSource, workerSource) {
  const problems = [];
  const call = productionHandlerCallEntries(launcherSource);
  const consumed = handlerOptionKeys(workerSource);
  if (call == null) {
    problems.push("could not locate the production createMeshWorkerExecutionHandler call site in mesh-launcher.mjs");
    return problems;
  }
  if (consumed == null) {
    problems.push("could not locate createMeshWorkerExecutionHandler's option destructuring in mesh-worker-execution.mjs");
    return problems;
  }

  // (3a) LIVE, TODAY AND FOREVER: the production call site must never pass a STATIC credential
  // value. A token on the handler's options is scoped to the HANDLER (one per worker process),
  // not to the clone — the exact opposite of SECURITY T4's "per-clone, minted for one
  // assignment, not reused". ADR-009's production credential path is an async RESOLVER.
  for (const key of call.keys) {
    if (key === LEGACY_STATIC_CREDENTIAL_OPTION || (CREDENTIAL_SHAPED.test(key) && !/^request|^resolve|^mint|^fetch/i.test(key))) {
      problems.push(`the production handler call site passes a STATIC credential option \`${key}\` — ADR-009/SECURITY T4: a credential must be obtained per-clone through an async resolver, never held as a static per-worker-process option`);
    }
  }

  // (3b) THE F12 GUARD — arms on implementation: any credential-shaped collaborator the handler
  // CONSUMES must be supplied as a LITERAL key at the production call site. A collaborator
  // reachable ONLY through `...(options?.workerExecutionOptions ?? {})` — the documented
  // test-injection seam — is production-dead: exactly F12 (the GIT_ASKPASS path was fully built
  // and fully green, yet could only ever clone a PUBLIC repo, because no production caller ever
  // supplied a credential). The legacy static `cloneCredential` is exempt ONLY because clause
  // (3a) forbids supplying it at all; ADR-009 mandates deleting it.
  for (const key of consumed) {
    if (!CREDENTIAL_SHAPED.test(key)) continue;
    if (key === LEGACY_STATIC_CREDENTIAL_OPTION) continue;
    if (!call.keys.includes(key)) {
      problems.push(`the worker-execution handler consumes credential collaborator \`${key}\`, but the production call site (mesh-launcher.mjs) does not supply it as a literal key — it is reachable only through the \`workerExecutionOptions\` TEST-INJECTION spread, so it is null in production (F12 / ADR-008: a component fed only by a fixture, never by its real producer)`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------
// SELF-CHECK PLANT PLUMBING — SYNTHESIZED sources, never a string-replace on the REAL
// files.
//
// The self-check below used to plant violations by `.replace()`-ing literal
// substrings of the ACTUAL `mesh-launcher.mjs` / `mesh-worker-execution.mjs` source.
// That coupled the plants to production TEXT that a correct refactor is free (and, in
// ADR-009's case, REQUIRED) to change — deleting the legacy static `cloneCredential`
// option is exactly such a refactor, and it silently turned a plant's `.replace()`
// into a no-op (the search string no longer existed), which the "did the plant
// actually rewrite the source" guard then correctly (and unhelpfully) failed on. A
// self-check whose non-vacuity depends on a specific implementation shape surviving
// forever is backwards: the DETECTOR is what must be proven robust, not the
// production source's exact bytes.
//
// The fix: build the violating (and clean/negative-control) shapes ourselves, as
// minimal hand-written snippets carrying only the ANCHOR TEXT the detector functions
// above actually key on (`export function buildDirectiveFrame`, `createHandler(`,
// `export function createMeshWorkerExecutionHandler`, …) — never derived from the
// real files at all. This is what the coordinator asked for: "build the violating
// shape yourself and feed it to the detector."
//
// Two disciplines carried over from the original string-replace plants, both still
// load-bearing:
//   (1) EVERY plant still asserts it actually differs from its own clean baseline
//       (`assert.notEqual(planted, clean)`) before asserting the detector trips —
//       now guarding against a copy/paste mistake in the plant's OWN construction
//       (e.g. accidentally passing the same shape to both sides) rather than a
//       failed string search, but the same "a plant that didn't land proves
//       nothing" principle.
//   (2) Every snippet is built with EXPLICIT "\n" line joins (Array#join("\n")),
//       never a raw multi-line template literal — so its runtime shape is immune to
//       the repo's own CRLF checkout convention, the SAME hazard `lf()` guards
//       against for the real files, closed here at the source instead of by
//       normalising after the fact.
function synthesizeDirectiveRegion({ returnStatement, dispatchExtra = "" }) {
  return [
    "export function buildDirectiveFrame(to, { assignmentId, itemRef, workspaceId, at }) {",
    `  ${returnStatement}`,
    "}",
    "",
    "export function dispatchDirectiveOverTargets(targets, directive, { getMeshRegistry = () => null } = {}) {",
    ...(dispatchExtra ? [`  ${dispatchExtra}`] : []),
    "  return sendDirective(targets, directive?.to, directive);",
    "}",
    "",
    "export function createStreamRegistry() {",
    "  return {};",
    "}",
  ].join("\n");
}

// synthesizeLauncherCallSite({ extraKey }) — the shape of mesh-launcher.mjs's ONE
// production `createHandler({...})` call site. `extraKey`, when supplied, is a
// literal `key: value,` line inserted BEFORE the `now`/spread tail — exactly where
// ADR-009 mandates the real resolver line live.
function synthesizeLauncherCallSite({ extraKey = null } = {}) {
  return [
    "export async function startLauncher(ws, options = {}) {",
    "  if (options?.workerExecution !== false) {",
    "    const createHandler = options?.createMeshWorkerExecutionHandler ?? createMeshWorkerExecutionHandler;",
    "    const handler = createHandler({",
    "      loadWs: options?.workerExecutionLoadWs ?? (() => Promise.resolve(ws)),",
    "      nodeId,",
    "      sendAssignmentStatus: (...args) => client.sendAssignmentStatus(...args),",
    ...(extraKey ? [`      ${extraKey}`] : []),
    "      now: nowFn,",
    "      ...(options?.workerExecutionOptions ?? {}),",
    "    });",
    "    client.onDirective(handler);",
    "  }",
    "}",
  ].join("\n");
}

// synthesizeWorkerDestructure({ extraKey }) — the shape of createMeshWorkerExecutionHandler's
// OWN top-level options destructure. `extraKey`, when supplied, is a BARE (no
// default value) destructured name, appended after the non-credential collaborators
// — mirroring how a real credential-shaped option is always destructured bare (its
// absence must resolve to `undefined`, never a silently-wrong default).
function synthesizeWorkerDestructure({ extraKey = null } = {}) {
  return [
    "export function createMeshWorkerExecutionHandler(options = {}) {",
    "  const {",
    "    loadWs = () => loadWorkspace(process.cwd()),",
    "    nodeId,",
    "    sendAssignmentStatus,",
    "    spawnRuntime = defaultSpawnRuntime,",
    "    now = () => new Date().toISOString(),",
    "    exec,",
    "    driver,",
    "    onCleanup = () => {},",
    "    openStore,",
    "    globalWorkStoreOptions,",
    "    cloneExec,",
    ...(extraKey ? [`    ${extraKey},`] : []),
    "  } = options;",
    "  return async function handleDirective(directive) {};",
    "}",
  ].join("\n");
}

export const archTests = [
  {
    name: "arch/38 ADR-009 (acd-clone-credential-pull-not-pushed): the FROZEN directive down-frame still carries EXACTLY the five 35/ADR-002 keys — no credential rides the directive (behavioural, real producer)",
    run: async () => {
      const frame = buildDirectiveFrame("worker-a", {
        assignmentId: "asg-1",
        itemRef: "38/01",
        workspaceId: "ws-1",
        at: "2026-07-12T10:00:00.000Z",
        // A caller that tries to smuggle a credential through the builder gets NOTHING on
        // the frame — the projection is closed over exactly five keys.
        cloneCredential: "ghs_smuggled_token",
      });
      assert.deepEqual(Object.keys(frame), FROZEN_DIRECTIVE_KEYS, "the directive frame is the frozen five-key projection");
      assert.ok(!CREDENTIAL_SHAPED.test(JSON.stringify(frame)), "no credential value reaches the directive frame");
    },
  },
  {
    name: "arch/38 ADR-009 (acd-clone-credential-pull-not-pushed): the directive build/dispatch path mints and sends NO credential (structural — control cannot know a clone is needed, so a push must mint speculatively)",
    run: async () => {
      const controlSource = await readFile(controlSourcePath, "utf8");
      assert.deepEqual(directivePathProblems(controlSource), [], "the directive path names no credential");
    },
  },
  {
    name: "arch/38 ADR-009 (acd-clone-credential-pull-not-pushed): the clone credential is PRODUCTION-WIRED — no static credential at the production call site, and no credential collaborator reachable only through the test-injection spread (the F12 guard)",
    run: async () => {
      const launcherSource = await readFile(launcherSourcePath, "utf8");
      const workerSource = await readFile(workerSourcePath, "utf8");
      const problems = productionWiringProblems(launcherSource, workerSource);
      assert.deepEqual(problems, [], `production-wiring problems: ${JSON.stringify(problems, null, 2)}`);
    },
  },
  {
    name: "arch/38 ADR-009 (acd-clone-credential-pull-not-pushed): self-check — a credential on the directive frame, a mint on the dispatch path, a static credential at the production call site, and the F12 shape (a resolver reachable ONLY through the test spread) all trip the detector; the correct PULL wiring stays clean",
    run: async () => {
      const controlSource = lf(await readFile(controlSourcePath, "utf8"));
      const launcherSource = lf(await readFile(launcherSourcePath, "utf8"));
      const workerSource = lf(await readFile(workerSourcePath, "utf8"));

      // The real tree is clean under every detector.
      assert.deepEqual(directivePathProblems(controlSource), [], "the real directive path is clean");
      assert.deepEqual(productionWiringProblems(launcherSource, workerSource), [], "the real production wiring is clean");

      // Every plant below is SYNTHESIZED (see the plant-plumbing block above) — never
      // a string-replace on `controlSource`/`launcherSource`/`workerSource` — so a
      // correct refactor of the real files (e.g. ADR-009's own mandate to DELETE the
      // legacy static `cloneCredential` option) can never silently turn a plant into
      // a vacuous no-op again.

      // PLANT 1 — candidate (a), rejected: a credential key added to the FROZEN directive frame.
      const cleanDirectiveRegion = synthesizeDirectiveRegion({
        returnStatement: 'return { kind: "directive", to, assignmentId, itemRef, workspaceId, at };',
      });
      assert.deepEqual(directivePathProblems(cleanDirectiveRegion), [], "sanity: the synthesized CORRECT shape is clean");
      const plantedFrameKey = synthesizeDirectiveRegion({
        returnStatement: 'return { kind: "directive", to, assignmentId, itemRef, workspaceId, at, cloneCredential };',
      });
      assert.notEqual(plantedFrameKey, cleanDirectiveRegion, "the plant actually differs from the clean synthesized shape");
      assert.ok(directivePathProblems(plantedFrameKey).length > 0, "a credential key on the directive frame trips the detector");

      // PLANT 2 — candidate (b), rejected: control MINTS + pushes a credential on the dispatch
      // path (a separate frame sent alongside the directive). Still a secret on every directive.
      const plantedPush = synthesizeDirectiveRegion({
        returnStatement: 'return { kind: "directive", to, assignmentId, itemRef, workspaceId, at };',
        dispatchExtra: 'const token = mintCloneToken(directive?.workspaceId); if (token != null) sendDirective(targets, directive?.to, { kind: "clone-credential", to: directive?.to, token });',
      });
      assert.notEqual(plantedPush, cleanDirectiveRegion, "the plant actually differs from the clean synthesized shape");
      assert.ok(directivePathProblems(plantedPush).length > 0, "a mint/push of a credential on the directive dispatch path trips the detector");

      // PLANT 3 — a STATIC credential passed at the production call site (per-worker-process,
      // not per-clone — SECURITY T4).
      const cleanLauncherCallSite = synthesizeLauncherCallSite();
      const cleanWorkerDestructure = synthesizeWorkerDestructure();
      assert.deepEqual(
        productionWiringProblems(cleanLauncherCallSite, cleanWorkerDestructure),
        [],
        "sanity: the synthesized CORRECT shape (no credential-shaped collaborator on either side) is clean",
      );
      const plantedStatic = synthesizeLauncherCallSite({ extraKey: "cloneCredential: config?.mesh?.repo?.token ?? null," });
      assert.notEqual(plantedStatic, cleanLauncherCallSite, "the plant actually differs from the clean synthesized call site");
      assert.ok(
        productionWiringProblems(plantedStatic, cleanWorkerDestructure).length > 0,
        "a static credential at the production call site trips the detector",
      );

      // PLANT 4 — THE F12 SHAPE ITSELF: the handler CONSUMES `requestCloneCredential`, but the
      // launcher supplies it nowhere — so the only path to it is the `workerExecutionOptions`
      // test-injection spread. Green tests, null credential in production, private clone
      // impossible. Exactly the F12 defect.
      const workerWithResolver = synthesizeWorkerDestructure({ extraKey: "requestCloneCredential" });
      assert.notEqual(workerWithResolver, cleanWorkerDestructure, "the plant actually differs from the clean synthesized destructure");
      assert.ok(
        handlerOptionKeys(workerWithResolver).includes("requestCloneCredential"),
        "the planted handler really does consume the resolver",
      );
      const launcherWithoutResolver = cleanLauncherCallSite; // supplies no requestCloneCredential
      const f12Problems = productionWiringProblems(launcherWithoutResolver, workerWithResolver);
      assert.ok(
        f12Problems.some((problem) => problem.includes("TEST-INJECTION spread")),
        "the F12 shape (a credential collaborator reachable only through the test-injection spread) trips the detector",
      );

      // NEGATIVE CONTROL — the CORRECT ADR-009 wiring: the resolver is a LITERAL key at the
      // production call site (closing over the worker's own stream client, which pulls a token
      // from control on a clone miss). Clean.
      const correctLauncher = synthesizeLauncherCallSite({ extraKey: "requestCloneCredential: (request) => client.requestCloneCredential(request)," });
      assert.notEqual(correctLauncher, launcherWithoutResolver, "the negative control actually differs from the resolver-less call site");
      assert.deepEqual(
        productionWiringProblems(correctLauncher, workerWithResolver),
        [],
        "the correct PULL wiring (resolver supplied as a literal key by the real producer) is clean",
      );

      // NEGATIVE CONTROL, real producer, for completeness: the ACTUAL fixed source
      // (read fresh above) already proved clean at the top of this test — the exact
      // shape ADR-009 mandates (no static option, resolver as a literal key) really
      // is what ships, not merely what a synthesized snippet can represent.
      assert.ok(!handlerOptionKeys(workerSource).includes(LEGACY_STATIC_CREDENTIAL_OPTION), "the real, shipped worker source no longer consumes the legacy static option at all — ADR-009's DELETE, not merely an exemption");
    },
  },
];
