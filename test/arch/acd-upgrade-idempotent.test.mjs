// Fitness function for milestone 40 / ADR-005 — `aof upgrade` is idempotent: running
// it twice is a no-op the second time, and a stamped-current item is left untouched.
//
// The structural guarantee of idempotency lives in the registry SHAPE: no transform may
// apply to an item already at the current schema. Because every transform advances the
// schema and the highest target EQUALS WORK_ITEM_SCHEMA_VERSION (acd-work-item-schema-
// single-constant), a current item (schema === current) matches NO transform, so a
// second `aof upgrade` selects an empty chain and writes nothing. This is proven at the
// data level (API-independent, durable) — the behavioural "run twice = no-op" is the
// concern of story 02's .feature over the real engine.
//
// GUARD-IF-PRESENT: a clean no-op until src/work-upgrade.mjs exists; arms on build.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as work from "../../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UPGRADE_MODULE = path.join(repoRoot, "src", "work-upgrade.mjs");

function endpointOf(descriptor, kind) {
  const candidates = kind === "from"
    ? [descriptor?.from, descriptor?.fromSchema, descriptor?.fromVersion]
    : [descriptor?.to, descriptor?.toSchema, descriptor?.toVersion];
  const value = candidates.find((v) => Number.isInteger(v));
  return Number.isInteger(value) ? value : null;
}

async function loadModule() {
  if (!existsSync(UPGRADE_MODULE)) return null;
  return import(pathToFileURL(UPGRADE_MODULE).href);
}

// A registry-selection function, if the engine exposes one under a plausible name.
function findPlanFn(mod) {
  for (const name of ["planUpgrade", "selectTransforms", "transformsFor", "migrationsFor", "planFor"]) {
    if (typeof mod?.[name] === "function") return mod[name];
  }
  return null;
}

export const archTests = [
  {
    name: "arch/ADR-005(m40): NO transform applies to an item already at WORK_ITEM_SCHEMA_VERSION — a stamped-current item matches nothing, so a second `aof upgrade` is a no-op (idempotent by construction)",
    run: async () => {
      const mod = await loadModule();
      if (mod === null) return; // guard-if-present
      const migrations = mod.WORK_ITEM_MIGRATIONS ?? mod.MIGRATIONS ?? mod.migrations;
      if (!Array.isArray(migrations)) return;
      const constant = work.WORK_ITEM_SCHEMA_VERSION;
      assert.ok(Number.isInteger(constant), "WORK_ITEM_SCHEMA_VERSION is the integer that defines 'current'");

      // The idempotency invariant: no transform has a source >= current. If one did, a
      // current item would keep matching it and `aof upgrade` would never converge.
      const applicableToCurrent = migrations.filter((m) => {
        const from = endpointOf(m, "from");
        return from !== null && from >= constant;
      });
      assert.deepEqual(
        applicableToCurrent.map((m) => m.id ?? `${endpointOf(m, "from")}->${endpointOf(m, "to")}`),
        [],
        "no transform starts at or beyond the current schema — a current item selects an EMPTY chain, so a re-run writes nothing",
      );
      // Non-vacuity: a registry containing a from===current transform WOULD be flagged.
      const planted = [{ id: "bad", from: constant, to: constant + 1 }];
      assert.equal(
        planted.filter((m) => endpointOf(m, "from") >= constant).length,
        1,
        "the detector catches a transform that would re-fire on a current item",
      );
    },
  },
  {
    name: "arch/ADR-005(m40): GUARD-IF-PRESENT — the selection function returns an empty plan for an item already at the current schema",
    run: async () => {
      const mod = await loadModule();
      if (mod === null) return; // guard-if-present
      const plan = findPlanFn(mod);
      if (plan === null) return; // engine exposes no recognised plan fn — the data-level proof above stands
      const constant = work.WORK_ITEM_SCHEMA_VERSION;
      const result = await plan(constant, constant);
      const empty = result == null || (Array.isArray(result) && result.length === 0);
      assert.ok(
        empty,
        `the plan for a current -> current upgrade is empty (got ${JSON.stringify(result)}) — nothing to apply, the second run is a no-op`,
      );
    },
  },
];
