// Fitness function: acd-desktop-trusted-spawn (milestone 36 / ADR-004, fitness #4) —
// "The supervisor resolves the `aof` binary it spawns by an ABSOLUTE, co-located path
//  (the sibling `aof(.exe)` in the SAME install dir the desktop app was installed
//  into — $HOME/.aof/bin, m28/ADR-006), NEVER a bare-PATH `aof` lookup. Co-location
//  removes the PATH-order hijack ambiguity even aof's own tailscale-spawn precedent
//  (src/mesh-fabric.mjs, PATH-first-then-pinned-fallback) cannot avoid — both binaries
//  install together, so the sibling path is unambiguous. Spawns are shell-less argv
//  (never a `cmd /c` / shell string)."
//
// GUARD-IF-PRESENT (refine, pre-build): a clean no-op while `app/desktop/` is absent;
// a hard assertion the moment the crate lands. Green now, RED-if-violated once built.
//
// Proof, over every `app/desktop/**/*.rs` (Rust comments stripped):
//  1. NO spawn of a bare `"aof"` / `"aof.exe"` program name (which would trigger a
//     PATH search) — `Command::new("aof")` / `Command::new("aof.exe")` are forbidden.
//     The program passed to the spawn is a RESOLVED path variable, not a bare literal.
//  2. NO shell-string spawn — no `Command::new("cmd")` / `"sh"` / `"powershell"` with
//     an `aof …` argument string (shell-metacharacter injection surface).
//  3. Self-check (m03 non-vacuous): a planted `Command::new("aof")` and a planted
//     `Command::new("cmd").args(["/C", ...])` trip the SAME detector; a resolved
//     `Command::new(aof_path)` on an absolute co-located path does NOT.
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DESKTOP_DIR = path.join(repoRoot, "app", "desktop");

// A bare-PATH spawn of the aof binary (the hijack risk), or a shell-string spawn.
const FORBIDDEN_SPAWN_FORMS = [
  // Command::new("aof") / Command::new("aof.exe") — a bare program name = PATH search.
  /Command::new\(\s*["']aof(?:\.exe)?["']\s*\)/,
  // a shell-string spawn (cmd/sh/powershell driving an aof command) — injection surface.
  /Command::new\(\s*["'](?:cmd|cmd\.exe|sh|bash|powershell|powershell\.exe|pwsh)["']\s*\)/,
];

function stripRustComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function detectSpawn(source) {
  const stripped = stripRustComments(source);
  return FORBIDDEN_SPAWN_FORMS.filter((re) => re.test(stripped)).map((re) => re.source);
}

async function dirExists(dir) {
  try { return (await stat(dir)).isDirectory(); } catch { return false; }
}

async function collectRustFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "target") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectRustFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".rs")) out.push(full);
  }
  return out;
}

export const archTests = [
  {
    name: "arch/36 ADR-004 (acd-desktop-trusted-spawn): the aof binary is spawned by a resolved absolute co-located path, never bare-PATH or a shell string (guard-if-present)",
    run: async () => {
      if (!(await dirExists(DESKTOP_DIR))) {
        assert.equal(await dirExists(DESKTOP_DIR), false, "app/desktop/ absent (pre-build); armed at build by story 00");
        return;
      }
      const files = await collectRustFiles(DESKTOP_DIR);
      assert.ok(files.length > 0, "the Rust subtree exists and was scanned (non-vacuous)");
      const offenders = [];
      for (const file of files) {
        const violations = detectSpawn(await readFile(file, "utf8"));
        if (violations.length > 0) offenders.push({ file: path.relative(repoRoot, file), violations });
      }
      assert.deepEqual(offenders, [], `no bare-PATH / shell-string aof spawn exists, got: ${JSON.stringify(offenders)}`);
    },
  },
  {
    name: "arch/36 ADR-004 (acd-desktop-trusted-spawn): self-check — a planted bare-PATH / shell-string spawn trips the SAME detector; a resolved-path spawn does NOT (non-vacuous)",
    run: async () => {
      // The trusted form: a resolved absolute co-located path variable is not flagged.
      assert.deepEqual(detectSpawn('let p = install_dir.join("aof");\nCommand::new(&p).args(["mesh","status"]);\n'), [], "a resolved co-located path spawn is trusted");

      // The hijack forms are caught.
      assert.ok(detectSpawn('Command::new("aof").args(["mesh","status"]);\n').length > 0, "a planted bare-PATH `aof` spawn trips the detector");
      assert.ok(detectSpawn('Command::new("aof.exe").arg("--version");\n').length > 0, "a planted bare-PATH `aof.exe` spawn trips the detector");
      assert.ok(detectSpawn('Command::new("cmd").args(["/C", "aof mesh status"]);\n').length > 0, "a planted shell-string spawn trips the detector");
      assert.ok(detectSpawn('Command::new("powershell").arg("aof mesh ui");\n').length > 0, "a planted powershell-string spawn trips the detector");
    },
  },
];
