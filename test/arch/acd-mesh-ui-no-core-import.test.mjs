// Fitness function: acd-mesh-ui-no-core-import (milestone 25 / story 02;
// ARCHITECTURE 25/ADR-003 decision 3 — the registry is the only door, the mesh-face
// mirror of 08/ADR-004 inv.3 / acd-work-ui-no-core-import).
//
// "The new fleet web face (`src/mesh-ui-serve.mjs`) imports NO mesh-core/operation
//  module — `mesh-store.mjs`, `mesh-presence.mjs`, `mesh-registry.mjs`,
//  `mesh-sync.mjs`, `./commands/*` — except `./command-core.mjs`; it performs no
//  operation fs write. Positive: it DOES import `./command-core.mjs` (the one door)."
//
// Source-grep the fleet face (comments discounted, the call-form discipline of
// acd-board-write-isolation / acd-work-ui-no-core-import): the ONLY operation-bearing
// local import is `./command-core.mjs`; the deny-list
// mesh-store|mesh-presence|mesh-registry|mesh-sync + `./commands/` is empty; and no
// fs-write call form (writeFile/appendFile) remains — the face is a pure read-only
// transport over invoke("mesh:status").
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");

// Discount `// …` and `/* … */` so a comment naming a verb/module is not a match.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// All `import { … } from "<specifier>"` / `import x from "<specifier>"` statements.
function imports(source) {
  const out = [];
  const re = /import\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(source)) !== null) out.push({ clause: match[1], specifier: match[2] });
  return out;
}

export const archTests = [
  {
    name: "arch/25 ADR-003: the command registry (./command-core.mjs) is the ONLY operation-bearing import in mesh-ui-serve.mjs",
    run: async () => {
      const source = stripComments(await readFile(MESH_UI_SERVE, "utf8"));
      const specifiers = imports(source).map((i) => i.specifier);
      // The door IS imported — the positive assertion a deny-list lint cannot make.
      assert.ok(
        specifiers.includes("./command-core.mjs"),
        "mesh-ui-serve.mjs imports the command registry from ./command-core.mjs (the only door to the fleet data)"
      );
      // No OTHER local ./<module> import brings in fleet-core/operation logic. The
      // deny-list is the mesh-core modules + any direct command-body import.
      const operationBearing = imports(source).filter((i) => {
        const spec = i.specifier;
        if (!spec.startsWith(".")) return false; // node:* / package deps are not fleet-core
        if (spec === "./command-core.mjs") return false; // the door
        return /\.\/mesh-(store|presence|registry|sync)\.mjs$/.test(spec) || spec.startsWith("./commands/");
      });
      assert.deepEqual(
        operationBearing.map((i) => i.specifier),
        [],
        "mesh-ui-serve.mjs imports no mesh-store/mesh-presence/mesh-registry/mesh-sync/commands/* — only ./command-core.mjs"
      );
    },
  },
  {
    name: "arch/25 ADR-003: mesh-ui-serve.mjs reaches the fleet aggregate ONLY via invoke(mesh:status) — no direct mesh-core read",
    run: async () => {
      const source = stripComments(await readFile(MESH_UI_SERVE, "utf8"));
      // Positive: it invokes the ONE registered fleet-data command (ADR-002).
      assert.ok(
        /invoke\s*\(\s*["']mesh:status["']/.test(source),
        "mesh-ui-serve.mjs reaches the fleet aggregate via invoke(\"mesh:status\", …) — the single data command"
      );
      // It never names a mesh-core read directly (readRegistry / readNodeRecords /
      // readPresenceRecord would each be a second data path bypassing mesh:status).
      for (const reader of ["readRegistry", "readNodeRecords", "readPresenceRecord", "readNodeRecord", "publishNodeRecord"]) {
        assert.ok(
          !new RegExp(`\\b${reader}\\s*\\(`).test(source),
          `mesh-ui-serve.mjs makes no ${reader}( call — the fleet read flows through invoke("mesh:status"), not a direct mesh-core read`
        );
      }
    },
  },
  {
    name: "arch/25 ADR-003/004: mesh-ui-serve.mjs runs no operation filesystem write of its own (read-only face)",
    run: async () => {
      const source = stripComments(await readFile(MESH_UI_SERVE, "utf8"));
      // Call form `\bverb\s*\(` — a read-only transport writes nothing to disk. (The
      // face reads static bundle files, so readFile is legitimate; a WRITE is not.)
      for (const verb of ["writeFile", "appendFile", "writeFileSync", "appendFileSync", "mkdir", "rm", "rename"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(source),
          `mesh-ui-serve.mjs makes no ${verb}( call — the fleet face writes nothing (read-only render, ADR-004)`
        );
      }
    },
  },
];
