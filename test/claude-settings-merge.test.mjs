// milestone 43 / story 03 — task 03: the CO-AUTHORED `.claude/settings.json`
// (`tasks/03_claude-settings-surgical-merge.feature`, AC9–AC12, ADR-002).
//
// A HARD RULE, AND THE FIXTURE THAT KEEPS IT: every scenario runs against a BYTE-COPY
// of the operator's real `.claude/settings.json`, placed in a scratch directory.
// NOTHING here writes to the repo's own file — it is this repo's live hook config
// (SessionStart / UserPromptSubmit / SessionEnd session wiring plus the PreToolUse
// test-isolation guard), and the whole story exists because a latent defect would
// delete it. The copy is read once, from disk, so the fixture is the operator's real
// key set rather than someone's memory of it.
//
// EVERY `Then` is confirmable from the settings FILE's own bytes before and after a
// run — its parsed content, its byte-for-byte comparison against the prior copy, its
// mtime — plus the `--json` plan envelope of the command that ran. The invariant "the
// settings writer never writes the file wholesale" is a property of every possible run
// and belongs to `test/arch/acd-claude-settings-co-authored.test.mjs`; what is asserted
// here is its observable consequence.
//
// BYTE-IDENTICAL, READ AS THE PRECEDENTS DEFINE IT. ADR-002 names `mergeLock` and
// `writeSidecarPatch` as the shape to mirror, and both re-serialise the whole document
// with `JSON.stringify(_, null, 2)`; `mergeLock`'s own comment says keys the patch does
// not name "survive byte-equivalent". So a surviving key is compared by its canonical
// serialisation — every operator VALUE intact, nothing dropped, nothing invented.
// (A merge that changes nothing writes nothing at all, so an untouched file is never
// even re-serialised.)
//
// The `@manual` scenario at the foot of the feature (a scratch CLONE of this repo,
// with a real `claude` session started in it) is not agent-runnable in one process and
// is NOT attempted here.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyClaudeSettingsMerge, claudeSettingsPath, formatClaudeSettingsOutcome, AOF_HOOK_MARKER } from "../src/claude-settings.mjs";
import { ARTIFACT_SYNC_SCRIPT_ARGV, ARTIFACT_SYNC_SCRIPT_RELPATH } from "../src/artifact-sync.mjs";
import { initWork } from "../src/work-init.mjs";
import { updateWork } from "../src/work-update.mjs";
import { assetsApplyCommand } from "../src/commands/assets-apply.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPERATOR_SETTINGS = path.join(repoRoot, ".claude", "settings.json");

// The config declaration that arms the hook — the Background's "an `.aof/aof.config.json`
// in that workspace declaring the claude-runtime artifact-sync hook".
const ARTIFACT_SYNC_HOOK = {
  id: "aof-artifact-sync",
  event: "PostToolUse",
  matcher: "Write|Edit|NotebookEdit",
  type: "command",
  command: "node",
  runtimes: ["claude"],
  // ADR-013/C2 — a checkout-relative argv, because `.claude/settings.json` is tracked
  // and a worktree inherits it verbatim. The queue is derived from the script.
  claude: { args: [ARTIFACT_SYNC_SCRIPT_RELPATH] },
};

// Most scenarios below isolate the PROJECT-CONFIG half of the union: the hook they
// splice is the fixture's own declaration, so `bundleHooks: []` models a workspace
// whose aof bundle declares no claude hook (a codex-only install). The UNION against
// the REAL bundle — the shape a fresh `aof work init` produces — has its own scenario,
// and the door scenarios below run with the real bundle too.
const ISOLATED = { bundleHooks: [] };

const OPERATOR_TOP_LEVEL = ["hooks", "enabledPlugins", "extraKnownMarketplaces", "permissions", "sandbox"];
const HAND_WIRED_EVENTS = ["SessionStart", "UserPromptSubmit", "SessionEnd", "PreToolUse"];

async function operatorFixtureText() {
  return readFile(OPERATOR_SETTINGS, "utf8");
}

