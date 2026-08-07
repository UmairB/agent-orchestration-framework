// THE APP SHELL (milestone 45 / story 03; ADR-002 and ADR-005 with its five [Build-N]
// amendments; DESIGN §Surface 1's binding checklist).
//
// The chrome the four routed surfaces mount inside. It renders DESIGN's five rows in one
// declared order — R1 notice rail, R2 top bar, R3 surface bar, R4 content (the ONE `<main>`
// and the one mount point), R5 overlay — publishes the measured chrome height as one CSS
// custom property, and owns the navigation, the not-found state and the single fullscreen
// door.
//
// WHAT IS *NOT* HERE, ON PURPOSE. Every decision this file makes is read from
// ui/src/app/shell-layout.mjs and ui/src/app/shell-nav.mjs — the region order and heights, the
// chrome-height model and its budget verdict, the content modes, the z ladder, the nav items
// and their hrefs, the fullscreen transitions. This component contributes the DOM and nothing
// else. That split is not tidiness: this repo has no React test harness for layout decisions,
// so a rule that lives in JSX is a rule nothing can check, and milestones 46/47/49 all bind to
// those modules by name.
//
// WHAT IS ONLY HERE, ALSO ON PURPOSE ([Build-1]). Presenting a surface fullscreen ADOPTS a
// LIVE DOM NODE — the shell re-parents it into a dedicated, React-childless host inside the
// overlay region, and returns the SAME node to its home on dismiss. It never renders a copy of
// one. The tidy-looking build (render a React
// element into an overlay portal) unmounts and remounts the subtree, so a terminal's session
// effect cleans up — `dataSub.dispose()`, `socket.close()`, `term.dispose()` — and fullscreen
// becomes the one gesture that kills the session it exists to enlarge. Reviewers: this is the
// adoption ADR-005's Consequences tell you to look for.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import type { RouteId } from "./routes.mjs";
import {
  BRAND_MARK,
  CHROME_HEIGHT_PROPERTY,
  CONTENT_REGION_ID,
  NOTICE_RAIL_CLASS,
  SHELL_CARD_CLASS,
  SHELL_CARD_WRAPPER_CLASS,
  STATE_FAILED,
  STATE_MOUNTING,
  STATE_NOT_FOUND,
  SURFACE_BAR_CLASS,
  TOP_BAR_CLASS,
  WORDMARK,
  Z_LADDER,
  chromeModel,
  contentModeFor,
  contentStateFor,
  fullscreenReducer,
  fullscreenState,
  presentedStateModel,
  surfaceBarStands,
  type FullscreenState,
} from "./shell-layout.mjs";
import { NAV_FORM_DISCLOSURE, navModel, type NavItem, type NavResolvable } from "./shell-nav.mjs";
import {
  SLOT_NOTICE,
  SLOT_SURFACE,
  attachFullscreenHost,
  attachShellHost,
  contributionFor,
  declareShellPresent,
  type FullscreenRequest,
} from "./shell-bus.mjs";
import { Landing } from "./Landing";

// A shell EXISTS in this bundle. Declared at module scope, not in an effect: a routed surface
// asks this question while rendering its own controls — before any parent effect has run — so
// an effect-time flag would make every surface render its bar contents in place on the first
// pass and then move them, which binding rail 2 ("nothing in the shell moves") forbids.
declareShellPresent();

// The documented neutral identity, inherited verbatim from the fleet's own rule
// (Fleet.tsx's `useGroupName`: `?group=` else the neutral default). The chip NEVER renders
// blank — an empty chip reads as a loading state.
const NEUTRAL_IDENTITY = "fleet";

