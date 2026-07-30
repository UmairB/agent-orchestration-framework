// src/graphify.mjs — the graphify adapter (ADR-002): the SOLE place in the
// codebase that spawns the graphify binary. The graph:* commands call these
// helpers; nothing else (no face, no MCP server runtime, no command module)
// spawns graphify directly — the no-direct-spawn fitness guard (ADR-006 inv. 2)
// asserts the only `graphify` spawn in src/ is here.
//
// This module owns the three spawn-seam concerns RESEARCH flagged, in ONE place:
//   (1) Binary resolution — the install spec is PyPI `graphifyy` (double-y) but
//       the invoked binary is `graphify` (single-y) (RESEARCH §G). As of
//       milestone-12 ADR-004, graphify resolves STORE-FIRST: resolveGraphifyBinary
//       DELEGATES to tool-store.mjs's resolveManagedBinary, which checks the managed
//       store copy (~/.aof/tools/graphify/<version>/{Scripts|bin}/graphify[.exe])
//       BEFORE falling back to the PATH walk (the 09 behaviour, now inside the
//       shared resolver). It still probes the version, degrading to `version: null`
//       when the flag is absent (RESEARCH §A4) rather than ever throwing, and a
//       total miss is still the frozen `{found:false,hint}` no-throw contract
//       (09/ADR-002) — only the hint changes, now naming `aof project provision
//       graphify`.
//   (2) The #756 cwd discipline (RESEARCH §I) — query/path/explain hardcode
//       `<cwd>/graphify-out/graph.json` and IGNORE GRAPHIFY_OUT, so every spawn
//       runs with `cwd = projectRoot`; the driver never redirects via env.
//   (3) Version pinning — PINNED_GRAPHIFY_VERSION is the version the contract is
//       verified against; the verb mapping is gated on it (and is the store-key
//       version the store-first resolver looks up).
//
// The pure, fully-testable core here is `normalizeGraph` (ADR-003): it reads the
// NetworkX `node_link_data` `links` key (NOT `edges`), preserves
// confidence/confidenceScore (score present ONLY for INFERRED), maps node fields
// to camelCase, and keeps `graph.hyperedges` SEPARATE. As of milestone 10/01 that
// pure core lives in the spawn-free `./graph-normalize.mjs` so the graphify MEMORY
// backend can reach it WITHOUT importing this spawn site; this module RE-EXPORTS
// `graphJsonPath`/`readGraph`/`normalizeGraph` from there so 09's command code +
// tests are behaviour-preserved (they still import them from here). The spawn
// helpers need the live binary, so they are exercised only by @manual scenarios.
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { resolveManagedBinary } from "./tool-store.mjs";
// The PURE normalizer (extracted 10/01) — re-exported below so existing 09
// importers (`src/commands/graph-*.mjs`, the 09 tests) keep importing from here.
import { graphJsonPath, readGraph, normalizeGraph, graphArtifactBuiltAt } from "./graph-normalize.mjs";

export { graphJsonPath, readGraph, normalizeGraph, graphArtifactBuiltAt };

// The two names RESEARCH §G flags as load-bearing: install via the PyPI package
// `graphifyy` (double-y), invoke the `graphify` binary (single-y). A doctor/lock
// entry stores BOTH; the resolver returns the binary name it actually found.
export const GRAPHIFY_SPEC = "graphifyy";
export const GRAPHIFY_BINARY = "graphify";

// The version the command contract is verified against (RESEARCH §G desk-checked
// 0.8.44, 2026-06-19). The verb mapping is gated on this; an unexpected installed
// version is a doctor warning (ADR-004), never a silent mismap.
export const PINNED_GRAPHIFY_VERSION = "0.8.44";

// --------------------------------------------------------------- resolution ---

