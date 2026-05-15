import { runSharedCliStep } from "./shared-cli.steps.mjs";

export async function runStep(context, step) {
  await runSharedCliStep(context, step);
}
