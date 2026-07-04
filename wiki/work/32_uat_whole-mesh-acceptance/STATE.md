---
doc: state
---
<!--
  UAT session STATE.md — answers ONE question: where are we in the session, and what happened?
  Owner: qa (single writer). Identity is inherited from the folder; the canonical status lives on
  SESSION.md frontmatter. This is the running narrative + the feedback inbox the retrospective drains.
-->
# 32 · Whole-Mesh Acceptance — State

## Progress

- Framed `2026-07-03` by `aof:add-uat` — a cross-milestone acceptance gate over the runs → mesh →
  console delivery (`depends: 18–28`). The operator elected at `aof:verify 27` to perform the mesh's
  experiential human acceptance holistically here rather than per-milestone. **Not started** — this is a
  frame only; `aof:verify 32` runs the lanes and records acceptance.

- [x] Regression sweep (`@executable` + fitness functions across 18–28) — **green, 2221/0** (`2026-07-04`)
- [ ] `@manual` re-run — **not completed** (halted)
- [ ] `@uat` human sign-off — **not completed** (halted)

- **HALTED `2026-07-04` — rejected for relay/transport redesign.** The operator stopped the session
  during the live cross-OS lane. The regression sweep passed, but standing up a real 2-node fleet
  (Windows + macOS over Tailscale) revealed the mesh does not deliver the integrated experience: the
  relay was never launchable (F-3201, prototyped this session), had no reachability model (F-3202),
  node identity is inherited on clone (F-3203), and — the deciding call — **the relay architecture is
  the wrong abstraction for a mesh-VPN transport and needs a rewrite (F-3204)**. Verdict + rationale
  in `SESSION.md ## Sign-off / verdict`. Re-run this gate after the milestone-33 redesign.

## Notes & decisions in flight

- **Blocked on 27 + 28.** Entry requires every accepted milestone `done`. `27` is done ✓;
  `28_milestone_console-app` is in-progress (verifying). `aof work next` will not advance to this session
  until both are accepted — run `aof:verify 32` once 28 lands.
- **Carried from 27's accept:** the two headline human lanes here are milestone 27's delegated residuals —
  the KR3 3-OS real-fleet breadth (27/VERIFICATION F-2701) and the `[⊕ assign]` interactive-state
  click-through (27 task 02 `@uat`). The single-OS KR3 mechanism (100%/≤2/0/no-shuffle) and the static
  affordance states (CONFORMS) are already proven at 27's gate — this session supplies only the
  cross-OS + live-interaction breadth.

## Feedback (for retro)

<!-- Raw process notes — drained by the retrospective at close. Acceptance OBSERVATIONS go to
     SESSION.md ## Findings (via aof:feedback 32), not here. -->

- The whole-mesh UAT earned its keep: milestones 18–28 each passed their **own** gates, yet the
  *integration* failed on first real cross-OS contact. A cross-milestone acceptance gate caught what
  eleven per-milestone gates structurally could not — the parts were green, the product was not.
  **Raised by:** qa (session).
- Process gap: the mesh's **transport/reachability + identity model was never exercised on real
  hardware** before this session — the `@executable` + `@manual` lanes proved each mechanism in
  isolation (loopback relay, single-OS KR3, in-process enrollment) but the load-bearing integration
  assumptions (relay reachable off-box, records actually sync, node identity distinct per machine)
  went unvalidated across m22–m27. Consider an earlier "real 2-node smoke" checkpoint, not deferred
  to the final whole-mesh gate. **Raised by:** qa (session).
- The relay was designed hub-and-spoke (broker + device-code + tunnels) without a decision on the
  **network fabric**; once Tailscale was the intended transport, most of that machinery became
  redundant (F-3204). Pin the transport assumption **before** building the coordination layer.
  **Raised by:** umair (operator).
