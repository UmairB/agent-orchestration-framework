// A MINIMAL React runtime + renderer, for driving the REAL production fleet
// components headlessly (milestone 38 / story 04 / task 06).
//
// WHY THIS EXISTS. This repo ships no React test harness, so the house pattern
// puts render-logic in pure .mjs helpers and tests those. STATE.md's F-38.06e
// records exactly where that stops being enough: *"a state satisfied by calling
// the reducer directly proved nothing, because production could never drive
// it."* A pure-helper test of the F22 acknowledgment would repeat that defect
// class — it would prove the state machine is correct while saying nothing
// about whether Fleet.tsx invokes it, or whether a real click fires the one
// silent re-load.
//
// So this module implements just enough of React — function components, the five
// hooks Fleet.tsx uses (useState/useEffect/useCallback/useMemo/useRef), keys,
// fragments, arrays, conditional children — to MOUNT the real, unmodified
// production component tree (esbuild-transpiled from the real .tsx) and drive
// real handlers. It is NOT a React implementation; it is a test instrument, and
// every divergence from React it could hide is a divergence the `npm run
// ui:build` type-check + the browser itself still cover.
//
// Model: render is synchronous and whole-tree; a setState marks the tree dirty
// and the caller flushes. Effects run after the render pass, cleanups run before
// a re-run and on unmount — the ordering the component's hold-then-decay timer
// depends on.

export const FRAGMENT = Symbol.for("aof.mini.fragment");
const ELEMENT = Symbol.for("aof.mini.element");

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

