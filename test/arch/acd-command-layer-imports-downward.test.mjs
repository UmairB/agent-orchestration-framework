// Fitness function: acd-command-layer-imports-downward (milestone 42 wave (d) leg d1;
// PRD-command-spine-effects-ledger §Context — "Layering leaks both ways: four lower
// modules import upward into `commands/`, one confirmed circular import
// (`mesh-worker-execution` ↔ `commands/mesh-repo`)").
//
// THE INVARIANT — the command layer is a LEAF of the module graph:
//
//   (1) NO src-root module (`src/*.mjs`) imports `src/commands/*` — the four measured
//       upward imports (mesh-launcher→mesh-identity, mesh-ui-serve→mesh-assign,
//       mesh-worker-execution→mesh-repo, work-upgrade→commands/errors) are inverted:
//       whatever both layers share lives BELOW `commands/`, and the command keeps only
//       its verb. Exempt: `cli.mjs`, `command-core.mjs` and `spine/*` — the faces and
//       the registry ARE the command layer's own doors, not lower modules.
//
//   (2) NO import cycle exists between `src/commands/*` and `src/*.mjs`. (1) makes a
//       cycle THROUGH the command boundary structurally impossible, so this proof is
//       the direct one: walk every commands/* import edge and assert no target module
//       reaches back into commands/.
//
// Why it matters beyond tidiness: a cycle means module-init order decides which half
// of a pair is defined at first call, which is exactly the class of "works until it
// doesn't" defect m42 exists to end. And an upward import is the tell that a CORE is
// living inside a command — the next caller that needs it either reaches up (spreading
// the leak) or copies it (the several-doors disease).
//
// Detection is source-level and comment-blind (the acd-mesh-ui-no-core-import idiom):
// static `import … from "<specifier>"` statements only. Dynamic `await import()` is
// NOT an edge for this gate — it defers resolution past module init, which is what
// makes it the sanctioned escape hatch on the rare occasion one is needed.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");

// The command layer's own doors — these are ALLOWED to import commands/* because they
// ARE the layer's entry points, not modules underneath it.
const FACE_MODULES = new Set(["cli.mjs", "command-core.mjs"]);

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Static import specifiers only (`import x from "…"` / `import { … } from "…"` /
// `import "…"`). A dynamic import() is deliberately not matched — see the header.
function staticImports(source) {
  const clean = stripComments(source);
  const out = [];
  const re = /import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(clean)) !== null) out.push(match[1]);
  return out;
}

async function readSrcModules(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".mjs")).map((e) => e.name);
}

export const archTests = [
  {
    name: "arch/42 wave (d) d1 (acd-command-layer-imports-downward): no src-root module imports src/commands/* — the command layer is a leaf, not a dependency of the cores",
    run: async () => {
      const modules = await readSrcModules(SRC);
      const offenders = [];
      for (const name of modules) {
        if (FACE_MODULES.has(name)) continue;
        const source = await readFile(path.join(SRC, name), "utf8");
        for (const spec of staticImports(source)) {
          if (spec.startsWith("./commands/")) offenders.push(`${name} → ${spec}`);
        }
      }
      assert.deepEqual(
        offenders,
        [],
        `every src/*.mjs module imports DOWNWARD (found upward imports into the command layer: ${offenders.join(", ")}). ` +
          "Move the shared thing below commands/ — the command keeps its verb, the core moves down " +
          "(m42 wave (d): command-error.mjs, mesh-repo-marker.mjs, mesh-assignment.mjs).",
      );

      // --- self-check: the detector FIRES on a planted upward import.
      const planted = staticImports('import { assignWork } from "./commands/mesh-assign.mjs";').filter((s) =>
        s.startsWith("./commands/"),
      );
      assert.deepEqual(planted, ["./commands/mesh-assign.mjs"], "self-check: a planted upward import is detected");

      // --- self-check: a COMMENT naming an upward import is not a match (comment-blind).
      const commented = staticImports('// import { assignWork } from "./commands/mesh-assign.mjs";').filter((s) =>
        s.startsWith("./commands/"),
      );
      assert.deepEqual(commented, [], "self-check: a commented-out upward import is not counted");
    },
  },
  {
    name: "arch/42 wave (d) d1: no import cycle across the commands/ boundary — nothing a command imports imports commands/ back",
    run: async () => {
      const commandFiles = await readSrcModules(path.join(SRC, "commands"));
      const offenders = [];
      for (const name of commandFiles) {
        const source = await readFile(path.join(SRC, "commands", name), "utf8");
        for (const spec of staticImports(source)) {
          // Only edges that LEAVE the command layer can close a cycle through it.
          if (!spec.startsWith("../")) continue;
          const target = path.basename(spec);
          if (!target.endsWith(".mjs")) continue;
          if (FACE_MODULES.has(target)) continue; // the registry/face doors, exempt above
          let targetSource;
          try {
            targetSource = await readFile(path.join(SRC, target), "utf8");
          } catch {
            continue; // not a src-root module (spine/, effects/, …) — walked by its own path below
          }
          for (const back of staticImports(targetSource)) {
            if (back.startsWith("./commands/")) offenders.push(`commands/${name} → ${target} → ${back}`);
          }
        }
      }
      assert.deepEqual(
        offenders,
        [],
        `no command's dependency reaches back into commands/ (cycles found: ${offenders.join(", ")}). ` +
          "The measured one — mesh-worker-execution.mjs ↔ commands/mesh-repo.mjs — was broken by " +
          "mesh-repo-marker.mjs, which owns the mesh.repo subtree both sides share.",
      );
    },
  },
];
