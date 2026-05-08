import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function discoverFeatureFiles(integrationDir, options = {}) {
  if (Array.isArray(options.featureFiles) && options.featureFiles.length > 0) {
    return options.featureFiles;
  }

  const featuresDir = path.join(integrationDir, "features");
  try {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".feature"))
      .map((entry) => path.join(featuresDir, entry.name))
      .sort();
    if (files.length > 0) return files;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return [path.join(integrationDir, "cli.feature")];
}

export async function parseFeature(filePath) {
  const text = await readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const feature = { filePath, name: path.basename(filePath), scenarios: [] };
  let currentScenario = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    if (line.startsWith("Feature:")) {
      feature.name = line.slice("Feature:".length).trim();
      continue;
    }

    if (line.startsWith("Scenario:")) {
      currentScenario = { name: line.slice("Scenario:".length).trim(), steps: [] };
      feature.scenarios.push(currentScenario);
      continue;
    }

    if (/^(Given|When|Then|And)\b/.test(line)) {
      if (!currentScenario) throw new Error(`Step appears before scenario in ${filePath}: ${line}`);
      currentScenario.steps.push(line.replace(/^(Given|When|Then|And)\s+/, ""));
    }
  }

  return feature;
}

export async function runFeatureFiles(featureFiles, runner) {
  let failures = 0;

  for (const featureFile of featureFiles) {
    const feature = await parseFeature(featureFile);
    for (const scenario of feature.scenarios) {
      const scenarioName = `${feature.name}: ${scenario.name}`;
      const context = await runner.createContext({ feature, scenario });
      try {
        for (const step of scenario.steps) {
          await runner.runStep(context, step, { feature, scenario });
        }
        console.log(`ok - ${scenarioName}`);
      } catch (error) {
        failures += 1;
        console.error(`not ok - ${scenarioName}`);
        console.error(error.stack ?? error.message);
      } finally {
        await runner.cleanupContext(context, { feature, scenario });
      }
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}
