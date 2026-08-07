---
doc: verification
milestone: 45
verified: 2026-08-07
verifier: aof:verify
verdict: in-progress
---
<!--
  Milestone VERIFICATION.md — the verification record. Pointers, not restatements.
  Only sections with content are written (absence of a section is information).
  Written per story as each reaches its gate; the milestone verdict is recorded at Accept.
-->
# 45 · UI app shell & path routing — Verification

Ref resolved via `aof work find "<ref>" --json`. Verified **story by story**; the record grows one
section per story gate, and the milestone verdict is settled once all four are `done`.

## 45/01 · The route model — verified 2026-08-07, ACCEPTED

Lanes in scope: **`@executable`** only (all three tasks are `@executable @ui @work @distribution`).
No `@manual`, no `@uat`, and no rendered surface — the module is pure and imported by nobody until
45/03 — so the human-acceptance step and the design-conformance review are both out of scope.

**Memory recall** (`--kind near-miss`, run unconditionally by the developer before build): empty
block — nothing to surface, nothing honoured or departed from.

### Verification evidence

- **`@executable` suite green — 20 run / 0 failed** (`test/app-routes.test.mjs`, re-run at verify
  under `AOF_GLOBAL_HOME="$(mktemp -d)"`, focused files only). 20 scenarios ↔ 20 test entries; QA's
  coverage audit cross-checked **all 226 quoted literals** across the three features' Examples
  tables — 0 absent, no Then weakened. *verifies →* `stories/01_story_route-model/tasks/00…02`.
- **Fitness functions**: `acd-route-logic-framework-free` **5/5 green** (was 5 RED at refine);
  `acd-ui-single-route-table` route-module half green, entry half **red as expected** (story 03's
  gate); `acd-test-suite-registration` 2/2 green (suite registered the house way).
- **Non-vacuity proven twice, independently**: the developer's 3 reverted mutations, then QA's 6
  (first-mode-only strip, known-list rebuild, slash-greedy normalise, unconditional `?`, rescue-to-
  landing, unfrozen table) — every one went red in the suite, and the two the features name by hand
  (the loop guard and drop-by-default) failed with the exact predicted diagnostic.
- **Adversarial probe beyond the rows** (QA): ~90 pathnames / 35 searches / 13 hashes / 16 part
  shapes — 0 throws, 0 misroutes vs the HEAD oracle (`main.tsx:1261-1266`), 0 dropped non-`mode`
  parameters, 0 altered fragments; the 7 oracle divergences are all the one declared meaning change
  (bare `/` with no `mode` → landing), pinned by feature 01 scenario 5.

### Findings (all closed at review)

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| F-45-01-D (= architect blocker) | suite read `mesh-ui-serve.mjs` source and regex-froze the board-url body ADR-002 promises stays additive for m46 | defect (test) | blocker | fix: assertion deleted; the Then is discharged by construction (story edits no producer) + existing live-HTTP coverage | **fixed** |
| F-45-01-E | `routeFor("//")` → landing — unpinned boundary between two contract rows | design-gap | nit | PO ruling: `//` is not the landing; guard added, feature row pinned | **fixed** |
| F-45-01-G | hash without leading `#` returned verbatim (`/board18` if composed by hand) | design-gap | nit | carried to 45/03: the entry must pass `location`-shaped parts | **routed** |
| F-45-01-I | two `?mode=` producers absent from the features' cited lists (`Board.tsx:416`, `DetailPanel.tsx:270`) | doc | nit | carried to 45/04 (already named by the fitness function) | **routed** |
| architect nits 3–5 | stale `:NNN` labels in suite; id-set gate lives in story suite (move to fitness at m47); two search builders (decided fork, ADR-006) | craft / observation | nit | labels fixed; the rest recorded for m47 | **fixed / recorded** |

### Accept decision

**ACCEPTED 2026-08-07.** Validate gate PASS (`aof work validate 45/01`). All `@executable` green, no
open blocker. `STORY.md` → `done`.

## 45/02 · One static-serving leaf — verified 2026-08-07, ACCEPTED

Lanes in scope: **`@executable`** only (all three tasks are `@executable @cli @board @distribution`,
LITMUS = real HTTP against started servers). No `@manual`, no `@uat`, no rendered surface.

**Memory recall** (`--kind near-miss`): empty block — nothing to surface.

### Verification evidence

- **`@executable` suite green — 23 run / 0 failed** (`test/static-serve-fallback.test.mjs`, re-run at
  verify; real `serveBoard`/`serveSetupUi`/`serveMeshUi` on ephemeral ports; marker file planted
  outside the served root). 23 scenarios ↔ 23 entries, all 79 feature path cells present verbatim.
  *verifies →* `stories/02_story_static-serve-history-fallback/tasks/00…02`.
- **Fitness functions**: `acd-spa-fallback-never-masks` **7/7 green** (was 5 RED at refine) — one
  shared module, both servers import all three helpers, `safeStaticPath`/`contentType` each defined
  exactly once in `src/`, guard-before-fallback pinned against the real handler on the four measured
  traversal encodings.
