import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverFeatureFiles, runFeatureFiles } from "./support/feature-runner.mjs";
import { cleanupCliContext, createCliContext } from "./support/cli-context.mjs";
import { cleanupSetupUiContext } from "./support/setup-ui-context.mjs";
import { runStep as runAdapterPolicyStep } from "./steps/adapter-policy.steps.mjs";
import { runStep as runDslStep } from "./steps/dsl.steps.mjs";
import { runStep as runLifecycleStep } from "./steps/lifecycle.steps.mjs";
import { runStep as runPackagesStep } from "./steps/packages.steps.mjs";
import { runStep as runSetupUiStep } from "./steps/setup-ui.steps.mjs";

const integrationDir = path.dirname(fileURLToPath(import.meta.url));
const featureFiles = await discoverFeatureFiles(integrationDir);
const stepModules = new Map([
  ["adapter-policy.feature", runAdapterPolicyStep],
  ["dsl.feature", runDslStep],
  ["lifecycle.feature", runLifecycleStep],
  ["packages.feature", runPackagesStep],
  ["setup-ui.feature", runSetupUiStep],
  ["cli.feature", runLifecycleStep]
]);

await runFeatureFiles(featureFiles, {
  createContext: createCliContext,
  cleanupContext: async (context) => {
    await cleanupSetupUiContext(context);
    await cleanupCliContext(context);
  },
  runStep: async (context, step, { feature }) => {
    const runner = stepModules.get(path.basename(feature.filePath));
    if (!runner) {
      throw new Error(`No step module registered for ${path.basename(feature.filePath)}.`);
    }
    await runner(context, step);
  }
});
