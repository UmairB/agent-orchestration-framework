// Fitness function for milestone 13 / ADR-002:
// "Registered command + read-only source. `import:milestone` is registered in the
//  frozen Command core ({id,input,run,cli}) with a callable `cli` adapter and is
//  dispatched via invoke; source access is READ-ONLY — a local repo read in place, a
//  remote reached via the planning-init git-argv-spawn idiom (NO shell-STRING spawn),
//  and NO git WRITE verb (commit/push/checkout/clone-into-source) is ever constructed
//  against the source. The ONLY external-fetch form is the read-only git ls-remote /
//  read-only fetch argv idiom."
//
// Mirrors the acd-planning-install-commands network-boundary idiom (argv-derived,
// no shell string, the only external form is read-only) applied to import. Halves,
// all CI-able offline (no command run, no live source):
//   (a) REGISTERED-COMMAND: getCommand("import:milestone") returns the frozen-shape
//       command (exactly {id,input,run,cli}) with a callable cli.argv/render/json.
//   (b) NO-WRITE-VERB: source-grep the import modules — no `git` write verb
//       (commit/push/checkout/clone) appears as a spawn argv element against the source.
//   (c) NO-SHELL-STRING: no `exec(`/`execSync(` (a shell string), and no spawn whose
//       argv[0] is a constructed command-line string (a space-bearing template) — the
//       house spawn discipline is argv-array (`spawnSync("git", [..argv..], {…})`),
//       with `shell: <bool>` only to resolve git.cmd on win32 (the planning-init idiom).
//   (d) ONLY-READ-ONLY-FETCH: the ONLY `git` verb spawned across the import surface is
//       a READ-ONLY one (ls-remote / log / status / rev-parse / fetch) — every spawned
//       git argv leads with a read-only verb, never a write verb.
//
// Non-vacuous: (a) goes RED if the command is unregistered or its key-set changes;
// (b)/(d) go RED if any import module spawned `git ["commit"/"push"/"checkout"/"clone",
// …]` against the source (the regex sees the verb as a real argv string token); (c)
// goes RED if a constructed-command-string spawn / exec( appeared (the self-checks at
// the foot of each guard prove the matcher fires on the forbidden form and not on the
// accepted argv form).
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCommand } from "../../src/command-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_IMPORT_DIR = path.join(repoRoot, "src", "import");
const IMPORT_COMMAND = path.join(repoRoot, "src", "commands", "import-milestone.mjs");

// Strip line + block comments AND string/template literals so a documented mention of
// `git commit` in prose, or a "commit" inside an error MESSAGE string, does not trip
// the write-verb guard — only LIVE CODE (real argv tokens) counts. (The 09/10
// call-form-not-comment idiom.) String literals collapse to a space.
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code"; // code | line | block | sq | dq | tpl
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

// Keep STRING literals (so we can read the argv token strings) but drop comments, so a
// `git log` documented in a comment is discounted while a real `["log", …]` argv survives.
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Every git VERB spawned across the import surface — pulled from each spawn call's argv.
// We read the SPECIFIER of a spawn/exec of "git": `spawn*("git", [<verb>, …])`. The verb
// is the first array element (a string literal). A `-C <dir>` / `ls-remote` lead is the
// verb at argv[0] of the array (or argv[2] after `-C dir`).
const GIT_WRITE_VERBS = ["commit", "push", "checkout", "clone", "merge", "rebase", "reset", "add", "rm", "mv", "tag", "branch", "remote", "init", "stash", "apply", "am"];
// The verbs the import surface is ALLOWED to spawn — all read-only probes.
const GIT_READONLY_VERBS = ["ls-remote", "log", "status", "rev-parse", "fetch", "show", "cat-file", "config"];

