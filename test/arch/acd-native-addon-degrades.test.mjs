// Fitness function #3: acd-native-addon-degrades (milestone 28 / story 00,
// ADR-002).
//
// "node-pty is loaded ONLY via the guarded dynamic import/createRequire inside
//  defaultSpawn that degrades on absence; no module hard-imports a .node at top
//  level, so a missing sidecar never crashes startup."
//
// Comment-stripped import-specifier grep across src/**.mjs: assert (a) no
// top-level import of "node-pty" or any *.node (the only node-pty reference is
// INSIDE defaultSpawn in terminal-ws.mjs), and (b) terminal-ws.mjs's node-pty
// load is wrapped such that a load/spawn failure yields the {type:'error'}
// frame (the try/catch is present).
//
// m03 non-vacuous self-check: the matcher fires on a planted top-level
// `import ptyModule from "node-pty"` and does NOT flag the in-defaultSpawn
// dynamic load.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(repoRoot, "src");
const terminalWsPath = path.join(srcRoot, "terminal-ws.mjs");

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

async function collectMjsFiles(dir) {
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
      out.push(...(await collectMjsFiles(full)));
    } else if (entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

// A top-level (static) import of node-pty or a *.node file — the banned shape.
// Dynamic `await import("node-pty")` / `createRequire(...)("node-pty")` calls
// are NOT static imports and do not match this pattern (they are runtime calls,
// not import/require declarations at the top of the module).
function hasTopLevelNodePtyImport(code) {
  return /^\s*import\s+[^;]*from\s+["']node-pty["']/m.test(code)
    || /^\s*import\s+["']node-pty["']/m.test(code)
    || /^\s*import\s+[^;]*from\s+["'][^"']*\.node["']/m.test(code);
}

// F12 (craft-review, POLARITY): find loadNodePty's ternary and structurally
// determine which branch is guarded by isPackaged() TRUE vs FALSE, rather than
// merely checking that both strings exist ANYWHERE in the function (which an
// inverted ternary — e.g. `!isPackaged() ? createRequire(...) : import(...)` —
// would also satisfy). Returns { trueBranch, falseBranch } as one of
// "createRequire" | "dynamicImport" | null, extracted from the ACTUAL
// condition-then-branch structure of `isPackaged() ? A : B` /
// `!isPackaged() ? A : B`.
function extractLoaderPolarity(fnBody) {
  // Matches `isPackaged() ? <true-branch> : <false-branch>` OR the negated
  // form `!isPackaged() ? <true-branch> : <false-branch>` (which SWAPS which
  // branch actually runs when isPackaged() is true) — captures the negation
  // marker + both branch bodies up to the statement terminator.
  const ternary = /(!?)\s*isPackaged\(\)\s*\?\s*([^:]+?)\s*:\s*([^;]+?);/.exec(fnBody);
  if (!ternary) return { trueBranch: null, falseBranch: null };
  const negated = ternary[1] === "!";
  const branchWhenConditionTrue = ternary[2];
  const branchWhenConditionFalse = ternary[3];
  const classify = (text) => {
    if (/createRequire\(process\.execPath\)/.test(text)) return "createRequire";
    if (/import\(\s*["']node-pty["']\s*\)/.test(text)) return "dynamicImport";
    return null;
  };
  // The branch that actually executes when isPackaged() itself is TRUE is the
  // condition-true branch UNLESS the ternary's test is negated (!isPackaged()),
  // in which case negation swaps it to the condition-FALSE branch.
  const trueBranch = classify(negated ? branchWhenConditionFalse : branchWhenConditionTrue);
  const falseBranch = classify(negated ? branchWhenConditionTrue : branchWhenConditionFalse);
  return { trueBranch, falseBranch };
}

export const archTests = [
  {
    name: "arch/ADR-002: no src/**.mjs module top-level-imports \"node-pty\" or a *.node file",
    run: async () => {
      const files = await collectMjsFiles(srcRoot);
      const offenders = [];
      for (const file of files) {
        const code = stripComments(await readFile(file, "utf8"));
        if (hasTopLevelNodePtyImport(code)) {
          offenders.push(path.relative(repoRoot, file));
        }
      }
      assert.deepEqual(offenders, [], `no module top-level-imports node-pty / a .node file: ${JSON.stringify(offenders)}`);
    },
  },
  {
    name: "arch/ADR-002: the only node-pty reference lives inside terminal-ws.mjs's defaultSpawn (createRequire under SEA / dynamic import in dev)",
    run: async () => {
      const files = await collectMjsFiles(srcRoot);
      const referencing = [];
      for (const file of files) {
        const code = stripComments(await readFile(file, "utf8"));
        if (/node-pty/.test(code)) referencing.push(path.relative(repoRoot, file).split(path.sep).join("/"));
      }
      assert.deepEqual(referencing, ["src/terminal-ws.mjs"], "only terminal-ws.mjs references node-pty anywhere in src/");

      const code = stripComments(await readFile(terminalWsPath, "utf8"));
      // Both branches present: the SEA createRequire path and the dev dynamic
      // import — both live inside loadNodePty(), the loader defaultSpawn (and
      // the injectable createTerminalSpawn factory) calls; neither is hoisted
      // to a top-level import.
      assert.ok(/createRequire\(process\.execPath\)\(\s*["']node-pty["']\s*\)/.test(code), "the SEA branch resolves node-pty via createRequire(process.execPath)");
      assert.ok(/import\(\s*["']node-pty["']\s*\)/.test(code), "the dev branch keeps the dynamic import(\"node-pty\") call");
      const fnStart = code.indexOf("function loadNodePty");
      assert.ok(fnStart !== -1, "loadNodePty is defined");
      const fnEnd = code.indexOf("\n}", fnStart);
      const fnBody = code.slice(fnStart, fnEnd === -1 ? undefined : fnEnd + 2);
      assert.ok(/node-pty/.test(fnBody), "the node-pty reference is inside loadNodePty's body");
      // defaultSpawn (and the injectable factory) call the loader; the addon
      // reference is reached only through that call, never a top-level import.
      assert.ok(/loadNodePty\s*\(\s*\)/.test(code), "defaultSpawn calls loadNodePty()");

      // F12 (craft-review, POLARITY): structurally assert WHICH branch is
      // which, not merely that both strings exist — an inverted ternary
      // (`!isPackaged() ? createRequire(...) : import(...)`) would satisfy the
      // two asserts above but wire the branches backwards.
      const polarity = extractLoaderPolarity(fnBody);
      assert.equal(polarity.trueBranch, "createRequire", "when isPackaged() is TRUE (a SEA), the loader resolves via createRequire(process.execPath)");
      assert.equal(polarity.falseBranch, "dynamicImport", "when isPackaged() is FALSE (dev), the loader resolves via the dynamic import(\"node-pty\")");
    },
  },
  {
    name: "arch/ADR-002: a defaultSpawn/load failure is caught and surfaces the {type:'error'} control-frame",
    run: async () => {
      const code = stripComments(await readFile(terminalWsPath, "utf8"));
      // The handleConnection spawn call is wrapped in try/catch, surfacing
      // {type:'error', message:...} on failure (covers both a spawn() call that
      // rejects due to defaultSpawn's node-pty load throwing, and a post-load
      // spawn failure — the SAME catch, RESEARCH §2 :166-175).
      assert.ok(/try\s*\{[^]*?term\s*=\s*await\s+spawn\(/.test(code), "the spawn() call (which invokes defaultSpawn, including the node-pty load) is inside a try block");
      assert.ok(/catch\s*\(error\)\s*\{[^]*?type:\s*["']error["']/.test(code), "a spawn/load failure's catch block sends a {type:'error'} control-frame");
    },
  },
  {
    name: "arch/ADR-002 (m03 non-vacuous self-check): the matcher fires on a planted top-level node-pty import and does NOT flag the in-defaultSpawn dynamic load",
    run: async () => {
      const violatingCode = `
        import ptyModule from "node-pty";
        export function useIt() { return ptyModule.spawn; }
      `;
      assert.ok(hasTopLevelNodePtyImport(stripComments(violatingCode)), "self-check: the matcher FIRES on a planted top-level node-pty import");

      const legitCode = `
        async function defaultSpawn(bin, args, options) {
          const pty = isPackaged() ? createRequire(process.execPath)("node-pty") : await import("node-pty");
          return pty.spawn(bin, args, options);
        }
      `;
      assert.ok(!hasTopLevelNodePtyImport(stripComments(legitCode)), "self-check: the matcher does NOT flag the in-defaultSpawn dynamic load / createRequire call");
    },
  },
  {
    name: "arch/ADR-002 (F12 self-check): the POLARITY matcher fires (fails the assert) on an INVERTED ternary and passes the real, correctly-polarized loadNodePty",
    run: async () => {
      // The exact regression F12 names: negating the isPackaged() test swaps
      // which mechanism runs under a SEA vs dev WITHOUT changing which two
      // strings are present in the function — the two "both strings exist"
      // asserts above would pass this unchanged; only the polarity check catches it.
      const invertedBody = `
        function loadNodePty() {
          return !isPackaged() ? createRequire(process.execPath)("node-pty") : import("node-pty");
        }
      `;
      const invertedPolarity = extractLoaderPolarity(invertedBody);
      assert.equal(invertedPolarity.trueBranch, "dynamicImport", "self-check: an inverted ternary is DETECTED as wiring isPackaged()===true to the WRONG (dynamicImport) branch");
      assert.equal(invertedPolarity.falseBranch, "createRequire", "self-check: an inverted ternary is DETECTED as wiring isPackaged()===false to the WRONG (createRequire) branch");
      assert.notEqual(invertedPolarity.trueBranch, "createRequire", "self-check: the inverted form FAILS the real assertion's expectation (trueBranch !== createRequire)");

      // The real, correctly-polarized source passes.
      const realCode = stripComments(await readFile(terminalWsPath, "utf8"));
      const fnStart = realCode.indexOf("function loadNodePty");
      const fnEnd = realCode.indexOf("\n}", fnStart);
      const realBody = realCode.slice(fnStart, fnEnd === -1 ? undefined : fnEnd + 2);
      const realPolarity = extractLoaderPolarity(realBody);
      assert.equal(realPolarity.trueBranch, "createRequire", "self-check: the real loadNodePty passes (isPackaged()===true -> createRequire)");
      assert.equal(realPolarity.falseBranch, "dynamicImport", "self-check: the real loadNodePty passes (isPackaged()===false -> dynamicImport)");
    },
  },
];
