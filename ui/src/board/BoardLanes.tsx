// VIEW 2 — the status-lane board for one milestone (DESIGN VIEW 2). A breadcrumb
// row with a milestone switcher, then a 5-column status-lane grid filling the
// remaining height. Bucketing differs by focus: a milestone places its stories
// (plus any uat gate that depends on it); "all" places milestones, plus any
// in-review/blocked story, plus uat gates. Selection drives the detail panel.
import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { StatusRing, StatusDot, statusMeta, LANE_ORDER } from "./status";
import type { StatusKind } from "./status";
import { StaleBadge } from "./StaleBadge";
import type { Derived } from "./model";
import { gatesFor, titleOf } from "./model";
import type { WorkItem } from "./api";
import type { Freshness } from "./freshness.mjs";

// A card placed in a lane carries the source item plus a small right-tag.
type LaneCard = { item: WorkItem; tag: string };

export function BoardLanes({
  derived,
  focus,
  selectedRef,
  runningRefs,
  freshnessOf,
  switchOpen,
  onToggleSwitch,
  onCloseSwitch,
  onSetFocus,
  onSelect,
  onDeselect,
  onBackToOverview,
}: {
  derived: Derived;
  focus: "all" | string;
  selectedRef: string | null;
  // Refs with a live `running` run — drives the in-flight pulse dot (DESIGN
  // surface 2b). Empty set ⇒ no dots.
  runningRefs: Set<string>;
  // The board's ONE freshness reading for a row (Board-computed off the 1s tick
  // and the wire's window). Null for a row the cache does not publish.
  freshnessOf: (item: WorkItem | null | undefined) => Freshness | null;
  switchOpen: boolean;
  onToggleSwitch: () => void;
  onCloseSwitch: () => void;
  onSetFocus: (focus: "all" | string) => void;
  onSelect: (ref: string) => void;
  // Clicking empty lane area (not a card) deselects → back to the milestone view.
  onDeselect: () => void;
  onBackToOverview: () => void;
}) {
  const focusedMilestone = focus === "all" ? null : derived.milestones.find((m) => m.num === focus) ?? null;

  // Bucket the in-scope items into the five lanes.
  const lanes = useMemo(() => bucket(derived, focus), [derived, focus]);

  const scopeCounts = useMemo(() => {
    const cards = LANE_ORDER.flatMap((s) => lanes[s]);
    const review = cards.filter((c) => c.item.status === "in-review").length;
    const blocked = cards.filter((c) => c.item.status === "blocked").length;
    return { total: cards.length, review, blocked };
  }, [lanes]);

  const countLabel =
    focus === "all"
      ? `${derived.milestones.length} milestone${derived.milestones.length === 1 ? "" : "s"} · full stream`
      : `${focusedMilestone?.stories.length ?? 0} stor${(focusedMilestone?.stories.length ?? 0) === 1 ? "y" : "ies"}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* breadcrumb + switcher */}
      <div className="relative flex h-[46px] shrink-0 items-center gap-2 border-b border-border bg-card px-4">
        <button
          type="button"
          onClick={onBackToOverview}
          className="text-sm text-muted-foreground transition hover:text-foreground"
        >
          ‹ Work items
        </button>
        <span className="text-muted-foreground">/</span>

        <MilestoneSwitcher
          derived={derived}
          focus={focus}
          open={switchOpen}
          onToggle={onToggleSwitch}
          onClose={onCloseSwitch}
          onSetFocus={onSetFocus}
        />

        <span className="ml-auto flex items-center gap-3 text-xs">
          <span className="mono text-muted-foreground">{countLabel}</span>
          {scopeCounts.review > 0 ? <span className="text-accent">◔ {scopeCounts.review} review</span> : null}
          {scopeCounts.blocked > 0 ? <span className="text-destructive">! {scopeCounts.blocked} blocked</span> : null}
        </span>
      </div>

      {/* lanes */}
      {focusedMilestone && focusedMilestone.stories.length === 0 && gatesFor(derived, focus).length === 0 ? (
        <EmptyMilestone />
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-px bg-border"
          style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
          onClick={(e) => {
            // A click that did not land on a story card = empty lane area →
            // deselect (back to the milestone view).
            if (!(e.target as HTMLElement).closest("[data-card]")) onDeselect();
          }}
        >
          {LANE_ORDER.map((status) => (
            <Lane
              key={status}
              status={status}
              cards={lanes[status]}
              selectedRef={selectedRef}
              runningRefs={runningRefs}
              freshnessOf={freshnessOf}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function bucket(derived: Derived, focus: "all" | string): Record<StatusKind, LaneCard[]> {
  const out: Record<StatusKind, LaneCard[]> = {
    "not-started": [],
    "in-progress": [],
    "in-review": [],
    blocked: [],
    done: [],
  };
  const place = (item: WorkItem, tag: string) => {
    const status = (item.status ?? "not-started") as StatusKind;
    if (out[status]) out[status].push({ item, tag });
  };

  if (focus === "all") {
    for (const m of derived.milestones) place(m.item, "milestone");
    for (const m of derived.milestones) {
      for (const s of m.stories) {
        if (s.status === "in-review" || s.status === "blocked") place(s, `in ${m.num}`);
      }
    }
    for (const u of derived.uat) place(u, "uat");
    // milestone 37/ADR-003: spike/chore are additive top-level drivers
    // (ADR-001, uat-shaped) — placed via the SAME existing driver mechanism as
    // uat above (no new lane/column); the tag doubles as the type badge whose
    // text is the item's type.
    for (const d of derived.otherDrivers) place(d, d.type);
  } else {
    const m = derived.milestones.find((x) => x.num === focus);
    if (m) for (const s of m.stories) place(s, `in ${m.num}`);
    for (const u of gatesFor(derived, focus)) place(u, "uat");
  }
  return out;
}

function Lane({
  status,
  cards,
  selectedRef,
  runningRefs,
  freshnessOf,
  onSelect,
}: {
  status: StatusKind;
  cards: LaneCard[];
  selectedRef: string | null;
  runningRefs: Set<string>;
  freshnessOf: (item: WorkItem | null | undefined) => Freshness | null;
  onSelect: (ref: string) => void;
}) {
  const meta = statusMeta(status);
  const tinted = status === "blocked";
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden ${tinted ? "bg-destructive/5" : "bg-background"}`}>
      <div
        className={`sticky top-0 z-10 flex items-center gap-2 border-b border-border px-3 py-2 ${
          tinted ? "bg-destructive/5" : "bg-background"
        }`}
      >
        <StatusRing status={status} size={15} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {meta.short}
        </span>
        <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
          {cards.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {cards.map(({ item, tag }) => (
          <LaneCardView
            key={item.ref}
            item={item}
            tag={tag}
            selected={item.ref === selectedRef}
            running={runningRefs.has(item.ref)}
            freshness={freshnessOf(item)}
            onSelect={() => onSelect(item.ref)}
          />
        ))}
      </div>
    </div>
  );
}

