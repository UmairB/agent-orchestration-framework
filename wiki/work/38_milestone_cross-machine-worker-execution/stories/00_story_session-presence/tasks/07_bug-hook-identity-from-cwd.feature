@bug @finding-F4 @executable @cli @adapter @distribution
Feature: A real assistant hook resolves workspace + repo from the payload's `cwd`, so the bare `aof session` verbs actually write a record
  In order that SPEC objective (a) holds in PRODUCTION — opening a coding assistant on a repo makes that node
  read `working · <repo>` — the BARE hook commands the assistant actually fires (`aof session start|ping|end`,
  no flags) must resolve the workspace and repo from the ONE identity field every real hook payload carries:
  `cwd`. Today they resolve it from payload fields the vendor never sends, so every real hook exits 1 and the
  node stays a lie.

  # FINDING F4 (aof:verify 38, BLOCKER — found by the task-06 live soak, missed by 2409 green assertions).
  #
  # OBSERVED: a real Claude Code session on this repo, hooks wired per task 05, operator submits a real prompt →
  # `aof session ping` exits 1 with `session-arg-missing-workspace` and writes NOTHING. The node reads `idle`
  # while actively worked on — the EXACT bug this milestone exists to fix.
  #
  # ROOT CAUSE — the contract contradicted its own RESEARCH. `src/commands/mesh-session.mjs` resolves
  # `workspaceId = options.workspace ?? identity.payload?.workspace ?? null` and `repo` likewise — payload
  # fields Claude Code NEVER sends. RESEARCH.md §2.2 MEASURED the real payloads and recorded the truth:
  # "Common fields present on every payload (measured, consistent across all four): `session_id`,
  # `transcript_path`, `cwd`, `hook_event_name`." There is no `workspace` and no `repo` — they are aof
  # concepts the vendor cannot know. Task 05's contract nonetheless asserted "the payload carries session_id,
  # workspace, and repo" (05_assistant-hook-wiring.feature:33), the implementation faithfully built THAT, and
  # QA faithfully tested it with a synthetic payload carrying those fields. Every lane stayed green because
  # nobody fed the REAL payload to the BARE command. Task 05's false clause is corrected alongside this task.
  #
  # THE FIX SEAM: the CLI already loads the workspace from `process.cwd()` (mesh-session.mjs:212) — it has
  # what it needs and never derives from it. `workspaceId` MUST be derived through the CANONICAL idiom the
  # presence publisher itself uses — `config?.mesh?.workspaceId ?? workspaceIdFor(projectRoot)`
  # (src/mesh-launcher.mjs:375, src/global-node-registry.mjs:42, `workspaceIdFor` from
  # src/global-work-store.mjs). This is LOAD-BEARING, not cosmetic: a session record whose `workspaceId` does
  # not match the id the presence aggregation (ADR-003) and `global_node_workspaces` use would never be
  # attributed to the workspace, so ADR-004's run↔session subsumption would silently mis-fire. Verified at the
  # source: workspaceIdFor("C:\Source\umair\aof") == 9db1fd84f5895e38 == the registered workspaceId.
  #
  # @qa: the ONE assertion whose absence let this ship is "a REAL captured payload → the BARE command → a
  # record on disk". Fixtures MUST use the RESEARCH-captured field set, never a hand-authored payload shaped to
  # the consumer's convenience. Precedence and the loud-refusal discipline must both survive the fix.

  Background:
    Given the RESEARCH-captured Claude Code hook payload field set — `session_id`, `transcript_path`, `cwd`, `hook_event_name` (no `workspace`, no `repo`)
    And the workspace at the payload's `cwd` is a real aof workspace

  Scenario: the bare `aof session start` a real hook fires writes a session record — the regression this bug is
    # THE headline assertion. It must fail against today's code and pass after the fix.
    Given a real Claude Code SessionStart payload on stdin, carrying `cwd` and NO `workspace`/`repo`
    When the hook fires the BARE command `aof session start` (no flags, exactly as `.claude/settings.json` wires it)
    Then a session record IS written for this node
    And the record's `workspaceId` equals the registry-canonical `config.mesh.workspaceId ?? workspaceIdFor(<cwd>)` — the SAME id the presence publisher derives
    And the record's `repo` is the workspace's name
    And the record's `assistant` resolves without a flag
    And the command exits 0

  Scenario: the bare `aof session ping` upserts from the same payload, and the bare `aof session end` deletes
    Given a live session started from a real hook payload
    When the hook fires the BARE `aof session ping` with a real UserPromptSubmit payload
    Then the record's `lastPingAt` advances and no second record is created
    When the hook fires the BARE `aof session end` with a real SessionEnd payload
    Then the record for that `(node, workspace, assistant)` tuple is removed
    And the command exits 0

  Scenario: the derived workspaceId is the one presence actually aggregates on (the invariant the fix exists to hold)
    # The load-bearing tie-in: a record keyed on a NON-canonical id would be invisible to ADR-003 aggregation and
    # would break ADR-004 subsumption. Assert the identity, don't assume it.
    Given a session record written by the BARE hook command from a real payload
    Then its `workspaceId` is byte-equal to the id `assembleCurrentPresenceRecord` resolves for that same workspace
    And the live session therefore surfaces in the node's published presence `sessions[]`

  Scenario Outline: identity precedence — explicit flags win, then payload fields, then the payload's `cwd`
    # The fix ADDS a cwd fallback; it must not break the existing (flag-driven) callers a human/CI uses, nor a
    # payload that DOES carry the fields.
    Given the caller supplies <flags> and the payload carries <payload>
    Then the resolved workspaceId comes from <source>
    And the outcome is <outcome>

    Examples:
      | flags                  | payload                        | source              | outcome                       |
      | --workspace + --repo   | cwd only (real shape)          | the flags           | record written                |
      | --workspace + --repo   | workspace + repo               | the flags           | record written                |
      | none                   | workspace + repo               | the payload fields  | record written                |
      | none                   | cwd only (real shape)          | derived from cwd    | record written (THE FIX)      |
      | none                   | cwd only (real shape)          | derived from cwd    | workspaceId is registry-canonical |

  Scenario Outline: a cwd that cannot resolve a workspace still refuses LOUDLY — never a silent or half-formed record
    # The sole-producer discipline (task 00) must survive the fix: the refusal moves from "no --workspace flag"
    # to "this cwd is not an aof workspace", but it stays a coded, loud, record-free refusal.
    Given the payload's `cwd` is <cwd> and no identity flags are supplied
    Then the outcome is <outcome>
    And no session record is written

    Examples:
      | cwd                              | outcome                          |
      | a directory that is not an aof workspace | loud coded refusal        |
      | absent from the payload entirely | loud coded refusal               |
      | present but blank                | loud coded refusal               |
