// Fitness function: acd-issuance-write-scope (milestone 27 / story 01, ADR-001 /
// fitness #1) — the issuance directive write-scope guard, cloning
// acd-lease-write-scope's stripComments + collectCalls/firstArgument
// source-analysis helpers over src/mesh-issuance.mjs:
//
//   - the issuance mechanic references ZERO record-doc filename (record-doc
//     resolution lives in work.mjs, never here);
//   - every directive write routes through the atomic writeText seam (19/R2) —
//     never a bare writeFile/appendFile;
//   - every write joins the issuanceDirectivePath/meshDir partition seam;
//   - OWN-PATH ONLY: every written issuanceDirectivePath(...) is built with THIS
//     node's own id (the second argument is literally the writer's `ownNodeId`
//     parameter — never a foreign issuer);
//   - withdrawal/fulfilment is a STATE WRITE, never a delete: no unlink/rm of a
//     directive, ever.
//
// Per the m03 lesson (a fitness function asserts the PRESENCE of what should
// exist, not only the absence of what shouldn't), each proof pairs a positive
// assertion with a negative one AND a non-vacuous planted-violation self-check.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ISSUANCE_MODULE = new URL("../../src/mesh-issuance.mjs", import.meta.url);
const RECORD_DOCS = ["SPEC.md", "STORY.md", "STATE.md", "SESSION.md"];
const DIRECT_WRITE_VERBS = ["writeFile", "appendFile"];
const SEAM_WRITE_VERBS = ["mkdir", "writeText"];
const DELETE_VERBS = ["unlink", "unlinkSync", "rm", "rmSync", "rmdir"];
// The own-path form: a written directive path is
// issuanceDirectivePath(workspace, <ownNodeId-shaped>, itemRef) with the second
// argument LITERALLY the writer's own node parameter (issueDirective's
// `ownNodeId`, withdrawDirective's `ownNodeId`) — never a foreign issuer/holder.
const OWN_PATH_RE = /issuanceDirectivePath\s*\(\s*workspace\s*,\s*ownNodeId\s*,\s*[^,()]+\s*\)/;

