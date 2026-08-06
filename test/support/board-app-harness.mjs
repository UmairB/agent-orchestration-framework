// Mount the REAL production <Board/> component tree headlessly against a REAL
// running board face (milestone 43 / story 04; ADR-010 R4.5 named this a
// deliverable of the story rather than a convenience).
//
// The mechanism is the shared core (./react-app-harness.mjs): the real,
// unmodified `ui/src/board/Board.tsx` esbuild-bundled with its real siblings
// (BoardLanes, Overview, DetailPanel, ActionsStrip, Markdown, status.tsx,
// freshness.mjs, api.ts …), a minimal React, an instrumented `fetch` onto the
// real face's origin, and a controllable clock that ALSO owns `Date.now()`.
//
// THE CLOCK IS THE POINT, not a convenience. The board's freshness ramp is
// judged against a live 1-second cosmetic tick rather than against fetch time
// (DESIGN §"The threshold crossing"), so "the badge appears within one second of
// the crossing, with no network" can only be measured by driving BOTH the timer
// and the wall clock — and by counting the app's own traffic across the window.
// A harness that faked only timers would advance the tick while `Date.now()`
// stood still, and the assertion would measure nothing.
//
// WHAT IS STUBBED, AND WHY IT IS ONLY THIS:
//   - `./TerminalDock` — it alone pulls `@xterm/*` ×3 (which want a real DOM
//     canvas) and the board subtree's ONLY `@/` alias. It renders only after
//     `Run agent` opens a session, so rendering nothing is what production shows
//     for every lane here, and the dock has its own suites.
//   - `lucide-react` — an icon pack of ~1,500 SVG modules. The stub exports the
//     icons the board subtree actually imports BY NAME, so adding an icon
//     without adding it here fails the bundle LOUDLY rather than silently
//     rendering nothing.
// Everything else — including `marked`, the real markdown renderer — is bundled
// for real.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withMountedApp, findAll, textOf, visibleTextOf, FRAGMENT } from "./react-app-harness.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOARD_TSX = path.join(repoRoot, "ui", "src", "board", "Board.tsx");

const VIRTUAL_TERMINAL_DOCK = "export const TerminalDock = () => null;\n";
// The icons the board subtree imports today (ActionsStrip's `Send`; the dock's
// four, kept so a future un-stubbing of the dock does not fail here first).
const VIRTUAL_ICONS = [
  "Send",
  "X",
  "ChevronDown",
  "ChevronUp",
  "RotateCw",
].map((name) => `export const ${name} = () => null;`).join("\n") + "\n";

const BOARD_STUBS = {
  __terminal_dock__: VIRTUAL_TERMINAL_DOCK,
  __icons__: VIRTUAL_ICONS,
};
const BOARD_RESOLVE = [
  { filter: /(^|\/)TerminalDock$/, to: "__terminal_dock__" },
  { filter: /^lucide-react$/, to: "__icons__" },
];

// A fixed, plausible wall-clock epoch. Every fixture instant a lane states is
// expressed relative to it (`app.at(-299)` — "299 seconds before now"), so the
// mounted app and the lane share one frame of reference.
export const BOARD_EPOCH = Date.parse("2026-08-03T12:00:00.000Z");

// The stale badge's PINNED class signature (DESIGN §"Rendering 1"). Addressed by
// the tokens the design fixes rather than by a test-only attribute — and
// deliberately NOT by `border-dashed` alone, which the `not-started` StatusRing
// also carries: a badge is the dashed pill that is ALSO a padded `text-[11px]`
// inline-flex.
const BADGE_TOKENS = ["border-dashed", "border-muted-foreground/45", "rounded-full", "px-2", "text-[11px]", "font-semibold"];

function isBadgeNode(node) {
  if (node?.type !== "span") return false;
  const className = node.props?.className;
  return typeof className === "string" && BADGE_TOKENS.every((token) => className.includes(token));
}

// Every className in a subtree that carries a MOTION token. DESIGN forbids the
// ramp adding any, so a lane compares this set across the crossing rather than
// asserting a fixed list (buttons legitimately carry `transition` already).
const MOTION = /\b(?:animate-[\w-]+|transition|aof-pending)\b/;

