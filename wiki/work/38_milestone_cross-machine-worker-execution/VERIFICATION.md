---
doc: verification
milestone: 38
updated: 2026-07-10
---
<!--
  Milestone VERIFICATION.md — the record of aof:verify 38. Written by the orchestration (verify owns
  its own record doc). Only sections with content are present — absence of a section is information.
-->
# 38 · Cross-machine worker execution & session presence — Verification

## Verification evidence

### Automated `@executable` suite + fitness functions (regression sweep) — GREEN

- `node scripts/test.mjs` → **exit 0, 2409 ok, 0 not ok.** Covers every `@executable` task in scope:
  story-00 tasks 00–05 (`aof session` CLI + per-`(node, workspace, assistant)` session store, TTL
  liveness reusing `isStale`, additive `sessions` presence key, cross-workspace aggregation, fleet
  reconciliation render, assistant-hook wiring) and story-01 tasks 00–03 (clone-location config,
  scoped `meshCheckoutPath`, register-and-fallthrough, credential-not-persisted).
- **All 9 milestone-38 fitness-function arch-tests green, each with a non-vacuous self-check:**
  `acd-session-presence-additive` (ADR-001), `acd-session-record-frozen` /
  `acd-session-ttl-reuses-isstale` / `acd-session-ttl-self-expires` (ADR-002),
  `acd-presence-aggregates-node-workspaces` (ADR-003), `acd-session-run-reconciliation` (ADR-004),
  `acd-worker-clone-target-scoped` / `acd-worker-clone-no-credential-persisted` (ADR-005),
  `acd-worker-checkout-reuses-worktree` (ADR-006). verifies → the six story-00 + three story-01
  fitness units named in each STORY.md.

### ADR-004 reconciliation relocation — architect ratification (STATE flagged for verify) — SOUND

