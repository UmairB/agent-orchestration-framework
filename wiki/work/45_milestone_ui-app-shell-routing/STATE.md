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
- **Deferred, not fixed — `Fleet.tsx:1398`'s local-board drill-in dead-ends.** `href="/?mode=board"` is
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

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green — 5 registered, **18 red / 3 green** at refine, red for the right
      reasons: `acd-ui-single-route-table`, `acd-no-surface-mode-url-literal`,
      `acd-spa-fallback-never-masks`, `acd-route-logic-framework-free`,
      `acd-shell-z-ladder-single-home`. Satisfiability was proven by throwaway prototype and reverted;
      `src/` and `ui/` are unchanged by this refine.
- [ ] `@manual` signed off — see `UAT.md`
- [ ] `@uat` — `stories/03_story_app-shell-and-entry/tasks/04_app-shell-visual-review.feature`, judged
      against `mocks/app-shell.png` (pending) or `DESIGN.md`'s binding checklist, at 1280 / 768 / 390
      plus the desktop app's 760×520 window, on all four routes and an unmatched path.

## Feedback (for retro)

- 45/01 review (2026-08-07): a locked feature's Then can smuggle a cross-story coupling into a leaf
  story. Feature 02 scenario 5's last Then ("board-url's response SHAPE is untouched by any of this")
  is a claim about a producer this story does not edit, inside a feature whose own LITMUS is
  "returned values only" — the developer discharged it the only way it literally reads (a source
  read), which froze the exact body m46 must extend and coupled 45/01's suite to the file 45/02 was
  editing concurrently. Refine lesson: a Then asserting "something else did not change" belongs in
  the suite that owns the something else, or in the feature header as a non-goal — never as a Then.
  — Raised by: architect + QA, convergent
- 45/01 review (2026-08-07): `aof graph impact`'s remediation advice loops on this machine — when
  `aof graph build .` answers `graphify-missing`, impact still prints "rebuild with `aof graph
  build .`", which is unachievable; it should say `aof project provision graphify`. (The NOT-COVERED
  labelling itself worked and prevented a false no-coupling read.) — Raised by: architect
- Carried to 45/03: `legacyRedirectFor` tolerates a search missing its leading `?` but not a hash
  missing its `#` (returns it verbatim; a caller composing `${pathname}${search}${hash}` from
  hand-built parts gets `/board18`). Real `location.hash` always carries `#`; the entry must pass
  `location`-shaped parts, not hand-composed ones. — Raised by: QA (F-45-01-G)
- Carried to 45/04: two `?mode=` producers are absent from the features' cited lists but named by
  `acd-no-surface-mode-url-literal` — `Board.tsx:416` and `DetailPanel.tsx:270`. The producer
  rewrite must include them. — Raised by: QA (F-45-01-I)
- 45/02 review (2026-08-07): a refine-time quantitative prediction went into the record unverified —
  ARCHITECTURE's "net line-negative in `src/`" justified the 109th root module; measured: +134 total
  / +9 code lines (the leaf carries 73 lines of house narration). Justify a module on coupling, not
  a line forecast — or scope the forecast to code lines. — Raised by: architect
- 45/02 review (2026-08-07): "we chose not to pin this" still deserves a row documenting the
  resulting value — the deliberately-unpinned control-char status let `/%00` move from 404 to
  200-shell unobserved, and the next reviewer re-derived it from scratch. — Raised by: architect + QA
- 45/02 review (2026-08-07): a test helper can silently re-route the very input a row exists to
  probe — `new URL("//x", base)` in the suite's `get()` resolved protocol-relative and sent the
  request to host "api", so the double-slash row tested a stranger's server. When a row probes a
  parser edge, the harness must be checked against the same edge. — Raised by: orchestrator
- Carried to 45/04 (QA F-3 of 45/02): `aof assets ui` starts `serveSetupUi` with no `uiRoot`, so its
  API port now serves the vite SOURCE dir's index.html with SPA fallback — worth a line when 45/04
  moves that launcher's advertised URL to `/config`.

- Refine trap, hit at m45 ARCHITECTURE authoring (2026-08-06): running `aof graph build .` under AOF_GLOBAL_HOME=$(mktemp -d) — the repo's own hook-enforced test-isolation idiom — returns the structured { code: "graphify-missing" } miss, because the managed tool store lives under the global home. An isolated home makes an INSTALLED graphify indistinguishable from an absent one, and the codebase-grounding step's documented response to that miss is 'proceed on grep-and-infer'. So an agent that correctly follows the test-isolation rule silently loses the graph. Two fixes worth considering: (a) the graphify tool-store resolution should not be scoped by AOF_GLOBAL_HOME, or (b) the graphify-missing envelope should say WHICH store it looked in, so the miss is diagnosable rather than just believable. Workaround used: re-run without the isolated home (graph build is read-only over src and writes only graphify-out/). — Raised by: architect
