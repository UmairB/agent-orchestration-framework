import os from "node:os";
import path from "node:path";

export function defaultDataDir(env = process.env, platform = process.platform, homedir = os.homedir()) {
  if (env.AOF_DATA_DIR) return path.resolve(env.AOF_DATA_DIR);

  if (platform === "win32") {
    return path.join(env.APPDATA ?? path.join(homedir, "AppData", "Roaming"), "aof");
  }

  if (platform === "darwin") {
    return path.join(homedir, "Library", "Application Support", "aof");
  }

  return path.join(env.XDG_DATA_HOME ?? path.join(homedir, ".local", "share"), "aof");
}

export function defaultGlobalWorkspaceDir(env = process.env, platform = process.platform, homedir = os.homedir()) {
  if (env.AOF_GLOBAL_HOME) return path.resolve(env.AOF_GLOBAL_HOME);
  return path.join(homedir, ".aof");
}

// --------------------------------------------------------- tool store (12) ---
// PURE path geometry for the managed-tool store (milestone 12, ADR-001). The
// store lives UNDER the existing global workspace home (defaultGlobalWorkspaceDir
// = ~/.aof, AOF_GLOBAL_HOME-overridable) — so the root is NEVER a hardcoded
// os.homedir()/".aof" literal here: it derives from defaultGlobalWorkspaceDir(env),
// which makes AOF_GLOBAL_HOME relocate the WHOLE store for free (ADR-005 inv. 2,
// the relocation guard). These are raw-absolute, basis-neutral (08/ADR-002).

// toolStoreRoot(env) → <defaultGlobalWorkspaceDir(env)>/tools — the one root all
// managed tools share across the operator's projects.
export function toolStoreRoot(env = process.env) {
  return path.join(defaultGlobalWorkspaceDir(env), "tools");
}

// toolVersionDir(name, version, env) → <toolStoreRoot(env)>/<name>/<version> — a
// tool's version-keyed home (so a project can pin a version yet all projects share
// one store). This is the dir the uv lane provisions into and the resolver reads
// the {Scripts|bin}/<binary>[.exe] out of (ADR-001).
export function toolVersionDir(name, version, env = process.env) {
  return path.join(toolStoreRoot(env), name, version);
}
