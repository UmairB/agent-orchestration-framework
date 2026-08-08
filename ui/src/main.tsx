// THE APPLICATION ENTRY (milestone 45 / story 03; ADR-001, ADR-002, ADR-003).
//
// Three acts and nothing else: mount, apply the legacy `?mode=` translation ONCE, and render
// the shell around the surface the ONE route table names. It was 1,267 lines until this
// milestone, because it was both the entry and the config editor — the render root was its
// last six lines and `<App>` was the other 1,260. `<App>` now lives at ui/src/config/App.tsx,
// its route's own name, and `test/arch/acd-ui-single-route-table.test.mjs` keeps it there: the
// entry IMPORTS surfaces and defines none.
//
// It keeps its name and its location because index.html hardcodes `/src/main.tsx`.
// `import "./index.css"` STAYS HERE: it is the global stylesheet for every surface, and moving
// it with `<App>` would take Tailwind away from the fleet and the board.
//
// THE TRANSLATION IS APPLIED EXACTLY ONCE, BEFORE THE FIRST RENDER, AS A REPLACE:
//   - once, so it cannot loop — and `legacyRedirectFor` returning null for its own output means
//     even a second application would be a no-op;
//   - before the first render, because the surface is selected from the POST-rewrite address:
//     every legacy address this system ever advertised has a bare "/" pathname, so selecting
//     first would render the shell landing for all of them;
//   - `replaceState`, never `pushState` — a pushed entry makes the back button bounce between
//     the legacy URL and the canonical one, and the legacy URL then re-redirects. A replace
//     leaves the history stack exactly as deep as the operator's own navigation made it;
//   - from LOCATION-SHAPED PARTS, never a hand-composed string: `location.search` may be "" and
//     `location.hash` carries its own "#", so composing a URL by hand is how a fragment gets
//     corrupted (measured: F-45-01-G).
//
// `VITE_AOF_UI_MODE` is RETIRED with the query selector (ADR-002): a build-time constant that
// is undefined in the shipped bundle was a second input to a decision that must have one.
import { StrictMode } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { routeFor } from "./app/routes.mjs";
import { applyEntryPlan, entryPlanFor, surfaceMountFor } from "./app/entry.mjs";
import { Shell } from "./app/Shell";
import { Board } from "@/board/Board";
import { Fleet } from "@/fleet/Fleet";
import { App } from "@/config/App";

// The route table's `id` column (ADR-002, binding) → the surface that renders it. `landing` and
// `not-found` are absent on purpose: the shell renders both itself, and milestone 49 replaces
// what `/` renders without touching this map.
const SURFACES: Record<string, () => ReactElement> = {
  fleet: () => <Fleet />,
  board: () => <Board />,
  config: () => <App />,
};

const plan = entryPlanFor({ pathname: location.pathname, search: location.search, hash: location.hash });
// The plan's ONE side effect, and it lives in ui/src/app/entry.mjs so that "exactly once, as a
// replace, to the plan's own address" is a claim a headless suite can hold it to.
applyEntryPlan(plan, history);

// The render root selects a surface by asking the ONE table, and by no other means.
const route = routeFor(plan.address.pathname);
// …and what it does with the answer is `surfaceMountFor`'s, for the failure it makes loud: a
// route id this map has no entry for (the shape 47 and 49 produce by adding a table row) used
// to mount `null` — an EMPTY `<main>` inside a working shell, indistinguishable from a surface
// with nothing to show. It is now the shell's own failed state, naming the surface.
const mount = surfaceMountFor(route.id, Object.keys(SURFACES));
const surface = mount.mounts ? SURFACES[route.id]() : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell routeId={route.id} address={plan.address} surface={surface} surfaceFailed={mount.surfaceFailed} />
  </StrictMode>,
);
