@cli @work @distribution @manual
Feature: Two nodes on a shared remote each publish their identity and render the other's, purely over git
  In order to verify the milestone's load-bearing objective an outsider can check — the "decentralization is mostly using git" thesis
  two nodes sharing a git remote each publish their node identity and sync, then each renders the other's node record, merge-clean, with no relay,
  so that an outsider confirms the mesh foundation works over git alone: two installs, one shared remote, each sees the other — no daemon, no relay, no merge conflict.

  # ARCHITECTURE ADR-002/004 — the SPEC's outsider-verifiable acceptance (SPEC §Objective:
  # "two nodes on a shared remote each publish their identity + records and render the other's
  # — purely over git, no relay, no merge conflict"). @manual: an agent sets up two working
  # copies + a shared bare remote, drives the registered mesh:* commands, and records evidence
  # in the milestone VERIFICATION.md. This is the cross-node integration proof + the entry point
  # for the PRD A1 measurement spike (does a 15s-cadence push/pull stay merge-clean under real
  # concurrent publishes on a 3-node fleet?). It composes story 01's mesh:identity/mesh:status
  # with story 02's mesh:sync — driven only through the CLI face, never by hand-editing files.
  Background:
    Given a shared bare git remote both nodes can push/pull
    And two aof installs ("node A" and "node B") each cloned from that remote, each a node
    And both installs drive only the registered aof mesh commands (no hand-edited files)

  # Each node publishes its own identity and syncs; after a round-trip each tree carries BOTH
  # node records — the headline "see what the other node is" over git alone.
  # R4: pin the UNAFFECTED side — after pulling the peer's record, each node's OWN record file is
  # byte-identical to what it published (receiving a peer never rewrites your own record).
  Scenario: each node publishes its identity and renders the other's after a sync round-trip
    Given node A has run "aof mesh identity" then "aof mesh sync"
    And node B has run "aof mesh identity" then "aof mesh sync"
    When node A runs "aof mesh sync" then "aof mesh status"
    And node B runs "aof mesh sync" then "aof mesh status"
    Then node A's status lists node B with B's id and capabilities
    And node B's status lists node A with A's id and capabilities
    And node A's own record file is byte-identical to what node A published (the pull did not touch it)
    And node B's own record file is byte-identical to what node B published (the pull did not touch it)
    And neither sync produced a merge conflict (the partition convention kept the merge add-only)

  # Concurrent publishes from both nodes merge add-only — the conflict-avoidance convention
  # (story 00 / ADR-002) proven end-to-end over the shared remote, not just a single merge.
  # R4: pin that both records arrive BYTE-INTACT — add-only means each file lands exactly as its
  # owner wrote it, never content-merged into a hybrid.
  Scenario: concurrent identity publishes from both nodes merge add-only over the shared remote
    Given both nodes publish (or re-publish) their identity at nearly the same time
    When both run "aof mesh sync"
    Then both node records are present on the remote and in both trees
    And node A's record is byte-identical to what node A published (not content-merged)
    And node B's record is byte-identical to what node B published (not content-merged)
    And no push was rejected for a non-fast-forward content conflict (each node owns its own path)

  # The git-of-record property: git alone — no relay, no daemon — carries the records. Verified
  # by observing the remote's git history holds both nodes' record files as ordinary commits.
  Scenario: the records travel purely over git with no relay
    When both nodes have synced
    Then the shared remote's git history contains both nodes' record files as committed objects
    And each record file traces to a commit authored by its owning node's sync
    And no process other than git transported the records (there is no relay in this milestone)
