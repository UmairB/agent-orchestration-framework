---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 45 · UI app shell & path routing — Architecture Decisions

> Inputs: `SPEC.md` (three query-selected roots become one application behind real URL paths and a
> shared shell; no new product behaviour; every surface reachable today stays reachable; the SPA
> history fallback lands on `setup-ui.mjs`, which backs BOTH the board and the config origins; legacy
> `?mode=` keeps working; `?scope=` survives untouched), `STATE.md` (one DECIDED entry — the PRD's
> "both servers 404" claim is half-wrong: the fleet server already falls back, only `setup-ui.mjs`
> does not; scope corrected). No `DESIGN.md` / `RESEARCH.md` exists for this milestone; the measured
> ground truth below was taken directly from source at `eacbd57` (2026-08-06) and every line number in
> this document was re-verified here.
>
> **Memory recall.** `aof work memory recall "web UI path routing app shell SPA history fallback legacy
> query param redirect" --area architecture --block` was run before the first ADR below. The block came
> back **EMPTY** — nothing to surface, so no near-miss is honoured or departed from. (This matches m43's
> finding that the workspace memory index reports `records=0`; the recall path is exercised, not
> skipped.) Prior-milestone lessons are therefore cited directly from source: m43/ADR-015 F2's UI file
> budget, m43/ADR-014 E7's suite-registration rule, TECH_DEBT items 10 and 18, spike 44's finding, and
> m34/ADR-006's `scope.mjs` purity pattern.
>
> **Codebase-graph grounding.** The graph was rebuilt at this refine over the PROJECT ROOT
> (`aof graph build .`) and reported **`unchanged: true`** — graphify rewrites only on a topology
> change, so the artifact is current, not stale: **15,644 nodes / 21,352 edges, `builtAt`
> `2026-08-06T09:59:13.842Z`, `backend: null`, `egress: "none"`**. `aof graph impact` was then read back
> per file. What it says, and — just as important — what it CANNOT say:
> - **RELIABLE, and cited as actual structure:** `src/board-serve.mjs` ← `src/commands/work-ui.mjs`;
>   `src/mesh-ui-serve.mjs` ← `src/commands/mesh-ui.mjs`, → 8 modules including
>   `src/mesh-terminal-relay-bridge.mjs` and `src/workspace-identity.mjs`; `src/commands/assets-ui.mjs`
>   ← `src/command-core.mjs`, → `src/command-error.mjs`. Each web surface has exactly ONE command-layer
>   entry — which is why ADR-002's route rename is a three-file edit at the producers, not a sweep.
> - **A COVERAGE GAP, recorded rather than inferred away:** the extraction resolved most files into the
>   `.aof/mesh/worktrees/69a46fec-…/` duplicate of this repo, and its **TSX edge coverage is PARTIAL** —
>   `ui/src/main.tsx` reports only self-edges even though it demonstrably imports `Fleet`, `Board` and
>   its own `App`. `src/setup-ui.mjs` likewise reports only self-edges. **Their coupling is UNKNOWN to
>   the graph, and is NOT recorded here as "no coupling."** It was established by grep instead and is
>   labelled as such below: `src/board-serve.mjs:20` imports `serveSetupUi` from `./setup-ui.mjs` (read
>   at source), which is the single fact ADR-004 turns on.
>
> The graph is advisory. Every boundary below is the architect's call.
>
> **Measured ground truth, re-verified at `eacbd57`, 2026-08-06.** Two corrections to SPEC.md's own
> citations are made here and are load-bearing:
> - **There are FOUR entry values today, not three.** `ui/src/main.tsx:1261-1266` reads
>   `?mode` ?? `import.meta.env.VITE_AOF_UI_MODE` and branches `fleet → <Fleet>`, `board → <Board>`,
>   **anything else → `<App>`** — and `assets` is a REAL fourth entry, produced by
>   `src/commands/assets-ui.mjs:45,117` (`?mode=assets`) and `:90` (`VITE_AOF_UI_MODE: "assets"`). SPEC
>   says "three pages". The config editor is the fourth and it must survive.
> - **Every advertised URL carries `?mode=`.** `board-serve.mjs:41,62`; `mesh-ui-serve.mjs:143,736`;
>   `assets-ui.mjs:45,117`; `app/desktop/crates/app/src/supervisor.rs:44`. **Nothing anywhere advertises
>   a bare `/`.** That single measurement is what makes ADR-003's back-compat rule total (see there).
> - The in-app cross-links are at `ui/src/board/Board.tsx:416`, `ui/src/board/DetailPanel.tsx:270` (both
>   `http://127.0.0.1:4181/?mode=fleet…`) and `ui/src/fleet/Fleet.tsx:1398` (`/?mode=board`) — SPEC's
>   `Board.tsx:331` / `DetailPanel.tsx:212,798` are stale line numbers for the same three links.
> - `GET /api/mesh/board-url` (`mesh-ui-serve.mjs:278`) returns `{ url, workspaceId, ref }` where `url`
>   is a PAGE url `http://127.0.0.1:PORT/?mode=board#ref`; consumed by `ui/src/fleet/api.ts:284-290`,
>   navigated by `Fleet.tsx:514` (`window.location.assign`). The board reads the fragment back at
>   `ui/src/board/Board.tsx:585` and writes it at `:296`/`:392` — **`#ref` is a live deep-link
>   contract**, not decoration.
> - `ui/vite.config.ts` sets no `base` and no `build.assetsDir`, so the built bundle emits
>   **`ui/dist/assets/index-*.js` / `index-*.css`** (verified on disk). This is a measurement, not a
>   detail: it forecloses one candidate route name outright (ADR-002).
>
> **Amendments — Three Amigos, 2026-08-06.** Six findings landed on this log from the Three Amigos pass
> over all four stories. All six are folded in below, in place, because none of these ADRs has shipped
> yet: this is the same refine, so a correction here is drafting, not supersession. Each is marked
> **[Amigos-N]** at the point it changed, so a later reader meets the reasoning rather than a silently
> different document.
> - **[Amigos-1]** ADR-001 — the export names are stated ONE way: **`routeFor(pathname)`** and
>   **`legacyRedirectFor({ pathname, search, hash })`**. The story brief's `matchRoute` / `(url)` forms
>   are retired; the PO ruled the ADR and the committed arch test canonical. Every occurrence in this
>   document was swept. The one surviving `matchRoutes` is react-router's OWN helper, named in ADR-001's
>   rejection rationale, and is now explicitly labelled as such.
> - **[Amigos-2]** ADR-004 — the traversal guard runs BEFORE the fallback predicate, unconditionally,
>   and a refused path never reaches it. Security-adjacent; measured, now pinned.
> - **[Amigos-3]** ADR-006 — "byte-identically" was unsatisfiable and is replaced by the claim the
>   mandated mechanism actually delivers.
> - **[Amigos-4]** ADR-004 — `contentType` is a SECOND duplicated helper on the same two lines, and it
>   has already drifted. Folded into the same move.
> - **[Amigos-5]** ADR-005 — DESIGN's DG-45-2 z-ladder gains a fitness function.
> - **[Amigos-6]** ADR-002 — trailing-slash tolerance, case sensitivity, and the binding route-entry
>   ids are stated rather than left to the implementation.
>
> **Amendments — build start, 2026-08-07.** Five findings landed on **ADR-005 alone**, from the two
> developer-seat questions STATE.md left open at refine (the Three Amigos' developer seat was terminated
> by a rate limit, not by anything in the work) and answered at build start **against the live
> `TerminalDock` / `FleetTerminalView` code**. All five are folded in below, IN PLACE, because **nothing
> of ADR-005 has shipped**: `ui/src/app/shell-layout.mjs` does not exist yet and story 45/03 builds it
> next. This is the same drafting move the [Amigos-N] block records — a correction inside the same refine
> is drafting, not supersession — and each is marked **[Build-N]** at the point it changed. **No earlier
> decision is reversed.** Every one is a clause ADR-005 was missing, and every line number below was read
> at source on 2026-08-07.
> - **[Build-1] BLOCKING.** ADR-005's "a surface asks the shell to present a node" never promised that the
>   presented occupant's **instance and DOM identity survive present AND dismiss** — and both existing
>   terminal overlays exist for precisely that reason. Folded in with the **post-present layout tick**
>   both implementations independently discovered. Without this clause m46 cannot build against the shell
>   at all: the tidy-looking build (render into an overlay portal) disposes the xterm and closes the socket.
> - **[Build-2]** The shell owning `Escape` collides with an **interactive** occupant — m46's terminal
>   forwards stdin and `Esc` is a live keystroke for the `claude` TUI. The occupant **may claim** `Escape`;
>   the visible exit control stays mandatory in either case, which is what makes the claim safe.
> - **[Build-3]** The **dock's region home** is decided: `overlay`, out of flow. The z-ladder reserved
>   `z-30` for the dock and **no region named it**; a `content`-parented dock dies on every route change.
> - **[Build-4]** The **three-regions / five-rows reconciliation** is stated rather than left for m46 to
>   guess between two candidate name sets. The module exports THREE region constants; R1–R3 are interior
>   structure of `chrome`.
> - **[Build-5]** `--aof-shell-chrome-height` is **promoted out of the story-default paragraph into the
>   contract list as point 7**. m46's drag-resize clamp needs the chrome height as a named primitive.

