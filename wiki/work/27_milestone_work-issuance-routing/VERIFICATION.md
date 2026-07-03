---
doc: verification
milestone: 27
updated: 2026-07-03
---
<!--
  Milestone VERIFICATION.md — the verify+accept record. Authored by the aof:verify orchestration
  (NOT by evidence subagents — their writes are untrusted). Only sections with content are written.
-->
# 27 · Cross-Machine Issuance & Routing — Verification

Verified + accepted `2026-07-03` by `aof:verify 27`. Lanes in scope: `@executable` (whole suite +
fitness), `@manual` (the KR3 3-OS soak, task 06), `@uat` (the fleet issue/assign design-conformance,
task 02). Two non-`@executable` features only — everything else is `@executable` and rides the suite.

## Verification evidence

- **`@executable` suite + fitness + security-fitness — GREEN.** Fresh `node scripts/test.mjs`:
  **2221 ok / 0 not-ok** (exit 0). Covers every `@executable` scenario across the 15 task features and
  the milestone's fitness functions #1–#7 + the two security controls **S-1**
  (`acd-mesh-issue-route-same-origin`) and **S-2** (`acd-issuance-revoked-issuer-filtered`), each
  non-vacuous (mutation / planted-violation self-checks). `verifies →` `test/arch/acd-issuance-*`,
  `test/arch/acd-mesh-issue-route-same-origin`, `test/arch/acd-mesh-ui-write-isolation`,
  `test/arch/acd-next-candidacy-*`, and the story test suites
  (`test/mesh-issuance-*`, `test/mesh-issue-*`, `test/mesh-routing-*`, `test/mesh-cross-node-issuance-kr3`,
  `test/mesh-status-issued-render`, `test/mesh-ui-issue-route`).

- **KR3 `@manual` soak (task 06) — MEASURED GREEN on a single OS.** A local multi-clone fleet (one bare
  git remote + 3 clones: node-a issuer/control, node-b advertises `codex`, node-c advertises `claude`),
  driven **only** through registered commands (`aof mesh issue [--to …] [--withdraw]`, `syncMesh`,
  `aof work next`, `aof work run-start`) — never a hand-edited `.mesh/` file. A pool of **20** ready items
  was issued across all three target kinds (10 node-targeted, 5 capability-targeted `codex`, 5 untargeted):
  - **(1) coverage** — **20/20 = 100 %** picked up and claimed on an **eligible** node (target satisfied);
    ≥95 % target **met**.
  - **(2) latency** — every pickup within **≤2 sync intervals** (issuer push = 1, peer pull = 2); first
    offer/claim observed after exactly the one post-issue pull.
  - **(3) eligibility** — **0** ineligible runs (every `holders ⊆ eligible`; node-targeted never offered
    off-target, `codex`-targeted never offered on a non-advertiser).
  - **(4) no manual shuffle** — every directive reached its eligible node over the default-root git sync
    alone; no file was copied/edited/moved to route work.
  - **withdraw round-trip** — `--withdraw` on node-a → sync → node-b pull: node-b's pulled copy reads
    `withdrawn` (no file deleted either side), and the item returns to node-b's normal walk. Confirmed.
  - `verifies →` `stories/01_.../tasks/06_kr3-soak.feature`; mechanism half proven `@executable` at
    `test/mesh-cross-node-issuance-kr3.test.mjs` (task 05).
  - **Residual (F-2701):** ran on one Windows box (three git clones), not three OS-distinct machines — the
    macOS/Linux real-fleet breadth was **not** exercised here (delegated, see Findings + User sign-off).

## Live / environmental checks

- **Design-conformance render → designer judgement (task 02 `@uat`, ADR-001/002/003).** The fleet surface
  was rendered fresh via `npx playwright screenshot` against a live `aof mesh ui` (real built `ui/dist`),
  at **390 / 768 / 1280** on a **control-node** fixture (`isControlNode:true`) and a **runner-node**
  fixture (`isControlNode:false`) — the only difference between the two being the control-node fact
  (identical registry: 3 boards on node-a/b/c + 3 node records). `mesh:status` probes confirmed
  `nodes=3, boards=3, isControlNode true|false`. Renders at
  `…/scratchpad/m27-render/{control,runner}-{390,768,1280}.png`.
  - `aof-designer` verdict — **idle-control: CONFORMS** (all 3 widths): the `[⊕ assign]` trigger sits on
    the board-tile action row between the run-state chip (left) and `Open board →` (right) — order
    `state · issue · open`; a small `primary`/teal button with the plus-circle glyph + `assign` label; the
    rest of the tile m25-unchanged; the surface stays a calm read-only rail (no toolbar / bulk-select /
    command console). **gated-absent-runner: CONFORMS** (all 3 widths): the trigger is a **true absence**
    (not greyed/disabled) — the tile is byte-consistent with the m25 read-only tile (`chip … Open board →`,
    nothing between).
  - Interactive states (open picker / submitting / success / error) are not one-shot renderable —
    **INCONCLUSIVE-here by scope**; judged **CONFORMS** at the story-02 review (after the Gap-B popover-
    anchoring fix, STATE.md) and covered by the `@executable` route tests (`test/mesh-ui-issue-route`) +
    the User sign-off below.
  - Harness note (not a gap): node-presence dots rendered `stale` (fixture heartbeat aged before the poll)
    — a timing artifact; the presence ramp is not exercised by the closed-picker static renders.