// Pull each `git` spawn's verb tokens out of code that retains strings. Matches
// `spawn*("git", [ <tokens> ])` and returns the array of string-literal tokens.
function gitSpawnArgvTokens(codeWithStrings) {
  const tokens = [];
  const re = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*["']git["']\s*,\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(codeWithStrings)) !== null) {
    for (const lit of m[1].matchAll(/["']([^"']+)["']/g)) tokens.push(lit[1]);
  }
  return tokens;
}

// A constructed-command-STRING spawn: spawn*/exec* whose argv[0] is a template literal
// or a string concatenation (a `+`) or a space-bearing command string (`"git ls-remote"`).
// The accepted form is `("git", [..])` — a bare argv[0] + an array. This catches the
// FORBIDDEN `("git ls-remote " + repo, {shell:true})` / `(`git clone ${repo}`)` forms.
const SHELL_STRING_SPAWN = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*(?:`[^`]*`|["'][^"']*\s[^"']*["']|[A-Za-z0-9_.]+\s*\+)/;
// `exec(`/`execSync(` are inherently shell-string forms (no argv array) — forbidden outright.
const EXEC_SHELL = /\b(?:exec|execSync)\s*\(/;

async function importModuleFiles() {
  const files = [IMPORT_COMMAND];
  for (const entry of await readdir(SRC_IMPORT_DIR)) {
    if (entry.endsWith(".mjs")) files.push(path.join(SRC_IMPORT_DIR, entry));
  }
  return files;
}

export const archTests = [
  {
    name: "arch/import-read-only-source: getCommand(\"import:milestone\") returns the frozen-shape command ({id,input,run,cli}) with a callable cli adapter",
    run: async () => {
      const command = getCommand("import:milestone");
      assert.ok(command, "getCommand(\"import:milestone\") returns a command (registered in the frozen core)");
      assert.deepEqual(
        Object.keys(command).sort(),
        ["cli", "id", "input", "run"],
        "the command is EXACTLY the frozen {id,input,run,cli} shape"
      );
      assert.equal(command.id, "import:milestone", "id is import:milestone");
      assert.equal(typeof command.run, "function", "run is a function");
      assert.ok(command.input && typeof command.input === "object", "input is a JSON-schema object");
      // The cli adapter: argv (input builder) + render + json, all callable.
      assert.equal(typeof command.cli.argv, "function", "cli.argv is a callable adapter");
      assert.equal(typeof command.cli.render, "function", "cli.render is callable");
      assert.equal(typeof command.cli.json, "function", "cli.json is callable");
      // argv maps positionals → input (the dispatch contract): repo + optional selector.
      const input = command.cli.argv(["./some/repo", "00"], { dryRun: true });
      assert.equal(input.repo, "./some/repo", "cli.argv reads <repo> positional");
      assert.equal(input.selector, "00", "cli.argv reads [selector] positional");
      assert.equal(input.dryRun, true, "cli.argv reads --dry-run");
    },
  },
  {
    name: "arch/import-read-only-source: NO import module constructs a git WRITE verb against the source (commit/push/checkout/clone/…)",
    run: async () => {
      for (const file of await importModuleFiles()) {
        const code = stripCommentsOnly(await readFile(file, "utf8"));
        const verbs = gitSpawnArgvTokens(code);
        for (const verb of verbs) {
          assert.ok(
            !GIT_WRITE_VERBS.includes(verb),
            `${path.relative(repoRoot, file)} spawns NO git write verb against the source (found "${verb}")`
          );
        }
      }
      // Self-check (non-vacuous): the verb extractor DOES see a write verb in the
      // forbidden form, and does NOT see one in the accepted read-only form.
      assert.deepEqual(gitSpawnArgvTokens('spawnSync("git", ["commit", "-m", "x"])'), ["commit", "-m", "x"], "extractor reads a forbidden write argv");
      assert.deepEqual(gitSpawnArgvTokens('spawnSync("git", ["ls-remote", repo], opts)'), ["ls-remote"], "extractor reads the accepted read-only argv (variable args ignored)");
    },
  },
  {
    name: "arch/import-read-only-source: NO import module uses a shell-STRING spawn / exec( (the argv-array discipline; shell:<bool> only resolves git.cmd on win32)",
    run: async () => {
      for (const file of await importModuleFiles()) {
        const code = stripCommentsAndStrings(await readFile(file, "utf8"));
        // exec(/execSync( — inherently a shell string, no argv array. Forbidden.
        assert.ok(!EXEC_SHELL.test(code), `${path.relative(repoRoot, file)} uses no exec(/execSync( (a shell string)`);
      }
      // The shell-STRING-argv guard reads the STRING-retained code (a template/space-bearing
      // argv[0] is the forbidden form; the accepted form is ("git", [..])).
      for (const file of await importModuleFiles()) {
        const code = stripCommentsOnly(await readFile(file, "utf8"));
        assert.ok(
          !SHELL_STRING_SPAWN.test(code),
          `${path.relative(repoRoot, file)} constructs no shell-string spawn (argv[0] is a bare command, never a template/concatenated command line)`
        );
      }
      // Self-check (non-vacuous): the guard FIRES on the forbidden constructed-string
      // forms and does NOT fire on the accepted argv-array form.
      assert.ok(SHELL_STRING_SPAWN.test('spawnSync("git ls-remote " + repo, {shell:true})'), "guard catches a concatenated command string");
      assert.ok(SHELL_STRING_SPAWN.test('spawnSync(`git clone ${repo}`)'), "guard catches a template command string");
      assert.ok(SHELL_STRING_SPAWN.test('spawnSync("git ls-remote origin")'), "guard catches a space-bearing command string");
      assert.ok(!SHELL_STRING_SPAWN.test('spawnSync("git", ["ls-remote", repo], {shell: true})'), "guard does NOT catch the accepted argv-array form");
      assert.ok(EXEC_SHELL.test('exec("git status")'), "guard catches exec(");
    },
  },
  {
    name: "arch/import-read-only-source: the ONLY git verbs the import surface spawns are READ-ONLY (ls-remote/log/status/rev-parse/fetch) — the read-only network boundary",
    run: async () => {
      let sawAnyGitSpawn = false;
      for (const file of await importModuleFiles()) {
        const code = stripCommentsOnly(await readFile(file, "utf8"));
        // The verb is the FIRST git argv token that is itself a git subcommand (skip the
        // `-C <dir>` / `-c <kv>` lead flags + their values, which precede the verb).
        const re = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*["']git["']\s*,\s*\[([^\]]*)\]/g;
        let m;
        const KNOWN = new Set([...GIT_READONLY_VERBS, ...GIT_WRITE_VERBS]);
        while ((m = re.exec(code)) !== null) {
          sawAnyGitSpawn = true;
          const lits = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
          // The verb is the FIRST array-literal token that is a recognized git subcommand.
          // A `-C <dir>` lead whose <dir> is a non-literal variable contributes no token,
          // so keying off the known-subcommand set (not a positional skip) is robust to
          // the flag-value being interpolated. If the spawn names a WRITE verb, it shows
          // up here and fails (b)'s no-write guard too — this guard is the read-only floor.
          const verb = lits.find((tok) => KNOWN.has(tok));
          assert.ok(
            verb,
            `${path.relative(repoRoot, file)} git spawn names a recognized git subcommand (argv tokens: ${lits.join(" ")})`
          );
          assert.ok(
            GIT_READONLY_VERBS.includes(verb),
            `${path.relative(repoRoot, file)} spawns only a READ-ONLY git verb (found "${verb}", allowed: ${GIT_READONLY_VERBS.join("/")})`
          );
        }
      }
      // At least one git spawn exists across the surface (ls-remote in source.mjs, log in
      // recovery.mjs) — so this guard is NOT vacuously green over a surface with no git.
      assert.ok(sawAnyGitSpawn, "the import surface DOES spawn git read-only (the boundary is real, not absent)");
    },
  },
];