// resolveGraphifyBinary(options?) — the binary-resolution seam (ADR-002), now
// RE-POINTED STORE-FIRST (milestone-12 ADR-004). It DELEGATES to tool-store.mjs's
// resolveManagedBinary, keyed on graphify's name/pinned-version/binary, so the
// managed store copy (~/.aof/tools/graphify/<version>/{Scripts|bin}/graphify[.exe])
// wins over a stray global, and on a store miss it falls back to the SAME PATH walk
// the 09 resolver did (now living inside the shared resolver). Every graphify spawn
// (runGraphifyBuild/Query/Triage) and the doctor check resolve through this one seam.
//
// The FROZEN contract the graph commands depend on is preserved (09/ADR-002):
//   - a found result carries { found:true, binary, path, version } (the additive
//     `source:"store"|"path"` field is fine — callers ignore it);
//   - a total miss is the structured { found:false, hint } and NEVER throws (no
//     opaque ENOENT). Only the hint changes — it now names `aof project provision
//     graphify` (the lifecycle command, ADR-003/ADR-004), not the old two-step
//     manual install.
//   - the version probe degrades to `version: null` on a missing flag / non-zero
//     exit (RESEARCH §A4) — callers render "present, version unknown".
//
// `options` forwards the resolver's injectable seams so callers (and tests) can
// drive store/PATH/probe hermetically without mutating process-global state:
//   options.env        — the env the store root derives from (AOF_GLOBAL_HOME).
//   options.platform   — the platform shaping the exe path (Scripts/.exe vs bin).
//   options.pathValue  — the PATH string to scan on the store-miss fallback.
//   options.useLocator — whether to consult the OS locator (`where`/`which`).
//   options.probe      — an injected `<bin> --version` probe (default: live spawn).
// The production call passes nothing and behaves exactly as the 09 resolver did,
// plus the store-first prefix.
export function resolveGraphifyBinary(options = {}) {
  return resolveManagedBinary({
    name: GRAPHIFY_BINARY,
    version: PINNED_GRAPHIFY_VERSION,
    binary: GRAPHIFY_BINARY,
    ...options,
  });
}

// ------------------------------------------------------------------ spawns ----
// The build/query/triage spawns need the LIVE binary, so they are exercised only
// by @manual scenarios (task 02 / 03 success rows) — no CI test. They are
// implemented honestly against the documented verbs (RESEARCH §B) but must NEVER
// spawn when the binary is absent (ADR-004): callers guard with
// resolveGraphifyBinary() first and throw a structured graphify-missing error.

// graphifyBuildArgs(input, outRoot) — the PURE, testable core of the build argv
// (the `normalizeGraph` idiom: a no-spawn helper a unit test can drive without the
// live binary). graphify 0.8.44 `extract <path>` defaults `--out` to the EXTRACTION
// TARGET (`<path>`), NOT the cwd — so when the build target ≠ the artifact root, the
// #756 `cwd=projectRoot` discipline (which fixes the READ verbs) does NOT control
// extract's WRITE location, and the graph lands under the target folder where the
// driver can't find it. Fix: ALWAYS pin `--out <outRoot>` so the artifact lands at
// <outRoot>/graphify-out/ for the query family to read (verify-2026-06-22,
// finding-F2).
//
// TWO VERBS, chosen by whether a doc/media backend was asked for — because `extract`
// CANNOT honour aof's no-backend contract (measured against graphify 0.8.44,
// 2026-07-30):
//
//   - `extract <path> --out <outRoot>` — the SEMANTIC build. Needs a backend the
//     moment the corpus holds a single doc/paper/image file: with none it exits 1
//     ("no LLM API key found (N doc/paper/image file(s) need semantic extraction)")
//     and writes NOTHING AT ALL, not even the code half. So "omit --backend for a
//     code-only build" was a promise `extract` could not keep on any repo with a
//     README — before the honesty fix that surfaced as a silent no-op, and after it
//     as a hard `graphify-build-failed`. Neither is a usable code-only build.
//   - `update <path>` — the CODE-ONLY build, "re-extract code files and update the
//     graph (no LLM needed)". Measured on a corpus WITH a doc file: exit 0, no key,
//     no backend flag, code coupling + structural document nodes, clustering without
//     LLM community labels. This is what egress=none has always meant, so it is the
//     verb a no-backend build must actually run.
//
// `update` takes no `--out` (it writes <path>/graphify-out/), so it is only correct
// when the extraction target IS the artifact root — exactly the whole-project
// `aof graph build .` the guidance mandates. A no-backend SUBTREE build therefore
// stays on `extract`, where `--out` still pins the artifact and a doc file in the
// subtree fails loudly rather than lying. A tokenBudget is an LLM-extraction knob, so
// its presence also keeps the build on `extract` — never silently dropped.
// Either way NO --backend flag is passed → zero egress (the ADR-006 inv. 4
// egress=none privacy invariant; preserved exactly).
export function graphifyBuildArgs(input, outRoot, projectRoot = outRoot) {
  if (isCodeOnlyWholeRootBuild(input, outRoot, projectRoot)) {
    return ["update", outRoot];
  }
  const args = ["extract", input.path, "--out", outRoot];
  if (input.backend) {
    args.push("--backend", input.backend);
  }
  if (input.tokenBudget != null) {
    args.push("--token-budget", String(input.tokenBudget));
  }
  return args;
}

