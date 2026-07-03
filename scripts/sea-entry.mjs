// milestone 28 / story 00 (ADR-001/ADR-004) — the SEA main SOURCE.
//
// This is the file esbuild bundles (--bundle --platform=node --format=cjs
// --target=node22) into the single CJS SEA `main` script sea-config.json
// points at. It is BYTE-EQUIVALENT IN SHAPE to bin/aof.mjs (ADR-004): import
// the bundled `run`, call run(process.argv.slice(2)), print the error + set
// the exit code on reject — NOTHING else. No relay fast-path, no per-mode
// fork, no top-level `if (argv[0] === "relay")` branch — mode is entirely
// argv-routed through run()'s existing dispatch (23/ADR-001's mesh:relay
// route rides along unchanged, carried intact by the esbuild bundle).
//
// acd-single-entry-command-core (fitness #2) greps THIS file's build output
// shape via the same assertions it applies to bin/aof.mjs.
import { run } from "../src/cli.mjs";

run(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
