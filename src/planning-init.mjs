// `aof planning init` — install the bought planner (`phuryn/pm-skills`) through
// the runtime's own plugin CLI and record pinned-sha provenance (milestone 02 /
// story 00). A THIN wrapper over the runtime plugin CLI, structured exactly like
// the GSD framework installer (`src/frameworks.mjs`): a plan of commands, a
// `--dry-run` that prints and spawns nothing, then a per-item network boundary
// print + warning before each networked, code-executing step, executed via
// argv-based spawn (no shell string), with a simulation hook for tests.
//
//   ADR-001: aof owns the seam, not the install. The plan is one
//     `<runtime> plugin marketplace add <source>` followed by one
//     `<runtime> plugin install <plugin>@pm-skills` per recommended plugin (verb
//     `install`, marketplace token `pm-skills`). Guarded by
//     acd-planning-install-commands.
//   ADR-007 (supersedes ADR-001's marketplace-source invariant; the pinned REF is
//     itself superseded by ADR-008 below): the marketplace-add source is the HTTPS
//     git URL — `<runtime> plugin marketplace add https://github.com/phuryn/pm-skills.git#<ref>`
//     — NEVER the `phuryn/pm-skills@<ref>` shorthand, which Claude resolves to an
//     SSH clone (`git@github.com:`) that fails `Permission denied (publickey)` for
//     HTTPS-only GitHub auth (VERIFICATION.md Finding F1). The per-plugin install
//     token stays the manifest name `<plugin>@pm-skills` (only the clone source
//     needs HTTPS). Same shared marketplace-add builder serves claude AND codex.
//   ADR-008 (supersedes ADR-007's `#<sha>` REF): `claude plugin marketplace add
//     <url>#<ref>` runs `git clone --branch <ref>`, which resolves only a branch or
//     TAG name — NOT a bare 40-hex commit sha (VERIFICATION.md Finding F2). So the
//     emitted `#<ref>` is the immutable release TAG (`MARKETPLACE_REF = v2.0.0`),
//     the tightest clonable pin the runtime accepts — never the bare sha. The clone
//     ref (command) and the provenance sha (manifest) are decoupled: resolveSha
//     resolves the TAG (`git ls-remote <url> refs/tags/v2.0.0`) to its 40-hex
//     commit for the manifest, so ADR-002/003 hold unchanged. The dry-run can now
//     preview the real tag with no network call (the tag is statically known).
//   ADR-002: the recorded sha MUST be a 40-char lowercase-hex commit id; a
//     floating ref (branch/tag/HEAD/short/uppercase) is refused before any write.
//     Guarded by acd-planning-provenance-sha.
//   ADR-003 → ADR-009: provenance is written via read-merge-write into the SINGLE
//     unified project lock `.aof/aof.lock.json` (workspacePaths().lockPath) as its
//     `planning` section — the separate per-vertical provenance file is eliminated.
//     planning init owns ONLY the `planning` key: it reads the current lock and
//     writes `{ ...currentLock, planning: <provenance> }`, preserving the flat
//     asset fields and the `work` section it does not own, and never reconstructs
//     the lock from a fixed field set. The provenance object is the frozen schema
//     below minus its own `version` (the unified lock carries ONE top-level
//     version). Guarded by acd-planning-lock-isolation (section-isolation).
//   ADR-004: Claude is the default + only fully-scripted runtime; Codex degrades
//     honestly — register the marketplace only, record pluginsInstalled:false, emit
//     a manual fallback, never emit the absent Codex plugin-install verb. Guarded
//     by acd-planning-no-codex-install.
//   ADR-006: idempotent via a manifest guard with --force (mirrors `work init`).
//   ADR-010: the claude marketplace/plugin declarations default to PROJECT scope
//     (`--scope project`) so the bought planner travels with the repo's
//     `.claude/settings.json`, NOT the user's global `~/.claude/settings.json`
//     (the runtime CLI itself defaults to `--scope user`, which is the wrong default
//     for a per-project planner). Overridable via
//     `aof planning init --scope <user|project|local>`. `--scope` is a
//     claude-settings concept, so the flag is emitted ONLY on claude commands; the
//     codex marketplace-add carries no scope flag (codex registration is its own
//     mechanism), while the codex MANUAL fallback (`claude plugin install …`) DOES
//     carry `--scope <scope>` since the user runs it through claude. Guarded by
//     acd-planning-install-commands.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readLock, writeLock } from "./lock.mjs";
import { workspacePaths } from "./workspace.mjs";

