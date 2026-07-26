---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  COMPACTED at Accept (`2026-07-26`): the durable decisions live in ARCHITECTURE.md's ADRs, the
  lessons in RETROSPECTIVE.md, the measured evidence in VERIFICATION.md, and the product state in
  OUTCOME.md. The blow-by-blow (690 lines of build/verify narrative, 2026-07-10 → 07-26) is archived
  in git history — `git log -p wiki/work/38_milestone_cross-machine-worker-execution/STATE.md`.
-->
# 38 · Cross-machine worker execution & session presence — State

**CLOSED `2026-07-26` — accepted, all nine stories done.** See
[VERIFICATION.md](VERIFICATION.md) (evidence + findings), [OUTCOME.md](OUTCOME.md) (what the system now
is), [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R13), [ARCHITECTURE.md](ARCHITECTURE.md) (ADR-001–016).

## Progress

| date | what happened |
| --- | --- |
| `2026-07-10` | **Framed** from a defect found live in the m36 desktop UAT: the fleet read `idle` on a node being actively worked on. Root-caused at the data source — presence counted only executed task-runs, and read ONE workspace (the daemon's launch cwd). |
| `2026-07-10` | **Refined** (`--autonomous`): RESEARCH + ARCHITECTURE + DESIGN + SECURITY, then a graph-grounded break-down to **2** stories (00 session-presence, 01 worker-repo-checkout); `worker-worktrees` folded away (ADR-006 — m35 already ships the mechanics). |
| `2026-07-10` | **Built + reviewed** — both stories green, architect/QA/designer all GO. Both `in-review`. |
| `2026-07-12/13` | **Verified — and the headline feature did not work at all.** The live soak found **six blockers** (F4, F6, F7, F8, F9, F11) that 2409 green assertions, 9 green fitness functions, a green `validate` and a CONFORMS design review had all missed. All six fixed via `@bug` tasks 07–10 and re-verified on the *installed* stack. **Story 00 accepted**; story 01 not (unverified, not failed). ADR-008 + RETROSPECTIVE R1–R6 came out of this. |
| `2026-07-13` | **Story 02 added** (`clone-credential-mint`) at the user's direction — close the mesh network here rather than defer the credential automation. |
| `2026-07-16` | **Provisioning arc.** A real GitHub App created and installed on one repo only; `mesh repo publish` taught to auto-detect `cloneUrl`; the App key relocated out of a Dropbox-synced folder into `<meshRoot>/credentials/`. Security found and closed **F14** (an ambient git credential helper silently defeats `GIT_ASKPASS` and persists the token to the keychain), **F15** (a credential minted against the REQUESTER's workspace, not the assignment's) and **F16** (a terminal assignment still minting). **Story 02 accepted.** **Story 03 added** (`per-org-credential-scoping`) mid-pass at the operator's direction. |
| `2026-07-18` | **Stories 04–08 added** after the first real two-machine soak proved the plumbing worked but a worker's output was disposable, its driver could not ask a human anything, and nothing synced knowledge back. Operator's bar: *"I'm not signing off this milestone until it actually works in a real-world scenario."* Refined + contracted (ADR-011–016); stories 03/04/07 built to green. |
| `2026-07-19` | Stories **05/06/08** built to green. Verify raised two SOAK-BLOCKERS and both were closed the same day: **F-38.05** (the `NEEDS_INPUT`/`session_id` producer was unwired) and **F-38.06** (the terminal stream was green against an in-process broker but inert on a real deploy). **Story 05 accepted** after re-verify. |
| `2026-07-23` | **F-38.06c** closed — the transport was reachable but had NO CONSUMER SURFACE (`grep terminal-view ui/` = 0); the break was three links deep and its review found two more producer gaps beneath it. |
| `2026-07-24` | **The live two-machine mesh stood up**, and standing it up exposed **F18** (cross-node presence dropped `sessions` in transit — objective (a) failing across the boundary the milestone is named for; fixed, `d7fa8d5`) and **F19** (every prior pass's "arch suite GREEN" figure was a FILE count — the command ran nothing, masking 9 red cases). The **first soak that actually ran** then FAILED: the operator clicked let-shield's `ref 18` and the mesh dispatched the CONTROL's `ref 18` off a `200 ok` (**F21**), with no acknowledgment (**F22**). Both fixed, plus F-38.04a and F-B; the design surface was judged **four times** (DG-13 → DG-22) until it converged. **Story 04 accepted.** |
| `2026-07-25/26` | Ten days of live-soak fixes across stories 01/05/06/07 — PTY submit timing (F27/F27b), the worker clearing `claude`'s folder-trust dialog, the worker running the ASSIGNED workspace's checkout rather than the launcher's cwd, commit-before-push (F-38.06i), `aof mesh recover-push`, UI phase selection, board mesh-execution surfacing, and the payload-first launcher that made deploy a file-copy. **⚠️ These landed with no STATE entry at the time** — the git log is their narrative (RETROSPECTIVE **R11**). |
| `2026-07-26` | **Verified + ACCEPTED.** Deploy preflight clear for the first time (control node on HEAD exactly, both daemons current); foundation re-measured honestly — **2965 real cases, 16 red, none m38; `arch/38` 115/115**; the nine long-standing pre-existing arch reds cleared; the control-node session round-trip demonstrated live on both fleet faces. A NEW blocker **F23** was found (the desktop can never render a REMOTE node's session — `sessions` stripped for fabric-Online peers) and, with **F24** and **F26**, **routed to milestone 42** at the operator's direction; the five outstanding cross-machine `@manual` soaks were closed on the **operator's attestation** (SSH to the worker was refused — **F25** — so this session witnessed none of them). `validate 38` + whole stream **PASS**. |

## Decisions (graduated)

All sixteen ADRs live in [ARCHITECTURE.md](ARCHITECTURE.md); the design rules in
[DESIGN.md](DESIGN.md); the threat model in [SECURITY.md](SECURITY.md). Index, so a reader knows which
door to open:

- **ADR-001** `sessions` is an ADDITIVE fifth presence key (the m23 schema evolves, byte-order intact) ·
  **ADR-002** per-`(node, workspace, assistant)` record with TTL self-expiry reusing `isStale` ·
  **ADR-003** presence aggregates across ALL a node's registered workspaces · **ADR-004** run-wins
  reconciliation, session as the fallback line (relocated upstream into the publisher at build — the
  render layer structurally cannot attribute a bare `string[]` to a workspace).
- **ADR-005** clone-on-miss extends m35's refusal into resolve → clone → register → fall through ·
  **ADR-006** `worker-worktrees` subsumed by m35 · **ADR-007** the two-story partition along the graph's
  clean seam.
- **ADR-008** the producer-fed contract rule — *a green suite is not evidence a feature works* — this
  milestone's durable yield, with three armed fitness functions. **Owed clause** (from F21, R7): a seam
  whose failure mode is a WRONG TARGET must be exercised with ≥2 candidate targets, one not the
  caller's own, with the discriminating identifier COLLIDING across them.
- **ADR-009** the credential is PULLED by the worker at the miss over the existing stream, via an
  injected resolver · **ADR-010** `mintCloneCredential` becomes a config-selected provider
  (`env-token` | `github-app`), repo scope resolved from a control-trusted source · **ADR-011** the App
  identity resolves PER-ASSIGNED-WORKSPACE, keys under a code-enforced `<meshRoot>/credentials/`.
- **ADR-012** (AMENDED `2026-07-24`) the fleet face's ONE write route `POST /api/mesh/assign`, wire
  `{ref,nodeId,workspaceId}` all REQUIRED — the fallback WAS the defect · **ADR-013** an interactive
  `claude` PTY per assignment replaces `claude -p`, `NEEDS_INPUT` sentinel, `session_id` captured ·
  **ADR-014** (AMENDED, hybrid) the terminal bridge: fabric worker→control, loopback control→UI, mirror
  read-only in fact · **ADR-015** a real branch pushed BEFORE the worktree is removed, on a separate
  write-scoped token · **ADR-016** knowledge rides git; the graphify index never crosses the mesh.
- **PO framing choices, for the record:** presence is assistant-agnostic and hook-fed (an editor that
  reports nothing stays `idle`); presence is binary-per-workspace here, finer signal is additive later;
  the design baseline was **binding-checklist-only**, no new mock (user-chosen at refine) — which is
  precisely how the false CONFORMS was manufactured (RETROSPECTIVE R3).

## Feedback (for retro)

**Archived at Accept `2026-07-26`** — every note in this section has graduated into
[RETROSPECTIVE.md](RETROSPECTIVE.md) as **R1–R13** (and, where durable, into ADR-008). The raw notes
remain in git history.

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` + fitness green, honestly measured at the close — **2965 real cases / 16 not ok**
  (none m38), **`arch/38` 115/115**, per-case hermetic `AOF_GLOBAL_HOME`; the vacuous
  `node --test test/arch/*.test.mjs` figure prior passes recorded is corrected (F19)
- [x] `aof work validate 38` → **PASS**; whole stream → **PASS**
- [x] Live, first-hand at the close: a real `aof session ping` → presence within ~12s → both fleet faces
  render `working · aof (session)` on the current build
- [x] `@manual` / `@uat` live cross-machine soaks — **closed on the operator's attestation `2026-07-26`**
  (stories 01/03/06/07/08, plus story-04's re-run and story-02's real-App mint). Not witnessed by the
  verifying session; SSH to the worker was refused (**F25**)
- [x] **Accepted `2026-07-26`** — `SPEC.md status: done`, all nine story boxes ticked

## Carried forward

- **→ milestone 42** (routed at the close, measurements carried across in
  [42's STATE.md](../42_milestone_structural-overhaul/STATE.md)): **F23** the presence record is rebuilt
  field-by-field at three seams and only two know its shape — the desktop cannot render a remote node's
  session (wave (b)); **F24** a node descriptor's `workspaces[]` is the publisher's workspace stamped on
  the whole roster (debt item 4); **F26** the publish leaks its temp file (wave (a)).
- **Open, deferred, non-blocking:** **F13** the loopback re-listen with no error listener re-attached
  (its test-side twin still kills a full-suite run against a live daemon); **F5** `aof session` reads
  stdin unconditionally; **F3** task-00's unsatisfiable Scenario-Outline row; **F10** the lying demo
  fixture in `app/desktop/ui/app.js`; **DG-1**, **DG-18**, **DG-23** design residues; the §Surface 2
  `@uat` visual residues story 04 recorded.
- **Not m38's, but surfaced by its honest sweep:** the bundle command-count constants (`22 !== 21`,
  7 cases), the five `doctor/*` cases, `memory-integration`'s record count, and `agent-model-override`
  still asserting the retired `sonnet` developer default.
