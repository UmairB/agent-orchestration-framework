import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const BANNED_SQLITE_PACKAGES = new Set([
  "better-sqlite3",
  "sqlite3",
  "sqlite",
  "@sqlite.org/sqlite-wasm",
]);

export const archTests = [
  {
    name: "arch/34 ADR-003: package.json adds no native SQLite dependency for the global work store",
    run: async () => {
      const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.optionalDependencies ?? {}),
      };
      const present = Object.keys(deps).filter((name) => BANNED_SQLITE_PACKAGES.has(name));
      assert.deepEqual(present, [], `no SQLite npm package was added: ${JSON.stringify(present)}`);
    },
  },
  {
    name: "arch/34 ADR-003: global-work-store uses node:sqlite dynamically instead of a package import",
    run: async () => {
      const source = await readFile(path.join(repoRoot, "src", "global-work-store.mjs"), "utf8");
      assert.ok(/import\(\s*["']node:sqlite["']\s*\)/.test(source), "node:sqlite is loaded dynamically");
      assert.ok(!/from\s+["'](?:better-sqlite3|sqlite3|sqlite)["']/.test(source), "no static SQLite package import");
      assert.ok(!/require\(\s*["'](?:better-sqlite3|sqlite3|sqlite)["']\s*\)/.test(source), "no SQLite package require");
    },
  },
];
