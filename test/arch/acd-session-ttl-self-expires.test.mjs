// Fitness function: acd-session-ttl-self-expires (milestone 38 / ADR-002, fitness #4)
// — "a session past the TTL is not live (self-expires); one AT the TTL still is
// (strict >)."
//
// This is the BEHAVIOURAL sibling of acd-session-ttl-reuses-isstale (which pins the
// STRUCTURAL "no hand-rolled staleness" invariant) — this file exercises the real
// isSessionLive/resolveSessionTtlSeconds exports directly, over the full spread of
// ages the task-01 Scenario Outline names (fresh, TTL-1s, exactly-TTL, TTL+1ms,
// TTL+1s, 10x TTL), so RESEARCH.md §2's "no crash guarantee for SessionEnd" load-bearing
// claim (self-expiry is the PRIMARY liveness mechanism) has a concrete, passing proof.
//
// Proofs:
//  1. A session whose lastPingAt is fresh / TTL-1s / exactly-TTL reads LIVE.
//  2. A session whose lastPingAt is TTL+1ms / TTL+1s / 10x-TTL reads EXPIRED.
//  3. resolveSessionTtlSeconds honours a configured value (incl. 0) and falls back to
//     DEFAULT_SESSION_TTL_SECONDS for absent/NaN/negative/null/non-finite/string.
//  Self-check (m03 non-vacuous): a hand-rolled >= comparator disagrees with the real
//  predicate exactly AT the threshold — proving the assertion is not vacuously true.
import assert from "node:assert/strict";
import { isSessionLive, resolveSessionTtlSeconds, DEFAULT_SESSION_TTL_SECONDS } from "../../src/mesh-session.mjs";

const NOW_ISO = "2026-07-10T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const TTL_SECONDS = 120;
const TTL_MS = TTL_SECONDS * 1000;

function sessionAgedBy(ageMs) {
  return { lastPingAt: new Date(NOW_MS - ageMs).toISOString() };
}

export const archTests = [
  {
    name: "arch/38 ADR-002 (acd-session-ttl-self-expires): a session at or before the TTL reads live (0s / 1s / TTL-1s / exactly-TTL)",
    run: async () => {
      for (const ageMs of [0, 1000, TTL_MS - 1000, TTL_MS]) {
        assert.equal(isSessionLive(sessionAgedBy(ageMs), NOW_MS, TTL_MS), true, `age ${ageMs}ms (<= TTL) must read live`);
      }
    },
  },
  {
    name: "arch/38 ADR-002 (acd-session-ttl-self-expires): a session strictly past the TTL reads expired (TTL+1ms / TTL+1s / 10x TTL)",
    run: async () => {
      for (const ageMs of [TTL_MS + 1, TTL_MS + 1000, TTL_MS * 10]) {
        assert.equal(isSessionLive(sessionAgedBy(ageMs), NOW_MS, TTL_MS), false, `age ${ageMs}ms (> TTL) must read expired`);
      }
    },
  },
  {
    name: "arch/38 ADR-002 (acd-session-ttl-self-expires): resolveSessionTtlSeconds honours a configured finite value (0 included) and falls back to DEFAULT_SESSION_TTL_SECONDS for absent/NaN/negative/null/non-finite/string",
    run: async () => {
      assert.equal(resolveSessionTtlSeconds({ mesh: { session: { ttlSeconds: 90 } } }), 90);
      assert.equal(resolveSessionTtlSeconds({ mesh: { session: { ttlSeconds: 300 } } }), 300);
      assert.equal(resolveSessionTtlSeconds({ mesh: { session: { ttlSeconds: 0 } } }), 0, "0 is honoured, not a fallback");
      assert.equal(resolveSessionTtlSeconds({}), DEFAULT_SESSION_TTL_SECONDS, "absent key falls back to the documented default");
      assert.equal(resolveSessionTtlSeconds({ mesh: { session: { ttlSeconds: null } } }), DEFAULT_SESSION_TTL_SECONDS);
      assert.equal(resolveSessionTtlSeconds({ mesh: { session: { ttlSeconds: NaN } } }), DEFAULT_SESSION_TTL_SECONDS);
      assert.equal(resolveSessionTtlSeconds({ mesh: { session: { ttlSeconds: -1 } } }), DEFAULT_SESSION_TTL_SECONDS);
      assert.equal(resolveSessionTtlSeconds({ mesh: { session: { ttlSeconds: "120" } } }), DEFAULT_SESSION_TTL_SECONDS);
      assert.equal(resolveSessionTtlSeconds({ mesh: { session: { ttlSeconds: Infinity } } }), DEFAULT_SESSION_TTL_SECONDS);
      assert.equal(DEFAULT_SESSION_TTL_SECONDS, 120, "the pinned constant is 120s");
    },
  },
  {
    name: "arch/38 ADR-002 (acd-session-ttl-self-expires): self-check — a hand-rolled >= comparator disagrees with the real strict-> predicate exactly AT the threshold (non-vacuous)",
    run: async () => {
      const atThreshold = sessionAgedBy(TTL_MS);
      assert.equal(isSessionLive(atThreshold, NOW_MS, TTL_MS), true, "the real predicate: at-TTL is still live");
      const badGteExpired = (record, nowMs, ttlMs) => !((nowMs - Date.parse(record.lastPingAt)) >= ttlMs);
      assert.equal(badGteExpired(atThreshold, NOW_MS, TTL_MS), false, "the forbidden >= form wrongly calls an at-threshold session expired");
      assert.notEqual(isSessionLive(atThreshold, NOW_MS, TTL_MS), badGteExpired(atThreshold, NOW_MS, TTL_MS), "the real strict-> predicate disagrees with the forbidden >= form at the threshold");
    },
  },
];
