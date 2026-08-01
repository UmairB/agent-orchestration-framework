// Fitness functions for m42 wave (d) leg d4, PORT 3 (PRD-command-spine-effects-
// ledger: "insert/reindex emits `stream.reindexed` (run-record refs, Notion
// sidecar, projection remap) — the silent page mis-binding dies").
//
// THE DEFECT THIS CLOSES. `aof work insert-*` opens a slot by renaming folders and
// rewriting the `depends`/`parent` values that name the moved numbers, and stops
// there. But an item's REF is the join key of six other stores, and the renumber
// told none of them:
//
//   run records      keep stamping the ref the item used to have;
//   the Notion map   keeps binding `03 -> <pageId>`, so the next sync PATCHes that
//                    page with whatever item is `03` NOW — content written onto
//                    another item's page, silently (the measured symptom);
//   the projection   keeps its streamed doc/run rows, assignment rows and item
//                    branches keyed on refs that have moved.
//
// The cure is the arc's: DECLARE the consequence. `stream.reindexed` carries the
// OLD → NEW list as its own evidence — it must, because after the renames the old
// refs exist nowhere to be re-derived from.
//
//   (1) THE ENGINE HANDS OVER THE MAP: reindexForInsert returns the remap it
//       computed pre-rename, including the CASCADE (a story's ref changes when its
//       milestone moves, though its own folder never does), collision-free ordered.
//   (2) THE REINDEX IS REACHABLE ONLY THROUGH THE SEAM (no renumber without its
//       event), and the event declares all three remaps at reachable loci.
//   (3) THE MIS-BINDING DIES (behavioural, end-to-end through `invoke`): after an
//       insert that shifts a bound item, the sidecar binds the NEW ref to the page,
//       and the shifted item's run records say the new ref.
//   (4) THE PERMUTATION IS DEDUPED: a redelivered event does not shift everything a
//       second time. A ref remap is not idempotent, so this is the reactor
//       contract's other sanctioned option and it must actually hold.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EFFECTS } from "../../src/effects/table.mjs";
import { LOCAL_LOCI } from "../../src/effects/dispatch.mjs";
import { reindexForInsert } from "../../src/work-reindex.mjs";
import { transitionStreamReindexed } from "../../src/effects/stream-transitions.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { startRun, readRuns } from "../../src/run-store.mjs";
import { recordPageId, readMapping, resolvePageId, remapMappingRefs } from "../../src/notion/mapping.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(repoRoot, "src");

// The reindex engine's write door: reachable from its own module and the seam only.
const REINDEX_ALLOWED = new Set(["src/work-reindex.mjs", "src/effects/stream-transitions.mjs"]);

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

