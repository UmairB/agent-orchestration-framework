// Traceability wiring for milestone 18 / story 01, task 02 —
// tasks/02_multiboard-sidecar-coexistence.feature (@executable, every scenario). One
// test object per @executable scenario; ADR-005/006.
//
//   readMapping(projectRoot, dataSourceId)  → { dataSourceId, entries }  (THAT board's bucket; empty on absent — never throws)
//   resolvePageId(mapping, aofRef)          → pageId | null
//   recordPageId(projectRoot, dataSourceId, aofRef, pageId, meta) → merge into the bucket, leaving others untouched
//
// Drives the v2 per-data-source-bucket store against a temp projectRoot (no live
// Notion). Each scenario uses a fresh temp root (the feature Background: "a project with
// a git-ignored .aof/notion.work-map.json sidecar"). A binding under board A and a
// binding under board B coexist; recording B leaves A's bucket untouched; a ref resolves
// ONLY under its own data-source; a legacy v1 file migrates on first read; the cross-board
// guard applies to the migration path; the first record after a v1 read rewrites it v2
// non-lossily; an absent file is an empty mapping.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readMapping, resolvePageId, recordPageId, NOTION_WORK_MAP_FILE } from "../src/notion/mapping.mjs";

async function makeRoot() {
  return await mkdtemp(path.join(os.tmpdir(), "aof-multiboard-map-"));
}

// Seed a legacy v1 single-board sidecar `{ version:1, dataSourceId, entries }` on disk.
async function seedV1(root, dataSourceId, entries) {
  await mkdir(path.join(root, ".aof"), { recursive: true });
  const file = { version: 1, dataSourceId, entries };
  await writeFile(path.join(root, ".aof", NOTION_WORK_MAP_FILE), `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

// Read the raw on-disk sidecar JSON (to assert the persisted version/shape).
async function readRaw(root) {
  return JSON.parse(await readFile(path.join(root, ".aof", NOTION_WORK_MAP_FILE), "utf8"));
}

// Resolve a ref under a given data-source (read its bucket, then resolve).
async function resolveUnder(root, dataSourceId, ref) {
  return resolvePageId(await readMapping(root, dataSourceId), ref);
}

export const integrationsMultiboardSidecarTests = [
  {
    // Scenario: a binding under one board and a binding under another coexist in one sidecar
    name: "integrations-multiboard-sidecar/02 a binding under one board and a binding under another coexist in one sidecar",
    async run() {
      const root = await makeRoot();
      try {
        await recordPageId(root, "ds-ops", "18", "page-A", {});
        await recordPageId(root, "ds-growth", "19", "page-B", {});
        assert.equal(await resolveUnder(root, "ds-ops", "18"), "page-A", 'resolving "18" under ds-ops still returns "page-A"');
        assert.equal(await resolveUnder(root, "ds-growth", "19"), "page-B", 'resolving "19" under ds-growth returns "page-B"');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: recording into a second board does not clobber the first board's bindings
    name: "integrations-multiboard-sidecar/02 recording into a second board does not clobber the first board's bindings",
    async run() {
      const root = await makeRoot();
      try {
        await recordPageId(root, "ds-ops", "18", "page-A", {});
        await recordPageId(root, "ds-growth", "18", "page-B", {});
        assert.equal(await resolveUnder(root, "ds-ops", "18"), "page-A", 'resolving "18" under ds-ops still returns "page-A" (not clobbered)');
        assert.equal(await resolveUnder(root, "ds-growth", "18"), "page-B", 'resolving "18" under ds-growth returns "page-B"');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a ref does not resolve under a data-source it was not bound under
    name: "integrations-multiboard-sidecar/02 a ref does not resolve under a data-source it was not bound under",
    async run() {
      const root = await makeRoot();
      try {
        await recordPageId(root, "ds-ops", "18", "page-A", {});
        assert.equal(await resolveUnder(root, "ds-growth", "18"), null, "resolving under a data-source it was not bound under is a miss");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a legacy v1 single-board sidecar migrates on first read
    name: "integrations-multiboard-sidecar/02 a legacy v1 single-board sidecar migrates on first read",
    async run() {
      const root = await makeRoot();
      try {
        await seedV1(root, "ds-ops", { "18": { pageId: "page-A", lastStatus: null, lastSyncedAt: null } });
        assert.equal(await resolveUnder(root, "ds-ops", "18"), "page-A", 'reading the mapping for ds-ops resolves "18" → "page-A" (v1 read as its bucket)');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a legacy v1 sidecar does not resolve under a different data-source
    name: "integrations-multiboard-sidecar/02 a legacy v1 sidecar does not resolve under a different data-source",
    async run() {
      const root = await makeRoot();
      try {
        await seedV1(root, "ds-ops", { "18": { pageId: "page-A", lastStatus: null, lastSyncedAt: null } });
        assert.equal(await resolveUnder(root, "ds-growth", "18"), null, "a v1 file bound to ds-ops does not resolve under ds-growth (the cross-board guard on the migration path)");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the first record after a v1 read rewrites the sidecar non-lossily in v2 shape
    name: "integrations-multiboard-sidecar/02 the first record after a v1 read rewrites the sidecar non-lossily in v2 shape",
    async run() {
      const root = await makeRoot();
      try {
        await seedV1(root, "ds-ops", { "18": { pageId: "page-A", lastStatus: null, lastSyncedAt: null } });
        await recordPageId(root, "ds-growth", "19", "page-B", {});
        const raw = await readRaw(root);
        assert.equal(raw.version, 2, "the sidecar version is 2 after the first record");
        assert.equal(await resolveUnder(root, "ds-ops", "18"), "page-A", 're-reading ds-ops still resolves "18" → "page-A" (the v1 bucket carried forward non-lossily)');
        assert.equal(await resolveUnder(root, "ds-growth", "19"), "page-B", 're-reading ds-growth resolves "19" → "page-B"');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an absent sidecar is an empty mapping, not an error
    name: "integrations-multiboard-sidecar/02 an absent sidecar is an empty mapping, not an error",
    async run() {
      const root = await makeRoot();
      try {
        let mapping;
        await assert.doesNotReject(async () => {
          mapping = await readMapping(root, "ds-ops");
        }, "readMapping on an absent sidecar does not throw");
        assert.deepEqual(mapping.entries, {}, "the read succeeds with no entries");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
