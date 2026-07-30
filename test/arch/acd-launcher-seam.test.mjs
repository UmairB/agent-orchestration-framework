// Fitness function: acd-launcher-seam (m42 wave (d) leg d1, wave-3 tail part 2 —
// the successor of acd-desktop-verbs-outside-bijection, REWORKED twice as its
// subject migrated). The original gate kept launcher verbs OUT of the registry so
// no bijection probe could hang on a serve; the launcher seam inverts the
// posture: a verb whose real body is a long-lived foreground process now
// REGISTERS, declaring the body as `cli.launch` — and what this gate protects is
// the seam's discipline:
//
//  A. THE SHIMS STAY SHIMS: `repo` and `desktop` dispatch in meshCommand only as
//     no-verb/unknown-verb refusal shims (refusals a route cannot express) and
//     register NO bare `mesh:repo` / `mesh:desktop` id — their inner verbs are
//     the three-word-routed commands (mesh:repo-publish, mesh:desktop-install,
//     mesh:desktop-run).
//  B. THE SEAM SHAPE: every registered command declaring `cli.launch` also keeps
//     a runnable PROBE — a real run() plus the cli.spec/json faces — because the
//     probe IS the verb's --json face. (That the probe returns without blocking
//     is proven behaviourally by the bijection gates' spawn probes.) Armed
//     non-vacuously: mesh:ui and mesh:serve ride the seam today.
//  C. THE PROBE RULE IS FACE POLICY: src/spine/face.mjs consults cli.launch ONLY
//     when --json was not asked for — `--json` can never launch, so a bijection
//     spawn probe can never hang on a serve BY CONSTRUCTION, not per-command
//     care. Self-checked with a synthetic unguarded face body.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCommands } from "../../src/command-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_MJS = path.join(repoRoot, "src", "cli.mjs");
const FACE_MJS = path.join(repoRoot, "src", "spine", "face.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Isolate the meshCommand body (borrowed from acd-mesh-command-cli-bijection) so a
// dispatch grep cannot be satisfied by some other function's `subcommand === "…"`.
function meshCommandBody(source) {
  const start = source.search(/(?:async\s+)?function\s+meshCommand\s*\(/);
  if (start === -1) return "";
  const re = /\n(?:export\s+)?(?:async\s+)?function\s/g;
  re.lastIndex = start + 1;
  const next = re.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

// The detector for proof C: the cli.launch consult in runCommandFace must be
// guarded by the probe rule (--json never launches). Text-level on purpose — the
// guard IS the policy line, and a rework that drops it should have to face this
// gate, not slip past a looser semantic probe.
export function launchConsultUnguarded(faceSource) {
  const code = stripComments(faceSource);
  if (!/cli\.launch/.test(code)) return "face never consults cli.launch — the launcher seam is gone";
  const guarded = /options\.json\s*!==\s*true\s*&&\s*typeof\s+cli\.launch\s*===\s*["']function["']/.test(code);
  return guarded ? null : "the cli.launch consult is not guarded by `options.json !== true` — a --json invocation could launch, and a bijection spawn probe could hang on a serve";
}

// The registry ids as a Set, for the "no bare shim id" check.
const registryMeshVerbs = () =>
  new Set(
    listCommands()
      .filter((c) => c.id.startsWith("mesh:"))
      .map((c) => c.id.slice("mesh:".length)),
  );

// The nested groups whose no-verb/unknown-verb refusals a route cannot express:
// each keeps a ladder SHIM in meshCommand and must never register its bare name.
const SHIM_VERBS = ["repo", "desktop"];

export const archTests = [
  {
    name: "arch/m42-launcher-seam (A): the repo + desktop shims dispatch in meshCommand but register NO bare mesh:repo / mesh:desktop id (their inner verbs are the three-word routes)",
    run: async () => {
      const body = meshCommandBody(stripComments(await readFile(CLI_MJS, "utf8")));
      assert.ok(body.length > 0, "meshCommand is defined");
      const registry = registryMeshVerbs();
      for (const verb of SHIM_VERBS) {
        assert.ok(
          new RegExp(`subcommand\\s*===\\s*["']${verb}["']`).test(body),
          `\`${verb}\` keeps its no-verb/unknown-verb shim in meshCommand`,
        );
        assert.ok(
          !registry.has(verb),
          `no bare mesh:${verb} id — the shim is a refusal door, never a command`,
        );
      }
      // The inner verbs ARE registered (the shims guard real, routed commands).
      for (const id of ["repo-publish", "desktop-install", "desktop-run"]) {
        assert.ok(registry.has(id), `mesh:${id} is a registered three-word-routed command`);
      }
    },
  },
  {
    name: "arch/m42-launcher-seam (B): every cli.launch command keeps a runnable probe (run + spec + json), and the seam is armed (mesh:ui, mesh:serve ride it)",
    run: async () => {
      const launchers = listCommands().filter((c) => typeof c.cli?.launch === "function");
      const ids = launchers.map((c) => c.id);
      for (const id of ["mesh:ui", "mesh:serve"]) {
        assert.ok(ids.includes(id), `${id} declares cli.launch (the seam is armed, not vacuous)`);
      }
      for (const command of launchers) {
        assert.equal(typeof command.run, "function", `${command.id}: a launcher keeps a runnable probe (run)`);
        assert.equal(typeof command.cli.spec?.usage, "string", `${command.id}: the probe declares its face contract (spec.usage)`);
        assert.equal(typeof command.cli.json, "function", `${command.id}: the probe is the --json face (cli.json)`);
        assert.ok(Array.isArray(command.cli.route) && command.cli.route.length > 0, `${command.id}: a launcher rides the route table (cli.route)`);
      }
    },
  },
  {
    name: "arch/m42-launcher-seam (C): the face consults cli.launch only when --json was not asked for — a --json invocation can never launch",
    run: async () => {
      const problem = launchConsultUnguarded(await readFile(FACE_MJS, "utf8"));
      assert.equal(problem, null, problem ?? "");
    },
  },
  {
    name: "arch/m42-launcher-seam (self-check): an unguarded cli.launch consult and a launch-only command are the violations this fitness catches (non-vacuous)",
    run: async () => {
      // A synthetic face whose launch consult ignores the probe rule.
      const unguarded = [
        "export async function runCommandFace(command, args) {",
        "  const cli = command.cli ?? {};",
        "  const options = parseSpecArgv(args, cli.spec, command.id);",
        "  if (typeof cli.launch === \"function\") {",
        "    const body = cli.launch(options);",
        "    if (body != null) { await body(await cli.argv(options._, options), { options }); return; }",
        "  }",
        "}",
      ].join("\n");
      assert.notEqual(launchConsultUnguarded(unguarded), null, "an unguarded launch consult trips the detector");
      // And a registry entry that declared launch but dropped its probe would
      // fail proof B's run-is-a-function assertion — the violation shape.
      const launchOnly = { id: "mesh:synthetic", cli: { launch: () => () => {}, spec: { usage: "x" }, json: (r) => r, route: ["mesh", "synthetic"] } };
      assert.notEqual(typeof launchOnly.run, "function", "a launch-only command (no probe) is what proof B refuses");
    },
  },
];
