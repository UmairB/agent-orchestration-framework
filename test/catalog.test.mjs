import assert from "node:assert/strict";
import { openCatalog, itemsToConfig } from "../src/catalog.mjs";

export const catalogTests = [
  {
    name: "catalog starts empty while repo defaults are disabled",
    async run() {
      const catalog = await openCatalog();
      try {
        catalog.seedBuiltins();
        const items = catalog.listItems();
        assert.deepEqual(items, []);
        assert.equal(catalog.path, null);
      } finally {
        catalog.close();
      }
    }
  },
  {
    name: "converts selected catalog items to render config",
    run() {
      const config = itemsToConfig([
        { id: "prime", kind: "command", name: "prime", description: "Prime", body: "Prompt", runtimes: ["codex"] },
        { id: "gsd", kind: "framework", source: "npm:get-shit-done-cc@latest", runtimes: ["codex"] }
      ]);

      assert.equal(config.resources.length, 1);
      assert.equal(config.packages.length, 1);
      assert.equal(config.resources[0].id, "prime");
      assert.equal(config.packages[0].id, "gsd");
    }
  }
];
