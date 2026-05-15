---
status: complete
closed: 2026-05-15
result: all_pass
---

# Phase 32 Live UAT

**Started:** 2026-05-15
**Status:** Complete
**Closed:** 2026-05-15

## Command Flow

Executed in a temporary project directory:

1. `node bin/aof.mjs init --codex`
2. `node bin/aof.mjs assets add agent builder --description "Builder" --runtime codex`
3. `node bin/aof.mjs boards create delivery --title Delivery --objective "Ship task management"`
4. `node bin/aof.mjs boards breakdown delivery --objective "Kanban task management" --id uat-proposal`
5. `node bin/aof.mjs boards breakdown apply delivery uat-proposal`
6. `node bin/aof.mjs boards task add delivery phase-32 --title "Phase 32" --refs '{"phase":"32"}'`
7. `node bin/aof.mjs boards task assign delivery phase-32 builder`
8. `node bin/aof.mjs boards execution update delivery phase-32 --status complete --message "UAT complete"`
9. `node bin/aof.mjs boards show delivery`

## Observed Result

- Board contained four tasks: three generated from objective breakdown and one manually phase-linked task.
- `phase-32` ended with board status `done`.
- Execution record ended with status `complete`.
- Execution record included three GSD ceremony commands.

## UAT Finding: Board UI Command Boundary

**Status:** fixed

During milestone UAT, the board management UI was found to be coupled to the asset setup UI. The expected product boundary is:

- `aof assets ui` opens the asset/configuration editing UI.
- `aof boards ui` opens the board/task management UI.

The current behavior makes board management part of the asset UI surface, which mixes two different workflows and makes UAT/audit expectations ambiguous.

Expected remediation:

- Added a dedicated `aof boards ui` command.
- Kept asset and board UI entry points separate while reusing shared server/API code internally.
- Ensured the board UI focuses on board/task management only.
- Added BDD/integration coverage proving the board launcher is separate.

Verification:

- `npm run test:integration` passed.
- `npm run ui:build` passed.
- `npm run check` passed.

Follow-up UAT note:

- Manual `aof boards ui` validation can still show the old asset UI if the shell resolves `aof` to a globally installed package instead of this repository's `bin/aof.mjs`.
- The local implementation now gives boards its own default port pair (`4187` UI, `4188` API) and passes board mode through Vite environment as well as the URL query string, so an existing browser tab at `/` does not fall back to asset mode after reconnect.

## UAT Finding: Board Workspace Clarity

**Status:** fixed

During follow-up UAT, the board workspace was confusing because creating a new board appeared as a full form beside the currently selected board. This made the active board and board creation feel like one workflow.

Remediation:

- Moved new board creation behind a compact left-rail button.
- Kept board navigation, diagnostics, refresh, and creation in the left rail.
- Kept the selected board workspace focused on board metadata, task creation, and kanban task flow.
- Replaced the hand-rolled column grid with the requested shadcn kanban component pattern.

Verification:

- `npm run ui:build` passed.
- `npm run test:integration` passed.
- `npm run check` passed.
- Live `node bin\aof.mjs boards ui --port 4197 --api-port 4198` smoke served the boards UI successfully.

## UAT Finding: npm Supply-Chain Safety

**Status:** fixed

During dependency review, UAT raised concern about recent npm zero-day and compromised-package incidents. The repository needed default guardrails so UI dependencies and future framework installs are not accepted without basic supply-chain checks.

Remediation:

- Added repo npm defaults for exact versions, high audit level, engine enforcement, disabled lifecycle scripts, and a seven-day release cooldown.
- Added `scripts/supply-chain-audit.mjs` to scan the lockfile for known compromised package versions, risky package families, suspicious payload filenames, non-registry sources, and unexpected install scripts.
- Added the audit script to `npm run check`.
- Applied the same safe npm environment to framework install execution.
- Documented the supply-chain working rules in `AGENTS.md`.

Verification:

