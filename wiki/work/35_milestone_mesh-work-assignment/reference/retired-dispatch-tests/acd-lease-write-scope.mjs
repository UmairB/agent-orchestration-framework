// Fitness function: acd-lease-write-scope (milestone 26 / story 01, ADR-003 /
// fitness #6) — the lease write-scope guard, cloning acd-presence-write-scope's
// stripComments + collectCalls/firstArgument source-analysis helpers over
// src/mesh-lease.mjs:
//
//   - the lease mechanic references ZERO record-doc filename (record-doc resolution
//     lives in work.mjs, never here);
//   - every lease write routes through the atomic writeText seam (19/R2) — never a
//     bare writeFile/appendFile;
//   - every write joins the leaseClaimPath/meshDir partition seam;
//   - OWN-PATH ONLY: every written leaseClaimPath(...) is built with THIS node's id
//     (the third argument is literally the writer's `nodeId` parameter — never a
//     foreign holder / claim.nodeId);
//   - release is a STATE WRITE, never a delete: no unlink/rm of a claim, ever.
//
// Per the m03 lesson (a fitness function asserts the PRESENCE of what should exist,
// not only the absence of what shouldn't), each proof pairs a positive assertion
// with a negative one AND a non-vacuous planted-violation self-check.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const LEASE_MODULE = new URL("../../src/mesh-lease.mjs", import.meta.url);
const RECORD_DOCS = ["SPEC.md", "STORY.md", "STATE.md", "SESSION.md"];
const DIRECT_WRITE_VERBS = ["writeFile", "appendFile"];
const SEAM_WRITE_VERBS = ["mkdir", "writeText"];
const DELETE_VERBS = ["unlink", "unlinkSync", "rm", "rmSync", "rmdir"];
// The own-path form: a written claim path is leaseClaimPath(workspace, <ref>, nodeId)
// with the node argument LITERALLY the writer's own `nodeId` parameter.
const OWN_PATH_RE = /leaseClaimPath\s*\(\s*workspace\s*,\s*[^,()]+\s*,\s*nodeId\s*\)/;

