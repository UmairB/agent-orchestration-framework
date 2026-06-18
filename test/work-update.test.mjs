// Traceability wiring for milestone 01 / story 02 `work-update`.
//
// Every @executable scenario AND every Scenario-Outline Examples row across the
// story's four task features is covered here, exercised against the REAL update
// implementation (`updateWork` in ../src/work-update.mjs) — itself a thin
// orchestrator over the locked engine (no drift logic authored in tests):
//
//   00_classify-against-manifest.feature — skip/update/create classification;
//        --dry-run reports without writing; no manifest refuses → points to init
//   01_no-clobber-without-force.feature  — a locally-edited managed file is
//        drift-warned + preserved; --force overwrites with the new bundle content
//   02_delete-stale-members.feature      — a dropped member is deleted if
//        unmodified, drift-warned + preserved if edited locally
//   03_update-rewrites-manifest.feature  — the rewritten .aof/aof.work.lock.json
//        records the new release + fresh hashes; drift-warned entries preserved;
//        deleted absent; the consumer's own .aof/aof.lock.json untouched
//
// The fixture members `fixture-added-member` / `fixture-dropped-member` are
// SYNTHESIZED, not shipped ACD actors: tests pass `updateWork({ bundleOverride })`
// — a test-only seam that only chooses WHICH bundle is loaded; all
// create/update/skip/drift/delete classification still flows through
// planApplyActions. The "base install" is built with `installBase`, which reuses
// the SAME engine path init uses (synthesize → planApplyActions(null) →
// executeApplyActions → createLockManifest → writeLock) — no hand-rolled drift.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCK_VERSION, writeLock } from "../src/lock.mjs";
import { createLockManifest, executeApplyActions, planApplyActions } from "../src/render-plan.mjs";
import { loadBundle } from "../src/work-bundle.mjs";
import { synthesizeBundleConfig } from "../src/work-bundle-synthesis.mjs";
import { updateWork, workLockPath } from "../src/work-update.mjs";

async function tempRepo(prefix = "aof-update-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function p(dir, ...rel) {
  return path.join(dir, ...rel);
}

function fwd(filePath) {
  return String(filePath).replaceAll("\\", "/");
}

// Build a base install of `bundle` into `repo`, reusing the engine path init uses.
// This is a test fixture builder — NOT a second drift engine: it computes the
// desired set, plans against an EMPTY previousLock, executes, and writes the
// install manifest exactly as init does. It lets a test seed a repo whose manifest
// includes a synthesized fixture member (so update can later drop it).
async function installBase(repo, bundle, runtimes = ["claude"], version = "1.0.0") {
  const { desiredOutputs } = await synthesizeBundleConfig(bundle, { runtimes, targetDir: repo });
  const actions = await planApplyActions(desiredOutputs, null, { force: false, targetDir: repo });
  await executeApplyActions(actions);
  const base = createLockManifest({ actions, desiredOutputs, previousLock: null, config: { packages: [] }, runtimes });
  const manifest = {
    version: LOCK_VERSION,
    generatedAt: base.generatedAt,
    bundle: { version },
    runtimes,
    files: base.files.map((entry) => ({ ...entry, path: fwd(entry.path) })),
    packages: base.packages,
    frameworks: base.frameworks,
    frameworkInstallAttempts: base.frameworkInstallAttempts
  };
  await writeLock(workLockPath(repo), manifest);
  return manifest;
}

// A synthesized agent member that is not a shipped ACD actor.
function fixtureMember(id) {
  return { id, kind: "agent", runtimes: ["claude"], name: id, description: `fixture ${id}`, body: `# ${id}\n\nFixture body for ${id}.\n` };
}

function withMember(bundle, member) {
  return { ...bundle, resources: [...bundle.resources, member] };
}

// A new bundle whose `aof-architect` body differs from the recorded release.
function withChangedArchitect(bundle, marker = "\nUPSTREAM CHANGE\n") {
  return {
    ...bundle,
    resources: bundle.resources.map((res) => (res.id === "aof-architect" ? { ...res, body: res.body + marker } : res))
  };
}

const ARCHITECT_REL = ".claude/agents/aof-architect.md";

