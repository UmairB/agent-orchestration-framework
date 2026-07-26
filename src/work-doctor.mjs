// `work:doctor`'s engine — the deterministic, cross-item HEALTH lane over an ACD
// work stream (milestone 15 / ADR-003). A SIBLING of `work.mjs`'s `validateWork`,
// a new *consumer* of the model: it reuses `listItems` for identity, a `readMeta`
// pass for frontmatter, the raw `workDir` listing for orphan detection, and a
// per-item folder-mtime probe for the freshness lane — and adds NO new identity
// parsing. It must NOT duplicate `validateWork`'s per-file checks (folder↔
// frontmatter, tag vocabulary, the depends graph): those stay in the VALIDITY
// lane. Doctor's groups are strictly the cross-item / docs-for-status / freshness
// / structural-integrity facts validate cannot see.
//
// The shape (ADR-001/ADR-003):
//   Finding = { code, severity: "warn"|"error", path, message }   — basis-neutral
//             (path is a RAW ABSOLUTE in its on-disk OS form; the FACE relativises).
//   doctorWork(workDir, config, scope, { now, staleWindow }) builds the snapshot
//   ONCE, runs each pure (snapshot, ctx) => Finding[] group in the registry,
//   concatenates + de-dupes identical code+path+message, and filters to scope.
//
// DETERMINISM (ADR-003, a fitness function): this module reads NO wall-clock —
// `now`/`staleWindow` arrive through `ctx`. The only FS time read is the snapshot's
// `stat` pass, taken once at build, handed to the groups as data (not a clock they
// call). Same fixture + same `now` ⇒ byte-identical findings.
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { listItems, parseFrontmatter } from "./work.mjs";
// Story 01/02 check-groups, each a pure (snapshot, ctx) => Finding[] APPENDED to
// the registry below (ADR-003). They consume ITEM_RE/isDriver from this module
// (the cycle is safe — the bindings are read only inside the group bodies at run
// time, never at module-evaluation time).
import { statusCoherenceGroup, lifecycleCompletenessGroup } from "./work-doctor-coherence.mjs";
import { freshnessGroup, structuralIntegrityGroup } from "./work-doctor-freshness.mjs";
import { budgetGroup } from "./work-doctor-budget.mjs";
// milestone 33 / story 00 (ADR-004.4, F-3203) — the mesh-identity-committed warn group.
import { meshIdentityCommittedGroup } from "./work-doctor-identity.mjs";

// The item-identity regex + record-doc mapping are owned by `work.mjs`; doctor is
// a consumer. `work.mjs` does not export them, so the snapshot pass replicates the
// tiny bodies here (the same closed vocabulary) rather than re-globbing identity.
// Exported so the appended check-group modules (stories 01/02) consume the SAME
// identity vocabulary as the spine — no re-parsing of the item-name grammar.
// milestone 37 / ADR-001 — spike/chore admitted here too (mirrors work.mjs's
// ITEM_RE), so doctor does not flag a NN_spike_*/NN_chore_* folder as an unknown
// orphan.
export const ITEM_RE = /^(\d+)_(milestone|story|task|uat|spike|chore)_([a-z0-9-]+)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const recordDoc = (type) =>
  type === "milestone"
    ? "SPEC.md"
    : type === "story"
      ? "STORY.md"
      : type === "uat"
        ? "SESSION.md"
        : type === "spike"
          ? "SPIKE.md"
          : type === "chore"
            ? "CHORE.md"
            : null;

// Top-level drivers of the stream — the items that carry a number the resolver
// keys on (milestones + uat sessions + spike/chore — milestone 37 / ADR-001).
// Mirrors `work.mjs`'s `isDriver`.
export const isDriver = (item) =>
  item.type === "milestone" || item.type === "uat" || item.type === "spike" || item.type === "chore";

