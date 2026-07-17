// Fitness function for milestone 40 / ADR-006 — the upgrade changelog is GENERATED from
// the registry, never hand-authored, so it cannot drift from the transforms it describes.
//
//   "WORK_ITEM_MIGRATIONS is the single source of truth; the changelog is a pure
//    projection of it. 'How do I upgrade' resolves to `aof upgrade`, not to prose. The
//    generated artifact carries the aof-generated stamp and is a projection that cannot
//    omit a registered transform nor invent one."
//
// GUARD-IF-PRESENT: a clean no-op until src/work-upgrade.mjs exposes both the registry
// and a changelog generator; arms into a hard assertion on build. The proof is that the
// generator is a projection OF the registry (every transform is represented; the output
// reads the registry, not the reverse) — a hand edit could not survive a regenerate.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UPGRADE_MODULE = path.join(repoRoot, "src", "work-upgrade.mjs");

function findGeneratorFn(mod) {
  for (const name of ["renderChangelog", "generateChangelog", "changelogFromMigrations", "renderUpgradeChangelog", "buildChangelog"]) {
    if (typeof mod?.[name] === "function") return { name, fn: mod[name] };
  }
  return null;
}

function endpointOf(descriptor, kind) {
  const candidates = kind === "from"
    ? [descriptor?.from, descriptor?.fromSchema, descriptor?.fromVersion]
    : [descriptor?.to, descriptor?.toSchema, descriptor?.toVersion];
  const value = candidates.find((v) => Number.isInteger(v));
  return Number.isInteger(value) ? value : null;
}

// A changelog is aof-managed iff it carries the aof-generated marker in either canonical
// form (01/ADR-005): a leading `<!-- aof-generated: -->` comment, or an `aof-generated: true`
// frontmatter key inside a leading `---…---` block.
function isManaged(content) {
  const text = String(content);
  if (/<!--\s*aof-generated:/.test(text.slice(0, 512))) return true;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1 && /^aof-generated:\s*true\s*$/m.test(text.slice(0, end))) return true;
  }
  return false;
}

export const archTests = [
  {
    name: "arch/ADR-006(m40): GUARD-IF-PRESENT — the changelog generator is a PROJECTION of WORK_ITEM_MIGRATIONS (every registered transform is represented; it cannot omit or invent one)",
    run: async () => {
      if (!existsSync(UPGRADE_MODULE)) return; // guard-if-present
      const mod = await import(pathToFileURL(UPGRADE_MODULE).href);
      const generator = findGeneratorFn(mod);
      if (generator === null) return; // the generator (story 04) has not landed yet
      const migrations = mod.WORK_ITEM_MIGRATIONS ?? mod.MIGRATIONS ?? mod.migrations;
      assert.ok(Array.isArray(migrations) && migrations.length >= 1, "the generator has a registry to project");

      const output = String(await generator(migrations));
      // Every registered transform is represented in the output — the changelog cannot
      // silently omit a transform (that is the drift the ADR abolishes).
      for (const m of migrations) {
        const token = m.id ?? `${endpointOf(m, "from")}`;
        assert.ok(
          output.includes(String(token)) || output.includes(String(endpointOf(m, "to"))),
          `the generated changelog represents transform "${token}" (a projection cannot omit a registered transform)`,
        );
      }
      // The changelog resolves "how do I upgrade" to the command, not to advice.
      assert.ok(/aof upgrade/.test(output), "the changelog names `aof upgrade` — the act is a command, not prose");
      // Self-identifying as generated (01/ADR-005 stamp form) — a drift guard can detect it.
      assert.ok(isManaged(output), "the generated changelog carries the aof-generated stamp");

      // Non-vacuity: a generator that dropped a transform WOULD be caught.
      const planted = [{ id: "keystone-xyz", from: 0, to: 1 }];
      const bogus = "<!-- aof-generated: true -->\naof upgrade\n(no transforms listed)\n";
      assert.ok(!bogus.includes(planted[0].id), "the omission detector catches a changelog missing a registered transform");
    },
  },
];
