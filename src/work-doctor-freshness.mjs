// work:doctor — milestone 15 / story 02 check-groups: FRESHNESS / DATE-SANITY and
// STRUCTURAL-INTEGRITY. Each is a PURE `(snapshot, ctx) => Finding[]` function
// APPENDED to the engine's CHECK_GROUPS registry (ADR-003) — it edits no existing
// group and no spine control flow.
//
// FRESHNESS reads ctx.now / ctx.staleWindow + the snapshot's recorded
// created/updated dates and per-item newest-descendant-file mtime — NEVER the
// wall-clock (ADR-003; the determinism arch-test guards this). STRUCTURAL-INTEGRITY
// is folder-first (ADR-004): numbering-gap (warn) always-on, plus the dormant
// roadmap-folder-mismatch cross-reference that is an honest NO-OP until a
// structured, machine-parseable milestone index is configured (config.work.roadmap).
// orphan-folder + duplicate-driver-number are story 00 seeds — NOT re-implemented here.
//
// Codes + severities (ADR-001, fixed in the task .feature Examples):
//   freshness:   stale-updated (warn), updated-before-created (error),
//                unparseable-date (error), mtime-ahead-of-updated (warn)
//   structural:  numbering-gap (warn), roadmap-folder-mismatch (warn, opt-in)
import path from "node:path";
import { ITEM_RE, isDriver } from "./work-doctor.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

// -------------------------------------------------------- date parsing ----
//
// STRICT ISO parse: accept only `YYYY-MM-DD` (optionally with a `T…` time/zone),
// and verify the parsed value round-trips to the SAME calendar fields — so an
// impossible calendar date (2026-13-40) and a non-ISO shape (25-06-2026, DD-MM-YYYY)
// are rejected even though Date.parse would leniently coerce or roll them over.
// Returns a millisecond timestamp, or null when the string is not a valid ISO date.
function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (!match) return null;
  const [, y, mo, d] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  // Construct in UTC and require the fields to survive (no month/day rollover).
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  // Now that the DATE part is valid, take the full timestamp (so an explicit time
  // component like T12:00:00Z is honoured for the mtime/stale comparisons). A
  // zoneless date-ONLY value is the UTC midnight already computed above. A value
  // with a time component but NO explicit zone (Z / ±hh:mm) MUST be read as UTC —
  // deferring to Date.parse would interpret it in the HOST local timezone, making
  // findings non-deterministic across machines (ADR-003). An explicit zone is
  // honoured verbatim.
  const time = trimmed.slice(10); // everything after YYYY-MM-DD (a `T…`/` …` or "")
  if (time === "") return date.getTime();
  const zoneless = !/(?:Z|[+-]\d{2}:?\d{2})$/.test(time);
  const normalised = zoneless ? `${trimmed.replace(" ", "T")}Z` : trimmed;
  const full = Date.parse(normalised);
  return Number.isFinite(full) ? full : date.getTime();
}

// A date field is PRESENT-but-MALFORMED when it carries a non-empty value that does
// not parse to a valid ISO calendar date (an absent field is not a fault here).
function isMalformed(value) {
  return value != null && value !== "" && parseIsoDate(value) === null;
}

// Whether the raw value carries an explicit time-of-day component (a `T…`), vs a
// bare `YYYY-MM-DD`.
const hasTimeComponent = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}[T ]/.test(value.trim());

// The threshold an `updated` value represents for the mtime-ahead comparison: an
// explicit-time `updated` is the exact instant; a DATE-ONLY `updated` covers the
// WHOLE day, so a same-day file mtime is NOT "ahead" (it is end-of-day, the latest
// moment the bare date still denotes). Matches the feature: updated "2026-06-20" is
// not behind a 09:00 same-day mtime, yet updated "…T12:00:00Z" is behind a
// "…T12:00:01Z" mtime by one second.
function updatedMtimeThreshold(rawUpdated) {
  const base = parseIsoDate(rawUpdated);
  if (base == null) return null;
  if (hasTimeComponent(rawUpdated)) return base;
  return base + DAY_MS - 1; // end of the date-only day
}