export const archTests = [
  {
    name: "arch/issuance-write-scope: src/mesh-issuance.mjs references zero record-doc filename (record-doc resolution is not its job)",
    async run() {
      const code = stripComments(await readFile(ISSUANCE_MODULE, "utf8"));
      for (const doc of RECORD_DOCS) {
        assert.ok(
          !code.includes(doc),
          `mesh-issuance.mjs references no record-doc filename "${doc}" — a directive write can never target one`
        );
      }
      // Self-check (non-vacuous): the record-doc scan DOES fire on a real reference.
      assert.ok(
        stripComments('await writeText(path.join(dir, "STATE.md"), body);').includes("STATE.md"),
        "the record-doc scan catches a real STATE.md reference"
      );
    },
  },
  {
    name: "arch/issuance-write-scope: directive writes route through the atomic writeText seam, never a bare writeFile/appendFile",
    async run() {
      const code = stripComments(await readFile(ISSUANCE_MODULE, "utf8"));
      // Positive: the mechanic DOES persist via writeText (issue, withdraw) — not an
      // empty observed set.
      assert.ok(/\bwriteText\s*\(/.test(code), "mesh-issuance.mjs persists via the atomic writeText seam");
      // Negative: no bare write bypasses the seam.
      const bareWrites = collectCalls(code, DIRECT_WRITE_VERBS);
      assert.equal(
        bareWrites.length,
        0,
        `mesh-issuance.mjs calls no bare ${DIRECT_WRITE_VERBS.join("/")} — got: ${bareWrites.map((c) => c.verb).join(", ")}`
      );
      // Self-check (non-vacuous): the bare-write detector DOES fire on a real writeFile.
      assert.equal(
        collectCalls(stripComments("await writeFile(directivePath, body);"), DIRECT_WRITE_VERBS).length,
        1,
        "the bare-write detector catches a real writeFile call"
      );
    },
  },
  {
    name: "arch/issuance-write-scope: every directive write joins the reserved issuanceDirectivePath/meshDir partition seam — and every written path is built with THIS node's own issuer id",
    async run() {
      const code = stripComments(await readFile(ISSUANCE_MODULE, "utf8"));
      const writeCalls = collectCalls(code, SEAM_WRITE_VERBS);
      // Positive: at least one real write is observed (the mechanic persists directives).
      assert.ok(writeCalls.length >= 1, "mesh-issuance.mjs performs at least one fs write (it persists directive records)");
      for (const call of writeCalls) {
        const joinsSeam = /issuanceDirectivePath\s*\(/.test(call.firstArg) || /meshDir\s*\(/.test(call.firstArg);
        assert.ok(
          joinsSeam,
          `the ${call.verb}(...) write joins the partition seam (issuanceDirectivePath/meshDir) — got: ${call.firstArg}`
        );
        // OWN-PATH ONLY (ADR-001.1/ADR-001.3): a write that targets a directive path
        // must build it with the writer's own node parameter — never a foreign issuer.
        if (/issuanceDirectivePath\s*\(/.test(call.firstArg)) {
          assert.ok(
            OWN_PATH_RE.test(call.firstArg),
            `the written directive path is built with THIS node's own issuer id (own-partition writes only) — got: ${call.firstArg}`
          );
        }
      }
      // Self-checks (non-vacuous, the m03 planted violations):
      // (a) the seam check rejects an off-seam write;
      const offSeam = collectCalls(stripComments('await writeText(path.join(workDir, "loose.json"), body);'), SEAM_WRITE_VERBS);
      assert.equal(offSeam.length, 1, "the detector observes the planted off-seam write");
      assert.ok(
        !(/issuanceDirectivePath\s*\(/.test(offSeam[0].firstArg) || /meshDir\s*\(/.test(offSeam[0].firstArg)),
        "the seam check rejects a write that does not join issuanceDirectivePath/meshDir"
      );
      // (b) the own-path check rejects a FOREIGN-path write (a directive's own
      // `issuer` field, or a `target.nodeId`, instead of the writer's own parameter).
      for (const planted of [
        "writeText(issuanceDirectivePath(workspace, directive.issuer, itemRef), body)",
        "writeText(issuanceDirectivePath(workspace, target.nodeId, itemRef), body)",
      ]) {
        const call = collectCalls(stripComments(planted), ["writeText"])[0];
        assert.ok(
          !OWN_PATH_RE.test(call.firstArg),
          `the own-path check rejects the planted foreign write: ${planted}`
        );
      }
      // (c) …and accepts the real own-path form.
      assert.ok(
        OWN_PATH_RE.test("issuanceDirectivePath(workspace, ownNodeId, itemRef)"),
        "the own-path check accepts the own-nodeId form"
      );
    },
  },
  {
    name: "arch/issuance-write-scope: no unlink/rm of a directive — withdrawal/fulfilment are STATE WRITES, never a delete",
    async run() {
      const code = stripComments(await readFile(ISSUANCE_MODULE, "utf8"));
      const deletes = collectCalls(code, DELETE_VERBS);
      assert.equal(
        deletes.length,
        0,
        `mesh-issuance.mjs calls no delete verb (${DELETE_VERBS.join("/")}) — withdrawal is a state write, not a delete; got: ${deletes.map((c) => c.verb).join(", ")}`
      );
      // Positive pairing: the withdraw path DOES write the withdrawn state —
      // asserted over the COMMENT-STRIPPED code (the m26/#6 review lesson: a header
      // comment mentioning "withdrawn" would pass vacuously even if live code never
      // wrote it).
      assert.ok(
        /"withdrawn"/.test(code),
        'the withdraw path writes state "withdrawn" in LIVE code (the state-write half of the invariant)'
      );
      // Self-check (non-vacuous): a planted module whose ONLY "withdrawn" lives in a
      // comment does NOT satisfy the positive — the check reads live code only.
      assert.ok(
        !/"withdrawn"/.test(stripComments('// flips the directive to "withdrawn"\nawait writeText(directivePath, body);')),
        'the "withdrawn" positive rejects a comment-only mention (it must be a live-code write)'
      );
      // Self-check (non-vacuous): the delete detector DOES fire on a real unlink.
      assert.equal(
        collectCalls(stripComments("await unlink(issuanceDirectivePath(workspace, ownNodeId, itemRef));"), DELETE_VERBS).length,
        1,
        "the delete detector catches a real unlink call"
      );
    },
  },
];

// --- source-analysis helpers (cloned from acd-lease-write-scope) ----------

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