function fm(fields) {
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n`;
}

// A stream with two milestones, the second carrying a story — enough for both the
// direct shift (02 → 03) and the CASCADE (02/01 → 03/01).
async function buildStream() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-reindex-cascade-"));
  const workDir = path.join(repo, "wiki", "work");
  const one = path.join(workDir, "01_milestone_first");
  const two = path.join(workDir, "02_milestone_second");
  const story = path.join(two, "stories", "01_story_inner");
  await mkdir(one, { recursive: true });
  await mkdir(story, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(path.join(one, "SPEC.md"), fm({ type: "milestone", number: "01", slug: "first", status: "in-progress" }), "utf8");
  await writeFile(path.join(two, "SPEC.md"), fm({ type: "milestone", number: "02", slug: "second", status: "in-progress" }), "utf8");
  await writeFile(path.join(story, "STORY.md"), fm({ type: "story", number: "01", slug: "inner", parent: "02", status: "in-progress" }), "utf8");
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "reindex-fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8",
  );
  return { repo, workDir };
}

export const archTests = [
  {
    name: "arch/m42-d4-port3: the engine hands over the ref remap it computed pre-rename — including the story cascade — collision-free ordered",
    run: async () => {
      const { repo, workDir } = await buildStream();
      try {
        const result = await reindexForInsert(workDir, { at: 1, space: "top-level" });
        assert.equal(result.shifted, 2, "both milestones shift");
        assert.deepEqual(
          result.remap,
          [
            { from: "02", to: "03" },
            { from: "02/01", to: "03/01" },
            { from: "01", to: "02" },
          ],
          "every moved ref is named, the story CASCADE included, ordered highest-first so no entry writes onto a ref another has yet to vacate",
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/m42-d4-port3: the renumber is reachable only through the transition seam, and every declared remap sits at a locus an ordinary CLI process reaches",
    run: async () => {
      const files = await listSourceFiles(SRC_DIR);
      const offenders = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        if (REINDEX_ALLOWED.has(rel)) continue;
        const code = stripComments(await readFile(file, "utf8"));
        if (/reindexForInsert\s*\(/.test(code)) offenders.push(rel);
      }
      assert.deepEqual(offenders, [], `no caller renumbers without raising its event (offenders: ${offenders.join(", ")})`);

      const reactors = EFFECTS["stream.reindexed"];
      assert.ok(Array.isArray(reactors), "stream.reindexed is a declared event");
      assert.deepEqual(
        reactors.map((reactor) => reactor.key),
        ["remap-run-refs", "remap-notion-map", "remap-projection", "remap-control-facts"],
        "all four remaps are declared, in cascade order (the fact half split out by leg d5)",
      );
      // The sidecar remap is a LOCAL file rewrite, so it must NOT be declared at the
      // integration locus: a plain CLI process reaches checkout + local only, and an
      // integration-locus step would sit deferred forever — leaving the very
      // mis-binding this port exists to kill in place. The node-local three keep
      // that pin; the DISPATCH-FACT half (m42 wave (d) leg d5) is deliberately
      // control-store — the authoritative mesh store's writer pays it (the control
      // tick, or the d3 bridge) — and MUST carry the applicability predicate, or
      // every solo workspace's insert would owe a step no drain on that machine
      // ever reaches (the port-4 leak class).
      for (const reactor of reactors) {
        if (reactor.key === "remap-control-facts") {
          assert.equal(reactor.locus, "control-store", "the fact remap belongs to the authoritative store's writer");
          assert.equal(typeof reactor.applies, "function", "the fact remap is predicated (mesh workspaces only)");
          continue;
        }
        assert.ok(
          LOCAL_LOCI.includes(reactor.locus),
          `${reactor.key} is at a locus an ordinary CLI process drains (got "${reactor.locus}")`,
        );
      }
    },
  },
  {
    name: "arch/m42-d4-port3: the Notion mis-binding dies — after a shift the sidecar binds the NEW ref, and the run records follow (behavioural)",
    run: async () => {
      const { repo, workDir } = await buildStream();
      const globalHome = await mkdtemp(path.join(os.tmpdir(), "aof-reindex-cascade-gh-"));
      const journalOptions = { env: { ...process.env, AOF_GLOBAL_HOME: globalHome } };
      try {
        const workspace = await loadWorkspace(repo);
        const DS = "ds-board";
        // Milestone 02 is bound to a Notion page and has a run record.
        await recordPageId(repo, DS, "02", "page-for-second", { lastStatus: "In progress" });
        await recordPageId(repo, DS, "01", "page-for-first", { lastStatus: "In progress" });
        const two = { ref: "02", dir: path.join(workDir, "02_milestone_second"), type: "milestone" };
        await startRun(two, { now: "2026-07-09T10:00:00.000Z" });

        const result = await transitionStreamReindexed(workspace, { at: 1, space: "top-level" }, { journalOptions });
        assert.ok(result.eventId, "the renumber raised its event durably");
        for (const key of ["remap-run-refs", "remap-notion-map", "remap-projection"]) {
          const outcome = result.effects.find((entry) => entry.key === key);
          assert.ok(outcome, `${key} was drained`);
          assert.equal(outcome.status, "done", `${key} paid (got ${outcome.status}${outcome.error ? `: ${outcome.error}` : ""})`);
        }

        // THE MIS-BINDING: before this port, `02` still pointed at page-for-second
        // while `02` was now the item that used to be `01` — so the next sync wrote
        // milestone-first's content onto milestone-second's page.
        const mapping = await readMapping(repo, DS);
        assert.equal(resolvePageId(mapping, "03"), "page-for-second", "the shifted item's page follows it to its new ref");
        assert.equal(resolvePageId(mapping, "02"), "page-for-first", "…and the ref it vacated now binds the item that moved into it");

        // The run record inside the renamed folder says the new ref.
        const moved = { ref: "03", dir: path.join(workDir, "03_milestone_second"), type: "milestone" };
        const runs = await readRuns(moved);
        assert.equal(runs.length, 1, "the run record travelled with the folder");
        assert.equal(runs[0].itemRef, "03", "…and its itemRef followed the renumber");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(globalHome, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/m42-d4-port3: a redelivered remap does not shift the bindings a second time (event-id deduped — a permutation is not idempotent)",
    run: async () => {
      const { repo } = await buildStream();
      try {
        const DS = "ds-board";
        await recordPageId(repo, DS, "01", "page-a");
        await recordPageId(repo, DS, "02", "page-b");
        const remap = [{ from: "02", to: "03" }, { from: "01", to: "02" }];

        const first = await remapMappingRefs(repo, remap, { eventId: "evt-1" });
        assert.equal(first.remapped, 2, "both bindings move once");
        const afterFirst = await readMapping(repo, DS);
        assert.equal(resolvePageId(afterFirst, "02"), "page-a");
        assert.equal(resolvePageId(afterFirst, "03"), "page-b");

        // At-least-once delivery: the same event arrives again (a crash between the
        // write and the step being marked done). Applying the permutation twice
        // would read 02→03 and 03→… and shift everything a second time.
        const second = await remapMappingRefs(repo, remap, { eventId: "evt-1" });
        assert.equal(second.skipped, true, "the redelivery is a no-op");
        assert.equal(second.reason, "already-applied");
        const afterSecond = await readMapping(repo, DS);
        assert.equal(resolvePageId(afterSecond, "02"), "page-a", "the bindings are unmoved by the redelivery");
        assert.equal(resolvePageId(afterSecond, "03"), "page-b");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
