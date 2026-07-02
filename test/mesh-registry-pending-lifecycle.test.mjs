// Traceability wiring for milestone 24 / story 00 — the pending-invite durable shape
// + lifecycle (tasks/02_pending-invite-lifecycle.feature).
//
// Covers EVERY @executable scenario in tasks/02_pending-invite-lifecycle.feature,
// exercising the REAL src/mesh-registry.mjs pure pending-invite accessors — a registry
// value in, a registry value / a boolean out (no fs, no relay, no git, no crypto).
// codeHash is treated as an OPAQUE string (this story owns the durable SHAPE; the
// hashing is story 01's + the security-owned acd-enrollment-code-hashed-at-rest
// fitness). Every now / issuedAt / expiresAt is an INJECTED value, never wall-clock
// (the 22/R2 discipline), so the strict-> TTL boundary is asserted deterministically.
// One test object per scenario (the Scenario Outline runs its Examples rows in one
// test). node:assert/strict.
//
//   02_pending-invite-lifecycle.feature — appending a pending invite stores
//     { codeHash, issuedAt, expiresAt, consumedAt: null } with NO plaintext code
//     field; consuming sets consumedAt (single-use) and the accessor reads it as
//     consumed thereafter, the other fields byte-unchanged; a TTL read flags an
//     invite expired ONLY when now STRICTLY exceeds expiresAt (now == expiresAt is
//     NOT expired); consuming one invite leaves the other pending invites
//     byte-unchanged (an add-only marker on the one record).
import assert from "node:assert/strict";
import {
  appendPendingInvite,
  consumePendingInvite,
  isInviteConsumed,
  isInviteExpired,
  isInvitePending,
  emptyRegistry,
} from "../src/mesh-registry.mjs";

