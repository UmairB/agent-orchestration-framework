# Phase 2: Runtime Rendering And Lock State - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06T00:00:00+01:00
**Phase:** 2-Runtime Rendering And Lock State
**Areas discussed:** Lock State, Generated Output, Dry Run

---

## Lock State

| Option | Description | Selected |
|--------|-------------|----------|
| Generated manifest | Records every generated file path, source asset id/kind, target runtime, content hash, and generation timestamp. | yes |
| Reapply recipe | Records selected runtimes, package/framework intent, and enough config inputs to reproduce later install, but less detail per file. | |
| Minimal install record | Records only selected assets/runtimes/frameworks, keeping the lock small. | |

**User's choice:** Generated manifest
**Notes:** The lock should prove exactly what AOF generated and support audit/drift detection.

| Option | Description | Selected |
|--------|-------------|----------|
| Warn and require force | Detect hash mismatch, skip overwriting that file, and require an explicit force flag. | yes |
| Overwrite generated files | Treat runtime folders as output and always replace files AOF owns. | |
| Write conflict copies | Keep the edited file and write a generated version beside it. | |

**User's choice:** Warn and require force
**Notes:** Manual edits to previously generated runtime files are drift and should not be overwritten by default.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, intent only | Record declared framework package, target runtimes, scope, version/range if known, and dry-run/install intent. | yes |
| No, assets only | Leave all framework lock state to Phase 3. | |
| Full framework state now | Include installed files and installer result details in Phase 2. | |

**User's choice:** Yes, intent only
**Notes:** Full GSD install behavior remains Phase 3 scope.

---

## Generated Output

| Option | Description | Selected |
|--------|-------------|----------|
| Header marker plus lock entry | Include a small generated-by marker where format allows; rely on lock hashes for exact ownership. | yes |
| Lock entry only | Avoid generated content markers; ownership lives entirely in lock state. | |
| Dedicated manifest in each runtime folder | Write `.claude/aof-generated.json` / `.codex/aof-generated.json` beside generated files. | |

**User's choice:** Header marker plus lock entry
**Notes:** Markers are helpful, but lock entries remain authoritative.

| Option | Description | Selected |
|--------|-------------|----------|
| Prune owned stale files | If the previous lock says AOF generated the file and it has not drifted, remove it during apply. | yes |
| Warn only | Report stale generated files but leave cleanup to the user. | |
| Never delete output | Only write/update files; stale files remain until manually removed. | |

**User's choice:** Prune owned stale files
**Notes:** AOF owns generated output, but only non-drifted stale files should be removed automatically.

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic merged sections | One generated `AGENTS.md` with stable section order by asset id, each section clearly labeled. | yes |
| Concatenate in config order | Preserve the user's config order exactly. | |
| Reject collisions | Fail if multiple assets map to the same `AGENTS.md`. | |

**User's choice:** Deterministic merged sections
**Notes:** Stable section ordering supports reproducible generated output.

---

## Dry Run

| Option | Description | Selected |
|--------|-------------|----------|
| Action plan with reasons | List create/update/delete/skip/drift-warning per file, runtime, source asset, and reason. | yes |
| Simple file list | Only show paths that would be written or removed. | |
| Full generated content preview | Print rendered content for each file in addition to actions. | |

**User's choice:** Action plan with reasons
**Notes:** Dry-run should explain what would happen without writing files or lock state.

| Option | Description | Selected |
|--------|-------------|----------|
| Same analysis as apply | Compute the same ownership, hash, drift, and stale-file decisions as apply. | yes |
| Best-effort preview | Predict writes from current config without full previous-state analysis. | |
| Render-only preview | Show only what current config would render. | |

**User's choice:** Same analysis as apply
**Notes:** Dry-run and real apply should share analysis to avoid misleading previews.

| Option | Description | Selected |
|--------|-------------|----------|
| Never write lock state | Report would-be lock manifest summary but leave `.aof/aof.lock.json` unchanged. | yes |
| Write a temporary preview lock | Create `.aof/aof.lock.preview.json` for inspection. | |
| Update lock but not runtime files | Allow dry-run to refresh lock state without writing runtime files. | |

**User's choice:** Never write lock state
**Notes:** Dry-run must be side-effect free for both runtime files and lock state.

---

## the agent's Discretion

None.

## Deferred Ideas

- Full managed GSD install flow, interactive install behavior, and framework install-result tracking remain Phase 3 scope.
- Codex `.codex/rules/*.rules` execution-policy assets remain a separate future asset type, as decided in Phase 1.
