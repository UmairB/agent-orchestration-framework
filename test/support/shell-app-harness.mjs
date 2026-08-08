// Mount the REAL production app shell headlessly (milestone 45 / story 03).
//
// The mechanism is the shared core (./react-app-harness.mjs): the real, unmodified
// `ui/src/app/Shell.tsx` esbuild-bundled with its real siblings (shell-layout.mjs,
// shell-nav.mjs, shell-bus.mjs, SurfaceSlot.tsx, Landing.tsx and the route table), a minimal
// React, and a controllable clock. NOTHING about the shell is stubbed — the only stand-in is
// the mounted SURFACE, which is the harness's own (see shell-harness-entry.tsx), because the
// four production surfaces have their own harnesses and their own suites.
//
// WHY A HARNESS AT ALL, when story 45/03's models are pure. Because three of DESIGN's clauses
// are about the DOCUMENT and not about a model: exactly one `banner` and one `<main>` survive
// the absorption of the surfaces' own bars, the skip link is the FIRST focusable element, and
// the surface's contributions really do land in the shell's bar rather than in the surface's
// own body. Each of those is a fact about the rendered tree, and the model cannot see any of
// them.
//
// The shell fetches exactly one thing (the origin identity probe), so a lane that does not care
// passes `identity` and the probe never runs.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withMountedApp, findAll, textOf, visibleTextOf, FRAGMENT } from "./react-app-harness.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHELL_ENTRY = path.join(repoRoot, "test", "support", "shell-harness-entry.tsx");
const SHELL_FLEET_ENTRY = path.join(repoRoot, "test", "support", "shell-fleet-entry.tsx");

// The fleet's ONE stubbed leaf, copied from test/support/fleet-app-harness.mjs verbatim: the
// terminal view wants xterm and a real DOM canvas, it has its own suites, and rendering
// nothing is exactly what the production component does for an assignment with no live
// session. Nothing else about either the fleet or the shell is stubbed.
const FLEET_STUBS = { __terminal_view__: "export const FleetTerminalView = () => null;\n" };
const FLEET_RESOLVE = [{ filter: /terminal-view\/FleetTerminalView$/, to: "__terminal_view__" }];

// withShellApp(props, fn) — mount the REAL <Shell/> with `props`, and yield a driver whose
// accessors address the shell's regions the way DESIGN names them.
//
//   routeId / address        — what the entry resolved (the shell never re-derives them).
//   surface                  — "none" | "plain" | "contributing" (see shell-harness-entry.tsx).
//   slotLabels / noticeText   — what a CONTRIBUTING surface puts in the slot and the rail.
//   viewportWidth / identity / noticeHeight
//                            — the three seams; supplied, the shell measures nothing and probes
//                              nothing. `noticeHeight` stands in for the rail's MEASURED height:
//                              a mini-React tree has no layout, so without it the one coupling
//                              m46's dock binds to (rail stands → the published chrome height
//                              grows → the budget verdict changes) was assertable on the pure
//                              model only, never through the component that publishes it.
export async function withShellApp(props, fn) {
  const { search = "", hash = "", ...shellProps } = props ?? {};
  globalThis.__AOF_SHELL_PROPS__ = shellProps;
  // The shell bus is MODULE state inside the bundle. The bundle is cached per entry, so a
  // second mount in the same process reuses it — and a contribution left behind by the
  // previous mount would leak into the next lane's bar. The bundle exposes its own reset
  // through the entry, and `withMountedApp`'s unmount runs every effect cleanup (which is what
  // withdraws a contribution), so the reset here is belt AND braces.
  try {
    return await withMountedApp(
      {
        entry: SHELL_ENTRY,
        exportName: "ShellHarness",
        // Nothing on this surface talks to a server except the identity probe, and every lane
        // supplies `identity`. The origin is still real so a stray request would be visible in
        // `requests()` rather than silently swallowed.
        url: "http://127.0.0.1:9",
        search,
        hash,
        accessors: (driver) => shellAccessors(driver),
      },
      fn,
    );
  } finally {
    delete globalThis.__AOF_SHELL_PROPS__;
  }
}

// withShellComposedFleet({ url, search, settle, ...shellProps }, fn) — the REAL `<Fleet/>`
// inside the REAL `<Shell/>`, in ONE bundle, against the REAL fleet face listening at `url`.
//
// This is the join neither of the other two harnesses can see (see shell-fleet-entry.tsx). Its
// accessors are the shell's — a lane asks where a control ENDED UP, which is the whole
// question — plus `surfaceBody`, which is now the fleet's own tree rather than a stub's.
//
// `settle: "render"` mounts WITHOUT waiting for the fleet's first request to land, which is
// the only way to read the LOADING page state. The scope control is contributed outside the
// fleet's loading/error/empty/populated ternary precisely so it is present in all four, and
// that clause is only checkable from the state where it would be missing.
export async function withShellComposedFleet(options, fn) {
  const { url, search = "", hash = "", settle = "flush", holdFromStart = null, ...shellProps } = options ?? {};
  globalThis.__AOF_SHELL_PROPS__ = shellProps;
  try {
    return await withMountedApp(
      {
        entry: SHELL_FLEET_ENTRY,
        exportName: "ShellFleetHarness",
        stubs: FLEET_STUBS,
        resolve: FLEET_RESOLVE,
        url,
        search,
        hash,
        settle,
        holdFromStart,
        accessors: (driver) => shellAccessors(driver),
      },
      fn,
    );
  } finally {
    delete globalThis.__AOF_SHELL_PROPS__;
  }
}

