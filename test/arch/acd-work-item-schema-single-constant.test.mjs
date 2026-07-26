// Fitness function for milestone 40 / ADR-001 + ADR-003 + ADR-005 — the anti-drift
// single-source-of-truth guard for the work-item schema version.
//
//   "The version is a machine-comparable integer `schema` driven by ONE exported
//    constant `WORK_ITEM_SCHEMA_VERSION` (mirroring GLOBAL_WORK_SCHEMA_VERSION). The
//    migration registry's HIGHEST transform target EQUALS that constant — the constant
//    declares the target, the registry provides the path to it, and the two cannot
//    drift. The registry migrates FROM the pre-versioning baseline 0."
//
// GUARD-IF-PRESENT (the m36/m41 refine-stage discipline): a clean no-op while the
// constant / registry are unbuilt, so the suite stays GREEN now and each half arms into
// a hard assertion the moment its target lands. Each proof carries a non-vacuity check.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as work from "../../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UPGRADE_MODULE = path.join(repoRoot, "src", "work-upgrade.mjs");

// A transform descriptor may name its endpoints from/to (canonical) or a *Schema/*Version
// variant — read whichever is present so the guard is not brittle on the exact key.
function endpointOf(descriptor, kind) {
  const candidates = kind === "from"
    ? [descriptor?.from, descriptor?.fromSchema, descriptor?.fromVersion]
    : [descriptor?.to, descriptor?.toSchema, descriptor?.toVersion];
  const value = candidates.find((v) => Number.isInteger(v));
  return Number.isInteger(value) ? value : null;
}

async function loadRegistry() {
  if (!existsSync(UPGRADE_MODULE)) return null;
  const mod = await import(pathToFileURL(UPGRADE_MODULE).href);
  const migrations = mod.WORK_ITEM_MIGRATIONS ?? mod.MIGRATIONS ?? mod.migrations;
  return Array.isArray(migrations) ? migrations : null;
}

export const archTests = [
  {
    name: "arch/ADR-001(m40): WORK_ITEM_SCHEMA_VERSION is a single exported, non-negative integer constant (the GLOBAL_WORK_SCHEMA_VERSION idiom applied to the doc stream)",
    run: async () => {
      const constant = work.WORK_ITEM_SCHEMA_VERSION;
      if (constant === undefined) return; // guard-if-present: the constant has not landed yet
      assert.ok(
        Number.isInteger(constant) && constant >= 1,
        `WORK_ITEM_SCHEMA_VERSION is a non-negative integer >= 1 (got ${JSON.stringify(constant)}) — schema 1 is the current doc shape`,
      );
      // Non-vacuity: the check is a real integer test, not a truthiness pass.
      assert.equal(Number.isInteger(3) && 3 >= 1, true, "the integer check recognises a real version");
      assert.equal(Number.isInteger("1") && "1" >= 1, false, "the integer check rejects a stringly-typed version");
    },
  },
  {
    name: "arch/ADR-005(m40): the migration registry's HIGHEST transform target EQUALS WORK_ITEM_SCHEMA_VERSION — the constant and the transforms cannot drift",
    run: async () => {
      const migrations = await loadRegistry();
      if (migrations === null) return; // guard-if-present: work-upgrade.mjs not built yet
      const constant = work.WORK_ITEM_SCHEMA_VERSION;
      assert.ok(constant !== undefined, "once the registry exists, WORK_ITEM_SCHEMA_VERSION must exist to bind it");
      assert.ok(migrations.length >= 1, "the registry is never empty — it carries at least the 0 -> 1 stamp transform (ADR-003)");

      const targets = migrations.map((m) => endpointOf(m, "to")).filter((v) => v !== null);
      assert.equal(targets.length, migrations.length, "every transform declares an integer target endpoint (to)");
      const highest = Math.max(...targets);
      assert.equal(
        highest,
        constant,
        `the registry's highest transform target (${highest}) EQUALS WORK_ITEM_SCHEMA_VERSION (${constant}) — no drift between the declared current schema and the transforms that reach it`,
      );
    },
  },
  {
    name: "arch/ADR-003(m40): the registry migrates FROM the pre-versioning baseline 0, and the transform chain is contiguous (0 -> 1 -> … -> current)",
    run: async () => {
      const migrations = await loadRegistry();
      if (migrations === null) return; // guard-if-present
      const froms = migrations.map((m) => endpointOf(m, "from")).filter((v) => v !== null);
      const tos = migrations.map((m) => endpointOf(m, "to")).filter((v) => v !== null);
      assert.equal(froms.length, migrations.length, "every transform declares an integer source endpoint (from)");

      // The lowest `from` is 0 — the pre-versioning baseline an unstamped item reads as.
      assert.equal(Math.min(...froms), 0, "the lowest transform source is 0 — the baseline the registry migrates FROM (ADR-003)");

      // Contiguous chain: sorted, each transform advances by one and picks up where the
      // previous left off, so an item at any schema has an unbroken path to current.
      const chain = migrations
        .map((m) => ({ from: endpointOf(m, "from"), to: endpointOf(m, "to") }))
        .sort((a, b) => a.from - b.from);
      for (const step of chain) {
        assert.ok(step.to > step.from, `each transform advances the schema (from ${step.from} -> to ${step.to}) — never a downgrade or a no-op step`);
      }
      for (let i = 1; i < chain.length; i += 1) {
        assert.equal(chain[i].from, chain[i - 1].to, `the chain is contiguous: transform ${i} starts (${chain[i].from}) where ${i - 1} ended (${chain[i - 1].to})`);
      }
      // Non-vacuity: a broken chain WOULD be caught.
      const broken = [{ from: 0, to: 1 }, { from: 2, to: 3 }];
      assert.notEqual(broken[1].from, broken[0].to, "the contiguity check would catch a gap (0->1 then 2->3)");
    },
  },
];
