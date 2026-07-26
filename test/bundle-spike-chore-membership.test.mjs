// Traceability wiring for milestone 37 / story 01
// tasks/02_bundle-membership.feature — "the spike & chore commands and templates
// are members of the ACD asset bundle".
//
// Asserted the way the milestone-01 bundle tests do it (test/bundle.test.mjs,
// test/arch/acd-bundle-membership.test.mjs, test/arch/acd-bundle-manifest-hashes.test.mjs):
// load the REAL descriptor, resolve REAL on-disk files, and hash the REAL
// re-rendered content against the shipped manifest — no engine code authored here.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadBundle, readDescriptor, renderBundleOutputs, bundleRoot } from "../src/work-bundle.mjs";
import { readShippedManifest } from "../src/work-bundle-manifest.mjs";
import { hashContent } from "../src/lock.mjs";

function descriptorMembers() {
  return readDescriptor().members;
}

function normalize(p) {
  return String(p).replaceAll("\\", "/");
}

export const bundleSpikeChoreMembershipTests = [
  // Scenario: the add-spike and add-chore command docs are declared bundle members
  {
    name: 'bundle/spike-chore-membership: the descriptor declares "add-spike" and "add-chore" as kind "command", and still declares "add-task"/"add-story"',
    run: async () => {
      const byId = new Map(descriptorMembers().map((m) => [m.id, m]));
      const addSpike = byId.get("add-spike");
      const addChore = byId.get("add-chore");
      assert.ok(addSpike, "descriptor declares member add-spike");
      assert.equal(addSpike.kind, "command", "add-spike is kind command");
      assert.ok(addChore, "descriptor declares member add-chore");
      assert.equal(addChore.kind, "command", "add-chore is kind command");

      const addTask = byId.get("add-task");
      const addStory = byId.get("add-story");
      assert.ok(addTask && addTask.kind === "command", "still declares add-task as kind command");
      assert.ok(addStory && addStory.kind === "command", "still declares add-story as kind command");
    },
  },

  // Scenario: the SPIKE.md and CHORE.md templates are declared bundle members
  {
    name: 'bundle/spike-chore-membership: the descriptor declares "spike" and "chore" as kind "template", and still declares "story"/"uat"',
    run: async () => {
      const byId = new Map(descriptorMembers().map((m) => [m.id, m]));
      const spike = byId.get("spike");
      const chore = byId.get("chore");
      assert.ok(spike, "descriptor declares member spike");
      assert.equal(spike.kind, "template", "spike is kind template");
      assert.ok(chore, "descriptor declares member chore");
      assert.equal(chore.kind, "template", "chore is kind template");

      const story = byId.get("story");
      const uat = byId.get("uat");
      assert.ok(story && story.kind === "template", "still declares story as kind template");
      assert.ok(uat && uat.kind === "template", "still declares uat as kind template");
    },
  },

  // Scenario: each new member resolves to an existing bundle file on disk
  {
    name: "bundle/spike-chore-membership: commands/add-spike.md, commands/add-chore.md, templates/spike/SPIKE.md, templates/chore/CHORE.md all exist under the bundle root",
    run: async () => {
      const root = bundleRoot();
      assert.ok(existsSync(path.join(root, "commands", "add-spike.md")), "commands/add-spike.md exists under the bundle root");
      assert.ok(existsSync(path.join(root, "commands", "add-chore.md")), "commands/add-chore.md exists under the bundle root");
      assert.ok(existsSync(path.join(root, "templates", "spike", "SPIKE.md")), "templates/spike/SPIKE.md exists under the bundle root");
      assert.ok(existsSync(path.join(root, "templates", "chore", "CHORE.md")), "templates/chore/CHORE.md exists under the bundle root");
    },
  },

  // Scenario Outline: the manifest hash for "<id>" is a true content address of its re-rendered content
  ...["add-spike", "add-chore", "spike", "chore"].map((id) => ({
    name: `bundle/spike-chore-membership: the shipped manifest entry for "${id}" has a non-empty path, a "sha256:" hash equal to the sha256 of its re-rendered content`,
    run: async () => {
      const manifest = readShippedManifest();
      const rendered = renderBundleOutputs(loadBundle(), { runtimes: manifest.runtimes });
      const renderedById = new Map(rendered.map((o) => [o.resource.id, o]));

      const entries = manifest.entries.filter((e) => e.resource.id === id);
      assert.ok(entries.length > 0, `manifest carries at least one entry for member "${id}"`);

      for (const entry of entries) {
        assert.ok(typeof entry.path === "string" && entry.path.length > 0, `${id} entry has a non-empty path`);
        assert.ok(entry.hash.startsWith("sha256:"), `${id} entry hash begins with "sha256:"; got "${entry.hash}"`);

        // Find the matching rendered output by path (a template member may emit
        // multiple files; a command emits exactly one) — mirrors
        // acd-bundle-manifest-hashes.test.mjs's path-keyed lookup.
        const renderedByPath = new Map(rendered.map((o) => [normalize(o.path), o]));
        const output = renderedByPath.get(normalize(entry.path));
        assert.ok(output, `a rendered output exists for manifest path ${entry.path}`);
        assert.equal(output.resource.id, id, `rendered output at ${entry.path} belongs to member "${id}"`);
        assert.equal(entry.hash, hashContent(output.content), `${id} manifest hash at ${entry.path} equals the sha256 of the re-rendered content`);
      }

      // Non-vacuity: at least one rendered output actually exists for this id.
      assert.ok(renderedById.has(id) || rendered.some((o) => o.resource.id === id), `at least one rendered output exists for member "${id}"`);
    },
  })),
];
