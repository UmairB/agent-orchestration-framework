// THE CONFIG EDITOR'S TWO PRE-EDITOR STATES — loading, and the error state it was missing
// (milestone 45, finding F-45-M-1). Siblings rather than blocks inside `App.tsx`, because
// `acd-ui-surface-file-budget` says so in terms: "a surface gains child components, not
// blocks".

// Nothing has failed and nothing is decided yet — the plainest possible holding state, moved
// out of `App.tsx` unchanged.
export function ConfigLoading() {
  return (
    <div className="grid min-h-[calc(100dvh_-_var(--aof-shell-chrome-height,0px))] place-items-center bg-background text-foreground">
      <div className="mono text-sm text-muted-foreground">Loading AOF...</div>
    </div>
  );
}

// THE ERROR STATE (finding F-45-M-1).
//
// `Shell.tsx`'s standing promise is that a surface "reached on an origin that cannot serve its
// API degrades through its OWN existing error state". The board honoured that sentence; the
// config editor had no such state to degrade into, so it blanked the entire application
// instead. This is the state it was missing.
//
// The form is deliberately the SHELL's failed state, near enough: the same accent chip, the
// same one-line verdict, the same retry affordance. An operator who reaches a dead surface
// should not have to learn a second visual language for it depending on which one they hit.
export function ConfigLoadFailed({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-[calc(100dvh_-_var(--aof-shell-chrome-height,0px))] place-items-center bg-background p-10 text-foreground">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent">
          <span
            className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground"
            aria-hidden="true"
          >
            !
          </span>
          Could not load the configuration
        </div>
        {/* THE STATE TELLS ONE STORY, in the operator's vocabulary (designer GAP-1, 2026-08-08).
            The upstream string is whatever subsystem happened to refuse — on the fleet origin it
            reads "Mesh API route not found", naming a subsystem the operator never asked for on
            this route. Unlabelled and sitting between the headline and the recovery sentence, it
            read as the CAUSE. Labelled, it is what it is: a diagnostic, for whoever needs it. */}
        <p className="text-sm text-muted-foreground">
          This origin does not serve the configuration API. Open the config editor on its own
          origin with <span className="mono">aof assets ui</span>.
        </p>
        <p className="text-xs text-muted-foreground">
          upstream: <span className="mono">{reason}</span>
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
        >
          ⟳ Retry
        </button>
      </div>
    </div>
  );
}
