// src/work-upgrade.mjs — the migration registry + `aof upgrade` engine
// (milestone 40 / story 02, ADR-005). IMPORTS work.mjs's readers + the ADR-004
// atomic writer; work.mjs NEVER imports this module back — the god-node's
// 39-module blast radius does not grow (arch-test
// acd-upgrade-engine-blast-radius, mirroring m41/ADR-001's
// work-reindex.mjs -> work.mjs direction).
//
// WORK_ITEM_MIGRATIONS is the single source of truth for "what shape is a work
// item at schema N, and how do I reach the shape this build expects": an
// ordered, CONTIGUOUS chain of transform descriptors rooted at the
// pre-versioning baseline 0 (0 -> 1 -> …). Its highest `to` is BOUND EQUAL to
// WORK_ITEM_SCHEMA_VERSION below, so the constant (work.mjs) and the registry
// (here) can never silently drift apart (ADR-005 anti-drift; arch-test
// acd-work-item-schema-single-constant).
//
// The 0 -> 1 transform IS the stamp (ADR-003): it backstamps an unstamped
// (schema-0) item to schema 1 plus an `aofVersion` provenance string, through
// the ADR-004 atomic frontmatter writer. It is NOT a reconstruction — it
// records a TRUE version and infers no content — so it declares no
// `reconstructs` flag, and the engine sets no `reconstructed` marker for it
// (ADR-008).
import { listItems, recordDoc, readItemSchema, applyItemFrontmatter, WORK_ITEM_SCHEMA_VERSION } from "./work.mjs";
import { packageVersionString } from "./asset-base.mjs";
import { commandError } from "./command-error.mjs";

// ------------------------------------------------- the 0 -> 1 stamp transform
//
// `apply` is a PURE frontmatter-BLOCK mutator: `(rawBlockText, item) =>
// newRawBlockText` — the same block-in/block-out shape applyItemFrontmatter's
// `mutate` callback takes (ADR-004). The ENGINE (below), never the transform
// itself, is the sole caller of applyItemFrontmatter — a transform descriptor
// never touches the record-doc body and never writes frontmatter directly.
const STAMP_0_TO_1 = {
  id: "stamp-0-to-1",
  from: 0,
  to: 1,
  summary:
    "Backstamp an unstamped (schema-0) item to schema 1, writing an aofVersion provenance string. " +
    "This is the transform that backstamps the aof repository's own pre-versioning stream (items " +
    "00-39) — those items ARE the current shape, so stamping them schema 1 is a true version record, " +
    "never a reconstruction (ADR-003 / ADR-008).",
  apply(block) {
    const version = packageVersionString();
    let next = /^schema:/m.test(block) ? block.replace(/^schema:.*$/m, "schema: 1") : `${block}\nschema: 1`;
    next = /^aofVersion:/m.test(next)
      ? next.replace(/^aofVersion:.*$/m, `aofVersion: ${version}`)
      : `${next}\naofVersion: ${version}`;
    return next;
  },
};

// The registry — an ORDERED, CONTIGUOUS chain rooted at 0. Add a new transform
// by APPENDING an entry whose `from` equals the current highest `to`, and bump
// WORK_ITEM_SCHEMA_VERSION (work.mjs) to match its new `to` — the anti-drift
// bind directly below throws immediately if the two fall out of step.
export const WORK_ITEM_MIGRATIONS = [STAMP_0_TO_1];

// --------------------------------------------------- anti-drift bind (ADR-005)
//
// The registry's highest transform target MUST equal WORK_ITEM_SCHEMA_VERSION
// — the constant declares the target, the registry provides the path to it,
// and the two are bound equal here so they cannot silently drift apart. A
// STRUCTURAL check, not a convention an author must remember: this throws at
// MODULE LOAD if the two are ever out of step.
const highestTarget = WORK_ITEM_MIGRATIONS.reduce((max, transform) => Math.max(max, transform.to), -1);
if (highestTarget !== WORK_ITEM_SCHEMA_VERSION) {
  throw new Error(
    `WORK_ITEM_MIGRATIONS' highest transform target (${highestTarget}) must equal ` +
      `WORK_ITEM_SCHEMA_VERSION (${WORK_ITEM_SCHEMA_VERSION}) — the registry and the schema constant have drifted.`,
  );
}

