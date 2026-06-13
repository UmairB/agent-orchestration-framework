import path from "node:path";
import { writeText } from "./fs.mjs";
import { assetBodyPath } from "./config-editor.mjs";
import { workspacePaths } from "./workspace.mjs";

const WORKSPACE_GITIGNORE = "/cache/boards/dispatch.log.jsonl\n";

export async function writeWorkspaceConfig(targetDir, config) {
  const paths = workspacePaths(targetDir);
  const resources = [];

  for (const resource of config.resources ?? []) {
    const resourcePath = assetBodyPath(resource);
    const content = resource.body ?? resource.prompt ?? resource.instructions ?? "";
    await writeText(path.join(paths.workspaceDir, resourcePath), `${content.trim()}\n`);

    const metadata = { ...resource, path: resourcePath.replaceAll(path.sep, "/") };
    delete metadata.body;
    delete metadata.prompt;
    delete metadata.instructions;
    delete metadata.overrides;
    resources.push(metadata);
  }

  await writeText(path.join(paths.workspaceDir, ".gitignore"), WORKSPACE_GITIGNORE);
  await writeText(paths.configPath, `${JSON.stringify({
    $schema: config.$schema ?? "https://aof.local/schemas/aof.schema.json",
    name: config.name ?? "assistant-project",
    resources,
    packages: config.packages ?? [],
    ...(config.items ? { items: config.items } : {}),
    ...(config.runtimes ? { runtimes: config.runtimes } : {})
  }, null, 2)}\n`);
}
