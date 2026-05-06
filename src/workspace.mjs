import path from "node:path";
import { access } from "node:fs/promises";

export function workspacePaths(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const workspaceDir = path.join(root, ".aof");
  return {
    projectDir: root,
    workspaceDir,
    configPath: path.join(workspaceDir, "aof.config.json"),
    lockPath: path.join(workspaceDir, "aof.lock.json"),
    assetsDir: path.join(workspaceDir, "assets")
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