// A controllable clock. The component's `Sent` hold and <Fleet>'s poll are both
// timers; faking them makes "held for EXACTLY one poll interval" and "no second
// cadence" deterministic assertions instead of sleeps. Node's own fetch/http
// captured their timers at module load, long before install(), so real I/O is
// untouched.
//
// `epoch` (milestone 43 / story 04) — when supplied, install() ALSO owns
// `Date.now()`, reading `epoch + elapsed`. A surface whose behaviour is a
// function of wall-clock time rather than of timers alone — the board's
// freshness ramp is judged on `now - syncedAt`, recomputed off a 1s cosmetic
// tick — cannot be driven without it: advancing the timers would fire the tick
// while `Date.now()` stayed put, and "the badge appears within one second of the
// crossing" would measure nothing. Default absent, so every existing caller's
// `Date` is untouched.
export function createClock({ epoch = null } = {}) {
  let now = 0;
  let seq = 0;
  const scheduled = new Map();
  const real = {};

  // A handle that walks and quacks like a node Timeout for the callers that
  // poke at one — including `refresh()`, which node internals (and undici's
  // shared fast-timer tick) really do call. `refresh()` must genuinely re-arm:
  // a no-op would silently retire a timer its owner believes is still running.
  const AOF_FAKE_TIMER = Symbol.for("aof.mini.timer");
  const handle = (id) => ({
    id,
    [AOF_FAKE_TIMER]: true,
    unref() { return this; },
    ref() { return this; },
    refresh() {
      const entry = scheduled.get(id);
      if (entry) entry.at = now + entry.ms;
      return this;
    },
    [Symbol.toPrimitive]() { return id; },
  });

  const clock = {
    now: () => now,
    // The wall-clock instant the app reads through `Date.now()` — `epoch +
    // elapsed`. Exposed so a lane can state a fixture timestamp ("this row was
    // synced 299 seconds ago") in the SAME frame of reference the mounted app
    // judges it in, instead of guessing at the real clock.
    date: () => (epoch ?? 0) + now,
    pending: () => scheduled.size,
    setTimeout(fn, ms = 0, ...args) {
      const id = ++seq;
      scheduled.set(id, { at: now + ms, ms, fn, args, interval: null });
      return handle(id);
    },
    setInterval(fn, ms = 0, ...args) {
      const id = ++seq;
      scheduled.set(id, { at: now + ms, ms, fn, args, interval: Math.max(1, ms) });
      return handle(id);
    },
    // clear(token) — ONLY our own timers are ours to forget. A token that is not
    // one of our handles was armed by something else (node internals: undici
    // arms a real headers/body timeout per request, on the real timer wheel,
    // and clears it when the request completes) and MUST be cleared for real.
    //
    // Swallowing those is not a cosmetic bug. A clearTimeout that lands here and
    // does nothing leaves an orphan real timer armed against a socket whose
    // parser is subsequently destroyed — which surfaces, seconds later and in
    // an unrelated test, as undici's
    // `Cannot destructure property 'socket' of 'parser.deref(...)'` crashing the
    // whole run. Observed while building DG-14's held-response lanes, which
    // widen the window in which a real request is in flight across an installed
    // fake clock.
    clear(token) {
      if (token == null) return;
      if (typeof token === "object" && token[AOF_FAKE_TIMER] === true) {
        scheduled.delete(token.id);
        return;
      }
      if (typeof token === "number" && scheduled.has(token)) {
        scheduled.delete(token);
        return;
      }
      real.clearTimeout?.(token);
      real.clearInterval?.(token);
    },
    // advance(ms, onFire) — fire every callback due within the window, in time
    // order, re-arming intervals. `onFire` lets the caller flush the renderer
    // between callbacks (a timer that calls setState must re-render before the
    // next one runs, exactly as it would in a browser).
    async advance(ms, onFire) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [id, entry] of scheduled) {
          if (entry.at > target) continue;
          if (next == null || entry.at < next.entry.at) next = { id, entry };
        }
        if (next == null) break;
        now = next.entry.at;
        if (next.entry.interval == null) scheduled.delete(next.id);
        else next.entry.at = now + next.entry.interval;
        next.entry.fn(...next.entry.args);
        if (onFire) await onFire();
      }
      now = target;
    },
    install() {
      real.setTimeout = globalThis.setTimeout;
      real.clearTimeout = globalThis.clearTimeout;
      real.setInterval = globalThis.setInterval;
      real.clearInterval = globalThis.clearInterval;
      globalThis.setTimeout = clock.setTimeout;
      globalThis.clearTimeout = clock.clear;
      globalThis.setInterval = clock.setInterval;
      globalThis.clearInterval = clock.clear;
      // Only `Date.now` is taken, and only when an epoch was asked for — never
      // the `Date` constructor, so `new Date(iso)` / `Date.parse` (how every
      // timestamp on these wires is read) keep their real behaviour.
      if (epoch != null) {
        real.dateNow = Date.now;
        Date.now = () => epoch + now;
      }
      return real;
    },
    restore() {
      if (real.setTimeout) globalThis.setTimeout = real.setTimeout;
      if (real.clearTimeout) globalThis.clearTimeout = real.clearTimeout;
      if (real.setInterval) globalThis.setInterval = real.setInterval;
      if (real.clearInterval) globalThis.clearInterval = real.clearInterval;
      if (real.dateNow) Date.now = real.dateNow;
    },
  };
  return clock;
}

