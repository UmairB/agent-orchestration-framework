# Phase 22: Live Repository Verification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 22-Live Repository Verification
**Areas discussed:** Live Verification Scope, Interactive Asset Body Prompt, Setup UI Runtime Overrides, Setup UI Asset Cards, Apply Output, Generated Output Git Ignore

---

## Live Verification Scope

| Option | Description | Selected |
|--------|-------------|----------|
| BDD only | Rely on existing automated scenarios and close the milestone. | |
| Live repo verification | Exercise the rewritten CLI in new and existing repo shapes, fixing concrete findings. | yes |

**Notes:** Phase 22 exists specifically to prove the final command surface outside narrow fixture scenarios.

---

## Interactive Asset Body Prompt

| Option | Description | Selected |
|--------|-------------|----------|
| Keep optional body prompt | Continue asking for starter skill instructions in the terminal. | |
| Metadata-only interactive creation | Collect id, description, and runtimes only; scaffold body and direct editing to UI/editor. | yes |

**Notes:** User rejected entering markdown in the console during `aof assets add skill`. This is now captured as LF-01 and should be fixed during Phase 22.

---

## Setup UI Runtime Overrides

| Option | Description | Selected |
|--------|-------------|----------|
| Keep override checkboxes | Continue showing runtime overrides as peer rows in the Runtimes selector. | |
| Split targets from overrides | Runtimes selector shows only target runtimes; overrides move to explicit edit controls/sections. | yes |

**Notes:** User flagged the UI showing `Claude Code override` and `Codex override` as checkboxes with `native` badges. This is captured as LF-02 and should be fixed during Phase 22.

---

## Setup UI Asset Cards

| Option | Description | Selected |
|--------|-------------|----------|
| Keep current cards | Preserve the existing card layout and badges. | |
| Polish asset cards | Make asset rows/cards easier to scan and reduce metadata noise. | yes |

**Notes:** User flagged awkward id wrapping and repeated `native` badges on asset cards. This is captured as LF-03.

---

## Apply Output

| Option | Description | Selected |
|--------|-------------|----------|
| Keep technical action output | Continue printing action/source/runtime/reason details by default. | |
| Friendly default output | Show concise Created/Updated/Deleted/Skipped output by default, keeping technical detail for verbose/JSON. | yes |

**Notes:** User flagged `reason=file does not exist` as unnecessary and asked for friendlier CLI output with created-file ticks and suppressed technical messages. This is captured as LF-04.

---

## Generated Output Git Ignore

| Option | Description | Selected |
|--------|-------------|----------|
| Track generated outputs normally | Leave `.claude/` and `.codex/` files visible to git after apply. | |
| Ignore generated runtime output by default | Add an ignore strategy for generated runtime folders while allowing force-add/manual tracking. | yes |

**Notes:** User suggested `.gitignore` files inside `.claude/` and `.codex/` so generated duplicates are ignored by default while users can still manually add intentional files. This is captured as LF-05. The exact strategy should be decided during planning/execution: whole-folder ignore versus AOF-owned subpath ignore.

---

## the agent's Discretion

- Planner may decide live-test sequence and disposable repo setup.
- Planner may decide exact regression test shape for LF-01.
- Planner may decide exact UI layout for LF-02 as long as runtime targets and overrides are clearly separated.
- Planner may decide exact UI card layout for LF-03 as long as ids remain readable and metadata noise is reduced.
- Planner may decide exact friendly CLI symbols for LF-04, with ASCII fallback if needed.
- Planner may decide the generated-output ignore strategy for LF-05, but must preserve a way for users to intentionally track hand-owned runtime files.
- Planner must keep live writes contained and avoid real networked package install.

## Deferred Ideas

- Explicit asset body import, such as `--from-file`, is future product work unless separately planned.
