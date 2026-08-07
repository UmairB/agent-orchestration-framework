// src/claude-settings.mjs — the CO-AUTHORED settings writer (milestone 43 / ADR-002).
//
// `.claude/settings.json` is hand-maintained by an operator: ~140 possible top-level
// keys, five independently hand-wired hook events, `permissions.deny`,
// `sandbox.filesystem`, `enabledPlugins`, `extraKnownMarketplaces`. A whole-file
// render builds the body from `config.hooks` + `config.settings` and NOTHING ELSE, so
// it deletes every one of them. That is m42 leg d4's `writeLock` defect verbatim —
// one writer assuming sole ownership of a document with several authors.
//
// THE RULE, ONCE, FOR THE WHOLE CODEBASE (ADR-002): a whole-file render (bundle
// manifest, content-hashed, drift-protected) is correct IFF aof exclusively owns the
// file. A file with any other author gets a SURGICAL MERGE. So the hook SCRIPT ships
// as a bundle asset (aof owns it outright) and the hook ENTRY ships through here.
//
// The merge mirrors `mergeLock` (lock.mjs) and `writeSidecarPatch`
// (node-identity.mjs), including the latter's skip-the-write-when-unchanged
// refinement — with the two things neither precedent needed:
//
//   1. THE TARGET IS THREE LEVELS DEEP. Not "one top-level key" but one hook ARRAY
//      ENTRY, inside one EVENT key, inside one TOP-LEVEL key. An operator entry on
//      the same event survives beside aof's, in its original position.
//   2. AOF'S ENTRIES ARE SELF-IDENTIFYING (ADR-010/R3.E: a marker KEY on the entry
//      object, not a sentinel argv element — argv is content an operator may
//      legitimately edit). Without a marker the merge cannot tell its own entry from
//      an operator's on the next run and would either duplicate every run or clobber
//      a sibling. With one the splice is idempotent AND retractable: removing the
//      hook from config removes exactly aof's entry and nothing else.
//
// TORN READS REFUSE (ADR-010/R3.A, which SUPERSEDES ADR-002's "absent/torn ⇒ {}"):
// absent-⇒-{} is safe only because `mergeLock`'s subject is aof-owned. For a
// co-authored file, answering one missing brace by replacing the operator's document
// with a three-line aof-only one is the exact defect this module exists to close,
// arriving through its own fallback. ABSENT ⇒ `{}` (a genuine fresh install); TORN ⇒
// the coded `claude-settings-unparseable`, writing NOTHING.
//
// WHITESPACE. Like both precedents, the writer re-serialises the whole document with
// `JSON.stringify(_, null, 2)`. Every operator VALUE survives byte-identical; a file
// whose hand-authored layout is more compact is normalised the first time a real
// change is written (and never otherwise — an unchanged merge writes nothing at all).
import path from "node:path";
import { readFile } from "node:fs/promises";
import { writeText } from "./fs.mjs";
// m43 / ADR-013/C1 — the bundle's own hook declarations. The merge is fed the UNION of
// these and the project config's claude hooks through the ONE resolver below, because
// two config sources answering "which hooks does aof install" is the drift this
// milestone keeps paying for. (A narrow read: the descriptor plus the hook members,
// never the 40-odd agent/command/skill bodies.)
import { loadBundleHooks } from "./work-bundle.mjs";

// The marker KEY every aof-authored hook entry carries. Verified schema-legal
// (ADR-010/R3.E): all five hook variants in the installed
// `claude-code-settings.schema.json` leave `additionalProperties` undefined, so an
// extra key on a hook entry is permitted rather than a validation error.
export const AOF_HOOK_MARKER = "aofManaged";

export const CLAUDE_SETTINGS_RELPATH = ".claude/settings.json";

export function claudeSettingsPath(targetDir) {
  return path.join(targetDir, ...CLAUDE_SETTINGS_RELPATH.split("/"));
}

