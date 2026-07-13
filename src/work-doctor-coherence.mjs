// work:doctor — milestone 15 / story 01 check-groups: STATUS-COHERENCE and
// LIFECYCLE-COMPLETENESS. Each is a PURE `(snapshot, ctx) => Finding[]` function
// APPENDED to the engine's CHECK_GROUPS registry (ADR-003) — it edits no existing
// group and no spine control flow. Both groups read ONLY per-item frontmatter
// `status`/`parent`/`depends` and the snapshot's already-probed doc/tasks presence
// (story 00 builds the snapshot; this module never re-reads the FS or the clock).
//
// Codes + severities (ADR-001, fixed in the task .feature Examples):
//   status-coherence:
//     lying-parent                 error  done parent over a non-done child
//     stale-parent                 warn   not-started parent over a started child
//     story-done-under-not-started error  done story under a not-started milestone
//     depends-blocked-in-progress  error  in-progress driver whose depends is unmet
//   lifecycle-completeness (all warn — missing-deliverable reminders, not status lies):
//     missing-verification, missing-retrospective, milestone-no-stories,
//     started-story-no-tasks, missing-architecture
import path from "node:path";
import { isDriver } from "./work-doctor.mjs";

// `depends` arrives from parseFrontmatter as a scalar (single) or array (inline
// list) or absent — normalise to a number[] of referenced driver numbers, mirroring
// work.mjs's `asList`.
function dependsNumbers(meta) {
  const value = meta?.depends;
  const list = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return list.map((entry) => Number.parseInt(entry, 10)).filter((num) => Number.isFinite(num));
}

const statusOf = (item) => item?.meta?.status ?? null;

// Attribute each story to its OWN milestone by FOLDER containment (a story's dir is
// `<milestone.dir>/stories/<story>`), not merely by the `parent` NUMBER — so a
// duplicate driver number (two milestones at the same number) does NOT cross-
// attribute one milestone's stories to the other. Returns Map<milestone.dir, story[]>.
function childrenByMilestoneDir(snapshot) {
  const byDir = new Map();
  const milestones = snapshot.items.filter((item) => item.type === "milestone");
  for (const milestone of milestones) byDir.set(milestone.dir, []);
  for (const item of snapshot.items) {
    if (item.parent == null || item.type !== "story") continue;
    const owner = milestones.find((m) => item.dir.startsWith(m.dir + path.sep + "stories" + path.sep));
    if (owner) byDir.get(owner.dir).push(item);
  }
  return byDir;
}

// Statuses that mean "work has been started" (anything past not-started). A started
// child under a not-started parent is the `stale-parent` shape.
const isStarted = (status) => status != null && status !== "not-started";

// milestone 37 / ADR-001 — spike/chore admitted here too (mirrors work.mjs's
// recordDoc), so a cross-item finding anchored on a spike/chore resolves to its
// own record doc (SPIKE.md/CHORE.md), not its bare folder.
const recordDocFor = (item) =>
  item.type === "milestone"
    ? "SPEC.md"
    : item.type === "story"
      ? "STORY.md"
      : item.type === "uat"
        ? "SESSION.md"
        : item.type === "spike"
          ? "SPIKE.md"
          : item.type === "chore"
            ? "CHORE.md"
            : null;

// Anchor a finding on the item's record doc when it has one, else its folder — the
// natural anchor for a cross-item status fact (e.g. the lying parent's SPEC.md).
function anchorPath(item) {
  const doc = recordDocFor(item);
  return doc ? path.join(item.dir, doc) : item.dir;
}

