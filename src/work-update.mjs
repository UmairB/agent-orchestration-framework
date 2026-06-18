// `aof work update` — re-render the shipped ACD bundle against a consumer repo's
// install manifest and on-disk files (milestone 01 / story 02). The SYMMETRIC
// TWIN of `aof work init`: a THIN orchestrator over the existing engine.
//
//   ADR-003: update does NOT implement its own create/update/skip/drift/delete or
//     a `--force` comparison. It synthesizes the SAME aof `config` init does (the
//     shared synthesis in work-bundle-synthesis.mjs) and delegates to
//     createRenderPlan → planApplyActions(previousLock = the install manifest) →
//     executeApplyActions → createLockManifest. (Guarded by acd-reuses-render-plan.)
//   ADR-004: the per-repo install manifest is a lock-v2 record read from AND
//     rewritten to the FIXED path `.aof/aof.work.lock.json` (never
//     `.aof/aof.lock.json`), with a top-level `bundle: { version }`. update passes
//     this manifest to planApplyActions as `previousLock`. (Guarded by
//     acd-install-manifest-contract.)
//   ADR-005: drift detection is the engine's: a managed file whose hash diverges
//     from the manifest classifies as `drift-warning` and is preserved, never
//     overwritten without --force. (Guarded by acd-no-clobber-without-force.)
//   ADR-006: cross-runtime mapping is delegated to the CAPABILITIES matrix via the
//     shared synthesis — no `runtime === "codex"`/`"claude"` installability branch
//     lives here. (Guarded by acd-capability-delegation.)
import path from "node:path";
import { LOCK_VERSION, readLock, writeLock } from "./lock.mjs";
import { createLockManifest, executeApplyActions, planApplyActions } from "./render-plan.mjs";
import { RUNTIMES } from "./model.mjs";
import { loadBundle } from "./work-bundle.mjs";
import { bundleVersion, summarizeActions, synthesizeBundleConfig } from "./work-bundle-synthesis.mjs";

// The fixed install-manifest path (ADR-004). A literal `aof.work.lock.json` so the
// acd-install-manifest-contract fitness function can grep this source for it and
// prove update never touches the consumer's own `.aof/aof.lock.json`.
export const WORK_LOCK_PATH = path.join(".aof", "aof.work.lock.json");

export function workLockPath(targetDir) {
  return path.join(targetDir, ".aof", "aof.work.lock.json");
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

  // No-manifest guard (task 00): update re-renders against a prior install. If
  // there is no work manifest the repo was never initialised — refuse, write
  // nothing, and direct the user to init.
  const previousLock = await readLock(lockPath);
  if (!previousLock) {
    return {
      targetDir,
      dryRun,
      force,
      notInitialized: true,
      manifestPath: lockPath,
      manifestWritten: false,
      actions: [],
      notInstallable: [],
      message: `No ACD install found at ${WORK_LOCK_PATH.replaceAll("\\", "/")}. Run \`aof work init\` first to install the ACD bundle.`
    };
  }

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

  // Rewrite the install manifest (task 03, ADR-004): createLockManifest produces
  // the lock-v2 record — it already PRESERVES drift-warned entries (keeps their
  // PRIOR entry, passed as previousLock) and DROPS deleted ones. Re-attach the
  // top-level `bundle: { version }` set to the NEW bundle release. Written to the
  // fixed path, NEVER aof.lock.json.
  const baseManifest = createLockManifest({
    actions,
    desiredOutputs,
    previousLock,
    config: { packages: [] },
    runtimes
  });
  const manifest = {
    version: LOCK_VERSION,
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
  await writeLock(lockPath, manifest);

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