export interface ShellProps {
  // The route the entry resolved through ui/src/app/routes.mjs, and the address it resolved it
  // from (post-rewrite). The shell is handed the answer; it does not re-derive it, because a
  // second surface selector is exactly what `acd-ui-single-route-table` forbids.
  routeId: RouteId;
  address: { pathname: string; search: string; hash: string };
  // The mounted surface, or null on a route the shell renders itself (`/` and not-found).
  surface?: React.ReactNode;
  // The two states today's bundle cannot produce and milestone 49's code-split surfaces will:
  // a surface whose module is still in flight, and one whose module failed to load. They are
  // props rather than internal state so the shell's own four content states are all real,
  // renderable and drivable rather than three real ones and two paragraphs of DESIGN.
  surfaceLoaded?: boolean;
  surfaceFailed?: boolean;
  onRetry?: () => void;
  // Per-destination resolvability, for the origin probe milestones 47/49 add. Absent means
  // resolvable, which is ADR-002's origin-blind ruling: one bundle, one table, and ADR-004's
  // history fallback serves the shell for every extension-less path on all three origins, so
  // every nav link genuinely lands on its surface — one reached on an origin that cannot serve
  // its API degrades through its OWN existing error state.
  resolvable?: NavResolvable;
  // Test seams. The shell reads the real ones from `window`/the DOM when they exist.
  //
  // `noticeHeight` is the third of them and is here for the same reason as the other two: the
  // published `--aof-shell-chrome-height` GROWS by the notice rail's MEASURED height, and a
  // headless harness has no layout — `getBoundingClientRect()` is not a thing a mini-React
  // tree has. Without a seam, the one coupling m46's dock binds to (rail stands → the published
  // number grows → the budget verdict changes) was only assertable on the pure model, never
  // through the component that actually publishes it. Supplied, the measurement is skipped
  // entirely, exactly as `viewportWidth` skips the resize listener.
  viewportWidth?: number;
  identity?: string | null;
  noticeHeight?: number;
}

