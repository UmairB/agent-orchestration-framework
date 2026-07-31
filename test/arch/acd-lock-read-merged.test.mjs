// Fitness function: acd-lock-read-merged (milestone 42 wave (d) leg d4;
// PRD-command-spine-effects-ledger §"Cascades have no home" — "Two `aof init` /
// `project migrate` sites bypass `writeLock`'s read-merge and wipe the `work` /
// `planning` lock sections wholesale").
//
// THE INVARIANT — the install lock has SEVERAL writers and no owner, so every one
// of them must read-merge. `aof init` and `project migrate` author the
// items/runtimes half; `work init` writes `lock.work`; `planning init` writes
// `lock.planning`. The first two wrote the WHOLE document, so running either
// against a workspace that already had work or planning installed silently
// deleted the other subtree — the manifests were gone and the next `work update`
// had nothing to reconcile against. This is the same class as the mesh sidecar's
// one-writer-per-subtree rule (writeSidecarPatch), and it gets the same cure.
//
// Two proofs, because either alone is weak:
//   (a) STRUCTURAL — no module writes the lock file through a raw text write; the
//       lock is written through lock.mjs. A grep-only gate would pass a module
//       that merges wrongly, so:
//   (b) BEHAVIOURAL — mergeLock over a lock carrying `work` and `planning` keeps
//       both byte-equivalent while replacing the keys the patch names, and an
//       absent or TORN lock is a fresh install rather than a crash.
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeLock, readLock } from "../../src/lock.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function srcModules(dir = SRC, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await srcModules(path.join(dir, entry.name), rel)));
    else if (entry.name.endsWith(".mjs")) out.push(rel);
  }
  return out;
}

export const archTests = [
  {
    name: "arch/42 wave (d) d4 (acd-lock-read-merged): no module writes the lock file as raw text — every writer goes through lock.mjs",
    run: async () => {
      const offenders = [];
      for (const rel of await srcModules()) {
        if (rel === "lock.mjs") continue; // the writer itself
        const source = stripComments(await readFile(path.join(SRC, rel), "utf8"));
        // `writeText(<anything>lockPath<anything>, …)` — the exact bypass shape the
        // two retired sites used.
        if (/writeText\s*\(\s*[^,)]*lockPath/i.test(source)) offenders.push(rel);
      }
      assert.deepEqual(
        offenders,
        [],
        `the install lock is written only through lock.mjs (raw-text writers found: ${offenders.join(", ")}). ` +
          "Use mergeLock — the lock has several writers and no owner, so a wholesale write deletes another subsystem's manifest.",
      );

      // self-check: the detector fires on the retired shape and ignores a merge.
      assert.ok(/writeText\s*\(\s*[^,)]*lockPath/i.test("await writeText(paths.lockPath, JSON.stringify(lock));"));
      assert.ok(!/writeText\s*\(\s*[^,)]*lockPath/i.test("await mergeLock(paths.lockPath, { version: 1 });"));
    },
  },
  {
    name: "arch/42 wave (d) d4: mergeLock preserves the subtrees it does not own, replaces the keys it does, and treats an absent or torn lock as a fresh install (behavioural)",
    run: async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "aof-lock-merge-"));
      const lockPath = path.join(dir, "aof.lock.json");
      try {
        // A workspace with work AND planning installed, plus an items half.
        await writeFile(lockPath, `${JSON.stringify({
          version: 1,
          runtimes: ["claude"],
          items: [{ id: "old" }],
          work: { manifest: "work-manifest", entries: 42 },
          planning: { manifest: "planning-manifest" },
        }, null, 2)}\n`, "utf8");

        // `aof init`'s patch: it owns version/generatedAt/catalog/runtimes/items.
        await mergeLock(lockPath, { version: 1, generatedAt: "2026-07-31T10:00:00.000Z", catalog: null, runtimes: ["codex"], items: [] });
        const after = await readLock(lockPath);
        assert.deepEqual(after.work, { manifest: "work-manifest", entries: 42 }, "the work section survives an init — THE defect");
        assert.deepEqual(after.planning, { manifest: "planning-manifest" }, "the planning section survives an init");
        assert.deepEqual(after.runtimes, ["codex"], "the keys the patch owns are replaced, not merged into");
        assert.deepEqual(after.items, [], "…including emptying items");

        // Absent lock: a fresh install, not a crash.
        const freshPath = path.join(dir, "fresh.lock.json");
        const fresh = await mergeLock(freshPath, { version: 1, items: [] });
        assert.deepEqual(fresh, { version: 1, items: [] });

        // Torn lock: still a fresh install for the patch's keys, never a throw.
        const tornPath = path.join(dir, "torn.lock.json");
        await writeFile(tornPath, "{ not json at all", "utf8");
        const torn = await mergeLock(tornPath, { version: 1, items: [] });
        assert.deepEqual(torn, { version: 1, items: [] }, "a torn lock must not block an install");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },
];
