// Fitness function: acd-issuance-record-frozen (milestone 27 / story 00 / ADR-001 /
// fitness #2) — "The frozen six-key directive record + the EOL pin."
//
//   "assembleDirective/readIssuanceDirectives carry EXACTLY the six keys
//    itemRef, issuer, target, state, issuedAt, aofVersion in that name/order;
//    state ∈ {issued, withdrawn, fulfilled}; target is the discriminated union
//    {kind: any|node|capability}. AND the .gitattributes **/.mesh/** rule MATCHES
//    the real nested sample path wiki/work/<item>/.mesh/issuance/<node>/<ref>.json
//    by git-semantics matching (never a literal grep; no new pin authored — the
//    existing rule already covers it)."
//
// SPLIT per the story's build notes: the SCHEMA half is RED-until-module (it
// imports src/mesh-issuance.mjs); the EOL-match half is GREEN NOW (the rule and
// the repo already exist) — asserted via `git check-attr`, the acd-runs-eol-pinned
// method, NEVER a literal grep, with an out-of-scope path reporting `unspecified`
// as the non-vacuous control (the same precedent acd-runs-eol-pinned sets).
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSyncHardened } from "../support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The REAL issuance record path (forward slashes — git pathspec form). The mesh
// substrate anchors on the .aof config home as of 28/verify, so issuance directives
// live at .aof/mesh/issuance/<issuer>/<ref>.json. check-attr matches patterns, so the
// file need not exist.
const NESTED_ISSUANCE = ".aof/mesh/issuance/build-server/27-00.json";
const CONTROL = "wiki/work/27_milestone_work-issuance-routing/SPEC.md";

function checkAttr(paths) {
  const r = spawnSyncHardened("git", ["check-attr", "text", "eol", "--", ...paths], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `git check-attr runs cleanly (stderr: ${r.stderr})`);
  const out = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^(.+?): (text|eol): (.+)$/.exec(line.trim());
    if (!m) continue;
    (out[m[1]] ??= {})[m[2]] = m[3];
  }
  return out;
}

export const archTests = [
  {
    name: "arch/issuance-record-frozen: assembleDirective returns EXACTLY the six keys itemRef, issuer, target, state, issuedAt, aofVersion in that name/order",
    run: async () => {
      const { assembleDirective } = await import("../../src/mesh-issuance.mjs");
      const FROZEN_KEYS = ["itemRef", "issuer", "target", "state", "issuedAt", "aofVersion"];
      const directive = assembleDirective({
        itemRef: "27/00",
        issuer: "node-a",
        target: { kind: "any" },
        issuedAt: "2026-07-03T10:00:00.000Z",
        aofVersion: "0.1.0",
      });
      assert.deepEqual(Object.keys(directive), FROZEN_KEYS, "assembleDirective carries exactly the six frozen keys, in order");
    },
  },
  {
    name: "arch/issuance-record-frozen: state defaults to \"issued\" and accepts only issued|withdrawn|fulfilled",
    run: async () => {
      const { assembleDirective } = await import("../../src/mesh-issuance.mjs");
      const defaulted = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, issuedAt: "2026-07-03T10:00:00.000Z", aofVersion: "0.1.0" });
      assert.equal(defaulted.state, "issued", "state defaults to \"issued\" when not supplied");
      const VALID_STATES = ["issued", "withdrawn", "fulfilled"];
      for (const state of VALID_STATES) {
        const record = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, state, issuedAt: "2026-07-03T10:00:00.000Z", aofVersion: "0.1.0" });
        assert.equal(record.state, state, `state "${state}" is carried verbatim`);
      }
    },
  },
  {
    name: "arch/issuance-record-frozen: target is the discriminated union {kind: any|node|capability} for each arm",
    run: async () => {
      const { assembleDirective } = await import("../../src/mesh-issuance.mjs");
      const any = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, issuedAt: "2026-07-03T10:00:00.000Z", aofVersion: "0.1.0" });
      assert.deepEqual(any.target, { kind: "any" });
      const node = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "node", nodeId: "build-server" }, issuedAt: "2026-07-03T10:00:00.000Z", aofVersion: "0.1.0" });
      assert.deepEqual(node.target, { kind: "node", nodeId: "build-server" });
      const capability = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "capability", value: "codex" }, issuedAt: "2026-07-03T10:00:00.000Z", aofVersion: "0.1.0" });
      assert.deepEqual(capability.target, { kind: "capability", value: "codex" });
    },
  },
  {
    name: "arch/issuance-record-frozen: readIssuanceDirectives returns records carrying EXACTLY the six frozen keys, in order",
    run: async () => {
      const { mkdtemp, rm } = await import("node:fs/promises");
      const os = await import("node:os");
      const { assembleDirective, readIssuanceDirectives } = await import("../../src/mesh-issuance.mjs");
      const { issuanceDirectivePath } = await import("../../src/mesh-store.mjs");
      const { writeText } = await import("../../src/fs.mjs");
      const workDir = await mkdtemp(path.join(os.tmpdir(), "aof-issuance-frozen-"));
      try {
        const workspace = { workDir };
        const directive = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, issuedAt: "2026-07-03T10:00:00.000Z", aofVersion: "0.1.0" });
        await writeText(issuanceDirectivePath(workspace, "node-a", "27/00"), JSON.stringify(directive, null, 2));
        const [read] = await readIssuanceDirectives(workspace);
        assert.deepEqual(Object.keys(read), ["itemRef", "issuer", "target", "state", "issuedAt", "aofVersion"], "the read record carries exactly the six frozen keys, in order");
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/issuance-record-frozen (EOL half): .gitattributes' .aof/mesh/** rule MATCHES the real .aof/mesh/issuance/<node>/<ref>.json path with eol=lf (git-semantics matching via check-attr — never a literal grep; no new pin authored)",
    run: async () => {
      const attrs = checkAttr([NESTED_ISSUANCE]);
      assert.equal(attrs[NESTED_ISSUANCE]?.eol, "lf", `the real issuance directive path is pinned eol=lf — got ${JSON.stringify(attrs[NESTED_ISSUANCE])}`);
      assert.equal(attrs[NESTED_ISSUANCE]?.text, "set", "the issuance directive is treated as text (so the eol pin applies)");
    },
  },
  {
    name: "arch/issuance-record-frozen (EOL half, non-vacuous control): an out-of-scope path reports `unspecified` (proving check-attr can say no)",
    run: async () => {
      const attrs = checkAttr([CONTROL]);
      assert.equal(
        attrs[CONTROL]?.eol,
        "unspecified",
        `an out-of-scope record doc carries NO eol pin (the control — if this matched, the proof would be vacuous) — got ${JSON.stringify(attrs[CONTROL])}`
      );
    },
  },
];
