// Traceability wiring for milestone 17 / story 02, task 01 —
// tasks/01_descriptor-registered.feature (@executable, all scenarios).
//
// NOTION_DESCRIPTOR is a first-class m12 managed tool: in TOOL_DESCRIPTORS, resolved
// by descriptorFor("notion"), the frozen ADR-004 shape, and provisioned on the npx
// lane (NOT the version-keyed store). One test object per @executable scenario /
// Scenario-Outline row, run fully in-process via the m12 registry seams.
import assert from "node:assert/strict";
import {
  TOOL_DESCRIPTORS,
  NOTION_DESCRIPTOR,
  descriptorFor,
  planProvision,
} from "../src/tool-store.mjs";
import { toolVersionDir, toolStoreRoot } from "../src/paths.mjs";

export const notionDescriptorTests = [
  {
    // Scenario: NOTION_DESCRIPTOR is registered and resolves through descriptorFor.
    name: "notion-descriptor/01 NOTION_DESCRIPTOR is registered and resolves through descriptorFor",
    run() {
      assert.ok(Object.keys(TOOL_DESCRIPTORS).includes("notion"), 'the registered names include "notion"');
      assert.equal(descriptorFor("notion"), NOTION_DESCRIPTOR, 'descriptorFor("notion") returns the NOTION_DESCRIPTOR');
    },
  },

  {
    // Scenario: the descriptor carries the frozen provider, package, version, binary.
    name: "notion-descriptor/01 the descriptor carries the frozen provider, package, version, and binary",
    run() {
      const d = descriptorFor("notion");
      assert.equal(d.provider, "npx", "provider is npx");
      assert.equal(d.packageSpec, "ntn", "packageSpec is ntn");
      assert.equal(d.version, "0.17.0", "version is 0.17.0");
      assert.deepEqual(d.binaries, ["ntn"], "binaries are exactly [ntn]");
    },
  },

  {
    // Scenario: the platform matrix marks win32 supported with the x64-only / Node-22+ note.
    name: "notion-descriptor/01 the descriptor's platform matrix marks win32 supported with the x64-only / Node-22+ note",
    run() {
      const d = descriptorFor("notion");
      const win32 = d.platforms?.win32;
      assert.ok(win32, "a win32 platform entry exists");
      assert.notEqual(win32.supported, false, "win32 is marked supported");
      assert.ok(Array.isArray(win32.prereqs) && win32.prereqs.includes("node>=22") && win32.prereqs.includes("npm>=10"), `win32 records node>=22 and npm>=10 — got: ${JSON.stringify(win32.prereqs)}`);
      assert.ok(/x64/i.test(win32.note) && /arm64/i.test(win32.note), `win32 notes x64-only (no win32-arm64) — got: ${win32.note}`);
    },
  },

  {
    // Scenario: provisioning the descriptor plans the npx lane, not the version-keyed store.
    name: "notion-descriptor/01 provisioning the descriptor plans the npx lane, not the version-keyed store",
    run() {
      const d = descriptorFor("notion");
      const plan = planProvision(d, { dryRun: true });
      assert.equal(plan.provider, "npx", "the plan uses the npx provider lane");
      // The plan does NOT target a version-keyed store directory under the store root.
      const versionDir = toolVersionDir(d.name, d.version);
      const planText = JSON.stringify(plan);
      assert.ok(!planText.includes(versionDir), "the npx plan does not target the version-keyed store dir");
      assert.ok(!planText.includes(toolStoreRoot()) || !planText.includes(`${d.name}`), "the npx plan does not target a store/<notion>/<version> path");
      // Positively: the npx plan carries `items` (frameworks lane), no `versionDir`/`commands` (uv store lane).
      assert.ok(Array.isArray(plan.items), "the npx plan carries framework-lane items");
      assert.equal(plan.versionDir, undefined, "the npx plan has no versionDir (store-lane only)");
    },
  },

  {
    // Scenario Outline: a descriptor plans its own provider lane (npx vs uv).
    name: "notion-descriptor/01 a descriptor plans its own provider lane (npx notion vs uv graphify)",
    run() {
      const rows = [
        { tool: "notion", provider: "npx", lane: "npx", storeTarget: "does not target" },
        { tool: "graphify", provider: "uv", lane: "uv", storeTarget: "targets" },
      ];
      for (const { tool, provider, lane, storeTarget } of rows) {
        const d = descriptorFor(tool);
        assert.equal(d.provider, provider, `${tool} declares provider ${provider}`);
        const plan = planProvision(d, { dryRun: true });
        assert.equal(plan.provider, lane, `${tool} plans the ${lane} lane`);
        const versionDir = toolVersionDir(d.name, d.version);
        if (storeTarget === "targets") {
          assert.equal(plan.versionDir, versionDir, `${tool} (uv) targets the version-keyed store dir`);
        } else {
          assert.ok(!JSON.stringify(plan).includes(versionDir), `${tool} (npx) does not target the version-keyed store dir`);
        }
      }
    },
  },
];
