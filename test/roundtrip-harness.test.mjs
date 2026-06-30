// Traceability wiring for milestone 04 / story 00 — the round-trip harness.
//
// Every @executable scenario AND every Scenario-Outline Examples row across the
// story's three task features is covered here, driving the REAL harness functions
// (test/support/roundtrip-harness.mjs) — which themselves delegate to the shipped
// engine (initWork) and verbs (findWork/listStream/validateWork). No fixture is
// hand-rolled; the seed is the harness's own fixed fixture.
//
//   00_isolated-repo.feature        — createRoundTripRepo: git repo under
//        os.tmpdir, usable (status+commit), empty-of-bundle before install,
//        cleanup removes the dir, cleanup idempotent across pre-states, distinct
//        independent repos, cleaning one leaves the other intact
//   01_real-install.feature         — installBundle: structured result + a written
//        manifest under .aof/, the manifestWritten/guarded/manifestPath shape,
//        rendered files under .claude/agents + .claude/commands/aof/, runtime
//        forwarding (default + claude), guarded vs force re-install outline
//   02_seed-sample-milestone.feature — seedSampleMilestone: writes the fixture +
//        returns refs, refs resolve through the verbs, refs match disk exactly,
//        the seed validates clean, byte-identical determinism, identical refs
//        across seedings
import assert from "node:assert/strict";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";
import { access, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRoundTripRepo,
  installBundle,
  seedSampleMilestone,
  findWork,
  listStream,
  validateWork
} from "./support/roundtrip-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Recursively list a work-stream's files as { relPath, bytes } for byte-identity
// comparison (forward-slashed rel path so the comparison is OS-stable).
async function streamFiles(root) {
  const out = [];
  async function walk(current, rel) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(full, childRel);
      else out.push({ relPath: childRel, bytes: await readFile(full) });
    }
  }
  await walk(root, "");
  return out;
}

