// Fitness function for story 29 (the read-only source boundary, modelled on
// acd-import-read-only-source):
// "migrate reads the source READ-ONLY. The migrate command module constructs NO git
//  write verb (commit/push/checkout/clone/…) against the source and NO fs write into
//  the source tree; the only writes it makes are the SCAFFOLD under work.dir. After a
//  real migrate run the source tree is BYTE-FOR-BYTE unchanged."
//
// Two halves (the import read-only-source idiom applied to migrate):
//   (a) STATIC no-write-against-source: source-grep migrate-folder.mjs — it spawns NO
//       git write verb (the verb extractor reads each `spawn*("git", [<verb>, …])`
//       argv; migrate spawns NO git at all, so the set is empty and CANNOT contain a
//       write verb), uses NO shell-string spawn / exec(, and every fs WRITE call
//       (mkdir/writeFile/rm/…) targets the work.dir scaffold, NEVER the sourceDir.
//   (b) DYNAMIC byte-for-byte: run migrate over a REAL git fixture source and assert
//       the source's HEAD sha + `git status --porcelain` + a file-level tree snapshot
//       are all unchanged (no file created/deleted/modified in the source).
//
// Non-vacuous: (a)'s self-checks prove the matchers fire on the forbidden forms; (b)
// goes RED if migrate ever wrote into / committed against the source.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSyncHardened } from "../support/cli-spawn.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { invoke } from "../../src/command-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATE_COMMAND = path.join(repoRoot, "src", "commands", "migrate-folder.mjs");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// Strip line/block comments AND string/template literals so a documented mention of
// a write verb in prose, or a verb inside an error MESSAGE string, does not trip the
// guard — only LIVE CODE counts (the import read-only-source idiom).
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

// Keep STRING literals (to read argv token strings) but drop comments.
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const GIT_WRITE_VERBS = ["commit", "push", "checkout", "clone", "merge", "rebase", "reset", "add", "rm", "mv", "tag", "branch", "remote", "init", "stash", "apply", "am"];

// Pull each `git` spawn's verb tokens out of code that retains strings.
function gitSpawnArgvTokens(codeWithStrings) {
  const tokens = [];
  const re = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*["']git["']\s*,\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(codeWithStrings)) !== null) {
    for (const lit of m[1].matchAll(/["']([^"']+)["']/g)) tokens.push(lit[1]);
  }
  return tokens;
}

// A constructed-command-STRING spawn / an exec( shell form — forbidden outright.
const SHELL_STRING_SPAWN = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*(?:`[^`]*`|["'][^"']*\s[^"']*["']|[A-Za-z0-9_.]+\s*\+)/;
const EXEC_SHELL = /\b(?:exec|execSync)\s*\(/;

// --- fixtures -------------------------------------------------------------------

async function makeProjectRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-ro-proj-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return { repo, workDir };
}

// A REAL git fixture source: a README overview + a committed history (so a HEAD sha +
// a clean working tree exist for the byte-for-byte assertion). `git` is a CI dep.
async function makeGitSource() {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-ro-src-"));
  await writeFile(path.join(src, "README.md"), `# gizmo\n\nA gizmo service that set out to assemble gizmos.\n`, "utf8");
  await mkdir(path.join(src, "src"), { recursive: true });
  await writeFile(path.join(src, "src", "gizmo.js"), `export const make = () => "gizmo";\n`, "utf8");
  // No shell: shell:true on Windows joins argv into a command line + word-splits a
  // multi-word commit message. Shell-less argv resolves `git` on Windows (recovery's
  // own `git log` spawn proves it) and passes each arg verbatim.
  const git = (args) => spawnSyncHardened("git", ["-C", src, ...args], { encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "fixture@aof.local"]);
  git(["config", "user.name", "aof fixture"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "feat: assemble gizmos"]);
  return src;
}

function treeStateOf(repoDir) {
  const git = (args) => spawnSyncHardened("git", ["-C", repoDir, ...args], { encoding: "utf8" });
  const head = git(["rev-parse", "HEAD"]).stdout.trim();
  const porcelain = git(["status", "--porcelain"]).stdout;
  return { head, porcelain };
}

async function snapshotTree(root) {
  const out = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const s = await stat(full);
        out[path.relative(root, full).split(path.sep).join("/")] = `${s.size}:${s.mtimeMs}`;
      }
    }
  }
  await walk(root);
  return out;
}