---

## ADR-001: The router is a HAND-ROLLED pure route table in a framework-free `.mjs` module (`ui/src/app/routes.mjs`); `react-router-dom` is REJECTED for this surface, with the condition that would overturn it stated

**Status:** Accepted
**Date:** 2026-08-06

**Context.** `ui/package.json` installs no router. The choice is a hand-rolled table versus adding
`react-router-dom`, and three measured facts decide it.

**(1) The house test pattern is not a preference; it is the only way UI logic is tested here.** There
is NO React test harness in this repo — no vitest, no testing-library. Every UI surface keeps its
decisions in framework-free `.mjs` beside the component so `node:test` drives it headlessly:
`ui/src/fleet/scope.mjs` (whose own header states the rule — *"render-logic node:test must exercise
belongs in a plain .mjs helper the .tsx wires up, never inline JSX-only logic"*),
`ui/src/board/{runs,action,freshness,resync}.mjs`, `ui/src/board/terminal/*.mjs`,
`ui/src/fleet/terminal-view/*.mjs`. The canonical shape is `test/fleet-scope.test.mjs`. A router
library's matching lives inside React context and hooks; `<Navigate>` and route objects are JSX/config,
not functions. Adopting it would move the *one decision this milestone exists to make* — which URL
means which surface — into the exact place this codebase cannot test.

**(2) The surface is four routes with no nested layouts, no loaders, no data APIs, no parameterised
segments, no code splitting.** react-router's own `matchRoutes` helper, applied to a four-entry flat
table, is a `find` over an array. (**[Amigos-1]:** that `matchRoutes` is the LIBRARY's export, named
here only to size the thing being rejected. It is not this milestone's function — ours is `routeFor`,
below, and the two must never be conflated again.)

**(3) The two genuinely fiddly parts are pure string→string functions a library does not help with.**
The legacy `?mode=` translation (ADR-003) and the unrecognised-parameter passthrough (ADR-006) are
`(url) → url`. Under a router they would live in `<Navigate>` elements and a `loader`, i.e. in two
places instead of one, and still need testing by whatever means.

Against those, the library's costs are real and specific to this repo: a new runtime dependency in a
bundle that ships **inside an 88 MB SEA** and is served from **three different origins**, in a codebase
whose posture on new dependencies is already fitness-locked elsewhere (`acd-headroom-no-dependency`,
`acd-global-store-no-native-dep`, `acd-graphify-no-npx-install`).

**Decision.**
- **The router is a pure module: `ui/src/app/routes.mjs` (+ `routes.d.mts` for the `.tsx` importers),
  framework-free.** It imports no React, no `react-dom`, no DOM global. Like `scope.mjs` it **touches
  no `window`/`location` itself** — the caller passes the URL parts in and wires the result to
  `history`. It is loadable and drivable by `node:test` with no bundler.
- **Its exported surface is small and named, because the fitness functions and three downstream
  milestones bind to it:** the route table itself, **`routeFor(pathname)`** (path → route entry,
  including the not-found entry), and **`legacyRedirectFor({ pathname, search, hash })`** (ADR-003).
  Everything else is an implementation detail of the story.
  - **[Amigos-1] These two spellings are canonical and binding.** The story brief's `matchRoute(pathname)`
    and `legacyRedirectFor(url)` are RETIRED — PO ruling, 2026-08-06. A build satisfying the brief would
    have passed its features and failed CI, because `test/arch/acd-route-logic-framework-free.test.mjs`
    binds all five of its assertions to `routeFor` and to the **object** argument. The object argument
    is not incidental: `legacyRedirectFor` must see the `hash` as a separate field, and a single `url`
    string would either force the module to parse one (re-deriving what the caller already has) or to
    reach for `location` (which ADR-001 forbids on purpose). **No other ADR text depends on the old
    spelling** — swept and verified across this document.
- **The render root selects a surface by calling into this module and by NO other means.** No second
  ternary, no `?mode` read, no `import.meta.env` branch anywhere else in `ui/src`.
- **REJECTED: `react-router-dom`**, on the three grounds above — not on merit. It is the right tool for
  a surface this one is not yet.
- **The condition that overturns this, stated now so a later author meets a decision rather than an
  omission:** nested layouts with independent per-region data loading, route-level code splitting, or
  more than roughly ten routes with parameterised segments and relative links. At that point adopt the
  library — and keep `routeFor` / `legacyRedirectFor` as the pure functions it calls, so the headless
  tests survive the migration.

**Consequences.**
- The route table, the legacy translation and the query passthrough are all exercised by `node:test`
  with no harness, no DOM and no bundler — the same lane `test/fleet-scope.test.mjs` already runs in.
- `ui/`'s dependency set is unchanged, so the SEA payload and all three origins are unchanged.
- Milestones 47 and 49 add a route by adding a table row, not by learning a library.
- `acd-route-logic-framework-free` fails CI if the route module gains a React/DOM import, reaches for a
  `window`/`location` global, or stops being importable by plain node.

---

## ADR-002: FOUR paths, one ORIGIN-BLIND table — `/` (shell landing), `/fleet`, `/board`, `/config`; **`/assets` is forbidden because it is the bundle's own asset directory**; an unknown path renders the shell's 404 surface and is NEVER redirected to `/`

**Status:** Accepted
**Date:** 2026-08-06

**Context.** Today `?mode` selects among four surfaces, and the fall-through case is the config editor:
no mode, or any unrecognised mode, renders `<App>` (`main.tsx:1266`). So on the board origin AND on the
config origin, **bare `/` today IS the config editor**; on the fleet origin bare `/` renders `<App>`
against a server with no `/api/config`, which is what
`app/desktop/crates/app/src/supervisor.rs:37-44`'s doc comment records as *"the bare `/` renders
BLANK"*. Moving `/` to the shell landing therefore moves the config editor, and every launcher that
opens it must move in the same change.

Two constraints bound the naming:

- **`/assets` collides with the build output.** `ui/vite.config.ts` sets no `base` and no
  `build.assetsDir`, so the built bundle is `ui/dist/assets/index-*.js` and `index-*.css` (on disk,
  verified). A route literally named `/assets` would sit on the same origin as the directory that
  serves its own JavaScript. Bare `/assets` would reach the static handler and 404 (it is a directory),
  and ADR-004's fallback discriminator would have to carve an exception around the one prefix it most
  needs to leave alone. The legacy *mode value* is `assets`; the *path* cannot be.
- **The same bundle is served from three origins with different API surfaces** (`:4181` fleet, the
  board's ephemeral port, the config editor's dev port). `/board` on the fleet origin has no
  `/api/work`; `/fleet` on a board origin has no `/api/mesh`. This is true TODAY of `?mode=` and is not
  introduced here.

**Decision.**
- **The route table, complete. [Amigos-6] the `id` column is BINDING** — a `Then` step cannot be
  confirmed against an anonymous object, so the entry names are part of the contract, not an
  implementation detail. QA-01's proposed names are ACCEPTED verbatim; there was no reason to rename
  them, and an architect renaming a QA-authored identifier for taste is churn:

  | path | `id` | renders | notes |
  |---|---|---|---|
  | `/` | `landing` | the shell landing (a placeholder for now) | milestone 49 replaces the PLACEHOLDER, not the route |
  | `/fleet` | `fleet` | `<Fleet>`, unchanged | milestone 47 becomes its owner |
  | `/board` | `board` | `<Board>`, unchanged | `#ref` fragment semantics unchanged (`Board.tsx:585`) |
  | `/config` | `config` | `<App>`, the config editor, unchanged | its NEW address; every launcher moves with it |
  | anything else | `not-found` | the shell's not-found surface | see below — never a redirect |

  `landing` (not `home`) is deliberate and matches this ADR's own prose: `/` is "the shell landing".
  Milestone 49 replaces what that entry *renders*; it does not rename the entry, so the id survives the
  terminals-home landing on top of it.

- **[Amigos-6] A TRAILING SLASH is matched IN PLACE, not redirected.** `/fleet/` resolves to the
  `fleet` entry. The matcher is tolerant — it normalises a single trailing slash before lookup — and it
  does **NOT** rewrite the address bar. This leaves ADR-002's no-redirect rule completely untouched: the
  only rewrite this milestone performs anywhere is ADR-003's one-shot legacy translation. PO ruling,
  overturning QA-01's earlier pin of `/fleet/` to an in-shell 404: a trailing slash is a shape people
  type and paste, and answering it with "not found" is a worse answer than simply understanding it. Note
  the server side already agrees — `shouldServeAppShell("/fleet/")` is true (ADR-004), so a deep-linked
  `/fleet/` reaches the shell rather than 404ing at the origin, and the two halves must not disagree.
- **[Amigos-6] Paths are CASE-SENSITIVE; lowercase is canonical.** `/Fleet` is an unknown path and
  renders the not-found surface **in place** — not a redirect to `/fleet`, and not a case-insensitive
  match. PO ruling. Two reasons it is the right default: a case-insensitive matcher has to decide what
  to do about `/FLEET` in the address bar (either leave a URL that disagrees with every link the app
  emits, or rewrite — and rewriting is the thing this milestone does exactly once, on purpose); and
  every URL this codebase mints is lowercase already, so tolerance would buy nothing and cost a rule.
  Trailing slash and case are deliberately asymmetric, and that asymmetry is the point: a trailing slash
  is a *punctuation* variant of the same path, while a case variant is a *different* path that happens
  to look similar.
- **The table is ORIGIN-BLIND, and stays that way.** One bundle, one table, no `if (origin === …)`
  branch and no per-server build flag selecting a subset. An origin conditional inside the route table
  is the provider-conditional shape this repo bans on sight, and it would have to be re-decided by 46,
  47 and 49 in turn. A surface reached on an origin that cannot serve its API degrades through **its own
  existing error state** — byte-identically to what `?mode=fleet` on a board origin does today. This is
  a *known, unchanged* property, recorded so a later reviewer meets it as a decision.
- **`/config`, not `/assets`** — forced by the collision above. This deliberately diverges from the CLI
  verb (`aof assets ui`), from the command id (`assets:ui`) and from the legacy mode value (`assets`).
  The divergence is accepted and named here rather than discovered later: a *verb* and a *URL* need not
  share a word, the surface's own API namespace is already `/api/config`, and the alternative is a route
  that collides with the asset directory on every origin that serves it. The UI module moves to
  `ui/src/config/` to match the route (ADR-002's consequence, and see §Codebase health — it is
  currently 1,200+ lines inside `main.tsx`).
- **`/` renders the shell landing, NOT the config editor and NOT a redirect to `/fleet`.** SPEC
  explicitly sanctions shipping a route with nothing behind it ("`/` may render a placeholder"), and 49
  *replaces whatever `/` renders*. Two rejected alternatives, with reasons:
  - **`/` keeps rendering the config editor** — then 49's diff has to both build the terminals grid AND
    relocate the config editor, which is this milestone's job leaking into the next one.
  - **`/` redirects to `/fleet` until 49 lands** — a redirect that must later be reversed is a URL that
    changes meaning twice, and it rewrites every bookmark of `/` to `/fleet` in the interim. A landing
    that says what it is and links onward costs one click and changes meaning once.
- **An unknown path renders the shell's NOT-FOUND surface; it is never redirected to `/`.** A redirect
  makes a typo, a stale bookmark and a broken in-app link indistinguishable from a working one — it
  destroys the evidence in the address bar at exactly the moment routing is newly introduced and
  in-app links are newly rewritten (ADR-003). The not-found surface renders *inside* the shell, so the
  navigation is right there and recovery is one click. ADR-004 is deliberately built to make this the
  answer for a deep-linked unknown path too, so there is ONE not-found experience, not two.
- **`VITE_AOF_UI_MODE` is RETIRED, not kept as a second route input.** It is set in exactly one place
  (`assets-ui.mjs:90`) and is a build-time constant that is undefined in the shipped bundle. Keeping it
  as a fallback would give the route decision two inputs — a URL and a baked env var — which is the
  two-homes-for-one-fact shape. `ui/src/vite-env.d.ts:4`'s declaration goes with it.

**Consequences.**
- Four launchers change their advertised URL in this milestone and nothing else about them changes:
  `board-serve.mjs:41,62` → `/board`; `mesh-ui-serve.mjs:143,736` → `/fleet`; `assets-ui.mjs:45,117` →
  `/config`; `supervisor.rs:44` → `/fleet?scope=global` (and its doc comment's "renders BLANK" warning
  is deleted, because it stops being true). The graph confirms each has exactly one command-layer
  entry, so this is a small, enumerable edit set — not a sweep.
- Three in-app cross-links change with them (`Board.tsx:416`, `DetailPanel.tsx:270`, `Fleet.tsx:1398`).
- `/api/mesh/board-url`'s response is **untouched in shape** — still `{ url, workspaceId, ref }`, with
  `url` now `http://127.0.0.1:PORT/board#ref`. Spike 44's finding requires 46 to add an **origin** field
  to that same body; nothing here narrows, freezes or reshapes the route, so that addition stays purely
  additive.
- The board's `#ref` fragment is unchanged on every path, and `Board.tsx:585` needs no edit.
- `acd-ui-single-route-table` fails CI if a second surface-selecting branch appears anywhere in
  `ui/src`, or if the entry module still *defines* a surface instead of importing it.

---

## ADR-003: Legacy `?mode=` is translated by ONE pure `legacyRedirectFor(url)` in the route module, applied EXACTLY ONCE at the entry as a `history.replaceState` rewrite; `mode` is the ONLY thing removed; **every URL any producer has ever advertised carries `?mode=`, so the coverage is total**

**Status:** Accepted
**Date:** 2026-08-06

**Context.** The back-compat surface was measured rather than assumed, and the measurement changes the
shape of the rule. **Every** advertised URL in this codebase carries a `mode` selector:
`board-serve.mjs:41,62`, `mesh-ui-serve.mjs:143,736`, `assets-ui.mjs:45,117`,
`supervisor.rs:44`, and `board-url`'s returned page URL. **Nothing advertises a bare `/`.** Bare `/`
renders the config editor today only as the fall-through of `main.tsx:1266` — an accident of the
ternary's `else`, never a published address.

That matters because it converts a fuzzy promise ("no URL loses meaning") into a checkable one: the
legacy translation covers 100% of the addresses this system has ever handed out.

The bookmarked-URL shape that must survive intact is concrete: `?mode=fleet&scope=global` (the
desktop app's compiled constant, and the fleet's own advertised URL) and `?mode=board#ref` (what
`board-url` returns and what `Fleet.tsx:514` navigates to). So the translation must preserve a sibling
query parameter AND a fragment.

**Decision.**
- **ONE pure function, in the route module: `legacyRedirectFor({ pathname, search, hash })`**, returning
  the canonical `{ pathname, search, hash }` or `null` when the URL is already canonical. It is the
  ONLY place in `ui/src` that may name the string `mode`. No scattered checks, no per-surface
  compatibility shim.
- **Applied EXACTLY ONCE, at the entry, before the first render.** Not per-surface, not inside a route
  component, not in an effect.
- **It is a `history.replaceState` REWRITE, not a render-time alias.** Reasons, in order:
  - A render-time alias leaves `?mode=fleet` in the address bar forever, so **two URL vocabularies live
    simultaneously and permanently**, and every subsequent in-app navigation has to decide whether to
    carry the legacy form. The whole point of the milestone is that the address bar means something.
  - `replaceState`, **never `pushState`** — a pushed entry makes the back button bounce between the
    legacy URL and the canonical one, and the legacy URL then re-redirects. A replace leaves the history
    stack exactly as deep as the operator's own navigation made it.
  - It costs no server round trip, so it behaves identically on all three origins with no server-side
    redirect rule to write twice.
  - **Only the client can preserve the fragment.** A fragment is never sent to the server, so a
    server-side 3xx would be relying on browser-specific carry-over behaviour for `#ref` — the exact
    "works in my browser" class this repo pays for elsewhere.
- **The translation table is total and explicit:** `mode=fleet → /fleet`, `mode=board → /board`,
  `mode=assets → /config`. An **unrecognised** `mode` value (today's fall-through to `<App>`) maps to
  `/config` as well, so the ternary's `else` branch keeps its meaning verbatim rather than silently
  becoming a 404.
- **`mode` is the ONLY thing removed. Everything else survives — `scope`, any parameter this codebase
  does not recognise, milestone 47's future repo filter, and the fragment.** The rewrite is built by
  copying the incoming `URLSearchParams`, deleting `mode`, and re-attaching the original hash verbatim.
  **[Amigos-3]** The precise, satisfiable claim is ADR-006's, and it is *not* byte-equality: every
  surviving parameter **decodes identically, in the same order, with the same entry count**. The
  fragment IS carried verbatim, byte for byte, because it is never parsed.
- **The rewrite is IDEMPOTENT by construction:** `legacyRedirectFor` on an already-canonical URL returns
  `null` and nothing happens. Running the entry twice, or landing on a rewritten URL, changes nothing.
- **The ONE URL whose meaning changes, named rather than glossed:** bare `/` on the config-editor
  origin stops rendering the config editor and renders the shell landing (ADR-002). It is not in the
  advertised set — nothing has ever printed it — and `aof assets ui` moves its advertised URL to
  `/config` in the same story. It is a one-click difference on one dev-only origin, and it is the
  price of `/` becoming a real address.
- **No expiry is set on the legacy translation, deliberately.** The desktop app ships a **compiled**
  constant and an operator's bookmarks are outside this repo's control. Retiring the translation is a
  later decision that needs its own ADR and a measurement of what still emits the old form — not a
  timer.

**Consequences.**
- `?mode=fleet&scope=global` → `/fleet?scope=global`; `?mode=board#42/03` → `/board#42/03`;
  `?mode=assets` → `/config`. Every advertised URL, and every bookmark of one, keeps working.
- The house's headless harnesses (`test/support/fleet-app-harness.mjs:39`,
  `test/support/board-app-harness.mjs:123`) mount the surface COMPONENT directly and never go through
  the entry, so their `search: "?mode=fleet"` defaults are inert either way — no harness change is
  forced by this decision. The behavioural suites that assert an advertised URL *contains* `mode=`
  (`test/mesh-ui-serve.test.mjs:126,303`, `test/board-serve.test.mjs:186`,
  `test/work-ui-verb-rename.test.mjs:187`, `test/mesh-ui-cli-face.test.mjs:205`,
  `test/mesh-ui-global-scope.test.mjs:219`) DO change, in the same story that changes the producers.
  That is the correct blast radius and it is enumerated here so it is planned, not discovered.
- `acd-no-surface-mode-url-literal` fails CI while any `?mode=` literal remains in production code
  outside the route module.

---

## ADR-004: BOTH servers' static-serving rules move into ONE pure leaf, `src/static-serve.mjs` — the new `shouldServeAppShell(pathname)` history-fallback predicate AND the **byte-identical, twice-defined `safeStaticPath` traversal guard**; the discriminator is **"the pathname has no file extension"**; the route-derived allowlist and the `Accept:` header are REJECTED with reasons; **the fleet server's existing UNCONDITIONAL fallback is tightened by the same predicate, not pinned**

**Status:** Accepted
**Date:** 2026-08-06

**Context, measured at source.** Two servers, three findings — two different fallback defects, and one
duplication that only became visible from looking at both handlers side by side:

- **`src/setup-ui.mjs` has no fallback at all.** `safeStaticPath` (`:269`) is a literal file lookup;
  the handler at `:130-140` is `readFile(...).catch(() => 404)`. `/api/*` is already 404'd before it at
  `:125-128`, so the fallback can never shadow an API route. Established **by grep, because the graph
  does not cover it** (see the grounding note): `src/board-serve.mjs:20` imports `serveSetupUi`, and
  `serveBoard` (`:60`) points it at `ui/dist`. **One fix reaches both the board origin and the config
  origin.**
- **`safeStaticPath` is defined TWICE and the two copies are BYTE-IDENTICAL** — `setup-ui.mjs:269-280`
  and `mesh-ui-serve.mjs:873-884`, verified by `diff` (exit 0). It is not an incidental helper: it is
  the **directory-traversal guard** (`path.isAbsolute` refusal plus a resolved-prefix containment
  check) standing in front of both static roots. Two copies of a traversal guard is precisely the
  artefact that gets hardened in one place and not the other, and it is TECH_DEBT item 0.2's shape
  ("the same fact derived independently, everywhere") on a security-relevant rule. It sits on the exact
  lines this ADR already edits.
- **[Amigos-4] `contentType` is a SECOND duplicated helper on those same lines — and it has ALREADY
  DRIFTED.** `setup-ui.mjs:262-267` vs `mesh-ui-serve.mjs:861-868` (`diff` exit 1): the fleet copy
  knows `.json` → `application/json` and `.svg` → `image/svg+xml`; the board/config copy answers
  `application/octet-stream` for both. It is latent only because the built bundle is currently nothing
  but `index.html` plus hashed `.js`/`.css` — the first `.svg` vite emits makes it live, and it would
  present as "the icon renders on the fleet and downloads on the board", a defect nobody would think to
  attribute to a helper.
  This is not an additional finding so much as **empirical proof of this ADR's own thesis**: the pair
  was duplicated at the same moment, and within one codebase's lifetime one of the two has already
  diverged while the other has not *yet*. Waiting for `safeStaticPath` to drift the same way, when the
  fix is the same deletion-plus-import on the same two sites, would be the accretion the codebase-health
  rule exists to catch.
- **`src/mesh-ui-serve.mjs:558-568` falls back UNCONDITIONALLY.** SPEC asks that this be pinned by a
  test rather than assumed — but pinning it as-is would ratify a defect: an unconditional fallback
  serves `index.html`, with `Content-Type: text/html`, for a MISSING `/assets/index-abc.js`. A broken
  deploy then presents as `Uncaught SyntaxError: Unexpected token '<'` in the browser console, arbitrarily
  far from its cause. That is precisely the failure mode the SPEC's fallback rule is written to prevent —
  it simply already exists on the origin nobody was worried about.

So the real decision is not "add a fallback to one server". It is **"what is the fallback rule, and
where does it live so both servers cannot disagree about it."**

Three candidate discriminators were considered:

1. **`Accept: text/html`** — correct in spirit; a browser navigation sends it, a subresource does not.
   **REJECTED:** it makes one URL answer differently depending on a request header, so `curl`, this
   repo's own headless harnesses, and a browser get different bodies for the same address. Diagnosing a
   deploy by hand would then be actively misleading — the "works in a browser, not in the tool" class.
2. **An explicit route-prefix allowlist derived from the client's route table** — the tightest possible
   rule, and genuinely attractive. **REJECTED for a structural reason:** the server would have to learn
   the client's route table, which means either `src/setup-ui.mjs` imports `ui/src/app/routes.mjs` (a
   `src/` → `ui/src/` dependency, a new and wrong coupling direction — `src/` treats `ui/` as a build
   artefact today) or the list is duplicated server-side (two homes for one fact, guaranteed to drift
   the first time 47 or 49 adds a route). It also splits the not-found experience in two: a deep-linked
   typo would get a plain-text server 404 while the same typo reached by in-app navigation gets the
   shell's 404 surface (ADR-002). One 404, not two.
