// Steps for config-family.feature (m42 wave (d) leg d1, wave-1 completion).
// Mostly the shared grammar; the extras scaffold config-family fixtures and
// assert project files.
import assert from "node:assert/strict";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createStepRegistry } from "../support/step-registry.mjs";
import { registerCommonSteps } from "../support/common-steps.mjs";

const registry = createStepRegistry();
registerCommonSteps(registry);

async function writeProjectConfig(context, config) {
  const aofDir = path.join(context.projectDir, ".aof");
  await mkdir(aofDir, { recursive: true });
  await writeFile(path.join(aofDir, "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  context.workStreamReady = true;
  context.items ??= new Map();
}

registry.define("a project with an empty aof config", async (context) => {
  await writeProjectConfig(context, { name: "fixture", resources: [] });
});

registry.define("a project whose config declares a malformed package", async (context) => {
  await writeProjectConfig(context, { name: "fixture", resources: [], packages: [{}] });
});

// A legacy project: ROOT aof.config.json only — no .aof/ workspace dir yet.
registry.define("a legacy root-config project", async (context) => {
  await mkdir(context.projectDir, { recursive: true });
  await writeFile(
    path.join(context.projectDir, "aof.config.json"),
    `${JSON.stringify({ name: "legacy", resources: [] }, null, 2)}\n`,
    "utf8",
  );
  context.workStreamReady = true;
  context.items ??= new Map();
});

registry.define(/^project file `(.+)` should exist$/, async (context, relative) => {
  const target = path.join(context.projectDir, relative);
  await assert.doesNotReject(() => access(target), `${relative} exists under the project dir`);
});

export async function runStep(context, step) {
  await registry.run(context, step);
}
