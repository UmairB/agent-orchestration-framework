// Fitness function: acd-claude-settings-co-authored (milestone 43 / ADR-002) —
//
//   "`.claude/settings.json` is a CO-AUTHORED file: aof splices only its own
//    self-identifying hook entry through a read-overlay-write merge, and the whole-file
//    render path is CLOSED for it. A whole-file render is correct exactly when aof
//    EXCLUSIVELY owns the file."
//
// THE DEFECT THIS GATES (verified from source at HEAD, not merely reported):
// `src/render-plan.mjs:13-49` gates drift protection on a PRIOR LOCK ENTRY. For a file
// that exists on disk with NO prior entry — exactly this repo's hand-authored
// `.claude/settings.json`, which the bundle has never written (0 manifest entries) —
// every guard is skipped and the code falls through to
//   actions.push(action("update", output, prior ? "…" : "existing file will be overwritten"))
// an UNGATED overwrite: no --force, no drift warning. The content that would be written
// is `claudeSettingsJson({hooks, settings})` (src/runtime-config.mjs:21-28), which builds
// the ENTIRE body from config.hooks + config.settings and nothing else — dropping the
// operator's permissions/sandbox/plugins and four hand-wired hook events.
//
// It is DORMANT, not absent: `.aof/aof.config.json` has no `hooks` and no `settings`
// key, so `renderRuntimeConfigOutputs` (src/adapters.mjs:101-111) emits nothing today.
// It ARMS the moment this milestone adds a claude-runtime hook — which is why proof 3
// is keyed on exactly that condition. This is m42 leg d4's `writeLock` defect verbatim:
// one writer assuming sole ownership of a document with several authors.
//
// Proofs:
//  1. GREEN, a canary — the operator's top-level keys and four hand-wired hook events are
//     still present. A wholesale render would delete every one of them, so this fires on
//     the damage even if the mechanism changes shape.
//  2. GREEN — the 34-file bundle manifest carries ZERO `.claude/settings.json` entry: the
//     whole-file, content-hashed installer never writes this file (and must not start).
//  3. ARMED AT THE HAZARD — IF `.aof/aof.config.json` declares a claude-runtime hook or a
//     `settings.claude` entry, THEN `src/adapters.mjs` must not render the file whole-file
//     (no `claudeSettingsJson(` call reachable from the render pipeline) and a merge writer
//     must exist. A clean skip while the config declares neither.
//  Self-check (m03 non-vacuous): a planted claude-hook config trips the hazard detector,
//  and a planted wholesale-rendered settings body fails the key canary.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETTINGS = path.join(repoRoot, ".claude", "settings.json");
const MANIFEST = path.join(repoRoot, "src", "bundle", "manifest.json");
const AOF_CONFIG = path.join(repoRoot, ".aof", "aof.config.json");
const ADAPTERS = path.join(repoRoot, "src", "adapters.mjs");

// Candidate homes for the ADR-002 merge writer (mirroring mergeLock / writeSidecarPatch).
const MERGE_WRITER_CANDIDATES = [
  path.join(repoRoot, "src", "claude-settings.mjs"),
  path.join(repoRoot, "src", "runtime-settings-merge.mjs"),
];

// The operator's own top-level keys, measured at HEAD. `claudeSettingsJson` builds its
// body from config.hooks + config.settings alone, so a wholesale render drops all of
// these — this list IS the canary.
const OPERATOR_TOP_LEVEL_KEYS = ["hooks", "permissions", "sandbox", "enabledPlugins", "extraKnownMarketplaces"];
// …and the four hand-wired hook EVENTS beside the PostToolUse slot this milestone fills.
const HAND_WIRED_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "SessionEnd", "PreToolUse"];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// The hazard is live once aof's own config asks for a claude-runtime hook or setting —
// the exact trigger for renderRuntimeConfigOutputs to emit the file.
function hazardIsLive(config) {
  const hooks = Array.isArray(config?.hooks) ? config.hooks : [];
  const claudeHook = hooks.some((hook) => Array.isArray(hook?.runtimes) && hook.runtimes.includes("claude"));
  const claudeSettings = config?.settings != null && Object.prototype.hasOwnProperty.call(config.settings, "claude");
  return claudeHook || claudeSettings;
}

