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
import { resolveManagedBinary } from "./tool-store.mjs";
// The PURE normalizer (extracted 10/01) — re-exported below so existing 09
// importers (`src/commands/graph-*.mjs`, the 09 tests) keep importing from here.
import { graphJsonPath, readGraph, normalizeGraph } from "./graph-normalize.mjs";

export { graphJsonPath, readGraph, normalizeGraph };

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

// graphifyBuildArgs(input, projectRoot) — the PURE, testable core of the build
// argv (the `normalizeGraph` idiom: a no-spawn helper a unit test can drive
// without the live binary). graphify 0.8.44 `extract <path>` defaults `--out` to
// the EXTRACTION TARGET (`<path>`), NOT the cwd — so when the build target ≠
// projectRoot, the #756 `cwd=projectRoot` discipline (which fixes the READ verbs)
// does NOT control extract's WRITE location, and the graph lands under the target
// folder where the driver can't find it under projectRoot. Fix: ALWAYS pin
// `--out <projectRoot>` so the artifact lands at <projectRoot>/graphify-out/ for
// the query family to read (verify-2026-06-22, finding-F2). A null/absent backend
// still passes NO --backend flag → code/AST only, zero egress (the ADR-006 inv. 4
// egress=none privacy invariant; preserved exactly).
export function graphifyBuildArgs(input, projectRoot) {
  const args = ["extract", input.path, "--out", projectRoot];
  if (input.backend) {
    args.push("--backend", input.backend);
  }
  if (input.tokenBudget != null) {
    args.push("--token-budget", String(input.tokenBudget));
  }
  return args;
}

// graph build — `graphify extract <path> --out <projectRoot> [--backend X]
// [--token-budget N]` (RESEARCH §B; finding-F2). cwd = projectRoot so the query
// family finds <projectRoot>/graphify-out/graph.json (#756, RESEARCH §I), AND
// `--out projectRoot` so extract WRITES there (its --out default is <path>, the
// target — not cwd). A null/absent backend passes NO --backend flag → code/AST
// only, zero egress (privacy boundary, ADR-005).
export function runGraphifyBuild(input, { projectRoot }) {
  const resolved = resolveGraphifyBinary();
  if (!resolved.found) {
    const error = new Error(resolved.hint);
    error.code = "graphify-missing";
    throw error;
  }
  const args = graphifyBuildArgs(input, projectRoot);
  const result = spawnSync(resolved.path, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return {
    graphPath: graphJsonPath(projectRoot),
    stdout: result.stdout ?? "",
    status: result.status,
  };
}

// graph query — `graphify query "<question>" [--dfs|--bfs] [--budget N]`
// (RESEARCH §B). cwd = projectRoot (#756). stdout is graphify's human markdown,
// carried opaque (RESEARCH §C); the structured handle is graphPath.
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
  const result = spawnSync(resolved.path, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
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
  const result = spawnSync(resolved.path, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
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
