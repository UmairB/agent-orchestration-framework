// Fitness function: acd-enroll-git-argv-no-shell (milestone 24, ADR-003/ADR-004 /
// structural fitness — the architect's; the 13/ADR-002 read-only-source shell-less
// git-argv idiom applied to git-remote provisioning). "git-remote provisioning uses the
// read-only-source shell-less git-argv idiom."
//
//   "git remote access is provisioned alongside admission (PRD A3) and de-provisioned at
//    revoke (ADR-4). Every `git` spawn in the enrollment path is the shell-less argv form
//    spawnSync('git', [<verb>, …]) — NEVER a shell string / template / exec( (a shell
//    word-splits a url on Windows, the 13/ADR-002 hazard), and it configures the joining
//    node's OWN clone (`git remote add`/`remove`), making no git WRITE verb against a
//    FOREIGN source tree it does not own. This is the mesh-sync.mjs git(cwd, args)
//    precedent (spawnSync('git', args), never a shell)."
//
// The invariant this gate enforces is PURELY STRUCTURAL: the SHAPE of the git spawn (argv,
// never shell). The runtime enforcement (a revoked credential is rejected) is the
// security-owned acd-relay-auth-gate-checked; the observable (a joined node has the remote
// configured) is a story-02 task .feature. This gate owns only the shell-less argv shape.
//
// Modelled on acd-migrate-read-only-source / acd-import-read-only-source (the
// gitSpawnArgvTokens extractor, the SHELL_STRING_SPAWN + EXEC_SHELL guards). Each proof
// carries an m03 non-vacuous self-check (the matchers demonstrably fire on the forbidden
// template/exec forms).
//
// State: RED until src/commands/mesh-join.mjs + src/commands/mesh-revoke.mjs exist —
// readFile rejects on an absent module (module-not-found), the RED-until-built discipline.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const JOIN_COMMAND = path.join(repoRoot, "src", "commands", "mesh-join.mjs");
const REVOKE_COMMAND = path.join(repoRoot, "src", "commands", "mesh-revoke.mjs");
const ENROLL_GIT_SOURCES = [JOIN_COMMAND, REVOKE_COMMAND];

