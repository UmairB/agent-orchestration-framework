// The graphify MCP server runtime (milestone 09 / story 04 — ADR-005 amendment +
// ADR-006 inv. 2). aof's FIRST MCP transport: a stdio JSON-RPC 2.0 server that
// fronts the SAME 08 command core every other face couples through.
//
// It is a THIN TRANSPORT FACE — exactly like the CLI face. Its three tools map
// 1:1 onto the three `aof graph` verbs, and every `tools/call` becomes an
// in-process `invoke("graph:<verb>", input, ctx)` against the registry. It reaches
// the graph ONLY through `invoke`: it imports `getCommand`/`invoke` from the
// command core and NOTHING from `src/graphify.mjs` — it spawns no graphify binary
// (the driver `src/graphify.mjs` is the SOLE spawn site, ADR-002/ADR-006 inv. 2).
// A command error (e.g. `no-graph` build-first, `graphify-missing`) is projected
// into a CLEAN MCP tool error (an `isError` tool result), never a thrown/crashed
// transport — so the server stays up for the next call.
//
// HAND-ROLLED, no SDK: aof is lean (3 runtime deps) and the supply-chain posture
// is guarded, so rather than add `@modelcontextprotocol/sdk` this module speaks
// the MCP wire directly — line-delimited JSON-RPC 2.0 over stdio with the minimal
// method set an agent runtime needs to list and call tools: `initialize`,
// `tools/list`, `tools/call` (+ the `notifications/initialized` notification and a
// `ping` courtesy). The full SDK is not warranted for this surface; this departs
// from ADR-005's amendment estimate of "an MCP SDK dependency" — logged to STATE
// §Feedback for the architect to ratify at review.
//
//   export handleMcpMessage(message, ctx) → response | null   (pure-ish; the unit seam)
//   export serveStdio(ctx)                                     (the line-delimited loop)
//
//   ctx = { workspace } — the loadWorkspace result the CLI `serve` verb supplies.
import { getCommand, invoke } from "./command-core.mjs";

// The MCP protocol version this server speaks. A static, well-known revision —
// the agent runtime negotiates against it during `initialize`.
export const MCP_PROTOCOL_VERSION = "2024-11-05";

// serverInfo identifies an aof-FRONTED graphify server (ADR-005): the agent reaches
// the graph through aof's command core, not graphify's own `python -m graphify.serve`.
export const MCP_SERVER_INFO = {
  name: "aof-graph",
  title: "aof graph (graphify, fronted by aof)",
  version: "0.1.0",
};

// The three advertised tools — ONE per `aof graph` verb, each routed to its
// registered command (ADR-001). This is aof's OWN stable surface; it is NOT
// graphify's 9-tool MCP surface (get_node / get_neighbors / god_nodes / …), which
// omits PR triage and bypasses the command core (RESEARCH §H). The `command` field
// is the registry id each tool's `tools/call` maps to via `invoke`.
const TOOLS = [
  {
    name: "graph_build",
    command: "graph:build",
    description:
      "Build the codebase knowledge graph for a folder (aof graph build). Returns a graph summary; counts derive from graph.json.",
  },
  {
    name: "graph_query",
    command: "graph:query",
    description:
      "Ask a question against the built graph (aof graph query). Returns graphify's markdown answer plus the graph path.",
  },
  {
    name: "graph_triage",
    command: "graph:triage",
    description:
      "Rank pull requests against the graph (aof graph triage). Returns the triage queue markdown plus the graph path.",
  },
];

// The tool name → registry command id map (the mapping the whole face rests on).
const TOOL_TO_COMMAND = new Map(TOOLS.map((tool) => [tool.name, tool.command]));

// The MCP tool descriptor (name + description + inputSchema). The inputSchema is
// the registered command's OWN frozen input schema (08/ADR-002) — so the tool's
// declared shape is exactly the command's, never a re-typed copy that can drift.
function toolDescriptors() {
  return TOOLS.map((tool) => {
    const command = getCommand(tool.command);
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: command?.input ?? { type: "object", properties: {} },
    };
  });
}

// JSON-RPC 2.0 envelope helpers. A response always echoes the request id.
function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// MCP error codes (JSON-RPC reserved range): method-not-found is -32601, invalid
// params -32602. These are TRANSPORT/protocol errors — distinct from a tool
// EXECUTION failure, which is a successful response carrying isError:true.
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

