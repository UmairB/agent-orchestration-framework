// The SURFACE side of the shell's two contribution regions (milestone 45 / story 03;
// ADR-005 contract point 5, DESIGN §The scope-control ruling and §Surface 1's R1/R3).
//
// A routed surface does not know where its controls end up. It says "these are mine" and the
// shell decides which row holds them — the top bar at 1280, the surface bar at 768 and below.
// DESIGN's rule is the whole reason this exists: "surfaces contribute their own controls into
// a named slot; the shell does not author them." A shell that authored the fleet's scope
// control would have to know what a scope is, and then 46, 47 and 49 all queue behind it.
//
// WHEN NO SHELL IS PRESENT THE CONTRIBUTION RENDERS IN PLACE, and that is not a fallback —
// it is what keeps the surfaces honest when mounted alone (test/support/fleet-app-harness.mjs
// and board-app-harness.mjs mount the surface COMPONENT directly, which task 00 requires to
// keep working with no edit), and it is what a surface's own bar did before the shell existed.
//
// THE `deps` ARGUMENT IS NOT OPTIONAL POLISH. The contribution is published from an effect,
// so it must re-publish when — and ONLY when — the contributed content actually changes. An
// effect with no dependency list would re-publish on every render, the shell would re-render,
// the surface would re-render inside it, and the two would spin forever. Pass every value the
// contributed nodes CAPTURE (the fleet's `scope`, its `fetchedAt`, …); anything omitted goes
// stale in the bar while the surface's own body updates, which is the one failure a reviewer
// should look for here.
import { useEffect, useState } from "react";
import type * as React from "react";
import { SLOT_NOTICE, SLOT_SURFACE, contribute, hasShellHost, type ShellSlot } from "./shell-bus.mjs";

function Contribution({
  slot,
  children,
  deps,
  className,
}: {
  slot: ShellSlot;
  children: React.ReactNode;
  deps: readonly unknown[];
  className?: string;
}) {
  // Asked ONCE, at first render, and never re-asked: whether an app shell exists is a
  // property of the bundle, not of a moment, and re-reading it mid-life would let a
  // contribution move rows under the operator — the one thing binding rail 2 forbids.
  const [hosted] = useState(hasShellHost);

  useEffect(() => {
    if (!hosted) return undefined;
    // `contribute` returns the release, so an unmounting surface takes its controls with it
    // and never leaves a stale scope switch in a bar belonging to a surface that is gone.
    return contribute(slot, children);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's deps ARE the list; see the header.
  }, [hosted, slot, ...deps]);

  if (hosted) return null;
  return <div className={className}>{children}</div>;
}

// The right-anchored controls a surface puts in the shell's bar: on `/fleet` the scope
// control, the freshness legend and the refresh button; on `/board` the status legend and
// sync; on `/` and `/config` nothing at all.
export function SurfaceSlot({ children, deps, className }: { children: React.ReactNode; deps: readonly unknown[]; className?: string }) {
  return (
    <Contribution slot={SLOT_SURFACE} deps={deps} className={className}>
      {children}
    </Contribution>
  );
}

// The full-bleed notice rail ABOVE the chrome (R1). Its one occupant today is the board's
// `serverGone` strip, which must sit above the bars and PUSH them down — the shell is the
// only thing that can guarantee that, and the strip renders unchanged. At most one notice at
// a time; the rail is zero-height when empty, never a reserved blank band.
export function SurfaceNotice({ children, deps, className }: { children: React.ReactNode; deps: readonly unknown[]; className?: string }) {
  return (
    <Contribution slot={SLOT_NOTICE} deps={deps} className={className}>
      {children}
    </Contribution>
  );
}
