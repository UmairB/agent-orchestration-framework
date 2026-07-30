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
    // The two zero answers are DIFFERENT facts and the render must not conflate them. A
    // file the graph does not cover has UNKNOWN coupling; a file it covers with no
    // cross-file edges is genuinely uncoupled. The old render said "(not in graph — build
    // over its folder?)" for the first, quiet enough that a failed build got recorded as
    // the architectural finding "these modules have no coupling" — the whole reason this
    // command's honesty matters.
    name: "graph:impact render: a coverage gap is labelled UNKNOWN, real isolation is labelled as the fact it is",
    run: () => {
      const result = {
        graphPath: "graphify-out/graph.json",
        builtAt: "2026-07-30T11:22:33.000Z",
        files: [
          { file: "src/lonely.mjs", present: true, dependencies: [], dependents: [] },
          { file: "src/nope.mjs", present: false, dependencies: [], dependents: [] },
        ],
      };
      const text = graphImpactCommand.cli.render(result);

      // Mutation proof: dropping either label collapses the two answers back together
      // and reds the corresponding assertion.
      const gapLine = text.split("\n").find((l) => l.startsWith("# src/nope.mjs"));
      assert.match(gapLine, /NOT COVERED BY THIS GRAPH/, "an uncovered file is called out as a coverage gap");
      assert.match(gapLine, /not a no-coupling finding/, "the gap line refuses the no-coupling reading explicitly");

      const isolatedLine = text.split("\n").find((l) => l.startsWith("# src/lonely.mjs"));
      assert.match(isolatedLine, /genuinely uncoupled/, "an in-graph edgeless file is stated as really uncoupled");
      assert.ok(
        !isolatedLine.includes("NOT COVERED"),
        "a covered file is never labelled a coverage gap"
      );

      // Freshness leads, and it is the artifact's own time (never a call-time stamp).
      assert.match(text.split("\n")[0], /graph built 2026-07-30T11:22:33\.000Z/, "the render leads with the artifact's builtAt");
      // The tail summary makes a partial answer impossible to skim past.
      assert.match(text, /1 of 2 requested file\(s\) are absent from the graph/, "the render totals the coverage gaps");
      assert.match(text, /UNKNOWN, not zero/, "the summary names the correct reading of an absent file");
    },
  },
  {
    name: "graph:impact command: the result carries the artifact's own builtAt (freshness at the point of consumption)",
    run: async () => {
      const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
      const { statSync, utimesSync } = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");

      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-impact-builtat-"));
      const graphPath = path.join(repo, "graphify-out", "graph.json");
      const artifactTime = new Date("2024-03-04T05:06:07.000Z");
      try {
        await mkdir(path.dirname(graphPath), { recursive: true });
        await writeFile(
          graphPath,
          `${JSON.stringify({ nodes: [{ id: "A", source_file: "src/a.mjs" }], links: [] })}\n`,
          "utf8"
        );
        utimesSync(graphPath, artifactTime, artifactTime);

        const result = await graphImpactCommand.run(
          { paths: ["src/a.mjs"] },
          { workspace: { projectRoot: repo } }
        );

        // Mutation proof: a call-time `new Date()` here (the defect this family closes)
        // cannot equal a 2024 artifact mtime.
        assert.equal(result.builtAt, artifactTime.toISOString(), "builtAt is the graph artifact's mtime");
        assert.equal(result.builtAt, statSync(graphPath).mtime.toISOString(), "and it agrees with the file on disk");

        // …and with what a BUILD would have reported for the same untouched artifact.
        // These are two different stat flavours underneath (plain rounds the float
        // mtimeMs, bigint truncates it), which is why both go through one shared
        // derivation — a build and an impact must never name two instants for one file.
        const { graphArtifactBuiltAt } = await import("../src/graph-normalize.mjs");
        assert.equal(result.builtAt, graphArtifactBuiltAt(graphPath), "impact's builtAt IS the shared build-time derivation");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
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