- **The narrowing confirmed by independent probe** (QA): fleet `/assets/index-missing.js` → 404 coded
  envelope (was 200 HTML); `/fleet` deep-link and `/` still 200 shell; `index.html` unlinked under a
  live server → 404 on all three origins, never a blank 200; assets keep serving.
- **Adversarial probe** (QA): ~429 real responses — 0 bytes from outside the root via any URL shape,
  0 five-hundreds, 0 refused traversals answered with the shell, 0 extensioned misses answered with
  the shell; status uniform across origins with each origin's own envelope, as pinned.
- **Regression sweep**: setup-ui 10, board-serve 4, mesh-ui-serve 8, board-api 22,
  mesh-ui-global-scope 10 — all green; `git diff --stat -- test/` empty of edits to existing suites
  (the features' "the narrowing breaks nothing" claim held as measured).
- **Graph grounding** (architect): fresh rebuild (15,730 nodes / 21,472 edges); `static-serve.mjs`
  ← exactly {`mesh-ui-serve.mjs`, `setup-ui.mjs`}, → nothing — the pure-leaf claim confirmed by
  edges, not only by regex.

### Findings

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| F-1 (architect + QA, convergent, independent) | the traversal guard is lexical: an inside-root symlink pointing outside is admitted and followed (not client-reachable; identical to both pre-move copies — the story mandated a verbatim move) | design-gap | should-fix | routed to **TECH_DEBT item 23** (fix shape: `fs.realpath` containment; needs its own ADR-004 amendment + pinned rows) | **routed** |
| F-2 (QA) | `//api/*` parsed protocol-relative → API guard dodged → answered with the HTML shell (the masking class this story removes, one layer up) | defect | should-fix | PO ruling: fixed at review — both servers collapse leading slashes before parsing; rows pinned in task 01's feature + suite (and the suite's `get()` helper taught to send `//` targets verbatim) | **fixed** |
| F-3 | `/%00` → 200 shell (decodes dot-free; the feature's Thens — no 5xx, no leak, still serving — all hold; architect ruled a control-char refusal belongs in the guard via TECH_DEBT 23, never as a predicate special case) | design-gap | nit | folded into TECH_DEBT 23 | **routed** |
| F-4 | feature exclusion note claimed a platform split the shipped predicate removed (`/%2e%2e%5cpackage` is a platform-uniform 404) | doc | nit | note corrected in the feature | **fixed** |
| F-5 | non-GET methods answered with the shell (pre-existing; widened on board/config) | design-gap | nit | backlog — a later `405` is a deliberate decision | **recorded** |
| F-3 (arch. nit) | `aof assets ui` starts `serveSetupUi` with no `uiRoot` → its API port serves the vite source dir with fallback | observation | nit | carried to 45/04 (that launcher's URL moves to `/config` there) | **routed** |

### Accept decision

**ACCEPTED 2026-08-07.** Validate gate PASS (`aof work validate 45/02`). All `@executable` green, no
open blocker (the one should-fix not fixed in-story — the symlink guard — is TECH_DEBT item 23 with
its reachability assessed as not-client-reachable). `STORY.md` → `done`.

## 45/03 · The shell and the entry rewrite — verified 2026-08-07, PENDING `@uat`

Lanes in scope: **`@executable`** (tasks 00–03) + **`@uat`** (task 04, the human visual review — the
one open gate). No `@manual`. Design conformance ran at build (below), so the human gate arrives
pre-evidenced.

**Memory recall** (`--kind near-miss`): empty block — nothing to surface.

### Verification evidence

- **`@executable` suites green — 46 lanes / 0 failed** (`test/shell-{entry-plan,regions,navigation,
  not-found-and-fullscreen}.test.mjs`; 34 lanes at build + 12 added by review findings). Coverage:
  85/85 Examples rows; both reviewers audited row-by-row. Driven through the house react-app-harness
  (real production `.tsx` over mini-react), including a **real-composition lane** (`<Fleet/>` inside
  the real `<Shell/>`, one bundle, one bus).
- **Fitness functions**: `acd-ui-single-route-table` **4/5** (the 5th is 45/04's producer lane, by
  design); `acd-shell-z-ladder-single-home` **3/3** (was 1/3); `acd-shell-bus-single-host` **4/4**
  (NEW, written at review — the bus's single-host assumption ratcheted); `acd-ui-surface-file-budget`
  **4/4** (config/App.tsx capped at 1,300); `acd-rendered-component-fed-by-route` **4/4** (was 3/4 —
  see finding B1); `acd-mesh-ui-scope-visible` 3/3; `acd-route-logic-framework-free` 5/5; app-routes
  20/20; neighbours 99/99 with zero harness edits. `npm --prefix ui run build` green.
- **Non-vacuity**: 20 reviewer/developer mutations, every one caught by a named lane (incl. the
  ladder-sharing, push-instead-of-replace, rescue-to-landing, stale-dismisser, and budget-model
  mutations).
- **The split verified as a MOVE**: `git diff HEAD:ui/src/main.tsx ↔ ui/src/config/App.tsx` is clean
  — imports/export/`<main>`→`<div>`/4× `min-h-screen`→published-primitive only; not one view
  touched. Entry is 60 lines; `ROUTES`-driven nav; legacy rewrite applied exactly once as
  `replaceState` (now driven through a spy-history seam).
- **[Build-1] verified against the real effect**: fullscreen ADOPTS a live DOM node (re-parent into a
  dedicated React-childless host, same object returned home on dismiss, keyed on occupantId, layout
  tick on both transitions) — m46 is unblocked; the socket-alive pin stays m46's.
- **Design conformance (designer, over 20 real renders at 390/768/1280/760×520)**: **GAPS → one
  fixed, one carried.** Chrome CONFORMS region-by-region at every judged width (nav drops incl. the
  390 disclosure, slot moves to R3, 88px budget, one active item, none on not-found, chip never
  blank, no truncation, no horizontal scroll). GAP-2 (landing/not-found cards top-anchored,
  shrink-wrapped) **fixed** — shared wrapper, both-axis centring, `max-w-md`, re-rendered and
  confirmed. GAP-1 (the config editor's sidebar repeats the shell's brand/identity) **carried as
  DG-45-3** by PO ruling — SPEC's "config editor views untouched" boundary holds in m45; DESIGN.md
  records the gap, its fix shape and close condition; task 04 gained a row so the human meets it as
  recorded, not new. NOT-JUDGED (named): the board-origin `serverGone` rail at 768/390 (the one
  missing render — needs a dying board server staged), skip-link focus state, the 390 disclosure
  open, shell loading/error states, R5 occupants.

### Findings

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| B1 (architect) | `acd-rendered-component-fed-by-route` blinded by 45/02's `//api/*` line comment — the suite's block-first comment stripper ate 39k chars (a green-turned-red missed at 45/02's own verify) | defect (test infra) | blocker (branch) | stripper reordered line-first + non-vacuity assertion added; the 23-suite class-wide hazard measured and recorded as **TECH_DEBT item 24** | **fixed** |
| QA F-45-03-B | a stale fullscreen dismisser evicted the CURRENT occupant (m46's exact failure mode) | defect | should-fix | dismiss now carries its occupant id; non-current no-op; feature row pinned | **fixed** |
| QA F-45-03-A | copy-and-delete re-spells surviving parameters (`a%20b`→`a+b`, `debug`→`debug=`) vs the feature's "never re-encoded" | contract wording | should-fix | PO ruling: ADR-006 [Amigos-3] reading (decoded-pairs, order, count); feature amended, three re-spelling rows pinned explicitly | **fixed** |
| QA F-45-03-C | UNKNOWN nav availability announced `aria-disabled` with no title (pessimistic answer AT users only) | design-gap / a11y | should-fix | PO ruling: `aria-disabled` reserved for UNAVAILABLE; UNKNOWN gets the not-yet-known title; feature pinned | **fixed** |
| QA F-45-03-D/E/F/G/H/L | five coverage holes proven by mutation (private budget model; undriven history wiring; undriven return-home/ticks; unasserted verdicts; undriven identity-unknown; undriven Escape/claimed-Escape) | coverage | should-fix/nit | real seams exported (`navBudgetFor`, `applyEntryPlan`), document stub added to the harness, 12 lanes added — all now mutation-caught | **fixed** |
| architect F3/F4 + nits | bar-height two homes; unknown-route-id blank render; adoption insert-ordering; rail via querySelector; `unchanged()` alloc; stale comments | defect/craft | should-fix/nit | all applied (single-home classes, `surfaceMountFor` loudness, dedicated host div, ref, identity-stable reducer, comments corrected) | **fixed** |
| architect F7 | ADR-005's "document never scrolls" false for `content:page` as the locked feature requires | doc (ADR) | should-fix | **[Build-6]** folded in — struck through in place, two modes spelled out | **fixed** |
| QA F-45-03-K | not-found "verbatim" ambiguous (pathname vs full address) | contract wording | nit | PO ruling: FULL address (pathname+query+fragment); built + exact assertion | **fixed** |
| QA F-45-03-I | notice rail's "first line pinned" clause unbuilt | design-gap | nit | built (sticky first element child, with the stated CSS limit); reads-right verdict stays task 04's | **fixed** |
| dev (composition lane) | `Fleet.tsx`'s inline `onRefresh` is one refactor from an infinite update loop — production survives only via the entry's referentially-stable element | latent risk | nit | routed to **m46's brief** (m46 reworks these files; fix is a one-line `useCallback`) — recorded in STATE | **routed** |
| designer GAP-1 | brand/identity duplicated on `/config` (shell bar + `<App>` sidebar) | design-gap | should-fix | **carried as DG-45-3** (PO: not closed in m45; fix shape + close condition recorded in DESIGN.md; task 04 row added) | **carried** |

### Verdict

Automated + agent lanes **PASS**; validate gate **PASS** (`aof work validate 45/03`). **NOT accepted
yet** — task 04's `@uat` human visual review is open (the milestone's one designed human gate).
Twenty current renders for it are at the session scratchpad `renders/` dir
(`{landing,fleet,board,config,notfound}-{390,768,1280,desktop}.png`, post-fix); the `serverGone`
rail renders remain to be staged during the session. `STORY.md` stays `in-review`.
