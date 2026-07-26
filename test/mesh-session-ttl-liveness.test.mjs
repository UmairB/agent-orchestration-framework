// Traceability wiring for milestone 38 / story 00
// tasks/01_session-ttl-liveness.feature — "a session is LIVE only while its
// lastPingAt is within the TTL — reusing the ONE shared staleness predicate".
//
// Every @executable scenario / Scenario Outline row is asserted directly against
// the real src/mesh-session.mjs exports (isSessionLive, resolveSessionTtlSeconds,
// DEFAULT_SESSION_TTL_SECONDS) — a pure, injected-clock surface, no fs/fixture
// needed. node:assert/strict.
import assert from "node:assert/strict";
import { isSessionLive, resolveSessionTtlSeconds, DEFAULT_SESSION_TTL_SECONDS } from "../src/mesh-session.mjs";

const NOW_ISO = "2026-07-10T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function agedRecord(ageMs) {
  return { lastPingAt: new Date(NOW_MS - ageMs).toISOString() };
}

export const meshSessionTtlLivenessTests = [
  // ══ Scenario Outline: a session is live at or before the TTL and expired strictly past it ══
  {
    name: "mesh-session-ttl-liveness/01 a session is live at or before the TTL and expired strictly past it (Examples)",
    async run() {
      const ttlSeconds = 120;
      const ttlMs = ttlSeconds * 1000;
      const rows = [
        { age: 0, liveness: "live" },
        { age: 1000, liveness: "live" },
        { age: ttlMs - 1000, liveness: "live" },
        { age: ttlMs, liveness: "live" },
        { age: ttlMs + 1, liveness: "expired" },
        { age: ttlMs + 1000, liveness: "expired" },
        { age: ttlMs * 10, liveness: "expired" },
      ];
      for (const row of rows) {
        const live = isSessionLive(agedRecord(row.age), NOW_MS, ttlMs);
        assert.equal(live, row.liveness === "live", `age ${row.age}ms reads ${row.liveness}`);
      }
    },
  },

  // ══ Scenario Outline: the TTL default resolves from config, falling back to the one documented constant ══
  {
    name: "mesh-session-ttl-liveness/01 the TTL default resolves from config, falling back to the one documented constant (Examples)",
    async run() {
      const rows = [
        { configured: 90, resolved: 90 },
        { configured: 300, resolved: 300 },
        { configured: 0, resolved: 0 },
        { configured: undefined, resolved: DEFAULT_SESSION_TTL_SECONDS },
        { configured: null, resolved: DEFAULT_SESSION_TTL_SECONDS },
        { configured: NaN, resolved: DEFAULT_SESSION_TTL_SECONDS },
        { configured: -1, resolved: DEFAULT_SESSION_TTL_SECONDS },
        { configured: "120", resolved: DEFAULT_SESSION_TTL_SECONDS },
        { configured: Infinity, resolved: DEFAULT_SESSION_TTL_SECONDS },
      ];
      for (const row of rows) {
        const config = row.configured === undefined ? {} : { mesh: { session: { ttlSeconds: row.configured } } };
        assert.equal(resolveSessionTtlSeconds(config), row.resolved, `configured=${row.configured} resolves to ${row.resolved}`);
      }
    },
  },

  // ══ Scenario: a session at exactly the TTL is still live, one epsilon past it is expired ══
  {
    name: "mesh-session-ttl-liveness/01 a session at exactly the TTL is still live, one epsilon past it is expired (the strict-> pin)",
    async run() {
      const ttlMs = 120_000;
      const record = agedRecord(ttlMs);
      assert.equal(isSessionLive(record, NOW_MS, ttlMs), true, "at exactly the TTL, the session reads live");
      assert.equal(isSessionLive(record, NOW_MS + 1, ttlMs), false, "one more millisecond of now, the same session reads expired");
    },
  },
];
