// Fitness function for milestone 11 / ADR-003 + ADR-006 inv. 4 (codebase graph is
// derived + git-ignored):
// "The codebase graph is a git-ignored, rebuildable artifact under `graphify-out/`,
//  built fresh from current source via `graph:build` (which returns builtAt/egress/
//  counts); no 11 seam commits it or serves it stale without surfacing age. Freshness
//  is a build-fresh-at-the-decision-point prompt discipline: each grounding seam
//  BUILDS before it queries/triages."
//
// Mirrors the 10/ADR-005 acd-graphify-derived-index git-ignore idiom, but pins the
// REPO-ROOT .gitignore specifically. Subtle non-vacuity: m10 generates an IN-DIR
// `graphify-out/.gitignore` (`*` + `!.gitignore`) per project, so a naive
// `git check-ignore graphify-out/graph.json` would be vacuously GREEN via that in-dir
// file even if the root entry were removed. To be MEANINGFUL this test pins the ROOT
// `.gitignore` to carry a `graphify-out/` entry (the build-independent, repo-level
// ignore ADR-003 requires) — so removing the root entry goes RED here regardless of
// any in-dir file. Two halves:
//   (a) GIT-IGNORE: the repo-root .gitignore contains a `graphify-out/` entry, and
//       `git check-ignore -v graphify-out/` resolves to THAT root file (not an in-dir
//       graphify-out/.gitignore).
//   (b) FRESHNESS ORDERING (prompt-content): each grounding seam BUILDS
//       (`aof graph build`) BEFORE it QUERIES/TRIAGES — build precedes query/triage in
//       the seam text, surfacing builtAt/egress.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT_GITIGNORE = path.join(repoRoot, ".gitignore");
const bundleDir = path.join(repoRoot, "src", "bundle");

const SEAMS = {
  architect: path.join(bundleDir, "agents", "aof-architect.md"),
  refine: path.join(bundleDir, "commands", "refine.md"),
  codeReview: path.join(bundleDir, "commands", "code-review.md"),
};

export const archTests = [
  {
    name: "arch/codebase-graph-derived: the REPO-ROOT .gitignore carries a `graphify-out/` entry (the build-independent, repo-level ignore — ADR-003)",
    run: async () => {
      // Pin the ROOT entry directly — this is what makes the test non-vacuous against
      // m10's in-dir graphify-out/.gitignore. Removing the root entry goes RED here.
      const lines = (await readFile(ROOT_GITIGNORE, "utf8")).split(/\r?\n/).map((l) => l.trim());
      assert.ok(
        lines.includes("graphify-out/") || lines.includes("graphify-out"),
        `the repo-root .gitignore must contain a \`graphify-out/\` entry (the derived codebase graph is never committed); entries: ${lines.filter(Boolean).join(", ")}`
      );
    },
  },
  {
    name: "arch/codebase-graph-derived: `git check-ignore -v graphify-out/` resolves to the REPO-ROOT .gitignore (not an in-dir graphify-out/.gitignore)",
    run: async () => {
      // `git check-ignore -v` prints `<source>:<line>:<pattern>\t<path>`. Assert the
      // SOURCE that ignores graphify-out/ is the repo-root .gitignore — so the ignore is
      // build-independent (present before any reindex writes an in-dir file). This is the
      // meaningful pin: a naive check-ignore over graphify-out/graph.json could resolve to
      // an in-dir file; we test the DIR itself and assert the ROOT is the source.
      let out;
      try {
        out = execFileSync("git", ["check-ignore", "-v", "graphify-out/"], {
          cwd: repoRoot,
          encoding: "utf8",
        });
      } catch (error) {
        // Non-zero exit = NOT ignored = the invariant is violated (RED).
        assert.fail(`graphify-out/ is not git-ignored (git check-ignore exited non-zero): ${error.stderr ?? error.message}`);
      }
      const source = out.split(":")[0].trim();
      // The source path git reports is relative to the repo root for the root file:
      // ".gitignore". An in-dir file would report "graphify-out/.gitignore".
      assert.equal(
        path.normalize(source),
        ".gitignore",
        `graphify-out/ must be ignored by the REPO-ROOT .gitignore (build-independent), not an in-dir file; git reported source: "${source}"`
      );
    },
  },
  {
    name: "arch/codebase-graph-derived: each grounding seam BUILDS fresh before it queries/triages (build-fresh-at-the-decision-point — ADR-003)",
    run: async () => {
      // The freshness discipline is a prompt-content ordering check: `aof graph build`
      // must precede `aof graph query`/`aof graph triage` in the seam text, so the
      // queried graph reflects current source (builtAt/egress surfaced from the build).
      // ADR-007: the consume step is now the deterministic `aof graph impact` (build
      // must still precede it — build-fresh-at-the-decision-point).
      const cases = [
        ["aof-architect", SEAMS.architect, /aof graph impact/],
        ["refine (break-down)", SEAMS.refine, /aof graph impact/],
        ["code-review (PR impact)", SEAMS.codeReview, /aof graph impact/],
      ];
      for (const [label, file, consumeRe] of cases) {
        const text = await readFile(file, "utf8");
        const buildIdx = text.search(/aof graph build\b/);
        const consumeIdx = text.search(consumeRe);
        assert.ok(buildIdx >= 0, `${label} contains an \`aof graph build\` step`);
        assert.ok(consumeIdx >= 0, `${label} contains its query/triage consume step`);
        assert.ok(
          buildIdx < consumeIdx,
          `${label} BUILDS (\`aof graph build\` @${buildIdx}) BEFORE it queries/triages (@${consumeIdx}) — build-fresh-at-the-decision-point`
        );
      }
    },
  },
  {
    name: "arch/codebase-graph-derived: each grounding seam surfaces freshness (builtAt/egress/counts) — staleness is visible, never silently served",
    run: async () => {
      // ADR-003: the agent reads back builtAt/egress/counts from the BuildResult so
      // freshness is visible. Assert each seam tells the agent to read those back (the
      // freshness-is-visible discipline — not a silently-stale graph).
      for (const [label, file] of Object.entries(SEAMS)) {
        const text = await readFile(file, "utf8");
        assert.match(
          text,
          /builtAt|freshness is visible|surfac\w+ (its )?age|read back the.*counts/i,
          `${label} surfaces graph freshness (builtAt/egress/counts) so staleness is visible`
        );
      }
    },
  },
];