// -------------------------------------------------- status-coherence group ----
//
// Cross-item status contradictions a per-file validate cannot see. Reads only
// frontmatter `status` (and a driver's `depends`); never mtimes or folder names.
export function statusCoherenceGroup(snapshot) {
  const findings = [];

  // Index drivers by number for the depends-resolution check.
  const driverStatusByNumber = new Map();
  for (const item of snapshot.items) {
    if (item.parent == null && isDriver(item)) {
      driverStatusByNumber.set(Number.parseInt(item.number, 10), statusOf(item));
    }
  }

  // Each milestone's OWN child stories, by folder containment (duplicate-number safe).
  const childrenByDir = childrenByMilestoneDir(snapshot);
  // The milestone that physically OWNS a given story folder (for the inverse check).
  const milestones = snapshot.items.filter((item) => item.type === "milestone");
  const ownerOf = (story) => milestones.find((m) => story.dir.startsWith(m.dir + path.sep + "stories" + path.sep));

  for (const item of snapshot.items) {
    const status = statusOf(item);

    // Parent-vs-children contradictions (a milestone with child stories).
    if (item.type === "milestone") {
      const children = childrenByDir.get(item.dir) ?? [];

      // lying-parent (error): a done milestone with a child story that is not done —
      // a false claim of completion. Anchors on the lying parent.
      if (status === "done") {
        const liars = children.filter((child) => statusOf(child) !== "done");
        if (liars.length > 0) {
          const names = liars.map((child) => child.ref).sort();
          findings.push({
            code: "lying-parent",
            severity: "error",
            path: anchorPath(item),
            message: `milestone ${item.ref} is done but child ${liars.length > 1 ? "stories" : "story"} ${names.join(", ")} ${liars.length > 1 ? "are" : "is"} not done (lying parent)`,
          });
        }
      }

      // stale-parent (warn): a not-started milestone with a started child — the
      // parent forgot to advance. Advisory (nothing claims a false completion).
      if (status === "not-started") {
        const ahead = children.filter((child) => isStarted(statusOf(child)));
        if (ahead.length > 0) {
          const names = ahead.map((child) => child.ref).sort();
          findings.push({
            code: "stale-parent",
            severity: "warn",
            path: anchorPath(item),
            message: `milestone ${item.ref} is not-started but child ${ahead.length > 1 ? "stories" : "story"} ${names.join(", ")} ${ahead.length > 1 ? "are" : "is"} already started (stale parent)`,
          });
        }
      }
    }

    // story-done-under-not-started (error): a done story whose parent milestone is
    // not-started — a completed child under a parent claiming work has not begun.
    // Anchors on the story. The parent is resolved by FOLDER ownership.
    if (item.type === "story" && status === "done" && item.parent != null) {
      const parentStatus = statusOf(ownerOf(item));
      if (parentStatus === "not-started") {
        findings.push({
          code: "story-done-under-not-started",
          severity: "error",
          path: anchorPath(item),
          message: `story ${item.ref} is done but its milestone ${item.parent} is not-started (a completed child under a not-started parent)`,
        });
      }
    }

    // depends-blocked-in-progress (error): an in-progress driver whose depends names
    // a driver that is not yet done — working ahead of an unmet gate. Anchors on the
    // in-progress driver.
    if (item.parent == null && isDriver(item) && status === "in-progress") {
      const unmet = dependsNumbers(item.meta).filter((num) => driverStatusByNumber.get(num) !== "done");
      if (unmet.length > 0) {
        findings.push({
          code: "depends-blocked-in-progress",
          severity: "error",
          path: anchorPath(item),
          message: `driver ${item.ref} is in-progress but depends on driver ${unmet.sort((a, b) => a - b).join(", ")} which ${unmet.length > 1 ? "are" : "is"} not yet done (working ahead of an unmet dependency)`,
        });
      }
    }
  }

  return findings;
}

// --------------------------------------------- lifecycle-completeness group ----
//
// The close-convention docs a given status IMPLIES, surfaced when absent. Reads
// only frontmatter `status` + the snapshot's doc/stories/tasks presence. All warn
// (missing-deliverable reminders — never a status lie).
export function lifecycleCompletenessGroup(snapshot) {
  const findings = [];

  // Each milestone's OWN child stories, by folder containment (duplicate-number safe).
  const childrenByDir = childrenByMilestoneDir(snapshot);

  for (const item of snapshot.items) {
    const status = statusOf(item);

    if (item.type === "milestone") {
      const children = childrenByDir.get(item.dir) ?? [];

      // missing-verification (warn): in-review OR done with no NON-EMPTY VERIFICATION.md.
      if ((status === "in-review" || status === "done") && !item.docs?.["VERIFICATION.md"]?.nonEmpty) {
        findings.push({
          code: "missing-verification",
          severity: "warn",
          path: item.dir,
          message: `milestone ${item.ref} is ${status} but has no non-empty VERIFICATION.md`,
        });
      }

      // missing-retrospective (warn): done with no RETROSPECTIVE.md.
      if (status === "done" && !item.docs?.["RETROSPECTIVE.md"]?.present) {
        findings.push({
          code: "missing-retrospective",
          severity: "warn",
          path: item.dir,
          message: `milestone ${item.ref} is done but has no RETROSPECTIVE.md`,
        });
      }

      // milestone-no-stories (warn): a STARTED milestone (in-progress/done — past
      // not-started) with zero stories. A not-started milestone is silent (it has
      // reached no status requiring a break-down).
      if (isStarted(status) && children.length === 0) {
        findings.push({
          code: "milestone-no-stories",
          severity: "warn",
          path: item.dir,
          message: `milestone ${item.ref} is ${status} but has zero stories`,
        });
      }

      // missing-architecture (warn): a milestone that HAS at least one story but no
      // ARCHITECTURE.md (the structural-decision doc is absent).
      if (children.length > 0 && !item.docs?.["ARCHITECTURE.md"]?.present) {
        findings.push({
          code: "missing-architecture",
          severity: "warn",
          path: item.dir,
          message: `milestone ${item.ref} has ${children.length} ${children.length > 1 ? "stories" : "story"} but no ARCHITECTURE.md`,
        });
      }
    }

    // started-story-no-tasks (warn): a started story with an empty/absent tasks/.
    if (item.type === "story" && isStarted(status) && !item.hasTasks) {
      findings.push({
        code: "started-story-no-tasks",
        severity: "warn",
        path: item.dir,
        message: `story ${item.ref} is ${status} but its tasks/ is empty (no acceptance contract yet)`,
      });
    }
  }

  return findings;
}
