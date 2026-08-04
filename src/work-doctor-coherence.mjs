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

// ------------------------------------------------------- the cache overlay ----
//
// milestone 43 / story 06 (ADR-005, ADR-010/R6.1 + R6.2). Two predicates and one group,
// all decided by a single question: WHO last reported this row?
//
//   · reportedElsewhere — the cache is authoritative for the status AND another node put it
//     there. This node's disk is not expected to hold that item's deliverables at all.
//   · cacheDegraded     — …and the fact a lifecycle finding is about (a named convention doc,
//     or the children set) fell back to this node's disk, so the finding would be a claim
//     about a checkout nobody ever wrote to.
//
// The three suppressed findings are `missing-verification`, `missing-retrospective` and
// `milestone-no-stories`, and they are replaced by ONE `cache-incomplete` rather than
// silence: an operator who sees nothing cannot tell "checked and fine" from "not checked".
//
// A DELIBERATE SECOND SPELLING of `work-read.mjs`'s `reportedElsewhere`, and it CITES it
// (ADR-016/G10's condition). Same question, different SHAPE: the seam's predicate reads a
// stamped ROW (`answeredFrom` + the node the row itself carries), this one reads doctor's
// SNAPSHOT (`statusFrom`, the per-fact source stamp `overlayFor` writes, against
// `snapshot.selfNode`). Collapsing them would mean handing one of the two a shape it does not
// have, which is a translation layer for three clauses.
function reportedElsewhere(snapshot, item) {
  return item.statusFrom === "cache"
    && typeof item.reportedBy === "string" && item.reportedBy.length > 0
    && item.reportedBy !== snapshot.selfNode;
}

// `fact` is a convention-doc filename ("VERIFICATION.md") or the string "children".
function cacheDegraded(snapshot, item, fact) {
  if (!reportedElsewhere(snapshot, item)) return false;
  return fact === "children" ? item.childrenFrom !== "cache" : item.docsFrom?.[fact] !== "cache";
}

// The findings the overlay itself makes possible. Both NAME the reporting node in their
// message, which is a required contract (ADR-010/R6.2): a Finding is
// `{ code, severity, path, message }` with no room for structured provenance, so the message
// is the ONLY channel through which an operator can tell the two cases apart — and telling
// them apart is the whole of ADR-005's doctor clause.
export function cacheAuthorityGroup(snapshot) {
  const findings = [];
  for (const item of snapshot.items) {
    if (item.statusFrom !== "cache") continue;

    // cache-status-divergence (warn): this node's own disk disagrees with this node's own
    // last report. That is a REAL fault — something wrote the record doc without publishing,
    // or the publish tick is broken — and it stays a finding. The identical disagreement on a
    // ref another node reported is SILENT, because it is the mesh working exactly as designed:
    // the other node's copy is the live one and this node's scaffold is simply behind.
    if (!reportedElsewhere(snapshot, item) && (item.diskStatus ?? null) !== (statusOf(item) ?? null)) {
      const reporter = item.reportedBy ?? snapshot.selfNode ?? "this node";
      findings.push({
        code: "cache-status-divergence",
        severity: "warn",
        path: anchorPath(item),
        message: `${item.ref} reads "${item.diskStatus ?? "unset"}" on this node's disk but "${statusOf(item) ?? "unset"}" in the cache, last reported by ${reporter} — this node's own report disagrees with its own files`,
      });
      continue;
    }

    // cache-incomplete (warn): the ONE honest finding that replaces up to three false ones.
    if (item.type !== "milestone") continue;
    const missing = ["VERIFICATION.md", "RETROSPECTIVE.md", "children"].filter((fact) => cacheDegraded(snapshot, item, fact));
    // Only report where a lifecycle finding would ACTUALLY have fired: an item whose status
    // implies no deliverable yet (a not-started remote milestone) has nothing incomplete
    // about it, and a finding on every remote row would be the noise this exists to prevent.
    const status = statusOf(item);
    const lifecycleApplies = status === "in-review" || status === "done" || isStarted(status);
    if (missing.length === 0 || !lifecycleApplies) continue;
    findings.push({
      code: "cache-incomplete",
      severity: "warn",
      path: item.dir,
      message: `milestone ${item.ref} is "${status}" as last reported by ${item.reportedBy}, but this node holds none of its ${missing.join(", ")} — the lifecycle checks are suppressed rather than reported against a checkout that never held them`,
    });
  }
  return findings;
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
    // milestone 43 / story 06 (ADR-010/R6.1) — THE SUPPRESSION, and it is the whole reason
    // the overlay is per-fact. This group reads `status × docs × children`. When the STATUS
    // is cache-authoritative and was reported by ANOTHER node, while the doc-presence and
    // children facts fell back to THIS node's disk, all three findings below are claims
    // about a checkout that was never supposed to hold those artifacts — the control's disk
    // has no VERIFICATION.md, no RETROSPECTIVE.md and an empty `stories/` for a milestone a
    // worker built in its own worktree. Each is suppressed only when ITS OWN fact degraded,
    // and `cacheAuthorityGroup` replaces the set with ONE honest `cache-incomplete` naming
    // the reporting node. Gating on `statusFrom === "disk"` was REJECTED at refine: it would
    // exempt remote items from lifecycle checks permanently, which is doctor going blind on
    // exactly the items the mesh cares about.
    const degraded = (fact) => cacheDegraded(snapshot, item, fact);

    if (item.type === "milestone") {
      const children = item.childrenFrom === "cache"
        ? (item.cachedChildRefs ?? [])
        : (childrenByDir.get(item.dir) ?? []);

      // missing-verification (warn): in-review OR done with no NON-EMPTY VERIFICATION.md.
      if (!degraded("VERIFICATION.md") && (status === "in-review" || status === "done") && !item.docs?.["VERIFICATION.md"]?.nonEmpty) {
        findings.push({
          code: "missing-verification",
          severity: "warn",
          path: item.dir,
          message: `milestone ${item.ref} is ${status} but has no non-empty VERIFICATION.md`,
        });
      }

      // missing-retrospective (warn): done with no RETROSPECTIVE.md.
      if (!degraded("RETROSPECTIVE.md") && status === "done" && !item.docs?.["RETROSPECTIVE.md"]?.present) {
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
      if (!degraded("children") && isStarted(status) && children.length === 0) {
        findings.push({
          code: "milestone-no-stories",
          severity: "warn",
          path: item.dir,
          message: `milestone ${item.ref} is ${status} but has zero stories`,
        });
      }

      // missing-architecture (warn): a milestone that HAS at least one story but no
      // ARCHITECTURE.md (the structural-decision doc is absent). NOT in R6.1's suppressed
      // set, and deliberately so: it fires on a fact both sides agree about (nobody has one),
      // where the other three fire on a fact only the cache could have.
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
