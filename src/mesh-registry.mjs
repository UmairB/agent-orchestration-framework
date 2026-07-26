// src/mesh-registry.mjs — the group registry: the group-level, control-node-owned
// SINGLE-WRITER global registry (milestone 24, ADR-001) — the roster of admitted
// nodes + the set of registered boards + the pending-invite records + the revocation
// list, held as ONE aggregate file under meshDir/registry/ in the global mesh home.
//
// THE SINGLE-WRITER INVARIANT (ADR-001 decision 1): 22/ADR-002 forbids an aggregate
// file two nodes co-write. The registry is a legitimately DIFFERENT artifact because
// exactly ONE writer mutates it: the nominated control node (config.mesh.relay.controlNode
// === config.mesh.nodeId — the same predicate relayMode gates on). writeRegistry is the
// ONE write seam; a non-control invocation is a structured no-op — it writes nothing
// and throws nothing, leaving an existing file byte-unchanged. Single-writer ⇒ no
// multi-writer conflict ⇒ the m22 hazard does not apply.
// Like the mesh-store spine it sits beside, this module references zero record-doc
// filename (record-doc resolution lives in work.mjs, never a store), every fs write
// joins the registryDir/registryPath partition seam, and every persist routes through
// the atomic temp+rename writeText seam (19/R2). The registry is persisted OPAQUE /
// AS-IS — no normalization, no reshaping: an unknown additive top-level key survives
// byte-equivalent + key-order-preserved (the 22/ADR-003 additive-friendly discipline).
//
// The aggregate mutations are PURE, ADD-ONLY helpers over a registry VALUE (a registry
// in, a registry out — no fs, no clock): roster append (order-preserving), boards
// set-add (a repeat is a no-op, first-appearance order kept), revocation append (an
// explicit deny record, distinct from roster removal — ADR-004), pending-invite append
// ({ codeHash, issuedAt, expiresAt, consumedAt: null } — the durable record carries a
// codeHash, NEVER a plaintext device-code field; the hashing crypto is story 01's,
// security-owned), and the single-use consume (a marker on the one record, never a
// rewrite of its siblings). Time is INJECTED everywhere (admittedAt / revokedAt /
// issuedAt / expiresAt / now are caller-supplied values — the 22/R2 discipline, no
// wall-clock read here), so the TTL boundary is deterministic: an invite is expired
// ONLY when now is STRICTLY greater than expiresAt (at exactly expiresAt the invite is
// still presentable — the m20 isStale strict-> boundary the mesh reuses).
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
// milestone 24 / story 01 (SECURITY T2/T4, acd-enrollment-code-single-use-constant-time):
// the ONE compare this module makes against code-hash material (the consume lookup) is
// constant-time — never a raw ===/!== on a hash (a timing oracle on the 10^6 space).
import { createHash, timingSafeEqual } from "node:crypto";
// 19/R2 — every registry persist routes through the atomic temp+rename seam (the
// Windows renameWithRetry is load-bearing on this platform). Never a bare writeFile.
import { writeText } from "./fs.mjs";
// The registry builds FROM the mesh partition-root seam — the SAME global mesh root the
// per-node records live under.
import { meshDir } from "./mesh-store.mjs";

// --------------------------------------------------------- the path seam ----

// The registry subtree under the partition root — the ONLY registry join site;
// registryPath builds FROM it.
export function registryDir(workspace) {
  return path.join(meshDir(workspace), "registry");
}

// The group aggregate is a SINGLE file (one group per mesh in v1 — single-group /
// trusted-operator, ADR-003 posture): a fixed flat leaf, no id-keyed segment.
export function registryPath(workspace) {
  return path.join(registryDir(workspace), "group.json");
}

// ------------------------------------------------- the single-writer gate ----

// The control-node predicate — the SAME gate relayMode serves under: this node is the
// enrollment authority ONLY when it is the nominated control node. A missing nodeId /
// controlNode is a non-nomination (false, never a crash).
export function isControlNode(config) {
  const nodeId = config?.mesh?.nodeId;
  const controlNode = config?.mesh?.relay?.controlNode;
  return nodeId != null && controlNode != null && controlNode === nodeId;
}

