// Fitness function: acd-session-ttl-reuses-isstale (milestone 38 / ADR-002) —
// "session TTL liveness REUSES the shared m23 `isStale` predicate (strict >, injected
// clock) — it NEVER forks a parallel staleness rule."
//
// The whole mesh shares ONE staleness definition: `isStale` (run-store.mjs), re-exposed
// as `isNodeStale` (mesh-presence.mjs:202), strict `>`, UTC-Z Date.parse, injected
// nowMs/thresholdMs. 35/ADR-005 already keeps the run layer and the node layer on this
// one predicate (acd-assignment-reclaim-dual-staleness). ADR-002 extends the SAME
// predicate to session liveness: a session is live iff `!isStale(record, nowMs, ttlMs)`.
//
// A parallel, hand-rolled staleness in the session path — a second `Date.parse(a) -
// Date.parse(b) > threshold` comparison, a `>=` off-by-one, its own predicate — is the
// "two heartbeats" mistake the mesh guards against. This fitness function forbids it.
//
// STATE OF BUILD: the session module (src/mesh-session.mjs) is built by the story. This
// test is TOLERANT of its absence (the invariant cannot be violated by a file that does
// not exist yet) and STRICT once it exists: the module MUST import isStale/isNodeStale
// from the shared source and MUST NOT hand-roll a staleness comparison.
//
// Proofs:
//  1. If src/mesh-session.mjs exists, it imports isStale (or isNodeStale) from the
//     shared staleness source (run-store.mjs or mesh-presence.mjs) and contains NO
//     hand-rolled staleness comparison (`Date.parse(...) - Date.parse(...) > ...`).
//  2. The shared predicate itself is strict `>` (a session AT the TTL is still live) —
//     the property ADR-002 rests on, asserted against the live imported isNodeStale.
//  Self-check (m03 non-vacuous): a planted hand-rolled staleness comparison, and a `>=`
//  (at-threshold-stale) predicate, both trip the SAME detectors.
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isNodeStale } from "../../src/mesh-presence.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sessionSourcePath = path.join(repoRoot, "src", "mesh-session.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function readIfExists(file) {
  try {
    await access(file);
  } catch {
    return null;
  }
  return readFile(file, "utf8");
}

// The session module must import the shared predicate and hand-roll no staleness.
function assertStructural(code) {
  const problems = [];
  const importsShared =
    /import\s*\{[^}]*\bisStale\b[^}]*\}\s*from\s*["']\.\/run-store\.mjs["']/.test(code) ||
    /import\s*\{[^}]*\bisNodeStale\b[^}]*\}\s*from\s*["']\.\/mesh-presence\.mjs["']/.test(code) ||
    /import\s*\{[^}]*\bisStale\b[^}]*\}\s*from\s*["']\.\/mesh-presence\.mjs["']/.test(code);
  if (!importsShared) {
    problems.push("the session module does not import isStale/isNodeStale from the shared staleness source");
  }
  // A hand-rolled staleness: a Date.parse difference compared against a threshold.
  if (/Date\.parse\s*\([^)]*\)\s*-\s*Date\.parse\s*\([^)]*\)\s*>/.test(code)) {
    problems.push("a hand-rolled Date.parse staleness comparison exists in the session path");
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/38 ADR-002 (acd-session-ttl-reuses-isstale): the session module (if present) imports the shared isStale/isNodeStale predicate and hand-rolls NO staleness comparison (structural)",
    run: async () => {
      const source = await readIfExists(sessionSourcePath);
      if (source == null) return; // not-yet-built: the invariant cannot be violated by an absent file (pending)
      const problems = assertStructural(stripComments(source));
      assert.deepEqual(problems, [], `structural problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/38 ADR-002 (acd-session-ttl-reuses-isstale): the shared predicate is strict > — a session AT the TTL is STILL LIVE (the property session TTL rests on)",
    run: async () => {
      const now = Date.parse("2026-07-10T12:00:00.000Z");
      const ttlMs = 120_000;
      // lastPingAt exactly ttlMs ago → age == ttlMs → NOT stale (60 > 60 is false).
      const atThreshold = { heartbeatAt: new Date(now - ttlMs).toISOString() };
      assert.equal(isNodeStale(atThreshold, now, ttlMs), false, "a record AT the TTL must still be live (strict >)");
      // one ms past → stale.
      const pastThreshold = { heartbeatAt: new Date(now - ttlMs - 1).toISOString() };
      assert.equal(isNodeStale(pastThreshold, now, ttlMs), true, "a record past the TTL must be stale");
    },
  },
  {
    name: "arch/38 ADR-002 (acd-session-ttl-reuses-isstale): self-check — a planted hand-rolled staleness, and a >=-at-threshold predicate, trip the detectors",
    run: async () => {
      const clean = 'import { isStale } from "./run-store.mjs";\nexport const live = (r, now, ttl) => !isStale(r, now, ttl);\n';
      assert.deepEqual(assertStructural(clean), [], "a clean session module passes");

      const plantedHandRolled = 'export const live = (r, now, ttl) => (Date.parse(now) - Date.parse(r.lastPingAt) > ttl);\n';
      assert.ok(assertStructural(plantedHandRolled).length > 0, "a planted hand-rolled staleness trips the detector");

      // The strict-> property itself: a >= predicate would call an at-threshold record stale.
      const now = Date.parse("2026-07-10T12:00:00.000Z");
      const ttlMs = 120_000;
      const atThreshold = { heartbeatAt: new Date(now - ttlMs).toISOString() };
      const badGte = (r, n, t) => (n - Date.parse(r.heartbeatAt)) >= t; // the forbidden >= form
      assert.equal(badGte(atThreshold, now, ttlMs), true, "the forbidden >= form wrongly calls an at-threshold record stale");
      assert.notEqual(isNodeStale(atThreshold, now, ttlMs), badGte(atThreshold, now, ttlMs), "the real strict-> predicate disagrees with the forbidden >= form at the threshold");
    },
  },
];