// claudeHookDeclarations(config, { bundleHooks }) — THE ONE RESOLVER (ADR-013/C1) for
// "which claude hooks does aof install here": the BUNDLE's declarations (which is how
// `aof work init` in a fresh workspace gets the artifact-sync trigger at all — the codex
// hooks have always shipped this way) UNION the project config's own. A project entry
// with the same id wins, so a workspace can retune aof's declaration without forking it,
// and the two doors cannot answer differently.
export function claudeHookDeclarations(config, { bundleHooks } = {}) {
  const isClaude = (hook) => (hook?.runtimes == null ? true : Array.isArray(hook.runtimes) && hook.runtimes.includes("claude"));
  const byId = new Map();
  let anonymous = 0;
  for (const hook of [...(bundleHooks ?? loadBundleHooks()), ...(Array.isArray(config?.hooks) ? config.hooks : [])]) {
    // The runtimes default is dsl.mjs's own (`normalizeRuntimes`: absent ⇒ both), so a
    // RAW config read (work init/update) and a LOADED one (assets apply) select the
    // same hooks.
    if (!isClaude(hook)) continue;
    byId.set(typeof hook.id === "string" && hook.id.length > 0 ? hook.id : `anonymous-${anonymous++}`, hook);
  }
  return [...byId.values()];
}

// claudeSettingsPatch(config, { targetDir }) — the aof-authored half of the document.
// `hooks` are the resolved claude-runtime declarations (each becoming one marked entry
// inside one event group); `settings` are the `settings.claude` top-level keys the
// whole-file render used to project (the orchestrator model lives there) — spliced now
// instead of rendered.
export function claudeSettingsPatch(config, { targetDir, bundleHooks } = {}) {
  const hooks = claudeHookDeclarations(config, { bundleHooks })
    .map((hook) => ({
      id: hook.id ?? null,
      event: hook.event,
      matcher: hook.matcher,
      entry: markedEntry(hook, targetDir),
    }))
    .filter((hook) => typeof hook.event === "string" && hook.event.length > 0);
  const claudeSettings = config?.settings?.claude;
  const settings = claudeSettings != null && typeof claudeSettings === "object" && !Array.isArray(claudeSettings)
    ? { ...claudeSettings }
    : {};
  return { hooks, settings };
}

// One aof hook entry, in EXEC form and carrying its ownership marker. `command` stays
// a bare executable and every argument is its own argv element — never a shell string,
// whose interpreter differs across the Windows control node, the Mac worker and the
// WSL worker (ADR-001, RESEARCH §1.6).
function markedEntry(hook, targetDir) {
  const extension = hook?.claude != null && typeof hook.claude === "object" && !Array.isArray(hook.claude) ? hook.claude : {};
  const entry = { type: hook?.type ?? "command", command: hook?.command };
  const args = Array.isArray(extension.args) ? extension.args.map(portableArg) : null;
  if (args != null) entry.args = args;
  for (const [key, value] of Object.entries(extension)) {
    if (key === "args") continue;
    entry[key] = value;
  }
  entry[AOF_HOOK_MARKER] = hook?.id ?? "aof";
  return entry;
}

// EVERY ARGV ELEMENT IS RESOLVED AT RUN TIME, VIA `${CLAUDE_PROJECT_DIR}` (ADR-013/C2).
// `.claude/settings.json` is a tracked file and a `git worktree` inherits it verbatim, so
// an install-time absolute path names another checkout's script — and a missing `args[0]`
// makes `node` itself exit non-zero, defeating the enqueue script's "exit 0, always" from
// OUTSIDE the script. Forward slashes, because a Windows-written entry has to spawn on the
// Mac and WSL workers too.
//
// A BARE checkout-relative argv does NOT work, contrary to this comment's first version:
// the harness does NOT resolve a relative argv against the project directory. It spawns the
// hook with the session's PERSISTED SHELL CWD, so after any `cd` into a subdirectory the
// path misses and node exits MODULE_NOT_FOUND. That surfaces as a `hook_non_blocking_error`
// — NON-blocking, so the tool call proceeds and the hook silently does nothing. Measured
// 2026-08-06 across real installs (voice-vox-web, whisper-guard-portal): 37 such misses,
// from cwds like `<root>/packages/application/`. `${CLAUDE_PROJECT_DIR}` is substituted by
// the harness into BOTH `command` and every `args` element before the spawn, so it stays
// correct in every checkout and every worktree while never writing an absolute path into
// the tracked file. It also makes `process.argv[1]` absolute, which is what the enqueue
// script's `<root>/.claude/hooks/aof/<this>` -> `<root>/.aof/` walk needs to land the queue
// at the project root instead of relative to whatever cwd the hook inherited.
//
// The durable class, bigger than this milestone: anything aof writes into a TRACKED
// file must be checkout-relative or resolved at run time — and "the harness will resolve
// it for me" is an assumption to MEASURE, not to assume.
function portableArg(arg) {
  if (typeof arg !== "string") return arg;
  return arg.replaceAll("\\", "/").replace(/^\.\//, "");
}

// isAofEntry(entry) — aof recognises its own, and ONLY its own. An entry an operator
// hand-copied without the marker is the operator's: aof neither adopts, edits nor
// retracts it.
export function isAofEntry(entry) {
  return entry != null && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, AOF_HOOK_MARKER);
}

