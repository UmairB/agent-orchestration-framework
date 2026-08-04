// THE PROVENANCE LINE + ITS ONE RESYNC DOOR — the detail panel's provenance box
// LINE 2 (milestone 43 / story 04; DESIGN §Surface 1c), in its own module.
//
// It lives here rather than as a block inside `DetailPanel.tsx` because 43/ADR-015
// F2 ruled that a React surface file gains CHILD COMPONENTS, not blocks: the panel
// took +284 lines in this one story — more than in the whole month before it — and
// crossed 1,000, which is `global-work-store.mjs`'s own curve one layer over. This
// component is the natural unit that answers it: a clean four-prop boundary
// (`item`, `freshness`, `pollMs`, `onResyncWatch`), its own two behavioural suites,
// and its pure half ALREADY extracted (./resync.mjs), beside a sibling
// (./StaleBadge.tsx) that is exactly the right home shape. The budget ratchet for
// `ui/`'s surface files is test/arch/acd-ui-surface-file-budget.test.mjs.
//
// The move is behaviour-preserving by construction: the component below is
// unchanged, and the board harness addresses the rendered row STRUCTURALLY — by the
// label's class signature and the slot's `aria-live` role, never by component
// identity — so the existing suites prove the move without being touched.
import { useCallback, useEffect, useState } from "react";
import { workApi } from "./api";
import type { WorkItem } from "./api";
import { ProvenanceLabel } from "./StaleBadge";
import type { Freshness } from "./freshness.mjs";
import {
  resyncAckExpired,
  resyncAgeWord,
  resyncAtRest,
  resyncView,
  resyncWatchExpired,
  runResync,
} from "./resync.mjs";
import type { ResyncState } from "./resync.mjs";

