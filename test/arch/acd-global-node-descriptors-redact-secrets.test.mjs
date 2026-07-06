import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const archTests = [
  {
    name: "arch/34 ADR-005: global node/workspace descriptor assembly redacts secret-looking fields before persistence",
    async run() {
      const source = await readFile(path.join(repoRoot, "src", "global-node-registry.mjs"), "utf8");
      assert.ok(source.includes("SECRET_KEY_PATTERN"), "descriptor redaction is centralized behind a key pattern");
      assert.ok(/token\|secret\|credential\|auth\|invite\|hash/.test(source), "secret-looking key families are covered");
      assert.ok(source.includes("redactDescriptor(descriptor)"), "JSON descriptor writes pass through redaction");
      assert.ok(!/relayAuthHash\s*[,)]/.test(source), "relay credential hashes are not selected into registry rows");
      assert.ok(!/codeHash\s*[,)]/.test(source), "pending invite hashes are not selected into registry rows");
    },
  },
];