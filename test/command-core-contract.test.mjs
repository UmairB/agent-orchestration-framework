// Traceability wiring for milestone 08 / story 00 — the command core.
//
// Covers EVERY @executable scenario across the four task features, exercising the
// REAL in-process registry (src/command-core.mjs + src/commands/*) against temp
// fixture repos — loadWorkspace + invoke, real fs, in-process. One test object
// per @executable scenario (Scenario-Outline rows folded into one entry), each
// name tracing to feature + scenario.
//
//   00_registry-contract.feature    — six ids / getCommand hit+miss / frozen
//        {id,input,run,cli} shape / invoke verbatim / invoke unknown-id throws
//   01_read-commands.feature        — doc present/absent/slug/ref-not-found/
//        invalid-doc ; tasks parsed+counts/empty-dir/ref-not-found
//   02_basis-neutral-paths.feature  — validate raw-abs/clean/unresolved-scope/
//        scoped ; next raw-abs ; list dir == listStream value
//   03_feedback-write-command.feature — one bullet/refs/verbatim-heading/
//        exact-only/milestone+story+uat/missing-fields/only-STATE.md-changed
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace, listStream } from "../src/work.mjs";
import { getCommand, listCommands, invoke } from "../src/command-core.mjs";

// The milestone-08 SIX work operations. Milestone 15 (ADR-001) registers a 7th
// work command — work:doctor, the health lane — into the SAME registry; it is a
// sanctioned extension of the work:* namespace (like graph:* is for the broader
// registry), tracked here so the "exactly these work commands" contract stays
// honest as the namespace grows. Milestone 19 (ADR-003) registers the three
// work:run-* run-lifecycle commands into the SAME core — another sanctioned
// in-namespace extension (the run lifecycle driven through the one registry door);
// only their CLI face is wired here, the board face is milestone 21.
const SIX_IDS = ["work:list", "work:doc", "work:tasks", "work:validate", "work:next", "work:feedback"];
// Milestone 20 (ADR-003) registers a 4th run verb — work:run-retry, the resume-vs-fresh
// command — into the SAME core; another sanctioned in-namespace extension (its CLI face
// is wired; the board face is milestone 21, the BOARD_DEFERRED carve-out).
const WORK_IDS = [...SIX_IDS, "work:doctor", "work:run-start", "work:run-complete", "work:run-status", "work:run-retry"];

// --- fixture builders (mirrors board-api.test.mjs) ---------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-cmdcore-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  return { repo, workDir };
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function milestone(workDir, { number, slug, status, title, depends }) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPEC.md"),
    frontmatter({
      type: "milestone",
      number,
      slug,
      status,
      title: `"${title}"`,
      created: "2026-06-19",
      updated: "2026-06-19",
      ...(depends ? { depends: `[${depends}]` } : {}),
    }) + `# ${number} · ${title}\n`,
    "utf8"
  );
  return dir;
}

async function story(workDir, milestoneFolder, { number, slug, status, title, parent, withTasksDir = true }) {
  const dir = path.join(workDir, milestoneFolder, "stories", `${number}_story_${slug}`);
  await mkdir(withTasksDir ? path.join(dir, "tasks") : dir, { recursive: true });
  await writeFile(
    path.join(dir, "STORY.md"),
    frontmatter({
      type: "story",
      number,
      slug,
      status,
      title: `"${title}"`,
      parent,
      created: "2026-06-19",
      updated: "2026-06-19",
    }) + `# ${number} · ${title}\n`,
    "utf8"
  );
  return dir;
}

// A top-level uat session — like a milestone, a driver, but it groups no stories
// and carries no STATE feedback log (work:feedback must reject it).
async function uat(workDir, { number, slug, status, title }) {
  const dir = path.join(workDir, `${number}_uat_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SESSION.md"),
    frontmatter({
      type: "uat",
      number,
      slug,
      status,
      title: `"${title}"`,
      created: "2026-06-19",
      updated: "2026-06-19",
    }) + `# ${number} · ${title}\n`,
    "utf8"
  );
  return dir;
}

// --- helpers -----------------------------------------------------------------

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