// --------------------------------------------------------------- selection --
//
// The ordered sub-chain from `fromSchema` forward to `toSchema`, over an
// INJECTABLE registry (defaults to the real WORK_ITEM_MIGRATIONS — the ADR-008
// test seam a synthetic reconstructing transform drives, and the seam the
// engine functions below reuse). An item already at or past `toSchema`
// selects the EMPTY chain (the idempotency root, ADR-005). A schema with no
// registered transform reachable from it stops the chain where the registry
// runs out — it never invents a step.
export function planTransforms(fromSchema, toSchema, migrations = WORK_ITEM_MIGRATIONS) {
  if (!Number.isInteger(fromSchema) || !Number.isInteger(toSchema) || fromSchema >= toSchema) return [];
  const byFrom = new Map(migrations.map((transform) => [transform.from, transform]));
  const chain = [];
  let cursor = fromSchema;
  while (cursor < toSchema) {
    const step = byFrom.get(cursor);
    if (!step) break; // the registry has no step from here — never invent one
    chain.push(step);
    cursor = step.to;
  }
  return chain;
}

// ------------------------------------------------------------- the engine --

// planUpgrade enumerates every item under workDir, reads its ON-DISK schema
// (readItemSchema, work.mjs), and selects the sub-chain from that schema
// forward to WORK_ITEM_SCHEMA_VERSION. Read-only — mutates nothing. Returns
// one entry per item carrying a resolvable record doc (an item with no
// record doc — recordDoc returns null — is skipped: there is nothing to
// stamp). `migrations` is injectable (defaults to the real registry) — the
// same ADR-008 test seam planTransforms exposes.
export async function planUpgrade(workDir, { migrations = WORK_ITEM_MIGRATIONS } = {}) {
  const items = await listItems(workDir);
  const plan = [];
  for (const item of items) {
    const doc = recordDoc(item);
    if (!doc) continue;
    const schema = await readItemSchema(item);
    const transforms = planTransforms(schema, WORK_ITEM_SCHEMA_VERSION, migrations);
    plan.push({
      item,
      ref: item.ref,
      type: item.type,
      dir: item.dir,
      doc,
      schema,
      transforms,
      newerThanBuild: schema > WORK_ITEM_SCHEMA_VERSION,
    });
  }
  return plan;
}

// Apply ONE transform through the ADR-004 atomic writer. The engine is the
// SOLE caller of applyItemFrontmatter for a registered transform — a
// transform's own `apply` never touches the record doc directly, so every
// transform-driven write goes through the ONE frontmatter authority in
// work.mjs. When the descriptor declares `reconstructs: true`, the engine
// MECHANICALLY appends the `reconstructed: true` marker after the transform's
// own mutation — a STRUCTURAL guarantee (ADR-008), not something a transform
// author must remember to add themselves. The stamp transform above declares
// no `reconstructs` flag, so it never gains the marker.
async function applyTransform(item, transform) {
  await applyItemFrontmatter(item, async (block) => {
    let next = await transform.apply(block, item);
    if (transform.reconstructs === true && !/^reconstructed:/m.test(next)) {
      next = `${next}\nreconstructed: true`;
    }
    return next;
  });
}

