// src/work-artifacts.mjs — THE artifact set (milestone 43 / ADR-007).
//
// The set a worker STREAMS for its active worktree and the set a face may REQUEST
// by name are the same set, and this module is its one home. That invariant is not
// new — it is what `WORK_ITEM_DOC_FILES`' own comment claimed in
// `global-work-store.mjs` — but the widening (`tasks/*.feature`, ARCHITECTURE.md,
// DESIGN.md, RESEARCH.md, STATE.md) is exactly the moment a second literal list gets
// written by accident, so the constant moves here and `WORK_ITEM_DOC_FILES` becomes a
// DERIVED compatibility view over it. (`acd-work-artifact-set-single-home`.)
//
// TWO KINDS, AND NO THIRD:
//   { name, file }      an exact filename, requested by NAME.
//   { name, dir, ext }  a bounded directory + extension, requested by NAME + MEMBER.
// A glob/regex language is REJECTED (ADR-007): `work:doc`'s input contract is a name,
// so "what can I ask for" has to stay answerable. A pattern language is precisely how
// the streamed set and the requestable set would drift apart.
//
// A PURE LEAF (0 repo imports, `node:crypto` only). Its three consumers — the
// worker's content read, `commands/doc.mjs` and the drain — must not travel through
// `global-work-store.mjs`'s import closure to read a constant table. Separator
// handling is hand-rolled rather than `node:path`'s because a path spelled on a
// Windows node has to normalise identically when this module runs on Linux (the
// drain de-duplicates `/` against `\`, task 01), and posix `path` does not split on
// a backslash at all.
import { createHash } from "node:crypto";

// THE MANIFEST. Order is the streaming/enumeration order.
export const WORK_ITEM_ARTIFACTS = Object.freeze([
  Object.freeze({ name: "SPEC", file: "SPEC.md" }),
  Object.freeze({ name: "STORY", file: "STORY.md" }),
  Object.freeze({ name: "VERIFICATION", file: "VERIFICATION.md" }),
  Object.freeze({ name: "RETROSPECTIVE", file: "RETROSPECTIVE.md" }),
  Object.freeze({ name: "ARCHITECTURE", file: "ARCHITECTURE.md" }),
  Object.freeze({ name: "DESIGN", file: "DESIGN.md" }),
  Object.freeze({ name: "RESEARCH", file: "RESEARCH.md" }),
  Object.freeze({ name: "STATE", file: "STATE.md" }),
  Object.freeze({ name: "TASKS", dir: "tasks", ext: ".feature" }),
]);

// The DERIVED compatibility view (ADR-007): `{ NAME: "FILE.md" }` over the
// `file`-kind entries only, so every existing importer of `WORK_ITEM_DOC_FILES`
// keeps working byte-identically. One definition, one derived view — never two
// literal lists. It is re-exported from `global-work-store.mjs` for the callers
// that already import it from there.
export const WORK_ITEM_DOC_FILES = Object.freeze(Object.fromEntries(
  WORK_ITEM_ARTIFACTS.filter((entry) => entry.file != null).map((entry) => [entry.name, entry.file]),
));

const BY_NAME = new Map(WORK_ITEM_ARTIFACTS.map((entry) => [entry.name, entry]));

// normalizeArtifactPath(value) — `\` → `/`, collapsed repeats, no trailing slash.
// The ONE spelling rule: a path a Windows agent reported and the same path a WSL
// agent reported must de-duplicate to one key (task 01). Case is NOT folded — two
// paths differing only in case are different files on Linux, and a de-duplication
// that decided otherwise would drop one of them.
export function normalizeArtifactPath(value) {
  if (typeof value !== "string") return null;
  const slashed = value.replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  const trimmed = slashed.length > 1 ? slashed.replace(/\/+$/, "") : slashed;
  return trimmed.length > 0 ? trimmed : null;
}

// artifactForRelativePath(relPath) — the manifest membership test, stated over a
// path RELATIVE to an item's own directory. Returns the artifact key
// (`{ name, member }`, `member` null for a file-kind entry) or null when the path
// is outside the set. `notes.md`, `00_a.feature.bak`, `.keep`, `nested/deep.feature`
// and `00_A.FEATURE` are all outside it — the directory entry is bounded by ONE
// extension and is ONE directory, never a walk.
export function artifactForRelativePath(relPath) {
  const normalized = normalizeArtifactPath(relPath);
  if (normalized == null || normalized.startsWith("../")) return null;
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 1) {
    const entry = WORK_ITEM_ARTIFACTS.find((candidate) => candidate.file === segments[0]);
    return entry == null ? null : { name: entry.name, member: null };
  }
  if (segments.length === 2) {
    const entry = WORK_ITEM_ARTIFACTS.find((candidate) => candidate.dir === segments[0]);
    if (entry == null) return null;
    return isArtifactMember(entry, segments[1]) ? { name: entry.name, member: segments[1] } : null;
  }
  return null;
}

