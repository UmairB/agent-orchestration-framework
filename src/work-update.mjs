// `aof work update` — re-render the shipped ACD bundle against a consumer repo's
// install manifest and on-disk files (milestone 01 / story 02). The SYMMETRIC
// TWIN of `aof work init`: a THIN orchestrator over the existing engine.
//
//   ADR-003: update does NOT implement its own create/update/skip/drift/delete or
//     a `--force` comparison. It synthesizes the SAME aof `config` init does (the
//     shared synthesis in work-bundle-synthesis.mjs) and delegates to
//     createRenderPlan → planApplyActions(previousLock = the install manifest) →
//     executeApplyActions → createLockManifest. (Guarded by acd-reuses-render-plan.)
//   ADR-004 → ADR-009: the per-repo install manifest is the `work` SECTION of the
//     SINGLE unified project lock `.aof/aof.lock.json` (workspacePaths().lockPath) —
//     the separate per-vertical work-lock file is eliminated. update reads the
//     unified lock, passes the `work` SECTION (its recorded `files[]`) to
//     planApplyActions as `previousLock` for the drift-check, rebuilds the `work`
//     manifest, and writes `{ ...currentLock, work: <manifest> }` — preserving the
//     flat asset fields and the `planning` section, never reconstructing from a
//     fixed field set. The no-manifest guard keys off ABSENCE of `lock.work`.
//     (Guarded by acd-install-manifest-contract, section form.)
//   ADR-005: drift detection is the engine's: a managed file whose hash diverges
//     from the manifest classifies as `drift-warning` and is preserved, never
//     overwritten without --force. (Guarded by acd-no-clobber-without-force.)
//   ADR-006: cross-runtime mapping is delegated to the CAPABILITIES matrix via the
//     shared synthesis — no `runtime === "codex"`/`"claude"` installability branch
//     lives here. (Guarded by acd-capability-delegation.)
import path from "node:path";
import { readLock, writeLock } from "./lock.mjs";
import { createLockManifest, executeApplyActions, planApplyActions } from "./render-plan.mjs";
import { RUNTIMES } from "./model.mjs";
import { loadBundle } from "./work-bundle.mjs";
import { bundleVersion, summarizeActions, synthesizeBundleConfig } from "./work-bundle-synthesis.mjs";
import { workspacePaths } from "./workspace.mjs";
import { readConfig } from "./work-headroom.mjs";
import { ensureAofGitignore } from "./aof-gitignore.mjs";
// m43 / ADR-002: the co-authored `.claude/settings.json` is not in the render plan;
// the claude hook ENTRY lands through the surgical merge (the SAME call init makes, so
// the two doors cannot drift), after the plan has written the files its argv names.
import { applyClaudeSettingsMerge } from "./claude-settings.mjs";

// ADR-009: the install manifest is the `work` section of the single unified project
// lock `.aof/aof.lock.json` (resolved via workspacePaths().lockPath). There is no
// separate per-vertical work-lock file. The acd-install-manifest-contract fitness
// function greps this source to prove update names ONLY the unified lock.
export function workLockPath(targetDir) {
  return workspacePaths(targetDir).lockPath;
}

