// graph:build failure propagation, driven END-TO-END through the REAL resolver
// and the REAL spawn — no injected seams. A fake graphify binary is planted in a
// temp managed store (the AOF_GLOBAL_HOME seam), so these scenarios exercise the
// full chain invoke("graph:build") → resolveGraphifyBinary (store-first, keyed on
// PINNED_GRAPHIFY_VERSION) → spawnSync → the status/persist classification — the
// exact chain the field incident travelled (PantraWeb, 2026-08-07: `aof graph
// build src` with no src/ reported "Built 3149 nodes" — graphify exited 1 with
// "error: path not found" on stderr while the driver read the PREVIOUS graph.json
// and presented its counts as a fresh build).
//
// The unit-level classification is covered by graph-command-core's injected-seam
// scenarios; what THIS suite pins is different:
//   - the store-first pin is load-bearing: the fake store binary is spawned even
//     though a real graphify may sit on PATH (the distinctive stderr proves which
//     binary ran) — a store key drifting from PINNED_GRAPHIFY_VERSION would make
//     these tests fall through to the PATH binary and fail loudly;
//   - a non-zero exit from the REAL spawn layer surfaces as the structured
//     `graphify-build-failed` carrying graphify's own stderr, never as a
//     successful BuildResult over the stale artifact;
//   - a zero exit still succeeds, deriving counts from graph.json.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { PINNED_GRAPHIFY_VERSION } from "../src/graphify.mjs";

const POSIX = process.platform !== "win32";

// A minimal aof project root (mirrors graph-command-core's makeRepo).
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-graphfail-"));
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(path.join(repo, "wiki", "work"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return repo;
}

// A fake managed-store graphify at <home>/tools/graphify/<pin>/bin/graphify —
// keyed on PINNED_GRAPHIFY_VERSION so the store-first resolver hits the fake (a
// hardcoded version here would silently fall through to whatever real graphify
// sits on PATH the moment the pin moves). `behaviour` is a shell snippet run for
// any non---version invocation.
async function installFakeGraphify(home, behaviour) {
  const binDir = path.join(home, "tools", "graphify", PINNED_GRAPHIFY_VERSION, "bin");
  await mkdir(binDir, { recursive: true });
  const exe = path.join(binDir, "graphify");
  const script = [
    "#!/bin/sh",
    `if [ "$1" = "--version" ]; then echo "graphify ${PINNED_GRAPHIFY_VERSION}"; exit 0; fi`,
    behaviour,
    "",
  ].join("\n");
  await writeFile(exe, script, "utf8");
  await chmod(exe, 0o755);
  return exe;
}

// A minimal node_link graph.json the normalizer accepts (links, not edges).
const STALE_GRAPH = JSON.stringify({
  directed: true,
  multigraph: false,
  graph: {},
  nodes: [
    { id: "lib_a", label: "a.ts" },
    { id: "lib_b", label: "b.ts" },
  ],
  links: [{ source: "lib_a", target: "lib_b", relation: "imports_from", confidence: "EXTRACTED" }],
});

async function withFakeStore(behaviour, fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-fakestore-"));
  await installFakeGraphify(home, behaviour);
  const previous = process.env.AOF_GLOBAL_HOME;
  process.env.AOF_GLOBAL_HOME = home;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.AOF_GLOBAL_HOME;
    else process.env.AOF_GLOBAL_HOME = previous;
  }
}

export const graphBuildFailurePropagationTests = [
  {
    // The field defect verbatim: a typo'd subtree target (extract verb), the
    // binary exits 1 with its reason on stderr, and a perfectly readable stale
    // graph.json sits on disk. The command must reject with the stderr detail —
    // the marker string also proves the STORE binary ran, not a PATH one.
    name: "graph-fail/ a non-zero graphify exit fails graph:build even when a stale graph.json exists",
    async run() {
      if (!POSIX) return; // the fake-binary shim is a POSIX shell script
      const repo = await makeRepo();
      await mkdir(path.join(repo, "graphify-out"), { recursive: true });
      await writeFile(path.join(repo, "graphify-out", "graph.json"), STALE_GRAPH, "utf8");
      const behaviour = [
        'echo "[graphify extract] 617 code, 65 docs, 0 papers, 0 images changed; 0 unchanged; 144 deleted"',
        'echo "error: AOF-FAKE-STORE-BINARY: no LLM API key found (65 doc/paper/image file(s) need semantic extraction)." >&2',
        "exit 1",
      ].join("\n");
      await withFakeStore(behaviour, async () => {
        const ctx = { workspace: await loadWorkspace(repo) };
        let caught = null;
        try {
          await invoke("graph:build", { path: "src" }, ctx);
        } catch (error) {
          caught = error;
        }
        assert.ok(caught, "graph:build rejects when the binary exits non-zero");
        assert.equal(
          caught.code,
          "graphify-build-failed",
          `carries the structured code (got "${caught?.code}": ${caught?.message})`
        );
        assert.match(
          caught.message,
          /AOF-FAKE-STORE-BINARY: no LLM API key found/,
          "the stderr detail reaches the caller — and the marker proves the STORE binary was the one spawned"
        );
        assert.doesNotMatch(caught.message ?? "", /\d+ nodes/, "no stale success rendering");
      });
    },
  },
  {
    // The happy path through the same real chain: a whole-root no-backend build
    // (the `update` verb), zero exit, artifact untouched — counts derive from
    // graph.json and the run reports success, so the failure guard above cannot
    // have over-rotated into failing ordinary builds.
    name: "graph-fail/ a zero graphify exit still succeeds and reads counts from graph.json",
    async run() {
      if (!POSIX) return;
      const repo = await makeRepo();
      await mkdir(path.join(repo, "graphify-out"), { recursive: true });
      await writeFile(path.join(repo, "graphify-out", "graph.json"), STALE_GRAPH, "utf8");
      const behaviour = ['echo "[graphify] Code graph updated."', "exit 0"].join("\n");
      await withFakeStore(behaviour, async () => {
        const ctx = { workspace: await loadWorkspace(repo) };
        const result = await invoke("graph:build", { path: "." }, ctx);
        assert.equal(result.nodeCount, 2, "counts still derive from graph.json on success");
        assert.equal(result.edgeCount, 1);
        assert.equal(result.egress, "none", "a no-backend build stays zero-egress");
        assert.equal(result.unchanged, true, "an untouched artifact reports unchanged (graphify asserting currency)");
        assert.ok(typeof result.builtAt === "string" && result.builtAt.length > 0, "builtAt derives from the artifact");
      });
    },
  },
];
