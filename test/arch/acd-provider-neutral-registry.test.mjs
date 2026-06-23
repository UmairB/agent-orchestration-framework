// Fitness function for milestone 12 / ADR-005 inv. 3 (provider-neutral registry;
// ADR-002):
// "The uv lane never shells `npx`; the npx lane never shells `uv`; dispatch is on
//  descriptor.provider. No provisioning code leaks a provider-only assumption
//  across lanes."
//
// Two kinds of proof:
//   (a) SOURCE-GREP src/tool-store.mjs — the uv-lane planner's argv[0] is the
//       literal "uv" and the uv-lane code contains no `npx` shell; the npx-lane
//       planner DELEGATES to frameworks.mjs's planFrameworkInstall (whose argv[0]
//       is "npx") and the npx-lane code contains no `uv` shell. (For the
//       cross-shell check comments+strings are discounted so a mention in a
//       comment/string is not a leak; the argv-literal asserts keep strings.)
//   (b) BEHAVIOURAL — planProvision dispatched on a uv descriptor → every command
//       argv[0] is "uv", none is "npx"; on an npx descriptor → the delegated plan
//       items' argv[0] is "npx", none is "uv". And dispatch KEYS on
//       descriptor.provider: an unknown provider and an absent provider both
//       reject (naming the bad provider where applicable).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planProvision } from "../../src/tool-store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(repoRoot, "src");
const TOOL_STORE = path.join(srcDir, "tool-store.mjs");

// Strip line + block comments AND string literals (the cross-shell leak check —
// an `npx`/`uv` in a comment or a doc string is not a shell-out). Mirrors
// acd-graphify-no-npx-install's stripCommentsAndStrings.
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i += 1; continue; }
    if (state === "block") { if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i += 1; continue; }
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; i += 1; continue; }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}

// Strip ONLY comments (keep string literals) — for the argv-literal asserts: the
// `"uv"` spawn target is a string literal we WANT to see.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Extract the body of a named function declaration from a source string (brace
// matching). Returns the inner text between the body's opening `{` and its matching
// `}` — so a per-lane scan sees ONLY that lane's code. The parameter list is
// stepped over by paren-matching FIRST (so a `{}` default value inside the params,
// e.g. `options = {}`, is not mistaken for the body's opening brace).
function functionBody(source, fnName) {
  const sigRe = new RegExp(`function\\s+${fnName}\\s*\\(`);
  const sigMatch = sigRe.exec(source);
  assert.ok(sigMatch, `found the ${fnName} function declaration in tool-store.mjs`);
  // Walk the parameter list by paren depth, starting at the `(` the signature ends
  // on, so any `{}` inside the params is skipped.
  let i = source.indexOf("(", sigMatch.index);
  assert.ok(i >= 0, `found the parameter list of ${fnName}`);
  let parenDepth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") { parenDepth -= 1; if (parenDepth === 0) { i += 1; break; } }
  }
  // Now the next `{` opens the body.
  i = source.indexOf("{", i);
  assert.ok(i >= 0, `found the opening brace of ${fnName}`);
  let depth = 0;
  const start = i;
  for (; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  assert.fail(`could not find the closing brace of ${fnName}`);
}

