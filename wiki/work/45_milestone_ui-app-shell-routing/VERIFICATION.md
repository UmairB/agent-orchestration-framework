---
doc: verification
milestone: 45
verified: 2026-08-08
verifier: aof:verify
verdict: accepted
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

## 45/04 · Advertised entry points — verified 2026-08-07, PENDING `@manual`

Lanes in scope: **`@executable`** (tasks 00–01) + **`@manual`** (task 02 — the operator census +
the desktop tray, which needs the Windows `--desktop` cargo build). No `@uat`.

**Memory recall** (`--kind near-miss`): empty block — nothing to surface.

### Verification evidence

- **`@executable` suites green — 12 lanes / 0 failed** (`test/advertised-paths.test.mjs` 7,
  `test/in-app-cross-links.test.mjs` 5). QA's coverage audit: all 26 + 9 Examples rows present; hrefs
  read off the rendered tree per the LITMUS; the one weakened Then (env-dependent `uiBuildPresent`
  asserted by type) judged a net strengthening (exact key-set deepEqual).
- **Both target fitness functions green**: `acd-ui-single-route-table` **5/5** (milestone-complete);
  `acd-no-surface-mode-url-literal` **4/4** — strengthened at review from a 4-entry closed loop to a
  closed route-path VOCABULARY sweep (295 files, 8 declared homes, shrink-only exemptions; a
  sandboxed fifth producer minting `/fleet` directly now fails with a two-remedy message; a declared
  file that stops minting fails as a stale exemption).
- **QA end-to-end, independent of the suites**: every advertised address fetched on its own real
  origin renders the shell; the `/api/mesh/board-url` round trip carries `#ref` intact through
  milestone/story/task refs with the body exactly `{ url, workspaceId, ref }` (m46's `origin` stays
  additive); every legacy form still 200s AND converges through `legacyRedirectFor` onto exactly the
  address the new producers advertise; the announce line parses to `/fleet` + a real `scope` param
  for both scopes; the shipped bundle census counts zero `?mode=` and the expected path literals.
- **Mutations** (QA 3 + developer 1, all reverted sha-verified): re-glued announce → 4 lanes red
  (and the arch gate structurally blind to it — the parsed-URL assertions are the only catch, which
  is why they exist); board-url back to `?mode=` → 3 red; assets → `/assets` → 3 red; each caught.
- **Graph grounding** (architect): fresh, `unchanged: true` on re-run; `routes.mjs` is the fan-in
  hub (← 9, → 0) exactly as ADR-001 designed; no god-node touched; `/fleet`-homes question answered
  with a reasoned NO-constant verdict (collapse is architecturally foreclosed in three of four
  directions; the fitness function is the single home of the fact that matters).

