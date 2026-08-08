# 45 · UI app shell & path routing — Outcome

<!--
  OUTCOME.md — what this item now delivers, the assumptions that delivery rests on, and the gaps it
  declared but did not fill. Authored EXCLUSIVELY by aof:verify at Accept (ADR-004) — never at insert,
  never by a developer/evidence subagent (verify owns record docs). States product STATE ("the system
  now IS X"), never motive ("we built X because Y" — that reasoning belongs in RETROSPECTIVE.md). This
  is an ADDITIONAL artifact: it carries no identity frontmatter and is never this item's record doc.
-->

## Delivered

### Real URL paths
`/`, `/fleet`, `/board` and `/config` are the four addresses of the application; the render-root
`?mode=` ternary no longer exists. One frozen table in `ui/src/app/routes.mjs` is the only thing that
maps an address to a surface, and `acd-ui-single-route-table` is the only place that fact lives.

### A shared application shell
Every surface mounts inside `<Shell>`, which renders five named regions (notice rail, top bar, surface
bar, content, overlay), publishes its measured height as `--aof-shell-chrome-height`, and owns one
z-ladder, one skip link, one `banner` and one `<main>`. Chrome measures 48px at 1280 and exactly 88px
at 768 and below; at the desktop app's 760×520 window the content region is exactly 432px.

### Navigation between the surfaces
A four-item nav, driven by the route table, is present on every route and on every origin; the active
surface is identifiable from its rule and weight with colour removed. At 390 the nav collapses to a
disclosure labelled with the active surface — or `Surfaces ▾` where no route matched.

### Chrome that stays put while a surface scrolls
The chrome block is pinned, so the top bar and the navigation remain on screen through a page scroll
on `content:page` routes. DESIGN GAP D1's page-level horizontal clamp is `overflow-x: clip` on `html`
and `body` — it clamps without establishing a scrollport, so the pin resolves against the document.

### A history fallback on both static origins
A client-side path that is deep-linked or refreshed renders instead of 404ing, on the board and
config-editor origins as well as the fleet's. `src/static-serve.mjs` is the single home of the
traversal guard, the MIME table and the fallback predicate; the guard runs before the predicate
unconditionally, so a refused path is a 404 and never the shell.

### Paths as the only advertised address
Every producer that hands an operator a URL — the board, fleet and config-editor launchers (announce
line and `--json` probe), `GET /api/mesh/board-url`, the desktop tray's compiled constant, and the
in-app cross-links — emits an ADR-002 path. No surface URL in `ui/`, `src/` or `app/desktop/` contains
`mode=`, and `acd-no-surface-mode-url-literal` sweeps a closed route-path vocabulary over 295 files so
a fifth producer cannot appear unseen.

### Every legacy address still opens what it always opened
A `?mode=` URL is translated once, client-side, as a `replaceState` onto its canonical path, with the
query and fragment carried through unaltered. Back returns to wherever the operator was before, never
to the legacy form. The bare `/` on the board origin now renders the shell landing; it previously
rendered the config editor, and it is the one URL whose meaning changed.

### A surface that fails takes down only itself
A surface that throws while rendering is contained at the shell boundary and rendered as the shell's
`failed` state, with the chrome, the navigation and a retry intact. A surface reached on an origin
that cannot serve its API degrades through its own error state: the config editor states the failure,
names the command that opens it on its own origin, and offers a retry.

## Assumptions

- **The route table is hand-rolled, not a router library** — the four-route flat table has no nested
  routes, no route parameters and no data loaders; a fifth route with any of those overturns ADR-001.
- **Paths are case-sensitive and lowercase-canonical, and a trailing slash is matched in place** —
  `/fleet/` resolves to `fleet` without a rewrite, so ADR-002's no-redirect rule holds.
- **The origins stay separate** — `/` and `/fleet` are the fixed `:4181` fleet server, the board is a
  per-workspace server on an ephemeral port, the config editor is the `setup-ui` origin. Routing is
  origin-blind: every origin serves every path, and a surface reached from an origin that cannot serve
  its API degrades rather than working.
- **`--aof-shell-chrome-height` is the one number a height-constrained surface subtracts** — the
  432px content floor at 760×520 is met exactly, so the budget has no headroom for a third chrome row.
- **The desktop tray's entry URL is a compiled Rust constant** — changing it requires a Windows
  `--desktop` cargo build, and a previously shipped binary's legacy URL keeps working only because
  ADR-003's translation has no expiry.
- **The shell renders no motion** — route changes are full page loads and are instant, so a screenshot
  is a complete lock on the shell's appearance.

## Gaps

### The nav's cross-origin honesty rule has no producer
- **Status:** open
- **Discharge condition:** a production caller passes `resolvable` for every nav destination, and a
  render shows the dashed / `aria-disabled` / `title` treatment on a genuinely unresolvable item.

DESIGN requires that an item whose destination cannot be resolved from the current origin must not
render as a live link. The unavailable treatment is built and unit-tested in `shell-nav.mjs`, but the
entry passes no `resolvable`, so every nav item renders as a live link on every origin — measured
across all 34 conformance renders. Following `Board` from the fleet origin therefore lands on a
surface that cannot load its stream. Recorded as DG-45-5 at the rule itself; owned by milestone 47.

### The origin-mismatch state has two visual languages
- **Status:** open
- **Discharge condition:** every route's origin-mismatch state renders in one language, evidenced by a
  render showing `/config`-on-fleet and `/board`-on-fleet side by side.

`/config` reached from the fleet origin renders a centred accent pill naming the failure, the recovery
command and a retry. `/board` reached from the same origin renders a bare red sentence, top-left, with
no headline, no glyph and no recovery command — carrying the failure by colour alone. Recorded as
DG-45-4; expected to close with DG-45-5 in milestone 47.

### The config editor's sidebar repeats the shell's identity
- **Status:** open
- **Discharge condition:** the first milestone that has `<App>`'s views legitimately in scope drops the
  sidebar's 40px mark and `AOF` wordmark, keeping the config name.

On `/config` the shell's 24px mark, `aof` wordmark and identity chip are repeated immediately below by
the editor's own 40px mark, `AOF` wordmark and project name. It is worst at 390 and 760×520, where the
sidebar's mark is larger and higher-contrast than the shell's own. Recorded as DG-45-3.

### The shell's fullscreen door has no caller
- **Status:** open
- **Discharge condition:** milestone 46's terminal presents an occupant through `requestFullscreen`.

`shell:fullscreen` is built, modelled and tested — one named slot, one occupant, chrome hidden rather
than overlaid, `Esc` plus a visible exit, and DOM-identity preservation across present and dismiss —
but nothing in `ui/src/` calls `requestFullscreen`. It is built to milestone 46's stated requirements
and unexercised until then.

### The traversal guard is lexical
- **Status:** open
- **Discharge condition:** the guard contains by resolved real path (`fs.realpath`), with the rows that
  pin it.

`safeStaticPath` refuses a path that escapes the served root lexically, so a symlink that lives inside
the root and points outside it is admitted and followed. It is not client-reachable, and the behaviour
is identical to both pre-move copies — the story mandated a verbatim move. Ledgered as TECH_DEBT
item 23.

### `BoardsRegion` renders empty on the shipped fleet surface
- **Status:** open
- **Discharge condition:** the fleet face's status payload carries a `boards` key, or the region is
  removed.

The fleet's boards region has had no data since milestone 34 / ADR-006, so one migrated cross-link is
operator-unreachable. Pre-existing, unchanged by this milestone, and recorded on milestone 47's STATE
as the receiving side.