export const archTests = [
  {
    name: "arch/ADR-005 inv.3: the uv lane's plan argv[0] is the `uv` literal and the uv-lane code contains no `npx` shell",
    run: async () => {
      const withStrings = stripComments(await readFile(TOOL_STORE, "utf8"));
      // The uv lane builds its commands with the literal "uv" as argv[0] (the
      // venv + pip-install pair).
      const uvBody = functionBody(withStrings, "planUvProvision");
      assert.ok(
        /\[\s*["']uv["']\s*,/.test(uvBody),
        "planUvProvision builds a command whose argv[0] is the `uv` literal"
      );
      // The uv lane NEVER shells npx (comments + strings discounted so a mention
      // in a doc comment/string is not counted — only a live `npx` token).
      const live = stripCommentsAndStrings(await readFile(TOOL_STORE, "utf8"));
      const uvLive = functionBody(live, "planUvProvision");
      assert.ok(!/\bnpx\b/.test(uvLive), "the uv lane contains no live `npx` reference");
    },
  },
  {
    name: "arch/ADR-005 inv.3: the npx lane DELEGATES to frameworks.mjs (planFrameworkInstall) and contains no `uv` shell; the delegated argv[0] is `npx`",
    run: async () => {
      const live = stripCommentsAndStrings(await readFile(TOOL_STORE, "utf8"));
      const npxLive = functionBody(live, "planNpxProvision");
      // The npx lane delegates to the untouched frameworks.mjs planner (a re-home,
      // not a rewrite) — so the planFrameworkInstall call is present...
      assert.ok(
        /\bplanFrameworkInstall\s*\(/.test(npxLive),
        "the npx lane delegates to frameworks.mjs's planFrameworkInstall"
      );
      // ...and it never shells uv.
      assert.ok(!/\buv\b/.test(npxLive), "the npx lane contains no live `uv` reference");

      // The delegated argv shape (argv[0] === "npx") lives in frameworks.mjs — the
      // untouched planner. (acd-npx-lane-preserved is the dedicated guard; here we
      // confirm the delegation TARGET still produces an npx argv.)
      const frameworks = stripComments(await readFile(path.join(srcDir, "frameworks.mjs"), "utf8"));
      assert.ok(
        /argv\s*=\s*\[\s*["']npx["']/.test(frameworks),
        "the delegated frameworks.mjs planner builds an argv starting with the `npx` literal"
      );
    },
  },
  {
    name: "arch/ADR-005 inv.3: planProvision on a uv descriptor plans only `uv` commands (no `npx`); on an npx descriptor plans only `npx` items (no `uv`)",
    run: () => {
      // ── uv descriptor → first command argv[0] is "uv", none is "npx".
      const uvPlan = planProvision(
        { name: "graphify", provider: "uv", packageSpec: "graphifyy", version: "0.8.44", binaries: ["graphify"] },
        { dryRun: true, env: { AOF_GLOBAL_HOME: path.join(repoRoot, ".tmp-nonexistent") } }
      );
      assert.ok(Array.isArray(uvPlan.commands) && uvPlan.commands.length > 0, "the uv plan carries a command list");
      assert.equal(uvPlan.commands[0][0], "uv", "the uv lane's first command argv[0] is `uv`");
      for (const command of uvPlan.commands) {
        assert.equal(command[0], "uv", "every uv-lane command argv[0] is `uv`");
        assert.notEqual(command[0], "npx", "no uv-lane command argv[0] is `npx`");
      }

      // ── npx descriptor → the delegated plan items' argv[0] is "npx", none "uv".
      const npxPlan = planProvision(
        { name: "gsd", provider: "npx", packageSpec: "get-shit-done-cc@latest", version: "latest", binaries: ["gsd"] },
        { dryRun: true }
      );
      assert.ok(Array.isArray(npxPlan.items) && npxPlan.items.length > 0, "the npx plan carries delegated items");
      for (const item of npxPlan.items) {
        assert.ok(Array.isArray(item.argv) && item.argv.length > 0, "each npx item carries an argv");
        assert.equal(item.argv[0], "npx", "every npx-lane item argv[0] is `npx`");
        assert.notEqual(item.argv[0], "uv", "no npx-lane item argv[0] is `uv`");
      }
    },
  },
  {
    name: "arch/ADR-005 inv.3: dispatch keys on descriptor.provider — an unknown provider and an absent provider both reject (naming the bad provider)",
    run: () => {
      // Unknown provider → reject, naming the bad provider.
      assert.throws(
        () => planProvision({ name: "wat", provider: "wat", packageSpec: "wat", version: "1.0.0", binaries: ["wat"] }, { dryRun: true }),
        (error) => {
          assert.ok(/wat/.test(error.message), "the error names the unknown provider `wat`");
          return true;
        },
        "an unknown provider is rejected, not guessed"
      );

      // Absent provider → reject (no lane to dispatch to).
      assert.throws(
        () => planProvision({ name: "noprov", packageSpec: "noprov", version: "1.0.0", binaries: ["noprov"] }, { dryRun: true }),
        "an absent provider is rejected"
      );

      // Defensive: a fully-absent/empty descriptor also rejects (no guessing).
      assert.throws(() => planProvision({}, { dryRun: true }), "an empty descriptor is rejected");
      assert.throws(() => planProvision(undefined, { dryRun: true }), "an undefined descriptor is rejected");
    },
  },
];