function motionClassesIn(node) {
  return findAll(node, (candidate) => typeof candidate.props?.className === "string" && MOTION.test(candidate.props.className))
    .map((candidate) => candidate.props.className)
    .sort();
}

// EVERY Resync door in a subtree, however it was built. Deliberately BROAD —
// accessible name OR visible label OR either in-flight label — because the
// scenario it serves ("exactly ONE Resync control exists across all of them") is
// about a SECOND door someone adds later, and a second door built without the
// naming contract is precisely the one a narrow finder would miss.
const RESYNC_TEXT = /resync|requested/i;

function isResyncControl(node) {
  if (node?.type !== "button" && node?.type !== "a") return false;
  const name = String(node.props?.["aria-label"] ?? "");
  return name.startsWith("Resync ") || RESYNC_TEXT.test(visibleTextOf(node));
}

// The provenance LABEL — the `mono text-[11px] text-muted-foreground` span the
// ramp paints its line into. Addressed by that class signature rather than by
// position, so the line's text stays readable as ONE claim even though the row
// also holds the Resync control and the message slot.
function isProvenanceLabel(node) {
  if (node?.type !== "span") return false;
  const className = node.props?.className;
  return typeof className === "string"
    && className.includes("mono")
    && className.includes("text-[11px]")
    && className.includes("text-muted-foreground");
}

// The message slot — the permanently-present polite live region beside the
// control. Found by its ROLE in the a11y tree (`aria-live`), not by its copy, so
// "the element is never removed and re-added between states" is checkable.
function isMessageSlot(node) {
  return node?.type === "span" && node.props?.["aria-live"] === "polite";
}

// withBoardApp({ url, hash, search }, fn) — mount the REAL <Board/> against the
// REAL board face at `url`. `hash` is the app's own deep link (`43/04`), which is
// how a lane opens the detail panel on an item: through the door the operator
// uses, never by poking component state.
export async function withBoardApp({ url, hash = "", search = "?mode=board", settle = "flush" }, fn) {
  return withMountedApp(
    {
      entry: BOARD_TSX,
      exportName: "Board",
      stubs: BOARD_STUBS,
      resolve: BOARD_RESOLVE,
      url,
      search,
      hash: hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "",
      epoch: BOARD_EPOCH,
      settle,
      accessors: (driver) => boardAccessors(driver),
    },
    fn,
  );
}

