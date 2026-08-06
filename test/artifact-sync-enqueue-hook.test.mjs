// milestone 43 / story 03 — task 00: the PostToolUse ENQUEUE hook
// (`tasks/00_posttooluse-enqueue-hook.feature`, AC1–AC4, ADR-001).
//
// THE THREE CHANNELS the contract's litmus allows, and the only ones used here:
//   (a) the QUEUE FILE's bytes after a payload is delivered on stdin,
//   (b) the process's EXIT CODE and its stdout/stderr as the harness observed them,
//   (c) the `hooks.PostToolUse` entry as it stands in the WRITTEN settings file.
// No source read of the enqueue script: this suite asserts what the script DOES.
// The structural half ("no src/ import, no store open, no workspace-identity
// derivation, no non-zero exit path") is a property of every possible run and is owned
// by `test/arch/acd-artifact-sync-hook-derivation-free.test.mjs`.
//
// EVERY RUN SPAWNS THE REAL SCRIPT with argv and JSON on stdin — no shell string, no
// `bash -c`, no heredoc — so these steps run unchanged on the Windows control node,
// the Mac worker and the WSL worker. The two degrade conditions that are not portably
// provokable (ENOSPC, a permission-denied directory) are deliberately absent; their
// portable stand-ins (an absent parent, a directory named as the queue, a file as the
// parent) are in the table and reach the same "the append throws" branch.
//
// The `@manual` scenario at the foot of the feature (the exec entry spawning
// identically on all three nodes) needs three machines and is NOT attempted here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyClaudeSettingsMerge, claudeSettingsPath } from "../src/claude-settings.mjs";
import { ARTIFACT_SYNC_SCRIPT_RELPATH, artifactSyncQueuePath } from "../src/artifact-sync.mjs";
// The last scenario needs a real worker daemon (the reconciliation tick is the whole
// point of it), so it rides the story's shared fixture.
import { withArtifactSyncFixture } from "./support/artifact-sync-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLED_SCRIPT = path.join(repoRoot, "src", "bundle", "hooks", "artifact-sync-enqueue.mjs");

// THE SCRIPT IS NEVER SPAWNED FROM THE REPO. Since ADR-013/C2 the queue is derived
// from the script's OWN installed location, so running the repo's copy would append
// into this repo's `.aof/` — the one thing this story's safety rule forbids. Every
// scenario installs a byte-copy into its own scratch checkout at the bundle's declared
// target and drives THAT, which is also what a real workspace runs.
async function installScript(root) {
  const installed = path.join(root, ...ARTIFACT_SYNC_SCRIPT_RELPATH.split("/"));
  await mkdir(path.dirname(installed), { recursive: true });
  await writeFile(installed, await readFile(BUNDLED_SCRIPT, "utf8"), "utf8");
  return installed;
}