## Findings

| id | observed | type | severity | triage | routed-to | status |
|----|----------|------|----------|--------|-----------|--------|
| **F-2701** | KR3 soak (task 06) ran single-OS (Windows, 3 git clones); the macOS/Linux real-fleet breadth was not exercised. Coverage 100 % / ≤2-interval / 0-ineligible / no-shuffle all met on the one OS; mechanism proven `@executable` (task 05) + fitness. | environmental / evidence-completeness | low | **non-blocker → delegate** | **whole-mesh UAT session (18–28)** — the 3-OS soak is its headline `@manual` scenario | open (delegated) |
| **F-2702** | On the control node at 1280 px the narrower (272 px) board tile wraps `Open board →` to two lines once the `[⊕ assign]` control is present. Row order + components all correct; the m25 responsive card idiom. | design-gap (cosmetic) | low | **design-gap → defer** (designer proposes: action row `flex-wrap:nowrap` + truncate name/owner, or glyph-only trigger at the narrowest column; fold into the recommended affordance mock) | backlog / `DESIGN.md` follow-up (aof-designer sets the rule) | open (deferred) |
| **F-2703** | `05_cross-node-issuance-kr3.feature` withdraw scenario `Then "B's next no longer offers the item"` is unsatisfiable under ADR-004.2 (routing narrows, never grants — a withdrawn directive returns the item to B's normal walk, so B still offers it). The green test asserts the correct semantics and self-documents the drift (`test/mesh-cross-node-issuance-kr3.test.mjs:252-258`). | contract-prose drift | low | **non-blocker → defer** (reword the `Then` to "the withdrawn directive is spent — B's pulled copy reads `withdrawn`, steering no routing verdict; B offers via its normal walk"; the scenario **title is embedded in the test name**, so reword title + test-name together to keep traceability) | backlog (PO) | open (deferred) |
| **F-2704** | `00_fleet-ui-issue-route.feature` malformed-body Examples named `400 / missing-ref` for the three ref rows, but the route passes `ref` straight to `mesh:issue`, which emits `404 / ref-not-found` (the file's own RESOLVED note prescribes it; the wiring test tolerates `[400,404]` + any non-empty code). | contract-cell drift | low | **non-blocker → RECONCILED at verify** (inline PO): the three ref rows updated to `404 / ref-not-found`; validate re-run PASS | — | **resolved** |

No **blocker** finding is open.

## User sign-off

- **`@uat` — accepted at the milestone level on the design-conformance verdict.** `aof-designer` returned
  **CONFORMS** on both statically-renderable gating states (idle-control · gated-absent-runner) across all
  three breakpoints — that CONFORMS is the ADR-001/002/003 design-conformance authority.
- **Experiential human sign-off delegated.** The operator (`umair`, 2026-07-03) elected to perform the
  **experiential** human acceptance — the interactive click-through (open picker → target → issue →
  submitting/success/error) and the real cross-machine feel — **holistically across the whole mesh arc**,
  as a dedicated cross-milestone **UAT session (`depends: 18–28`)**, rather than per-milestone. Milestone 27
  is therefore accepted now on its technical + design-conformance evidence; the m27 affordance
  interactive-state click-through **and** the KR3 3-OS real-fleet soak (F-2701) are carried as the
  headline `@manual`/`@uat` scenarios of that session — delegated, not skipped.

## Accept decision

**Milestone 27 — ACCEPTED (2026-07-03).** All three stories' `@executable` + `@manual` (single-OS) +
design-conformance lanes are green; `aof work validate` **PASS**; **no blocker finding open**. Stories
00 · 01 · 02 → `done`; SPEC → `done`; STATE compacted. Two items delegated to the whole-mesh UAT session
(18–28): the KR3 3-OS breadth (F-2701) and the affordance experiential click-through. Three non-blocker
doc drifts logged: F-2702 (design, deferred) · F-2703 (prose, deferred) · F-2704 (cells, **reconciled**).