// True when the request is "the whole artifact root, code only, zero egress" — the one
// shape `graphify update` can serve correctly (it has no --out, so the target must BE
// the root it writes under). PURE + exported so the verb choice is assertable without a
// spawn. A RELATIVE target resolves against `projectRoot` because that is the spawn cwd
// (#756), while the artifact root it must match is `outRoot` — the two differ only for
// the memory backend's work-stream graph, which always names a backend and so never
// reaches here. `path.resolve` both sides so `.`, a trailing separator and an absolute
// target all compare equal; a subtree, a backend, or a tokenBudget answers false and
// keeps the build on `extract`.
export function isCodeOnlyWholeRootBuild(input, outRoot, projectRoot = outRoot) {
  if (input.backend) return false;
  if (input.tokenBudget != null) return false;
  if (typeof input.path !== "string") return false;
  if (typeof outRoot !== "string" || typeof projectRoot !== "string") return false;
  return path.resolve(projectRoot, input.path) === path.resolve(outRoot);
}

// ---------------------------------------------------------- spawn-safety envelope ----
//
// EVERY graphify spawn is SYNCHRONOUS (spawnSync) and, with a network extraction
// backend like `claude-cli`, can run for minutes or block on an interactive prompt —
// so an UNBOUNDED spawn hangs the whole aof process indefinitely. This is the memory
// `ingest`/`reindex` hang: the records index write completes, then the graph:build
// spawn NEVER returns (graphify shells out to the `claude` CLI and blocks). The
// binary-absent "fail soft" (resolveGraphifyBinary → graphify-missing, caught) does
// NOT cover a PRESENT binary that blocks — and that path is @manual, never CI-checked.
// Two guards make every graphify spawn ALWAYS terminate:
//   - `timeout` (+ SIGKILL): a run that outlives the wall-clock budget is force-killed
//     and surfaces as a structured `graphify-timeout` the memory backend FAILS SOFT on
//     (records intact, graph skipped). Tunable via AOF_GRAPHIFY_TIMEOUT_MS for a
//     genuinely large repo; a non-positive/garbage value falls back to the default
//     (never "no timeout" — that would reintroduce the hang).
//   - stdin is IGNORED (`stdio[0]="ignore"`): a graphify/claude-cli prompt that reads
//     stdin gets EOF instead of blocking forever on a pipe nothing writes to.
// stdout/stderr stay piped + captured (encoding:"utf8"), so counts still come from
// graph.json (ADR-001) and the opaque markdown is still carried.
export const GRAPHIFY_TIMEOUT_ENV = "AOF_GRAPHIFY_TIMEOUT_MS";
export const DEFAULT_GRAPHIFY_TIMEOUT_MS = 120_000;

