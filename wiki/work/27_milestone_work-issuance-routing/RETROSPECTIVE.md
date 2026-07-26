---
doc: retrospective
milestone: 27
updated: 2026-07-03
---
<!--
  Milestone RETROSPECTIVE.md — carryable lessons only. Distilled at Accept by aof:retrospective from
  STATE ## Feedback (for retro) + VERIFICATION findings + any blocker stops. No doc if the run was clean;
  this run was not (5 feedback notes + 4 findings, 0 blockers). R<n> = a carryable lesson; ADR-graduation
  notes flag durable decisions owed to the record. Folded into memory via `aof work memory ingest`.
-->
# 27 · Cross-Machine Issuance & Routing — Retrospective

Run shape: **clean delivery, no blocker stops** — the 00→01→02 chain built + reviewed + accepted in one
pass. Lessons below are process/tooling carry-forwards, not defect post-mortems. Findings F-2701…F-2704
live in [VERIFICATION.md](VERIFICATION.md); the two contract-prose drifts (F-2703/F-2704) were wording, not
behaviour — every mechanism was proven green.

## Carryable lessons

- **R1 — A forward-looking arch-test detector that keys on a symbol's NAME must distinguish DEFINITION
  from CONSUMPTION.** The S-2 gate (`acd-issuance-revoked-issuer-filtered`), authored at Decide for the
  consuming story 01, armed one story EARLY on story 00: its call-site regex matched the
  `readIssuanceDirectives`/`nodeSatisfiesTarget` **definitions** in the new substrate module as if they
  were routing call-sites, flipping red on the substrate's own contract-mandated deliverable. Fix pattern
  (applied): strip definition sites before the call-site test + add a definition-only non-vacuous
  self-check. Carry: when a SPECIFY-at-a-later-story gate names vocabulary the DEPENDENCY-ROOT story
  defines, the detector must exempt definition sites or it fires on the substrate.

- **R2 — A command that grows a SECOND face (CLI + HTTP) in a later story needs a SHARED
  input-normalization helper both faces call, OR a parity fitness.** The `--to any` sentinel diverged
  across faces: the UI route normalized `"any"→undefined` while the CLI resolved `--to any` to
  `{kind:"capability",value:"any"}`. No fitness caught it — fitness #7 pins "reaches the mutation via
  `invoke`", S-1 pins "guarded before invoke", but **nothing asserted the two faces disambiguate `to`
  IDENTICALLY**. Fixed by consolidating into `resolveTarget` (the ONE disambiguator, both faces agree on
  `{kind:"any"}`). Carry: cross-face contract splits are a silent-divergence class — a second author
  re-deciding a frozen contract locally (adjacent to [[verify-owns-record-docs]]). Prefer a shared helper
  or a parity fitness whenever a command sprouts a transport face.

- **R3 — Every NEW loopback write route needs a same-origin guard (Origin + non-simple content-type),
  not just a loopback bind.** Standing convention, established by m27's `POST /api/mesh/issue` (SECURITY
  T1 / `acd-mesh-issue-route-same-origin`). Loopback bind stops a remote-network attacker but NOT a
  browser-CSRF attacker: a CORS simple request needs no preflight and the attacker need not read the
  response — the side effect IS the attack. **Owed retrofit (out of m27 scope):** the two pre-existing
  loopback write routes still defend with bind alone — `POST /api/work/feedback` (`src/board-ui.mjs`) and
  the m24 `POST /enroll` (`src/mesh-relay.mjs`). Route to the security backlog; make the guard a standing
  requirement, not a per-milestone re-derivation.

- **R4 — A bounded-write method matrix pins the EXACT refusal code + the `Allow` header PER route, not an
  `||` OR.** The fleet face's 405s carry a correct per-route `Allow` (`GET, HEAD` on status, `POST` on
  issue) but the test originally asserted `405 || 404`; tightened at the gate to pin status + code + Allow
  per row. Carry the per-row pin as the convention for any bounded-write surface.

- **R5 — Don't silently trust graphify's node set where a file-existence check disagrees.** A phantom
  dependent `src/mesh-lease-tie.mjs` (does not exist on the tree — `tieClaimToRun` lives in
  `src/mesh-lease.mjs`) was reported by `aof graph impact` and **persisted across fresh rebuilds**
  (1261/3400 → 1287/3269), so it is a standing extractor artifact, not a one-off — likely a comment/plan
  reference graphify resolves as a node. It changed no story boundary (real coupling held), but graph
  nodes should be verified against the tree at boundary-drawing time. **Tooling follow-up:** confirm
  graphify's extractor isn't promoting a comment/plan reference to a node.

- **R6 — When an ADR's own consequence will MOVE line numbers, cite STRUCTURAL anchors (function +
  return-site), not absolute lines.** ADR-004.3 / fitness #5 pinned `work.mjs:568/574/598`, but the
  fold-in those ADRs mandate moved the returns (~:585/:603/:646). The arch-tests anchor structurally so
  nothing was brittle — but the citation convention should follow suit.

## ADR-graduation owed

- **Graduate the `candidacySkipped` guard into the ADR record.** The developer's in-spirit
  correctness strengthening — *a milestone whose remaining stories are ALL candidacy-skipped is not
  falsely offered for ACCEPT* — resolves an under-specified carve-out in ADR-004.3. Record it in
  [ARCHITECTURE.md](ARCHITECTURE.md) ADR-004.3 so the next consumer inherits the rule rather than
  re-deriving it. (Deferred, non-blocking; folded here for the accept-time ADR pass.)
