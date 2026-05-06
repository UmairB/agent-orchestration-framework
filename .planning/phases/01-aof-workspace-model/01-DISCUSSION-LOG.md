# Phase 1: `.aof` Workspace Model - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06T15:39:30+01:00
**Phase:** 1-`.aof` Workspace Model
**Areas discussed:** `.aof` folder shape and file ownership, root config compatibility, asset model, runtime override semantics, global verification

---

## `.aof` Folder Shape And File Ownership

| Question | Options Considered | Selected |
|----------|--------------------|----------|
| Primary config entry point | `.aof/aof.config.json`; `.aof/config.json`; `.aof/project.json` | `.aof/aof.config.json` |
| Source asset body storage | File-backed under `.aof/assets/<kind>/<id>/...`; inline in config; hybrid | File-backed under `.aof/assets/<kind>/<id>/...` |
| Runtime override location | Beside each asset; central `.aof/overrides/`; inline in config | Beside each asset |
| Lock/install state location | `.aof/aof.lock.json`; `.aof/lock.json`; `.aof/state/lock.json` | `.aof/aof.lock.json` |

**Notes:** User chose the recommended source-of-truth layout consistently.

---

## Root Config Compatibility

| Question | Options Considered | Selected |
|----------|--------------------|----------|
| Authoritative config when both exist | `.aof/aof.config.json`; error; root config | `.aof/aof.config.json` |
| `aof init` behavior with existing root config | Reconcile by default; refuse and require migration; leave root alone | Refuse and require migration |
| Explicit migration path | `aof migrate`; `aof init --migrate`; `aof config migrate` | `aof migrate` |
| Root file after migration | Leave untouched and warn; rename; replace with pointer | Leave untouched and warn |

**Notes:** Migration must be explicit and non-destructive.

---

## Asset Model

| Question | Options Considered | Selected |
|----------|--------------------|----------|
| Asset identification in config | Metadata with `path`; discover directories; per-asset manifests | Metadata with `path` |
| Rules/instructions model | Shared `rule`; runtime-specific kinds; defer | Shared `rule`, corrected to render Claude `.claude/rules/*.md` and Codex `AGENTS.md` |
| Path scoping representation | Generic `paths`; Claude override only; defer | Generic `paths` |
| Asset body file naming | Kind-specific defaults; `content.md`; arbitrary path | Kind-specific defaults |

**Notes:** User corrected the assistant on current Claude `.claude/rules/` support and clarified that Codex `.codex/rules/*.rules` should remain separate execution policy, while `AGENTS.md` may reference those files later.

---

## Runtime Override Semantics

| Question | Options Considered | Selected |
|----------|--------------------|----------|
| Override mutability | Runtime metadata/rendering fields only; any field; body only | Runtime metadata/rendering fields only |
| Unsupported capability behavior | Closest supported representation; fail without override; silently skip; capability-specific | Capability-specific |
| Runtime capability table location | Central source module; JSON schema only; docs only | Central source module |
| Override merge behavior | Shallow merge; deep merge; full replacement | Shallow merge |

**Notes:** User rejected a single global unsupported-capability rule. Capabilities must be handled one-by-one, as with Claude rules vs Codex guidance vs Codex policy rules.

---

## Global Verification

| Decision | Selected |
|----------|----------|
| Verification standard for new functionality | BDD tests are required for all new functionality |

**Notes:** User called this crucial and global. Phase 1 planning must treat BDD coverage as mandatory.

---

## the agent's Discretion

None.

## Deferred Ideas

- Codex `.codex/rules/*.rules` as a future execution-policy asset type.
