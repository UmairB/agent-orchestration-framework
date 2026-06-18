// `aof work init` — render the shipped ACD bundle into a consumer repo
// (milestone 01 / story 01). A THIN orchestrator over the existing engine:
//
//   ADR-003: init does NOT implement its own create/update/skip/drift/delete or
//     a `--force` comparison. It synthesizes an aof `config` from the bundle (via
//     the SHARED synthesis in work-bundle-synthesis.mjs — the same one update uses)
//     and delegates to planApplyActions(previousLock = null) → executeApplyActions
//     → createLockManifest. (Guarded by acd-reuses-render-plan.)
//   ADR-004: the per-repo install manifest is a lock-v2 record written to the
//     FIXED path `.aof/aof.work.lock.json` (never `.aof/aof.lock.json`), with a
//     top-level `bundle: { version }`. (Guarded by acd-install-manifest-contract.)
//   ADR-005: every rendered file is self-identifying — frontmatter `aof-generated:
//     true` for resources, the comment-form `<!-- aof-generated: bundle -->` for
//     templates. (The renderers already emit these; guarded by acd-generated-stamp.)
//   ADR-006: cross-runtime mapping is delegated to the CAPABILITIES matrix via the
//     shared synthesis. There is NO `runtime === "codex"`/`"claude"` branch deciding
//     installability — a member is rendered iff CAPABILITIES[kind][runtime] is
//     renderable, otherwise it is reported as not-installable. (Guarded by
//     acd-capability-delegation.)
//   ADR-007: command members carry `commandNamespace: "aof"` and the adapter's
//     general namespace rule renders them under `commands/aof/<id>.md`.
import path from "node:path";
import { LOCK_VERSION, readLock, writeLock } from "./lock.mjs";
import { createLockManifest, executeApplyActions, planApplyActions } from "./render-plan.mjs";
import { RUNTIMES } from "./model.mjs";
import { loadBundle } from "./work-bundle.mjs";
import { bundleVersion, summarizeActions, synthesizeBundleConfig } from "./work-bundle-synthesis.mjs";

// The fixed install-manifest path (ADR-004). A literal `aof.work.lock.json` so the
// acd-install-manifest-contract fitness function can grep this source for it and
// prove init never touches the consumer's own `.aof/aof.lock.json`.
export const WORK_LOCK_PATH = path.join(".aof", "aof.work.lock.json");

export function workLockPath(targetDir) {
  return path.join(targetDir, ".aof", "aof.work.lock.json");
}

// `aof work init [dir] [--dry-run] [--runtime <r>] [--force]`.
//
// Returns a structured result (for the CLI to print and for tests to assert):
//   { targetDir, runtimes, dryRun, guarded, actions, notInstallable, manifestPath,
//     manifestWritten, summary }
// On the guarded refusal (manifest exists and not --force) returns `guarded: true`
// having written NOTHING — the CLI maps that to a non-zero exit.
export async function initWork(options = {}) {
  const targetDir = path.resolve(options.targetDir ?? process.cwd());
  const runtimes = normalizeRuntimes(options.runtimes);
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);

  const lockPath = workLockPath(targetDir);

  // Guard (ADR-003 / task 03): init is a first-install. If a work manifest already
  // exists and --force was not given, refuse and write nothing.
  const existing = await readLock(lockPath);
  if (existing && !force) {
    return {
      targetDir,
      runtimes,
      dryRun,
      guarded: true,
      manifestPath: lockPath,
      manifestWritten: false,
      actions: [],
      notInstallable: [],
      message: `An ACD install already exists at ${WORK_LOCK_PATH.replaceAll("\\", "/")}. Run \`aof work update\` to deliver bundle changes, or \`aof work init --force\` to re-render from scratch.`
    };
  }

  const bundle = loadBundle();

  // The IDENTICAL synthesis update uses (shared helper, ADR-003): partition the
  // bundle by the capability matrix and build the desired-output set. init and
  // update share this ONE implementation so their desired sets cannot drift.
  const { desiredOutputs, notInstallable } = await synthesizeBundleConfig(bundle, { runtimes, targetDir });

  // First-install semantics: previousLock is ALWAYS null (ADR-003). --force does
  // not pass a prior lock; it re-renders from scratch. The classification,
  // create/update/skip/drift, is inherited from planApplyActions unchanged.
  const actions = await planApplyActions(desiredOutputs, null, { force, targetDir });

  if (dryRun) {
    return {
      targetDir,
      runtimes,
      dryRun,
      guarded: false,
      actions,
      notInstallable,
      desiredOutputs,
      manifestPath: lockPath,
      manifestWritten: false,
      summary: summarizeActions(actions)
    };
  }

  await executeApplyActions(actions);

  // Install manifest (ADR-004): a lock-v2 record from createLockManifest, plus the
  // top-level `bundle: { version }`. Written to the fixed path, NEVER aof.lock.json.
  const baseManifest = createLockManifest({
    actions,
    desiredOutputs,
    previousLock: null,
    config: { packages: [] },
    runtimes
  });
  const manifest = {
    version: LOCK_VERSION,
    generatedAt: baseManifest.generatedAt,
    bundle: { version: bundleVersion() },
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
    guarded: false,
    actions,
    notInstallable,
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
      throw new Error(`Unsupported runtime "${runtime}". Expected one of: ${Object.keys(RUNTIMES).join(", ")}.`);
    }
  }
  return deduped;
}