// ── THE THREE REGIONS ───────────────────────────────────────────────────────
//
// The provenance box's LINE 2 answers three different questions:
//
//   the LABEL   — the DATA: `[stale · ]synced <age> · from <node>[ (this node)]`,
//                 plus any persistent fact about the world (`· owner unreachable`);
//   the BUTTON  — the CALL: `⟳ Resync` / `Resyncing…` / `Requested`;
//   the SLOT    — the outcome, in a permanently-present polite live region.
//
// WHY THE DOOR IS SINGULAR, AND WHY THAT IS STRUCTURAL RATHER THAN A PREFERENCE.
// The lane card and the overview milestone card are themselves `<button
// data-card>` elements, and an HTML `<button>` may never nest another
// interactive element (m38/ADR-012). So the badge on those cards is inert and
// the ONLY Resync in the whole tree is this one. It is not in the footer actions
// strip either: that strip holds work-stream verbs ON the item, whereas Resync
// repairs THE VIEW, and it must appear and disappear with the claim it repairs.
//
// RENDERED ONLY WHILE THE ROW IS STALE. A fresh row has nothing to repair, and
// the restraint is the visual expression of the milestone's own rule: this is
// the first sanctioned pull, it is operator-initiated, and an always-present
// pull button would contradict the architecture on screen.
//
// The component holds NO transition logic of its own: every label, tone,
// disabled/busy flag, message and timer duration comes from `resyncView`, and
// the click is `runResync`.
export function ProvenanceLine({
  item,
  freshness,
  pollMs,
  onResyncWatch,
}: {
  item: WorkItem;
  freshness: Freshness;
  pollMs: number;
  onResyncWatch: (watching: boolean) => void;
}) {
  const [episode, setEpisode] = useState<ResyncState>(resyncAtRest);
  const stale = freshness.state === "stale";
  const view = resyncView({
    phase: episode.phase,
    code: episode.code,
    detail: episode.detail,
    unreachable: episode.unreachable,
    watching: episode.watching,
    // WHO to ask is the row's OWN recorded reporter — never a presence lookup
    // and never an assignment's target node. "Ask whoever reported this copy" is
    // the only question a resync can honestly ask.
    node: freshness.reportedBy,
    ref: item.ref,
    // …and every failure message names the copy still on screen by its age, so a
    // failed request can never read as "your data is gone".
    ageWord: resyncAgeWord(freshness.age),
    pollMs,
  });

  // A fresher copy landing ends the episode outright — badge, control, message
  // and the persistent clause all go, because the DATA changed. That is the only
  // thing allowed to clear them, which is "no success toast" seen from the other
  // end: the disappearance IS the confirmation.
  useEffect(() => {
    if (!stale && episode.phase !== "idle") setEpisode(resyncAtRest());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, episode.phase]);

  // THE ACKNOWLEDGEMENT'S HOLD — exactly one poll interval, then decay to rest
  // with nothing left over. "A hold of exactly one poll interval is what
  // guarantees there is never a moment between the click and a confirmation in
  // which the surface says nothing." A view with `holdMs === null` schedules
  // nothing, which is what makes "no hold on a terminal outcome" structural.
  const holdMs = stale ? view.holdMs : null;
  useEffect(() => {
    if (holdMs == null) return;
    const timer = setTimeout(() => setEpisode(resyncAckExpired), holdMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdMs, episode.phase]);

  // THE WATCH WINDOW — the SECOND, longer leg, on its own key so the hold above
  // cannot cut it short. While it runs the Board polls the list (43/ADR-010
  // R4.3): without that, "no answer" would be structurally guaranteed rather
  // than measured, because a settled board schedules no list poll of its own —
  // and a settled row is exactly the case Resync exists for.
  const watchMs = stale ? view.watchMs : null;
  useEffect(() => {
    if (watchMs == null) return;
    onResyncWatch(true);
    const timer = setTimeout(() => setEpisode(resyncWatchExpired), watchMs);
    return () => {
      clearTimeout(timer);
      onResyncWatch(false);
    };
  }, [watchMs, onResyncWatch]);

  // The whole episode is the pure module's; this hands it the real api client
  // and its own setter, and returns the promise so a caller can await the round
  // trip (the click itself never blocks the render — `onState(begin)` runs
  // synchronously, before the POST).
  // …including its DEADLINE, which is derived from the board's own cadence
  // rather than fixed (43/ADR-014: a bound shorter than the drain cadence
  // reported "no answer" for roughly one in three HEALTHY resyncs).
  const requestMs = view.requestMs;
  const onResync = useCallback(
    () => runResync(
      { resync: (ref: string) => workApi.resync(ref), onState: setEpisode, timeoutMs: requestMs ?? undefined },
      { ref: item.ref },
    ),
    [item.ref, requestMs]
  );

  const message = stale ? view.message : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <ProvenanceLabel freshness={freshness} note={stale ? view.lineNote : null} />
      {stale ? (
        <button
          type="button"
          onClick={onResync}
          disabled={view.disabled}
          aria-busy={view.ariaBusy ? "true" : undefined}
          aria-label={view.ariaLabel}
          className={
            // The m38 assign-action shape verbatim — this codebase's established
            // quiet action at `text-[11px]` scale — with the acknowledgement
            // DROPPING the primary tint rather than adding anything to it: same
            // box, same padding, same height, same type, only the label and the
            // tint change. `min-h-6` (24px) is WCAG 2.2 SC 2.5.8's target size,
            // which `py-1` alone lands just under, bought without changing the
            // visual weight or the row's height rhythm.
            //
            // NO `transition`, deliberately, unlike the assign action it copies:
            // DESIGN's ramp for this milestone is "Motion: none", and a control
            // that materialises at the threshold must not bring an animation
            // token onto a row that had none.
            `inline-flex min-h-6 shrink-0 items-center justify-center rounded-md px-2.5 py-1 text-[11px] font-semibold disabled:cursor-not-allowed ${
              view.tone === "muted"
                ? "border border-border bg-muted text-muted-foreground"
                : "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            }`
          }
        >
          {/* The inner span reserves a CONSTANT width sized to the longest label
              the control ever reads (`Resyncing…`) in every state, so a label
              swap can never reflow the row (m38 DG-13 clause 1). There is no
              `phase` in that width by construction. */}
          <span className="block whitespace-nowrap text-center" style={{ width: view.labelWidth }}>
            {view.label}
          </span>
        </button>
      ) : null}
      {/* THE MESSAGE SLOT — present in the DOM AT ALL TIMES, including when it is
          empty and when the row is fresh. A live region created at the moment of
          the message is unreliably announced, and this is a reserved,
          constant-width slot in the row geometry anyway, so it costs no layout.
          It is also the element that YIELDS: it shrinks and truncates while the
          label and the button do not, and it carries the full server text in its
          native `title`.

          The BADGE, by contrast, is deliberately NOT in a live region: the
          threshold crossing is a passive state change, and announcing every item
          that ages past the window would be an unprompted interruption. */}
      <span
        aria-live="polite"
        title={message ? view.messageTitle ?? undefined : undefined}
        className={`mono min-w-0 shrink truncate text-[10.5px] ${
          view.messageTone === "destructive" ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {message}
      </span>
    </div>
  );
}