// --------------------------------------------------------- freshness group ----
//
// Per-item date sanity against the INJECTED clock. Pure over the snapshot's
// recorded created/updated + newest-descendant-file mtime; reads ctx.now /
// ctx.staleWindow only — no wall-clock.
export function freshnessGroup(snapshot, ctx) {
  const findings = [];
  const now = ctx?.now ?? null;
  const staleWindow = ctx?.staleWindow ?? null;

  for (const item of snapshot.items) {
    const meta = item.meta ?? {};
    const createdRaw = meta.created;
    const updatedRaw = meta.updated;

    // unparseable-date (error): a present-but-malformed created OR updated. One
    // finding per item carrying any malformed date (the item's record is unsound).
    const malformed = [];
    if (isMalformed(createdRaw)) malformed.push(`created "${createdRaw}"`);
    if (isMalformed(updatedRaw)) malformed.push(`updated "${updatedRaw}"`);
    if (malformed.length > 0) {
      findings.push({
        code: "unparseable-date",
        severity: "error",
        path: item.dir,
        message: `item ${item.ref} has an unparseable date: ${malformed.join(", ")}`,
      });
      // A malformed date makes the chronology/staleness comparisons meaningless —
      // skip them for this item (report the parse fault, not derived nonsense).
      continue;
    }

    const created = parseIsoDate(createdRaw);
    const updated = parseIsoDate(updatedRaw);

    // updated-before-created (error): both parse and updated is STRICTLY before
    // created (equal dates are not out of order).
    if (created != null && updated != null && updated < created) {
      findings.push({
        code: "updated-before-created",
        severity: "error",
        path: item.dir,
        message: `item ${item.ref} has updated "${updatedRaw}" before created "${createdRaw}"`,
      });
    }

    // stale-updated (warn): an in-progress item whose updated is older than the
    // staleWindow before now (now - updated >= staleWindow). Only in-progress items.
    //
    // THE STATUS GATE READS THE DISK'S STATUS, EXPLICITLY (m43 / ADR-005 + ADR-016/G5,
    // MEASURED). ADR-005 declares this group disk-only, and every OTHER datum it compares —
    // `created`, `updated`, `newestFileMtimeMs` — is this node's own filesystem. `meta.status`
    // is NOT: 43/06's snapshot builder overlays the cache's status onto `item.meta`, so this
    // gate silently became cache-authoritative while its comparands stayed the disk's. On a
    // control node holding a pre-run scaffold for an item a WORKER is actively building, that
    // produced `item 07 is in-progress but updated "…" is older than the stale window` — a
    // finding whose `path` is the control's folder, whose subject is another machine's live
    // work, and which is false about the item and true only about a scaffold nobody was meant
    // to be reading. `item.diskStatus` is the disk's own value, stamped by `overlayFor` on
    // BOTH of its branches, so the whole comparison is one node's facts again.
    //
    // THE RULE, stated because "disk-only" was read as "unedited": A GROUP IS DISK-ONLY WHEN
    // THE FACTS IT READS ARE THE DISK'S — A GATE IS A READ. A group's source is a property of
    // what it consumes, not of whether its file appears in a diff. Comparing one machine's
    // status against another machine's mtimes is a defect whichever line was edited to
    // produce it.
    if (
      item.diskStatus === "in-progress" &&
      updated != null &&
      now != null &&
      staleWindow != null &&
      now - updated >= staleWindow
    ) {
      findings.push({
        code: "stale-updated",
        severity: "warn",
        path: item.dir,
        message: `item ${item.ref} is in-progress but updated "${updatedRaw}" is older than the stale window`,
      });
    }

    // mtime-ahead-of-updated (warn): a folder file whose mtime is STRICTLY newer than
    // the recorded updated — the record was touched but `updated` was not bumped. A
    // DATE-ONLY updated covers the whole day, so a same-day mtime is not ahead; an
    // explicit-time updated is compared to the exact instant.
    const threshold = updatedMtimeThreshold(updatedRaw);
    if (threshold != null && item.newestFileMtimeMs != null && item.newestFileMtimeMs > threshold) {
      findings.push({
        code: "mtime-ahead-of-updated",
        severity: "warn",
        path: item.dir,
        message: `item ${item.ref} has a folder file newer than its recorded updated "${updatedRaw}"`,
      });
    }
  }

  return findings;
}