// Bullets under the verbatim feedback heading (mirrors board-api.test.mjs).
function bulletsUnderHeading(stateText) {
  const lines = stateText.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## Feedback (for retro)");
  if (headingIndex === -1) return [];
  const bullets = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    const line = lines[i];
    if (line.trim().startsWith("- ") && !line.includes("<note>")) bullets.push(line);
  }
  return bullets;
}

async function snapshotDir(dir) {
  const snap = new Map();
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const info = await stat(full);
        snap.set(full, `${info.mtimeMs}:${await readFile(full, "utf8")}`);
      }
    }
  }
  await walk(dir);
  return snap;
}

function diffSnapshots(before, after) {
  const changed = [];
  for (const [file, value] of after) if (before.get(file) !== value) changed.push(file);
  for (const file of before.keys()) if (!after.has(file)) changed.push(file);
  return changed;
}

// Assert a thrown error carries the expected `.code` (the command error contract).
async function assertRejectsWithCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected a thrown error with code "${code}"`);
  assert.equal(caught.code, code, `the error carries code "${code}"`);
  return caught;
}

export const commandCoreContractTests = [
  // ════════════════════════ 00_registry-contract.feature ════════════════════
  {
    name: "command-core/00 the registry exposes exactly the known work commands",
    async run() {
      const ids = listCommands().map((command) => command.id);
      // The milestone-08 contract: exactly the six work:* operations are re-homed
      // into the registry — no missing, no extra WORK command. Milestone 09's
      // accepted ADR-001 extends the SAME registry with the graph:* family, so the
      // "no other registered commands" clause is scoped to the work:* namespace
      // (the operations this milestone owns) — graph:* commands are a sanctioned
      // extension, not an 08 regression. See 09 STATE.md §Feedback (for retro).
      // Milestone 15 (ADR-001) adds the 7th work:* command — work:doctor, the
      // health lane — a sanctioned in-namespace extension (WORK_IDS), not a
      // regression: the registry stays the single door for every work operation.
      const workIds = ids.filter((id) => id.startsWith("work:"));
      assert.deepEqual([...workIds].sort(), [...WORK_IDS].sort(), "exactly the known work ids, no more, no fewer");
      assert.equal(workIds.length, WORK_IDS.length, "there are no other registered work commands");
    },
  },
  {
    name: "command-core/00 getCommand resolves a registered id and only a registered id",
    async run() {
      // Examples: work:doc → returns a command ; work:feedback → returns a command ;
      //           work:unknown → returns nothing
      for (const id of ["work:doc", "work:feedback"]) {
        const command = getCommand(id);
        assert.ok(command, `getCommand("${id}") returns a command`);
        assert.equal(command.id, id, "the returned command carries the looked-up id");
      }
      assert.equal(getCommand("work:unknown"), undefined, "an unknown id returns nothing");
    },
  },
  {
    name: "command-core/00 every registered command carries the frozen { id, input, run, cli } shape",
    async run() {
      for (const command of listCommands()) {
        // id is a string equal to its registry key
        assert.equal(typeof command.id, "string", "id is a string");
        assert.equal(getCommand(command.id), command, "id equals its registry key");
        // input is a schema that survives a JSON round-trip unchanged (plain data)
        assert.ok(command.input && typeof command.input === "object", `${command.id} has an input schema`);
        assert.deepEqual(
          JSON.parse(JSON.stringify(command.input)),
          command.input,
          `${command.id} input survives a JSON round-trip unchanged (no functions)`
        );
        // run is an async function
        assert.equal(typeof command.run, "function", `${command.id} has a run function`);
        assert.equal(command.run.constructor.name, "AsyncFunction", `${command.id} run is async`);
        // cli is an adapter with argv + render (json too)
        assert.ok(command.cli && typeof command.cli === "object", `${command.id} has a cli adapter`);
        assert.equal(typeof command.cli.argv, "function", `${command.id} cli.argv is a function`);
        assert.equal(typeof command.cli.render, "function", `${command.id} cli.render is a function`);
      }
    },
  },
  {
    name: "command-core/00 invoke returns the command's result unchanged",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const ctx = await ctxFor(repo);

        const result = await invoke("work:doc", { ref: "08", doc: "SPEC" }, ctx);
        // carries exactly the fields ref, doc, present, body
        assert.deepEqual(Object.keys(result).sort(), ["body", "doc", "present", "ref"]);
        // equals the object the command's own run produces for the same input
        const direct = await getCommand("work:doc").run({ ref: "08", doc: "SPEC" }, ctx);
        assert.deepEqual(result, direct, "invoke returns run's result verbatim (no projection)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/00 invoke on an unknown id fails rather than returning undefined",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        let result;
        let caught = null;
        try {
          result = await invoke("work:nope", { anything: true }, ctx);
        } catch (error) {
          caught = error;
        }
        assert.ok(caught instanceof Error, "invoke raises an Error");
        assert.ok(caught.message.includes("work:nope"), "the error names the unknown command id");
        assert.equal(result, undefined, "no result is returned");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ════════════════════════ 01_read-commands.feature ════════════════════════
  {
    name: "command-core/01 work:doc returns a present doc with its verbatim body",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const mDir = await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const specBody = await readFile(path.join(mDir, "SPEC.md"), "utf8");
        const ctx = await ctxFor(repo);

        const result = await invoke("work:doc", { ref: "08", doc: "SPEC" }, ctx);
        assert.equal(result.ref, "08");
        assert.equal(result.doc, "SPEC");
        assert.equal(result.present, true);
        assert.equal(result.body, specBody, "the body equals the milestone's SPEC.md verbatim");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/01 a missing doc is present:false with an empty body, not an error",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        // no RETROSPECTIVE.md written
        const ctx = await ctxFor(repo);

        const result = await invoke("work:doc", { ref: "08", doc: "RETROSPECTIVE" }, ctx);
        assert.equal(result.present, false, "an absent doc is present:false");
        assert.equal(result.body, "", "the body is the empty string");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/01 work:doc resolves a free-text slug to the matching item",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const ctx = await ctxFor(repo);

        // free-text slug, not an exact id → resolveItem's slug fallback
        const result = await invoke("work:doc", { ref: "cli-command-core", doc: "SPEC" }, ctx);
        assert.equal(result.ref, "08", "the slug resolves to the 08 milestone");
        assert.equal(result.present, true);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/01 a ref that resolves to no item raises ref-not-found (work:doc)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const ctx = await ctxFor(repo);

        await assertRejectsWithCode(() => invoke("work:doc", { ref: "99", doc: "SPEC" }, ctx), "ref-not-found");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/01 an unknown doc name is rejected as invalid-doc, distinct from a missing doc",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const ctx = await ctxFor(repo);

        // invalid-doc is a thrown error, distinct from the present:false an absent
        // valid doc returns (asserted in the missing-doc scenario above).
        const error = await assertRejectsWithCode(() => invoke("work:doc", { ref: "08", doc: "NONSENSE" }, ctx), "invalid-doc");
        assert.notEqual(error.code, "ref-not-found", "invalid-doc is distinct from ref-not-found");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/01 work:tasks lists a story's parsed feature scenarios with lane counts",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const storyDir = await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        // Two .feature files; 02 sorts after 01.
        await writeFile(
          path.join(storyDir, "tasks", "01_registry.feature"),
          [
            "Feature: registry",
            "",
            "  @executable",
            "  Scenario: the six commands",
            "    Given a registry",
            "",
            "  @manual",
            "  Scenario: a hand-checked thing",
            "    Given something",
            "",
            "  @executable",
            "  Scenario Outline: each row",
            "    Given <x>",
          ].join("\n"),
          "utf8"
        );
        await writeFile(
          path.join(storyDir, "tasks", "02_walkthrough.feature"),
          ["@uat", "Feature: walkthrough", "", "  Scenario: operator walks it", "    Given the thing"].join("\n"),
          "utf8"
        );
        const ctx = await ctxFor(repo);

        const result = await invoke("work:tasks", { ref: "08/00" }, ctx);
        assert.equal(result.ref, "08/00");
        assert.equal(result.tasks.length, 2, "one entry per .feature file");
        assert.deepEqual(result.tasks.map((t) => t.file), ["01_registry.feature", "02_walkthrough.feature"], "sorted by filename");

        const first = result.tasks[0];
        assert.equal(first.feature, "registry", "each entry carries its feature title");
        assert.equal(first.scenarios.length, 3, "each entry carries its scenarios");
        assert.deepEqual(first.counts, { executable: 2, manual: 1, uat: 0 }, "per-lane counts for executable/manual/uat");

        const second = result.tasks[1];
        assert.deepEqual(second.counts, { executable: 0, manual: 0, uat: 1 });
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/01 a missing tasks dir yields an empty tasks list, not an error",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        // story 08/01 created WITHOUT a tasks/ dir
        await story(workDir, "08_milestone_cli-command-core", { number: "01", slug: "no-tasks", status: "in-progress", title: "No tasks", parent: "8", withTasksDir: false });
        const ctx = await ctxFor(repo);

        const result = await invoke("work:tasks", { ref: "08/01" }, ctx);
        assert.deepEqual(result, { ref: "08/01", tasks: [] }, "absent tasks/ → empty list, no error");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/01 work:tasks on a ref that resolves to no item raises ref-not-found",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const ctx = await ctxFor(repo);

        await assertRejectsWithCode(() => invoke("work:tasks", { ref: "99" }, ctx), "ref-not-found");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ════════════════════════ 02_basis-neutral-paths.feature ══════════════════
  {
    name: "command-core/02 work:validate returns findings whose paths are raw absolutes",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        // a story whose folder slug disagrees with its frontmatter slug → a finding
        const storyDir = path.join(workDir, "08_milestone_cli-command-core", "stories", "00_story_folder-slug");
        await mkdir(path.join(storyDir, "tasks"), { recursive: true });
        await writeFile(
          path.join(storyDir, "STORY.md"),
          frontmatter({ type: "story", number: "00", slug: "frontmatter-slug", status: "in-progress", title: '"Mismatched"', parent: "8", created: "2026-06-19", updated: "2026-06-19" }),
          "utf8"
        );
        const ctx = await ctxFor(repo);

        const result = await invoke("work:validate", {}, ctx);
        assert.ok(Array.isArray(result.findings), "the result is a findings envelope");
        assert.ok(result.findings.length >= 1, "at least one finding");
        for (const finding of result.findings) {
          assert.ok("path" in finding && "problem" in finding, "each finding has a path and a problem");
        }
        const slugFinding = result.findings.find((f) => /slug/.test(f.problem));
        assert.ok(slugFinding, "a finding names the slug problem");
        // RAW ABSOLUTE, OS-native — the command did NO projection.
        const expected = path.join(storyDir, "STORY.md");
        assert.equal(slugFinding.path, expected, "the finding path is the real on-disk path, unprojected");
        assert.ok(path.isAbsolute(slugFinding.path), "the finding path is absolute");
        // not project-root-relative
        assert.ok(slugFinding.path.startsWith(ctx.workspace.projectRoot), "the path is NOT projectRoot-relative (it contains the root)");
        // not forward-slashed on Windows (it equals path.join, which uses OS sep)
        if (path.sep === "\\") {
          assert.ok(slugFinding.path.includes("\\"), "on Windows the raw path contains backslashes (not forward-slashed)");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/02 a clean stream returns an empty findings envelope",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        const ctx = await ctxFor(repo);

        const result = await invoke("work:validate", {}, ctx);
        assert.deepEqual(result, { findings: [] }, "a clean stream is an empty findings envelope");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/02 an unresolved scope yields an empty findings envelope, not an error",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // well-formed under every milestone
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        const ctx = await ctxFor(repo);

        // scope "99" matches nothing — a filter, not a validated ref → empty, no error
        const result = await invoke("work:validate", { scope: "99" }, ctx);
        assert.deepEqual(result, { findings: [] }, "an unresolved scope yields an empty envelope, no error");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/02 work:validate narrows to a supplied scope",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // a malformed item under milestone 03 and one under milestone 04
        await milestone(workDir, { number: "03", slug: "m-three", status: "in-progress", title: "Three" });
        await milestone(workDir, { number: "04", slug: "m-four", status: "in-progress", title: "Four" });
        const badThree = path.join(workDir, "03_milestone_m-three", "stories", "00_story_bad-three");
        const badFour = path.join(workDir, "04_milestone_m-four", "stories", "00_story_bad-four");
        for (const [dir, slug, parent] of [[badThree, "wrong-three", "3"], [badFour, "wrong-four", "4"]]) {
          await mkdir(path.join(dir, "tasks"), { recursive: true });
          await writeFile(
            path.join(dir, "STORY.md"),
            frontmatter({ type: "story", number: "00", slug, status: "in-progress", title: '"Bad"', parent, created: "2026-06-19", updated: "2026-06-19" }),
            "utf8"
          );
        }
        const ctx = await ctxFor(repo);

        const result = await invoke("work:validate", { scope: "03" }, ctx);
        assert.ok(result.findings.length >= 1, "in-scope findings reported");
        assert.ok(result.findings.every((f) => f.path.includes("m-three")), "only findings under milestone 03 are reported");
        assert.ok(!result.findings.some((f) => f.path.includes("m-four")), "findings under milestone 04 are not reported");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/02 work:next returns a NextResult whose path is a raw absolute",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const storyDir = await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        const ctx = await ctxFor(repo);

        const result = await invoke("work:next", {}, ctx);
        // the next item's ref, type, status, slug, and state
        for (const key of ["ref", "type", "status", "slug", "state"]) {
          assert.ok(key in result, `the result carries ${key}`);
        }
        // path is the raw absolute item directory, unprojected
        assert.equal(result.path, storyDir, "the next path is the real on-disk directory, unprojected");
        assert.ok(path.isAbsolute(result.path), "the next path is absolute");
        assert.ok(result.path.startsWith(ctx.workspace.projectRoot), "the path is NOT projectRoot-relative");
        if (path.sep === "\\") {
          assert.ok(result.path.includes("\\"), "on Windows the raw path is not forward-slashed");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/02 work:list returns the whole stream with dir exactly as listStream emits it",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        const ctx = await ctxFor(repo);

        const result = await invoke("work:list", {}, ctx);
        const direct = await listStream(workDir);
        // the full work-stream array, dir exactly as listStream produces
        assert.deepEqual(result, direct, "the result is the full listStream array, unwrapped + unprojected");
        for (const row of result) {
          // forward-slashed absolute, neither cwd- nor projectRoot-relative
          assert.ok(!row.dir.includes("\\"), "each dir is forward-slashed (as listStream emits)");
          assert.ok(row.dir.includes(workDir.replaceAll("\\", "/")), "each dir is the full absolute, not relativised");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ════════════════════════ 03_feedback-write-command.feature ═══════════════
  {
    name: "command-core/03 work:feedback appends one attributed bullet and returns it",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const storyDir = await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        await writeFile(path.join(storyDir, "STATE.md"), "# 00 · State\n\n## Feedback (for retro)\n\n", "utf8");
        const ctx = await ctxFor(repo);

        const result = await invoke("work:feedback", { ref: "08/00", note: "spec was ambiguous on the empty state", actor: "qa" }, ctx);
        assert.equal(result.ok, true, "the result is { ok: true }");
        assert.equal(result.bullet, "- spec was ambiguous on the empty state — Raised by: qa", "result carries the rendered bullet");

        const bullets = bulletsUnderHeading(await readFile(path.join(storyDir, "STATE.md"), "utf8"));
        assert.equal(bullets.length, 1, "exactly one bullet appended under the heading");
        assert.equal(bullets[0], "- spec was ambiguous on the empty state — Raised by: qa");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/03 a supplied refs pointer is recorded verbatim on the bullet",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const storyDir = await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        await writeFile(path.join(storyDir, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
        const ctx = await ctxFor(repo);

        const result = await invoke("work:feedback", { ref: "08/00", note: "revisit the chip ramp", actor: "qa", refs: "ADR-002" }, ctx);
        const bullets = bulletsUnderHeading(await readFile(path.join(storyDir, "STATE.md"), "utf8"));
        assert.equal(bullets.length, 1);
        assert.ok(bullets[0].endsWith("Refs: ADR-002"), "the appended bullet ends with the verbatim Refs pointer");
        // three spaces before Refs, em-dash — the canonical template form
        assert.equal(bullets[0], "- revisit the chip ramp — Raised by: qa   Refs: ADR-002");
        assert.equal(result.bullet, bullets[0]);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/03 the append creates the verbatim heading when it is absent",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const storyDir = await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        // STATE.md with NO feedback heading
        await writeFile(path.join(storyDir, "STATE.md"), "# 00 · State\n\n## Progress\n\n- [ ] something\n", "utf8");
        const ctx = await ctxFor(repo);

        await invoke("work:feedback", { ref: "08/00", note: "the loading copy reads oddly", actor: "qa" }, ctx);
        const stateText = await readFile(path.join(storyDir, "STATE.md"), "utf8");
        assert.ok(stateText.includes("## Feedback (for retro)"), "the verbatim heading is created");
        assert.ok(stateText.includes("## Progress"), "the existing body is preserved");
        const bullets = bulletsUnderHeading(stateText);
        assert.equal(bullets.length, 1, "exactly one bullet appended under it");
        assert.equal(bullets[0], "- the loading copy reads oddly — Raised by: qa");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/03 a non-exact ref fails rather than writing to a slug-matched item",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // a milestone whose slug "cli-command-core" a READ would slug-match on free text
        const mDir = await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        await writeFile(path.join(mDir, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
        const ctx = await ctxFor(repo);

        const before = await snapshotDir(workDir);
        // a partial/typo'd ref the exact resolver must reject (no slug fallback)
        await assertRejectsWithCode(() => invoke("work:feedback", { ref: "cli-command", note: "should not land", actor: "qa" }, ctx), "ref-not-found");
        const after = await snapshotDir(workDir);
        assert.deepEqual(diffSnapshots(before, after), [], "no bullet is appended to any item");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/03 feedback targets a milestone or story, and rejects other kinds",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const mDir = await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const storyDir = await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        const uatDir = await uat(workDir, { number: "09", slug: "acceptance", status: "in-progress", title: "Acceptance" });
        await writeFile(path.join(mDir, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
        await writeFile(path.join(storyDir, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
        const ctx = await ctxFor(repo);

        // Examples: 08 → appends to that milestone STATE.md
        await invoke("work:feedback", { ref: "08", note: "a note", actor: "qa" }, ctx);
        assert.equal(bulletsUnderHeading(await readFile(path.join(mDir, "STATE.md"), "utf8")).length, 1, "08 appends one bullet to the milestone STATE.md");

        // 08/00 → appends to that story STATE.md
        await invoke("work:feedback", { ref: "08/00", note: "a note", actor: "qa" }, ctx);
        assert.equal(bulletsUnderHeading(await readFile(path.join(storyDir, "STATE.md"), "utf8")).length, 1, "08/00 appends one bullet to the story STATE.md");

        // 09 (uat) → rejected as unsupported-target, appending nothing
        const before = await snapshotDir(uatDir);
        await assertRejectsWithCode(() => invoke("work:feedback", { ref: "09", note: "a note", actor: "qa" }, ctx), "unsupported-target");
        assert.deepEqual(diffSnapshots(before, await snapshotDir(uatDir)), [], "the uat session is unchanged (nothing appended)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/03 a missing required field is rejected before any write",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const storyDir = await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        await writeFile(path.join(storyDir, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
        const ctx = await ctxFor(repo);

        const before = await snapshotDir(workDir);
        // Examples: ref "08/00" and no note → missing-note ; note "a note" and no ref → missing-ref
        await assertRejectsWithCode(() => invoke("work:feedback", { ref: "08/00" }, ctx), "missing-note");
        await assertRejectsWithCode(() => invoke("work:feedback", { note: "a note" }, ctx), "missing-ref");
        const after = await snapshotDir(workDir);
        assert.deepEqual(diffSnapshots(before, after), [], "no bullet is appended to any item");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "command-core/03 the append writes only the target STATE.md and nothing else",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "08", slug: "cli-command-core", status: "in-progress", title: "CLI command core" });
        const storyDir = await story(workDir, "08_milestone_cli-command-core", { number: "00", slug: "command-core", status: "in-progress", title: "The command core", parent: "8" });
        await writeFile(path.join(storyDir, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
        const ctx = await ctxFor(repo);

        const before = await snapshotDir(workDir);
        await invoke("work:feedback", { ref: "08/00", note: "only-write check", actor: "qa" }, ctx);
        const after = await snapshotDir(workDir);

        assert.deepEqual(diffSnapshots(before, after), [path.join(storyDir, "STATE.md")], "the only file changed is the story's STATE.md");
        // record-doc frontmatter + status unchanged
        const storyBefore = before.get(path.join(storyDir, "STORY.md"));
        const storyAfter = after.get(path.join(storyDir, "STORY.md"));
        assert.equal(storyBefore, storyAfter, "the item's record-doc frontmatter and status are unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
