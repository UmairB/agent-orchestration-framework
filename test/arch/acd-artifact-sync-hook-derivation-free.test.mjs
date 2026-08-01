// Fitness function: acd-artifact-sync-hook-derivation-free (milestone 43 / ADR-001) —
//
//   "The sync trigger is a PostToolUse `command` hook in EXEC form whose body DERIVES
//    NOTHING: it reads stdin, resolves the path field through an explicit per-tool map,
//    appends one NDJSON line to a queue path stamped into its argv, and exits 0 —
//    always. It opens no store, imports nothing from src/, boots no CLI, and computes
//    no workspace identity."
//
// WHY each clause is structural, not behavioural:
//  - "derives no workspace identity" is TECH_DEBT item 4 — a cwd-derived id is what
//    silently discarded 100% of the worker->control frames for days. A scenario can
//    only sample one run; the ABSENCE of a derivation is a source fact.
//  - "handles notebook_path as well as file_path" is RESEARCH §1.2 measured: Write/Edit
//    carry `tool_input.file_path`, NotebookEdit carries `tool_input.notebook_path`. A
//    hook keyed only on file_path silently misses every notebook edit — silence is the
//    exact failure mode being engineered out.
//  - "exec form, never shell form" is RESEARCH §1.6: the shell FORM's interpreter
//    differs across the Windows control node, the Mac worker and the WSL worker
//    (bash / Git-Bash / PowerShell), and a hook that behaves differently per node is
//    the cross-machine defect class this repo keeps paying for.
//
// STATE OF BUILD: the enqueue script is built by 43_story_artifact-sync-on-write.
//  - Proof 1 is GREEN TODAY: the in-repo hook precedent still reads `tool_input` from
//    stdin (the payload field name the whole design hangs on) — if that contract ever
//    changes, this fires before the new hook is written against a dead field.
//  - Proof 2 is GREEN TODAY and vacuously satisfied while `PostToolUse` is empty: every
//    aof-authored PostToolUse entry in .claude/settings.json is exec form. It binds the
//    moment the story writes one.
//  - Proof 3 is ARMED: a clean skip while the enqueue script is absent, strict the
//    moment it lands.
//  Self-check (m03 non-vacuous): planted shell-form entries and a planted deriving
//  script trip the SAME detectors the real sources pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETTINGS = path.join(repoRoot, ".claude", "settings.json");
const EXISTING_HOOK = path.join(repoRoot, ".claude", "hooks", "aof", "guard-test-isolation.mjs");

// Where the story may land the enqueue script — the bundle source (the aof-exclusive,
// content-hashed asset, ADR-002) or its installed location in this repo.
const ENQUEUE_CANDIDATES = [
  path.join(repoRoot, "src", "bundle", "hooks", "artifact-sync-enqueue.mjs"),
  path.join(repoRoot, ".claude", "hooks", "aof", "artifact-sync-enqueue.mjs"),
];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// An entry aof authored: its command/args mention an aof artefact. Operator-authored
// entries are none of this guard's business (ADR-002: the file is CO-AUTHORED).
function isAofAuthored(entry) {
  const blob = JSON.stringify(entry ?? {});
  return /aof/i.test(blob);
}

// EXEC form (RESEARCH §1.6): `args` present alongside `command`, and `command` is a bare
// executable name/path with no shell metacharacters — never a shell command STRING.
function execFormProblems(entry) {
  const problems = [];
  if (entry?.type !== "command") return problems; // http/prompt/agent/mcp_tool: not this clause's subject
  if (!Array.isArray(entry.args)) {
    problems.push(`aof PostToolUse entry is SHELL form (no \`args\`): ${JSON.stringify(entry.command)}`);
    return problems;
  }
  if (typeof entry.command !== "string" || /[|&;<>$`"']/.test(entry.command)) {
    problems.push(`aof PostToolUse entry's \`command\` is not a bare executable: ${JSON.stringify(entry.command)}`);
  }
  return problems;
}

function aofPostToolUseEntries(settings) {
  const groups = settings?.hooks?.PostToolUse ?? [];
  const entries = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const entry of Array.isArray(group?.hooks) ? group.hooks : []) {
      if (isAofAuthored(entry)) entries.push(entry);
    }
  }
  return entries;
}