export const archTests = [
  {
    name: "arch/lease-write-scope: src/mesh-lease.mjs references zero record-doc filename (record-doc resolution is not its job)",
    async run() {
      const code = stripComments(await readFile(LEASE_MODULE, "utf8"));
      for (const doc of RECORD_DOCS) {
        assert.ok(
          !code.includes(doc),
          `mesh-lease.mjs references no record-doc filename "${doc}" — a lease write can never target one`
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
    name: "arch/lease-write-scope: lease writes route through the atomic writeText seam, never a bare writeFile/appendFile",
    async run() {
      const code = stripComments(await readFile(LEASE_MODULE, "utf8"));
      // Positive: the mechanic DOES persist via writeText (claim write, stand-down,
      // withdrawal) — not an empty observed set.
      assert.ok(/\bwriteText\s*\(/.test(code), "mesh-lease.mjs persists via the atomic writeText seam");
      // Negative: no bare write bypasses the seam.
      const bareWrites = collectCalls(code, DIRECT_WRITE_VERBS);
      assert.equal(
        bareWrites.length,
        0,
        `mesh-lease.mjs calls no bare ${DIRECT_WRITE_VERBS.join("/")} — got: ${bareWrites.map((c) => c.verb).join(", ")}`
      );
      // Self-check (non-vacuous): the bare-write detector DOES fire on a real writeFile.
      assert.equal(
        collectCalls(stripComments("await writeFile(claimPath, body);"), DIRECT_WRITE_VERBS).length,
        1,
        "the bare-write detector catches a real writeFile call"
      );
    },
  },
  {
    name: "arch/lease-write-scope: every lease write joins the reserved leaseClaimPath/meshDir partition seam — and every written claim path is built with THIS node's own id",
    async run() {
      const code = stripComments(await readFile(LEASE_MODULE, "utf8"));
      const writeCalls = collectCalls(code, SEAM_WRITE_VERBS);
      // Positive: at least one real write is observed (the mechanic persists claims).
      assert.ok(writeCalls.length >= 1, "mesh-lease.mjs performs at least one fs write (it persists claim records)");
      for (const call of writeCalls) {
        const joinsSeam = /leaseClaimPath\s*\(/.test(call.firstArg) || /meshDir\s*\(/.test(call.firstArg);
        assert.ok(
          joinsSeam,
          `the ${call.verb}(...) write joins the partition seam (leaseClaimPath/meshDir) — got: ${call.firstArg}`
        );
        // OWN-PATH ONLY (ADR-003.2): a write that targets a claim path must build it
        // with the writer's own `nodeId` parameter — never a foreign holder.
        if (/leaseClaimPath\s*\(/.test(call.firstArg)) {
          assert.ok(
            OWN_PATH_RE.test(call.firstArg),
            `the written claim path is built with THIS node's own \`nodeId\` (own-path writes only) — got: ${call.firstArg}`
          );
        }
      }
      // Self-checks (non-vacuous, the m03 planted violations):
      // (a) the seam check rejects an off-seam write;
      const offSeam = collectCalls(stripComments('await writeText(path.join(workDir, "loose.json"), body);'), SEAM_WRITE_VERBS);
      assert.equal(offSeam.length, 1, "the detector observes the planted off-seam write");
      assert.ok(
        !(/leaseClaimPath\s*\(/.test(offSeam[0].firstArg) || /meshDir\s*\(/.test(offSeam[0].firstArg)),
        "the seam check rejects a write that does not join leaseClaimPath/meshDir"
      );
      // (b) the own-path check rejects a FOREIGN-path write (a holder's / a claim
      // record's node id instead of the writer's own parameter).
      for (const planted of [
        "writeText(leaseClaimPath(workspace, itemRef, claim.nodeId), body)",
        "writeText(leaseClaimPath(workspace, itemRef, holder), body)",
      ]) {
        const call = collectCalls(stripComments(planted), ["writeText"])[0];
        assert.ok(
          !OWN_PATH_RE.test(call.firstArg),
          `the own-path check rejects the planted foreign write: ${planted}`
        );
      }
      // (c) …and accepts the real own-path form.
      assert.ok(
        OWN_PATH_RE.test("leaseClaimPath(workspace, claim.itemRef, nodeId)"),
        "the own-path check accepts the own-nodeId form"
      );
    },
  },
  {
    name: "arch/lease-write-scope: no unlink/rm of a claim — release/stand-down/withdrawal are STATE WRITES, never a delete",
    async run() {
      const code = stripComments(await readFile(LEASE_MODULE, "utf8"));
      const deletes = collectCalls(code, DELETE_VERBS);
      assert.equal(
        deletes.length,
        0,
        `mesh-lease.mjs calls no delete verb (${DELETE_VERBS.join("/")}) — release is a state write, not a delete; got: ${deletes.map((c) => c.verb).join(", ")}`
      );
      // Positive pairing: the release path DOES write the released state — asserted
      // over the COMMENT-STRIPPED code (review MUST-FIX 2: the module's own header
      // comments mention "released", so a raw-file grep would pass vacuously even
      // if the live code never wrote it).
      assert.ok(
        /"released"/.test(code),
        'the release path writes state "released" in LIVE code (the state-write half of the invariant)'
      );
      // Self-check (non-vacuous): a planted module whose ONLY "released" lives in a
      // comment does NOT satisfy the positive — the check reads live code only.
      assert.ok(
        !/"released"/.test(stripComments('// flips the claim to "released"\nawait writeText(claimPath, body);')),
        'the "released" positive rejects a comment-only mention (it must be a live-code write)'
      );
      // Self-check (non-vacuous): the delete detector DOES fire on a real unlink.
      assert.equal(
        collectCalls(stripComments("await unlink(leaseClaimPath(workspace, itemRef, nodeId));"), DELETE_VERBS).length,
        1,
        "the delete detector catches a real unlink call"
      );
    },
  },
];

// --- source-analysis helpers (cloned from acd-presence-write-scope) ----------

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