3. **The pathname has no file extension.** ACCEPTED.

**Decision.**
- **The static-serving rules live ONCE, in a new pure leaf `src/static-serve.mjs` (no LOCAL imports —
  `node:path` only), exporting all THREE: `shouldServeAppShell(pathname)`,
  `safeStaticPath(root, pathname)` and — **[Amigos-4]** — `contentType(filePath)`.** Both
  `src/setup-ui.mjs` and `src/mesh-ui-serve.mjs` import all three and re-derive none. A rule copied into
  two servers is a rule that is true in one of them — and the traversal guard has been living that way
  since the fleet face was built.
  - **`safeStaticPath` moves rather than staying put, and the module is named for what it holds.** The
    two definitions are byte-identical today, so the move is a deletion plus an import at each site —
    no behaviour change, nothing to reconcile. Naming the module `spa-fallback.mjs` and then putting a
    traversal guard in it would be the same under-description one layer up; `static-serve.mjs` says
    what it is: the rules for serving the static bundle.
  - **[Amigos-4] `contentType` moves with it, and the merged table is the UNION** — the fleet copy's
    richer one, i.e. `.js` / `.css` / `.html` / `.json` / `.svg`, with `application/octet-stream` as the
    fall-through. Folding it in is the PO's expectation and the architect agrees: it is the identical
    deletion-plus-import on the identical two sites, inside a diff that is already rewriting the lines
    between them. The union is also the only safe direction — taking the *intersection* would silently
    regress the fleet origin, which serves `.json`/`.svg` correctly today. Net effect on the board and
    config origins: an `.svg` starts rendering instead of downloading, and a `.json` gets its real type.
    Neither is a route change and neither can break a working deploy.
  - **This is IN scope, not scope creep.** ADR-004 already edits the four lines immediately above and
    below both copies. Leaving TWO duplicated helpers — one of them a *security* guard, the other
    already visibly drifted — untouched while rewriting the handler around them is the accretion the
    codebase-health rule exists to catch.
