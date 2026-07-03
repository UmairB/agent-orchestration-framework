// src/mesh-issuance.mjs — the ISSUANCE DIRECTIVE substrate (milestone 27 / stories
// 00 + 01, ADR-001 / ADR-002 / ADR-003): the six-key directive assembly, the
// absence-tolerant / torn-file-skipping union read across every issuer partition,
// the pure eligibility / targeting matcher, and the own-path directive WRITES
// (issueDirective / withdrawDirective — story 01, ADR-001.3). GIT-PURE by
// construction — the same shape src/mesh-lease.mjs rides: no config, no clock
// inside the assembler, no relay/cache import; every write joins the reserved
// issuanceDirectivePath seam via the atomic writeText temp+rename discipline
// (19/R2), own-issuer-partition only.
//
// THE PER-ISSUER PARTITION (ADR-001.1, the 22/ADR-002 invariant held STRICTLY):
// each issuer owns its own `.mesh/issuance/<issuer>/` subtree — two nodes never
// write one path, so a directive merge over git is add-only, never a three-way
// content conflict, even when two issuers both issue the SAME item (two files at
// two distinct paths, both survive — the reader below unions them, it never
// resolves a "winner").
//
// THE FROZEN SIX-KEY SCHEMA (ADR-001.2, top-level keys, in this order):
//   { itemRef, issuer, target, state, issuedAt, aofVersion }
// `target` is a discriminated union: { kind:"any" } | { kind:"node", nodeId } |
// { kind:"capability", value } — never a bare string that conflates a node id
// with a capability value. `state` is one of "issued" | "withdrawn" | "fulfilled"
// (ADR-001.3). `issuedAt` is ISO-8601 UTC-Z provenance ONLY — never a clock or
// arbitration key (no expiry key: a directive does not lapse on a clock, unlike a
// presence-tied lease).
//
// THE LIFECYCLE WRITES (ADR-001.3, story 01 — the 26/ADR-003.2 release idiom,
// NEVER a delete): `issueDirective` is the DURABLE own-path mint (atomic writeText
// at issuanceDirectivePath); `withdrawDirective` re-reads THIS node's own directive
// and writes it back with state "withdrawn" — an own-path STATE FLIP, never an
// unlink/rm. Both are the command's ORCHESTRATES-the-seam-WRITES split (20/ADR-005)
// — `commands/mesh-issue.mjs` calls into these, it never joins the path itself.
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { meshDir, issuanceDirectivePath } from "./mesh-store.mjs";
// 19/R2 / 20/ADR-007 — every directive write routes through the atomic temp+rename
// seam (the Windows renameWithRetry is load-bearing on this platform). Never a bare
// writeFile.
import { writeText } from "./fs.mjs";

// ------------------------------------------------- the directive assembly ----

// Assemble a directive record — the FROZEN six-key schema, EXACTLY these keys in
// this order (ADR-001.2 / the assembleClaimRecord idiom, src/mesh-lease.mjs:56):
// a bare object-literal return, zero fs/config/network. `issuedAt` is a REQUIRED
// caller-supplied instant stamped VERBATIM — no `new Date()` fallback inside the
// assembler (unlike assembleDescriptor's `now ?? new Date().toISOString()`); a
// wall-clock default is the CALLER's concern (story 01's mesh:issue command).
export function assembleDirective({ itemRef, issuer, target, state = "issued", issuedAt, aofVersion }) {
  return {
    itemRef,
    issuer,
    target,
    state,
    issuedAt,
    aofVersion,
  };
}

// ------------------------------------------------------- the directive writes ----

// issueDirective(workspace, ownNodeId, itemRef, directive) — the DURABLE own-path
// mint (ADR-001.3 / ADR-002.2): an atomic writeText at
// issuanceDirectivePath(workspace, ownNodeId, itemRef) — the reserved seam
// story 00 named, story 01 joins. The written path is ALWAYS built with THIS
// node's OWN issuer id (the second argument is the writer's own nodeId, never a
// foreign issuer) — own-partition writes only (fitness #1). The caller (`mesh:
// issue`) assembles the directive via `assembleDirective` and hands it here whole;
// this seam performs no assembly of its own (the command orchestrates, the seam
// writes — 20/ADR-005). Returns the written record.
export async function issueDirective(workspace, ownNodeId, itemRef, directive) {
  await writeText(issuanceDirectivePath(workspace, ownNodeId, itemRef), JSON.stringify(directive, null, 2));
  return directive;
}

