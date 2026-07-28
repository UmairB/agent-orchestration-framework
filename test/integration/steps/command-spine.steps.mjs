// Steps for command-spine.feature (m42 wave (d) leg d1). Everything the feature
// needs is the shared grammar — the point: a migrated verb's contract is
// expressible in common steps, so migrating a command costs a scenario, not a
// bespoke harness.
import { createStepRegistry } from "../support/step-registry.mjs";
import { registerCommonSteps } from "../support/common-steps.mjs";

const registry = createStepRegistry();
registerCommonSteps(registry);

export async function runStep(context, step) {
  await registry.run(context, step);
}
