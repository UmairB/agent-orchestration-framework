// test/support/item-lock-fixture.mjs — the shared fixture for milestone 43 / story 01
// (the exclusive item lock).
//
// It is `mesh-assign-fixture.mjs` widened along the ONE axis this story needs: an
// ARBITRARY work stream (the features talk about milestones "42", "43", "44" and the
// string-prefix near-miss "420", each with its own stories) rather than that fixture's
// fixed `35_milestone_demo`. Everything else is reused verbatim from there —
// `seedTargetNode` (the two store facts the assign verb's repo gate reads) and
// `seedAssignment` (a direct-insert `global_assignments` row for a "Given an ACTIVE
// assignment …" background) are IMPORTED, never re-implemented, so a row this suite
// plants is byte-identical to the one m35's suites plant.
//
// The real `.aof/templates/work/{milestone,story}` templates are copied in (the
// work-insert-fixture.mjs discipline) because the control-side mutation door is
// exercised through the REAL `work:insert-story` verb, which scaffolds from them.
import { mkdtemp, mkdir, realpath, rm, writeFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../src/work.mjs";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../../src/global-work-store.mjs";
import { seedAssignment, seedTargetNode, readAssignmentRows } from "./mesh-assign-fixture.mjs";

export { seedAssignment, seedTargetNode, readAssignmentRows };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The stream the story's features describe, top to bottom. `420` is the string-prefix
// near-miss: "42" must not hold it, and no `LIKE '42%'` may ever say otherwise.
export const LOCK_STREAM = [
  { number: "42", stories: ["01", "02", "03"] },
  { number: "43", stories: ["01", "02", "03"] },
  { number: "44", stories: [] },
  { number: "420", stories: ["00"] },
];

function frontmatter(fields) {
  const body = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

// withItemLockFixture(body, { stream, mesh, name }) — a hermetic AOF_GLOBAL_HOME + a
// real workspace whose work stream is `stream`. `body({ … })` receives everything the
// suites need; the whole tree is removed afterwards.
//
//   mesh: false ⇒ NO `mesh` block in the config at all — the plain single-node CLI, the
//   workspace that must never notice the lock exists.
export async function withItemLockFixture(body, { stream = LOCK_STREAM, mesh = true, nodeId = "control-a" } = {}) {
  // realpath the root: macOS's os.tmpdir() is a symlink, and a path-derived
  // workspaceId must agree with every other derivation of it.
  const tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), "aof-item-lock-")));
  const home = path.join(tmp, "home");
  const root = path.join(tmp, "repo");
  // The fixture's home is THE global home for the duration of the body. Threading it
  // through `ctx.globalWorkStoreOptions` alone is not enough: `mesh:assign` hands its
  // core an EMPTY ctx by design (commands/mesh-assign.mjs), so the assign door resolves
  // its store from the environment — and a fixture that seeded rows somewhere else
  // would silently test nothing.
  const priorHome = process.env.AOF_GLOBAL_HOME;
  process.env.AOF_GLOBAL_HOME = home;
  try {
    const workDir = path.join(root, "wiki", "work");
    await mkdir(workDir, { recursive: true });
    await writeStream(workDir, stream);

    const aofDir = path.join(root, ".aof");
    await mkdir(aofDir, { recursive: true });
    const config = {
      name: "item-lock-fixture",
      work: { dir: "./wiki/work" },
      ...(mesh ? { mesh: { enabled: true, nodeId } } : {}),
    };
    await writeFile(path.join(aofDir, "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    for (const type of ["milestone", "story"]) {
      await cp(path.join(repoRoot, ".aof", "templates", "work", type), path.join(aofDir, "templates", "work", type), { recursive: true });
    }

    const env = { AOF_GLOBAL_HOME: home };
    const workspace = await loadWorkspace(root, undefined, { env });
    const workspaceId = workspace.config?.mesh?.workspaceId ?? workspaceIdFor(root);
    const ctx = {
      workspace,
      globalWorkStoreOptions: { env },
      effectsJournalOptions: { env },
    };
    return await body({ tmp, home, root, workDir, workspace, workspaceId, env, ctx, nodeId });
  } finally {
    if (priorHome === undefined) delete process.env.AOF_GLOBAL_HOME;
    else process.env.AOF_GLOBAL_HOME = priorHome;
    await rm(tmp, { recursive: true, force: true });
  }
}

