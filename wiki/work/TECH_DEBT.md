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

---

## 9. `planApplyActions` silently overwrites any CO-AUTHORED file it has no lock entry for

**Status:** open (raised 2026-08-01 by the architect, during milestone 43's Decide stage; verified
from source at `277ada5`). **Severity:** medium-high — it is item 8's sibling and m42 leg d4's
`writeLock` defect a third time, and it is *silent*.

**What's wrong.** `planApplyActions` (`src/render-plan.mjs:13-49`) gates every drift protection on a
**prior lock entry**. For a file that exists on disk with **no** prior entry, each guard is skipped in
turn and the code falls through to line 48:

```js
actions.push(action("update", output, prior ? "generated content changed" : "existing file will be overwritten"));
```

An **ungated `update`** — no `--force` required, no drift warning surfaced, straight through to
`executeApplyActions` → `writeText`. Both `aof work init` (`src/work-init.mjs:30,91` — `previousLock =
null`, so *every* existing unlocked file is treated as safe to overwrite) and `aof work update`
(`src/work-update.mjs:27,100`) route through it. This is **worse than the drift-warning case**, not
equivalent to it: item 8's CRLF bug at least *reported* that it was protecting something.

**How it bites.** The live instance is `.claude/settings.json` — a genuinely hand-maintained file
(hooks for four events, `permissions.deny`, `sandbox.filesystem`, `enabledPlugins`,
`extraKnownMarketplaces`) that the aof lock has never recorded, because the 34-file bundle manifest
carries zero entries for it. `claudeSettingsJson()` (`src/runtime-config.mjs:21-28`) builds the file's
**entire** body from `config.hooks` + `config.settings` alone, so the moment a `claude`-runtime hook is
added to `.aof/aof.config.json`, the next `work init`/`work update`/`assets apply` deletes every one of
those sections without a word. It is **dormant, not absent**: this repo's config has no `hooks` key
today. Milestone 43 adds one.

The class is wider than that one file: *any* file with an author besides aof and no lock entry is
overwritable this way.

**The fix.** Two halves, and the first is not the interesting one.
- **Narrow (milestone 43, `43_story_artifact-sync-on-write`, 43/ADR-002):** `.claude/settings.json`
  stops being whole-file rendered at all — `renderRuntimeConfigOutputs` (`src/adapters.mjs:101-111`) no
  longer emits it, and a merge writer splices only aof's own self-identifying hook entry (the
  `mergeLock` / `writeSidecarPatch` pattern: read, overlay this caller's keys, write the union). Gated
  by `test/arch/acd-claude-settings-co-authored.test.mjs`, which arms the moment a claude hook lands in
  config.
- **Wide (this item):** make the fall-through refuse instead of overwrite. A desired output whose target
  exists on disk with **no prior lock entry** should be a `drift-warning`, not an `update` — i.e. the
  same protection a *previously generated* file gets, since "aof has never written this" is strictly
  stronger evidence of foreign authorship than "aof wrote it and someone changed it". Files aof
  exclusively owns are unaffected because they either don't exist yet (`create`) or already match
  (`skip`). Needs a pass over `work init`'s `previousLock = null` semantics, which currently *rely* on
  the permissive branch.

---

## 10. `src/` has no interior structure: a 3,254-line god-file, 108 flat root modules, and a face-named module the spine now imports

