// test/integration/cli.mjs — the BDD runner entry (m42 wave (d): the
// integration-first restructure). Step modules resolve BY CONVENTION —
// features/<name>.feature ↔ steps/<name>.steps.mjs — so adding a feature never
// edits this file (the old hand-kept map is exactly the ladder disease the
// wave-(d) spine work retires). The one legacy exception is cli.feature, which
// predates the convention and shares lifecycle's grammar.
//
// Runs in two modes (cli-context.mjs decides): spawn (the default — the REAL
// bin/aof.mjs, per-scenario temp project + isolated AOF_GLOBAL_HOME) and
// in-process (AOF_IN_PROCESS_INTEGRATION=1, how scripts/test.mjs embeds it).
// Focused run: `node test/integration/cli.mjs <feature-name>`.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverFeatureFiles, runFeatureFiles } from "./support/feature-runner.mjs";
import { cleanupCliContext, createCliContext } from "./support/cli-context.mjs";
import { cleanupSetupUiContext } from "./support/setup-ui-context.mjs";

const integrationDir = path.dirname(fileURLToPath(import.meta.url));

const STEP_MODULE_EXCEPTIONS = new Map([["cli.feature", "lifecycle.steps.mjs"]]);

const stepRunners = new Map();
async function stepRunnerFor(featureFile) {
  const base = path.basename(featureFile);
  if (!stepRunners.has(base)) {
    const moduleName = STEP_MODULE_EXCEPTIONS.get(base) ?? `${base.replace(/\.feature$/, "")}.steps.mjs`;
    const modulePath = path.join(integrationDir, "steps", moduleName);
    let module;
    try {
      module = await import(pathToFileURL(modulePath).href);
    } catch (error) {
      throw new Error(`No step module for ${base}: expected steps/${moduleName} (${error.message})`);
    }
    if (typeof module.runStep !== "function") {
      throw new Error(`steps/${moduleName} must export runStep(context, step).`);
    }
    stepRunners.set(base, module.runStep);
  }
  return stepRunners.get(base);
}

// The focus filter applies only when this file IS the entry point — when
// scripts/test.mjs imports the suite, its own argv never narrows it.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
const filter = invokedDirectly ? process.argv[2] : undefined;

let featureFiles = await discoverFeatureFiles(integrationDir);
if (filter) {
  const wanted = filter.replace(/\.feature$/, "");
  featureFiles = featureFiles.filter((file) => path.basename(file, ".feature") === wanted);
  if (featureFiles.length === 0) {
    throw new Error(`No feature matches "${filter}" under ${path.join(integrationDir, "features")}.`);
  }
}

await runFeatureFiles(featureFiles, {
  createContext: createCliContext,
  cleanupContext: async (context) => {
    await cleanupSetupUiContext(context);
    await cleanupCliContext(context);
  },
  runStep: async (context, step, { feature }) => {
    const runner = await stepRunnerFor(feature.filePath);
    await runner(context, step);
  },
});
