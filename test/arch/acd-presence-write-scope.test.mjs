// Fitness function: acd-presence-write-scope (milestone 23, ADR-002 / fitness #3) —
// the presence write-scope guard, mirroring 22's acd-mesh-write-scope (the
// stripComments + collectCalls/firstArgument source-analysis helpers).
//
// Every presence write the mechanic performs joins the m22-RESERVED
// presenceRecordPath(...) / meshDir(...) seam and routes through the atomic writeText
// seam (19/R2) — NOT a bare writeFile/appendFile; NO write targets an item record doc
// (SPEC.md/STORY.md/STATE.md/SESSION.md) or its frontmatter (record-doc resolution
// lives in work.mjs, never the presence mechanic). The scan covers BOTH the presence
// module (src/mesh-presence.mjs) AND the command (src/commands/mesh-heartbeat.mjs),
// per ARCHITECTURE.md fitness #3.
//
// Per the m03 lesson (a fitness function asserts the PRESENCE of what should exist,
// not only the absence of what shouldn't), each proof pairs a positive assertion (a
// real write IS routed through the seam) with a negative one (no record-doc, no bare
// write) AND a non-vacuous self-check (the detector fires on a real violation).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const PRESENCE_MODULE = new URL("../../src/mesh-presence.mjs", import.meta.url);
const HEARTBEAT_COMMAND = new URL("../../src/commands/mesh-heartbeat.mjs", import.meta.url);
const PRESENCE_SOURCES = [PRESENCE_MODULE, HEARTBEAT_COMMAND];
const RECORD_DOCS = ["SPEC.md", "STORY.md", "STATE.md", "SESSION.md"];
// A bare writeFile/appendFile would bypass the atomic writeText seam (forbidden).
// mkdir is a directory write — its target must still join the partition seam.
const DIRECT_WRITE_VERBS = ["writeFile", "appendFile"];
const SEAM_WRITE_VERBS = ["mkdir", "writeText"];

export const archTests = [
  {
    name: "arch/presence-write-scope: the presence mechanic references zero record-doc filename (record-doc resolution is not its job)",
    async run() {
      for (const moduleUrl of PRESENCE_SOURCES) {
        const code = stripComments(await readFile(moduleUrl, "utf8"));
        for (const doc of RECORD_DOCS) {
          assert.ok(
            !code.includes(doc),
            `${moduleUrl.pathname.split("/").pop()} references no record-doc filename "${doc}" — a presence write can never target one`
          );
        }
      }
      // Self-check (non-vacuous): the record-doc scan DOES fire on a real reference.
      assert.ok(
        stripComments('await writeText(path.join(dir, "STATE.md"), body);').includes("STATE.md"),
        "the record-doc scan catches a real STATE.md reference"
      );
    },
  },
  {
    name: "arch/presence-write-scope: presence writes route through the atomic writeText seam, never a bare writeFile/appendFile",
    async run() {
      // The presence mechanic persists via writeText (the atomic temp+rename seam) —
      // it must call writeText AND must not call a bare writeFile/appendFile.
      let sawWriteText = false;
      for (const moduleUrl of PRESENCE_SOURCES) {
        const code = stripComments(await readFile(moduleUrl, "utf8"));
        if (/\bwriteText\s*\(/.test(code)) sawWriteText = true;
        const bareWrites = collectCalls(code, DIRECT_WRITE_VERBS);
        assert.equal(
          bareWrites.length,
          0,
          `${moduleUrl.pathname.split("/").pop()} calls no bare ${DIRECT_WRITE_VERBS.join("/")} (every persist routes through writeText) — got: ${bareWrites.map((c) => c.verb).join(", ")}`
        );
      }
      // Non-vacuous: at least one presence source DID route a write through writeText
      // (src/mesh-presence.mjs's publishPresenceRecord) — not an empty observed set.
      assert.ok(sawWriteText, "the presence mechanic persists via the atomic writeText seam (publishPresenceRecord)");
      // Self-check (non-vacuous): the bare-write detector DOES fire on a real writeFile.
      assert.equal(
        collectCalls(stripComments('await writeFile(presencePath, body);'), DIRECT_WRITE_VERBS).length,
        1,
        "the bare-write detector catches a real writeFile call"
      );
    },
  },
  {
    name: "arch/presence-write-scope: every presence write joins the reserved presenceRecordPath/meshDir partition seam",
    async run() {
      // At least one real write must be observed AND every observed write must join the
      // partition seam — the positive (a write exists) + negative (none escape) pair.
      const writeCalls = [];
      for (const moduleUrl of PRESENCE_SOURCES) {
        const code = stripComments(await readFile(moduleUrl, "utf8"));
        writeCalls.push(...collectCalls(code, SEAM_WRITE_VERBS));
      }
      assert.ok(writeCalls.length >= 1, "the presence mechanic performs at least one fs write (it persists presence records)");
      for (const call of writeCalls) {
        const joinsSeam = /presenceRecordPath\s*\(/.test(call.firstArg) || /meshDir\s*\(/.test(call.firstArg);
        assert.ok(
          joinsSeam,
          `the ${call.verb}(...) write joins the partition seam (presenceRecordPath/meshDir), not a record doc — got: ${call.firstArg}`
        );
      }
      // Self-check (non-vacuous): the seam check DOES reject a write that joins a
      // non-partition path (a bare workDir join would not match presenceRecordPath/meshDir).
      const offending = collectCalls(stripComments('await writeText(path.join(workDir, "loose.json"), body);'), SEAM_WRITE_VERBS);
      assert.equal(offending.length, 1, "the detector observes the off-seam write");
      assert.ok(
        !(/presenceRecordPath\s*\(/.test(offending[0].firstArg) || /meshDir\s*\(/.test(offending[0].firstArg)),
        "the seam check rejects a write that does not join presenceRecordPath/meshDir"
      );
    },
  },
];

// --- source-analysis helpers (mirroring acd-mesh-write-scope) ----------------

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

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