// `aof work update [dir] [--dry-run] [--force]`.
//
// Returns a structured result (for the CLI to print and for tests to assert):
//   { targetDir, runtimes, dryRun, force, notInitialized, actions, notInstallable,
//     desiredOutputs, manifest, manifestPath, manifestWritten, summary }
// When no install manifest exists, returns `notInitialized: true` having written
// NOTHING — the CLI maps that to a non-zero exit and points the user to init.
//
// A `bundleOverride` (a `{ resources, templates, descriptor }` object) is a
// TEST-ONLY seam: it lets a test synthesize a modified bundle (a changed / added /
// dropped member) without mutating the real shipped `src/bundle/`. It is NOT a
// drift hook — the override only chooses WHICH bundle is loaded; all
// classification still flows through planApplyActions unchanged.
export async function updateWork(options = {}) {
  const targetDir = path.resolve(options.targetDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);

  const lockPath = workLockPath(targetDir);

  // No-manifest guard (task 00 → ADR-009): update re-renders against a prior
  // install. Key off ABSENCE of the `work` SECTION of the unified lock (the lock
  // may exist for the asset/`planning` verticals while `work` has never run). If
  // there is no `work` section the repo was never `work init`-ed — refuse, write
  // nothing, and direct the user to init.
  const currentLock = await readLock(lockPath);
  const workSection = currentLock?.work ?? null;
  if (!workSection) {
    return {
      targetDir,
      dryRun,
      force,
      notInitialized: true,
      manifestPath: lockPath,
      manifestWritten: false,
      actions: [],
      notInstallable: [],
      message: "No ACD install found in .aof/aof.lock.json. Run `aof work init` first to install the ACD bundle."
    };
  }

  // The drift-check baseline is the `work` SECTION (its recorded `files[]` hashes),
  // NOT the whole unified lock — the engine compares desired vs on-disk vs this.
  const previousLock = workSection;

  // Re-render for the runtimes recorded at install time (ADR-006). Falls back to
  // claude only if a legacy manifest omitted them.
  const runtimes = normalizeRuntimes(previousLock.runtimes);

  const bundle = options.bundleOverride ?? loadBundle();

  // The IDENTICAL synthesis init uses (shared helper, ADR-003). This is the only
  // structural surface update adds; classification is the engine's.
  const { desiredOutputs, notInstallable } = await synthesizeBundleConfig(bundle, { runtimes, targetDir });

  // Update semantics: previousLock IS the install manifest (ADR-004). The engine
  // classifies create/update/skip/drift-warning/delete by comparing the desired
  // hash vs. on-disk hash vs. this prior lock, with --force semantics. No drift
  // logic is authored here.
  const actions = await planApplyActions(desiredOutputs, previousLock, { force, targetDir });

  if (dryRun) {
    return {
      targetDir,
      runtimes,
      dryRun,
      force,
      notInitialized: false,
      actions,
      notInstallable,
      desiredOutputs,
      manifestPath: lockPath,
      manifestWritten: false,
      summary: summarizeActions(actions)
    };
  }

  await executeApplyActions(actions);

  // m43 / ADR-013/C4 — the `.aof/.gitignore` baseline is re-established on UPDATE too,
  // not only on init. It was called by `work-init.mjs` and by nothing else, so a
  // workspace initialised before a baseline entry existed would never receive it: the
  // artifact-sync queue would stay untracked-but-not-ignored in every worktree of every
  // existing install. Idempotent and additive, exactly as on the init path.
  await ensureAofGitignore(targetDir);

  const claudeSettings = await applyClaudeSettingsMerge(targetDir, (await readConfig(targetDir)).config);

  // Rewrite the install manifest (task 03, ADR-004 → ADR-009): createLockManifest
  // produces the lock-v2 record — it already PRESERVES drift-warned entries (keeps
  // their PRIOR entry, passed as previousLock = the `work` section) and DROPS
  // deleted ones. Re-attach the `bundle: { version }` set to the NEW bundle release,
  // MINUS the section's own `version` (the unified lock carries ONE top-level
  // version). This is the rewritten `work` SECTION.
  const baseManifest = createLockManifest({
    actions,
    desiredOutputs,
    previousLock,
    config: { packages: [] },
    runtimes
  });
  // ADR-009: build the `work` section by EXPLICIT field selection — do NOT spread
  // `baseManifest`. createLockManifest spreads its `previousLock` (here the prior
  // `work` section), so baseManifest carries a stale top-level `version`/`bundle`;
  // spreading it would leak those into the nested `work` section. Pick fields only.
  const manifest = {
    generatedAt: baseManifest.generatedAt,
    // The NEW bundle release version (ADR-002 bundleVersion). A test that drives a
    // synthesized bundle may pass `bundleVersionOverride` to model a release bump.
    bundle: { version: options.bundleVersionOverride ?? bundleVersion() },
    runtimes,
    // Repo-relative paths with forward slashes (ADR-004). The renderer/lock layer
    // emits OS-separator paths; normalize here so the manifest is portable.
    files: baseManifest.files.map((entry) => ({ ...entry, path: String(entry.path).replaceAll("\\", "/") })),
    packages: baseManifest.packages,
    frameworks: baseManifest.frameworks,
    frameworkInstallAttempts: baseManifest.frameworkInstallAttempts
  };
  // Read-merge-write (ADR-009): preserve the flat asset fields and the `planning`
  // section; replace ONLY the `work` key. Never reconstruct from a fixed field set.
  await writeLock(lockPath, { ...(currentLock ?? {}), work: manifest });

  return {
    targetDir,
    runtimes,
    dryRun,
    force,
    notInitialized: false,
    actions,
    notInstallable,
    desiredOutputs,
    manifest,
    manifestPath: lockPath,
    manifestWritten: true,
    claudeSettings,
    summary: summarizeActions(actions)
  };
}

function normalizeRuntimes(runtimes) {
  const selected = Array.isArray(runtimes) && runtimes.length > 0 ? runtimes : ["claude"];
  const deduped = [...new Set(selected.map((runtime) => String(runtime).trim()).filter(Boolean))];
  for (const runtime of deduped) {
    if (!RUNTIMES[runtime]) {
      throw new Error(`Unsupported runtime "${runtime}" in the install manifest. Expected one of: ${Object.keys(RUNTIMES).join(", ")}.`);
    }
  }
  return deduped;
}
