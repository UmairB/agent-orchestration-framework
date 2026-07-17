// Fitness function for milestone 39 / ADR-005 (PRESENCE meta-fitness):
// "A dangling-declaration fitness function (record-format-field-has-a-producer,
//  story 04's deliverable) EXISTS under test/arch and is wired into the assembled
//  runner registry. Its BEHAVIOUR is story 04's; its PRESENCE is a milestone
//  invariant — and once the delivery-memory machinery lands (`parseOutcome`
//  exported), its presence is NON-OPTIONAL (the honesty half of the SPEC cannot be
//  dropped — otherwise the milestone 'ships an honesty box for a liar')."
//
// Idiom (mirrors acd-roundtrip-registration): a NON-VACUOUS live assertion armed
// TODAY — the nearest prior-art declared-surface-has-a-producer fitness function
// (acd-assignment-state-has-producer, 35/ADR-001) exists, exports a non-empty
// archTests, and is REGISTERED in the assembled suite — so de-registering the
// idiom's precedent (or breaking the registry-read mechanism) goes RED today.
// Red-until-built: the story-04 presence gate self-activates once parseOutcome is
// exported, then requires a milestone-39 declared-field-has-a-producer check to be
// registered.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const archDir = path.dirname(fileURLToPath(import.meta.url));
// scripts/test.mjs runs its suite ONLY as the entry point, so importing it here is a
// pure, side-effect-free read of the assembled registration (lazy — see below).
const runnerUrl = new URL("../../scripts/test.mjs", import.meta.url).href;

const PRIOR_ART = "acd-assignment-state-has-producer.test.mjs";

async function assembledNames() {
  const { tests } = await import(runnerUrl);
  return new Set(tests.map((t) => t.name));
}

async function parseOutcomeLanded() {
  const mod = await import("../../src/memory/local-indexing.mjs");
  return typeof mod.parseOutcome === "function";
}

export const archTests = [
  {
    name: "arch/39 ADR-005 (present): the prior-art declared-surface-has-a-producer fitness function is on disk and REGISTERED in the assembled suite — LIVE, non-vacuous",
    run: async () => {
      const entries = await readdir(archDir);
      assert.ok(entries.includes(PRIOR_ART), `${PRIOR_ART} exists on disk (the idiom's precedent)`);

      const mod = await import(pathToFileURL(path.join(archDir, PRIOR_ART)).href);
      assert.ok(Array.isArray(mod.archTests) && mod.archTests.length > 0, `${PRIOR_ART} exports a non-empty archTests`);

      const names = await assembledNames();
      for (const test of mod.archTests) {
        assert.ok(
          names.has(test.name),
          `prior-art "${test.name}" is registered in the assembled runner suite (the registry-wiring mechanism works)`,
        );
      }
    },
  },
  {
    name: "arch/39 ADR-005 (present): once parseOutcome has landed, a milestone-39 declared-field-has-a-producer fitness function is registered (the honesty half is non-optional) — self-activates",
    run: async () => {
      if (!(await parseOutcomeLanded())) return; // inert-green until the delivery-memory machinery lands

      const names = [...(await assembledNames())];
      // Story 04's deliverable: a "declared record-format field with no producer"
      // check. Its registered test name will reference milestone 39 / ADR-005 and the
      // producer/dangling/declared invariant — and is NOT this presence meta-test, NOT
      // the assignment-state prior art.
      const candidate = names.filter((name) => {
        const n = name.toLowerCase();
        const isMilestone39Producer =
          /\b39\b/.test(name) && (n.includes("producer") || n.includes("dangling") || n.includes("declared"));
        const isThisPresenceTest = n.includes("(present)");
        const isPriorArt = n.includes("assignment");
        return isMilestone39Producer && !isThisPresenceTest && !isPriorArt;
      });
      assert.ok(
        candidate.length > 0,
        "delivery memory has landed (parseOutcome) — a milestone-39 declared-field-has-a-producer fitness function must be registered (ADR-005: the honesty half is non-optional)",
      );
    },
  },
];
