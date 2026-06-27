// Traceability wiring for milestone 17 / story 00 — the `.aof/` mapping sidecar
// (ADR-001). One test object per @executable scenario of
// `02_mapping-sidecar-roundtrip.feature`.
//
//   readMapping(projectRoot, dataSourceId) → { entries }   (empty on absent file — NEVER throws)
//   resolvePageId(mapping, aofRef)         → pageId | null  (HIT → pageId; MISS → null)
//   recordPageId(projectRoot, dataSourceId, aofRef, pageId, meta) → persist the binding back
//
// Drives the store against a temp projectRoot with no live Notion — the @executable
// lane. Each scenario uses a fresh temp project root (the feature Background: "an
// empty temp project root with no .aof/notion.work-map.json sidecar").
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readMapping, resolvePageId, recordPageId } from "../src/notion/mapping.mjs";

async function makeRoot() {
  return await mkdtemp(path.join(os.tmpdir(), "aof-notion-map-"));
}

export const notionMappingSidecarTests = [
  {
    // Scenario: readMapping on an absent sidecar returns an empty mapping and never throws
    name: "notion-spine/mapping-sidecar/00 readMapping on an absent sidecar returns an empty mapping and never throws",
    async run() {
      const root = await makeRoot();
      try {
        let mapping;
        await assert.doesNotReject(async () => {
          mapping = await readMapping(root, "ds-A");
        }, "readMapping on an absent sidecar does not throw");
        assert.ok(mapping && typeof mapping === "object", "readMapping returns a mapping object");
        assert.deepEqual(mapping.entries, {}, "the mapping has no entries");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: resolvePageId returns the recorded page id on a HIT
    name: "notion-spine/mapping-sidecar/01 resolvePageId returns the recorded page id on a HIT",
    async run() {
      const root = await makeRoot();
      try {
        await recordPageId(root, "ds-A", "17", "page-17", {});
        const mapping = await readMapping(root, "ds-A");
        assert.equal(resolvePageId(mapping, "17"), "page-17", "a HIT resolves the recorded page id");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: resolvePageId returns null on a MISS
    name: "notion-spine/mapping-sidecar/02 resolvePageId returns null on a MISS",
    async run() {
      const root = await makeRoot();
      try {
        const mapping = await readMapping(root, "ds-A");
        assert.equal(resolvePageId(mapping, "17/01"), null, "a MISS resolves null");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a recorded binding survives a re-read with its meta carried
    name: "notion-spine/mapping-sidecar/03 a recorded binding survives a re-read with its meta carried",
    async run() {
      const root = await makeRoot();
      try {
        await recordPageId(root, "ds-A", "17/01", "page-1701", {
          lastStatus: "in-progress",
          lastSyncedAt: "2026-06-25T10:00:00Z",
        });
        const mapping = await readMapping(root, "ds-A");
        assert.equal(resolvePageId(mapping, "17/01"), "page-1701", "the recorded binding resolves after a fresh read");
        const entry = mapping.entries["17/01"];
        assert.equal(entry.lastStatus, "in-progress", 'the entry carries lastStatus "in-progress"');
        assert.equal(entry.lastSyncedAt, "2026-06-25T10:00:00Z", "the entry carries the recorded lastSyncedAt");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a binding recorded under one data-source does not resolve under a different one
    name: "notion-spine/mapping-sidecar/04 a binding recorded under one data-source does not resolve under a different one",
    async run() {
      const root = await makeRoot();
      try {
        await recordPageId(root, "ds-A", "17", "page-17", {});
        const mappingB = await readMapping(root, "ds-B");
        assert.equal(resolvePageId(mappingB, "17"), null, "a ds-A binding does not resolve under ds-B");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
