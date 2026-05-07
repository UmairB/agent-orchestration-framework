import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openCatalog, itemsToConfig } from "../src/catalog.mjs";

export const catalogTests = [
  {
    name: "seeds builtin catalog items into sqlite",
    async run() {
      const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-db-"));
      const catalog = await openCatalog({ db: path.join(targetDir, "aof.sqlite") });
      try {
        catalog.seedBuiltins();
        const items = catalog.listItems();
        assert.ok(items.some((item) => item.id === "project-context" && item.kind === "skill"));
        assert.ok(items.some((item) => item.id === "gsd" && item.kind === "framework"));
      } finally {
        catalog.close();
        await rm(targetDir, { recursive: true, force: true });
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
