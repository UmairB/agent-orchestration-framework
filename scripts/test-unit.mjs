import { adapterTests } from "../test/adapters.test.mjs";
import { catalogTests } from "../test/catalog.test.mjs";
import { pathTests } from "../test/paths.test.mjs";
import { promptTests } from "../test/prompt.test.mjs";
import { modelTests } from "../test/model.test.mjs";
import { workspaceTests } from "../test/workspace.test.mjs";

const tests = [
  ...adapterTests,
  ...modelTests,
  ...workspaceTests,
  ...pathTests,
  ...promptTests,
  ...catalogTests
];

let failures = 0;

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

if (failures > 0) {
  process.exitCode = 1;
}