function boardAccessors(driver) {
  // The node region-finders, all structural: a lane card is the `<button
  // data-card>` the production component emits; an overview milestone card is
  // the `rounded-[10px]` card button; a gate bar is the acceptance-gate button.
  const cardsWith = (predicate) => findAll(driver.tree(), predicate);

  const refIn = (node) => {
    const mono = findAll(node, (candidate) => candidate.type === "span" && typeof candidate.props?.className === "string" && candidate.props.className.includes("mono"));
    return mono.length > 0 ? textOf(mono[0]).trim() : "";
  };

  const badgeIn = (node) => (node ? findAll(node, isBadgeNode)[0] ?? null : null);

  const badgeFacts = (node) => {
    const badge = badgeIn(node);
    if (!badge) return null;
    return {
      node: badge,
      // The reader's reading of the pill — the mark and the words are two spans
      // (the mark must be `aria-hidden`, the words must not be), separated on
      // screen by the pinned `gap-1`.
      text: visibleTextOf(badge),
      className: badge.props?.className ?? "",
      title: badge.props?.title ?? null,
      role: badge.props?.role ?? null,
      ariaLabel: badge.props?.["aria-label"] ?? null,
      // The badge must never be interactive — the cards that carry it are
      // themselves `<button>`s (m38/ADR-012).
      interactive: Boolean(badge.props?.onClick || badge.props?.tabIndex != null || badge.props?.href),
      // The glyph span's a11y treatment, and whether the words are hidden.
      glyphHidden: findAll(badge, (candidate) => candidate.type === "span" && candidate.props?.["aria-hidden"] === "true").length > 0,
    };
  };

  // Everything DESIGN's Resync state table states about the CONTROL, read off
  // the rendered element: what it says, whether it is disabled, what it tells
  // the accessibility tree, and which tint it carries. The label's reserved
  // width lives on its inner sizing shell, so "no outcome reflows the row" is a
  // property of a node the lane can compare across states.
  const resyncFacts = (node) => {
    if (!node) return null;
    const sizer = findAll(node, (child) => child.type === "span" && child.props?.style?.width != null)[0] ?? null;
    const className = node.props?.className ?? "";
    return {
      node,
      label: visibleTextOf(node),
      disabled: node.props?.disabled === true,
      ariaBusy: node.props?.["aria-busy"] ?? null,
      ariaLabel: node.props?.["aria-label"] ?? null,
      className,
      // The tint, read as DESIGN states it: the acknowledgement is the SAME box
      // with the `primary` tint DROPPED, never a new colour primitive.
      tone: className.includes("border-primary/40") ? "primary" : className.includes("bg-muted") ? "muted" : "unknown",
      labelWidth: sizer?.props?.style?.width ?? null,
      tabIndex: node.props?.tabIndex ?? null,
      async click() {
        await node.props?.onClick?.({ stopPropagation() {}, preventDefault() {} });
        await driver.flush();
      },
      // clickDetached() — fire the REAL click WITHOUT awaiting it, so the lane
      // can read the tree between the synchronous `onState(sending)` and the
      // awaited POST (the in-flight row of DESIGN's table, read off the REAL
      // rendered tree rather than off the reducer).
      clickDetached() {
        const pending = node.props?.onClick?.({ stopPropagation() {}, preventDefault() {} });
        return {
          async settle() {
            await pending;
            await driver.flush();
          },
        };
      },
    };
  };

  const cardFacts = (node) => (node
    ? {
      node,
      type: node.type,
      className: node.props?.className ?? "",
      text: visibleTextOf(node),
      badge: badgeFacts(node),
      buttons: findAll(node, (candidate) => candidate.type === "button" && candidate !== node),
      links: findAll(node, (candidate) => candidate.type === "a"),
      async click() {
        await node.props?.onClick?.({ stopPropagation() {}, preventDefault() {} });
        await driver.flush();
      },
    }
    : null);

  return {
    // ── the app's wall clock, in the lane's own words ──────────────────────
    // at(secondsFromNow) — an ISO instant expressed against the MOUNTED app's
    // clock, so "this row was reported 299 seconds ago" means exactly that to
    // the ramp the app runs.
    at: (secondsFromNow) => new Date(driver.clock.date() + secondsFromNow * 1000).toISOString(),
    nowMs: () => driver.clock.date(),

    // ── regions ───────────────────────────────────────────────────────────
    // Every stale badge anywhere in the rendered tree — how "no badge appears
    // anywhere" and "exactly one badge per item context" are counted.
    badges: () => cardsWith(isBadgeNode).map((node) => badgeFacts(node)),
    laneCards: () => cardsWith((node) => node.type === "button" && node.props?.["data-card"] !== undefined),
    laneCard(ref) {
      return cardFacts(driver.laneCards().find((node) => refIn(node) === ref) ?? null);
    },
    overviewCards: () => cardsWith(
      (node) => node.type === "button"
        && typeof node.props?.className === "string"
        && node.props.className.includes("rounded-[10px]"),
    ),
    overviewCard(ref) {
      return cardFacts(driver.overviewCards().find((node) => refIn(node) === ref) ?? null);
    },
    gateBars: () => cardsWith(
      (node) => node.type === "button"
        && typeof node.props?.className === "string"
        && node.props.className.includes("rounded-lg")
        && visibleTextOf(node).includes("uat gate"),
    ),
    gateBar(ref) {
      return cardFacts(driver.gateBars().find((node) => refIn(node) === ref) ?? null);
    },

    // Every Resync door anywhere in the rendered tree — how "exactly ONE Resync
    // control exists across all of them" is COUNTED rather than inspected on one
    // component. `resyncControls().length` is the whole assertion.
    resyncControls: () => cardsWith(isResyncControl).map((node) => resyncFacts(node)),

    // The detail panel: its header row-1 cluster, its badge, and the provenance
    // box's two lines — addressed by their DESIGN region names, so a class
    // rename fails loudly instead of silently matching nothing.
    detail() {
      const tree = driver.tree();
      const heading = findAll(tree, (node) => node.type === "h2" && typeof node.props?.className === "string" && node.props.className.includes("text-[16px]"))[0] ?? null;
      if (!heading) return null;
      const panel = findAll(tree, (node) => node.type === "div" && typeof node.props?.className === "string" && node.props.className.includes("border-b border-border p-4") && findAll(node, (inner) => inner === heading).length > 0)[0] ?? null;
      if (!panel) return null;
      const row1 = (panel.children ?? []).find((child) => child?.type === "div" && String(child.props?.className ?? "").includes("flex items-center gap-2")) ?? null;
      const cluster = row1 ? (row1.children ?? []).find((child) => String(child?.props?.className ?? "").includes("ml-auto")) ?? null : null;
      const box = findAll(panel, (node) => node.type === "div" && String(node.props?.className ?? "").includes("bg-muted/40"))[0] ?? null;
      const boxLines = box ? (box.children ?? []).filter((child) => child && typeof child === "object") : [];
      // The box's TWO lines, by their content rather than by index: line 1 is the
      // execution facts (present only when the mesh dispatched this item), line 2
      // is the provenance line — and line 2 is the one that holds the label, the
      // Resync door and the message slot.
      const provenanceRow = boxLines.find((line) => findAll(line, isProvenanceLabel).length > 0) ?? null;
      const executionRow = boxLines.find((line) => line !== provenanceRow) ?? null;
      const label = provenanceRow ? findAll(provenanceRow, isProvenanceLabel)[0] ?? null : null;
      const slot = provenanceRow ? findAll(provenanceRow, isMessageSlot)[0] ?? null : null;
      const resync = provenanceRow ? findAll(provenanceRow, isResyncControl)[0] ?? null : null;
      return {
        panel,
        title: heading ? textOf(heading).trim() : "",
        row1,
        // Row 1's direct children, by kind + class + text — DESIGN's "nothing
        // moves at the threshold" is only checkable if the row's membership and
        // order are themselves readable.
        row1Children: (row1?.children ?? []).filter(Boolean).map((child) => (typeof child === "object"
          ? { type: child.type, className: child.props?.className ?? "", text: visibleTextOf(child) }
          : { type: "#text", className: "", text: String(child) })),
        cluster,
        // The cluster's children in DOM order — the badge must be the sibling
        // immediately BEFORE the status chip.
        clusterChildren: (cluster?.children ?? []).filter(Boolean),
        badge: badgeFacts(panel),
        statusChip: cluster ? findAll(cluster, (node) => node.type === "span" && String(node.props?.className ?? "").includes("rounded-full px-2.5"))[0] ?? null : null,
        provenanceBox: box,
        // Line 1 is the execution facts (present only when the mesh dispatched
        // this item); line 2 is the provenance/freshness line.
        provenanceLines: boxLines.map((line) => visibleTextOf(line)),
        // The provenance line as the reader reads its CLAIM — the label alone.
        // The controls beside it (the Resync door, the message slot) answer
        // different questions and are read through their own accessors, so a
        // lane asserting what the LINE says is never confounded by what the
        // BUTTON says.
        provenanceLine: label ? visibleTextOf(label) : null,
        provenanceLabel: label,
        // Line 1 verbatim, or null when the mesh never dispatched this item.
        executionLine: executionRow ? visibleTextOf(executionRow) : null,
        // The whole of line 2 including its controls — for the geometry claims
        // (element order, who shrinks) rather than the copy claims.
        provenanceRow,
        provenanceRowChildren: (provenanceRow?.children ?? []).filter(Boolean),
        resync: resyncFacts(resync),
        messageSlot: slot
          ? {
            node: slot,
            text: visibleTextOf(slot),
            className: slot.props?.className ?? "",
            title: slot.props?.title ?? null,
            live: slot.props?.["aria-live"] ?? null,
          }
          : null,
        text: visibleTextOf(panel),
      };
    },

    // The doc-body region — the panel's scrolling body. Its FIRST child is the
    // per-artifact provenance line when the cache served the body (DESIGN: above
    // the markdown, before the reader reads it, not after).
    docRegion() {
      const tree = driver.tree();
      const region = findAll(tree, (node) => node.type === "div" && String(node.props?.className ?? "").includes("min-h-0 flex-1 overflow-y-auto p-4"))[0] ?? null;
      if (!region) return null;
      // The rendered body's own root — `Markdown` emits a `dangerouslySetInnerHTML`
      // div, which is how "the markdown follows it" is read without parsing HTML.
      const markdown = findAll(region, (node) => node.props?.dangerouslySetInnerHTML != null)[0] ?? null;
      const dashed = findAll(region, (node) => typeof node.props?.className === "string" && node.props.className.includes("border-dashed"))[0] ?? null;
      const inner = (region.children ?? []).filter(Boolean);
      // The region wraps its content in one layout div; the "first child" DESIGN
      // names is the first element of that content, not the wrapper.
      const content = inner.length === 1 && inner[0]?.type === "div" ? (inner[0].children ?? []).filter(Boolean) : inner;
      const provenance = findAll(region, isProvenanceLabel)[0] ?? null;
      return {
        region,
        text: visibleTextOf(region),
        firstChild: content[0] ?? null,
        firstChildText: content[0] ? visibleTextOf(content[0]) : null,
        provenanceLine: provenance ? visibleTextOf(provenance) : null,
        markdown,
        markdownHtml: markdown?.props?.dangerouslySetInnerHTML?.__html ?? null,
        placeholder: dashed ? visibleTextOf(dashed) : null,
        placeholderClassName: dashed?.props?.className ?? "",
        badges: findAll(region, isBadgeNode).map((node) => badgeFacts(node)),
        resyncControls: findAll(region, isResyncControl),
      };
    },

    // The doc-tab row — how a lane opens a tab through the door the operator uses.
    tabs: () => findAll(driver.tree(), (node) => node.type === "button" && String(node.props?.className ?? "").includes("border-b-2")).map((node) => textOf(node).trim()),
    async openTab(name) {
      const tab = findAll(driver.tree(), (node) => node.type === "button" && String(node.props?.className ?? "").includes("border-b-2") && textOf(node).trim() === name)[0] ?? null;
      if (!tab) throw new Error(`board harness: no ${name} tab on the panel (have ${driver.tabs().join(", ")})`);
      await tab.props.onClick?.({ stopPropagation() {}, preventDefault() {} });
      await driver.flush();
    },

    // The footer actions strip — the work-stream verbs. Read so "there is no
    // Resync in the actions strip, which still holds only what it holds today"
    // is an assertion about the strip's MEMBERSHIP, not about one absence.
    actionsStrip() {
      const tree = driver.tree();
      const strip = findAll(tree, (node) => node.type === "div" && String(node.props?.className ?? "").includes("shrink-0 border-t border-border p-4"))[0] ?? null;
      if (!strip) return null;
      return {
        strip,
        text: visibleTextOf(strip),
        buttons: findAll(strip, (node) => node.type === "button").map((node) => visibleTextOf(node)),
        resyncControls: findAll(strip, isResyncControl),
      };
    },

    // ── the legend ────────────────────────────────────────────────────────
    // The board legend is a HOVER popover, so a lane opens it the way the
    // operator does — through the trigger's own `onMouseEnter`.
    async openLegend() {
      const trigger = findAll(driver.tree(), (node) => typeof node.props?.onMouseEnter === "function"
        && findAll(node, (inner) => inner.props?.["aria-label"] === "Status legend").length > 0)[0] ?? null;
      if (!trigger) throw new Error("board harness: no `◷ status legend` trigger in the top bar");
      await trigger.props.onMouseEnter();
      // A RENDER pass, not a network settle: opening the legend fetches nothing,
      // and the legend's own contract is that it is correct BEFORE any data has
      // arrived — so a lane must be able to open it while the list is still in
      // flight, which a flush could never allow.
      await driver.renderOnly();
      return driver.legend();
    },
    legend() {
      const panel = findAll(driver.tree(), (node) => node.type === "div"
        && String(node.props?.className ?? "").includes("rounded-md border border-border bg-card")
        && String(node.props?.className ?? "").includes("shadow-lg"))[0] ?? null;
      if (!panel) return null;
      // A `.map()` child arrives as a nested ARRAY in the rendered tree (the
      // renderer flattens one level, not all of them), so the panel's blocks are
      // read flat — otherwise the five status rows would count as one block and
      // "the five status rows, a divider, then Freshness" could not be an ORDER.
      const children = (panel.children ?? []).flat(Infinity).filter(Boolean);
      return {
        panel,
        text: visibleTextOf(panel),
        // The panel's direct children in DOM order, by kind — how "the five
        // status rows, a divider, then Freshness" is read as an ORDER.
        blocks: children.map((child) => ({
          type: child.type,
          className: child.props?.className ?? "",
          text: visibleTextOf(child),
        })),
        headings: findAll(panel, (node) => typeof node.props?.className === "string"
          && node.props.className.includes("uppercase")
          && node.props.className.includes("tracking-wide")).map((node) => visibleTextOf(node)),
        // One entry per freshness row: its text and the badge it paints (null on
        // the `(no badge)` row, which shows the absence itself).
        freshnessRows: findAll(panel, (node) => typeof node.props?.className === "string"
          && node.props.className.includes("flex items-center gap-1.5")).map((node) => ({
          text: visibleTextOf(node),
          badge: badgeFacts(node),
        })),
        badges: findAll(panel, isBadgeNode).map((node) => badgeFacts(node)),
      };
    },

    // ── the whole-surface reads a States table needs ───────────────────────
    // The page-level branch the board is showing — read off the branch's OWN
    // marker element, so an empty stream cannot be mistaken for a view switch.
    screen() {
      const tree = driver.tree();
      const text = visibleTextOf(tree);
      if (text.includes("Loading work stream...")) return "loading";
      if (text.includes("Could not load the work stream")) return "error";
      if (text.includes("No work items yet")) return "empty";
      const overviewHeading = findAll(tree, (node) => node.type === "h1" && visibleTextOf(node) === "Work items").length > 0;
      return overviewHeading ? "overview" : "board";
    },
    // Every role-bearing announcement region on the page — a toast, a banner, a
    // dialog. "No success toast" is asserted by this being empty.
    alerts: () => findAll(driver.tree(), (node) => ["status", "alert", "dialog", "alertdialog"].includes(node.props?.role)).map((node) => ({ role: node.props.role, text: visibleTextOf(node) })),
    liveRegions: () => findAll(driver.tree(), (node) => typeof node.props?.["aria-live"] === "string").map((node) => ({ politeness: node.props["aria-live"], text: visibleTextOf(node) })),
    motionClasses: () => motionClassesIn(driver.tree()),
    // Every element carrying a `destructive` token, and what it is — the tone
    // rail's assertion subject. Takes an optional ROOT so a lane can scope the
    // claim to one region (the page as a whole legitimately carries the token: a
    // blocked lane is tinted, the summary counts blocked gates).
    destructiveNodes: (root = null) => findAll(root ?? driver.tree(), (node) => typeof node.props?.className === "string" && node.props.className.includes("destructive"))
      .map((node) => ({ type: node.type, className: node.props.className, text: visibleTextOf(node) })),

    // ── the doors an operator uses ─────────────────────────────────────────
    // sync() — the top bar's `⟳ sync`, the app's own silent re-load. The only
    // door a lane should use to make a fresher copy land, since a settled board
    // schedules no list poll of its own.
    async sync() {
      const button = findAll(driver.tree(), (node) => node.type === "button" && node.props?.["aria-label"] === "Sync work stream")[0] ?? null;
      if (!button) throw new Error("board harness: no `⟳ sync` control on the page");
      await button.props.onClick?.({ stopPropagation() {}, preventDefault() {} });
      await driver.flush();
    },
    // openMilestone(ref) — click the overview card, exactly as the operator does.
    async openMilestone(ref) {
      const card = driver.overviewCard(ref);
      if (!card) throw new Error(`board harness: no overview card for ${ref}`);
      await card.click();
    },
    // selectCard(ref) — click a lane card, which drives the detail panel.
    async selectCard(ref) {
      const card = driver.laneCard(ref);
      if (!card) throw new Error(`board harness: no lane card for ${ref}`);
      await card.click();
    },
  };
}

export { FRAGMENT, findAll, textOf, visibleTextOf, isBadgeNode, isResyncControl };
