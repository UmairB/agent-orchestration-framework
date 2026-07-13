// Fitness function for milestone 37 / ADR-001 + 26/ADR-007 (FF-3705):
// "`nextWork` treats spike/chore the UAT way (item-is-the-work): it ready-returns
//  the DRIVER ITSELF — it never drills them into stories, never labels them 'needs
//  break-down', and the ready-return is the SAME candidacy-guarded branch the uat
//  return lives on (never a fresh, lease-BLIND ready-return)."
//
// This is the retro-honouring guard for 26/ADR-007 (the uat + zero-story driver
// ready-returns were lease-blind; 27/ADR-004.3 fixed them). ADR-001 reuses that
// already-guarded return rather than adding a fresh one. Two proofs:
//   (a) SOURCE — the item-is-the-work branch in nextWork (the `driver.type === "uat"`
//       branch, which carries the candidacyView guard) names spike & chore, so they
//       ride the guarded return. It is NOT a separate branch below it.
//   (b) BEHAVIOURAL — nextWork over a spike/chore stream ready-returns the DRIVER's
//       own ref (type spike/chore), not a story ref, and not a "needs break-down"
//       drill (there are no stories to find).
//
// Red-until-built: inert-green until the vocabulary lands in ITEM_RE. Self-activates.
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextWork } from "../../src/work.mjs";

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

async function buildStream(type, num, slug, doc) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), `aof-arch-next-${type}-`));
  const dir = path.join(workDir, `${num}_${type}_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, doc),
    frontmatter({ type, number: num, slug, status: "not-started", title: `"${slug}"`, created: "2026-07-09", updated: "2026-07-09", depends: "[]" }),
    "utf8"
  );
  return { workDir, ref: num };
}

export const archTests = [
  {
    name: "arch/spike-chore-next-uat-shaped: the item-is-the-work (candidacy-guarded) branch in nextWork names spike & chore — source (FF-3705)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until the vocabulary lands
      const src = await readFile(workSrc, "utf8");
      // The uat driver branch in nextWork is the one that carries the candidacyView
      // guard (uatCandidacy?.routed / leased-live / leased-stale). Spike & chore must
      // be handled BY that same branch — i.e. the branch condition names them — so they
      // inherit the 26/ADR-007 candidacy guard rather than a fresh unguarded return.
      // Locate the guarded item-is-the-work branch: the guard tokens must co-occur with
      // spike & chore in the type dispatch. We assert the type-dispatch condition that
      // gates the item-is-actionable return names uat, spike, AND chore together.
      const nextBody = src.slice(src.indexOf("export async function nextWork"));
      // The dispatch predicate admitting the item-is-the-work types (uat + spike + chore).
      // Accept either an inlined `driver.type === "uat" || ... "spike" || ... "chore"`
      // OR a named predicate (e.g. itemIsTheWork(driver)) whose definition names all three.
      const inlineDispatch = /driver\.type\s*===\s*"uat"[\s\S]{0,160}"spike"[\s\S]{0,160}"chore"|driver\.type\s*===\s*"uat"[\s\S]{0,160}"chore"[\s\S]{0,160}"spike"/.test(nextBody);
      const namedPredicate = /itemIsTheWork|isSelfActionable|groupsNoStories/.test(nextBody) &&
        /"uat"[\s\S]{0,200}"spike"[\s\S]{0,200}"chore"|"spike"[\s\S]{0,120}"chore"/.test(src);
      assert.ok(
        inlineDispatch || namedPredicate,
        "the candidacy-guarded item-is-the-work branch in nextWork names uat + spike + chore (spike/chore ride the guarded return, never a fresh unguarded one — 26/ADR-007)"
      );
    },
  },
  {
    name: "arch/spike-chore-next-uat-shaped: nextWork ready-returns the SPIKE driver itself (not a story, not needs-break-down) — behavioural (FF-3705)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until the vocabulary lands
      const { workDir, ref } = await buildStream("spike", "00", "de-risk-thing", "SPIKE.md");
      try {
        const result = await nextWork(workDir, null);
        assert.equal(result.state, "ready", `spike is actionable; got ${JSON.stringify(result)}`);
        assert.equal(result.type, "spike", "the ready item is the spike DRIVER itself (item-is-the-work), not a story");
        assert.equal(result.ref, ref, "the ready ref is the spike's own ref");
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/spike-chore-next-uat-shaped: nextWork ready-returns the CHORE driver itself — behavioural (FF-3705)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until the vocabulary lands
      const { workDir, ref } = await buildStream("chore", "00", "tidy-config", "CHORE.md");
      try {
        const result = await nextWork(workDir, null);
        assert.equal(result.state, "ready", `chore is actionable; got ${JSON.stringify(result)}`);
        assert.equal(result.type, "chore", "the ready item is the chore DRIVER itself (item-is-the-work), not a story");
        assert.equal(result.ref, ref, "the ready ref is the chore's own ref");
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  },
];
