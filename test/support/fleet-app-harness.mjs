// Mount the REAL production <Fleet/> component tree headlessly against a REAL
// running fleet face (milestone 38 / story 04 / task 06).
//
// THE POINT (STATE.md F-38.06e + F-38.06d). A pure-helper test of the F22
// acknowledgment would prove the state machine and nothing about production —
// "a state satisfied by calling the reducer directly proved nothing, because
// production could never drive it". And producer-fed must mean producer-
// SEQUENCED: the real click, through the real api client, to the real route,
// against the real store, in the real order. So this harness:
//
//   - esbuild-bundles the REAL, UNMODIFIED ui/src/fleet/Fleet.tsx (with the real
//     ./api.ts, ./scope.mjs, ./assignments.mjs, ./assign-affordance.mjs …
//     bundled in — nothing about the code under test is stubbed);
//   - substitutes ONLY the environment React itself would provide: a minimal
//     react / react/jsx-runtime (test/support/mini-react.mjs), a no-op
//     FleetTerminalView (it wants xterm + a DOM, and story 06 owns its lanes),
//     `location`/`history`, and a `fetch` that resolves the app's same-origin
//     relative URLs against the fixture server's real origin;
//   - runs a CONTROLLABLE clock, so "held for EXACTLY one poll interval" and
//     "exactly ONE extra load, no second cadence" are deterministic.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRuntime, createClock, findAll, textOf, FRAGMENT } from "./mini-react.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FLEET_TSX = path.join(repoRoot, "ui", "src", "fleet", "Fleet.tsx");

// The virtual `react` + `react/jsx-runtime` the bundle links against. They
// delegate to `globalThis.__AOF_MINI_REACT__`, which the harness sets BEFORE
// importing the bundle — so the runtime the components call is the very object
// this harness drives (an inlined copy would be a second, unreachable instance).
const VIRTUAL_REACT = `
const R = () => globalThis.__AOF_MINI_REACT__;
export const useState = (...a) => R().useState(...a);
export const useEffect = (...a) => R().useEffect(...a);
export const useLayoutEffect = (...a) => R().useEffect(...a);
export const useCallback = (...a) => R().useCallback(...a);
export const useMemo = (...a) => R().useMemo(...a);
export const useRef = (...a) => R().useRef(...a);
export const Fragment = Symbol.for("aof.mini.fragment");
export default { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, Fragment };
`;

const VIRTUAL_JSX = `
const R = () => globalThis.__AOF_MINI_REACT__;
export const jsx = (type, props, key) => R().jsx(type, props, key);
export const jsxs = (type, props, key) => R().jsx(type, props, key);
export const jsxDEV = (type, props, key) => R().jsx(type, props, key);
export const Fragment = Symbol.for("aof.mini.fragment");
`;

// story 06's terminal view wants xterm + a real DOM canvas; it is not what these
// lanes are about and it has its own suites. Rendering nothing here is exactly
// what the production component does for an assignment with no live session.
const VIRTUAL_TERMINAL_VIEW = "export const FleetTerminalView = () => null;\n";

let cachedBundle = null;

async function buildFleetBundle() {
  if (cachedBundle) return cachedBundle;
  const esbuild = await import("esbuild");
  const stubs = new Map([
    ["react", VIRTUAL_REACT],
    ["react/jsx-runtime", VIRTUAL_JSX],
    ["react/jsx-dev-runtime", VIRTUAL_JSX],
    ["__terminal_view__", VIRTUAL_TERMINAL_VIEW],
  ]);
  const stubPlugin = {
    name: "aof-fleet-harness-stubs",
    setup(build) {
      build.onResolve({ filter: /^react(\/jsx-(dev-)?runtime)?$/ }, (args) => ({ path: args.path, namespace: "aof-stub" }));
      build.onResolve({ filter: /terminal-view\/FleetTerminalView$/ }, () => ({ path: "__terminal_view__", namespace: "aof-stub" }));
      build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: "aof-empty" }));
      build.onLoad({ filter: /.*/, namespace: "aof-stub" }, (args) => ({ contents: stubs.get(args.path) ?? "export default {};", loader: "js" }));
      build.onLoad({ filter: /.*/, namespace: "aof-empty" }, () => ({ contents: "", loader: "js" }));
    },
  };
  const result = await esbuild.build({
    entryPoints: [FLEET_TSX],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    jsx: "automatic",
    target: "es2022",
    logLevel: "silent",
    plugins: [stubPlugin],
  });
  cachedBundle = result.outputFiles[0].text;
  return cachedBundle;
}

