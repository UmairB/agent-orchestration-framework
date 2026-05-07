# Phase 8: Adapter Degradation Policy - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 8-Adapter Degradation Policy
**Areas discussed:** Where warnings live, Strict mode semantics, Lossy vs unsupported rules, Warning detail and user experience

---

## Where Warnings Live

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Warning surfaces | Validate+Render | Show warnings in `validate`/`doctor` and repeat them during `apply`/`sync`. | ✓ |
| Warning surfaces | Diagnostics only | Keep `apply`/`sync` quieter, but rendering may happen without a final warning. | |
| Warning surfaces | Render only | Show warnings closest to generated output, but diagnostics miss portability issues. | |
| Warning representation | Same diagnostic model everywhere | Use one shared warning object across commands. | ✓ |
| Warning representation | Separate CLI messages per command | Faster but risks drift between commands. | |
| Warning representation | Diagnostics structured, render plain text | Structured diagnostics, less structured render warnings. | |
| Dry-run placement | Before actions | Print warnings before create/update/delete actions. | ✓ |
| Dry-run placement | After actions | Keep action plan first, but warnings are easier to miss. | |
| Dry-run placement | No dry-run warnings | Dry-run stays file-action-focused but less useful for planning. | |
| Persistence | Computed only | Do not store adapter warnings in lock state. | ✓ |
| Persistence | Persist summary counts | Record counts only. | |
| Persistence | Persist full warnings | Strong audit trail, but noisy and stale-prone. | |

**User's choice:** Validate+Render, shared warning object, dry-run warnings before actions, computed only.
**Notes:** Warning behavior should be consistent across diagnostics and render planning while keeping `.aof/aof.lock.json` focused on generated files and package/install state.

---

## Strict Mode Semantics

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Strict surfaces | All commands that emit warnings | `validate`, `doctor`, `apply`, and `sync` all fail under `--strict` when adapter warnings exist. | ✓ |
| Strict surfaces | Diagnostics only | Render commands warn and continue. | |
| Strict surfaces | CI flag only | Warn in Phase 8, enforce later. | |
| Write behavior | Pre-write fail | `apply --strict` and `sync --strict` fail before generated files or lock updates. | ✓ |
| Write behavior | Write safe outputs, skip warned outputs | More permissive but creates partial state. | |
| Write behavior | Write everything, exit non-zero | Unsafe for CI. | |
| Force interaction | Force does not bypass strict | `--force` remains drift-only. | ✓ |
| Force interaction | Force bypasses warnings | Convenient but weakens CI semantics. | |
| Force interaction | Separate override flag | Possible future escape hatch. | |
| Flag availability | Add it now | Add user-facing `apply --strict` and `sync --strict`. | ✓ |
| Flag availability | Validate/doctor only | Partial ADPT-04 delivery. | |
| Flag availability | Sync only | Strict belongs only to lifecycle command. | |

**User's choice:** Strict mode applies to all warning-emitting commands, fails before writes, is not bypassed by `--force`, and should be exposed on `apply` and `sync` in Phase 8.
**Notes:** This makes adapter warnings suitable for CI and avoids partial generated state.

---

## Lossy vs Unsupported Rules

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Codex rule guidance | Mapped info, not warning | Existing `AGENTS.md` mapping is intentional supported behavior. | ✓ |
| Codex rule guidance | Lossy warning | Warn because Codex lacks a direct Claude-rules equivalent. | |
| Codex rule guidance | No diagnostic | Treat as ordinary rendering. | |
| Hook gaps | Warn and skip that runtime's hook | Avoid silently inventing behavior; keep supported runtimes rendering. | ✓ |
| Hook gaps | Warn and inline best effort | Preserve output but may not match intent. | |
| Hook gaps | Hard error always | Safest but blocks multi-runtime configs. | |
| Runtime extensions | Ignore silently | Non-matching runtime ignores namespaced escape hatches. | ✓ |
| Runtime extensions | Info diagnostic | Visible but noisy. | |
| Runtime extensions | Warning | Too noisy for valid config. | |
| Unsupported combinations | Warning and skip output | Visible issue, supported runtimes continue, strict mode can fail. | ✓ |
| Unsupported combinations | Hard error | Blocks writes without `--strict`. | |
| Unsupported combinations | Silent skip | Violates Phase 8 goal. | |

**User's choice:** Intentional mapped behavior is informational; unsupported or unrepresentable runtime output warns and skips; runtime-specific extensions are silent for non-target runtimes.
**Notes:** This preserves existing Codex rule behavior while making new lossy/unsupported cases explicit.

---

## Warning Detail And User Experience

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Warning fields | Full actionable detail | Include code, severity, config path, primitive kind/id, runtime, generated path if known, reason, remediation. | ✓ |
| Warning fields | Medium detail | Code, primitive id, runtime, reason. | |
| Warning fields | Minimal detail | One-line human warning only. | |
| Human output | Grouped warning block | Compact `adapter-warnings:` block before actions and in diagnostics output. | ✓ |
| Human output | Inline per action | Precise but can clutter actions. | |
| Human output | Summary only by default | Less noise but easier to miss remediation. | |
| JSON output | Top-level `adapterWarnings` | Stable CI parsing across diagnostics and dry-run commands. | ✓ |
| JSON output | Inside `diagnostics` only | Simpler but less explicit. | |
| JSON output | Inside each action | Precise for render actions but unsuitable for diagnostics-only commands. | |
| Remediation | Prescriptive when safe | Suggest exact safe fix when obvious. | ✓ |
| Remediation | Neutral only | Explain but avoid suggested changes. | |
| Remediation | Docs link only | Shorter but less useful in terminal. | |

**User's choice:** Full actionable warning details, grouped human output, top-level `adapterWarnings` in JSON, and prescriptive remediation when safe.
**Notes:** This creates a clear BDD and CI contract for adapter policy.

---

## the agent's Discretion

No areas were delegated to the agent's discretion.

## Deferred Ideas

None.