// A scratch CHECKOUT: the installed script plus the `.aof/` its queue derives to.
async function withCheckout(body) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "aof-enqueue-hook-")));
  try {
    const script = await installScript(dir);
    await mkdir(path.join(dir, ".aof"), { recursive: true });
    return await body({ dir, script, queuePath: artifactSyncQueuePath(dir) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Deliver a payload on the script's stdin, exactly as Claude Code does: `node` plus
// the entry's argv, with the process cwd set to the project directory (the harness's
// own contract). `script` may be RELATIVE, which is how the committed entry spells it.
function deliver(payload, { script, cwd, raw = null }) {
  const input = raw != null ? raw : JSON.stringify(payload);
  return spawnSync(process.execPath, [script], { input, cwd, encoding: "utf8" });
}

function queueLines(queuePath) {
  if (!existsSync(queuePath)) return [];
  try {
    return readFileSync(queuePath, "utf8").split("\n").filter((line) => line.trim().length > 0);
  } catch (error) {
    // The queue destination is a DIRECTORY in one of the fault rows — "no lines" is
    // the honest reading, and the row's own assertions cover what is on disk.
    if (error?.code === "EISDIR") return [];
    throw error;
  }
}
export const artifactSyncEnqueueHookTests = [
  {
    // HEADLINE (AC1) — the ENTRY as a FRESH WORKSPACE really receives it. The trigger
    // ships as a `kind: "hook"` BUNDLE member (ADR-013/C1: before this, the matcher
    // existed in the repo only inside test fixtures, so `aof work init` installed the
    // script and no entry at all), and it lands through the co-authored merge. Exec form
    // (`args` present, `command` a bare executable) is the cross-machine requirement;
    // the matcher is pinned to ONE exact string. There is deliberately no MultiEdit case
    // anywhere: the tool was measured removed from the shipped set.
    //
    // ADR-013/C2 AMENDS AC1's two "absolute path" Thens (the feature's own text still
    // carries the pre-amendment wording): `.claude/settings.json` is TRACKED and a
    // `git worktree` inherits it verbatim, so an argv element in it may not carry an
    // install-time absolute path. Both elements collapse into ONE checkout-relative
    // script path; the queue is derived from the script's own installed location.
    name: "artifact-sync/00 the installed hook is a PostToolUse command hook in EXEC form with the matcher pinned to exactly Write|Edit|NotebookEdit",
    run: async () => withCheckout(async ({ dir }) => {
      await mkdir(path.join(dir, ".claude"), { recursive: true });
      await writeFile(claudeSettingsPath(dir), `${JSON.stringify({ hooks: { PostToolUse: [] } }, null, 2)}\n`, "utf8");
      // NO project-config hook: the declaration comes from aof's own bundle, which is
      // what makes this a claim about a fresh workspace rather than about a fixture.
      await applyClaudeSettingsMerge(dir, { name: "fresh" });

      const settings = JSON.parse(readFileSync(claudeSettingsPath(dir), "utf8"));
      const groups = settings.hooks.PostToolUse;
      const aofGroups = groups.filter((group) => group.hooks.some((entry) => entry.aofManaged != null));
      assert.equal(aofGroups.length, 1, "exactly one aof-authored group, from the bundle alone");
      assert.equal(aofGroups[0].matcher, "Write|Edit|NotebookEdit", "the matcher is the exact string");

      const entry = aofGroups[0].hooks[0];
      assert.equal(entry.type, "command");
      assert.equal(entry.command, "node");
      assert.ok(Array.isArray(entry.args) && entry.args.length > 0, "a non-empty args array (exec form)");
      assert.doesNotMatch(entry.command, /[|&;<>$`"'\\]/, "the command carries no shell metacharacter — it is a bare executable");

      assert.ok(entry.args.includes(ARTIFACT_SYNC_SCRIPT_RELPATH), "one args element names the enqueue script, checkout-relative");
      for (const arg of entry.args) {
        assert.equal(path.isAbsolute(arg), false, `no argv element is an install-time absolute path (${arg}) — ADR-013/C2`);
        assert.doesNotMatch(arg, /^[A-Za-z]:/, `no drive-letter path in argv (${arg})`);
        assert.doesNotMatch(arg, /\$\{?\w+\}?|%\w+%/, `no environment variable in argv (${arg})`);
        assert.doesNotMatch(arg, /\\/, `argv uses forward slashes so the same entry spawns on the Mac and WSL workers (${arg})`);
      }
      // …and the argv the entry carries really is where the bundle installs the script.
      const installedTarget = JSON.parse(readFileSync(path.join(repoRoot, "src", "bundle", "bundle.json"), "utf8"))
        .members.find((member) => member.id === "artifact-sync-enqueue").target;
      assert.equal(installedTarget, ARTIFACT_SYNC_SCRIPT_RELPATH, "the bundle installs the script exactly where the entry names it");
    }),
  },
  {
    // ADR-013/C2, QA's closing scenario — the reason the absolute path had to go. The
    // committed settings file is checked out into a SECOND workspace at a different
    // path, and the hook fires there before any aof command has run.
    name: "artifact-sync/00 a second checkout of the committed settings file names its OWN queue",
    run: async () => withCheckout(async (first) => withCheckout(async (second) => {
      await mkdir(path.join(first.dir, ".claude"), { recursive: true });
      await applyClaudeSettingsMerge(first.dir, { name: "first" });
      const committed = readFileSync(claudeSettingsPath(first.dir), "utf8");

      // The SECOND workspace receives that file verbatim — a `git worktree add` /
      // `git clone` of the tracked copy — and nothing else has run there.
      await mkdir(path.join(second.dir, ".claude"), { recursive: true });
      await writeFile(claudeSettingsPath(second.dir), committed, "utf8");
      const entry = JSON.parse(committed).hooks.PostToolUse[0].hooks[0];

      const result = deliver({ tool_name: "Write", tool_input: { file_path: `${second.dir}/STORY.md` } }, { script: entry.args[0], cwd: second.dir });
      assert.equal(result.status, 0, "the hook ran in the second checkout");
      assert.equal(queueLines(second.queuePath).length, 1, "the line lands in the SECOND workspace's queue file");
      assert.equal(queueLines(first.queuePath).length, 0, "no line is appended to the first workspace's queue");
    })),
  },
  {
    // ADR-013/C2's SHARP half: an absolute `args[0]` that does not exist on this node
    // makes `node` ITSELF exit non-zero, before the script's "exit 0, always" can apply
    // — AC4 defeated from outside the script. The checkout-relative entry cannot.
    name: "artifact-sync/00 the committed entry still spawns where the absolute form would have failed the tool call",
    run: async () => withCheckout(async ({ dir, queuePath }) => {
      const payload = { tool_name: "Write", tool_input: { file_path: `${dir}/STORY.md` } };

      // The pre-amendment shape, reproduced: an absolute path from ANOTHER checkout.
      const foreign = path.join(dir, "not-this-checkout", ...ARTIFACT_SYNC_SCRIPT_RELPATH.split("/"));
      const absolute = deliver(payload, { script: foreign, cwd: dir });
      assert.notEqual(absolute.status, 0, "node itself fails on an absolute path that does not exist here (non-vacuous — this is the defeated AC4)");

      // The shipped shape: relative, resolved by the harness against the project dir.
      const relative = deliver(payload, { script: ARTIFACT_SYNC_SCRIPT_RELPATH, cwd: dir });
      assert.equal(relative.status, 0, "the checkout-relative entry spawns and exits 0");
      assert.equal(relative.stdout, "", "…and says nothing on stdout");
      assert.equal(queueLines(queuePath).length, 1, "…and enqueues the line, in this checkout's own queue");
    }),
  },
  {
    // THE PER-TOOL PATH MAP (AC3) — the highest-value table in the story, because the
    // field name is NOT uniform. Row 4 is the failure mode the design exists to remove:
    // a hook keyed only on `file_path` drops every notebook edit SILENTLY.
    name: "artifact-sync/00 the mapped path field is resolved per tool, and a matched-but-unresolvable payload degrades loudly instead of vanishing",
    run: async () => {
      const rows = [
        { tool: "Write", input: { file_path: "/w/STORY.md" }, lines: 1, expect: { tool: "Write", path: "/w/STORY.md" } },
        { tool: "Edit", input: { file_path: "/w/STATE.md" }, lines: 1, expect: { tool: "Edit", path: "/w/STATE.md" } },
        { tool: "NotebookEdit", input: { notebook_path: "/w/analysis.ipynb" }, lines: 1, expect: { tool: "NotebookEdit", path: "/w/analysis.ipynb" } },
        // MEASURED EXCEPTION: NotebookEdit carries `notebook_path`. A payload that
        // carries only `file_path` for it is a MATCHED tool with an absent mapped
        // field — coded, never dropped.
        { tool: "NotebookEdit", input: { file_path: "/w/analysis.ipynb" }, lines: 1, expect: { tool: "NotebookEdit", code: "unresolved-path" } },
        { tool: "Write", input: {}, lines: 1, expect: { tool: "Write", code: "unresolved-path" } },
        { tool: "Edit", input: undefined, lines: 1, expect: { tool: "Edit", code: "unresolved-path" } },
        { tool: "NotebookEdit", input: {}, lines: 1, expect: { tool: "NotebookEdit", code: "unresolved-path" } },
        { tool: "Bash", input: { command: "npm test" }, lines: 0, expect: null },
      ];
      for (const row of rows) {
        await withCheckout(async ({ dir, queuePath }) => {
          const payload = { tool_name: row.tool, ...(row.input === undefined ? {} : { tool_input: row.input }) };
          const result = deliver(payload, { script: ARTIFACT_SYNC_SCRIPT_RELPATH, cwd: dir });
          assert.equal(result.status, 0, `${row.tool}: exit 0`);
          assert.equal(result.stdout, "", `${row.tool}: nothing on stdout`);
          const lines = queueLines(queuePath);
          assert.equal(lines.length, row.lines, `${row.tool} (${JSON.stringify(row.input)}): ${row.lines} line(s)`);
          if (row.expect == null) return;
          const parsed = JSON.parse(lines[0]);
          assert.deepEqual(parsed, row.expect, `${row.tool}: the appended line`);
          if (row.expect.code != null) assert.equal(parsed.path, undefined, "a coded line names no path");
          if (row.expect.path != null) assert.equal(parsed.code, undefined, "a resolved line carries no code");
        });
      }
    },
  },
  {
    // THE LINE DERIVES NOTHING (AC2), stated behaviourally: every value in it can be
    // pointed at in the payload, and the SAME queue file is appended to from an
    // unrelated cwd. The cwd clause is not incidental — cwd-derived identity is
    // TECH_DEBT item 4, the defect that silently discarded 100% of the frames for days.
    // Since ADR-013/C2 the queue follows the SCRIPT, not the cwd, so the script is
    // named absolutely here to hold the cwd variable on its own.
    name: "artifact-sync/00 the appended line carries only payload values, and lands in the same queue file from any cwd",
    run: async () => withCheckout(async ({ dir, script, queuePath }) => {
      const worktree = path.join(dir, "worktree");
      await mkdir(worktree, { recursive: true });
      // A RELATIVE path in the payload: resolving it would itself be a cwd derivation,
      // so it must be carried VERBATIM — and identically from both cwds.
      const payload = { tool_name: "Write", tool_input: { file_path: "./wiki/work/43/STORY.md" }, session_id: "s-1", cwd: worktree };

      const first = deliver(payload, { script, cwd: worktree });
      const second = deliver(payload, { script, cwd: path.parse(worktree).root });
      assert.equal(first.status, 0);
      assert.equal(second.status, 0);

      const lines = queueLines(queuePath);
      assert.equal(lines.length, 2, "both invocations appended to the SAME queue file, from different cwds");
      const payloadValues = new Set(["Write", "./wiki/work/43/STORY.md", "s-1", worktree]);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        assert.equal(parsed.path, "./wiki/work/43/STORY.md", "the path is byte-identical to the payload's mapped field");
        for (const value of Object.values(parsed)) {
          assert.ok(payloadValues.has(value), `every value comes from the payload (${value})`);
        }
        for (const key of ["workspaceId", "workspace", "itemRef", "ref", "nodeId", "node", "cwd"]) {
          assert.equal(parsed[key], undefined, `the line carries no ${key}`);
        }
      }
      assert.deepEqual(lines[0], lines[1], "the two cwds produced byte-identical lines");
      assert.deepEqual(await readdir(path.join(dir, ".aof")), ["artifact-sync-queue.ndjson"], "no second queue file was created anywhere");
    }),
  },
  {
    // A HOT HOOK: PostToolUse on Write|Edit fires far more often than the per-prompt
    // `session ping` this repo already runs, so append ordering and concurrent appends
    // are part of the contract. A torn interleave would silently lose an artifact.
    name: "artifact-sync/00 consecutive and concurrent payloads each produce exactly one whole, separately-parseable line",
    run: async () => withCheckout(async ({ dir, script, queuePath }) => {
      const paths = Array.from({ length: 20 }, (_, index) => `${dir}/file-${String(index).padStart(2, "0")}.md`);
      for (const filePath of paths.slice(0, 10)) {
        const result = deliver({ tool_name: "Write", tool_input: { file_path: filePath } }, { script, cwd: dir });
        assert.equal(result.status, 0);
      }
      // The remaining ten by ten CONCURRENTLY-spawned processes — real OS-level
      // interleaving against one append-only file, not a simulated one.
      const { spawn } = await import("node:child_process");
      await Promise.all(paths.slice(10).map((filePath) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script], { cwd: dir, stdio: ["pipe", "ignore", "ignore"] });
        child.on("error", reject);
        child.on("close", () => resolve());
        child.stdin.end(JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath } }));
      })));

      const lines = queueLines(queuePath);
      assert.equal(lines.length, 20, "exactly twenty lines");
      const seen = lines.map((line) => JSON.parse(line).path); // every line parses ON ITS OWN
      for (const filePath of paths) {
        assert.equal(seen.filter((value) => value === filePath).length, 1, `${filePath} appears in exactly one line`);
      }
      assert.deepEqual(seen.slice(0, 10), paths.slice(0, 10), "the first ten appear in delivery order");
    }),
  },
  {
    // "NEVER FAILS THE AGENT" IS A FIRST-CLASS CONTRACT (AC4). The faults are induced
    // in the WORLD — a real absent parent, a real directory, a real file-as-parent, a
    // real torn line on disk — never by injecting a throwing seam into the script.
    name: "artifact-sync/00 a queue that cannot be written exits 0 and stays silent — never a failed tool call",
    run: async () => {
      const rows = [
        { name: "a parent directory that does not exist", prepare: async () => {}, writes: false },
        {
          name: "an existing directory rather than a file",
          prepare: async ({ queuePath }) => { await mkdir(queuePath, { recursive: true }); },
          writes: false,
        },
        {
          name: "a path whose parent is a file",
          prepare: async ({ dir }) => { await writeFile(path.join(dir, ".aof"), "not a directory\n", "utf8"); },
          writes: false,
          noAofDir: true,
        },
        {
          name: "a torn final line from a killed run",
          prepare: async ({ dir, queuePath }) => {
            await mkdir(path.join(dir, ".aof"), { recursive: true });
            await writeFile(queuePath, '{"tool":"Write","path":"/x/STORY.m', "utf8");
          },
          writes: true,
          torn: true,
        },
        {
          name: "a valid empty file",
          prepare: async ({ dir, queuePath }) => {
            await mkdir(path.join(dir, ".aof"), { recursive: true });
            await writeFile(queuePath, "", "utf8");
          },
          writes: true,
        },
      ];
      for (const row of rows) {
        await withCheckout(async ({ dir, script, queuePath }) => {
          // withCheckout pre-creates `.aof/`; rows 1 and 3 need it gone.
          await rm(path.join(dir, ".aof"), { recursive: true, force: true });
          await row.prepare({ dir, queuePath });
          const before = [
            await readdir(dir).catch(() => []),
            await readdir(path.dirname(queuePath)).catch(() => []),
            await readdir(queuePath).catch(() => []),
          ];

          const result = deliver({ tool_name: "Write", tool_input: { file_path: `${dir}/STORY.md` } }, { script, cwd: dir });
          assert.equal(result.status, 0, `${row.name}: exit 0`);
          assert.equal(result.stdout, "", `${row.name}: nothing on stdout`);
          const after = [
            await readdir(dir).catch(() => []),
            await readdir(path.dirname(queuePath)).catch(() => []),
            await readdir(queuePath).catch(() => []),
          ];
          if (!row.writes) {
            assert.equal(queueLines(queuePath).length, 0, `${row.name}: nothing is written`);
            // …and the script created no file or directory anywhere near the queue
            // destination: the three listings are byte-identical to before the run.
            assert.deepEqual(after, before, `${row.name}: the script created no file or directory outside the queue destination`);
            return;
          }
          const text = readFileSync(queuePath, "utf8");
          if (row.torn) {
            assert.ok(text.startsWith('{"tool":"Write","path":"/x/STORY.m'), `${row.name}: the torn line is left as-is`);
            const whole = text.split("\n").filter((line) => line.trim().length > 0);
            assert.equal(whole.length, 2, `${row.name}: the new line is appended whole beside it`);
            assert.deepEqual(JSON.parse(whole[1]), { tool: "Write", path: `${dir}/STORY.md` });
          } else {
            assert.equal(queueLines(queuePath).length, 1, `${row.name}: exactly one whole line is appended`);
          }
        });
      }
    },
  },
  {
    // THE PAYLOAD ITSELF CAN BE MISSING OR MALFORMED. Distinct from the coded
    // `unresolved-path` case above: an unparseable payload names no tool, so there is
    // nothing to enqueue.
    name: "artifact-sync/00 an absent or malformed payload exits 0 and enqueues nothing",
    run: async () => {
      const rows = [
        { name: "nothing (stdin closes immediately, 0 bytes)", raw: "" },
        { name: "whitespace only", raw: "   \n  \t " },
        { name: "text that is not JSON", raw: "this is not json at all" },
        { name: "a JSON array rather than an object", raw: '[{"tool_name":"Write"}]' },
        { name: "valid JSON with no tool_name key", raw: '{"tool_input":{"file_path":"/x/STORY.md"}}' },
        { name: "valid JSON whose tool_name is not a string", raw: '{"tool_name":{"name":"Write"},"tool_input":{"file_path":"/x/STORY.md"}}' },
      ];
      for (const row of rows) {
        await withCheckout(async ({ dir, script, queuePath }) => {
          const result = deliver(null, { script, cwd: dir, raw: row.raw });
          assert.equal(result.status, 0, `${row.name}: exit 0`);
          assert.equal(result.stdout, "", `${row.name}: nothing on stdout`);
          assert.equal(queueLines(queuePath).length, 0, `${row.name}: nothing enqueued`);
        });
      }
    },
  },
  {
    // THE DEGRADED PATH IS NEVER WORSE THAN TODAY (AC4). With the queue unwritable for
    // a WHOLE RUN, the artifacts still reach the control node — on the reconciliation
    // tick that already runs and that STATE mandates keeping. This is what makes the
    // "degrades to the pre-existing behaviour" claim confirmable rather than asserted,
    // and the fault is induced in the WORLD: the queue path is a real directory, so
    // every real hook invocation's real append really fails.
    name: "artifact-sync/00 with the queue unwritable for a whole run the artifacts still reach the control node on the reconciliation tick",
    run: async () => withArtifactSyncFixture(async (fx) => {
      // The queue destination cannot be written for the duration of the run.
      await mkdir(fx.queuePath, { recursive: true });

      const architecture = path.join(fx.itemDir, "ARCHITECTURE.md");
      const featureA = path.join(fx.itemDir, "tasks", "00_a.feature");
      const featureB = path.join(fx.itemDir, "tasks", "01_b.feature");
      await mkdir(path.dirname(featureA), { recursive: true });
      await writeFile(architecture, "the ADR log the agent just wrote\n", "utf8");
      await writeFile(featureA, "@executable\nFeature: a\n  Scenario: one\n", "utf8");
      await writeFile(featureB, "@executable\nFeature: b\n  Scenario: two\n", "utf8");

      // …and every one of those writes fires the REAL hook — installed in the worktree
      // exactly as a workspace has it, so it derives THIS worktree's queue and really
      // cannot append, because that queue is a directory.
      const script = await installScript(fx.worktree);
      for (const filePath of [architecture, featureA, featureB]) {
        const result = deliver({ tool_name: "Write", tool_input: { file_path: filePath } }, { script, cwd: fx.worktree });
        assert.equal(result.status, 0, "no tool call reported an error to the agent");
        assert.equal(result.stdout, "", "…and nothing was written on stdout");
      }
      assert.deepEqual(await readdir(fx.queuePath), [], "no line was enqueued — the queue destination is unwritable");

      // Within ONE stream tick the control node answers anyway.
      await fx.tick();
      await fx.deliver();
      const doc = await fx.doc("43/03", "ARCHITECTURE");
      assert.equal(doc.body, "the ADR log the agent just wrote\n", "`work doc 43/03 ARCHITECTURE --json` answers with the new body");
      const tasks = await fx.tasks("43/03");
      assert.deepEqual(tasks.tasks.map((task) => task.file), ["00_a.feature", "01_b.feature"], "`work tasks 43/03 --json` lists both feature files");
    }),
  },
];
