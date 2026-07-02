// Fitness function: acd-mesh-eol-pinned (milestone 23, ADR-002 / fitness #6 — the
// F1/R5 carry-forward). The git-tracked .mesh/** records carried no line-ending pin in
// milestone 22, so a mixed-OS / autocrlf=true fleet would see byte-divergent (content-
// identical) record files (22/R5). Milestone 23 builds presence on the SAME .mesh/ git
// bus, so the pin lands HERE: .gitattributes must pin the .mesh/** records to LF
// (text eol=lf), mirroring the existing src/bundle/** text eol=lf pin — so a peer
// checks out a presence/<id>.json BYTE-FOR-BYTE as the writer wrote it regardless of
// core.autocrlf, and the poll-for-durability byte-identity assertions hold across the
// git seam (the 22/R5 byte-divergence cannot recur).
//
// Per the m03 lesson, this asserts the PRESENCE of the required pin (positive) AND
// confirms the matcher is non-vacuous (it would NOT match an unpinned line).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const GITATTRIBUTES = new URL("../../.gitattributes", import.meta.url);

// A rule that pins the .mesh records to LF: `**/.mesh/** text eol=lf` (the form this
// milestone adds — the `**/` prefix anchors at ANY depth, since a node's .mesh/ lives
// under its work stream, e.g. wiki/work/.mesh/) OR a root-anchored `.mesh/** ...` OR a
// record-`*.json`-scoped variant under .mesh, OR the `-text` binary-treatment
// alternative — any of which forces byte-stable checkout. The match is tolerant of the
// optional `**/` prefix + the record-glob, but REQUIRES the eol=lf / -text treatment so
// a bare `.mesh/** text` (which still leaves CRLF under autocrlf) does not satisfy it.
const MESH_EOL_PIN = /^\s*(?:\*\*\/)?\.mesh\/\*\*(?:\/\*\.json)?\s+(?:text\s+eol=lf|-text|eol=lf)\b/m;

export const archTests = [
  {
    name: "arch/mesh-eol-pinned: .gitattributes pins the .mesh/** records to LF (eol=lf), so a mixed-OS fleet sees byte-stable record files (22/R5 carry-forward)",
    async run() {
      const attrs = await readFile(GITATTRIBUTES, "utf8");
      assert.ok(
        MESH_EOL_PIN.test(attrs),
        "a .gitattributes rule pins .mesh/** to text eol=lf (or -text), mirroring the src/bundle/** pin — the 22/R5 byte-divergence cannot recur"
      );
      // The pin mirrors the existing src/bundle/** eol pin (the reference precedent in
      // the same file) — confirm that precedent is still present (a non-vacuous anchor).
      assert.ok(
        /^\s*src\/bundle\/\*\*\s+text\s+eol=lf\b/m.test(attrs),
        "the reference src/bundle/** text eol=lf pin is present (the precedent this rule mirrors)"
      );
    },
  },
  {
    name: "arch/mesh-eol-pinned: the .mesh pin matcher is non-vacuous (a bare, un-pinned .mesh line does not satisfy it)",
    async run() {
      // Self-check: an un-pinned `.mesh/** text` (no eol=lf) must NOT match — otherwise
      // the gate would falsely pass while CRLF could still leak under autocrlf.
      assert.ok(!MESH_EOL_PIN.test(".mesh/** text\n"), "a bare `.mesh/** text` (no eol=lf) does not satisfy the pin");
      assert.ok(!MESH_EOL_PIN.test("# .mesh/** text eol=lf\n"), "a commented `.mesh` pin does not satisfy the gate");
      // …and the canonical forms DO match (the positive control).
      assert.ok(MESH_EOL_PIN.test("**/.mesh/** text eol=lf\n"), "the depth-anchored `**/.mesh/** text eol=lf` form matches");
      assert.ok(MESH_EOL_PIN.test(".mesh/** text eol=lf\n"), "the root-anchored `.mesh/** text eol=lf` form matches");
      assert.ok(MESH_EOL_PIN.test(".mesh/**/*.json text eol=lf\n"), "the record-json-scoped form matches");
      assert.ok(MESH_EOL_PIN.test("**/.mesh/** -text\n"), "the `-text` binary-treatment form matches");
    },
  },
];
