import assert from "node:assert/strict";
import { BackendUnsupportedError, resolveBackend, supportedBackends } from "../src/backends/index.mjs";

export const backendTests = [
  {
    name: "resolves strict board backend implementations",
    run: resolvesStrictBackends
  },
  {
    name: "rejects unsupported board backends with structured details",
    run: rejectsUnsupportedBackends
  },
  {
    name: "null backend returns deterministic test responses",
    run: nullBackendReturnsDeterministicResponses
  }
];

function resolvesStrictBackends() {
  const backend = resolveBackend("gsd");
  assert.equal(backend.kind, "gsd");
  assert.equal(backend.capabilities.has("assignTask"), true);
  assert.equal(typeof backend.loadState, "function");
  assert.equal(typeof backend.analyzeRoadmap, "function");
  assert.equal(typeof backend.assertMilestone, "function");
  assert.equal(typeof backend.syncBoardFromMilestone, "function");
  assert.deepEqual(supportedBackends(), ["gsd"]);
  assert.deepEqual(supportedBackends({ includeTest: true }), ["gsd", "null"]);
}

function rejectsUnsupportedBackends() {
  assert.throws(
    () => resolveBackend("other"),
    (error) => {
      assert.equal(error instanceof BackendUnsupportedError, true);
      assert.equal(error.code, "BACKEND_UNSUPPORTED");
      assert.deepEqual(error.expected, ["gsd"]);
      assert.equal(error.actual, "other");
      assert.equal(error.toJSON().next.includes("executionProvider"), true);
      return true;
    }
  );
}

async function nullBackendReturnsDeterministicResponses() {
  const backend = resolveBackend("null");
  assert.equal(backend.kind, "null");
  assert.equal(backend.capabilities.has("assignTask"), false);

  assert.deepEqual(await backend.loadState(process.cwd()), {
    milestoneId: null,
    statePresent: false,
    roadmapPresent: false,
    configPresent: false,
    raw: ""
  });
  assert.deepEqual(await backend.assertMilestone(process.cwd(), "v1.7"), {
    ok: true,
    expected: "v1.7",
    actual: "v1.7",
    code: null
  });
  const synced = await backend.syncBoardFromMilestone(process.cwd(), "v1.7", {
    roadmap: { milestones: [{ version: "v1.7" }], phases: [{ number: "35" }] }
  });
  assert.equal(synced.assertion.ok, true);
  assert.deepEqual(synced.phases, [{ number: "35" }]);
}