export function createRuntime() {
  let current = null;
  let hookIndex = 0;
  let dirty = false;
  let pendingEffects = [];

  const runtime = {
    // The jsx-runtime factory (jsx/jsxs/jsxDEV all land here).
    jsx(type, props, key) {
      return { $$el: ELEMENT, type, props: props ?? {}, key: key ?? null };
    },
    Fragment: FRAGMENT,
    useState(initial) {
      const instance = current;
      const index = hookIndex++;
      if (instance.hooks.length <= index) {
        instance.hooks.push({ value: typeof initial === "function" ? initial() : initial });
      }
      const hook = instance.hooks[index];
      if (!hook.set) {
        hook.set = (next) => {
          const value = typeof next === "function" ? next(hook.value) : next;
          if (Object.is(value, hook.value)) return;
          hook.value = value;
          dirty = true;
        };
      }
      return [hook.value, hook.set];
    },
    useRef(initial) {
      const instance = current;
      const index = hookIndex++;
      if (instance.hooks.length <= index) instance.hooks.push({ ref: { current: initial } });
      return instance.hooks[index].ref;
    },
    useMemo(factory, deps) {
      const instance = current;
      const index = hookIndex++;
      if (instance.hooks.length <= index) instance.hooks.push({ deps: undefined, memo: undefined });
      const hook = instance.hooks[index];
      if (!sameDeps(hook.deps, deps)) {
        hook.memo = factory();
        hook.deps = deps;
      }
      return hook.memo;
    },
    useCallback(fn, deps) {
      return runtime.useMemo(() => fn, deps);
    },
    useEffect(effect, deps) {
      const instance = current;
      const index = hookIndex++;
      if (instance.hooks.length <= index) instance.hooks.push({ deps: undefined, cleanup: null, mounted: false });
      const hook = instance.hooks[index];
      if (!hook.mounted || !sameDeps(hook.deps, deps)) {
        hook.deps = deps;
        hook.mounted = true;
        pendingEffects.push(hook.__pending = { hook, effect });
      }
    },
  };

  const instances = new Map();
  let rootElement = null;

  function renderNode(node, pathKey, seen) {
    if (node == null || node === false || node === true) return null;
    if (Array.isArray(node)) {
      return node.flatMap((child, index) => {
        const rendered = renderNode(child, `${pathKey}[${child?.key ?? index}]`, seen);
        return rendered == null ? [] : [rendered];
      });
    }
    if (typeof node !== "object") return String(node);
    if (node.$$el !== ELEMENT) return null;

    const { type, props, key } = node;
    if (type === FRAGMENT) {
      return renderNode(props.children ?? null, `${pathKey}<>${key ?? ""}`, seen);
    }
    // CLASS COMPONENTS, and the ONE reason they are here: ERROR BOUNDARIES (milestone 45,
    // finding F-45-M-1). A boundary is the only containment React offers for a surface that
    // throws while rendering, and it has no function-component form — so a shell that
    // promises "a failing surface degrades in place, the chrome survives" could not be
    // driven headlessly at all. That is the same defect class this module's own header
    // names: a rule nothing can check. Support is deliberately the minimum that makes a
    // boundary real — construct, `state`, `setState`, `getDerivedStateFromError`,
    // `componentDidCatch`, `render` — and nothing else (no lifecycle beyond the catch pair,
    // no `forceUpdate`). React marks these with `prototype.isReactComponent`; so do we.
    if (typeof type === "function" && type.prototype?.isReactComponent) {
      const name = type.name || "anon";
      const instanceKey = `${pathKey}/${name}#${key ?? ""}`;
      seen.add(instanceKey);
      let instance = instances.get(instanceKey);
      if (!instance) {
        instance = { hooks: [], key: instanceKey, classInstance: null };
        instances.set(instanceKey, instance);
      }
      if (!instance.classInstance) {
        const component = new type(props);
        component.props = props;
        component.state = component.state ?? null;
        component.setState = (next) => {
          const patch = typeof next === "function" ? next(component.state) : next;
          const merged = { ...component.state, ...patch };
          if (Object.keys(merged).every((k) => Object.is(merged[k], component.state?.[k]))) return;
          component.state = merged;
          dirty = true;
        };
        instance.classInstance = component;
      }
      const component = instance.classInstance;
      component.props = props;

      // The CATCH, and why it wraps the child render rather than `render()` alone: a
      // throwing surface throws while ITS OWN subtree is being reconciled, which in this
      // synchronous whole-tree renderer is inside `renderNode` of this boundary's output.
      // Catching only `component.render()` would catch nothing at all — the exact
      // false-green a boundary test must not produce.
      const canCatch =
        typeof type.getDerivedStateFromError === "function" || typeof component.componentDidCatch === "function";
      try {
        return renderNode(component.render(), instanceKey, seen);
      } catch (error) {
        if (!canCatch) throw error;
        if (typeof type.getDerivedStateFromError === "function") {
          component.state = { ...component.state, ...type.getDerivedStateFromError(error) };
        }
        if (typeof component.componentDidCatch === "function") {
          component.componentDidCatch(error, { componentStack: instanceKey });
        }
        // Re-render the boundary with its caught state — the fallback IS the result of
        // this pass, exactly as React re-renders the boundary rather than leaving a hole.
        return renderNode(component.render(), instanceKey, seen);
      }
    }

    if (typeof type === "function") {
      const name = type.name || "anon";
      const instanceKey = `${pathKey}/${name}#${key ?? ""}`;
      seen.add(instanceKey);
      let instance = instances.get(instanceKey);
      if (!instance) {
        instance = { hooks: [], key: instanceKey };
        instances.set(instanceKey, instance);
      }
      const previous = current;
      const previousIndex = hookIndex;
      current = instance;
      hookIndex = 0;
      let output;
      try {
        output = type(props);
      } finally {
        current = previous;
        hookIndex = previousIndex;
      }
      return renderNode(output, instanceKey, seen);
    }
    // A host element.
    const children = renderNode(props.children ?? null, `${pathKey}/${String(type)}#${key ?? ""}`, seen);
    return {
      type: String(type),
      props,
      children: children == null ? [] : Array.isArray(children) ? children : [children],
    };
  }

  function unmountAbsent(seen) {
    for (const [instanceKey, instance] of [...instances]) {
      if (seen.has(instanceKey)) continue;
      for (const hook of instance.hooks) {
        if (typeof hook.cleanup === "function") {
          hook.cleanup();
          hook.cleanup = null;
        }
      }
      instances.delete(instanceKey);
    }
  }

  let tree = null;

  function renderPass() {
    const seen = new Set();
    dirty = false;
    tree = renderNode(rootElement, "", seen);
    unmountAbsent(seen);
    const effects = pendingEffects;
    pendingEffects = [];
    for (const { hook, effect } of effects) {
      if (typeof hook.cleanup === "function") hook.cleanup();
      const cleanup = effect();
      hook.cleanup = typeof cleanup === "function" ? cleanup : null;
    }
  }

  return {
    runtime,
    mount(element) {
      rootElement = element;
      renderPass();
      return tree;
    },
    // The host drives settling: it knows when the app's REAL requests have
    // landed. `isDirty()` reports a pending state update; `render()` performs one
    // synchronous render pass (+ its effects), exactly as a browser would
    // between paints.
    isDirty: () => dirty,
    render: renderPass,
    tree: () => tree,
    unmount() {
      rootElement = null;
      unmountAbsent(new Set());
      tree = null;
    },
  };
}

// ── tree queries ────────────────────────────────────────────────────────────

export function walk(node, visit) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== "object") return;
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

export function findAll(node, predicate) {
  const found = [];
  walk(node, (candidate) => {
    if (predicate(candidate)) found.push(candidate);
  });
  return found;
}

export function textOf(node) {
  if (node == null || node === false || node === true) return "";
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node !== "object") return String(node);
  return (node.children ?? []).map(textOf).join("");
}

// The text a READER sees, rather than the raw concatenation. Adjacent element
// children are separated on screen (a flex `gap`, an inline box boundary) even
// when their text nodes abut, so they are joined with a space and the result is
// whitespace-collapsed. This is what lets a lane assert a rendered phrase
// verbatim — "◌ stale · 12m ago" — when the mark and the words are two spans
// because the mark must be `aria-hidden` and the words must not be.
export function visibleTextOf(node) {
  if (node == null || node === false || node === true) return "";
  if (Array.isArray(node)) return node.map(visibleTextOf).join(" ").replace(/\s+/g, " ").trim();
  if (typeof node !== "object") return String(node);
  return (node.children ?? []).map(visibleTextOf).join(" ").replace(/\s+/g, " ").trim();
}
