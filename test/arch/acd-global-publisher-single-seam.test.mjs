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
    name: "arch/34 ADR-004: mutation commands and launcher reach the global store only through the shared publisher seam",
    async run() {
      for (const rel of CALLER_FILES) {
        const source = await readFile(path.join(repoRoot, rel), "utf8");
        assert.ok(source.includes("global-work-publisher.mjs"), `${rel} imports the publisher seam`);
        assert.ok(!source.includes("global-work-store.mjs"), `${rel} does not import the SQLite store directly`);
        assert.ok(!source.includes("openGlobalWorkProjectionStore"), `${rel} does not open the global store directly`);
        assert.ok(!source.includes("publishWorkspaceSnapshot"), `${rel} does not call the projection writer directly`);
      }
    },
  },
];