**Status:** open (raised 2026-08-01 by the architect, during milestone 43's Decide stage). **Severity:**
medium — nothing is broken, but every measurement in item 0's own table has moved the wrong way, and
this is the shape item 0 named.

**What's wrong.** Measured 2026-08-01 against item 0's 2026-07-26 baseline, then re-measured through
milestone 43's stories (`.mjs` only, so every column is comparable — 2026-08-02, ADR-013/C7):

| Signal | 2026-07-26 | 2026-08-01 | 43/01 | 43/02 | 43/03 | 43/04 | Trend |
|---|---|---|---|---|---|---|---|
| `src/` `.mjs` files | 147 | **202** | 203 | 203 | 208 | **211** | +44% |
| `src/` `.mjs` lines | 41,348 | **50,744** | 51,378 | 51,927 | 52,980 | **54,126** | +31% |
| `src/` **root-level** `.mjs` | — | **99** (of 202) | 100 | 100 | 104 | **106** | half the tree is one flat directory |
| `src/mesh-worker-execution.mjs` | 2,163 | **3,174** | 3,187 | 3,187 | 3,187 | 3,187 | **+47%** — the largest file in the repo |
| `src/mesh-launcher.mjs` | — | — | — | 1,585 | 1,660 | **1,693** | 2-in / **30-out** — the widest out-degree in `src/` |

**The root's biggest FAMILY is now measurable, and it is the partition that would pay best** (measured
2026-08-03, 43/04's review): of the 106 root-level modules, **25 are `mesh-*`** and **20 are `work-*`**
— 42% of the flat root is two subjects with no directory. A `src/mesh/` grouping alone would take the
root under 82. 43/04's own two additions are on ADR-013/C7's test (`cache-provenance.mjs`, a 1-out
near-leaf required by ADR-012/B4; `mesh-resync.mjs`, ADR-010/R4.2's transport beside the
`mesh-recovery-push.mjs` it mirrors) — so, again, not sprawl by subject.

**A duplicated SHAPE now has two instances, and the third must extract it** (ADR-014/E7):
`mesh-resync.mjs` is `mesh-recovery-push.mjs`'s structure re-typed — two wire kinds, four identical
lifecycle strings, `ensure*Table` / `request*` / `read*` / `list*Requests` / `mark*State` /
`build*Frame` / `build*ResultFrame` / `apply*ResultFrame` / `run*DispatchTick`, ~270 lines each, keyed
on a different column with one deliberate policy difference. Two instances is honest; the pattern is
"a durable operator-requested row + a control-tick directive dispatch + an authorization-checked result
apply", and the **third** instance owes the shared seam rather than a third copy. Each instance also
costs **two** store openers (item 12), which is the same duplication measured from another angle.

**A THIRD shape, and it is NAME drift rather than size** (measured 2026-08-04, 43/05+06's review,
ADR-016/G10): **`src/board-worker-stream.mjs` has become the node's shared cache-read module while
still being named for one face.** It grew **191 → 351 lines (+84%) in one wave** and its dependents
went **5 → 9** (`aof graph impact`, 2,454 nodes / 6,135 edges) — the three new arrivals are
`work-read.mjs`, `mesh-launcher.mjs` and `commands/doctor.mjs`, i.e. **the spine now imports a module
named for a face.** In substance it is not a layering inversion: the module contains no render and no
HTTP code, its own header already says its subject widened to "the node's read of the shared cache,
of which 'as the worker sees it' was the first instance", and putting the three new readers there
rather than opening a twentieth store connection was the right call (item 12). **But ADR-003 drew
"the spine must not import a face" against `board-mesh-execution.mjs` on exactly this reasoning, and
a module whose NAME asserts a layer its nine dependents contradict is how the next author gets it
wrong.** The cure is a subject-named home for the cache-read half (`src/cache-read.mjs`, or the
`src/mesh/` partition above taking it), and it is a rename touching nine importers — a decision, not
a tidy-up, and a scope explosion inside any single story. **Trigger: the tenth dependent, or the
`src/mesh/` partition, whichever comes first.**

**A SECOND file is now on the same trajectory: `src/mesh-launcher.mjs`.** Graph-measured 2026-08-02
(2,389 nodes / 6,212 edges): it imports **30** modules and is imported by 2 — the same *sink* shape, not
hub shape, that item 0 named on `mesh-worker-execution.mjs`. 43/03 added ~60 lines of drain
*orchestration* inline to `pushActiveWorktreeState` (the drain *mechanism* correctly went to a new leaf,
`src/artifact-sync.mjs`, so this is the residue rather than the whole block). ADR-013/C7 makes the same
requirement ADR-012/B4 made of the store module: **43/04 and 43/05 add a call site to it, never a
block.** Nothing in either file's growth was a bad diff on its own; that is the point of the item.

**The root-sibling count moved for the first time in this milestone.** 99 → 104. ADR-013/C7 verified on
the graph that each of 43/03's four new root modules is ADR-mandated and leaf-shaped
(`work-artifacts.mjs` 5-in/0-out, `claude-settings.mjs` 4-in/2-out, `work-content-read.mjs` 2-in/3-out,
`artifact-sync.mjs` 2-in/1-out) — so this is not sprawl by *subject*, and no ratchet was imposed. It is
sprawl by *directory*, and ADR-005 still owes a fifth (`work-read.mjs`) in 43/06. The ceiling stays
dishonest until the grouping below exists; the number is recorded here so the overhaul is scheduled
against evidence rather than an impression.

`mesh-worker-execution.mjs` imports 17 modules and is imported by 3 (codebase graph, 2026-08-01: 1960
nodes / 5754 edges). It is not a hub anyone depends on — it is a **sink** that keeps absorbing. Its 47%
growth in five weeks is the single clearest instance of the accretion item 0 describes: each milestone
adds its worker-side leg *inside* the file that already has one, because that is where the surrounding
context lives.

The flat root is the same disease at the directory level. There are real interior directories
(`commands/`, `effects/`, `memory/`, `notion/`, `import/`, `spine/`, `bundle/`), and 99 modules that
belong to none of them — mesh transport, worktree/git, stores, work-stream engines, UI servers and
config machinery all as siblings. Nothing in a review ever says "this is the 100th".

**How it bites.** Not as failures — as *review blindness*. A change to the worker's execution path
lands in a 3,000-line file where nobody can see what else it touches; a new module lands in a directory
whose membership means nothing, so no reviewer can tell whether it belongs. Both are how item 0's
"no single seam for an act" reproduces itself one milestone at a time.

**The fix.**
- **Split `mesh-worker-execution.mjs` along its own seams.** It already has them, marked by its own
  section comments: worktree materialisation + branch/base decisions, the PTY/agent driver, the
  settle/push/cleanup path, and the directive handler that sequences them. Each is a module; the
  handler keeps the sequencing and gets short. Milestone 43 deliberately does **not** attempt this —
  its two stories that touch the file add a *call site* each (43/ADR-008 requires the branch-advance
  logic to live in `mesh-worktree.mjs`, which already owns every git verb), so the file does not grow
  by another block. That constraint is a stopgap, not the fix.
- **Give `src/` interior directories and a ratchet.** Group the root by subject (`mesh/`, `git/`,
  `store/`, `work/`), then a fitness function on root-level file count so the N+1th sibling fails CI
  instead of needing a reviewer to notice. The ratchet is only honest *after* the grouping — a ceiling
  imposed on today's 99 would fail every unrelated milestone for a debt none of them created.
- **A file-size ratchet on the top-N files**, same shape: a measured ceiling per file, raised only
  deliberately, so "it grew 47%" is a build failure rather than a retrospective observation.

---

## 11. `aof work validate <ref>` reports PASS for a ref that does not exist

**Status:** open (found 2026-08-01 by the architect while checking a QA defect report during milestone
43's Three Amigos closure; **measured**, on this repo's own stream). **Severity:** medium — it is a
*silent green* on a gate command, which is the one failure mode a gate must not have.

**What's wrong.** `validateWork`'s scope is a FILTER (`src/work.mjs:687-694`), and an unresolved scope
filters to nothing. Nothing distinguishes "this ref has no problems" from "this ref does not exist", so
`work:validate` returns `{ findings: [] }` and the CLI renders the PASS line
(`src/commands/validate.mjs:48-50`):

```
PASS — 99 is well-formed.
```

Measured against `wiki/work` at `277ada5`: `validate 99` → 0 findings, `validate 43/07` → 0 findings,
`validate nonexistent-slug` → 0 findings. The scope-as-filter semantics are deliberate and documented in
`validate.mjs`'s own header ("An unresolved scope is a filter that matches nothing → empty findings, no
error"); what is not deliberate is *rendering that as a pass*.

**How it bites.** A typo'd ref, or a ref whose folder has not been scaffolded yet, reports the stream
healthy. In an `--autonomous` cascade — which runs `validate` as a gate between steps and reads its exit
code — a mistyped scope is indistinguishable from a green gate, and the run proceeds. It also exits 0,
so CI cannot catch it either.

**What is NOT wrong (checked in the same pass, recorded so it is not re-investigated).** A scoped
validate DOES reach task features: `checkFeatureTags` sits after the `inScope` guard inside the same loop
(`src/work.mjs:720`, `:786-790`), and `inScope` for a numeric ref matches `item.parent ?? item.number`,
so a milestone's nested stories are in scope. Measured on a scratch stream carrying a bogus-tag feature:
scopes `undefined`, `01`, `01/01` and `demo` each returned the identical findings.

**The fix.** Distinguish "matched nothing" from "found nothing wrong". `validateWork` should report
whether the scope resolved to at least one item; an unresolved scope becomes a coded error
(`scope-not-found`) or a finding, never a PASS — matching the resolver behaviour the rest of the command
surface already has (`work:tasks` throws `ref-not-found`; `work:doc` likewise). Keep the filter
semantics; change only what an EMPTY match renders as.

---

## 12. NINETEEN modules open the global mesh store for themselves — there is no per-invocation handle

**Status:** open (raised 2026-08-02 by the architect, during milestone 43 story 01's structural review;
**count moved 17 → 19 at 43/04's review, 2026-08-03** — the first movement since it was raised, and it
crossed this item's own stated ratchet threshold; **held at 19 through 43/05+06, and took its first
production bite there, 2026-08-04**).
**Severity:** low-medium — nothing is broken today, but the count only ever goes up, and each opener is a
place a store can be opened against the *wrong* home.

**What's wrong.** `openGlobalWorkProjectionStore` has no owner. **19 modules in `src/` import it and open
their own connection** (measured 2026-08-03): `board-mesh-execution`, `board-worker-stream`,
`commands/mesh-logs`, `commands/mesh-recover-push`, `commands/mesh-terminal-resume`,
**`commands/resync`**, `control-stream-server`, `effects/table`, `global-mesh-query`,
`global-work-publisher`, `global-work-store`, `item-lock`, `mesh-assignment-reclaim`, `mesh-assignment`,
`mesh-presence`, `mesh-recovery-push`, **`mesh-resync`**, `mesh-worker-execution`, `spine/face`. Each
follows the same open-read-close shape, and each re-derives its own paths from its own options bag
(`globalWorkStoreOptions`, `storeOptions`, `paths`, `env`, an injectable `openStore` override — five
spellings of one thing).

**The 18th and 19th arrived together, from ONE feature** (m43/04's Resync door, ADR-014/E7): the CLI
half and the transport half each open their own, exactly as the `mesh-recover-push` pair before it
does. That is the measurable cost of the shape item 10 now names — **a feature of this class costs two
openers by construction**, so the count moves in twos and the "18th opener fails CI" ratchet proposed
below would have fired on a diff that was individually reasonable. The ratchet is still right; it just
has to land with the handle, not before it.

**THE FIRST PRODUCTION BITE, measured 2026-08-04** (m43/05+06's review, ADR-016/G7). Until now this
item was a count. 43/06 migrated the control's presence aggregation onto the cache-first seam —
correctly; `mesh-launcher:390` is on ADR-005's must-migrate list, and the launcher going blind to
worker-authored items was a real defect — and the migration turned **one disk scan per workspace per
propagation tick** into **two SQLite opens per workspace per tick**: `listItemsCacheFirst`
(→ `readCachedItemRows`) and then `readCachedActiveRunIds`, each acquiring its own connection
(`mesh-launcher.mjs:411-419, 529-531`). With N = every workspace the control's fleet aggregation
resolves, the tick costs **2N opens**. Measured against `test/mesh-coordination-launcher.test.mjs`
("the healthy launcher refreshes this node's durable presence on each propagation tick"), ONE
workspace, EMPTY store:

```
6b4ab7f (before): presence refreshed at ~27ms   — lane GREEN
working tree:     not refreshed at 31ms; ~136ms — lane RED
```

**The store is ONE file for every workspace** (`withProjectionStore` keys on `globalMeshPaths(options)`),
so every one of those opens after the first is pure ceremony — which is exactly what "the invocation
has a store, but nothing models that" costs when the caller is a loop rather than a command. The
per-tick fix is local and is required by that review; **the general fix is still the handle**, and
this is the evidence that the ceremony has stopped being free.

A single command invocation now opens the store **more than once**: `aof work run-start` on a meshed
workspace opens it for the item-lock guard (`item-lock.mjs`) and again for the publish reactor
(`global-work-publisher.mjs`); `aof work next` opens it for the held-scope read on every call. The
overrides exist because tests must inject a hermetic home — which is the tell: the *invocation* has a
store, but nothing models that, so every seam re-acquires it and every test re-injects it.

**How it bites.** Three ways, none of them yet a failure:
- **Correctness surface.** Every opener is an independent chance to resolve the wrong `AOF_GLOBAL_HOME`
  — the same class as TECH_DEBT item 4 (cwd-derived identity), which silently discarded 100% of the
  worker→control frames for days. A single acquisition point would have one place to get that wrong.
- **Consistency.** Two opens inside one verb are two snapshots; a row can change between them, so a
  command's guard and its publish can disagree about the same workspace.
- **Ceremony.** Every new seam pays a ~10-line open/try/finally/close block plus an injection seam, and
  every test pays the matching plumbing. That cost is why "just read one more fact" is never cheap.

**The fix.** Give the invocation a store. The command `ctx` already threads `globalWorkStoreOptions`
everywhere; make it thread a lazily-opened, once-per-invocation **handle** instead, closed by the spine
when the command returns — the same shape `effectsJournalOptions`/the journal already gestures at. Seams
take the handle rather than the options bag; the injectable `openStore` override collapses into "the test
supplies the handle". Then a ratchet: `openGlobalWorkProjectionStore` may be called from exactly one
module, and the 18th opener fails CI instead of needing a reviewer to notice.

---

## 13. After the authority cut, a foreign-authored cached row for a ref an OPERATOR deletes is unreachable

**Status:** open, NARROWED 2026-08-02 (raised by the architect during milestone 43 story 02's
structural review, routed by ADR-012/B6; the RENUMBER half was then ruled back INTO 43/02 by the PO
at that story's review and is **built** — see "What was fixed" below). **Severity:** low-medium — a
phantom item on the board, reachable only by an operator deleting an item a worker had reported.

**What was fixed in 43/02, and what is left.** The two ways in were the same disease but not the same
door. The renumber half was a live *regression* against HEAD (the wholesale rebuild self-healed a
renumber; author retraction cannot) and turned out to be curable with the mechanism 43/02 had already
built: `publish-projection` is now registered on `stream.reindexed`, carrying `operatorRefs` = BOTH
ends of every remap entry, and the operator door may retract those refs whoever authored them. A
renumber therefore re-derives its own refs and leaves no row on a ref it vacated. **What remains is
the OPERATOR-DELETE half only**, below.

**What's wrong.** `work_items` is now a fact, and ADR-004's deletion rule is author retraction: a node
deletes only rows where `node_id = <itself> AND ref NOT IN <the set it still claims>`. That rule is
correct and is the whole cure — no node may destroy another node's work. Its cost is the case nobody
owns: **a ref whose row was authored by a worker, which then ceases to exist on the control's disk.**
Nothing can remove it. The control cannot (not its row). The worker never will (it no longer carries
that ref, and a frame retracts nothing by design). The only door that reaches it is
`removeWorkspaceFromCache`, which takes the entire workspace.

**The one way in that remains — an operator delete.** ADR-010/D1 named the cure — *"an
operator-initiated delete is an operator door: it may retract the ref regardless of `node_id`, and is
refused while locked. Without this an operator could not delete an item a worker had ever reported."*
43/02 built exactly half of it: the operator door may now retract, but only for refs an event names as
rewritten (a remap's two ends), because that is the only operator act aof currently has that vacates a
ref. **aof has no item-delete verb**, so a deletion performed by an operator removing a folder by hand
is invisible to the ledger and has no door to hang on. Until one exists, a worker-authored row for a
ref the operator deleted from the control's disk survives every tick.

*(Superseded, kept for the record: this item originally also covered the RENUMBER path — `43/03 →
43/04` leaving every worker-authored row on the OLD ref forever, with two `src/effects/table.mjs`
comments claiming a publish reactor that did not exist. Both comments and the defect were fixed in
43/02; `acd-stream-reindex-cascade` now pins the reactor list including the publish step, and
`cache-authority-author-retraction` covers the behaviour end-to-end through the real
`work:insert-story` verb.)*

**How it bites.** The control's cache — which this milestone is making the ONE read surface — keeps
answering for an item that does not exist anywhere. It renders on `/api/mesh/status`, in
`aof work list --mesh` and on the board, with a plausible status and a real `reportedBy`, and no
operator action removes it short of forgetting the whole workspace. It is the same shape as the disease
the milestone cures (a stale row outliving its truth), one deletion path over.

**The fix.** ONE door, and half of it exists. `upsertWorkItems`'s retraction already reaches any
`node_id` for a ref the caller names in `operatorRefs`, and is already refused while the scope is
locked (ADR-003) — the renumber cascade is its first caller. What is left is the SECOND caller: an
item-delete verb, which must name the deleted ref the same way `stream.reindexed` names a remap's two
ends, so the deletion is an operator act carried by an event rather than a folder vanishing behind the
ledger's back. **Natural home: `43/04`**, which already owns Resync — the door that asks an owning node
to re-report — and is the only other story that touches this seam's read side.

## 14. The clone-credential provider is fleet-GLOBAL, so a GitHub-configured mesh cannot dispatch to any other repo

**Measured 2026-08-03**, during the m43 live cross-machine verification, on a two-node fleet (Windows
control `umairs-msi` + WSL worker `umairs-msi-wsl`) against a purpose-built local test repo
(`C:\Source\umair\aof-test-repo`, workspace `52294b307214c27d`, `cloneUrl`
`file:///mnt/c/Source/umair/aof-test-repo`).

`resolveCloneCredentialProvider` (`src/mesh-clone-credential-provider.mjs:412`) reads ONE key —
`config.mesh.repo.credential.provider` — and this control node's `~/.aof/aof.config.json` sets it to
`github-app` (the `aof-mesh-clone` App, id 4317525, VoiceVox-ai). That choice is **per control node, not
per workspace**, so every clone-credential request for every workspace is routed to the GitHub App
mint. For a workspace whose repo the App has no installation for — a local `file://` repo, a public
repo, a repo in another org — the provider **throws**, and `applyCloneCredentialRequestFrame`
(`src/control-stream-server.mjs:616-622`) turns any throw into the coded refusal
`clone-credential-mint-failed`. The worker then fails the whole assignment:

```
assignment-repo-unavailable: clone credential request failed for workspace "52294b307214c27d":
clone-credential-request was refused by control (code=clone-credential-mint-failed)
```

**Why it is a real gap rather than a misconfiguration.** The `env-token` default deliberately treats
"no credential" as a legitimate answer — `defaultMintCloneCredential` returns `null` when
`AOF_MESH_CLONE_TOKEN` is absent, and the module doc calls that *"a legitimate 'no credential
configured for this workspace' reply (the public-repo path), never a refusal."* The `github-app`
provider has **no equivalent fall-through**: it cannot express "this workspace needs no credential". So
the moment a fleet is configured for one private forge, every other repo in that fleet becomes
undispatchable — including the local test-bed a developer would reach for to verify mesh behaviour
without touching production repos.

**The fix.** Give the App provider the same "no installation ⇒ `null`, not a throw" path the env-token
provider already has, so a repo the App does not cover degrades to an unauthenticated clone (which is
correct for `file://` and for a public repo) instead of failing the assignment. A per-workspace
provider override would also work but is the larger change; the null-return is the one that restores
the documented semantics.

## 15. There is no path to enrol an EXISTING worker into a NEW workspace — `mesh join` grants a credential, never membership

**Measured 2026-08-03**, same live run. The control node holds the enrollment facts for the new
workspace — all three membership rows are present in its `global_node_workspaces`:

```
[{"node_id":"umairs-mac-mini","workspace_id":"52294b307214c27d"},
 {"node_id":"umairs-msi","workspace_id":"52294b307214c27d"},
 {"node_id":"umairs-msi-wsl","workspace_id":"52294b307214c27d"}]
```

The WORKER's own local projection store has **no row for that workspace at all** — neither the
membership nor the descriptor — while carrying rows for the three workspaces that existed when its
daemon started:

```
node_workspaces: [... e1aa9092f951cedb, 9db1fd84f5895e38 ...]   # no 52294b307214c27d
descriptors:     [... e1aa9092f951cedb, 9db1fd84f5895e38 ...]   # no 52294b307214c27d
```

The worker daemon started at 23:51; the workspace was published at 23:52 and the node joined at 23:55.
**A daemon restart at 00:07 did NOT fix it** — the rows were still absent afterwards, which disproves the
first reading of this item ("stale until restart") and points at the real cause below.

**The root cause, measured.** A node's workspace membership is derived from the workspaces that node can
**see on its own filesystem**, and is published in its own node record. The worker's
`~/.aof/mesh/nodes/umairs-msi-wsl.json` lists exactly one workspace:

```json
"workspaces": [ { "workspaceId": "9db1fd84f5895e38", "name": "aof",
                  "projectRoot": "/home/umair/source/aof" } ]
```

So the three verbs an operator would reach for each do something *other* than enrol:

| verb | what it actually does |
|---|---|
| `aof mesh invite` (control) | mints a short-TTL join code |
| `aof mesh join <code>` (worker) | stores a **relay credential** in the worker's global config — `{"joined": true}` — and adds **no** workspace |
| `aof mesh repo publish` (control) | registers the workspace in the **control's** registry and writes its `clone_url` |
| `aof mesh identity` (either) | republishes that node's own record — including its workspace list, derived from what it can see locally |

Nothing in that set gives an existing worker a workspace it does not already have a checkout of. A
pre-seeded clone under `<meshRoot>/checkouts/<workspaceId>/` does not count either — that directory is
populated **by** dispatch, and is not a source of membership.

**How it bites.** `workerHasRepo` (`src/mesh-worker-execution.mjs:319`) is the AND of two facts — the
local `mesh.repo.published` marker and this node's OWN local `global_node_workspaces` membership row.
With the membership row absent the guard is false, the worker takes the clone-on-miss path, and with no
local `clone_url` either it must ask the control for one — which is how a missing registry row surfaces
as a *credential* failure two hops away from its cause. Every dispatch to that workspace fails until
the worker daemon is restarted, and `aof mesh join` succeeding on the control gives an operator every
reason to believe enrollment is complete.

**Why it matters beyond the test-bed.** Enrolling a new workspace is a routine, expected act on a live
mesh; requiring a daemon restart on every worker to make it usable is the kind of hidden coupling that
reads as "the mesh is flaky". It also compounds item 14: the operator sees a credential error and goes
looking at credentials, when the actual missing fact is a registry row.

**The fix.** `mesh join` should take the workspace it was invited to and make the node a member of it —
the invite already names one, so the code carries the fact; the join simply drops it. Concretely: on
join, record the membership and let the worker acquire the checkout through the clone path it already
has (which is exactly what a dispatch does), rather than requiring an operator to hand-place a checkout
and re-run `mesh identity` on every worker. Failing that, `workerHasRepo`'s miss must name the missing
FACT — "this node has no membership row for this workspace" — instead of letting it surface two hops
downstream as a *clone* or *credential* failure, which is what sent this investigation to the wrong
subsystem twice.

**Measured operator workaround** (what a two-node fleet actually has to do today): give the worker a
real checkout of the workspace somewhere it owns, run `aof mesh identity` there so its node record
republishes with the new workspace in its list, and only then dispatch.

## 16. `aof mesh repo publish` silently discards a malformed `cloneUrl` and reports success

**Measured 2026-08-03**, same live run — and it cost the first full dispatch cycle before the cause was
found. `.aof/aof.config.json` was hand-configured with `"cloneUrl": "/mnt/c/Source/umair/aof-test-repo"`.
`isWellFormedCloneUrl` (`src/mesh-repo-marker.mjs:23`) correctly rejects a bare filesystem path (it
requires `scheme://host/...` or scp-style `user@host:path`), so the value was discarded — but
`writeRepoPublishedMarker` then reported `"cloneUrl": null` inside an envelope whose `"ok": true` and
`"published": true` say the publish succeeded. The module doc states the intent plainly: a detection
failure *"is silent and non-fatal — the publish still succeeds with no `cloneUrl`."* That is right for a
repo with **no** origin; it is wrong when the operator **configured** one and it was thrown away.

**How it bites.** The next signal the operator gets is a worker failing an assignment with
`assignment-repo-unavailable … cloneUrl unresolved`, on a different machine, minutes later. The publish
that caused it reported success.

**The fix.** Distinguish "nothing configured, nothing derived" (silent, correct) from "configured and
rejected" (loud). A configured-but-malformed `cloneUrl` should warn on the publish envelope naming the
value and the shape rule it failed — the same treatment the codebase gives every other coded refusal.

---

## 17. Six test suites are imported by NEITHER runner — a whole accepted story's proof has never run in CI

**Status:** open (measured 2026-08-03 by the architect, during milestone 43 story 04's structural
review). **Severity:** medium — it is not a broken test, it is a *gate that isn't there*: a suite no
runner imports is green, red or deleted with equal effect on every gate we have.

**What's wrong.** Both runners register their suites by **explicit import** (`scripts/test.mjs` and
`scripts/test-unit.mjs`). Nothing checks that the set of imports covers the set of files. Measured, six
`test/**/*.test.mjs` files are imported by neither:

| File | Origin | State when run by hand |
|---|---|---|
| `test/artifact-sync-drain.test.mjs` | m43/03 (ACCEPTED) | green |
| `test/artifact-sync-enqueue-hook.test.mjs` | m43/03 (ACCEPTED) | green |
| `test/artifact-sync-manifest.test.mjs` | m43/03 (ACCEPTED) | green |
| `test/claude-settings-merge.test.mjs` | m43/03 (ACCEPTED) | green |
| `test/mesh-ui-write-isolation-bounded.test.mjs` | m25-era (`15e0a92`) | **RED** — 3 of 6 fail |
| `test/work-observe.test.mjs` | work-observe | exports no runner array |

Two distinct problems, one cause. **(a)** An accepted story's four behavioural suites — 38 scenarios,
the proof that `43/03` works — have never executed in `npm test`. They pass today; nothing would tell
anyone the day they stop. **(b)** `mesh-ui-write-isolation-bounded` tests `POST /api/mesh/issue`, a
route that no longer exists; its siblings were retired into
`wiki/work/35_milestone_mesh-work-assignment/reference/retired-dispatch-tests/` and this one was
missed. It has been red and invisible ever since.

**How it bites.** It is the exact inverse of a flaky test, and worse: a flaky test is noisy, an
unregistered one is silent. It also breaks the assumption every review in this repo makes — that "the
suite is green" says something about the code under review. The m43/03 case is the sharp end: a story
was reviewed, accepted and merged on evidence that CI has never re-checked once.

**The fix.** A fitness function, and it is small: every `test/**/*.test.mjs` must be imported by
`scripts/test.mjs` or `scripts/test-unit.mjs`, with the current orphan set as a **named, shrink-only
baseline** (the `acd-no-new-silent-catch` idiom) so the seventh orphan fails CI while the six are paid
down deliberately. Then: register 43/03's four green suites (four lines), and retire
`mesh-ui-write-isolation-bounded` to the m35 reference directory its siblings already live in — its
route is gone, so there is nothing to repair, only a file to file correctly.

---

## 18. `ui/` has no interior structure either — one surface's folder is the shared library, and the fleet cannot say which machine it is

**Status:** open (measured 2026-08-03 by the architect, during milestone 43 story 04's **second-pass**
structural review — the UI half). **Severity:** medium. This is TECH_DEBT item 10 (`src/` has no
interior structure) seen in the other half of the codebase, plus one concrete consequence that is
already blocking a test someone wants to write.

**What's wrong — two things with one cause, that `ui/` was never given a shared layer.**

**(a) `ui/src/board/` is the de-facto shared UI library, and nothing declares it.** `ui/src/fleet/`
reaches into `ui/src/board/` **seven** times — `runs.mjs` (the one relative-time formatter),
`status.tsx` (the status ramp), `api.ts` (wire types), and milestone 43's `freshness.mjs` ×2 +
`StaleBadge.tsx` — up from four before 43/04. Meanwhile `ui/src/components/` (seven kit primitives)
and `ui/src/lib/` exist and are the nominal shared homes, and neither holds any of it. So the import
graph says "the fleet depends on the board", which is not the relationship: both depend on a shared
ramp/vocabulary layer that has no folder. Each new cross-surface primitive lands in whichever surface
built it first — exactly item 10's shape ("a rule living at whichever call site needed it first is
not a rule"), one directory over.

Line-count trend for the same subtree, measured from this repo's history:

| file | m03 (06-21) | m26 (07-02) | 07-30 | 43/04 |
|---|---|---|---|---|
| `ui/src/board/DetailPanel.tsx` | 434 | 707 | 814 | **1,123** |
| `ui/src/fleet/Fleet.tsx` | — | 508 | 1,463 | **1,521** |
| `ui/src/board/Board.tsx` | 315 | 367 | 437 | **581** |
| `ui/src` files | 29 | 33 | 48 | **53** |

`acd-ui-surface-file-budget` (m43/ADR-015 F2) now ratchets the first two so the *files* stop growing;
it does nothing about the missing *layer*, which is this item.

**(b) The fleet payload cannot say which machine is serving it, so "this node" is unrenderable there.**
Milestone 43/04 gave the board's `/api/work/list` envelope a `nodeId` key, and the board now reads
`from aof-control (this node)` on rows it published itself. The fleet has no equivalent:
`shapeGlobalStatus` (`src/global-mesh-query.mjs`) states `stalenessSeconds` but no serving-node
identity, and `mesh-ui-serve.mjs` already resolves one internally (`controlNodeId()`, used only as the
assign `issuer`). The fleet's `node.local` marker IS produced — by the `mesh:status` command
(`src/commands/mesh-identity.mjs:~343`) — but its only web consumer is `NodeCard`
(`ui/src/fleet/Fleet.tsx:1069`), which **never mounts in the web app**: the codebase records this at
`Fleet.tsx:951-954` (m38 finding F9) — *"mesh-ui-serve.mjs serves BOTH scopes from
queryGlobalMeshStatus, so isGlobalStatus(status) is always true and NodeCard/NodesRegion never mount
there."* The card that does render falls back to the registry's `role` (`control`/`worker`), which
answers a different question.

**How it bites.** (a) compounds silently: the next shared primitive lands in `board/` too, and the
fleet's dependency on the board deepens until neither can be moved. (b) bites now and concretely —
**a lane asserting that the fleet's "this node" tag and the board's new `(this node)` clause agree
about the same machine cannot be written**, because the fleet has no such tag on the wire. Two
surfaces answering "which machine is this?" differently, with no test able to compare them, is the
disagreement class milestone 43 exists to remove. It also leaves a whole local-shape render path
(`NodesRegion`, `NodeCard`, `BoardsRegion`, `BoardDrillIn` — several hundred lines) reachable by no
production request, dead since m38 and never routed.

**The fix.** Two independent, both small.
- **(a)** A shared layer — `ui/src/ramps/` (the five read-only ramps: status, runs, assignment,
  presence, freshness) or an honest `ui/src/shared/` — and move the cross-surface modules into it, so
  `fleet → board` becomes `fleet → shared ← board`. Mechanical, but it touches every importer, which
  is why it is here rather than inside a story.
- **(b)** `shapeGlobalStatus` states the serving node's identity on the payload, the way
  `/api/work/list` now does (`mesh-ui-serve.mjs` already has it memoised). Then `node.local` is
  derivable in `ui/` for the card that actually renders, the two surfaces answer the question from one
  source, and the cross-surface lane becomes writable. While there, decide the fate of the
  never-mounting local-shape components: render them or retire them, but not neither.
