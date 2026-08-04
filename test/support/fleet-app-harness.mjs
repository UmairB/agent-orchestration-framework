// Mount the REAL production <Fleet/> component tree headlessly against a REAL
// running fleet face (milestone 38 / story 04 / task 06).
//
// THE POINT, and the mechanism, now live in ./react-app-harness.mjs — the
// surface-agnostic core (bundle the real .tsx, substitute only what React itself
// would provide, instrument every request, run a controllable clock). Extracted
// there for milestone 43 / story 04 (ADR-010 R4.5), which needs the same
// instrument for the BOARD; this file keeps exactly what is fleet-specific:
//
//   - the ENTRY (ui/src/fleet/Fleet.tsx) and its one net-new stub (the terminal
//     view, which wants xterm + a real DOM canvas — story 06 owns its lanes, and
//     rendering nothing here is exactly what the production component does for an
//     assignment with no live session);
//   - the ACCESSORS: how a lane addresses a fleet card, its region-6 affordance
//     row and the DG-13 geometry facts.
//
// The driver's shape is unchanged from the pre-extraction harness — every
// existing caller (fleet-assign-acknowledgment, fleet-assign-affordance,
// fleet-assign-row-geometry, mesh-ui-assign-item-workspace) sees the same
// { flush, clock, tree, cards(), affordance(ref), statusLoads(), … } it did.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withMountedApp, findAll, textOf, FRAGMENT } from "./react-app-harness.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FLEET_TSX = path.join(repoRoot, "ui", "src", "fleet", "Fleet.tsx");

// story 06's terminal view wants xterm + a real DOM canvas; it is not what these
// lanes are about and it has its own suites. Rendering nothing here is exactly
// what the production component does for an assignment with no live session.
const VIRTUAL_TERMINAL_VIEW = "export const FleetTerminalView = () => null;\n";

const FLEET_STUBS = { __terminal_view__: VIRTUAL_TERMINAL_VIEW };
const FLEET_RESOLVE = [{ filter: /terminal-view\/FleetTerminalView$/, to: "__terminal_view__" }];

// withFleetApp({ url, search }, fn) — mounts the REAL <Fleet/> against the REAL
// fleet face listening at `url`, and yields a driver:
//   { flush, clock, tree, cards(), card(ref), statusLoads(), unmount }
export async function withFleetApp({ url, search = "?mode=fleet" }, fn) {
  return withMountedApp(
    {
      entry: FLEET_TSX,
      exportName: "Fleet",
      stubs: FLEET_STUBS,
      resolve: FLEET_RESOLVE,
      url,
      search,
      accessors: (driver) => fleetAccessors(driver),
    },
    fn,
  );
}

