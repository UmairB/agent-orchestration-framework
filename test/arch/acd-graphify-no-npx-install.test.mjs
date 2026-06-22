// Fitness function for milestone 09 / ADR-006 inv. 6 (no npx install of graphify;
// the load-bearing npx installer untouched; ADR-004 Option B):
// "No aof code provisions graphify via npx, and `src/frameworks.mjs` gains no
//  Python/uv/pipx lane in this milestone — the npx installer stays npx-only."
//
// This is a REGRESSION guard (GREEN now): frameworks.mjs is npx-only today. It
// must STAY so — Option B provisions graphify assets-only + a doctor check, never
// by generalizing the installer.
//
// Two proofs (call-form, comments/strings discounted):
//   (a) src/frameworks.mjs carries NO `graphify`/`graphifyy`/`uv`/`pipx`/
//       `pip install` reference, and its spawn argv[0] stays the npx literal — the
//       installer is structurally incapable of installing a Python tool;
//   (b) no module in the codebase spawns `npx graphifyy` (no aof path npx-installs
//       graphify under any name).
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(repoRoot, "src");
const FRAMEWORKS = path.join(srcDir, "frameworks.mjs");

// Strip line + block comments AND string literals so the grep sees only live code.
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

// Strip ONLY comments (keep string literals) — for asserting on the literal argv
// the installer pushes (the `"npx"` spawn target is a string literal we WANT to
// see, and the forbidden `graphify`/`pip install` could hide in a string too).
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function collectMjs(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectMjs(full)));
    } else if (entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

export const archTests = [
  {
    name: "arch/ADR-006 inv.6: src/frameworks.mjs carries NO graphify/uv/pipx/pip-install reference (no Python lane)",
    run: async () => {
      // Comments stripped, string literals KEPT — a `graphify`/`pip install` ref
      // would be a real provisioning intent whether in code or a string argv.
      const text = stripComments(await readFile(FRAMEWORKS, "utf8"));
      assert.ok(!/graphifyy?/i.test(text), "frameworks.mjs references neither graphify nor graphifyy");
      assert.ok(!/\buv\s+tool\b/i.test(text), "frameworks.mjs has no `uv tool` lane");
      assert.ok(!/\bpipx\b/i.test(text), "frameworks.mjs has no pipx lane");
      assert.ok(!/\bpip\s+install\b/i.test(text), "frameworks.mjs has no `pip install` lane");
    },
  },
  {
    name: "arch/ADR-006 inv.6: the framework installer's spawn argv[0] stays the `npx` literal (npx-only)",
    run: async () => {
      const text = stripComments(await readFile(FRAMEWORKS, "utf8"));
      // The plan's argv begins with the npx literal — the installer is npx-only.
      assert.ok(
        /argv\s*=\s*\[\s*["']npx["']/.test(text),
        "planFrameworkInstall builds an argv starting with the `npx` literal"
      );
      // And there is no non-npx executable in any argv[0] position (uv/pipx/pip/
      // python would be a generalized installer — forbidden this milestone).
      assert.ok(!/\[\s*["'](uv|pipx|pip|python3?)["']/.test(text), "no argv[0] is a Python provisioner (uv/pipx/pip/python)");
    },
  },
  {
    name: "arch/ADR-006 inv.6: no module in the codebase spawns `npx graphifyy` (no npx install of graphify under any name)",
    run: async () => {
      const files = await collectMjs(srcDir);
      assert.ok(files.length > 0, "found src/*.mjs files to scan");
      const offenders = [];
      for (const file of files) {
        // Code AND strings: an `npx graphify` could be a spawn-arg string literal.
        const raw = stripComments(await readFile(file, "utf8"));
        // The pairing we forbid: `npx` adjacent to `graphify`/`graphifyy` (an npx
        // install/exec of graphify), in either argv order.
        if (/npx[\s\S]{0,40}graphifyy?/i.test(raw) || /graphifyy?[\s\S]{0,40}npx/i.test(raw)) {
          offenders.push(path.relative(repoRoot, file));
        }
      }
      assert.deepEqual(offenders, [], `no module npx-installs/execs graphify; offenders: ${offenders.join(", ")}`);
    },
  },
];
