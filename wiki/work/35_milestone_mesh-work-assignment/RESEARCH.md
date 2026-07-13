---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Facts only, each with a source/measurement and the constraint it imposes.
  No decisions, no architecture, no scenarios — that is the architect's ADRs (DESIGN/ARCHITECTURE.md).
-->
# 35 · Mesh Work Assignment — Research

Measured against this repo (`C:\Source\umair\aof`, branch `feat/issuance-routing-console-sea-release`,
commit `957ed69`), Node v22.22.2, git 2.47.0.windows.1, Windows 11.

## 1. The execution seam — confirmed: no in-`src` execution driver exists

**Question.** Does `src/` contain any "execute/spawn a runtime to run a ref" path, or does only the ACD
skill/agent layer drive execution?

**Measured answer: confirmed — none exists in `src/`. It must be built.**

- `src/run-store.mjs` is exhaustively a state-machine + persistence store. Its own header says so:
  "the run-record store, the state-machine validator, the runs/ path seam" (`src/run-store.mjs:1-6`).
  It never imports `child_process`, `node-pty`, or any spawn primitive — confirmed by
  `Grep spawn|execFile|exec\(|child_process` over `src/`, which returns 48 files, and
  `src/run-store.mjs` is **not** among them.
- `src/commands/run-start.mjs` (`work:run-start`) only mints a run record already in state `running`
  (`src/run-store.mjs:294-296` `startRun`) and republishes it to the mesh store
  (`src/commands/run-start.mjs:146-162`). It calls no runtime binary.
- `src/commands/run-complete.mjs` (`work:run-complete`) only performs the terminal `running→outcome`
  transition (`completeRun`, `src/run-store.mjs:416-429`) plus a status rollback on failure
  (`src/commands/run-complete.mjs:68-74`). It calls no runtime binary.
- `src/command-core.mjs:166-195` is the full registry of every command aof exposes (28 commands as of
  this milestone). There is no `run:execute`, `run:drive`, or equivalent — the registry is a closed list
  and none of its entries spawns a runtime against a ref.
- The only actual driver of "run this ref" today is the ACD **skill layer**: `src/bundle/commands/continue.md`
  is itself an *interactive Claude Code slash command* whose `<process>` spawns `aof-developer` /
  `aof-architect` / `aof-qa` / `aof-designer` via the `Task` tool (`src/bundle/commands/continue.md:20-47`).
  It is markdown prompt content, not `src/` code, and it **never calls `work:run-start` / `run-complete`** —
  confirmed by `Grep run-start|run-complete|run-status|run-retry` over `src/bundle/commands/continue.md`
  returning no matches.
- `src/bundle/commands/autonomous.md` is the only skill that wires the run-store lifecycle in
  (`aof work run-start <ref>` / `run-complete --outcome …` / `run-retry`,
  `src/bundle/commands/autonomous.md:69-89`) — but it does so **from inside its own already-running,
  interactive Claude Code session**, wrapping calls to `aof:refine` / `aof:continue` / `aof:verify` as
  its own in-session sub-steps (`src/bundle/commands/autonomous.md:41-66`). It is not a standalone
  process that can be spawned headlessly and left to drive a ref to a terminal state unattended — it
  *is* the interactive agent loop.

**Constraint this imposes.** A worker in milestone 35 has nothing in `src/` to reuse for "drive a ref to
done/failed." Whatever executes the assigned ref must either (a) invoke a configured runtime headlessly
with a prompt telling it to do the equivalent of `aof:continue`/`aof:autonomous`'s job, or (b) a new
purpose-built driver must be written. Today, `run-store.mjs`'s state machine is only ever a bookkeeping
side-effect *of* an interactive session, never the thing that causes work to happen.

## 2. The configured runtimes — headless invocation is real and measured on this machine

**Question.** How is a runtime meant to be invoked to run a ref? Is `claude`/`codex` invocable headlessly?

