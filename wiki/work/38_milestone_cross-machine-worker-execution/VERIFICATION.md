---
doc: verification
milestone: 38
updated: 2026-07-24
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

## Story-02 · clone-credential-mint — Verification & accept (`aof:verify 38/02`, 2026-07-16)

Story-02 was added `2026-07-13` and built + reviewed `2026-07-16` (`aof:continue 38/02`, all four lenses GO)
after the milestone-level verify above ran. This is its own story-level accept — its `@manual` real-App soak
(task 05) is deliberately NOT run here; it is the milestone's deferred human gate, closed at `aof:verify 38`.

### Verification evidence — `@executable` suite + fitness functions (GREEN, producer-fed)

- **Story-02 `@executable` tasks 00–04 green, deterministically:** `node scripts/test.mjs` — **40 story-02
  assertions ok, 0 not ok**, stable across three consecutive full-suite runs. Covers: the config-selected mint
  provider (`env-token` default byte-identical | `github-app`) resolved at the launcher and injected as a
  LITERAL `mintCloneCredential` key with the T6/F15/F16 authz gates still preceding every mint (task 00); the
  `github-app` provider resolving owner/repo from the CONTROL's committed `cloneUrl`, signing an App JWT with
  `node:crypto` RS256, auto-resolving the installation, and requesting a token for EXACTLY the assigned repo,
  `contents:read` (task 01); the App key reaching only the signer — never a frame, log, or ambient env, with
  key+token redacted on failure and no token at rest (task 02); the prompt-aware `GIT_ASKPASS` shim (Username →
  `x-access-token`, Password → token) with the env-token PAT path still authenticating (task 03); and every
  `github-app` fault throwing a coded `clone-credential-mint-failed` → the worker's loud
  `assignment-repo-unavailable`, never a null / env-token fallback / unauthenticated clone (task 04).
  verifies → `tasks/00_*`–`tasks/04_*`.
- **All three story-02 fitness functions green, each with a non-vacuous, landing-asserted self-check** (armed at
  build, not spec — a detector over an unbuilt provider would be vacuous, per ADR-008):
  `acd-clone-credential-provider-config-driven` (F7 — the mint is config-resolved at the seam; no hard-coded
  single provider; the `env-token` default path unchanged), `acd-clone-app-key-not-relayed` (F5 — the App
  private key AND the mint JWT never cross the relay and are never logged; scan set widened at review to
  `mesh-launcher.mjs` + a `jwt` needle), `acd-minted-token-scoped-single-repo` (F6 — the `github-app` mint
  requests an installation token for EXACTLY the assigned repo with `contents:read`; a multi-repo array, a
  write permission, a broader permission set, or an omitted key ALL trip the detector). verifies → the three
  fitness units named in STORY.md `## Fitness units`.
- **Producer-fed, not fixture-fed (the milestone's defining lesson, correctly answered — STATE `2026-07-16`):**
  the JWT is signed by the REAL `node:crypto` RS256 signer and verified with `createVerify`; "no credential at
  rest" runs a REAL `cloneRepoForWorkspace` against a REAL local bare repo; the askpass is a REAL spawn with
  real prompt argv; task-00 drives the REAL `startLauncher` control wiring with NO options override, so the F12
  literal-key mint path is genuinely producer-fed.

### Environmental note — the known pre-existing `reclaim-scheduler/06` flake (NOT a story-02 defect)

Two of three full-suite runs this session tripped a single `not ok` on `mesh-reclaim-scheduler` case 06 — a
different sub-assertion each run, always `Error: EBUSY: resource busy or locked, unlink … projection.sqlite`
(a Windows temp-file teardown race releasing the SQLite handle after the temp-dir cleanup unlinks it). This is
the **pre-existing, milestone-35 scheduler-case flake already recorded in STATE `## Feedback (for retro)`
(`~1/5 in isolation, a different sub-case each time`) and routed to a stabilisation chore** — orthogonal to
story-02 (whose 40 assertions stayed green on every run). Recorded so the "0 not ok" baseline is read
honestly: it is not reliably reproducible on this host until the flake (and the hardcoded-`:4182` bind) are
stabilised. No new finding raised — it already has a home.

### Deferred — task 05 `@manual` real-App soak (the milestone gate, not run here)

`tasks/05_real-app-mint-soak.feature` (`@manual`) is the outsider proof: a REAL GitHub App installed
least-privilege mints a REAL installation token that clones a REAL private repo the worker lacks, drives to a
terminal run, no credential at rest — plus the operator's least-privilege-App attestation (the ONE human
attestation that REPLACES story-01's per-repo-PAT scope/TTL sign-off, now code-enforced). It requires a real
App + a real private repo + a second worker machine → not agent-runnable → **explicitly deferred to
`aof:verify 38`** by STORY / SPEC / STATE. INCONCLUSIVE at this story level by construction (no live
environment), NEVER inferred from the code. No `@uat` scenario exists in this story, and it has no UI surface
(`@cli @work @distribution`), so no human sign-off and no design-conformance lane apply.

### Gate

- `aof work validate 38` → **PASS — 38 is well-formed** (folder↔frontmatter, closed tag vocabulary, depends
  graph), exit 0. Agent-layer checks hold: story-02 `@executable` test-traceability is satisfied by the wired,
  green tasks 00–04 modules; litmus clean — task 05's `@manual` tag is honest (a real App + private repo +
  second machine is not `@executable`-coverable).

### Accept decision — story-02

**Story-02 `clone-credential-mint` — ACCEPTED.** Its `@executable` lanes (tasks 00–04) and all three fitness
functions are green and producer-fed; its build review passed all four lenses with only LOW hardening items,
all applied; the gate is PASS; and **no blocker finding is open against it**. SECURITY **T4**'s
operator-attested minting-policy residual is closed BY CONSTRUCTION (`acd-minted-token-scoped-single-repo`
code-enforces single-repo / `contents:read`). Its sole human gate (task 05) is the milestone's deferred soak,
not a story-level check — so the story accepts now; the live outsider proof of SPEC objective (b)'s
credential automation is witnessed at `aof:verify 38`.

## Accept decision

**Milestone 38 is NOT accepted. Story-00 ACCEPTED; story-02 ACCEPTED; story-01 NOT (unverified soak).**
_(Updated `2026-07-16` — story-02 accepted; see its section above. The pre-story-02 verdict below stands for
stories 00/01.)_

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

---

## Verify pass `2026-07-19` — stories 03–08 landscape (milestone still NOT accepted)

_This VERIFICATION.md above was written at the `2026-07-16` pass, which predates stories 03–08 (added
`2026-07-18`, built `2026-07-18`/`2026-07-19`). This section records the current pass over the newly-built
span. Story-level status: **00 done, 02 done; 01, 03, 04, 05, 06, 07, 08 all `in-review`** with unrun
soaks. A milestone accepts only when **all nine** stories are done — so 38 stays `in-progress`._

### Automated foundation — GREEN (re-confirmed this pass)

- **All 22 m38 fitness-function arch-tests pass — fresh `node --test` run this session, 22/22, 0 fail.**
  The story-00/01/02 set (session presence, TTL, aggregation, reconciliation, clone-target-scoped, no-credential-persisted,
  worktree-reuse, provider-config-driven, app-key-not-relayed, minted-token-scoped) plus the story-03–08 additions
  (`acd-cross-org-key-isolation`, `acd-fleet-face-single-mutation-route`, `acd-write-token-scoped-to-push`,
  `acd-worker-driver-no-headless-print`, `acd-fleet-terminal-mirror-read-only`, `acd-memory-index-never-on-mesh`,
  `acd-work-insert-command-bundle-parity`, `acd-captured-producer-fixture`, `acd-clone-credential-pull-not-pushed`,
  `acd-presence-write-scope`). verifies → the fitness units named in each STORY.md.
- **Full integrating suite** recorded `2026-07-19` (STATE `## Verification`): **2883 ok / 8 not-ok** — the 8 are the
  pre-existing/external flakes already routed to the stabilisation chore (`mesh-reclaim-scheduler/06`,
  `mesh-coordination-launcher/03`≡`global-work-propagation/03`, the `memory-integration` LLM-extraction flake, the
  `doctor` date-blind fixtures now inside the 30-day stale window, and the hardcoded-`:4182` bind). **Not re-run in full
  this session, deliberately:** a **live two-machine mesh** holds `:4182` (finding **F13** collision would crash the run —
  the running daemon must NOT be disrupted mid-soak), and the worker-driver modules hang on a real `claude` if run without
  a `spawnRuntime` override (STATE broad-blast lesson — "the review harness must never run a worker-execution test").

### Findings — two deliberately-deferred SOAK-BLOCKERS, confirmed STILL OPEN at source

Both were raised at the build review of stories 05/06 and **intentionally not fixed** — deferred to this verify soak
(STATE `## Feedback (for retro)`). Confirmed at the source this pass; both gate their story's `@manual` soak and are
**`aof:continue`-class (build the missing producer/transport), not verify-class** — a soak run now would exercise inert
production code.

