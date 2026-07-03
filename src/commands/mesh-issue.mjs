// mesh:issue — the resolve → assemble → write → push composition (milestone 27 /
// story 01, ADR-002). A thin WRITE wrapper over story 00/01's src/mesh-issuance.mjs
// (the frozen six-key directive assembly + the own-path issueDirective/
// withdrawDirective writes) — the `run-start.mjs` shape, far thinner (no lease/
// reclaim loop; a directive push is a single fire-and-observe, never a raced
// acquire).
//
// THE RESOLVE → ASSEMBLE → WRITE → PUSH ORDER (ADR-002.2/.3/.4):
//   1. resolveItemExact(ws.workDir, ref) — NO slug fallback (08/ADR-003
//      write-isolation, the run-start precedent): a miss is ref-not-found BEFORE
//      any directive touches disk (write-isolation — the issuance tree stays
//      byte-unchanged on a typo).
//   2. --to disambiguation is DATA-DRIVEN against the synced roster
//      (readNodeRecords): a token matching a synced nodeId ⇒ { kind:"node" };
//      any other non-empty token ⇒ { kind:"capability" }; absent/empty ⇒
//      { kind:"any" } — frozen into the directive at issue time (ADR-003 never
//      re-disambiguates at match time).
//   3. assembleDirective (story 00's pure builder) with issuer = THIS node's own
//      config.mesh.nodeId, state:"issued", issuedAt from an injected input.now
//      (the mesh:heartbeat/mesh:status white-box precedent) falling back to
//      wall-clock.
//   4. issueDirective (story 01's own-path write in mesh-issuance.mjs) — the
//      command ORCHESTRATES, the seam WRITES (20/ADR-005 split: this command
//      never joins issuanceDirectivePath itself).
//   5. ONE default-root sync (ADR-002.4 / ADR-005.1): `const runSync = ctx
//      ?.syncRunner ?? (() => syncMesh(ws));` — no runsPathspec (the directive is
//      under .mesh/, story 00's contract). A push failure surfaces a coded error
//      while the directive stays durable locally (already written in step 4) —
//      the push-for-liveness/poll-for-durability posture the whole mesh rides.
//      v1 attempts NO relay push (a directive has no race to win, ADR-002.4).
//
// WITHDRAW (ADR-001.3 / tasks/01_directive-withdraw.feature): the SAME registered
// command, an additive `--withdraw` flag — the issuer flips its OWN-partition
// directive to state "withdrawn" (mesh-issuance.mjs's withdrawDirective — an
// own-path state write, never a delete). Withdraw takes no --to (the target is
// frozen at issue time; withdrawing does not re-target). No sync push is required
// by the contract (the withdrawal rides the next issue/sync cadence like any other
// .mesh/ write) — for KR3 parity with issuance the command pushes the same ONE
// default-root sync so a withdrawal propagates within the same budget the issue
// path promises; a push failure is coded the same honest way, the withdrawal
// already durable locally.
import { resolveItemExact } from "./resolve.mjs";
import { commandError } from "./errors.mjs";
import { readNodeRecords } from "../mesh-store.mjs";
import { assembleDirective, issueDirective, withdrawDirective } from "../mesh-issuance.mjs";
import { syncMesh } from "../mesh-sync.mjs";
import { aofVersion } from "./mesh-identity.mjs";
import { meshNodeIdOf } from "./mesh-gate.mjs";

// Disambiguate a single --to token against the synced roster (ADR-002.3 /
// ADR-003): the literal wire sentinel "any" (case-insensitive, trimmed) ⇒ the
// fleet-wide any target — checked BEFORE the roster lookup so BOTH faces (the
// CLI `--to any` and the fleet UI's `{ to: "any" }` POST body) agree on the SAME
// { kind: "any" } outcome (review fix — the sentinel is disambiguated in this
// ONE place, never re-normalized upstream by a route/CLI layer); a token
// matching a KNOWN synced node id ⇒ a node target; any other non-empty token ⇒
// a capability target; absent/empty ⇒ the fleet-wide any target. DATA-DRIVEN —
// resolved ONCE here, at issue time, and frozen into the directive; the matcher
// (nodeSatisfiesTarget) never re-disambiguates.
async function resolveTarget(ws, to) {
  const token = typeof to === "string" ? to.trim() : "";
  if (token === "" || token.toLowerCase() === "any") return { kind: "any" };
  const records = await readNodeRecords(ws);
  const isKnownNode = records.some((record) => record?.nodeId === token);
  return isKnownNode ? { kind: "node", nodeId: token } : { kind: "capability", value: token };
}