// isArtifactMember(entry, member) — a legal member of a `dir`-kind entry: one
// bounded directory entry (no separator, no traversal, no dotfile) whose name ends
// in the entry's exact extension. The extension test is case-SENSITIVE by choice:
// `00_A.FEATURE` is a different file on a case-sensitive filesystem, and a set whose
// membership depended on the host's case-folding would answer differently per node.
export function isArtifactMember(entry, member) {
  if (entry?.dir == null || typeof member !== "string" || member.length === 0) return false;
  if (member.includes("/") || member.includes("\\")) return false;
  if (member === "." || member === ".." || member.startsWith(".")) return false;
  return member.endsWith(entry.ext) && member.length > entry.ext.length;
}

// artifactEntry(name) — the manifest entry for an UPPERCASE name, or null.
export function artifactEntry(name) {
  return BY_NAME.get(String(name ?? "").trim().toUpperCase()) ?? null;
}

// resolveArtifactRequest(name, member) — the ONE input contract for a by-name
// request (`work:doc`'s `{ ref, doc, member? }`, ADR-010/R3.D). Returns
// `{ ok: true, name, member, relPath, docKey }` or `{ ok: false, code, message }`
// with a CODED refusal — never a silent empty answer:
//   invalid-doc         the name is in no manifest entry
//   invalid-doc-member  the name is in the manifest but the member is out of contract
//                       (traversal, nested, absent on a dir entry, present on a file entry)
export function resolveArtifactRequest(name, member) {
  const requested = String(name ?? "").trim().toUpperCase();
  const entry = BY_NAME.get(requested);
  if (entry == null) {
    return { ok: false, code: "invalid-doc", message: `Unknown document "${name ?? ""}".` };
  }
  const hasMember = typeof member === "string" && member.length > 0;
  if (entry.file != null) {
    if (hasMember) {
      return {
        ok: false,
        code: "invalid-doc-member",
        message: `Document "${entry.name}" is an exact file and takes no member.`,
      };
    }
    return { ok: true, name: entry.name, member: null, relPath: entry.file, docKey: entry.name };
  }
  if (!hasMember) {
    return {
      ok: false,
      code: "invalid-doc-member",
      message: `Document "${entry.name}" is a directory entry and is requested by name plus member (e.g. "00_a${entry.ext}").`,
    };
  }
  if (!isArtifactMember(entry, member)) {
    return {
      ok: false,
      code: "invalid-doc-member",
      message: `"${member}" is not a member of "${entry.name}" — a member is one bounded ${entry.dir}/ entry ending in ${entry.ext}.`,
    };
  }
  return {
    ok: true,
    name: entry.name,
    member,
    relPath: `${entry.dir}/${member}`,
    docKey: `${entry.name}/${member}`,
  };
}

// canonicalArtifactDocKey(doc) — the ONE spelling of a `work_item_docs.doc` key,
// shared by the writer and the reader so a streamed body and a requested body can
// never miss each other. A file-kind key is UPPERCASE (today's contract, unchanged);
// a dir-kind key is `NAME/member` with the MEMBER VERBATIM — uppercasing it would
// destroy the filename the face has to render and would fold `a.feature` onto
// `A.FEATURE`, which the manifest deliberately treats as different files.
export function canonicalArtifactDocKey(doc) {
  const raw = String(doc ?? "").trim();
  const cut = raw.indexOf("/");
  if (cut < 0) return raw.toUpperCase();
  return `${raw.slice(0, cut).toUpperCase()}${raw.slice(cut)}`;
}

// artifactDocKeyMember(docKey) — the member half of a dir-kind key, or null.
export function artifactDocKeyMember(docKey) {
  const raw = String(docKey ?? "");
  const cut = raw.indexOf("/");
  return cut < 0 ? null : raw.slice(cut + 1);
}

// hashArtifactBody(body) — the per-artifact CONTENT hash (ADR-007/AC8). Over the
// bytes, never over mtime: a touched-but-unchanged file (a checkout, an archive
// extraction, an edit reverted exactly) must not cost a wire body.
export function hashArtifactBody(body) {
  return createHash("sha256").update(String(body ?? ""), "utf8").digest("hex");
}
