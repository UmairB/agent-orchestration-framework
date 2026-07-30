// Traceability wiring for milestone 09 / story 00 — the graphify command core.
//
// Covers the @executable scenarios across the four task features (the @manual
// driver-spawn / query+triage SUCCESS rows are DEFERRED — they need the live
// graphify binary). One test object per @executable scenario (Scenario-Outline
// rows folded into one entry), each name tracing to feature + scenario.
//
//   00_graph-commands-registered.feature — three graph ids alongside six work ids /
//        getCommand hit+miss / frozen {id,input,run,cli} shape / CLI spawn-and-parse
//        single JSON envelope per verb / unknown verb exits non-zero
//   01_graph-json-normalization.feature  — edges from `links` / links-absent+edges
//        a format error / confidence + confidenceScore (INFERRED-only) /
//        hyperedges separate / node camelCase + id join key
//   03_query-triage-results.feature      — missing-graph build-first error (the only
//        @executable rows; the query/triage SUCCESS rows are @manual)
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { statSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { getCommand, listCommands, invoke } from "../src/command-core.mjs";
import {
  normalizeGraph,
  graphifyBuildArgs,
  graphifySpawnOptions,
  runGraphifyBuild,
  GRAPHIFY_TIMEOUT_ENV,
  DEFAULT_GRAPHIFY_TIMEOUT_MS,
} from "../src/graphify.mjs";
import { classifyEgress, isNetworkBackend } from "../src/commands/graph-build.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");
const FIXTURE_GRAPH = path.join(repoRoot, "test", "fixtures", "graph", "graph.json");

const SIX_WORK_IDS = ["work:list", "work:doc", "work:tasks", "work:validate", "work:next", "work:feedback"];
const THREE_GRAPH_IDS = ["graph:build", "graph:query", "graph:triage"];

// --- fixture builders --------------------------------------------------------

// A minimal work-stream fixture workspace (a project root with a .aof config) —
// enough for loadWorkspace to resolve a projectRoot/workDir.
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-graphcore-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return { repo, workDir };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