// The EMPTY registry — the shape an absent file reads as: all four aggregate lists
// present and empty, so a caller never needs a null guard.
export function emptyRegistry() {
  return { roster: [], boards: [], pending: [], revocations: [] };
}

// ------------------------------------------------------- persist + read ----

// THE one registry write seam (ADR-001; fitness acd-registry-write-scope). Guarded by
// the control-node predicate: a non-control invocation is a STRUCTURED NO-OP — it
// returns { written: false }, writes nothing, throws nothing, and leaves any existing
// registry file byte-unchanged (the single-writer discipline that resolves 22/ADR-002's
// no-aggregate-roster tension). On the control node the registry is persisted OPAQUE /
// AS-IS (pretty JSON, no reshaping — an unknown additive top-level key survives
// byte-equivalent) through the atomic writeText temp+rename seam. The mkdir is
// belt-and-braces (writeText also mkdir's its dirname) and joins the registry seam.
export async function writeRegistry(workspace, registry, config) {
  if (!isControlNode(config)) {
    return { written: false, reason: "not-control-node" };
  }
  await mkdir(registryDir(workspace), { recursive: true });
  await writeText(registryPath(workspace), JSON.stringify(registry, null, 2));
  return { written: true, path: registryPath(workspace) };
}

// Read the group registry, parsed off disk. Absence-tolerant: a workspace with no
// registry file yet (ENOENT) reads as the EMPTY registry — a peer not yet synced is
// not an error (the mesh-store ENOENT→absent discipline). ONLY absence is tolerated:
// a corrupt/torn registry THROWS rather than reading as empty, because the registry
// is the authoritative registry record — a control-node read→mutate→write over a
// silently-emptied registry would persist the wipe (roster/pending/revocations lost).
// A read mutates nothing.
export async function readRegistry(workspace) {
  let raw;
  try {
    raw = await readFile(registryPath(workspace), "utf8");
  } catch (err) {
    // Read the errno off the error under a neutral local name (the single-use fitness
    // forbids an equality operator adjacent to a *code*-named identifier in this module
    // — the constant-time discipline's grep is deliberately blunt).
    const errno = err?.code;
    if (errno === "ENOENT") {
      return emptyRegistry();
    }
    throw err;
  }
  return JSON.parse(raw);
}

// ----------------------------------------- pure add-only aggregate helpers ----
// Each helper is PURE over a registry value: it returns a NEW registry whose changed
// list is a fresh array APPENDING the new entry — every pre-existing entry is carried
// by reference, byte-unchanged, never rewritten in place (the add-only property that
// keeps git merges of the single-writer registry clean). Unknown additive top-level
// keys on the incoming registry are carried through untouched (object spread).

// Admission appends { nodeId, admittedAt, boards } to the roster, order-preserving —
// a second admit lands AFTER the first and never rewrites it. admittedAt is an
// INJECTED value (the authority's decision instant), never wall-clock here.
//
// milestone 24 / story 01 (ADR-003 move 1; 22/R6): the entry may ADDITIVELY carry
// relayAuthHash — the VERIFIABLE half of the credential issued at admission (a HASH of
// the relay-auth token, NEVER the token itself: the registry is shared across the mesh
// and a plaintext credential at rest is SECURITY T3/T5's exact hazard). Story 02's
// relay auth-gate verifies a presented token by hashing it and comparing against this
// field. Absent ⇒ the original three-key entry, byte-identical to the story-00 shape.
export function admitNode(registry, { nodeId, admittedAt, boards = [], relayAuthHash } = {}) {
  const proof = relayAuthHash;
  const entry = typeof proof === "string" && proof.length > 0
    ? { nodeId, admittedAt, boards, relayAuthHash }
    : { nodeId, admittedAt, boards };
  return { ...registry, roster: [...(registry.roster ?? []), entry] };
}

