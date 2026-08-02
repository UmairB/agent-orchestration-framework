<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the TRIGGER and the ENQUEUE (STORY.md AC1–AC4, ADR-001): a
# `PostToolUse` `command` hook in EXEC form (`command` + `args`), matcher pinned to
# exactly `Write|Edit|NotebookEdit`, whose body reads stdin, resolves the path field
# through an EXPLICIT per-tool map, appends ONE NDJSON line to the queue file it derives
# from its own installed location, and exits 0 — ALWAYS.
#
# SUPERSEDED AT BUILD REVIEW (ADR-013/C2, 2026-08-02): this task originally required the
# queue's ABSOLUTE path to be stamped into the argv at install time. `.claude/settings.json`
# is TRACKED, and a `git worktree` — which is exactly how a mesh worker builds its checkout —
# inherits it verbatim. Two failures followed: the queue path resolved outside the worktree
# (the hook goes inert), and the SCRIPT path made `node` itself exit non-zero before the
# script's "exit 0, always" could apply — AC4 defeated from outside the script. An argv
# element in a tracked file may not carry an install-time absolute path. The argv is now a
# single CHECKOUT-RELATIVE element and the script derives the queue from `process.argv[1]`,
# which keeps AC2's no-derivation and AC1's no-environment-variable clauses intact.
# LITMUS: every Then is confirmable from one of exactly three observable channels —
# (a) the QUEUE FILE's bytes after a payload is delivered on the hook's stdin,
# (b) the process's EXIT CODE and its stdout/stderr bytes as the harness observed them,
# (c) the `hooks.PostToolUse` entry as it stands in the written settings file.
# No source read of the enqueue script: this task asserts what the script DOES, never
# what it contains. The structural half — "no `src/` import, no store open, no
# workspace-identity derivation, no non-zero exit path" — is a property of every
# possible run and is already owned by `test/arch/acd-artifact-sync-hook-derivation-
# free.test.mjs`; it is deliberately NOT restated as a scenario here.
#
# PORTABILITY (ADR-001 / RESEARCH §1.6). Exec form is mandatory because the shell
# form's interpreter differs across the Windows control node, the Mac worker and the
# WSL worker. Every @executable scenario below drives the script by spawning it
# directly with argv and writing JSON to its stdin — no shell string, no `bash -c`, no
# heredoc — so the same steps run unchanged on all three nodes. TWO degrade conditions
# are NOT portably provokable and are deliberately absent from the tables: a full disk
# (ENOSPC) and a permission-denied directory (a Windows Administrator writes through a
# read-only ACL). Their portable stand-ins ARE in the table: a queue path whose parent
# directory does not exist, and a queue path that names a directory rather than a file
# — both reach the same "the append throws" branch. The genuinely cross-node claim (the
# exec entry spawns identically on all three machines) is the @manual scenario at the
# foot of this file; it needs three machines and cannot be an @executable step.
#
# Indicative names only (ADR-001): the enqueue script's own filename and the queue
# file's location are the story's to choose — every step below refers to "the enqueue
# script" and "the queue file named in the hook's argv", never to a fixed path.

