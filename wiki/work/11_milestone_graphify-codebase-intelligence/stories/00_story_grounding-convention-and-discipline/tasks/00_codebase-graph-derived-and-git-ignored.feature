@cli @work @work-stream
Feature: the codebase graph is a derived, git-ignored artifact — rebuildable, never committed
  In order to keep the codebase graph a disposable grounding artifact and not an authoritative second
  copy that drifts against the source it describes
  graphify-out/ must be git-ignored at the project root, the built graph must never enter version
  control, and the graph must be reconstructable from source alone — holding no fact that is not
  already in the code.

  # ADR-003 / ADR-006 inv. 4. Mechanical git facts only — no binary, no agent (@executable). Mirrors the
  # 10/ADR-005 acd-graphify-derived-index git-ignore idiom.
  #
  # NUANCE (Three-Amigos, confirmed at refine — carry into the build): the derived graph FILES are
  # ALREADY ignored today, but via a `graphify-out/.gitignore` (an IN-DIR file milestone 10's
  # `ensureGraphifyOutGitignore` generates, and only AFTER a build/reindex has run — src/aof-gitignore.mjs
  # writes the nested file and deliberately leaves the repo-root .gitignore untouched). So
  # `git check-ignore graphify-out/graph.json` exits 0 today by accident-of-m10. Story 00's WORK is the
  # ROBUST, build-INDEPENDENT hardening: add `graphify-out/` to the repo-ROOT .gitignore so the codebase
  # graph is ignored from a fresh checkout, before any build, not contingent on m10's generator. The
  # "root entry specifically" assertion is what keeps story 03's acd-codebase-graph-derived arch-test
  # NON-vacuous (a naive `git check-ignore` is GREEN-now via the in-dir file; the test must pin the ROOT).
  # NOT in scope here: `.aof/aof.memory.graphify.index.json` (milestone 10's memory store, unignored at
  # root) — a cross-milestone cleanup item (STATE §Feedback), not a codebase-graph artifact.

  @executable
  Scenario Outline: each derived graph path under graphify-out/ is git-ignored at the project root
    Given a built codebase graph has written <path> under graphify-out/
    When I run "git check-ignore <path>"
    Then the command exits 0
    And <path> is reported as ignored

    Examples: the derived artifacts that must never be committed
      | path                    |
      | graphify-out/           |
      | graphify-out/graph.json |
      | graphify-out/graph.html |

  # The hardening that makes story 00 meaningful: the ignore is provided by the repo-ROOT .gitignore
  # (build-independent), not only by the in-dir graphify-out/.gitignore m10 generates after a build.
  @executable
  Scenario: graphify-out/ is ignored by the repo-root .gitignore, not only by an in-dir file
    Given a fresh checkout where no codebase graph has been built yet
    When I resolve which .gitignore rule ignores "graphify-out/"
    Then the repo-root .gitignore carries a "graphify-out/" entry
    And graphify-out/ is ignored even before any build has generated an in-dir .gitignore

  @executable
  Scenario: the built codebase graph is absent from version control
    Given graph:build has written graph.json and graph.html under graphify-out/
    When I list the files git tracks under graphify-out/
    Then no file under graphify-out/ is tracked by git

  # Needs a live graph:build to delete-and-reproduce, so @manual (verified at aof:verify with the
  # binary) — the git-ignore facts above are the @executable CI guard; this is the derived/disposable
  # observable that needs the binary.
  @manual
  Scenario: the derived graph is rebuildable from source and holds no authoritative fact
    Given a built graphify-out/graph.json exists
    When graphify-out/ is deleted and graph:build is re-run over the same source
    Then graphify-out/graph.json is reproduced from source alone
    And no committed work record depended on the deleted graph
