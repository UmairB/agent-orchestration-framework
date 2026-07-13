@executable @cli @adapter @distribution
Feature: The assistant hook seam wires Claude Code lifecycle events to `aof session start|ping|end`
  In order that a real coding assistant feeds session presence with no per-session manual step — while keeping
  the `aof session` CLI as the assistant-AGNOSTIC seam any tool can integrate — the Claude Code hooks in
  `.claude/settings.json` map SessionStart → `aof session start`, UserPromptSubmit → `aof session ping`, and
  SessionEnd → `aof session end`, each passing the session/workspace identity the hook delivers.

  # ARCHITECTURE 38/ADR-002 (aof session is the seam) + RESEARCH.md §2 (MEASURED: SessionStart, UserPromptSubmit,
  # Stop, and SessionEnd all fire; each delivers a distinct JSON payload over STDIN, never argv; CLAUDE_SESSION_ID
  # is also present in env as a redundant identity channel; Anthropic docs give NO crash/kill guarantee for
  # SessionEnd — so this wiring is best-effort and TTL self-expiry (task 01) is the LOAD-BEARING liveness, not a
  # fallback). RESEARCH.md §2 measured the repo's own `.claude/settings.json` has an EMPTY SessionStart and no
  # UserPromptSubmit/SessionEnd — both need adding. The wiring is verifiable WITHOUT a live assistant: assert the
  # settings emit the three hook→command mappings and that `aof session` reads identity from the hook payload
  # (stdin JSON / CLAUDE_SESSION_ID), assistant-agnostically. Keep it argv-form, shell-less where a command is spawned.
  #
  # @qa: complete the Examples — SessionStart→start, UserPromptSubmit→ping, SessionEnd→end mappings present;
  # the ping cadence sits under the TTL headroom; a malformed/absent payload is handled (session identity from
  # the redundant env channel); the seam names `aof session` (not a Claude-Code-specific verb).

  Background:
    Given the repo's `.claude/settings.json`

  Scenario: the three lifecycle hooks map to the aof session verbs
    Then SessionStart invokes `aof session start`
    And UserPromptSubmit invokes `aof session ping`
    And SessionEnd invokes `aof session end`

  # CORRECTED at aof:verify 38 (finding F4). This scenario previously read "When the payload carries
  # session_id, workspace, and repo" — a payload shape the vendor NEVER sends, contradicting this milestone's
  # OWN RESEARCH.md §2.2, which measured the real field set as `session_id`, `transcript_path`, `cwd`,
  # `hook_event_name`. The implementation faithfully built that false contract, so every real hook exited 1 and
  # the feature was inert in production. The workspace/repo are derived from `cwd` — see
  # 07_bug-hook-identity-from-cwd.feature, which owns the corrected behaviour.
  Scenario: `aof session` takes session/workspace identity from the hook payload, assistant-agnostically
    # the CLI reads identity from stdin JSON (or the redundant CLAUDE_SESSION_ID env channel), never a
    # Claude-Code-only argument shape — so a second assistant integrates by calling the same three verbs.
    Given a hook fires `aof session ping` with a JSON payload on stdin
    When the payload carries the REAL measured field set — session_id, transcript_path, cwd, hook_event_name (RESEARCH §2.2)
    Then the CLI resolves identity from the stdin JSON
    And the workspace and repo are derived from the payload's `cwd` (task 07), never read from absent payload fields
    And the resolved verb is `aof session` (the agnostic seam), not a Claude-Code-specific command
    And no session identity is read from argv

  # NB (developer-amigo feasibility): Claude Code's hook `command` is a single SHELL STRING by vendor design
  # (RESEARCH.md §2.2) — there is no argv-array hook shape to assert. So the testable invariant is that the
  # composed command is ONE simple `aof session <verb>` invocation with NO embedded shell chaining
  # (`&&` / `|` / `;` / redirection) tacked onto it — not "argv-form".
  Scenario Outline: each lifecycle event maps to exactly one aof session verb, a single unchained invocation
    Then the `<event>` hook invokes `<command>`
    And the composed hook `command` string is one simple `aof session <verb>` call with no embedded shell chaining (`&&`/`|`/`;`/redirection)
    And the command namespace is `aof session` (assistant-agnostic — not a Claude-Code-only verb)

    Examples:
      | event            | command             |
      | SessionStart     | aof session start   |
      | UserPromptSubmit | aof session ping    |
      | SessionEnd       | aof session end     |

  Scenario Outline: session identity resolves across the two channels — stdin JSON preferred, env the redundant fallback
    # RESEARCH.md §2: identity arrives BOTH as stdin JSON and as CLAUDE_SESSION_ID in env. The CLI prefers the
    # structured stdin payload, falls back to the env channel when the payload is absent/malformed, and refuses
    # LOUDLY only when NEITHER channel yields identity (never a silent no-op that would lose a live session).
    Given the stdin payload is <stdin> and the env CLAUDE_SESSION_ID is <env>
    Then session identity resolves from <source>
    And the outcome is <outcome>

    Examples:
      | stdin              | env       | source        | outcome                          |
      | valid JSON         | set       | stdin JSON    | ping succeeds                    |
      | valid JSON         | unset     | stdin JSON    | ping succeeds                    |
      | absent (empty)     | set       | env channel   | ping succeeds                    |
      | malformed (not JSON) | set     | env channel   | ping succeeds                    |
      | absent (empty)     | unset     | (neither)     | loud coded refusal, no record    |
      | malformed (not JSON) | unset   | (neither)     | loud coded refusal, no record    |

  Scenario: the UserPromptSubmit ping cadence sits under the TTL headroom, so a live-but-quiet session never falsely expires
    # the cadence↔TTL relationship the milestone rests on: UserPromptSubmit fires per prompt, well within the TTL
    # window (task 01 default), so an assistant open but idle between prompts keeps re-pinging inside the TTL and
    # is never falsely dropped. If the cadence ever exceeded the TTL, a quiet session would flap idle — asserted
    # NOT to be the case.
    Given the resolved session TTL (task 01) and the UserPromptSubmit ping cadence
    Then the ping cadence is strictly less than the TTL (comfortable headroom)
    And a session pinged once per prompt stays live between prompts