// The enqueue script must derive NOTHING and must never fail the agent.
function enqueueProblems(code) {
  const problems = [];
  const importsSrc = /\bfrom\s+["'][^"']*(?:\.\.\/)*src\/[^"']+["']/.test(code) ||
    /\bfrom\s+["']\.\.\/\.\.\/src\/[^"']+["']/.test(code);
  if (importsSrc) problems.push("the enqueue script imports from src/ — it must be standalone");
  for (const forbidden of ["workspaceIdFor", "loadWorkspace", "openGlobalWorkProjectionStore", "openGlobalWorkStore"]) {
    if (new RegExp(`\\b${forbidden}\\b`).test(code)) {
      problems.push(`the enqueue script calls ${forbidden}() — it must DERIVE NOTHING (TECH_DEBT item 4)`);
    }
  }
  if (!/\bfile_path\b/.test(code)) problems.push("the enqueue script does not resolve tool_input.file_path (Write/Edit)");
  if (!/\bnotebook_path\b/.test(code)) {
    problems.push("the enqueue script does not resolve tool_input.notebook_path (NotebookEdit) — measured RESEARCH §1.2");
  }
  if (/process\.exit\(\s*[1-9]/.test(code)) {
    problems.push("the enqueue script can exit non-zero — a failed enqueue must never surface to the agent (exit 0, always)");
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/43 ADR-001 (acd-artifact-sync-hook-derivation-free): the in-repo hook precedent still reads `tool_input` from stdin — the payload field contract the whole trigger hangs on",
    run: async () => {
      const code = stripComments(await readFile(EXISTING_HOOK, "utf8"));
      assert.ok(
        /readFileSync\(\s*0\s*,/.test(code),
        ".claude/hooks/aof/guard-test-isolation.mjs reads its payload from stdin (fd 0) — the measured hook contract",
      );
      assert.ok(
        /\btool_input\b/.test(code),
        ".claude/hooks/aof/guard-test-isolation.mjs reads `tool_input` — the field name RESEARCH §1.2 measured and ADR-001 builds on",
      );
    },
  },
  {
    name: "arch/43 ADR-001 (acd-artifact-sync-hook-derivation-free): every aof-authored PostToolUse entry in .claude/settings.json is EXEC form (`args` + a bare executable), never a shell string",
    run: async () => {
      const settings = JSON.parse(await readFile(SETTINGS, "utf8"));
      assert.ok(
        Object.prototype.hasOwnProperty.call(settings?.hooks ?? {}, "PostToolUse"),
        ".claude/settings.json still carries a PostToolUse slot (the trigger's home)",
      );
      const problems = aofPostToolUseEntries(settings).flatMap(execFormProblems);
      assert.deepEqual(problems, [], `exec-form problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/43 ADR-001 (acd-artifact-sync-hook-derivation-free): ARMED — once the enqueue script exists it imports no src/ module, derives no workspace identity, resolves BOTH path fields, and cannot exit non-zero",
    run: async () => {
      const found = ENQUEUE_CANDIDATES.find((candidate) => existsSync(candidate));
      if (found == null) return; // not-yet-built: a clean skip that arms the moment the script lands
      const problems = enqueueProblems(stripComments(await readFile(found, "utf8")));
      assert.deepEqual(problems, [], `${path.relative(repoRoot, found)}: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/43 ADR-001 (acd-artifact-sync-hook-derivation-free): self-check — a planted shell-form entry and a planted deriving/exiting script trip the SAME detectors",
    run: async () => {
      const good = { type: "command", command: "node", args: [".claude/hooks/aof/artifact-sync-enqueue.mjs", "--queue", "/tmp/q.ndjson"] };
      assert.deepEqual(execFormProblems(good), [], "the real exec-form shape passes");
      const shellForm = { type: "command", command: "node .claude/hooks/aof/artifact-sync-enqueue.mjs | tee /tmp/aof.log" };
      assert.ok(execFormProblems(shellForm).length > 0, "a planted SHELL-form aof entry trips the detector");
      assert.ok(isAofAuthored(shellForm), "the aof-authorship detector recognises an aof entry");
      assert.ok(!isAofAuthored({ type: "command", command: "node", args: ["scripts/lint.mjs"] }), "an operator entry is not claimed by this guard");

      const cleanScript = `
        import { appendFileSync } from "node:fs";
        import { readFileSync } from "node:fs";
        const p = JSON.parse(readFileSync(0, "utf8"));
        const file = p.tool_name === "NotebookEdit" ? p.tool_input?.notebook_path : p.tool_input?.file_path;
        try { appendFileSync(queuePath, JSON.stringify({ file }) + "\\n"); } catch (e) { /* reported by the drain */ }
      `;
      assert.deepEqual(enqueueProblems(cleanScript), [], "a clean derivation-free enqueue passes");
      assert.ok(
        enqueueProblems(cleanScript + '\nimport { workspaceIdFor } from "../../src/workspace-identity.mjs";').length > 0,
        "a planted workspace-identity derivation trips the detector",
      );
      assert.ok(
        enqueueProblems(cleanScript + "\nprocess.exit(2);").length > 0,
        "a planted non-zero exit trips the detector",
      );
      assert.ok(
        enqueueProblems(cleanScript.replace(/notebook_path/g, "file_path")).length > 0,
        "a script that only handles file_path (missing NotebookEdit) trips the detector",
      );
    },
  },
];