async function readFixtureGraph() {
  return JSON.parse(await readFile(FIXTURE_GRAPH, "utf8"));
}

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Assert a thrown error carries the expected `.code` (the command error contract).
async function assertRejectsWithCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected a thrown error with code "${code}"`);
  assert.equal(caught.code, code, `the error carries code "${code}" (got "${caught.code}": ${caught.message})`);
  return caught;
}

export const graphCommandCoreTests = [
  // ═══════════════════ 00_graph-commands-registered.feature ══════════════════
  {
    name: "graph-core/00 the registry exposes the three graph commands alongside the work commands",
    async run() {
      const ids = listCommands().map((command) => command.id);
      for (const id of THREE_GRAPH_IDS) {
        assert.ok(ids.includes(id), `the registry exposes "${id}"`);
      }
      for (const id of SIX_WORK_IDS) {
        assert.ok(ids.includes(id), `the six work command ids are still present ("${id}")`);
      }
    },
  },
  {
    name: "graph-core/00 getCommand resolves a registered graph id and only a registered id",
    async run() {
      // Examples: graph:build/query/triage → returns a command ; graph:nope → nothing
      for (const id of THREE_GRAPH_IDS) {
        const command = getCommand(id);
        assert.ok(command, `getCommand("${id}") returns a command`);
        assert.equal(command.id, id, "the returned command carries the looked-up id");
      }
      assert.equal(getCommand("graph:nope"), undefined, "an unknown graph id returns nothing");
    },
  },
  {
    name: "graph-core/00 every graph command carries the frozen { id, input, run, cli } shape",
    async run() {
      for (const id of THREE_GRAPH_IDS) {
        const command = getCommand(id);
        // id is a string equal to its registry key
        assert.equal(typeof command.id, "string", `${id} id is a string`);
        assert.equal(command.id, id, `${id} id equals its registry key`);
        // input is a schema that survives a JSON round-trip unchanged (plain data)
        assert.ok(command.input && typeof command.input === "object", `${id} has an input schema`);
        assert.deepEqual(
          JSON.parse(JSON.stringify(command.input)),
          command.input,
          `${id} input survives a JSON round-trip unchanged (no functions)`
        );
        // run is an async function
        assert.equal(typeof command.run, "function", `${id} has a run function`);
        assert.equal(command.run.constructor.name, "AsyncFunction", `${id} run is async`);
        // cli is an adapter with argv + render
        assert.ok(command.cli && typeof command.cli === "object", `${id} has a cli adapter`);
        assert.equal(typeof command.cli.argv, "function", `${id} cli.argv is a function`);
        assert.equal(typeof command.cli.render, "function", `${id} cli.render is a function`);
      }
    },
  },
  {
    name: "graph-core/00 aof graph <verb> --json emits a single parseable JSON envelope per verb",
    async run() {
      const { repo } = await makeRepo();
      try {
        // No graphify binary + no built graph in the fixture, so each verb emits
        // its STRUCTURED-ERROR envelope ({ ok:false, error, code }) — that is the
        // expected reachability proof (the verb IS dispatched and produces a single
        // parseable JSON document).
        for (const verb of ["build", "query", "triage"]) {
          const args =
            verb === "build"
              ? ["graph", "build", ".", "--json"]
              : verb === "query"
                ? ["graph", "query", "what calls main", "--json"]
                : ["graph", "triage", "--json"];
          const result = runCli(repo, args);
          // A structured-error envelope sets a non-zero exit; a crash would be a
          // null status with no stdout. Either way stdout must be one JSON doc.
          let parsed;
          assert.doesNotThrow(
            () => { parsed = JSON.parse(result.stdout); },
            `aof graph ${verb} --json emits a single parseable JSON document (stdout: ${result.stdout.slice(0, 200)}; stderr: ${result.stderr.slice(0, 200)})`
          );
          assert.ok(parsed !== undefined && parsed !== null, `aof graph ${verb} --json produced a JSON value`);
          assert.equal(typeof parsed, "object", `aof graph ${verb} --json is a single envelope object`);
          // The envelope is for THIS operation: a structured-error envelope here
          // (no binary/graph), which is a parseable single-pass JSON object.
          assert.equal(parsed.ok, false, `aof graph ${verb} --json emits the structured-error envelope (no binary/graph)`);
          assert.equal(typeof parsed.error, "string", `the ${verb} envelope carries an error message`);
          assert.equal(typeof parsed.code, "string", `the ${verb} envelope carries a code`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "graph-core/00 aof graph on an unknown verb exits non-zero and names it",
    async run() {
      const { repo } = await makeRepo();
      try {
        const result = runCli(repo, ["graph", "nonsense"]);
        assert.notEqual(result.status, 0, "an unknown graph verb exits non-zero");
        assert.ok(
          result.stderr.includes("nonsense"),
          `stderr names the unknown graph verb (stderr: ${result.stderr.slice(0, 200)})`
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ════════ 00 egress classifier + offline guard (FIX 1, ADR-001/ADR-005) ══════
  // Additive @executable hardening of the build command's egress field + the
  // ADR-001 offline-forbids-network-backend guard. Hermetic: the classifier is
  // pure; the offline conflict throws inside run() BEFORE any spawn (and before
  // the binary check), so it is CI-checkable with no graphify binary.
  {
    name: "graph-core/00 the egress classifier reports the doc/media hop, never reclassifies by locality",
    async run() {
      // none → "none" (code/AST only, fully local); ANY backend → "docs-media".
      // The privacy-relevant row: ollama is LOCAL but the doc/media hop still RAN,
      // so egress is "docs-media" — locality is a SEPARATE property (ADR-005).
      assert.equal(classifyEgress(null), "none", "no backend ⇒ egress none");
      assert.equal(classifyEgress(undefined), "none", "absent backend ⇒ egress none");
      assert.equal(classifyEgress("claude"), "docs-media", "a network backend ⇒ egress docs-media");
      assert.equal(classifyEgress("ollama"), "docs-media", "ollama (local) ⇒ STILL docs-media — the hop ran");
      // The locality classification the offline guard keys on (a SEPARATE axis).
      assert.equal(isNetworkBackend(null), false, "no backend is not a network backend");
      assert.equal(isNetworkBackend("ollama"), false, "ollama is LOCAL (not a network backend)");
      assert.equal(isNetworkBackend("claude"), true, "claude is a network backend");
      assert.equal(isNetworkBackend("openai"), true, "openai is a network backend");
    },
  },
  {
    name: "graph-core/00 offline:true forbids a network backend and is rejected before any spawn",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        // offline + a network backend → the offline-backend-conflict error, thrown
        // BEFORE the binary check / any spawn (so it fires with no graphify present).
        const error = await assertRejectsWithCode(
          () => invoke("graph:build", { path: ".", backend: "claude", offline: true }, ctx),
          "offline-backend-conflict"
        );
        assert.ok(/offline/i.test(error.message), "the conflict error names the offline mode");
        assert.ok(/claude/.test(error.message), "the conflict error names the rejected backend");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "graph-core/00 offline:true allows the local ollama backend and a no-backend build (no conflict)",
    async run() {
      // The offline guard forbids only NETWORK backends (ADR-001). ollama is local and
      // an absent backend is code-only — neither is a network backend, so offline+ollama
      // and offline+none clear the conflict guard. Asserted on the pure exported
      // classifier so the test is HERMETIC — independent of whether the graphify binary
      // is installed (invoking the full build would, on a graphify-present box, spawn the
      // real tool and surface ENOENT/run errors instead of a deterministic outcome).
      assert.equal(isNetworkBackend("ollama"), false, "ollama is a local backend → offline allows it");
      assert.equal(isNetworkBackend(undefined), false, "an absent backend is code-only → offline allows it");
      assert.equal(isNetworkBackend(null), false, "a null backend is code-only → offline allows it");
      assert.equal(isNetworkBackend("claude"), true, "a network backend (claude) is precisely what offline forbids");
    },
  },

  // ═══ 00 build-argv: --out pins projectRoot for the WRITE verb (@finding-F2) ═══
  // Regression guard for verify-2026-06-22 finding-F2: graphify 0.8.44 `extract`
  // defaults --out to the EXTRACTION TARGET (not cwd), so a build whose target ≠
  // projectRoot wrote graph.json under the target folder and then failed to read it
  // under projectRoot (the #756 cwd discipline fixes the READ verbs, not extract's
  // WRITE location). The fix pins `--out <projectRoot>` on the build argv. Asserted
  // on the PURE graphifyBuildArgs helper so the guard is CI-runnable with NO live
  // binary (the @manual 00/02 build lane cannot guard this in CI). Also re-asserts
  // the ADR-006 inv. 4 egress=none privacy invariant: a null/absent backend yields
  // NO --backend flag.
  {
    name: "graph-core/00 the build argv pins --out to the projectRoot (finding-F2) and gates --backend on egress",
    async run() {
      const projectRoot = "/some/project/root";
      const target = "/some/other/target/dir";

      // (a) --out is present and immediately followed by the projectRoot value, so
      // extract WRITES the graph under <projectRoot>/graphify-out/ even when the
      // build target differs from the project root.
      const noBackendArgs = graphifyBuildArgs({ path: target }, projectRoot);
      assert.deepEqual(
        noBackendArgs.slice(0, 2),
        ["extract", target],
        "the argv starts with `extract <target>`"
      );
      const outIndex = noBackendArgs.indexOf("--out");
      assert.notEqual(outIndex, -1, "the build argv always carries --out");
      assert.equal(
        noBackendArgs[outIndex + 1],
        projectRoot,
        "--out is immediately followed by the projectRoot value (finding-F2: extract writes target-relative by default)"
      );

      // (b) the egress=none guard (ADR-006 inv. 4): a no-backend input yields NO
      // --backend flag at all — code/AST only, zero egress.
      assert.ok(
        !noBackendArgs.includes("--backend"),
        "a no-backend input passes NO --backend flag (the egress=none privacy invariant)"
      );

      // (c) a --backend claude input carries `--backend claude` (the egress hop),
      // and --out projectRoot still holds.
      const backendArgs = graphifyBuildArgs({ path: target, backend: "claude" }, projectRoot);
      const backendIndex = backendArgs.indexOf("--backend");
      assert.notEqual(backendIndex, -1, "a backend input carries a --backend flag");
      assert.equal(backendArgs[backendIndex + 1], "claude", "the --backend flag names the requested backend");
      const backendOutIndex = backendArgs.indexOf("--out");
      assert.equal(
        backendArgs[backendOutIndex + 1],
        projectRoot,
        "--out still pins the projectRoot when a backend is set"
      );
    },
  },

  {
    name: "graph-core/00 a non-zero graphify build fails loudly instead of reading the stale graph",
    async run() {
      const { repo } = await makeRepo();
      const graphPath = path.join(repo, "graphify-out", "graph.json");
      try {
        await mkdir(path.dirname(graphPath), { recursive: true });
        await writeFile(graphPath, '{"nodes":[{"id":"stale"}],"links":[]}\n', "utf8");

        // Mutation proof: removing the status guard makes this return a successful
        // stale BuildResult; this assertion then goes red.
        const error = await assertRejectsWithCode(
          () => runGraphifyBuild(
            { path: "apps/portal/src" },
            {
              projectRoot: repo,
              resolveBinary: () => ({ found: true, path: "graphify-test" }),
              spawn: () => ({
                status: 1,
                stdout: "[graphify extract] scanned 412 code, 9 docs",
                stderr: "error: no LLM API key found",
              }),
            }
          ),
          "graphify-build-failed"
        );
        assert.match(error.message, /no LLM API key found/, "the child stderr explains why no graph was written");
        assert.match(await readFile(graphPath, "utf8"), /stale/, "the stale artifact remains identifiable as stale");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "graph-core/00 a zero exit that persists nothing fails loudly",
    async run() {
      const { repo } = await makeRepo();
      const graphPath = path.join(repo, "graphify-out", "graph.json");
      try {
        await mkdir(path.dirname(graphPath), { recursive: true });
        await writeFile(graphPath, '{"nodes":[{"id":"stale"}],"links":[]}\n', "utf8");

        // Mutation proof: removing the before/after artifact guard makes this
        // unchanged graph report success; this assertion then goes red.
        await assertRejectsWithCode(
          () => runGraphifyBuild(
            { path: "apps/portal/src" },
            {
              projectRoot: repo,
              resolveBinary: () => ({ found: true, path: "graphify-test" }),
              spawn: () => ({ status: 0, stdout: "scan complete", stderr: "" }),
            }
          ),
          "graphify-no-persist"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "graph-core/00 a persisted build reports builtAt from the artifact mtime",
    async run() {
      const { repo } = await makeRepo();
      const graphPath = path.join(repo, "graphify-out", "graph.json");
      const artifactTime = new Date("2024-02-03T04:05:06.000Z");
      try {
        await mkdir(path.dirname(graphPath), { recursive: true });
        await writeFile(graphPath, '{"nodes":[{"id":"stale"}],"links":[]}\n', "utf8");

        const result = runGraphifyBuild(
          { path: "." },
          {
            projectRoot: repo,
            resolveBinary: () => ({ found: true, path: "graphify-test" }),
            spawn: () => {
              writeFileSync(graphPath, '{"nodes":[{"id":"fresh"},{"id":"second"}],"links":[]}\n', "utf8");
              utimesSync(graphPath, artifactTime, artifactTime);
              return { status: 0, stdout: "wrote graph.json", stderr: "" };
            },
          }
        );

        // Mutation proof: replacing the artifact mtime with the call-time clock
        // makes this exact historical timestamp assertion fail.
        assert.equal(result.builtAt, artifactTime.toISOString());
        assert.equal(result.builtAt, statSync(graphPath).mtime.toISOString());
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // Every graphify spawn (build/query/triage) is SYNCHRONOUS; with the network
  // claude-cli extraction backend it can block for minutes or wait on an interactive
  // prompt, so an UNBOUNDED spawn hangs the whole aof process — this was the
  // `aof work memory ingest`/`reindex` hang (the records index wrote, then the graph
  // spawn never returned). graphifySpawnOptions is the guard: a positive finite
  // wall-clock timeout (force-kill on overrun) + an IGNORED stdin (a prompt gets EOF,
  // not a hang). Asserted on the PURE helper so the guard is CI-runnable with NO live
  // binary (the @manual build/query/triage lanes cannot guard this).
  {
    name: "graph-core/spawn the graphify spawn is BOUNDED (finite timeout + ignored stdin) so a hung extraction can't block aof",
    async run() {
      const projectRoot = "/some/project/root";

      const opts = graphifySpawnOptions({ projectRoot });
      assert.equal(opts.cwd, projectRoot, "the spawn runs with cwd = projectRoot (#756)");
      assert.ok(
        Number.isFinite(opts.timeout) && opts.timeout > 0,
        "a positive, finite timeout is always set (never unbounded)"
      );
      assert.equal(opts.timeout, DEFAULT_GRAPHIFY_TIMEOUT_MS, "the default timeout is the pinned default");
      assert.ok(opts.killSignal, "a kill signal is set so a hung child is force-killed on overrun");
      assert.equal(
        Array.isArray(opts.stdio) && opts.stdio[0],
        "ignore",
        "the child's stdin is ignored (an interactive read gets EOF, never a hang)"
      );

      // AOF_GRAPHIFY_TIMEOUT_MS raises the budget for a large repo — injected via the env
      // seam so the global process env is never mutated.
      const tuned = graphifySpawnOptions({ projectRoot, env: { [GRAPHIFY_TIMEOUT_ENV]: "5000" } });
      assert.equal(tuned.timeout, 5000, "AOF_GRAPHIFY_TIMEOUT_MS overrides the default timeout");

      // A non-positive / garbage override falls back to the default — never "no timeout"
      // (which would reintroduce the hang).
      const garbage = graphifySpawnOptions({ projectRoot, env: { [GRAPHIFY_TIMEOUT_ENV]: "-1" } });
      assert.equal(
        garbage.timeout,
        DEFAULT_GRAPHIFY_TIMEOUT_MS,
        "a non-positive override falls back to the default (never unbounded)"
      );
    },
  },

  // ═══════════════════ 01_graph-json-normalization.feature ═══════════════════
  {
    name: "graph-core/01 the normalizer reads edges from the links key",
    async run() {
      const raw = await readFixtureGraph();
      const normalized = normalizeGraph(raw);
      // edges come from `links`, not `edges` — count equals the links array length.
      assert.equal(normalized.edges.length, raw.links.length, "normalized edges count equals the fixture's `links` length");
      assert.ok(normalized.edges.length > 0, "the fixture has edges (guards against a silently empty set)");
      for (const edge of normalized.edges) {
        assert.ok("source" in edge && "target" in edge && "relation" in edge, "each normalized edge carries a source, target, and relation");
        assert.equal(typeof edge.source, "string");
        assert.equal(typeof edge.target, "string");
        assert.equal(typeof edge.relation, "string");
      }
    },
  },
  {
    name: "graph-core/01 a links-absent edges-present graph is a surfaced format error",
    async run() {
      // A malformed graph with an `edges` array and NO `links` array.
      const malformed = {
        directed: true,
        graph: {},
        nodes: [{ id: "a", label: "A", file_type: "code", source_file: "a.py", community: 0, norm_label: "a" }],
        edges: [{ source: "a", target: "a", relation: "calls", confidence: "EXTRACTED" }],
      };
      let caught = null;
      try {
        normalizeGraph(malformed);
      } catch (error) {
        caught = error;
      }
      assert.ok(caught, "normalization reports a graph-format error (it throws)");
      assert.equal(caught.code, "graph-format", "the error carries the graph-format code");
      // It does NOT silently return an empty edge set — it threw before any return.
      assert.ok(/links/i.test(caught.message) || /edges/i.test(caught.message), "the error names the links/edges format problem");
    },
  },
  {
    name: "graph-core/01 confidence is preserved and confidenceScore survives only for INFERRED",
    async run() {
      // Examples folded: EXTRACTED (no score → absent), INFERRED 0.62 → 0.62,
      // INFERRED 1.0 → 1.0, INFERRED no score → absent, AMBIGUOUS no score → absent.
      const cases = [
        { confidence: "EXTRACTED", score: undefined, expected: "absent" },
        { confidence: "INFERRED", score: 0.62, expected: 0.62 },
        { confidence: "INFERRED", score: 1.0, expected: 1.0 },
        { confidence: "INFERRED", score: undefined, expected: "absent" },
        { confidence: "AMBIGUOUS", score: undefined, expected: "absent" },
      ];
      for (const { confidence, score, expected } of cases) {
        const link = { source: "a", target: "b", relation: "calls", confidence };
        if (score !== undefined) link.confidence_score = score;
        const raw = {
          graph: {},
          nodes: [],
          links: [link],
        };
        const [edge] = normalizeGraph(raw).edges;
        assert.equal(edge.confidence, confidence, `confidence "${confidence}" is preserved`);
        if (expected === "absent") {
          assert.ok(!("confidenceScore" in edge), `confidenceScore is ABSENT for ${confidence}/${score ?? "(none)"} (never a fabricated 0)`);
        } else {
          assert.equal(edge.confidenceScore, expected, `confidenceScore is ${expected} for INFERRED`);
        }
      }
    },
  },
  {
    name: "graph-core/01 hyperedges normalize separately and are never flattened into edges",
    async run() {
      const raw = await readFixtureGraph();
      const normalized = normalizeGraph(raw);
      // A SEPARATE hyperedges field, populated from graph.hyperedges.
      assert.ok(Array.isArray(normalized.hyperedges), "the normalized result has a separate `hyperedges` field");
      assert.equal(normalized.hyperedges.length, raw.graph.hyperedges.length, "every fixture hyperedge is normalized");
      assert.ok(normalized.hyperedges.length >= 1, "the fixture carries at least one n-ary hyperedge");
      for (const he of normalized.hyperedges) {
        assert.ok(Array.isArray(he.nodes) && he.nodes.length >= 3, "a hyperedge is n-ary (3+ member nodes)");
      }
      // The hyperedges are NOT present in the normalized edges array — no pairwise
      // flattening. Edge count stays exactly the `links` count.
      assert.equal(normalized.edges.length, raw.links.length, "edges are exactly the `links`, with no hyperedges flattened in");
    },
  },
  {
    name: "graph-core/01 node fields map to the GraphNode shape on the id join key",
    async run() {
      const raw = await readFixtureGraph();
      const normalized = normalizeGraph(raw);
      assert.equal(normalized.nodes.length, raw.nodes.length, "every fixture node is normalized");
      for (let i = 0; i < normalized.nodes.length; i += 1) {
        const node = normalized.nodes[i];
        const source = raw.nodes[i];
        for (const key of ["id", "label", "fileType", "sourceFile", "community", "normLabel"]) {
          assert.ok(key in node, `the normalized node carries ${key}`);
        }
        // camelCase mapping of the snake_case source fields.
        assert.equal(node.fileType, source.file_type, "file_type → fileType");
        assert.equal(node.sourceFile, source.source_file, "source_file → sourceFile");
        assert.equal(node.normLabel, source.norm_label, "norm_label → normLabel");
        // id preserved verbatim as the stable join key.
        assert.equal(node.id, source.id, "the node id is preserved verbatim as the join key");
      }
    },
  },

  // ═══════════════════ 03_query-triage-results.feature ═══════════════════════
  {
    name: "graph-core/03 query with no built graph fails clearly with a build-first message",
    async run() {
      const { repo } = await makeRepo();
      try {
        // No graphify-out/graph.json under the project root.
        const ctx = await ctxFor(repo);
        const error = await assertRejectsWithCode(
          () => invoke("graph:query", { question: "what calls main" }, ctx),
          "no-graph"
        );
        assert.ok(/built first/i.test(error.message), "the message says a graph must be built first");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "graph-core/03 triage with no built graph fails clearly with a build-first message",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        const error = await assertRejectsWithCode(
          () => invoke("graph:triage", {}, ctx),
          "no-graph"
        );
        assert.ok(/built first/i.test(error.message), "the message says a graph must be built first");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "graph-core/03 aof graph query/triage with no graph exits non-zero saying build first (CLI)",
    async run() {
      const { repo } = await makeRepo();
      try {
        // Examples folded: query "what calls main", triage (no arg). The
        // non-json CLI face propagates the no-graph error to stderr + non-zero exit.
        for (const args of [["graph", "query", "what calls main"], ["graph", "triage"]]) {
          const result = runCli(repo, args);
          assert.notEqual(result.status, 0, `aof ${args.join(" ")} exits non-zero with no built graph`);
          assert.ok(
            /built first/i.test(result.stderr),
            `stderr says a graph must be built first (stderr: ${result.stderr.slice(0, 200)})`
          );
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
