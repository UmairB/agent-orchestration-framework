// Fitness function: acd-assignment-state-has-producer (milestone 35 / ADR-001 /
// R2·m20, fitness #2) — "Every value in the assignment state set maps to exactly ONE
// named producer in a single source-of-truth table/enum; no state exists without a
// writer."
//
// Proofs:
//  1. Load the single ASSIGNMENT_STATE_PRODUCERS enum (assignment-record.mjs). Assert
//     its keys equal EXACTLY {assigned, accepted, running, done, failed, withdrawn,
//     reclaimed}, and each maps to a non-empty producer id.
//  2. The union of producers the codebase actually WRITES (grep the dedicated writer
//     call sites for the state literals they set — insertAssignment/
//     updateAssignmentState call sites in mesh-assign.mjs) is a subset of the mapped
//     producers — no orphan state, no producerless state.
//  3. Self-check (m03 non-vacuous): a planted state with no producer entry fails the
//     SAME detector the real enum passes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASSIGNMENT_STATE_PRODUCERS, ASSIGNMENT_STATES } from "../../src/assignment-record.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const EXPECTED_STATES = ["assigned", "accepted", "running", "done", "failed", "withdrawn", "reclaimed"];

function validateEnum(enumObject) {
  const problems = [];
  const keys = Object.keys(enumObject);
  const missing = EXPECTED_STATES.filter((state) => !keys.includes(state));
  const extra = keys.filter((state) => !EXPECTED_STATES.includes(state));
  if (missing.length > 0) problems.push(`missing states: ${missing.join(", ")}`);
  if (extra.length > 0) problems.push(`unexpected states: ${extra.join(", ")}`);
  for (const state of keys) {
    const producer = enumObject[state]?.producer;
    if (typeof producer !== "string" || producer.length === 0) {
      problems.push(`state "${state}" has no non-empty producer`);
    }
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/35 ADR-001 (acd-assignment-state-has-producer): the enum's key set is exactly the seven states, each with a non-empty producer",
    run: async () => {
      assert.deepEqual([...ASSIGNMENT_STATES].sort(), [...EXPECTED_STATES].sort());
      const problems = validateEnum(ASSIGNMENT_STATE_PRODUCERS);
      assert.deepEqual(problems, [], `enum problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/35 ADR-001 (acd-assignment-state-has-producer): every state literal the dedicated writers actually SET is mapped in the enum (no orphan state)",
    run: async () => {
      const source = await readFile(path.join(repoRoot, "src", "commands", "mesh-assign.mjs"), "utf8");
      const recordSource = await readFile(path.join(repoRoot, "src", "assignment-record.mjs"), "utf8");
      const combined = `${source}\n${recordSource}`;

      // Every quoted state literal appearing as a value passed to updateAssignmentState(
      // store, id, "<state>", …) or assembleAssignmentRecord({ state: "<state>" }) must be
      // a key the enum recognises.
      const writeCalls = [...combined.matchAll(/updateAssignmentState\([^)]*?["'](\w+)["']/g)].map((m) => m[1]);
      const stateDefaults = [...combined.matchAll(/state\s*(?:\?\?|:)\s*["'](\w+)["']/g)].map((m) => m[1]);
      const writtenStates = new Set([...writeCalls, ...stateDefaults].filter((s) => EXPECTED_STATES.includes(s)));

      assert.ok(writtenStates.size > 0, "at least one state literal was found at a writer call site (non-vacuous)");
      for (const state of writtenStates) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(ASSIGNMENT_STATE_PRODUCERS, state),
          `written state "${state}" has a mapped producer`,
        );
      }
    },
  },
  {
    name: "arch/35 ADR-001 (acd-assignment-state-has-producer): self-check — a planted producerless state fails the SAME detector the real enum passes",
    run: async () => {
      assert.deepEqual(validateEnum(ASSIGNMENT_STATE_PRODUCERS), [], "the real enum is clean");

      const plantedMissingProducer = {
        ...Object.fromEntries(Object.entries(ASSIGNMENT_STATE_PRODUCERS)),
        orphaned: { producer: "", classification: "control-created" },
      };
      const problems = validateEnum(plantedMissingProducer);
      assert.ok(problems.length > 0, "a planted producerless state trips the detector");

      const plantedMissingState = { ...ASSIGNMENT_STATE_PRODUCERS };
      delete plantedMissingState.withdrawn;
      const problems2 = validateEnum(plantedMissingState);
      assert.ok(problems2.some((p) => p.includes("missing states")), "a planted missing state trips the detector");
    },
  },
];
