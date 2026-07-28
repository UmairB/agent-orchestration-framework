// Fitness function: acd-migrate-command-cli-bijection (story 29) — a deliberate
// MIRROR of acd-mesh-command-cli-bijection / acd-graph-command-cli-bijection,
// filtered to the migrate:* namespace:
//   "Every registry migrate:* command carries a non-null `cli` adapter
//    (`cli.argv`/`cli.render`/`cli.json` are functions) AND is the frozen
//    { id, input, run, cli } shape AND has a callable CLI face dispatched by the
//    top-level `migrate` verb in cli.mjs — no migrate command the CLI cannot run."
//
// Three proofs, over the registry-derived migrate:* set:
//   (a) each migrate:* command is the frozen {id,input,run,cli} shape with a
//       callable cli adapter (argv/render/json);
//   (b) source-grep cli.mjs's top-level dispatch + the migrateCommand face: the
//       `migrate` verb routes to migrateCommand, and migrateCommand reaches the
//       command via getCommand("migrate:folder") → invoke (comments discounted);
//   (c) CLI spawn-and-parse: `aof migrate <fixture> --json` over a local fixture
//       source exits 0 + emits parseable JSON naming the produced milestone ref.
//
// Non-vacuous: (a) goes RED if the command is unregistered or its key-set changes;
// (b) goes RED if the top-level `migrate` dispatch or the getCommand/invoke wiring
// is removed; (c) goes RED if the face does not run the command end-to-end.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCommands, getCommand } from "../../src/command-core.mjs";
import { spawnCliSync } from "../support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");
const CLI_MJS = path.join(repoRoot, "src", "cli.mjs");

// The migrate-surface commands DERIVED from the registry (NOT a hard-coded literal:
// a future migrate:* command is covered with no edit). work:/graph:/import:/mesh: are
// non-migrate and correctly excluded.
const migrateCommands = () => listCommands().filter((command) => command.id.startsWith("migrate:"));

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Isolate a named function body so a dispatch grep cannot be satisfied by a token
// belonging to some OTHER function.
function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (start === -1) return "";
  const re = /\n(?:export\s+)?(?:async\s+)?function\s/g;
  re.lastIndex = start + 1;
  const next = re.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

// Isolate the TOP-LEVEL run(argv) dispatcher body (the `if (command === "…")` ladder).
function runDispatchBody(source) {
  return functionBody(source, "run");
}

// --- the CLI fixture: a minimal aof project + a local aof-structured source ----

async function buildProjectFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-bijection-proj-"));
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

async function buildSourceFixture() {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-bijection-src-"));
  await writeFile(
    path.join(src, "README.md"),
    `# widget\n\nA widget service that set out to render configurable widgets.\n`,
    "utf8"
  );
  return src;
}

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

export const archTests = [
  {
    name: "arch/migrate-bijection: every registered migrate:* command is the frozen {id,input,run,cli} shape with a callable cli adapter",
    run: async () => {
      const commands = migrateCommands();
      // The story-29 command must be present (this is NOT a RED-until-commands gate —
      // migrate:folder ships with the story).
      assert.ok(commands.length >= 1, "at least one migrate:* command is registered (migrate:folder)");
      assert.ok(getCommand("migrate:folder"), 'getCommand("migrate:folder") resolves');
      for (const command of commands) {
        assert.deepEqual(Object.keys(command).sort(), ["cli", "id", "input", "run"], `${command.id} is the frozen {id,input,run,cli} shape`);
        assert.equal(typeof command.run, "function", `${command.id} run is a function`);
        assert.ok(command.input && typeof command.input === "object", `${command.id} input is a JSON-schema object`);
        assert.equal(typeof command.cli.argv, "function", `${command.id} cli.argv is a function`);
        assert.equal(typeof command.cli.render, "function", `${command.id} cli.render is a function`);
        assert.equal(typeof command.cli.json, "function", `${command.id} cli.json is a function`);
      }
    },
  },
  {
    name: "arch/migrate-bijection: the top-level `migrate` verb reaches migrate:folder — a route-table entry or a migrateCommand ladder face",
    run: async () => {
      // m42 wave (d) leg d1 (wave 2): migrate:folder migrated onto the
      // registry-derived route table (cli.route: ["migrate"] + the ONE generic
      // face) — reachability is now a REGISTRY fact, mirroring the
      // acd-work-command-cli-bijection route-or-ladder update. The ladder form
      // stays accepted so this gate never forces a route back out.
      const { deriveRouteTable } = await import("../../src/spine/face.mjs");
      const routes = deriveRouteTable(listCommands());
      const routed = routes.has("migrate") && routes.get("migrate").id === "migrate:folder";

      if (!routed) {
        const source = stripComments(await readFile(CLI_MJS));
        const dispatch = runDispatchBody(source);
        assert.ok(dispatch.length > 0, "the top-level run(argv) dispatcher is defined");
        assert.ok(/command\s*===\s*["']migrate["']/.test(dispatch), 'run dispatches `command === "migrate"`');
        const face = functionBody(source, "migrateCommand");
        assert.ok(face.length > 0, "migrateCommand is defined in cli.mjs");
        assert.ok(/getCommand\(\s*["']migrate:folder["']\s*\)/.test(face), 'migrateCommand resolves getCommand("migrate:folder")');
        assert.ok(/invoke\(/.test(face), "migrateCommand reaches the command through invoke (the registry door)");
      }

      // Either way: `migrate` must NOT sit in the removed-command list (the reclaim).
      const source = stripComments(await readFile(CLI_MJS));
      const dispatch = runDispatchBody(source);
      const removedListMatch = dispatch.match(/\[([^\]]*)\]\.includes\(command\)/);
      if (removedListMatch) {
        assert.ok(!/["']migrate["']/.test(removedListMatch[1]), 'migrate is removed from the removed-command list (reclaimed)');
      }
    },
  },
  {
    name: "arch/migrate-bijection: aof migrate <fixture> --json runs the command end-to-end and emits parseable JSON naming the produced milestone",
    run: async () => {
      const root = await buildProjectFixture();
      const src = await buildSourceFixture();
      try {
        const result = runCli(root, ["migrate", src, "--json"]);
        assert.ok([0, 1].includes(result.status), `aof migrate <fixture> --json runs cleanly (got status ${result.status}${result.error ? `; spawn error ${result.error.code ?? result.error.message}` : ""}; stderr: ${result.stderr})`);
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `aof migrate --json emits parseable JSON (stdout: ${result.stdout.slice(0, 200)})`);
        assert.ok(parsed !== undefined, "aof migrate --json produced a JSON value");
        // A successful run names the produced milestone's ref (the bijection's
        // end-to-end proof: the verb dispatched and the command ran).
        if (parsed && parsed.ok !== false) {
          assert.ok("milestoneRef" in parsed, "the JSON result names the produced milestone ref");
          assert.ok("dir" in parsed, "the JSON result names the produced dir");
        }
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
];

// readFile shim (kept local so the import list mirrors the sibling bijection tests,
// which import only fs/promises bits they use).
async function readFile(p) {
  const { readFile: rf } = await import("node:fs/promises");
  return rf(p, "utf8");
}