**Measured answer: `runtimes: ["claude","codex"]` in `.aof/aof.config.json` is scaffolding/adapter
selection, NOT an execution-invocation config — but both binaries independently support real, measured
headless/non-interactive exec modes.**

- `.aof/aof.config.json:46-49` — `runtimes: ["claude", "codex"]`.
- Every `src/` consumer of "runtimes" is about **which adapter artifacts to generate** (MCP servers,
  hooks, project docs, slash-command bundles) per runtime — e.g. `src/adapters.mjs:89-94` filters
  `mcpServers`/`hooks` by `runtimes.has("claude"|"codex")`; `src/frameworks.mjs:58-64` maps a runtime to
  its CLI-flag rendering; `src/model.mjs:4` defines the closed `RUNTIMES` vocabulary consumed by
  `supportedRuntimes()`. None of this is spawn/invocation code — it is `aof:provision`/bundle-sync logic
  (verified by reading `src/frameworks.mjs`, `src/adapters.mjs`, `src/model.mjs`).
- The only real **spawn** path in the repo touching `claude`/`codex` binaries is
  `src/terminal-providers.mjs` + `src/terminal-ws.mjs`: a `node-pty`-backed **interactive terminal
  session** exposed over the board UI's WebSocket terminal panel (`resolveProvider`,
  `src/terminal-providers.mjs:88-92`; `pty.spawn`, `src/terminal-ws.mjs:60,74`). It launches `claude`/
  `codex` with **no args** (`PROVIDER_META`, `src/terminal-providers.mjs:22-26`, `args: []`) — i.e. an
  ordinary interactive REPL session a human/agent types into via the PTY, not a headless run.
- **Installed on this machine** (measured):
  - `claude` → `C:\Users\Umair\.local\bin\claude.exe`, version `2.1.201 (Claude Code)`.
  - `codex` → `C:\Program Files\nodejs\codex` / `codex.cmd`, version `codex-cli 0.130.0`.
- **`claude` headless mode is real and measured:** `claude --help` documents `-p/--print` — "starts an
  interactive session by default, use -p/--print for non-interactive output" — plus
  `--output-format text|json|stream-json`, `--session-id`, `-r/--resume`, `--max-budget-usd`,
  `--allowedTools`/`--disallowedTools`, `--permission-mode`, and `--dangerously-skip-permissions`. Ran
  `claude -p "reply with exactly the word OK and nothing else" --output-format json` and got a
  **single structured JSON result** on stdout including `session_id`, `result: "OK"`,
  `total_cost_usd: 0.132615`, `duration_ms: 5197`, `stop_reason: "end_turn"`, `terminal_reason: "completed"`.
  This proves a scriptable, parseable, exit-and-return invocation shape exists today.
  - Two CLI flags directly matter for a worktree-scoped worker: `--add-dir <dirs>` (grant tool access
    outside cwd) and `-w/--worktree [name]` (claude's OWN worktree-creation flag exists too, though a
    worker driving its own `git worktree add` beforehand and launching `claude -p` with cwd set to that
    worktree is the more controllable shape).
- **`codex` headless mode is real and measured:** `codex --help` documents a first-class `exec` (alias
  `e`) subcommand — "Run Codex non-interactively." `codex exec --help` documents `-C/--cd <DIR>` (working
  root), `-s/--sandbox <read-only|workspace-write|danger-full-access>`,
  `-a/--ask-for-approval <untrusted|on-failure|on-request|never>` (`never` is explicitly documented as
  the non-interactive choice — "Execution failures are immediately returned to the model"), `--json`
  (JSONL event stream to stdout), `-o/--output-last-message <FILE>` (the agent's final message written to
  a file — directly consumable by a driver without stdout-parsing), and `--skip-git-repo-check` /
  `--ephemeral`. `resume` supports resuming a previous exec session by id.

