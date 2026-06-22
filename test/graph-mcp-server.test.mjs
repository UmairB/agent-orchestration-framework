// Traceability wiring for milestone 09 / story 04 — the graphify MCP server runtime.
//
// Covers the @executable scenarios across the two task features by exercising the
// REAL in-process server seam (src/graph-mcp-server.mjs handleMcpMessage) against
// temp fixture workspaces — loadWorkspace + handleMcpMessage, real fs, in-process,
// exactly the command-core-contract.test.mjs idiom. The @manual live-agent-over-
// stdio round-trip (01) is DEFERRED. One test object per @executable scenario
// (Scenario-Outline rows folded into one entry), each name tracing to feature +
// scenario.
//
//   00_serve-entrypoint.feature        — initialize handshake (aof-fronted serverInfo +
//        protocolVersion) / tools/list advertises exactly graph_build/query/triage /
//        does NOT advertise graphify's own get_node/get_neighbors/god_nodes surface /
//        `aof graph serve` is the launch command the graph-faces MCP entry declares
//   01_tools-front-the-registry.feature — each tools/call routes to invoke("graph:<verb>") /
//        a no-graph query returns a CLEAN MCP tool error (routed through the command,
//        no graphify spawn) / the server stays up for the next call
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { loadWorkspace } from "../src/work.mjs";
import { graphJsonPath } from "../src/graphify.mjs";
import {
  handleMcpMessage,
  serveStdio,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
} from "../src/graph-mcp-server.mjs";
import {
  graphifyMcpServer,
  GRAPHIFY_SERVE_COMMAND,
  GRAPHIFY_SERVE_ARGS,
} from "../src/graph-faces.mjs";

const THREE_TOOLS = ["graph_build", "graph_query", "graph_triage"];
// graphify's own MCP tool surface (RESEARCH §H) — the aof server must NOT advertise
// any of these: re-exposing them would bypass the command core and omit triage.
const GRAPHIFY_OWN_TOOLS = ["get_node", "get_neighbors", "god_nodes"];

// --- fixture builders (mirrors command-core-contract.test.mjs) ----------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mcp-"));
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

// Write a minimal graph.json at <projectRoot>/graphify-out/graph.json so a query's
// missing-graph precondition does NOT fire (the success path) — used only to prove
// the no-graph branch is precondition-driven, not just "always errors".
async function buildGraph(projectRoot) {
  const graphPath = graphJsonPath(projectRoot);
  await mkdir(path.dirname(graphPath), { recursive: true });
  await writeFile(graphPath, JSON.stringify({ nodes: [], links: [], graph: {} }), "utf8");
  return graphPath;
}

let nextId = 1;
const req = (method, params) => ({ jsonrpc: "2.0", id: nextId++, method, params });