function fleetAccessors(driver) {
  return {
    statusLoads: () => driver.requestsMatching("/api/mesh/status").length,
    assignPosts: () => driver.requestsMatching("/api/mesh/assign").length,
    // Every work-item card on screen, in render order — a card being the root
    // <div> that carries the card's own class marker AND a picker. On a GLOBAL
    // face these come from MANY workspaces, which is the whole point of F21:
    // two cards can carry the same ref.
    cards() {
      return findAll(
        driver.tree(),
        (node) =>
          node.type === "div"
          && typeof node.props?.className === "string"
          && node.props.className.includes("rounded-[10px]")
          && findAll(node, (inner) => inner.type === "select" && String(inner.props?.["aria-label"] ?? "").startsWith("Assign ")).length > 0,
      );
    },
    // cardByTitle(title) — the way the OPERATOR addresses a card: by the
    // milestone title they can read. This is how the soak's click is
    // reproduced, since ref alone is ambiguous across workspaces.
    cardByTitle(title) {
      const matches = driver.cards().filter((card) => textOf(card).includes(title));
      if (matches.length === 0) return null;
      if (matches.length > 1) throw new Error(`more than one card matches the title ${JSON.stringify(title)}`);
      return driver.affordanceIn(matches[0]);
    },
    // The affordance row for a card, addressed the way the operator does:
    // through the <select>'s accessible name ("Assign <ref> to a worker node").
    affordance(ref) {
      const tree = driver.tree();
      const selects = findAll(tree, (node) => node.type === "select" && node.props?.["aria-label"] === `Assign ${ref} to a worker node`);
      if (selects.length === 0) return null;
      if (selects.length > 1) throw new Error(`more than one affordance renders for ref ${ref} — address the card by title instead`);
      return driver.affordanceIn(selects[0]);
    },
    // affordanceIn(node) — the region-6 facts for a card (or for the picker
    // itself). Region 6 is the row that DIRECTLY contains the picker; the
    // action and the message slot are its siblings there. Addressed
    // structurally (never by index), so a layout change fails loudly.
    affordanceIn(node) {
      const tree = driver.tree();
      const select = node.type === "select"
        ? node
        : findAll(node, (inner) => inner.type === "select" && String(inner.props?.["aria-label"] ?? "").startsWith("Assign "))[0];
      if (!select) return null;
      const card = findAll(
        tree,
        (candidate) =>
          candidate.type === "div"
          && typeof candidate.props?.className === "string"
          && candidate.props.className.includes("rounded-[10px]")
          && findAll(candidate, (inner) => inner === select).length > 0,
      )[0] ?? null;
      const row = findAll(tree, (candidate) => (candidate.children ?? []).includes(select))[0] ?? null;
      const action = (row?.children ?? []).find((child) => child && child.type === "button") ?? null;
      const message = (row?.children ?? []).find((child) => child && child.type === "span" && typeof child.props?.className === "string" && child.props.className.includes("text-destructive")) ?? null;
      const optionNodes = findAll(select, (child) => child.type === "option");
      const options = optionNodes.map((child) => child.props?.value ?? "");
      // DG-13 — the row's GEOMETRY, read off the RENDERED props/classNames
      // (the house idiom: a class/structure fact, asserted where the component
      // actually emits it). The action's width lives on its inner sizing
      // shell; the picker's floor on the <select> itself; the message slot's
      // full text on its native `title`.
      const actionSizer = action ? findAll(action, (child) => child.type === "span")[0] ?? null : null;
      // The one honest placeholder an EMPTY roster renders ("No worker nodes
      // yet") — a single valueless option. Exposed so the empty-roster row of
      // the States table can be read off the RENDERED tree, not only derived
      // from the reducer.
      const placeholder = optionNodes.length === 1 && (optionNodes[0].props?.value ?? "") === "" ? optionNodes[0] : null;
      return {
        select,
        action,
        // The WHOLE card node (all six regions) — so a region-5 assertion is
        // made against the SAME rendered tree as region 6's affordance.
        card,
        row,
        // The WHOLE card (all six regions) — so region 5's m35 `assigned` chip
        // is read from the SAME rendered tree as region 6's affordance, never
        // from the payload.
        cardText: card ? textOf(card) : "",
        options,
        pickerPlaceholder: placeholder ? textOf(placeholder) : null,
        selectedNode: select.props?.value ?? "",
        selectDisabled: select.props?.disabled === true,
        selectClassName: select.props?.className ?? "",
        selectStyle: select.props?.style ?? null,
        actionLabel: textOf(action),
        actionDisabled: action?.props?.disabled === true,
        actionClassName: action?.props?.className ?? "",
        actionSizerClassName: actionSizer?.props?.className ?? "",
        actionSizerStyle: actionSizer?.props?.style ?? null,
        // The row's own direct children, by kind — DG-13 clause 1's "a label
        // swap may not move another element" is only meaningful if the row's
        // membership is itself constant.
        rowChildTypes: (row?.children ?? []).filter(Boolean).map((child) => (typeof child === "object" ? child.type : "#text")),
        message: message ? textOf(message) : null,
        messageClassName: message?.props?.className ?? "",
        messageTitle: message?.props?.title ?? null,
        async choose(nodeId) {
          select.props?.onChange?.({ target: { value: nodeId } });
          await driver.flush();
        },
        async click() {
          const event = { stopPropagation() {}, preventDefault() {} };
          await action?.props?.onClick?.(event);
          await driver.flush();
        },
        // clickDetached() — fire the REAL click WITHOUT awaiting it, so the
        // caller can read the tree mid-flight (pair with holdNext + renderOnly)
        // and settle afterwards.
        clickDetached() {
          const event = { stopPropagation() {}, preventDefault() {} };
          const pending = action?.props?.onClick?.(event);
          return {
            async settle() {
              await pending;
              await driver.flush();
            },
          };
        },
      };
    },
  };
}

// Re-exported so a lane can query REGIONS the affordance driver does not model
// (region 5's footer / attention cluster — DG-13 clause 5) off the same tree.
export { FRAGMENT, findAll, textOf };