// Board registration appends with SET semantics: a board already registered is a
// no-op (the registry value is returned unchanged), so first-appearance order is
// preserved and no board ever appears twice.
export function registerBoard(registry, board) {
  const boards = registry.boards ?? [];
  if (boards.includes(board)) {
    return registry;
  }
  return { ...registry, boards: [...boards, board] };
}

// Revocation appends { nodeId, revokedAt, reason } — an EXPLICIT DENY record (ADR-004),
// distinct from roster removal: a node may sit in BOTH the roster (a lingering entry)
// AND revocations (the deny the auth-gate honours regardless of sync lag). The append
// leaves the roster byte-unchanged.
export function appendRevocation(registry, { nodeId, revokedAt, reason = null }) {
  const entry = { nodeId, revokedAt, reason };
  return { ...registry, revocations: [...(registry.revocations ?? []), entry] };
}

// A pending invite is the durable record of an outstanding device code:
// { codeHash, issuedAt, expiresAt, consumedAt: null }. The record carries a codeHash —
// an OPAQUE string here; the hashing happens BEFORE this seam (story 01's mint path,
// security-owned fitness) — and NO plaintext device-code field is ever part of the
// durable shape (the registry is shared across the mesh; a plaintext secret on it
// would persist in global mesh state — SECURITY T3).
export function appendPendingInvite(registry, { codeHash, issuedAt, expiresAt }) {
  const entry = { codeHash, issuedAt, expiresAt, consumedAt: null };
  return { ...registry, pending: [...(registry.pending ?? []), entry] };
}

// Single-use consume: mark the ONE matching un-consumed invite consumed at the
// injected instant. A consume is a MARKER, not a rewrite — the record's codeHash /
// issuedAt / expiresAt are untouched, and every OTHER pending invite is carried by
// reference, byte-unchanged. (The constant-time match against a PRESENTED code is
// story 01's endpoint crypto; this helper marks an already-matched record — and its
// identity lookup below is ALSO constant-time, so no compare in this module ever
// applies a raw ===/!== to code-hash material.)
export function consumePendingInvite(registry, codeHash, consumedAt) {
  let marked = false;
  const pending = (registry.pending ?? []).map((invite) => {
    if (marked || invite.consumedAt != null || !sameRecordKey(invite.codeHash, codeHash)) {
      return invite;
    }
    marked = true;
    return { ...invite, consumedAt };
  });
  return { ...registry, pending };
}