// withdrawDirective(workspace, ownNodeId, itemRef) — the own-path STATE FLIP to
// "withdrawn" (ADR-001.3, the 26/ADR-003.2 release idiom): re-reads THIS node's
// OWN directive at issuanceDirectivePath and writes it back with state
// "withdrawn" — NEVER a delete/unlink. The remaining five keys (itemRef, issuer,
// target, issuedAt, aofVersion) are carried through byte-unchanged; only `state`
// moves. Idempotent-safe on an already-withdrawn directive (re-writes the same
// state, a no-op flip) and absence-tolerant on a never-issued one (no file is
// fabricated — returns null, nothing written). Own-path only: it reads/writes
// ONLY this node's own partition file, never a peer's.
export async function withdrawDirective(workspace, ownNodeId, itemRef) {
  let current;
  try {
    const parsed = JSON.parse(await readFile(issuanceDirectivePath(workspace, ownNodeId, itemRef), "utf8"));
    current = parsed != null && typeof parsed === "object" ? parsed : null;
  } catch {
    current = null;
  }
  if (current == null) return null;
  const withdrawn = { ...current, state: "withdrawn" };
  await writeText(issuanceDirectivePath(workspace, ownNodeId, itemRef), JSON.stringify(withdrawn, null, 2));
  return withdrawn;
}

// ------------------------------------------------- the absence-tolerant read ----

// Read every issuer's directives across EVERY partition under issuance/ (the
// readLeaseClaims walk one level deeper, src/mesh-lease.mjs:86-120): absence (no
// issuance/ dir) reads as [] — never an error; a torn/unparseable file is skipped
// rather than blinding the healthy directives; a non-.json entry is ignored. The
// reader is a FLAT UNION across every issuer partition — itemRef is always read
// from the RECORD, never re-derived from the flatLeaf'd directory/file name. A
// read mutates nothing.
export async function readIssuanceDirectives(workspace) {
  const root = path.join(meshDir(workspace), "issuance");
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const directives = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    directives.push(...await readIssuerDir(path.join(root, entry.name)));
  }
  return directives;
}

async function readIssuerDir(dir) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const directives = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      if (parsed != null && typeof parsed === "object") directives.push(parsed);
    } catch {
      continue;
    }
  }
  return directives;
}

// ------------------------------------------------- the targeting matcher ----

// Coerce a possibly-absent/non-array descriptor field to an array (the
// assembleDescriptor field-coercion idiom, src/node-identity.mjs:140-141) — an
// inline helper, not a separate module, so there is nothing further to certify
// pure.
const coerce = (x) => (Array.isArray(x) ? x : []);

// nodeSatisfiesTarget(descriptor, target) — the PURE total predicate (ADR-003): a
// two-plain-data-argument function (the resolveArbitration / claimLiveness shape,
// src/mesh-lease.mjs:147,162), reading ONLY the frozen 22/ADR-003 descriptor
// fields (nodeId / runtimes / skills) AS DATA. Imports NOTHING from
// src/node-identity.mjs — no re-derivation, no re-assembly.
//   - "any"        ⇒ true for every descriptor (the fleet-wide offer);
//   - "node"       ⇒ descriptor?.nodeId === target.nodeId (exact match; a missing
//                    target.nodeId can never equal a real descriptor.nodeId ⇒ false);
//   - "capability" ⇒ target.value is a member of runtimes[] OR skills[] (absent /
//                    non-array fields coerce to [] — a bare install never crashes,
//                    it just never capability-matches); a missing target.value can
//                    never be a member ⇒ false;
//   - any other / missing / malformed kind (including target == null) ⇒ false —
//     fail-safe: an unroutable directive offers to nobody, never to everybody.
export function nodeSatisfiesTarget(descriptor, target) {
  const kind = target?.kind;
  if (kind === "any") return true;
  if (kind === "node") return descriptor?.nodeId === target.nodeId;
  if (kind === "capability") {
    return coerce(descriptor?.runtimes).includes(target.value) || coerce(descriptor?.skills).includes(target.value);
  }
  return false;
}