// ADR-009: provenance lives in the `planning` section of the single unified project
// lock `.aof/aof.lock.json` (resolved via workspacePaths().lockPath). There is no
// separate per-vertical provenance file. The acd-planning-lock-isolation fitness
// function greps this source to prove planning init names ONLY the unified lock and
// never a per-vertical lock or the runtime's own plugin-state files.

// Marketplace facts (ADR-001/003, verified in RESEARCH §6).
export const MARKETPLACE_SOURCE = "phuryn/pm-skills"; // owner/repo — recorded as `source` in provenance
export const MARKETPLACE_NAME = "pm-skills"; // manifest name used in plugin@marketplace
export const MARKETPLACE_VERSION = "2.0.0"; // semver recorded in the manifest `marketplaceVersion` (ADR-003) — NOT the clone ref
// ADR-008: the immutable release TAG the marketplace-add `#<ref>` pins — the
// tightest clonable ref `git clone --branch` accepts (a bare sha is not clonable,
// F2). The real upstream tag is `v2.0.0` (WITH the leading `v`), so derive it as
// `v${MARKETPLACE_VERSION}` for a single source of truth — NEVER the bare `2.0.0`.
export const MARKETPLACE_REF = `v${MARKETPLACE_VERSION}`; // "v2.0.0"
export const MARKETPLACE_HEAD_URL = "https://github.com/phuryn/pm-skills"; // ls-remote target (no .git needed)
// ADR-007: the clone URL whose `#<sha>` fragment pins the marketplace-add ref over
// HTTPS — never the `owner/repo` shorthand, which Claude clones over SSH (F1).
// Derived from MARKETPLACE_HEAD_URL so the repo path has a single source of truth:
// the ls-remote resolver and the clone source can never silently diverge.
export const MARKETPLACE_GIT_URL = `${MARKETPLACE_HEAD_URL}.git`;

// Recommended plugin set (ADR-001). pm-ai-shipping is NEVER installed.
export const CORE_PLUGINS = ["pm-execution", "pm-product-discovery", "pm-product-strategy"];
export const OPTIONAL_PLUGINS = ["pm-market-research"];

const VALID_RUNTIMES = ["claude", "codex"];
const SHA_RE = /^[0-9a-f]{40}$/;
// ADR-010: where the claude marketplace/plugin declarations are written. Defaults to
// `project` (the repo's .claude/settings.json) so the planner travels with the repo,
// never silently landing in the user's global settings (the runtime CLI's own default).
export const VALID_SCOPES = ["user", "project", "local"];
export const DEFAULT_SCOPE = "project";

// The unified project lock path (ADR-009). planning init reads/merge-writes ONLY
// the `planning` section of this one file — it is the SAME lock work init/update
// and assets apply write (their own sections), never a per-vertical sibling.
export function planningLockPath(targetDir) {
  return workspacePaths(targetDir).lockPath;
}

export function recommendedPlugins({ withOptional = false } = {}) {
  return withOptional ? [...CORE_PLUGINS, ...OPTIONAL_PLUGINS] : [...CORE_PLUGINS];
}

