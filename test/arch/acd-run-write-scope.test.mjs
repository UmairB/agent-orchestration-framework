// Fitness function: acd-run-write-scope (milestone 19, ADR-001/002 / fitness #2).
//
// The write-scope guard: every filesystem write the run mechanic performs lands
// within the item's runs/ dir; NO writeFile/appendFile/mkdir targets the item record
// doc (SPEC.md/STORY.md/STATE.md/SESSION.md) or its frontmatter — status rollback is
// milestone 20, not here. The path builder is the single write seam.
//
// Source-analysis (call-form, comments discounted) of src/run-store.mjs — mirroring
// the style of acd-board-write-isolation.test.mjs (the stripComments helper, etc.).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const RUN_STORE = new URL("../../src/run-store.mjs", import.meta.url);
const RECORD_DOCS = ["SPEC.md", "STORY.md", "STATE.md", "SESSION.md"];
const WRITE_VERBS = ["writeFile", "appendFile", "mkdir"];

export const archTests = [
  {
    name: "arch/run-write-scope: every store write joins runsDir(...)/runs and none targets a record-doc filename",
    async run() {
      const source = await readFile(RUN_STORE, "utf8");
      const code = stripComments(source);

      // The store references ZERO record-doc filename anywhere (record-doc resolution
      // lives in work.mjs, never the store) — so a write can NEVER target one.
      for (const doc of RECORD_DOCS) {
        assert.ok(
          !code.includes(doc),
          `src/run-store.mjs references no record-doc filename "${doc}" (record-doc resolution is not the store's job)`
        );
      }

      // Every write/append/mkdir call's path argument resolves through the runs/ seam:
      // it joins runsDir(...) OR runRecordPath(...) (which is itself built from runsDir),
      // never a bare item-dir or record-doc path.
      const writeCalls = collectCalls(code, WRITE_VERBS);
      assert.ok(writeCalls.length >= 1, "the store performs at least one fs write (it persists runs)");
      for (const call of writeCalls) {
        const joinsSeam = /runsDir\s*\(/.test(call.firstArg) || /runRecordPath\s*\(/.test(call.firstArg);
        assert.ok(
          joinsSeam,
          `the ${call.verb}(...) write joins the runs/ seam (runsDir/runRecordPath), not a record doc — got: ${call.firstArg}`
        );
      }
    },
  },
  {
    name: "arch/run-write-scope: the run-file path is built by a single seam (runsDir/runRecordPath)",
    async run() {
      const source = await readFile(RUN_STORE, "utf8");
      const code = stripComments(source);

      // runsDir is THE path seam: join(item.dir, "runs"). runRecordPath is the ONLY
      // run-file path builder and it is built FROM runsDir (so milestone 26's <node>/
      // segment slots in as one additive edit there).
      assert.ok(/function\s+runsDir\s*\(/.test(code), "runsDir is defined as the single path seam");
      assert.ok(/function\s+runRecordPath\s*\(/.test(code), "runRecordPath is the single run-file path builder");
      assert.ok(/runRecordPath[\s\S]*?runsDir\s*\(/.test(code), "runRecordPath is built from runsDir (one seam)");

      // No write joins item.dir directly with a non-runs path segment (every path goes
      // through the seam). The only path.join into item.dir is runsDir's join(item.dir, "runs").
      const itemDirJoins = [...code.matchAll(/path\.join\s*\(\s*item\.dir\s*,([^)]*)\)/g)];
      for (const match of itemDirJoins) {
        assert.ok(
          /["']runs["']/.test(match[1]),
          `the only join into item.dir is the runs/ seam — got path.join(item.dir, ${match[1].trim()})`
        );
      }
    },
  },
];

// --- source-analysis helpers (mirroring acd-board-write-isolation) ----------

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Collect each write-verb call with its first argument expression (balanced to the
// first top-level comma or the closing paren).
function collectCalls(code, verbs) {
  const calls = [];
  for (const verb of verbs) {
    const re = new RegExp(`\\b${verb}\\s*\\(`, "g");
    let match;
    while ((match = re.exec(code))) {
      const start = match.index + match[0].length;
      calls.push({ verb, firstArg: firstArgument(code, start) });
    }
  }
  return calls;
}

// Read the first call argument starting at `start` (just after the open paren),
// tracking nesting so a path.join(...) argument is captured whole.
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
