@executable @cli @work @distribution
Feature: `aof session start|ping|end` are the sole producers of a per-(node, workspace, assistant) session record
  In order that a live coding-assistant session becomes a machine-readable liveness fact a node's presence can
  surface — even when the session executes zero aof task-runs — an assistant-agnostic CLI writes, refreshes,
  and clears a session record keyed by (nodeId, workspaceId, assistant), stored in the node's OWN global mesh
  home (never git, never the repo working tree).

  # ARCHITECTURE 38/ADR-002 (session record + sole-producer discipline). The record shape is FROZEN:
  # { nodeId, workspaceId, repo, assistant, startedAt, lastPingAt } — `acd-session-record-frozen` pins the
  # ordered key set. `start` writes it (startedAt = lastPingAt = now); `ping` upserts lastPingAt = now (a ping
  # without a prior start still works — idempotent); `end` deletes it. Each is a SINGLE-record mutation through
  # the atomic writeText temp+rename seam (19/R2) — never a bare write, mirroring the m35 assignment
  # sole-producer-per-state discipline. Records live under globalMeshPaths(...).meshRoot `sessions/` partition
  # (honoring AOF_GLOBAL_HOME), co-located with the global_node_workspaces registry the aggregation reads
  # (ADR-003) so one store-open covers both. RESEARCH.md §2: the assistant delivers session identity over a
  # hook payload (CLAUDE_SESSION_ID / stdin JSON) — the CLI takes it as data, assistant-agnostic.
  #
  # @qa: complete the Examples/case matrix — start-writes, ping-upserts-without-start, ping-refreshes,
  # end-deletes, two-assistants-one-workspace → two records, two-workspaces-one-assistant → two records,
  # missing/blank required arg is a loud coded refusal, end-of-a-nonexistent-session is benign.

  Background:
    Given AOF_GLOBAL_HOME points at a fixture global home
    And this node's id is "node-a"

  Scenario: `aof session start` writes a session record with the frozen shape
    When the operator runs `aof session start --workspace ws-1 --repo my-repo --assistant claude-code`
    Then a session record exists for (node "node-a", workspace "ws-1", assistant "claude-code")
    And its keys are exactly nodeId, workspaceId, repo, assistant, startedAt, lastPingAt in that order
    And startedAt equals lastPingAt

  Scenario: `aof session ping` refreshes lastPingAt and upserts an unstarted session
    # ping is idempotent — a crash-recovered assistant that never issued `start` still registers on first ping.
    Given no session record exists for (node "node-a", workspace "ws-1", assistant "claude-code")
    When the operator runs `aof session ping --workspace ws-1 --repo my-repo --assistant claude-code` at "2026-07-10T12:00:00.000Z"
    Then a session record exists for (node "node-a", workspace "ws-1", assistant "claude-code")
    And its lastPingAt is "2026-07-10T12:00:00.000Z"
    And its startedAt equals its lastPingAt
    When the operator runs `aof session ping --workspace ws-1 --repo my-repo --assistant claude-code` again at "2026-07-10T12:00:30.000Z"
    Then the same record's lastPingAt is now "2026-07-10T12:00:30.000Z"
    And its startedAt is unchanged at "2026-07-10T12:00:00.000Z"
    And exactly one record exists for that tuple (ping upserts in place, never a duplicate)

  Scenario: `aof session end` deletes the record
    # after end, the (node, workspace, assistant) tuple has no record; a subsequent presence read shows no session.
    Given a session record exists for (node "node-a", workspace "ws-1", assistant "claude-code")
    When the operator runs `aof session end --workspace ws-1 --assistant claude-code`
    Then no session record exists for (node "node-a", workspace "ws-1", assistant "claude-code")
    And a subsequent presence read shows no session for that tuple

  Scenario: `aof session end` on a nonexistent session is benign — a no-op success, never an error
    # a crash-recovered assistant may fire end for a tuple whose record already TTL-expired or was never written.
    Given no session record exists for (node "node-a", workspace "ws-9", assistant "claude-code")
    When the operator runs `aof session end --workspace ws-9 --assistant claude-code`
    Then the command exits 0
    And no session record exists for (node "node-a", workspace "ws-9", assistant "claude-code")
    And no error is emitted

  Scenario Outline: the (node, workspace, assistant) tuple is the key — distinct tuples are distinct records
    # two assistants on one repo, or one assistant on two repos, hold DISTINCT records (the "node working two
    # repos shows both" SPEC line falls out of this key).
    Given a session started for tuple <tuple-a>
    And a session started for tuple <tuple-b>
    Then the number of distinct session records for node "node-a" is <records>
    And ending tuple <tuple-a> leaves tuple <tuple-b> intact

    Examples:
      | tuple-a                    | tuple-b                    | records |
      | ws-1 / claude-code         | ws-1 / claude-code         | 1       |
      | ws-1 / claude-code         | ws-1 / cursor              | 2       |
      | ws-1 / claude-code         | ws-2 / claude-code         | 2       |
      | ws-1 / claude-code         | ws-2 / cursor              | 2       |

  Scenario Outline: a missing or blank required argument is a LOUD coded refusal — never a silent partial write
    # start/ping require (workspace, repo, assistant); end requires (workspace, assistant). A missing or
    # whitespace-only value is refused with a stable coded exit, and NO record is written (sole-producer never
    # emits a half-formed record).
    When the operator runs `aof session <verb>` with <arg> set to <value>
    Then the command exits non-zero with code "<code>"
    And no session record is written

    Examples:
      | verb  | arg       | value      | code                          |
      | start | workspace | (omitted)  | session-arg-missing-workspace |
      | start | workspace | "   "      | session-arg-missing-workspace |
      | start | repo      | (omitted)  | session-arg-missing-repo      |
      | start | assistant | (omitted)  | session-arg-missing-assistant |
      | start | assistant | ""         | session-arg-missing-assistant |
      | ping  | workspace | (omitted)  | session-arg-missing-workspace |
      | ping  | assistant | (omitted)  | session-arg-missing-assistant |
      | end   | workspace | (omitted)  | session-arg-missing-workspace |
      | end   | assistant | (omitted)  | session-arg-missing-assistant |
