// `aof work` re-index engine — milestone 41 (work-item insertion & re-index),
// story 01 (`reindex-engine`, the shared foundation both insert command families
// depend on). Grounded in ARCHITECTURE.md ADR-001 (this module, dependency
// direction), ADR-003 (Tier-1 validate-green surface: folder/frontmatter
// `number`, `parent`, `depends`), ADR-004 (the count primitive), ADR-005 (the
// two number spaces), ADR-006 (PINNED signatures, descending rename order —
// supersedes the indicative shapes in ADR-001/004).
//
// Dependency direction (ADR-001, guarded by
// test/arch/acd-reindex-engine-blast-radius.test.mjs): this module IMPORTS
// work.mjs's readers; work.mjs NEVER imports this module back. That keeps the
// 36-module god-node's blast radius from growing — the renumber WRITER lives
// beside work.mjs, not inside it.
//
// Frontmatter writes are SURGICAL, mirroring `rollbackItemStatus` (work.mjs):
// every mutation matches the frontmatter block with a regex, replaces ONLY the
// target line via `.replace(/^(key:[ \t]*).*$/m, ...)`, and reassembles the
// record doc byte-for-byte around it. There is no `parseFrontmatter` +
// reserialize round-trip anywhere in this module (18/ADR-007) — `parseFrontmatter`
// is used ONLY to LOCATE which items carry a `depends`/`parent` reference that
// must change; the write is always the targeted line replacement.
import path from "node:path";
import { readFile, rename } from "node:fs/promises";
import { listItems, parseFrontmatter, recordDoc, ITEM_RE } from "./work.mjs";
import { writeText } from "./fs.mjs";

// Mirrors work.mjs's private `workError` (the command-error contract: `.code`/
// `.status`) — not exported there, so re-declared here rather than reached for
// across the module boundary ADR-001 draws.
function reindexError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

const VALID_SPACES = new Set(["top-level", "nested"]);

// Local `asList` mirror (work.mjs's own helper is not exported — a one-line
// helper, cheaper to mirror than to widen the ADR-001 import surface for).
const asList = (value) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]);

// The ONE selection primitive both `countShiftedByInsert` and
// `reindexForInsert` share (ADR-004's "one source of truth"): which items in
// the target number space have `number >= at`.
//
// - `space: "top-level"` — every item with no `parent` (milestone/uat/spike/
//   chore share this space; ADR-005).
// - `space: "nested"` — REQUIRES `parent` (the milestone number owning the
//   target `stories/` space); scoped to exactly that milestone's stories
//   (ADR-006). A nested call with no `parent` FAILS LOUD — never a silent
//   global story sweep.
function selectAffected(items, { at, space, parent }) {
  if (!VALID_SPACES.has(space)) {
    throw reindexError(`space must be "top-level" or "nested" (got "${space}")`, "reindex-invalid-space", 400);
  }
  const atNum = Number.parseInt(at, 10);
  if (space === "nested") {
    if (parent == null || parent === "") {
      throw reindexError(
        `nested re-index requires a "parent" milestone number selecting the target stories/ space`,
        "reindex-missing-parent",
        400,
      );
    }
    const parentNum = Number.parseInt(parent, 10);
    return items.filter(
      (item) =>
        item.type === "story" &&
        item.parent != null &&
        Number.parseInt(item.parent, 10) === parentNum &&
        Number.parseInt(item.number, 10) >= atNum,
    );
  }
  // top-level — every item with no parent (milestone/uat/spike/chore); `parent`
  // is absent/ignored per ADR-006.
  return items.filter((item) => item.parent == null && Number.parseInt(item.number, 10) >= atNum);
}

// Surgical single-line replace WITHIN the frontmatter block — the shared shape
// `rollbackItemStatus` establishes. `transform(frontmatterText) -> frontmatterText`
// runs over ONLY the `---...---` interior; the fence markers and the body after
// the closing fence are reassembled byte-for-byte, untouched.
function replaceFrontmatterBlock(text, transform) {
  const block = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!block) return text;
  const rewritten = transform(block[2]);
  if (rewritten === block[2]) return text;
  return block[1] + rewritten + block[3] + text.slice(block[0].length);
}