function shellAccessors(driver) {
  const tree = () => driver.tree();
  const byRow = (row) => findAll(tree(), (node) => node.props?.["data-shell-row"] === row);

  return {
    // R1–R5, addressed by the row names shell-layout.mjs declares.
    row: (name) => byRow(name)[0] ?? null,
    rows: () => ["notice-rail", "top-bar", "surface-bar", "content", "overlay"].filter((row) => byRow(row).length > 0),

    // The two landmarks DESIGN §Accessibility 6 caps at one each.
    banners: () => findAll(tree(), (node) => node.type === "header" || node.props?.role === "banner"),
    mains: () => findAll(tree(), (node) => node.type === "main" || node.props?.role === "main"),

    // The skip link — the first focusable element in the document.
    focusables: () =>
      findAll(
        tree(),
        (node) =>
          (node.type === "a" && typeof node.props?.href === "string")
          || node.type === "button"
          || node.type === "select"
          || node.props?.tabIndex === 0,
      ),

    navItems: () => findAll(tree(), (node) => typeof node.props?.["data-nav-item"] === "string"),
    navItem: (id) => findAll(tree(), (node) => node.props?.["data-nav-item"] === id)[0] ?? null,
    nav: () => findAll(tree(), (node) => node.type === "nav")[0] ?? null,

    // The surface slot, wherever it lives at this width — the slot MOVES, its contents never
    // change form, so a lane addresses it by role rather than by row.
    slot: () => findAll(tree(), (node) => typeof node.props?.["data-shell-slot"] === "string")[0] ?? null,
    slotHome: () => findAll(tree(), (node) => typeof node.props?.["data-shell-slot"] === "string")[0]?.props?.["data-shell-slot"] ?? null,
    slotLabels: () => {
      const slot = findAll(tree(), (node) => typeof node.props?.["data-shell-slot"] === "string")[0] ?? null;
      return slot === null ? [] : findAll(slot, (node) => node.type === "button").map((node) => node.props?.["aria-label"] ?? textOf(node));
    },

    notice: () => findAll(tree(), (node) => node.props?.role === "alert")[0] ?? null,

    // The published chrome height and the budget verdict, read off the root exactly as an
    // outsider (or m46's dock) would.
    chromeHeight: () => findAll(tree(), (node) => typeof node.props?.["data-shell-chrome-height"] === "string")[0]?.props?.["data-shell-chrome-height"] ?? null,
    budgetVerdict: () => findAll(tree(), (node) => typeof node.props?.["data-shell-budget"] === "string")[0]?.props?.["data-shell-budget"] ?? null,

    fullscreen: () => findAll(tree(), (node) => typeof node.props?.["data-shell-fullscreen"] === "string")[0] ?? null,
    // The childless host the adopted node is re-parented INTO — a different element from the
    // overlay, which also carries the exit header (and, from m46, the dock).
    fullscreenHost: () => findAll(tree(), (node) => typeof node.props?.["data-shell-fullscreen-host"] === "string")[0] ?? null,
    surfaceBody: () => findAll(tree(), (node) => typeof node.props?.["data-stub-surface"] === "string")[0] ?? null,

    // Any node carrying an accessible name, by that name — the way an operator addresses a
    // control, and how a lane finds the fleet's scope control wherever the shell put it.
    byLabel: (label) => findAll(tree(), (node) => node.props?.["aria-label"] === label)[0] ?? null,
    // The accessible names inside the surface slot, whatever element carries them (the fleet's
    // scope control is a `role="group"`, not a button — `slotLabels` above sees buttons only).
    slotControls: () => {
      const slot = findAll(tree(), (node) => typeof node.props?.["data-shell-slot"] === "string")[0] ?? null;
      if (slot === null) return [];
      const labelled = findAll(slot, (node) => typeof node.props?.["aria-label"] === "string");
      // A control nested inside another labelled control is that control's part, not a second
      // contribution (the scope control's two buttons live inside its group).
      return labelled
        .filter((node) => !labelled.some((other) => other !== node && findAll(other, (inner) => inner === node).length > 0))
        .map((node) => node.props["aria-label"]);
    },

    // The fullscreen door, reached through the REAL shell bus the mounted shell is listening on
    // (see shell-harness-entry.tsx). A lane presents and dismisses the way m46's terminal will.
    async present(request) {
      globalThis.__AOF_SHELL_BUS__.requestFullscreen(request);
      await driver.flush();
    },
    async dismissFullscreen(id) {
      globalThis.__AOF_SHELL_BUS__.dismissFullscreen(id);
      await driver.flush();
    },
  };
}

export { FRAGMENT, findAll, textOf, visibleTextOf };