export const meshIssueCommand = {
  id: "mesh:issue",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      to: { type: "string" },
      withdraw: { type: "boolean" },
      // `now` (ISO-8601 UTC-Z) is an INJECTED clock (the mesh:heartbeat/mesh:status
      // white-box idiom, 22/R2 — a test input, never a CLI flag): it drives the
      // directive's issuedAt stamp; absent ⇒ wall-clock.
      now: { type: "string" },
    },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";

    // Step 1 — resolve EXACTLY, BEFORE any directive touches disk (write-isolation,
    // 08/ADR-003, the run-start precedent). A typo'd/partial ref never issues or
    // withdraws the wrong item — it fails ref-not-found, the tree byte-unchanged.
    const item = await resolveItemExact(ctx.workspace.workDir, ref);
    if (!item) throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);

    const ws = ctx.workspace;
    const config = ws.config ?? {};
    const ownNodeId = meshNodeIdOf(config);
    if (!ownNodeId) throw commandError("mesh:issue requires a configured config.mesh.nodeId.", "mesh-not-configured", 400);

    // The injected default-root sync runner (ADR-002.4 / ADR-005.1) — no
    // runsPathspec, the directive is under .mesh/. Test-drivable via ctx.syncRunner
    // (mirrors ctx.relayClient at run-start.mjs:210); production defaults to
    // syncMesh(ws) with the default [meshDir] roots.
    const runSync = ctx?.syncRunner ?? (() => syncMesh(ws));

    if (input.withdraw === true) {
      // WITHDRAW — the own-path state flip (ADR-001.3). Absence-tolerant (nothing
      // fabricated on a never-issued directive) and idempotent on an
      // already-withdrawn one (mesh-issuance.mjs's own discipline).
      const withdrawn = await withdrawDirective(ws, ownNodeId, item.ref);
      const envelope = await runSync();
      if (isSyncFailure(envelope)) {
        throw commandError(`mesh:issue withdraw push failed (${envelope.reason}).`, envelope.reason ?? "push-failed", 502);
      }
      return withdrawn;
    }

    // Step 2 — disambiguate --to DATA-DRIVEN against the synced roster.
    const target = await resolveTarget(ws, input.to);

    // Step 3 — assemble the frozen six-key record under THIS node's own issuer id.
    const issuedAt = typeof input.now === "string" && input.now.length > 0 ? input.now : new Date().toISOString();
    const directive = assembleDirective({
      itemRef: item.ref,
      issuer: ownNodeId,
      target,
      state: "issued",
      issuedAt,
      aofVersion: aofVersion(),
    });

    // Step 4 — the durable own-path write (the seam WRITES, this command
    // ORCHESTRATES — 20/ADR-005). The directive is on disk BEFORE the sync is
    // attempted, so a push failure never loses it.
    const written = await issueDirective(ws, ownNodeId, item.ref, directive);

    // Step 5 — ONE default-root sync (KR3). A push failure is an HONEST coded
    // error; the directive is already durable locally (degrades to the git
    // cadence — the next successful sync carries it).
    const envelope = await runSync();
    if (isSyncFailure(envelope)) {
      throw commandError(`mesh:issue push failed (${envelope.reason}).`, envelope.reason ?? "push-failed", 502);
    }

    return written;
  },

  cli: {
    // `aof mesh issue <ref> [--to <node|cap>] [--withdraw]` — one positional (the
    // ref), --to the disambiguation token, --withdraw the lifecycle flip. `now` is
    // a white-box test input, never a CLI flag.
    argv: (positionals, options) => ({
      ref: positionals[0],
      to: options.to,
      withdraw: options.withdraw === true,
    }),

    // Confirm the written/withdrawn directive: the ref, its state, and (when
    // present) its target.
    render: (result) => {
      if (result == null) return "No directive to withdraw (never issued).";
      const targetPart = result.target?.kind === "node"
        ? `node ${result.target.nodeId}`
        : result.target?.kind === "capability"
          ? `capability ${result.target.value}`
          : "any";
      return `Directive ${result.itemRef} — issuer ${result.issuer}, target ${targetPart}, state ${result.state}.`;
    },

    // The bare directive record — no path in the result.
    json: (result) => result,
  },
};

// A sync envelope the transport marked as a FAILURE (the mesh-sync.mjs
// synced:false discipline — never a success-shaped return on a failed push/pull).
function isSyncFailure(envelope) {
  return envelope != null && typeof envelope === "object" && envelope.synced === false;
}
