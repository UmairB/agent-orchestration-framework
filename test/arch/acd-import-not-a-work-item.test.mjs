// Fitness function for milestone 13 / ADR-004:
// "An import is never a managed work item. Nothing the import materializes is a
//  top-level NN_type_slug folder under workDir; the import store lives OUTSIDE workDir
//  (under .aof/) and is git-ignored via the NESTED .aof/imports/.gitignore baseline (NOT
//  the repo-root .gitignore), so the work-item resolver — listItems/findWork/nextWork/
//  validateWork (ALL via listItems(workDir)) — never enumerates an import as a
//  milestone/story/task/uat. An import is consequently never refine/continue/verify-able."
//
// Mirrors the codebase-graph-derived git-ignore idiom (git status / check-ignore over a
// real temp git repo), pinned to the NESTED store ignore (story 00's `*`+`!.gitignore`),
// NOT the repo root. Halves, all CI-able offline:
//   (a) RESOLVER-EXCLUSION: materialize a FIXTURE import into a temp project, then run
//       listItems(workDir) / findWork / nextWork / validateWork over the work stream and
//       assert NONE returns the import as a resolvable item (a real work-stream milestone
//       IS resolved, so the exclusion is a POSITIVE exclusion, not an empty stream).
//   (b) OUTSIDE-WORKDIR + NON-NN_TYPE_SLUG: importStoreRoot is OUTSIDE workDir; the
//       per-import folder name (import-<ref>) does NOT match ITEM_RE.
//   (c) GIT-IGNORED-NESTED: in a real temp git repo, `git status --porcelain` shows
//       NOTHING under the import store (the nested .aof/imports/.gitignore covers it), the
//       nested ignore file exists, and the repo-root .gitignore was NOT created/touched.
//
// Non-vacuous (the load-bearing trap): the fixture deliberately materializes under a
// sourceSlug `00_milestone_decoy` that WOULD match ITEM_RE — so if a geometry regression
// ever rooted the store under workDir (or named a per-import folder NN_type_slug),
// listItems would enumerate it and (a) would go RED. (b) goes RED if the store root
// landed under workDir; (c) goes RED if the store stopped being git-ignored (the
// materialized .md would show in `git status`) — exactly the drift this pins.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSyncHardened } from "../support/cli-spawn.mjs";
import { fileURLToPath } from "node:url";
import { listItems, findWork, nextWork, validateWork } from "../../src/work.mjs";
import { materializeImport } from "../../src/import/materialize.mjs";
import { importStoreRoot, importMilestoneDir } from "../../src/import/store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// The work-item resolver's ONE rule (mirrors src/work.mjs ITEM_RE) — used to PROVE the
// import store path/folder could never be enumerated, and to make the test non-vacuous.
const ITEM_RE = /^(\d+)_(milestone|story|task|uat)_([a-z0-9-]+)$/;

function fixtureRecovered() {
  return {
    intent: { objective: "Recover the decoy milestone.", scope: "In: snapshot. Out: sync." },
    decisions: [
      { id: "ADR-001", title: "Decoy reuses the seam", status: "Accepted", body: "**Decision.** Decoy reuses the existing seam." },
    ],
    outcomes: [
      { id: "R1", title: "Decoy seam froze first", body: "- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** dev\n\n- **Lesson:** freeze the decoy seam first." },
    ],
  };
}

// A temp project with: a real work-stream milestone "01" (so the resolver DOES resolve
// something — the exclusion is positive), and a fixture import materialized under a
// sourceSlug that WOULD match ITEM_RE were the store ever rooted in workDir (the trap).
const DECOY_SOURCE_SLUG = "00_milestone_decoy"; // matches ITEM_RE if it ever landed under workDir
const DECOY_REF = "00";

async function tempProjectWithImport() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-arch-import-workitem-"));
  const workDir = path.join(projectRoot, "wiki", "work");
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  // A real, resolvable work-stream milestone (positive exclusion control).
  const ms = path.join(workDir, "01_milestone_real-stream");
  await mkdir(ms, { recursive: true });
  await writeFile(path.join(ms, "SPEC.md"), "---\ndoc: spec\ndepends: []\n---\n# 01 Real stream\n", "utf8");
  // Materialize the fixture import (story 00's frozen .aof/ layout).
  await materializeImport({ projectRoot, sourceSlug: DECOY_SOURCE_SLUG, milestoneRef: DECOY_REF, recovered: fixtureRecovered() }, {});
  return { projectRoot, workDir };
}

