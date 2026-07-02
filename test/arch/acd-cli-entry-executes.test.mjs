// Fitness function: the CLI entry-point contract.
//
// `src/cli.mjs` EXPORTS `run(argv)` and is the module imported by both the
// canonical bin (`bin/aof.mjs`) and the in-process test harness. It also carries
// a main-module guard so that executing the file DIRECTLY (`node src/cli.mjs …`)
// dispatches through `run` exactly like the bin. Without that guard, a direct run
// loads the module, defines `run`, and exits 0 having done NOTHING — a silent
// success that defeats `… || fallback` guards (the bad command "succeeds", so the
// fallback never fires). That footgun cost real debugging time once; this locks it
// shut from three sides:
//   1. a direct run DISPATCHES (produces the help banner, exits 0),
//   2. a direct run is BYTE-IDENTICAL to the bin entry (no divergent face),
//   3. an unknown command exits NON-ZERO (a direct run can still fail loudly),
//   4. IMPORTING the module stays inert (no dispatch, no output) — the design that
//      lets the bin and the harness import `run` without side effects.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnCliSync } from "../support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcCli = path.join(repoRoot, "src", "cli.mjs");
const binCli = path.join(repoRoot, "bin", "aof.mjs");

function runNode(args) {
  const result = spawnCliSync(process.execPath, ["--no-warnings", ...args], {
    cwd: repoRoot,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const archTests = [
  {
    name: "arch/cli-entry: `node src/cli.mjs --help` dispatches (not a silent exit-0 no-op)",
    run: async () => {
      const result = runNode([srcCli, "--help"]);
      assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
      assert.match(
        result.stdout,
        /aof - Agent Orchestration Framework/,
        "a direct `node src/cli.mjs --help` must print the help banner — if this is empty, the main-module guard is missing and the file is a silent no-op"
      );
    },
  },
  {
    name: "arch/cli-entry: direct `node src/cli.mjs` is identical to the bin entry",
    run: async () => {
      const direct = runNode([srcCli, "--help"]);
      const bin = runNode([binCli, "--help"]);
      assert.equal(direct.status, bin.status, "exit code must match the bin entry");
      assert.equal(direct.stdout, bin.stdout, "stdout must match the bin entry byte-for-byte");
    },
  },
  {
    name: "arch/cli-entry: a direct run still fails loudly on an unknown command",
    run: async () => {
      const result = runNode([srcCli, "totally-unknown-command"]);
      // The pre-fix footgun: ANY direct invocation exited 0. An unknown command
      // must now exit non-zero, proving the guard routes errors through the catch.
      assert.notEqual(result.status, 0, "an unknown command must exit non-zero");
      assert.match(result.stderr, /Unknown command/, "the error message must reach stderr");
    },
  },
  {
    name: "arch/cli-entry: importing src/cli.mjs is inert (no dispatch, no output)",
    run: async () => {
      // Importing must NOT trip the main-module guard: argv[1] is this -e script,
      // not cli.mjs, so the module only defines `run`. Assert nothing is printed
      // and `run` is exported as a function.
      const url = pathToFileURL(srcCli).href;
      const result = runNode([
        "--input-type=module",
        "-e",
        `import(${JSON.stringify(url)}).then((m) => { if (typeof m.run !== "function") { console.error("run is not a function"); process.exit(3); } });`,
      ]);
      assert.equal(result.status, 0, `import should be inert and exit 0, got ${result.status}\n${result.stderr}`);
      assert.equal(result.stdout, "", "importing the module must print nothing (no dispatch on import)");
    },
  },
];
