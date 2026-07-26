// Fitness function: acd-enroll-websocket-only-no-git (milestone 34 correction).
// Mesh enrollment/revocation is websocket + registry state only. It must not provision,
// de-provision, or otherwise mutate git remotes as part of mesh membership.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const JOIN_COMMAND = path.join(repoRoot, "src", "commands", "mesh-join.mjs");
const REVOKE_COMMAND = path.join(repoRoot, "src", "commands", "mesh-revoke.mjs");
const ENROLLMENT_SOURCES = [JOIN_COMMAND, REVOKE_COMMAND];

function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const GIT_SPAWN_ANY = /\b(?:spawnSync|spawn|execFileSync|execFile|exec|execSync)\s*\(\s*(?:["'`][^"'`]*\bgit\b|["']git["'])/;
const GIT_REMOTE_TEXT = /git\s+remote|gitRemote|git-remote|no-grant|no git remote/i;

export const archTests = [
  {
    name: "arch/enroll-websocket-only-no-git: mesh join/revoke do not spawn git or mention git remote provisioning",
    run: async () => {
      for (const moduleUrl of ENROLLMENT_SOURCES) {
        const source = stripCommentsOnly(await readFile(moduleUrl, "utf8"));
        const name = path.basename(moduleUrl);
        assert.ok(!GIT_SPAWN_ANY.test(source), `${name} does not spawn git; mesh membership sync is websocket-only`);
        assert.ok(!GIT_REMOTE_TEXT.test(source), `${name} contains no git-remote provisioning/de-provisioning branch or operator message`);
      }

      assert.ok(GIT_SPAWN_ANY.test('spawnSync("git", ["remote", "add", name, url])'), "the spawn detector catches a planted git argv spawn");
      assert.ok(GIT_SPAWN_ANY.test('exec("git remote add origin " + url)'), "the spawn detector catches a planted shell git command");
      assert.ok(GIT_REMOTE_TEXT.test('no git remote provisioned (no-grant)'), "the text detector catches the stale no-grant operator message");
    },
  },
];