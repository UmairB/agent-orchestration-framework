// Fitness functions for m42 wave (d) leg d1 (PRD-command-spine-effects-ledger):
// the CLI's route table is DERIVED from the registry — never a hand-kept ladder
// — and stays coherent as verbs migrate.
//
//   (1) deriveRouteTable derives collision-free (two commands can never claim
//       the same words — the derivation itself throws, this pins it).
//   (2) Every command declaring cli.route RESOLVES through resolveRoute to
//       itself, with the remaining argv (positionals/flags) passed through — a
//       declared route that cannot dispatch is a lie.
//   (3) A routed command carries a cli.spec with a usage line — the per-command
//       flag vocabulary is the route-table contract (no routed verb may fall
//       back to parseOptions' global allow-list).
//   (4) No group ladder re-implements a routed verb: a `subcommand === "<sub>"`
//       branch for a routed verb may exist ONLY as a delegation (it must call
//       runCommandFace) — the bare-`aof project` default spelling is the
//       sanctioned example. Anything else is a second door.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCommands } from "../../src/command-core.mjs";
import { deriveRouteTable, resolveRoute } from "../../src/spine/face.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_MJS = path.join(repoRoot, "src", "cli.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Isolate one `async function <name>(…) { … }` body (the bijection-test idiom).
function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (start === -1) return "";
  const re = /\n(?:export\s+)?(?:async\s+)?function\s/g;
  re.lastIndex = start + 1;
  const next = re.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

// The group dispatchers that still hold a legacy ladder. Extend as groups grow;
// a routed verb under any of them must not be re-implemented there.
const GROUP_DISPATCHERS = Object.freeze({
  work: "workCommand",
  assets: "assetsCommand",
  packages: "packagesCommand",
  project: "projectCommand",
  graph: "graphCommand",
  mesh: "meshCommand",
});

export const archTests = [
  {
    name: "arch/m42-d1: the route table derives from the registry collision-free",
    run: async () => {
      const table = deriveRouteTable(listCommands());
      assert.ok(table.size >= 1, "at least one command declares cli.route (the migration has begun)");
      for (const key of table.keys()) {
        assert.ok(key.trim().length > 0, "route keys are non-empty word sequences");
      }
    },
  },
  {
    name: "arch/m42-d1: every declared cli.route resolves through resolveRoute to its own command, argv passed through",
    run: async () => {
      for (const command of listCommands()) {
        const route = command.cli?.route;
        if (!Array.isArray(route) || route.length === 0) continue;
        const resolved = resolveRoute([...route, "positional", "--json"], listCommands());
        assert.ok(resolved, `${command.id}: resolveRoute finds a command for [${route.join(", ")}]`);
        assert.equal(resolved.command.id, command.id, `${command.id}: the route resolves to itself`);
        assert.deepEqual(resolved.rest, ["positional", "--json"], `${command.id}: trailing argv passes through untouched`);
      }
    },
  },
  {
    name: "arch/m42-d1: a routed command declares its face contract (cli.spec with usage)",
    run: async () => {
      for (const command of listCommands()) {
        if (!Array.isArray(command.cli?.route) || command.cli.route.length === 0) continue;
        assert.ok(command.cli.spec && typeof command.cli.spec === "object", `${command.id} carries cli.spec`);
        assert.equal(typeof command.cli.spec.usage, "string", `${command.id} spec has a usage line`);
      }
    },
  },
  {
    name: "arch/m42-d1: no group ladder re-implements a routed verb (a surviving branch must delegate to runCommandFace)",
    run: async () => {
      const source = stripComments(await readFile(CLI_MJS, "utf8"));
      for (const command of listCommands()) {
        const route = command.cli?.route;
        if (!Array.isArray(route) || route.length !== 2) continue;
        const [group, sub] = route;
        const dispatcher = GROUP_DISPATCHERS[group];
        if (!dispatcher) continue;
        const body = functionBody(source, dispatcher);
        if (body.length === 0) continue;
        const branch = new RegExp(
          `if\\s*\\(\\s*subcommand\\s*===\\s*["']${sub}["']\\s*\\)\\s*\\{([\\s\\S]*?)\\n  \\}`,
        ).exec(body);
        if (!branch) continue; // fully migrated — the route table is the only door
        assert.ok(
          /runCommandFace\s*\(/.test(branch[1]),
          `${dispatcher}'s "${sub}" branch must delegate to runCommandFace (route ${command.id}) — a re-implementation is a second door`,
        );
      }
    },
  },
];
