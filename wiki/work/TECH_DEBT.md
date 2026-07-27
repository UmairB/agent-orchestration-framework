# aof work stream — tech debt

Known structural debt in the aof codebase: things that are wrong by design (not merely unfinished),
recorded with the evidence that exposed them and the shape of the intended fix. Sibling to
[ROADMAP.md](ROADMAP.md) — the roadmap is *deferred want*, this is *accrued cost*. Promote an item
into a milestone/story (`aof:add-milestone` / `aof:add-story`) when it's time to pay it down.

Each item states: **what's wrong**, **how it bites**, **the fix**.

**Item 0 is the umbrella.** Items 1–6 are its symptoms, not six unrelated bugs.

> **Promoted 2026-07-26:** items 0–7 → [`42_milestone_structural-overhaul`](42_milestone_structural-overhaul/SPEC.md).
> This file remains the evidence record; the milestone is the payment plan.

---

## 0. The system is flaky because nothing has one home — it needs a top-to-bottom overhaul

**Status:** open (raised 2026-07-26 by the operator, after a two-machine soak in which every layer
failed separately). **Severity:** the reason the other items exist.

**What's wrong.** The codebase has grown by accretion: each defect was fixed *where it surfaced*,
with a comment explaining the scar, rather than by changing the design that produced it. The result is
147 files / 41k lines in which the same fact is derived in many places, the same act has several
doors, and failure is handled by silence. Measured 2026-07-26:

| Signal | Measured | What it means |
|---|---|---|
| `src/` | 147 files, 41,348 lines | 3,163-line `cli.mjs`, 2,163-line `mesh-worker-execution.mjs` |
| Comment lines in `src/` | 12,945 (31%) | history narrated in prose beside the code |
| Scar markers (`FINDING F<n>`, `review fix`, `VERIFICATION (`, `ADR-<n>`) | 1,670 | the code documents its own past failures instead of being reshaped to remove them |
| Empty `catch` blocks | 43 across 22 files | failure isolation implemented as silence |
| `workspaceIdFor(` call sites | 17 | one identity rule, re-derived seventeen times, each with its own fallback |
| Test files / arch tests | 519 / 221 | a large suite, 10 of which fail before any change (item 5) |

The recurring shape, in four forms:

1. **No single seam for an act.** "Continue this item" had three independent doors — the board's local
   PTY, the fleet's assign, and a slash command typed by hand — each with different behaviour. Which
   machine your work ran on depended on which button you pressed. (Being fixed: `work:continue`.)
2. **The same fact derived independently, everywhere.** A workspace's identity is recomputed from a
   path at 17 sites, each with its own `?? workspaceIdFor(...)` fallback. When two of them disagreed
   across machines, the worker→control stream silently discarded 100% of its frames for days.
3. **Failure handled by silence.** 43 empty catches. Every one is a place the system can fail while
   reporting success.
4. **History kept in comments rather than in the design.** A third of `src/` is prose, much of it
   narrating bugs from previous milestones inline. It reads as an audit trail, but it does not stop
   the next instance — the same defect class (silent catch, id mismatch, stale build) recurred *on the
   same day* it was documented.

**How it bites.** The system is unpredictable in a specific way: each layer works in isolation and the
seams between them fail quietly. On 2026-07-26 alone — the worker streamed to an id the control node
refused, the control node discarded the frames without a word, the daemons had nowhere to log it, half
the install was running a stale binary, and 10 arch tests were already red so nothing gated any of it.
No single bug there was hard; finding them required reading SQLite stores by hand on two machines.

**The fix — an overhaul, not more patches.** This is a design job, and it should be scoped as
milestones, not squeezed in beside feature work. The shape:

- **One home per concept.** Workspace identity, "where does work run", "what is this node's state",
  "what build am I" — each gets exactly one module that owns it, and every other caller asks it.
  Delete the re-derivations rather than adding a seventeenth.
- **One door per act,** with the *decision* (where/how) inside it and the faces (CLI, board, fleet)
  reduced to transport. `work:continue` is the pattern; refine/verify/run need the same.
- **Errors are events, not silence.** No empty catch survives; every degrade path emits a coded event
  to a real sink (items 2 and 3).
