// Fitness function for milestone 37 / ADR-001 (FF-3702):
// "`isDriver` is TRUE for `spike` and `chore` — they sit at the stream root, carry
//  `depends`, and participate in the ordering/gating graph exactly like milestone|uat."
//
// Two proofs: (a) SOURCE — the isDriver predicate names spike & chore (it is
// module-private, so a source grep is the reachable proof); (b) BEHAVIOURAL — a
// spike/chore folder at the stream root is enumerated by listItems as a depth-0
// item with `parent` null (the driver geometry), via the exported resolver.
//
// Red-until-built: both proofs are inert-green until the vocabulary lands in
// ITEM_RE (else listItems would not even enumerate a spike/chore folder). Gated on
// the ITEM_RE alternation.
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listItems } from "../../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workSrc = path.join(repoRoot, "src", "work.mjs");

async function itemTypeAlternation() {
  const src = await readFile(workSrc, "utf8");
  const m = src.match(/const\s+ITEM_RE\s*=\s*\/\^\(\\d\+\)_\(([^)]+)\)_/);
  if (!m) return null;
  return new Set(m[1].split("|").map((t) => t.trim()));
}
async function vocabularyLanded() {
  const types = await itemTypeAlternation();
  return types != null && types.has("spike") && types.has("chore");
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// A stream with one spike + one chore driver at the root.
async function buildDriverFixture() {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "aof-arch-spike-chore-drivers-"));
  const mk = async (num, type, slug, doc) => {
    const dir = path.join(workDir, `${num}_${type}_${slug}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, doc),
      frontmatter({ type, number: num, slug, status: "not-started", title: `"${slug}"`, created: "2026-07-09", updated: "2026-07-09", depends: "[]" }),
      "utf8"
    );
  };
  await mk("00", "spike", "de-risk-thing", "SPIKE.md");
  await mk("01", "chore", "tidy-config", "CHORE.md");
  return workDir;
}

export const archTests = [
  {
    name: "arch/spike-chore-are-drivers: the isDriver predicate names `spike` and `chore` (FF-3702, source)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until the vocabulary lands
      const src = await readFile(workSrc, "utf8");
      // The isDriver predicate (or an equivalent item-is-a-driver helper) must admit both.
      const isDriverLine = src.match(/const\s+isDriver\s*=\s*\(item\)\s*=>[^;]+;/);
      assert.ok(isDriverLine, "isDriver predicate is present in src/work.mjs");
      assert.match(isDriverLine[0], /spike/, "isDriver admits `spike`");
      assert.match(isDriverLine[0], /chore/, "isDriver admits `chore`");
    },
  },
  {
    name: "arch/spike-chore-are-drivers: a spike/chore folder is enumerated as a depth-0 driver (parent null) — behavioural (FF-3702)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until the vocabulary lands
      const workDir = await buildDriverFixture();
      try {
        const items = await listItems(workDir);
        const spike = items.find((i) => i.type === "spike");
        const chore = items.find((i) => i.type === "chore");
        assert.ok(spike, "listItems enumerates the spike as a work item");
        assert.ok(chore, "listItems enumerates the chore as a work item");
        // Driver geometry: depth-0, no parent (mirrors milestone/uat).
        assert.ok(spike.parent == null, `spike is depth-0 (parent null), got ${JSON.stringify(spike.parent)}`);
        assert.ok(chore.parent == null, `chore is depth-0 (parent null), got ${JSON.stringify(chore.parent)}`);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  },
];