// withFleetApp({ url, search }, fn) — mounts the REAL <Fleet/> against the REAL
// fleet face listening at `url`, and yields a driver:
//   { flush, clock, tree, cards(), card(ref), statusLoads(), unmount }
export async function withFleetApp({ url, search = "?mode=fleet" }, fn) {
  const bundleSource = await buildFleetBundle();
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-fleet-harness-"));
  const bundlePath = path.join(tmp, `fleet-${Date.now()}.mjs`);

  const renderer = createRuntime();
  const clock = createClock();
  const origin = new URL(url).origin;

  const previous = {
    react: globalThis.__AOF_MINI_REACT__,
    fetch: globalThis.fetch,
    location: globalThis.location,
    history: globalThis.history,
    window: globalThis.window,
  };

  // Every request the app makes, in order — the ONLY instrument between the app
  // and the real server. It rewrites the app's same-origin relative URLs onto
  // the fixture origin and records them, so "exactly ONE extra status load per
  // successful assign" is measured from the app's ACTUAL traffic.
  const requests = [];
  const inflight = new Set();
  // The subset of `inflight` belonging to a DELIBERATELY HELD response. A flush
  // that waited on one of these would hang forever by construction — which is
  // the whole point of a hung POST (DG-14) — so `flush({ ignoreHeld: true })`
  // settles everything EXCEPT them: the app's polls still land, its renders
  // still settle, and only the held round trip stays pending.
  const heldInflight = new Set();
  const holds = [];
  const realFetch = previous.fetch;

  // The BODY the app actually put on the wire, recorded verbatim beside the URL
  // (parsed when it is JSON, which every write this face makes is). A lane that
  // asserts "the POST the app SENT carries <x>" must read the app's own request,
  // not a hand-built one — and for a wrong-target defect the store row alone
  // cannot say whether the app or the route chose the wrong value.
  const bodyOf = (init) => {
    if (typeof init?.body !== "string") return null;
    try {
      return JSON.parse(init.body);
    } catch {
      return null;
    }
  };

  globalThis.__AOF_MINI_REACT__ = renderer.runtime;
  globalThis.fetch = (input, init) => {
    const raw = typeof input === "string" ? input : input?.url ?? String(input);
    const absolute = /^https?:/i.test(raw) ? raw : new URL(raw, origin).toString();
    requests.push({
      url: absolute,
      method: (init?.method ?? "GET").toUpperCase(),
      at: clock.now(),
      body: bodyOf(init),
      rawBody: typeof init?.body === "string" ? init.body : null,
    });
    // A HOLD delays only the DELIVERY of this response to the app — the request
    // is really issued to the real server and really answered; the app's own
    // await simply stays pending, exactly as a slow round trip leaves it. It is
    // what makes an in-flight read deterministic instead of a race with a
    // millisecond-fast loopback POST.
    const hold = holds.find((entry) => !entry.claimed && absolute.includes(entry.fragment));
    if (hold) hold.claimed = true;
    const headers = { ...(init?.headers ?? {}) };
    // A real browser attaches the page's own Origin to a same-origin POST; node's
    // fetch does not. Supplying it here reproduces the browser envelope the
    // route's SECURITY T13 admission guard is written against — it is the
    // BROWSER's behaviour being stood in for, never the app's.
    if ((init?.method ?? "GET").toUpperCase() !== "GET") headers.origin = origin;
    const track = (promise, held = false) => {
      inflight.add(promise);
      if (held) heldInflight.add(promise);
      const forget = () => { inflight.delete(promise); heldInflight.delete(promise); };
      promise.then(forget, forget);
      return promise;
    };
    // The Response is wrapped so the app's OWN body reads (`response.json()`)
    // are tracked too — a fetch whose promise has settled but whose body has not
    // been parsed yet is still work in flight, and reading the tree before it
    // lands would assert against a loading screen.
    return track(realFetch(absolute, { ...init, headers }).then(async (response) => {
      if (hold) {
        // The REAL server has now answered — the request was really issued and
        // really processed; only its delivery to the app is held. A lane that
        // asserts a server-side FACT (the record the hung dispatch minted) must
        // wait for this, or it races the real round trip.
        hold.arrive();
        await hold.gate;
      }
      return response;
    }).then((response) => ({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      url: response.url,
      json: () => track(response.json()),
      text: () => track(response.text()),
    })), Boolean(hold));
  };
  globalThis.location = { search, pathname: "/", href: `${origin}/${search}`, assign() {} };
  globalThis.history = { pushState() {} };
  globalThis.window = { location: globalThis.location, history: globalThis.history };

  clock.install();
  try {
    await writeFile(bundlePath, bundleSource, "utf8");
    const mod = await import(pathToFileURL(bundlePath).href);
    const Fleet = mod.Fleet;
    if (typeof Fleet !== "function") throw new Error("the Fleet bundle did not export a Fleet component");

    renderer.mount({ $$el: Symbol.for("aof.mini.element"), type: Fleet, props: {}, key: null });

    // flush() — settle the app: let every in-flight REAL request land, re-render
    // until the tree is stable, and repeat while either is still moving. This is
    // the browser's "between paints" boundary; a fetch the app fired must be
    // allowed to land before the tree is read, or a test would assert against a
    // loading screen. Bounded, so a genuine loop fails loudly.
    const flush = async ({ ignoreHeld = false } = {}) => {
      let stable = 0;
      for (let pass = 0; pass < 400; pass += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        const pending = ignoreHeld ? [...inflight].filter((entry) => !heldInflight.has(entry)) : [...inflight];
        if (pending.length > 0) {
          await Promise.allSettled(pending);
          stable = 0;
          continue;
        }
        if (renderer.isDirty()) {
          renderer.render();
          stable = 0;
          continue;
        }
        stable += 1;
        if (stable >= 5) return renderer.tree();
      }
      throw new Error("fleet harness: the app never settled");
    };

    // renderOnly() — settle the RENDER without waiting for the network: the
    // browser's "between paints" boundary WHILE a request is still in flight.
    // This is what lets a lane read the tree between the click's synchronous
    // `onState(sending)` and the awaited fetch (the DESIGN States table's
    // `assigning` row, read off the REAL rendered tree instead of the reducer).
    const renderOnly = async () => {
      for (let pass = 0; pass < 50; pass += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        if (!renderer.isDirty()) break;
        renderer.render();
      }
      return renderer.tree();
    };

    await flush();

    const driver = {
      clock,
      flush,
      renderOnly,
      tree: () => renderer.tree(),
      requests: () => requests.slice(),
      // holdNext(fragment) — hold the DELIVERY of the next response whose URL
      // contains `fragment` until release() is called (see the fetch wrapper).
      holdNext(fragment) {
        let release = () => {};
        let arrive = () => {};
        const gate = new Promise((resolve) => { release = resolve; });
        const arrived = new Promise((resolve) => { arrive = resolve; });
        const entry = { fragment, gate, claimed: false, arrive: () => arrive() };
        holds.push(entry);
        return {
          release() {
            release();
            holds.splice(holds.indexOf(entry), 1);
          },
          claimed: () => entry.claimed,
          // answered() — resolves once the REAL server has answered this
          // request, while its delivery to the app stays held. It is the join
          // point between "the app is still waiting" and "the server-side
          // effect has really happened", which is exactly the state DG-14's
          // hung POST is about — and awaiting it also keeps a real request from
          // outliving the fixture server's teardown.
          answered: () => arrived,
        };
      },
      statusLoads: () => requests.filter((entry) => entry.url.includes("/api/mesh/status")).length,
      assignPosts: () => requests.filter((entry) => entry.url.includes("/api/mesh/assign")).length,
      // advance(ms) — move the controllable clock, re-rendering between each
      // timer callback exactly as a browser would between paints.
      advance: (ms) => clock.advance(ms, flush),
      // advanceHeld(ms) — the SAME clock advance, settling everything EXCEPT a
      // deliberately-held response. Required whenever a delivery is held
      // (holdNext): plain flush() waits for every in-flight request to land and
      // a held one never will — which is the exact condition DG-14's timeout is
      // about. The app's own polls still land, so the tree read after the
      // advance is the settled one.
      advanceHeld: (ms) => clock.advance(ms, () => flush({ ignoreHeld: true })),
      // Every work-item card on screen, in render order — a card being the root
      // <div> that carries the card's own class marker AND a picker. On a GLOBAL
      // face these come from MANY workspaces, which is the whole point of F21:
      // two cards can carry the same ref.
      cards() {
        return findAll(
          renderer.tree(),
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
        const tree = renderer.tree();
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
        const tree = renderer.tree();
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
            await flush();
          },
          async click() {
            const event = { stopPropagation() {}, preventDefault() {} };
            await action?.props?.onClick?.(event);
            await flush();
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
                await flush();
              },
            };
          },
        };
      },
    };

    return await fn(driver);
  } finally {
    renderer.unmount();
    clock.restore();
    globalThis.__AOF_MINI_REACT__ = previous.react;
    globalThis.fetch = previous.fetch;
    if (previous.location === undefined) delete globalThis.location; else globalThis.location = previous.location;
    if (previous.history === undefined) delete globalThis.history; else globalThis.history = previous.history;
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
    await rm(tmp, { recursive: true, force: true });
  }
}

// Re-exported so a lane can query REGIONS the affordance driver does not model
// (region 5's footer / attention cluster — DG-13 clause 5) off the same tree.
export { FRAGMENT, findAll, textOf };
