---
doc: retrospective
milestone: 23
updated: 2026-07-01
---
<!--
  Milestone RETROSPECTIVE.md — the distilled, carryable lessons from how m23 actually ran.
  One R<n> per lesson; append-only (never renumber). Reference, never restate (the detail
  lives in STATE ## Feedback, VERIFICATION ## Findings, and the ADRs). Written by
  aof:retrospective at the close of aof:verify 23 (the F1 close-out re-verify).
-->
# 23 · Control Node + Thin Relay — Retrospective

## R1 — Every observable needs a reader: a write-graph break-down is blind to the consuming hop
- **Kind:** mistake (decomposition gap → verify blocker) · **Area:** refine/break-down · **Stage:** refine (surfaced at verify) · **Owner:** PO/architect lane · **Raised by:** aof:verify 23 (finding F1)
- **What happened.** The story break-down mapped the presence data-path as publish (`mesh:heartbeat`) +
  transport (`serveRelay` broker) + git-read render (`mesh:status`) — every authored task went green — yet the
  milestone's **headline** KR ("a peer's change reflected ≤5s over the relay") stayed **undeliverable**: no task
  owned the node-side **consuming** hop. `createRelayClient` was push-only; nothing applied a fanned-out signal
  into what `mesh:status` reads, so a peer's change surfaced only after a ≤30s git sync. A blocker (F1) at
  verify; closed by building the receive-and-apply consumer in-milestone (ADR-004).
- **Why.** A break-down grounded in the **write** graph (who *produces* each record) faithfully maps producers
  but is structurally blind to the **reader**: the consuming hop leaves no write-side coupling edge, so it never
  appears as a task. Every authored task can be green while the end-to-end observable is dead.
- **Lesson.** For any end-to-end latency/visibility objective, walk **each hop of the observable's data-path —
  producer → transport → consumer → render** — and confirm a task owns each, *especially the consuming hop*,
  before locking the break-down. This is the inverse of 22/R1 ("every write trips a gate"): **every observable
  needs a reader.** **Refs:** VERIFICATION ## Findings **F1**; STATE ## Feedback (decomposition gap); ADR-004 +
  fitness #7.

## R2 — A narrow design-lock must LEAD the build, not race it (and name its own gate)
- **Kind:** misunderstanding · **Area:** orchestration · **Stage:** refine/build (F1 close-out) · **Owner:** orchestrator · **Raised by:** aof-architect (ADR-004 design-lock)
- **What happened.** For the F1 fix, the developer built `mesh-presence-cache.mjs` + `mesh-presence-subscriber.mjs`
  + the `mesh:status` overlay **concurrently** with the architect authoring ADR-004 (files timestamped minutes
  apart), so the ACD premise — a narrow design-lock BEFORE the developer builds, with the fitness function RED
  until the module lands — did not hold: the gate landed **green against already-built code**, and the ADR was
  reconciled against a fait accompli. Secondary drift: the built modules' headers cited an arch-test name
  (`acd-presence-cache-not-authority`) that was never authored — the real gate is
  `acd-presence-subscriber-cache-only` — because the orchestrator over-commissioned a parallel fitness function
  before seeing the architect's pre-authored ADR-004 #7. Neither was a defect (the implementation conforms;
  suite green), but the ordering is exactly what the architect-leads-refine step exists to prevent.
- **Why.** A single-finding close-out feels small enough to dispatch dev + design-lock in parallel; the
  gate-before-code discipline (RED-until-built proves the gate fires on absence) silently degrades to
  green-against-presence, and a parallel gate draft drifts the arch↔dev naming handshake.
- **Lesson.** Even for a one-finding fix, dispatch the **design-lock first** (so its fitness function is RED
  until the module lands — the proof the gate is live), and when the architect has pre-authored a fitness
  function in the ADR, the developer brief must reference **that** gate by name — never commission a parallel
  one. One invariant, one gate, authored once. **Refs:** STATE ## Feedback (F1 design-lock); ADR-004; fitness #7.

## R3 — A git-as-bus EOL pin must match the REAL nested record path, not a root anchor
- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer/architect lane · **Raised by:** developer (build-shaping)
- **What happened.** The first `.gitattributes` pin `.mesh/** text eol=lf` resolved as **`unspecified`** for the
  actual record path `wiki/work/.mesh/presence/<node>.json` (`git check-attr`) — it only anchored a *root-level*
  `.mesh/`. Corrected to `**/.mesh/** text eol=lf` (verified to resolve `eol=lf` at both nested and root depth)
  and the `acd-mesh-eol-pinned` matcher widened to match. This is the direct discharge of 22/R5 (the deferred
  F1→m23 EOL pin).
