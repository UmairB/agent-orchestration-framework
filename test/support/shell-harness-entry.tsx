// The mount entry for the app-shell harness (milestone 45 / story 03).
//
// `withMountedApp` mounts one exported component with NO props — every existing surface
// (`<Fleet/>`, `<Board/>`) is propless, and the shell is not: the entry hands it the route the
// table resolved, the address it resolved it from, and the surface element to mount. So this
// file is the shell's propless wrapper, reading its props from a global the lane sets before
// the bundle is imported. It is the ONLY thing between the lane and the REAL production
// `ui/src/app/Shell.tsx`; nothing about the shell is stubbed.
//
// The stub SURFACE is deliberate and is itself part of what a lane checks: it contributes to
// the shell's slot and notice rail through the REAL `SurfaceSlot` and the REAL shell bus, so a
// lane exercises the whole surface → shell channel rather than a mock of it. What it does NOT
// do is fetch anything or want a DOM canvas, which is the same reason the fleet's xterm view
// and the board's dock are stubbed in their own harnesses.
import { Shell } from "../../ui/src/app/Shell";
import { SurfaceNotice, SurfaceSlot } from "../../ui/src/app/SurfaceSlot";
import { dismissFullscreen, requestFullscreen, resetShellBus } from "../../ui/src/app/shell-bus.mjs";

// The bundle has its OWN copy of the shell bus (it is bundled, not imported from node), so a
// lane that wants to ask the shell to present something must reach THIS copy — the one the
// mounted shell is listening on. Publishing it here is the seam; it exists only in the test
// tree, and production reaches the bus the way a surface does: by importing it.
(globalThis as Record<string, unknown>).__AOF_SHELL_BUS__ = { requestFullscreen, dismissFullscreen, resetShellBus };

type HarnessProps = Record<string, unknown> & {
  surface?: "none" | "plain" | "contributing";
  slotLabels?: string[];
  noticeText?: string;
};

function readProps(): HarnessProps {
  return ((globalThis as Record<string, unknown>).__AOF_SHELL_PROPS__ as HarnessProps) ?? {};
}

function StubSurface({ slotLabels, noticeText }: { slotLabels: string[]; noticeText: string | null }) {
  return (
    <div data-stub-surface="">
      <SurfaceSlot deps={[slotLabels.join("|")]} className="flex items-center gap-4">
        {slotLabels.map((label) => (
          <button key={label} type="button" aria-label={label}>
            {label}
          </button>
        ))}
      </SurfaceSlot>
      {noticeText === null ? null : (
        <SurfaceNotice deps={[noticeText]}>
          <div role="alert" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <span aria-hidden="true">⚠</span>
            <span>{noticeText}</span>
          </div>
        </SurfaceNotice>
      )}
      <p>surface body</p>
    </div>
  );
}

export function ShellHarness() {
  const { surface = "none", slotLabels = [], noticeText, ...rest } = readProps();
  const mounted =
    surface === "none" ? null : surface === "plain" ? <p data-stub-surface="">surface body</p> : (
      <StubSurface slotLabels={slotLabels} noticeText={noticeText ?? null} />
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the lane's props are the shell's own, checked by tsc at every real call site.
  return <Shell {...(rest as any)} surface={mounted} />;
}
