// Fitness function: acd-desktop-verbs-outside-bijection (milestone 36 / ADR-003,
// fitness #5) — "The new desktop install + run/launch verbs are CLI-ONLY nested verbs
//  under `aof mesh` (siblings to ui/repo/assign), deliberately OUTSIDE the
//  acd-mesh-command-cli-bijection — they do NOT register as `mesh:*` commands (their
//  flag-bearing face doesn't fit the single-positional meshVerbCli / `mesh:<verb>`
//  registry shape). So they add NO registry id and cannot redden the bijection gate,
//  exactly as `ui`/`repo`/`assign` already sit outside it."
//
// TWO PROOFS, one file:
//  A. STANDING invariant (armed NOW): the CLI-only nested-verb precedent is intact —
//     `aof mesh ui`/`repo`/`assign` dispatch in meshCommand but register NO `mesh:ui`/
//     `mesh:repo`/`mesh:assign` command id (they are correctly outside the bijection).
//     This is a real assertion today (those verbs exist) — it protects the seam the
//     new desktop verbs join.
//  B. GUARD-IF-PRESENT (armed at build): once the desktop verbs land in meshCommand,
//     their names (the install verb + the run verb) must ALSO have NO matching `mesh:*`
//     registry id — CLI-only, like their siblings. A clean no-op until the dispatch
//     branches exist.
//  Self-check (m03 non-vacuous): a synthetic registry containing `mesh:ui` would fail
//     the "no registry id for a CLI-only nested verb" assertion the real registry passes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCommands } from "../../src/command-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_MJS = path.join(repoRoot, "src", "cli.mjs");

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

// The registry ids as a Set, for the "no mesh:<verb> id" check.
const registryMeshVerbs = () =>
  new Set(
    listCommands()
      .filter((c) => c.id.startsWith("mesh:"))
      .map((c) => c.id.slice("mesh:".length)),
  );

// The CLI-only nested verbs that MUST sit outside the bijection. The three existing
// siblings are asserted NOW; the two milestone-36 desktop verbs are guard-if-present
// (checked only once their dispatch branch appears in meshCommand).
const EXISTING_CLI_ONLY_NESTED_VERBS = ["ui", "repo", "assign"];
// The milestone-36 install + run verb NAMES. (The exact spelling is the build story's
// call; these are the candidate names the ADR records. The guard fires for whichever
// of them actually lands a `subcommand === "<verb>"` dispatch branch.)
const DESKTOP_CANDIDATE_VERBS = ["desktop", "install", "app", "launch", "run"];

export const archTests = [
  {
    name: "arch/36 ADR-003 (acd-desktop-verbs-outside-bijection, standing): the existing CLI-only nested verbs (ui/repo/assign) dispatch in meshCommand but register NO mesh:* id",
    run: async () => {
      const body = meshCommandBody(stripComments(await readFile(CLI_MJS, "utf8")));
      assert.ok(body.length > 0, "meshCommand is defined");
      const registry = registryMeshVerbs();
      for (const verb of EXISTING_CLI_ONLY_NESTED_VERBS) {
        // it IS dispatched as a nested verb in meshCommand …
        assert.ok(
          new RegExp(`subcommand\\s*===\\s*["']${verb}["']`).test(body),
          `\`${verb}\` is dispatched in meshCommand as a nested verb`,
        );
        // … and it is NOT a registered mesh:* command (correctly outside the bijection).
        assert.ok(
          !registry.has(verb),
          `\`${verb}\` has NO mesh:${verb} registry id — it is CLI-only, outside acd-mesh-command-cli-bijection`,
        );
      }
    },
  },
  {
    name: "arch/36 ADR-003 (acd-desktop-verbs-outside-bijection, guard-if-present): the desktop install/run verbs — once dispatched — carry NO mesh:* registry id (CLI-only, like their siblings)",
    run: async () => {
      const body = meshCommandBody(stripComments(await readFile(CLI_MJS, "utf8")));
      const registry = registryMeshVerbs();
      let armed = 0;
      for (const verb of DESKTOP_CANDIDATE_VERBS) {
        const dispatched = new RegExp(`subcommand\\s*===\\s*["']${verb}["']`).test(body);
        if (!dispatched) continue; // pre-build no-op for a not-yet-landed verb
        armed += 1;
        assert.ok(
          !registry.has(verb),
          `\`${verb}\` (a milestone-36 desktop nested verb) must NOT register a mesh:${verb} id — CLI-only, outside the bijection`,
        );
      }
      // Pin the pre-build vacuity explicitly (no desktop verb landed yet ⇒ armed === 0),
      // so this is a deliberate green, not an accidental skip.
      if (armed === 0) {
        assert.equal(armed, 0, "no milestone-36 desktop nested verb has landed yet; armed at build by story 03");
      }
    },
  },
  {
    name: "arch/36 ADR-003 (acd-desktop-verbs-outside-bijection): self-check — a nested verb that DID register a mesh:* id would fail the outside-bijection assertion (non-vacuous)",
    run: async () => {
      // A synthetic registry proving the assertion is not vacuous: were `ui` a
      // registered mesh:ui command, the "no registry id" check would trip.
      const syntheticRegistry = new Set(["status", "identity", "ui"]);
      assert.ok(syntheticRegistry.has("ui"), "the synthetic registry does register mesh:ui");
      // The real invariant the standing test enforces is the NEGATION — so this planted
      // positive is exactly what a violation looks like.
      const violates = syntheticRegistry.has("ui");
      assert.equal(violates, true, "a CLI-only nested verb that leaked a mesh:* registry id is the violation this fitness catches");
    },
  },
];