export const roundtripHarnessTests = [
  // ====================================================================
  // 00_isolated-repo.feature
  // ====================================================================
  {
    name: "roundtrip-harness/isolated-repo: the created repo is an initialised git repo under the OS temp root, with a cleanup function",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        assert.equal(typeof repo.dir, "string", "returns a dir path");
        const { realpath } = await import("node:fs/promises");
        const tmpReal = await realpath(os.tmpdir());
        const dirReal = await realpath(repo.dir);
        assert.ok(dirReal.startsWith(tmpReal), `dir ${dirReal} is under os.tmpdir() (${tmpReal})`);
        assert.ok((await stat(path.join(repo.dir, ".git"))).isDirectory(), "dir contains an initialised git repository");
        assert.equal(typeof repo.cleanup, "function", "returns a cleanup function");
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/isolated-repo: the created repo is a usable git repository — git status succeeds and a file can be committed",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        const status = spawnSyncHardened("git", ["status"], { cwd: repo.dir, encoding: "utf8" });
        assert.equal(status.status, 0, "git status exits successfully");

        await writeFile(path.join(repo.dir, "hello.txt"), "hi\n", "utf8");
        const env = {
          ...process.env,
          GIT_AUTHOR_NAME: "Proof",
          GIT_AUTHOR_EMAIL: "proof@example.com",
          GIT_COMMITTER_NAME: "Proof",
          GIT_COMMITTER_EMAIL: "proof@example.com"
        };
        const add = spawnSyncHardened("git", ["add", "hello.txt"], { cwd: repo.dir, encoding: "utf8", env });
        assert.equal(add.status, 0, "git add succeeds");
        const commit = spawnSyncHardened("git", ["commit", "-m", "seed", "--no-gpg-sign"], { cwd: repo.dir, encoding: "utf8", env });
        assert.equal(commit.status, 0, `git commit succeeds: ${commit.stderr ?? ""}`);
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/isolated-repo: a freshly created repo carries no bundle render before install (no .aof/, no .claude/)",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        const entries = await readdir(repo.dir);
        assert.ok(!entries.includes(".aof"), "no .aof/ directory before install");
        assert.ok(!entries.includes(".claude"), "no .claude/ directory before install");
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/isolated-repo: cleanup removes the repo and leaves nothing behind",
    run: async () => {
      const repo = await createRoundTripRepo();
      let cleaned = false;
      try {
        await repo.cleanup();
        cleaned = true;
        assert.equal(await exists(repo.dir), false, "the repo dir no longer exists after cleanup");
      } finally {
        if (!cleaned) await repo.cleanup();
      }
    }
  },
  {
    // Scenario Outline: cleanup is idempotent and safe when the repo is already gone.
    name: "roundtrip-harness/isolated-repo: outline — cleanup is idempotent and safe across pre-states (present / removed out-of-band / cleaned once)",
    run: async () => {
      // Row 1: present (never cleaned) → cleanup removes it.
      {
        const repo = await createRoundTripRepo();
        await repo.cleanup();
        assert.equal(await exists(repo.dir), false, "row1: dir gone after cleanup");
      }
      // Row 2: already removed out-of-band → cleanup resolves without throwing.
      {
        const repo = await createRoundTripRepo();
        await rm(repo.dir, { recursive: true, force: true });
        await assert.doesNotReject(() => repo.cleanup(), "row2: cleanup safe when dir removed out-of-band");
        assert.equal(await exists(repo.dir), false, "row2: dir still gone");
      }
      // Row 3: cleanup() already called once → a second call resolves without throwing.
      {
        const repo = await createRoundTripRepo();
        await repo.cleanup();
        await assert.doesNotReject(() => repo.cleanup(), "row3: second cleanup resolves");
        assert.equal(await exists(repo.dir), false, "row3: dir still gone");
      }
    }
  },
  {
    name: "roundtrip-harness/isolated-repo: each call yields a distinct, independent repo (paths differ, neither inside the other)",
    run: async () => {
      const a = await createRoundTripRepo();
      const b = await createRoundTripRepo();
      try {
        assert.notEqual(a.dir, b.dir, "the two dir paths differ");
        const aSep = a.dir.replaceAll("\\", "/") + "/";
        const bSep = b.dir.replaceAll("\\", "/") + "/";
        assert.ok(!bSep.startsWith(aSep), "b is not inside a");
        assert.ok(!aSep.startsWith(bSep), "a is not inside b");
      } finally {
        await a.cleanup();
        await b.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/isolated-repo: cleaning up one repo does not disturb a second concurrent repo",
    run: async () => {
      const first = await createRoundTripRepo();
      const second = await createRoundTripRepo();
      try {
        await first.cleanup();
        assert.equal(await exists(first.dir), false, "first repo dir no longer exists");
        assert.ok(await exists(second.dir), "second repo dir still exists");
        assert.ok((await stat(path.join(second.dir, ".git"))).isDirectory(), "second repo is still a git repository");
      } finally {
        await first.cleanup();
        await second.cleanup();
      }
    }
  },

  // ====================================================================
  // 01_real-install.feature
  // ====================================================================
  {
    name: "roundtrip-harness/real-install: installBundle returns the structured init result and writes a manifest under .aof/",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        const result = await installBundle(repo.dir);
        assert.ok(Array.isArray(result.actions), "result carries the planned actions[]");
        assert.ok(result.manifest && Array.isArray(result.manifest.files), "result carries a manifest with files[]");
        assert.ok(await exists(path.join(repo.dir, ".aof", "aof.lock.json")), "a manifest file is written under .aof/");
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/real-install: the structured result reports a written manifest at the unified lock path",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        const result = await installBundle(repo.dir);
        assert.ok(result.actions.length > 0, "actions is a non-empty list");
        assert.equal(result.manifestWritten, true, "manifestWritten is true");
        assert.equal(result.guarded, false, "guarded is false");
        assert.ok(result.manifestPath.replaceAll("\\", "/").endsWith(".aof/aof.lock.json"), "manifestPath ends with .aof/aof.lock.json");
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/real-install: the install lands real rendered bundle files under the runtime root and commands/aof/",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        await installBundle(repo.dir);
        assert.ok(existsSync(path.join(repo.dir, ".claude", "agents")), "bundle agent files exist under the runtime root");
        const agents = await readdir(path.join(repo.dir, ".claude", "agents"));
        assert.ok(agents.length > 0, "at least one agent file rendered");
        assert.ok(existsSync(path.join(repo.dir, ".claude", "commands", "aof")), "command files exist under commands/aof/");
        const commands = await readdir(path.join(repo.dir, ".claude", "commands", "aof"));
        assert.ok(commands.length > 0, "at least one command file rendered under commands/aof/");
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/real-install: installBundle honours the requested runtimes (claude → rendered under the claude root)",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        await installBundle(repo.dir, { runtimes: ["claude"] });
        assert.ok(existsSync(path.join(repo.dir, ".claude", "agents")), "rendered files appear under the claude runtime root");
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    // Scenario Outline: the requested runtime selects the runtime root.
    name: "roundtrip-harness/real-install: outline — runtime selection ((no opts → claude), ({runtimes:[claude]} → claude))",
    run: async () => {
      const rows = [
        { opts: undefined, root: ".claude" },
        { opts: { runtimes: ["claude"] }, root: ".claude" }
      ];
      for (const row of rows) {
        const repo = await createRoundTripRepo();
        try {
          await installBundle(repo.dir, row.opts);
          assert.ok(existsSync(path.join(repo.dir, row.root, "agents")), `rendered files appear under the ${row.root} runtime root`);
        } finally {
          await repo.cleanup();
        }
      }
    }
  },
  {
    // Scenario Outline: re-installing is guarded unless force is given.
    name: "roundtrip-harness/real-install: outline — re-install is guarded ((no force → guarded, no write), (force → re-render, write))",
    run: async () => {
      // Row 1: a second install WITHOUT force → guarded=true, manifestWritten=false.
      {
        const repo = await createRoundTripRepo();
        try {
          await installBundle(repo.dir);
          const again = await installBundle(repo.dir);
          assert.equal(again.guarded, true, "row1: second no-force install is guarded");
          assert.equal(again.manifestWritten, false, "row1: nothing new written");
        } finally {
          await repo.cleanup();
        }
      }
      // Row 2: a second install WITH force → guarded=false, manifestWritten=true.
      {
        const repo = await createRoundTripRepo();
        try {
          await installBundle(repo.dir);
          const forced = await installBundle(repo.dir, { force: true });
          assert.equal(forced.guarded, false, "row2: forced re-install is not guarded");
          assert.equal(forced.manifestWritten, true, "row2: manifest re-written on force");
        } finally {
          await repo.cleanup();
        }
      }
    }
  },

  // ====================================================================
  // 02_seed-sample-milestone.feature
  // ====================================================================
  {
    name: "roundtrip-harness/seed: seeding writes the sample milestone into the work stream and returns milestoneRef + storyRefs",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        const seeded = await seedSampleMilestone(repo.dir);
        assert.equal(typeof seeded.milestoneRef, "string", "returns a milestoneRef");
        assert.ok(Array.isArray(seeded.storyRefs), "returns a storyRefs list");
        const workDir = path.join(repo.dir, "wiki", "work");
        const entries = await readdir(workDir);
        const milestoneFolder = entries.find((name) => /^\d+_milestone_/.test(name));
        assert.ok(milestoneFolder, "a milestone folder is written under the repo's work directory");
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/seed: the seeded refs resolve through the shipped work verbs",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        const seeded = await seedSampleMilestone(repo.dir);
        const workDir = path.join(repo.dir, "wiki", "work");
        const milestone = await findWork(workDir, seeded.milestoneRef);
        assert.ok(
          milestone.some((row) => row.ref === seeded.milestoneRef && row.type === "milestone"),
          "findWork resolves the seeded milestone"
        );
        for (const storyRef of seeded.storyRefs) {
          const story = await findWork(workDir, storyRef);
          assert.ok(
            story.some((row) => row.ref === storyRef && row.type === "story" && row.parent != null),
            `findWork resolves the seeded story ${storyRef} under the milestone`
          );
        }
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/seed: the returned refs match the seeded folders on disk exactly (one milestone, story-ref set, shape, count)",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        const seeded = await seedSampleMilestone(repo.dir);
        const workDir = path.join(repo.dir, "wiki", "work");
        const rows = await listStream(workDir);
        const milestones = rows.filter((row) => row.type === "milestone");
        assert.equal(milestones.length, 1, "exactly one milestone in the stream");
        assert.equal(milestones[0].ref, seeded.milestoneRef, "the milestone ref equals milestoneRef");

        const listStoryRefs = rows.filter((row) => row.type === "story").map((row) => row.ref).sort();
        assert.deepEqual(listStoryRefs, [...seeded.storyRefs].sort(), "the list's story refs equal the returned storyRefs as a set");

        for (const storyRef of seeded.storyRefs) {
          assert.ok(storyRef.startsWith(`${seeded.milestoneRef}/`), `${storyRef} has the form <milestoneRef>/SS`);
          const tail = storyRef.slice(seeded.milestoneRef.length + 1);
          assert.ok(/^\d+$/.test(tail), `${storyRef} tail is the story number`);
        }
        assert.ok(seeded.storyRefs.length >= 1, "the count of returned storyRefs is at least one");
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/seed: the seeded stream validates clean through the shipped validator (zero findings)",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        await seedSampleMilestone(repo.dir);
        const workDir = path.join(repo.dir, "wiki", "work");
        const findings = await validateWork(workDir, {}, undefined);
        assert.deepEqual(findings, [], `the seeded stream reports no findings (got ${JSON.stringify(findings)})`);
      } finally {
        await repo.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/seed: the fixture is deterministic across runs — work-stream files are byte-identical between two repos",
    run: async () => {
      const a = await createRoundTripRepo();
      const b = await createRoundTripRepo();
      try {
        await seedSampleMilestone(a.dir);
        await seedSampleMilestone(b.dir);
        const filesA = await streamFiles(path.join(a.dir, "wiki", "work"));
        const filesB = await streamFiles(path.join(b.dir, "wiki", "work"));
        assert.deepEqual(
          filesA.map((f) => f.relPath),
          filesB.map((f) => f.relPath),
          "the same set of work-stream files is written"
        );
        for (let i = 0; i < filesA.length; i += 1) {
          assert.ok(filesA[i].bytes.equals(filesB[i].bytes), `${filesA[i].relPath} is byte-identical between the two repos`);
        }
      } finally {
        await a.cleanup();
        await b.cleanup();
      }
    }
  },
  {
    name: "roundtrip-harness/seed: the returned refs are identical across two independent seedings",
    run: async () => {
      const a = await createRoundTripRepo();
      const b = await createRoundTripRepo();
      try {
        const seededA = await seedSampleMilestone(a.dir);
        const seededB = await seedSampleMilestone(b.dir);
        assert.equal(seededA.milestoneRef, seededB.milestoneRef, "both calls return the same milestoneRef");
        assert.deepEqual(seededA.storyRefs, seededB.storyRefs, "both calls return the same storyRefs in the same order");
      } finally {
        await a.cleanup();
        await b.cleanup();
      }
    }
  }
];