export const archTests = [
  {
    name: "arch/migrate-read-only-source: migrate-folder.mjs constructs NO git write verb and NO shell-string/exec spawn against the source",
    run: async () => {
      const withStrings = stripCommentsOnly(await readFile(MIGRATE_COMMAND, "utf8"));
      const verbs = gitSpawnArgvTokens(withStrings);
      for (const verb of verbs) {
        assert.ok(!GIT_WRITE_VERBS.includes(verb), `migrate spawns no git write verb (found "${verb}")`);
      }
      // migrate reads the source through the recovery seam; it spawns NO git itself.
      assert.equal(verbs.length, 0, "migrate-folder.mjs spawns no git directly (it reaches the source only through the read-only recovery seam)");
      const noStrings = stripCommentsAndStrings(await readFile(MIGRATE_COMMAND, "utf8"));
      assert.ok(!EXEC_SHELL.test(noStrings), "migrate uses no exec(/execSync( (a shell string)");
      assert.ok(!SHELL_STRING_SPAWN.test(withStrings), "migrate constructs no shell-string spawn");
      // Self-checks (non-vacuous): the matchers DO fire on the forbidden forms.
      assert.deepEqual(gitSpawnArgvTokens('spawnSync("git", ["commit", "-m", "x"])'), ["commit", "-m", "x"], "extractor reads a forbidden write argv");
      assert.ok(SHELL_STRING_SPAWN.test('spawnSync(`git clone ${repo}`)'), "guard catches a template command string");
      assert.ok(EXEC_SHELL.test('exec("git status")'), "guard catches exec(");
    },
  },
  {
    name: "arch/migrate-read-only-source: every fs WRITE in migrate-folder.mjs targets the work.dir scaffold, never the sourceDir",
    run: async () => {
      const code = stripCommentsAndStrings(await readFile(MIGRATE_COMMAND, "utf8"));
      // Find every write-class fs call and capture its first argument expression.
      const writeRe = /\b(?:mkdir|writeFile|rm|rmdir|unlink|appendFile|cp|copyFile|rename)\s*\(\s*([^,)]+)/g;
      let m;
      let sawWrite = false;
      while ((m = writeRe.exec(code)) !== null) {
        sawWrite = true;
        const arg = m[1];
        // Every write target is derived from milestoneDir / storyDir / tasksDir /
        // workDir — the scaffold paths under work.dir. It must NEVER be derived from a
        // SOURCE-tree path: `sourceDir`, OR the substructure-recovery names that read
        // the source — `picked.dir` (the recovered source milestone dir) and
        // `storiesDir` (the source's own `stories/` dir, read by recoverSourceStories).
        // (NOT `storyDir` — that is a scaffold/destination path joined under
        // milestoneDir/work.dir, a legitimate write target.)
        assert.ok(
          !/\bsourceDir\b/.test(arg) && !/\bpicked\.dir\b/.test(arg) && !/\bstoriesDir\b/.test(arg),
          `a write call's target is derived from the scaffold, not the source (offending arg: ${arg.trim()})`
        );
      }
      assert.ok(sawWrite, "migrate-folder.mjs DOES perform fs writes (the scaffold is real, not absent)");
      // And the only readdir/readFile against the source are READS (read-only seam):
      // they appear in the recover* helpers, never paired with a write of the same path.
      assert.ok(/readdir\s*\(/.test(code) || /readFile\s*\(/.test(code), "migrate reads the source (readdir/readFile) — the read-only source access");
    },
  },
  {
    name: "arch/migrate-read-only-source: after a real migrate the source tree is byte-for-byte unchanged (HEAD + porcelain + file snapshot)",
    run: async () => {
      const { repo } = await makeProjectRepo();
      const src = await makeGitSource();
      try {
        const treeBefore = treeStateOf(src);
        const snapBefore = await snapshotTree(src);
        const ctx = { workspace: await loadWorkspace(repo) };
        const result = await invoke("migrate:folder", { folder: src, migratedAt: "2026-06-30" }, ctx);
        assert.ok(result.migrated, "the migrate produced a managed item");
        const treeAfter = treeStateOf(src);
        const snapAfter = await snapshotTree(src);
        assert.equal(treeAfter.head, treeBefore.head, "the source HEAD sha is unchanged (migrate makes NO commit against the source)");
        assert.equal(treeAfter.porcelain, treeBefore.porcelain, "the source working tree is clean and unchanged (no new/modified/deleted file)");
        assert.deepEqual(snapAfter, snapBefore, "every source file is byte-for-byte unchanged (size + mtime)");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
];