// mergeClaudeSettings(settingsPath, patch) — read, splice, write the union; write
// NOTHING when the merged value is unchanged.
//
// Returns { path, action, written, code, message, drift[] } where `action` is one of
//   created | updated | skipped | absent | refused
// `drift` names each aof-marked entry whose on-disk value differed from the one the
// config implies — restored, and REPORTED (never silently, ADR-010/R3.E).
export async function mergeClaudeSettings(settingsPath, patch = {}) {
  const read = await readSettings(settingsPath);
  if (read.code === "claude-settings-unparseable") {
    return {
      path: settingsPath,
      action: "refused",
      written: false,
      code: "claude-settings-unparseable",
      // The message names WHAT is wrong, not a guess: a JSON array / string / number is
      // perfectly parseable and still cannot hold settings, and telling an operator
      // their valid file "is not parseable JSON" sends them to look for a missing brace
      // that is not there (ADR-013 / QA F-10).
      message: `Refusing to write ${settingsPath}: ${read.reason}. aof cannot preserve contents it cannot read — repair or remove the file, then re-run.`,
      drift: [],
    };
  }

  const hookPatches = Array.isArray(patch?.hooks) ? patch.hooks : [];
  const settingsPatch = patch?.settings != null && typeof patch.settings === "object" ? patch.settings : {};
  const nothingToSplice = hookPatches.length === 0 && Object.keys(settingsPatch).length === 0;

  if (read.absent) {
    // A missing file with nothing to splice STAYS missing — no empty artefact is
    // created for a workspace that asked for nothing.
    if (nothingToSplice) {
      return { path: settingsPath, action: "absent", written: false, code: null, message: null, drift: [] };
    }
  }

  const current = read.value ?? {};
  const { merged, drift } = spliceSettings(current, hookPatches, settingsPatch);
  if (stableEqual(merged, current) && !read.absent) {
    return { path: settingsPath, action: "skipped", written: false, code: null, message: null, drift };
  }
  await writeText(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);
  return {
    path: settingsPath,
    action: read.absent ? "created" : "updated",
    written: true,
    code: null,
    message: null,
    drift,
  };
}

