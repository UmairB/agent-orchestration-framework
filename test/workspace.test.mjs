import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findProjectConfig, globalWorkspacePaths, isLegacyConfigOnlyProject, legacyConfigPath, workspacePaths } from "../src/workspace.mjs";

export const workspaceTests = [
  {
    name: "workspace paths point inside .aof",
    run() {
      const paths = workspacePaths("/repo");
      const root = path.resolve("/repo");
      assert.equal(paths.configPath, path.join(root, ".aof", "aof.config.json"));
      assert.equal(paths.lockPath, path.join(root, ".aof", "aof.lock.json"));
      assert.equal(paths.assetsDir, path.join(root, ".aof", "assets"));
    }
  },
  {
    name: "global workspace paths mirror .aof workspace shape",
    run() {
      const paths = globalWorkspacePaths({ env: { AOF_GLOBAL_HOME: "/tmp/aof-global" } });
      const root = path.resolve("/tmp/aof-global");
      assert.equal(paths.workspaceDir, root);
      assert.equal(paths.configPath, path.join(root, "aof.config.json"));
      assert.equal(paths.lockPath, path.join(root, "aof.lock.json"));
      assert.equal(paths.assetsDir, path.join(root, "assets"));
    }
  },
  {
    name: "config discovery prefers .aof over legacy root",
    async run() {
      const projectDir = await mkdtemp(path.join(os.tmpdir(), "aof-workspace-"));
      try {
        const paths = workspacePaths(projectDir);
        await mkdir(paths.workspaceDir, { recursive: true });
        await writeFile(legacyConfigPath(projectDir), "{}", "utf8");
        await writeFile(paths.configPath, "{}", "utf8");
        assert.equal(await findProjectConfig(projectDir), paths.configPath);
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: "config discovery reads legacy root when .aof config is absent",
    async run() {
      const projectDir = await mkdtemp(path.join(os.tmpdir(), "aof-workspace-"));
      try {
        const legacyPath = legacyConfigPath(projectDir);
        await writeFile(legacyPath, "{}", "utf8");
        assert.equal(await findProjectConfig(projectDir), legacyPath);
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: "explicit config path overrides discovered config",
    async run() {
      const projectDir = await mkdtemp(path.join(os.tmpdir(), "aof-workspace-"));
      try {
        assert.equal(await findProjectConfig(projectDir, "custom.json"), path.join(projectDir, "custom.json"));
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: "detects legacy-only config projects",
    async run() {
      const projectDir = await mkdtemp(path.join(os.tmpdir(), "aof-workspace-"));
      try {
        await writeFile(legacyConfigPath(projectDir), "{}", "utf8");
        assert.equal(await isLegacyConfigOnlyProject(projectDir), true);
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  }
];