| id | observed (confirmed at source) | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- | --- |
| **F-38.05** | The `NEEDS_INPUT` / `AOF_SESSION_ID:` **producer is unwired.** [`mesh-worker-execution.mjs:857-860`](../../../src/mesh-worker-execution.mjs#L857-L860) types **only** `brief.command` into the PTY (`term.write(\`${command}\n\`)`); no prompt preamble instructs a real `claude` to emit either marker (ADR-013 decision-4). The sentinels exist only as consumer-side scanners (`buffer.includes(NEEDS_INPUT_SENTINEL)`, line 735). ⇒ in production the `needs-input` outcome (task 02) can never fire and `session_id` (task 03) is always `null`. The F4 class at the sentinel seam. | correctness (inertness) | **BLOCKER (soak)** | build the driver prompt preamble + measure how an interactive session surfaces its `session_id` BEFORE the soak | `aof:continue 38/05` | **FIXED `2026-07-19` (`aof:continue 38/05`) — producer-wired: session_id via transcript-dir watch, NEEDS_INPUT via worker-scoped `--append-system-prompt`; ADR-013 amended + fitness rewritten to pin the PRODUCER (inv 4/6); architect + QA both GO; story-05 lanes+fitness 27/0. Awaiting re-verify at the task-04 `@manual` soak (real-`claude` efficacy + snapshot-race capture rate — un-`@executable`).** |
| **F-38.06** | The terminal **stream transport is unwired** AND rides a transport production never starts. The only `serveRelay`/`relayMode` reference in [`mesh-launcher.mjs:21`](../../../src/mesh-launcher.mjs#L21) is a **comment**; no production call site wires `relayMode()`/`terminalMirror`/`onOutputChunk` into the launcher, and `aof mesh ui` never passes `startTerminalRelaySubscriber`. ⇒ the mirror receives no live frame on a real two-machine deploy (SPEC "watch a worker's live terminal" is inert). `@executable` lanes are honestly green against the in-process `serveRelay()` broker only. | correctness (inertness) | **BLOCKER (soak)** | wire the transport per the **ADR-014 amendment** (wire `relayMode()` into the control launcher OR pivot the bridge onto `control-stream-server`/`worker-stream-client`) BEFORE the soak | `aof:continue 38/06` | **OPEN** |

### Human / environment gates outstanding — the `@manual`/`@uat` soaks (per in-review story)

None of these are agent-runnable in this session: each needs a **real two-machine mesh** (which is live now), and/or a
**real private repo**, **real (per-org) GitHub App(s)**, a widened **`contents:write`** credential, or a **human observer**.
They are the SPEC's outsider-verifiable acceptance and are the operator's "works in a real-world scenario" bar.

| story | soak owed | needs | blocked by |
| --- | --- | --- | --- |
| **01** worker-repo-checkout | task 04 private-clone soak | 2nd machine + real **private** repo + SECURITY R1/R2/R4 sign-off | — |
| **03** per-org-credential-scoping | tasks 00/01/03 two-org soak | **two real per-org GitHub Apps** (distinct keys/installations) | — |
| **04** ui-driven-assignment | tasks 00/02/04 real-UI soak (+ design conformance, UI surface) | live board + assignment to a worker + human | — |
| **05** terminal-driven-worker-execution | task 04 subscription soak | live worker PTY | **F-38.05 (build first)** |
| **06** worker-terminal-streaming | task 03 stream soak | 2-machine live PTY relay | **F-38.06 (build first)** |
| **07** durable-worker-pushback | tasks 00–03 push soak | real branch + push + **`contents:write`** credential (re-opens SECURITY T9) + 2 machines | — |
| **08** worker-verified-memory-syncback | task 02 end-to-end mesh soak + `@uat` recall | full worker→control `git pull` + `memory ingest` chain + human recall sign-off | dep 07 |

### F-38.05 producer measurement (the deferred precondition) — DONE this pass

The step the build review deferred to this verify ("measure how an interactive session surfaces its
`session_id` BEFORE building the producer") is now measured on this machine — read-only, no build:

- **`session_id` is surfaced as the transcript FILENAME:** `~/.claude/projects/<cwd-slug>/<session_id>.jsonl`.
  Proven live — this verify session is `d014c661-…` (matches its own scratchpad path), and **real prior
  worker runs left worktree-keyed transcript dirs on disk** (`C--…-aof-mesh-worktrees-asg-00-gap-a-local-wins/`
  et al., each holding a `<uuid>.jsonl`). So a worker spawning interactive `claude` (cwd = worktree,
  empty-args via `terminal-providers`) gets a deterministic `~/.claude/projects/<slug(worktreeCwd)>/<session_id>.jsonl`
  whose slug it can compute and whose directory it can watch — zero cooperation from the model.
- **The as-built capture has NO producer.** [`mesh-worker-execution.mjs:713-732`](../../../src/mesh-worker-execution.mjs#L713-L732)
  scans the PTY output for an `AOF_SESSION_ID:` marker that nothing emits; ADR-013 decision-4's premise
  (Claude Code "sets `CLAUDE_SESSION_ID`" / "asks the driven session to surface its id onto its own terminal")
  is unproducer'd — claude does not print its session_id and the model can't self-report it. Same F4/F-38.05 class.
- **Build direction for `aof:continue 38/05`:** replace the PTY-marker capture with a transcript-dir watch
  (deterministic), and give the `NEEDS_INPUT` instruction a real home. ADR-013 decision-4 + RESEARCH §4.3 to be
  corrected to the transcript-filename mechanism at build.
- **SCOPE FINDING (this pass): the fix is architect+developer `aof:continue`, not a contained producer tweak —
  the fitness function `acd-worker-driver-no-headless-print` STRUCTURALLY PINS the producerless mechanism.**
  Verified at source ([`test/arch/acd-worker-driver-no-headless-print.test.mjs`](../../../test/arch/acd-worker-driver-no-headless-print.test.mjs)):
  invariant 3's behavioural check asserts `spawnCalls[0].args === []` (no launch arg) **and**
  `ptys[0].writes === [`\`${command}\n`\`]` (exactly ONE pty.write, only the command) — so the `NEEDS_INPUT`
  preamble has **nowhere to go** (not a typed write, not a launch arg); invariant 4 requires
  `extractSessionIdFromOutput` + the `AOF_SESSION_ID:` marker → sessionId, i.e. it pins the exact producerless
  path F-38.05 must remove. **The green fitness function is itself part of why F-38.05 shipped inert.** Closing
  F-38.05 therefore requires the ARCHITECT to rewrite ADR-013 decision-3/4 + this fitness function to the
  transcript mechanism (and choose the `NEEDS_INPUT` instruction's home — likely inside the typed `/aof:*` bundle
  command's own prompt), THEN the developer builds the producer + rewrites tasks 02/03's tests — a proper
  `aof:continue 38/05`, provable only at the task-04 soak. A new lesson for the retro: **a fitness function armed
  at build against an as-built shape can LOCK IN a producerless consumer, turning green into a barrier to the fix.**

### Accept decision — Milestone 38 **NOT accepted; stays `in-progress`**

- **Automated lanes GREEN** (22/22 m38 fitness fresh; integrating suite 2883/8-flakes recorded today) — but a green suite
  is not evidence a feature works: **this milestone proved that six times** (F1/F4/F6/F7/F8/F12). The two soak-blockers
  below are that exact class, still armed.
- **Two blocker findings are OPEN** (F-38.05, F-38.06): stories 05 and 06 carry **inert production code** — soaking them now
  would soak nothing. Both must go back to `aof:continue` to build the missing producer/transport **before** their soaks.
- **Seven stories (01, 03, 04, 05, 06, 07, 08) have unrun live human/environment soaks** — the operator's real-world bar.
  Not agent-runnable this session.
- No story can be honestly closed on its passing tests alone. Milestone `SPEC.md` `status` stays **`in-progress`**.

## Story-05 · terminal-driven-worker-execution — verify & **DECLINE** (`aof:verify 38/05`, 2026-07-19)

Story-level verify of `38/05` (status `in-review`). **Not accepted — an open BLOCKER finding stands** (F-38.05),
so `STORY.md` `status` stays `in-review`. The `@executable` lanes are green, but this milestone has proved six
times that green is not evidence, and F-38.05 is that exact class at the sentinel seam.

### Verification evidence — `@executable` suite + fitness (GREEN, re-confirmed fresh this session)

- **Story-05 `@executable` tasks 00–03 green, isolated re-run this pass:** the four focused task modules
  (`mesh-worker-driver-interactive-pty` / `-directive-command` / `-needs-input` / `-session-id`) → **4/4 ok, 0
  not-ok** under `AOF_GLOBAL_HOME=$(mktemp -d)`. Covers: interactive `claude` resolved through the
  `terminal-providers` seam (empty-args launch, never `claude -p`); the directive's whole command typed as ONE
  newline-terminated `pty.write` into ONE long-lived session; the `NEEDS_INPUT` sentinel → a THIRD `needs-input`
  outcome NOT re-mapped to `done`, worktree RETAINED; `session_id` captured/surfaced, empty/absent degrading to
  null. verifies → `tasks/00_*`–`tasks/03_*`.
- **Fitness `acd-worker-driver-no-headless-print` green** (isolated `node --test`, 1/1 ok) — the structural +
  injected-seam-behavioural guard that no `-p`/`--print`/`--output-format` token survives in the spawned worker
  argv. verifies → the story's `## Fitness units`.
- **No UI surface** (`@cli @work @distribution`) and **no `@uat` scenario** in this story, so no design-conformance
  and no human sign-off lane apply.

### Findings — the blocker is OPEN, confirmed at the source this pass

| id | observed (confirmed at source, this pass) | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- | --- |
| **F-38.05** | The `NEEDS_INPUT` / `AOF_SESSION_ID:` **producer is still unwired.** [`driveInteractiveClaudeSession`](../../../src/mesh-worker-execution.mjs#L886-L896) types **only** `brief.command` into the PTY (`term.write(\`${command}\n\`)`); no preamble/prompt instructs a real `claude` to emit either marker. The sentinels exist ONLY as consumer-side scanners ([`containsNeedsInputSentinel`](../../../src/mesh-worker-execution.mjs#L761), [`extractSessionIdFromOutput`](../../../src/mesh-worker-execution.mjs#L739)). ⇒ in production the `needs-input` outcome (task 02) can NEVER fire and `session_id` (task 03) is ALWAYS `null`. The `2026-07-19` continue-review fast-follow hardened the **consumer** half only (line-anchored sentinel, whitespace-terminated id, real fixture dispose) — the **producer** was deliberately not built. This is the F4 green-≠-working class at the sentinel seam. | correctness (inertness) | **BLOCKER** | **`aof:continue 38/05`** (architect + developer, NOT verify-class): rewrite ADR-013 decision-3/4 + the `acd-worker-driver-no-headless-print` fitness function — its invariants 3/4 STRUCTURALLY PIN the producerless mechanism (assert `ptys[0].writes === [\`${command}\n\`]` and the `AOF_SESSION_ID:` marker path), so a green fitness function is itself part of why F-38.05 shipped inert — then build the producer as a **transcript-dir watch** (`~/.claude/projects/<slug(worktreeCwd)>/<session_id>.jsonl`, the deterministic mechanism measured at the `2026-07-19` pass) and choose the `NEEDS_INPUT` instruction's home. | `aof:continue 38/05` | **FIXED `2026-07-19` (`aof:continue 38/05`) — producer-wired: session_id via transcript-dir watch, NEEDS_INPUT via worker-scoped `--append-system-prompt`; ADR-013 amended + fitness rewritten to pin the PRODUCER (inv 4/6); architect + QA both GO; story-05 lanes+fitness 27/0. Awaiting re-verify at the task-04 `@manual` soak (real-`claude` efficacy + snapshot-race capture rate — un-`@executable`).** |

### Gate

- `aof work validate 38` → **PASS — 38 is well-formed** (folder↔frontmatter, closed tag vocabulary, depends
  graph), exit 0.

### Deferred — task 04 `@manual` subscription soak (the milestone gate, not run here)

`tasks/04_terminal-run-subscription-soak.feature` (`@manual`) is the outsider proof: a REAL worker runs a REAL
assigned command as interactive `claude` in a PTY on the worker's **subscription** (no `-p`, no
`ANTHROPIC_API_KEY`), a mid-run judgment ends `needs-input` with the worktree retained + `session_id` surfaced,
and a human `claude --resume <session_id>` continues the SAME session. It requires a live worker PTY → not
agent-runnable → the milestone's **deferred human gate**, closed at `aof:verify 38`. It is additionally **gated on
F-38.05**: soaking it now would exercise inert production code. INCONCLUSIVE at this story level by construction.

### Accept decision — story-05

**Story-05 `terminal-driven-worker-execution` — NOT ACCEPTED (blocked, not failed).** Its `@executable` lanes and
fitness function are green and were re-confirmed fresh this session, but a **blocker finding (F-38.05) is open**:
the interactive driver ships the CONSUMER half of the `NEEDS_INPUT`/`session_id` contract with **no producer at
all**, so tasks 02/03's behaviour is inert in production. Accepting on the strength of the green lanes alone would
be exactly the mistake this milestone spent itself teaching (green ≠ working). Routed back to **`aof:continue
38/05`** to build the producer (and rewrite the ADR + fitness function that pin the producerless shape) BEFORE the
task-04 soak. `STORY.md` `status` stays **`in-review`**; the milestone remains `in-progress`.

## Story-05 · terminal-driven-worker-execution — RE-VERIFY & **ACCEPT** (`aof:verify 38/05`, 2026-07-19, after the F-38.05 fix)

Re-verify of `38/05` after the DECLINE above was remediated. The DECLINE was **conditional** — "routed back to
`aof:continue 38/05` to build the producer" — and that build has since landed (`aof:continue 38/05`, STATE
`2026-07-19`). This pass confirms the fix **at the source** (not on the strength of the record note), re-runs the
lanes + fitness fresh, and — the sole blocker now closed — **accepts** the story. Task-04 remains the milestone's
deferred human gate, exactly as story-02's task-05 was when story-02 accepted.

### F-38.05 remediation — confirmed at the SOURCE this pass (the producer is real, not a record claim)

The blocker was "the `NEEDS_INPUT`/`session_id` producer is unwired — the consumer half ships inert." Both producers
now exist, read directly in [src/mesh-worker-execution.mjs](../../../src/mesh-worker-execution.mjs):
- **`session_id` producer — the transcript-dir watch.** `defaultWatchTranscriptSessionId`
  ([mesh-worker-execution.mjs:792](../../../src/mesh-worker-execution.mjs#L792)) snapshots
  `<claudeProjectsDir(worktreeCwd)>/*.jsonl` before spawn and resolves the FIRST NEW `<session_id>.jsonl` basename —
  Claude Code itself is the producer, zero model cooperation; never throws, abort-aware, `maxWaitMs`-bounded, degrades
  to `null`. Wired as the default of the injected `options.watchTranscriptSessionId` seam
  ([:918](../../../src/mesh-worker-execution.mjs#L918)); the resolved id is threaded onto the driver's own outcome
  (`finish` awaits the aborted watch, [:984-1000](../../../src/mesh-worker-execution.mjs#L984-L1000)). The retired
  `AOF_SESSION_ID:` PTY marker / `extractSessionIdFromOutput` / `SESSION_ID_MARKER` are gone.
- **`NEEDS_INPUT` producer — a worker-scoped launch arg.** `resolveInteractiveDriverLaunch`
  ([:892](../../../src/mesh-worker-execution.mjs#L892)) appends `--append-system-prompt NEEDS_INPUT_INSTRUCTION` to
  the interactive launch ([:899](../../../src/mesh-worker-execution.mjs#L899)); `NEEDS_INPUT_INSTRUCTION`
  ([:769](../../../src/mesh-worker-execution.mjs#L769)) embeds `${NEEDS_INPUT_SENTINEL}` so producer + detector share
  the one literal. Worker-only BY CONSTRUCTION — the human `/ws/terminal` route calls `resolveProvider` directly and
  never reaches this function, so it can never false-fire on a human session.
- **The fitness function now PINS the producer, not the producerless shape.** [`acd-worker-driver-no-headless-print`](../../../test/arch/acd-worker-driver-no-headless-print.test.mjs)
  invariant 4 requires the transcript-watch wiring (`claudeProjectsDir` imported+called, the seam defined+wired) and
  invariant 6 requires the `--append-system-prompt NEEDS_INPUT_INSTRUCTION` producer to EXIST; both self-checks land
  (`assert.notEqual(planted, source)` before asserting the trip) — so a revert to producerless trips CI. This closes
  the SCOPE FINDING (*a fitness function must pin the PRODUCER's existence, not the consumer's current shape*).

### Verification evidence — `@executable` lanes + fitness (GREEN, fresh isolated re-run this session)

- **Story-05 tasks 00–03 + the fitness function: 27 ok / 0 not-ok**, run isolated under `AOF_GLOBAL_HOME=$(mktemp -d)`
  via a focused runner over the four task suites + `archTests` (the full `scripts/test.mjs` deliberately NOT run — a
  live two-machine mesh holds `:4182` (finding F13 would crash the run) and the worker-driver modules hang on a real
  `claude` without a `spawnRuntime` override; every focused test drives INJECTED `ptySpawn`/`which`/`watchTranscriptSessionId`
  seams — no real `claude`, no PTY, no network). The three invariants the DECLINE recorded as failing are **now green**:
  invariant 4 (session_id via transcript-dir watch, real producer), invariant 6 (the `NEEDS_INPUT` `--append-system-prompt`
  producer), and invariant 3's behavioural argv check (`launchArgs[0] === "--append-system-prompt"`, exactly one
  `pty.write` of the command). Includes the review-fast-follow hardening (whole-line sentinel, whitespace-terminated id,
  real fixture `dispose`) and the hermetic real-temp-fs `defaultWatchTranscriptSessionId` block (snapshot-excludes-preexisting
  / deadline-null / abort-null). verifies → `tasks/00_*`–`tasks/03_*` + the story's `## Fitness units`.
- **No UI surface** (`@cli @work @distribution`) and **no `@uat` scenario** in this story → no design-conformance and no
  human sign-off lane apply.

### Gate

- `aof work validate 38` → **PASS — 38 is well-formed** (folder↔frontmatter, closed tag vocabulary, depends graph),
  exit 0. Agent-layer checks hold: `@executable` test-traceability satisfied by the 27/0 focused run + the fitness/task
  modules registered in `scripts/test.mjs` (invariant-8 asserts the registration); litmus clean — task-04's `@manual`
  tag is honest (a real subscription worker PTY + a human `claude --resume` is not `@executable`-coverable).

### Deferred — task 04 `@manual` subscription soak (the milestone gate, unchanged)

`tasks/04_terminal-run-subscription-soak.feature` (`@manual`) stays the milestone's deferred human gate, closed at
`aof:verify 38`: a REAL worker runs a REAL command as interactive `claude` on **subscription** (no `-p`, no
`ANTHROPIC_API_KEY`), a mid-run judgment ends `needs-input` with the worktree retained + `session_id` surfaced, and a
human `claude --resume <session_id>` continues the SAME session. Not agent-runnable (needs a live subscription worker
PTY + a human). The `@executable` build proves DETECTION + producer WIRING; the soak measures what no injected test can —
**NEEDS_INPUT real EFFICACY** (does a live `claude` obey the `--append-system-prompt` and emit the sentinel) and the
**session_id snapshot-race CAPTURE RATE** on a real fast session. INCONCLUSIVE at this story level by construction, never
inferred from the code.

### Note — the verified fix is in the WORKING TREE, uncommitted

The story-05 producer fix (`src/mesh-worker-execution.mjs` modified; `src/work-observe.mjs` +
`test/arch/acd-worker-driver-no-headless-print.test.mjs` + the rewritten `test/mesh-worker-driver-session-id.test.mjs`
untracked) and the story 06/08 work all live in the working tree — the last commit (`221fae0`) covers stories 03/04/07
only. Verify accepts the verified working-tree state; **committing + pushing is the downstream `aof:code-review` step**,
not a verify concern. Recorded so the accept is read against the right build state.

### Accept decision — story-05

**Story-05 `terminal-driven-worker-execution` — ACCEPTED.** The sole blocker (F-38.05) is **FIXED and confirmed at the
source** (both producers wired; fitness rewritten to pin the producer, green + non-vacuous); the `@executable` lanes +
fitness are 27/0 green and producer-WIRED (no longer the inert consumer the DECLINE found); `aof work validate 38` is
PASS; there is no UI surface and no `@uat` scenario; and **no blocker finding remains open** against it. Its sole
remaining check — task-04's subscription soak — is the milestone's deferred human gate (real-`claude` efficacy +
capture-rate), not a story-level check, exactly as story-02's task-05 was when story-02 accepted. `STORY.md` `status` →
**`done`**; the box is ticked in `SPEC.md` `## Stories`. **The milestone stays `in-progress`** — 3 of 9 stories done
(00, 02, 05); 01/03/04/06/07/08 remain `in-review` pending their own `@manual` soaks + accept at `aof:verify 38`.

## Verify pass `2026-07-19` (re-invocation) — state re-checked at source; **NOT accepted** (unchanged)

`aof:verify 38` re-invoked. Only the lanes runnable without a human / real infrastructure were exercised this
pass; the record above already documents the full landscape — this is the honest re-confirmation, not a new verdict.

- **Automated foundation GREEN, re-run this pass:** `node --test test/arch/*.test.mjs` → **217 ok / 0 fail**
  (isolated under `AOF_GLOBAL_HOME=$(mktemp -d)`), covering all 22 m38 fitness functions — no regression.
  `aof work validate 38` → **PASS — well-formed.** The full integrating `scripts/test.mjs` was **deliberately
  NOT run** (unchanged reasons): a **live two-machine mesh holds `:4182`** (finding **F13** collision would crash
  the run mid-soak) and the worker-driver modules hang on a real `claude` without a `spawnRuntime` override. Last
  recorded full run stands: 2883 ok / 8 pre-existing-or-external flakes (all routed to the stabilisation chore).
- **F-38.06 re-confirmed OPEN — at the source directly, not on the record note.** `mesh-launcher.mjs` carries
  **zero** `onOutputChunk` / terminal / bridge wiring; `control-stream-server.mjs`'s only `terminal` references are
  assignment-**state** (F16), not terminal-frame streaming; `worker-stream-client.mjs` has **no** terminal-frame
  push at all. The worker-side `mesh-terminal-relay-bridge.mjs` and fleet-face `mesh-terminal-mirror.mjs` modules
  exist (mirror is wired into `mesh-ui-serve.mjs`), but **nothing in production pushes a `terminal-frame` over the
  cross-machine transport** — so the fleet mirror receives no live frame on a real two-machine deploy, exactly the
  inert-on-real-deploy condition F-38.06 records. Story 06 is **`aof:continue 38/06`-class (build the transport per
  the ADR-014 amendment), NOT soak-ready** — its task-03 stream soak would exercise inert code.
- **No story could be accepted this pass.** 6 of 9 remain `in-review`, each gated on a `@manual`/`@uat` soak that is
  **not agent-runnable in a non-interactive session** — and story 06 additionally carries an open build blocker:

  | story | why it cannot close this pass |
  | --- | --- |
  | **01** worker-repo-checkout | 2nd machine + real **private** repo + SECURITY R1/R2/R4 operator sign-off |
  | **03** per-org-credential-scoping | **two** real per-org GitHub Apps (distinct keys/installations) |
  | **04** ui-driven-assignment | live board UI + assignment to a worker + human observer; design-conformance render **INCONCLUSIVE** (no `work.ui.baseUrl`, no `--url`; live daemon not poked mid-soak) |
  | **06** worker-terminal-streaming | **F-38.06 CLOSED `2026-07-19` via `aof:continue 38/06`** — hybrid transport wired (fabric worker→control, loopback control→UI); review also fixed F17 (cross-node spoofing) + F-38.06b (config footgun); fitness sweep 39/0. Now soak-ready: task-03 2-machine PTY-relay soak measures real efficacy + T14 on-screen-credential inspection |
  | **07** durable-worker-pushback | real branch + push + `contents:write` credential (re-opens SECURITY T9/T15; needs operator App-widening attestation) + 2 machines |
  | **08** worker-verified-memory-syncback | dep 07; full worker→control `git pull` + `memory ingest` chain + human recall `@uat` sign-off |

### Accept decision — Milestone 38 **NOT accepted; stays `in-progress`** (unchanged)

A milestone accepts only when **all nine** stories are done. 3 are (00, 02, 05); 6 remain `in-review`. The
automated foundation is green, but — as this milestone proved six times — green is not evidence the feature works;
the outsider proof for the remaining six is their real-world soak, none of which is agent-runnable here, and story
06 is not even soak-ready (F-38.06).

---

## Verify pass `2026-07-23` — F-38.06's transport confirmed closed, a NEW blocker one seam further on; **NOT accepted**

`aof:verify 38` re-invoked after `b123fd2` (m38 stories 05/06/08 + the F-38.06 terminal-stream transport) and
`736e78b`. The operator elected at this pass to **drive the live soaks** rather than record-and-stop, so this
section carries the automated re-confirmation, the **deploy preflight** the soaks must clear first, and the
**new blocker that removes story 06 from the soak chain**.

### Automated foundation — GREEN in m38's own scope, re-run fresh this pass

- **All 22 m38 fitness-function arch-tests green:** `node --test test/arch/*.test.mjs` → **219 ok / 0 fail**,
  isolated under `AOF_GLOBAL_HOME=$(mktemp -d)`. Includes the story-06 additions confirmed present on disk —
  `acd-terminal-stream-transport-wired`, `acd-fleet-terminal-frame-connection-identity`,
  `acd-fleet-terminal-mirror-read-only`. verifies → the fitness units named in each STORY.md.
- **Full integrating suite re-run this pass (the first full run since `2026-07-19`):** `node scripts/test.mjs`
  → **2896 ok / 16 not-ok, exit 1.** **Every m38 module is green** — measured directly over the run log:
  `session` 89/0, `presence` 50/0, `terminal` 82/0, `clone-credential` 32/0, `mesh-launcher` 14/0,
  `control-stream` 17/0, `worker-stream` 13/0, `mesh-worker` 2/0, `memory-syncback` 12/0 (**311 m38-module
  assertions ok, 0 not-ok**).
- **The 16 red are all OUTSIDE m38, attributed from their own failure text (not assumed):**
  - **10 · bundle/distribution family — count drift from work in flight, not a defect in either milestone.**
    `bundle/source-tree` fails `22 !== 21` ("21 commands (incl. the 4 insert-* placement twins)") and
    `bundle-asset-manifest-complete/00` fails `50 !== 42` — the bundle grew past both frozen counts as the
    **uncommitted milestone-41 `insert-*` work** (`src/work-bundle.mjs`, `src/adapters.mjs`,
    `src/runtime-config.mjs`, `src/work-bundle-synthesis.mjs`, `scripts/test.mjs` all modified in the tree) and
    `736e78b`'s `assimilate-code` command landed without the counts being regenerated.
    `agent-model-override` fails `'opus' !== 'sonnet'` — `736e78b` moved `aof-developer`'s shipped default to
    opus and its test still pins sonnet. The siblings (`bundle/descriptor`, `bundle/loader`,
    `work-init/runtime`, `arch/ADR-007`, `single-entry-two-mode/00`, `build-sea-recipe-guards/F14`) are the
    same family.
  - **5 · the recorded date-blind fixture TIME-BOMB, now firmly tripped.** All five `doctor/00`+`doctor/01`
    failures are an unexpected `stale-updated` finding. Confirmed at source:
    `test/doctor-coherence-completeness.test.mjs:51` hardcodes `updated: "2026-06-19"` and pins no `now`, so at
    `2026-07-23` the fixture is **34 days old** — past the 30-day stale window. STATE recorded this on
    `2026-07-19` (then exactly AT the boundary) and routed it to the stabilisation chore; it is now
    unconditionally red and will stay red until the fixture pins `now`.
  - **1 · the recorded `memory-integration` LLM-extraction flake** (`374 !== 381`), already routed.
  - **Method note (recorded so the number is read honestly):** a clean-`HEAD` git-worktree baseline was
    attempted to attribute the 16 and **discarded as invalid** — a fresh worktree carries no untracked build
    outputs (`ui/dist`, generated manifests), so it fails 147 tests for reasons unrelated to the diff. The
    attribution above rests on each failure's own assertion text instead.
- **`aof work validate 38` → PASS — 38 is well-formed** (folder↔frontmatter, closed tag vocabulary, depends
  graph), exit 0.

### F-38.06 remediation — CONFIRMED AT THE SOURCE this pass (not on the record note)

The `2026-07-19` record claimed the hybrid transport was wired by `aof:continue 38/06`. Read directly, both legs
exist in production code — the claim holds:
- **Worker → control (cross-machine, the FABRIC leg).** `sendTerminalFrame(sessionId, bytes)` is defined on the
  worker stream client ([worker-stream-client.mjs:421](../../../src/worker-stream-client.mjs#L421), exported at
  [:651](../../../src/worker-stream-client.mjs#L651)) and **wired at a real production call site** — the worker
  branch of the launcher passes
  `onOutputChunk: (chunk, sessionId) => client.sendTerminalFrame(sessionId, String(chunk))`
  ([mesh-launcher.mjs:856](../../../src/mesh-launcher.mjs#L856)). The control side branches the `terminal-frame`
  kind **before** `applyStreamFrame` ([control-stream-server.mjs:892](../../../src/control-stream-server.mjs#L892)).
- **Control → UI (loopback leg).** `relayMode` is imported and started for real
  ([mesh-launcher.mjs:748](../../../src/mesh-launcher.mjs#L748) — `options?.relayMode ?? relayMode`), and
  `aof mesh ui` passes the subscriber as a LITERAL production key
  ([cli.mjs:1149](../../../src/cli.mjs#L1149) — `startTerminalRelaySubscriber`). The `2026-07-19` condition
  ("the only `serveRelay`/`relayMode` reference in `mesh-launcher.mjs` is a comment") no longer holds.

F-38.06 is **CLOSED**. The transport is real.

### Findings — one NEW blocker

| id | observed (confirmed at source this pass) | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- | --- |
| **F-38.06c** | **The fleet terminal-VIEW has no browser surface — the mirror has no consumer, so story 06's soak cannot be run at all.** The READ-ONLY route is served (`GET /ws/terminal-view?nodeId=&sessionId=`, [mesh-ui-serve.mjs:360](../../../src/mesh-ui-serve.mjs#L360)) and the transport now feeds the mirror (F-38.06, closed above) — but `terminal-view` has **ZERO matches anywhere under [`ui/`](../../../ui/)**. The only terminal WebSocket consumer in the UI is [`TerminalDock.tsx:389`](../../../ui/src/board/TerminalDock.tsx#L389), which dials the board-side `/ws/terminal` (story 05's LOCAL interactive PTY) — a different route on a different surface. ⇒ task-03's two core scenarios are **structurally unrunnable**: "the output appears in the control-node fleet view's terminal panel" has no panel, and "a keystroke typed into the fleet-view terminal panel does not reach the worker" has nothing to type into. DESIGN §Surface 3 declared this on `2026-07-19` ("**NO browser surface was built this pass**") and it still holds at HEAD — `b123fd2` closed the TRANSPORT and left the CONSUMER unbuilt. **This is the milestone's own recurring class advanced one seam: F-38.05 was a consumer with no producer; F-38.06 was a producer on an unreachable transport; F-38.06c is a reachable producer with no consumer surface.** | correctness (inertness) | **BLOCKER (soak)** | build the fleet terminal-view component against DESIGN §Surface 3's V1–V9 binding checklist, THEN run the task-03 soak | `aof:continue 38/06` | **OPEN** |

### Deploy preflight for the live soaks — the mesh is NOT in a soakable state

The operator elected to run the soaks, so the live environment was checked first. It does **not** meet the
precondition, and soaking as-is would repeat soak-run-1's exact mistake (measuring the old build):

| node | role | last heartbeat | verdict |
| --- | --- | --- | --- |
| `umairs-msi` (this host) | control | `2026-07-22T09:21:29Z` | **`stale: true` — daemon down**; nothing listening on :4181–4183 |
| `umairs-mac-mini` | worker | `2026-07-23T13:44:39Z` (16s before the check) | alive, **but publishing a PRE-m38 build** |

- **The worker is on an old build — proven, not inferred.** Its live presence record is the FOUR-key
  `{nodeId, heartbeatAt, activeRuns, aofVersion}`, with **no `sessions` key**. The current code emits that key
  unconditionally — `assemblePresenceRecord` returns `sessions: sessions ?? []`
  ([mesh-presence.mjs:277](../../../src/mesh-presence.mjs#L277)) — so a record without it cannot have come from
  an m38 build. (The control node's own record, by contrast, carries `sessions: []`.) **Not a code defect — a
  deploy step**, recorded so any soak result is read against the right build.
- **Precondition for every soak below:** the current build installed on BOTH machines, both daemons up, and
  `aof mesh status --json` showing a `sessions` key on BOTH presence records.

### Soak lanes — what this pass could and could not close

`@manual`/`@uat` scenarios exist ONLY on the six soak tasks (every other `@manual` string in the milestone's
`.feature` files is prose inside a comment — checked this pass). None is agent-runnable without the operator's
hardware; story 06's is now unrunnable outright.

| story | soak owed | still blocked by |
| --- | --- | --- |
| **01** worker-repo-checkout | task 04 private-clone soak | 2nd machine on the current build + a real **private** repo + SECURITY R1/R2/R4 operator sign-off |
| **03** per-org-credential-scoping | task 03 two-org soak | **two** real per-org GitHub Apps (distinct keys + installations) |
| **04** ui-driven-assignment | task 04 real-UI soak (+ §Surface 2 A1–A11 design conformance) | live fleet UI + a live worker in the roster + a human at the browser |
| **06** worker-terminal-streaming | task 03 stream soak | **F-38.06c — no fleet terminal-view surface exists to soak** (`aof:continue 38/06` first) |
| **07** durable-worker-pushback | task 03 push soak | real branch + push + a `contents:write` App + operator T15 sign-off |
| **08** worker-verified-memory-syncback | task 02 end-to-end soak + `@uat` recall | dep 07; worker→control `git pull` + `memory ingest` + human recall sign-off |

Stories **02** and **05** are already accepted; their own deferred soaks (task 05 / task 04) also come due at the
milestone gate and are unchanged by this pass.

### Accept decision — Milestone 38 **NOT accepted; stays `in-progress`**

- **3 of 9 stories are done** (00, 02, 05); **6 remain `in-review`** (01, 03, 04, 06, 07, 08). A milestone accepts
  only when ALL its stories are.
- **F-38.06 is closed** — the terminal transport is genuinely wired, confirmed at source, and that is real
  forward progress since the last pass.
- **F-38.06c is open** — and it is a *build* blocker, not a verify one: story 06 cannot be soaked because the
  surface its user story promises ("watch a dispatched run progress in real time") was never built. Routed to
  `aof:continue 38/06`.
- **No story could close on the automated lanes alone.** The m38 scope is green (311/0 + 22/22 fitness) and
  `validate` is PASS — but this milestone has now demonstrated **seven** times (F1, F4, F6, F7, F8, F12, and the
  F-38.05/06/06c chain) that green is not evidence a feature works. The outsider proof for the remaining six is
  their live soak.
- **The live mesh is not yet in a soakable state** (control daemon down; worker on a pre-m38 build) — the
  operator is bringing it up. The five runnable soaks chain as **04 → 01 → 05 → 07 → 08**, with **03** separate
  (needs a second org's App) and **06** withdrawn from the chain pending F-38.06c. Next steps are the operator's: close F-38.06 via `aof:continue 38/06`, then
drive the real-infrastructure soaks with a human observer.

---

## Verify pass `2026-07-23` (re-invocation) — F-38.06c CLOSED; all six remaining stories now soak-ready; **NOT accepted**

`aof:verify 38` re-invoked after `aof:continue 38/06` remediated the F-38.06c blocker raised at the pass above.
Only the lanes runnable without a human / real infrastructure were exercised; the verdict is unchanged (milestone
stays `in-progress`), but the last **build** blocker in the milestone is now gone — the six remaining stories are
blocked only by their live soaks, not by any inert seam.

### F-38.06c — CONFIRMED CLOSED at the source (not on the record note)

The prior section raised F-38.06c: the terminal transport reached the fleet mirror, but `grep terminal-view ui/`
returned **zero** matches — a reachable producer with **no browser consumer**, so story 06's task-03 soak was
structurally unrunnable. Read directly at HEAD + working tree, the consumer surface now exists and is mounted:
- **The component exists** — [`ui/src/fleet/terminal-view/`](../../../ui/src/fleet/terminal-view/):
  `FleetTerminalView.tsx` (thin consumer) over framework-free `stream.mjs` + `view-state.mjs` helpers (each with a
  `.d.mts` companion, the house pattern that F2 was raised for).
- **It is mounted on the work-item card** — [`Fleet.tsx:6`](../../../ui/src/fleet/Fleet.tsx#L6) imports
  `FleetTerminalView`; [`Fleet.tsx:530`](../../../ui/src/fleet/Fleet.tsx#L530) renders it under
  `{assignment ? <FleetTerminalView … /> : null}`. The `2026-07-23` DESIGN §Surface 3 "NO browser surface was
  built this pass" condition no longer holds.
- **The armed fitness now goes GREEN at the source** — the new
  [`acd-terminal-view-live-observable`](../../../test/arch/acd-terminal-view-live-observable.test.mjs) (F17-shaped,
  RED-until-fixed) pins ADR-013 inv.7 (the `(nodeId, sessionId)` join key reaches control **mid-run**, not only at
  end — closing the deeper **F-38.06d**) and ADR-014 inv.8 (the stream END is producer-emitted, not inferred —
  closing **F-38.06e**). It is **green** on today's tree with both self-checks landing, alongside the two new
  behavioural surface tests (`test/fleet-terminal-view-surface.test.mjs`,
  `test/fleet-terminal-view-producer-fed.test.mjs`): **3/3 ok** isolated.

F-38.06c (and the F-38.06d/F-38.06e defects the fix's review surfaced beneath it) is **CLOSED**. Story 06 now has
a real, producer-fed browser surface — its task-03 two-machine stream soak is finally runnable once the hardware
is up. **The milestone carries no open build/inertness blocker.** *(The fix is in the working tree, uncommitted —
`ui/src/fleet/terminal-view/` + the three new tests + the `06/tasks/04_bug-fleet-terminal-view-surface.feature`
`@bug @finding-F-38.06c` task are untracked; committing is the downstream `aof:code-review` step, not a verify
concern. Recorded so the accept is read against the right build state.)*

### Automated foundation — GREEN, re-run fresh this pass (isolated)

- **All m38 fitness-function arch-tests green:** `node --test test/arch/*.test.mjs` (under
  `AOF_GLOBAL_HOME=$(mktemp -d)`) → **220 ok / 0 fail**, up from 219 last pass by exactly the new
  `acd-terminal-view-live-observable`. The story-06 set on disk —
  `acd-terminal-stream-transport-wired`, `acd-fleet-terminal-frame-connection-identity`,
  `acd-fleet-terminal-mirror-read-only`, `acd-terminal-view-live-observable` — all pass. verifies → the fitness
  units named in each STORY.md.
- `aof work validate 38` → **PASS — well-formed** (folder↔frontmatter, closed tag vocabulary, depends graph).
- The full integrating `scripts/test.mjs` was **not re-run this pass** — its result is unchanged from the pass
  above (2896 ok / 16 not-ok, every red **outside** m38: the m41-in-flight bundle-count drift, the
  `agent-model-override` opus/sonnet pin, the date-blind `doctor` fixture time-bomb, the `memory-integration`
  flake — all routed to the stabilisation chore). No m38 module changed since; the m38 scope stood 311/0.

### Deploy preflight — the live mesh is STILL not soakable (unchanged, re-checked read-only this pass)

| node | role | last heartbeat | presence keys | verdict |
| --- | --- | --- | --- | --- |
| `umairs-mac-mini` (worker) | worker | `2026-07-23T17:48:07Z` (alive) | `nodeId, heartbeatAt, activeRuns, aofVersion` (**4 — no `sessions`**) | **on a PRE-m38 build** |
| `umairs-msi` (control) | control | `2026-07-22T09:21:29Z` | (5-key) | **`stale: true` — daemon down** |

The current (uncommitted) build is not deployed on either machine: the worker publishes the 4-key record the
current `assemblePresenceRecord` cannot emit (it returns `sessions: sessions ?? []` unconditionally), and the
control daemon is down. **Precondition for every soak: the current build installed on BOTH machines, both daemons
up, `aof mesh status --json` showing a `sessions` key on BOTH.** Not a code defect — a deploy step (the operator's
flow); recorded so any soak result is read against the right build.

### Soak lanes — none closeable this pass (unchanged), but story 06 is no longer withdrawn

`@manual`/`@uat` scenarios exist only on the six soak tasks; none is agent-runnable without the operator's
hardware + a human observer. The one change from the prior pass: **06 is back in the chain** (F-38.06c closed).

| story | soak owed | still blocked by |
| --- | --- | --- |
| **01** worker-repo-checkout | task 04 private-clone soak | 2nd machine on current build + real **private** repo + SECURITY R1/R2/R4 sign-off |
| **03** per-org-credential-scoping | task 03 two-org soak | **two** real per-org GitHub Apps (distinct keys + installations) |
| **04** ui-driven-assignment | task 04 real-UI soak (+ §Surface 2 A1–A11 design conformance) | live fleet UI + a live worker + a human at the browser |
| **06** worker-terminal-streaming | task 03 stream soak | live 2-machine PTY relay + a human (F-38.06c **now closed** — surface exists) |
| **07** durable-worker-pushback | task 03 push soak | real branch + push + a `contents:write` App + operator T15 sign-off |
| **08** worker-verified-memory-syncback | task 02 end-to-end soak + `@uat` recall | dep 07; worker→control `git pull` + `memory ingest` + human recall sign-off |

Stories **02** and **05** are accepted; their own deferred soaks (task 05 / task 04) also come due at the
milestone gate and are unchanged.

### Accept decision — Milestone 38 **NOT accepted; stays `in-progress`**

- **3 of 9 stories done** (00, 02, 05); **6 remain `in-review`** (01, 03, 04, 06, 07, 08). A milestone accepts only
  when ALL its stories are.
- **F-38.06c is closed** — the fleet terminal-view surface is built, mounted, and producer-fed; its armed fitness
  is green at source. Story 06 is soak-ready, and **no open build/inertness blocker remains anywhere in the
  milestone** — real forward progress since the last pass.
- **No story could close on the automated lanes alone.** The m38 scope is green (220/220 fitness; validate PASS) —
  but this milestone has demonstrated **seven** times that green is not evidence a feature works. The outsider
  proof for the remaining six is their live soak, and **none is agent-runnable in this non-interactive session.**
- **The live mesh is not in a soakable state** (control daemon down; worker on a pre-m38 build) — the current
  build must be deployed to both machines first. Next steps are the operator's: deploy the current build to both
  nodes, bring both daemons up, then drive the runnable soaks (chain **04 → 01 → 05 → 07 → 08**; **03** separate on
  a second org's App; **06** now joins once the relay is live) with a human observer.

---

## Verify pass `2026-07-24` — live two-machine mesh STOOD UP; a new blocker found **and fixed**; the recorded automated evidence **corrected**

The preflight was finally cleared: the current build is installed on BOTH machines, both daemons are up, and the
fabric is genuinely connected (control `:4182` LISTENING with multiple ESTABLISHED connections from the worker over
Tailscale). Standing it up immediately exposed a blocker that every prior pass had missed — and, separately, that
the automated evidence recorded by those passes was **vacuous**.

### F18 (NEW, **BLOCKER** — FIXED this pass) — cross-node presence DROPS the `sessions` key

**Observed live, at source.** With both nodes on the current build and the fabric connected, the control node held a
**fresh but FOUR-key** presence record for the worker (`~/.aof/mesh/presence/umairs-mac-mini.json` — mtime seconds
old, `{nodeId, heartbeatAt, activeRuns, aofVersion}`), while the worker's OWN self-view was the correct five-key
record. The `sessions` key was being destroyed in transit.

**Root cause, confirmed at source.** [`applyPresenceFrame`](../../../src/control-stream-server.mjs#L187) — the
control's fabric-ingestion of a *peer's* presence — rebuilt the record from only the original m23 four keys:
```js
const record = { nodeId, heartbeatAt, activeRuns: …, aofVersion: … };   // no `sessions`
```
The worker SENDS its full five-key record (`{ ...presence }`,
[worker-stream-client.mjs:60](../../../src/worker-stream-client.mjs#L60)); the control cherry-picked the old four and
never carried ADR-001's additive fifth key, then persisted that four-key result.

**Consequence — SPEC objective (a) failed for every node that is not the control itself.** A remote worker could
only ever read `idle` on the fleet, however actively it was being worked on: the milestone's headline bug, still
live across the exact boundary the milestone is *named for*.

**Why seven prior passes missed it.** The control's OWN presence is written by `assemblePresenceRecord` (five-key) —
the only path a single-machine soak ever exercises. Only a REMOTE node's presence flows through
`applyPresenceFrame`, and presence had never been soaked two-machine. Worse, the existing test
(`control-stream-server/02`) fed a **four-key fixture** and asserted a round-trip — it had no `sessions` key to
lose. That is the same fixture-fed pattern as F1/F4/F6–F9, at an eighth address.

**Fix (committed `d7fa8d5`).** `applyPresenceFrame` now carries `sessions` through **verbatim** (the worker is the
single TTL-filtering authority — it holds the session records; a dead worker's whole record is gated stale anyway),
in ADR-001 key order. The fixture-fed test was made producer-shaped (a real five-key record with a live session), and
a dedicated cross-node regression now pins both the surviving `sessions` and the full five-key shape.
**Proven non-vacuous:** all three presence cases go RED without the fix (the new one with `+ undefined` for the
dropped key) and GREEN with it.

**Live end-to-end proof — the first cross-machine demonstration of SPEC objective (a) in this milestone.** A real
session started on the **Mac worker** (`aof session start --workspace f693d197edbbb992 --repo aof --assistant
claude-code`) crossed the fabric and landed on the **control**:
```
sessions: [{ workspaceId: "f693d197edbbb992", repo: "aof", assistant: "claude-code", lastPingAt: … }]
fleetCurrentWorkLines(presence) → { lines: ["working · aof (session)"], token: "primary", state: "working" }
```
Before the fix that array did not exist at all. **Status: FIXED, verified at source, in test, and live.**

### F19 (NEW, process) — the automated evidence recorded by prior passes is **VACUOUS**

Every pass above records the automated foundation as e.g. *"`node --test test/arch/*.test.mjs` → 219 ok / 0 fail"*.
**That command runs nothing.** These test files export **case arrays** (`export const archTests = [...]`) and register
**zero** `node:test` tests, so `node --test` reports one trivially-passing test **per FILE** with 0 subtests.
`ls test/arch/*.test.mjs | wc -l` = **220** — precisely the "220 tests" figure. The `2026-07-19` (217), `2026-07-23`
(219) and the earlier `2026-07-24` (220) numbers are **file counts, not test results**, and they masked **9 genuinely
red arch cases**. Cases only execute via `scripts/test.mjs`'s own runner
([scripts/test.mjs:2024](../../../scripts/test.mjs#L2024)) or an equivalent case-array runner.

**The milestone's own thesis, turned on its verification:** the evidence proving "green" was itself a green that
proved nothing.

### Automated foundation — RE-ESTABLISHED honestly (real case-array runner, per-case isolated `AOF_GLOBAL_HOME`)

- **Full arch/fitness sweep: 220 files → 694 REAL cases → 685 ok / 9 not ok.** **No m38 fitness function is red.**
  The 9 reds are all pre-existing and already routed to the stabilisation chore (STATE `2026-07-23`): `acd-sync-root-set`
  (4), `acd-claim-relay-independent` (3) and `acd-fleet-reclaim-guarded` (1) all read `src/mesh-sync.mjs`, **deleted at
  m33**; `acd-command-namespace` (1) is the m41 `insert-*` command-count drift. They were invisible precisely because
  the vacuous command never ran them.
- **Focused presence + terminal-view suite: 64 ok / 0 not ok** — `control-stream-server`, the presence suites,
  `worker-stream-client`, both `fleet-terminal-view-*` surfaces and `acd-terminal-view-live-observable`. This is also the
  first REAL execution of the story-06 terminal-view cases: **they genuinely pass** (the F-38.06c fix is sound — only the
  earlier *verification method* was worthless).
- The full integrating `scripts/test.mjs` remains un-runnable here: the live mesh daemon holds `:4182` (finding **F13**).

### Deploy state at this pass

Both machines now run the current build. The control node's SEA was rebuilt and installed via a new
`scripts/install-local.mjs` (the local-build twin of `install.ps1`, which only ever fetched a signed *release*);
the prior binary was preserved as `aof.exe.bak.<timestamp>`. The Rust desktop app was rebuilt and confirmed
**already current** — cargo `Finished` with no recompile and no `.rs` newer than the binary, so its Jul-13 date
reflects an unchanged Rust source (all later m38 work was JS/TS), NOT a stale build. An earlier note in this
document calling it stale was wrong.

### Accept decision — Milestone 38 **NOT accepted; stays `in-progress`**

- **3 of 9 stories done** (00, 02, 05); 6 remain `in-review` (01, 03, 04, 06, 07, 08), each gated on its live soak.
- **F18 is fixed** and, for the first time, SPEC objective (a) is demonstrated **across machines** — real forward
  progress, and the strongest evidence yet that the remaining soaks must actually be run rather than inferred.
- **F19 means no prior pass's "automated foundation GREEN" claim can be relied on as written.** The foundation is
  green *when measured properly* (685/694, 9 known pre-existing reds), but every accept decision that leaned on the
  vacuous figure should be read with that correction.

### Soak 04 (story 04 · task 04, `@manual`) — **RUN `2026-07-24`, and it FAILED.** Two new findings

The first soak of this milestone to actually run on a live two-machine mesh. Every precondition was met, which is
what makes the result meaningful rather than environmental:

- Control + worker both on the current build; fabric LISTENING on `:4182` with ESTABLISHED connections from the worker.
- Serve-face `:4181` bound to **`127.0.0.1` only** — the **R5 loopback bind attestation, measured** (`:4182` is on the
  Tailscale address by necessity — that is the fabric, not the serve face).
- A real target milestone (`18 · Homedata Live Property Data`) created in `let-shield-portal`, committed and pushed
  (`origin/main e542436`), and published into the projection (`lastPublishedAt 2026-07-24T12:40:55Z`, 61 items).
- The worker's stale checkout renamed aside so clone-on-miss would fire, and its workspace deliberately unregistered.
- The **assign affordance rendered** — every milestone card carried a live node picker + `Assign →`. §Surface 2's
  affordance exists on screen (the one thing this pass can positively report for story 04).

**What happened.** The operator clicked `Assign →` on let-shield's milestone 18, targeting `umairs-mac-mini`, with **no
CLI touched**. The route returned `200 ok` — and minted this:
```
assignmentId: da6d78ff-…   itemRef: "18"   targetNodeId: "umairs-mac-mini"
workspaceId:  9db1fd84f5895e38        ← the CONTROL's OWN (aof) workspace, NOT let-shield-portal (1f164bd03ea535da)
state: assigned → failed (1.5s later)
```
`ref 18` in the control's own workspace is a **completely different milestone** — *"Per-folder integration descriptor —
a co-located `.integrations.json` routes each work item to its external tool(s)"*. The operator clicked *"Homedata Live
Property Data"* and the mesh dispatched something else entirely.

| id | observed (confirmed at source) | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- | --- |
| **F21** | **The fleet assign route ignores the item's workspace and always resolves the ref against the CONTROL's own.** [`mesh-ui-serve.mjs:242`](../../../src/mesh-ui-serve.mjs#L242) does `loadWorkspace(resolvedProjectDir, …)` — the **daemon's own project dir** — then `assignWork(assignWorkspace, ref, nodeId, …)`. The POST body carries only `{ ref, nodeId }` (the code says so verbatim: *"ONLY { ref, nodeId } is lifted off the body"*), so **there is no `workspaceId` on the wire** and the route structurally CANNOT target another workspace. But the fleet face is **global** — it lists items from every workspace (102 milestones across 5 here). So a card from any non-control workspace is mis-assigned: where the ref COLLIDES it **silently dispatches different work** (measured live above); where it does not, it fails. The danger is not the failure — it is the silent wrong-work dispatch: on a worker holding the control's repo this would have executed **real, unintended work** off a correct-looking `200 ok`. This is the **ADR-010 "Gap A" class** (resolve per-assigned-workspace, never globally from the control's own config) that story 03 fixed for the App identity — repeated at the assign seam, unnoticed. | correctness (wrong-target dispatch) | **BLOCKER** | put `workspaceId` on the wire and resolve the item's OWN workspace (mirroring ADR-010 Gap A); a producer-fed test must assign an item belonging to a **non-control** workspace — the shape no existing test covers | `aof:continue 38/04` | **OPEN** |
| **F22** | **The assign affordance reports nothing on success.** A `200 ok` produced no transition, no pending/loading indicator and no `assigned` chip on the card; the operator only knew the call had succeeded by reading the raw API response. §Surface 2's A1–A11 binding checklist is the baseline for exactly this and was recorded INCONCLUSIVE at the build review pending this render. | design-gap / feedback | non-blocker | designer sets the A1–A11 states (pending → assigned → failed), then build | `aof:continue 38/04` (+ `aof-designer`) | **OPEN** |

**Why the `@executable` lanes never caught F21.** Story 04's tasks 00–03 drive the route against the server's *own*
workspace — the only workspace a single-workspace fixture has. The mis-targeting is invisible unless the test asserts an
item belonging to a **different** workspace than the server's, which nothing does. Same defect class as F1/F4/F6–F9/F18:
a seam exercised only in the configuration where it cannot fail.

**Soak-chain consequence.** The chain died at its first link. The worker never cloned (no new checkout, no logs on the
Mac) — it failed in ~1.5s because the mis-targeted workspace has no resolvable `cloneUrl` on the worker. So **01
(clone-on-miss), 02 (real App mint) and 05 (terminal execution) were NOT exercised** by this run; they remain unrun.

**Incidental observation (recorded, not a finding):** workspace ids are **path-derived**, so the same repo carries a
DIFFERENT id per machine (control's aof `9db1fd84f5895e38` vs the worker's `f693d197edbbb992`). Any fix that puts a
workspaceId on the wire has to reckon with the fact that a worker cannot resolve a control-authored workspace id to its
own checkout by identity alone.

**Story 04 — NOT ACCEPTED.** Its affordance renders, but the one outsider check it exists for dispatched the wrong work.

---

## Story-04 · ui-driven-assignment — verify & **DECLINE** (`aof:verify 38/04`, 2026-07-24, after the F21/F22 fix)

Story-level verify of `38/04` (status `in-review`), run on the **post-fix working tree** — the `aof:continue 38/04`
build that closed **F21** (wrong-workspace dispatch), **F22** (no acknowledgment), **F-38.04a/GAP-S2-3** (the stale
selection), **F-B** (the issuer), and the two designer rules **DG-13** (binding geometry) / **DG-14** (the timed-out
row). **Not accepted.** The automated lanes are green and the two blocker findings that re-opened this story are
closed at source and in pixels — but the story's own design surface came back **GAPS** with two BUILD defects, and
**the `@manual` soak the story was re-opened by has not been re-run**. `STORY.md` `status` stays `in-review`.

### Verification evidence — `@executable` lanes + fitness (GREEN, fresh this session, producer-fed)

- **Story-04 focused surface: 68 cases → 68 ok / 0 not ok**, run through a **real case-array runner** with a
  per-case isolated `AOF_GLOBAL_HOME` (the **F19** discipline — `node --test` on these modules executes ZERO cases).
  Covers task 00 (4) · 01 (3) · 02 (4) · 03 (6) · 05 (9) · 06 (19) · 07 (9), plus both fitness functions
  `acd-fleet-face-single-mutation-route` (5) and `acd-fleet-assign-targets-item-workspace` (9).
  verifies → `tasks/00_*`–`tasks/03_*`, `tasks/05_*`–`tasks/07_*` and the story's `## Fitness units`.
- **Full arch/fitness sweep, honest measurement: 221 files → 703 REAL cases → 694 ok / 9 not ok.** **No m38 fitness
  function is red, and no story-04 lane regressed.** The 9 reds are the *same* pre-existing set recorded at the
  earlier `2026-07-24` pass and already routed to the stabilisation chore: `acd-sync-root-set` (4) /
  `acd-claim-relay-independent` (3) / `acd-fleet-reclaim-guarded` (1) — all three read `src/mesh-sync.mjs`, **deleted
  at m33** — plus `acd-command-namespace` (1), the concurrent m41 `insert-*` command-count drift. No new red.
- **Blast radius: 34 mesh-ui / fleet / assignment suites in one process → 225 ok / 0 not ok.** The neighbouring
  read-only fleet contracts (`acd-mesh-ui-read-only`, `acd-mesh-ui-write-isolation`, `acd-mesh-ui-single-server`,
  `acd-fleet-terminal-mirror-read-only`, the m35 chip + assignment-shape suites, both story-06 terminal-view
  surfaces) are unaffected by the mutation carve-out's amendment.
- **`npm run ui:build` (`tsc -b && vite build`) green** — the **F2** discipline holds: `assign-affordance.mjs` ships
  with its `.d.mts` companion, so the `.tsx` consumer type-checks.
- **The full integrating `scripts/test.mjs` was NOT run, deliberately and for the same reason as prior passes:** a
  **live two-machine mesh** holds `:4182` (control fabric LISTENING on the Tailscale address with ESTABLISHED worker
  connections) and finding **F13** turns that collision into a process **crash**, not a test failure. Disrupting the
  live daemon would also destroy the very environment the owed soak needs.

### Design conformance — §Surface 2 re-render → **GAPS at 1280** (the story's own surface)

The re-render **DG-13/DG-14 owed** was produced this pass and judged by `aof-designer` (ADR-001 hand-off — the
orchestration rendered and handed the frames; the designer judged them and never ran the browser).

- **Provenance.** **13 frames at 1280 only** (390/768 are effectively unrenderable for this page — §Surface 2's own
  recorded reason), from the **real built `ui/dist`** rebuilt this session (post-DG-12, so the pixels are not void),
  served by the **real `serveMeshUi`** over an **isolated** global store carrying **two published workspaces**, driven
  by **real synthetic clicks** producing **real `POST /api/mesh/assign` calls** that minted **real
  `global_assignments` rows read back from the real store**. **Nothing hand-seeded.**
- **Two of the three prior gaps CLOSED outright.** **GAP-S2-2/DG-14 — CLOSED:** a hung POST times out at a measured
  **10057 ms** (= 2 × `POLL_MS`) into the existing `refused` presentation verbatim, reading `no answer — timed out`,
  re-click permitted. **GAP-S2-3 — CLOSED:** the frozen picker, region 5's chip and the **real store row** all read
  `umairs-msi` — three independent readings, one node, on a node that is *not* the alphabetical default. The target
  is derived, not remembered.
- **GAP-S2-1/DG-13 — CLOSED as filed** (action **83.06px in all eight** states; row **360.66 × 38px** in all eight; the
  picker never a bare chevron, **124.66px** at its narrowest; the message is the element that yields, full sentence in
  its native `title`) — **but three narrower successors opened at its edges** (below).
- **F21 re-witnessed in pixels:** two cards carry the identical `ref 18`; the mint landed in the **clicked** workspace
  (`b49723d46648025a`) and the daemon's own card (`e0a472b259be2a7f`) stayed untouched. **A8 measured:** exactly **ONE**
  extra `/api/mesh/status` GET on the 2xx (0 → 1), decay **5017 ms** ≈ one `POLL_MS`.
- **Region 6 — the affordance's own state axis — CONFORMS end to end. Region 5 — GAPS.** Full region / rule /
  States-table ledgers, the provenance, and the NOT-ASSESSED list are recorded in **DESIGN.md §Surface 2 → Review
  status** (second real verdict, 2026-07-24).

### Findings

| id | observed | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- | --- |
| **DG-15** | **A long target OVERPRINTS `Open board →`.** With target `umairs-mac-mini-build-agent-02` the chip's `→ <target>` renders in FULL (DG-13 c5's headline demand, met) but runs straight into `Open board →` with no gap or separator — the target's trailing `2` and the `O` of `Open` occupy the **same pixels**, and the chip's `· just now` tail is destroyed. A priority list was built as a **paint** order instead of a **yield** order, so it destroys **both** parties: the target id DG-13 c5 exists to protect, *and* the card's navigation affordance — at exactly the moment the operator needs to read the target. Confirmed at source by the orchestration on frame `08-long-target-chip-card.png`. | design-gap (**BUILD defect**) | **blocker (story accept)** | designer set the rule FIRST (done — DG-13 gains a sixth clause: *no two elements in region 5 may occupy the same pixels; the priority list is a YIELD order, never a paint order*), then build | `aof:continue 38/04` | **OPEN** |
| **DG-16** | **The workspace name yields to a ONE-CHARACTER STUB instead of being dropped** — `l…` / `le…` / `let…` for `let-shield-portal` in every chip-bearing frame, while frame 08 **drops it entirely** under heavier pressure. Two behaviours, and the build reaches for the worse one first. **This falsifies DG-11's `2026-07-24` "does not reproduce — a fixture artifact" note**: it reproduces in a producer-fed, post-DG-12, real-assign render, at the workspace-name element rather than the chip. DG-11's rule (*a legible minimum, or drop entirely; never a one-character stub*) was right all along and is still unbuilt. | design-gap (**BUILD defect**) | **blocker (story accept)** | designer rule recorded (*in region 5 the workspace name is the one element NEVER truncated — full or dropped, with its `·`*), then build | `aof:continue 38/04` | **OPEN** |
| **DG-17** | **The refusal message still truncates before naming the holder** — `already assigned → uma…`. The copy is exactly DG-13 c4's form and the full sentence is in the `title`, but the slot is 136.94px and the string needs ~173px (**c4's own exemplar needs ~197px**). **The arithmetic proves the rule cannot be satisfied:** picker floor 124.66 (c2) + fixed action 83.06 (c1) + gaps = 223.72 of a 360.66px row. **The developer implemented c4 exactly as written — this is the designer's error, not the build's.** | design-gap (**RULE wrong**) | **blocker (story accept)** | **rule changed first** (DG-13 c4 superseded by a graduated copy LADDER — the holder is an atomic, protected substring: `already assigned → <holder>` → `held by <holder>` → `→ <holder>` → outcome alone; never CSS-truncated); **do NOT fix by shrinking the picker floor** | `aof:continue 38/04` | **OPEN** |
| **DG-18** | **A successful assign grows the card 6px (251.5 → 257.5px) and reflows its grid row** — A10 binds the affordance ROW (38px, conforming); nothing binds region 5's height. Story 04 did not create the growth (it is the m35 chip pill's own geometry) but **A8's one silent re-load moved the reflow to the moment of the click**, making it deterministic and visible. | design-gap | non-blocker | **defer** — region 5 reserves the chip's line height whether or not a chip is present; as much m35 as story-04 | backlog / next `aof:refine` | **open (deferred)** |

_(No new correctness, security or robustness finding was raised this pass. F21, F22, F-38.04a/GAP-S2-3 and F-B are
closed — verified at source, in the 68-case lane, and in the re-render's pixels.)_

### The `@manual` gate — task 04's soak is **OWED AGAIN and was NOT run**

`tasks/04_ui-assign-soak.feature` (`@manual`) is the story's outsider proof and the reason it was re-opened: the
`2026-07-24` live run FAILED, raising F21 + F22. **It has not been re-run on the fixed build, and it is not
agent-runnable** — it needs a real browser, a real enrolled worker holding the published repo, the operator's **R5
loopback-bind attestation**, and an outsider's observation that **no CLI was touched**.

**It is also not currently runnable at all, and this is a deploy fact, not a code defect.** The live mesh is up
(control fabric `:4182` LISTENING with ESTABLISHED worker connections; serve face `:4181` bound to **127.0.0.1 only**
— the R5 attestation still measurable), **but the running control node is the SEA installed at `12:14` today, which
predates this fix.** The F21/F22/DG-13/DG-14 build is in the **working tree, uncommitted**. A soak run right now
would re-soak the *broken* build. **Re-running it requires the SEA rebuilt + reinstalled on the control node**
(`scripts/install-local.mjs`, the local-build twin of `install.ps1`) and the daemon restarted first.

**No `@uat` scenario exists in this story** (its tags are `@manual @ui @work @distribution`), so no human sign-off
lane applies at the story level — the soak is the milestone's deferred human gate, closed at `aof:verify 38`.

### Gate

- `aof work validate 38/04` → **PASS — 38/04 is well-formed** (folder↔frontmatter, closed tag vocabulary, depends
  graph), exit 0. Agent-layer checks hold: `@executable` test-traceability is satisfied by the wired, green task
  modules for 00–03 and 05–07 (68 cases, each traceable to its task); litmus clean — task 04's `@manual` tag is
  honest (a real two-machine mesh + a human at the browser is not `@executable`-coverable).

### The design gaps were BUILT in this same pass — four judgement rounds, then ACCEPT

The decline below was written after the FIRST design verdict of this pass and is **superseded**. The operator
directed that the gaps be fixed rather than routed to another `aof:continue` cycle. They were — and the surface
was re-judged after each build, three more times, until it converged.

| round | verdict | findings raised | outcome |
| --- | --- | --- | --- |
| 1 | GAPS at 1280 | **DG-15** (overprint), **DG-16** (`l…` stub), **DG-17** (holder truncated) | all three built |
| 2 | GAPS at 1280 | **DG-19** (squeeze where a drop is needed + the row leaving the card's box), **DG-20** (gate on chip, not fit), **DG-21** (a rung with no outcome word) | all three built |
| 3 | **GAPS — explicitly NON-BLOCKING**; *"Region 6 — the region story 04 actually builds — CONFORMS end to end for the first time: state axis, geometry and copy"* | **DG-22** (cluster drift), **DG-23** (pre-existing lone `·`) | DG-22 built; DG-23 deferred (predates story 04) |
| 4 | residues closed and re-rendered | — | DG-19/20/21/22 witnessed closed |

**What is now true in real pixels** (13 frames + the discriminating DG-20 frame, all producer-fed — real built
`ui/dist`, real `serveMeshUi`, real clicks → real `POST /api/mesh/assign` → real `global_assignments` rows read
back, nothing hand-seeded):
- A 30-character target renders **in full** (`→ umairs-mac-mini-build-agent-02`) with **nothing overprinted**, the
  tail dropped whole rather than stubbed, and the drill-in degraded to its pinned `→` with the label in `title`.
- The refusal reads **`refused · umairs-msi`** — the holder whole, and an outcome word in **every** rung, so the
  `destructive` tint is never the only thing distinguishing a refusal from region 5's `assigned → <same node>`.
- The workspace name is **full or dropped**, decided by fit: the `aof` card keeps its name beside a chip;
  `let-shield-portal` is dropped whole with its separator.
- Geometry holds: action **83.06px** and row **360.66 × 38px** in every state; decay ≈ one `POLL_MS`; timeout
  ≈ 2 × `POLL_MS`; exactly ONE extra status GET on success; the mint lands in the **clicked** workspace only.

**The lesson this pass earned, and it is a build lesson, not a design one.** The yield order was first built out
of flex `shrink` factors (1000000 : 1000 : 1 — a ratio that on paper sends ~99.6% of any squeeze to the
lowest-priority element). **Measured, it did nothing of the kind:** the drill-in yielded 13.1px while the chip,
weighted 1, yielded 17.5px, so the protected target truncated anyway. **Flexbox distributes a squeeze; it cannot
express "this element goes away so that one can be whole."** Every clause is now a **discrete budgeted drop** —
the same instrument as the copy ladder — with the shrink factors left only as a backstop. Two more defects fell
out the same way: `min-w-0` on the drill-in let its pinned arrow escape the card's content box, while NO
min-width made `min-width:auto` resolve to its full content width so it never yielded at all; and `flex-1` on a
KEPT workspace name made it GROW into the free space and squeeze the target — c5 exactly backwards. **None of
the three was visible in the markup. All three came off a `getBoundingClientRect` ledger.** Reasoning about this
row's layout was wrong every time it was tried; measuring it was right every time.

**Two NOT-ASSESSED items that had been owed for three and four passes were also closed by measurement:** the
**DG-20 discriminating frame** (produced), and the **abbreviated arrow's tint** — `getComputedStyle` reads
`rgb(19, 118, 109)` at BOTH its 78.7px and 14px widths, so the designer's suspicion that it "reads greyer" was a
downscaled-crop artifact, not a c5.4 violation.

### Final gate (re-run after every build in this pass)

- **Story-04 focused surface: 70 cases → 70 ok / 0 not ok** (a lane was ADDED pinning DG-19's tail-drop).
- **Blast radius: 227 ok / 0 not ok** over 34 mesh-ui / fleet / assignment suites.
- **Full arch/fitness sweep: 703 real cases → 694 ok / 9 not ok** — the same nine pre-existing reds
  (`mesh-sync.mjs` deleted at m33, plus the m41 command-count drift). **No m38 fitness function is red; nothing
  regressed.**
- **`npm run ui:build` green**; both new constants carry their `.d.mts` declarations (the F2 discipline).
- **`aof work validate 38/04` → PASS**; whole stream → **PASS**.

### Findings — final state

| id | type | severity | status |
| --- | --- | --- | --- |
| **DG-15** overprint | design-gap (build defect) | blocker | **CLOSED** — witnessed |
| **DG-16** `l…` stub | design-gap (build defect) | blocker | **CLOSED** — witnessed |
| **DG-17** truncated holder | design-gap (rule wrong) | blocker | **CLOSED** — rule replaced by the ladder |
| **DG-19** squeeze-not-drop + row left the card's box | design-gap (build defect) | blocker | **CLOSED** — discrete budgets + an arrow-sized floor |
| **DG-20** gate on chip, not fit | design-gap (build defect) | blocker | **CLOSED** — fit budget, discriminating frame produced |
| **DG-21** a rung with no outcome word | design-gap (rule wrong) | blocker | **CLOSED** — every rung names the outcome |
| **DG-22** cluster drift in the vacated space | design-gap (build defect) | non-blocker | **CLOSED** |
| **DG-18** the chip's 6px card growth | design-gap | non-blocker | **open (deferred)** — as much m35 as story-04 |
| **DG-23** lone `·` on chip-less cards | design-gap | non-blocker | **open (deferred)** — predates story 04 |

_(No correctness, security or robustness finding was raised at any round of this pass. F21, F22, F-38.04a/GAP-S2-3
and F-B remain closed — at source, in the 70-case lane, and in the pixels.)_

### Accept decision — story-04 **ACCEPTED**

`STORY.md` → `status: done`; its box ticked in `SPEC.md` `## Stories`.

- **Its `@executable` contract is green and producer-fed** — 70/70 across tasks 00–03 and 05–07 plus both fitness
  functions, with no regression anywhere in its blast radius or the milestone's fitness set.
- **The two blockers that re-opened this story are closed three ways** — at source, in test, and in the pixels of a
  producer-fed render: **F21**'s wrong-target dispatch (the mint lands in the *clicked* workspace; the daemon's
  identically-refed card stays untouched) and **F22**'s silent success (`Sent`, held one poll interval, plus the
  one silent re-load that lands the chip).
- **Its design surface was judged four times and every blocking gap is closed.** The designer's own third-round
  ruling is the operative one: *"Nothing open blocks story 04's acceptance. Region 6 — the region story 04
  actually builds — CONFORMS end to end."* The two residues (DG-18, DG-23) are deferrable refinements to a footer
  carried forward from m35, one of which predates this story entirely.
- **No blocker finding is open against it.**

**What this accept does NOT claim, stated plainly.** Task 04's `@manual` soak — a person assigning a REAL item to
a REAL node in the REAL UI on a two-machine mesh — **has not been re-run on the fixed build, and this story is not
accepted on the strength of having run it.** It cannot be run from here: it needs a human at the browser, and the
live control node is still the SEA installed at `12:14` today, which predates this fix. That soak is, by this
story's own contract and by the story-02 precedent, the **milestone's** deferred human gate, closed at
`aof:verify 38` — not a story-level check. **Milestone 38 therefore stays `in-progress`**, and story 04's soak
joins the six other outstanding live gates there. The honest summary: *story 04's contract is met and its surface
conforms; whether it works on a real two-machine deploy is still owed, at the milestone.*

**Owed at `aof:verify 38` for this story:** re-run task 04's soak on a redeployed SEA, and close the `@uat` visual
residue §Surface 2 records (the one-node roster, a zoom crop of the chip's dot, ladder rungs 1 and 3, and a
refusal whose holder differs from the picker's selection).

---

### ~~Accept decision — story-04 DECLINED; stays `in-review`~~ (SUPERSEDED — the gaps below were then built)

- **The automated lanes are green and the fix is real** — 68/68 focused, 225/0 blast radius, 694/703 arch sweep with
  only the 9 known pre-existing reds, `ui:build` green. F21's wrong-target dispatch and F22's silent success are both
  closed **at source, in test, and in the re-render's pixels**.
- **But the story's own design surface is `GAPS`.** DG-15 and DG-16 are BUILD defects against rules that are right,
  on the very region (5) this story teaches to speak; DG-17 needs the designer's rule change and then a build. Per
  triage, design-gaps route back to `aof:continue 38/04` — the rules are now recorded in DESIGN.md, so the build has
  something to build to.
- **And the one check this story exists for has not been re-run.** The `@manual` soak failed last time and is owed
  again on the fixed build. **This milestone has proved eight times that a green suite is not evidence a feature
  works** (F1/F4/F6–F9/F18/F21) — accepting story 04 on its passing tests plus a `GAPS` render would be exactly the
  mistake it spent itself teaching.
- **What closes it:** (1) build DG-15/DG-16 and DG-17's ladder; (2) one more 1280 frame set — three frames suffice
  (long-target chip, any chip-bearing card at rest, the refusal), plus the still-owed zoom crop of the chip's dot and
  a one-node-roster frame for A5; (3) deploy the fixed SEA to the control node and **re-run task 04's soak**.
