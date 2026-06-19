// Fitness function: acd-memory-recall-contract (ADR-004).
//
// `recall` returns { query, scope, records[], text }; each record is a
// MemoryRecord plus a numeric `score`; the `--json` CLI path emits the structured
// `records` array (the contract), never the rendered `text` blob.
import assert from "node:assert/strict";
import { recall, MEMORY_RECORD_FIELDS } from "../../src/memory/local-retrieval.mjs";
import { runMemory } from "../../src/work-memory.mjs";

// A minimal frozen-shape fixture index (ADR-005): absent-type fields present-as-"".
function fixtureRecords() {
  return [
    {
      recordType: "adr", id: "ADR-002", item: "01", itemSlug: "acd-asset-bundle",
      title: "content-addressed manifest membership", area: "architecture",
      stage: "", kind: "", owner: "", status: "Accepted",
      summary: "bundle membership is a content-addressed manifest",
      text: "content addressed manifest membership content hash manifest bundle",
      source: "01_milestone_acd-asset-bundle/ARCHITECTURE.md:66"
    },
    {
      recordType: "lesson", id: "R1", item: "01", itemSlug: "acd-asset-bundle",
      title: "requiring-grep is a fitness-fn smell", area: "architecture",
      stage: "build", kind: "near-miss", owner: "architect", status: "",
      summary: "requiring grep is a fitness function smell",
      text: "requiring grep fitness function smell content addressed",
      source: "01_milestone_acd-asset-bundle/RETROSPECTIVE.md:42"
    }
  ];
}

export const archTests = [
  {
    name: "arch/memory-recall-contract: recall returns the four frozen RecallResult keys",
    async run() {
      const result = await recall("content addressed manifest", { area: "architecture" }, {}, { records: fixtureRecords() });
      assert.deepEqual(Object.keys(result).sort(), ["query", "records", "scope", "text"], "exactly { query, scope, records, text }");
      assert.equal(result.query, "content addressed manifest");
      assert.equal(typeof result.text, "string");
      assert.ok(Array.isArray(result.records));
    }
  },
  {
    name: "arch/memory-recall-contract: each record is a MemoryRecord plus a numeric score",
    async run() {
      const result = await recall("content addressed manifest", {}, {}, { records: fixtureRecords() });
      assert.ok(result.records.length > 0, "the query matches at least one record");
      for (const record of result.records) {
        assert.equal(typeof record.score, "number", "every record carries a numeric score");
        for (const field of MEMORY_RECORD_FIELDS) {
          assert.ok(field in record, `every record carries the frozen MemoryRecord field "${field}"`);
        }
      }
    }
  },
  {
    name: "arch/memory-recall-contract: the --json CLI path emits the records array, not the text blob",
    async run() {
      const fixed = {
        query: "q",
        scope: {},
        records: [{ recordType: "adr", id: "ADR-002", source: "x/ARCHITECTURE.md:1", score: 7 }],
        text: "recall \"q\"  →  1 hit(s)\n  ▸ [ADR-002] …\n"
      };
      const stub = {
        name: "stub",
        async recall() { return fixed; },
        async reindex() { return { recordCount: 0 }; },
        async status() { return { backend: "stub", recordCount: 0 }; }
      };

      let printed = "";
      const outcome = await runMemory(["recall", "q", "--json"], {
        config: {},
        resolveBackend: () => stub,
        log: (line) => { printed += `${line}\n`; }
      });

      assert.equal(outcome.ok, true);
      const parsed = JSON.parse(printed); // must parse as JSON (the contract)
      assert.ok(Array.isArray(parsed), "--json prints the records ARRAY");
      assert.equal(parsed[0].source, "x/ARCHITECTURE.md:1", "the printed array carries MemoryRecord fields");
      assert.ok(!printed.includes("hit(s)"), "--json does NOT print the rendered human text blob");
    }
  }
];