async function readDirSafe(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function mtimeMs(target) {
  try {
    return (await stat(target)).mtimeMs;
  } catch {
    return null;
  }
}

// The newest mtime of any FILE in `dir`'s subtree (the dir's own mtime does NOT
// move when a descendant file's content changes — milestone 15 story 02's
// `mtime-ahead-of-updated` needs the newest descendant-FILE mtime, not the folder
// mtime). One recursive `stat` pass at snapshot build — pure DATA handed to the
// freshness group (it never re-reads the FS or the clock). Returns null for an
// empty/absent subtree.
async function newestFileMtimeMs(dir) {
  let newest = null;
  for (const entry of await readDirSafe(dir)) {
    const child = path.join(dir, entry.name);
    // Do NOT follow symbolic links / junctions: on Windows a junctioned dir is
    // reported as a directory, and a cyclic link would recurse to a stack overflow.
    // A symlink is not a content file of this item's tree — skip it entirely.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const sub = await newestFileMtimeMs(child);
      if (sub != null && (newest == null || sub > newest)) newest = sub;
    } else {
      const m = await mtimeMs(child);
      if (m != null && (newest == null || m > newest)) newest = m;
    }
  }
  return newest;
}

// The convention docs the lifecycle-completeness group (story 01) keys on. Probed
// once at snapshot build as pure DATA (presence + non-emptiness): an empty stub is
// a missing deliverable, mirroring SPEC's "non-empty VERIFICATION.md".
const CONVENTION_DOCS = ["VERIFICATION.md", "RETROSPECTIVE.md", "ARCHITECTURE.md"];

