// The shared status ramp for the two-level board (DESIGN — the GLYPH RING).
//
// One helper maps an ACD status onto: a label, a short label, a glyph, a small
// round "ring" React node whose SHAPE carries meaning (dashed = not-started,
// teal conic = in-progress, ◔ crimson = in-review, ! red disc = blocked, ✓ teal
// disc = done), a chip class set, a tone, and a dot colour. Everything maps to
// the THEME TOKENS in ui/src/index.css — the design's crimson is the `accent`
// token; teal is `primary`; red is `destructive`; greys are `muted`. We never
// hardcode a hex where a token exists.
import type { WorkStatus } from "./api";

export type StatusKind = WorkStatus;

export type StatusMeta = {
  // The full status string (e.g. "in-progress").
  status: StatusKind;
  // The on-screen label with its leading glyph (e.g. "◐ in-progress").
  label: string;
  // A terse label for dense lane cards / meta lines (e.g. "in progress").
  short: string;
  // The bare unicode glyph for the ring centre / inline use.
  glyph: string;
  // The pill/chip class set (token-coloured fill + text).
  chipClasses: string;
  // A coarse tone bucket used for emphasis decisions.
  tone: "quiet" | "primary" | "accent" | "destructive";
  // The dot/fill colour token name, as a Tailwind background class.
  dotClass: string;
};

const META: Record<StatusKind, StatusMeta> = {
  "not-started": {
    status: "not-started",
    label: "○ not-started",
    short: "not started",
    glyph: "○",
    chipClasses: "border border-border bg-transparent text-muted-foreground",
    tone: "quiet",
    dotClass: "bg-muted-foreground/30",
  },
  "in-progress": {
    status: "in-progress",
    label: "◐ in-progress",
    short: "in progress",
    glyph: "◐",
    chipClasses: "border-transparent bg-primary/12 text-primary",
    tone: "primary",
    dotClass: "bg-primary",
  },
  "in-review": {
    status: "in-review",
    label: "◔ in-review",
    short: "in review",
    glyph: "◔",
    chipClasses: "border-transparent bg-accent/12 text-accent",
    tone: "accent",
    dotClass: "bg-accent",
  },
  blocked: {
    status: "blocked",
    label: "! blocked",
    short: "blocked",
    glyph: "!",
    chipClasses: "border-transparent bg-destructive/12 text-destructive",
    tone: "destructive",
    dotClass: "bg-destructive",
  },
  done: {
    status: "done",
    label: "✓ done",
    short: "done",
    glyph: "✓",
    chipClasses: "border-transparent bg-primary/15 text-primary",
    tone: "primary",
    dotClass: "bg-primary",
  },
};

const UNKNOWN: StatusMeta = {
  status: "not-started",
  label: "○ unknown",
  short: "unknown",
  glyph: "○",
  chipClasses: "border border-border bg-transparent text-muted-foreground",
  tone: "quiet",
  dotClass: "bg-muted-foreground/30",
};

// The status's full metadata. A null/unknown status falls back to the quiet form.
export function statusMeta(status: WorkStatus | null | undefined): StatusMeta {
  return (status && META[status]) ?? UNKNOWN;
}

// A round status ring. Shape — not just colour — encodes the status:
//   not-started → dashed grey hollow ring
//   in-progress → teal conic-fill ring
//   in-review   → crimson ring carrying ◔
//   blocked     → solid red disc with !
//   done        → solid teal disc with ✓
// `size` is the diameter in px (18 for cards/detail, 15–16 for lane cards).
export function StatusRing({
  status,
  size = 18,
  title,
}: {
  status: WorkStatus | null | undefined;
  size?: number;
  title?: string;
}) {
  const meta = statusMeta(status);
  const dim = { width: size, height: size };
  const glyphSize = Math.round(size * 0.62);
  const label = title ?? meta.short;

  if (meta.status === "not-started") {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="inline-block shrink-0 rounded-full border-2 border-dashed border-muted-foreground/45"
        style={dim}
      />
    );
  }

  if (meta.status === "in-progress") {
    // A teal conic-fill ring: a conic-gradient quarter-fill over a faint track,
    // with a white hole punched out so it reads as a ring, not a pie.
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="relative inline-block shrink-0 rounded-full"
        style={{
          ...dim,
          background:
            "conic-gradient(var(--color-primary) 0deg 250deg, color-mix(in srgb, var(--color-primary) 18%, transparent) 250deg 360deg)",
        }}
      >
        <span
          className="absolute rounded-full bg-card"
          style={{ inset: Math.max(2, Math.round(size * 0.2)) }}
        />
      </span>
    );
  }

  if (meta.status === "in-review") {
    // A crimson (accent) ring carrying the ◔ glyph.
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="grid shrink-0 place-items-center rounded-full border-2 border-accent text-accent"
        style={dim}
      >
        <span style={{ fontSize: glyphSize, lineHeight: 1 }} aria-hidden="true">
          ◔
        </span>
      </span>
    );
  }

  if (meta.status === "blocked") {
    // A solid red (destructive) disc with a bang.
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="grid shrink-0 place-items-center rounded-full bg-destructive font-bold text-destructive-foreground"
        style={dim}
      >
        <span style={{ fontSize: glyphSize, lineHeight: 1 }} aria-hidden="true">
          !
        </span>
      </span>
    );
  }

  // done — a solid teal disc with a check.
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
      style={dim}
    >
      <span style={{ fontSize: glyphSize, lineHeight: 1 }} aria-hidden="true">
        ✓
      </span>
    </span>
  );
}

// A token-coloured status chip (label + glyph). Colour alone is insufficient, so
// the glyph travels with it.
export function StatusChip({ status }: { status: WorkStatus | null | undefined }) {
  const meta = statusMeta(status);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.chipClasses}`}
    >
      {meta.label}
    </span>
  );
}

// A bare 8px status dot (used for story dots on the milestone cards). The
// not-started dot is a hollow grey ring; the rest are solid token fills.
export function StatusDot({
  status,
  size = 8,
  title,
}: {
  status: WorkStatus | null | undefined;
  size?: number;
  title?: string;
}) {
  const meta = statusMeta(status);
  const label = title ?? meta.short;
  if (meta.status === "not-started") {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="inline-block shrink-0 rounded-full border border-muted-foreground/45"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block shrink-0 rounded-full ${meta.dotClass}`}
      style={{ width: size, height: size }}
    />
  );
}

// The ordered status lanes (DESIGN VIEW 2): not-started · in-progress ·
// in-review · blocked · done.
export const LANE_ORDER: StatusKind[] = ["not-started", "in-progress", "in-review", "blocked", "done"];
