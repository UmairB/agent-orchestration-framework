// src/mesh-lease.mjs — the LEASE-OF-RECORD (milestone 26 / story 01, ADR-003):
// per-contender claim assembly/read, the presence-tied liveness predicate, the PURE
// arbitration resolver, and acquireLease/releaseLease/standDown over an INJECTED
// runSync. GIT-ONLY by construction: this module imports NO relay/cache/subscriber/
// sync module (fitness #8 — arbitration is git-observed only; the relay overlay is
// story 02's, composed in the COMMAND layer) — the sync runner arrives as a closure.
//
// THE WRITE-SCOPE DISCIPLINE (ADR-003 / fitness #6, the mesh-presence carry-forward):
// every lease write joins the m26-story-00-RESERVED leaseClaimPath seam and routes
// through the atomic temp+rename writeText seam (19/R2) — NEVER a bare writeFile.
// Every written claim path is built with THIS node's own id (the writer functions'
// own-node parameter is literally named `nodeId` — own-path writes only, never a
// foreign holder's file). Release/stand-down/withdrawal are STATE WRITES, never a
// delete: no unlink of a claim, ever (a delete + a concurrent re-claim is a path
// resurrection race, and history loses the stand-down trail). This module references
// zero record-doc filename — record-doc resolution lives in work.mjs, never here.
//
// PRESENCE IS THE LEASE CLOCK (ADR-003.2 — 23/ADR-002 verbatim): a claim is LIVE iff
// state === "claimed" AND its holder's presence is FRESH (isNodeStale over
// presence/<node>.json, threshold from resolveStalenessSeconds). There is NO
// per-lease TTL, NO expiry stamp, NO second clock. A stale holder's claim reads
// LAPSED — a RULE readers apply, never a byte anybody writes. The PO CONTRACT LOCK
// (task 01): claimed + NO presence record is "leased-unknown" — NOT live (no fresh
// heartbeat exists to earn live) and NOT reclaimable (never-beat is unknown
// liveness, not staleness — the m23 lock); readers SKIP (the KR2-safe direction).
//
// ARBITRATION IS REMOTE-HISTORY ORDER (ADR-003.3): hold or stand down is decided
// ONLY from (re-read disk claims × presence) + the injected sync's honest envelope.
// claimedAt NEVER arbitrates (clock skew must not crown a winner). Ambiguity fails
// CLOSED: a claimant that cannot establish it won stands down — two losers is a
// liveness hiccup; two winners is the KR2 violation.
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
// 19/R2 / 20/ADR-007 — every claim write routes through the atomic temp+rename seam
// (the Windows renameWithRetry is load-bearing on this platform). Never a bare writeFile.
import { writeText } from "./fs.mjs";
// The story-00-RESERVED lease seam + the partition root (22/ADR-002's flatLeaf
// trust boundary rides inside leaseClaimPath — this module never re-implements it).
import { meshDir, leaseClaimPath } from "./mesh-store.mjs";
// The m23 presence dimension — the ONE staleness definition (23/ADR-002; never a
// parallel clock): the lease clock IS the node-presence clock, imported, not re-derived.
import { isNodeStale, resolveStalenessSeconds, readPresenceRecord } from "./mesh-presence.mjs";

// The bounded-retry literal (ADR-003.3 d–e): how many injected-sync attempts a
// claimant makes before ambiguity fails CLOSED. The task-00 ambiguity rows count
// the scripted runner's calls against exactly this constant — never unbounded retry.
export const MAX_CLAIM_SYNC_ATTEMPTS = 2;

// ------------------------------------------------- the claim record assembly ----

// Assemble a claim record — the FROZEN six-key schema, EXACTLY these keys in this
// order (ADR-003.1): { itemRef, nodeId, state, claimedAt, runId, aofVersion }.
// No TTL, no expiry key — presence is the one clock. runId is null at claim time
// (the run tie is set by story 02); claimedAt is ISO-8601 UTC-Z provenance ONLY —
// NEVER the arbitration key. The assemblePresenceRecord idiom: a PURE projection.
export function assembleClaimRecord({ itemRef, nodeId, state, claimedAt, runId = null, aofVersion }) {
  return {
    itemRef,
    nodeId,
    state,
    claimedAt,
    runId,
    aofVersion,
  };
}

