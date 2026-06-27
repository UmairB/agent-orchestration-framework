// Fitness function for milestone 17 / ADR-004 + SPEC §Out of scope (inv. 6):
//   "CLI-not-MCP. The integration imports / depends on NO Notion MCP server or MCP
//    client anywhere; the sole Notion egress is the provisioned CLI spawn (argv[0] is
//    the provisioned binary)."
//
// Source-grep of src/notion/* + src/commands/notion-sync-work.mjs, CI-able offline
// (mirrors acd-headroom-no-dependency / the graph no-face-spawn idiom):
//   (a) NO MCP import — no `@modelcontextprotocol` SDK, no Notion-MCP package, no `mcp`
//       client/server import; and no MCP server stand-up (`McpServer`/`createServer`).
//   (b) NO MCP dependency in package.json (the integration pulls in no MCP package).
//   (c) The sole Notion egress is a CLI spawn whose argv[0] is the PROVISIONED binary
//       (the m12-resolved `ntn` path) — spawned with an argv ARRAY, never a constructed
//       MCP transport. Proven by: cli.mjs resolves the binary via the m12 resolver and
//       spawns it with the operation argv.
//   Self-checked non-vacuous: the MCP-import matcher fires on a planted
//   `@modelcontextprotocol` import.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_NOTION_DIR = path.join(repoRoot, "src", "notion");
const SYNC_COMMAND = path.join(repoRoot, "src", "commands", "notion-sync-work.mjs");
const pkgPath = path.join(repoRoot, "package.json");

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

// An MCP import: a bare specifier naming `@modelcontextprotocol` / an mcp SDK / a
// Notion-MCP package. A RELATIVE import of a sibling aof module is fine (excluded by
// the leading-./ negative lookahead).
const MCP_IMPORT =
  /\bfrom\s+["'](?![./])[^"']*(?:@modelcontextprotocol|modelcontextprotocol|notion-mcp|mcp-server|mcp-client|\bmcp\b)[^"']*["']/i;
const MCP_REQUIRE =
  /\brequire\(\s*["'](?![./])[^"']*(?:@modelcontextprotocol|modelcontextprotocol|notion-mcp|mcp-server|mcp-client|\bmcp\b)[^"']*["']\s*\)/i;
// An MCP server stand-up form (creating/listening an MCP server transport).
const MCP_SERVER_STANDUP = /\b(?:McpServer|MCPServer|StdioServerTransport|createMcpServer|mcp\.createServer)\b/;

async function notionSurfaceFiles() {
  const files = [SYNC_COMMAND];
  for (const entry of await readdir(SRC_NOTION_DIR)) {
    if (entry.endsWith(".mjs")) files.push(path.join(SRC_NOTION_DIR, entry));
  }
  return files;
}

export const archTests = [
  {
    name: "arch/notion-cli-not-mcp: no Notion-integration source imports an MCP SDK / Notion-MCP package, and none stands up an MCP server",
    async run() {
      for (const file of await notionSurfaceFiles()) {
        const where = path.relative(repoRoot, file);
        const code = stripComments(await readFile(file, "utf8"));
        assert.ok(!MCP_IMPORT.test(code), `${where}: imports no MCP SDK / Notion-MCP package`);
        assert.ok(!MCP_REQUIRE.test(code), `${where}: require()s no MCP SDK / Notion-MCP package`);
        assert.ok(!MCP_SERVER_STANDUP.test(code), `${where}: stands up no MCP server`);
      }
      // Self-check (non-vacuous): the MCP-import matcher FIRES on planted forbidden
      // forms and does NOT fire on the accepted relative sibling-import form.
      assert.ok(MCP_IMPORT.test('import { Client } from "@modelcontextprotocol/sdk/client";'), "the MCP-import guard fires on a planted @modelcontextprotocol import");
      assert.ok(MCP_IMPORT.test('import x from "notion-mcp-server";'), "the MCP-import guard fires on a planted notion-mcp import");
      assert.ok(MCP_SERVER_STANDUP.test("const s = new McpServer();"), "the MCP-standup guard fires on a planted McpServer stand-up");
      assert.ok(!MCP_IMPORT.test('import { makeNotionSpawn } from "./cli.mjs";'), "the MCP-import guard does NOT fire on the accepted relative sibling import");
    },
  },
  {
    name: "arch/notion-cli-not-mcp: package.json carries no MCP dependency (the integration pulls in no MCP package)",
    async run() {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
      const offenders = names.filter((name) => /@modelcontextprotocol|(^|[-/])mcp([-/]|$)|notion-mcp/i.test(name));
      assert.deepEqual(offenders, [], `no MCP dependency in package.json: ${offenders.join(", ")}`);
    },
  },
  {
    name: "arch/notion-cli-not-mcp: the sole Notion egress is a CLI spawn (node running the ntn bin/ntn launcher) with an argv ARRAY — never an MCP transport",
    async run() {
      const cli = stripComments(await readFile(path.join(SRC_NOTION_DIR, "cli.mjs"), "utf8"));
      // The ntn launcher is resolved via the npx-lane resolver (resolveNtnLauncher) and
      // run through node — not a constructed MCP transport.
      assert.ok(/resolveNtnLauncher/.test(cli), "cli.mjs resolves the ntn bin/ntn launcher (the npx-lane resolver)");
      assert.ok(/descriptorFor\(\s*["']notion["']\s*\)/.test(cli), "cli.mjs reads the provisioned NOTION descriptor (pinned identity/version)");
      // The egress is a child-process spawn of `node` with an argv ARRAY carrying the
      // launcher + the operation argv — a CLI spawn, never an MCP transport client.
      assert.ok(
        /\bspawn\s*\(\s*node\s*,\s*\[\s*launcher\s*,\s*\.\.\.argv\s*\]/.test(cli),
        "cli.mjs spawns `node [launcher, ...argv]` (a CLI spawn with an argv array, not an MCP transport)"
      );
    },
  },
];
