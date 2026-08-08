// The mount entry for the REAL-COMPOSITION harness (milestone 45 / story 03).
//
// `shell-harness-entry.tsx` mounts the real shell around a STUB surface, and the fleet's own
// harness mounts the real `<Fleet/>` with no shell. Both are right for what they check, and
// between them sits the one thing neither can see: the REAL fleet inside the REAL shell, in
// ONE bundle — which is the only configuration where the surface → shell channel is the same
// module instance at both ends.
//
// WHY THAT MATTERS ENOUGH FOR A THIRD ENTRY (architect's structural review, F6). The channel's
// host flag is MODULE state (`ui/src/app/shell-bus.mjs`'s `shellPresent`, set by importing
// Shell.tsx). Two harnesses that each bundle one half therefore each get their own copy of the
// bus, and every clause about the JOIN — the fleet's scope control leaving the fleet's own body
// and arriving in the shell's slot, in the loading state as well as the populated one — is
// true in neither bundle. A defect that unhooked the two (a second bus copy, a contribution
// published before the shell attaches, a surface whose slot renders only once its data lands)
// would leave both existing suites green and the operator with no scope control.
//
// The stub is the same ONE leaf the fleet's own harness stubs, for the same reason: the
// terminal view wants xterm and a real DOM canvas, it has its own suites, and rendering
// nothing is exactly what production does for an assignment with no live session.
import { Shell } from "../../ui/src/app/Shell";
import { Fleet } from "../../ui/src/fleet/Fleet";

type CompositionProps = Record<string, unknown>;

function readProps(): CompositionProps {
  return ((globalThis as Record<string, unknown>).__AOF_SHELL_PROPS__ as CompositionProps) ?? {};
}

export function ShellFleetHarness() {
  const props = readProps();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the lane's props are the shell's own, checked by tsc at every real call site.
  return <Shell {...(props as any)} surface={<Fleet />} />;
}