function git(cwd, args) {
  return spawnSyncHardened("git", args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}

export const archTests = [
  {
    name: "arch/import-not-a-work-item: the resolver (listItems/findWork/nextWork/validateWork) never enumerates the import as a managed item (positive exclusion vs a real milestone)",
    run: async () => {
      const { projectRoot, workDir } = await tempProjectWithImport();
      try {
        const items = await listItems(workDir);
        // The real work-stream milestone IS resolved (so the stream is not empty).
        assert.ok(items.some((i) => i.type === "milestone" && i.number === "01"), "listItems resolves the real work-stream milestone (positive control)");
        // NO item carries the decoy slug / the import ref — the import is invisible.
        assert.ok(!items.some((i) => i.slug === "decoy" || i.name === DECOY_SOURCE_SLUG), "listItems enumerates NO import as a managed item");
        // Every enumerated item's dir is UNDER workDir (the import store under .aof/ is not).
        for (const item of items) {
          const rel = path.relative(workDir, item.dir);
          assert.ok(!rel.startsWith(".."), `enumerated item ${item.name} is under workDir (the import store is not)`);
        }

        // NON-VACUITY (the geometry trap): physically place the ENTIRE materialized import
        // store tree as a top-level folder UNDER workDir — i.e. simulate the worst-case
        // ADR-004 regression where importStoreRoot landed inside workDir. Even then,
        // listItems must NOT enumerate ANY of the import's folder names as a work item,
        // because neither the store dirs (`imports`, the slugged sourceSlug) nor the
        // per-import folder (`import-<ref>`) matches ITEM_RE. This is what makes (a) able
        // to go RED: if the geometry AND the naming both regressed to NN_type_slug, the
        // copied tree's top folder would be enumerated here.
        const realStore = importStoreRoot(projectRoot);
        const transplanted = path.join(workDir, path.basename(realStore)); // workDir/imports
        await mkdir(transplanted, { recursive: true });
        // recursively copy the store tree under workDir/imports/
        const { cp } = await import("node:fs/promises");
        await cp(realStore, transplanted, { recursive: true });
        const afterTransplant = await listItems(workDir);
        for (const item of afterTransplant) {
          // Walk every path component between workDir and the item dir: none may be the
          // import store's own folders (they are not ITEM_RE; listItems only descends into
          // a milestone's `stories/`, never into `imports/`).
          assert.ok(
            item.name !== "imports" && !item.name.startsWith("import-") && item.slug !== "decoy",
            `even transplanted under workDir, the import's folders are not enumerated (saw ${item.name})`
          );
        }
        // Positive control: listItems DID still resolve the real milestone — proving the
        // sweep above is over a non-empty, working resolver (not vacuously empty).
        assert.ok(afterTransplant.some((i) => i.number === "01" && i.type === "milestone"), "the real milestone is still enumerated post-transplant (the resolver works)");

        // findWork over the decoy slug + the import folder name finds nothing.
        const bySlug = await findWork(workDir, "decoy");
        assert.deepEqual(bySlug, [], "findWork(\"decoy\") resolves nothing (the import is not findable)");
        const byFolder = await findWork(workDir, DECOY_SOURCE_SLUG);
        assert.deepEqual(byFolder, [], `findWork(\"${DECOY_SOURCE_SLUG}\") resolves nothing`);

        // nextWork never returns the import as the next driver (the import is not a driver
        // — it is not under workDir, so it never enters the driver set).
        const next = await nextWork(workDir, null);
        assert.ok(
          !JSON.stringify(next ?? {}).includes("decoy") && !JSON.stringify(next ?? {}).includes("imports"),
          "nextWork never selects the import as the next item"
        );

        // validateWork raises no finding that references the import store / decoy folder.
        const findings = await validateWork(workDir, { name: "fixture" }, null);
        assert.ok(
          !findings.some((f) => String(f.path ?? "").includes("decoy") || String(f.path ?? "").includes("imports")),
          "validateWork raises no finding over the import (it is not in the validated stream)"
        );
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-not-a-work-item: the import store is OUTSIDE workDir and uses no NN_type_slug folder name (structural exclusion, even with a decoy ITEM_RE-shaped sourceSlug)",
    run: async () => {
      const { projectRoot, workDir } = await tempProjectWithImport();
      try {
        const root = importStoreRoot(projectRoot);
        // The store root is OUTSIDE workDir (a path.relative that escapes upward).
        const relToWork = path.relative(workDir, root);
        assert.ok(relToWork.startsWith(".."), `the import store root is OUTSIDE workDir (relative: ${relToWork})`);
        // The store root is UNDER .aof/ (the derived-artifact home).
        assert.ok(path.basename(path.dirname(root)) === ".aof", "the import store root is under .aof/");

        // The per-import folder name is `import-<ref>` — it does NOT match ITEM_RE even
        // though the sourceSlug itself is ITEM_RE-shaped (the trap). The TRAP proves
        // non-vacuity: if the materialize ever rooted under workDir OR named the folder
        // NN_type_slug, listItems would catch it.
        const dir = importMilestoneDir(projectRoot, DECOY_SOURCE_SLUG, DECOY_REF);
        const folder = path.basename(dir);
        assert.ok(!ITEM_RE.test(folder), `the per-import folder "${folder}" does NOT match the work-item pattern`);
        // Sanity: the decoy sourceSlug WOULD have matched ITEM_RE — so the trap is armed.
        assert.ok(ITEM_RE.test(DECOY_SOURCE_SLUG), "the decoy sourceSlug IS ITEM_RE-shaped (the non-vacuity trap is armed)");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-not-a-work-item: the import store is git-ignored via the NESTED .aof/imports/.gitignore (never the repo-root .gitignore); git status shows nothing under it",
    run: async () => {
      const { projectRoot } = await tempProjectWithImport();
      try {
        // The nested ignore the materialize wrote (story 00's `*` + `!.gitignore`).
        const nestedGitignore = path.join(importStoreRoot(projectRoot), ".gitignore");
        assert.ok(existsSync(nestedGitignore), ".aof/imports/.gitignore exists (the nested store ignore)");
        assert.ok(!existsSync(path.join(projectRoot, ".gitignore")), "the repo-root .gitignore was NOT created/touched (F-02 nested discipline)");

        // In a REAL temp git repo, the materialized import shows in NO `git status` — the
        // nested ignore covers the whole store (it is re-derivable, never committed).
        const init = git(projectRoot, ["init", "-q"]);
        assert.equal(init.status, 0, "git init succeeded in the temp project");
        git(projectRoot, ["config", "user.email", "fixture@aof.local"]);
        git(projectRoot, ["config", "user.name", "aof fixture"]);
        const porcelain = git(projectRoot, ["status", "--porcelain"]);
        assert.equal(porcelain.status, 0, "git status ran");
        const linesUnderStore = porcelain.stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .filter((l) => /(^|[\s"])\.aof[\/\\]imports[\/\\]/.test(l) && !/\.gitignore"?$/.test(l));
        assert.deepEqual(
          linesUnderStore,
          [],
          `git status shows NO materialized import content (the nested ignore covers the store); saw: ${linesUnderStore.join(" | ")}`
        );

        // And git agrees the nested file is the source of the ignore (build-independent of
        // the root): check-ignore -v on a materialized artifact resolves to the nested file.
        const artifact = "./.aof/imports/" + DECOY_SOURCE_SLUG + "/import-" + DECOY_REF + "/ARCHITECTURE.md";
        const ci = git(projectRoot, ["check-ignore", "-v", artifact]);
        assert.equal(ci.status, 0, `git check-ignore confirms the materialized artifact is ignored (${artifact})`);
        const ignoreSource = ci.stdout.split(":")[0].trim();
        assert.ok(
          path.normalize(ignoreSource).includes(path.normalize(path.join(".aof", "imports", ".gitignore"))),
          `the ignore source is the NESTED .aof/imports/.gitignore (not the repo root); git reported: "${ignoreSource}"`
        );
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
];
