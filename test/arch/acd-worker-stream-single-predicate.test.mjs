import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Strip // line comments and JS string/template literals so a grep for a CODE
// comparison never false-positives on prose that merely MENTIONS the comparison
// (e.g. an error message documenting the enrollment-authority rule in English).
function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\/[^\n]*/g, "")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

// A worker/control/standalone ROLE-CLASSIFYING comparison in live code: reading
// config.mesh.relay.controlNode and comparing it with === against some node-id-ish
// value. mesh-launcher.mjs's resolveNodeIdentity is the ONE place this is allowed
// (byte-identical to meshRole()'s own internal comparison) — every OTHER module must
// route through mesh-role.mjs's meshRole() instead of re-deriving it privately.
const ROLE_COMPARISON_PATTERN = /relay\??\.controlNode\s*===/;

export const archTests = [
  {
    name: "arch/34 ADR-007: worker/control role is decided by the ONE shared mesh-role predicate",
    async run() {
      const roleSource = await readFile(path.join(repoRoot, "src", "mesh-role.mjs"), "utf8");
      assert.ok(roleSource.includes("export function meshRole"), "mesh-role.mjs exports the shared predicate");
      assert.ok(roleSource.includes('"worker"') && roleSource.includes('"control"') && roleSource.includes('"standalone"'), "meshRole returns the 3-value role");

      // mesh-launcher.mjs is the ONE caller that classifies role today (both the
      // launcher probe and the story-04 stream host read it) — it must route through
      // meshRole(), not re-implement the comparison as a second independent classifier.
      const launcherSource = await readFile(path.join(repoRoot, "src", "mesh-launcher.mjs"), "utf8");
      assert.ok(launcherSource.includes("mesh-role.mjs"), "mesh-launcher.mjs imports the shared mesh-role seam");
      assert.ok(launcherSource.includes("meshRole(config, nodeId)"), "mesh-launcher.mjs calls meshRole(config, nodeId) to classify role");
    },
  },
  {
    name: "arch/34 ADR-007: the story-04 stream modules never privately re-derive worker/control role from config.mesh.relay.controlNode",
    async run() {
      // Scoped to the NEW milestone-34/story-04 surface (mesh-role.mjs's own
      // definition, its ONE caller mesh-launcher.mjs, and the two new stream
      // modules) — pre-existing modules from earlier stories (e.g.
      // global-node-registry.mjs's per-descriptor "is this node the control node"
      // flag, story 34/02) make their OWN, unrelated, already-shipped comparison and
      // are out of THIS story's ownership/contract.
      const mustNotCompare = [
        path.join("src", "worker-stream-client.mjs"),
        path.join("src", "control-stream-server.mjs"),
      ];
      for (const rel of mustNotCompare) {
        const raw = await readFile(path.join(repoRoot, rel), "utf8");
        const codeOnly = stripCommentsAndStrings(raw);
        assert.ok(
          !ROLE_COMPARISON_PATTERN.test(codeOnly),
          `${rel} does not privately compare relay.controlNode === <nodeId> in live code — it consumes an already-classified role/roster`,
        );
      }
    },
  },
];