// Build the ordered command plan (ADR-001/004). Each item carries the structured
// fields + an argv and a joined `command` string (spawn discipline is argv-based,
// no shell string). For claude: marketplace add then one install per plugin (verb
// `install`). For codex: ONLY the marketplace add — zero per-plugin install items,
// because that verb does not exist on Codex (ADR-004). The absent Codex per-plugin
// verb is never constructed here (enforced by acd-planning-no-codex-install).
export function planPlanningInstall({ runtime = "claude", sha, withOptional = false, scope = DEFAULT_SCOPE } = {}) {
  if (!VALID_RUNTIMES.includes(runtime)) {
    throw new Error(`Unsupported runtime "${runtime}". Expected one of: ${VALID_RUNTIMES.join(", ")}.`);
  }
  if (!VALID_SCOPES.includes(scope)) {
    throw new Error(`Unsupported scope "${scope}". Expected one of: ${VALID_SCOPES.join(", ")}.`);
  }
  const plan = [];

  // ADR-010: emit `--scope <scope>` (default `project`) so the declarations land in
  // the repo's .claude/settings.json, not the user's global settings. The flag is a
  // claude-settings concept, so it rides ONLY claude commands; codex marketplace-add
  // stays unscoped (its registration is a different mechanism). Placed right after
  // the verb (before the positional) so the `<url>`/`<plugin>@pm-skills` token stays
  // last — keeping the marketplace source as the argv tail for the clone-smoke guard.
  const scopeArgs = runtime === "claude" ? ["--scope", scope] : [];

  // ADR-007: source is the HTTPS git URL (forces an HTTPS clone), NOT the
  // `owner/repo@<ref>` shorthand (SSH clone, F1).
  // ADR-008: the `#<ref>` pin is the immutable release TAG (MARKETPLACE_REF =
  // v2.0.0), NOT the provenance sha. `claude plugin marketplace add <url>#<ref>`
  // runs `git clone --branch <ref>`, which cannot resolve a bare commit sha (F2) —
  // only a clonable branch/tag name. The `sha` param is the recorded provenance
  // value only (ADR-002/003); it no longer feeds the command.
  const marketplaceArgv = [runtime, "plugin", "marketplace", "add", ...scopeArgs, `${MARKETPLACE_GIT_URL}#${MARKETPLACE_REF}`];
  plan.push({
    runtime,
    kind: "marketplace",
    plugin: null,
    argv: marketplaceArgv,
    command: marketplaceArgv.join(" ")
  });

  // Codex has no scriptable per-plugin install verb (ADR-004): the plan stops at
  // the marketplace registration. Only Claude scripts the installs.
  if (runtime === "claude") {
    for (const plugin of recommendedPlugins({ withOptional })) {
      const argv = [runtime, "plugin", "install", ...scopeArgs, `${plugin}@${MARKETPLACE_NAME}`];
      plan.push({
        runtime,
        kind: "install",
        plugin,
        argv,
        command: argv.join(" ")
      });
    }
  }

  return plan;
}

// The documented manual fallback for Codex (ADR-004): the exact `claude plugin
// install <plugin>@pm-skills` lines the user must run to enable the plugins,
// since Codex cannot script them. Returned so the CLI/tests can assert + print it.
export function codexManualFallback({ withOptional = false, scope = DEFAULT_SCOPE } = {}) {
  return recommendedPlugins({ withOptional }).map(
    (plugin) => `claude plugin install --scope ${scope} ${plugin}@${MARKETPLACE_NAME}`
  );
}

export const CODEX_SLASH_COMMAND_NOTE =
  "Note: on Codex, pm-skills' /write-prd runs as plain language, not as a Codex slash command.";

// Injection-only sha resolution — the offline seam. An explicit `options.sha`, an
// `options.ref`, an `options.resolveSha` callback, or the AOF_PLANNING_SHA env var
// short-circuit any network. Returns null when none is supplied, so the caller
// decides whether the live path may run (it must NOT on a dry-run — ADR-001).
export function resolveInjectedSha(options = {}) {
  if (typeof options.sha === "string" && options.sha.length > 0) return options.sha;
  if (typeof options.ref === "string" && options.ref.length > 0) return options.ref;
  if (typeof options.resolveSha === "function") return options.resolveSha();
  if (typeof process.env.AOF_PLANNING_SHA === "string" && process.env.AOF_PLANNING_SHA.length > 0) {
    return process.env.AOF_PLANNING_SHA;
  }
  return null;
}

// The dry-run preview token shown when no sha is injected. The live commit is
// NEVER resolved on a dry-run (ADR-001: a dry-run performs no network call or
// process spawn) — the real run prints the resolved 40-hex sha in its place.
export const SHA_PLACEHOLDER = "<sha>";

