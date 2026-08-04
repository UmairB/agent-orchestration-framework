// VIEW 1 — the "Work items" overview (DESIGN VIEW 1). A 3-column grid of
// milestone cards plus an "Acceptance gates" section for the uat items. Cards
// derive every count/progress/dot from the flat list; clicking a card opens its
// board. Task counts are deliberately omitted (not in the contract).
import type * as React from "react";
import { StatusRing, StatusChip, StatusDot } from "./status";
import { StaleBadge } from "./StaleBadge";
import type { Derived, Milestone } from "./model";
import { milestoneOfGate, titleOf } from "./model";
import type { WorkItem } from "./api";
import type { Freshness } from "./freshness.mjs";

export function Overview({
  derived,
  gateWaiting,
  freshnessOf,
  onOpenMilestone,
  onOpenGate,
}: {
  derived: Derived;
  // Optional per-gate "waiting on" labels fetched from /api/work/next (may be empty).
  gateWaiting: Record<string, string[]>;
  // The board's ONE freshness reading for a row (Board-computed off the 1s tick
  // and the wire's window). Null for a row the cache does not publish — a
  // `uat` gate is a LOCAL acceptance item and carries none, which is why the
  // gate bar takes no badge at all (absent, not `fresh`).
  freshnessOf: (item: WorkItem | null | undefined) => Freshness | null;
  onOpenMilestone: (ref: string) => void;
  onOpenGate: (gate: WorkItem) => void;
}) {
  const { milestones, uat } = derived;

  return (
    <div className="mx-auto w-full max-w-[1180px] p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Work items</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {milestones.length} milestone{milestones.length === 1 ? "" : "s"} · derived from project state. Open one to
            work its board.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <SummaryChip className="bg-primary/12 text-primary">✓ {derived.doneMilestones} done</SummaryChip>
          <SummaryChip className="bg-primary/12 text-primary">◐ {derived.activeMilestones} active</SummaryChip>
          {derived.blockedGates > 0 ? (
            <SummaryChip className="bg-destructive/12 text-destructive">
              ! {derived.blockedGates} blocked gate{derived.blockedGates === 1 ? "" : "s"}
            </SummaryChip>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        {milestones.map((m) => (
          <MilestoneCard
            key={m.item.ref}
            milestone={m}
            freshness={freshnessOf(m.item)}
            onOpen={() => onOpenMilestone(m.num)}
          />
        ))}
      </div>

      {uat.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Acceptance gates</h2>
          <div className="space-y-2">
            {uat.map((gate) => (
              <GateBar
                key={gate.ref}
                gate={gate}
                waitingOn={gateWaiting[gate.ref] ?? []}
                accepts={milestoneOfGate(derived, gate)}
                onOpen={() => onOpenGate(gate)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SummaryChip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-semibold ${className}`}>{children}</span>
  );
}

function MilestoneCard({
  milestone,
  freshness,
  onOpen,
}: {
  milestone: Milestone;
  freshness: Freshness | null;
  onOpen: () => void;
}) {
  const m = milestone;
  const isDone = m.item.status === "done";
  const progressLabel = m.total === 0 ? "not started" : "stories done";

  // Footer attention span (DESIGN): in-review > accepted > neutral.
  let attention: React.ReactNode = <span className="text-muted-foreground">·</span>;
  if (m.inReview > 0) {
    attention = <span className="text-accent">◔ {m.inReview} in review</span>;
  } else if (isDone) {
    attention = <span className="text-primary">✓ accepted</span>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-[10px] border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
    >
      {/* 1 — ring · ref · MILESTONE · [stale badge] status chip.
          The `ml-auto` moved from the chip's own span onto a CLUSTER holding the
          badge then the chip, so the chip keeps its exact right-edge anchor and
          NOTHING MOVES when a row crosses the threshold (DESIGN documented-default
          3 — the m03 header baselines survive). The badge is a non-interactive
          <span>: this card is itself a <button>, and an HTML button may never nest
          another interactive element (m38/ADR-012), so there is no Resync here. */}
      <div className="flex items-center gap-2">
        <StatusRing status={m.item.status} size={18} />
        <span className="mono text-sm text-muted-foreground">{m.item.ref}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">milestone</span>
        <span className="ml-auto flex items-center gap-1.5">
          <StaleBadge freshness={freshness} form="full" />
          <StatusChip status={m.item.status} />
        </span>
      </div>

      {/* 2 — title */}
      <h3 className="mt-2 text-[16px] font-bold leading-snug">{titleOf(m.item)}</h3>

      {/* 3 — progress */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{progressLabel}</span>
          <span className="mono">
            {m.done} / {m.total}
          </span>
        </div>
        <ProgressTrack milestone={m} />
      </div>

      {/* 4 — story dots */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {m.stories.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <>
            {m.stories.map((s) => (
              <StatusDot key={s.ref} status={s.status} size={8} title={`${s.ref} · ${s.status ?? "unknown"}`} />
            ))}
            <span className="ml-1 text-[11px] text-muted-foreground">
              {m.stories.length} stor{m.stories.length === 1 ? "y" : "ies"}
            </span>
          </>
        )}
      </div>

      {/* 5 — footer */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">
          {m.total} stor{m.total === 1 ? "y" : "ies"}
        </span>
        <span className="flex items-center gap-3">
          {attention}
          <span className="font-semibold text-primary group-hover:underline">Open board →</span>
        </span>
      </div>
    </button>
  );
}

// The bar measures ACCEPTANCE: SOLID teal = stories actually done/accepted
// (done / total — matching the label beside it), so an empty teal fill always
// means "0 accepted". The un-done remainder of an *in-progress* milestone gets a
// MUTED moving shimmer (clearly not teal) to read as "work in flight, not yet
// accepted" — so a 0-done / 3-in-review milestone shows NO teal + a grey shimmer,
// never a teal bar that looks finished. A done milestone is fully teal; a
// not-started one is a flat empty track.
function ProgressTrack({ milestone }: { milestone: Milestone }) {
  const m = milestone;
  if (m.total === 0) {
    return <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted" />;
  }
  const donePct = (m.done / m.total) * 100;
  const remainderPct = 100 - donePct;
  const active = m.item.status === "in-progress" || m.inProgress + m.inReview + m.blocked > 0;
  return (
    <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {donePct > 0 ? (
        <div className="h-full" style={{ width: `${donePct}%`, background: "var(--color-primary)" }} />
      ) : null}
      {remainderPct > 0 && active ? (
        <div className="aof-pending h-full" style={{ width: `${remainderPct}%` }} />
      ) : null}
    </div>
  );
}

function GateBar({
  gate,
  waitingOn,
  accepts,
  onOpen,
}: {
  gate: WorkItem;
  waitingOn: string[];
  accepts: Milestone | null;
  onOpen: () => void;
}) {
  const blocked = gate.status === "blocked";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:border-primary/50 ${
        blocked ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"
      }`}
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-destructive font-bold text-destructive-foreground"
        aria-hidden="true"
      >
        !
      </span>
      <span className="mono text-sm text-muted-foreground">{gate.ref}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        uat gate{blocked ? " · blocked" : ""}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {titleOf(gate)}
        {accepts ? <span className="ml-2 text-xs text-muted-foreground">accepts {accepts.num}</span> : null}
        {waitingOn.length > 0 ? (
          <span className="ml-2 text-xs text-destructive">waiting on {waitingOn.join(", ")}</span>
        ) : null}
      </span>
      <span className="ml-auto">
        <StatusChip status={gate.status} />
      </span>
    </button>
  );
}
