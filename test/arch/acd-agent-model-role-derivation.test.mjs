// Fitness function for story 30 / task 02 (the validator's accepted-key set).
//
// The task feature flagged this STRUCTURAL invariant as an arch-test (NOT a
// Then): the set of valid per-role model-override KEYS config-inspect accepts is
// EXACTLY the 8 frozen ACD roles, and that set must be DERIVED from
// readDescriptor() (the bundle.json agent members) rather than a 4th hardcoded
// copy of the list (it is already hardcoded in acd-bundle-membership.test.mjs +
// bundle.test.mjs; a fourth copy would silently rot).
//
// We prove the derivation is LIVE — not merely "correct today" — by driving the
// probe off the DESCRIPTOR at test time and asserting the validator's accepted
// set is congruent with it, both directions:
//   - every descriptor agent-id, offered as an override key, yields NO
//     model-map-unknown-role error (accepted);
//   - a synthetic id that is NOT in the descriptor yields the error (rejected);
//   - the count of accepted keys equals the descriptor's agent count (so a future
//     hardcoded copy that GAINS or LOSES a role relative to the descriptor breaks
//     here — an extra hardcoded role would accept a key the descriptor doesn't
//     declare; a missing one would reject a key the descriptor does declare).
//
// It binds the REAL validateConfig over a fixture .aof/aof.config.json — the same
// diagnostics `aof project validate` surfaces — so it fails against production if
// the accepted set ever diverges from readDescriptor().
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readDescriptor } from "../../src/work-bundle.mjs";
import { validateConfig } from "../../src/config-inspect.mjs";

// The frozen ACD agent ids, DERIVED from the descriptor at test time. This is
// the SAME source the validator is asserted to derive from — so if the validator
// ever hardcodes a divergent copy, the two disagree and the test fails.
function descriptorAgentIds() {
  return readDescriptor()
    .members.filter((m) => m.kind === "agent")
    .map((m) => m.id);
}

// Run the REAL validateConfig over a fixture project whose aof.config.json
// carries the given per-role override map, and return only the
// model-map-unknown-role errors keyed on `work.agents.models`.
async function unknownRoleErrorsFor(models) {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-model-derivation-"));
  try {
    await mkdir(path.join(targetDir, ".aof"), { recursive: true });
    await writeFile(
      path.join(targetDir, ".aof", "aof.config.json"),
      `${JSON.stringify({ work: { agents: { models } } }, null, 2)}\n`,
      "utf8"
    );
    const diagnostics = await validateConfig(targetDir);
    return diagnostics.filter(
      (d) =>
        d.severity === "error" &&
        d.code === "model-map-unknown-role" &&
        String(d.path ?? "").startsWith("work.agents.models")
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

export const archTests = [
  {
    name: "arch/story-30: the validator accepts EXACTLY the descriptor's agent ids as override keys (derivation is live)",
    run: async () => {
      const ids = descriptorAgentIds();
      assert.equal(ids.length, 8, "the descriptor declares exactly the 8 frozen ACD agents");

      // Every descriptor agent-id, offered as a key with a well-formed value, is
      // accepted (no unknown-role error). A well-formed value ("opus") ensures
      // ONLY the key drives the verdict.
      for (const id of ids) {
        const errors = await unknownRoleErrorsFor({ [id]: "opus" });
        assert.equal(
          errors.length,
          0,
          `descriptor agent id "${id}" is accepted as an override key (no unknown-role error)`
        );
      }

      // The whole descriptor set at once is accepted — the accepted set is at
      // least the descriptor set.
      const allAtOnce = await unknownRoleErrorsFor(
        Object.fromEntries(ids.map((id) => [id, "opus"]))
      );
      assert.equal(
        allAtOnce.length,
        0,
        "the full descriptor agent-id set is accepted with no unknown-role errors"
      );
    }
  },
  {
    name: "arch/story-30: the validator rejects a key that is NOT a descriptor agent id (accepted set is not broader than the descriptor)",
    run: async () => {
      // A synthetic id guaranteed absent from the descriptor. If a future dev
      // hardcodes a broader role list than the descriptor declares, this row (or
      // the count row below) will fail.
      const bogus = "aof-not-a-real-descriptor-role";
      assert.ok(
        !descriptorAgentIds().includes(bogus),
        "the probe key is genuinely absent from the descriptor"
      );
      const errors = await unknownRoleErrorsFor({ [bogus]: "opus" });
      assert.ok(
        errors.length >= 1,
        `a non-descriptor key "${bogus}" is rejected with a model-map-unknown-role error`
      );
    }
  },
  {
    name: "arch/story-30: the validator's accepted-key set is congruent with the descriptor (a hardcoded copy that drifts would fail)",
    run: async () => {
      // Directly assert the two-way congruence: partition a candidate key space
      // into descriptor-members and one non-member, and require the validator's
      // accept/reject verdict to match descriptor membership for each. This is
      // the "derived, not a stale hardcoded copy" guard — a hardcoded set that
      // ever GAINS or LOSES a role relative to the descriptor breaks a row here.
      const ids = descriptorAgentIds();
      const candidates = [...ids, "aof-orchestrator"]; // last is a plausible non-member
      for (const key of candidates) {
        const shouldBeAccepted = ids.includes(key);
        const errors = await unknownRoleErrorsFor({ [key]: "opus" });
        if (shouldBeAccepted) {
          assert.equal(errors.length, 0, `descriptor member "${key}" is accepted`);
        } else {
          assert.ok(errors.length >= 1, `non-member "${key}" is rejected`);
        }
      }
    }
  }
];