- **The build is honest about itself** — decoupled from the binary, stamped, and visible at runtime
  (item 1).
- **Green means green.** Fix or delete the dead gate so the suite can hold the line (item 5).
- **Then delete.** Most of the 1,670 scar markers describe defects whose *cause* is gone or should be.
  Comments explaining why a workaround exists are debt; the fix retires them.

**Sequencing note.** Attempted as one rewrite this will fail — the system is a live two-machine soak.
Do it as: (a) stop the bleeding (items 2, 3, 5 — logging, no silent failure, a working gate), because
without them no overhaul can be verified; then (b) consolidate the seams (identity, one-door-per-act);
then (c) the build (item 1). Each step should leave the soak running.

---

## 1. The binary is the whole program, not a wrapper around the CLI

**Status:** largely addressed (2026-07-26). `aof.exe` is now a payload-first LAUNCHER: when
`<exeDir>/src/cli.mjs` exists (the install ships the real `src/` + prod `node_modules` beside the
exe) the CLI loads from disk — a source change deploys as `node scripts/install-local.mjs` (file
copy, no SEA build) + restart. The embedded bundle remains only as the release/single-file fallback
(`AOF_SEA_EMBEDDED=1`); a broken payload fails loudly, never a silent embedded fallback. The build
is stamped (`BUILD_ID.json`; `aof --version` and both daemons' startup lines report
source/payload/embedded + build id) and `.bak` binaries are pruned to the newest 3 on install.
Remaining: `aof mesh status` does not yet surface a REMOTE node's build id, and the deploy is still
per-machine (the Mac's npm-symlink path was already restart-based). **Severity:** high — it taxes every
single change.

**What's wrong.** `aof.exe` is supposed to be a thin wrapper around the CLI. It isn't. It is a Node
SEA (single executable application): the Node runtime *plus every `src/*.mjs` file compiled into one
88 MB binary* (`scripts/build-sea.mjs` → `dist-sea/` → `~/.aof/bin/aof.exe`). The installed tree next
to it holds only `bundle/`, `ui/`, `node_modules/`, `node-pty-sidecar/` — there is no `src/`. The
program's actual source lives *inside* the executable.

**How it bites.**

- **Every source change needs an 88 MB rebuild + reinstall.** Editing one line of
  `src/mesh-launcher.mjs` changes nothing on this machine until the whole SEA is rebuilt and copied
  into `~/.aof/bin`. There is no "just restart the daemon" path.
- **Installs strand the running build, silently.** Windows won't overwrite a running `.exe`, so the
  installer renames the live binary aside (`aof.exe.bak.<ts>`) and writes the new one. The running
  process keeps executing the renamed image — Windows holds it by handle, not by path — so it runs the
  *old* code indefinitely. Measured 2026-07-26: `mesh serve` was on the new build while `mesh ui` was
  still executing `aof.exe.bak.20260726T004025`, serving a stale UI bundle. Nothing anywhere reports
  which build a process is running.
- **Disk cost.** Each install leaves another 88 MB backup. Measured: **15** `.bak` binaries in
  `~/.aof/bin`, ~1.3 GB, none ever reclaimed.
- **The two machines behave differently, so fixes deploy differently.** The Mac worker installs `aof`
  as an npm symlink straight into its repo clone — a `git pull` + restart is the whole deploy. Windows
  needs build + install + restart. The same change therefore ships two different ways, and it is easy
  to update one node and believe you updated both.

**The fix.** Decouple the program from the binary. `aof.exe` becomes what it was meant to be — a
launcher that resolves and runs the CLI from a known location — so a source change is picked up by a
restart, not a rebuild. Sketch:

- ship the JS payload *beside* the exe (`~/.aof/bin/src/`, versioned), the way `bundle/` and `ui/`
  already are, and have the launcher execute it;
- keep the SEA only for the distributable single-file artefact (a release concern), not for the
  development/soak loop;
- record the build id in every daemon's startup line and expose it (`aof mesh status`), so a stale
  process is *visible* rather than inferred;
- prune `.bak` binaries on install (keep the last N).

**Note on the shape of the fix.** This is deliberately not "make install faster". As long as the code
is inside the binary, a running daemon and its source can silently disagree — which is the failure that
actually costs time.

---

## 2. Daemons have nowhere to log

**Status:** largely addressed (2026-07-26, milestone 42 wave (a)): every daemon event lands as JSONL
in `~/.aof/mesh/logs/<proc>.log` (size-rotated, one kept generation) — mesh-serve tees all launcher
warnings + a build-stamped `daemon-started`; mesh-ui records its startup; `aof mesh logs [proc]
[--tail N]` reads it (absent-not-error, torn lines surfaced as `raw`). Remaining: the REMOTE-node
read (`--node <id>`, over the fabric) and `--follow`. **Severity:** high — it is why item-level bugs stay undiagnosed
for days.

**What's wrong.** The long-running processes (`aof mesh serve --serve`, `aof mesh ui`) write
diagnostics with `console.error`, and when supervised by `aof-mesh-desktop.exe` that output goes
nowhere. Newest file in `~/.aof/mesh/logs/` on the control node: **18 July** — eight days stale while
the daemon ran continuously. The Mac worker only had a readable log because it was launched by hand
with `> /tmp/aof-mesh.log 2>&1`.

**How it bites.** The worker→control worktree stream was refusing 100% of its frames
(`unknown-workspace`) on every tick for days. The control node knew, computed the refusal, and had
nowhere to say it. The bug was found by reading the SQLite store directly, not from any log.

**The fix.** A real sink: every long-running process writes JSONL to `~/.aof/mesh/logs/<proc>.log`
(rotating), plus `aof mesh logs [--follow] [--node <id>]` to read it — including on a worker, so
nobody needs to redirect stdout by hand to see what a remote node is doing.

---

## 3. Silent `catch {}` is load-bearing

**Status:** ADDRESSED (2026-07-26, milestone 42 wave (a) — ratchet armed and swept the same day):
all 97 silent-catch sites across 28 files (the honest count: comment-only bodies are runtime
silence) now report coded degrade events via `degrade.mjs` (throttled, never-throwing, into the
item-2 sink family as `degrade.log`). `acd-no-new-silent-catch`'s baseline is the sanctioned floor —
the reporter and the sink themselves — so the gate is an outright ban everywhere else: best-effort
now means "does not crash", and it always says something. **Severity:** high.

**What's wrong.** "Best-effort, never crash the daemon" is implemented throughout as an empty catch,
which in practice means "fails invisibly". Cases found in one day:

- `pushActiveWorktreeState` referenced an out-of-scope variable; the `ReferenceError` was swallowed, so
  the live worktree stream was a silent no-op that reported nothing for days (`5383c60`);
- `applyStreamFrame`'s refusal result was returned into a `.catch(() => {})` nobody read, so every
  discarded frame was invisible (fixed 2026-07-26 via `onFrameSkipped`);
- two more were written *the same day*, in the terminal spawn path, by the same author who had just
  fixed the first two.

**How it bites.** A one-character scope bug becomes undiagnosable. Failure isolation is correct;
silence is not.

**The fix.** A fitness test that fails the build on an empty `catch {}` / `catch (e) {}` body in
`src/` (this codebase already enforces structure this way — `test/arch/acd-*`). Best-effort must mean
"does not crash", never "says nothing".

---

## 4. Workspace identity is derived from the local path

**Status:** open (raised 2026-07-26). **Severity:** medium-high — it breaks cross-machine reasoning.

**What's wrong.** A workspaceId is `sha256(absolute project path)` (`workspaceIdFor`). The *same repo*
therefore has a different id on every machine: `let-shield-portal` is `1f164bd03ea535da` on the control
node and `14d86b2b2196077a` on the Mac's scoped checkout. `config.mesh.workspaceId` can override it,
but the mesh clone path writes `mesh.repo.workspaceId` — which nothing reads as identity.

**How it bites.**

- The worker holds a `global_node_workspaces` membership row for the mesh id with **no descriptor** for
  it, so `resolveNodeWorkspaces` logs `workspace-workdir-unresolvable … (no-descriptor)` every ~5s,
  forever.
- The worker's own stream frames are stamped with its *launch-cwd* workspace id, which the control node
  has no descriptor for, so they are refused (`unknown-workspace`). This is what stopped the worktree
  stream from ever landing a row; fixed for worktree deltas in `f623a6a` by stamping the assignment's
  id, but the underlying identity mismatch is untouched.
- Every CLI mesh verb resolves the workspace from **cwd**: `aof mesh assign 18 --withdraw` run from
  the wrong directory reports "No assignment exists" while the row sits in the store (bit the
  operator-recovery path live, 2026-07-26) — the same one-fact-many-derivations class.
- A daemon launched from a non-workspace directory **published its launch cwd as a fleet
  workspace** (measured 2026-07-26: `C:\WINDOWS\system32` via Task Scheduler's default cwd,
  `~/.aof/bin` via an installer-dir launch) — the machine-wide `mesh.enabled` merges into ANY cwd.
  **Gated 2026-07-26**: `meshGlobalPropagationDecision` now also requires the workspace's own
  config on disk (`mesh-workspace-unconfigured` refusal); `scripts/prune-projection.mjs` is the
  recovery tool for rows that already landed. The underlying cwd-derived identity remains open.

**The fix.** Make the mesh workspace id the checkout's *own* local identity: write `mesh.workspaceId`
into the scoped checkout's `.aof/aof.config.json` at clone time, so publish, descriptor and frames all
agree on one id per repo across machines. Needs a migration story for the duplicate ids already in the
projections.

---

## 5. Part of the fitness gate is dead

**Status:** ADDRESSED (2026-07-26, milestone 42 wave (a)): the arch suite runs at zero standing
failures (694/0 across 219 files). Dead tests retired with their eliminated subjects
(`acd-sync-root-set`, `acd-claim-relay-independent`, the lease test in `acd-fleet-reclaim-guarded`);
the bundle-member counts in `acd-command-namespace` are derived, not hard-coded. Remaining caveat:
the FULL suite still cannot run on the control node while daemons hold :4182 (the focused-run
discipline stands). **Severity:** medium — the gate reads green-ish while not
running.

**What's wrong.** Measured 2026-07-26: **10 of 700 arch tests fail before any change is made.**
`test/arch/acd-sync-root-set.test.mjs` reads `src/mesh-sync.mjs`, which does not exist (ENOENT ×3) and
imports `acd-mesh-sync-record-neutral.test.mjs`, which does not exist either. One test file exports
something that is not runnable (`t.run is not a function`). `acd-command-namespace` asserts a hard-coded
count of 21 bundle command members that no longer matches.

**How it bites.** A permanently-red suite can't gate anything: a real regression is indistinguishable
from the standing noise, and nobody reads the output.

**The fix.** Delete or repair the tests whose subject no longer exists, derive the bundle-member count
instead of hard-coding it, and get the arch suite to zero — then it can be a gate.

---

## 6. The board bridges a worker's rows and nothing else

**Status:** partially addressed (2026-07-26). The doc-body and run-record legs are BUILT: projection
schema v5 adds `work_item_docs`/`work_item_runs`, the worker streams its active worktree's record-doc
bodies + run records as a `worktree-content` frame (same connection, same assignment workspaceId,
same descriptor gate), and `work:doc`/`work:run-status` fall back to the projection when the local
checkout cannot answer (marked `fromWorker`/`reportedBy`; local disk wins when present). Unit-verified
(focused suites green); **NOT yet verified on the live two-machine soak** — needs build+install+restart
on both nodes. The CONSOLE leg is still open: the board still has no embedded view of a worker's live
session (the fleet mirror link is the interim). **Severity:** high — the board
states things it cannot then show you.

**What's wrong.** The worker→control stream bridges the *item list* into the projection, so the board
correctly shows a milestone's stories as the worker has them. Every drill-down still reads the CONTROL
node's local disk. Measured 2026-07-26 — the control checkout for item 18 contains exactly `SPEC.md`
and `STATE.md`: no `stories/`, no `runs/`. Yet the board lists seven stories.

**How it bites.** Three separate dead ends, all the same cause:

- clicking a streamed story → `Could not load STORY: No item resolves to ref "18/03"` (`work:doc`
  resolves against the local work dir);
- the RUNS tab reads the local `runs/` directory → "No runs yet", for an item that is running;
- there is no console. The board's terminal dock is a LOCAL pty; a worker's live session is only
  visible in the fleet UI's read-only mirror. The board says "Running on \<node\>" and offers no way to
  watch it.

So the board asserts a state it cannot evidence, which is worse than showing the local truth — the
operator is told work exists and then told it does not.

**The fix.** Finish the bridge, by the same rule as the rows (from the worker, over the fabric, never
from a branch): doc bodies and run records ride the same projection path; the terminal is the fleet's
existing mirror, which the board should embed instead of its local dock. Until then the board should
at least *say* the content lives on \<node\> rather than rendering a resolution error.

---

## 7. A restarted worker does not reclaim its own runs

**Status:** open (carried from the 2026-07-25 handover; hit again 2026-07-26 — **twice**: the
morning stall, and run `39ec5149` in the afternoon, whose agent died ~11 minutes in — subagents
"stopped by user" in the transcript, cause undiagnosable without item 2's log sink — while the
assignment sat `running` and the fleet mirror showed "waiting for output" for a process that no
longer existed; recovered by manual withdraw). The scope is wider than restarts: **any dead run is
indistinguishable from a live one** — no heartbeat-driven liveness on the assignment, no watchdog,
no startup reclaim. This is the single biggest source of perceived flakiness and the top of
milestone 42's wave (a)/(b) work with items 2 and 3. **Severity:** high (upgraded 2026-07-26).

**ADDRESSED in code (2026-07-26, milestone 42 wave (b) — live-drill verification pending):**
(1) the PTY liveness probe — a child that dies without an exit event settles `failed/agent_died`
within ~15s; (2) worker startup reclaim — persisted worktree dirs are reported
`failed/daemon-restarted` before new work, made safe by the new apply-seam invariant *a terminal
assignment never regresses*; (3) the control dual-staleness reclaim read run records LOCAL-ONLY, so
every cross-machine assignment was skipped forever — it now falls back to the streamed v5
`work_item_runs` record, then to the assignment's own frozen `updatedAt`.

**What's wrong.** Killing a worker daemon mid-run strands `runs/<node>/<runId>.json` in `running` and
its control-side assignment in `running`. Nothing clears them: the item is blocked until heartbeat
staleness (~15 min) or a manual `aof work run-complete <ref> --run-id <id> --outcome cancelled` plus
`aof mesh assign <ref> --withdraw`.

**How it bites.** Any worker restart can block an item, and the recovery is two commands on two
different machines that an operator has to know. It cost a manual unblock on 2026-07-26.

**The fix.** On startup a worker knows its own `running` records cannot be alive — reclaim them (and
report the reclaim) before accepting new work.

---

## 8. CRLF jams the bundle drift-guard — `aof work update` was silently dead on Windows

**Status:** open (found 2026-07-27, while propagating the architect codebase-health charter).
**Severity:** medium — the bundle self-update path, the mechanism that keeps agent charters current,
did not work on the control node.

**What's wrong.** The bundle renderer writes generated files (`.claude/agents|commands`,
`.codex/agents|skills`) with LF and records LF-content hashes in `.aof/aof.lock.json`. Those files
are also git-tracked, and git on Windows checks them out CRLF. On-disk hash ≠ lock hash for **every**
generated file, so `aof work update` classified all 59 as `drift-warning: was modified; not
overwriting` — permanently, with no hand edit anywhere. (Cosmetic sibling: the drift message exists
twice — `render-plan.mjs` says "use --force to overwrite", `cli.mjs` drops the hint — same fact, two
homes.)

**How it bites.** Charter updates shipped in the bundle never reach the runtime copies: on 2026-07-27
the developer, researcher and continue charters were all stale on the control node, and the new
architect codebase-health duty needed `--force` to land. Silent — update reports success with
drift-warnings that read as "protecting your edits" when there are none.

**The fix.** One newline rule for generated bundle files: pin them LF in `.gitattributes`
(`.claude/** text eol=lf`, `.codex/** text eol=lf`, plus `.aof` templates) and renormalize once — or
have the drift check hash newline-normalized content. Either way, drift must mean *content* drift.
And one home for the drift message.
