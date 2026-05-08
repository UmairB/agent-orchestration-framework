import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFeatureFiles } from "./support/feature-runner.mjs";
import { cleanupCliContext, createCliContext } from "./support/cli-context.mjs";
import { runStep } from "./steps/cli-legacy.steps.mjs";

const integrationDir = path.dirname(fileURLToPath(import.meta.url));
const featureFiles = [path.join(integrationDir, "cli.feature")];

await runFeatureFiles(featureFiles, {
  createContext: createCliContext,
  cleanupContext: cleanupCliContext,
  runStep
});
