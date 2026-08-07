// SURFACE 2 — the `/` landing placeholder (milestone 45 / story 03; DESIGN §Surface 2 and its
// binding checklist; ADR-002's "`/` renders the shell landing, NOT the config editor and NOT a
// redirect to `/fleet`").
//
// `/` is the terminals home's future address (milestone 49). Today it renders a placeholder,
// and SPEC is explicit that "shipping a route with nothing behind it yet is correct here".
// Three things it must not be, each for its own reason:
//   - a REDIRECT to `/fleet` — that makes `/` mean nothing, which is exactly what this
//     milestone exists to stop, and it rewrites every bookmark of `/` in the interim;
//   - an ERROR — nothing failed;
//   - a LOADING state — nothing is coming. The landing fetches nothing, so a skeleton here
//     would promise data that does not exist. DESIGN states that absence rather than leaving
//     it blank, and if a future revision gives `/` a data source that clause is amended in the
//     same change.
//
// Milestone 49 replaces what this route RENDERS; it does not rename the route (`landing` keeps
// its id) and it does not touch the shell.
import { SHELL_CARD_CLASS, SHELL_CARD_WRAPPER_CLASS } from "./shell-layout.mjs";
import type { NavItem } from "./shell-nav.mjs";

export function Landing({ destinations }: { destinations: readonly NavItem[] }) {
  return (
    // Horizontally and vertically centred within the content region, in the SAME wrapper the
    // shell's not-found state uses — one rule, both places, spelled once in shell-layout.mjs.
    // `min-h-full` was what centred neither: R4 is a flex child, so it resolves against a
    // parent with no definite height in `content:page` and the wrapper collapses to its card.
    <div className={SHELL_CARD_WRAPPER_CLASS}>
      <div className={SHELL_CARD_CLASS}>
        {/* The `✦` mark at reduced opacity: decorative only, and it carries no accessible name. */}
        <span className="mb-3 block text-2xl text-primary/40" aria-hidden="true">
          ✦
        </span>
        {/* The ONE `h1` on the page. It is NOT a focus target: navigation here is a real link
            and therefore a full page load, so the browser's own load focus applies and there is
            no route change for the shell to move focus on. (Milestone 49 may make `/` a live
            surface; a client-side transition would be the change that earns a focus move.) */}
        <h1 className="text-sm font-semibold text-foreground">Live terminals</h1>
        {/* Copy names the THING, not the milestone number — internal scheduling is not product
            copy. One sentence, no second paragraph. */}
        <p className="mt-1 text-sm text-muted-foreground">Live terminals will appear here.</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
          {destinations.map((item) =>
            item.href === null ? (
              // An unreachable destination takes the SAME unavailable treatment as the nav —
              // one rule, both places, and the rule is the MODEL's rather than a second copy
              // of it typed here: the marking (dashed for UNAVAILABLE, the plain transparent
              // rule while a probe is still out), `aria-disabled` ONLY where it is true, and
              // the `title` that says either what to run or that the answer is coming. Never a
              // dead `href`.
              <span
                key={item.id}
                aria-disabled={item.ariaDisabled ?? undefined}
                title={item.title ?? undefined}
                tabIndex={0}
                className={`${item.marking.className} text-xs font-semibold`}
              >
                {item.label}
              </span>
            ) : (
              <a key={item.id} href={item.href} className="text-xs font-semibold text-primary hover:underline">
                {item.label}
              </a>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
