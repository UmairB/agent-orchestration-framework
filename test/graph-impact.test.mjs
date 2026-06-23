// graph:impact — the deterministic, edge-based coupling command (milestone 11
// re-open / ADR-007). Tests the PURE computeImpact core (dependents + dependencies
// from a normalized graph) and the command's build-first precondition. This is the
// NON-VACUOUS value test: it asserts the command returns EXACT coupling, not that a
// prompt contains certain words.
import assert from "node:assert/strict";
import { computeImpact, graphImpactCommand } from "../src/commands/graph-impact.mjs";

// A tiny normalized graph (the normalizeGraph output shape): nodes carry
// id/sourceFile; edges carry source/target (node ids). Models:
//   a.mjs ──imports──> b.mjs ──imports──> c.mjs
//   d.mjs ──imports──> b.mjs
// So b.mjs depends on c.mjs and is depended on by a.mjs + d.mjs.
const GRAPH = {
  nodes: [
    { id: "A", sourceFile: "src/a.mjs" },
    { id: "B", sourceFile: "src/b.mjs" },
    { id: "C", sourceFile: "src/c.mjs" },
    { id: "D", sourceFile: "src/d.mjs" },
    { id: "B2", sourceFile: "src/b.mjs" }, // a 2nd symbol node in b.mjs
  ],
  edges: [
    { source: "A", target: "B", relation: "imports" },
    { source: "B", target: "C", relation: "imports" },
    { source: "D", target: "B", relation: "imports" },
    { source: "B2", target: "B2", relation: "contains" }, // self-loop, must be dropped
  ],
  hyperedges: [],
};

export const tests = [
  {
    name: "graph:impact computeImpact: returns EXACT dependents + dependencies from the edges",
    run: () => {
      const [b] = computeImpact(GRAPH, ["src/b.mjs"]);
      assert.equal(b.file, "src/b.mjs");
      assert.equal(b.present, true);
      // b.mjs imports c.mjs.
      assert.deepEqual(b.dependencies, ["src/c.mjs"]);
      // b.mjs is imported by a.mjs and d.mjs (sorted, deduped, self-loop dropped).
      assert.deepEqual(b.dependents, ["src/a.mjs", "src/d.mjs"]);
    },
  },
  {
    name: "graph:impact computeImpact: a leaf (only imported) has dependents, no deps; an entry (only importing) has deps, no dependents",
    run: () => {
      const [c] = computeImpact(GRAPH, ["src/c.mjs"]);
      assert.deepEqual(c.dependencies, []);
      assert.deepEqual(c.dependents, ["src/b.mjs"]);

      const [a] = computeImpact(GRAPH, ["src/a.mjs"]);
      assert.deepEqual(a.dependencies, ["src/b.mjs"]);
      assert.deepEqual(a.dependents, []);
    },
  },
  {
    name: "graph:impact computeImpact: a path absent from the graph is reported present:false, not an error",
    run: () => {
      const [x] = computeImpact(GRAPH, ["src/nope.mjs"]);
      assert.equal(x.present, false);
      assert.deepEqual(x.dependencies, []);
      assert.deepEqual(x.dependents, []);
    },
  },
  {
    name: "graph:impact computeImpact: matches a basename/suffix path against the graph's repo-relative source_file",
    run: () => {
      // An agent may pass just the file name or a deeper path; suffix match resolves it.
      const [b] = computeImpact(GRAPH, ["b.mjs"]);
      assert.equal(b.present, true);
      assert.deepEqual(b.dependents, ["src/a.mjs", "src/d.mjs"]);
    },
  },
  {
    name: "graph:impact command: throws a build-first `no-graph` error when no graph exists (deterministic precondition)",
    run: async () => {
      // Point projectRoot at a dir with no graphify-out/graph.json.
      const ctx = { workspace: { projectRoot: "/nonexistent-aof-graph-root-xyz" } };
      await assert.rejects(
        () => graphImpactCommand.run({ paths: ["src/a.mjs"] }, ctx),
        (err) => err.code === "no-graph",
        "absent graph → structured no-graph error before any read"
      );
    },
  },
  {
    name: "graph:impact command: registered shape — id, required paths input, cli adapter",
    run: () => {
      assert.equal(graphImpactCommand.id, "graph:impact");
      assert.deepEqual(graphImpactCommand.input.required, ["paths"]);
      assert.equal(typeof graphImpactCommand.cli.argv, "function");
      assert.equal(typeof graphImpactCommand.cli.render, "function");
      // argv maps positionals → { paths }.
      assert.deepEqual(graphImpactCommand.cli.argv(["src/a.mjs", "src/b.mjs"]), {
        paths: ["src/a.mjs", "src/b.mjs"],
      });
    },
  },
];