// The wall-clock budget (ms) from AOF_GRAPHIFY_TIMEOUT_MS, or the pinned default. Only
// a positive finite integer overrides; anything else (absent / 0 / negative / garbage)
// falls back to the default so the spawn is NEVER unbounded. `env` is injectable so a
// test drives the override without mutating the global process env.
export function graphifySpawnTimeoutMs(env = process.env) {
  const raw = Number.parseInt(env?.[GRAPHIFY_TIMEOUT_ENV] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GRAPHIFY_TIMEOUT_MS;
}

// The spawnSync options EVERY graphify spawn shares (build/query/triage). Bounds the
// wall-clock, force-kills on overrun, and closes the child's stdin (see the envelope
// note above). Pure + injectable (`env`) so a unit test asserts the guards without a
// live binary.
export function graphifySpawnOptions({ projectRoot, env = process.env } = {}) {
  return {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: graphifySpawnTimeoutMs(env),
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
  };
}

// Translate a spawnSync `result.error` (a timeout kill or a failed launch) into the
// structured command error the callers map. `graphify-timeout` when the wall-clock
// budget was exceeded (spawnSync sets error.code === "ETIMEDOUT" and force-kills) — the
// memory backend FAILS SOFT on it; `graphify-spawn-failed` for any other launch error.
// A clean run (no result.error) is a no-op — the caller reads stdout/graph.json.
function throwOnSpawnError(result, options) {
  if (!result.error) return;
  const timedOut = result.error.code === "ETIMEDOUT";
  const error = new Error(
    timedOut
      ? `graphify timed out after ${options.timeout}ms — raise ${GRAPHIFY_TIMEOUT_ENV} for a large repo, or check the extraction backend is not blocking.`
      : `graphify failed to run: ${result.error.message}`
  );
  error.code = timedOut ? "graphify-timeout" : "graphify-spawn-failed";
  throw error;
}

// graph build — `graphify extract <path> --out <outRoot> [--backend X]
// [--token-budget N]`, or `graphify update <outRoot>` for a code-only build
// (RESEARCH §B; finding-F2; graphifyBuildArgs owns the verb choice). cwd =
// projectRoot so the query family finds <projectRoot>/graphify-out/graph.json (#756,
// RESEARCH §I), AND `--out <outRoot>` so extract WRITES there (its --out default is
// <path>, the target — not cwd). A null/absent backend passes NO --backend flag →
// code/AST only, zero egress (privacy boundary, ADR-005). The spawn is BOUNDED
// (timeout + ignored stdin, see graphifySpawnOptions) so a blocking extraction can't
// hang aof — an overrun throws graphify-timeout, which the memory reindex catches and
// skips soft.
//
// WHAT COUNTS AS A FAILED BUILD (measured against graphify 0.8.44, 2026-07-30 —
// re-derived after the first version of this guard broke the ordinary case):
//
//   exit != 0                     → graphify-build-failed, carrying its stderr.
//   exit 0, NO artifact           → graphify-no-persist. Nothing to read at all.
//   exit 0, artifact UNCHANGED    → SUCCESS, `unchanged: true`.
//   exit 0, artifact rewritten    → SUCCESS, `unchanged: false`.
//
// The third row is the correction. graphify rewrites ONLY on a topology change: a
// re-run over an untouched corpus prints "No code-graph topology changes detected;
// outputs left untouched" and exits 0, and so does a run after an edit that adds no
// node or edge (measured: adding `export const version = 2` to an extracted module
// leaves the artifact byte-identical, while adding a function or a file rewrites it).
// So an unchanged artifact after a zero exit is graphify ASSERTING the graph is
// already current — the ordinary steady state of any repo whose graph is up to date.
// Treating it as a failure meant a second consecutive build could never succeed, and
// the shipped guidance then told the agent to abandon a perfectly current graph and
// fall back to grep-and-infer: the exact harm this family of fixes exists to prevent,
// reached by a new route.
//
// This is also why staleness is NOT inferred from source mtimes. "Any source file
// newer than the artifact ⇒ stale" is wrong for the same measured reason — graphify
// deliberately does not rewrite for a non-topological edit, so that rule fails loudly
// on a current graph. aof has no honest, spawn-free way to second-guess graphify's own
// currency verdict, so it does not try; it reports the fact (`unchanged`) and lets the
// caller read it. The genuine "exited 0 and wrote nothing it should have" is caught
// upstream by the status check — the originally-reported defect exited 1 every time —
// and downstream by graph:build's structured read of the artifact, which turns an
// absent/corrupt/unparseable graph into a build failure rather than a stack trace.
//
// TWO ROOTS, deliberately separable. `projectRoot` is the spawn cwd (the #756 read
// discipline); `outRoot` is the directory whose `graphify-out/graph.json` this build
// writes and reports — and it DEFAULTS to projectRoot, so the codebase graph is
// untouched. It exists because graphify extraction REPLACES the single artifact under
// a root, and aof builds two unrelated graphs: the CODEBASE graph (`aof graph build`,
// read by graph:impact/query) and the memory backend's WORK-STREAM graph (built over
// wiki/work as a recall re-rank signal). Sharing one artifact meant whichever ran last
// evicted the other — a memory reindex silently replaced the code graph with work-item
// nodes, and `graph impact` then answered `present: false` over it, indistinguishable
// from "this module has no coupling". The memory backend passes its own outRoot so the
// two graphs can never collide.
export function runGraphifyBuild(
  input,
  { projectRoot, outRoot = projectRoot, resolveBinary = resolveGraphifyBinary, spawn = spawnSync }
) {
  const resolved = resolveBinary();
  if (!resolved.found) {
    const error = new Error(resolved.hint);
    error.code = "graphify-missing";
    throw error;
  }
  const graphPath = graphJsonPath(outRoot);
  const before = graphArtifactStat(graphPath);
  const args = graphifyBuildArgs(input, outRoot, projectRoot);
  const options = graphifySpawnOptions({ projectRoot });
  const result = spawn(resolved.path, args, options);
  throwOnSpawnError(result, options);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    const error = new Error(
      `graphify ${args[0]} exited with status ${result.status}${detail ? `: ${detail}` : "."}`
    );
    error.code = "graphify-build-failed";
    throw error;
  }
  // A zero exit with NO artifact at all is the one unambiguous "the build produced
  // nothing" — nothing to read, nothing to answer over. Loud, unconditionally.
  const after = graphArtifactStat(graphPath);
  if (!after) {
    const error = new Error(
      `graphify ${args[0]} exited successfully but no graph exists at ${graphPath}.`
    );
    error.code = "graphify-no-persist";
    throw error;
  }
  return {
    graphPath,
    stdout: result.stdout ?? "",
    status: result.status,
    // The SHARED derivation (graph-normalize), not `after.mtime` — the two stat
    // flavours round differently, so deriving it here would report a builtAt a
    // millisecond off the one `graph:impact` prints for the same untouched file.
    builtAt: graphArtifactBuiltAt(graphPath),
    // Whether this run rewrote the artifact. NOT a failure when false: graphify
    // rewrites only on a TOPOLOGY change, so an untouched artifact after a zero exit
    // is graphify asserting the graph is already current. Reported so a caller can
    // tell "rebuilt" from "already current" — two different facts, both successes.
    unchanged: sameGraphArtifact(before, after),
  };
}

