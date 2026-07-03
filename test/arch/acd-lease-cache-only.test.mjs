// Fitness function: acd-lease-cache-only (milestone 26, ADR-004.2 / fitness #11) —
// "the lease cache is in-memory only, never a second system of record."
//
//   "The lease-kind apply branch (src/mesh-presence-subscriber.mjs) + the lease cache
//    (createLeaseCache in src/mesh-presence-cache.mjs) perform NO durable write and
//    import NO persist seam — the EXISTING acd-presence-subscriber-cache-only gate's
//    file coverage EXTENDS over the lease additions (the same two modules), and THIS
//    gate adds the lease-specific halves: no leaseClaimPath reference, no mesh-lease
//    write-verb reference, no mesh-lease.mjs import — the cached intent can never join
//    the durable lease path to write. The applied intent is a fast-path projection
//    feeding ONLY the buildLeaseView hint slot (skip/defer), never a lease of record."
//
// The deliberate carve-out (unchanged from the m23 gate): the modules MAY import the
// frozen kind literals from mesh-relay-client.mjs and the frame-size floor from
// mesh-relay.mjs — a const literal and a size floor are not a persist seam.
//
// Three proofs, each paired with the m03 non-vacuous planted-violation self-check, plus
// the positive half (the gate asserts the PRESENCE of what should exist):
//   (a) NO DURABLE WRITE + NO LEASE-PATH JOIN: no writeText/writeFile call and no
//       leaseClaimPath / releaseLease / standDown / acquireLease reference in live code;
//   (b) NO PERSIST-SEAM IMPORT: neither module imports node:fs / fs.mjs /
//       mesh-presence.mjs / mesh-store.mjs / mesh-lease.mjs;
//   (c) THE POSITIVE HALF: createLeaseCache exists, is keyed by the signal's itemRef,
//       ignores non-lease/shape-broken envelopes (behavioural, in-memory), and the
//       subscriber's handler applies the injected leaseCache.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLeaseCache } from "../../src/mesh-presence-cache.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUBSCRIBER = path.join(repoRoot, "src", "mesh-presence-subscriber.mjs");
const CACHE = path.join(repoRoot, "src", "mesh-presence-cache.mjs");
const RECEIVE_MODULES = [SUBSCRIBER, CACHE];

// Comment-stripped (strings RETAINED) — for import-specifier reads.
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Comment-AND-string-stripped — for live-code identifier matchers, so a documenting
// mention never trips the guard; only real code does (the m23 gate's discipline).
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i += 1; continue; }
    if (state === "block") { if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i += 1; continue; }
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; i += 1; continue; }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