function actionsByClass(result, action) {
  return result.actions.filter((item) => item.action === action).map((item) => fwd(item.path));
}

function classOf(result, relPath) {
  const item = result.actions.find((entry) => fwd(entry.path) === relPath);
  return item ? item.action : undefined;
}

export const workUpdateTests = [
  // ====================================================================
  // 00_classify-against-manifest.feature
  // ====================================================================

  {
    name: "work-update/classify: nothing changed since install — every member up-to-date, no file written",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        await installBase(repo, base);
        // Snapshot the disk + manifest before update.
        const architect = p(repo, ".claude", "agents", "aof-architect.md");
        const before = await readFile(architect, "utf8");
        const lockBefore = await readFile(workLockPath(repo), "utf8");

        const result = await updateWork({ targetDir: repo, bundleOverride: base, bundleVersionOverride: "1.0.0" });
        assert.equal(result.notInitialized, false, "not refused");
        // Every action is a skip (up-to-date); none created/updated/deleted/drifted.
        assert.equal(result.summary.created, 0, "nothing created");
        assert.equal(result.summary.updated, 0, "nothing updated");
        assert.equal(result.summary.deleted, 0, "nothing deleted");
        assert.equal(result.summary["drift-warning"], 0, "nothing drifted");
        assert.ok(result.summary.skipped > 0, "members reported up-to-date (skip)");
        // No managed file written or changed.
        assert.equal(await readFile(architect, "utf8"), before, "managed file unchanged on disk");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-update/classify: a member changed upstream + on-disk unmodified — update rewrites it",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        await installBase(repo, base);
        const changed = withChangedArchitect(base);

        const result = await updateWork({ targetDir: repo, bundleOverride: changed, bundleVersionOverride: "2.0.0" });
        assert.equal(classOf(result, ARCHITECT_REL), "update", "aof-architect reported as updated");
        const onDisk = await readFile(p(repo, ".claude", "agents", "aof-architect.md"), "utf8");
        assert.ok(onDisk.includes("UPSTREAM CHANGE"), "file on disk now matches new bundle content");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-update/classify: the bundle adds a new member — update creates it",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        await installBase(repo, base);
        const added = withMember(base, fixtureMember("fixture-added-member"));

        const result = await updateWork({ targetDir: repo, bundleOverride: added, bundleVersionOverride: "2.0.0" });
        const createdRel = ".claude/agents/fixture-added-member.md";
        assert.equal(classOf(result, createdRel), "create", "fixture-added-member reported as created");
        assert.ok(existsSync(p(repo, ".claude", "agents", "fixture-added-member.md")), "new file exists on disk");
        const content = await readFile(p(repo, ".claude", "agents", "fixture-added-member.md"), "utf8");
        assert.ok(content.includes("Fixture body for fixture-added-member"), "new file has the new bundle content");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-update/classify: --dry-run reports update/create/skip and writes/creates/deletes nothing",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        await installBase(repo, base);
        // Changes one member, adds one member, leaves the rest identical.
        const next = withMember(withChangedArchitect(base), fixtureMember("fixture-added-member"));

        const architect = p(repo, ".claude", "agents", "aof-architect.md");
        const architectBefore = await readFile(architect, "utf8");
        const lockBefore = await readFile(workLockPath(repo), "utf8");

        const result = await updateWork({ targetDir: repo, bundleOverride: next, bundleVersionOverride: "2.0.0", dryRun: true });
        assert.equal(result.manifestWritten, false, "manifest not written on dry-run");
        assert.equal(classOf(result, ARCHITECT_REL), "update", "changed member listed as update");
        assert.equal(classOf(result, ".claude/agents/fixture-added-member.md"), "create", "added member listed as create");
        assert.ok(result.summary.skipped > 0, "unchanged members listed as skip");
        // Nothing written, created, or deleted.
        assert.equal(await readFile(architect, "utf8"), architectBefore, "changed member not written");
        assert.ok(!existsSync(p(repo, ".claude", "agents", "fixture-added-member.md")), "added member not created");
        assert.equal(await readFile(workLockPath(repo), "utf8"), lockBefore, "manifest untouched on dry-run");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-update/classify: no install manifest refuses (non-zero) and points to aof work init",
    run: async () => {
      const repo = await tempRepo();
      try {
        assert.ok(!existsSync(workLockPath(repo)), "no work manifest present");
        const result = await updateWork({ targetDir: repo });
        assert.equal(result.notInitialized, true, "refused → CLI maps to non-zero exit");
        assert.equal(result.manifestWritten, false, "wrote nothing");
        assert.equal(result.actions.length, 0, "no actions");
        assert.ok(/not? .*install|No ACD install/i.test(result.message), "reports the repo is not initialized");
        assert.ok(/aof work init/.test(result.message), "directs the user to run aof work init");
        // Nothing written at all.
        assert.ok(!existsSync(workLockPath(repo)), "still no manifest");
        assert.ok(!existsSync(p(repo, ".claude")), "no runtime root written");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: classification from (bundle-vs-manifest) x (disk-vs-manifest).
  {
    name: "work-update/classify: outline — (unchanged,unmodified)=skip (differs,unmodified)=update (new,absent)=create",
    run: async () => {
      // skip: unchanged bundle, unmodified disk.
      {
        const repo = await tempRepo();
        try {
          const base = loadBundle();
          await installBase(repo, base);
          const result = await updateWork({ targetDir: repo, bundleOverride: base, bundleVersionOverride: "1.0.0" });
          assert.equal(classOf(result, ARCHITECT_REL), "skip", "unchanged+unmodified → skip");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // update: content differs, disk unmodified.
      {
        const repo = await tempRepo();
        try {
          const base = loadBundle();
          await installBase(repo, base);
          const result = await updateWork({ targetDir: repo, bundleOverride: withChangedArchitect(base), bundleVersionOverride: "2.0.0" });
          assert.equal(classOf(result, ARCHITECT_REL), "update", "differs+unmodified → update");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // create: new member, absent on disk.
      {
        const repo = await tempRepo();
        try {
          const base = loadBundle();
          await installBase(repo, base);
          const result = await updateWork({ targetDir: repo, bundleOverride: withMember(base, fixtureMember("fixture-added-member")), bundleVersionOverride: "2.0.0" });
          assert.equal(classOf(result, ".claude/agents/fixture-added-member.md"), "create", "new+absent → create");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    }
  },

  // ====================================================================
  // 01_no-clobber-without-force.feature
  // ====================================================================

  {
    name: "work-update/no-clobber: a file edited locally AND changed upstream is preserved and drift-warned",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        await installBase(repo, base);
        const architect = p(repo, ".claude", "agents", "aof-architect.md");
        const edited = `${await readFile(architect, "utf8")}\nLOCAL EDIT\n`;
        await writeFile(architect, edited, "utf8");

        const result = await updateWork({ targetDir: repo, bundleOverride: withChangedArchitect(base), bundleVersionOverride: "2.0.0" });
        assert.equal(classOf(result, ARCHITECT_REL), "drift-warning", "reported as drifted (drift-warning), not overwritten");
        assert.equal(await readFile(architect, "utf8"), edited, "on-disk content unchanged from the local edit");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-update/no-clobber: a locally-edited managed file is recognised as user-modified (hash mismatch triggers protection)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        await installBase(repo, base);
        const architect = p(repo, ".claude", "agents", "aof-architect.md");
        await writeFile(architect, `${await readFile(architect, "utf8")}\nLOCAL EDIT\n`, "utf8");

        const result = await updateWork({ targetDir: repo, bundleOverride: withChangedArchitect(base), bundleVersionOverride: "2.0.0" });
        const item = result.actions.find((entry) => fwd(entry.path) === ARCHITECT_REL);
        assert.equal(item.action, "drift-warning", "the mismatch classifies the file as drift-warning");
        // The reason explains the file no longer matches and that --force is needed.
        assert.match(item.reason, /modified|--force/, `reason explains the no-clobber protection: ${item.reason}`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-update/no-clobber: --force overwrites the locally-edited file with the new bundle content",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        await installBase(repo, base);
        const architect = p(repo, ".claude", "agents", "aof-architect.md");
        await writeFile(architect, `${await readFile(architect, "utf8")}\nLOCAL EDIT\n`, "utf8");

        const result = await updateWork({ targetDir: repo, bundleOverride: withChangedArchitect(base), bundleVersionOverride: "2.0.0", force: true });
        assert.equal(classOf(result, ARCHITECT_REL), "update", "reported as updated under --force");
        const onDisk = await readFile(architect, "utf8");
        assert.ok(onDisk.includes("UPSTREAM CHANGE"), "on-disk content now matches new bundle content");
        assert.ok(!onDisk.includes("LOCAL EDIT"), "the local edit was overwritten");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: changed-upstream member's outcome depends on local edits and --force.
  {
    name: "work-update/no-clobber: outline — (unmodified,no)=update (locally-modified,no)=drift-warn (locally-modified,yes)=force-overwrite",
    run: async () => {
      const base = loadBundle();
      const changed = withChangedArchitect(base);
      // Row 1: unmodified, no force → update.
      {
        const repo = await tempRepo();
        try {
          await installBase(repo, base);
          const result = await updateWork({ targetDir: repo, bundleOverride: changed, bundleVersionOverride: "2.0.0" });
          assert.equal(classOf(result, ARCHITECT_REL), "update", "row1: unmodified+no-force → update");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // Row 2: locally-modified, no force → drift-warn, preserve.
      {
        const repo = await tempRepo();
        try {
          await installBase(repo, base);
          const architect = p(repo, ".claude", "agents", "aof-architect.md");
          const edited = `${await readFile(architect, "utf8")}\nEDIT\n`;
          await writeFile(architect, edited, "utf8");
          const result = await updateWork({ targetDir: repo, bundleOverride: changed, bundleVersionOverride: "2.0.0" });
          assert.equal(classOf(result, ARCHITECT_REL), "drift-warning", "row2: modified+no-force → drift-warn");
          assert.equal(await readFile(architect, "utf8"), edited, "row2: preserved");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // Row 3: locally-modified, force → force-overwrite (update).
      {
        const repo = await tempRepo();
        try {
          await installBase(repo, base);
          const architect = p(repo, ".claude", "agents", "aof-architect.md");
          await writeFile(architect, `${await readFile(architect, "utf8")}\nEDIT\n`, "utf8");
          const result = await updateWork({ targetDir: repo, bundleOverride: changed, bundleVersionOverride: "2.0.0", force: true });
          assert.equal(classOf(result, ARCHITECT_REL), "update", "row3: modified+force → overwrite (update)");
          assert.ok((await readFile(architect, "utf8")).includes("UPSTREAM CHANGE"), "row3: overwritten with bundle content");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    }
  },

  // ====================================================================
  // 02_delete-stale-members.feature
  // ====================================================================

  {
    name: "work-update/delete-stale: a stale member's unmodified file is deleted",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        const withFixture = withMember(base, fixtureMember("fixture-dropped-member"));
        await installBase(repo, withFixture);
        const stale = p(repo, ".claude", "agents", "fixture-dropped-member.md");
        assert.ok(existsSync(stale), "stale member installed on disk");

        // New bundle no longer declares the fixture member.
        const result = await updateWork({ targetDir: repo, bundleOverride: base, bundleVersionOverride: "2.0.0" });
        assert.equal(classOf(result, ".claude/agents/fixture-dropped-member.md"), "delete", "reported as deleted");
        assert.ok(!existsSync(stale), "file no longer exists on disk");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-update/delete-stale: a stale member edited locally is preserved and drift-warned (not deleted)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        const withFixture = withMember(base, fixtureMember("fixture-dropped-member"));
        await installBase(repo, withFixture);
        const stale = p(repo, ".claude", "agents", "fixture-dropped-member.md");
        const edited = `${await readFile(stale, "utf8")}\nLOCAL EDIT\n`;
        await writeFile(stale, edited, "utf8");

        const result = await updateWork({ targetDir: repo, bundleOverride: base, bundleVersionOverride: "2.0.0" });
        assert.equal(classOf(result, ".claude/agents/fixture-dropped-member.md"), "drift-warning", "reported as drifted, not deleted");
        assert.ok(existsSync(stale), "file still exists on disk");
        assert.equal(await readFile(stale, "utf8"), edited, "local-edit content unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: stale member's outcome depends on whether its file was edited.
  {
    name: "work-update/delete-stale: outline — (unmodified)=deleted (locally-modified)=drift-warn,preserved",
    run: async () => {
      const base = loadBundle();
      // Row 1: unmodified → deleted.
      {
        const repo = await tempRepo();
        try {
          await installBase(repo, withMember(base, fixtureMember("fixture-dropped-member")));
          const stale = p(repo, ".claude", "agents", "fixture-dropped-member.md");
          const result = await updateWork({ targetDir: repo, bundleOverride: base, bundleVersionOverride: "2.0.0" });
          assert.equal(classOf(result, ".claude/agents/fixture-dropped-member.md"), "delete", "row1: unmodified → deleted");
          assert.ok(!existsSync(stale), "row1: removed from disk");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // Row 2: locally-modified → drift-warn, preserved.
      {
        const repo = await tempRepo();
        try {
          await installBase(repo, withMember(base, fixtureMember("fixture-dropped-member")));
          const stale = p(repo, ".claude", "agents", "fixture-dropped-member.md");
          const edited = `${await readFile(stale, "utf8")}\nEDIT\n`;
          await writeFile(stale, edited, "utf8");
          const result = await updateWork({ targetDir: repo, bundleOverride: base, bundleVersionOverride: "2.0.0" });
          assert.equal(classOf(result, ".claude/agents/fixture-dropped-member.md"), "drift-warning", "row2: modified → drift-warn");
          assert.equal(await readFile(stale, "utf8"), edited, "row2: preserved");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    }
  },

  // ====================================================================
  // 03_update-rewrites-manifest.feature
  // ====================================================================

  {
    name: "work-update/manifest: rewritten manifest records the new release and the freshly written hashes",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        await installBase(repo, base, ["claude"], "1.0.0");
        const next = withMember(withChangedArchitect(base), fixtureMember("fixture-added-member"));

        const result = await updateWork({ targetDir: repo, bundleOverride: next, bundleVersionOverride: "2.5.0" });
        assert.equal(result.manifestWritten, true, "manifest rewritten");
        const lock = JSON.parse(await readFile(workLockPath(repo), "utf8"));
        assert.equal(lock.bundle.version, "2.5.0", "bundle.version records the new release");

        // Each updated/created member's files[] hash matches the file freshly written.
        const { hashFileIfExists } = await import("../src/lock.mjs");
        for (const item of result.actions.filter((a) => a.action === "update" || a.action === "create")) {
          const rel = fwd(item.path);
          const entry = lock.files.find((f) => f.path === rel);
          assert.ok(entry, `manifest has an entry for ${rel}`);
          const diskHash = await hashFileIfExists(p(repo, ...rel.split("/")));
          assert.equal(entry.hash, diskHash, `${rel} manifest hash matches the file on disk`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-update/manifest: a drift-warned member keeps its previous entry (unchanged, not dropped)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        await installBase(repo, base, ["claude"], "1.0.0");
        const lockBefore = JSON.parse(await readFile(workLockPath(repo), "utf8"));
        const archEntryBefore = lockBefore.files.find((f) => f.path === ARCHITECT_REL);

        // Edit locally + change upstream → drift-warning.
        const architect = p(repo, ".claude", "agents", "aof-architect.md");
        await writeFile(architect, `${await readFile(architect, "utf8")}\nLOCAL EDIT\n`, "utf8");
        const result = await updateWork({ targetDir: repo, bundleOverride: withChangedArchitect(base), bundleVersionOverride: "2.0.0" });
        assert.equal(classOf(result, ARCHITECT_REL), "drift-warning", "the member drifted");

        const lockAfter = JSON.parse(await readFile(workLockPath(repo), "utf8"));
        const archEntryAfter = lockAfter.files.find((f) => f.path === ARCHITECT_REL);
        assert.ok(archEntryAfter, "drift-warned member's entry is NOT dropped from the manifest");
        assert.deepEqual(archEntryAfter, archEntryBefore, "the entry is unchanged from before the update (prior entry preserved)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-update/manifest: rewrite stays valid lock-v2 at the fixed path and never touches the consumer's own lock",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        await installBase(repo, base);
        // The consumer's own lock is present with its own contents.
        await mkdir(p(repo, ".aof"), { recursive: true });
        const ownLockPath = p(repo, ".aof", "aof.lock.json");
        const ownLockContent = `${JSON.stringify({ version: 2, note: "consumer's own apply lock", files: [] }, null, 2)}\n`;
        await writeFile(ownLockPath, ownLockContent, "utf8");

        await updateWork({ targetDir: repo, bundleOverride: withChangedArchitect(base), bundleVersionOverride: "2.0.0" });

        // Work lock is valid lock-v2 at the fixed path.
        const workLock = JSON.parse(await readFile(workLockPath(repo), "utf8"));
        assert.equal(workLock.version, 2, "version 2");
        assert.equal(path.basename(workLockPath(repo)), "aof.work.lock.json", "at the fixed path");
        // The consumer's own lock is byte-for-byte unchanged.
        assert.equal(await readFile(ownLockPath, "utf8"), ownLockContent, "aof.lock.json byte-for-byte unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: each post-update file class maps to its manifest-entry outcome.
  {
    name: "work-update/manifest: outline — updated=new-hash created=new-entry drift-warned=prior-entry deleted=absent",
    run: async () => {
      const repo = await tempRepo();
      try {
        const base = loadBundle();
        // Base install: includes the soon-to-be-stale fixture member.
        const withFixture = withMember(base, fixtureMember("fixture-dropped-member"));
        await installBase(repo, withFixture, ["claude"], "1.0.0");
        const lockBefore = JSON.parse(await readFile(workLockPath(repo), "utf8"));
        const updatedHashBefore = lockBefore.files.find((f) => f.path === ".claude/agents/aof-developer.md").hash;
        const driftEntryBefore = lockBefore.files.find((f) => f.path === ARCHITECT_REL);

        // Set up one of each class:
        //  - updated: aof-developer changes upstream, disk unmodified.
        //  - created: fixture-added-member is new in the bundle.
        //  - drift-warned: aof-architect changes upstream AND was edited locally.
        //  - deleted: fixture-dropped-member removed from the bundle, disk unmodified.
        const architect = p(repo, ".claude", "agents", "aof-architect.md");
        await writeFile(architect, `${await readFile(architect, "utf8")}\nLOCAL EDIT\n`, "utf8");

        const next = {
          ...base, // base has NO fixture-dropped-member → it will be deleted
          resources: [
            ...base.resources.map((res) => {
              if (res.id === "aof-developer") return { ...res, body: res.body + "\nDEV UPSTREAM\n" };
              if (res.id === "aof-architect") return { ...res, body: res.body + "\nARCH UPSTREAM\n" };
              return res;
            }),
            fixtureMember("fixture-added-member")
          ]
        };

        const result = await updateWork({ targetDir: repo, bundleOverride: next, bundleVersionOverride: "2.0.0" });
        const lock = JSON.parse(await readFile(workLockPath(repo), "utf8"));

        // updated → new hash
        assert.equal(classOf(result, ".claude/agents/aof-developer.md"), "update", "developer updated");
        const devEntry = lock.files.find((f) => f.path === ".claude/agents/aof-developer.md");
        assert.notEqual(devEntry.hash, updatedHashBefore, "updated member → new hash");

        // created → new entry
        assert.equal(classOf(result, ".claude/agents/fixture-added-member.md"), "create", "added created");
        assert.ok(lock.files.some((f) => f.path === ".claude/agents/fixture-added-member.md"), "created member → new entry");

        // drift-warned → prior entry preserved
        assert.equal(classOf(result, ARCHITECT_REL), "drift-warning", "architect drift-warned");
        const archEntry = lock.files.find((f) => f.path === ARCHITECT_REL);
        assert.deepEqual(archEntry, driftEntryBefore, "drift-warned member → prior entry preserved");

        // deleted → absent
        assert.equal(classOf(result, ".claude/agents/fixture-dropped-member.md"), "delete", "fixture deleted");
        assert.ok(!lock.files.some((f) => f.path === ".claude/agents/fixture-dropped-member.md"), "deleted member → absent from manifest");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];