// Keep STRING literals (to read argv token strings) but drop comments.
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Strip comments AND strings — for the exec-shell live-code matcher (a verb inside a
// message string must not trip it).
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

// Pull each `git` spawn's verb tokens out of code that retains strings (the
// acd-migrate-read-only-source extractor).
function gitSpawnArgvTokens(codeWithStrings) {
  const tokens = [];
  const re = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*["']git["']\s*,\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(codeWithStrings)) !== null) {
    for (const lit of m[1].matchAll(/["']([^"']+)["']/g)) tokens.push(lit[1]);
  }
  return tokens;
}

// A `git` spawn at all (argv OR any other form) — used to assert that IF the module spawns
// git, it does so through the argv form and not a shell string.
const GIT_SPAWN_ANY = /\b(?:spawnSync|spawn|execFileSync|execFile|exec|execSync)\s*\(\s*(?:["'`][^"'`]*\bgit\b|["']git["'])/;
// A constructed-command-STRING spawn / an exec( shell form — forbidden outright (a shell
// word-splits a url on Windows).
const SHELL_STRING_SPAWN = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*(?:`[^`]*`|["'][^"']*\s[^"']*["']|[A-Za-z0-9_.]+\s*\+)/;
const EXEC_SHELL = /\b(?:exec|execSync)\s*\(/;

export const archTests = [
  {
    name: "arch/enroll-git-argv-no-shell: every `git` spawn in the enrollment path (mesh-join + mesh-revoke) is the shell-less spawnSync('git', [ … ]) argv form — no shell string, no exec(",
    run: async () => {
      let sawAnyGitSpawn = false;
      for (const moduleUrl of ENROLL_GIT_SOURCES) {
        const raw = await readFile(moduleUrl, "utf8");
        const withStrings = stripCommentsOnly(raw);
        const noStrings = stripCommentsAndStrings(raw);
        const name = path.basename(moduleUrl);

        // No shell string spawn / no exec( — outright forbidden.
        assert.ok(!SHELL_STRING_SPAWN.test(withStrings), `${name} constructs no shell-string spawn (a shell word-splits a url on Windows — 13/ADR-002)`);
        assert.ok(!EXEC_SHELL.test(noStrings), `${name} uses no exec(/execSync( (a shell string)`);

        // If it spawns git at all, the argv extractor must find the verbs (the argv form);
        // a git spawn that the argv extractor CANNOT read is a non-argv (shell) form. The
        // git-spawn detection runs on the STRINGS-RETAINED source (withStrings) — the
        // `spawnSync("git", …)` literal is what GIT_SPAWN_ANY matches, and it is stripped
        // out of the comment-AND-string-stripped noStrings (the acd-import-read-only-source
        // sibling detects the same way, off stripCommentsOnly).
        if (GIT_SPAWN_ANY.test(withStrings)) {
          sawAnyGitSpawn = true;
          const verbs = gitSpawnArgvTokens(withStrings);
          assert.ok(
            verbs.length > 0,
            `${name} spawns git through the argv form spawnSync("git", [ … ]) — the argv extractor reads its verb tokens (a git spawn the extractor cannot read is a forbidden shell form)`
          );
        }
      }
      // At least one enrollment module DOES provision git-remote (the mechanic is real, not
      // absent — 22/R6: "provisioned alongside" must RUN, not be a README line).
      assert.ok(sawAnyGitSpawn, "the enrollment path DOES spawn git (git-remote provisioning/de-provisioning is a real mechanic, not a doc step)");

      // Self-checks (non-vacuous): the matchers DO fire on the forbidden forms + the
      // extractor reads a real argv.
      assert.deepEqual(gitSpawnArgvTokens('spawnSync("git", ["remote", "add", name, url])'), ["remote", "add"], "the extractor reads a real remote-add argv (the string interpolations name/url are non-literal, correctly excluded)");
      assert.ok(SHELL_STRING_SPAWN.test('spawnSync(`git remote add ${name} ${url}`)'), "the guard catches a template command string");
      assert.ok(EXEC_SHELL.test('exec("git remote add origin " + url)'), "the guard catches exec(");
    },
  },
  {
    name: "arch/enroll-git-argv-no-shell: the enrollment path makes no git WRITE verb against a foreign source tree — it configures the joining node's OWN clone (remote add/remove), the read-only-source discipline",
    run: async () => {
      // The ONLY git verbs the enrollment path uses are the remote-configuration verbs on
      // the node's OWN clone: `remote` (add/remove/set-url). It must NOT commit/push/clone
      // against a foreign tree it does not own (that is a mutation of another node's repo —
      // the 13/ADR-002 read-only-source boundary). `remote` configures THIS clone's config,
      // not a foreign tree.
      const FOREIGN_WRITE_VERBS = ["commit", "push", "merge", "rebase", "reset", "checkout", "clone", "fetch", "pull", "stash", "apply", "am", "tag"];
      const collectedVerbs = [];
      for (const moduleUrl of ENROLL_GIT_SOURCES) {
        const withStrings = stripCommentsOnly(await readFile(moduleUrl, "utf8"));
        collectedVerbs.push(...gitSpawnArgvTokens(withStrings));
      }
      for (const verb of collectedVerbs) {
        assert.ok(
          !FOREIGN_WRITE_VERBS.includes(verb),
          `the enrollment path uses no foreign-tree git write verb (found "${verb}") — it only configures the joining node's OWN clone (git remote add/remove), the read-only-source discipline`
        );
      }
      // Self-check (non-vacuous): the extractor + the forbidden-verb set DO flag a planted
      // push, and DO NOT flag the accepted `remote` verb.
      const planted = gitSpawnArgvTokens('spawnSync("git", ["push", "origin", "main"])');
      assert.ok(planted.some((v) => FOREIGN_WRITE_VERBS.includes(v)), "the detector flags a planted foreign-tree push");
      const accepted = gitSpawnArgvTokens('spawnSync("git", ["remote", "add", name, url])');
      assert.ok(!accepted.some((v) => FOREIGN_WRITE_VERBS.includes(v)), "the detector does NOT flag the accepted remote-add (own-clone config)");
    },
  },
];