// ------------------------------------------------ structural-integrity group ----
//
// Folder-first (ADR-004). numbering-gap is always-on, pure over the top-level driver
// number sequence. The roadmap-folder-mismatch cross-reference is OPT-IN: it fires
// ONLY when a structured, machine-parseable milestone index is configured at
// config.work.roadmap; with none (this repo's state) it is an honest no-op.
// (orphan-folder + duplicate-driver-number are story 00 seeds — not duplicated.)
export function structuralIntegrityGroup(snapshot, ctx) {
  const findings = [];

  // numbering-gap (warn): a missing number in the top-level driver sequence. Drivers
  // are milestone/uat items at the root (isDriver); a gap between the min and max
  // observed numbers is advisory (gaps are usually intentional reservations).
  const driverNumbers = [
    ...new Set(
      snapshot.items
        .filter((item) => item.parent == null && isDriver(item))
        .map((item) => Number.parseInt(item.number, 10))
        .filter((num) => Number.isFinite(num))
    ),
  ].sort((a, b) => a - b);

  if (driverNumbers.length >= 2) {
    const lo = driverNumbers[0];
    const hi = driverNumbers[driverNumbers.length - 1];
    const present = new Set(driverNumbers);
    const missing = [];
    for (let n = lo; n <= hi; n += 1) {
      if (!present.has(n)) missing.push(n);
    }
    if (missing.length > 0) {
      findings.push({
        code: "numbering-gap",
        severity: "warn",
        path: snapshot.workDir,
        message: `the top-level driver sequence has ${missing.length > 1 ? "gaps" : "a gap"}: number ${missing.map((n) => String(n).padStart(2, "0")).join(", ")} ${missing.length > 1 ? "are" : "is"} missing between ${String(lo).padStart(2, "0")} and ${String(hi).padStart(2, "0")}`,
      });
    }
  }

  // roadmap-folder-mismatch (warn) — OPT-IN / honest no-op (ADR-004). Activates ONLY
  // when a structured milestone index is provided via config.work.roadmap (a
  // { index: [{ number, slug? }, …] } object, or an array of such entries). With no
  // such structured index — a prose/backlog ROADMAP, or none — this emits nothing.
  findings.push(...roadmapFolderMismatch(snapshot, ctx));

  return findings;
}

// The dormant ROADMAP↔folder cross-reference. Parses ONLY a structured, machine-
// readable milestone index from config.work.roadmap; never any prose. Diffs the
// indexed milestone numbers against the on-disk milestone folders both ways
// (indexed-but-absent / on-disk-but-unindexed). Returns [] when no structured index
// is configured (the honest no-op — this repo's state).
function roadmapFolderMismatch(snapshot, ctx) {
  const index = structuredIndex(ctx?.config);
  if (index == null) return []; // no structured index → honest no-op

  const indexedNumbers = new Set(
    index
      .map((entry) => Number.parseInt(entry?.number, 10))
      .filter((num) => Number.isFinite(num))
  );

  const folderNumbers = new Set(
    snapshot.topEntries
      .map((name) => name.match(ITEM_RE))
      .filter((m) => m && m[2] === "milestone")
      .map((m) => Number.parseInt(m[1], 10))
      .filter((num) => Number.isFinite(num))
  );

  const findings = [];
  for (const num of [...indexedNumbers].sort((a, b) => a - b)) {
    if (!folderNumbers.has(num)) {
      findings.push({
        code: "roadmap-folder-mismatch",
        severity: "warn",
        path: snapshot.workDir,
        message: `the ROADMAP index lists milestone ${String(num).padStart(2, "0")} but no matching folder exists on disk`,
      });
    }
  }
  for (const num of [...folderNumbers].sort((a, b) => a - b)) {
    if (!indexedNumbers.has(num)) {
      findings.push({
        code: "roadmap-folder-mismatch",
        severity: "warn",
        path: snapshot.workDir,
        message: `milestone folder ${String(num).padStart(2, "0")} exists on disk but the ROADMAP index omits it`,
      });
    }
  }
  return findings;
}

// Extract a structured milestone index from config, or null when none is configured.
// A structured index is `config.work.roadmap.index` (an array of { number, … }) or
// `config.work.roadmap` itself being such an array. A string path or any non-array
// shape is treated as NOT a structured index (the prose/backlog case → no-op).
function structuredIndex(config) {
  const roadmap = config?.work?.roadmap;
  if (Array.isArray(roadmap)) return roadmap;
  if (roadmap && Array.isArray(roadmap.index)) return roadmap.index;
  return null;
}