export const graphMcpServerTests = [
  // ═══════════════════════ 00_serve-entrypoint.feature ═══════════════════════
  {
    name: "graph-mcp/00 aof graph serve is the command the rendered MCP entry launches",
    async run() {
      // The entry↔server agreement: the story-02 rendered graphify MCP config entry
      // (src/graph-faces.mjs) must target `aof graph serve` — exactly the launch
      // command THIS server's `aof graph serve` dispatch implements.
      const entry = graphifyMcpServer();
      assert.equal(entry.command, "aof", "the rendered MCP entry's command is the aof bin");
      assert.deepEqual(entry.args, ["graph", "serve"], 'the rendered MCP entry launches "aof graph serve"');
      // And the launch constants the entry is built from agree.
      assert.equal(GRAPHIFY_SERVE_COMMAND, "aof");
      assert.deepEqual(GRAPHIFY_SERVE_ARGS, ["graph", "serve"]);
    },
  },
  {
    name: "graph-mcp/00 the server completes the MCP initialize handshake as an aof-fronted graphify server",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        const response = await handleMcpMessage(req("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }), ctx);

        // A well-formed JSON-RPC result that echoes the request id.
        assert.equal(response.jsonrpc, "2.0", "the handshake response is JSON-RPC 2.0");
        assert.ok("result" in response, "initialize returns a result (no error)");
        const result = response.result;

        // The handshake reports a protocolVersion + capabilities + serverInfo.
        assert.equal(typeof result.protocolVersion, "string", "the handshake reports a protocolVersion");
        assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION, "the protocolVersion is the server's");
        assert.ok(result.capabilities && typeof result.capabilities === "object", "the handshake reports capabilities");
        assert.ok(result.capabilities.tools, "the server advertises the tools capability");

        // It reports itself as an AOF-FRONTED graphify server (ADR-005): the
        // serverInfo names aof, not graphify's own `python -m graphify.serve`.
        assert.ok(result.serverInfo && typeof result.serverInfo === "object", "the handshake reports serverInfo");
        assert.equal(result.serverInfo.name, MCP_SERVER_INFO.name, "serverInfo carries the server name");
        const identity = `${result.serverInfo.name} ${result.serverInfo.title ?? ""}`.toLowerCase();
        assert.ok(identity.includes("aof"), "serverInfo identifies an aof-fronted server");
        assert.ok(identity.includes("graph"), "serverInfo identifies the graph (graphify) surface");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "graph-mcp/00 serveStdio drives the line-delimited loop over injectable streams (FIX 3)",
    async run() {
      // Prove the serveStdio loop itself (not just handleMcpMessage): feed two
      // newline-delimited JSON-RPC frames (initialize then tools/list) into an
      // in-memory input stream and assert the FRAMED responses come back on the
      // injected output stream — no subprocess, no real stdio. The seam already
      // exists: serveStdio(ctx, { input, output }) defaults to process.stdin/stdout.
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        const input = new PassThrough();
        // Collect every chunk written to the output stream (a Writable PassThrough).
        const output = new PassThrough();
        const chunks = [];
        output.on("data", (chunk) => chunks.push(chunk.toString("utf8")));

        const done = serveStdio(ctx, { input, output });

        // Two line-delimited JSON-RPC frames, then EOF (closes the loop → resolves).
        input.write(`${JSON.stringify(req("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }))}\n`);
        input.write(`${JSON.stringify(req("tools/list"))}\n`);
        input.end();

        await done; // resolves when the input stream closes (EOF)

        // The output is line-delimited frames: split on newline, parse each.
        const frames = chunks.join("").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
        assert.equal(frames.length, 2, "two requests yield two framed responses on the output stream");

        // Frame 1: the initialize handshake result (aof-fronted serverInfo + protocolVersion).
        const init = frames[0];
        assert.equal(init.jsonrpc, "2.0", "the handshake frame is JSON-RPC 2.0");
        assert.ok("result" in init, "the handshake frame carries a result");
        assert.equal(init.result.protocolVersion, MCP_PROTOCOL_VERSION, "the framed handshake reports the protocolVersion");
        assert.equal(init.result.serverInfo.name, MCP_SERVER_INFO.name, "the framed handshake reports the aof-fronted serverInfo");

        // Frame 2: tools/list → exactly the three graph_* tools, over the wire.
        const list = frames[1];
        assert.ok("result" in list, "the tools/list frame carries a result");
        const names = list.result.tools.map((tool) => tool.name);
        assert.deepEqual([...names].sort(), [...THREE_TOOLS].sort(), "the framed tools/list returns exactly the three graph_* tools");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "graph-mcp/00 the server advertises exactly the three aof graph verb tools",
    async run() {
      // Scenario Outline (graph_build / graph_query / graph_triage) folded in, PLUS
      // the negative: the server does NOT re-export graphify's own MCP tool surface.
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        const response = await handleMcpMessage(req("tools/list"), ctx);
        assert.ok("result" in response, "tools/list returns a result");
        const names = response.result.tools.map((tool) => tool.name);

        // Each aof graph verb is advertised as a tool (the Scenario Outline rows).
        for (const tool of THREE_TOOLS) {
          assert.ok(names.includes(tool), `the tools include a "${tool}" tool`);
        }
        // EXACTLY the three — no more, no fewer (the tools ARE the aof graph verbs).
        assert.deepEqual([...names].sort(), [...THREE_TOOLS].sort(), "the tools are exactly the three aof graph verbs");

        // NOT graphify's own get_node / get_neighbors / god_nodes surface (RESEARCH §H).
        for (const own of GRAPHIFY_OWN_TOOLS) {
          assert.ok(!names.includes(own), `the tools do NOT include graphify's own "${own}" tool`);
        }

        // Each tool descriptor carries its registered command's input schema (the
        // tool's declared shape IS the command's, never a re-typed copy that drifts).
        for (const tool of response.result.tools) {
          assert.ok(tool.inputSchema && typeof tool.inputSchema === "object", `${tool.name} declares an inputSchema`);
          assert.equal(typeof tool.description, "string", `${tool.name} carries a description`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ════════════════════ 01_tools-front-the-registry.feature ══════════════════
  {
    name: "graph-mcp/01 each tool call is answered by invoking the matching graph command",
    async run() {
      // Scenario Outline: graph_build→graph:build, graph_query→graph:query,
      // graph_triage→graph:triage. Proven by routing each tools/call through the
      // server and asserting the response carries the SPECIFIC command's failure code —
      // which can only come from invoke()-ing that exact registered command. Each chosen
      // code fires BEFORE any binary check / spawn, so the proof is HERMETIC (independent
      // of whether the graphify binary is installed): graph:build guards on
      // offline-backend-conflict (offline + a network backend) before the binary check;
      // query/triage guard on no-graph before any spawn. The mapping is what the whole
      // face rests on.
      const cases = [
        { tool: "graph_build", args: { path: ".", backend: "claude", offline: true }, code: "offline-backend-conflict" },
        { tool: "graph_query", args: { question: "what calls main" }, code: "no-graph" },
        { tool: "graph_triage", args: {}, code: "no-graph" },
      ];
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        for (const { tool, args, code } of cases) {
          const response = await handleMcpMessage(req("tools/call", { name: tool, arguments: args }), ctx);
          // tools/call ALWAYS returns a JSON-RPC result (tool errors live INSIDE the
          // result as isError, never as a transport error) — so the call routed.
          assert.ok("result" in response, `${tool} tools/call returns a JSON-RPC result (not a transport error)`);
          const toolResult = response.result;
          // The tool response carries the projected command result (here, the
          // projected command ERROR — proving it routed to that registered command).
          assert.equal(toolResult.isError, true, `${tool} surfaced its command's precondition failure as a tool error`);
          const text = toolResult.content.map((block) => block.text).join("\n");
          assert.ok(text.includes(code), `${tool} routed to its command (carries the "${code}" code from invoke)`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "graph-mcp/01 a tool call drives the registry, not the graphify binary",
    async run() {
      // The graph_query tool with NO built graph returns the no-graph build-first
      // error. That precondition fires INSIDE graph:query's run BEFORE any graphify
      // spawn — so seeing it proves the answer came from an invoke("graph:query")
      // call AND that the server process did not (and structurally cannot, it does
      // not import the driver) spawn the graphify binary.
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        const response = await handleMcpMessage(
          req("tools/call", { name: "graph_query", arguments: { question: "what calls main" } }),
          ctx
        );
        assert.ok("result" in response, "the query tool call returns a JSON-RPC result");
        assert.equal(response.result.isError, true, "the answer is the command's no-graph failure");
        const text = response.result.content.map((block) => block.text).join("\n");
        assert.ok(text.includes("no-graph"), "the answer comes from an invoke(graph:query) call (its no-graph precondition)");
        assert.ok(/built first/i.test(text), "the no-graph error carries the build-first guidance");

        // Structural proof the server reaches the graph ONLY through invoke and never
        // the driver: the server module imports neither src/graphify.mjs nor any
        // spawn primitive (the no-face-spawn invariant's observable counterpart). The
        // checks are CALL-FORM / IMPORT-FORM (the house arch-test discipline — the
        // module's own prose deliberately says "spawns nothing", so the word in a
        // comment must not trip the guard; only an actual import / call form does).
        const source = await readFile(new URL("../src/graph-mcp-server.mjs", import.meta.url), "utf8");
        assert.ok(!/from\s+["'][^"']*graphify\.mjs["']/.test(source), "the server does not import the graphify driver");
        assert.ok(!/from\s+["']node:child_process["']/.test(source), "the server does not import child_process");
        assert.ok(!/\bspawn(Sync)?\s*\(/.test(source), "the server invokes no spawn() call form");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "graph-mcp/01 a precondition failure is a clean MCP tool error and the server stays up",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);

        // The project has no built graph → graph_query returns an MCP tool error
        // reporting that a graph must be built first — a clean isError result, NOT a
        // thrown/crashed transport.
        const errored = await handleMcpMessage(
          req("tools/call", { name: "graph_query", arguments: { question: "anything" } }),
          ctx
        );
        assert.ok("result" in errored && !("error" in errored), "the precondition failure is a tool result, not a JSON-RPC transport error");
        assert.equal(errored.result.isError, true, "it is a clean MCP TOOL error (isError:true)");
        const text = errored.result.content.map((block) => block.text).join("\n");
        assert.ok(/built first/i.test(text), "the tool error reports that a graph must be built first");

        // The server stays up for the NEXT call: a subsequent tools/list still works
        // (the transport was never torn down by the tool error).
        const after = await handleMcpMessage(req("tools/list"), ctx);
        assert.ok("result" in after, "the server stays up — the next call (tools/list) still answers");
        assert.deepEqual(after.result.tools.map((t) => t.name).sort(), [...THREE_TOOLS].sort(), "the next call returns the full tool list");

        // And once a graph EXISTS the precondition no longer fires (the no-graph
        // branch was genuinely precondition-driven). With no live binary the success
        // spawn would fail, so we only assert the no-graph code is GONE.
        await buildGraph(ctx.workspace.projectRoot);
        const withGraph = await handleMcpMessage(
          req("tools/call", { name: "graph_query", arguments: { question: "anything" } }),
          ctx
        );
        assert.ok("result" in withGraph, "the query with a graph still returns a JSON-RPC result");
        const withGraphText = (withGraph.result.content ?? []).map((block) => block.text).join("\n");
        assert.ok(!withGraphText.includes("no-graph"), "with a built graph the no-graph precondition no longer fires");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