// Resolve the marketplace commit sha (ADR-002/008). Injection (see
// resolveInjectedSha) keeps tests offline; otherwise the live path shells
// `git ls-remote https://github.com/phuryn/pm-skills.git refs/tags/v2.0.0` by argv
// (read-only network call). ADR-008: resolve the TAG the command pins — NOT HEAD —
// so the recorded provenance sha is the exact commit the clonable `#v2.0.0` tag
// points at. Parse robustly: an annotated tag emits a peeled `refs/tags/v2.0.0^{}`
// line whose sha is the underlying COMMIT (use it when present); a lightweight tag
// emits only the `refs/tags/v2.0.0` line, whose sha IS the commit. Only an actual
// run reaches the live path — a dry-run never calls this (ADR-001). The returned
// value is NOT validated here — the caller validates before any write.
export function resolveSha(options = {}) {
  const injected = resolveInjectedSha(options);
  if (injected !== null) return injected;

  const tagRef = `refs/tags/${MARKETPLACE_REF}`;
  const result = spawnSync("git", ["ls-remote", MARKETPLACE_GIT_URL, tagRef], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    throw new Error(
      `Could not resolve the marketplace tag ${MARKETPLACE_REF} for ${MARKETPLACE_SOURCE} via git ls-remote.`
    );
  }
  return parseTagSha(result.stdout, MARKETPLACE_REF);
}

// Parse a `git ls-remote <url> refs/tags/<tag>` payload into the commit sha the tag
// resolves to. Lines are `<sha>\t<ref>`. Prefer the peeled `refs/tags/<tag>^{}`
// line (an annotated tag dereferenced to its commit); fall back to the plain
// `refs/tags/<tag>` line (a lightweight tag → the commit directly). Returns "" when
// neither is present, so the caller's 40-hex gate refuses rather than mis-pins.
export function parseTagSha(stdout, ref) {
  const lines = stdout.trim().split(/\r?\n/).filter((line) => line.length > 0);
  const peeledRef = `refs/tags/${ref}^{}`;
  const exactRef = `refs/tags/${ref}`;
  let peeled = "";
  let plain = "";
  for (const line of lines) {
    const [sha, name] = line.split(/\s+/);
    if (name === peeledRef) peeled = sha ?? "";
    else if (name === exactRef) plain = sha ?? "";
  }
  return peeled || plain || "";
}

export function isFullSha(value) {
  return typeof value === "string" && SHA_RE.test(value);
}

// Execute the plan (ADR-001). Before each executing command, print a
// `network-boundary:` line AND a warning that the step accesses the network and
// executes plugin/marketplace code (NOT the npm wording), then spawn by argv. A
// simulation seam (options.simulateInstall / AOF_PLANNING_SIMULATE / a spawn
// injection) lets unit tests run no real process. Returns recorded attempts.
export function executePlanningPlan(plan, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const simulate = isSimulated(options);
  const spawn = options.spawn ?? spawnSync;
  const attempts = [];

  for (const item of plan) {
    log(`network-boundary: ${item.command}`);
    log("warning: this command accesses the network and executes plugin/marketplace code.");

    if (simulate) {
      attempts.push({ command: item.command, runtime: item.runtime, kind: item.kind, plugin: item.plugin, status: "simulated", exitStatus: 0 });
      continue;
    }

    const result = spawn(item.argv[0], item.argv.slice(1), {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env }
    });
    const status = (result?.status ?? 1) === 0 ? "success" : "failed";
    attempts.push({ command: item.command, runtime: item.runtime, kind: item.kind, plugin: item.plugin, status, exitStatus: result?.status ?? 1 });
  }

  return attempts;
}

function isSimulated(options) {
  if (options.simulateInstall !== undefined) return Boolean(options.simulateInstall);
  return process.env.AOF_PLANNING_SIMULATE === "1";
}

// Build the `planning` section (ADR-009): the frozen provenance schema MINUS its
// own `version` — the unified lock carries one top-level version. This object is
// what gets nested under `lock.planning` and what `result.manifest` returns.
function buildManifest({ runtime, sha, withOptional, generatedAt }) {
  const base = {
    generatedAt,
    source: MARKETPLACE_SOURCE,
    marketplaceName: MARKETPLACE_NAME,
    marketplaceVersion: MARKETPLACE_VERSION,
    sha,
    runtime
  };

  if (runtime === "codex") {
    // Honest degrade (ADR-004): the marketplace was registered but no plugin was
    // installed, so the plugin set is recorded empty and codex carries the truth.
    return {
      ...base,
      plugins: [],
      codex: { marketplaceRegistered: true, pluginsInstalled: false }
    };
  }

  return {
    ...base,
    plugins: recommendedPlugins({ withOptional }).map((name) => ({ name, marketplace: MARKETPLACE_NAME })),
    codex: null
  };
}

