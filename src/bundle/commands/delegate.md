---
description: Set this project's two model decisions in one place — toggle Codex delegation on/off (default off), then always choose the orchestrator (main-session) model, Fable 5 or Opus 4.8. Pass `status` to just report the current settings.
argument-hint: "on | off | status"
allowed-tools: [Bash, Read]
---
<objective>
One command for the project's two model decisions: whether the ACD agents may delegate bulk/mechanical
work to the configured Codex delegation model (via Codex — **default off**, Claude does everything itself),
and which model the
**orchestrator** (main session) runs on — **Fable 5 or Opus 4.8**. On any on/off change you are ALWAYS
asked which orchestrator model to use.
</objective>

<process>
Parse "$ARGUMENTS" — one of `on`, `off`, or `status` (empty ≡ `status`).

1. **status** (or empty args): run `aof work delegation --show` and `aof work orchestrator --show`, report
   both current values, and stop. Make no changes.

2. **on / off**: run `aof work delegation <on|off> --no-model`. The `--no-model` flag is REQUIRED here — it
   stops the CLI from opening its own interactive picker (which cannot run when invoked this way); you will
   handle the orchestrator choice yourself in step 3. This command also re-renders the `codex-*` skills so
   the toggle takes effect (on ⇒ auto-invocable, off ⇒ not). Report the new delegation state, and tell the
   user to **reload this Claude Code session** so it picks up the changed skills.

3. **ALWAYS ask the orchestrator model** (never skip this on an on/off run): ask the user, in chat,
   "Which orchestrator model — **Fable 5** or **Opus 4.8**?" Wait for their answer, then run
   `aof work orchestrator <fable|opus>` with their choice. Report the model set, and remind them that
   `aof apply` re-renders `.claude/settings.json` so the next session launches on it.
</process>

<notes>
- Delegation defaults to **off** (Claude-only): the `codex-*` skills render non-auto-invocable, so Claude
  does everything itself. Turning it **on** re-renders them auto-invocable, so Claude may use the configured
  Codex delegation model for bulk/mechanical work when the Codex CLI is available. Either way you can always
  invoke `/codex-…` by hand.
- The change is picked up on the next session load, so remind the user to reload after toggling.
- Both orchestrator models stay fully available; this is a switch, not a one-way fallback. Fable 5 is the
  strongest but counts against token usage, so it is never a silent default — that is why you always ask.
</notes>

<output>
Confirm the delegation state and the orchestrator model now set. For `status`, report both current values
without changing anything.
</output>