- **[Amigos-2] THE ORDER IS FIXED AND IT MATTERS: the traversal guard runs FIRST, unconditionally, and
  a path it REFUSES never reaches the fallback predicate.** The handler is:
  1. `/api/*` → the coded not-found envelope, returns (unchanged; `setup-ui.mjs:125-128`,
     `mesh-ui-serve.mjs:546-549`);
  2. `safeStaticPath(root, pathname)` → **`null` is TERMINAL: a 404, and the request stops there**;
  3. only an ADMITTED path is read from disk, and only a read that MISSES consults
     `shouldServeAppShell`.

  **Why this needed saying, measured 2026-08-06.** Several traversal encodings survive WHATWG URL
  parsing intact *and* end in a segment with no `.` in it — `/%2e%2e%2fetc%2fpasswd`,
  `/%2e%2e%2f%2e%2e%2fetc%2fshadow`, `/%2e%2e%2froot`, `/%2f%2fetc%2fpasswd`. For every one of them
  `safeStaticPath` correctly returns `null` **and** `shouldServeAppShell` independently returns `true`.
  So a handler that treats "the guard refused" as "the file is missing" — which is the natural,
  tidy-looking refactor, `if (!filePath) → fall back` — answers **`200 text/html`** to an attempted
  directory escape. It leaks no file, but it converts a refusal into a success, which is the opposite of
  this repo's "a refusal must name its own cause" rule, and it is silent.

  Both servers happen to return at the guard today (`setup-ui.mjs:131-134`,
  `mesh-ui-serve.mjs:554-557`). **Nothing said they must**, and this ADR is what makes the fallback
  attractive to wire in the wrong place. The order is therefore a decision, not an accident of the
  current code, and `acd-spa-fallback-never-masks` asserts it against the REAL handler with each of the
  four measured inputs.
