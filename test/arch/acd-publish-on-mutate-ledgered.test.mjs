// Fitness functions for m42 wave (d) leg d4, PORT 1 (PRD-command-spine-effects-
// ledger, "cascade-ports"): publish-on-mutate is a LEDGERED CONSEQUENCE, not a
// per-command import decision.
//
// THE DEFECT THIS CLOSES. Whether a mutation propagated its workspace to the
// global projection was decided by whether that command's author remembered to
// import `withGlobalWorkPropagation` and wrap the return value. Three verbs did;
// every other mutation did not, and nothing said so. That is wave (d)'s disease
// exactly — the consequence living at whichever call site needed it first — and
// the cure is the same as run-completion's: DECLARE it. `publish-projection` is
// now one reactor in src/effects/table.mjs, hung off the events the transition
// seams raise, and a command can neither forget it nor opt itself out.
//
//   (1) THE WRAPPER IS GONE. `withGlobalWorkPropagation` exists nowhere in src/
//       — a ratchet, because its return-value shape is what made per-command
//       publishing possible in the first place.
//   (2) ONE PUBLISH DOOR. `publishGlobalWorkSnapshot(` is called in src/ only by
//       the publisher itself, the effects table's reactor, and the two sanctioned
//       NON-cascade publishers (the verb whose whole purpose is publishing, and
//       the launcher's periodic propagation tick). No command may publish on its
//       own authority.
//   (3) THE EVENTS DECLARE IT. Every event a mutation seam raises for a
//       propagating fact carries the publish reactor at `local` locus, and the
//       reactor is the SAME function for all of them (one home, not a copy per
//       event).
//   (4) THE WARNING STILL REACHES THE RESULT (behavioural). The recorded decision
//       for this port is that the face threads the reactor's warning back rather
//       than letting the ported verbs' --json change shape: a failing publish
//       surfaces as `propagationWarnings` on the command result, exactly as the
//       retired wrapper made it. Proven end-to-end through invoke() for BOTH
//       ported verbs, with the publish injected to fail.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EFFECTS } from "../../src/effects/table.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { invoke } from "../../src/command-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(repoRoot, "src");

// The sanctioned publishGlobalWorkSnapshot callers (repo-relative, forward-slashed).
const PUBLISH_ALLOWED = new Set([
  // The definition.
  "src/global-work-publisher.mjs",
  // The LEDGER's reactor — the one door for publish-as-a-consequence.
  "src/effects/table.mjs",
  // `aof mesh repo publish`: publishing IS this verb's deliverable (it writes the
  // repo marker and publishes the snapshot that marker unlocks), not a cascade it
  // remembers after some other mutation.
  "src/commands/mesh-repo.mjs",
  // The launcher's periodic propagation tick + its startup snapshot: time-driven
  // convergence, not a mutation's consequence.
  "src/mesh-launcher.mjs",
]);

// The events whose facts propagate. Each must carry the publish reactor.
const PROPAGATING_EVENTS = ["run.started", "run.completed", "feedback.recorded"];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

function frontmatter(fields) {
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n`;
}

// A mesh-ENABLED workspace (the publish reactor's precondition: the propagation
// decision requires the enable AND the workspace's own config on disk).
async function buildPropagatingFixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-publish-ledgered-"));
  const milestoneDir = path.join(repo, "wiki", "work", "34_milestone_global-mesh");
  const storyDir = path.join(milestoneDir, "stories", "01_story_propagation");
  await mkdir(storyDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "34", slug: "global-mesh", status: "in-progress" }),
    "utf8",
  );
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter({ type: "story", number: "01", slug: "propagation", parent: "34", status: "in-progress" }),
    "utf8",
  );
  await writeFile(path.join(storyDir, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh: { enabled: true } }, null, 2)}\n`,
    "utf8",
  );
  return repo;
}

export const archTests = [
  {
    name: "arch/m42-d4-port1: withGlobalWorkPropagation is gone from src/ — publishing is not a per-command wrapper (ratchet)",
    run: async () => {
      const files = await listSourceFiles(SRC_DIR);
      const offenders = [];
      for (const file of files) {
        const code = stripComments(await readFile(file, "utf8"));
        if (/withGlobalWorkPropagation/.test(code)) {
          offenders.push(path.relative(repoRoot, file).replaceAll("\\", "/"));
        }
      }
      assert.deepEqual(offenders, [], `the retired wrapper has no live references (offenders: ${offenders.join(", ")})`);
    },
  },
  {
    name: "arch/m42-d4-port1: publishGlobalWorkSnapshot is reachable only from the ledger's reactor + the two sanctioned non-cascade publishers",
    run: async () => {
      const files = await listSourceFiles(SRC_DIR);
      const offenders = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        if (PUBLISH_ALLOWED.has(rel)) continue;
        const code = stripComments(await readFile(file, "utf8"));
        if (/publishGlobalWorkSnapshot\s*\(/.test(code)) offenders.push(rel);
      }
      assert.deepEqual(
        offenders,
        [],
        `no command publishes on its own authority (offenders: ${offenders.join(", ")})`,
      );
    },
  },
  {
    name: "arch/m42-d4-port1: every propagating event declares the publish reactor at `local` locus, and it is ONE function for all of them",
    run: async () => {
      const applies = new Set();
      for (const name of PROPAGATING_EVENTS) {
        const reactors = EFFECTS[name];
        assert.ok(Array.isArray(reactors), `"${name}" is a declared event`);
        const publish = reactors.find((reactor) => reactor.key === "publish-projection");
        assert.ok(publish, `"${name}" declares the publish-projection reactor`);
        assert.equal(publish.locus, "local", `"${name}"/publish-projection is a local-locus consequence`);
        applies.add(publish.apply);
      }
      assert.equal(applies.size, 1, "publish-on-mutate is ONE reactor function shared by every propagating event");
    },
  },
  {
    name: "arch/m42-d4-port1: a failing publish still surfaces as propagationWarnings on the ported verbs' results (the recorded threading decision, behavioural)",
    run: async () => {
      const repo = await buildPropagatingFixture();
      const globalHome = await mkdtemp(path.join(os.tmpdir(), "aof-publish-ledgered-gh-"));
      try {
        const workspace = await loadWorkspace(repo);
        const error = new Error("sqlite unavailable");
        error.code = "sqlite-unavailable";
        const ctx = {
          workspace,
          effectsJournalOptions: { env: { ...process.env, AOF_GLOBAL_HOME: globalHome } },
          globalWorkStoreOptions: { env: { ...process.env, AOF_GLOBAL_HOME: globalHome } },
          globalPublisher: async () => { throw error; },
        };

        const feedback = await invoke("work:feedback", { ref: "34/01", note: "ledgered", actor: "qa" }, ctx);
        assert.equal(feedback.ok, true, "the command's own result is unchanged by the port");
        assert.equal(feedback.bullet.includes("ledgered"), true, "the bullet is the command's own");
        assert.equal(feedback.propagationWarnings?.length, 1, "work:feedback threads the reactor's warning back");
        assert.equal(feedback.propagationWarnings[0].code, "sqlite-unavailable");

        const started = await invoke("work:run-start", { ref: "34/01" }, ctx);
        assert.equal(started.state, "running", "the run record is unchanged by the port");
        assert.equal(started.propagationWarnings?.length, 1, "work:run-start threads the reactor's warning back");
        assert.equal(started.propagationWarnings[0].code, "sqlite-unavailable");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(globalHome, { recursive: true, force: true });
      }
    },
  },
];