function LaneCardView({
  item,
  tag,
  selected,
  running,
  freshness,
  onSelect,
}: {
  item: WorkItem;
  tag: string;
  selected: boolean;
  // The item has a live `running` run → carry the in-flight pulse dot.
  running: boolean;
  // This row's cache-freshness reading; null when the cache does not publish it.
  freshness: Freshness | null;
  onSelect: () => void;
}) {
  const meta = statusMeta(item.status);
  return (
    <button
      type="button"
      data-card
      onClick={onSelect}
      className={`relative w-full rounded-lg border bg-card p-2.5 text-left transition ${
        selected
          ? "border-[1.5px] shadow-md"
          : "border-border hover:border-primary/40"
      }`}
      style={selected ? { borderColor: tone(meta.tone), background: `color-mix(in srgb, ${tone(meta.tone)} 6%, var(--color-card))` } : undefined}
    >
      {/* In-flight pulse dot (DESIGN surface 2b): an 8px teal pulse dot, distinct
          in position + primitive from the item-status glyph-ring, shown for a
          `running` run only — so active runs are visible from the board. */}
      {running ? (
        <span
          className="absolute right-1.5 top-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-primary"
          title="agent run in progress"
          aria-hidden="true"
        />
      ) : null}
      <div className="flex items-center gap-1.5">
        <StatusRing status={item.status} size={15} />
        <span className="mono text-xs text-muted-foreground">{item.ref}</span>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {tag}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-medium leading-snug">{titleOf(item)}</p>
      {/* The meta line: the barber bar or the short status text on the left, and
          the stale badge at the RIGHT end (`ml-auto`, `shrink-0`). The lane card
          has no status chip, so this is the local form of the global "immediately
          left of the status chip" rule (DESIGN §1a). SHORT form only — the
          reporting node lives in the badge's `title`, never in its visible text.
          No Resync here, and that is STRUCTURAL: the card is itself a `<button
          data-card>`, and an HTML button may never nest another interactive
          element (m38/ADR-012); a non-interactive `<span>` badge inside it is
          fine. */}
      <div className="mt-1.5 flex items-center gap-2">
        {item.status === "in-progress" ? (
          <span className="min-w-0 flex-1">
            <BarberBar />
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">{meta.short}</span>
        )}
        {freshness?.badge ? (
          <span className="ml-auto">
            <StaleBadge freshness={freshness} form="short" />
          </span>
        ) : null}
      </div>
    </button>
  );
}

