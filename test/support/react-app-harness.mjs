// The SURFACE-AGNOSTIC half of the headless mount harness: esbuild-bundle a REAL
// production React surface, mount it against a REAL running face, and drive it on
// a controllable clock (milestone 38 / story 04 / task 06 — extracted for
// milestone 43 / story 04, ADR-010 R4.5).
//
// THE POINT (STATE.md F-38.06e + F-38.06d), unchanged by the extraction. A pure-
// helper test of a UI state proves the state machine and nothing about
// production — "a state satisfied by calling the reducer directly proved nothing,
// because production could never drive it". And producer-fed must mean producer-
// SEQUENCED: the real click, through the real api client, to the real route,
// against the real store, in the real order. So this core:
//
//   - esbuild-bundles the REAL, UNMODIFIED .tsx entry (with its real siblings
//     bundled in — nothing about the code under test is stubbed);
//   - substitutes ONLY the environment React itself would provide: a minimal
//     react / react/jsx-runtime (test/support/mini-react.mjs), `location` /
//     `history` / `window`, a `fetch` that resolves the app's same-origin
//     relative URLs against the fixture server's real origin — plus whatever
//     leaf the CALLER declares unmountable here (the fleet's xterm terminal
//     view; the board's TerminalDock and its icon pack);
//   - runs a CONTROLLABLE clock, so "held for EXACTLY one poll interval",
//     "exactly ONE extra load, no second cadence" and "the badge appears within
//     one second of the crossing" are deterministic rather than sleeps.
//
// WHAT BELONGS HERE vs IN A SURFACE HARNESS. Everything above is surface-
// agnostic and lives here. A surface harness (fleet-app-harness.mjs,
// board-app-harness.mjs) supplies three things and nothing else: its ENTRY +
// export name, its STUBS (the leaves React itself would not provide), and its
// ACCESSORS (how a lane addresses that surface's regions).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRuntime, createClock, findAll, textOf, visibleTextOf, FRAGMENT } from "./mini-react.mjs";

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
// The class base, present for ONE reason: an error boundary has no function-component
// form, so without it the shell's "a failing surface degrades in place" contract is
// undrivable headlessly (m45 / F-45-M-1). \`isReactComponent\` on the prototype is the
// same marker React itself uses, and it is what mini-react's renderer branches on.
// \`setState\` is replaced per instance by the renderer, which owns the dirty flag.
export class Component {
  constructor(props) { this.props = props; this.state = null; }
  setState() { throw new Error("setState called before the renderer mounted this component"); }
  render() { return null; }
}
Component.prototype.isReactComponent = {};
export default { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, Fragment, Component };
`;

const VIRTUAL_JSX = `
const R = () => globalThis.__AOF_MINI_REACT__;
export const jsx = (type, props, key) => R().jsx(type, props, key);
export const jsxs = (type, props, key) => R().jsx(type, props, key);
export const jsxDEV = (type, props, key) => R().jsx(type, props, key);
export const Fragment = Symbol.for("aof.mini.fragment");
`;

// One bundle per (entry, stub set) — building the real component tree is the
// expensive part of a lane, and every lane in a suite mounts the same surface.
const bundleCache = new Map();

// bundleSurface({ entry, stubs, resolve }) — the REAL entry, bundled.
//   `stubs`  — { <virtual name>: <module source> }, the leaves React itself
//              would not provide (a terminal that wants xterm + a DOM canvas, an
//              icon pack that is 1,500 SVG modules).
//   `resolve`— [{ filter: RegExp, to: <virtual name> }], how an import specifier
//              in the real source reaches one of those stubs.
export async function bundleSurface({ entry, stubs = {}, resolve = [] }) {
  const key = `${entry}::${Object.keys(stubs).sort().join(",")}`;
  const cached = bundleCache.get(key);
  if (cached) return cached;

  const esbuild = await import("esbuild");
  const sources = new Map([
    ["react", VIRTUAL_REACT],
    ["react/jsx-runtime", VIRTUAL_JSX],
    ["react/jsx-dev-runtime", VIRTUAL_JSX],
    ...Object.entries(stubs),
  ]);
  const stubPlugin = {
    name: "aof-app-harness-stubs",
    setup(build) {
      build.onResolve({ filter: /^react(\/jsx-(dev-)?runtime)?$/ }, (args) => ({ path: args.path, namespace: "aof-stub" }));
      for (const entry of resolve) {
        build.onResolve({ filter: entry.filter }, () => ({ path: entry.to, namespace: "aof-stub" }));
      }
      build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: "aof-empty" }));
      build.onLoad({ filter: /.*/, namespace: "aof-stub" }, (args) => ({ contents: sources.get(args.path) ?? "export default {};", loader: "js" }));
      build.onLoad({ filter: /.*/, namespace: "aof-empty" }, () => ({ contents: "", loader: "js" }));
    },
  };
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    jsx: "automatic",
    target: "es2022",
    logLevel: "silent",
    plugins: [stubPlugin],
  });
  const text = result.outputFiles[0].text;
  bundleCache.set(key, text);
  return text;
}

// withMountedApp({ entry, exportName, stubs, resolve, url, search, hash, epoch,
// accessors }, fn) — mount the REAL surface against the REAL face listening at
// `url` and yield a driver. The CORE driver is
//   { clock, flush, renderOnly, tree, requests, advance, advanceHeld, holdNext,
//     requestsMatching, unmount }
// and `accessors(driver)` adds the surface's own vocabulary on top.
//
// `epoch` — when supplied, the controllable clock ALSO owns `Date.now()`, based
// at that instant. A surface whose behaviour is a function of wall-clock time
// (the board's freshness ramp: "the badge appears within one second of the
// crossing") cannot be driven otherwise — advancing timers alone would fire the
// tick while `Date.now()` stayed put, and the assertion would measure nothing.
export async function withMountedApp(options, fn) {
  const { entry, exportName, stubs, resolve, url, search = "/", hash = "", epoch = null, accessors, settle = "flush", holdFromStart = null } = options;
  const bundleSource = await bundleSurface({ entry, stubs, resolve });
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-app-harness-"));
  const bundlePath = path.join(tmp, `app-${Date.now()}.mjs`);

  const renderer = createRuntime();
  const clock = createClock({ epoch });
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
  // successful assign" / "ZERO additional requests across the crossing" are
  // measured from the app's ACTUAL traffic.
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

  // createHold(fragment) — arm a hold and return its handle. Extracted from `holdNext` so a
  // hold can also be armed BEFORE the mount (`holdFromStart`, below): an app's FIRST request
  // is fired during its first render, so by the time a lane has a driver to call `holdNext`
  // on, the one request it wanted to hold has already been delivered. On a loopback fixture
  // that race is not close — it is lost every time — which is why a surface's own LOADING
  // state was unreachable through this harness for anything that fetches on mount.
  const createHold = (fragment) => {
    let release = () => {};
    let arrive = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const arrived = new Promise((resolve) => { arrive = resolve; });
    const entry = { fragment, gate, claimed: false, arrive: () => arrive() };
    holds.push(entry);
    return {
      release() {
        release();
        const at = holds.indexOf(entry);
        if (at >= 0) holds.splice(at, 1);
      },
      claimed: () => entry.claimed,
      // answered() — resolves once the REAL server has answered this request, while its
      // delivery to the app stays held. It is the join point between "the app is still
      // waiting" and "the server-side effect has really happened", which is exactly the state
      // DG-14's hung POST is about — and awaiting it also keeps a real request from outliving
      // the fixture server's teardown.
      answered: () => arrived,
    };
  };

  // Holds armed before the first render, in declaration order. A lane reads them back off the
  // driver (`driver.startHolds()`) to release them and watch the app settle.
  const startHolds = (Array.isArray(holdFromStart) ? holdFromStart : holdFromStart === null || holdFromStart === undefined ? [] : [holdFromStart]).map(createHold);

  // The BODY the app actually put on the wire, recorded verbatim beside the URL
  // (parsed when it is JSON, which every write these faces make is). A lane that
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
  // A MINIMAL `document`, reachable as `window.document` only.
  //
  // It exists for one class of behaviour that is genuinely document-level and cannot be
  // reached through a component's props: a DOCUMENT-scoped key listener. The app shell owns
  // `Escape` for its fullscreen occupant (m45/ADR-005 [Build-2]) by adding a `keydown`
  // listener to `document` — there is nowhere else to add it, because the point is that the
  // key works wherever focus happens to be. Without this, the only way to drive that clause
  // was to call the reducer directly, which is exactly the "a state satisfied by calling the
  // reducer directly proved nothing" defect this harness exists to stop.
  //
  // DELIBERATELY NOT on `globalThis`. Production reads it as `window.document` behind a guard;
  // publishing a bare `document` global would change what `typeof document === "undefined"`
  // answers for every module in every surface's bundle, which is a much larger blast radius
  // than the one behaviour this enables.
  //
  // The query methods answer EMPTY rather than throwing, and that is the honest answer: this
  // is a mini-React tree, not a DOM, so nothing here can be found by selector and nothing has
  // layout. A component that measures or queries must take a seam (the shell's `noticeHeight`
  // / `viewportWidth` props) — a stub that pretended otherwise would let a lane assert against
  // a measurement nobody made.
  const documentListeners = new Map();
  const documentStub = {
    activeElement: null,
    addEventListener(type, handler) {
      if (typeof handler !== "function") return;
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      documentListeners.get(type)?.delete(handler);
    },
    // dispatchEvent(event) — deliver to the listeners attached RIGHT NOW (a copy, so a handler
    // that detaches during delivery does not mutate the set being iterated).
    dispatchEvent(event) {
      for (const handler of [...(documentListeners.get(event?.type) ?? [])]) handler(event);
      return true;
    },
    listenerCount: (type) => documentListeners.get(type)?.size ?? 0,
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  globalThis.location = { search, hash, pathname: "/", href: `${origin}/${search}${hash}`, assign() {} };
  globalThis.history = { pushState() {} };
  globalThis.window = { location: globalThis.location, history: globalThis.history, document: documentStub };

  clock.install();
  try {
    await writeFile(bundlePath, bundleSource, "utf8");
    const mod = await import(pathToFileURL(bundlePath).href);
    const App = mod[exportName];
    if (typeof App !== "function") throw new Error(`the bundle did not export a ${exportName} component`);

    renderer.mount({ $$el: Symbol.for("aof.mini.element"), type: App, props: {}, key: null });

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
      throw new Error("app harness: the app never settled");
    };

    // renderOnly() — settle the RENDER without waiting for the network: the
    // browser's "between paints" boundary WHILE a request is still in flight.
    // This is what lets a lane read the tree between the click's synchronous
    // `onState(sending)` and the awaited fetch (a DESIGN States table's
    // in-flight row, read off the REAL rendered tree instead of the reducer).
    const renderOnly = async () => {
      for (let pass = 0; pass < 50; pass += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        if (!renderer.isDirty()) break;
        renderer.render();
      }
      return renderer.tree();
    };

    // `settle: "render"` mounts WITHOUT waiting for the app's first request to
    // land — the only way to read a surface's own LOADING branch, which is a
    // state the DESIGN States tables assert ("no skeleton badge stands in for
    // one"). The lane settles the network itself afterwards.
    //
    // On a LOOPBACK fixture that is often not enough on its own: `renderOnly`
    // yields to the event loop between render passes, and a same-machine
    // response lands inside that window, so the tree read back is the populated
    // one. Pair it with `holdFromStart` when the loading state must be genuinely
    // frozen rather than merely raced for.
    if (settle === "render") await renderOnly();
    else await flush({ ignoreHeld: startHolds.length > 0 });

    const driver = {
      clock,
      flush,
      renderOnly,
      tree: () => renderer.tree(),
      requests: () => requests.slice(),
      // requestsMatching(fragment) — the app's own traffic to one route, which is
      // how "no list fetch, no doc fetch, no probe" and "exactly ONE resync
      // request left the app across the whole episode" are counted.
      requestsMatching: (fragment) => requests.filter((entry) => entry.url.includes(fragment)),
      // holdNext(fragment) — hold the DELIVERY of the next response whose URL
      // contains `fragment` until release() is called (see the fetch wrapper).
      holdNext: (fragment) => createHold(fragment),
      // The holds armed BEFORE the mount, in declaration order (`holdFromStart`).
      startHolds: () => startHolds.slice(),
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
      // The document the mounted app sees, for a lane that needs to inspect what
      // the app attached to it.
      document: () => documentStub,
      // press(key, init) — a real `keydown` at the DOCUMENT, delivered to the
      // listeners the app itself attached, then settled. This is how a
      // document-scoped key (the shell's `Escape`) is driven through the REAL
      // component rather than by calling its reducer.
      async press(key, init = {}) {
        let defaultPrevented = false;
        documentStub.dispatchEvent({
          type: "keydown",
          key,
          shiftKey: false,
          ...init,
          preventDefault() { defaultPrevented = true; },
          stopPropagation() {},
        });
        await flush();
        return { defaultPrevented };
      },
    };
    Object.assign(driver, accessors ? accessors(driver) : {});

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

// Re-exported so a surface harness (and a lane) can query regions its accessors
// do not model, off the same tree.
export { FRAGMENT, findAll, textOf, visibleTextOf };
