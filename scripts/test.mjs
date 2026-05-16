import { adapterTests } from "../test/adapters.test.mjs";
import { catalogTests } from "../test/catalog.test.mjs";
import { pathTests } from "../test/paths.test.mjs";
import { promptTests } from "../test/prompt.test.mjs";
import { modelTests } from "../test/model.test.mjs";
import { workspaceTests } from "../test/workspace.test.mjs";
import { renderPlanTests } from "../test/render-plan.test.mjs";
import { configInspectTests } from "../test/config-inspect.test.mjs";
import { configEditorTests } from "../test/config-editor.test.mjs";
import { frameworkTests } from "../test/frameworks.test.mjs";
import { cleanTests } from "../test/clean.test.mjs";
import { dslPrimitiveTests } from "../test/dsl-primitives.test.mjs";
import { setupUiTests } from "../test/setup-ui.test.mjs";
import { schemaTests } from "../test/schema.test.mjs";
import { adapterWarningTests } from "../test/adapter-warnings.test.mjs";
import { packageTests } from "../test/packages.test.mjs";
import { boardTests } from "../test/boards.test.mjs";
import { boardBreakdownTests } from "../test/board-breakdown.test.mjs";
import { boardExecutionTests } from "../test/board-execution.test.mjs";
import { gsdSdkAdapterTests } from "../test/gsd-sdk-adapter.test.mjs";

const tests = [
  ...gsdSdkAdapterTests,
  ...boardExecutionTests,
  ...boardBreakdownTests,
  ...boardTests,
  ...adapterWarningTests,
  ...packageTests,
  ...adapterTests,
  ...renderPlanTests,
  ...configInspectTests,
  ...configEditorTests,
  ...frameworkTests,
  ...cleanTests,
  ...dslPrimitiveTests,
  ...setupUiTests,
  ...schemaTests,
  ...modelTests,
  ...workspaceTests,
  ...pathTests,
  ...promptTests,
  ...catalogTests
];

let failures = 0;

console.log("# unit");
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error.stack ?? error.message);
  }
}

console.log("# integration");
const previousInProcess = process.env.AOF_IN_PROCESS_INTEGRATION;
process.env.AOF_IN_PROCESS_INTEGRATION = "1";
await import("../test/integration/cli.mjs");

if (previousInProcess === undefined) {
  delete process.env.AOF_IN_PROCESS_INTEGRATION;
} else {
  process.env.AOF_IN_PROCESS_INTEGRATION = previousInProcess;
}

if (failures > 0 || process.exitCode) {
  process.exitCode = 1;
}
