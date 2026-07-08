// Fitness function: acd-lease-arbitration-git-observed (milestone 26 / story 01,
// ADR-003 step d + ADR-004.3.4 / fitness #8) — "Arbitration is git-observed ONLY":
//
//   - the hold/stand-down resolver in src/mesh-lease.mjs is PURE over git-read
//     claims + presence: the module imports NO cache/subscriber/relay module (and no
//     sync engine — the runner is INJECTED), so the in-memory lease cache can only
//     ever cause a SKIP/DEFER (in the command overlay), never a HOLD;
//   - positively, it DOES import mesh-store (the claim path seam) + mesh-presence
//     (the one staleness clock) — the sanctioned inherited seams;
//   - the resolver's inputs are disk-read claims + presence data
//     (resolveArbitration(ownNodeId, claims, presenceById, nowMs, thresholdMs)).
//
// Import-grep with the m03 non-vacuous planted-violation self-checks.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const LEASE_MODULE = new URL("../../src/mesh-lease.mjs", import.meta.url);

// The forbidden couplings: relay (any mesh-relay*), the subscriber, the in-memory
// cache, and the sync engine (the runner is injected — never imported).
const FORBIDDEN_MODULE = /(^|\/)(mesh-relay[^/]*|mesh-presence-subscriber|mesh-presence-cache|mesh-sync)\.mjs$/;
// The pure resolver's data-only signature (disk-read claims + presence + injected clock).
const RESOLVER_SIGNATURE_RE = /export\s+function\s+resolveArbitration\s*\(\s*ownNodeId\s*,\s*claims\s*,\s*presenceById\s*,\s*nowMs\s*,\s*thresholdMs\s*\)/;

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

export const archTests = [
  {
    name: "arch/lease-arbitration-git-observed: src/mesh-lease.mjs imports NO cache/subscriber/relay/sync module — the cache can never cause a HOLD",
    async run() {
      const specs = importSpecifiers(stripComments(await readFile(LEASE_MODULE, "utf8")));
      const forbidden = specs.filter((s) => FORBIDDEN_MODULE.test(s));
      assert.deepEqual(
        forbidden,
        [],
        `mesh-lease.mjs imports no relay/subscriber/cache/sync module — imports: ${specs.join(", ")}`
      );
      // Self-check (non-vacuous): the matcher catches every forbidden form…
      for (const bad of [
        "./mesh-relay.mjs",
        "./mesh-relay-client.mjs",
        "./mesh-presence-subscriber.mjs",
        "./mesh-presence-cache.mjs",
        "./mesh-sync.mjs",
      ]) {
        assert.ok(FORBIDDEN_MODULE.test(bad), `the matcher catches a planted ${bad} import`);
      }
      // …and spares the sanctioned seams (mesh-presence is NOT mesh-presence-cache).
      assert.ok(!FORBIDDEN_MODULE.test("./mesh-store.mjs"), "the matcher spares ./mesh-store.mjs");
      assert.ok(!FORBIDDEN_MODULE.test("./mesh-presence.mjs"), "the matcher spares ./mesh-presence.mjs");
    },
  },
  {
    name: "arch/lease-arbitration-git-observed: mesh-lease.mjs DOES import the sanctioned inherited seams — mesh-store (the claim path) + mesh-presence (the one staleness clock)",
    async run() {
      const specs = importSpecifiers(stripComments(await readFile(LEASE_MODULE, "utf8")));
      assert.ok(
        specs.some((s) => /(^|\/)mesh-store\.mjs$/.test(s)),
        "mesh-lease.mjs imports mesh-store.mjs (leaseClaimPath/meshDir — the reserved seam, not a re-derivation)"
      );
      assert.ok(
        specs.some((s) => /(^|\/)mesh-presence\.mjs$/.test(s)),
        "mesh-lease.mjs imports mesh-presence.mjs (isNodeStale/resolveStalenessSeconds — presence IS the lease clock, never a parallel one)"
      );
      // The staleness predicate is IMPORTED, not re-derived: no local `>` age
      // comparison over a heartbeat lives here (isNodeStale is the one boundary).
      const code = stripComments(await readFile(LEASE_MODULE, "utf8"));
      assert.ok(/\bisNodeStale\s*\(/.test(code), "the liveness predicate calls the imported isNodeStale");
      assert.ok(
        !/Date\.parse\s*\([^)]*heartbeatAt/.test(code),
        "mesh-lease.mjs never re-derives the staleness boundary from a heartbeat itself (no private clock)"
      );
    },
  },
  {
    name: "arch/lease-arbitration-git-observed: the resolver is pure over disk-read claims + presence — resolveArbitration(ownNodeId, claims, presenceById, nowMs, thresholdMs)",
    async run() {
      const code = stripComments(await readFile(LEASE_MODULE, "utf8"));
      assert.ok(
        RESOLVER_SIGNATURE_RE.test(code),
        "the hold/stand-down resolver takes ONLY data: (ownNodeId, claims, presenceById, nowMs, thresholdMs)"
      );
      // Self-check (non-vacuous): the signature matcher rejects a resolver that
      // takes a cache/relay input.
      assert.ok(
        !RESOLVER_SIGNATURE_RE.test("export function resolveArbitration(ownNodeId, claims, leaseCache, nowMs, thresholdMs)"),
        "the matcher rejects a planted cache-consuming resolver signature"
      );
    },
  },
];