// ------------------------------------------------- the absence-tolerant reads ----

// The one item's lease directory — derived FROM the reserved builder (never a second
// path join for the lease shape): the dirname of the item's per-contender claim path.
function itemLeaseDir(workspace, itemRef) {
  return path.dirname(leaseClaimPath(workspace, itemRef, "any"));
}

// Read every contender's claim for ONE item, parsed. The mesh-store read discipline:
// absence (no dir) reads as [] — never an error; a torn/unparseable file is skipped
// rather than blinding the healthy claims. A read mutates nothing.
export async function readItemClaims(workspace, itemRef) {
  return readClaimDir(itemLeaseDir(workspace, itemRef));
}

// Read every claim across EVERY item under leases/ (the readNodeRecords walk, one
// level deeper: leases/<item>/<node>.json). Absence ⇒ [], torn file ⇒ skip. Item
// refs come from each RECORD's itemRef — never re-derived from the flatLeaf'd
// directory name (the dir leaf is a path-safety coercion, not the ref).
export async function readLeaseClaims(workspace) {
  const root = path.join(meshDir(workspace), "leases");
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const claims = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    claims.push(...await readClaimDir(path.join(root, entry.name)));
  }
  return claims;
}

async function readClaimDir(dir) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const claims = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      if (parsed != null && typeof parsed === "object") claims.push(parsed);
    } catch {
      continue;
    }
  }
  return claims;
}