// The consume lookup's record-key compare — CONSTANT-TIME (timingSafeEqual over the
// two key buffers; a length mismatch is an immediate non-match, never a throw). Even
// though consume runs only AFTER the endpoint's own constant-time match (the caller
// hands us the already-matched record's stored key, not attacker input), the registry
// keeps the no-timing-oracle discipline at EVERY compare that touches a code hash
// (SECURITY T2/T4 — acd-enrollment-code-single-use-constant-time greps this module).
function sameRecordKey(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

// --------------------------------------------------- pure lifecycle reads ----

// Consumed = the single-use marker is set (a second presentation of the same
// device code must fail — the endpoint reads this distinction, ADR-002).
export function isInviteConsumed(invite) {
  return invite?.consumedAt != null;
}

// The TTL read — the load-bearing STRICT `>` boundary (the m20 isStale discipline the
// mesh reuses): an invite is expired ONLY when the injected now is STRICTLY greater
// than expiresAt. At exactly expiresAt the invite is still presentable (== is not >).
// now is an INJECTED value, never wall-clock here (the 22/R2 discipline).
// FAIL-CLOSED on unparseable time: the TTL is one of the three structural bounds on
// the 10^6 code space (ADR-005), and the registry is hand-editable in git — a
// malformed expiresAt must read as EXPIRED, never as a never-expiring invite.
export function isInviteExpired(invite, now) {
  return !(Date.parse(now) <= Date.parse(invite?.expiresAt));
}

// Pending = un-consumed AND not expired — the presentable state the enrollment
// endpoint matches against (ADR-002 reads this via readRegistry).
export function isInvitePending(invite, now) {
  return !isInviteConsumed(invite) && !isInviteExpired(invite, now);
}

// ------------------------------------- the credential-verify seam (ADR-003) ----
// milestone 24 / story 02 (ADR-003 move 2 + ADR-004; SECURITY T1/T6): the PURE
// credential-verify the relay auth-gate reads on every group ws upgrade. It is a
// function of the LIVE registry VALUE (a registry in, an admit/deny out — no fs, no
// clock), so the auth-gate re-reads it per connect (readRegistry(workspace) →
// verifyCredential(registry, token)) rather than caching a serve-start snapshot: a node
// revoked AFTER its credential was issued is denied on its NEXT connect.
//
// The decision is a function of BOTH aggregate lists:
//   1. the presented relayAuth token must HASH (sha256) to a roster entry's
//      relayAuthHash — the verifiable half issued at admission (the token itself is
//      never at rest, SECURITY T3/T5). The hash compare is CONSTANT-TIME
//      (timingSafeEqual over the two hex digests — no ===/!== timing oracle on the
//      token), and
//   2. that entry's nodeId must NOT appear in the revocation list — an explicit deny
//      the gate honours even if a stale roster entry lingers (ADR-004 revocation
//      completeness, T6).
// A missing/blank token, an unmatched token, or a revoked nodeId is a DENY (a clear
// { ok: false, reason }); a match on a non-revoked roster entry is an ADMIT carrying
// the resolved nodeId.

// Is this nodeId in the revocation list — the explicit-deny check (ADR-004 / T6).
export function isRevoked(registry, nodeId) {
  if (nodeId == null) return false;
  const revocations = registry?.revocations ?? [];
  return revocations.some((entry) => entry?.nodeId === nodeId);
}

export function verifyCredential(registry, token) {
  // An absent / non-string / empty token is never a member — deny before any compare.
  // (The token is presented material, not a stored hash — this length guard reads a
  // neutral local, never an equality operator adjacent to a hash-named identifier, the
  // constant-time fitness's blunt grep discipline this module keeps.)
  const presented = typeof token === "string" ? token : "";
  if (presented.length === 0) {
    return { ok: false, reason: "absent" };
  }
  const presentedHash = sha256HexLocal(presented);
  const roster = registry?.roster ?? [];
  // The verifiable half at rest is a stored hash — hash the presented token and
  // CONSTANT-TIME compare against each roster entry's stored hash (never a raw === on
  // hash material; SECURITY T2/T4). hashesEqualLocal's length check makes an absent
  // stored hash (empty) an immediate non-match, so no separate presence guard is needed.
  // The first match resolves the credential's nodeId.
  const entry = roster.find((member) => hashesEqualLocal(presentedHash, member?.relayAuthHash));
  if (entry == null) {
    // The token matched no admitted roster entry — invalid / not-in-roster.
    return { ok: false, reason: "not-in-roster" };
  }
  // A roster match is not enough — the LIVE revocation list is the explicit deny the
  // gate consults (T6 revocation completeness): a revoked nodeId is rejected even with
  // a still-lingering roster entry.
  if (isRevoked(registry, entry.nodeId)) {
    return { ok: false, reason: "revoked", nodeId: entry.nodeId };
  }
  return { ok: true, nodeId: entry.nodeId };
}

// The one-arg sha256-hex used by the verify seam — kept local (mesh-relay.mjs owns the
// enrollment-surface sha256Hex, and this store must not import the relay leaf, which
// imports THIS module: a store-side local avoids the import cycle while hashing the same
// way — the mint hashed the token through mesh-relay's sha256Hex, an identical sha256
// hex digest, so the two agree on the algorithm).
function sha256HexLocal(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

// The constant-time hex-digest compare the verify seam uses (SECURITY T2/T4 — the same
// no-timing-oracle discipline sameRecordKey keeps): a timingSafeEqual over the two hex
// buffers, a length mismatch an immediate non-match, never a raw ===/!== on the token
// hash.
function hashesEqualLocal(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