// withFixture(body, { settings, declares }) — a scratch workspace carrying a BYTE-COPY
// of the operator's file (unless a scenario asks for a different `before` state) and an
// `.aof/aof.config.json` that declares (or omits) the hook.
async function withFixture(body, { settings = "operator", declares = true } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-claude-settings-"));
  try {
    await mkdir(path.join(dir, ".aof"), { recursive: true });
    const config = { name: "fixture", work: { dir: "./wiki/work" }, resources: [], packages: [], ...(declares ? { hooks: [ARTIFACT_SYNC_HOOK] } : {}) };
    await writeFile(path.join(dir, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    if (settings !== "absent") {
      await mkdir(path.join(dir, ".claude"), { recursive: true });
      const text = settings === "operator" ? await operatorFixtureText() : settings;
      await writeFile(claudeSettingsPath(dir), text, "utf8");
    }
    return await body({ dir, config, settingsPath: claudeSettingsPath(dir) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const readSettings = async (settingsPath) => JSON.parse(await readFile(settingsPath, "utf8"));
const canonical = (value) => JSON.stringify(value);
const aofEntries = (settings, event = "PostToolUse") =>
  (settings?.hooks?.[event] ?? []).flatMap((group) => (group.hooks ?? []).filter((entry) => entry[AOF_HOOK_MARKER] != null));
const operatorGroups = (settings, event = "PostToolUse") =>
  (settings?.hooks?.[event] ?? []).filter((group) => (group.hooks ?? []).every((entry) => entry[AOF_HOOK_MARKER] == null));

export const claudeSettingsMergeTests = [
  {
    // HEADLINE (AC9) — the defect this closes, stated as its own negation. A wholesale
    // render builds the file's entire body from `config.hooks` + `config.settings` and
    // nothing else, so every row below is a key it would have deleted.
    name: "claude-settings/03 every pre-existing key survives the merge byte-identical",
    run: async () => withFixture(async ({ dir, config, settingsPath }) => {
      const before = await readSettings(settingsPath);
      // Non-vacuous: the fixture really is the operator's file, with all five top-level
      // keys and all five hand-wired hook events.
      assert.deepEqual(Object.keys(before).sort(), [...OPERATOR_TOP_LEVEL].sort(), "the fixture carries the operator's measured top-level key set");
      assert.deepEqual(Object.keys(before.hooks).sort(), [...HAND_WIRED_EVENTS, "PostToolUse"].sort(), "…and its five hook events");
      assert.deepEqual(before.hooks.PostToolUse, [], "…with PostToolUse present-but-empty");
      assert.ok(before.permissions.deny.length > 0 && before.sandbox.filesystem.denyRead.length > 0, "…and a real permissions/sandbox body");

      const result = await applyClaudeSettingsMerge(dir, config, ISOLATED);
      assert.equal(result.action, "updated");
      const after = await readSettings(settingsPath);

      for (const event of HAND_WIRED_EVENTS) {
        assert.equal(canonical(after.hooks[event]), canonical(before.hooks[event]), `hooks.${event} is byte-identical to before`);
      }
      for (const key of ["permissions", "sandbox", "enabledPlugins", "extraKnownMarketplaces"]) {
        assert.equal(canonical(after[key]), canonical(before[key]), `${key} is byte-identical to before`);
      }
      assert.equal(after.hooks.PostToolUse.length, 1, "hooks.PostToolUse grew by exactly one aof-authored entry");
      assert.equal(aofEntries(after).length, 1, "…and nothing else");
      assert.deepEqual(Object.keys(after), Object.keys(before), "the set of top-level keys is unchanged — no key added, none removed");
      assert.deepEqual(Object.keys(after.hooks), Object.keys(before.hooks), "…and so is the set of hook events");
    }),
  },
  {
    // THE MERGE TARGET IS THREE LEVELS DEEP (AC9): not "one key" but one hook array
    // entry, inside one event key, inside one top-level key. Neither precedent
    // (`mergeLock`, `writeSidecarPatch`) reaches below the top level, so an operator
    // entry on the SAME event is the case that would break a naive port of either.
    name: "claude-settings/03 an operator entry on the same PostToolUse event survives byte-identical beside aof's",
    run: async () => {
      const operator = JSON.parse(await operatorFixtureText());
      operator.hooks.PostToolUse = [
        { matcher: "Bash", hooks: [{ type: "command", command: "npm run lint" }] },
        { matcher: "Edit", hooks: [{ type: "command", command: "echo second-operator-group" }] },
      ];
      return withFixture(async ({ dir, config, settingsPath }) => {
        const before = await readSettings(settingsPath);
        const result = await applyClaudeSettingsMerge(dir, config, ISOLATED);
        assert.equal(result.action, "updated");
        const after = await readSettings(settingsPath);

        const groups = operatorGroups(after);
        assert.equal(groups.length, 2, "both operator groups survive");
        assert.equal(canonical(groups[0]), canonical(before.hooks.PostToolUse[0]), "the operator's PostToolUse group is byte-identical to before");
        assert.equal(canonical(groups[1]), canonical(before.hooks.PostToolUse[1]), "…and so is the second");
        assert.equal(groups[0].matcher, "Bash", "the operator's group keeps its position relative to the other operator group");
        assert.equal(groups[1].matcher, "Edit");
        assert.equal(aofEntries(after).length, 1, "aof's entry is present beside them");
        for (const event of HAND_WIRED_EVENTS) {
          assert.equal(canonical(after.hooks[event]), canonical(before.hooks[event]), `no other event key under hooks changed (${event})`);
        }
      }, { settings: `${JSON.stringify(operator, null, 2)}\n` });
    },
  },
  {
    // IDEMPOTENCE (AC10) — what the self-identifying marker buys. Without one the merge
    // cannot tell its own entry from an operator's on the next run, and would either
    // append a duplicate every run or clobber a sibling.
    name: "claude-settings/03 running the merge repeatedly leaves exactly one aof-authored entry",
    run: async () => {
      for (const runs of [1, 2, 5]) {
        await withFixture(async ({ dir, config, settingsPath }) => {
          const before = await readSettings(settingsPath);
          let firstBytes = null;
          for (let i = 0; i < runs; i += 1) {
            await applyClaudeSettingsMerge(dir, config, ISOLATED);
            if (i === 0) firstBytes = await readFile(settingsPath, "utf8");
          }
          const after = await readSettings(settingsPath);
          assert.equal(aofEntries(after).length, 1, `${runs} run(s): hooks.PostToolUse holds exactly one aof-authored entry`);
          for (const event of HAND_WIRED_EVENTS) {
            assert.equal(canonical(after.hooks[event]), canonical(before.hooks[event]), `${runs} run(s): the operator's own entries are byte-identical to before the first run`);
          }
          assert.equal(await readFile(settingsPath, "utf8"), firstBytes, `${runs} run(s): the file's bytes after the last run are identical to its bytes after the first`);
        });
      }
    },
  },
  {
    // THE SKIP-WRITE REFINEMENT (AC9, `writeSidecarPatch`'s own): a merge whose result
    // is unchanged performs NO write at all. Observable as an mtime that does not move —
    // which is what stops a no-op `work update` looking like an edit to git, to a
    // watcher, or to the operator.
    name: "claude-settings/03 a merge whose result is byte-identical writes nothing and leaves no mtime churn",
    run: async () => withFixture(async ({ dir, config, settingsPath }) => {
      await applyClaudeSettingsMerge(dir, config, ISOLATED);
      const bytes = await readFile(settingsPath, "utf8");
      const mtime = (await stat(settingsPath)).mtimeMs;
      await new Promise((resolve) => setTimeout(resolve, 25));

      const result = await applyClaudeSettingsMerge(dir, config, ISOLATED);
      assert.equal(result.action, "skipped", "the merge reports a skip, not a write");
      assert.equal(result.written, false);
      assert.equal(await readFile(settingsPath, "utf8"), bytes, "the file's bytes are unchanged");
      assert.equal((await stat(settingsPath)).mtimeMs, mtime, "the file's mtime is unchanged");
      const siblings = await readdir(path.join(dir, ".claude"));
      assert.deepEqual(siblings, ["settings.json"], "no temporary file is left beside it");
    }),
  },
  {
    // RETRACTION (AC10): removing the hook from config removes exactly aof's entry and
    // nothing else. The first row is the precise one — the operator's file ships
    // `PostToolUse: []` present-and-empty, so a retraction must return it to `[]`, never
    // delete the key.
    name: "claude-settings/03 retracting the hook from config removes exactly aof's entry",
    run: async () => {
      const opA = { matcher: "Bash", hooks: [{ type: "command", command: "npm run lint" }] };
      const opB = { matcher: "Edit", hooks: [{ type: "command", command: "echo b" }] };
      const rows = [
        { name: "aof's entry alone", operators: [], expect: [] },
        { name: "an operator group then aof's entry", operators: [opA], expect: [opA], aofLast: true },
        { name: "aof's entry then an operator group", operators: [opA], expect: [opA], aofFirst: true },
        { name: "two operator groups around aof's entry", operators: [opA, opB], expect: [opA, opB] },
        { name: "an empty array (aof never installed)", operators: [], expect: [], neverInstalled: true },
      ];
      for (const row of rows) {
        const operator = JSON.parse(await operatorFixtureText());
        operator.hooks.PostToolUse = [...row.operators];
        await withFixture(async ({ dir, settingsPath }) => {
          const configPath = path.join(dir, ".aof", "aof.config.json");
          const base = { name: "fixture", work: { dir: "./wiki/work" }, resources: [], packages: [] };
          if (!row.neverInstalled) {
            await applyClaudeSettingsMerge(dir, { ...base, hooks: [ARTIFACT_SYNC_HOOK] }, ISOLATED);
            const installed = await readSettings(settingsPath);
            assert.equal(aofEntries(installed).length, 1, `${row.name}: aof's entry is present before the retraction`);
            if (row.aofFirst) {
              // The operator moved their group AFTER aof's — the retraction must still
              // leave it byte-identical and in place.
              installed.hooks.PostToolUse = [installed.hooks.PostToolUse.at(-1), ...installed.hooks.PostToolUse.slice(0, -1)];
              await writeFile(settingsPath, `${JSON.stringify(installed, null, 2)}\n`, "utf8");
            }
          }
          const before = await readSettings(settingsPath);
          const bytesBefore = await readFile(settingsPath, "utf8");
          const mtimeBefore = (await stat(settingsPath)).mtimeMs;
          await new Promise((resolve) => setTimeout(resolve, 25));

          // The claude hook is REMOVED from `.aof/aof.config.json`, and the merge runs.
          await writeFile(configPath, `${JSON.stringify(base, null, 2)}\n`, "utf8");
          const result = await applyClaudeSettingsMerge(dir, base, ISOLATED);
          const after = await readSettings(settingsPath);

          assert.ok(Object.prototype.hasOwnProperty.call(after.hooks, "PostToolUse"), `${row.name}: the key survives, it is not deleted`);
          assert.equal(aofEntries(after).length, 0, `${row.name}: aof's entry is gone`);
          assert.equal(after.hooks.PostToolUse.length, row.expect.length, `${row.name}: ${row.expect.length} group(s) remain`);
          for (const [index, group] of row.expect.entries()) {
            assert.equal(canonical(after.hooks.PostToolUse[index]), canonical(group), `${row.name}: operator group ${index} is byte-identical and in its original order`);
          }
          for (const key of ["permissions", "sandbox", "enabledPlugins", "extraKnownMarketplaces"]) {
            assert.equal(canonical(after[key]), canonical(before[key]), `${row.name}: ${key} is byte-identical to before the retraction`);
          }
          for (const event of HAND_WIRED_EVENTS) {
            assert.equal(canonical(after.hooks[event]), canonical(before.hooks[event]), `${row.name}: ${event} is byte-identical to before the retraction`);
          }
          if (row.neverInstalled) {
            assert.equal(result.action, "skipped", `${row.name}: no write is performed`);
            assert.equal(await readFile(settingsPath, "utf8"), bytesBefore, `${row.name}: the bytes are unchanged`);
            assert.equal((await stat(settingsPath)).mtimeMs, mtimeBefore, `${row.name}: …and so is the mtime`);
          }
        }, { settings: `${JSON.stringify(operator, null, 2)}\n`, declares: !row.neverInstalled });
      }
    },
  },
  {
    // THE READ SIDE (AC9): absent / zero-byte / torn / `{}`, induced in the WORLD — the
    // real file really is absent, really is zero bytes, really is truncated JSON.
    //
    // ONE DELIBERATE DEVIATION, FLAGGED NOT HIDDEN: row 5 (torn + declares). The
    // feature's Examples row says the torn file is "read as `{}`, then written with
    // exactly aof's entry" — ADR-002's original fallback. ADR-010/R3.A SUPERSEDES that
    // clause, and does so explicitly ("the sharpest catch of the set"): a torn read of a
    // CO-AUTHORED file must be a coded refuse-and-report, `claude-settings-unparseable`,
    // writing NOTHING, because answering one missing brace by replacing the operator's
    // ~140-key document with a three-line aof-only one IS the defect this module exists
    // to close. The build follows the ADR; the feature row is reported to the PO for
    // reconciliation rather than quietly satisfied either way.
    name: "claude-settings/03 an absent, empty, torn or empty-object settings file is handled without inventing content",
    run: async () => {
      const rows = [
        { name: "absent + declares", settings: "absent", declares: true, expect: "created" },
        { name: "absent + omits", settings: "absent", declares: false, expect: "absent" },
        { name: "zero bytes + declares", settings: "", declares: true, expect: "created-from-empty" },
        { name: "exactly {} + omits", settings: "{}", declares: false, expect: "unchanged" },
        { name: "torn + declares", settings: '{ "hooks": { "PostToolUse": [ ', declares: true, expect: "refused", reason: /not parseable JSON/ },
        { name: "torn + omits", settings: '{ "hooks": { "PostToolUse": [ ', declares: false, expect: "refused", reason: /not parseable JSON/ },
        // VALID JSON that cannot hold settings. Telling an operator their file "is not
        // parseable JSON" when it parses perfectly sends them looking for a missing
        // brace that is not there, so the refusal names what it actually found.
        { name: "a JSON array + declares", settings: "[]", declares: true, expect: "refused", reason: /parses as JSON array/ },
        { name: "a JSON string + declares", settings: '"nope"', declares: true, expect: "refused", reason: /parses as JSON string/ },
        { name: "a JSON number + declares", settings: "42", declares: true, expect: "refused", reason: /parses as JSON number/ },
      ];
      for (const row of rows) {
        await withFixture(async ({ dir, config, settingsPath }) => {
          const bytesBefore = row.settings === "absent" ? null : await readFile(settingsPath, "utf8");
          const mtimeBefore = row.settings === "absent" ? null : (await stat(settingsPath)).mtimeMs;
          await new Promise((resolve) => setTimeout(resolve, 25));
          const result = await applyClaudeSettingsMerge(dir, config, ISOLATED);

          if (row.expect === "created" || row.expect === "created-from-empty") {
            const after = await readSettings(settingsPath);
            assert.deepEqual(Object.keys(after), ["hooks"], `${row.name}: exactly hooks.PostToolUse with aof's entry — no key the merge did not author or find`);
            assert.deepEqual(Object.keys(after.hooks), ["PostToolUse"]);
            assert.equal(aofEntries(after).length, 1, `${row.name}: aof's entry`);
            assert.equal(result.action, row.expect === "created" ? "created" : "updated");
          }
          if (row.expect === "absent") {
            assert.equal(existsSync(settingsPath), false, `${row.name}: still absent — no empty file is created`);
            assert.equal(result.action, "absent");
            assert.equal(result.written, false);
          }
          if (row.expect === "unchanged") {
            assert.equal(await readFile(settingsPath, "utf8"), bytesBefore, `${row.name}: byte-identical`);
            assert.equal((await stat(settingsPath)).mtimeMs, mtimeBefore, `${row.name}: mtime unchanged — no write is performed`);
            assert.equal(result.action, "skipped");
          }
          if (row.expect === "refused") {
            // ADR-010/R3.A: a file we cannot read is a file whose contents we cannot
            // claim to preserve, and preserving them is the whole point.
            assert.equal(result.code, "claude-settings-unparseable", `${row.name}: a coded refusal`);
            assert.equal(result.written, false, `${row.name}: writing NOTHING`);
            assert.match(result.message, row.reason, `${row.name}: …and the operator is told what is actually wrong with the file`);
            assert.ok(result.message.includes(settingsPath), `${row.name}: …naming the file`);
            assert.equal(await readFile(settingsPath, "utf8"), bytesBefore, `${row.name}: the torn file is left untouched`);
            assert.equal((await stat(settingsPath)).mtimeMs, mtimeBefore, `${row.name}: …with its mtime`);
          }
        }, { settings: row.settings, declares: row.declares });
      }
    },
  },
  {
    // SELF-IDENTIFYING MEANS AOF RECOGNISES ITS OWN, AND ONLY ITS OWN (AC10). An entry
    // an operator hand-copied WITHOUT the marker is the operator's; aof neither adopts,
    // edits nor retracts it. An entry aof DID author is aof's to keep canonical — and
    // the restore is REPORTED (ADR-010/R3.E: never SILENTLY restored).
    name: "claude-settings/03 an unmarked look-alike entry is treated as the operator's, and aof's own marked entry is kept canonical",
    run: async () => {
      const operator = JSON.parse(await operatorFixtureText());
      return withFixture(async ({ dir, config, settingsPath }) => {
        // A look-alike: the same shape as aof's entry, with NO ownership marker.
        const lookAlike = {
          matcher: "Write|Edit|NotebookEdit",
          hooks: [{ type: "command", command: "node", args: [ARTIFACT_SYNC_SCRIPT_RELPATH] }],
        };
        const seeded = { ...operator, hooks: { ...operator.hooks, PostToolUse: [lookAlike] } };
        await writeFile(settingsPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

        await applyClaudeSettingsMerge(dir, config, ISOLATED);
        let after = await readSettings(settingsPath);
        assert.equal(canonical(operatorGroups(after)[0]), canonical(lookAlike), "the unmarked entry is byte-identical to before");
        assert.equal(aofEntries(after).length, 1, "aof's own marked entry is present beside it");

        // The queue path inside aof's OWN marked entry is hand-edited…
        const edited = await readSettings(settingsPath);
        const aofGroup = edited.hooks.PostToolUse.find((group) => (group.hooks ?? []).some((entry) => entry[AOF_HOOK_MARKER] != null));
        aofGroup.hooks[0].args = ["some/other/hook.mjs"];
        await writeFile(settingsPath, `${JSON.stringify(edited, null, 2)}\n`, "utf8");

        const restored = await applyClaudeSettingsMerge(dir, config, ISOLATED);
        after = await readSettings(settingsPath);
        assert.deepEqual(aofEntries(after)[0].args, [ARTIFACT_SYNC_SCRIPT_RELPATH], "aof's marked entry is restored to the value the config implies");
        assert.equal(restored.drift.length, 1, "…and the restore is REPORTED, never silent (ADR-010/R3.E)");
        assert.equal(restored.drift[0].id, ARTIFACT_SYNC_HOOK.id);
        // ADR-013/C3 — the report NAMES the escape hatch, because an escape hatch nobody
        // is told about is not one: the marker is aof's claim of authorship, and removing
        // it makes the entry the operator's.
        const line = formatClaudeSettingsOutcome(restored, { targetDir: dir });
        assert.match(line, /drift-warning/, "the restore is reported on the human face too");
        assert.ok(line.includes(`remove the "${AOF_HOOK_MARKER}" key`), "…and the line tells the operator how to keep an edit");
        assert.equal(canonical(operatorGroups(after)[0]), canonical(lookAlike), "the unmarked entry is still byte-identical to before");

        // …and retracting the hook removes ONLY the marked entry.
        const base = { name: "fixture", work: { dir: "./wiki/work" }, resources: [], packages: [] };
        await applyClaudeSettingsMerge(dir, base, ISOLATED);
        after = await readSettings(settingsPath);
        assert.equal(aofEntries(after).length, 0, "aof's marked entry is retracted");
        assert.equal(canonical(after.hooks.PostToolUse), canonical([lookAlike]), "the unmarked one is left byte-identical");
      }, { settings: `${JSON.stringify(operator, null, 2)}\n` });
    },
  },
  {
    // THE TRIGGER SHIPS FROM THE BUNDLE, THROUGH ONE RESOLVER (ADR-013/C1). Before this,
    // `Write|Edit|NotebookEdit` existed in the repo only inside test fixtures: no shipped
    // surface declared a claude-runtime hook, so `aof work init` in a fresh workspace
    // installed the script and NO ENTRY, and AC1 was a claim about a fixture. The union
    // is one resolver — the bundle's declarations plus the project config's — so the
    // doors cannot answer differently about "which hooks does aof install".
    name: "claude-settings/03 a fresh workspace receives the trigger from the bundle, and a project hook joins it through one resolver",
    run: async () => withFixture(async ({ dir, settingsPath }) => {
      // A workspace whose config declares NOTHING: the entry can only come from aof's
      // own bundle.
      const fresh = { name: "fresh", work: { dir: "./wiki/work" }, resources: [], packages: [] };
      await applyClaudeSettingsMerge(dir, fresh);
      const bundled = aofEntries(await readSettings(settingsPath));
      assert.deepEqual(bundled.map((entry) => entry[AOF_HOOK_MARKER]), ["claude-artifact-sync"], "the bundle's trigger lands with no project declaration at all");
      const group = (await readSettings(settingsPath)).hooks.PostToolUse.find((candidate) => candidate.hooks.some((entry) => entry[AOF_HOOK_MARKER] != null));
      assert.equal(group.matcher, "Write|Edit|NotebookEdit", "…with the matcher pinned to exactly the measured tool set");

      // …and a project-config hook joins it rather than replacing it.
      await applyClaudeSettingsMerge(dir, { ...fresh, hooks: [ARTIFACT_SYNC_HOOK] });
      const union = aofEntries(await readSettings(settingsPath)).map((entry) => entry[AOF_HOOK_MARKER]).sort();
      assert.deepEqual(union, ["aof-artifact-sync", "claude-artifact-sync"], "the union carries both, deduped by id");

      // …and a project entry with the SAME id wins, so a workspace can retune aof's own
      // declaration without forking it.
      await applyClaudeSettingsMerge(dir, { ...fresh, hooks: [{ ...ARTIFACT_SYNC_HOOK, id: "claude-artifact-sync", matcher: "Write" }] });
      const overridden = aofEntries(await readSettings(settingsPath));
      assert.equal(overridden.length, 1, "the same id is ONE entry, not two");
      const overriddenGroup = (await readSettings(settingsPath)).hooks.PostToolUse.find((candidate) => candidate.hooks.some((entry) => entry[AOF_HOOK_MARKER] === "claude-artifact-sync"));
      assert.equal(overriddenGroup.matcher, "Write", "…and the project's value wins");
    }),
  },
  {
    // THE WHOLE-FILE RENDER PATH IS CLOSED (AC11) — the latent defect closed BEFORE it
    // arms. `planApplyActions` falls through to an ungated "existing file will be
    // overwritten" for any file with no prior lock entry, which describes this file
    // exactly; `work init` makes it worse by treating every unlocked file as fresh. The
    // observable is that the plan names NO action for the file at all, on every door.
    //
    // Each door is run TWICE: the first run is the one that installs aof's entry (so
    // `hooks` gains exactly that entry and nothing else), the second is the steady state
    // in which ALL FIVE top-level keys are byte-identical. Both states are asserted,
    // because the scenario's Then is only satisfiable in the second for `hooks` itself.
    name: "claude-settings/03 with a claude hook configured, no command plans a whole-file action for .claude/settings.json",
    run: async () => {
      const doors = [
        {
          name: "aof work init --json",
          run: async (dir) => {
            const result = await initWork({ targetDir: dir, runtimes: ["claude"], force: true });
            return { actions: result.actions, lock: result.manifest };
          },
        },
        {
          name: "aof work update --json",
          run: async (dir) => {
            const result = await updateWork({ targetDir: dir });
            assert.notEqual(result.notInitialized, true, "update ran against an installed workspace");
            return { actions: result.actions };
          },
        },
        {
          name: "aof assets apply --json",
          run: async (dir) => {
            const result = await assetsApplyCommand.run({ target: dir });
            assert.equal(result.mode, "applied", "assets apply ran");
            return { actions: result.actions };
          },
        },
      ];

      for (const door of doors) {
        await withFixture(async ({ dir, settingsPath }) => {
          // `work update` needs a prior install; `assets apply` needs a lock. One
          // `work init` first makes every door reachable from the same fixture.
          if (door.name !== "aof work init --json") {
            await initWork({ targetDir: dir, runtimes: ["claude"] });
          }
          const before = await readSettings(settingsPath);
          assert.ok(existsSync(path.join(dir, ".aof", "aof.lock.json")) || door.name === "aof work init --json", "the workspace has an install lock where the door needs one");
          // …and the file has NO entry in aof's install lock — the exact condition that
          // makes `planApplyActions` fall through.
          const lock = existsSync(path.join(dir, ".aof", "aof.lock.json")) ? JSON.parse(await readFile(path.join(dir, ".aof", "aof.lock.json"), "utf8")) : null;
          const lockedPaths = [...(lock?.files ?? []), ...(lock?.work?.files ?? [])].map((entry) => String(entry.path).replaceAll("\\", "/"));
          assert.ok(!lockedPaths.includes(".claude/settings.json"), "the settings file has no entry in aof's install lock (the fall-through condition)");

          const first = await door.run(dir);
          const named = (first.actions ?? []).filter((action) => String(action.path).replaceAll("\\", "/").endsWith(".claude/settings.json"));
          assert.deepEqual(named, [], `${door.name}: the plan envelope names NO action for .claude/settings.json — no create, no update, no drift-warning, no "existing file will be overwritten"`);

          const afterFirst = await readSettings(settingsPath);
          for (const key of ["permissions", "sandbox", "enabledPlugins", "extraKnownMarketplaces"]) {
            assert.equal(canonical(afterFirst[key]), canonical(before[key]), `${door.name}: the operator's ${key} is byte-identical afterwards`);
          }
          for (const event of HAND_WIRED_EVENTS) {
            assert.equal(canonical(afterFirst.hooks[event]), canonical(before.hooks[event]), `${door.name}: the operator's ${event} hook is byte-identical afterwards`);
          }
          // TWO aof entries: the BUNDLE's artifact-sync trigger (ADR-013/C1 — what a
          // fresh workspace receives) and this fixture's own project-config declaration.
          // Both arrived through the merge; neither is in the plan.
          const landed = aofEntries(afterFirst).map((entry) => entry[AOF_HOOK_MARKER]).sort();
          assert.deepEqual(landed, ["aof-artifact-sync", "claude-artifact-sync"], `${door.name}: the bundle's trigger AND the project's hook landed — through the merge, not the plan`);

          // The steady state: run the door again; now every one of the five top-level
          // keys is byte-identical, and the plan still names no action for the file.
          const second = await door.run(dir);
          const namedAgain = (second.actions ?? []).filter((action) => String(action.path).replaceAll("\\", "/").endsWith(".claude/settings.json"));
          assert.deepEqual(namedAgain, [], `${door.name} (second run): the plan still names no action for the file`);
          const afterSecond = await readSettings(settingsPath);
          for (const key of OPERATOR_TOP_LEVEL) {
            assert.equal(canonical(afterSecond[key]), canonical(afterFirst[key]), `${door.name}: the operator's top-level ${key} is byte-identical across the steady-state run`);
          }
        });
      }
    },
  },
  {
    // THE QUEUE IS PER-NODE RUNTIME STATE (ADR-013/C4). It is written into EVERY
    // worktree an agent runs in, so an untracked-but-not-ignored file would (a) show in
    // every `git status` an agent or an operator reads mid-run and (b) leave every
    // worktree permanently DIRTY — which is exactly the input 43/05's ADR-008 refuses
    // gate propagation on. The second half is the one that would otherwise be missed:
    // `ensureAofGitignore` was called by `work init` and by NOTHING ELSE, so an existing
    // workspace would never receive a new baseline entry.
    name: "claude-settings/03 the artifact-sync queue is git-ignored, and an EXISTING workspace gets the entry from work update too",
    run: async () => withFixture(async ({ dir }) => {
      const ignorePath = path.join(dir, ".aof", ".gitignore");
      await initWork({ targetDir: dir, runtimes: ["claude"] });
      const afterInit = (await readFile(ignorePath, "utf8")).split(/\r?\n/).map((line) => line.trim());
      for (const entry of ["artifact-sync-queue.ndjson", "artifact-sync-queue.ndjson.batch"]) {
        assert.ok(afterInit.includes(entry), `work init ignores ${entry}`);
      }

      // An EXISTING workspace: the baseline is stripped back to what a pre-43/03 install
      // would hold, and only `work update` runs.
      await writeFile(ignorePath, "# aof — derived/regenerable artifacts; never commit (the tracked install is committed).\naof.memory.index.json\n", "utf8");
      await updateWork({ targetDir: dir });
      const afterUpdate = (await readFile(ignorePath, "utf8")).split(/\r?\n/).map((line) => line.trim());
      for (const entry of ["artifact-sync-queue.ndjson", "artifact-sync-queue.ndjson.batch"]) {
        assert.ok(afterUpdate.includes(entry), `work update adds ${entry} to an existing workspace's baseline`);
      }
      assert.ok(afterUpdate.includes("aof.memory.index.json"), "…additively — the pre-existing entry survives");
      assert.equal(afterUpdate.filter((line) => line === "artifact-sync-queue.ndjson").length, 1, "…and idempotently, never duplicated");
    }),
  },
  {
    // TWO DOORS (AC12): the enqueue SCRIPT is aof-exclusive and rides the existing
    // content-hashed, drift-protected bundle mechanism; the settings ENTRY rides the
    // merge. Splitting them is what keeps "a whole-file render iff aof exclusively owns
    // the file" true of every file the bundle writes.
    name: "claude-settings/03 the script installs as a drift-protected asset while the installer never writes the settings file",
    run: async () => {
      const operator = JSON.parse(await operatorFixtureText());
      operator.operatorSentinel = { keepMe: true };
      return withFixture(async ({ dir, settingsPath }) => {
        const before = await readSettings(settingsPath);
        assert.deepEqual(before.operatorSentinel, { keepMe: true }, "the fixture carries an operator-only sentinel key (non-vacuous)");

        const install = await initWork({ targetDir: dir, runtimes: ["claude"] });
        const scriptPath = path.join(dir, ...ARTIFACT_SYNC_SCRIPT_RELPATH.split("/"));
        assert.ok(existsSync(scriptPath), "the enqueue script exists at its installed path");
        const bundled = await readFile(path.join(repoRoot, "src", "bundle", "hooks", "artifact-sync-enqueue.mjs"), "utf8");
        assert.equal(await readFile(scriptPath, "utf8"), bundled, "…with the content the bundle recorded");

        const after = await readSettings(settingsPath);
        assert.deepEqual(after.operatorSentinel, { keepMe: true }, "the operator's sentinel key is byte-identical afterwards");
        assert.deepEqual(install.actions.filter((action) => String(action.path).replaceAll("\\", "/").endsWith(".claude/settings.json")), [], ".claude/settings.json appears in NO install action of that run");
        // …while the script DOES appear as a normal, content-hashed install action.
        assert.ok(install.actions.some((action) => String(action.path).replaceAll("\\", "/").endsWith(".claude/hooks/aof/artifact-sync-enqueue.mjs")), "the script rides the ordinary install plan");

        // A hand-modified installed script is reported as DRIFT, exactly as for any
        // other bundled file.
        await writeFile(scriptPath, `${bundled}\n// hand-modified\n`, "utf8");
        const update = await updateWork({ targetDir: dir });
        const scriptActions = update.actions.filter((action) => String(action.path).replaceAll("\\", "/").endsWith("artifact-sync-enqueue.mjs"));
        assert.equal(scriptActions.length, 1, "the script is classified by the ordinary engine");
        assert.equal(scriptActions[0].action, "drift-warning", "…and a hand modification is reported as drift");

        const settings = await readSettings(settingsPath);
        const bundleEntry = aofEntries(settings).find((entry) => entry[AOF_HOOK_MARKER] === "claude-artifact-sync");
        assert.deepEqual(bundleEntry.args, [ARTIFACT_SYNC_SCRIPT_ARGV], "the hook entry's argv still names the installed script — resolved at run time (ADR-013/C2), so a worktree of this file names ITS OWN copy");
        // …and that argv, once the harness substitutes the token for THIS checkout,
        // resolves to a file that really exists here.
        const resolvedArgv = bundleEntry.args[0].replaceAll("${CLAUDE_PROJECT_DIR}", dir);
        assert.ok(existsSync(resolvedArgv), "…and that argv resolves to a file that really exists in this checkout");
      }, { settings: `${JSON.stringify(operator, null, 2)}\n` });
    },
  },
];