// Project a successful command result into an MCP tool response. The structured
// result is carried as a JSON text content block (the portable MCP form for
// non-text data) — the agent gets the registered command's result VERBATIM.
function toolSuccess(result) {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: false,
  };
}

// Project a command error into a CLEAN MCP tool error (NOT a thrown transport):
// isError:true with the error message + code as content. The transport stays up;
// the agent sees a tool-level failure it can read and recover from. This is how a
// `no-graph` build-first precondition (which fires BEFORE any graphify spawn) or a
// `graphify-missing` guard surfaces — proving the call routed through the command
// and never reached a graphify spawn.
function toolError(error) {
  const code = error?.code ?? "error";
  const message = error?.message ?? String(error);
  return {
    content: [{ type: "text", text: `${message} (code: ${code})` }],
    isError: true,
  };
}

// Handle a single JSON-RPC request → response. Pure-ish (the only side effect is
// the in-process `invoke`, against the supplied ctx) — the unit seam the tests
// exercise. A JSON-RPC NOTIFICATION (no `id`) returns null (no response is sent).
//
//   initialize        → serverInfo (aof-fronted graphify) + capabilities + protocolVersion
//   tools/list        → the three graph tools (graph_build/query/triage)
//   tools/call        → invoke("graph:<verb>", input, ctx) → projected tool result;
//                       a command error → a clean MCP tool error (isError), never a throw
export async function handleMcpMessage(message, ctx) {
  const { id, method, params } = message ?? {};
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: MCP_SERVER_INFO,
      capabilities: { tools: { listChanged: false } },
    });
  }

  // The post-initialize handshake notification + a ping courtesy — acknowledged
  // (ping) or swallowed (the notification carries no id, so no response).
  if (method === "notifications/initialized") {
    return null;
  }
  if (method === "ping") {
    return isNotification ? null : rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: toolDescriptors() });
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const commandId = TOOL_TO_COMMAND.get(toolName);
    if (!commandId) {
      // An unknown TOOL name is an invalid-params transport error (the agent asked
      // for a tool this server does not advertise).
      return rpcError(id, INVALID_PARAMS, `Unknown tool "${toolName ?? ""}".`);
    }
    // Route through the registry — the single source of truth. A command error
    // (no-graph / graphify-missing / validation) becomes a clean MCP TOOL error,
    // never a thrown transport: the server stays up for the next call.
    try {
      const result = await invoke(commandId, params?.arguments ?? {}, ctx);
      return rpcResult(id, toolSuccess(result));
    } catch (error) {
      return rpcResult(id, toolError(error));
    }
  }

  // Any other method is method-not-found (a notification gets no response).
  if (isNotification) return null;
  return rpcError(id, METHOD_NOT_FOUND, `Unknown method "${method ?? ""}".`);
}

// The stdio transport loop: read line-delimited JSON-RPC from stdin, delegate each
// message to handleMcpMessage, write each non-null response as one line to stdout.
// A malformed line is answered with a JSON-RPC parse error (-32700) rather than
// crashing the transport. Resolves when stdin closes (EOF). This is the thin I/O
// shell; ALL routing lives in handleMcpMessage (the testable seam).
export function serveStdio(ctx, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const writeResponse = (response) => {
      if (response !== null && response !== undefined) {
        output.write(`${JSON.stringify(response)}\n`);
      }
    };

    const handleLine = async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        writeResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
        return;
      }
      try {
        writeResponse(await handleMcpMessage(parsed, ctx));
      } catch (error) {
        // A handler-level crash is still kept off the wire as a transport error,
        // so a single bad message never takes the server down.
        const id = parsed && typeof parsed === "object" ? parsed.id ?? null : null;
        writeResponse({ jsonrpc: "2.0", id, error: { code: -32603, message: error?.message ?? "Internal error." } });
      }
    };

    // Serialise line handling so responses are written in request order even when
    // handlers await (invoke is async).
    let chain = Promise.resolve();
    const enqueue = (line) => {
      chain = chain.then(() => handleLine(line));
    };

    input.setEncoding("utf8");
    input.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        enqueue(line);
        newlineIndex = buffer.indexOf("\n");
      }
    });
    input.on("end", () => {
      if (buffer.length > 0) enqueue(buffer);
      chain.then(resolve, reject);
    });
    input.on("error", reject);
  });
}
