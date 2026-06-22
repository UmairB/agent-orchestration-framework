#!/usr/bin/env node
// claude-shim.mjs — a local Anthropic-compatible shim for the milestone-10 spike.
//
// PURPOSE
//   Prove that graphify's `--backend claude` semantic pass can be driven entirely
//   through the user's existing Claude Code session (`claude -p`) with ZERO egress
//   to api.anthropic.com. graphify's claude backend uses the `anthropic` Python
//   SDK pointed at ANTHROPIC_BASE_URL; the SDK issues `POST <base>/v1/messages`.
//   This server answers that route by shelling out to `claude -p` and wrapping the
//   output in a minimal Anthropic Messages response.
//
// CONTRACT (confirmed from graphify 0.8.44 llm.py:_call_claude):
//   - client = anthropic.Anthropic(base_url=ANTHROPIC_BASE_URL); client.messages.create(...)
//   - The SDK POSTs to  <base_url>/v1/messages  with JSON body:
//       { model, max_tokens, system, messages:[{role:"user", content:<str|blocks>}] }
//   - graphify reads:  resp.content[0].text , resp.usage.input_tokens/output_tokens,
//                      resp.stop_reason  (llm.py:1023-1031)
//   - So the response MUST carry: content:[{type:"text",text:<...>}], usage:{...},
//     stop_reason, plus id/type/role/model for SDK validation.
//
// It also answers GET /v1/models and any other path with a benign stub, and LOGS
// every inbound request (method, path, model) to requests.log so the run is provable.
//
// Usage:  node claude-shim.mjs [--port 8787]
import http from "node:http";
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(__dirname, "requests.log");
const PORT = Number(
  (process.argv.find((a) => a.startsWith("--port=")) || "").split("=")[1] ||
    process.argv[process.argv.indexOf("--port") + 1] ||
    8787
);

// Reset the log on each boot so a run's evidence is self-contained.
writeFileSync(LOG, `# shim boot ${new Date().toISOString()} port=${PORT}\n`);
function log(line) {
  appendFileSync(LOG, line + "\n");
}

// On Windows the npm shim is claude.cmd; CreateProcess can't run a bare "claude"
// or claude.ps1. Mirror graphify's own resolution (llm.py:1095-1099).
function resolveClaude() {
  const isWin = process.platform === "win32";
  const candidates = isWin ? ["claude.cmd", "claude.exe", "claude"] : ["claude"];
  for (const c of candidates) {
    const probe = spawnSync(c, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return c;
  }
  return isWin ? "claude.cmd" : "claude";
}
const CLAUDE = resolveClaude();

// Flatten Anthropic message content (string OR an array of blocks) to a prompt.
function flattenContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "string" ? b : b?.text ?? ""))
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
}

// Drive `claude -p` non-interactively, JSON output, with graphify's own system
// prompt forwarded so extraction returns raw JSON (no markdown fences).
function callClaude(systemPrompt, userPrompt) {
  const args = ["-p", "--output-format", "json", "--no-session-persistence"];
  if (systemPrompt) args.push("--system-prompt", systemPrompt);
  // A small fast model is plenty for structured extraction; keeps the spike cheap.
  if (process.env.SPIKE_CLAUDE_MODEL) args.push("--model", process.env.SPIKE_CLAUDE_MODEL);
  const proc = spawnSync(CLAUDE, args, {
    input: userPrompt,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
  });
  if (proc.status !== 0) {
    return { text: "", usage: { in: 0, out: 0 }, err: (proc.stderr || "").slice(0, 500) };
  }
  let env;
  try {
    env = JSON.parse(proc.stdout);
  } catch (e) {
    return { text: "", usage: { in: 0, out: 0 }, err: "unparseable claude json: " + String(e).slice(0, 200) };
  }
  // claude -p --output-format json returns a single result object whose `.result`
  // is the model text (confirmed empirically).
  const text = env?.result ?? "";
  const u = env?.usage ?? {};
  return {
    text,
    usage: {
      in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      out: u.output_tokens || 0,
    },
    model: env?.modelUsage ? Object.keys(env.modelUsage)[0] : "claude-code-plan",
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const raw = await readBody(req);
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    /* non-JSON (e.g. GET) */
  }
  const model = body?.model ?? "(none)";
  log(`${new Date().toISOString()} ${req.method} ${req.url} model=${model} bytes=${raw.length}`);

  // The Anthropic Messages route — the one graphify's SDK hits.
  if (req.method === "POST" && /\/v1\/messages\/?$/.test(req.url)) {
    const system = typeof body.system === "string" ? body.system : flattenContent(body.system);
    const userMsg = (body.messages || []).map((m) => flattenContent(m.content)).join("\n\n");
    // Persist the exact prompt graphify sent (proves the prose-extraction shape).
    writeFileSync(path.join(__dirname, "last-extraction-prompt.txt"),
      `=== SYSTEM ===\n${system}\n\n=== USER ===\n${userMsg}\n`);
    const out = callClaude(system, userMsg);
    if (out.err) log(`  -> claude error: ${out.err}`);
    const resp = {
      id: "msg_spike_" + Date.now(),
      type: "message",
      role: "assistant",
      model: body.model || out.model || "claude-code-plan",
      content: [{ type: "text", text: out.text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: out.usage.in, output_tokens: out.usage.out },
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(resp));
    log(`  -> 200 text_len=${out.text.length} in=${out.usage.in} out=${out.usage.out}`);
    return;
  }

  // Benign stub for any other route the SDK might probe.
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, route: req.url }));
});

server.listen(PORT, "127.0.0.1", () => {
  log(`# listening on http://127.0.0.1:${PORT} claude=${CLAUDE}`);
  // eslint-disable-next-line no-console
  console.log(`[shim] http://127.0.0.1:${PORT}  claude=${CLAUDE}  log=${LOG}`);
});