- **Why.** A glob written against the *conceptual* partition (`.mesh/`) silently under-matches the *actual*
  co-located nested path (`wiki/work/.mesh/…`); `unspecified` is a silent no-op, not an error.
- **Lesson.** When pinning attributes/ignores for a generated partition, verify the rule with `git check-attr`
  at the **real on-disk depth** (not the conceptual root), and have the fitness function assert **whole-surface**
  scope — the m03 "a fitness function must assert WHOLE-SURFACE scope" lesson, re-lived and caught at build.
  **Refs:** STATE ## Feedback (EOL near-miss); fitness #6; 22/R5.

## R4 — A ws contract-frame check must fire BEFORE the protocol layer's own limit
- **Kind:** near-miss · **Area:** contract/build-note · **Stage:** build · **Owner:** developer/amigos · **Raised by:** developer
- **What happened.** Story 01's build note said "set ws `maxPayload` to the SAME value as `maxFrameBytes`" — but
  ws enforces `maxPayload` at the protocol layer and `1009`-closes an at-limit frame **before** the inbound
  handler runs, so an over-limit sender would get ws's 1009 close (the WRONG observable the note itself warned
  against), never OUR frozen `{type:'error'}` control-frame. Corrected to `payloadFloor = max(2×, +64 KiB)`
  **above** `maxFrameBytes`, so the hand-rolled contract check fires first while ws still guards a truly enormous
  DoS frame. The subscriber's read-side `parseInboundFrame` shares the same floor. No `.feature`/ADR change; the
  build note was wrong.
- **Why.** A defence-in-depth limit set *equal* to the contract limit pre-empts the contract path — the library's
  own enforcement wins the race and emits the library's observable, not the hand-rolled one.
- **Lesson.** When a hand-rolled check must own the observable (a frozen error frame), set the underlying
  library's guard **strictly above** the contract limit so the contract path always fires first; a defence floor
  is a floor, never an equal. **Refs:** STATE ## Feedback (maxPayload near-miss); ADR-001; fitness #2.

## R5 — A shared test suite goes red the moment a downstream milestone is refined; scope "green" to the milestone under verify
- **Kind:** misunderstanding · **Area:** process · **Stage:** verify · **Owner:** verify lane · **Raised by:** aof:verify 23
- **What happened.** m23's build recorded "1716 ok / 0 not ok", but at this F1-close-out re-verify the shared
  `scripts/test.mjs` reported **1719 ok / 10 not ok** — the 10 red being m24's (group-enrollment) fitness
  functions (`enrollment-code-*`, `relay-auth-gate-checked`, `registry-write-scope`, `enroll-git-argv-no-shell`),
  registered at m24's refine and correctly **RED-until-built** (m24 refined, not yet built). Every m23 test +
  all 7 m23 fitness functions were green. A second trap compounded it: `node scripts/test.mjs | tail -40`
  returned the **pipeline's** exit (tail's `0`), masking node's real exit `1` — the red suite first *looked*
  green. Caught by re-running with the exit code captured directly (`node …; echo $?`).
- **Why.** The RED-until-built discipline (a gate authored before its code fails until the code lands) is
  designed per-milestone, but the suite is **shared** — so refining milestone N+1 immediately reds milestone N's
  re-verification of the *same* suite. And a shell pipeline's exit code is the last stage's, not node's.
- **Lesson.** At verify, "confirm the suite green" means the **milestone-under-verify's** tests + its own fitness
  functions; a residual red must be triaged, and residual red from a **downstream** milestone's RED-until-built
  gates (out of the current scope) is expected, not a regression — record the exact red set and its owning
  milestone so a reader is not misled. Always capture the **runner's own exit code** (never a pipe's) when
  asserting green. **Refs:** VERIFICATION ## Automated evidence (the 10 m24 gates); this document.

<!-- Non-blocker findings F2–F5 (production launcher deferred; presence-only-node contract undocumented; stale
     MESH_USAGE banner; no mesh:status --now affordance) are backlog deferrals already logged in
     VERIFICATION ## Findings — carried, not distilled as lessons (each is a scope choice, not a process defect).
     F2 (no live daemon) is now load-bearing for m24/m25: the F1 subscriber + the relay serve both need a
     production launcher, so the launcher question graduates to m24's scope. -->