export const meshRegistryPendingLifecycleTests = [
  {
    name: "mesh-registry-pending/02 appending a pending invite stores { codeHash, issuedAt, expiresAt, consumedAt: null } with no plaintext code field",
    async run() {
      const registry = appendPendingInvite(emptyRegistry(), {
        codeHash: "OPAQUE-HASH-1",
        issuedAt: "2026-07-01T10:00:00Z",
        expiresAt: "2026-07-01T10:05:00Z",
      });

      assert.equal(registry.pending.length, 1, "pending contains exactly one record");
      const record = registry.pending[0];
      assert.equal(record.codeHash, "OPAQUE-HASH-1", 'the record carries codeHash "OPAQUE-HASH-1" (an opaque string — the hashing crypto is the security-owned fitness, not asserted here)');
      assert.equal(record.issuedAt, "2026-07-01T10:00:00Z", "the record carries its injected issuedAt");
      assert.equal(record.expiresAt, "2026-07-01T10:05:00Z", "the record carries its injected expiresAt");
      assert.equal(record.consumedAt, null, "consumedAt is null (a fresh invite is unconsumed)");
      // the durable shape is EXACTLY the four ADR-001 fields — no bare plaintext field
      assert.deepEqual(Object.keys(record), ["codeHash", "issuedAt", "expiresAt", "consumedAt"], "the durable shape is exactly { codeHash, issuedAt, expiresAt, consumedAt }");
      for (const forbidden of ["code", "deviceCode", "plaintext", "plainCode", "rawCode"]) {
        assert.ok(!(forbidden in record), `NO bare "${forbidden}" field is persisted on the record`);
      }
    },
  },
  {
    name: "mesh-registry-pending/02 marking an invite consumed sets consumedAt, and the accessor reads it as consumed thereafter",
    async run() {
      const registry = appendPendingInvite(emptyRegistry(), {
        codeHash: "OPAQUE-HASH-1",
        issuedAt: "2026-07-01T10:00:00Z",
        expiresAt: "2026-07-01T10:05:00Z",
      });
      const fresh = registry.pending[0];
      assert.equal(fresh.consumedAt, null, "the invite starts with consumedAt null");
      // an invite whose consumedAt is null and is not expired reads as PENDING (the
      // distinction the endpoint reads) — now injected inside the TTL window
      assert.equal(isInvitePending(fresh, "2026-07-01T10:01:00Z"), true, "an unconsumed, unexpired invite reads as pending");
      assert.equal(isInviteConsumed(fresh), false, "an unconsumed invite does not read as consumed");

      const consumed = consumePendingInvite(registry, "OPAQUE-HASH-1", "2026-07-01T10:03:00Z");
      const record = consumed.pending[0];
      assert.equal(record.consumedAt, "2026-07-01T10:03:00Z", 'the invite\'s consumedAt is "2026-07-01T10:03:00Z"');
      assert.equal(isInviteConsumed(record), true, "the accessor reads the invite as consumed");
      assert.equal(isInvitePending(record, "2026-07-01T10:03:30Z"), false, "a consumed invite no longer reads as pending");
      // the consume is a MARKER, not a rewrite: the other fields are byte-unchanged
      assert.equal(record.codeHash, fresh.codeHash, "codeHash is byte-unchanged by the consume");
      assert.equal(record.issuedAt, fresh.issuedAt, "issuedAt is byte-unchanged by the consume");
      assert.equal(record.expiresAt, fresh.expiresAt, "expiresAt is byte-unchanged by the consume");
      assert.deepEqual(Object.keys(record), Object.keys(fresh), "the consume added/removed/reordered no field (a marker, not a rewrite)");
    },
  },
  {
    name: "mesh-registry-pending/02 a TTL read flags an invite expired only when now strictly exceeds expiresAt (outline: before / one s before / equal / one s after / after)",
    async run() {
      const registry = appendPendingInvite(emptyRegistry(), {
        codeHash: "OPAQUE-HASH-1",
        issuedAt: "2026-07-01T10:00:00Z",
        expiresAt: "2026-07-01T10:05:00Z",
      });
      const invite = registry.pending[0];
      // Examples: | now vs expiresAt | expired | — the AT-boundary row is load-bearing:
      // now == expiresAt is NOT expired (== is not >, the m20 strict-> discipline)
      const rows = [
        { now: "2026-07-01T10:00:00Z", label: "before", expired: false },
        { now: "2026-07-01T10:04:59Z", label: "one s before", expired: false },
        { now: "2026-07-01T10:05:00Z", label: "equal", expired: false },
        { now: "2026-07-01T10:05:01Z", label: "one s after", expired: true },
        { now: "2026-07-01T10:10:00Z", label: "after", expired: true },
      ];
      for (const row of rows) {
        assert.equal(
          isInviteExpired(invite, row.now),
          row.expired,
          `[now ${row.now} (${row.label})] the invite expired flag is ${row.expired}`
        );
      }
      // the pending read agrees with the boundary: still presentable AT expiresAt
      assert.equal(isInvitePending(invite, "2026-07-01T10:05:00Z"), true, "at exactly expiresAt the unconsumed invite still reads as pending");
      assert.equal(isInvitePending(invite, "2026-07-01T10:05:01Z"), false, "one second past expiresAt the invite no longer reads as pending");
      // FAIL-CLOSED on unparseable time (story-00 structural-review fix): the TTL is a
      // structural bound on the 10^6 code space (ADR-005) and the registry is
      // hand-editable in git — a malformed expiresAt/now must read as EXPIRED, never
      // as a never-expiring invite.
      const mangled = { ...invite, expiresAt: "not-a-timestamp" };
      assert.equal(isInviteExpired(mangled, "2026-07-01T10:00:00Z"), true, "a malformed expiresAt reads as EXPIRED (fail-closed, never a never-expiring invite)");
      assert.equal(isInvitePending(mangled, "2026-07-01T10:00:00Z"), false, "a malformed expiresAt is never presentable");
      assert.equal(isInviteExpired(invite, "not-a-timestamp"), true, "a malformed injected now reads as EXPIRED (fail-closed)");
    },
  },
  {
    name: "mesh-registry-pending/02 consuming one invite leaves the other pending invites byte-unchanged",
    async run() {
      let registry = emptyRegistry();
      registry = appendPendingInvite(registry, { codeHash: "OPAQUE-HASH-1", issuedAt: "2026-07-01T10:00:00Z", expiresAt: "2026-07-01T10:05:00Z" });
      registry = appendPendingInvite(registry, { codeHash: "OPAQUE-HASH-2", issuedAt: "2026-07-01T10:01:00Z", expiresAt: "2026-07-01T10:06:00Z" });
      registry = appendPendingInvite(registry, { codeHash: "OPAQUE-HASH-3", issuedAt: "2026-07-01T10:02:00Z", expiresAt: "2026-07-01T10:07:00Z" });
      assert.ok(registry.pending.every((invite) => invite.consumedAt === null), "all three invites start with consumedAt null");

      // record the on-value bytes of the OPAQUE-HASH-2 and OPAQUE-HASH-3 invites
      const bytes2 = JSON.stringify(registry.pending[1]);
      const bytes3 = JSON.stringify(registry.pending[2]);

      const after = consumePendingInvite(registry, "OPAQUE-HASH-1", "2026-07-01T10:03:00Z");

      assert.equal(isInviteConsumed(after.pending[0]), true, "the OPAQUE-HASH-1 invite reads as consumed");
      assert.equal(JSON.stringify(after.pending[1]), bytes2, "the OPAQUE-HASH-2 invite is byte-unchanged (the consume marked only the one record)");
      assert.equal(JSON.stringify(after.pending[2]), bytes3, "the OPAQUE-HASH-3 invite is byte-unchanged (the consume marked only the one record)");
      assert.equal(after.pending[1], registry.pending[1], "the OPAQUE-HASH-2 invite was not rewritten in place (carried through)");
      assert.equal(after.pending[2], registry.pending[2], "the OPAQUE-HASH-3 invite was not rewritten in place (carried through)");
      assert.equal(after.pending[1].consumedAt, null, "no other pending invite's consumedAt was set");
      assert.equal(after.pending[2].consumedAt, null, "no other pending invite's consumedAt was set (an add-only marker on the one record)");
    },
  },
];