// One `[a, b]`-style inline-list entry (or a bare scalar): strip leading/
// trailing whitespace and an optional quote pair to find the numeric value: if
// it matches a shifted number, rewrite it to the new number, preserving the
// entry's own leading/trailing spacing, quoting, and zero-pad width (a value
// written with a leading zero — `"02"` — stays zero-padded at its ORIGINAL
// width; an unpadded value stays unpadded) — ADR-006's "preserve the inline-list
// format exactly" bound, applied per-entry (a partial-rewrite, never a whole-list
// replace).
function rewriteToken(token, shiftMap) {
  const leading = (token.match(/^\s*/) ?? [""])[0];
  const trailing = (token.match(/\s*$/) ?? [""])[0];
  const core = token.slice(leading.length, token.length - trailing.length);
  const quoted = core.match(/^(["'])([\s\S]*)\1$/);
  const quote = quoted ? quoted[1] : "";
  const raw = quoted ? quoted[2] : core;
  const num = Number.parseInt(raw, 10);
  if (!Number.isFinite(num) || !shiftMap.has(num)) return { text: token, changed: false };
  const newNum = shiftMap.get(num);
  const padded = /^0\d/.test(raw) ? String(newNum).padStart(raw.length, "0") : String(newNum);
  const newCore = quote ? `${quote}${padded}${quote}` : padded;
  return { text: `${leading}${newCore}${trailing}`, changed: true };
}

// Bump the `number:` line to the new (zero-padded) folder number — the ONE
// mandatory rewrite every shifted item's record doc receives.
function applyNumberBump(text, newNumStr) {
  return replaceFrontmatterBlock(text, (fm) => fm.replace(/^(number:[ \t]*).*$/m, `$1${newNumStr}`));
}

// Rewrite ONLY the `depends: [a, b]` entries that point at a shifted item —
// entries that don't are left byte-identical (ADR-003 Tier 1 / feature 01's
// "partial-rewrite" scenario).
function applyDependsRewrite(text, shiftMap) {
  return replaceFrontmatterBlock(text, (fm) =>
    fm.replace(/^(depends:[ \t]*\[)([^\]]*)(\].*)$/m, (whole, prefix, inner, suffix) => {
      let changed = false;
      const newParts = inner.split(",").map((part) => {
        const res = rewriteToken(part, shiftMap);
        if (res.changed) changed = true;
        return res.text;
      });
      return changed ? `${prefix}${newParts.join(",")}${suffix}` : whole;
    }),
  );
}

// Rewrite the `parent:` scalar when the nested story's owning milestone
// shifted — untouched when it didn't (ADR-005's nested-axis carve-out has no
// analogue here; this is the TOP-LEVEL axis's consequence on a nested story).
function applyParentRewrite(text, shiftMap) {
  return replaceFrontmatterBlock(text, (fm) =>
    fm.replace(/^(parent:[ \t]*)(.*)$/m, (whole, prefix, rest) => {
      const res = rewriteToken(rest, shiftMap);
      return res.changed ? `${prefix}${res.text}` : whole;
    }),
  );
}

// The Tier 1 reference-rewrite pass (ADR-003), run ONLY for a top-level
// slot-open (ADR-005: the nested axis touches no depends/parent — its owning
// milestone did not move). `shiftMap` is `oldNumber -> newNumber` for exactly
// the items THIS call shifted. Re-lists the (now-renamed) stream fresh so every
// item's CURRENT dir is read; `parseFrontmatter` LOCATES which items carry a
// reference that must change (a pure read), the actual write is always the
// surgical line replacement above — never a parseFrontmatter round-trip
// (18/ADR-007).
async function rewriteReferences(workDir, shiftMap) {
  const items = await listItems(workDir);
  for (const item of items) {
    const doc = recordDoc(item);
    if (!doc) continue;
    const docPath = path.join(item.dir, doc);
    let text;
    try {
      text = await readFile(docPath, "utf8");
    } catch {
      continue;
    }
    const meta = parseFrontmatter(text);
    let updated = text;

    // Discriminate on `item.parent == null` — the exact field `listItems`
    // sets, and the domain rule itself (ADR-005/ADR-006: nested items carry a
    // `parent`, top-level drivers don't) — rather than `item.type === "story"`,
    // which would mis-route a STANDALONE story (type "story", no `parent`,
    // per the story template's own "OMIT when standalone" line) into the
    // parent-rewrite branch instead of the depends branch.
    if (item.parent != null) {
      // A nested story: its `parent` needs rewriting iff the milestone it
      // names (its CURRENT stored value, possibly stale) is one that shifted.
      const parentNum = Number.parseInt(meta.parent, 10);
      if (Number.isFinite(parentNum) && shiftMap.has(parentNum)) {
        updated = applyParentRewrite(text, shiftMap);
      }
    } else {
      // A top-level driver (or a standalone story): rewrite any `depends`
      // entry pointing at a shifted driver.
      const deps = asList(meta.depends);
      const needsRewrite = deps.some((dep) => shiftMap.has(Number.parseInt(dep, 10)));
      if (needsRewrite) {
        updated = applyDependsRewrite(text, shiftMap);
      }
    }

    if (updated !== text) await writeText(docPath, updated);
  }
}

// countShiftedByInsert(workDir, { at, space, parent }) — ADR-004's pure count
// primitive: how many items in the target space have `number >= at`. Reads no
// config, prompts nothing, mutates nothing (a pure projection over
// `listItems`). `reindexForInsert` reuses this exact selection (`selectAffected`)
// so the count a caller is warned about is always the count that actually
// shifts.
export async function countShiftedByInsert(workDir, { at, space, parent } = {}) {
  const items = await listItems(workDir);
  return selectAffected(items, { at, space, parent }).length;
}

// refsTouchedByInsert(workDir, { at, space, parent }) — every ref this insert would
// TOUCH, as refs rather than a count (milestone 43 / ADR-003). The control-side
// mutation guard has to know what an insert would disturb BEFORE it disturbs it, and
// it must read the identical selection the count and the engine use — a second
// derivation of "which items move" is exactly how a guard and the mutation it guards
// come to disagree.
//
// It is a superset of the SHIFTED set by exactly one member: on the nested axis the
// owning milestone itself is touched (its stories set changes, its checklist is
// rewritten) even when no sibling shifts, so an insert into a HELD milestone is
// refused whether or not it renumbers anything. Pure: reads no config, mutates nothing.
export async function refsTouchedByInsert(workDir, { at, space, parent } = {}) {
  const items = await listItems(workDir);
  const refs = selectAffected(items, { at, space, parent }).map((item) => item.ref);
  if (space === "nested") {
    const parentNum = Number.parseInt(parent, 10);
    const owner = items.find((item) => item.parent == null && Number.parseInt(item.number, 10) === parentNum);
    if (owner) refs.push(owner.ref);
  }
  return refs;
}

// buildRefRemap(items, { shiftMap, space, parent }) — the OLD → NEW ref list for
// the refs this reindex is about to change (m42 wave (d) leg d4, port 3). Computed
// from the PRE-rename item list, because after the renames the old refs no longer
// exist anywhere to be derived from.
//
// A ref is the join key of six stores that the rename tells nothing (run records,
// the Notion sidecar, the streamed doc/run projections, assignment rows, item
// branches) — so the `stream.reindexed` event has to carry the map itself rather
// than a ping that makes every reactor re-derive it from state that has already
// moved.
//
//   top-level: every shifted driver `NN` -> `NN+1`, PLUS the CASCADE — every story
//              under a shifted milestone (`NN/SS` -> `(NN+1)/SS`), whose ref
//              changes even though its own folder never moved.
//   nested:    every shifted story `NN/SS` -> `NN/(SS+1)` (its milestone did not
//              move — ADR-005's carve-out).
//
// Ordered DESCENDING by the number that changed, so a consumer applying the list
// in order never writes onto a ref another entry has yet to vacate — the same
// collision rule the folder renames obey (ADR-006).
export function buildRefRemap(items, { shiftMap, space, parent } = {}) {
  const padTo = (num, width) => String(num).padStart(width, "0");
  const remap = [];

  if (space === "nested") {
    const parentNum = Number.parseInt(parent, 10);
    for (const item of items) {
      if (item.parent == null) continue;
      if (Number.parseInt(item.parent, 10) !== parentNum) continue;
      const oldNum = Number.parseInt(item.number, 10);
      if (!shiftMap.has(oldNum)) continue;
      const newNumStr = padTo(shiftMap.get(oldNum), item.number.length);
      remap.push({ from: item.ref, to: `${item.parent}/${newNumStr}`, order: oldNum });
    }
  } else {
    for (const item of items) {
      if (item.parent == null) {
        const oldNum = Number.parseInt(item.number, 10);
        if (!shiftMap.has(oldNum)) continue;
        const newNumStr = padTo(shiftMap.get(oldNum), item.number.length);
        remap.push({ from: item.ref, to: newNumStr, order: oldNum });
        continue;
      }
      // The CASCADE: a story's ref is `<milestone>/<own>`, so it changes when its
      // MILESTONE shifts even though the story's own number never does.
      const parentNum = Number.parseInt(item.parent, 10);
      if (!shiftMap.has(parentNum)) continue;
      const newParentStr = padTo(shiftMap.get(parentNum), item.parent.length);
      remap.push({ from: item.ref, to: `${newParentStr}/${item.number}`, order: parentNum });
    }
  }

  remap.sort((a, b) => b.order - a.order);
  return remap.map(({ from, to }) => ({ from, to }));
}

// reindexForInsert(workDir, { at, space, parent }) — opens a slot at `at` in
// the target number space (ADR-006 pinned signature):
//   1. selects every item with `number >= at` in the space (the SAME
//      `selectAffected` the count primitive uses);
//   2. renames their folders DESCENDING (highest number first — ADR-006:
//      ascending collides, forbidden on every filesystem and fatal on
//      Windows), bumping each item's frontmatter `number` to match;
//   3. for `space === "top-level"` ONLY, rewrites every stored `depends`/
//      nested-story `parent` value that pointed at a shifted item to its new
//      number (ADR-003 Tier 1; ADR-005 — the nested axis touches neither).
// Returns `{ shifted, at, space, parent, remap }` — `shifted` is the exact count
// of items renamed (== `countShiftedByInsert`'s answer for the same input), and
// `remap` (ADDITIVE, m42 wave (d) leg d4 port 3) is the OLD → NEW ref list this
// call changed, computed BEFORE the renames because the old refs stop existing
// once they land. It is the evidence `stream.reindexed` carries so the stores
// keyed by ref can converge; the engine itself still tells no store anything.
export async function reindexForInsert(workDir, { at, space, parent } = {}) {
  const items = await listItems(workDir);
  const affected = selectAffected(items, { at, space, parent });

  // Descending numeric order (ADR-006) — highest original number first, so
  // every target slot is vacated before the next item moves into it.
  const ordered = [...affected].sort((a, b) => Number.parseInt(b.number, 10) - Number.parseInt(a.number, 10));

  // oldNumber -> newNumber, fixed BEFORE any rename (every shifted item moves
  // up by exactly one) — the map the reference-rewrite pass reads.
  const shiftMap = new Map();
  for (const item of ordered) {
    const oldNum = Number.parseInt(item.number, 10);
    shiftMap.set(oldNum, oldNum + 1);
  }

  // The ref remap, computed while the OLD refs still exist (see buildRefRemap).
  const remap = buildRefRemap(items, { shiftMap, space, parent });

  for (const item of ordered) {
    const oldNum = Number.parseInt(item.number, 10);
    const newNum = oldNum + 1;
    // Preserve the stream's existing zero-pad width (the item's own folder
    // number string length — every sibling in a valid stream shares it).
    const width = item.number.length;
    const newNumStr = String(newNum).padStart(width, "0");
    const newName = `${newNumStr}_${item.type}_${item.slug}`;
    if (!ITEM_RE.test(newName)) {
      throw reindexError(`computed folder name "${newName}" is not a valid work-item folder name`, "reindex-invalid-folder-name", 500);
    }

    // Fail-loud guard (review fix): compute — and VALIDATE — the mandatory
    // `number:` bump BEFORE this item's folder is renamed. Every valid record
    // doc carries a `---...---` frontmatter block with a `number:` line (the
    // happy path always sees `bumped !== text`); a doc that doesn't (no
    // resolvable fence, or no `number:` line) would otherwise have its folder
    // renamed anyway while its frontmatter stays stale at the OLD number — a
    // silent folder<->frontmatter mismatch with no error. Read from the OLD
    // (pre-rename) dir so the check runs before any mutation for this item.
    const doc = recordDoc(item);
    let bumped = null;
    if (doc) {
      const oldDocPath = path.join(item.dir, doc);
      const text = await readFile(oldDocPath, "utf8");
      bumped = applyNumberBump(text, newNumStr);
      if (bumped === text) {
        throw reindexError(
          `"${oldDocPath}" has no resolvable "number:" line inside a "---" frontmatter block — refusing to rename its folder and leave a silent folder≠frontmatter number mismatch`,
          "reindex-number-bump-failed",
          500,
        );
      }
    }

    const newDir = path.join(path.dirname(item.dir), newName);
    await rename(item.dir, newDir);

    if (doc) {
      const newDocPath = path.join(newDir, doc);
      await writeText(newDocPath, bumped);
    }
  }

  if (space === "top-level" && shiftMap.size > 0) {
    await rewriteReferences(workDir, shiftMap);
  }

  return { shifted: ordered.length, at, space, parent: parent ?? null, remap };
}