function settingsKeyProblems(settings) {
  const problems = [];
  for (const key of OPERATOR_TOP_LEVEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(settings ?? {}, key)) {
      problems.push(`.claude/settings.json lost the operator's top-level "${key}" — the wholesale-overwrite signature`);
    }
  }
  for (const event of HAND_WIRED_HOOK_EVENTS) {
    if (!Object.prototype.hasOwnProperty.call(settings?.hooks ?? {}, event)) {
      problems.push(`.claude/settings.json lost the hand-wired "${event}" hook — the wholesale-overwrite signature`);
    }
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/43 ADR-002 (acd-claude-settings-co-authored): the operator's top-level keys and four hand-wired hook events survive in .claude/settings.json (the wholesale-overwrite canary)",
    run: async () => {
      const settings = JSON.parse(await readFile(SETTINGS, "utf8"));
      const problems = settingsKeyProblems(settings);
      assert.deepEqual(problems, [], `co-authorship problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/43 ADR-002 (acd-claude-settings-co-authored): the content-hashed bundle manifest carries ZERO .claude/settings.json entry — the whole-file installer never writes a co-authored file",
    run: async () => {
      const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
      const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
      assert.ok(entries.length > 0, "the bundle manifest has entries (non-vacuous)");
      const settingsEntries = entries.filter((entry) => String(entry?.path ?? "").replace(/\\/g, "/").endsWith(".claude/settings.json"));
      assert.deepEqual(
        settingsEntries,
        [],
        "the bundle must never install .claude/settings.json wholesale — it is co-authored (ADR-002); the hook SCRIPT ships as a bundle asset, the hook ENTRY through the merge",
      );
    },
  },
  {
    name: "arch/43 ADR-002 (acd-claude-settings-co-authored): ARMED AT THE HAZARD — once a claude-runtime hook/setting exists in .aof/aof.config.json, adapters.mjs must not render the file whole-file and a merge writer must exist",
    run: async () => {
      const config = JSON.parse(await readFile(AOF_CONFIG, "utf8"));
      if (!hazardIsLive(config)) return; // dormant: a clean skip that arms the moment the story adds the hook

      const adapters = stripComments(await readFile(ADAPTERS, "utf8"));
      assert.ok(
        !/claudeSettingsJson\s*\(/.test(adapters),
        "src/adapters.mjs still renders .claude/settings.json WHOLE-FILE (claudeSettingsJson) while a claude hook is configured — planApplyActions falls through to an ungated overwrite (render-plan.mjs:48)",
      );
      const writer = MERGE_WRITER_CANDIDATES.find((candidate) => existsSync(candidate));
      assert.ok(
        writer != null,
        `no .claude/settings.json merge writer exists (looked for ${MERGE_WRITER_CANDIDATES.map((p) => path.relative(repoRoot, p)).join(", ")}) — a configured claude hook has no safe write path`,
      );
    },
  },
  {
    name: "arch/43 ADR-002 (acd-claude-settings-co-authored): self-check — a planted claude-hook config arms the hazard, and a wholesale-rendered body fails the key canary",
    run: async () => {
      const real = JSON.parse(await readFile(AOF_CONFIG, "utf8"));
      assert.equal(hazardIsLive(real), false, "the hazard is dormant at HEAD (no hooks/settings key in .aof/aof.config.json)");
      assert.equal(
        hazardIsLive({ hooks: [{ event: "PostToolUse", runtimes: ["claude"] }] }),
        true,
        "a planted claude-runtime hook arms the hazard detector",
      );
      assert.equal(hazardIsLive({ settings: { claude: { model: "x" } } }), true, "a planted settings.claude entry arms the hazard detector");
      assert.equal(hazardIsLive({ hooks: [{ event: "Stop", runtimes: ["codex"] }] }), false, "a codex-only hook does not arm the claude hazard");

      // The wholesale render's actual output shape: body = runtimeSettings(settings,"claude") + hooks.
      const wholesaleRendered = { hooks: { PostToolUse: [] } };
      assert.ok(
        settingsKeyProblems(wholesaleRendered).length >= OPERATOR_TOP_LEVEL_KEYS.length - 1,
        "a wholesale-rendered settings body trips the key canary (the operator's keys are gone)",
      );
      assert.deepEqual(
        settingsKeyProblems(JSON.parse(await readFile(SETTINGS, "utf8"))),
        [],
        "the real, hand-authored settings file passes the same canary",
      );
    },
  },
];