// Count lines platform-invariantly (milestone 16 / ADR-003): split on `/\r?\n/` so a
// CRLF (win32) and an LF (CI) line break yield the SAME count, and DROP a single
// trailing empty element so a terminating `\n` does NOT add a phantom line — an empty
// file ⇒ 0 lines, "a\nb\n" ⇒ 2, "a\nb" ⇒ 2 (STATE.md's fixed convention). Pure over
// text the snapshot already read (no FS read of its own).
function splitLines(text) {
  const parts = text.split(/\r?\n/);
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

// `{ present, nonEmpty, lines }` for a file — present means it exists; nonEmpty means
// it exists AND has non-whitespace content; lines is the splitLines count of the SAME
// read (milestone 16 / ADR-002: measurement of an existing read, not a second read).
// Absent ⇒ { present:false, nonEmpty:false, lines:0 }.
async function fileState(target) {
  try {
    const text = await readFile(target, "utf8");
    return { present: true, nonEmpty: text.trim().length > 0, lines: splitLines(text).length };
  } catch {
    return { present: false, nonEmpty: false, lines: 0 };
  }
}

// Whether a `tasks/` dir directly under `dir` holds at least one regular file (a
// non-empty task contract). A started story with an empty/absent `tasks/` has no
// acceptance contract yet (story 01's `started-story-no-tasks`).
async function hasTaskFiles(dir) {
  const tasksDir = path.join(dir, "tasks");
  for (const entry of await readDirSafe(tasksDir)) {
    if (entry.isFile()) return true;
  }
  return false;
}

// -------------------------------------------------------------- snapshot ----

// Build the SHARED, read-only snapshot ONCE (ADR-003 step 1). Every group reads
// from this; no group re-traverses the FS for identity. It carries:
//   items        — the `listItems` set, each enriched with { meta, mtimeMs }
//   workDir      — the stream root (so a group can anchor a root-level finding)
//   topEntries   — the raw `workDir` dir listing (dirs only) for orphan detection
//   storyEntries — per milestone, its `stories/` dir listing (dirs only)
// Mtimes come from a single `stat` pass here — the one FS time read, taken at
// build and handed to the freshness group as DATA (never a clock it calls).
export async function buildSnapshot(workDir) {
  const items = await listItems(workDir);

  const enriched = [];
  for (const item of items) {
    const doc = recordDoc(item.type);
    // Additive snapshot DATA (milestone 16 / ADR-002, the one allowed snapshot
    // extension): a SEPARATE per-artifact line-count map for the long-form context
    // docs the doc-bloat budget group measures (SPEC.md / ARCHITECTURE.md / STORY.md).
    // Kept distinct from `docs` (story 01's present/non-empty contract) so the two
    // stories' data shapes never entangle. Populated ONLY from text the snapshot
    // already reads — the frontmatter read here and the CONVENTION_DOCS fileState
    // read below — never a second filesystem read of any artifact.
    const docSizes = {};
    let meta = {};
    if (doc) {
      try {
        const text = await readFile(path.join(item.dir, doc), "utf8");
        meta = parseFrontmatter(text);
        // SPEC.md (milestone) / STORY.md (story) are budgeted context docs; measure
        // them from THIS read. SESSION.md (uat) is not budgeted — excluded.
        if (doc === "SPEC.md" || doc === "STORY.md") docSizes[doc] = { lines: splitLines(text).length };
      } catch {
        meta = {};
      }
    }
    // Additive snapshot DATA (ADR-003, the one allowed snapshot extension): the
    // convention-doc presence/non-emptiness map + the `tasks/`-non-empty flag the
    // lifecycle-completeness group (story 01) reads, probed once here as pure data.
    const docs = {};
    for (const name of CONVENTION_DOCS) {
      const state = await fileState(path.join(item.dir, name));
      // Preserve story 01's `docs` shape EXACTLY ({ present, nonEmpty }) — never leak
      // `lines` into it (milestone 16 / ADR-002). The ARCHITECTURE.md line count rides
      // the SAME fileState read into the separate docSizes map (no extra traversal).
      docs[name] = { present: state.present, nonEmpty: state.nonEmpty };
      if (name === "ARCHITECTURE.md" && state.present) docSizes["ARCHITECTURE.md"] = { lines: state.lines };
    }
    enriched.push({
      ...item,
      meta,
      mtimeMs: await mtimeMs(item.dir),
      // The newest mtime of any file in the item's folder subtree, for the
      // freshness group's `mtime-ahead-of-updated` check. The folder mtime alone is
      // insufficient (it does not move on a descendant-file content change).
      newestFileMtimeMs: await newestFileMtimeMs(item.dir),
      docs,
      docSizes,
      hasTasks: item.type === "story" ? await hasTaskFiles(item.dir) : false,
    });
  }

  // The raw root listing — directories only (a stray FILE at the root, e.g.
  // ROADMAP.md, is not an item-folder candidate and is not an orphan).
  const topEntries = (await readDirSafe(workDir))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // Per-milestone `stories/` directory listings (dirs only) — the second place an
  // orphan (a typo'd story folder) can hide.
  const storyEntries = {};
  for (const entry of topEntries) {
    const match = entry.match(ITEM_RE);
    if (!match || match[2] !== "milestone") continue;
    const storiesDir = path.join(workDir, entry, "stories");
    storyEntries[entry] = (await readDirSafe(storiesDir))
      .filter((child) => child.isDirectory())
      .map((child) => child.name);
  }

  return { items: enriched, workDir, topEntries, storyEntries };
}

// -------------------------------------------------- seed check-groups ----
//
// The TWO seeded, folder-only check-groups story 00 ships (ADR-004 folder-first).
// They are the minimal pair that gives the `--strict` exit matrix a real warn-only
// fixture (orphan-folder) and a real error fixture (duplicate-driver-number).
// Story 02 owns the REST of structural-integrity (numbering-gap, the ROADMAP hook)
// + all freshness — it must NOT re-implement these two codes, only APPEND groups.

// `orphan-folder` (warn): a directory directly under `workDir` (or under any
// milestone's `stories/`) whose name does NOT match ITEM_RE. `listItems` silently
// drops these (work.mjs), so a typo'd folder vanishes from every command — a real
// artifact nothing else reports.
export function orphanFolderGroup(snapshot) {
  const findings = [];
  for (const name of snapshot.topEntries) {
    if (!ITEM_RE.test(name)) {
      findings.push({
        code: "orphan-folder",
        severity: "warn",
        path: path.join(snapshot.workDir, name),
        message: `folder "${name}" is not a valid NN_type_slug work item (dropped by every command)`,
      });
    }
  }
  for (const [milestone, children] of Object.entries(snapshot.storyEntries)) {
    for (const name of children) {
      if (!ITEM_RE.test(name)) {
        findings.push({
          code: "orphan-folder",
          severity: "warn",
          path: path.join(snapshot.workDir, milestone, "stories", name),
          message: `story folder "${name}" is not a valid NN_type_slug work item (dropped by every command)`,
        });
      }
    }
  }
  return findings;
}

// `duplicate-driver-number` (error): two top-level DRIVERS (milestone/uat, via
// isDriver) sharing a number — `findWork`/`nextWork` key on the number, so a
// duplicate makes depends/next resolution ambiguous (a coherence violation). ONE
// finding per duplicated NUMBER (anchored at the stream root, naming the conflicting
// folders) — the collision is one fact about the stream, not one per participant.
export function duplicateDriverNumberGroup(snapshot) {
  const byNumber = new Map();
  for (const item of snapshot.items) {
    if (item.parent != null || !isDriver(item)) continue;
    const num = Number.parseInt(item.number, 10);
    if (!byNumber.has(num)) byNumber.set(num, []);
    byNumber.get(num).push(item);
  }

  const findings = [];
  for (const [num, drivers] of [...byNumber].sort((a, b) => a[0] - b[0])) {
    if (drivers.length < 2) continue;
    const names = drivers.map((driver) => driver.name).sort();
    findings.push({
      code: "duplicate-driver-number",
      severity: "error",
      path: snapshot.workDir,
      message: `driver number ${num} is shared by ${drivers.length} top-level items (${names.join(", ")}) — ambiguous depends/next resolution`,
    });
  }
  return findings;
}

// The CHECK-GROUP REGISTRY (ADR-003 step 2): the array the engine iterates. Each
// entry is a PURE `(snapshot, ctx) => Finding[]` fn. A new check family = a new fn
// APPENDED here (the milestone-16 seam); it edits no existing group. Story 00 ships
// the two folder-only seeds; stories 01/02 APPEND their groups below (additive,
// order-independent — the engine concatenates + de-dupes):
//   story 01 — statusCoherenceGroup, lifecycleCompletenessGroup (frontmatter-only)
//   story 02 — freshnessGroup (injected clock + mtimes), structuralIntegrityGroup
//   story 02 — freshnessGroup (injected clock + mtimes), structuralIntegrityGroup
//   milestone 16 — budgetGroup (doc-bloat: per-artifact line budgets off ctx.budgets)
//   milestone 33 (story 00) — meshIdentityCommittedGroup (per-install identity in the
//     COMMITTED config — reads ctx.rawCommittedMesh, never ctx.config, ADR-004.4)
export const CHECK_GROUPS = [
  orphanFolderGroup,
  duplicateDriverNumberGroup,
  statusCoherenceGroup,
  lifecycleCompletenessGroup,
  freshnessGroup,
  structuralIntegrityGroup,
  budgetGroup,
  meshIdentityCommittedGroup,
];

// ----------------------------------------------------------- the engine ----

// Resolve `config.work.doctor.staleWindowDays` to a window in ms; defaults to
// 30 days when absent. (The CLI face supplies this through `ctx.staleWindow`;
// passing it here keeps the engine's wall-clock-free contract.)
export function staleWindowFromConfig(config) {
  const days = config?.work?.doctor?.staleWindowDays;
  const parsed = Number.parseInt(days, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * DAY_MS : 30 * DAY_MS;
}

// The DOCUMENTED DEFAULT per-artifact line budgets (milestone 16 / ADR-005). These
// numbers live ONLY here — never baked into the budgetGroup body (the config-sourced
// arch-test source-greps the group for them). Calibrated so `aof work doctor` over a
// healthy repo yields zero `doc-over-budget` findings while genuine bloat fires.
const DEFAULT_BUDGETS = { spec: 300, architecture: 700, story: 150 };

// Resolve `config.work.doctor.budgets = { spec, architecture, story }` (line counts)
// to a fully-populated `{ spec, architecture, story }`, substituting the documented
// default for any absent/invalid key (mirrors `staleWindowFromConfig`'s robustness —
// a non-finite-positive-integer key falls back to its default). A partially-set
// `budgets` leaves the unset kinds on their defaults (ADR-006). The resolved budgets
// flow into the group via `ctx.budgets`, keeping the group pure (it reads no config).
export function budgetsFromConfig(config) {
  const raw = config?.work?.doctor?.budgets ?? {};
  const resolve = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    spec: resolve(raw.spec, DEFAULT_BUDGETS.spec),
    architecture: resolve(raw.architecture, DEFAULT_BUDGETS.architecture),
    story: resolve(raw.story, DEFAULT_BUDGETS.story),
  };
}

// Scope-as-filter with the SAME semantics as `validateWork` (an unresolved scope
// matches nothing → empty, never a throw). A bare number scopes to that driver's
// subtree (the driver + its stories); `NN/SS` to that exact story; free text to a
// slug substring.
function inScope(item, scopeRef) {
  if (!scopeRef) return true;
  const ref = scopeRef.trim();
  if (ref === "") return true;
  if (/^\d+$/.test(ref)) return Number.parseInt(item.parent ?? item.number, 10) === Number.parseInt(ref, 10);
  const pair = ref.match(/^(\d+)\/(\d+)$/);
  if (pair) return item.ref === `${pair[1]}/${pair[2]}` || item.ref === ref;
  return item.slug.includes(ref);
}

// Scope filters only the ITEM-anchored findings. A finding anchored at the workDir
// root is a STREAM-LEVEL integrity fact (numbering-gap, duplicate-driver-number,
// roadmap-folder-mismatch) — it is ALWAYS reported regardless of scope, mirroring
// `validateWork`'s workDir-anchored `depends cycle`. An item-anchored finding is in
// scope when its path belongs to an in-scope item's folder. A scope that resolves to
// no item still yields the stream-level findings (the unresolved-scope contract — an
// empty item set — applies only to the item-anchored findings).
function filterFindingsToScope(findings, snapshot, scopeRef) {
  if (!scopeRef || scopeRef.trim() === "") return findings;
  const scoped = snapshot.items.filter((item) => inScope(item, scopeRef));
  const dirs = scoped.map((item) => item.dir);
  return findings.filter(
    (finding) =>
      finding.path === snapshot.workDir ||
      dirs.some((dir) => finding.path === dir || finding.path.startsWith(dir + path.sep)),
  );
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.code}\0${finding.path}\0${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// `doctorWork(workDir, config, scope, { now, staleWindow, groups })` — the engine
// (ADR-003). Build the snapshot ONCE, run every registry group over (snapshot,
// ctx), concatenate, de-dupe identical code+path+message, filter to scope. `now`/
// `staleWindow` are INJECTED (the impure edge — the CLI's Date.now() — lives at
// the command boundary, never here). `groups` defaults to CHECK_GROUPS; the tests
// (and the milestone-16 seam) pass their own registry to prove composition.
//
// milestone 33 / story 00 (ADR-004.4, F-3203) — `rawCommittedMesh` + `committedConfigPath`
// are ALSO injected at this SAME impure edge: the mesh-identity-committed check-group
// (work-doctor-identity.mjs) must warn off the RAW committed config on disk, never
// `ctx.config` (which is the loadWorkspace-HYDRATED object — post-migration it still
// carries mesh.nodeId, sourced from the sidecar, so warning off it would false-positive
// forever on a correctly-migrated repo). `commands/doctor.mjs` reads the committed
// file's mesh block independently and hands it in here as plain data, exactly like
// `now`/`staleWindow` — the engine itself performs no extra disk read.
export async function doctorWork(workDir, config, scope, options = {}) {
  const { now, staleWindow, budgets, groups = CHECK_GROUPS, rawCommittedMesh, committedConfigPath, legacyIdentitySidecarPresent, legacyIdentitySidecarPath } = options;
  const snapshot = await buildSnapshot(workDir);
  const ctx = {
    now: now ?? null,
    staleWindow: staleWindow ?? staleWindowFromConfig(config),
    budgets: budgets ?? budgetsFromConfig(config),
    config: config ?? {},
    rawCommittedMesh: rawCommittedMesh ?? {},
    committedConfigPath: committedConfigPath ?? null,
    legacyIdentitySidecarPresent: legacyIdentitySidecarPresent === true,
    legacyIdentitySidecarPath: legacyIdentitySidecarPath ?? null,
  };

  const all = [];
  for (const group of groups) {
    const produced = group(snapshot, ctx);
    if (Array.isArray(produced)) all.push(...produced);
  }

  return filterFindingsToScope(dedupe(all), snapshot, scope);
}