async function writeStream(workDir, stream) {
  for (const driver of stream) {
    const type = driver.type ?? "milestone";
    const slug = driver.slug ?? `m${driver.number}`;
    const dir = path.join(workDir, `${driver.number}_${type}_${slug}`);
    await mkdir(dir, { recursive: true });
    const doc = type === "uat" ? "SESSION.md" : "SPEC.md";
    await writeFile(
      path.join(dir, doc),
      frontmatter({
        type,
        number: driver.number,
        slug,
        status: driver.status ?? "not-started",
        title: `Milestone ${driver.number}`,
        created: "2026-08-01",
        updated: "2026-08-01",
        schema: 1,
        ...(driver.depends ? { depends: driver.depends } : {}),
      }),
      "utf8",
    );
    for (const story of driver.stories ?? []) {
      const number = typeof story === "string" ? story : story.number;
      const status = typeof story === "string" ? "not-started" : (story.status ?? "not-started");
      const storySlug = `s${driver.number}-${number}`;
      const storyDir = path.join(dir, "stories", `${number}_story_${storySlug}`);
      await mkdir(path.join(storyDir, "tasks"), { recursive: true });
      await writeFile(
        path.join(storyDir, "STORY.md"),
        frontmatter({
          type: "story",
          number,
          slug: storySlug,
          parent: driver.number,
          status,
          title: `Story ${driver.number}/${number}`,
          created: "2026-08-01",
          updated: "2026-08-01",
          schema: 1,
        }),
        "utf8",
      );
    }
  }
}

// seedActive(fx, { assignmentId, itemRef, node, state }) — the "Given an ACTIVE
// assignment for <ref> held by <node>" background, one line.
export async function seedActive(fx, { assignmentId = "asg-1", itemRef, node = "aof-wsl", state = "running", at = "2026-08-01T09:00:00.000Z" } = {}) {
  await seedAssignment(fx, {
    assignmentId,
    itemRef,
    workspaceId: fx.workspaceId,
    targetNodeId: node,
    issuer: "control-a",
    state,
    assignedAt: at,
    updatedAt: at,
  });
  return assignmentId;
}

// settle(fx, assignmentId, state) — the GATE: the phase ends and every refused door
// opens. A direct state write (the fixture is the operator's withdraw/settle, not the
// verb under test).
export async function settle(fx, assignmentId, state = "done") {
  await withStore(fx, (store) => {
    store.db.prepare("UPDATE global_assignments SET state = ? WHERE assignment_id = ?").run(state, assignmentId);
  });
}

export async function withStore(fx, body) {
  const store = await openGlobalWorkProjectionStore({ env: fx.env });
  try {
    return await body(store);
  } finally {
    store.close?.();
  }
}

// countAssignments(fx) — "the store holds EXACTLY the assignments it held before".
export async function countAssignments(fx) {
  return withStore(fx, (store) => store.db.prepare("SELECT COUNT(*) AS n FROM global_assignments").get().n);
}

export async function assignmentRow(fx, assignmentId) {
  return withStore(fx, (store) => store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(assignmentId));
}

// publishedWorkspace(fx) — the workspace row + registered target node the assign
// verb's repo-availability gate needs before it can reach the lock gate at all.
export async function seedWorker(fx, nodeId = "worker-b") {
  await seedTargetNode(fx, { nodeId, workspaceId: fx.workspaceId, projectRoot: fx.root, workDir: fx.workDir });
}

// refuse(promise) — await a coded refusal and return the error, failing loudly when the
// call unexpectedly SUCCEEDS (a lock test that passes because nothing threw would be
// the worst possible false green).
export async function refuse(run) {
  try {
    const result = await run();
    throw new Error(`expected a coded refusal, but the call succeeded: ${JSON.stringify(result)?.slice(0, 200)}`);
  } catch (error) {
    if (error?.code == null) throw error;
    return error;
  }
}