- `node scripts\supply-chain-audit.mjs` passed.
- `node scripts\test-unit.mjs` passed.
- `node scripts\test.mjs` passed.
- `node scripts\ui-build.mjs` passed when rerun outside the Windows sandbox limitation that blocks esbuild helper process spawning.

## UAT Finding: GSD-Backed Board Lifecycle

**Status:** fixed

During follow-up UAT, board task creation needed to follow GSD milestone and phase ceremonies rather than allowing free-form task cards. A board backed by GSD should start from `$gsd-new-milestone`, then import roadmap phases as the default board tasks. New tasks must be added through GSD phase management and synced back into the board.

Remediation:

- GSD-configured projects now create boards with `executionProvider`, `defaultExecutionRuntime`, and GSD milestone/task-creation metadata.
- Added `aof boards sync <board-id>` to import `.planning/ROADMAP.md` phases as board tasks with `refs.phase`.
- Direct task creation is rejected for GSD-backed boards before and after sync, with guidance to run `$gsd-new-milestone`, `$gsd-phase add`, and board sync.
- The boards UI no longer presents a manual task creation form; it shows the GSD milestone/sync state and a phase sync action instead.
- Updated `.aof/boards/agent-boards/BOARD.json` with the default GSD execution runtime metadata.

Verification:

- `node scripts\supply-chain-audit.mjs` passed.
- `node scripts\test-unit.mjs` passed.
- `node test\integration\cli.mjs` passed when rerun outside the Windows sandbox limitation that blocks child Node process spawning.
- `node scripts\ui-build.mjs` passed when rerun outside the Windows sandbox limitation that blocks esbuild helper process spawning.

Follow-up UAT note:

- Initial sync behavior incorrectly defaulted to the repository's active `.planning/ROADMAP.md`, which caused `agent-boards` to import AOF v1.6 phases 28-32.
- Fixed by requiring an explicit board milestone binding before sync. Bare `aof boards sync <board-id>` now fails until the board has an attached backing milestone.
- Added `aof boards repair <board-id>` as the recovery path for boards without a backing milestone; it prepares the board for GSD and surfaces `$gsd-new-milestone` as the next action.
- Removed the accidentally imported `agent-boards` phase task files and reset the board milestone status to `pending`.

## UAT Finding: Board Cleanup Command

**Status:** fixed

During cleanup UAT, board removal was needed to delete experimental boards without adding destructive behavior to the UI yet.

Remediation:

- Added CLI-only `aof boards remove <board-id>`.
- Added `--dry-run` support so users can inspect what would be removed before deleting a board folder.
- Kept board removal out of the boards UI/API for now.

Verification:

- `node scripts\test-unit.mjs` passed.
- `node test\integration\cli.mjs` passed when rerun outside the Windows sandbox limitation that blocks child Node process spawning.

## UAT Finding: Mandatory Board Objective

**Status:** fixed

During final board lifecycle UAT, board creation needed to require an objective because GSD-backed boards use that objective as the input to `$gsd-new-milestone`.

Remediation:

- `aof boards create <id>` now requires `--objective`.
- The objective is stored in board GSD milestone metadata.
- The UI requires an objective before creating a board.
- Repair also requires an objective if a board does not already have one.

Verification:

- `node scripts\supply-chain-audit.mjs` passed.
- `node scripts\test-unit.mjs` passed.
- `node test\integration\cli.mjs` passed when rerun outside the Windows sandbox limitation that blocks child Node process spawning.
- `node scripts\ui-build.mjs` passed when rerun outside the Windows sandbox limitation that blocks esbuild helper process spawning.

## Final UAT Closure

**Status:** complete

Milestone-level UAT is closed. The user explicitly chose milestone-level validation rather than validating every phase individually. Remaining per-phase Nyquist validation artifacts are accepted process debt for this milestone closeout.

Final verification:

- `node scripts\check.mjs` passed when rerun outside the Windows sandbox limitations for child process spawning.