- **The discriminator: fall back to `index.html` only when the pathname has NO file extension** — i.e.
  the last path segment contains no `.`. `/fleet`, `/board`, `/config`, `/`, and any future
  `/a/deep/path` fall back. `/assets/index-abc.js`, `/index.html`, `/favicon.ico` and every other
  extensioned request **404 exactly as they do today**. This holds against the real build output, which
  is entirely hashed `.js`/`.css` plus `index.html` (verified on disk), and it needs no request header
  and no knowledge of the client's routes.
- **`/api/*` is never reachable by the fallback, and this is belt AND braces.** `setup-ui.mjs:125-128`
  and `mesh-ui-serve.mjs:546-549` already return before the static handler, and `shouldServeAppShell`
  ALSO answers `false` for any `/api/` pathname on its own. Two independent guards, because a later
  refactor that reorders the handler must not be able to turn an API 404 into an HTML 200.
- **The fleet server is TIGHTENED, not pinned.** `mesh-ui-serve.mjs`'s unconditional
  `catch → index.html` is gated behind the same predicate. This is a one-condition change in the same
  subject as the milestone, it removes a live asset-masking defect, and — critically — it means the
  test SPEC asked for pins the CORRECT behaviour on both origins rather than blessing two different
  ones. A deep-linked `/fleet` on `:4181` keeps working exactly as it does today.
- **The fallback response is `200` with `Content-Type: text/html`**, unchanged from
  `mesh-ui-serve.mjs`'s current behaviour, and the shell then renders its own not-found surface for an
  unknown path (ADR-002). A `404` status carrying the app shell was considered and rejected: it makes
  every valid client route return 404 to any tool that reads status codes, for no operator benefit.
- **A missing `index.html` stays a friendly 404**, as `mesh-ui-serve.mjs:567` already does — the
  ui-build-missing case is loud, never a blank 200.

**Consequences.**
- One fix, two origins, because `board-serve.mjs:20` delegates to `serveSetupUi` — the board's
  ephemeral-port server and the config editor's server both gain the fallback in the same change.
- A broken deploy fails at its cause on **both** servers: a missing hashed asset 404s instead of
  arriving as HTML.
- The directory-traversal guard has ONE definition, so hardening it once hardens both origins — and an
  attempted escape can never be answered with the app shell, whoever wires the handler next.
- **[Amigos-4]** The MIME table has one definition too, so the board and config origins stop being one
  file type behind the fleet. **This widens story 45/02's scope by one helper**: that story's note
  should read "`shouldServeAppShell` + `safeStaticPath` + `contentType` move into `src/static-serve.mjs`;
  both servers import all three", not two of the three.
- The dev config-editor path is unaffected: `assets-ui.mjs` serves the UI from a **vite dev server**
  (`:79-95`), which does SPA fallback itself; `serveSetupUi` there is the API half only.
- `acd-spa-fallback-never-masks` drives the REAL `serveSetupUi` handler (not a copy), asserts both
  servers import the shared module, asserts `safeStaticPath` **and `contentType`** are each defined
  exactly once in `src/`, and asserts the guard-before-fallback ordering on four measured traversal
  inputs.

---

## ADR-005: The shell exposes THREE named regions — `chrome` / `content` / `overlay` — as importable constants; the shell guarantees a BOUNDED, non-scrolling content box (`min-height: 0`), the SURFACE owns scroll inside it, and **fullscreen is ONE mechanism owned by the shell**; the Fullscreen API and per-surface `position: fixed` overlays are both rejected

**Status:** Accepted
**Date:** 2026-08-06

**Context.** Milestone 46 consumes "the shell's layout primitives" and needs a surface to escape the
content region and go fullscreen; milestone 49 puts a grid of live terminals at `/`. Both depend on the
same thing, and it is not a component: a terminal computes its geometry from the box it is given.
`TerminalDock.tsx:167` already splits fit-vs-scale, and 46's SPEC pins that split to *whether the far
end can be told to resize*. What the shell must guarantee is that **the box is knowable without
measuring the document** — otherwise every terminal surface re-derives the chrome height and they
disagree.

This ADR is a CONTRACT. It fixes what 46 and 49 may rely on. It does not fix the CSS.