// Snapshot the one artifact before and after extraction; a successful process
// is not a successful build unless that artifact was actually persisted.
function graphArtifactStat(graphPath) {
  try {
    return statSync(graphPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sameGraphArtifact(before, after) {
  return before != null
    && before.size === after.size
    && before.mtimeNs === after.mtimeNs
    && before.ctimeNs === after.ctimeNs
    && before.ino === after.ino;
}

// graph query — `graphify query "<question>" [--dfs|--bfs] [--budget N]`
// (RESEARCH §B). cwd = projectRoot (#756). stdout is graphify's human markdown,
// carried opaque (RESEARCH §C); the structured handle is graphPath.
// Query reads the artifact written by the build above; it never spawns a build.
export function runGraphifyQuery(input, { projectRoot }) {
  const resolved = resolveGraphifyBinary();
  if (!resolved.found) {
    const error = new Error(resolved.hint);
    error.code = "graphify-missing";
    throw error;
  }
  const args = ["query", input.question];
  if (input.strategy === "dfs") args.push("--dfs");
  if (input.strategy === "bfs") args.push("--bfs");
  if (input.budget != null) args.push("--budget", String(input.budget));
  const options = graphifySpawnOptions({ projectRoot });
  const result = spawnSync(resolved.path, args, options);
  throwOnSpawnError(result, options);
  return {
    stdout: result.stdout ?? "",
    graphPath: graphJsonPath(projectRoot),
  };
}

// graph triage — `graphify prs --triage` / `prs --conflicts` / `prs N`
// (RESEARCH §B/§H — triage has no MCP tool, so it must drive the CLI). cwd =
// projectRoot (#756). stdout is the triage-queue markdown, carried opaque.
export function runGraphifyTriage(input, { projectRoot }) {
  const resolved = resolveGraphifyBinary();
  if (!resolved.found) {
    const error = new Error(resolved.hint);
    error.code = "graphify-missing";
    throw error;
  }
  const args = ["prs"];
  if (input.pr != null) {
    args.push(String(input.pr));
  } else if (input.mode === "conflicts") {
    args.push("--conflicts");
  } else {
    args.push("--triage");
  }
  const options = graphifySpawnOptions({ projectRoot });
  const result = spawnSync(resolved.path, args, options);
  throwOnSpawnError(result, options);
  return {
    stdout: result.stdout ?? "",
    graphPath: graphJsonPath(projectRoot),
  };
}

// --------------------------------------------------------------- read graph ---
// `readGraph` + the ADR-003 `normalizeGraph` (and its node/edge/hyperedge
// shaping) now live in the spawn-free `./graph-normalize.mjs` (extracted 10/01)
// and are re-exported at the top of this module. The graphify memory backend
// imports them from there directly; 09's command code + tests still import them
// from here, unchanged.
