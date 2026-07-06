import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { globalMeshPaths } from "../../src/workspace.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const globalStorePath = path.join(repoRoot, "src", "global-work-store.mjs");

function stripCommentsAndStrings(source) {
  let out = "";
  let state = "code";
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; i += 1; continue; }
      if (c === "/" && next === "*") { state = "block"; i += 1; continue; }
      if (c === "'") { state = "sq"; out += " "; continue; }
      if (c === '"') { state = "dq"; out += " "; continue; }
      if (c === "`") { state = "tpl"; out += " "; continue; }
      out += c;
      continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; }
      continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") { state = "code"; i += 1; continue; }
      if (c === "\n") out += "\n";
      continue;
    }
    if (c === "\\") { i += 1; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
      state = "code";
      continue;
    }
    if (c === "\n") out += "\n";
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export const archTests = [
  {
    name: "arch/34 ADR-001: globalMeshPaths derives every mesh root from AOF_GLOBAL_HOME",
    run: async () => {
      const home = path.join(repoRoot, ".tmp-aof-global-mesh-home");
      const paths = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } });
      assert.equal(paths.meshRoot, path.join(home, "mesh"));
      assert.equal(paths.workRoot, path.join(home, "mesh", "work"));
      assert.equal(paths.nodesRoot, path.join(home, "mesh", "nodes"));
      assert.equal(paths.workspacesRoot, path.join(home, "mesh", "workspaces"));
      assert.equal(paths.databasePath, path.join(home, "mesh", "work", "projection.sqlite"));
    },
  },
  {
    name: "arch/34 ADR-001: global-work-store routes path geometry through globalMeshPaths and no live homedir call",
    run: async () => {
      const source = await readFile(globalStorePath, "utf8");
      const live = stripCommentsAndStrings(source);
      assert.ok(/globalMeshPaths/.test(source), "global-work-store imports/uses globalMeshPaths");
      assert.ok(!/\bos\s*\.\s*homedir\s*\(/.test(live), "global-work-store makes no os.homedir() call");
      assert.ok(!/\bhomedir\s*\(/.test(live), "global-work-store makes no homedir() call under an alias");
    },
  },
  {
    name: "arch/34 ADR-001: global-work-store carries no hardcoded .aof path literal",
    run: async () => {
      const text = stripComments(await readFile(globalStorePath, "utf8"));
      assert.ok(!/['"`]\.aof['"`]/.test(text), "no bare .aof string literal in global-work-store");
      assert.ok(!/['"`][^'"`]*[\\\/]\.aof([\\\/][^'"`]*)?['"`]/.test(text), "no path literal containing a .aof segment");
    },
  },
];