// The splice itself. Every top-level key the patch does not name is carried through
// by reference; `hooks` is rebuilt event by event, and an event the patch does not
// name is carried through untouched.
function spliceSettings(current, hookPatches, settingsPatch) {
  const merged = { ...current, ...settingsPatch };
  const currentHooks = current?.hooks != null && typeof current.hooks === "object" && !Array.isArray(current.hooks)
    ? current.hooks
    : null;
  const events = new Set(hookPatches.map((hook) => hook.event));
  // Retraction reaches every event that currently carries an aof entry, not only the
  // events the patch names — otherwise removing a hook from config would strand its
  // entry forever.
  for (const [event, groups] of Object.entries(currentHooks ?? {})) {
    if (hasAofEntry(groups)) events.add(event);
  }
  if (events.size === 0) return { merged, drift: [] };

  const drift = [];
  const nextHooks = { ...(currentHooks ?? {}) };
  for (const event of events) {
    const wanted = hookPatches.filter((hook) => hook.event === event);
    const existing = Array.isArray(nextHooks[event]) ? nextHooks[event] : [];
    const operatorGroups = [];
    for (const group of existing) {
      const entries = Array.isArray(group?.hooks) ? group.hooks : [];
      const carried = entries.filter((entry) => !isAofEntry(entry));
      if (carried.length === entries.length) {
        operatorGroups.push(group); // untouched, by reference — position preserved
        continue;
      }
      for (const mine of entries.filter(isAofEntry)) {
        const replacement = wanted.find((hook) => (hook.entry?.[AOF_HOOK_MARKER] ?? null) === (mine?.[AOF_HOOK_MARKER] ?? null));
        if (replacement != null && !stableEqual(mine, replacement.entry)) {
          drift.push({ event, id: mine?.[AOF_HOOK_MARKER] ?? null, found: mine, expected: replacement.entry });
        }
      }
      if (carried.length > 0) operatorGroups.push({ ...group, hooks: carried });
    }
    const mineGroups = wanted.map((hook) => ({
      ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }),
      hooks: [hook.entry],
    }));
    // The key SURVIVES a full retraction as an empty array — it is never deleted
    // (the operator's file ships `PostToolUse: []` present-and-empty).
    nextHooks[event] = [...operatorGroups, ...mineGroups];
  }
  merged.hooks = nextHooks;
  return { merged, drift };
}

function hasAofEntry(groups) {
  return (Array.isArray(groups) ? groups : []).some((group) => (Array.isArray(group?.hooks) ? group.hooks : []).some(isAofEntry));
}

// The "already matches" test is over the VALUE, not the serialised bytes: a file whose
// hand-authored layout differs from this writer's must not be reformatted by a merge
// that changes nothing (that is exactly the mtime churn writeSidecarPatch's refinement
// exists to prevent).
function stableEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function readSettings(settingsPath) {
  let text;
  try {
    text = await readFile(settingsPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { absent: true, value: {}, code: null };
    throw error;
  }
  if (text.trim().length === 0) return { absent: false, value: {}, code: null }; // zero bytes ⇒ {}
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { absent: false, value: null, code: "claude-settings-unparseable", reason: "it exists but is not parseable JSON" };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      absent: false,
      value: null,
      code: "claude-settings-unparseable",
      reason: `it parses as JSON ${Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed} rather than an object, so it cannot hold settings`,
    };
  }
  return { absent: false, value: parsed, code: null };
}

// applyClaudeSettingsMerge(targetDir, config) — the ONE call the doors make
// (`work init`, `work update`, `assets apply`). It is the reason the whole-file render
// could be REMOVED rather than guarded: the claude runtime's settings still reach the
// file, through the only writer that can be trusted with a co-authored one.
export async function applyClaudeSettingsMerge(targetDir, config, { bundleHooks } = {}) {
  return mergeClaudeSettings(claudeSettingsPath(targetDir), claudeSettingsPatch(config, { targetDir, bundleHooks }));
}

// The one-line human form each door prints. Silent on a no-op: a merge that changed
// nothing has nothing to say, and a line per run would train an operator to ignore it.
export function formatClaudeSettingsOutcome(result, { targetDir } = {}) {
  if (result == null) return null;
  const display = targetDir ? path.relative(targetDir, result.path).replaceAll("\\", "/") : result.path;
  if (result.code != null) return `warning: ${display} — ${result.message}`;
  const lines = [];
  if (result.action === "created" || result.action === "updated") {
    lines.push(`${result.action === "created" ? "Created" : "Updated"} ${display} (merged aof's hook entry; every other key preserved)`);
  }
  for (const entry of result.drift ?? []) {
    // ADR-013/C3: restore AND report — with the escape hatch NAMED, because an escape
    // hatch nobody is told about is not an escape hatch. The marker is aof's claim of
    // authorship; removing it makes the entry the operator's, forever and totally.
    lines.push(
      `drift-warning: ${display} — aof's "${entry.id}" ${entry.event} entry had been edited; restored to the configured value. `
      + `To keep an edit, remove the "${AOF_HOOK_MARKER}" key from that entry: aof then treats it as yours and neither edits nor retracts it.`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