function BarberBar() {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full w-full"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, var(--color-primary) 0, var(--color-primary) 5px, color-mix(in srgb, var(--color-primary) 50%, transparent) 5px, color-mix(in srgb, var(--color-primary) 50%, transparent) 10px)",
        }}
      />
    </div>
  );
}

function tone(t: "quiet" | "primary" | "accent" | "destructive"): string {
  if (t === "primary") return "var(--color-primary)";
  if (t === "accent") return "var(--color-accent)";
  if (t === "destructive") return "var(--color-destructive)";
  return "var(--color-border)";
}

function EmptyMilestone() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-muted p-10 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="inline-block h-12 w-12 rounded-full border-2 border-dashed border-muted-foreground/40" aria-hidden="true" />
        <p className="text-sm font-medium">No stories in this milestone yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          It's scaffolded but not started — nothing to review or run.
        </p>
      </div>
    </div>
  );
}

function MilestoneSwitcher({
  derived,
  focus,
  open,
  onToggle,
  onClose,
  onSetFocus,
}: {
  derived: Derived;
  focus: "all" | string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSetFocus: (focus: "all" | string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  const focused = focus === "all" ? null : derived.milestones.find((m) => m.num === focus) ?? null;
  const buttonLabel = focused ? `${focused.num} · ${titleOf(focused.item)}` : "All milestones";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (!open) {
            const rect = ref.current?.getBoundingClientRect();
            if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
          }
          onToggle();
        }}
        className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-sm font-medium transition hover:border-primary/50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {focused ? <StatusDot status={focused.item.status} size={8} /> : <span className="text-muted-foreground">✦</span>}
        <span className="mono">{buttonLabel}</span>
        <span className="text-muted-foreground">▾</span>
      </button>

      {open && pos ? (
        <div
          role="listbox"
          // DG-45-2 — the milestone switcher's listbox is a POPOVER (z-20), not the shell's
          // fullscreen occupant; the ladder in ui/src/app/shell-layout.mjs is its one home.
          className="fixed z-20 max-h-[60vh] w-[320px] overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          <SwitchRow active={focus === "all"} onClick={() => onSetFocus("all")}>
            <span className="text-muted-foreground">✦</span>
            <span className="font-medium">All milestones</span>
            <span className="ml-auto text-xs text-muted-foreground">full stream</span>
          </SwitchRow>
          <div className="my-1 border-t border-border" />
          {derived.milestones.map((m) => (
            <SwitchRow key={m.item.ref} active={focus === m.num} onClick={() => onSetFocus(m.num)}>
              <StatusDot status={m.item.status} size={8} />
              <span className="mono text-xs text-muted-foreground">{m.num}</span>
              <span className="min-w-0 flex-1 truncate">{titleOf(m.item)}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">{statusMeta(m.item.status).short}</span>
            </SwitchRow>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SwitchRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
        active ? "bg-primary/10 text-foreground" : "hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
