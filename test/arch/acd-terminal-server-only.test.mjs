// Fitness function for milestone 03 / ADR-003:
// "The PTY/terminal native stack is confined to the SERVER — node-pty (and ws)
//  are dependencies of the ROOT package.json (never ui/package.json), and no
//  import/require of node-pty appears under ui/src/; the browser terminal imports
//  only @xterm/*."
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readJson(rel) {
  return JSON.parse(await readFile(path.join(repoRoot, rel), "utf8"));
}

// Recursively collect files under a dir matching an extension set.
async function collectFiles(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full, exts)));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

export const archTests = [
  {
    name: "arch/ADR-003: node-pty and ws are ROOT dependencies, not ui/ dependencies",
    run: async () => {
      const root = await readJson("package.json");
      const ui = await readJson("ui/package.json");
      const rootDeps = { ...root.dependencies, ...root.devDependencies };
      const uiDeps = { ...ui.dependencies, ...ui.devDependencies };

      assert.ok(rootDeps["node-pty"], "root package.json depends on node-pty");
      assert.ok(rootDeps["ws"], "root package.json depends on ws");
      assert.ok(!uiDeps["node-pty"], "ui/package.json does NOT depend on node-pty");
      assert.ok(!uiDeps["ws"], "ui/package.json does NOT depend on ws");
    },
  },
  {
    name: "arch/ADR-003: no node-pty import/require anywhere under ui/src",
    run: async () => {
      const files = await collectFiles(path.join(repoRoot, "ui", "src"), [".ts", ".tsx", ".js", ".jsx", ".mjs"]);
      assert.ok(files.length > 0, "found ui/src source files to scan");
      const offenders = [];
      for (const file of files) {
        const text = await readFile(file, "utf8");
        if (/node-pty/.test(text) || /require\(['"]node-pty['"]\)/.test(text) || /from\s+['"]node-pty['"]/.test(text)) {
          offenders.push(path.relative(repoRoot, file));
        }
      }
      assert.deepEqual(offenders, [], "no ui/src file references node-pty");
    },
  },
  {
    name: "arch/ADR-003: the browser terminal imports only @xterm/* for the terminal engine",
    run: async () => {
      const dockPath = path.join(repoRoot, "ui", "src", "board", "TerminalDock.tsx");
      const text = await readFile(dockPath, "utf8");
      // The terminal engine + addons come only from the @xterm scope.
      assert.ok(/from\s+["']@xterm\/xterm["']/.test(text), "imports the terminal engine from @xterm/xterm");
      assert.ok(/from\s+["']@xterm\/addon-fit["']/.test(text), "imports FitAddon from @xterm/addon-fit");
      assert.ok(/from\s+["']@xterm\/addon-web-links["']/.test(text), "imports WebLinksAddon from @xterm/addon-web-links");
      // No server-side transport/native deps leak into the browser component.
      assert.ok(!/from\s+["']ws["']/.test(text), "the browser dock does not import ws");
      assert.ok(!/node-pty/.test(text), "the browser dock does not import node-pty");
      // The deprecated unscoped xterm package is not used.
      assert.ok(!/from\s+["']xterm["']/.test(text), "does not use the deprecated unscoped xterm package");
    },
  },
];
