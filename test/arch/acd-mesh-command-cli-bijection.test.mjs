// Fitness function: acd-mesh-command-cli-bijection (milestone 22, ADR-001 / fitness
// #3) — the NEW registry-derived mesh-namespace gate (19/R1). A deliberate MIRROR of
// acd-work-command-cli-bijection, filtered id.startsWith("mesh:"):
//   "Every registry mesh:* command carries a non-null `cli` adapter (`cli.argv`/
//    `cli.render` are functions) AND a reachable `aof mesh <sub>` dispatch branch in
//    meshCommand, AND `aof mesh <sub> --json` runs cleanly + emits parseable JSON.
//    The sub set is DERIVED from listCommands() (NOT a hard-coded literal), so any
//    future mesh:* command is covered with no edit."
//
// Three proofs, over the registry-derived mesh:* sub set:
//   (a) each mesh:* command's `cli` adapter is present with argv/render functions;
//   (b) source-grep meshCommand in cli.mjs for a `subcommand === "<sub>"` branch per
//       derived sub (comments discounted, isolated to the meshCommand body);
//   (c) CLI spawn-and-parse: `aof mesh <sub> --json` over a fixture exits 0 + parseable.
//
// With ZERO mesh:* commands today (story 00 is the spine + face SKELETON; the verbs
// land in stories 01/02), all three proofs pass VACUOUSLY — RED-until-commands is the
// correct state. Proof (b) ALSO asserts meshCommand IS defined (body.length > 0), so
// the SKELETON itself is gated. The argsFor switch's default THROWS (the 19/R1
// pattern): adding a mesh:* command with no args mapping fails loudly here.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCommands } from "../../src/command-core.mjs";
import { spawnCliSync } from "../support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");
const CLI_MJS = path.join(repoRoot, "src", "cli.mjs");

// The mesh-surface subcommands DERIVED from the registry — every mesh:* command's op
// segment. (NOT a hard-coded literal: a new mesh:* command is covered with no edit.
// work:*/graph:*/import:* are non-mesh and correctly excluded.)
const subcommands = () =>
  listCommands()
    .filter((command) => command.id.startsWith("mesh:"))
    .map((command) => command.id.slice("mesh:".length))
    .sort();

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Isolate the `meshCommand` function body so the dispatch grep cannot be satisfied by
// a `subcommand === "<sub>"` belonging to some OTHER command's dispatcher.
function meshCommandBody(source) {
  const start = source.search(/(?:async\s+)?function\s+meshCommand\s*\(/);
  if (start === -1) return "";
  const re = /\n(?:export\s+)?(?:async\s+)?function\s/g;
  re.lastIndex = start + 1;
  const next = re.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

// --- the CLI fixture stream (mirrors acd-work-command-cli-bijection's builder) ----

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-bijection-"));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  const milestoneDir = path.join(workDir, "03_milestone_board");
  const storyDir = path.join(milestoneDir, "stories", "01_story_board-ui");
  await mkdir(storyDir, { recursive: true });
  await mkdir(aofDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "03", slug: "board", status: "in-progress", title: '"Board"', created: "2026-06-19", updated: "2026-06-19" }),
    "utf8"
  );
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter({ type: "story", number: "01", slug: "board-ui", parent: "03", status: "in-progress", title: '"Board UI"', created: "2026-06-19", updated: "2026-06-19" }),
    "utf8"
  );
  return root;
}

