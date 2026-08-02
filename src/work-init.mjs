// `aof work init` — render the shipped ACD bundle into a consumer repo
// (milestone 01 / story 01). A THIN orchestrator over the existing engine:
//
//   ADR-003: init does NOT implement its own create/update/skip/drift/delete or
//     a `--force` comparison. It synthesizes an aof `config` from the bundle (via
//     the SHARED synthesis in work-bundle-synthesis.mjs — the same one update uses)
//     and delegates to planApplyActions(previousLock = null) → executeApplyActions
//     → createLockManifest. (Guarded by acd-reuses-render-plan.)
//   ADR-004 → ADR-009: the per-repo install manifest is a lock-v2 record written
//     read-merge-write into the SINGLE unified project lock `.aof/aof.lock.json`
//     (workspacePaths().lockPath) as its `work` SECTION — the separate per-vertical
//     work-lock file is eliminated. work init owns ONLY the `work` key: it reads
//     the current lock and writes `{ ...currentLock, work: <manifest> }`,
//     preserving the flat asset fields and the `planning` section it does not own,
//     and never reconstructs the lock from a fixed field set. The manifest carries
//     a `bundle: { version }` minus its own `version` (the unified lock carries ONE
//     top-level version). (Guarded by acd-install-manifest-contract, section form.)
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
import { readLock, writeLock } from "./lock.mjs";
import { createLockManifest, executeApplyActions, planApplyActions } from "./render-plan.mjs";
import { RUNTIMES } from "./model.mjs";
import { loadBundle } from "./work-bundle.mjs";
import { bundleVersion, summarizeActions, synthesizeBundleConfig } from "./work-bundle-synthesis.mjs";
import { workspacePaths } from "./workspace.mjs";
import { ensureAofGitignore } from "./aof-gitignore.mjs";
import { setHeadroomEnabled, readConfig, writeConfig } from "./work-headroom.mjs";
// m43 / ADR-002: `.claude/settings.json` is CO-AUTHORED and is therefore NOT in the
// render plan above — `init` treats every unlocked file as fresh, which is exactly how
// a whole-file render would delete the operator's hooks/permissions/sandbox. The
// claude runtime's own hook entry reaches the file through the surgical merge, after
// the plan has run and written the files the entry's argv names.
import { applyClaudeSettingsMerge } from "./claude-settings.mjs";

// ADR-009: the install manifest lives in the `work` section of the single unified
// project lock `.aof/aof.lock.json` (resolved via workspacePaths().lockPath). There
// is no separate per-vertical work-lock file. The acd-install-manifest-contract
// fitness function greps this source to prove init names ONLY the unified lock.
export function workLockPath(targetDir) {
  return workspacePaths(targetDir).lockPath;
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
  const withHeadroom = Boolean(options.withHeadroom);

  const lockPath = workLockPath(targetDir);

  // Guard (ADR-003 / task 03 → ADR-009): init is a first-install. Key off the
  // PRESENCE of the `work` SECTION of the unified lock (the lock may already exist
  // for the asset/`planning` verticals). If the section is present and --force was
  // not given, refuse and write nothing.
  const existing = await readLock(lockPath);
  if (existing && existing.work && !force) {
    return {
      targetDir,
      runtimes,
      dryRun,
      guarded: true,
      manifestPath: lockPath,
      manifestWritten: false,
      actions: [],
      notInstallable: [],
      message: "An ACD install already exists in .aof/aof.lock.json. Run `aof work update` to deliver bundle changes, or `aof work init --force` to re-render from scratch."
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

  const claudeSettings = await applyClaudeSettingsMerge(targetDir, (await readConfig(targetDir)).config);

  // Establish the workspace `.gitignore` baseline (milestone 04 round-trip finding
  // F-02): a SELF-CONTAINED nested `.aof/.gitignore` that ignores the derived,
  // regenerable artifacts (the memory index) — never the repo-root `.gitignore`.
  // The tracked install (lock, config, rendered members) stays committed. Idempotent
  // and additive, so a re-render (--force) or a later memory reindex composes cleanly.
  await ensureAofGitignore(targetDir);

  // Install manifest (ADR-004 → ADR-009): a lock-v2 record from createLockManifest,
  // MINUS its own `version` (the unified lock carries ONE top-level version), plus
  // the `bundle: { version }`. This is the `work` SECTION of the unified lock.
  const baseManifest = createLockManifest({
    actions,
    desiredOutputs,
    previousLock: null,
    config: { packages: [] },
    runtimes
  });
  const manifest = {
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
  // Read-merge-write (ADR-009): preserve the flat asset fields and the `planning`
  // section; replace ONLY the `work` key. --force re-renders and re-pins `work`
  // while still preserving the foreign sections. Never reconstruct from a fixed set.
  const currentLock = (await readLock(lockPath)) ?? {};
  await writeLock(lockPath, { ...currentLock, work: manifest });

  // `--with-headroom` (ADR-004): the SAME config write as use-headroom, applied to the
  // fresh config. `aof work init` does not otherwise write aof.config.json (it renders
  // the bundle + writes the lock), so this is genuinely NEW config-writing wiring. We
  // create-or-merge the config, set the enabled work.headroom block (deep-merge, never
  // clobbering work.* siblings) and record the selected runtimes so the resulting
  // config observably selects them. Without the flag the config is left untouched, so
  // work.headroom stays absent (the off default, ADR-001). The lock is never read/written here.
  if (withHeadroom) {
    await writeHeadroomConfig(targetDir, runtimes);
  }

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
    // The merge's outcome rides the result rather than a console.log, so a refusal
    // (`claude-settings-unparseable`) reaches --json as well as the human render.
    claudeSettings,
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

// `--with-headroom`: create-or-merge aof.config.json with the enabled work.headroom
// block, reusing work-headroom.mjs's IDENTICAL readConfig/writeConfig (so the config
// path resolution and JSON style are the SAME as `use-headroom` — no second, divergent
// idiom). It also records the selected runtimes so the resulting config observably
// selects them (task 03's "the resulting config selects the runtimes" scenario).
// NOTE: `config.runtimes` is written ONLY on this `--with-headroom` path — a plain
// `aof work init` writes no aof.config.json at all (it renders the bundle + lock), so
// the runtimes key is a deliberate `--with-headroom`-only side effect, not a general
// init behaviour. The headroom `providers` default stays ["claude","codex"], independent
// of --runtime (the resolver intersects at runtime). Never touches the lock.
async function writeHeadroomConfig(targetDir, runtimes) {
  const { configPath, config } = await readConfig(targetDir);
  config.runtimes = runtimes;
  setHeadroomEnabled(config);
  await writeConfig(configPath, config);
}
