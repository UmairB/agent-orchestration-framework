---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 45 · UI app shell & path routing — State

## Progress

**Framed 2026-08-02** (`aof:shatter wiki/planning/PRD-web-ui-restructure.md`).

**Refined 2026-08-06** (`aof:refine 45 --autonomous`) — Decide + Break-down + all four Contracts.

- [x] Decide — `ARCHITECTURE.md` (6 ADRs, 5 fitness functions), `DESIGN.md` (2 surfaces). No
      `RESEARCH.md`: the milestone had no blocking unknown, and spike 44 had already settled the one
      adjacent question (the terminal origin boundary).
- [x] stories — broken down into four, listed in `SPEC.md`
- [x] contracts — 14 task `.feature` files authored across all four stories; `aof work validate 45`
      PASS
- [~] build — in progress (`aof:continue 45`, autonomous cascade, started 2026-08-07 on branch
      `feat/45-ui-app-shell-routing`). Stories 01+02 fanned out in parallel (disjoint trees, as the
      seam analysis promised). **01 route-model: built, reviewed, validate PASS** — 20/20 behavioural
      green, `acd-route-logic-framework-free` 5/5 green, route-half of `acd-ui-single-route-table`
      green (entry-half correctly red for 03). Architect: module CONFORMS on all four ADRs; one
      blocker found IN THE SUITE (a source-read regex over `mesh-ui-serve.mjs` that froze the
      board-url body ADR-002 promises stays additive for m46) — removed. QA: PASS, 6/6 mutations
      caught, all 226 feature literals covered; `//` boundary pinned by PO ruling (`//` → not-found,
      row added to feature 00). **02 static-serve: built** — 23/23 real-HTTP green,
      `acd-spa-fallback-never-masks` 7/7 green, 14 neighbour suites green, fleet-fallback narrowing
      broke no existing test (measured); **reviewed, validate PASS**. Architect: PASS, ADR-004
      conformance verified at every branch incl. catch paths; the guard's symlink-following (a
      verbatim-move constraint, not a regression) routed to TECH_DEBT item 23. QA: PASS — ~429
      adversarial responses, 0 leaks/5xx; one should-fix confirmed and FIXED at review: a `//api/*`
      request target parses as protocol-relative, dodging the API guard and answering HTML — both
      servers now collapse leading slashes before parsing (rows added to task 01's feature + suite;
      the suite's own `get()` helper needed the same lesson, sending `//` targets verbatim via
      pathname assignment). Neighbour suites re-run green (setup-ui 10, board-serve 4, mesh-ui-serve
      8, board-api 22, mesh-ui-global-scope 10); `acd-spa-fallback-never-masks` 7/7.
      **03 app-shell-and-entry: built, reviewed, validate PASS — parked at the `@uat` gate**
      (2026-08-07, attempt 2 of 3; attempt 1 was killed by an account session limit before any work —
      run-store lineage carries the `runtime_offline` failure and resume). The main.tsx split verified
      as a clean move (1,267 → 60-line entry; `<App>` → `ui/src/config/App.tsx`); shell + nav +
      landing landed in `ui/src/app/` (TECH_DEBT 18a's layer now real); 46 behavioural lanes green;
      z-ladder ratchet armed 3/3; NEW `acd-shell-bus-single-host` 4/4. Architect PASS (its one
      branch blocker was 45/02's `//api/*` comment blinding a fitness function's naive stripper —
      fixed, class-wide hazard = TECH_DEBT item 24); QA PASS (0 blockers; its mutation sweep drove 12
      new lanes); designer GAPS → landing-card centring FIXED, config-sidebar brand duplication
      CARRIED as DG-45-3 (PO: SPEC's config-editor boundary holds in m45). ADR-005 gained [Build-6]
      (content:page's document-scroll truth). **Carried to m46's brief:** `Fleet.tsx`'s inline
      `onRefresh` is one refactor from an infinite update loop (one-line `useCallback`; production
      survives only via the entry's referentially-stable element — the composition lane documents it).
      **Operator ruling (2026-08-07): all verification is deferred to the end** — 45/03's `@uat`
      visual review and the milestone acceptance run together after 45/04 lands. 45/04's build starts
      on the operator's explicit instruction with 45/03 built-and-validated but not yet accepted; the
      `@uat` gate is deferred, never skipped.
      **04 advertised-entry-points: built, reviewed, validate PASS** (2026-08-07). All seven
      producers migrated (board/fleet/assets servers + probes, board-url page URL, supervisor.rs
      constant, three in-app links — Fleet's deliberately still relative, F-45-04-1); the
      `${fleetUrl}&scope=` glue trap fixed via URL.searchParams (mutation-verified); the two target
      fitness functions green — and `acd-no-surface-mode-url-literal` STRENGTHENED at review
      (architect F1: the "no fifth producer unseen" name now has a closed route-path-vocabulary body,
      4/4, shrink-only exemptions). New suites 7/7 + 5/5; five behavioural suites moved to parsed-URL
      assertions; QA's independent e2e proved every advertised address renders the shell on its own
      origin, the board-url round trip carries `#ref` through story-refs, and old/new addresses
      CONVERGE through `legacyRedirectFor`. The pre-existing `work-ui-verb-rename` red (m42 usage
      drift) repaired with its reason stated. Rust rebuild correctly deferred to the Windows deploy
      loop (`--desktop`); until then the tray opens the legacy URL, which keeps working by ADR-003.
      Task 02's `@manual` census runs at the end gate. Findings routed: BoardsRegion permanently
      empty since m34 (+ the drill-in dead-end) → recorded in m47/STATE as the receiving side.

**End gate run 2026-08-07 (`aof:verify 45`) — BLOCKED, not accepted.** Regression sweep green (165
behavioural + 41 fitness, focused imports under an isolated global home); `aof work validate 45`
PASS. 45/04's `@manual` census walked in a real browser over CDP against the LIVE fleet daemon and
real `serveBoard`/`serveSetupUi` origins: **all 8 legacy rows pass** — canonical address bar, no
`mode=` at any point, `#34/01` intact, rewritten exactly once as a replace, Back never returns to the
legacy form, reload stable. Bare `/` renders the shell landing on both the fleet and board origins,
retiring `supervisor.rs`'s blank-page warning. The tray's compiled constant is verified in the
shipped binary (`/fleet?scope=global`, no `mode=`); the `--desktop` rebuild had already landed.
**Two things the gate found.** (a) **The UI was never deployed** — `ui/dist` was still the 00:09:59
bundle from before 45/03's commit, so the live daemon served pre-m45 code throughout 45/04's build
and review; the census caught it on its first row because it reads the rendered tree. Redeployed at
verify (no restart needed: `dist` resolves once at start, files are read per request). (b) **F-45-M-1,
a blocker**: `/config` on the FLEET origin renders a totally blank page — `<App>`'s `/api/config`
404s there, `payload.resources` is `undefined`, a `useMemo` calls `.filter` on it, and with no error
boundary the throw unmounts the whole tree, shell and nav included. 14 of 15 measured (origin × path)
cells render the shell; this is the one that does not, it is one click from the fleet's own nav, and
it contradicts `Shell.tsx:91-94`'s own promise that such a surface "degrades through its OWN existing
error state" — which `/board` on the same origin honours. The crashing line is byte-identical to its
pre-split original, so the DOOR is m45's, not `<App>`'s: routed to a new `@bug` task
`45/03/05_surface-crash-degrades-in-shell.feature` (`@finding-F-45-M-1`) → `aof:continue 45/03`. The
fix is at the shell boundary and enters the `failed` state `contentStateFor`/`SurfaceFailed` already
render.

**F-45-M-1 FIXED INLINE 2026-08-08** (operator instruction), in the two halves the finding had. (a)
The **designed path**: `App.tsx`'s loader was the only `fetch` in that file not testing
`response.ok`, and the one that runs on mount — the rule moved to a framework-free leaf
`ui/src/config/config-load.mjs` (`loadScope` + `isConfigPayload`, a POSITIVE definition of "this is
a config" so unanticipated shapes are refused too), and a failed load is now a state rather than a
poisoned payload. (b) The **safety net**: `SurfaceBoundary` in `Shell.tsx` — a class, because
`getDerivedStateFromError` has no hook form — wraps the mounted surface only, keyed by route, and
renders the `SurfaceFailed` state the shell already had but nothing could reach from a runtime
throw. Two extractions the `acd-ui-surface-file-budget` ratchet demanded and was right to demand
(`config-load.mjs` + `ConfigLoadFailed.tsx`; `App.tsx` ends at 1,297/1,300, comments moved rather
than trimmed). **`mini-react` grew class + error-boundary support** (additive, `isReactComponent`-
keyed) — without it a boundary was undrivable headlessly, which is exactly why the `Shell.tsx`
contract could sit reviewed and false for one surface in four. Re-verified: **171 behavioural + 49
fitness lanes green**, 6 new containment lanes MUTATION-PROVEN (remove the boundary → all 5 render
lanes go red with the throw propagating), and the live three-origin matrix is **15/15 cells
rendering the shell, 0 exceptions** (was 14/15). All 8 legacy census rows still pass; all 16 renders
carry the shell; chrome still exactly 88px `at-budget` at 760×520.

**Design conformance run 2026-08-08 — verdict GAPS, none blocking.** The ADR-001 hand-off, twice: 34
renders across three real origins at four breakpoints, judged by `aof-designer` against DESIGN's binding
checklists (the mock still has not landed). Round 1 returned INCONCLUSIVE on its own render gate — the
gate working: `/config` had never been rendered on an origin that actually serves it, so the fourth
surface had never been seen mounted in the shell. Produced, and the verdict resolved. **The `serverGone`
rail is now MEASURED** (49px at 768, 65px at 390, against ~48/~64 estimated — right to a pixel), driven
through the board's own `⟳ sync`; DESIGN's estimate table is replaced. Two gaps FIXED at the gate: GAP-1
(the `/config` failure state named two APIs adjacently, the wrong one first) and **GAP-4** — the identity
chip's `min-w-[7ch]` is a *border*-box minimum, so it reserved 4.26 characters of text, not 7, and the nav
moved 4.828px between origins; two `shell-regions` lanes existed over exactly this and passed throughout
because they asserted the class string instead of the invariant. Fixed from one shared constant, verified
in the browser (chip 64.172px, nav at 173.375px on all three origins). Two gaps CARRIED with fix shapes
and close conditions: **DG-45-4** (`/board`- and `/config`-on-fleet render one condition in two visual
languages) and **DG-45-5** (the cross-origin honesty rule has no producer — nothing passes `resolvable`,
so every nav item is a live link on every origin; recorded at the rule itself, and owned by m47). DG-45-3
recorded and now evidenced for the first time; fullscreen deferred to m46, which owns its only caller.

**Still parked: 45/03's `@uat` human visual review and 45/04's tray click** — the milestone's one designed
human gate and the one producer no lane can read.

**Story order.** `01` and `02` are parallel-eligible from day one and share nothing. `03` depends on
`01`; `04` depends on `03`. The one cross-story rule, from the architect's seam analysis: everything
in `ui/` waits on the route module, and nothing in `src/` waits on anything.

**Grounding done at refine.** The codebase graph was built fresh over the project root
(2026-08-06T09:59:13.842Z, 15,644 nodes / 21,352 edges, `egress: none`) and `graph impact` read back
per candidate boundary. Its `.mjs` answers were reliable and are cited in `SPEC.md` and story `02`.
Its `.tsx` coverage is **partial** — `ui/src/main.tsx` reports only self-edges though it demonstrably
imports `Fleet`/`Board`/`App` — so every `ui/` boundary was drawn by reading source, and the graph's
silence there was treated as unknown, never as absence. Memory recall (both the PO's domain-keyed call
and the architect's `--area architecture` call) returned an **empty block** — nothing to surface,
proceeded unchanged.

## Notes & decisions in flight

- **The PRD's "both servers 404" claim is half-wrong** (measured 2026-08-02). The fleet server already
  falls back to `index.html` ([mesh-ui-serve.mjs:563-567](../../../src/mesh-ui-serve.mjs#L563-L567)).
  Only `setup-ui.mjs`'s `safeStaticPath` lacks the fallback — and that one handler backs both the board
  and the config editor, since `board-serve.mjs` delegates to `serveSetupUi`. Scope corrected in SPEC.
  **Refined further at Decide:** the fleet's fallback is *unconditional*, so that origin masks every
  missing asset today. ADR-004 puts both origins behind one predicate, which makes story `02` a
  deliberate **narrowing** of live fleet behaviour, not only an addition.
- **"Three pages" was four** (measured 2026-08-06). `?mode=assets` — produced by `aof assets ui` — falls
  through the ternary's `else` to `<App>` exactly as no-mode does. It is a real entry point and gets a
  real path. SPEC corrected; the route table is four paths.
- **Default decisions taken at refine** (autonomous; each documented in the ADR that owns it, each
  reversible, none a product call): a hand-rolled route table over `react-router-dom` (ADR-001, with the
  overturn condition stated); `/config` as the config editor's path and `/assets` **forbidden** as a
  route because it is the bundle's own asset directory (ADR-002); an unknown path renders the 404
  surface **in place** rather than redirecting (ADR-002); the extension-less discriminator for the
  history fallback (ADR-004, with `Accept:` and a route-derived allowlist rejected for stated reasons);
  the scope control staying inside `<Fleet>` with the shell providing a slot (DESIGN).
- **PO rulings made during the Three Amigos pass** (recorded in ADR-002): a trailing slash is **matched
  in place** (`/fleet/` → `/fleet`, no rewrite — a tolerant matcher, not a redirect, so ADR-002's
  no-redirect rule is untouched); paths are **case-sensitive**, lowercase canonical.
- **Two required refactors, both found by measuring rather than assuming**, each folded into the story
  that already edits those lines: `ui/src/main.tsx` (1,267 lines, entry *and* config-editor surface)
  splits in `03`; and `safeStaticPath` — the directory-traversal guard — is defined **twice,
  byte-identically** across the two servers and folds into `src/static-serve.mjs` in `02`.
- **A second duplicated helper, already drifted** (found by QA, ADR-004 [Amigos-4]): `contentType` is
  also defined twice, and unlike `safeStaticPath` the copies have diverged — the fleet copy knows
  `.json`/`.svg`, the board/config copy answers `application/octet-stream`. Latent only because the
  built bundle is `index.html` plus hashed `.js`/`.css`; live the first `.svg` the build emits. Folded
  into the same move, and the merged table is the **union**, never the intersection.
- **The traversal guard runs BEFORE the fallback predicate, unconditionally** (ADR-004 [Amigos-2]).
  Several traversal encodings end in an extension-less segment, so a handler that routed a *refused*
  path into `shouldServeAppShell` would answer `200 text/html` to an attempted escape. Measured, now
  pinned in the fitness function both as a predicate property and against the real `serveSetupUi`.

- **F-45-01-C swept into the contract at build start (2026-08-07, inline PO).** The Three Amigos
  ruling above (trailing slash matched in place) was recorded in ADR-002 [Amigos-6] and here, but
  task `45/01/00`'s trailing-slash row still pinned the overturned exact-match default and still
  carried the "PO to confirm" flag. Reconciled before build: the `/fleet/` row moved out of the
  unknown-path table into its own scenario (`/fleet/`→`fleet`, `/board/`→`board`, `/config/`→`config`,
  matched in place, no rewrite), and a `/fleet//` row pins the ruling's "single slash only" boundary.
  A contract-doc sweep that misses the feature files leaves the build gated on the overturned text —
  worth a retro line.

## Open — carried into build

- **The two unanswered developer-seat questions were settled at build start (2026-08-07), as this
  section asked.** (a) The `main.tsx` split IS genuinely mechanical: the file has no `export` at all,
  nothing imports it, and lines 1-1259 travel as one unit — with three cautions for story 03:
  `import "./index.css"` must STAY in the entry (moving it with `<App>` kills all Tailwind everywhere);
  the shell component must land in `ui/src/app/` (the arch test forbids `main.tsx` defining `Shell`);
  and `<App>`'s `min-h-screen` root (~:232) is the one line a pure move still touches under the shell's
  bounded box. (b) ADR-005 as written does NOT yet give m46 what it needs — five gaps, measured against
  the live TerminalDock/FleetTerminalView code: **(1, blocking)** "present a node" never promises the
  occupant's instance/DOM identity survives present/dismiss — both existing terminal overlays exist
  precisely to keep one xterm + one socket alive (re-parenting the live host / hidden-not-unmounted),
  and a portal that re-renders would dispose the PTY; the contract needs an identity-preservation
  clause plus a post-present layout tick (both implementations defer a re-fit one frame). **(2)** the
  shell owning `Escape` collides with an interactive occupant — m46's terminal forwards stdin and `Esc`
  is a live keystroke for the `claude` TUI; the contract needs an occupant-may-claim-Escape clause.
  **(3)** the dock has no named region home (ladder reserves `z-30`; DESIGN says R5 out-of-flow in two
  places and "in-flow/docked" in one; today it is an in-flow flex child hoisted so route/view changes
  cannot unmount it — under a shell, `content`-parented dies on navigation, `overlay`-parented
  survives). **(4)** ADR-005 says three named regions, DESIGN and story 03's features say five (R1-R5)
  — m46 cannot import a name with two candidate sets. **(5)** `--aof-shell-chrome-height` is DESIGN's
  primitive but ADR-005 demotes the CSS mechanism to a story default — m46's drag-resize clamp
  (`window.innerHeight/2`, wrong by the chrome height) needs it contractual. Routed to the architect to
  fold into ADR-005 (same-refine drafting, nothing shipped) before story 03 builds `shell-layout.mjs`.

- **ADR-005 amended at build start ([Build-1..5], 2026-08-07)** — the five gaps above are folded in;
  contract list is now eight points; fitness function unchanged (re-run: 2 RED / 1 green, the
  expected pre-03 state). Two rulings landed with it: **the ladder collision** (feature
  `45/03/01`'s Then listed six rung names incl. `content`; the committed arch test pins exactly
  {10,20,30,40,50}) — PO ruled the test is the contract, `content` is the ladder's FLOOR (z auto,
  never a ladder value); feature amended in place. And **`DESIGN.md:240`'s "in-flow/docked" wording**
  contradicts DESIGN's own R5 rows and ADR-005 [Build-3]'s overlay ruling — routed to the designer to
  amend during story 03's conformance pass, not silently edited. ARCHITECTURE's fitness table was
  also re-counted (said "Four … 16 red, 2 green" after [Amigos-5] had added a fifth; now five / 18
  red / 3 green, matching this file).

- **The shell mock has not landed.** The operator elected to supply `mocks/app-shell.png`; `DESIGN.md`
  names it the conformance source of truth marked **PENDING**, and its binding checklist is the interim
  baseline, superseded by the mock wherever the two differ. The `@uat` task judges against whichever is
  current at review time. **Risk `DESIGN.md` flags:** if the mock shows a **dark** shell that is outside
  this milestone's ramp and comes back as its own design gap with its own token work — not absorbed
  silently. There is a scenario for exactly that.
- **The "no React test harness" premise is stale, and it cost story 03 nine scenario clauses.** QA
  downgraded them to `@uat` on that premise; verified at refine, `test/support/react-app-harness.mjs`
  esbuild-bundles the **real, unmodified** production `.tsx`, mounts it over `mini-react.mjs` against a
  real running face on a controllable clock, and its own header argues *against* pure-helper-only
  testing ("a state satisfied by calling the reducer directly proved nothing, because production could
  never drive it"). `board-app-harness.mjs` / `fleet-app-harness.mjs` wrap the two real surfaces.
  **Carry into build:** re-examine story 03's `@uat` downgrades and story 04's task 01 against the
  harness — several may return to `@executable`. Note it deliberately stubs the board's `TerminalDock`
  and the fleet's xterm view as unmountable leaves, which bounds what it can reach. The PRD and ADR-001
  both restate the stale premise; ADR-001's *conclusion* still holds on its own merits (a four-route
  flat table does not need a router library), but the premise should be corrected rather than repeated.
- **The developer seat of the Three Amigos did not complete.** All four feasibility agents were
  terminated mid-run by an account rate limit, not by anything in the work. Two of their highest-value
  questions were answered inline instead and are recorded here (the harness, above; the `&` trap,
  below); the rest — chiefly whether the `main.tsx` split is genuinely mechanical, and whether ADR-005's
  fullscreen mechanism gives milestone 46 what it needs — are **unanswered**, and should be settled at
  the start of build rather than discovered inside it.
- **One concatenation trap, confirmed and bounded.** `src/commands/mesh-ui.mjs:106` composes its
  announce as `` `${fleetUrl}&scope=${scope}` `` — the `&` hard-coded on the assumption `fleetUrl`
  already carries a query. Change `fleetUrl` to a path and that untouched line yields
  `/fleet&scope=global`, a pathname with **no** `scope` parameter, which a naive `includes("scope=")`
  assertion accepts. Swept at refine: `assets-ui.mjs:48` and `work-ui.mjs:52` interpolate cleanly, so
  this is the **only** instance. Story `04`'s scenarios read `new URL(...).searchParams.get("scope")`
  rather than a substring, precisely to catch it.
- **F-45-04-1 · Deferred, not fixed — `Fleet.tsx:1398`'s local-board drill-in dead-ends.** `href="/?mode=board"` is
  *relative*, so from the fleet origin it resolves to `:4181`, which deliberately 404s `/api/work`
  ([mesh-ui-serve.mjs:541-543](../../../src/mesh-ui-serve.mjs#L541-L543)) — the board surface loads but
  cannot load its stream. The component's own comment at `:1373-1380` claims it navigates out to its own
  `aof work ui`; a relative href does not do that. **Out of scope for 45/04** — a URL migration that also
  changes where a link goes is two changes in one unreviewable diff. Story `04` pins the relative form on
  purpose. **Routed to milestone 47**, which becomes the fleet surface's owner; the likely fix is the
  `/api/mesh/board-url` route the peer-board branch already uses.
- **Two design gaps opened and owned by story 03** — DG-45-1 (fleet and board paint *different* brand
  marks in the same bar position; the shell paints one) and DG-45-2 (`z-50` currently means four
  unrelated things; the shell owns a named ladder). DG-45-2 is ratcheted by
  `acd-shell-z-ladder-single-home` so 46/47/49 cannot silently reopen it — 49 being precisely the
  milestone that puts a surface fullscreen. `FleetTerminalView.tsx:412` is a **named, shrink-only
  exemption** in that test, retiring with milestone 46, which deletes the file.
- **The notice rail vs the chrome budget**, settled in `DESIGN.md` at refine: the 88px cap counts the two
  **bars** only; the notice rail is not a bar and is exempt, additive and bounded (one notice, ≤25% of
  viewport height). The reasoning is stated rather than left emergent — while the rail is standing there
  is no work to act on, so the ≥432px content floor is not what is being defended in that state.

## Verification

Settled at the end gate, 2026-08-08 — see `VERIFICATION.md` for the evidence and `OUTCOME.md` for
what the milestone now delivers.

- [x] `@executable` suite green — **173 lanes / 0 failed** at accept
- [x] Fitness functions green — **45 lanes / 0 failed** across twelve gates (5 registered at refine,
      18 red / 3 green then; all green now, plus `acd-shell-bus-single-host` written at 45/03's review)
- [x] `@manual` — 45/04 task 02's back-compat census, walked in a real browser: all 8 legacy rows
- [x] `@uat` — 45/03 task 04, RUN rather than delegated: the thesis measured against the pre-milestone
      build at `b9052ff`, scroll ownership, the keyboard pass, motion, and the tray chain

## Accepted — 2026-08-08

`SPEC.md` → `done`, all four stories `done`. Two defects were found at the end gate and fixed there
(`F-45-M-1`, the blank `/config`; `GAP-5`, the top bar scrolling out of view), plus two design gaps
fixed at the conformance pass. Three gaps are carried with fix shapes and close conditions —
**DG-45-3** (the config sidebar's duplicate identity), **DG-45-4** (the origin-mismatch state's two
visual languages) and **DG-45-5** (the cross-origin honesty rule with no producer) — the last two owned
by milestone 47, which becomes the fleet surface's owner and ships the origin probe both need.

### Compaction

The blow-by-blow above is the milestone's narrative and is left intact; the two sections that had
graduated are gone rather than duplicated:

- **`## Feedback (for retro)`** — its ~20 running notes were triaged and distilled into
  **`RETROSPECTIVE.md`** (12 lessons, `R1`–`R12`), then folded into memory via `aof work memory ingest`
  (483 records reindexed) so they are recallable at milestone 46's refine. The section is archived
  here rather than carried: its lessons have graduated, exactly as durable decisions graduate into ADRs.
- **The refine-time verification checklist** — replaced above by the settled result.

### Durable decisions, and where they now live

Nothing is graduated into a new ADR: every durable decision this milestone took already has an ADR that
owns it (ADR-001 the hand-rolled table, ADR-002 the four paths and origin-blind routing, ADR-003 the
client-side legacy translation, ADR-004 the one static-serving leaf, ADR-005 the shell regions and the
fullscreen door with its five `[Build-N]` amendments, ADR-006 the shell's parameter-blindness). Three
decisions taken at the end gate were folded into the document that owns them rather than into a new ADR:

- the identity chip's width rule, restated in `DESIGN.md` §R2 as an **invariant** rather than a utility
  class (R3);
- DESIGN GAP D1's page-level clamp, now `overflow-x: clip` on `html` and `body`, with the reason
  recorded in `index.css` at the declaration (R4);
- the shell root's overflow, moved out of a hand-typed class and into
  `contentModeFor.rootEstablishesScrollport`, which answers it per content mode (R4).

### Carried into milestone 46

- `Fleet.tsx`'s inline `onRefresh` is one refactor from an infinite update loop — a one-line
  `useCallback`; production survives only via the entry's referentially-stable element.
- `shell:fullscreen` is built and unexercised: nothing in `ui/src/` calls `requestFullscreen`, so m46's
  terminal is its first caller and its `@uat` scenario belongs to m46's gate.
- TECH_DEBT items 23 (the lexical traversal guard) and 24 (the comment-stripper hazard across 23
  arch-test suites) were opened by this milestone's reviews.
