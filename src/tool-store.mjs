// src/tool-store.mjs — the SPINE of milestone 12 (managed-tool provisioning).
// The single home for store geometry + the store-first resolver + the provider
// registry + the frozen tool descriptors. graphify (ADR-004) and headroom
// (ADR-004) front this; the lifecycle command (ADR-003) and the retrofit
// provisioning call the SAME registry — no provisioning code shells `npx`/`uv`
// outside its lane.
//
// This module owns, in ONE place, the three load-bearing facts RESEARCH pinned:
//   (1) the cross-platform exe path — a uv-lane tool lands at
//       <store>/<name>/<version>/Scripts/<binary>.exe on Windows and
//       <store>/<name>/<version>/bin/<binary> on POSIX (uv's standard venv layout);
//   (2) the package→binary map — one install spec ships MORE than one binary
//       (graphifyy → graphify + graphify-mcp; the spec name ≠ the binary name), so
//       resolution needs a MAP, not a name guess (RESEARCH §"Cross-platform");
//   (3) version verification degrades — a `<bin> --version` probe degrades to
//       version:null rather than throwing (RESEARCH §A4), the no-throw contract
//       the 09 resolver established (09/ADR-002) and this resolver keeps.
//
// The store root derives from defaultGlobalWorkspaceDir(env) via the paths.mjs
// helpers — there is NO os.homedir() call and NO ".aof" string literal in this
// module's live code (ADR-005 inv. 2, the relocation guard). AOF_GLOBAL_HOME
// relocates the whole store because the root flows through that one seam.
//
// The store-first / PATH-fallback ORDER (ADR-001's crux) is what makes the 06/09
// retrofit non-breaking: a project with a managed install gets the pinned store
// copy; a project that never provisioned still resolves the operator's global
// binary exactly as the 06/09 resolvers do today.
import path, { delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { statSync, rmSync } from "node:fs";
import { toolStoreRoot, toolVersionDir } from "./paths.mjs";
import { planFrameworkInstall } from "./frameworks.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

// The package→binary map (ADR-001). One install spec can ship several binaries;
// the spec name (graphifyy/headroom-ai) ≠ the binary name (graphify/headroom). A
// resolver/doctor consults THIS, never a name guess (RESEARCH §"Cross-platform").
export const PACKAGE_BINARIES = {
  graphifyy: ["graphify", "graphify-mcp"],
  "headroom-ai": ["headroom"],
};

// ----------------------------------------------------------- store geometry ---

// The exe directory under a version dir is platform-shaped: `Scripts` on Windows,
// `bin` on POSIX (darwin shares the POSIX shape) — uv follows the standard venv
// layout (RESEARCH §"Cross-platform"/"Store layout").
export function exeDirFor(versionDir, platform = process.platform) {
  return path.join(versionDir, platform === "win32" ? "Scripts" : "bin");
}

// The exe filename is platform-shaped: `<binary>.exe` on Windows, bare `<binary>`
// on POSIX. (The PATH-walk fallback below uses the wider win32 .exe/.cmd/.bat set;
// a STORE exe is always the uv-produced `.exe`.)
export function exeNameFor(binary, platform = process.platform) {
  return platform === "win32" ? `${binary}.exe` : binary;
}

// ------------------------------------------------------------- resolution -----

// The cross-platform exe-name set for the PATH walk, mirroring the 09 resolver
// (src/graphify.mjs): `.exe`/`.cmd`/`.bat`/bare on win32, bare on POSIX. A store
// exe is the precise uv `.exe`/bare name; PATH may carry a shim, so the wider set
// is consulted only on the PATH-fallback leg.
function pathExeNamesFor(binary, platform) {
  return platform === "win32"
    ? [`${binary}.exe`, `${binary}.cmd`, `${binary}.bat`, binary]
    : [binary];
}

// A minimal existence check (a file on disk) that NEVER throws to the caller —
// statSync on a missing path throws ENOENT, which we swallow into `false`. Used
// for both the store-first probe and the PATH walk (mirrors graphify.mjs).
function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

// The wall-clock budget (ms) shared by EVERY tool-resolution spawn — the `where`/
// `which` locator and the `<bin> --version` probe. Both run on every
// resolveManagedBinary call (the locator even when the tool is ABSENT — running it is
// HOW absence is determined), so an UNBOUNDED spawn here hangs the caller
// INTERMITTENTLY under machine contention: a stuck `where.exe`/`which` (or a `--version`
// that blocks) never returns, and a resident hung one wedges the next attempt. This is
// the `aof work memory ingest`/`reindex` intermittent hang on a machine where graphify
// is ABSENT (the graph build never runs — only resolution does). These probes are cheap
// (sub-second normally), so the budget is SHORT; a non-positive/garbage override falls
// back to the default (never "no timeout"). Tunable via AOF_TOOL_PROBE_TIMEOUT_MS.
export const TOOL_PROBE_TIMEOUT_ENV = "AOF_TOOL_PROBE_TIMEOUT_MS";
export const DEFAULT_TOOL_PROBE_TIMEOUT_MS = 10_000;

export function toolProbeTimeoutMs(env = process.env) {
  const raw = Number.parseInt(env?.[TOOL_PROBE_TIMEOUT_ENV] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TOOL_PROBE_TIMEOUT_MS;
}

// The spawnSync options every tool-resolution spawn shares (locator + version probe).
// Bounds the wall-clock and force-kills on overrun so a stalled child DEGRADES rather
// than hangs — the locator falls through to the manual PATH scan, the probe to
// version:null. stdin is IGNORED so neither child can block reading a prompt. `env` is
// injectable so a unit test asserts the guards without a live binary.
export function toolSpawnOptions(env = process.env) {
  return {
    encoding: "utf8",
    timeout: toolProbeTimeoutMs(env),
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
  };
}

// The default version probe: spawn `<bin> --version` and degrade to null on ANY
// failure — a missing flag, a non-zero exit, an ENOENT, a TIMEOUT (RESEARCH §A4).
// NEVER throws. Modelled on graphify.mjs's probeVersion. Injectable via the resolver's
// `probe` seam so a test can drive the clean / failing / empty rows hermetically.
// `spawn` is an injectable seam (default: the real spawnSync) so the degrade
// BRANCH LOGIC itself — non-zero exit → null, empty/odd stdout → null, a clean
// dotted version → that version — is unit-testable without a live binary. The live
// spawn is BOUNDED (toolSpawnOptions): a hung `--version` is killed and degrades to null.
export function defaultProbe(exeFile, spawn = spawnSync) {
  try {
    const result = spawn(exeFile, ["--version"], toolSpawnOptions());
    if (!result || result.status !== 0 || typeof result.stdout !== "string") return null;
    // The --version output form varies per tool; extract a dotted version if
    // present, else the trimmed stdout, else null (never throw).
    const match = result.stdout.match(/\d+\.\d+\.\d+/);
    if (match) return match[0];
    const trimmed = result.stdout.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

// Locate `<binary>` on PATH, cross-platform — the 06/09 PATH-fallback behaviour,
// generalized over the binary name (graphify.mjs hardcodes GRAPHIFY_BINARY). The
// injected `pathValue`/`useLocator` seams keep the PATH leg hermetic under test:
// a test passes an empty pathValue + useLocator:false so the injected PATH is the
// ONLY source consulted, never the process-global PATH.
function findBinaryOnPath(binary, { pathValue = process.env.PATH ?? "", useLocator = true, platform = process.platform } = {}) {
  const exeNames = pathExeNamesFor(binary, platform);

  // Prefer the platform locator (`where`/`which`); fall back to scanning PATH dirs
  // ourselves. A test skips the locator (useLocator:false) so an empty injected
  // PATH is the only source — making the absent assertion hermetic.
  if (useLocator) {
    const locator = platform === "win32" ? "where" : "which";
    try {
      // BOUNDED (toolSpawnOptions): a stalled `where`/`which` is force-killed and
      // falls through to the manual PATH scan below — never an unbounded hang.
      const probe = spawnSync(locator, [binary], toolSpawnOptions());
      if (probe.status === 0 && typeof probe.stdout === "string") {
        const first = probe.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        if (first) return first;
      }
    } catch (error) {
      // locator absent — fall through to the manual PATH scan.
      reportDegrade("tool-store", error); }
  }

  const pathDirs = (pathValue ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const exe of exeNames) {
      const candidate = path.join(dir, exe);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

// The install hint surfaced on a TOTAL miss — names the lifecycle command (ADR-003)
// so the caller can guide the operator. Per-tool (the <name> is woven in).
function installHintFor(name) {
  return `Run \`aof project provision ${name}\` to install it into the managed tool store.`;
}

// resolveManagedBinary — the STORE-FIRST resolver (ADR-001). The single place the
// store geometry + the cross-platform exe path + the no-throw degrade live.
//
//   resolveManagedBinary({ name, version, binary, env?, platform?, pathValue?, useLocator?, probe? })
//     → { found:true,  source:"store", binary, path, version }   // store hit
//     | { found:true,  source:"path",  binary, path, version }   // store miss → PATH walk (06/09)
//     | { found:false, hint }                                    // total miss: structured, never throws
//
// STORE-FIRST: it checks <store>/<name>/<version>/{Scripts|bin}/<binary>[.exe]
// BEFORE any PATH lookup, so a managed pinned install WINS over a stray global.
// PATH-FALLBACK: only on a store miss does it do the PATH walk (the 06/09
// behaviour, preserved). TOTAL MISS: a structured {found:false,hint}, never an
// opaque ENOENT. The version is probed and degrades to null, never throwing.
export function resolveManagedBinary({
  name,
  version,
  binary,
  env = process.env,
  platform = process.platform,
  pathValue,
  useLocator = true,
  probe,
} = {}) {
  const probeVersion = probe ?? defaultProbe;

  // STORE-FIRST — the pinned managed copy at the deterministic version-keyed path.
  const versionDir = toolVersionDir(name, version, env);
  const storeExe = path.join(exeDirFor(versionDir, platform), exeNameFor(binary, platform));
  if (isFile(storeExe)) {
    return {
      found: true,
      source: "store",
      binary,
      path: storeExe,
      version: probeVersion(storeExe),
    };
  }

  // PATH-FALLBACK — the 06/09 PATH walk, unchanged in spirit (generalized over the
  // binary name + the injected platform/path seams).
  const pathBinary = findBinaryOnPath(binary, { pathValue, useLocator, platform });
  if (pathBinary) {
    return {
      found: true,
      source: "path",
      binary,
      path: pathBinary,
      version: probeVersion(pathBinary),
    };
  }

  // TOTAL MISS — structured, never a throw; carries the provision guidance.
  return { found: false, hint: installHintFor(name) };
}

// ------------------------------------------------------- provider registry ----
// The provisioner is a PROVIDER REGISTRY { npx, uv } (ADR-002), a plain object
// keyed by provider id — extensible by adding a key, not a class hierarchy (the
// house FRAMEWORKS/ROUTABLE idiom). planProvision(descriptor, options) dispatches
// on descriptor.provider; the npx lane DELEGATES to the untouched frameworks.mjs
// (lock/attempt preserved), the uv lane plans `uv venv` + `uv pip install --python`
// into the version dir. Each lane owns its OWN exec env — the npx env is npm-
// specific (SAFE_NPM_EXEC_ENV) and does NOT transfer to uv. Neither lane shells
// the other (ADR-005 inv. 3, the provider-neutrality guard).

// The uv-lane install spec: `<packageSpec>[<extras>]==<version>`. Extras are the
// comma-joined PyPI form (headroom-ai[all], headroom-ai[mcp,proxy]); absent/empty
// extras yield the bare spec (graphifyy==0.8.44). (RESEARCH §"Headroom".)
function uvInstallSpec({ packageSpec, version, extras }) {
  const extraSuffix = Array.isArray(extras) && extras.length ? `[${extras.join(",")}]` : "";
  return `${packageSpec}${extraSuffix}==${version}`;
}

// The uv lane (ADR-002): provision INTO the version-keyed store via
//   uv venv <verDir>
//   uv pip install --python <verDir> "<spec>[extras]==<version>"
// This is the ONLY route to the deterministic, version-keyed path (NOT
// `uv tool install`, which is package-keyed — RESEARCH §"Store layout"). It owns
// its OWN exec env (NOT SAFE_NPM_EXEC_ENV) and NEVER shells npx. Under dryRun it
// returns the plan WITHOUT spawning (mirrors planFrameworkInstall's dryRun).
function planUvProvision(descriptor, options = {}) {
  const { name, packageSpec, version, extras } = descriptor;
  const versionDir = toolVersionDir(name, version, options.env);
  const spec = uvInstallSpec({ packageSpec, version, extras });
  const commands = [
    ["uv", "venv", versionDir],
    ["uv", "pip", "install", "--python", versionDir, spec],
  ];
  // dryRun → return the plan only (no spawn). The live execution path is @manual
  // (a real uv venv is heavy / live-only — RESEARCH §A2/A4); story 01's command
  // executes the commands when not dryRun.
  return { provider: "uv", commands, versionDir, spec };
}

// The npx lane (ADR-002): a RE-HOME of the existing frameworks.mjs behaviour
// behind the registry — NOT a rewrite. It DELEGATES to planFrameworkInstall, so
// the lock/attempt/skip/--force/SAFE_NPM_EXEC_ENV semantics are preserved
// byte-for-byte (ADR-005 inv. 4, the regression guard). The plan items carry an
// argv starting with "npx"; this lane NEVER shells uv.
function planNpxProvision(descriptor, options = {}) {
  const items = planFrameworkInstall(descriptor.name, {
    packageName: descriptor.packageSpec,
    force: options.force,
    previousLock: options.previousLock,
    dryRun: options.dryRun,
  });
  return { provider: "npx", items };
}

// The provider registry — { npx, uv }, keyed by provider id (ADR-002). Extensible
// by adding a key. Dispatch is a lookup, not a class hierarchy.
export const PROVIDERS = {
  uv: planUvProvision,
  npx: planNpxProvision,
};

// planProvision(descriptor, options) — dispatch on descriptor.provider to the
// lane's planner (ADR-002). An unknown/absent provider is REJECTED (the bad
// provider is named on error.provider, error.code = "unknown-provider"), never
// guessed. Under options.dryRun the lane returns the command list WITHOUT spawning.
export function planProvision(descriptor, options = {}) {
  const provider = descriptor?.provider;
  const lane = provider == null ? undefined : PROVIDERS[provider];
  if (!lane) {
    const error = new Error(
      `Unknown provider ${provider == null ? "(absent)" : `"${provider}"`} — known providers: ${Object.keys(PROVIDERS).join(", ")}.`
    );
    error.code = "unknown-provider";
    error.provider = provider ?? null;
    throw error;
  }
  return lane(descriptor, options);
}

// A managed tool's name + version each become ONE path segment under the store
// root. A value carrying a path separator, a `..` traversal, or an absolute path
// could escape the store — so reject it BEFORE it ever reaches toolVersionDir /
// rmSync (ADR-005 inv. 5). The frozen descriptors always pass; this is the boundary
// guard for an untrusted --version (a typo or an attacker) — without it,
// `provision <tool> --version ../../x --uninstall` would rmSync OUTSIDE the store.
export function assertSafeToolSegment(value, label = "value") {
  if (typeof value !== "string" || value.length === 0) {
    const error = new Error(`The ${label} must be a non-empty string.`);
    error.code = "invalid-segment";
    throw error;
  }
  if (value === "." || value.includes("..") || /[\\/]/.test(value) || path.isAbsolute(value)) {
    const error = new Error(`The ${label} "${value}" is not a safe path segment (no separators, "..", or absolute paths).`);
    error.code = "invalid-segment";
    throw error;
  }
}

// uninstall(descriptor, { removeDir }) — remove ONLY toolVersionDir(name, version)
// (ADR-002/ADR-003; ADR-005 inv. 5, the store-scoped removal guard). It NEVER
// targets a global/PATH/system path, never `uv tool uninstall`, never the store
// root. Two guards enforce that at RUNTIME (not just by construction): (1) name +
// version are validated as safe single segments; (2) the resolved target is asserted
// STRICTLY CONTAINED within the store root before the remove — a path that escapes
// (traversal, absolute, the root itself) is refused. `removeDir` is injectable for
// tests (default: a real recursive rmSync). Returns the removed path.
export function uninstall(descriptor, { removeDir, env } = {}) {
  const { name, version } = descriptor;
  assertSafeToolSegment(name, "tool name");
  assertSafeToolSegment(version, "version");
  const root = toolStoreRoot(env);
  const versionDir = toolVersionDir(name, version, env);
  // Defense in depth: even past the segment guard, refuse a target that is not
  // strictly under the store root (never the root itself, never an escape).
  const rel = path.relative(root, versionDir);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    const error = new Error(`Refusing to remove ${versionDir}: it is not contained within the tool store root ${root}.`);
    error.code = "unsafe-removal";
    throw error;
  }
  const remove = removeDir ?? ((dir) => rmSync(dir, { recursive: true, force: true }));
  remove(versionDir);
  return versionDir;
}

// --------------------------------------------------------- tool descriptors ---
// The frozen spine — both managed tools declare HOW they provision (ADR-002).
// Plain serialisable data (08/ADR-002 spirit). story 01's command + story 04's
// arch-tests enumerate these via toolDescriptors()/TOOL_DESCRIPTORS.

// graphify — the uv-lane PyPI tool `graphifyy` shipping TWO binaries
// (graphify + graphify-mcp), pinned at 0.8.44 (RESEARCH §"Cross-platform").
export const GRAPHIFY_DESCRIPTOR = {
  name: "graphify",
  provider: "uv",
  packageSpec: "graphifyy",
  version: "0.8.44",
  binaries: ["graphify", "graphify-mcp"],
};

// headroom — the uv-lane PyPI tool `headroom-ai` (binary `headroom`), pinned at
// 0.26.0 with the [all] extra. The platform matrix records win32 = unsupported
// from a prebuilt wheel (no Windows wheel; the sdist needs Rust) — the tool-platform
// doctor check (story 01) surfaces the warning (RESEARCH §"Headroom"/§A3).
export const HEADROOM_DESCRIPTOR = {
  name: "headroom",
  provider: "uv",
  packageSpec: "headroom-ai",
  version: "0.26.0",
  extras: ["all"],
  binaries: ["headroom"],
  platforms: {
    linux: { supported: true },
    darwin: { supported: true },
    win32: { supported: false, prereqs: ["rust"], note: "no Windows wheel — sdist build needs Rust" },
  },
};

// notion — the npx-lane CLI `ntn` (binary `ntn`), pinned at 0.17.0 (milestone 17 /
// ADR-004; RESEARCH §A1). provider:"npx" means the m12 npx lane provisions it as a
// node framework (12/ADR-002), NOT the version-keyed store — the npx-lane decision
// is HONOURED, not extended. The platform matrix marks win32 supported with the
// x64-only / Node-22+ / npm-10+ note the tool-platform doctor check surfaces.
export const NOTION_DESCRIPTOR = {
  name: "notion",
  provider: "npx",
  packageSpec: "ntn",
  version: "0.17.0",
  binaries: ["ntn"],
  platforms: {
    win32: { supported: true, prereqs: ["node>=22", "npm>=10"], note: "x64 only (no win32-arm64)" },
  },
};

// The descriptor map — the single enumerable source story 01/04 consult.
export const TOOL_DESCRIPTORS = {
  graphify: GRAPHIFY_DESCRIPTOR,
  headroom: HEADROOM_DESCRIPTOR,
  notion: NOTION_DESCRIPTOR,
};

// toolDescriptors() → the descriptor list (a stable array for enumeration).
export function toolDescriptors() {
  return Object.values(TOOL_DESCRIPTORS);
}

// descriptorFor(name) → the frozen descriptor for a managed tool; throws a clear
// error for an unknown tool (error.code = "unknown-tool"), never guesses.
export function descriptorFor(name) {
  const descriptor = TOOL_DESCRIPTORS[name];
  if (!descriptor) {
    const error = new Error(
      `Unknown managed tool "${name}" — known tools: ${Object.keys(TOOL_DESCRIPTORS).join(", ")}.`
    );
    error.code = "unknown-tool";
    throw error;
  }
  return descriptor;
}
