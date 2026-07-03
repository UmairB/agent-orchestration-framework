// Security fitness function: acd-issuance-revoked-issuer-filtered (milestone 27 /
// story 01; SECURITY T4 / S-2; ARCHITECTURE 27/ADR-004.4 — the routing candidacy
// build reads directives under the config.mesh.nodeId gate in commands/next.mjs).
//
// THE THREAT (T4 — revoked-issuer residue). A node REVOKED after issuing (m24
// isRevoked) leaves lingering directives in the git-synced .mesh/ tree / history. If
// a consuming node's `next` keeps honouring them, a revoked member still routes work
// across the fleet after its credential is dead — revocation that only half-applies
// (the relay half rejects it, the routing half does not). This is the 24/T6
// "revocation completeness" property, extended to the NEW routing surface.
//
// THE CONTROL (S-2). The routing read that feeds the candidacy view — the
// readIssuanceDirectives consumption under 27/ADR-004.4 (in src/commands/next.mjs,
// under the config.mesh.nodeId gate) — SKIPS a directive whose `issuer` is revoked,
// reading the LIVE registry (isRevoked / the revocation list), exactly as the relay
// auth-gate reads it (verifyCredential/isRevoked, 24). So revocation applies to
// routing as it applies to the relay.
//
// SPECIFY-at-build / existsSync-guarded posture (the codebase idiom — the routing
// filter is story 01; src/mesh-issuance.mjs + the routing fold in commands/next.mjs
// do not exist on today's tree). This gate is GREEN vacuously now (the routing-filter
// surface is absent — no directive is honoured at all yet, so none is honoured from a
// revoked issuer) and ARMS when story 01 lands the filter: once the routing candidacy
// build consumes issuance directives, that build MUST couple a revocation check to the
// directive `issuer`. It is RED only in the broken half: a routing filter that reads
// directives WITHOUT consulting revocation (T4 left open).
//
// Per the m03 lesson, each assertion pairs the accepted form with a non-vacuous
// planted-violation self-check (the detector fires on a revocation-blind filter and
// stays quiet on the revocation-checking form).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NEXT_CMD = path.join(repoRoot, "src", "commands", "next.mjs");
const ISSUANCE = path.join(repoRoot, "src", "mesh-issuance.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Does this (comment-stripped) source consume issuance directives for routing? — a
// readIssuanceDirectives call or a nodeSatisfiesTarget routing-verdict reference (the
// 27/ADR-003/ADR-004 vocabulary). If neither routing consumer exists, the routing
// surface is absent (vacuously safe — no directive is honoured, so none from a
// revoked issuer). A function DEFINITION is not a consumer: the substrate module
// (mesh-issuance.mjs, story 00) defines this vocabulary without routing anything, so
// definition sites are stripped before the call-site test — the gate arms on a real
// call-site (story 01's candidacy build), never on the substrate landing.
function consumesDirectivesForRouting(code) {
  const withoutDefinitions = code.replace(
    /(?:async\s+)?function\s+(?:readIssuanceDirectives|nodeSatisfiesTarget)\s*\(/g,
    ""
  );
  return (
    /readIssuanceDirectives\s*\(/.test(withoutDefinitions) ||
    /nodeSatisfiesTarget\s*\(/.test(withoutDefinitions)
  );
}

// Does the routing surface couple a revocation check to the directive issuer? — an
// isRevoked call, or a reference to the revocation list adjacent to the directive
// issuer (the live-registry revocation read the relay auth-gate also uses).
function checksRevocation(code) {
  return /isRevoked\s*\(/.test(code) || /\brevocations?\b/i.test(code);
}

export const archTests = [
  {
    name: "arch/27 S-2 (T4 revocation completeness): the routing candidacy build filters directives from revoked issuers (isRevoked) — or the routing surface does not exist yet (SPECIFY-at-build, vacuous-safe)",
    async run() {
      // Gather the routing-surface source across the two homes the filter may live in
      // (the directive read module + the candidacy build in commands/next.mjs).
      const sources = [];
      if (existsSync(ISSUANCE)) sources.push(stripComments(await readFile(ISSUANCE, "utf8")));
      if (existsSync(NEXT_CMD)) sources.push(stripComments(await readFile(NEXT_CMD, "utf8")));

      const routingConsumer = sources.filter(consumesDirectivesForRouting);

      if (routingConsumer.length === 0) {
        // The routing filter is not built yet (or next.mjs does not yet consume
        // directives): no directive is honoured for routing at all, so none from a
        // revoked issuer can be — vacuously safe. Arms when story 01 lands the filter.
        assert.equal(
          routingConsumer.length,
          0,
          "no issuance-directive routing consumer yet — T4 has no surface (the pre-story-01 state)"
        );
      } else {
        // Story 01 landed the routing filter: at least one routing-consuming source
        // MUST also couple a revocation check (the module that reads the directives
        // for routing must consult the live revocation list before honouring them).
        assert.ok(
          routingConsumer.some(checksRevocation),
          "the routing directive-consumer couples a revocation check (isRevoked / the revocation list) — a revoked issuer's directive is skipped (T4 / 24/T6 completeness)"
        );
      }

      // --- non-vacuous planted-violation self-checks (m03) ---
      // A revocation-blind routing filter (the broken half T4 must catch): reads
      // directives + applies the matcher, never consults revocation.
      const blind = stripComments(`
        const directives = await readIssuanceDirectives(workspace);
        for (const d of directives) {
          if (nodeSatisfiesTarget(ownDescriptor, d.target)) {
            candidacy.set(d.itemRef, { verdict: "offer" });
          }
        }
      `);
      assert.ok(consumesDirectivesForRouting(blind), "self-check: the detector sees a planted routing consumer");
      assert.ok(
        !checksRevocation(blind),
        "self-check: the revocation detector FIRES on a revocation-blind routing filter (no isRevoked / revocation-list read)"
      );
      // The accepted revocation-checking form: the detector stays quiet.
      const checked = stripComments(`
        const registry = await readRegistry(workspace);
        const directives = await readIssuanceDirectives(workspace);
        for (const d of directives) {
          if (isRevoked(registry, d.issuer)) continue;
          if (nodeSatisfiesTarget(ownDescriptor, d.target)) {
            candidacy.set(d.itemRef, { verdict: "offer" });
          }
        }
      `);
      assert.ok(consumesDirectivesForRouting(checked), "self-check: the detector sees the guarded routing consumer");
      assert.ok(
        checksRevocation(checked),
        "self-check: the revocation detector ACCEPTS the isRevoked-checking form"
      );
      // A definition-only source (the story-00 substrate shape) is NOT a routing
      // consumer — the gate must not arm on the vocabulary being defined.
      const definitionOnly = stripComments(`
        export async function readIssuanceDirectives(workspace) {
          return [];
        }
        export function nodeSatisfiesTarget(descriptor, target) {
          return false;
        }
      `);
      assert.ok(
        !consumesDirectivesForRouting(definitionOnly),
        "self-check: a definition alone (the substrate module) is not a routing consumer — the gate stays vacuous until a call-site lands"
      );
    },
  },
];