**Decision.**
- **Exactly three named regions, and the names are importable constants** from a framework-free
  `ui/src/app/shell-layout.mjs` — not string literals typed in each surface:
  - **`chrome`** — the top bar (brand, nav between the surfaces, the group chip, and a SLOT the routed
    surface may fill, which is where `<ScopeControl>` lands). Never scrolls. Mounted in every page
    state, exactly as `acd-mesh-ui-scope-visible` already requires of `<TopBar>`.
    **[Build-4]** `chrome` is *everything above the content region*, not the top bar alone — DESIGN's
    conditional notice rail (R1) and surface bar (R3) are inside it too (see the reconciliation below).
    Its height is therefore **measured, not fixed**: this bullet previously said "fixed height", which is
    true only of R2 in isolation (48px) and is wrong in every combination where R1 or R3 stands. The one
    number a surface may rely on is point 7's `--aof-shell-chrome-height`.
  - **`content`** — the routed surface. Exactly one per shell.
  - **`overlay`** — a SIBLING of `content` inside the shell root, empty until something is presented
    fullscreen (**[Build-3]**: and, from m46, while the DOCK is open — the clause below widens this
    region from "the fullscreen slot" to "every out-of-flow layer"). A sibling (not a child of
    `content`) so a fullscreen surface covers `chrome` too without a stacking-context fight.
    - **[Build-3] The DOCK's region home is `overlay`, and it is decided here because the z-ladder
      reserved `z-30` for the dock while NO region ever named it.** `overlay` is the home of every
      out-of-flow layer — DESIGN's R5 in full: the dock, toasts, and the one `shell:fullscreen`
      occupant (`DESIGN.md:472`, `:527`).
      **Measured, and it is the same failure as [Build-1] in a different costume.** The dock survives a
      view switch today only because `ui/src/board/Board.tsx:540-541` renders it OUTSIDE the
      loading/error/overview/board conditional, expressly so nothing can unmount it — the reason is
      written twice in that file, at `:517-521` (*"rendered OUTSIDE the loading/error/overview/board
      conditional so NOTHING in the board content … can unmount it and tear down the running session"*)
      and again at `:474`. **Under a router the same hoist must happen ONE LEVEL UP.** A `content`-parented
      dock is unmounted by every route change, so navigating from `/board` to `/fleet` would kill the
      PTY — the hoist that a component already had to perform against a *view* switch must be performed
      by the shell against a *route* change, or it is undone the moment routing lands.
      **DESIGN answers this twice out of flow and once in flow; the ADR rules R5 / OUT OF FLOW.**
      `DESIGN.md:472` and `:527` both put the dock in the out-of-flow overlay layer; `DESIGN.md:240`
      describes `z-30` as the dock "in its in-flow/docked position". That single wording is **flagged to
      the designer as a to-amend and is deliberately NOT edited here** (see Consequences).
      **The consequence is stated rather than discovered:** an out-of-flow dock **overlays** the bottom
      of the content region instead of shrinking it. The shell's obligation is the region and the rung,
      nothing more. If m46 finds it needs content to SHRINK by the dock's height, that is a NEW contract
      point of the same shape as point 7 (a published dock inset) and it needs an amendment here — not a
      CSS decision taken inside a story.
- **[Build-4] THREE exported region constants, FIVE visual rows — the reconciliation is stated here
  because m46 cannot import a name that has two candidate sets.** DESIGN's region table
  (`DESIGN.md:520-527`) and story 45/03's task 01 both describe R1–R5, and the layout MODEL yields five
  rows in one declared order (notice rail, top bar, surface bar, content, overlay). **Those five rows are
  not five regions:**
  - **R1 (notice rail), R2 (top bar) and R3 (surface bar) are INTERIOR STRUCTURE of `chrome`.** All three
    sit above the content region, all three are summed into the published chrome height (point 7), and
    two of the three are conditional. `chrome` is what a consumer NAMES; R1–R3 are how the shell BUILDS
    it.
  - **R4 = `content`. R5 = `overlay`.**
  - **The MODULE therefore exports exactly THREE region constants, and m46 imports three names, not
    five.** A module exporting five would put `noticeRail` and `surfaceBar` — both conditional, both
    purely internal — into the vocabulary of every downstream milestone, and 46, 47 and 49 would each
    have to know which of the five exist in a given viewport state. Three names are true in every state.
  - **Checked at build start against story 45/03's own feature: there is NO collision, and it needs no
    change.** `stories/03_story_app-shell-and-entry/tasks/01_shell-regions.feature:8-14` already states
    the same mapping in terms (*"ADR-005 collapses R1–R3 into the contract name `chrome`, R4 into
    `content`, R5 into `overlay`, and requires the names to be IMPORTED CONSTANTS"*), and its Background
    binds to "the constants ADR-005 requires". Its five-row `Then` (*"their order is exactly: notice
    rail, top bar, surface bar, content, overlay"*) is an assertion about the model's yielded **rows**,
    not about the exported constant set. The two live at different altitudes on purpose.
- **The shell root is the viewport and the ONLY element that is `100dvh` with `overflow: hidden`.** The
  document and `body` never scroll. Consequence, and the reason it is in the contract: a surface can
  always derive its available height from the content region's own box.
- **`content` is a BOUNDED box with `min-height: 0`, and it does NOT scroll by default. SCROLL IS OWNED
  BY THE SURFACE.** The `min-height: 0` is load-bearing and non-obvious: a flex child defaults to
  `min-height: auto`, so an overflowing child silently grows the parent and every "size to the box"
  calculation is wrong in a way that only shows up with real content. Stating it here is most of the
  point of this ADR. The board scrolls its lanes and the fleet scrolls its list — inside the box, by
  their own choice; 46's terminal and 49's grid size to the box and do not scroll. A shell that scrolled
  its content region would force every non-scrolling surface to fight it.
- **Fullscreen is ONE mechanism, and the shell owns it.** A surface *asks* the shell to present a node;
  it does not build its own overlay. The shell owns the `overlay` region, the stacking order, `Escape`,
  the focus move and the restore. The request/present/dismiss transitions live as a pure state machine
  in `shell-layout.mjs` so `node:test` drives them headlessly, in the house pattern.
  - **[Build-1] BLOCKING — "present a node" GUARANTEES the occupant's INSTANCE AND DOM IDENTITY across
    present AND dismiss.** The shell **adopts a live node**; it does not render a copy of one. Presenting
    must not unmount, remount, re-create or re-key the occupant, and dismissing must return the *same*
    node to its host. This is the clause the ADR was missing, and it is the one m46 is blocked on.
    **Measured — both existing implementations exist for precisely this reason, and neither is an
    accident.** `ui/src/fleet/terminal-view/FleetTerminalView.tsx:247` **re-parents the live DOM host**
    on expand (`if (host.parentElement !== active) active.appendChild(host)`) rather than re-rendering
    it. `ui/src/board/TerminalDock.tsx:409-412` keeps the body **mounted and merely `hidden`** while
    collapsed, with `collapsed` deliberately EXCLUDED from the session effect's dependency list
    (`:280-281`) and the reason written out at `:138-141`: *"collapsing must NOT tear the session down —
    the WS/PTY stay alive … Only ✕ (onClose → unmount) ends the session. So `collapsed` is deliberately
    NOT a dependency."* Two independent surfaces, two different mechanisms, one shared requirement: **one
    xterm, one socket, one PTY, kept alive across a change of visual home.**
    **What this FORBIDS, named because it is the tidy-looking build:** presenting by rendering a React
    element into an overlay portal. React unmounts and remounts a subtree whose parent changes, so the
    session effect's cleanup runs — `TerminalDock.tsx:272-278`, `dataSub.dispose()`, `socket.close()`,
    `term.dispose()` — and the xterm is disposed, the WebSocket closed, the PTY and its scrollback gone.
    Fullscreen would then be the one gesture that kills the session it exists to enlarge.
    **What it leaves open, and the boundary it must respect.** Either mechanism satisfies the guarantee
    and the story picks one: **adoption** (re-parent the live host into the overlay, as the fleet does
    today) or **promotion in place** (leave the occupant mounted where it is and promote it to the
    fullscreen rung, as the dock's hide-don't-unmount does today). Either way the DOM work belongs to the
    shell **component** (`.tsx`); `shell-layout.mjs` stays the pure, framework-free state machine — which
    is not a style preference but the first assertion of `acd-shell-z-ladder-single-home`, which imports
    that module under plain `node`.
  - **[Build-1] The shell emits a POST-PRESENT LAYOUT TICK, and it is contract, not a story detail.** An
    occupant is not laid out on the tick it is presented, so a surface that sizes itself to its box must
    be told to re-measure one frame later — and again on dismiss, when the box changes back. Both
    implementations already do this and both had to discover it independently:
    `FleetTerminalView.tsx:265-268` runs `fit()` and then `requestAnimationFrame(fit)`, with the reason
    in the comment — *"the pane may not be laid out on the tick the host lands in it (the very first
    paint, or the frame the overlay mounts)"*. Putting the tick in the contract is what stops 46 and 49
    each re-deriving a one-frame defer against a shell they do not own, and getting it subtly different.
  - **[Build-2] The occupant MAY CLAIM `Escape`. The shell's `Esc` dismissal applies only when the
    occupant does not claim it — and the VISIBLE exit control is mandatory either way.** The shell still
    owns the key by default: an occupant that claims nothing is dismissed by `Esc`, exactly as story
    45/03's fullscreen scenarios assert. But an **interactive** occupant may declare `Escape` its own,
    and the shell must honour that.
    **Measured reason.** Milestone 46's terminal forwards stdin: `ui/src/board/TerminalDock.tsx:155` sets
    `disableStdin: false` and `:261-263` sends every keystroke straight down the socket
    (`term.onData(input => socket.send(input))`). `Esc` is therefore a live keystroke for the `claude`
    TUI on the far end. A shell that swallowed it would make the one key a TUI needs most mean "leave",
    and an operator pressing `Esc` to get out of insert mode would close their terminal instead.
    **Why this was invisible until now — it is an omission, not an oversight, and worth saying so.** The
    ONE fullscreen overlay that exists in the codebase today (`FleetTerminalView.tsx:412`) is
    **read-only** and dismisses **by button only**. There was no interactive occupant to collide with, so
    "the shell owns `Escape`" read as free. It stops being free the moment m46 lands.
    **The visible exit control is what makes the claim safe, and this is why DESIGN mandates both.** A
    presented state must carry a visible dismiss *and* answer `Esc`; for a claiming occupant the visible
    control is not redundancy, it is **the only remaining exit**, and it is non-negotiable. A claimed
    `Esc` may never leave an operator with no way out.
  - **REJECTED as the mechanism: the browser Fullscreen API (`requestFullscreen`).** It takes the whole
    browser chrome, so the app's own navigation disappears; it is permission/gesture-gated; and in the
    desktop app's webview it changes what the operator's window is. It may be offered later as an
    ADDITIONAL affordance layered on the shell's overlay — it is not the contract.
  - **REJECTED: each surface rolling its own `position: fixed; inset: 0` portal.** That is exactly how
    two z-index vocabularies and two `Escape` handlers appear, and it is the duplication milestone 46
    exists to delete, reintroduced one layer up.
- **[Amigos-5] The shell owns DESIGN's DG-45-2 z-ladder, it is declared in `shell-layout.mjs` beside
  the region names, and it gets a fitness function.** DESIGN fixes the five rungs — `sticky chrome`
  `z-10`, `popover` `z-20`, `dock` `z-30` (reserved for m46), `toast` `z-40`, `fullscreen` `z-50`
  **alone** — and states the closure rule: *"An element that needs a rung not on this list is a GAP
  whose fix is to add the rung here first."* The ladder is layout vocabulary, so it belongs in the same
  framework-free module as the region names, for the same reason: a rung typed as a class literal in a
  surface is a rung nobody can find.
  **Why it needed a ratchet rather than a scenario.** Story 45/03's own feature says, in terms, that it
  does *not* assert "no `z-50` literal survives anywhere else in `ui/src`" — so the gap closes in 03 and
  reopens the moment 46, 47 or 49 adds an overlay, and **49 is precisely the milestone that puts a
  surface fullscreen**. That is the Nth-instance case the codebase-health rule says to ratchet.
  Measured inventory, 2026-08-06 (DESIGN cites three `z-50`s; there are **four**):
  `Board.tsx:528` (dispatch toast → belongs on `toast`), `Board.tsx:568` (the milestone-switcher
  disclosure → `popover`), `BoardLanes.tsx:373` (the switcher listbox → `popover`), and
  `FleetTerminalView.tsx:412` (the fleet peek's own `fixed inset-0 z-50` portal). The `z-10`s
  (`main.tsx:318`, `Fleet.tsx:281`, `BoardLanes.tsx:181`) and the one `z-20` (`Fleet.tsx:360`) are
  already on their correct rungs and need no edit.
  **`FleetTerminalView.tsx:412` is a NAMED, shrink-only exemption, not an oversight.** It is a genuine
  violation of this ADR's own "no per-surface `fixed inset-0` portal" rule — and milestone 46 **deletes
  the file**. Forcing 45/03 to re-home a fullscreen overlay inside a component that is about to be
  removed would be work done twice. So it is carried on an explicit exemption list in the fitness
  function, with its reason and its retirement milestone attached, exactly as
  `acd-test-suite-registration` carries its unregistered baseline.
- **What milestone 46 may rely on — the contract, stated as a list, because a contract that has to be
  inferred from CSS is not one:**
  1. `content` is a bounded box whose height is derivable without measuring the document;
  2. `content` does not scroll unless the surface opts in;
  3. exactly one fullscreen mechanism exists, it is the shell's, and it covers `chrome`;
     - **[Build-1]** the presented occupant's **instance and DOM identity survive** present AND dismiss —
       one xterm, one socket, one PTY, through both transitions — and the shell emits a **layout tick**
       after each, so a fitted surface re-measures once its new box is live;
     - **[Build-2]** an **interactive occupant may claim `Escape`**; the shell's `Esc` dismissal applies
       only when it does not, and the visible exit control is mandatory in both cases;
  4. the region names are imported constants, not strings typed twice — **[Build-4]** and there are
     exactly **three** of them (`chrome` / `content` / `overlay`); DESIGN's R1–R5 are five visual ROWS,
     of which R1–R3 are interior structure of `chrome`;
  5. `chrome` offers a slot the routed surface may fill, so a surface-specific control (scope today,
     47's repo filter tomorrow) does not need its own bar;
  6. **[Amigos-5]** the z-ladder is closed and declared: `z-50` means "the shell's fullscreen occupant"
     and nothing else, and m46's docked terminal has `z-30` reserved for it already.
  7. **[Build-5]** the shell publishes the chrome height as ONE named CSS custom property,
     **`--aof-shell-chrome-height`** (DESIGN §"The shell's layout primitives" 1, `DESIGN.md:304-316`):
     set to the **measured** height of everything above the content region (R1 + R2 + R3), such that a
     height-constrained surface sizes itself `calc(100dvh - var(--aof-shell-chrome-height))` — in `dvh`,
     never `vh`, and **tracking the notice rail** when it stands (`DESIGN.md:126-127`). **The NAME and
     its meaning are contract; how the shell computes and sets it stays a story default.**
     **Measured reason it was promoted out of the story-default paragraph:**
     `ui/src/board/TerminalDock.tsx:120` clamps its drag-resize to
     `Math.round(window.innerHeight / 2)` — a clamp against the **viewport**, which under a shell is
     wrong by exactly the chrome height, so the dock can be dragged to a height that pushes its own
     content behind the bar. m46 cannot fix that with a story-local CSS choice; it needs a **named
     number** it can subtract. A primitive a downstream milestone binds to by name is not a reversible
     local default, which is the test this ADR applies to everything in this list.
  8. **[Build-3]** the `overlay` region is the home of **every out-of-flow layer**, and `z-30` on the
     ladder is the dock's rung — so m46's dock arrives with both a region and a number already reserved,
     and neither has to be invented under time pressure.
- **The CSS mechanism is a DOCUMENTED DEFAULT and is deliberately left to the story** — flex vs grid,
  how the three regions are composed, which element carries the sticky positioning, are reversible and
  local. **[Build-5] The `--aof-shell-chrome-height` custom property is NO LONGER an example on that
  list**: it moved up into the contract as point 7, because a downstream milestone binds to the name.
  What remains a story default is how the shell measures and sets it. The **eight** contract points above
  are not reversible. What would overturn the default: a surface that genuinely needs the chrome to
  scroll away on a small viewport, which is a product decision, not a layout one.

**Consequences.**
- 46 extracts one terminal control against a stable box and one fullscreen door, instead of against
  whichever page it happens to be mounted in.
- 49's grid gets the same guarantee for free, and `/`'s placeholder can be replaced without touching
  the shell.
- **[Amigos-5]** `acd-shell-z-ladder-single-home` fails CI if a `z-50` literal appears anywhere in
  `ui/src` outside the ladder module (bar the one named exemption), or if any `z-*` utility uses a rung
  the ladder does not declare — so the 46/47/49 reopening is caught by CI rather than by a reviewer's
  eye.
- `acd-mesh-ui-scope-visible` (m34/ADR-006) keeps its meaning: it asserts the scope control renders in
  the top-level shell mounted in EVERY page state. The shell's `chrome` slot is where that stays true
  after the move; the story must keep that test green, and the invariant — not its current file
  offsets — is the contract.
- **[Build-1] Story 45/03 must build the fullscreen slot as an ADOPTION (or a promotion in place), never
  as a render-into-a-portal — and this is a REVIEW obligation, stated here because the story's own
  feature cannot catch it.** 45/03's scenarios drive a PURE state machine, where instance identity is
  not observable at all; the violation is therefore invisible in 45 and fatal in 46. It is also not
  greppable, so it gets no fitness function here: the honest pin is a behavioural one in **m46**, where a
  real socket and a real PTY exist to survive the transition. Reviewers of 45/03: look for the adoption.
- **[Build-3] One DESIGN wording is FLAGGED TO THE DESIGNER as a to-amend, and is deliberately not edited
  here.** `DESIGN.md:240` describes `z-30` as the dock "in its in-flow/docked position", while
  `DESIGN.md:472` and `:527` both place the dock in the out-of-flow R5 overlay layer. ARCHITECTURE rules
  **R5 / out of flow** (above). The `:240` line should be reworded by its owner — an architect editing
  DESIGN in place is the two-homes-for-one-fact shape these ADRs keep refusing, and a decision recorded
  in someone else's document is a decision nobody can find.
- **[Build-1 … Build-5] `acd-shell-z-ladder-single-home` needs NO change, re-verified at build start.**
  That test asserts exactly four things: `ui/src/app/shell-layout.mjs` is loadable by plain `node`; it
  exports a ladder under one of four accepted names; the ladder's VALUES are exactly the five declared
  rungs (10/20/30/40/50); and no `z-50` — and no undeclared or arbitrary rung — appears anywhere in
  `ui/src` outside the ladder module, bar the one named `FleetTerminalView.tsx` exemption retiring with
  m46. None of these five amendments touches any of them: they add clauses about occupant identity, the
  layout tick, `Escape` ownership, a region's home, the region COUNT and a CSS custom property, and none
  of those is a stacking rung. **[Build-1] actively PROTECTS the test's first assertion** — keeping the
  identity-preserving DOM work in the shell component rather than in `shell-layout.mjs` is what keeps the
  module plain-node-loadable. Extra exports (the region constants, the chrome-height property name) are
  invisible to it: it selects the ladder export by name.

---

## ADR-006: The router is a PATH router: it reads exactly ONE query parameter (`mode`, only to delete it) and carries every other parameter and the fragment through UNTOUCHED; enforced in the single URL-building site inside `routes.mjs`, and `scope` keeps its existing ONE home in `ui/src/fleet/scope.mjs`

**Status:** Accepted
**Date:** 2026-08-06

**Context.** `?scope=` is a live deep-link contract with server-side consumers: `mesh-ui-serve.mjs:143`
advertises it, `queryGlobalMeshStatus` honours it, `ui/src/fleet/api.ts:279` sends it, and it has ONE
client-side home — the pure helpers `withScopeParam` (`ui/src/fleet/scope.mjs:42`) and `scopeFromSearch`
(`:50`), whose round-trip is already pinned behaviourally by `acd-mesh-ui-scope-visible`'s third
assertion. Milestone 47 adds a repo filter beside it and decides `scope`'s future; this milestone must
not touch either. The failure mode being engineered out is banal and common: a router that "normalises"
the query string and quietly drops the parameters it does not recognise, so a deep link works until the
moment it is redirected.

**Decision.**
- **The router matches on PATHNAME only.** The route table has no query-parameter conditions. The one
  query key `routes.mjs` may name is `mode`, and the only thing it may do with it is delete it during
  the legacy translation (ADR-003).
- **Every unrecognised query parameter is carried through, and the fragment is carried through
  VERBATIM.** This is enforced in ONE place — the single URL-building site inside `routes.mjs` (used by
  the legacy redirect and by any navigation helper the shell needs). It works by *copy the incoming
  `URLSearchParams`, delete `mode`* — never by constructing a fresh parameter set from a known list. A
  known-list builder is the drop-by-default shape; a copy-and-delete builder is preserve-by-default, and
  47 gets its repo filter working through the router for free, with no route change.
- **[Amigos-3] The passthrough claim is stated at the strength the mechanism actually delivers: every
  surviving parameter DECODES IDENTICALLY, IN ORDER, WITH THE SAME ENTRY COUNT — not byte-for-byte.**
  This ADR previously said "byte-identically", which the mandated mechanism cannot satisfy and which
  QA-01 measured in node: `URLSearchParams` **re-serialises** on `toString()`, so `q=a%20b` → `q=a+b`,
  an unencoded `/` in a value → `%2F`, and a value-less `debug` → `debug=`. Every one of those is the
  **same URL to every consumer** — same key, same decoded value, same position — and a different byte
  string.
  The alternative was rejected on sight: preserving raw bytes means doing text surgery on the query
  string, i.e. hand-rolling a query parser to find and excise exactly `mode=…` with its correct
  delimiter, in a module whose entire justification (ADR-001) is that it is small enough to be obviously
  correct. Trading a real parser for cosmetic byte-stability on a URL nobody diffs is a bad trade.
  **Order and entry count remain hard requirements** — `URLSearchParams` copy preserves insertion order
  — because those are what make a bookmark still *mean* the same thing, and what a test can honestly
  assert. `acd-route-logic-framework-free` therefore compares `[...searchParams.entries()]`, never the
  search string.
- **`scope` keeps its ONE home and the router does not import it.** `routes.mjs` never names `scope`,
  never validates it and never defaults it; `ui/src/fleet/scope.mjs` stays the sole owner. The router
  not knowing that `scope` exists is precisely what makes 47's change local to the fleet.
- **The fragment is never interpreted by the router.** `#ref` belongs to the board (`Board.tsx:585`).
  The router carries it and says nothing about it.

**Consequences.**
- `?mode=fleet&scope=global` → `/fleet?scope=global`, and `?mode=board#42/03` → `/board#42/03`, with
  `scope` and the fragment intact — the two shapes actually in the wild (the desktop constant and
  `board-url`'s return).
- 47 adds a repo filter with no edit to the route module.
- `acd-route-logic-framework-free` asserts the passthrough behaviourally over arbitrary extra
  parameters plus a fragment, and asserts structurally that `routes.mjs` names no query key but `mode`.

---

## Fitness functions

Five, each pinning a structural invariant an ADR above implies (this paragraph originally said "four";
[Amigos-5] added the fifth in prose and left this table un-recounted — corrected 2026-08-07, at the
same build-start pass as the [Build-N] amendments). All five are **expected-RED until the
stories land** — that is the house convention: an arch test written at refine time is part of the
contract, not a report on the present. Each file states its own red/green expectation at the top.

| file | pins | today |
|---|---|---|
| `test/arch/acd-ui-single-route-table.test.mjs` | ADR-001/002 — ONE route table; the render root selects via `routes.mjs` and by nothing else; the entry imports surfaces and defines none | **4 RED**, 1 green (self-check) |
| `test/arch/acd-no-surface-mode-url-literal.test.mjs` | ADR-002/003 — no `?mode=` literal in any advertised-URL producer across `src/`, `ui/src`, `app/desktop`; the route module is the ONE allowed mention | **2 RED**, 1 green (self-check) |
| `test/arch/acd-spa-fallback-never-masks.test.mjs` | ADR-004 — one shared module imported by both servers; the fallback never shadows `/api/*` and never masks a missing asset (driven against the REAL `serveSetupUi` handler); `safeStaticPath` defined exactly once | **5 RED** |
| `test/arch/acd-route-logic-framework-free.test.mjs` | ADR-001/006 — the route module is React-free, DOM-free and `node:test`-loadable; the legacy redirect preserves every other parameter and the fragment, and is idempotent | **5 RED** |
| `test/arch/acd-shell-z-ladder-single-home.test.mjs` | ADR-005 [Amigos-5] — the z-ladder has ONE home in `shell-layout.mjs`; no `z-50` or undeclared rung anywhere else in `ui/src` (one named, shrink-only exemption retiring with m46) | **2 RED**, 1 green (declared-rung sweep) |

18 assertions red, 3 green. The green ones are the **self-checks** and the declared-rung sweep, green on purpose:
each runs its detector over the REAL pre-45 source lines (including the `?mode=` links that live inside
`http://…` literals, which a naive comment-stripper would swallow) and over the innocent look-alikes
(`ui/src/board/runs.mjs:116`'s `mode: "fresh"`, and the five source comments that narrate the legacy
form in prose). So non-vacuity is proven **today**, not asserted for later.

**Satisfiability was verified, not assumed.** A fitness function that can never go green is worse than
none. Throwaway prototypes of the two pinned modules (`src/static-serve.mjs`, `ui/src/app/routes.mjs`),
the two servers' import + fallback wiring, and the `safeStaticPath` de-duplication were written, the
suites run — **every one of the 16 green** — and the prototypes then reverted. The contract is
buildable exactly as written; the two `ui/` assertions that need the `main.tsx` split were not
prototyped (they are satisfiable by construction — a file move).

All five are registered in `scripts/test.mjs`, per m43/ADR-014 E7 (`acd-test-suite-registration`, which
is re-run and green) — an unregistered suite is no gate at all, including a red one nobody can see.

---

## Codebase health (measured this refine, and where each finding is routed)

Measured 2026-08-06 at `eacbd57`, against TECH_DEBT items 10 and 18's own baselines:

| Signal | earlier baseline | 2026-08-06 | Trend |
|---|---|---|---|
| `src/` `.mjs` files | 202 (08-01) | **213** | +5% in five days |
| `src/` root-level `.mjs` | 108 (item 10) | **108** | flat — half the tree is still one directory |
| `src/` lines | 50,744 (08-01) | **55,705** | +10% |
| `ui/src` files | 53 (43/04) | **54** | +1 |
| `ui/src` lines | — | **10,887** | — |
| `ui/src/main.tsx` | — | **1,267** | the entry file IS a surface |
| `ui/src/fleet/Fleet.tsx` | 1,521 (43/04) | **1,532** | under its 1,560 ratchet, with 28 lines of headroom |
| `ui/src/board/DetailPanel.tsx` | 1,123 (43/04) | **994** | m43's required `ProvenanceLine` extraction landed — the ratchet worked |

Four findings, each routed:

1. **`ui/src/main.tsx` is 1,267 lines and is BOTH the application entry and the config-editor surface.**
   The render root (`:1261-1266`) is the last six lines of a file whose other 1,260 lines are `<App>`.
   With a router this stops being merely untidy and becomes structurally wrong: the entry must select a
   surface, and it cannot credibly do that from inside one of them. **Route: refactor REQUIRED of this
   milestone**, and it is small and mechanical — `<App>` moves to `ui/src/config/App.tsx` (its route's
   name, ADR-002) and `main.tsx` becomes the thin entry: mount, apply `legacyRedirectFor`, render the
   shell. This is a MOVE, not a re-skin, so SPEC's "re-skinning the config editor is out of scope"
   is honoured exactly. `acd-ui-single-route-table`'s "the entry defines no surface" assertion is the
   ratchet that keeps it true.
2. **`ui/` still has no shared layer (TECH_DEBT item 18a), and this milestone is the first thing that
   has ever needed one.** `ui/src/fleet/` reaches into `ui/src/board/` seven times because `board/` is
   the de-facto shared library that nothing declares. The shell, the route table and the layout
   primitives are shared by construction — every surface mounts inside them. **Route: partially paid
   here, and the payment is bounded.** The shell and router land in a NEW `ui/src/app/`, which is
   neither surface's folder; that is the correct home and it establishes the layer TECH_DEBT 18a asks
   for. What this milestone does **NOT** do is migrate the seven existing `fleet → board` imports —
   that is 18a's own fix, it touches every importer, and dragging it into a routing milestone is the
   scope explosion the health rule warns against. **TECH_DEBT item 18 stays open**, with its (a) half
   now half-built: the folder exists, the migration does not. A story here that puts a shared primitive
   into `board/` or `fleet/` instead of `app/` should be refused at review.
3. **`safeStaticPath` — the directory-traversal guard in front of both static roots — is defined TWICE
   and the copies are byte-identical** (`setup-ui.mjs:269-280`, `mesh-ui-serve.mjs:873-884`; `diff`
   exit 0). This is TECH_DEBT item 0.2's shape ("the same fact derived independently") landing on a
   *security* rule: hardening one copy leaves the other origin unprotected, and nothing would say so.
   It was found by reading both handlers side by side, which ADR-004 requires anyway. **Route: refactor
   REQUIRED of this milestone** — it moves into `src/static-serve.mjs` beside the fallback predicate
   (ADR-004), which is a deletion plus an import at each of the two sites this milestone already edits.
   `acd-spa-fallback-never-masks` asserts the single definition.
4. **`src/static-serve.mjs` adds a 109th flat root-level module to `src/` (TECH_DEBT item 10).** Named
   rather than hidden. It is justified by ADR-004's one-home argument — the alternative is the rules
   living in two servers — it is a **pure leaf with zero imports**, and it is net **line-negative** in
   `src/` because it deletes one of the two `safeStaticPath` copies. **Route: no refactor required, no
   new debt entry** (item 10 already owns this trend). Consistent with m43's ruling on the same
   question: a root-file-count ceiling imposed by an unrelated milestone would fail CI for reasons that
   have nothing to do with the diff that trips it.

Nothing new is written to `wiki/work/TECH_DEBT.md` by this refine: findings 1 and 3 are required of
this milestone, finding 2 is already item 18, finding 4 is already item 10.

---

## Story-boundary guidance (input to the PO's break-down — not a partition)

Story boundaries are drawn with the PO. These are the seams the ADRs above create, with the coupling
that decides them, offered as input:

- **The server-side fallback (ADR-004) is fully independent of everything else here.** It is
  `src/static-serve.mjs` plus two call sites (and the `safeStaticPath` de-duplication that rides with
  it), it ships value on its own (`/board` stops 404ing on refresh; a missing asset stops arriving as
  HTML on the fleet), and it touches no `ui/` file. Graph-cited:
  `board-serve.mjs ← commands/work-ui.mjs` and `mesh-ui-serve.mjs ← commands/mesh-ui.mjs` — one
  command-layer entry each, no shared dependent. **First and parallel-eligible.**
- **The route module (ADR-001/003/006) is a pure leaf and is testable before anything renders it.** It
  can land, be fully exercised by `node:test`, and be imported by nothing — a zero-blast-radius stage,
  the same shape m43/ADR-005 used for its seam.
- **The shell + entry rewrite (ADR-002/005) is the one story with real breadth**, because it carries the
  `main.tsx` split (health finding 1) and the four surfaces' mounting. It depends on the route module
  and on nothing else.
- **The advertised-URL migration (ADR-002's consequence) is a leaf per producer** — `board-serve`,
  `mesh-ui-serve`, `assets-ui`, `supervisor.rs`, three in-app links — each independently revertible,
  each with a named behavioural test to update alongside it (enumerated in ADR-003's consequences).
  It must land AFTER the entry can serve the new paths and BEFORE `acd-no-surface-mode-url-literal`
  can go green.

The cross-story dependency to keep an eye on is exactly one: everything in `ui/` waits on the route
module, and nothing in `src/` waits on anything.
