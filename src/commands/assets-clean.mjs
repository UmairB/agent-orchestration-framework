// assets:clean — remove lock-owned generated files (m42 wave (d) leg d1).
// Class-A migration of cli.mjs's inline `assetsCleanCommand` over clean.mjs's
// plan/execute pair. Byte-identical output (formatApplyAction moved to its
// owning module, render-plan.mjs).
import path from "node:path";
import { formatApplyAction } from "../render-plan.mjs";

export const assetsCleanCommand = {
  id: "assets:clean",
  input: {
    type: "object",
    properties: {
      target: { type: "string" },
      dryRun: { type: "boolean" },
    },
    additionalProperties: false,
  },

  async run(input) {
    const targetDir = path.resolve(input.target ?? process.cwd());
    // Dynamic import mirrors the retired handler (clean stays lazy-loaded).
    const { createCleanPlan, executeCleanPlan } = await import("../clean.mjs");
    const plan = await createCleanPlan(targetDir);

    const base = {
      dryRun: Boolean(input.dryRun),
      hasLock: Boolean(plan.lock),
      lockPath: plan.lockPath,
      actions: plan.actions,
      removedCount: plan.removedCount,
    };
    if (!plan.lock || input.dryRun) return { ...base, executed: false };

    await executeCleanPlan(plan);
    return { ...base, executed: true };
  },

  cli: {
    route: ["assets", "clean"],
    spec: {
      usage: "aof assets clean [--target <dir>] [--dry-run]",
      workspace: false,
      flags: {
        target: { type: "string", description: "project directory (defaults to cwd)" },
        dryRun: { type: "boolean", description: "preview without removing files or lock entries" },
      },
    },

    argv: (positionals, options) => ({
      target: options.target,
      dryRun: options.dryRun === true ? true : undefined,
    }),

    render(result) {
      if (!result.hasLock) return `clean: no lock file found at ${result.lockPath}`;
      const lines = [];
      if (result.dryRun) lines.push("dry-run: no generated files or lock entries will be removed");
      if (result.actions.length === 0) lines.push("clean: no generated file entries in lock");
      for (const item of result.actions) lines.push(formatApplyAction(item));
      lines.push(`lock-preview: remove ${result.removedCount} file entr${result.removedCount === 1 ? "y" : "ies"}`);
      if (result.executed) lines.push(`lock: ${result.lockPath}`);
      return lines.join("\n");
    },

    json: (result) => result,
  },
};