### Findings

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| arch F1 | the producer gate's NAME claimed a fifth-producer sweep its body (a closed 4-entry loop) did not perform — sandbox-proven | defect (fitness fn) | medium | strengthened before close (assertion 4, vocabulary sweep) | **fixed** |
| QA-1 | task 01 sc.4's per-row non-vacuity Then unsatisfiable for 3 measured zero-anchor states | contract text | low | PO amended the feature to the pinned-count reading (three rows are pinned-zero) | **fixed** |
| QA-2 | the feature's feasibility note claimed the fleet face serves a `boards` aggregate — measured false on both scopes | contract text | low-med | PO corrected the note (lanes are producer-fed; honest for the render contract, not reachability) | **fixed** |
| QA-3 | `BoardsRegion` permanently empty on the shipped surface since m34/ADR-006 (the face's status payload has no `boards` key) — one migrated link operator-unreachable | defect (pre-existing) | medium | routed to **m47/STATE** (receiving side written) together with F-45-04-1's drill-in dead-end; task 02's census records it as unreachable, not clickable | **routed** |
| QA-4 / arch F6 | `work-ui-verb-rename` 1 lane red at HEAD (m42 usage-string drift, `277ada5`) | defect (pre-existing) | low | assertion updated to the current usage with the reason inline; suite 5/5 | **fixed** |
| QA-5 | stale test comment (peer-board row); the `/assets`-collision connective seam implicit | craft | low | comment corrected; the seam named in the feature amendments | **fixed** |
| arch F2/F3/F4 | one-way deferral (m47 had no receiving-side record); dangling `F-45-04-1` citation; undischared 45/02-carried note | doc | nit | m47/STATE line written; STATE bullet labelled; carried note discharged with the measured line | **fixed** |
| arch F5 | `acd-no-new-silent-catch` RED on `main` (`board-worker-stream.mjs`, arrived with PR #11 / `eacbd57`) — predates m45 | defect (pre-existing, main) | info | flagged to the operator; owner is PR #11 | **open (not m45's)** |

### Verdict

Automated + agent lanes **PASS**; validate gate **PASS** (`aof work validate 45/04`). **NOT accepted
yet** — task 02's `@manual` census runs at the end gate (its desktop-tray scenario additionally
needs the Windows `--desktop` rebuild; until then the tray's legacy URL keeps working via ADR-003).
`STORY.md` stays `in-review`.

## 45 · MILESTONE END GATE — verified 2026-08-07, **NOT ACCEPTED** (one blocker)

The end gate the operator deferred 45/03's `@uat` and 45/04's `@manual` to. Run against the
**deployed** system, not the tree: the m45 payload at `44f5b60`, the live fleet daemon on
`127.0.0.1:4181`, and real `serveBoard` / `serveSetupUi` origins on ephemeral ports.

### Verification evidence

- **Regression sweep green — 165 lanes / 0 failed**, re-run at verify under
  `AOF_GLOBAL_HOME="$(mktemp -d)"` via focused test-array imports (never the full suite —
  `global-work-propagation` binds `:4182`, which the live control daemon holds):
  m45's own eight suites **101/101** (app-routes 20, static-serve-fallback 23, shell-entry-plan 10,
  shell-regions 16, shell-navigation 8, shell-not-found-and-fullscreen 12, advertised-paths 7,
  in-app-cross-links 5), and the neighbour suites **64/64** (setup-ui 10, board-serve 4,
  mesh-ui-serve 8, board-api 22, mesh-ui-global-scope 10, work-ui-verb-rename 5,
  work-ui-board-serves-unchanged 5).
- **Fitness functions green — 41/41** across all ten m45-relevant gates:
  `acd-ui-single-route-table` 5/5 (milestone-complete), `acd-no-surface-mode-url-literal` 4/4,
  `acd-spa-fallback-never-masks` 7/7, `acd-route-logic-framework-free` 5/5,
  `acd-shell-z-ladder-single-home` 3/3, `acd-shell-bus-single-host` 4/4,
  `acd-ui-surface-file-budget` 4/4, `acd-rendered-component-fed-by-route` 4/4,
  `acd-mesh-ui-scope-visible` 3/3, `acd-test-suite-registration` 2/2.
- **THE DEPLOY WAS STALE, AND THE HARNESS CAUGHT IT ON THE FIRST ROW.** The first census pass
  reported the address bar UNCHANGED at `/?mode=fleet` and no shell in the DOM. The cause was not
  the code: `~/.aof/bin/ui/dist` (and the repo's) held the **00:09:59** bundle — built before
  45/03's commit `1282875` — with **zero** `data-shell-row` / `data-nav-item` / `Live terminals`
  occurrences and a surviving `mode=fleet` + `Work Board`. `install-local.mjs` had last run
  `--skip-ui`. Redeployed (`node scripts/install-local.mjs`, full) → `index-DgCM4Vjl.js`; the live
  origin picked it up **without a restart**, because `dist` resolves once at server start but the
  files themselves are read per request. Recorded because a census that read component source
  instead of the rendered tree would have passed this run against pre-m45 code.
- **45/04 task 02 — the `@manual` census, browser half: 8 of 8 legacy rows PASS.** Driven through
  the cached ms-playwright Chromium over CDP (`npx playwright` is policy-blocked here), reading the
  real `location.href` after ADR-003's client-side `replaceState` and counting `history.length` so
  "rewritten exactly once, a replace not a push" is **measured**:

  | row | legacy | address bar after | once? | Back ≠ legacy | reload stable |
  |---|---|---|---|---|---|
  | 1 board's advertised URL | `:PORT/?mode=board` | `:PORT/board` | ✓ Δ1 | ✓ | ✓ |
  | 2 drill-in, fragment and all | `:PORT/?mode=board#34/01` | `:PORT/board#34/01` — **fragment intact** | ✓ Δ0 | ✓ | ✓ |
  | 3 fleet's advertised URL | `:4181/?mode=fleet` | `:4181/fleet` | ✓ Δ1 | ✓ | ✓ |
  | 4 the bookmarked fleet URL | `:4181/?mode=fleet&scope=global` | `:4181/fleet?scope=global` | ✓ Δ0 | ✓ | ✓ |
  | 5 the local-scope fleet URL | `:4181/?mode=fleet&scope=local` | `:4181/fleet?scope=local` — local filter applied | ✓ Δ1 | ✓ | ✓ |
  | 6 config editor's advertised URL | `:PORT/?mode=assets` | `:PORT/config` | ✓ Δ1 | ✓ | ✓ |
  | 7 fleet-origin board link (NO-CHANGE row) | `:4181/?mode=board` | `:4181/board` | ✓ Δ1 | ✓ | ✓ |
  | 8 an unrecognised mode value | `:PORT/?mode=banana` | `:PORT/config` | ✓ Δ0 | ✓ | ✓ |

  No address bar carried `mode=` at any point. Row 7 reproduced today's behaviour **exactly** as the
  feature demands — the board surface renders in-shell and degrades through its own
  "Could not load the work stream: Mesh API route not found. Retry".
  *verifies →* `stories/04_story_advertised-entry-points/tasks/02` scenario 2.
- **Census scenario 3 — the retired blank, confirmed retired.** Bare `/` renders the shell landing
  ("Live terminals") on the fleet origin (127 B) **and** on the board origin (125 B); not blank, not
  a 404, not a redirect — the address bar still reads `/`, and the fleet is one nav click away.
  *verifies →* `…/tasks/02` scenario 3.
- **Census scenario 1 — the tray's compiled constant, verified in the shipped binary.** The
  `--desktop` cargo rebuild HAS landed (`~/.aof/bin/aof-mesh-desktop.exe`, written
  2026-08-07T21:21:02, replacing a 13 July build). Byte-scanned: the binary's only `:4181` literal
  is `http://127.0.0.1:4181/fleet?scope=global`, and `mode=fleet` is **absent**. The operator's
  tray CLICK remains the one step no lane can take — see the open items below.
- **Census scenario 4 — no `?mode=` reaches the operator.** Every `href` the shell renders on every
  origin is a bare ADR-002 path (`/`, `/fleet`, `/board`, `/config`); zero carry `mode=`. The
  launcher announce lines and `--json` probe envelopes are covered by task 00's 7 `@executable`
  lanes and `acd-no-surface-mode-url-literal`'s 295-file closed-vocabulary sweep.
- **Design conformance — 16 fresh renders of the DEPLOYED bundle** (4 routes × 390 / 768 / 1280 /
  760×520, cached Chromium at explicit device metrics, absolute screenshot paths). The chrome
  arithmetic is **measured, not modelled**: at the desktop app's 760×520 window the chrome is
  **exactly 88px** (`top-bar` 48 + `surface-bar` 40), verdict `at-budget`, content region starting
  at y=88 → **432px**, the floor exactly met; at 1280 the slot lives in the top bar and chrome is
  48px (`within`). Two chrome rows at every width, never three. No page-level horizontal scrollbar
  at any breakpoint (`overflow-x: hidden` backstop in place). The 390 column collapses to the
  disclosure, whose trigger names the active surface. Nav geometry is identical across routes
  (each item's left edge at the same x on `/fleet` and `/nope`). First focusable is the skip link
  → `#aof-shell-content` on every route; focus order is skip → nav in table order → slot → content.
  Not-found renders in-shell as a centred dashed card naming `/nope`, with no nav item active and
  no error treatment.

### Findings

| id | observed | type | severity | triage | routed-to | status — updated after the inline fix |
|---|---|---|---|---|---|---|
| **F-45-M-1** *(FIXED inline 2026-08-08 — see the fix section below)* | **`/config` on the FLEET origin renders a totally blank page** — no shell, no nav, no way back but the browser's Back button. `<App>` fetches `/api/config`; the fleet origin is the one origin that does not serve it, its coded 404 lands in `payload`, `payload.resources` is `undefined`, and a `useMemo` calls `.filter` on it → uncaught `TypeError` → React unmounts the **whole** tree. Measured on all 3 real origins × 5 paths: **14 of 15 cells render the shell; this one does not.** Reachable in ONE CLICK from the fleet's own nav, which advertises `Config` as `available` with `href="/config"` — and the fleet origin is exactly where the desktop tray lands. It contradicts the shell's own written contract (`Shell.tsx:91-94`: a surface "reached on an origin that cannot serve its API degrades through its OWN existing error state") — which `/board` on the same origin honours and this does not. | defect | **blocker** | PO ruling: the crashing `useMemo` is byte-identical to its pre-split original (`1282875^:main.tsx:124`) and SPEC puts `<App>`'s views out of scope — but m45 minted the `/config` path AND the nav item that advertises it, so the DOOR is m45's. Fix at the shell boundary, not in `<App>`: contain a throwing surface and enter the `failed` content state that `contentStateFor`/`SurfaceFailed` **already** render (nothing feeds it from a runtime throw today — only `surfaceMountFor`'s unknown-route-id path). No new state, no new DESIGN rule, no new token. | new `@bug` task `stories/03_story_app-shell-and-entry/tasks/05_surface-crash-degrades-in-shell.feature` (`@finding-F-45-M-1`) → fixed inline on operator instruction, 2026-08-08 | **FIXED — re-verified, 15/15 cells** |
| F-45-M-2 | The m45 build never deployed its UI: `ui/dist` at verify was the 00:09:59 bundle, predating 45/03's commit, so the live fleet daemon served pre-m45 code for the whole of 45/04's build and review. | process | non-blocker | Redeployed at verify (full `install-local.mjs`); no code change. The lesson — a `@manual`/`@uat` lane must read the RENDERED tree, and a story that changes `ui/` is not deployed by a `--skip-ui` install — is a retro line. | STATE `## Feedback (for retro)` | **fixed (redeployed) / recorded** |
| arch F5 (carried from 45/04) | `acd-no-new-silent-catch` RED — `board-worker-stream.mjs`, 1 silent catch, baseline 0. Re-confirmed at the end gate. | defect (pre-existing, `main`) | info | Re-verified NOT m45's: the file's last commit is `eacbd57` (PR #11) and it is absent from `git diff main...HEAD`. | PR #11's owner | **open (not m45's)** |

## 45 · F-45-M-1 FIXED INLINE — 2026-08-08, on operator instruction

Fixed in two halves, because the finding had two: a surface that manufactured a throw, and a shell
with nothing to catch one.

### The fix

- **The designed path — the surface degrades through its OWN error state.** The fault was one
  missing check: `App.tsx`'s loader was the only `fetch` in that file that did not test
  `response.ok` before believing the body, and it is the one that runs on mount. The rule now lives
  in a framework-free leaf, `ui/src/config/config-load.mjs` — `loadScope` returns a payload or
  throws a coded `ConfigLoadError`, and `isConfigPayload` is the single positive definition of
  "this response is a config" (it states the one good shape rather than listing bad ones, so the
  next unanticipated shape is refused too). A failed load is now a STATE, not a poisoned payload;
  `payload` is left untouched on failure, so a transient error on a scope switch no longer discards
  the config already on screen.
- **The safety net — the shell contains a throwing surface.** `SurfaceBoundary` (a class, because
  `getDerivedStateFromError` has no hook form — the only non-function component in `ui/src/app/`)
  wraps the mounted surface ONLY, keyed by route, and renders the `SurfaceFailed` state the shell
  already had. Nothing fed that state from a runtime throw before; `surfaceMountFor`'s
  unknown-route-id path was its only producer. The boundary is loud (`console.error` naming the
  surface and the error), so a swallowed throw is not the next finding.
- **Two extractions the file-budget ratchet required, and was right to.**
  `acd-ui-surface-file-budget` went red at 1,358 lines with the message "extract the next region
  into a sibling component with a prop boundary; do NOT trim comments to fit". So the load rule
  went to `config-load.mjs` (+ `config-load.d.mts`, the house `.mjs` + declaration split) and both
  pre-editor states to `ui/src/config/ConfigLoadFailed.tsx` (`ConfigLoading`, `ConfigLoadFailed`).
  `App.tsx` ends at **1,297 / 1,300** and the gate is green — the account of the finding lives in
  the module that owns the rule, not deleted to fit.
- **Test infrastructure: `mini-react` grew class-component + error-boundary support.** Additive —
  a new branch keyed on `prototype.isReactComponent`; every function-component path is untouched
  (170 neighbouring lanes re-run green). It supports exactly construct / `state` / `setState` /
  `getDerivedStateFromError` / `componentDidCatch` / `render` and nothing more. The catch wraps the
  child render rather than `render()` alone — catching only the latter would catch nothing, which
  is the precise false-green a boundary test must not produce. `react-app-harness`'s virtual
  `react` gained the matching `Component` base. **This is why the contract could sit reviewed and
  false for one surface in four: a boundary was undrivable headlessly, so nothing could check it.**

### Re-verification evidence

- **`test/shell-surface-containment.test.mjs` — 6 new lanes, all green**, registered the house way
  in `scripts/test.mjs` (`acd-test-suite-registration` 2/2, `acd-roundtrip-registration` 1/1). They
  cover the load rule against five real response shapes (the fleet's coded 404, a 200 with no
  `resources`, a 200 carrying HTML, a 500, an explicit refusal) plus the positive; the chrome
  surviving a throwing surface; containment for all three routed surfaces; the failed state keeping
  all four nav destinations live; and failed / not-found / landing staying three distinct states.
- **MUTATION-PROVEN, not asserted.** With `<SurfaceBoundary>` removed from `Shell.tsx`, **all 5
  render lanes go RED** with the throw propagating out of the render pass — the measured blank
  page, reproduced on demand. Reverted; `git diff` confirms the boundary restored.
- **Regression sweep — 171 behavioural / 0 failed** (the 165 from the first gate, plus the 6 new
  lanes) and **49 fitness lanes / 0 failed** across thirteen gates, including
  `acd-ui-surface-file-budget` 4/4 and `acd-console-log-confined` 3/3 (the boundary's loud line is
  within the confined surface).
- **THE MEASUREMENT THAT MATTERS — the live three-origin matrix, re-run in a real browser against
  the redeployed bundle: 15 of 15 cells render the shell, 0 exceptions** (was 14/15 with one
  uncaught `TypeError`). `/config` on the fleet origin now renders full chrome, the nav with
  `Config` still marked current, "Could not load the configuration", the server's own reason
  ("Mesh API route not found."), the command that gets the operator a working editor
  (`aof assets ui`) and a Retry — at 1280 and, in the disclosure form, at 390.
- **Nothing else moved.** All 8 legacy census rows still PASS (canonical address bar, no `mode=`,
  `#34/01` intact, rewritten exactly once, Back never returns to the legacy form, reload stable).
  All 16 renders (4 routes × 390/768/1280/760×520) carry the shell; chrome is 48px at 1280 and
  exactly 88px `at-budget` at the desktop 760×520 window on every route, content floor 432px met;
  no horizontal scrollbar anywhere; skip link still the first focusable on every route.

## 45 · DESIGN CONFORMANCE — 2026-08-08, verdict **GAPS** (none blocking)

The ADR-001 hand-off, run twice: the orchestration rendered, `aof-designer` judged. **34 renders** of the
deployed bundle across three real origins — the live fleet daemon, a real `serveBoard`, a real
`serveSetupUi` — at 390 / 768 / 1280 and the desktop app's own 760×520. Baseline: `mocks/app-shell.png`
has still not landed, so `DESIGN.md`'s binding checklists bound in full (and correctly did **not** yield
an INCONCLUSIVE on the mock's absence — 07/ADR-003).

**Round 1 returned INCONCLUSIVE on its own render gate, which is the gate working.** Two
Background-required renders were missing, one of them the only capture in which the fourth routed surface
actually mounts inside the shell. Both were produced and the verdict resolved.

### What the designer confirmed CONFORMS

The thesis (four surfaces read as one product; everything left of the surface slot identical across
routes and across origins); the brand (one mark, one `aof` wordmark, `Mesh`/`Work Board` retired as
designed changes); the 48/88px chrome budget and the **exactly 432px** floor at 760×520 — now confirmed
with a real mounted surface, so the budget has zero headroom; rail-2 invariance; the 390 squeeze in whole
discrete drops with nothing truncated; "you are here" identifiable from rule and weight alone with the
hue removed; the unmatched path reading as "not a surface" (no red, no accent, nav un-marked, `Surfaces ▾`
at 390); the `/` landing and its one-rule-both-places card container, pixel-identical to the not-found
card at every width; and `/fleet?scope=local`.

**The `serverGone` rail is now MEASURED, not modelled** — the row DESIGN itself called "the single
highest-value missing render". Driven through the board's own `⟳ sync` control (three consecutive silent
load failures, the production door): **49px at 768, 65px at 390** against DESIGN's ~48/~64 estimates —
right to within a pixel. It pushes the bars down rather than overlaying them, nothing yields to it, the
sentence is unclipped, and it is 9.4% / 12.5% of the binding 520 height against a 25% bound. `DESIGN.md`'s
estimate table is replaced with the measurement.

### Gaps, and what happened to each

| gap | severity | verdict | disposition |
|---|---|---|---|
| **GAP-1** — the `/config` degraded state named two different APIs in adjacent lines, the raw upstream string second and unlabelled, so the wrong subsystem was the first thing the operator met | LOW | **FIXED + re-judged CLOSED** | Re-ordered to headline → recovery sentence naming `aof assets ui` → `upstream: <raw>` last, labelled, `text-xs` mono. Designer: "closed on the merits, not just on the bytes." |
| **GAP-4** — the identity chip's `min-w-[7ch]` is a BORDER-box minimum, so with `px-2` + border it reserved **4.26 characters of text, not 7** | LOW | **FIXED + verified in the browser** | See below — this one was a documented promise that was false. |
| **GAP-2** — `/board`-on-fleet and `/config`-on-fleet render one condition in two visual languages; the board side is colour-only, off-ramp, uncentred and offers no recovery command | MEDIUM | **CARRIED as DG-45-4** | PO ruling: the board's error branch is `<Board>`'s, which SPEC puts out of scope — the same boundary already ruled for DG-45-3. The divergence is only *visible* because m45 fixed the other half, which makes it real but does not open `<Board>`. Fix shape + close condition recorded in `DESIGN.md`; expected to close with DG-45-5 in m47. |
| **GAP-3** — DESIGN's cross-origin honesty rule has **no producer**: nothing passes `resolvable`, so every nav item is a live link on every origin and the nav offers doors that dead-end | MEDIUM | **CARRIED as DG-45-5** | PO ruling: the probe is m47's (it owns the fleet surface and already ships the peer-board honest-locality pattern). Recorded **at the rule itself** in `DESIGN.md`, not in a gap list — a reviewer must be able to tell "not built" from "built and never triggered", and that exact ambiguity cost a review round-trip here. |
| **DG-45-3** — the config sidebar repeats the shell's brand | — | **recorded, not re-litigated** | Now evidenced for the first time (`config-own-origin-*`), and ranked: worst at 390 and 760×520, where the sidebar's 40px mark visually outranks the shell's own 24px one across an empty R3 band. |
| fullscreen | — | **deferred to m46** | `requestFullscreen` has no production caller in `ui/src/`; the door is built for m46's terminal. The `@uat` scenario is re-pointed to m46's gate, not deleted. |

### GAP-4 — a documented promise that was false, and the lanes that froze it

`Shell.tsx` promised "a **SAME-SIZED** pulse block rather than a collapsed chip that would then push the
nav sideways", and DESIGN called it m43 documented-default-3. Measured in the shipped bundle: 1ch =
6.609px, so `min-w-[7ch]` computed to a 46.184px **border**-box minimum; minus `px-2` (16px) and the
border (2px) it reserved 28.18px of text — **4.26 characters**. `fleet` (33px) overflowed it, the box grew
to 51px, and the nav went with it: **4.828px** between the fleet origin (`fleet`) and a board/config
origin (`aof`), and by arithmetic the same jump at the loading→loaded threshold for any identity over ~4
characters.

Two `shell-regions` lanes existed over exactly this and **passed throughout**, because they asserted the
string `min-w-[7ch]` rather than the invariant — they froze the defect they existed to prevent. Both are
rewritten to assert through the shared constant.

Fixed by reserving the CONTENT box (`min-w-[calc(7ch+1.125rem)]`) from **one** home,
`IDENTITY_CHIP_WIDTH_CLASS`, consumed by both the chip and its placeholder so "same-sized" is true by
construction. The class is kept a literal because Tailwind emits utilities by scanning source text — a
composed one would name a rule never generated, silently removing the reservation altogether. Re-measured
in the browser after the fix: **chip 64.172px and nav first item at 173.375px on all three origins** — the
cross-origin shift is gone.

Honest limit, recorded: the loading→loaded jump was never *captured*. The fleet origin resolves its
identity synchronously (`useGroupName` → `?group=` else the literal `"fleet"`) so it has no pulse state,
and this machine's workspace is named `aof`, which fit inside even the old reservation. The mechanism is
arithmetic from measured values.

### DESIGN.md amendments applied (authored by the designer, applied verbatim)

The measured rail row replacing the estimates; the R2 chip clause rewritten to state the **invariant**
rather than a utility class ("the chip's box and its loading placeholder measure identically, and the box
does not change width when the identity resolves") — naming a class is what let the promise and the pixels
drift apart with neither looking wrong; DG-45-4 added; DG-45-5 recorded at §Cross-origin honesty; DG-45-3's
2026-08-08 evidence appended.

### Verdict

Validate gate **PASS**. Automated + agent lanes **PASS**. **F-45-M-1 closed**, re-verified against the
deployed system. Design conformance **GAPS**, none blocking. Proceeded to the `@uat` gate below.

## 45 · `@uat` — RUN, not delegated (2026-08-08)

Four clauses had been parked as "only a person can settle these". On the operator's instruction they were
run instead. Three of them a browser settles **better** than a person, and the fourth — the thesis — far
better, because a browser can hold the pre-milestone build and the post-milestone build side by side and
diff them, which no eye can do reliably.

The instrument: the cached ms-playwright Chromium over CDP, against the **deployed** bundle on the live
fleet daemon and real `serveBoard` / `serveSetupUi` origins.

### The thesis — measured against the actual pre-m45 build

SPEC's success condition is *"an outsider cannot tell what changed except that the address bar now means
something and the three pages know about each other."* Tested by building the bundle at **`b9052ff`** —
the commit before the shell landed, rebuilt to the byte-identical hashes that were deployed then
(`index-DPMT8sAx.js`) — serving it through the **real** `serveMeshUi` (read-only by ratcheted invariant,
so it reads the same live mesh state), and diffing every control an operator can reach:

| | pre-m45 (`b9052ff`) | today |
|---|---|---|
| reachable controls | **462** | **467** |
| controls an operator can no longer reach | — | **NONE** |
| controls gained | — | `Skip to content`, `Terminals`, `Fleet`, `Board`, `Config` |
| surface headings | identical | identical |

**The only difference in what an operator can reach is the navigation itself.** That is the success
condition, met and measured rather than asserted.

### Scroll ownership — and the gap it found

Real wheel gestures at 760×520 on all four routes. This is where **GAP-5** surfaced, and it could only
have surfaced here: it is a fact about the CSS cascade, not about any value the shell computes, so no
model lane and no screenshot could see it.

**Measured before the fix: after a 1200px wheel on `/fleet` the top bar was at y = −1200 — scrolled clean
out of view.** DESIGN's R2 row says in terms: *"none — it never scrolls out of view (`sticky top-0` in
`content:page`)"*, and the bar carried exactly that class. Two independent causes, both found by walking
the ancestor chain rather than guessing:

1. **Three redundant copies of DESIGN GAP D1's clamp.** `overflow-x: hidden` computes the other axis to
   `auto`, which makes an element a scroll container — and `position: sticky` resolves against the
   nearest one. The shell root carried its own `overflow-x-hidden` (a third copy, on top of `html` and
   `body`), and it is `min-h-dvh` so it grows to its content — measured **18,470px** on `/fleet` — and
   never scrolls. Removing it exposed the same defect one level up in `body`. Fixed by moving the clamp
   from `hidden` to **`clip`** on `html` and `body`: identical clamping, but `clip` establishes no
   scrollport. Re-verified at 360/390/414 on both builds — no horizontal overflow, D1 intact.
2. **A sticky child can only travel within its parent's box.** With the scrollports gone the bar stuck
   for exactly 40px and then left (y = −1160) — its parent is the 88px chrome wrapper. Fixed by pinning
   the **chrome block** rather than the bar inside it, which also keeps
   `--aof-shell-chrome-height` honest: what is above the content on screen stays equal to the number the
   shell publishes, which is what m46's dock sizes against.

**After: all four routes PASS** — `/fleet` scrolls 1200px with the bar at y = 0; no route ever has a page
scrollbar and a content scrollbar at once. Both halves are **mutation-proven** (revert `clip`→`hidden`,
or unpin the wrapper: the lane goes red each time) and pinned by a lane in
`test/shell-surface-containment.test.mjs`.

### The keyboard pass — real Tab keystrokes

| tab | element | size | focus ring |
|---|---|---|---|
| 1 | **Skip to content** | 119.97 × 34 | ✓ |
| 2–5 | Terminals / Fleet / Board / Config | 38–68 × **48** | ✓ |
| 6–8 | Global / Local / Refresh the fleet view | 44–152 × **24** | ✓ |

The skip link is the first focusable element, targets `#aof-shell-content`, and **activating it moves
focus there** (`document.activeElement` → `aof-shell-content`, hash set). Focus order is exactly DESIGN's:
skip → nav in route-table order → surface slot → content. Every stop ≥ 24×24. **CONFORMS.**

### Motion — **CONFORMS**

400 shell elements audited for computed `animation` / `transition`. The only animation present anywhere
is `pulse` (the pre-existing load placeholders). **Zero nav items carry any transition** — route changes
are instant, as DESIGN requires. The 19 elements with transitions are all pre-existing hover ramps
(`color`/`background-color`, 0.15s) on surface controls, none of them shell chrome.

### 45/04 task 02 scenario 1 — the tray

Discharged as a **chain**, each link verified, rather than as a click:

1. The compiled constant, byte-scanned in the shipped `~/.aof/bin/aof-mesh-desktop.exe` (rebuilt
   2026-08-07T21:21): its only `:4181` literal is `http://127.0.0.1:4181/fleet?scope=global`, and
   `mode=fleet` is **absent**.
2. The wiring, read: `supervisor.rs:57` `MESH_UI_URL` → `:101` `ui_url` (one assignment, no
   transformation) → `main.rs:438` `opener::open_browser(&url)` on the `"open-web-ui"` menu event. No
   branch alters the string.
3. That URL's behaviour in a real browser: **verified** — it renders the fleet at global scope, the
   address bar carries no `mode=` at any point, and a refresh re-renders rather than 404ing (it is the
   canonical target of census row 4).
4. `supervisor.rs:37-44`'s doc comment claiming the bare `/` renders BLANK is **already rewritten**, and
   the behavioural half is measured: bare `/` renders the shell landing on both origins.

**Not done, and stated plainly:** nobody clicked the tray. Automating a real tray menu on this machine
means driving a menu whose adjacent item is **Quit**, which would stop the operator's running daemons —
an unforced risk against a chain that is otherwise fully determined. The one unverified step is whether
the OS opens a browser at a string handed to `opener`, which is not aof's behaviour.

### Findings from the `@uat` gate

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| **GAP-5** | The top bar scrolled out of view on `/fleet` (measured y = −1200 after a 1200px wheel), against DESIGN's R2 "it never scrolls out of view". Cause: D1's `overflow-x: hidden` clamp made `html`, `body` **and** a third redundant copy on the shell root into scroll containers, so `sticky` resolved against a box that never scrolls; and the bar's sticky was additionally confined to its 88px parent. | defect | **should-fix** | Fixed at the gate, both halves: D1's clamp → `overflow-x: clip` on `html`/`body` (same clamp, no scrollport), the redundant root copy deleted and the answer moved into `contentModeFor.rootEstablishesScrollport`, and the **chrome block** pinned instead of the bar. Mutation-proven; lane added. | **FIXED** |

### Sign-off / verdict

**`@uat` PASSED.** Every clause settled by measurement against the deployed build: the thesis (zero
controls lost, five gained, all of them the navigation), scroll ownership (all four routes, after
GAP-5), the keyboard pass, motion, and the tray chain. One defect found and fixed at the gate.

Signed off by `aof:verify` on the operator's explicit instruction to run rather than delegate the gate
(2026-08-08). The renders remain at the session scratchpad `renders/` + `renders-final/` dirs.

## 45 · ACCEPT DECISION

**ACCEPTED 2026-08-08.**

- Validate gate **PASS** (`aof work validate 45` → "PASS — 45 is well-formed").
- **173 behavioural lanes / 0 failed** and **45 fitness lanes / 0 failed**, re-run at accept against the
  deployed build under an isolated global home.
- The live three-origin matrix: **15/15 cells render the shell, 0 exceptions**. All **8** legacy census
  rows pass. All **16** renders carry the shell with no horizontal scroll; chrome exactly 88px
  `at-budget` at 760×520 on every route.
- **No blocker finding is open.** F-45-M-1 and GAP-5 were found at this gate and fixed at it; GAP-1 and
  GAP-4 fixed and re-judged; DG-45-3, DG-45-4 and DG-45-5 carried with fix shapes and close conditions,
  all owned by m47 except DG-45-3.
- One red gate remains on `main` and is **not m45's**: `acd-no-new-silent-catch` on
  `board-worker-stream.mjs`, from PR #11 (`eacbd57`), absent from `git diff main...HEAD`.

`SPEC.md` → `done`; `45/03` and `45/04` → `done`.