// Read THIS node's own claim file for one item (absence-tolerant: null on any miss).
async function readOwnClaim(workspace, itemRef, nodeId) {
  try {
    const parsed = JSON.parse(await readFile(leaseClaimPath(workspace, itemRef, nodeId), "utf8"));
    return parsed != null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------- the liveness predicate ----

// claimLiveness(claim, holderPresence, nowMs, thresholdMs) — PURE, four-outcome
// (ADR-003.2 + the task-01 PO lock):
//   - state !== "claimed"      ⇒ "not-held"        (a released file is a withdrawal —
//                                                    presence-blind, it holds nothing);
//   - no presence record       ⇒ "leased-unknown"  (NOT live — no fresh heartbeat exists
//                                                    to earn live — and NOT reclaimable —
//                                                    never-beat is unknown liveness, not
//                                                    staleness; readers SKIP, KR2-safe);
//   - presence fresh           ⇒ "live";
//   - presence stale           ⇒ "lapsed"          (reclaimable — a RULE, never an edit).
// The staleness boundary is the m23 strict-> shape (age == threshold ⇒ still fresh),
// via the imported isNodeStale — never a private re-derivation. claimedAt is never
// consulted (no clock lives in the claim).
export function claimLiveness(claim, holderPresence, nowMs, thresholdMs) {
  if (claim == null || claim.state !== "claimed") return "not-held";
  if (holderPresence == null || typeof holderPresence.heartbeatAt !== "string") return "leased-unknown";
  return isNodeStale(holderPresence, nowMs, thresholdMs) ? "lapsed" : "live";
}

// --------------------------------------------------- the arbitration resolver ----

// resolveArbitration(ownNodeId, claims, presenceById, nowMs, thresholdMs) — the PURE
// hold/stand-down resolver (ADR-003.3 d; fitness #8): decided ONLY over disk-read
// claims × presence — no cache, no relay, no clock beyond the injected now. A
// competing claim that is LIVE — or whose holder is UNKNOWN (never beat: the PO-lock
// skip direction) — means the competitor holds ⇒ { held: false, heldBy }. A lapsed
// or released competitor holds nothing. claimedAt is NEVER compared (remote-history
// order arbitrates, observed by the caller through the sync envelopes + re-reads).
export function resolveArbitration(ownNodeId, claims, presenceById, nowMs, thresholdMs) {
  for (const claim of claims ?? []) {
    if (claim == null || claim.nodeId === ownNodeId) continue;
    const liveness = claimLiveness(claim, presenceById?.get?.(claim.nodeId) ?? null, nowMs, thresholdMs);
    if (liveness === "live" || liveness === "leased-unknown") {
      return { held: false, heldBy: claim.nodeId };
    }
  }
  return { held: true };
}

// Observe the item's competitors off the LOCAL tree: read the claims, read each
// foreign holder's presence off disk, resolve. This is the re-read acquireLease
// performs after EVERY injected-sync return (the task-00 locked contract).
async function observeCompetitors(workspace, itemRef, nodeId, nowMs, thresholdMs) {
  const claims = await readItemClaims(workspace, itemRef);
  const presenceById = new Map();
  for (const claim of claims) {
    if (claim == null || typeof claim.nodeId !== "string") continue;
    if (claim.nodeId === nodeId || presenceById.has(claim.nodeId)) continue;
    const presence = await readPresenceRecord(workspace, claim.nodeId);
    if (presence) presenceById.set(claim.nodeId, presence);
  }
  return resolveArbitration(nodeId, claims, presenceById, nowMs, thresholdMs);
}

// ------------------------------------------------------- own-path hygiene ----

// withdrawOwnLapsedClaims(workspace, nodeId, { nowMs, thresholdMs }) — the returning
// owner's own-path hygiene (ADR-003.2; the task-01 resolved seam): when THIS node's
// OWN on-disk presence is STALE under the injected now (the fleet has been reading
// its claims as lapsed), flip each own state:"claimed" file to "released" — own
// leaseClaimPath only, a state write never a delete. Fresh own presence ⇒ a
// zero-write no-op. NO presence record ⇒ a zero-write no-op too (never-beat is
// unknown liveness, not staleness — nothing has lapsed). acquireLease calls this as
// its FIRST own-path step (before the step-a competitor read); publishing the fresh
// heartbeat itself is the CALLER's business (story 02's command layer beats after
// hygiene) — this module performs no heartbeat.
export async function withdrawOwnLapsedClaims(workspace, nodeId, { nowMs, thresholdMs } = {}) {
  const ownPresence = await readPresenceRecord(workspace, nodeId);
  if (ownPresence == null || typeof ownPresence.heartbeatAt !== "string") return [];
  if (!isNodeStale(ownPresence, nowMs, thresholdMs)) return [];
  const withdrawn = [];
  for (const claim of await readLeaseClaims(workspace)) {
    if (claim.nodeId !== nodeId || claim.state !== "claimed") continue;
    if (typeof claim.itemRef !== "string") continue;
    const released = { ...claim, state: "released" };
    await writeText(leaseClaimPath(workspace, claim.itemRef, nodeId), JSON.stringify(released, null, 2));
    withdrawn.push(claim.itemRef);
  }
  return withdrawn;
}

// --------------------------------------------------- release / stand-down ----

// standDown — the own-path STATE WRITE to "released" (ADR-003.2/3.3 d–e): the loser
// (or ambiguous claimant) withdraws by flipping ITS OWN file — never a delete, never
// a foreign write. The released file remains at its own path as the audit trail.
// Absence-tolerant: no own claim on disk ⇒ nothing to flip (null, no write).
export async function standDown(workspace, itemRef, nodeId) {
  const current = await readOwnClaim(workspace, itemRef, nodeId);
  if (current == null) return null;
  const released = { ...current, state: "released" };
  await writeText(leaseClaimPath(workspace, itemRef, nodeId), JSON.stringify(released, null, 2));
  return released;
}

// releaseLease — the holder's release (run finished — story 02 wires
// work:run-complete). The SAME own-path state-write mechanic as standDown: released
// is a terminal state on the record, never an unlink.
export async function releaseLease(workspace, itemRef, nodeId) {
  return standDown(workspace, itemRef, nodeId);
}

// tieClaimToRun(workspace, itemRef, nodeId, runId) — the lease↔run TIE-BACK (m26
// story 02 / ADR-003.1, graduated HERE by PO SANCTION recorded in STATE.md — ONE
// lease-write home; ADR-003's consequences name this module as the claim-write
// module): once work:run-start WINS the lease and mints the run, THIS node's OWN
// claim file gains the minted runId ("null at claim, set once the run is minted") —
// the lease-to-run tie every reader consumes. The command ORCHESTRATES, this seam
// WRITES (20/ADR-005's split — a run-* command carries no write verb of its own).
// The same own-path discipline as every writer above: the ONE write joins
// leaseClaimPath built with THIS node's id, routed through atomic writeText — a
// STATE write, never a delete, never a foreign holder's file. Absence is the ONE
// benign edge (ENOENT ⇒ null, no write — the mesh path always claims before it
// mints); any OTHER read/parse failure PROPAGATES: a torn or unreadable own claim
// immediately after acquireLease wrote it is a real anomaly, never silently eaten.
export async function tieClaimToRun(workspace, itemRef, nodeId, runId) {
  let body;
  try {
    body = await readFile(leaseClaimPath(workspace, itemRef, nodeId), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const tied = { ...JSON.parse(body), runId };
  await writeText(leaseClaimPath(workspace, itemRef, nodeId), JSON.stringify(tied, null, 2));
  return tied;
}

// ------------------------------------------------------- the acquire protocol ----

// acquireLease(workspace, itemRef, nodeId, { runSync, now, config, aofVersion,
// onClaimWritten }) — the ADR-003.3 protocol over an INJECTED sync runner (a closure
// over the engine — or a scripted envelope sequence in tests; this module never
// imports the engine):
//
//   0. own-path hygiene (withdrawOwnLapsedClaims — the returning-owner seam);
//   a. read the item's claims off the LOCAL tree — a LIVE (or unknown-holder)
//      competing claim already visible ⇒ do not claim at all (the git-cadence skip:
//      no own file minted, no sync attempted);
//   b. write this node's claim file — atomic writeText at its OWN leaseClaimPath —
//      then await the optional onClaimWritten(claim) hook (m26 story 02 / ADR-004.3;
//      the PO-SANCTIONED co-edit recorded in STATE.md): the FROZEN A2 slot between
//      the durable claim write and the FIRST sync, where the COMMAND layer
//      broadcasts the best-effort relay intent so peers defer within relay latency
//      rather than a full sync round. The hook arrives as INJECTED DATA — this
//      module still imports NO relay/cache/subscriber module (fitness #8) — and its
//      outcome cannot gate the claim: the caller owns its failure handling (the
//      best-effort try/catch lives on the claim path, fitness #9);
//   c/d. runSync() loop, bounded by MAX_CLAIM_SYNC_ATTEMPTS: after EVERY return the
//      claims are RE-READ off the tree and re-resolved (claims × presence). A live
//      competitor observed ⇒ the competitor won ⇒ stand down (own-file flip) and
//      return { held:false, heldBy, mint:false }. A clean envelope with no live
//      competitor ⇒ our claim reached the remote first ⇒ HELD. A failure envelope
//      (push-failed / pull-failed — the engine's honest race signal) ⇒ retry within
//      the bound and re-observe;
//   e. attempts exhausted without establishing a win ⇒ AMBIGUITY FAILS CLOSED:
//      stand down, mint nothing (two losers is a liveness hiccup; two winners is
//      the KR2 violation).
//
// The threshold comes from resolveStalenessSeconds(config) (the ONE knob); `now` is
// injected (ISO-8601 UTC-Z; wall-clock only when absent). The result tells the
// caller what to do: { held:true, mint:true } ⇒ mint the run; { held:false,
// heldBy?, mint:false } ⇒ mint NOTHING.
export async function acquireLease(workspace, itemRef, nodeId, { runSync, now, config, aofVersion = "", onClaimWritten } = {}) {
  const nowIso = typeof now === "string" && now.length > 0 ? now : new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const thresholdMs = resolveStalenessSeconds(config ?? {}) * 1000;

  // Step 0 — own-path hygiene before anything else (the task-01 resolved ordering).
  await withdrawOwnLapsedClaims(workspace, nodeId, { nowMs, thresholdMs });

  // Step a — the git-cadence skip: a live competitor already on the local tree means
  // the race is over before it starts. No own claim file is minted.
  const preflight = await observeCompetitors(workspace, itemRef, nodeId, nowMs, thresholdMs);
  if (!preflight.held) {
    return { held: false, heldBy: preflight.heldBy, mint: false };
  }

  // Step b — the durable own-path claim write (atomic, first, unconditional).
  const record = assembleClaimRecord({
    itemRef,
    nodeId,
    state: "claimed",
    claimedAt: nowIso,
    runId: null,
    aofVersion,
  });
  await writeText(leaseClaimPath(workspace, itemRef, nodeId), JSON.stringify(record, null, 2));

  // The ADR-004.3 intent slot — claim written, sync NOT yet run: the injected hook
  // fires HERE so the fast-path broadcast precedes the first sync round (the whole
  // point of the accelerator — under contention the sync loop is at its slowest).
  // Awaited so the caller's best-effort push completes before the authoritative
  // act; the caller catches its own failures, so nothing here can gate the claim.
  if (typeof onClaimWritten === "function") {
    await onClaimWritten(record);
  }

  // Steps c–d — sync, re-observe, decide; bounded retries on the honest failure
  // envelopes. Hold or stand down is decided HERE and only here, from git
  // observation alone (fitness #8 — no cache, no relay, no hope).
  //
  // The runner contract is ENVELOPES-NOT-THROWS (the engine returns its honest
  // failure envelopes rather than throwing): a THROWING runner therefore propagates
  // out of this loop un-caught — deliberately, so a mis-wired closure fails loudly
  // at its caller instead of being silently absorbed — and sits OUTSIDE the
  // fail-closed guarantee below, which is defined over envelopes.
  for (let attempt = 1; attempt <= MAX_CLAIM_SYNC_ATTEMPTS; attempt += 1) {
    const envelope = await runSync();
    const verdict = await observeCompetitors(workspace, itemRef, nodeId, nowMs, thresholdMs);
    if (!verdict.held) {
      // The pull surfaced a live competing claim that was on the remote before ours
      // landed — the competitor won. Stand down: own-file state write, mint nothing.
      await standDown(workspace, itemRef, nodeId);
      return { held: false, heldBy: verdict.heldBy, mint: false };
    }
    // HELD requires an AFFIRMATIVE real envelope (ADR-003.3 e — never held on
    // hope). The engine's SUCCESS envelope carries NO `synced` key ({ committed,
    // pushed, pulled, noop }); only failures carry { synced:false, reason } — so
    // the affirmative gate is "a non-null OBJECT that is not a failure", NEVER
    // `synced === true` (no real envelope carries it; that gate would never hold).
    // An absent/malformed return (null / undefined / non-object — e.g. a mis-wired
    // runner that forgot to return the engine's envelope) establishes NOTHING and
    // must NOT win: it counts as an ambiguous attempt exactly like a failure
    // envelope — retry within the bound, then fail closed (the KR2
    // double-execution direction is the one this protocol never fails toward).
    if (envelope != null && typeof envelope === "object" && envelope.synced !== false) {
      // A clean sync whose pull surfaced NO live competitor: this claim reached
      // the remote first — HELD.
      return { held: true, itemRef, nodeId, mint: true };
    }
    // push-failed: the remote moved mid-race — re-sync (bounded) and re-observe.
    // pull-failed: the read-back half did not happen — we cannot establish we won
    // on this attempt either. Absent/malformed envelope: nothing was established.
    // All retry within the bound; persistence falls through to the fail-closed
    // stand-down below.
  }

  // Step e — ambiguity fails CLOSED: the sync kept failing (or kept establishing
  // nothing), so this claimant cannot establish it won. Stand down even though no
  // competitor is visible.
  await standDown(workspace, itemRef, nodeId);
  return { held: false, heldBy: null, mint: false };
}

// --------------------------------------------------------- the lease view ----

// buildLeaseView(claims, presenceById, { nowMs, thresholdMs, hint }) — the PURE
// view builder for mesh-aware `next` (ADR-005; the task-02 FROZEN shape): a Map
// keyed by item ref (the claim RECORD's itemRef — the same ref strings nextWork's
// items carry), value { state: "leased-live" | "leased-stale", holder }. A ref
// absent from the map is unleased. Mapping (the task-01 PO lock applied):
//   live            ⇒ leased-live  (skip);
//   leased-unknown  ⇒ leased-live  (skip — NEVER leased-stale: a no-presence holder
//                                   is not affirmatively stale, so never reclaimable);
//   lapsed          ⇒ leased-stale (ready + reclaimable at the walk);
//   not-held        ⇒ no entry     (a released file is history, not a hold).
// During the transient two-claims window ANY live/unknown claim keeps the item in
// the SKIP bucket (ADR-003.4 — a third-party reader never resolves the winner; skip
// beats reclaimable, the fail-safe direction).
//
// The hint overlay (23/ADR-004's git-wins discipline, locked at Contract): DISK
// FIRST — the hint may only ADD an entry for a ref the disk left unleased (state
// "leased-live", holder from the hint); it never removes, downgrades, or marks
// reclaimable. The hint arrives as plain DATA — a Map of itemRef → claim-shaped
// record, or a cache-shaped { ids(), get(id) } (story 02 wires the real subscriber
// cache); this builder stays pure either way (no cache module import — fitness #8).
export function buildLeaseView(claims, presenceById, { nowMs, thresholdMs, hint = null } = {}) {
  const view = new Map();
  for (const claim of claims ?? []) {
    if (claim == null || typeof claim.itemRef !== "string" || typeof claim.nodeId !== "string") continue;
    const liveness = claimLiveness(claim, presenceById?.get?.(claim.nodeId) ?? null, nowMs, thresholdMs);
    if (liveness === "not-held") continue;
    const state = liveness === "lapsed" ? "leased-stale" : "leased-live";
    const existing = view.get(claim.itemRef);
    if (existing == null) {
      view.set(claim.itemRef, { state, holder: claim.nodeId });
    } else if (existing.state === "leased-stale" && state === "leased-live") {
      // Skip beats reclaimable: any live/unknown claim keeps the item leased.
      view.set(claim.itemRef, { state, holder: claim.nodeId });
    }
    // An existing leased-live entry is never downgraded; the first stale holder stands.
  }
  for (const [ref, entry] of hintEntries(hint)) {
    if (typeof ref !== "string" || view.has(ref)) continue; // git wins — disk first
    if (entry == null || typeof entry !== "object") continue;
    if (entry.state === "released") continue; // a withdrawal signal is not a hold
    const holder = typeof entry.nodeId === "string"
      ? entry.nodeId
      : (typeof entry.holder === "string" ? entry.holder : null);
    // The hint can only ADD a skip — always leased-live, never reclaimable.
    view.set(ref, { state: "leased-live", holder });
  }
  return view;
}

// The hint's two accepted DATA shapes, normalized to entries. No cache module is
// imported — the cache-shaped duck ({ ids(), get(id) }) is read structurally.
function hintEntries(hint) {
  if (hint == null) return [];
  if (hint instanceof Map) return [...hint.entries()];
  if (typeof hint.ids === "function" && typeof hint.get === "function") {
    return hint.ids().map((id) => [id, hint.get(id)]);
  }
  return [];
}
