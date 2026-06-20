// Fitness function for milestone 02 / ADR-002:
// "The provenance manifest's `sha` is a 40-char lowercase-hex commit id — never a
//  branch/tag/HEAD/floating ref."
//
// Proofs:
//  1. Produce a manifest with an injected sha; assert manifest.sha matches
//     /^[0-9a-f]{40}$/.
//  2. Assert a branch-name input (`main`) is rejected BEFORE write — no manifest
//     is written.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { initPlanning, planningLockPath } from "../../src/planning-init.mjs";

const SHA_RE = /^[0-9a-f]{40}$/;
const FIXTURE_SHA = "d384f0c9eb81fe74656a4f6da168587836939edb";

export const archTests = [
  {
    name: "arch/ADR-002: a produced manifest's sha is a 40-char lowercase-hex commit id",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-planning-sha-"));
      try {
        const result = await initPlanning({
          targetDir: repo,
          sha: FIXTURE_SHA,
          simulateInstall: true,
          log: () => {}
        });
        assert.equal(result.manifestWritten, true, "manifest written for a full sha");
        // ADR-009: provenance is the `planning` SECTION of the unified lock.
        const manifest = JSON.parse(await readFile(planningLockPath(repo), "utf8")).planning;
        assert.match(manifest.sha, SHA_RE, "manifest.sha is 40-char lowercase hex");
        assert.equal(manifest.sha, FIXTURE_SHA, "manifest pins the injected commit");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "arch/ADR-002: a branch-name input (main) is rejected before write — no manifest written",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-planning-sha-"));
      try {
        const result = await initPlanning({
          targetDir: repo,
          sha: "main",
          simulateInstall: true,
          log: () => {}
        });
        assert.equal(result.shaRejected, true, "a branch name is rejected");
        assert.equal(result.manifestWritten, false, "no manifest written on a floating ref");
        assert.equal(existsSync(planningLockPath(repo)), false, "the provenance manifest does not exist");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];
