// The board read-model derivations (DESIGN — "State & data plumbing").
//
// Everything here is computed CLIENT-SIDE from the flat /api/work/list array
// (ADR-002's 7-field contract). A milestone = type:milestone with parent null;
// its stories = items whose parent == the milestone's number; a uat gate =
// type:uat. Counts, progress and story-dots are derived — never fetched, never
// faked. Task counts are deliberately NOT surfaced (not in the contract).
import type { WorkItem, WorkStatus } from "./api";

export type Milestone = {
  item: WorkItem;
  // The milestone's plain ref/number (e.g. "03").
  num: string;
  stories: WorkItem[];
  // story-status tallies
  total: number;
  done: number;
  inReview: number;
  inProgress: number;
  blocked: number;
  notStarted: number;
  // The progress-bar fill percentage (DESIGN): round((done + inReview*0.66)/total*100).
  fillPct: number;
};

export type Derived = {
  items: WorkItem[];
  milestones: Milestone[];
  uat: WorkItem[];
  byRef: Map<string, WorkItem>;
  // Stream-wide summary counts (overview chips).
  doneMilestones: number;
  activeMilestones: number;
  blockedGates: number;
};

// A milestone's "number" key as referenced by a child's `parent` field. In the
// contract `parent` is the milestone's ref/number string (e.g. "03"). Stories
// carry `parent === milestone.ref` for milestones (the seed uses the 2-digit
// number); we also tolerate a bare numeric form ("3") by normalising.
function milestoneKey(item: WorkItem): string {
  return item.ref;
}

// Normalise a parent pointer to compare against a milestone ref. The seed writes
// parent as the milestone's number (e.g. "3" or "03"); milestone refs are the
// 2-digit form ("03"). Compare on the numeric value when both look numeric.
function sameMilestone(parent: string | null, milestoneRef: string): boolean {
  if (parent == null) return false;
  if (parent === milestoneRef) return true;
  const a = Number.parseInt(parent, 10);
  const b = Number.parseInt(milestoneRef, 10);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

export function deriveBoard(items: WorkItem[]): Derived {
  const byRef = new Map<string, WorkItem>();
  for (const item of items) byRef.set(item.ref, item);

  const milestoneItems = items.filter((i) => i.type === "milestone" && i.parent == null);
  const uat = items.filter((i) => i.type === "uat");

  const milestones: Milestone[] = milestoneItems.map((item) => {
    const stories = items.filter((s) => s.type === "story" && sameMilestone(s.parent, milestoneKey(item)));
    const tally = (status: WorkStatus) => stories.filter((s) => s.status === status).length;
    const total = stories.length;
    const done = tally("done");
    const inReview = tally("in-review");
    const inProgress = tally("in-progress");
    const blocked = tally("blocked");
    const notStarted = tally("not-started");
    const fillPct =
      total === 0
        ? item.status === "done"
          ? 100
          : 0
        : Math.round(((done + inReview * 0.66) / total) * 100);
    return {
      item,
      num: item.ref,
      stories,
      total,
      done,
      inReview,
      inProgress,
      blocked,
      notStarted,
      fillPct: Math.max(0, Math.min(100, fillPct)),
    };
  });

  const doneMilestones = milestones.filter((m) => m.item.status === "done").length;
  const activeMilestones = milestones.filter((m) => m.item.status === "in-progress").length;
  const blockedGates = uat.filter((u) => u.status === "blocked").length;

  return {
    items,
    milestones,
    uat,
    byRef,
    doneMilestones,
    activeMilestones,
    blockedGates,
  };
}

// All stories under a milestone (used by the board lanes).
export function storiesOf(derived: Derived, milestoneRef: string): WorkItem[] {
  const m = derived.milestones.find((x) => x.num === milestoneRef);
  return m ? m.stories : [];
}

// The uat gate(s) that accept a given milestone, if derivable. The contract
// gives uat items a `parent`; when it points at the milestone we treat it as the
// gate for that milestone. (May be empty — that's fine, we then omit.)
export function gatesFor(derived: Derived, milestoneRef: string): WorkItem[] {
  return derived.uat.filter((u) => sameMilestone(u.parent, milestoneRef));
}

// The milestone a uat gate accepts (its parent), if derivable.
export function milestoneOfGate(derived: Derived, gate: WorkItem): Milestone | null {
  if (gate.parent == null) return null;
  return derived.milestones.find((m) => sameMilestone(gate.parent, m.num)) ?? null;
}

export function findMilestone(derived: Derived, ref: string): Milestone | null {
  return derived.milestones.find((m) => m.num === ref) ?? null;
}

export const titleOf = (item: WorkItem): string => item.title ?? item.slug;
