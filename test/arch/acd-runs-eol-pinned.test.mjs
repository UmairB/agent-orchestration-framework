// Fitness function: acd-runs-eol-pinned (milestone 26 / story 00 / ADR-001 /
// fitness #3 — the 23/R3 carry-forward: "a git-as-bus EOL pin must match the REAL
// nested record path, not a root anchor").
//
//   ".gitattributes rules cover the real sample paths
//    wiki/work/<item>/runs/<node>/<run-id>.json AND the flat legacy shape, pinned
//    eol=lf. Also: .mesh/leases/** is already covered by the existing **/.mesh/**
//    rule (the m26 lease records need NO new pin)."
//
// THE R3 METHOD: assert by MATCHING real sample paths against the parsed rules —
// `git check-attr` IS git's own attribute matcher, so the proof runs on git's
// semantics, never a literal-pattern grep (a grep passed while the real nested path
// stayed unpinned — the exact m23 near-miss). Non-vacuous: an out-of-scope path
// must report `unspecified` (the control proving the matcher can say no).
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSyncHardened } from "../support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The REAL sample paths (forward slashes — git pathspec form). check-attr matches
// patterns, so the files need not exist.
const NESTED_RUN = "wiki/work/26_milestone_distributed-runs-leasing/runs/umair-desktop/20260702T100000000Z-0000.json";
const FLAT_RUN = "wiki/work/26_milestone_distributed-runs-leasing/runs/20260702T100000000Z-0000.json";
const STORY_RUN = "wiki/work/26_milestone_x/stories/00_story_y/runs/node-a/20260702T100000000Z-0000.json";
const LEASE_RECORD = ".aof/mesh/leases/26/umair-desktop.json";
const CONTROL = "wiki/work/26_milestone_distributed-runs-leasing/SPEC.md";

// Parse `git check-attr text eol -- <paths>` output into { path: { attr: value } }.
function checkAttr(paths) {
  const r = spawnSyncHardened("git", ["check-attr", "text", "eol", "--", ...paths], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `git check-attr runs cleanly (stderr: ${r.stderr})`);
  const out = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    // "<path>: <attribute>: <value>" — the path carries no colon in our samples.
    const m = /^(.+?): (text|eol): (.+)$/.exec(line.trim());
    if (!m) continue;
    (out[m[1]] ??= {})[m[2]] = m[3];
  }
  return out;
}

export const archTests = [
  {
    name: "arch/runs-eol-pinned: .gitattributes rules MATCH the real nested runs/<node>/<run-id>.json path AND the flat legacy path with eol=lf (git-semantics matching via check-attr — the R3 method, never a literal grep)",
    run: async () => {
      const attrs = checkAttr([NESTED_RUN, FLAT_RUN, STORY_RUN]);
      // The REAL nested shape — the exact path class the 23/R3 near-miss left
      // unpinned when the assertion was a pattern grep.
      assert.equal(attrs[NESTED_RUN]?.eol, "lf", `the real NESTED run-record path is pinned eol=lf — got ${JSON.stringify(attrs[NESTED_RUN])}`);
      assert.equal(attrs[NESTED_RUN]?.text, "set", "the nested run record is treated as text (so the eol pin applies)");
      // The flat legacy shape (the single-node install's records ride the same bus).
      assert.equal(attrs[FLAT_RUN]?.eol, "lf", `the FLAT legacy run-record path is pinned eol=lf — got ${JSON.stringify(attrs[FLAT_RUN])}`);
      // A story's own runs/ folder (the deeper 19/ADR-002 layout) is covered too.
      assert.equal(attrs[STORY_RUN]?.eol, "lf", `a story-level nested run-record path is pinned eol=lf — got ${JSON.stringify(attrs[STORY_RUN])}`);
    },
  },
  {
    name: "arch/runs-eol-pinned: .aof/mesh/leases/** is already covered by the existing .aof/mesh/** pin (the m26 lease records need NO new rule; location moved at 28/verify)",
    run: async () => {
      const attrs = checkAttr([LEASE_RECORD]);
      assert.equal(attrs[LEASE_RECORD]?.eol, "lf", `the lease claim record path under .aof/mesh/leases/ is pinned eol=lf by the existing .aof/mesh/** rule — got ${JSON.stringify(attrs[LEASE_RECORD])}`);
    },
  },
  {
    name: "arch/runs-eol-pinned: the matcher is non-vacuous — an out-of-scope path reports `unspecified` (the control proving check-attr can say no)",
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