@cli @adapter @distribution
Feature: the PostToolUse hook names each artifact write and enqueues it without deriving anything, and never fails the agent
  In order that an artifact reaches the control node because the agent wrote it — not because a re-scan happened to notice — and so that the report can never veto, slow or break the write it reports
  the installed hook must be a `PostToolUse` `command` hook in exec form whose body resolves the payload's path through an explicit per-tool map, appends one line to the argv-stamped queue file, and exits 0 under every condition

  Background:
    Given a scratch workspace whose `.claude/settings.json` carries aof's artifact-sync hook entry
    And the queue file named in that entry's argv, currently empty

  # HEADLINE (AC1) — the entry itself. Exec form (`args` present, `command` a bare
  # executable) is the cross-machine requirement, and the matcher is pinned to one
  # exact string. NOTE: there is deliberately NO `MultiEdit` case anywhere in this file
  # — the tool was measured removed from the shipped set (2.1.220), so the contract is
  # the matcher's EXACT VALUE, asserted here, rather than a scenario about a tool that
  # does not exist.
  @executable
  Scenario: the installed hook is a PostToolUse command hook in exec form with the matcher pinned to exactly Write|Edit|NotebookEdit
    Then the settings file's `hooks.PostToolUse` holds exactly one aof-authored group
    And that group's `matcher` value is the exact string "Write|Edit|NotebookEdit"
    And the group's entry has `type` "command", `command` "node", and a non-empty `args` array
    And the entry carries no shell command string — no `&&`, `|`, `;`, redirection or quoting in `command`
    And the `args` array holds exactly one element, the CHECKOUT-RELATIVE path of the enqueue script
    And that element carries no drive letter, no leading separator and no `..` segment, so a second checkout of this tracked file resolves it against its OWN root
    And the entry names no environment variable, and no absolute path for either the script or the queue

  # THE PER-TOOL PATH MAP (AC3) — the highest-value table in this story, because the
  # field name is NOT uniform: Write/Edit carry `tool_input.file_path`, NotebookEdit
  # carries `tool_input.notebook_path` (RESEARCH §1.2, measured live). The fourth row
  # is the failure mode the whole design exists to remove: a hook keyed only on
  # `file_path` would drop every notebook edit SILENTLY. A matched tool whose mapped
  # field is absent enqueues a coded `unresolved-path` line — the event is never
  # dropped, it is degraded loudly and the drain reports it (task 01).
  @executable
  Scenario Outline: the mapped path field is resolved per tool, and a matched-but-unresolvable payload degrades loudly instead of vanishing
    Given a `PostToolUse` payload whose `tool_name` is <tool_name> and whose `tool_input` carries <tool_input>
    When the payload is written to the enqueue script's stdin
    Then the queue file has gained exactly <lines> line(s)
    And the appended line is <line>
    And the script's exit code is 0
    And the script wrote nothing on stdout

    Examples:
      | tool_name    | tool_input                                  | lines | line                                                     |
      | "Write"      | file_path = ".../STORY.md"                | 1     | a record naming path ".../STORY.md" and no code        |
      | "Edit"       | file_path = ".../STATE.md"                | 1     | a record naming path ".../STATE.md" and no code        |
      | "NotebookEdit" | notebook_path = ".../analysis.ipynb"    | 1     | a record naming path ".../analysis.ipynb" and no code  |
      | "NotebookEdit" | file_path only (notebook_path absent)     | 1     | a record with code "unresolved-path" and no path         |
      | "Write"      | an empty object (no file_path)              | 1     | a record with code "unresolved-path" and no path         |
      | "Edit"       | absent (no tool_input key at all)           | 1     | a record with code "unresolved-path" and no path         |
      | "NotebookEdit" | an empty object (no notebook_path)        | 1     | a record with code "unresolved-path" and no path         |
      | "Bash"       | command = "npm test"                        | 0     | (nothing is appended — the map has no entry for this tool) |

  # THE LINE DERIVES NOTHING (AC2) — stated behaviourally rather than structurally. The
  # observable form of "derives nothing" is that the line's every value can be pointed
  # at in either the payload or the argv, and that the SAME queue file is appended to
  # from an unrelated cwd. The cwd clause is not incidental: cwd-derived identity is
  # TECH_DEBT item 4, the defect that silently discarded 100% of the worker→control
  # frames for days. The path is carried VERBATIM as the payload delivered it —
  # resolving a relative path to an absolute one would itself be a cwd derivation, so
  # canonicalisation is the drain's job (task 01), never the hook's.
  @executable
  Scenario: the appended line carries only payload values and argv values, and lands in the same queue file from any cwd
    Given a `Write` payload naming a file inside the worktree
    When the payload is written to the enqueue script's stdin with the process cwd set to the worktree
    And the identical payload is written to a second invocation with the process cwd set to the filesystem root
    Then the queue file has gained exactly two lines
    And each line parses as JSON on its own
    And each line's path value is byte-identical to the payload's mapped field value
    And every other value in each line is byte-identical to a value present in the payload or in the hook's argv
    And neither line carries a workspace id, an item ref, a node id, or any absolute path the payload did not supply
    And no second queue file was created anywhere

  # A HOT HOOK: `PostToolUse` on Write|Edit fires far more often than the per-prompt
  # `session ping` this repo already runs, so append ordering and concurrent appends
  # are part of the contract, not an edge case. Every line must survive whole — a torn
  # interleave would silently lose an artifact.
  @executable
  Scenario: consecutive and concurrent payloads each produce exactly one whole, separately-parseable line
    Given twenty `Write` payloads naming twenty distinct files
    When the first ten are delivered one after another
    And the remaining ten are delivered by ten concurrently-spawned invocations
    Then the queue file holds exactly twenty lines
    And every line parses as JSON on its own
    And every one of the twenty file paths appears in exactly one line
    And the first ten lines appear in the order they were delivered

  # "NEVER FAILS THE AGENT" IS A FIRST-CLASS CONTRACT (AC4), not a footnote. The exit
  # code is 0 under every queue-destination fault. `PostToolUse` cannot block (the tool
  # already ran, RESEARCH §1.4), so a non-zero exit would only ever show the model an
  # error about a sync it never asked for. Portability note: see the header — ENOSPC
  # and permission-denied are not portably provokable and their stand-ins are rows 1-3.
  @executable
  Scenario Outline: a queue that cannot be written exits 0 and stays silent — never a failed tool call
    Given the queue destination <destination>
    When a valid `Write` payload is written to the enqueue script's stdin
    Then the script's exit code is 0
    And the script wrote nothing on stdout
    And the script created no file or directory outside the queue destination
    And the outcome on disk is <outcome>

    Examples:
      | destination                                             | outcome                                                   |
      | names a parent directory that does not exist            | nothing is written                                        |
      | names an existing directory rather than a file          | nothing is written                                        |
      | names a path whose parent is a file, not a directory    | nothing is written                                        |
      | holds a torn final line left by a previously killed run | the new line is appended whole; the torn line is left as-is |
      | is a valid empty file                                   | exactly one whole line is appended                        |

  # THE PAYLOAD ITSELF CAN BE MISSING OR MALFORMED — the harness's contract is not
  # aof's to police, and the in-repo precedent (guard-test-isolation.mjs) already
  # exits 0 on both. An unparseable payload names no tool, so there is nothing to
  # enqueue: this is distinct from the coded `unresolved-path` case above, which is a
  # KNOWN tool whose mapped field is absent.
  @executable
  Scenario Outline: an absent or malformed payload exits 0 and enqueues nothing
    Given the enqueue script's stdin delivers <stdin>
    When the script runs
    Then the script's exit code is 0
    And the queue file has gained <lines> line(s)
    And the script wrote nothing on stdout

    Examples:
      | stdin                                        | lines |
      | nothing (stdin closes immediately, 0 bytes)  | 0     |
      | whitespace only                              | 0     |
      | text that is not JSON                        | 0     |
      | a JSON array rather than an object           | 0     |
      | valid JSON with no `tool_name` key           | 0     |
      | valid JSON whose `tool_name` is not a string | 0     |

  # THE DEGRADED PATH IS NEVER WORSE THAN TODAY (AC4). With the queue unwritable for a
  # whole run, the artifacts still reach the control node — via the reconciliation tick
  # that already runs and that STATE mandates keeping. This is the scenario that makes
  # the "degrades to the pre-existing behaviour" claim confirmable rather than asserted.
  @executable
  Scenario: with the queue unwritable for a whole run the artifacts still reach the control node on the reconciliation tick
    Given the queue destination cannot be written for the duration of a run
    And a worker daemon streaming an active worktree for item "43/03"
    When the agent writes ARCHITECTURE.md and two `tasks/*.feature` files into that worktree
    Then no line is enqueued
    And no tool call reported an error to the agent
    And within one stream tick the control node answers `aof work doc 43/03 ARCHITECTURE --json` with the new body
    And within one stream tick the control node's `aof work tasks 43/03 --json` lists both feature files

  # CROSS-NODE — the reason exec form is mandatory rather than preferred. This CANNOT
  # be an @executable step: it needs three machines with three different default hook
  # interpreters (bash on the Mac, bash on WSL, Git-Bash-or-PowerShell on the Windows
  # control node). The observable is identical on all three — one write, one line.
  @manual
  Scenario Outline: the exec-form entry spawns and enqueues identically on all three nodes
    Given aof is installed on <node> with the artifact-sync hook merged into that machine's `.claude/settings.json`
    When a single `Write` is performed by a real Claude Code session on that node
    Then that node's queue file gains exactly one line naming the written file
    And the session reported no hook error
    And the line's shape is byte-comparable to the line the other two nodes produced for the same write

    Examples:
      | node                                       |
      | the Windows control node                   |
      | the Mac worker (umairs-mac-mini)           |
      | the WSL worker (aof-wsl)                   |