// Sensible args per mesh subcommand. With ZERO mesh:* commands today the loops are
// vacuous, but the switch THROWS on an unmapped sub (the 19/R1 pattern) so a new
// mesh:* command without an args mapping fails loudly here (stories 01/02 add cases).
function argsFor(sub) {
  switch (sub) {
    // milestone 22 / story 01 — node-identity verbs. `identity` (no ref) PUBLISHES
    // this node's record (exit 0); `status` lists the roster (empty → exit 0). Both
    // emit a parseable JSON document. story 02 adds: case "sync": …
    case "identity": return ["mesh", "identity", "--json"];
    case "status": return ["mesh", "status", "--json"];
    // milestone 22 / story 02 — the git-sync verb. `sync` runs the git transport;
    // the fixture below is NOT a git repo, so mesh:sync degrades to a clean,
    // structured no-op envelope ({ noop:true, reason:"no-git-repo" }) — exit 0 +
    // parseable JSON, keeping the gate honest in a no-repo/no-remote fixture (the
    // realistic degraded path the ADR-004 transport handles).
    case "sync": return ["mesh", "sync", "--json"];
    // milestone 23 / story 00 — the presence-publish verb. `heartbeat` assembles +
    // publishes THIS node's presence record git-only against the local fixture (no
    // remote needed) — exit 0 + a parseable JSON document (the bare presence record).
    case "heartbeat": return ["mesh", "heartbeat", "--json"];
    // milestone 23 / story 01 — the relay-mode verb. `aof mesh relay` is a long-lived
    // serve verb, but its registered run is the NON-BLOCKING status probe: `aof mesh relay
    // --json` reports the configured control-node + url + nominated-or-not and RETURNS
    // (it never calls listen/blocks) — exit 0 + a parseable JSON document (the bare relay
    // status). This keeps the gate honest without the bijection probe hanging on a serve.
    case "relay": return ["mesh", "relay", "--json"];
    // milestone 24 / story 01 — the device-code enrollment verbs. The fixture is NOT a
    // control node (no config.mesh block), so `invite` refuses with ONE structured
    // { ok:false, code:"not-control-node" } envelope — exit 1 + parseable (the gate
    // accepts [0,1]); `join` with a code but NO configured relay url rejects with
    // { ok:false, code:"no-relay-url" } — exit 1 + parseable. Both prove the
    // single-envelope --json discipline without a live relay. story 02 adds:
    // case "revoke": …
    case "invite": return ["mesh", "invite", "--json"];
    case "join": return ["mesh", "join", "123456", "--json"];
    // milestone 24 / story 02 — the revoke verb. The fixture is NOT a control node (no
    // config.mesh block), so `revoke <node>` refuses with ONE structured
    // { ok:false, code:"not-control-node" } envelope — exit 1 + parseable (the gate
    // accepts [0,1]), proving the single-envelope --json discipline without a live
    // control node.
    case "revoke": return ["mesh", "revoke", "node-x", "--json"];
    // milestone 27 / story 01 — the issuance verb. The fixture's milestone 03's
    // board-ui story is a resolvable ref, but the fixture is NOT mesh-configured
    // (no config.mesh block), so `issue` refuses with ONE structured
    // { ok:false, code:"mesh-not-configured" } envelope — exit 1 + parseable (the
    // gate accepts [0,1]), proving the single-envelope --json discipline without a
    // live mesh install.
    case "issue": return ["mesh", "issue", "03/01", "--json"];
    // milestone 33 / story 01 — the coordination-launcher verb. `serve` (no --serve
    // flag) is the NON-BLOCKING probe: it reports fabric state + self-address + peer
    // count + issuance-authority and RETURNS — exit 0 + a parseable JSON document (the
    // bare launcher-probe shape). Never calls listen()/startSyncLoop; the long-lived
    // `--serve` face is a SEPARATE CLI-only path (meshServeDaemonCommand), never routed
    // through the registered bijection-probed run.
    case "serve": return ["mesh", "serve", "--json"];
    default: throw new Error(`unmapped subcommand ${sub}`);
  }
}

// spawnCliSync (test/support/cli-spawn.mjs) hardens this against the Windows
// CreateProcess flake: under full-suite temp-dir / handle pressure the spawn can
// transiently fail with status:null (the child never ran — NOT a CLI exit), which would
// falsely red this structurally-sound gate; the shared helper retries ONLY that
// never-ran case while passing a real exit straight through.
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
    name: "arch/mesh-bijection: every registered mesh:* command carries a non-null cli adapter (argv + render functions)",
    run: async () => {
      const meshCommands = listCommands().filter((command) => command.id.startsWith("mesh:"));
      // RED-until-commands: vacuously true with zero mesh:* commands (the verbs land
      // in stories 01/02); each mesh:* command must carry a cli adapter when it lands.
      for (const command of meshCommands) {
        assert.ok(command.cli != null, `${command.id} has a non-null cli adapter`);
        assert.equal(typeof command.cli.argv, "function", `${command.id} cli.argv is a function`);
        assert.equal(typeof command.cli.render, "function", `${command.id} cli.render is a function`);
      }
    },
  },
  {
    name: "arch/mesh-bijection: meshCommand in cli.mjs is defined and has a reachable dispatch branch per registry-derived mesh:* subcommand",
    run: async () => {
      const body = meshCommandBody(stripComments(await readFile(CLI_MJS, "utf8")));
      // The SKELETON itself is gated: meshCommand must be defined (story 00 ships it).
      assert.ok(body.length > 0, "meshCommand is defined in cli.mjs (the face skeleton)");
      // Vacuously true with zero mesh:* commands; each derived sub must have a branch.
      for (const sub of subcommands()) {
        assert.ok(
          new RegExp(`subcommand\\s*===\\s*["']${sub}["']`).test(body),
          `meshCommand dispatches \`subcommand === "${sub}"\` (no mesh command the CLI cannot run)`
        );
      }
    },
  },
  {
    name: "arch/mesh-bijection: aof mesh <sub> --json runs cleanly and emits parseable JSON for every registry-derived mesh:* subcommand",
    run: async () => {
      const subs = subcommands();
      if (subs.length === 0) {
        // RED-until-commands: with zero mesh:* commands the spawn loop is vacuous.
        // Pin the vacuity explicitly so the proof is a deliberate green, not an
        // accidental skip — stories 01/02 populate subs and exercise the loop.
        assert.deepEqual(subs, [], "no mesh:* commands yet (story 00 is the spine + face skeleton); 01/02 add the verbs");
        return;
      }
      const root = await buildFixture();
      try {
        for (const sub of subs) {
          const result = runCli(root, argsFor(sub));
          assert.ok([0, 1].includes(result.status), `aof mesh ${sub} --json runs cleanly (got status ${result.status}${result.error ? `; spawn error ${result.error.code ?? result.error.message}` : ""}; stderr: ${result.stderr})`);
          let parsed;
          assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `aof mesh ${sub} --json emits parseable JSON (stdout: ${result.stdout.slice(0, 200)})`);
          assert.ok(parsed !== undefined, `aof mesh ${sub} --json produced a JSON value`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
