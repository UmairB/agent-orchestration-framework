// Fitness function: acd-memory-backend-interface (ADR-003).
//
// Every registered backend module's default export provides EXACTLY
// { name, recall, reindex, status } (name a string, the rest async functions);
// the seam calls backends only through these and never reads a backend's index
// file directly; the `none` backend is a total no-op.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import localBackend from "../../src/memory/local-backend.mjs";
import noneBackend from "../../src/memory/none-backend.mjs";
import { runMemory } from "../../src/work-memory.mjs";

const INTERFACE_KEYS = ["name", "recall", "reindex", "status"];

function assertInterface(backend, label) {
  assert.deepEqual(
    Object.keys(backend).sort(),
    [...INTERFACE_KEYS].sort(),
    `${label} default export must be exactly { name, recall, reindex, status } (ADR-003)`
  );
  assert.equal(typeof backend.name, "string", `${label}.name is a string`);
  for (const method of ["recall", "reindex", "status"]) {
    assert.equal(typeof backend[method], "function", `${label}.${method} is a function`);
  }
}

export const archTests = [
  {
    name: "arch/memory-backend-interface: the local backend exports exactly the frozen interface",
    run() {
      assertInterface(localBackend, "local backend");
      assert.equal(localBackend.name, "local");
    }
  },
  {
    name: "arch/memory-backend-interface: the none backend exports exactly the frozen interface",
    run() {
      assertInterface(noneBackend, "none backend");
      assert.equal(noneBackend.name, "none");
    }
  },
  {
    name: "arch/memory-backend-interface: the seam never reads the index file directly (only the backend does)",
    async run() {
      const seamSource = await readFile(new URL("../../src/work-memory.mjs", import.meta.url), "utf8");
      assert.ok(
        !seamSource.includes("aof.memory.index.json"),
        "the seam must not name the index file — the backend owns the store (ADR-003)"
      );
      assert.ok(
        !seamSource.includes("memoryIndexPath"),
        "the seam must not resolve the index path — it reaches the backend only through the interface"
      );
    }
  },
  {
    name: "arch/memory-backend-interface: the none backend is a total no-op across every verb",
    async run() {
      const recalled = await noneBackend.recall("anything", { area: "architecture" }, {}, {});
      assert.deepEqual(recalled.records, [], "none.recall returns an empty records array");
      assert.equal(typeof recalled.text, "string", "none.recall still returns a text projection");

      assert.deepEqual(await noneBackend.reindex(null, {}), { recordCount: 0 }, "none.reindex is a zero no-op");
      assert.deepEqual(await noneBackend.status({}), { backend: "none", recordCount: 0 }, "none.status reports zero");
    }
  },
  {
    name: "arch/memory-backend-interface: an unknown verb is gated before any backend method is invoked",
    async run() {
      const calls = [];
      const recordingBackend = {
        name: "stub",
        async recall() { calls.push("recall"); return { query: "", scope: {}, records: [], text: "" }; },
        async reindex() { calls.push("reindex"); return { recordCount: 0 }; },
        async status() { calls.push("status"); return { backend: "stub", recordCount: 0 }; }
      };
      const outcome = await runMemory(["frobnicate"], {
        config: {},
        resolveBackend: () => recordingBackend,
        log: () => {}
      });
      assert.equal(outcome.ok, false, "an unknown verb fails");
      assert.notEqual(outcome.exitCode, 0, "an unknown verb exits non-zero");
      assert.deepEqual(calls, [], "no backend method is invoked for an unknown verb");
    }
  }
];
