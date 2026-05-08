import path from "node:path";
import { access } from "node:fs/promises";
import { defaultGlobalWorkspaceDir } from "./paths.mjs";

export function workspacePaths(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const workspaceDir = path.join(root, ".aof");
  return workspacePathsForRoot(workspaceDir, { projectDir: root });
}

export function globalWorkspacePaths(options = {}) {
  return workspacePathsForRoot(defaultGlobalWorkspaceDir(options.env, options.platform, options.homedir), { projectDir: null });
}

export function workspacePathsForRoot(workspaceDir, options = {}) {
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  return {
    projectDir: options.projectDir ?? path.dirname(resolvedWorkspaceDir),
    workspaceDir: resolvedWorkspaceDir,
    configPath: path.join(resolvedWorkspaceDir, "aof.config.json"),
    lockPath: path.join(resolvedWorkspaceDir, "aof.lock.json"),
    assetsDir: path.join(resolvedWorkspaceDir, "assets")
  };
}

export function legacyConfigPath(projectDir = process.cwd()) {
  return path.join(path.resolve(projectDir), "aof.config.json");
}

export async function findProjectConfig(projectDir = process.cwd(), explicitConfigPath) {
  if (explicitConfigPath) {
    return path.resolve(projectDir, explicitConfigPath);
  }

  const paths = workspacePaths(projectDir);
  if (await exists(paths.configPath)) return paths.configPath;

  const legacyPath = legacyConfigPath(projectDir);
  if (await exists(legacyPath)) return legacyPath;

  return paths.configPath;
}

export async function isLegacyConfigOnlyProject(projectDir = process.cwd()) {
  const paths = workspacePaths(projectDir);
  return (await exists(legacyConfigPath(projectDir))) && !(await exists(paths.configPath));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