const DURABLE_WRITE = /\b(?:writeText|writeFile|writeFileSync|appendFile|appendFileSync|outputFile)\s*\(/;
// The lease-specific durable seam: the claim-path builder + the lease write verbs.
const LEASE_WRITE_SEAM = /\b(?:leaseClaimPath|acquireLease|releaseLease|standDown|withdrawOwnLapsedClaims)\b/;

function importsPersistSeam(specs) {
  return specs.some(
    (s) =>
      /^node:fs(\/promises)?$/.test(s) ||
      /(^|\/)fs\.mjs$/.test(s) ||
      /(^|\/)mesh-presence\.mjs$/.test(s) ||
      /(^|\/)mesh-store\.mjs$/.test(s) ||
      /(^|\/)mesh-lease\.mjs$/.test(s)
  );
}

export const archTests = [
  {
    name: "arch/lease-cache-only: the lease apply branch + lease cache perform NO durable write and never join the lease write seam (no leaseClaimPath / lease write verb in live code)",
    async run() {
      for (const moduleFile of RECEIVE_MODULES) {
        const liveCode = stripCommentsAndStrings(await readFile(moduleFile, "utf8"));
        assert.ok(
          !DURABLE_WRITE.test(liveCode),
          `${path.basename(moduleFile)} calls NO writeText/writeFile/appendFile — the applied lease intent lives in memory only`
        );
        assert.ok(
          !LEASE_WRITE_SEAM.test(liveCode),
          `${path.basename(moduleFile)} references NO leaseClaimPath / lease write verb — the cached intent can never become a lease of record`
        );
      }
      // Self-checks (non-vacuous, the m03 lesson): the detectors fire on planted
      // violations and stay quiet on documented mentions.
      assert.ok(DURABLE_WRITE.test("await writeText(leaseClaimPath(ws, ref, id), body);"), "the write guard catches a real writeText call");
      assert.ok(LEASE_WRITE_SEAM.test("const p = leaseClaimPath(ws, ref, id);"), "the seam guard catches a real leaseClaimPath join");
      assert.ok(LEASE_WRITE_SEAM.test("await releaseLease(ws, ref, id);"), "the seam guard catches a real release write");
      assert.ok(
        !LEASE_WRITE_SEAM.test(stripCommentsAndStrings("// the cache never joins leaseClaimPath to write")),
        "a documented mention alone does not trip the guard"
      );
    },
  },
  {
    name: "arch/lease-cache-only: the lease apply branch + lease cache import NO persist seam (node:fs / fs.mjs / mesh-presence.mjs / mesh-store.mjs / mesh-lease.mjs) — the m23 cache-only gate's coverage extends over the lease additions",
    async run() {
      for (const moduleFile of RECEIVE_MODULES) {
        const specs = importSpecifiers(stripCommentsOnly(await readFile(moduleFile, "utf8")));
        assert.equal(
          importsPersistSeam(specs),
          false,
          `${path.basename(moduleFile)} imports NO persist seam. imports: ${specs.join(", ")}`
        );
      }
      // Self-checks (non-vacuous): the reader catches each planted seam import and
      // stays quiet on the sanctioned kind-literal carve-out.
      assert.ok(importsPersistSeam(importSpecifiers('import { acquireLease } from "./mesh-lease.mjs";')), "the reader catches a real mesh-lease.mjs import");
      assert.ok(importsPersistSeam(importSpecifiers('import { writeText } from "./fs.mjs";')), "the reader catches a real fs.mjs import");
      assert.ok(
        !importsPersistSeam(importSpecifiers('import { LEASE_SIGNAL_KIND } from "./mesh-relay-client.mjs";')),
        "the kind-literal import from mesh-relay-client.mjs is the sanctioned carve-out — not a persist seam"
      );
    },
  },
  {
    name: "arch/lease-cache-only: the positive half — createLeaseCache exists, keys by the signal's itemRef, ignores non-lease/shape-broken envelopes, and the subscriber applies the injected leaseCache",
    async run() {
      // createLeaseCache exists and is a pure in-memory closure.
      assert.equal(typeof createLeaseCache, "function", "createLeaseCache is exported from mesh-presence-cache.mjs");
      const cache = createLeaseCache();
      const claim = { itemRef: "26/02", nodeId: "node-b", state: "claimed", claimedAt: "2026-07-02T12:00:00.000Z", runId: null, aofVersion: "0.1.0" };
      assert.equal(cache.apply({ kind: "lease", nodeId: "node-b", signal: claim }), true, "a valid lease envelope is applied");
      assert.deepEqual(cache.get("26/02"), claim, "the entry is keyed by the signal's itemRef");
      assert.equal(cache.apply({ kind: "presence", nodeId: "node-b", signal: { nodeId: "node-b", heartbeatAt: "x" } }), false, "a presence envelope is ignored by the lease cache");
      assert.equal(cache.apply({ kind: "lease", nodeId: "node-b", signal: "not-an-object" }), false, "a non-object signal is ignored");
      assert.equal(cache.apply({ kind: "lease", nodeId: "node-b", signal: { nodeId: "node-b" } }), false, "a signal with no itemRef is ignored");
      assert.equal(cache.size, 1, "the ignored envelopes stored nothing");
      // The cache source keys by signal.itemRef (the ADR-004.2 keying, in live code).
      const cacheCode = stripCommentsAndStrings(await readFile(CACHE, "utf8"));
      assert.ok(/signal\.itemRef/.test(cacheCode), "the lease cache keys by signal.itemRef in live code");
      // The subscriber's handler applies the injected leaseCache (the additive branch).
      const subCode = stripCommentsAndStrings(await readFile(SUBSCRIBER, "utf8"));
      assert.ok(/\bleaseCache\b/.test(subCode), "the subscriber takes the injected leaseCache");
      assert.ok(/leaseCache\??\.apply\s*\(/.test(subCode), "the subscriber's handler applies frames into the lease cache");
    },
  },
];