**Constraint this imposes.** A worker CAN drive an assigned ref headlessly using installed, real tooling
— `claude -p --output-format json` or `codex exec --json -o <file>` — both exit with a parseable result
and a definite process exit code. Neither requires the interactive PTY/terminal-ws path. The `runtimes`
config key as it exists today answers "which adapter files to scaffold," not "how to invoke a runtime to
run a ref" — a worker execution driver cannot reuse it as-is for invocation semantics; it would need to
be extended or a new config surface added (an architecture decision, not reported further here).

## 3. Minimal viable worker execution — a bounded path exists with installed tooling

**Question.** What is the smallest thing that satisfies "run the assigned ref in a worktree and reach a
terminal run state" without a full interactive agent session?

**Measured facts (not a design choice):**

- The full sequence **`git worktree add <path> <ref-or-commit>` → `work:run-start` (mint running) →
  spawn `claude -p "<instruction referencing the ref>" --output-format json` (or `codex exec --json -o
  last.txt`) with `cwd` set to the worktree → parse the process's exit code / JSON result →
  `work:run-complete --outcome done|failed`** is fully expressible with commands/binaries that exist and
  were exercised in this research (worktree add measured in §4; `run-start`/`run-complete` are existing
  registered commands, `src/command-core.mjs:183-184`; `claude -p`/`codex exec` measured in §2).
