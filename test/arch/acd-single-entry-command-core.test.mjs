// Fitness function #2: acd-single-entry-command-core (milestone 28 / story 00,
// ADR-004 / 08/ADR-001).
//
// "The packaged entry (bin/aof.mjs / the SEA main) routes both node and relay
//  modes through the ONE run() command core; NO second forked entry per mode,
//  NO top-level relay fast-path."
//
// Source-analysis of bin/aof.mjs (+ the SEA-main recipe): assert it imports run
// from src/cli.mjs and calls exactly run(process.argv.slice(2)) with no
// argv[0]==="relay" / mode==="relay" branch before it, and that src/cli.mjs
// exports exactly one run; grep the entry for a forbidden second dispatch
// function.
//
// m03 non-vacuous self-check: the matcher fires on a planted
// `if (argv[0]==="relay") serveRelay()` fast-path and passes the real
// `run(...)`-only entry.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const binPath = path.join(repoRoot, "bin", "aof.mjs");
const cliPath = path.join(repoRoot, "src", "cli.mjs");
// The SEA main SOURCE (the file esbuild bundles into the CJS sea-config.json
// `main`) — not a build artifact, so this arch-test runs against the checked-in
// entry regardless of whether a real SEA build has been produced locally.
const seaEntryPath = path.join(repoRoot, "scripts", "sea-entry.mjs");

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// The forbidden shape: a pre-run mode fork — a conditional testing argv[0] (or
// a `mode` variable) against "relay" BEFORE run(...) is called, or a second
// top-level dispatch function (a second exported `run`-shaped entry).
function hasPerModeFork(code) {
  // e.g. `if (argv[0] === "relay")`, `if (process.argv[2] === "relay")`,
  // `mode === "relay"`, `argv[0]==="relay"` (whitespace-insensitive).
  return /(?:argv\s*\[\s*0\s*\]|process\.argv\s*\[\s*2\s*\]|mode)\s*===\s*["']relay["']/.test(code);
}

function callsRunWithFullArgv(code) {
  return /run\s*\(\s*process\.argv\.slice\(\s*2\s*\)\s*\)/.test(code);
}

export const archTests = [
  {
    name: "arch/ADR-004: bin/aof.mjs imports run from src/cli.mjs and calls exactly run(process.argv.slice(2)) with no per-mode fork",
    run: async () => {
      const code = stripComments(await readFile(binPath, "utf8"));
      assert.ok(/import\s*\{\s*run\s*\}\s*from\s*["']\.\.\/src\/cli\.mjs["']/.test(code), "bin/aof.mjs imports { run } from ../src/cli.mjs");
      assert.ok(callsRunWithFullArgv(code), "bin/aof.mjs calls run(process.argv.slice(2))");
      assert.ok(!hasPerModeFork(code), "bin/aof.mjs has no argv[0]/mode === \"relay\" fork ahead of run()");
    },
  },
  {
    name: "arch/ADR-004: src/cli.mjs exports exactly one run function, no second dispatch entry",
    run: async () => {
      const code = stripComments(await readFile(cliPath, "utf8"));
      const runExportMatches = code.match(/export\s+async\s+function\s+run\s*\(/g) ?? [];
      assert.equal(runExportMatches.length, 1, "src/cli.mjs exports exactly one `run` function");
      // No forbidden second dispatch function name in cli.mjs (a would-be second
      // entry point mirroring run's shape).
      assert.ok(!/export\s+(async\s+)?function\s+(dispatch|mainDispatch|routeMode)\s*\(/.test(code), "no second dispatch function is exported alongside run()");
    },
  },
  {
    name: "arch/ADR-004: the SEA-main source (scripts/sea-entry.mjs, esbuild-bundled into the CJS SEA main) is byte-equivalent in shape to bin/aof.mjs — run(...) only, no relay fast-path",
    run: async () => {
      const raw = await readFile(seaEntryPath, "utf8");
      const code = stripComments(raw);
      assert.ok(/import\s*\{\s*run\s*\}\s*from\s*["']\.\.\/src\/cli\.mjs["']/.test(code), "scripts/sea-entry.mjs imports { run } from ../src/cli.mjs");
      assert.ok(callsRunWithFullArgv(code), "the SEA main source calls run(process.argv.slice(2))");
      assert.ok(!hasPerModeFork(code), "the SEA main source has no argv[0]/mode === \"relay\" fork ahead of run()");
      // The SEA main must not stand up its own relay serve/listener ahead of
      // run() — the ONLY door into relay mode is run()'s existing argv dispatch.
      assert.ok(!/serveRelay\s*\(/.test(code), "the SEA main source does not call serveRelay() directly (no relay fast-path)");
    },
  },
  {
    name: "arch/ADR-004 (m03 non-vacuous self-check): the matcher fires on a planted relay fast-path and passes the real run(...)-only entry",
    run: async () => {
      const violatingCode = `
        import { run } from "../src/cli.mjs";
        const argv = process.argv.slice(2);
        if (argv[0] === "relay") {
          serveRelay();
        } else {
          run(argv).catch((error) => { console.error(error.message); process.exitCode = 1; });
        }
      `;
      assert.ok(hasPerModeFork(stripComments(violatingCode)), "self-check: the matcher FIRES on a planted argv[0]===\"relay\" fast-path");

      const legitCode = await readFile(binPath, "utf8");
      assert.ok(!hasPerModeFork(stripComments(legitCode)), "self-check: the matcher does NOT fire on the real run(...)-only bin/aof.mjs");
    },
  },
];
