// Fitness function for milestone 12 / ADR-005 inv. 2 (AOF_GLOBAL_HOME honoured /
// no hardcoded homedir; ADR-001):
// "The store root derives from defaultGlobalWorkspaceDir (so AOF_GLOBAL_HOME
//  relocates the WHOLE store); no os.homedir() call and no `.aof` string literal
//  appears in the store/provision code (src/tool-store.mjs +
//  src/commands/project-provision.mjs)."
//
// paths.mjs legitimately uses os.homedir() in defaultGlobalWorkspaceDir — that is
// the ONE expression the relocation flows through, so the guard is SCOPED to the
// two files ADR-005 inv. 2 names (the store + provision code), not paths.mjs.
//
// Two proofs:
//   (a) POSITIVE behaviour — toolStoreRoot({ AOF_GLOBAL_HOME }) and
//       toolVersionDir(...) relocate the root UNDER the override (a couple of
//       override values, so it is not a coincidence of one path);
//   (b) NEGATIVE source-grep — neither tool-store.mjs nor project-provision.mjs
//       contains a live `os.homedir(` call (comments + strings discounted) nor a
//       live `.aof` string literal (comments discounted, strings KEPT — the literal
//       would hide in a string).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toolStoreRoot, toolVersionDir } from "../../src/paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(repoRoot, "src");

// The TWO files ADR-005 inv. 2 scopes the guard to (the store + provision code).
const TOOL_STORE = path.join(srcDir, "tool-store.mjs");
const PROJECT_PROVISION = path.join(srcDir, "commands", "project-provision.mjs");

// Strip line + block comments AND string literals — for the os.homedir( call grep
// (a call form is live code; a homedir mention inside a comment/string is not a
// call). Mirrors acd-graphify-no-npx-install's stripCommentsAndStrings.
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

// Strip ONLY comments (keep string literals) — for the `.aof` literal grep: a
// hardcoded ".aof" would be a string literal we WANT to catch.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export const archTests = [
  {
    name: "arch/ADR-005 inv.2: toolStoreRoot / toolVersionDir relocate the store root UNDER AOF_GLOBAL_HOME (the root derives from defaultGlobalWorkspaceDir)",
    run: async () => {
      // A couple of distinct override values — relocation is real, not a one-path
      // coincidence. Each store root is exactly <override>/tools and each version
      // dir is exactly <root>/<name>/<version>.
      for (const override of [
        path.join(os.tmpdir(), "aof-home-A"),
        path.join(os.tmpdir(), "aof-home-B-nested", "deeper"),
      ]) {
        const env = { AOF_GLOBAL_HOME: override };
        const root = toolStoreRoot(env);
        assert.equal(root, path.join(override, "tools"), `the store root is <AOF_GLOBAL_HOME>/tools for ${override}`);
        assert.ok(root.startsWith(override), "the store root is UNDER the override home");

        const versionDir = toolVersionDir("graphify", "0.8.44", env);
        assert.equal(
          versionDir,
          path.join(override, "tools", "graphify", "0.8.44"),
          "the version dir is <AOF_GLOBAL_HOME>/tools/<name>/<version>"
        );
        assert.ok(versionDir.startsWith(root), "the version dir is UNDER the relocated store root");
      }

      // And two DIFFERENT overrides relocate to DIFFERENT roots (so the override is
      // truly the source, not a constant).
      const rootA = toolStoreRoot({ AOF_GLOBAL_HOME: path.join(os.tmpdir(), "aof-distinct-A") });
      const rootB = toolStoreRoot({ AOF_GLOBAL_HOME: path.join(os.tmpdir(), "aof-distinct-B") });
      assert.notEqual(rootA, rootB, "distinct AOF_GLOBAL_HOME values relocate to distinct store roots");
    },
  },
  {
    name: "arch/ADR-005 inv.2: src/tool-store.mjs + src/commands/project-provision.mjs contain NO live os.homedir( call (comments/strings discounted)",
    run: async () => {
      for (const file of [TOOL_STORE, PROJECT_PROVISION]) {
        const live = stripCommentsAndStrings(await readFile(file, "utf8"));
        assert.ok(
          !/\bos\s*\.\s*homedir\s*\(/.test(live),
          `${path.relative(repoRoot, file)} makes no os.homedir() call (the root derives from defaultGlobalWorkspaceDir)`
        );
        // No `homedir(` under any import alias either (a `homedir()` direct call).
        assert.ok(
          !/\bhomedir\s*\(/.test(live),
          `${path.relative(repoRoot, file)} makes no homedir() call under any alias`
        );
      }
    },
  },
  {
    name: "arch/ADR-005 inv.2: src/tool-store.mjs + src/commands/project-provision.mjs contain NO hardcoded `.aof` string literal (comments discounted, strings kept)",
    run: async () => {
      for (const file of [TOOL_STORE, PROJECT_PROVISION]) {
        const text = stripComments(await readFile(file, "utf8"));
        assert.ok(
          !/['"`]\.aof['"`]/.test(text),
          `${path.relative(repoRoot, file)} carries no bare ".aof" string literal (the home is derived, not hardcoded)`
        );
        // Also catch a ".aof" embedded in a larger path literal (e.g. "~/.aof",
        // ".aof/tools") — any string literal containing the .aof segment.
        assert.ok(
          !/['"`][^'"`]*[\\/]\.aof([\\/][^'"`]*)?['"`]/.test(text),
          `${path.relative(repoRoot, file)} carries no path literal containing a hardcoded ".aof" segment`
        );
      }
    },
  },
];
