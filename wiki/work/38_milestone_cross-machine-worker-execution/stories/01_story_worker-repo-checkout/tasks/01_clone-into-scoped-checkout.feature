@executable @cli @work @distribution
Feature: On a repo miss, the worker clones into the ONE scoped meshCheckoutPath seam — never an arbitrary path
  In order that a self-provisioning worker can never be steered to write outside a dedicated, keyed location,
  the clone target is built ONLY by the `meshCheckoutPath(workspaceId)` seam under the global mesh home
  (`<meshRoot>/checkouts/<workspaceId>/`), composed from the store-canonical workspaceId — never os.tmpdir(),
  never a path built from directive/ref text, so a traversal id escapes nothing.

  # ARCHITECTURE 38/ADR-005 — the SAME "one dedicated, scoped, keyed root" discipline meshWorktreePath keeps for
  # worktrees (35/ADR-004). meshCheckoutPath(workspaceId) is the ONE place the checkout path is built; keyed by
  # workspaceId (a store-canonical id, never directive text — the T3b enumerate-then-filter discipline). The git
  # clone spawn is argv-form, shell-less (the mesh-worktree/enroll-git-argv-no-shell precedent). STRUCTURAL: the
  # clone target is built only from the dedicated root, no os.tmpdir / directive-text path →
  # acd-worker-clone-target-scoped. SECURITY (see SECURITY.md): the clone must NOT use `--config
  # http.extraHeader` (RESEARCH.md §1 measured: it persists the raw credential to .git/config) — that invariant
  # is task 03; this task is the PATH scoping.
  #
  # @qa: complete the Examples — a valid workspaceId → path under <meshRoot>/checkouts/<workspaceId>/; a
  # traversal/absolute/`..`-laden id constructs no escaping path (matches nothing / is rejected); the target is
  # never os.tmpdir(); a concurrent clone for a different workspaceId lands at a distinct, non-colliding path.

  Background:
    Given AOF_GLOBAL_HOME points at a fixture global home
    And a worker that lacks the repo for workspace "ws-1" with a resolvable cloneUrl

  Scenario: the clone target is the scoped meshCheckoutPath under the global mesh home
    When the worker clones the repo for "ws-1"
    Then the checkout lands under <meshRoot>/checkouts/ws-1/
    And the path was built by the meshCheckoutPath seam, not os.tmpdir() and not a directive-text path

  # PATH SCOPING (ADR-005 / acd-worker-clone-target-scoped): whatever the workspaceId, a well-formed store-canonical
  # id resolves to a prefix-child of the ONE checkouts root; an id carrying traversal, an absolute path, or a
  # `..`-laden segment constructs NO escaping path — it either normalizes to a path still under the checkouts root
  # or resolves to no clone (rejected as a non-canonical id, never a path escaping the root).
  Scenario Outline: a workspaceId that would traverse escapes nothing
    Given a workspaceId "<id>"
    Then the constructed checkout path stays under the checkouts root or the id resolves to no clone

    Examples:
      | id            |
      # A well-formed store-canonical id — lands under the checkouts root.
      | ws-1          |
      | ws-2-abc123   |
      # Traversal / absolute / `..`-laden ids — construct no escaping path (rejected or normalized-under-root).
      | ../etc        |
      | ../../secrets |
      | /abs/outside  |
      | ws-1/../../x  |
      | ..            |
      | C:\Windows    |

  # NEVER THE MACHINE-GLOBAL TEMP DIR (ADR-005): whatever the id, the target is a child of the dedicated
  # <meshRoot>/checkouts/ root — never os.tmpdir(), never a hand-built path outside the global mesh home.
  Scenario: the clone target is never os.tmpdir() and never a hand-built path outside the checkouts root
    When the worker clones the repo for "ws-1"
    Then the normalized checkout path is a prefix-child of <meshRoot>/checkouts/ under the global mesh home
    And no checkout is created under a machine-global temp directory (os.tmpdir())
    And the path was composed from the workspaceId only, never from directive or ref text

  # THE CLONE SPAWN IS ARGV-FORM, SHELL-LESS (ADR-005, the mesh-worktree/enroll-git-argv-no-shell precedent):
  # git is invoked via execFile with an argv array, never a shell string — so no path segment or id is ever
  # interpreted by a shell.
  Scenario: the git clone is spawned argv-form with no shell
    When the worker clones the repo for "ws-1"
    Then the clone is spawned as an argv array (execFile), not a shell command string
    And the target path is passed as one argv element, never interpolated into a shell string

  # CONCURRENCY (ADR-005, mirroring 35/ADR-004's worktree concurrency): two clones for two distinct workspaceIds
  # land at two distinct, non-colliding checkout paths under the same checkouts root — each keyed by its own id.
  Scenario: two concurrent clones for distinct workspaceIds land at distinct, non-colliding paths
    Given a second worker task cloning the repo for a distinct workspace "ws-2" with its own cloneUrl
    When the worker clones "ws-1" and "ws-2" concurrently
    Then "ws-1" lands under <meshRoot>/checkouts/ws-1/ and "ws-2" under <meshRoot>/checkouts/ws-2/
    And the two checkout paths are distinct, keyed by their respective workspaceIds
    And neither checkout is written inside the other

  # IDEMPOTENT TARGET (ADR-005): re-resolving the checkout path for the SAME workspaceId always yields the SAME
  # path (a pure function of id + global home) — so a re-clone reuses the one scoped location, never a second one.
  Scenario: the checkout path is a stable pure function of the workspaceId and global home
    When the worker resolves the checkout path for "ws-1" twice
    Then both resolutions yield the same <meshRoot>/checkouts/ws-1/ path
    And the resolution reads only the workspaceId and the global mesh home, no directive text