// -------------------------------------------------------- the changelog --
//
// renderChangelog projects `migrations` (default the real registry) into a
// markdown changelog — ONE entry per transform descriptor, each showing its
// `id`, its `from -> to` step, and its `summary` (ADR-006 / story 04). PURE
// and DETERMINISTIC: nothing volatile (no timestamp, no
// packageVersionString()/aofVersion, no per-release value) appears anywhere
// in the output — regenerating this function's output must reproduce the
// committed artifact (UPGRADE-CHANGELOG.md, repo root — see story 04's
// STORY.md "committed artifact" note) byte-for-byte, on every call, which is
// only possible if nothing volatile leaks in. The leading
// `<!-- aof-generated: true -->` comment is the 01/ADR-005 stamp form, so the
// artifact is self-identifying. "How do I upgrade" resolves to the
// `aof upgrade` command named in the preamble — never to prose that could go
// stale. This function only READS `migrations`; it is never called from
// planUpgrade/planTransforms/runUpgrade — the changelog is a downstream-only
// projection of the registry, never fed back into what the engine executes
// (acd-changelog-generated).
export function renderChangelog(migrations = WORK_ITEM_MIGRATIONS) {
  const chain = [...migrations].sort((a, b) => a.from - b.from);
  const lines = [
    "<!-- aof-generated: true -->",
    "",
    "# Upgrade changelog",
    "",
    "This changelog is generated from `WORK_ITEM_MIGRATIONS` (`src/work-upgrade.mjs`) — a pure",
    "projection of the migration registry, never hand-authored (ADR-006, milestone 40). It",
    "describes each registered transform; the act of upgrading a work stream to the current",
    "schema is always the command:",
    "",
    "```",
    "aof upgrade",
    "```",
    "",
    "(`aof upgrade --dry-run` previews the pending transforms without writing; add `--json` for",
    "a machine-readable plan.) Regenerating this file from the registry reproduces it",
    "byte-for-byte — a hand edit cannot survive the drift guard.",
    "",
    "## Transforms",
    "",
  ];
  for (const transform of chain) {
    lines.push(`### \`${transform.id}\` — schema ${transform.from} -> ${transform.to}`);
    lines.push("");
    lines.push(transform.summary);
    lines.push("");
  }
  while (lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

// changelogDrift is the drift-guard CHECK (ADR-006 / story 04's second
// regenerate-surface, alongside the `aof upgrade --changelog` CLI emit,
// src/commands/upgrade.mjs). It performs NO fs I/O itself — the caller reads
// the committed artifact's bytes and passes them in — so it stays a pure,
// injectable comparison: a fresh renderChangelog(migrations) vs the supplied
// `committedText`. `drifted: true` means the committed artifact no longer
// matches what the registry would generate today (a hand edit, or a registry
// change nobody regenerated the file for).
export function changelogDrift(committedText, migrations = WORK_ITEM_MIGRATIONS) {
  const regenerated = renderChangelog(migrations);
  return { drifted: String(committedText) !== regenerated, regenerated };
}

// runUpgrade is the whole-stream engine `aof upgrade` (src/commands/upgrade.mjs)
// calls. `{ apply: false }` (the default) is the DRY-RUN — plans and reports,
// mutates nothing. `{ apply: true }` applies every pending item's transforms in
// order, through the atomic writer, and is IDEMPOTENT by construction: an item
// already at WORK_ITEM_SCHEMA_VERSION selects the empty chain (planTransforms
// above) and is therefore never touched, so re-running an already-current
// stream is a byte-identical no-op (ADR-005, arch-test acd-upgrade-idempotent).
//
// A stream/item schema NEWER than this build's WORK_ITEM_SCHEMA_VERSION is a
// REFUSAL — checked BEFORE any write, dry-run or apply, mirroring the
// global-work-store precedent (existing > current throws at open, before
// migrateSchema ever runs): the WHOLE run refuses and nothing is written,
// never a downgrade.
export async function runUpgrade(workDir, { apply = false, migrations = WORK_ITEM_MIGRATIONS } = {}) {
  const plan = await planUpgrade(workDir, { migrations });

  const newer = plan.filter((entry) => entry.newerThanBuild);
  if (newer.length > 0) {
    throw commandError(
      `${newer.length} item(s) carry a schema newer than this aof build supports ` +
        `(WORK_ITEM_SCHEMA_VERSION ${WORK_ITEM_SCHEMA_VERSION}): ` +
        `${newer.map((entry) => `${entry.ref} (schema ${entry.schema})`).join(", ")}. ` +
        `Refusing to downgrade — upgrade your aof build to continue.`,
      "schema-newer-than-build",
      409,
    );
  }

  const pending = plan.filter((entry) => entry.transforms.length > 0);
  const pendingReport = pending.map((entry) => ({
    ref: entry.ref,
    type: entry.type,
    schema: entry.schema,
    transformIds: entry.transforms.map((transform) => transform.id),
    toSchema: entry.transforms[entry.transforms.length - 1]?.to ?? entry.schema,
  }));

  if (!apply) {
    return { dryRun: true, total: plan.length, pendingCount: pending.length, pending: pendingReport };
  }

  const applied = [];
  for (const entry of pending) {
    for (const transform of entry.transforms) {
      await applyTransform(entry.item, transform);
    }
    applied.push({ ref: entry.ref, type: entry.type, transformIds: entry.transforms.map((transform) => transform.id) });
  }

  return { dryRun: false, total: plan.length, pendingCount: pending.length, pending: pendingReport, applied };
}
