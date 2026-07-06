import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const CALLER_FILES = [
  path.join("src", "commands", "run-start.mjs"),
  path.join("src", "commands", "run-complete.mjs"),
  path.join("src", "commands", "feedback.mjs"),
  path.join("src", "mesh-launcher.mjs"),
];

export const archTests = [
  {
    name: "arch/34 ADR-004: global propagation enablement is decided by one shared predicate",
    async run() {
      const predicateSource = await readFile(path.join(repoRoot, "src", "global-work-publisher.mjs"), "utf8");
      assert.ok(predicateSource.includes("mesh?.enabled === true"), "the shared predicate requires config.mesh.enabled === true");
      assert.ok(predicateSource.includes("mesh-global-disabled"), "the disabled result has the stable skipped code");

      for (const rel of CALLER_FILES) {
        const source = await readFile(path.join(repoRoot, rel), "utf8");
        assert.ok(source.includes("global-work-publisher.mjs"), `${rel} uses the shared global-work-publisher seam`);
        assert.ok(!source.includes("mesh.enabled"), `${rel} does not make its own mesh.enabled decision`);
        assert.ok(!source.includes("config?.mesh?.enabled"), `${rel} does not duplicate the optional-chain predicate`);
      }
    },
  },
];
