import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const archTests = [
  {
    name: "arch/34 ADR-005: global registry query reads projection rows and descriptors, not every workspace",
    async run() {
      const source = await readFile(path.join(repoRoot, "src", "global-node-registry.mjs"), "utf8");
      const queryStart = source.indexOf("export async function queryGlobalRegistry");
      assert.ok(queryStart >= 0, "queryGlobalRegistry is the global registry query surface");
      const querySource = source.slice(queryStart);
      assert.ok(querySource.includes("global_nodes"), "query reads the global node projection");
      assert.ok(querySource.includes("global_workspace_descriptors"), "query reads the global workspace descriptor projection");
      assert.ok(querySource.includes("global_node_workspaces"), "query reads the membership projection");
      assert.ok(!querySource.includes("loadWorkspace"), "query does not open every workspace");
      assert.ok(!querySource.includes("listItems("), "query does not rescan work streams");
      assert.ok(!source.includes('from "./work.mjs"') && !source.includes("from '../work.mjs'"), "registry query module does not import the work stream reader");
    },
  },
];