- This path is **bounded and scriptable**: `claude -p --output-format json` returns exactly one JSON
  object and then the process exits (measured — the earlier invocation returned and the shell prompt came
  back; `stop_reason`/`terminal_reason` fields are present in the payload for a driver to branch on).
  `codex exec` likewise is documented to run to completion and exit (its `--json` JSONL stream plus
  `-o/--output-last-message` gives a driver two independent completion signals without needing to
  understand the agent's internal reasoning).
- What is **not** measured/known: whether a single non-interactive `claude -p`/`codex exec` turn is
  *sufficient* to actually complete a real work item (build code to green, run tests, update STATE.md) the
  way the multi-agent `aof:continue` flow does — `continue.md`'s flow explicitly fans out to four
  different specialised subagents with a Review gate (`src/bundle/commands/continue.md:17-47`). A single
  headless turn has no equivalent built-in Review/QA/architect pass; it is at most a rough proxy for the
  *build* half, and only if the invoking prompt reconstructs equivalent instructions (reading
  SPEC/STORY/tasks, updating status, etc.) inline in the `-p` prompt text or via `--append-system-prompt`.
- Both CLIs support `--output-format json`/`--json` durable machine-parseable output and a
  `session_id`/resume mechanism (`claude --session-id`/`-r`; `codex exec resume`), which is the primitive
  a retry-lineage-aware worker would need if it re-attempts a failed assignment — this maps cleanly onto
  the existing `retryOf`/`attempt`/`sessionId` fields `run-store.mjs` already carries
  (`src/run-store.mjs:194-221`).

**Constraint this imposes.** A bounded, testable, non-interactive execution path is technically possible
today with zero new external dependencies (worktree + existing run-store commands + one `claude -p`/
`codex exec` call). Whether that single headless turn is a *faithful enough* substitute for the full
`aof:continue` multi-agent build+review flow is an open scope question the Three Amigos must weigh — the
research only establishes that the mechanical plumbing exists, not that a one-shot headless call reaches
the same quality bar as the interactive skill flow.

## 4. `git worktree` on Windows — measured behavior

All commands run against this actual repo in a disposable scratch path under the session's temp
scratchpad; the real working tree (`C:\Source\umair\aof`) was never touched (`git status --short`
confirmed clean before and after).

- **Detached-at-commit works and is fast.** `git worktree add <path> HEAD` succeeded in ~1.16s for this
  repo's 1285 tracked files, landing at `957ed69 (detached HEAD)`. Measured directly (`time git worktree
  add … HEAD`).
- **Branch checkout is exclusive; detached-commit checkout is not.** `git worktree add -b
  wt-test-branch-a <path> HEAD` succeeded; a second `git worktree add <path2> wt-test-branch-a` (same
  branch, different path) **failed**: `fatal: 'wt-test-branch-a' is already used by worktree at '<path>'`
  (exit 128). By contrast, a second **detached** `git worktree add <path3> HEAD` at the identical commit
  **succeeded** with no conflict. Measured directly.
- **Concurrent `git worktree add` calls do not contend.** Fired 5 simultaneous `git worktree add
  <pathN> HEAD` background processes; all 5 returned exit 0 and produced 5 independent working
  directories with no observed `.git/index.lock` failure. Measured directly (parallel shell backgrounding).
- **Clean remove is complete; dirty remove is refused by default.** `git worktree remove <path>` on a
  clean worktree succeeds and deletes both the worktree directory and its `.git/worktrees/<name>` admin
  metadata (confirmed `.git/worktrees/` itself disappears when the last entry is removed). Adding an
  uncommitted/untracked change first and retrying `remove` fails: `fatal: '<path>' contains modified or
  untracked files, use --force to delete it` (exit 128); `git worktree remove --force` then succeeds
  (exit 0). Measured directly.
- **A held read file handle did not block removal on this Windows setup.** Opened a read-mode file
  handle inside a worktree (Node `fs.openSync(...,'r')`, held 5s) and ran `git worktree remove` against
  that worktree concurrently — it succeeded (exit 0) rather than failing on a Windows sharing-violation.
  This is a narrow measurement (read-mode handle only); it does not rule out failures from
  exclusive-write locks, an antivirus scanner holding a handle, or a still-running child process with an
  open working-directory handle (Windows can refuse directory deletion when a process's cwd points inside
  it) — those were not exercised here.
- **Manual deletion (bypassing git) leaves stale, blocking metadata.** `rm -rf` on a worktree directory
  without calling `git worktree remove` leaves `.git/worktrees/<name>` behind; `git worktree list` then
  shows that entry as `prunable`, and a subsequent `git worktree add` **at the same path** fails: `fatal:
  '<path>' is a missing but already registered worktree; use 'add -f' to override, or 'prune' or 'remove'
  to clear` (exit 128). Running `git worktree prune -v` clears it (`Removing worktrees/<name>: gitdir
  file points to non-existent location`), after which the path can be reused. Measured directly.
- **`git worktree lock`/`unlock` work as an explicit in-flight guard.** `git worktree lock <path> --reason
  "…"` marks the entry `locked` in `git worktree list`; `git worktree remove` on a locked worktree fails
  (`fatal: cannot remove a locked working tree, lock reason: …`, exit 128) unless `-f -f` is passed;
  `git worktree unlock` then allows a normal `remove` to succeed. Measured directly.
- **`core.longpaths` is already `true`** on this machine (`git config --get core.longpaths` → `true`),
  and `core.autocrlf` is `true`. Git version is `2.47.0.windows.1`.
- **Path length.** The longest tracked file path relative to repo root is 171 characters (a `.feature`
  file under `wiki/work/11_milestone_.../tasks/`). `node_modules` is gitignored and is not materialized by
  `git worktree add` (worktrees only populate tracked files) — a worker worktree would need its own
  `npm install`/equivalent if the assigned ref's tooling needs `node_modules`, which is a real cost/step,
  not a git limitation. Combined with a long scratch/temp base path (this session's scratchpad path alone
  is ~140 characters), a worktree path + a 171-char relative path could approach Windows' legacy 260-char
  `MAX_PATH`; `core.longpaths=true` mitigates this for git's own operations, but non-git tooling invoked
  inside the worktree (npm, some editors/linters) may not honour long-path opt-in uniformly on Windows.

**Constraint this imposes.** Worktree mechanics are solid and fast for this repo's size; the two real
Windows-flavoured risks worth carrying into design are (a) path-length exposure if the worker's worktree
base path is itself deep (e.g. nested under a long profile/temp path) combined with this repo's ~170-char
relative paths, and (b) directory-deletion failures when a *child process* (not just an open file handle)
still has its cwd inside the worktree at cleanup time — not exercised here, and the likelier real-world
failure mode than a simple open file handle. Branch-based worktrees are exclusive per branch (one worktree
per branch, enforced by git) — a design implication if two assignments ever target the same branch
concurrently; detached-commit worktrees have no such restriction.

## 5. Concurrency reality — multiple worktrees of the same repo coexist cleanly

**Question.** Can multiple worktrees coexist for concurrent assignments? Any git-level contention?

**Measured answer: yes, they coexist cleanly for this repo; no contention observed on `.git/index.lock`,
`.git/config`, or `.git/worktrees` under 5-way concurrent creation.**

- 5 concurrent `git worktree add <pathN> HEAD` invocations (measured in §4) all succeeded with independent
  file trees under `.git/worktrees/par1..par5`; `git worktree list` showed all 5 correctly afterward.
- Each worktree gets its own `.git/worktrees/<name>/{gitdir,HEAD,...}` admin entry
  (`cat .git/worktrees/*/gitdir` showed a distinct absolute path per entry) — worktrees do not share an
  index/HEAD, so concurrent commands (`git status`, `git add`, a hypothetical commit) inside *different*
  worktrees do not contend on the same `.git/index.lock`, only on the shared object database (reads,
  which are lock-free) and shared refs (writes to the *same* ref, e.g. two worktrees trying to update the
  same branch, which git already serializes/rejects — not exercised beyond the branch-exclusivity result
  in §4).
- The one exclusivity rule measured is **per-branch**, not per-repo: a branch already checked out in one
  worktree cannot be checked out in a second (§4); this is git's designed safety, not a bug, and applies
  regardless of concurrency — it would surface deterministically (not as a race) if two assignments
  targeted the same branch ref rather than distinct detached commits or distinct branches.

**Constraint this imposes.** Concurrent assignments are safe at the git-mechanics level as long as each
gets either its own detached commit checkout or its own distinct branch — assigning two concurrent
in-flight tasks to the *same* branch name is the one combination git itself will refuse, and any worker
design must pick branch names (or stay detached) accordingly.

## Summary of constraints for the Three Amigos

1. **No execution driver exists in `src/` today** (§1) — building one (or wiring a headless runtime
   invocation) is in-scope work for this milestone's worker story, not a reuse of existing plumbing.
2. **`runtimes` config is scaffolding metadata, not invocation config** (§2) — do not assume the existing
   key tells a worker *how* to invoke `claude`/`codex`; that mapping does not exist yet.
3. **Headless invocation is real and measured** (§2, §3): `claude -p --output-format json` and `codex exec
   --json -o <file>` both give a scriptable, bounded, parseable single-shot execution — but neither
   reproduces the multi-agent build+review depth of `aof:continue`/`aof:autonomous` out of the box. This
   is a scope/quality-bar question for refine, not a blocker.
4. **Worktree mechanics are solid on Windows** (§4, §5) with two flagged risks: path-length exposure
   under a long base path, and untested behavior when a *process* (not just a file handle) has its cwd
   inside a worktree at cleanup time. Branch-name collisions across concurrent assignments are the one
   git-enforced exclusivity to design around.
5. **The control→worker directive channel does not exist yet** — `src/control-stream-server.mjs` today is
   worker→control ingest only (confirmed by reading the file's header and the milestone-34
   ARCHITECTURE.md's own framing of "WS eases a **future** control→worker command channel," ARCHITECTURE.md:222-223)
   — milestone 35 is squarely responsible for adding that direction; nothing to reuse there either.
6. **The global store is `node:sqlite`**, Node's built-in experimental SQLite binding
   (`src/global-work-store.mjs:68`, `await import("node:sqlite")`), confirmed working on the installed
   Node v22.22.2 but flagged by Node itself as experimental ("SQLite is an experimental feature and might
   change at any time") — inherited risk from milestone 34, relevant since the worker's run/assignment
   records flow through this same store.