// `aof planning init [dir] [--dry-run] [--force] [--with-optional] [--runtime <r>]`.
//
// Returns a structured result (for the CLI to print and for tests to assert):
//   { runtime, targetDir, dryRun, force, withOptional, guarded, shaRejected, sha,
//     plan, planCommands, attempts, codex, manualFallback, manifest, manifestPath,
//     manifestWritten, message }
// On the guarded refusal (manifest exists and not --force) returns guarded:true
// having written/spawned/networked NOTHING. On a floating-ref input returns
// shaRejected:true having written NOTHING. The CLI maps both to a non-zero exit.
export async function initPlanning(options = {}) {
  const targetDir = path.resolve(options.targetDir ?? process.cwd());
  const runtime = options.runtime ?? "claude";
  if (!VALID_RUNTIMES.includes(runtime)) {
    throw new Error(`Unsupported runtime "${runtime}". Expected one of: ${VALID_RUNTIMES.join(", ")}.`);
  }
  // ADR-010: default to project scope (the repo's .claude/settings.json), overridable.
  const scope = options.scope ?? DEFAULT_SCOPE;
  if (!VALID_SCOPES.includes(scope)) {
    throw new Error(`Unsupported scope "${scope}". Expected one of: ${VALID_SCOPES.join(", ")}.`);
  }
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const withOptional = Boolean(options.withOptional);
  const log = options.log ?? ((line) => console.log(line));
  const lockPath = planningLockPath(targetDir);

  // Re-run guard (ADR-006 → ADR-009): key off the PRESENCE of the `planning`
  // SECTION of the unified lock, not on file existence (the unified lock may
  // already exist for the asset/`work` verticals). If the section is present and
  // --force was not given, refuse and write nothing. --dry-run always previews
  // regardless (so the guard is skipped on a dry-run and the lock is untouched).
  if (!dryRun) {
    const existing = await readLock(lockPath);
    if (existing && existing.planning && !force) {
      return {
        runtime,
        targetDir,
        dryRun,
        force,
        withOptional,
        guarded: true,
        shaRejected: false,
        manifestPath: lockPath,
        manifestWritten: false,
        plan: [],
        planCommands: [],
        attempts: [],
        message: "A planning provenance section already exists in .aof/aof.lock.json. Re-run with `--force` to re-pin the sha and re-install."
      };
    }
  }

  // Resolve the sha (ADR-002). A dry-run must NOT touch the network or spawn a
  // process (ADR-001): it uses an injected sha if one was supplied, else a
  // placeholder token in the preview — it never calls the live `git ls-remote`
  // path. Only an actual run resolves the live commit (behind the boundary below).
  const resolved = dryRun ? (resolveInjectedSha(options) ?? SHA_PLACEHOLDER) : resolveSha(options);

  // The plan is the same regardless of dry-run. ADR-008: the marketplace command
  // pins the statically-known release TAG (`#v2.0.0`), not the sha, so the dry-run
  // preview shows the real, clonable tag with no network — `resolved` is the
  // provenance value only (a placeholder on a dry-run with no injected sha).
  const plan = planPlanningInstall({ runtime, sha: resolved, withOptional, scope });
  const planCommands = plan.map((item) => item.command);

  if (dryRun) {
    // Pure preview (ADR-001): no sha validation gate, no network, no spawn, no
    // write. Print the commands the run would execute.
    log("dry-run: the following runtime commands would be run (nothing run, nothing written):");
    for (const command of planCommands) log(`  ${command}`);
    if (resolved === SHA_PLACEHOLDER) {
      log(`note: the marketplace clones the immutable tag \`${MARKETPLACE_REF}\`; a dry-run resolves no commit, but the real run records the exact pm-skills commit that tag points at (via \`git ls-remote refs/tags/${MARKETPLACE_REF}\`) in the provenance manifest.`);
    }

    const manualFallback = runtime === "codex" ? codexManualFallback({ withOptional, scope }) : [];
    if (runtime === "codex") {
      log("codex degrade: the marketplace would be registered, but plugins are NOT installed (no scriptable Codex install verb).");
      log("manual fallback — run these to enable the plugins:");
      for (const line of manualFallback) log(`  ${line}`);
      log(CODEX_SLASH_COMMAND_NOTE);
    }

    return {
      runtime,
      targetDir,
      dryRun,
      force,
      withOptional,
      guarded: false,
      shaRejected: false,
      sha: resolved,
      plan,
      planCommands,
      attempts: [],
      codex: runtime === "codex" ? { marketplaceRegistered: false, pluginsInstalled: false } : null,
      manualFallback,
      manifest: null,
      manifestPath: lockPath,
      manifestWritten: false
    };
  }

  // Integrity gate (ADR-002): the recorded sha MUST be a 40-hex lowercase commit.
  // A floating ref (main/HEAD/tag/short/uppercase/over-length) is refused BEFORE
  // any network/spawn/write — nothing is recorded.
  if (!isFullSha(resolved)) {
    return {
      runtime,
      targetDir,
      dryRun,
      force,
      withOptional,
      guarded: false,
      shaRejected: true,
      sha: resolved,
      plan: [],
      planCommands: [],
      attempts: [],
      manifestPath: lockPath,
      manifestWritten: false,
      message: `Refusing to pin: the resolved ref "${resolved}" is not a 40-character commit sha. Resolve an exact commit (40-char lowercase hex) before installing; no manifest was written.`
    };
  }

  // Execute behind the network/code-execution boundary (ADR-001), then record
  // provenance (ADR-003). The simulation seam keeps unit tests offline.
  const attempts = executePlanningPlan(plan, { ...options, log });

  const manualFallback = runtime === "codex" ? codexManualFallback({ withOptional }) : [];

  // Honesty gate (the milestone-wide principle behind ADR-004): never record a
  // pin/install that did not happen. If any executed step failed, refuse to write
  // a success manifest and surface the failure — the manifest must not claim
  // plugins (or a registration) that the runtime did not actually complete.
  const failed = attempts.filter((attempt) => attempt.status === "failed");
  if (failed.length > 0) {
    log(`error: ${failed.length} runtime step(s) failed; no provenance manifest was written.`);
    return {
      runtime,
      targetDir,
      dryRun,
      force,
      withOptional,
      guarded: false,
      shaRejected: false,
      installFailed: true,
      sha: resolved,
      plan,
      planCommands,
      attempts,
      codex: runtime === "codex" ? { marketplaceRegistered: false, pluginsInstalled: false } : null,
      manualFallback,
      manifest: null,
      manifestPath: lockPath,
      manifestWritten: false,
      message: `Refusing to record provenance — the following step(s) failed: ${failed.map((attempt) => attempt.command).join("; ")}. No manifest was written.`
    };
  }

  if (runtime === "codex") {
    // Honest degrade reporting (ADR-004): never claim the plugins were installed;
    // emit the exact manual fallback commands the user must run instead.
    log("codex degrade: marketplace registered; plugins were NOT installed (no scriptable Codex install verb).");
    log("manual fallback — run these to enable the plugins:");
    for (const line of manualFallback) log(`  ${line}`);
    log(CODEX_SLASH_COMMAND_NOTE);
  }

  const manifest = buildManifest({ runtime, sha: resolved, withOptional, generatedAt: new Date().toISOString() });
  // Read-merge-write (ADR-009): preserve the flat asset fields and the `work`
  // section; replace ONLY the `planning` key. Never reconstruct from a fixed set.
  const currentLock = (await readLock(lockPath)) ?? {};
  await writeLock(lockPath, { ...currentLock, planning: manifest });

  return {
    runtime,
    targetDir,
    dryRun,
    force,
    withOptional,
    guarded: false,
    shaRejected: false,
    sha: resolved,
    plan,
    planCommands,
    attempts,
    codex: manifest.codex,
    manualFallback,
    manifest,
    manifestPath: lockPath,
    manifestWritten: true
  };
}
