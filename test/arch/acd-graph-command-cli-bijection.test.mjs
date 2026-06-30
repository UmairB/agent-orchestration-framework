// Fitness function for milestone 09 / ADR-006 inv. 1 (the 08 bijection, extended
// to graph:*):
// "`graph:build`/`graph:query`/`graph:triage` are in the SAME `listCommands()`
//  registry, each with a non-null `cli` adapter (`cli.argv`/`cli.render`
//  functions) AND a reachable `aof graph <verb>` dispatch branch — no graph
//  command the CLI cannot run."
//
// Three proofs, mirroring 08's acd-work-command-cli-bijection idiom applied to
// the graph surface:
//   (a) import the registry; assert each of the three graph:* commands is present
//       and carries a `cli` adapter with `argv`/`render` functions;
//   (b) source-grep `graphCommand` in cli.mjs for a reachable dispatch branch per
//       verb (`subcommand === "<verb>"`, comments/strings discounted, and
//       isolated to the graphCommand body so an unrelated dispatcher cannot
//       satisfy it);
//   (c) CLI spawn-and-parse: run `aof graph {build,query,triage} --json` against a
//       temp fixture repo (no graphify binary, no built graph) and assert each
//       emits a SINGLE parseable JSON envelope — a success projection OR the
//       structured `{ ok:false, error, code }` error envelope (both parse). This
//       proves the verb is dispatched even when its live preconditions are absent.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCommands } from "../../src/command-core.mjs";
import { spawnCliSync } from "../support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");
const CLI_MJS = path.join(repoRoot, "src", "cli.mjs");

// The graph verbs, each backed by a graph:<verb> command. `impact` is the
// milestone-11/ADR-007 deterministic edge-based coupling command (the running agents'
// primary grounding signal) — covered here so its argv/render/dispatch are CI-locked
// like the others (gap caught at the ADR-007 structural review).
const GRAPH_VERBS = ["build", "query", "triage", "impact"];
const GRAPH_COMMAND_IDS = GRAPH_VERBS.map((verb) => `graph:${verb}`);

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Isolate the `graphCommand` function body so the dispatch grep cannot be
// satisfied by a `subcommand === "<verb>"` belonging to some OTHER dispatcher.
function graphCommandBody(source) {
  const start = source.search(/(?:async\s+)?function\s+graphCommand\s*\(/);
  if (start === -1) return "";
  const re = /\n(?:export\s+)?(?:async\s+)?function\s/g;
  re.lastIndex = start + 1;
  const next = re.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

// --- the CLI fixture repo: a minimal aof project, NO graphify binary, NO graph -

async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-graph-bijection-"));
  const aofDir = path.join(root, ".aof");
  await mkdir(aofDir, { recursive: true });
  await mkdir(path.join(root, "wiki", "work"), { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return root;
}

// `aof graph <verb> --json` args. build needs a positional folder; query needs a
// question; triage takes no positional. All run with NO graphify + NO built
// graph, so each resolves to the structured error envelope (graphify-missing /
// no-graph) — which still parses as a single JSON document.
function argsFor(verb) {
  switch (verb) {
    case "build": return ["graph", "build", ".", "--json"];
    case "query": return ["graph", "query", "what calls main", "--json"];
    case "triage": return ["graph", "triage", "--json"];
    // impact takes a path positional; against the fixture (no built graph) it resolves
    // to the structured no-graph error envelope — which still parses as one JSON doc.
    case "impact": return ["graph", "impact", "src/cli.mjs", "--json"];
    default: throw new Error(`unmapped graph verb ${verb}`);
  }
}

function runCli(root, args) {
  // A scrubbed PATH so the fixture run cannot accidentally find a real graphify
  // binary on the developer machine — the error envelope must be deterministic.
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", PATH: "", Path: "" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const archTests = [
  {
    name: "arch/ADR-006 inv.1: the three graph:* commands are in listCommands() with a non-null cli adapter (argv + render functions)",
    run: async () => {
      const commands = listCommands();
      const byId = new Map(commands.map((command) => [command.id, command]));
      for (const id of GRAPH_COMMAND_IDS) {
        const command = byId.get(id);
        assert.ok(command != null, `${id} is registered in listCommands()`);
        assert.ok(command.cli != null, `${id} carries a non-null cli adapter`);
        assert.equal(typeof command.cli.argv, "function", `${id} cli.argv is a function`);
        assert.equal(typeof command.cli.render, "function", `${id} cli.render is a function`);
      }
    },
  },
  {
    name: "arch/ADR-006 inv.1: graphCommand in cli.mjs has a reachable dispatch branch per graph verb",
    run: async () => {
      const body = graphCommandBody(stripComments(await readFile(CLI_MJS, "utf8")));
      assert.ok(body.length > 0, "graphCommand is defined in cli.mjs");
      for (const verb of GRAPH_VERBS) {
        assert.ok(
          new RegExp(`subcommand\\s*===\\s*["']${verb}["']`).test(body),
          `graphCommand dispatches \`subcommand === "${verb}"\` (no graph command the CLI cannot run)`
        );
      }
    },
  },
  {
    name: "arch/ADR-006 inv.1: aof graph <verb> --json emits a single parseable JSON envelope for every verb (success OR structured error)",
    run: async () => {
      const root = await buildFixture();
      try {
        for (const verb of GRAPH_VERBS) {
          const args = argsFor(verb);
          const result = runCli(root, args);
          // With no binary + no graph, the verb routes to the structured error
          // envelope (exit 1) — but it must NEVER crash (a null status from a
          // thrown, unhandled error) and must emit exactly one JSON document.
          assert.notEqual(result.status, null, `aof ${args.join(" ")} did not crash (stderr: ${result.stderr})`);
          assert.ok([0, 1].includes(result.status), `aof ${args.join(" ")} exits 0/1 (got ${result.status}; stderr: ${result.stderr})`);
          let parsed;
          assert.doesNotThrow(
            () => { parsed = JSON.parse(result.stdout); },
            `aof ${args.join(" ")} emits a single parseable JSON envelope (stdout: ${result.stdout.slice(0, 200)})`
          );
          assert.ok(parsed !== undefined, `aof ${args.join(" ")} produced a JSON value`);
          // The envelope is either a success projection or the structured error
          // { ok:false, error, code } — both are valid; neither is an unparsed
          // crash dump.
          if (parsed && parsed.ok === false) {
            assert.equal(typeof parsed.error, "string", `${verb} error envelope carries an error message`);
            assert.ok("code" in parsed, `${verb} error envelope carries a code`);
          }
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