The build-review F1 fix relocated the run↔session subsumption **upstream** from the fleet render helper
into `assembleCurrentPresenceRecord`. Ratified as **structurally sound**:
- The frozen m23 `activeRuns` is a bare `string[]` (23/ADR-002) with **no workspace attribution**, so a
  render-layer helper fed only `{ activeRuns, sessions }` structurally *cannot* decide which workspace a
  run belongs to. The per-workspace attribution exists **only** in the assembler's per-workspace loop
  ([src/mesh-launcher.mjs:122-172](../../../src/mesh-launcher.mjs#L122-L172)), which now drops any live
  session whose `workspaceId` already has a running run **before publish** — `sessions[]` is
  pre-subsumed on the wire.
- [ui/src/fleet/runs.mjs](../../../ui/src/fleet/runs.mjs) is consequently a **pure projection** over the
  pre-subsumed record; it re-reads nothing, invents no run-attribution, and both desktop (36) + web (25)
  consume the one helper. Producer and render helper are consistent.
- verifies → `acd-session-run-reconciliation`, whose behavioural cases (same-workspace run+session ⇒ ONE
  line; session-only ⇒ `(session)` fallback; run+session on *different* workspaces ⇒ two lines) now run
  end-to-end against the **production wire shape** — closing the F1 gap where the old test fed attributed
  run objects the producer never emits.
- **ADR text alignment:** ADR-004's prose still says reconciliation "lives in the fleet model." The
  as-built split — *subsumption in the assembler, pure line-projection in the fleet model* — should be
  folded into ADR-004 at STATE compaction (recorded here so it is not lost).

### Design conformance — the one UI surface (fleet NodeCard row-3)

- DESIGN.md declares a single changed surface: the NodeCard **current-work line (row 3)**, gaining the
  `working · <repo> (session)` state; rows 1/2/4 carried forward verbatim. Baseline = the binding
  checklist (§Surface 1), **no mock** (user's refine choice).
- **Build-time verdict: CONFORMS** (STATE) — the built `ui/dist` was served with a fixture presence
  payload exercising every row-3 state and rendered via headless Chromium at **1280 + 390**; `aof-designer`
  judged the handed screenshot **CONFORMS**, no design gaps, row 3 the only changed region.
- **This verify pass:** no base URL is configured (`work.ui.baseUrl` absent, no `--url` given), so no
  fresh render was produced this session. Per the litmus, a `CONFORMS`/`GAPS` verdict is **never** inferred
  from component code — the honest verdict absent a handed render is INCONCLUSIVE. The **live**
  re-confirmation of the new NodeCard state is folded into the story-00 task-06 `@uat` visual-review
  scenario (below), judged on the operator's real render.

## Findings

| id | observed | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- |
| F1 | `acd-session-run-reconciliation` + the task-04 render test were authored against attributed run *objects* while the ADR-001-frozen `activeRuns` is a bare `string[]`, so a green arch-test masked a real per-workspace-subsume violation in production. | correctness | blocker | fixed in build | subsumption relocated to `assembleCurrentPresenceRecord`; tests fed the production wire shape | **resolved** (ratified above) |
| F2 | `ui/src/fleet/runs.mjs` shipped without its `.d.mts` companion — the node suite passed while `tsc -b && vite build` failed (implicit-any); the craft gate did not run the UI build. | build | non-blocker | fixed in build | `ui/src/fleet/runs.d.mts` added; lesson → run `npm run ui:build` when a `.mjs` helper is consumed from `.tsx` | **resolved** |
| F3 | `00_session-cli-record.feature` "the tuple is the key" Scenario-Outline row 1 (`tuple-a == tuple-b`) carries an unsatisfiable clause (`ending tuple-a leaves tuple-b intact` cannot hold when the tuples are the same record). Dev asserted the satisfiable claim (record-count idempotency) and flagged rather than editing the `.feature`. | contract | non-blocker | **defer to next refine** | amend the `.feature` to scope the "leaves intact" clause to the distinct-tuple rows only (or split the Outline) | **open (deferred, non-blocking)** |
| **F13** | **A retry that crashes the process instead of degrading.** `listenOrDegradeToLoopback` ([`control-stream-server.mjs:457-469`](../../../src/control-stream-server.mjs#L457-L469)) handles `EADDRNOTAVAIL` by re-calling `server.listen(port, "127.0.0.1", resolve)` — **without re-attaching an `error` listener**. A second failure on that retry is therefore an **unhandled** error event that kills the process rather than degrading. Surfaced live: with a real `mesh serve` daemon holding `:4182`, `node scripts/test.mjs` **crashed** mid-run rather than failing a test. (The daemon-vs-suite port collision is itself worth fixing — the suite should bind an ephemeral port.) | robustness | non-blocker | defer to next `aof:continue` | story-01 / control-stream-server | **open (deferred)** |
| **F15** | **Mint privilege escalation — a credential is scoped to the REQUESTER's `workspaceId`, not the assignment's.** `applyCloneCredentialRequestFrame` ([`control-stream-server.mjs`](../../../src/control-stream-server.mjs#L293)) passes the T6 holder check, then mints `mint(frame.workspaceId, assignmentId)` — **never cross-checking `frame.workspaceId` against the row's `existing.workspace_id`** (the comment even *claims* it does). Confirmed at source + measured by security: a node holding `asg-1`/`ws-a` requests `workspaceId: "ws-b"` and control mints a token scoped to **someone else's repo**. A holder of any trivial assignment can pull a credential for **any repo in the fleet**. Dormant under the insecure default, **armed by a correct per-repo mint** (the more T4-compliant the mint, the worse it bites). | security (AuthZ) | **BLOCKER** | dev fix (mint against `existing.workspace_id`; refuse on mismatch) | back to `aof:continue` (story-01) | **FIXED — security re-verified CLOSED** |
| **F14** | **Git's ambient `credential.helper` silently defeats `GIT_ASKPASS` — and persists the token to the OS keychain.** The scoped clone runs bare `git clone` with only `GIT_ASKPASS` set. Security measured on stock Git-for-Windows (system `manager` + `wincred`): a configured helper **wins**, `GIT_ASKPASS` is never called, so the relay-minted scoped token is **silently bypassed** for the operator's broad keychain PAT — and the clone *succeeds*, so nobody notices T4 evaporated. Worse, on success git runs `approve`→`store`, **persisting an askpass token into the keychain** — the durable secret store this milestone explicitly refused (T1/R2). | security (Info-disclosure + AuthZ) | **BLOCKER** | dev fix (`-c credential.helper=` + `GIT_TERMINAL_PROMPT=0` on the clone exec, incl. the public path) | back to `aof:continue` (story-01) | **FIXED — security re-verified CLOSED (live-git)** |
| **F16** | **A terminal assignment still mints a live credential.** The mint has no active-state gate — control mints for assignments in `done`/`failed`/`withdrawn`/`reclaimed`. A worker finished, reclaimed, or withdrawn OFF the work can still pull fresh repo credentials indefinitely. | security (AuthZ) | non-blocker (still fixed) | dev fix (gate on `isActiveAssignmentState`) | back to `aof:continue` (story-01) | **FIXED — security re-verified CLOSED** |
| **F12** | **[FIXED — ADR-009 pull] The worker can NEVER obtain a credential in production — it can only clone a PUBLIC repo, so SPEC objective (b) is unmeetable by the shipped code.** [`mesh-worker-execution.mjs:356`](../../../src/mesh-worker-execution.mjs#L356) reads `options.cloneCredential ?? null`, and the source itself documents that option as *"a fake token string **(tests only)**"*. The **only** production constructor ([`mesh-launcher.mjs:484`](../../../src/mesh-launcher.mjs#L484)) builds the handler as `{ loadWs, nodeId, sendAssignmentStatus, now, ...(options?.workerExecutionOptions ?? {}) }` — and `workerExecutionOptions` is a documented **test-injection** spread. `aof mesh serve --serve` passes none ⇒ `cloneCredential` is **always `null`**. The whole `GIT_ASKPASS` machinery was built, fully green, and **nothing ever hands it a token**. Story-01's `@executable` tests are green because they all **inject a fake credential** and assert what the code does *with* one — **nobody asked where the credential comes from**. | correctness | **BLOCKER** | **`@bug` task 05 (+`@finding-F12`)** + **ADR-009** | back to `aof:continue` (story-01) | **fix in flight** |
| **F11** | **THE MILESTONE'S HEADLINE FIX DID NOT WORK — ADR-003's cross-workspace aggregation never aggregated.** `global_workspace_descriptors.work_dir` stored the **raw, unresolved** `config.work.dir` — the relative string `"./wiki/work"` — for EVERY workspace ([`global-node-registry.mjs:187`](../../../src/global-node-registry.mjs#L187) wrote `workspace.workDir` verbatim). So the publisher resolved every workspace against **its own launch cwd**. Measured live: both registered workspaces returned the IDENTICAL `workDir: "./wiki/work"`, both read the SAME 154 items (aof's), so (a) it read ONE workspace N times instead of N workspaces; (b) ONE running run produced `activeRuns: [id, id]` → the card rendered **`running 2 runs`**; (c) every workspaceId got flagged as having runs, so ADR-004 subsumption dropped **EVERY** live session — a second repo's session vanished though it had no run; and (d) **from the install dir the aggregation resolved ZERO workspaces** (`stat("./wiki/work")` fails → silent `continue`) → **permanently `idle`** — *precisely the "packaged tray app reads idle forever" bug the milestone exists to kill*. The `stat()` guard hid it because a relative path accidentally resolves when the daemon runs from that very repo — which is how every test and dev run was done. | correctness | **BLOCKER** | **`@bug` task 10 (+`@finding-F11`)** | back to `aof:continue` (story-00) | **FIXED — verified at source** |
| **F9** | **m38's fleet render landed in a component the web app NEVER renders — the production card has no current-work line at all.** [`Fleet.tsx:167`](../../../ui/src/fleet/Fleet.tsx#L167) branches `isGlobalStatus(status) ? <GlobalScopeView/> : <NodesRegion/>`. Task 04's session render went into `NodesRegion → NodeCard` (which calls `fleetCurrentWorkLines`, line 631). But `mesh-ui-serve.mjs` serves **both** scopes from `queryGlobalMeshStatus`, so the payload is **always** the global shape → `isGlobalStatus` is always true → the app **always** renders `GlobalNodePanel` (line 537), whose card is dot+nodeId+role → host → last-seen → assignments → fabric addr → capabilities and **never calls `fleetCurrentWorkLines`**. `NodeCard` is dead code in production. **Confirmed by a headless render of the live fleet with a real session: the node cards show no current-work row whatsoever** — not even `idle`/`running N runs`. This is also why the build-time design review "CONFORMED": it fed a **LOCAL-shaped fixture**, which renders `NodeCard` — a component the real app never shows. | correctness | **BLOCKER** | folded into **`@bug` task 08** (+`@finding-F9`) | back to `aof:continue` (story-00) | **fix in flight** |
| **F8** | **The Rust desktop reads `activeRuns` in a shape the producer never emits (the m36-era twin of F1).** `view_model.rs`'s `current_work()` does `first.get("ref")` / `first.get("title")` — expecting `activeRuns[]` to hold OBJECTS. But `readActiveRuns` ([`mesh-presence.mjs:69-78`](../../../src/mesh-presence.mjs#L69-L78)) returns `runIds` — a bare **`string[]`** — and [`mesh-identity.mjs:218`](../../../src/commands/mesh-identity.mjs#L218) passes it through unenriched; ADR-001 freezes `activeRuns: string[]`. So on a real running run, `.get("ref")` on a JSON string yields `None` and the desktop renders `" ·  (running)"` with an empty ref and title. | correctness | **BLOCKER** | **`@bug` task 09 (+`@finding-F8`)** | back to `aof:continue` (story-00) | **fix in flight** |
| **F7** | **The desktop fleet — the surface whose UAT RAISED this bug — never learned about sessions.** `app/desktop/crates/core/src/view_model.rs` defines `enum CurrentWork { Running { work_ref, title }, Idle }` — **no session variant** — and `current_work()` derives the cell from `presence.activeRuns` ALONE. The desktop is a **Rust/Tauri** app; m38's UI work landed only in the React `Fleet.tsx`. Verified live: `aof mesh status --json` (the desktop's own single data path, 36/ADR-004) returned `sessions: [{workspaceId, repo:"aof", …}]` while the desktop card read **`idle`**. | correctness | **BLOCKER** | **`@bug` task 09 (+`@finding-F7`)** | back to `aof:continue` (story-00) | **fix in flight** |
| **F6** | **The web fleet's read route carries no presence at all, so its session render is dead code.** `/api/mesh/status` (both scopes) is served from `queryGlobalMeshStatus` ([`global-mesh-query.mjs`](../../../src/global-mesh-query.mjs)), which builds **no presence record** — only a `freshness` ramp. Node objects come back with no `presence` key. But [`Fleet.tsx:631`](../../../ui/src/fleet/Fleet.tsx#L631) reads `fleetCurrentWorkLines(node.presence ?? {})` → always `{}` → row 3 is **always `idle`**. (So the m23 `running N runs` state has never rendered on the web fleet either.) | correctness | **BLOCKER** | **`@bug` task 08 (+`@finding-F6`)** | back to `aof:continue` (story-00) | **fix in flight** |
| F5 | `aof session <verb>` reads stdin **unconditionally**, guarding only `process.stdin.isTTY`. A caller that supplies full identity via explicit flags but whose stdin is an open **non-TTY** pipe that never reaches EOF (a CI runner, a programmatic spawn) **blocks forever** — it hung the verify session for 2 minutes on `aof session end --workspace … --assistant …`. Real hooks are unaffected (Claude Code closes stdin after writing the payload). Fix: skip the stdin read entirely when the flags already resolve identity, and/or bound the read. | robustness | non-blocker | defer to next `aof:continue` | story-00 (`mesh-session.mjs` `readStdinText`) | **open (deferred)** |
| **F4** | **The wired assistant hook can NEVER write a session record — SPEC objective (a) is inert in production.** `.claude/settings.json` wires the bare commands `aof session start` / `ping` / `end` (no flags). A faithful Claude Code hook payload carries `{session_id, transcript_path, cwd, hook_event_name, prompt}` — it has **no `workspace` and no `repo`** (they are aof concepts Claude Code cannot know). But [`mesh-session.mjs:183-184`](../../../src/commands/mesh-session.mjs#L183-L184) resolves them as `options.workspace ?? identity.payload?.workspace ?? null` / `options.repo ?? identity.payload?.repo ?? null` — falling back to payload fields that are never sent. Both resolve `null` → `requireNonBlank` → coded refusal `session-arg-missing-workspace`, exit 1, **no record written**. | correctness | **BLOCKER** | **new `@bug` + `@finding-F4` task scenario + fix** | back to `aof:continue` (story-00) | **OPEN — blocks story-00 + milestone accept** |

### F4 — evidence, root cause, and the fix (the milestone's headline feature is broken)

**Live evidence (the soak, not a synthetic test).** With the m38 SEA deployed and the m38 daemon publishing
the correct 5-key record, a **real Claude Code session on this repo** (hooks wired per task 05) had the
operator submit a real prompt. Result: **no session record was created** — `sessions: []`, and the
`<meshRoot>/sessions/` directory did not exist at all. The node stayed **`idle` while actively being worked
on** — precisely the bug this milestone exists to fix.

**Reproduced deterministically.** Feeding a faithful Claude Code payload (verified field set:
`session_id, transcript_path, cwd, hook_event_name, prompt`; `has workspace? false | has repo? false | has cwd? true`)
to the exact wired command:
```
$ aof session ping --json  < real-hook.json
{ "ok": false, "error": "--workspace is required and must not be blank.",
  "code": "session-arg-missing-workspace" }   EXIT=1
```
The same call **succeeds** when the payload is hand-doctored to carry `workspace`/`repo` — i.e. the CLI is
coded against a payload shape **the real producer never emits**.

**Why the whole `@executable` suite stayed green (the untested seam).** Task-00's tests drive the CLI with
**explicit flags** (`--workspace X --repo Y --assistant Z`) — green. Task-05's test only **string-inspects the
composed hook command** (asserting a single unchained `aof session <verb>` with no shell chaining) — green.
**Nobody tested the joint**: the bare hook command + a REAL payload → a written record. This is the *same
failure class as F1*, recurring at a different seam — a component tested against a synthetic upstream shape
the real producer never emits. F1's own retro lesson ("exercise the ACTUAL upstream wire shape") was not
generalised to the hook boundary.

**The fix (direction verified).** The payload carries `cwd`, and the CLI **already loads the workspace from
`process.cwd()`** ([`mesh-session.mjs:212`](../../../src/commands/mesh-session.mjs#L212)) — it has everything it
needs and simply never derives from it. When flags/payload do not supply them, `workspaceId` must be derived
from the payload's `cwd` (falling back to `process.cwd()`) via the **canonical idiom already used by the
presence publisher** — `config?.mesh?.workspaceId ?? workspaceIdFor(projectRoot)`
([`mesh-launcher.mjs:375`](../../../src/mesh-launcher.mjs#L375), [`global-node-registry.mjs:42`](../../../src/global-node-registry.mjs#L42)) — and `repo`
from the workspace name. Using the same seam is **load-bearing**: the session record's `workspaceId` must
match the id the presence aggregation and `global_node_workspaces` use, or ADR-003 aggregation and ADR-004
subsumption will not line up. Verified at the source: `workspaceIdFor("C:\Source\umair\aof")` →
`9db1fd84f5895e38` — exactly the registered workspaceId.

**Regression test owed with the fix:** feed a **real Claude Code hook payload** to the **bare** hook command and
assert a session record lands with the *registry-canonical* `workspaceId` — the assertion whose absence let this
ship.

_(F1/F2 were raised and fixed during build/review; recorded here for the milestone trail. F3 is a
non-blocking contract wrinkle deferred to the next refine. **F4 is an open blocker** — it fails the task-06
soak at scenario 1 and blocks acceptance of story-00 and the milestone.)_

### F6 / F7 / F8 — the last mile: the plumbing works, but NO fleet surface renders the session

The soak proved the m38 **pipeline** is correct end-to-end: a real hook writes a session record, the publisher
aggregates it across the node's workspaces, TTL-filters it, run-subsumes it, and publishes the frozen five-key
record. Applying the shared projection to that REAL record yields exactly the specified line:

```
sessions: [{ workspaceId: "9db1fd84f5895e38", repo: "aof", assistant: "claude-code", … }]
fleetCurrentWorkLines(presence) → { lines: ["working · aof (session)"], token: "primary", state: "working" }
```

**But neither shipped fleet surface can display it:**

| Surface | Session line implemented? | Receives presence? | Renders |
| --- | --- | --- | --- |
| **Desktop** (Rust/Tauri, m36) — *the surface whose UAT raised this bug* | ❌ `CurrentWork` is `Running \| Idle` (**F7**) | ✅ yes (`aof mesh status`) | **`idle`** |
| **Web** (React `Fleet.tsx`, m25/34) | ✅ `fleetCurrentWorkLines` | ❌ route carries no presence (**F6**) | **`idle`** |

So **SPEC objective (a) fails on every surface**: the node you are actively working on still reads `idle`, on the
very app whose UAT surfaced "the fleet lies about what a node is doing". The milestone did not close its own
headline bug.

**Two false premises this exposes (owed to the architect):**
- **ADR-004 asserts "Both UIs consume the SAME projection function (the m36 single-data-path discipline) — never
  two divergent collapse rules."** The premise is **false**: the desktop is a **Rust/Tauri** app and structurally
  *cannot* import `ui/src/fleet/runs.mjs`. The RULE can be shared; the IMPLEMENTATION is necessarily duplicated.
  The discipline that must replace the false premise: **both implementations are exercised against the SAME real
  captured presence payload**, so they cannot drift. ADR-004 is amended alongside tasks 08/09.
- **Story-00 task 04 claims "one pure projection shared by desktop (36) + web (25)."** In production it is shared
  by **neither** — the desktop doesn't use it, and the web never receives the data it needs.

**The recurring defect class — this milestone's real lesson.** F1, F4, F6, F7 and F8 are all *the same bug*: a
component was exercised against a **fixture shaped to its own convenience** and never against **its actual
producer**.
- **F1** — the reconciliation fitness test fed attributed run *objects*; the producer emits a bare `string[]`.
- **F4** — the session CLI was coded (and tested) against a hook payload carrying `workspace`/`repo`; the vendor
  sends `cwd`. The milestone's **own RESEARCH.md §2.2 had captured the real field set** — the contract contradicted it.
- **F6** — the card's render test fed a hand-built presence record; its real route carries no presence at all.
- **F7/F8** — the desktop was never fed the real payload either: it missed `sessions` entirely and mis-typed
  `activeRuns` as objects (F8 is F1's twin, in Rust).
- The build-time design **CONFORMS** verdict was itself a fixture-fed render — it validated the projection, not
  the product.

**The rule this milestone earns:** *wherever we do not own the producer (a vendor hook, an HTTP route, a
cross-language surface), the contract test MUST be fed a REAL captured payload from that producer. A "wiring" test
that inspects a command string, or a render test fed a hand-built record, proves nothing about production.*

## Gate

- `aof work validate` → **PASS — work stream is well-formed** (folder↔frontmatter, closed tag vocabulary,
  depends graph). Agent-layer checks hold: `@executable` test-traceability satisfied by the 2409-green
  suite; litmus clean — the `@manual`/`@uat` tags (task 06, task 04) are honest (a real assistant / a
  second machine + private repo — neither is `@executable`-coverable).

## Live / environmental checks (deferred human gates — the outsider proof of the SPEC objectives)

Both remaining tasks are the SPEC's outsider-verifiable acceptance and are **not** agent-runnable in this
session — they require a real environment and a human observer. Explicitly deferred to `aof:verify 38` by
the STORY / STATE / SECURITY docs. Operator elected (at `aof:verify`) to **run both live**, **task-06
first, task-04 after**; **status: in progress — awaiting the m38 build on the live daemon.**

> **Deploy prerequisite (found at verify, `2026-07-10`).** The running mesh (`aof.exe mesh serve` +
> `mesh ui`) was the **installed pre-m38 SEA**: it has no `aof session` verb (the wired Claude Code hooks
> fail against it) and its presence daemon publishes 4-key records with **no `sessions` key** (confirmed on
> the live `umairs-msi` / `umairs-mac-mini` presence). The m38 code is green in the working tree but
> uncommitted/undeployed — so the live soaks require the m38 SEA built + installed and the daemon restarted
> first. Operator is deploying m38 (their flow); task-04 additionally needs the second worker
> (`umairs-mac-mini`) on m38 + a real private repo + the SECURITY-approved credential. **Not a code
> defect** — a deploy step for uncommitted work; recorded so the soak result is read against the right build.

- **story-00 · `tasks/06_session-presence-soak.feature`** (`@manual` ×4 + `@uat` ×1) — SPEC objective (a):
  open a real coding assistant → node reads `working · <repo> (session)` within one heartbeat window; a
  second repo → BOTH show (`working · alpha, beta (session)`); graceful close → the line drops; **SIGKILL
  (no SessionEnd) → the node returns to `idle` on its own after the TTL** (proves TTL, not `end`, heals a
  crash); plus the `@uat` designer visual-review of the live NodeCard against DESIGN §Surface 1.
- **story-01 · `tasks/04_private-clone-soak.feature`** (`@manual` ×2) — SPEC objective (b): assign a story
  from the control node to a **second worker machine** lacking a **real private** repo; it clones with the
  SECURITY-approved credential into its scoped checkout, materializes a worktree, drives the ref to a
  terminal run — **no manual pre-setup**, no credential at rest (`.git/config` / process env / logs
  spot-checked) — while the fleet advances `assigned → running → done` live. Gated on the security sign-off
  below. **Status: NOT RUN** — deferred behind task-06 by operator choice; story-01 is independent of
  story-00 (ADR-007), so it remains verifiable on its own once a second machine + private repo are ready.

### Soak run 2 — after F4/F6/F7/F8/F9/F11 fixed: the pipeline works end to end (live, producer-fed)

All evidence below is from the **installed** stack (rebuilt SEA + rebuilt Rust desktop), driven by the **real**
Claude Code hook and the **real** `aof session` / `aof work run-start` producers — never a fixture.

- **Scenario 1 — a live assistant marks the node `working`: PASS.** The operator submitted a real prompt in a real
  Claude Code session; the wired `UserPromptSubmit` hook fired `aof session ping` → `Session pinged for claude-code
  on 9db1fd84f5895e38` → the presence daemon aggregated it → the card rendered **`working · aof (session)`** in
  `primary`. Verified on screen (headless render at 1280).
- **Scenario 2 — a node working two repos shows both: PASS.** Live sessions on `aof` + `pay-guard-portal` (two
  genuinely distinct registered workspaces) → the card rendered **`working · pay-guard-portal, aof (session)`** —
  comma-joined under ONE `working ·` prefix with ONE trailing `(session)`. *(This is only correct because F11 was
  fixed — before it, the second workspace's session was silently destroyed.)*
- **ADR-004 run-wins + ADR-003 aggregation, together: PASS.** With a REAL `running` run in the `aof` workspace and
  a live session in EACH workspace: `activeRuns` carried the run id **exactly once** (pre-F11 it was duplicated →
  `running 2 runs`); the `aof` session was **subsumed** by its own-workspace run; the `pay-guard-portal` session
  **survived** (different workspace, no run); and the card rendered BOTH lines —
  **`running 1 run`** + **`working · pay-guard-portal (session)`**, both in `primary`.
- **The SPEC's motivating case (the packaged tray app) — PASS, and this is the one that was broken.** Resolving the
  node's workspaces with cwd = the **install dir** (`C:\Users\Umair\.aof\bin`) now returns BOTH workspaces with
  **absolute, distinct** work dirs, each reading its OWN repo's items (`pay-guard-portal\wiki\work` → 72 items;
  `aof\wiki\work` → 154 items). **Before F11 it returned ZERO workspaces → permanently `idle`.**

### Soak run 1 `2026-07-10` — task-06, scenario 1: **FAILED** (blocker F4)

The m38 build was deployed live to run this soak (UI build → SEA build → install into
`C:\Users\Umair\.aof\bin\` → `mesh serve` relaunched; the daemon then correctly published the frozen FIVE
keys `nodeId, heartbeatAt, activeRuns, sessions, aofVersion` with `sessions: []`, node not stale). Precondition
held: the node read **`idle`**.

- **Scenario 1 — "a live assistant marks the node working within the heartbeat window": FAILED.** A real
  coding assistant (Claude Code, hooks wired per task 05) on repo `aof`, operator submitted a real prompt →
  the `UserPromptSubmit` hook fired `aof session ping` → **exit 1, `session-arg-missing-workspace`, no record
  written**. The node stayed `idle` (`sessions: []`; no `<meshRoot>/sessions/` directory). Root cause + fix:
  **finding F4** above.
- **Scenarios 2–4 (two repos / graceful close / SIGKILL + TTL self-expiry): NOT RUN** — each presupposes a
  live session record, which scenario 1 proves cannot exist. Blocked on the F4 fix.
- **Scenario 5 (`@uat` designer visual-review of the live `working · <repo> (session)` NodeCard): NOT RUN** —
  the state cannot be reached in a live render while F4 stands. Verdict therefore **INCONCLUSIVE** (naming the
  missing render), never inferred from component code. *(The build-time CONFORMS on a fixture-fed render still
  stands as evidence the render logic itself is faithful — but it was fed a synthetic presence payload, and it
  is exactly that "fixture-fed, never producer-fed" pattern that F1 and F4 both exploited. The live render
  must be re-judged after the F4 fix.)*

## Design conformance — `@uat` verdict (task 06, scenario 5)

**CONFORMS** — scoped: web Surface 1a (`GlobalNodePanel`), **1280px**, **all 6 of 6 States rows witnessed**
(was 2 of 5). Judged by `aof-designer` against DESIGN §Surface 1, on **three producer-fed live renders** (real
hook, real `aof session` CLI, a real `running` run record, real presence daemon, real `/api/mesh/status` route —
no fixtures):

| State | Verdict | Evidence |
| --- | --- | --- |
| `idle` | CONFORMS | all frames — muted |
| `running` | CONFORMS | Frame A — `running 1 run`, primary, correctly pluralised |
| `working-session` | CONFORMS | Frame A — `working · pay-guard-portal (session)` |
| `two-repos` | CONFORMS | Frame B — one prefix, comma-join, `(session)` once |
| `run + cross-workspace session` | CONFORMS | Frame A — two primary lines; the run's own-workspace session subsumed, the other survives |
| `stale-expired` | CONFORMS | Frame C — `idle`, muted, **with the dead session record still on disk**. No ghost |

**The designer corrected their own checklist against reality — the third time in this milestone that the DOCUMENT,
not the code, was the liar.** Frame A violated rules S1/S7/S9 *as originally written*, and the designer ruled the
**build correct and the doc wrong**: a run in workspace A and an editor open on workspace B are **two different
pieces of work on one machine**, not competing claims about one node. Enforcing the old per-node rule literally
would have **suppressed the second session — hiding real work, re-introducing this milestone's exact lie of
omission at a new address**. (The projection is even named `fleetCurrentWorkLines` — *plural*.) The checklist was
**tightened**, not bent: new **S11** (reconciliation is per-workspace, never per-node), S9 re-derived as bounded
growth, S6 now binds a deterministic repo order — and a fresh finding was raised against the build (DG-2).

- **DG-2 (design-gap, raised at review → FIXED):** the two-repo line's repo order was unbound (rendered
  `working · pay-guard-portal, aof (session)` — insertion order), so it would silently reshuffle between polls.
  The designer bound **deterministic alphabetical order by repo short name, in BOTH projections** (S6). Fixed in
  `ui/src/fleet/runs.mjs` and the Rust `status.rs` with a byte-wise (locale-independent) sort — identical in both
  languages so they cannot drift — plus order-independence tests in JS and Rust and a non-alphabetical **captured**
  fixture that gives the cross-surface byte-identity fitness function real teeth. Verified: input
  `[pay-guard-portal, aof]` and `[aof, pay-guard-portal]` both render `working · aof, pay-guard-portal (session)`.
- **S10 (both surfaces render the identical string) — verified by CONTRACT TEST, not by screenshot.** The designer
  ruled (correctly) that a byte-identity claim between two projections is a test's job, not a pixel's:
  `test/arch/acd-captured-producer-fixture.test.mjs` asserts both implementations render the same line for the same
  captured payload, and is green.
- **NOT ASSESSED (recorded, never inferred):** the **390/768 breakpoints** (unrenderable — at 390px this page is
  ~20,000px tall and the NODES region falls beyond the max canvas); the **Rust desktop's LOOK** (Surface 1b — S10
  closes the *string*, but its tokens/layout/two-line stack are unjudged); `running N runs` with **N ≥ 2 across two
  real workspaces**; and **repo-order stability across polls** (DG-2's fix is tested, not yet observed live over time).
- **Deferred design-gap DG-1** (recorded in DESIGN, not folded into m38): the product speaks **two presence
  vocabularies** (`♥ Ns` / `stale · Nm` / `no presence` vs `last seen 8d ago`). Pre-existing; correct answer is one
  ramp, one vocabulary.

## Accept decision

**Milestone 38 is NOT accepted. Story-00 is ACCEPTED; story-01 is NOT.**

### Story-00 `session-presence` — **ACCEPTED**

SPEC objective (a) now **holds in production, demonstrated live** — it did not when this verification began.

- `@executable` tasks 00–05 green, plus **four new `@bug` tasks** authored and made green at verify: **07** (F4),
  **08** (F6 + F9), **09** (F7 + F8), **10** (F11).
- Suite **2441 ok / 0 not ok, exit 0** (own run); `cargo test` **79 passed**; `npm run ui:build` green;
  `aof work validate` → **PASS**.
- **Soak scenarios 1–4 all PASS live** on the installed stack (see "Soak run 2"): a real assistant marks the node
  `working · aof (session)`; two repos show both; a graceful close drops the line; and a **hard-killed** session
  self-expires via TTL — its record still physically on disk, `end` never called — leaving the node `idle` with no
  ghost. **TTL, not `end`, healed the crash.**
- `@uat` design conformance: **CONFORMS** (6/6 states witnessed), with DG-2 raised and fixed.
- No blocker finding remains open against story-00.

### Story-01 `worker-repo-checkout` — **NOT ACCEPTED (unverified, not failed)**

Its `@executable` lanes (tasks 00–03) and the F1/F2 security fitness functions are green — **but green is not
evidence, and this milestone proved that six times.** Its `@manual` two-machine private-clone soak (**task 04**) has
**never been run**, and the operator sign-off on SECURITY residuals **R1/R2/R4** (token-minting policy, deploy-key
fallback, the inherited m35 RCE posture) has not been given. **SPEC objective (b) — a worker cloning a private repo
across machines with no manual pre-setup — has therefore never been demonstrated.** Deferred by operator choice at
verify; independent of story-00 (ADR-007), so it can close on its own once a second machine + a real private repo +
the approved credential are available.

### Milestone — **NOT accepted; stays `in-progress`**

A milestone is accepted only when **all** its stories are. Story-01's outsider check is outstanding, so `SPEC.md`
`status` stays `in-progress`. Given what the soak did to story-00's "green" lanes, accepting story-01 on the
strength of its passing tests alone would be exactly the mistake this milestone spent itself teaching.

### Open, non-blocking (carried forward)

- **F3** — task-00's unsatisfiable Scenario-Outline row; amend the `.feature` at next refine.
- **F5** — `aof session <verb>` reads stdin unconditionally (guards only `isTTY`), so a flags-only caller with an
  open non-TTY stdin **hangs forever**. Real hooks are unaffected (Claude Code closes stdin). Fix: skip the stdin
  read when the flags already resolve identity.
- **F10** — `app/desktop/ui/app.js`'s demo fixtures still encode the **object-shaped `activeRuns`**
  (`{ ref, title }`) that the producer never emits — the very fixture that taught the Rust code the wrong shape
  (F8). It is dev-only, but it will re-teach the next developer the same lie. Delete or re-capture it from the real
  producer.
- **Verification artifacts left on the work stream:** two **cancelled** run records on item 38
  (`20260712T213809392Z-0000`, `20260712T222849065Z-0001`) — created deliberately to witness the `running` /
  run-wins states, both driven to terminal. Harmless (never `running`), but they are mine, not the project's; prune
  if unwanted.
- **One unexplained transient:** during the TTL poll, a single `/api/mesh/status` response came back without a
  `nodes` key, then self-recovered; both daemons stayed up. Not reproduced. Logged, not diagnosed.
