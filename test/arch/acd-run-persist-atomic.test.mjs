// Fitness function: acd-run-persist-atomic (milestone 20, ADR-007 — closing 19/R2a).
//
// Every run-record write in run-store.mjs routes through the atomic src/fs.mjs:writeText
// temp+rename seam; there is NO raw writeFile/appendFile of a runs/<id>.json, and the
// module imports writeText from ./fs.mjs (the previously-missing edge the graph flagged).
// Source-analysis (call-form, comments discounted), mirroring acd-run-write-scope.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const RUN_STORE = new URL("../../src/run-store.mjs", import.meta.url);

export const archTests = [
  {
    name: "arch/run-persist-atomic: run-store imports writeText from ./fs.mjs (the atomic seam)",
    async run() {
      const code = stripComments(await readFile(RUN_STORE, "utf8"));
      assert.ok(
        /import\s*\{[^}]*\bwriteText\b[^}]*\}\s*from\s*["']\.\/fs\.mjs["']/.test(code),
        "run-store.mjs imports writeText from ./fs.mjs"
      );
    },
  },
  {
    name: "arch/run-persist-atomic: persist writes through writeText — no raw writeFile/appendFile of a run record",
    async run() {
      const code = stripComments(await readFile(RUN_STORE, "utf8"));

      // persist routes through writeText
      const persistBody = functionBody(code, "persist");
      assert.ok(persistBody.length > 0, "persist is defined");
      assert.ok(/writeText\s*\(/.test(persistBody), "persist calls writeText");

      // NO raw writeFile/appendFile anywhere in the store (the run-record write is the
      // only fs content-write, and it goes through the atomic seam). mkdir is allowed
      // (it creates the runs/ dir, joining the seam — see acd-run-write-scope).
      assert.ok(!/\bwriteFile\s*\(/.test(code), "no raw writeFile(...) call in run-store.mjs");
      assert.ok(!/\bappendFile\s*\(/.test(code), "no appendFile(...) call in run-store.mjs");

      // writeText is the single content-write site, and it targets the run-record path
      // seam. Capture each call's FULL first argument (balanced — not comma-naive) so a
      // refactor to writeText(localBuiltFromRunRecordPath, …) is still seen correctly.
      const writeTextCalls = [];
      const re = /writeText\s*\(/g;
      let match;
      while ((match = re.exec(code))) {
        writeTextCalls.push(firstArgument(code, match.index + match[0].length));
      }
      assert.ok(writeTextCalls.length >= 1, "writeText is called at least once");
      for (const arg of writeTextCalls) {
        assert.ok(
          /runRecordPath\s*\(/.test(arg),
          `every writeText writes a runRecordPath(...) (the runs/ seam) — got: ${arg}`
        );
      }
    },
  },
];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Read the first call argument starting just after the open paren, tracking nesting
// so a runRecordPath(item, runId) argument is captured whole (not cut at the comma).
function firstArgument(code, start) {
  let depth = 0;
  let out = "";
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === "," && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

function functionBody(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  if (!match) return "";
  const open = source.indexOf("{", match.index);
  let depth = 1;
  let out = "";
  for (let i = open + 1; i < source.length && depth > 0; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    out += ch;
  }
  return out;
}