export function Shell({
  routeId,
  address,
  surface = null,
  surfaceLoaded = true,
  surfaceFailed = false,
  onRetry,
  resolvable,
  viewportWidth: viewportWidthProp,
  identity: identityProp,
  noticeHeight: noticeHeightProp,
}: ShellProps) {
  const measuredWidth = useViewportWidth(viewportWidthProp);
  const viewportWidth = viewportWidthProp ?? measuredWidth;
  const identity = useOriginIdentity(identityProp);

  // The surface's own contributions. A re-publish bumps this tick; the nodes themselves are
  // read straight back off the bus, so the shell never holds a stale copy of one.
  const [, setContributionTick] = useState(0);
  useEffect(() => attachShellHost(() => setContributionTick((tick) => tick + 1)), []);
  const slotNode = contributionFor(SLOT_SURFACE);
  const noticeNode = contributionFor(SLOT_NOTICE);

  const fullscreen = useFullscreenSlot();
  const presenting = fullscreen.state.status === "presenting";
  const presented = presentedStateModel(fullscreen.state);

  const surfaceBar = surfaceBarStands({ viewportWidth });
  const contentMode = contentModeFor(routeId);
  const state = contentStateFor({ routeId, surfaceLoaded, surfaceFailed });

  const nav = useMemo(
    () => navModel({ address, viewportWidth, resolvable }),
    [address, viewportWidth, resolvable],
  );

  // R1's height is MEASURED, never assumed: the board's `serverGone` strip is a ~145-character
  // sentence at `px-4 py-2 text-xs`, so it is one line at 1280 and three at 390. A rail height
  // the shell guessed would be wrong by exactly the amount that makes a fitted terminal
  // overflow.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const viewportHeight = useViewportHeight();
  const noticeHeight = useMeasuredNoticeHeight(noticeNode, noticeRef, noticeHeightProp);
  const chrome = chromeModel({
    viewportHeight,
    viewportWidth,
    notice: noticeNode ? { height: noticeHeight } : null,
    surfaceBar,
    fullscreen: presenting,
  });

  // Contract point 7 ([Build-5]) — ONE published number, under ONE name, in `dvh`. m46's dock
  // clamps its drag-resize against the viewport today, which under a shell is wrong by exactly
  // this height; it needs a named number it can subtract.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof root.style?.setProperty !== "function") return;
    root.style.setProperty(CHROME_HEIGHT_PROPERTY, chrome.value);
  }, [chrome.value]);

  return (
    <div
      ref={rootRef}
      // The shell root IS the viewport and the ONLY element that is 100dvh with hidden
      // overflow in `content:fixed`; the document and body never scroll. DESIGN GAP D1's
      // `overflow-x: hidden` backstop stays in index.css and is not removed here.
      className={`${contentMode.rootClass} overflow-x-hidden bg-background text-foreground`}
      style={{ [CHROME_HEIGHT_PROPERTY]: chrome.value } as React.CSSProperties}
      data-shell-chrome-height={chrome.value}
      data-shell-budget={chrome.verdict}
    >
      {/* The skip link is the FIRST focusable element in the document, targeting the content
          region's id (WCAG 2.1 AA 2.4.1) — the direct cost of the chrome this milestone
          introduces. DESIGN lists it as R2's first item and it is rendered just OUTSIDE the
          `<header>` instead, for two reasons a reviewer should meet rather than discover: it
          must be first in the DOCUMENT (a banner child is first only while the banner is the
          first thing in the document), and it must survive the chrome being HIDDEN while an
          occupant is presented fullscreen, which is exactly when a keyboard user most needs a
          way into the content region. Visually and in focus order it is unchanged. */}
      <a
        href={`#${CONTENT_REGION_ID}`}
        // `focus:z-20` is the ladder's `popover` rung — the skip link is a transient thing that
        // must sit above the sticky chrome (z-10) while it is focused, and nothing more.
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-1.5 focus:text-sm"
      >
        Skip to content
      </a>

      {presenting ? null : (
        <div className="shrink-0">
          {/* R1 — the notice rail: full-bleed, above everything, contributed BY the surface,
              zero-height when empty (never a reserved blank band, which would cost every
              surface ~33px for a condition that is almost never true). It PUSHES the chrome
              down rather than overlaying it, and nothing yields to it. */}
          {noticeNode ? (
            // The rail's height is MEASURED off this very element, through the ref — never
            // found again with a `document.querySelector` for its own `data-shell-row`. The
            // query was a second way to name one node, and it would have found the WRONG one
            // the moment m46's dock puts a second shell-rowed element in the tree.
            //
            // Past the 25% bound it scrolls INSIDE ITSELF with its first line pinned; the rule
            // is NOTICE_RAIL_CLASS's, spelled once in shell-layout.mjs beside the fraction it
            // implements.
            <div ref={noticeRef} data-shell-row="notice-rail" className={NOTICE_RAIL_CLASS}>
              {noticeNode}
            </div>
          ) : null}

          {/* R2 — the top bar. `banner`, 48px, never scrolls out of view. */}
          <header
            data-shell-row="top-bar"
            // `TOP_BAR_CLASS`, never a retyped `h-12`: the bar's height is a number three
            // downstream milestones subtract from the viewport, and it had two homes.
            className={`sticky top-0 z-10 flex ${TOP_BAR_CLASS} shrink-0 items-center gap-3 border-b border-border bg-card px-4`}
          >
            <span className={BRAND_MARK.className} aria-hidden="true">
              {BRAND_MARK.glyph}
            </span>
            <span className="text-sm font-bold tracking-tight">{WORDMARK}</span>
            <IdentityChip identity={identity} />
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <Nav nav={nav} />
            {/* The surface slot: right-anchored, yielded AFTER the nav, so its contents grow
                leftward and can never displace the navigation. */}
            {surfaceBar ? null : (
              <span data-shell-slot="top-bar" className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                {slotNode}
              </span>
            )}
          </header>

          {/* R3 — the surface bar. The slot MOVES; its contents never change form, and it does
              not disappear when the notice rail is standing. */}
          {surfaceBar ? (
            <div
              data-shell-row="surface-bar"
              // `SURFACE_BAR_CLASS`, for the same reason the header takes `TOP_BAR_CLASS`:
              // R3's 40px is summed into the published chrome height, and a retyped `h-10`
              // here would be a second home for it.
              className={`flex ${SURFACE_BAR_CLASS} shrink-0 items-center gap-3 border-b border-border bg-card px-4`}
            >
              <span data-shell-slot="surface-bar" className="ml-auto flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                {slotNode}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {/* R4 — the content region: the one `<main>` and the one mount point. `min-h-0` is
          load-bearing (a flex child defaults to `min-height: auto`, so an overflowing child
          silently grows the parent and every "size to the box" calculation is wrong in a way
          that only shows up with real content). The shell adds no wrapper padding, no
          max-width and no background of its own — every surface already sets its own. */}
      <main id={CONTENT_REGION_ID} tabIndex={-1} className={contentMode.contentClass} data-shell-row="content">
        {state.state === STATE_NOT_FOUND ? (
          <NotFound address={address} />
        ) : state.state === STATE_MOUNTING ? (
          <MountPlaceholder routeId={routeId} />
        ) : state.state === STATE_FAILED ? (
          <SurfaceFailed routeId={routeId} onRetry={onRetry} />
        ) : routeId === "landing" ? (
          <Landing destinations={nav.items.filter((item) => item.id !== "landing")} />
        ) : (
          surface
        )}
      </main>

      {/* R5 — the overlay layer: out of flow, a SIBLING of content so a fullscreen occupant
          covers the chrome without a stacking-context fight, and ([Build-3]) the home of every
          out-of-flow layer — m46's dock, toasts, and the one `shell:fullscreen` occupant. */}
      <div data-shell-row="overlay">
        <div
          ref={fullscreen.overlayRef}
          data-shell-fullscreen={presenting ? "presenting" : "empty"}
          // The fullscreen rung is taken from the LADDER rather than retyped as a class here —
          // the top rung means the shell's fullscreen occupant and nothing else, and the one
          // place that number is spelled is ui/src/app/shell-layout.mjs (DG-45-2, and the
          // ratchet `acd-shell-z-ladder-single-home` keeps it that way).
          style={presented ? { zIndex: Z_LADDER.fullscreen } : undefined}
          className={presenting ? "fixed inset-0 flex flex-col bg-background" : "hidden"}
          role={presented ? presented.role : undefined}
          aria-modal={presented ? true : undefined}
          aria-label={presented ? presented.ariaLabel : undefined}
        >
          {presented ? (
            <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2 text-sm">
              <span className="font-semibold">{presented.ariaLabel}</span>
              {/* Exit is `Esc` AND a visible control, always — and for an occupant that has
                  claimed `Escape` ([Build-2]) this control is the ONLY remaining exit, which is
                  what makes the claim safe. It sits at the same `ml-auto` anchor as the control
                  that entered fullscreen, so the eye does not have to search for the way out. */}
              <button
                type="button"
                onClick={fullscreen.dismiss}
                className="ml-auto rounded-md border border-border px-2 py-1 text-xs font-semibold transition hover:border-primary/50"
              >
                ✕ Exit fullscreen
              </button>
            </div>
          ) : null}
          {/* THE ADOPTION HOST — its own element, and React renders NOTHING into it, ever.
              The adopted node is imperative DOM inside a React tree, so the two must not share
              a parent: React reconciles by POSITION among a parent's children, and `appendChild`
              puts the occupant after whatever React last rendered there. Today that is one
              header and the ordering happens to work; the moment [Build-3]'s overlay region
              gains a second React child (m46's dock is the named next occupant of this very
              region) the occupant would be inserted after it, or re-parented under it, or
              removed by a reconciliation that believes it owns the slot. A childless host makes
              the boundary structural instead of incidental. */}
          {presented ? <div ref={fullscreen.hostRef} data-shell-fullscreen-host="" className="min-h-0 flex-1" /> : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────── the top bar bits ─

// The ORIGIN identity chip — a LABEL, never a control (making it a workspace switcher is a
// different milestone). It never renders blank: while the name is unknown it renders a
// SAME-SIZED pulse block rather than a collapsed chip that would then push the nav sideways.
// The `ch` unit is honest here precisely because the chip is `mono`.
function IdentityChip({ identity }: { identity: string | null }) {
  if (identity === null) {
    return (
      <span
        className="mono h-5 min-w-[7ch] max-w-[18ch] animate-pulse rounded-md border border-border bg-muted px-2 py-0.5 text-xs"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="mono min-w-[7ch] max-w-[18ch] truncate rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      title={identity}
    >
      {identity}
    </span>
  );
}

// `<nav aria-label="Surfaces">` — real `<a href>` links in a real landmark, never `<button>` +
// pushState: middle-click, Ctrl-click and "copy link address" must all work, and the entire
// milestone exists so that the address is worth copying. Everything below is read off the nav
// model; this component chooses nothing.
function Nav({ nav }: { nav: ReturnType<typeof navModel> }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  if (nav.form === NAV_FORM_DISCLOSURE) {
    const disclosure = nav.disclosure!;
    return (
      <nav aria-label={nav.landmark.ariaLabel} className="relative -mb-px flex h-full items-center">
        <button
          ref={trigger}
          type="button"
          aria-haspopup={disclosure.ariaHasPopup}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            trigger.current?.focus?.();
          }}
          className={disclosure.className}
        >
          <span>{disclosure.label}</span>
          <span className="text-muted-foreground" aria-hidden="true">
            {disclosure.caret}
          </span>
        </button>
        {open ? (
          <div role="menu" className="absolute left-0 top-full z-20 mt-1 w-44 rounded-md border border-border bg-card p-1 shadow-lg">
            {disclosure.items.map((item) => (
              <NavLink key={item.id} item={item} className="flex w-full items-center px-2 py-1.5 text-sm" />
            ))}
          </div>
        ) : null}
      </nav>
    );
  }

  return (
    <nav aria-label={nav.landmark.ariaLabel} className="-mb-px flex h-12 items-center gap-4">
      {nav.items.map((item) => (
        <NavLink key={item.id} item={item} className="flex h-12 items-center px-1 text-sm" />
      ))}
    </nav>
  );
}

// One nav item. An UNAVAILABLE destination is present, marked and explained — never a dead
// `href` that dead-ends here — and it stays FOCUSABLE (`tabIndex={0}`), because an item skipped
// by the keyboard hides its explanation from exactly the users who need it.
function NavLink({ item, className }: { item: NavItem; className: string }) {
  const shared = `${className} ${item.marking.className}`;
  if (item.href === null) {
    return (
      <span
        // Read off the MODEL, never retyped as a literal `"true"` here: `aria-disabled` is
        // reserved for UNAVAILABLE, and an item whose probe has not answered (UNKNOWN) also
        // has no `href` while being emphatically not disabled (PO ruling on QA F-45-03-C).
        // Hard-coding it here is precisely how the model's distinction stops being true of
        // the document.
        aria-disabled={item.ariaDisabled ?? undefined}
        tabIndex={0}
        title={item.title ?? undefined}
        data-nav-item={item.id}
        data-nav-availability={item.availability}
        className={shared}
      >
        {item.label}
      </span>
    );
  }
  return (
    <a
      href={item.href}
      aria-current={item.ariaCurrent ?? undefined}
      data-nav-item={item.id}
      data-nav-availability={item.availability}
      className={shared}
    >
      {item.label}
    </a>
  );
}

// ──────────────────────────────────────────────── the shell's own three states ─

// NO ROUTE MATCHED. The URL is not rewritten, the nav is right there so recovery is one click,
// and NOTHING is marked active — none is, and marking one would lie about where you are. It is
// NOT `accent` and NOT `destructive`: nothing failed, the path simply is not a surface, and
// dressing it as an error teaches an operator to distrust their own address bar.
//
// IT NAMES THE WHOLE ADDRESS — pathname AND search AND fragment, as typed (PO ruling on QA
// F-45-03-K). The pathname alone makes `/nope?scope=local` and `/nope?scope=global` render the
// same sentence, so the state cannot confirm what the operator actually asked for; and the
// query is exactly where a mistyped deep link's real mistake usually is. The parts are joined
// here rather than by `addressToString` for one deliberate reason: this is rendered TEXT, and
// the entry's composer exists for the string handed to `history.replaceState` — importing the
// entry into the shell to reuse it would put the entry's decision inside the component the
// entry mounts.
function NotFound({ address }: { address: { pathname: string; search: string; hash: string } }) {
  const typed = `${address.pathname}${address.search}${address.hash}`;
  return (
    <div className={SHELL_CARD_WRAPPER_CLASS}>
      <div className={`${SHELL_CARD_CLASS} text-sm text-muted-foreground`}>
        <p>
          <span className="mono break-all text-foreground">{typed}</span> is not one of this app&apos;s surfaces.
        </p>
        <p className="mt-2">Pick one from the navigation above.</p>
      </div>
    </div>
  );
}

// A SURFACE STILL MOUNTING — the shell's own neutral placeholder, in the fleet's
// `RegionPlaceholder` shape. Exactly one loading treatment on screen at a time: the shell's is
// the outer one and yields the instant the surface mounts, so an operator never sees a skeleton
// inside a skeleton.
function MountPlaceholder({ routeId }: { routeId: RouteId }) {
  return (
    <section className="flex flex-col gap-2 p-6" aria-busy="true" aria-label={`Loading ${routeId}`}>
      <span className="h-3 w-24 animate-pulse rounded bg-muted" aria-hidden="true" />
      <span className="h-16 w-full animate-pulse rounded-lg border border-border bg-card/40" aria-hidden="true" />
    </section>
  );
}

// A SURFACE THAT FAILED TO LOAD. The chrome stays intact and fully usable — a failed surface
// must never trap the operator on it — and Retry re-attempts the MOUNT, not a fetch, which is
// what distinguishes this from a surface's own data error. NEVER `destructive`: a chunk that
// did not arrive is a retryable transport condition, not data loss.
function SurfaceFailed({ routeId, onRetry }: { routeId: RouteId; onRetry?: () => void }) {
  const retry = useCallback(() => {
    if (onRetry) {
      onRetry();
      return;
    }
    const view = safeWindow();
    view?.location?.reload?.();
  }, [onRetry]);

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-10">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent">
          <span className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground" aria-hidden="true">
            !
          </span>
          Could not load the {routeId} view
        </div>
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
        >
          ⟳ Retry
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── the plumbing ─

// Every DOM touch in this file goes through these two, and they are guarded rather than
// assumed: the headless harness this repo tests surfaces with supplies a `window` that carries
// `location` and `history` and nothing else, and a shell that threw on `addEventListener`
// would take every surface's suite down with it.
function safeWindow(): (Window & typeof globalThis) | null {
  try {
    return typeof window === "undefined" ? null : window;
  } catch {
    return null;
  }
}

function useViewportSize(pick: (view: Window & typeof globalThis) => number, fallback: number, frozen: boolean) {
  const [size, setSize] = useState(() => {
    const view = safeWindow();
    return view && typeof pick(view) === "number" ? pick(view) : fallback;
  });
  useEffect(() => {
    if (frozen) return undefined;
    const view = safeWindow();
    if (!view || typeof view.addEventListener !== "function") return undefined;
    const onResize = () => setSize(pick(view));
    view.addEventListener("resize", onResize);
    return () => view.removeEventListener("resize", onResize);
  }, [frozen, pick]);
  return size;
}

const pickWidth = (view: Window & typeof globalThis) => view.innerWidth;
const pickHeight = (view: Window & typeof globalThis) => view.innerHeight;

function useViewportWidth(override?: number) {
  return useViewportSize(pickWidth, 1280, override !== undefined);
}

function useViewportHeight() {
  return useViewportSize(pickHeight, 520, false);
}

// The origin's identity, from data this app already has: `?group=` when the address carries one
// (the fleet's own documented rule, lifted one level up with the bar it lived in), else the
// config origin's own name (`GET /api/config` → `payload.name`, which the config editor already
// renders and which the board origin serves too), else the documented neutral default. While it
// is unknown the chip pulses at its final size; it is never blank and never a control.
function useOriginIdentity(override?: string | null) {
  const [identity, setIdentity] = useState<string | null>(() => {
    if (override !== undefined) return override;
    const group = readQueryParam("group");
    return group === null ? null : group;
  });

  useEffect(() => {
    if (override !== undefined || identity !== null) return undefined;
    if (typeof fetch !== "function") {
      setIdentity(NEUTRAL_IDENTITY);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      let name: string | null = null;
      try {
        const response = await fetch("/api/config");
        if (response.ok) {
          const payload = (await response.json()) as { name?: unknown };
          if (typeof payload?.name === "string" && payload.name.length > 0) name = payload.name;
        }
      } catch {
        // Not an origin that serves the config API. The neutral default below is the answer,
        // and it is the same one the fleet's bar has always given.
      }
      if (!cancelled) setIdentity(name ?? NEUTRAL_IDENTITY);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolved once per mount, deliberately.
  }, []);

  return identity;
}

function readQueryParam(key: string): string | null {
  const view = safeWindow();
  try {
    const search = view?.location?.search ?? "";
    const value = new URLSearchParams(search).get(key);
    return value !== null && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

// The notice rail's MEASURED height. A `ResizeObserver` when the platform has one (the strip
// re-wraps as the viewport narrows, and its height is what `--aof-shell-chrome-height` must
// track), falling back to one measurement per render.
//
// THE RAIL IS REACHED THROUGH ITS REF, not found again with a `document.querySelector` for its
// own `data-shell-row`. The query was a second way to name one node — it takes whichever
// element happens to match FIRST in the whole document, which is the wrong one as soon as
// anything else in the tree carries that attribute (m46's dock joins this very region), and it
// silently measures 0 in any environment whose `document` is not the one the shell rendered
// into. A ref cannot point at the wrong element.
//
// `override` is the test seam (see ShellProps). Supplied, nothing is measured and no observer
// is attached — the same shape as `viewportWidth`.
function useMeasuredNoticeHeight(
  noticeNode: React.ReactNode,
  ref: React.RefObject<HTMLDivElement | null>,
  override?: number,
) {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (override !== undefined) return undefined;
    if (!noticeNode) {
      setHeight(0);
      return undefined;
    }
    const element = ref.current;
    if (!element || typeof element.getBoundingClientRect !== "function") return undefined;
    const measure = () => setHeight(Math.round(element.getBoundingClientRect().height));
    measure();
    const view = safeWindow();
    const Observer = (view as unknown as { ResizeObserver?: typeof ResizeObserver })?.ResizeObserver;
    if (typeof Observer !== "function") return undefined;
    const observer = new Observer(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [noticeNode, ref, override]);

  if (override !== undefined) return noticeNode ? override : 0;
  return height;
}

// The fullscreen slot: the pure machine from shell-layout.mjs, plus the DOM work that machine
// deliberately does not model — the ADOPTION of a live node ([Build-1]), the post-present and
// post-dismiss LAYOUT TICKS, `Escape` (which the occupant may have claimed, [Build-2]), and the
// focus restore.
function useFullscreenSlot() {
  const [state, setState] = useState<FullscreenState>(fullscreenState);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // The childless host the occupant is adopted INTO — a different element from the overlay,
  // which also holds the exit header and (from m46) whatever else [Build-3] puts in this
  // region. `overlayRef` stays the focus trap's scope; `hostRef` is the adoption's.
  const hostRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<FullscreenRequest | null>(null);

  useEffect(
    () =>
      attachFullscreenHost((event) => {
        if (event.type === "present") {
          requestRef.current = event.occupant;
          setState((current) => fullscreenReducer(current, { type: "present", occupant: event.occupant }));
          return;
        }
        // The dismisser's OWN id travels into the reducer, which no-ops a dismiss aimed at an
        // occupant that is not the one presented. Dropping it here (as this handler did) would
        // put the stale-dismisser guard in the machine and then not use it: `requestFullscreen`
        // hands every caller a dismiss closed over its id precisely so a replaced occupant
        // cannot tear down its successor.
        setState((current) => fullscreenReducer(current, { type: "dismiss", id: event.id, via: event.via ?? "control" }));
      }),
    [],
  );

  // THE ADOPTION. The occupant's instance and DOM identity survive present AND dismiss: the
  // shell re-parents the live node into the overlay's childless HOST and returns THE SAME NODE
  // to its home on teardown. One xterm, one socket, one PTY, through both transitions.
  const occupantId = state.occupant?.id ?? null;
  useEffect(() => {
    const request = requestRef.current;
    if (occupantId === null || request === null || request.id !== occupantId) return undefined;
    const host = hostRef.current;
    const node = request.node;
    if (host && node && typeof host.appendChild === "function" && node.parentElement !== host) {
      host.appendChild(node);
    }
    // An occupant is not laid out on the tick it is presented, so a surface that sizes itself
    // to its box is told to re-measure now AND one frame later — the defer both existing
    // terminal overlays had to discover independently.
    tick(request);
    return () => {
      if (request.home && node && typeof request.home.appendChild === "function") request.home.appendChild(node);
      // …and again on dismiss, when the box changes back.
      tick(request);
      request.opener?.focus?.();
    };
  }, [occupantId]);

  // `Esc` — the shell owns it BY DEFAULT and yields it to an occupant that claims it. The
  // reducer makes that call; this listener only reports the key.
  //
  // The same listener carries the FOCUS TRAP (DESIGN §Accessibility 10): while an occupant is
  // presented, Tab cycles within the overlay rather than walking out into the chrome behind it —
  // which is what `aria-modal="true"` promises an assistive technology, and a promise the one
  // overlay that exists today makes without keeping.
  useEffect(() => {
    if (state.status !== "presenting") return undefined;
    const view = safeWindow();
    const target = view?.document;
    if (!target || typeof target.addEventListener !== "function") return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setState((current) => fullscreenReducer(current, { type: "escape" }));
        return;
      }
      if (event.key !== "Tab") return;
      const overlay = overlayRef.current;
      const focusable = overlay?.querySelectorAll?.<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = target.activeElement;
      if (event.shiftKey && (active === first || !overlay?.contains?.(active))) {
        event.preventDefault();
        last.focus?.();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus?.();
      }
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [state.status]);

  // The shell's OWN exit control. It passes no id on purpose: it is rendered by the presented
  // state, so "the occupant it aims at" and "the occupant presented" are the same thing by
  // construction — exactly as `Escape` is. The id guard is for the dismiss handles held by
  // CALLERS, which can outlive the occupant they were minted for.
  const dismiss = useCallback(() => {
    setState((current) => fullscreenReducer(current, { type: "dismiss", via: "control" }));
  }, []);

  return { state, overlayRef, hostRef, dismiss };
}

function tick(request: FullscreenRequest) {
  request.onLayout?.();
  const view = safeWindow();
  if (typeof view?.requestAnimationFrame === "function") view.requestAnimationFrame(() => request.onLayout?.());
}
