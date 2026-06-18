// Fitness function for milestone 01 / ADR-004:
// "The install manifest is read/written only at the fixed path
//  .aof/aof.work.lock.json, never the consumer's own .aof/aof.lock.json; and it
//  conforms to lock-v2 shape."
//
// Two proofs:
//  1. Source — grep the init source for the manifest path literal
//     `aof.work.lock.json` and assert NO read/write of `aof.lock.json`.
//  2. Behavioural — produce a manifest by running init into a temp repo and
//     validate it against the frozen schema (version: 2, bundle.version,
//     lock-shaped files[] with {path, runtime, resource:{id,kind}, hash,
//     generatedAt}, and the compatibility arrays packages/frameworks/
//     frameworkInstallAttempts).
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initWork, workLockPath } from "../../src/work-init.mjs";
import { updateWork } from "../../src/work-update.mjs";
import { loadBundle } from "../../src/work-bundle.mjs";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const initSourcePath = path.join(srcDir, "work-init.mjs");
const updateSourcePath = path.join(srcDir, "work-update.mjs");

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function assertFixedPathOnly(code, label) {
  assert.ok(/aof\.work\.lock\.json/.test(code), `${label} references the fixed work-lock literal`);
  // The only lock path the code names is the work lock. A bare `aof.lock.json`
  // (not preceded by `work.`) would be the consumer's own lock.
  const bareLock = /(^|[^.])(?<!work\.)aof\.lock\.json/;
  assert.ok(!bareLock.test(code.replaceAll("aof.work.lock.json", "")), `${label} never reads/writes aof.lock.json`);
}

function newerBundle(bundle) {
  return {
    ...bundle,
    resources: bundle.resources.map((res) => (res.id === "aof-architect" ? { ...res, body: res.body + "\nNEWER\n" } : res))
  };
}

export const archTests = [
  {
    name: "arch/ADR-004: init uses the fixed literal aof.work.lock.json and never touches aof.lock.json",
    run: async () => {
      const code = stripComments(await readFile(initSourcePath, "utf8"));
      assertFixedPathOnly(code, "init");
    }
  },
  {
    name: "arch/ADR-004: update uses the fixed literal aof.work.lock.json and never touches aof.lock.json",
    run: async () => {
      const code = stripComments(await readFile(updateSourcePath, "utf8"));
      assertFixedPathOnly(code, "update");
    }
  },
  {
    name: "arch/ADR-004: an update-produced manifest conforms to the frozen lock-v2 schema and leaves aof.lock.json untouched",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-update-manifest-"));
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        // The consumer's own lock is present with its own contents.
        await mkdir(path.join(repo, ".aof"), { recursive: true });
        const ownLockPath = path.join(repo, ".aof", "aof.lock.json");
        const ownLockContent = `${JSON.stringify({ version: 2, note: "consumer apply lock" }, null, 2)}\n`;
        await writeFile(ownLockPath, ownLockContent, "utf8");

        await updateWork({ targetDir: repo, bundleOverride: newerBundle(loadBundle()), bundleVersionOverride: "9.9.9" });

        const lock = JSON.parse(await readFile(workLockPath(repo), "utf8"));
        assert.equal(lock.version, 2, "version === 2 (LOCK_VERSION)");
        assert.equal(lock.bundle.version, "9.9.9", "bundle.version records the new release");
        assert.ok(Array.isArray(lock.runtimes) && lock.runtimes.length > 0, "runtimes[]");
        assert.ok(Array.isArray(lock.files) && lock.files.length > 0, "files[]");
        for (const entry of lock.files) {
          assert.ok(typeof entry.path === "string" && !entry.path.includes("\\"), `${entry.path} forward-slash path`);
          assert.ok(entry.resource && typeof entry.resource.id === "string" && typeof entry.resource.kind === "string", "entry.resource {id,kind}");
          assert.match(entry.hash, /^sha256:[0-9a-f]{64}$/, `${entry.path} hash is sha256:<hex>`);
        }
        assert.deepEqual(lock.packages, [], "packages: []");
        assert.deepEqual(lock.frameworks, [], "frameworks: []");
        assert.deepEqual(lock.frameworkInstallAttempts, [], "frameworkInstallAttempts: []");
        // The consumer's own lock is byte-for-byte unchanged by update.
        assert.equal(await readFile(ownLockPath, "utf8"), ownLockContent, "aof.lock.json untouched");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "arch/ADR-004: a produced manifest conforms to the frozen lock-v2 install-manifest schema",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-manifest-"));
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        const lockPath = workLockPath(repo);
        assert.equal(path.basename(lockPath), "aof.work.lock.json", "manifest at the fixed filename");
        const lock = JSON.parse(await readFile(lockPath, "utf8"));

        assert.equal(lock.version, 2, "version === 2 (LOCK_VERSION)");
        assert.ok(lock.bundle && typeof lock.bundle.version === "string" && lock.bundle.version.length > 0, "bundle.version present");
        assert.ok(Array.isArray(lock.runtimes) && lock.runtimes.length > 0, "runtimes[]");
        assert.ok(typeof lock.generatedAt === "string", "generatedAt present");

        assert.ok(Array.isArray(lock.files) && lock.files.length > 0, "files[]");
        for (const entry of lock.files) {
          assert.ok(typeof entry.path === "string" && !entry.path.includes("\\"), `${entry.path} repo-relative forward-slash path`);
          assert.ok(typeof entry.runtime === "string", "entry.runtime");
          assert.ok(entry.resource && typeof entry.resource.id === "string" && typeof entry.resource.kind === "string", "entry.resource {id,kind}");
          assert.match(entry.hash, /^sha256:[0-9a-f]{64}$/, `${entry.path} hash is sha256:<hex>`);
          assert.ok(typeof entry.generatedAt === "string", "entry.generatedAt");
        }

        // Compatibility arrays — present and empty for the bundle.
        assert.deepEqual(lock.packages, [], "packages: []");
        assert.deepEqual(lock.frameworks, [], "frameworks: []");
        assert.deepEqual(lock.frameworkInstallAttempts, [], "frameworkInstallAttempts: []");

        // The consumer's own lock is never created by init.
        const ownLockExists = await readFile(path.join(repo, ".aof", "aof.lock.json"), "utf8").then(() => true).catch(() => false);
        assert.equal(ownLockExists, false, "no .aof/aof.lock.json written");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];
