// project:provision — the lifecycle surface (12/ADR-003). A NEW command-core
// command (registered into the SAME COMMANDS registry the work/graph commands
// live in, 08/ADR-002) that installs/pins a managed tool INTO the version-keyed
// store, or removes one version dir. It drives story 00's provider registry +
// resolver (ADR-001/002) — it does NOT own the store geometry or the lanes.
//
//   input  { tool, version?, force?, uninstall?, dryRun? }
//   result ProvisionResult { tool, provider, version, storePath, status, plan }
//     status ∈ "installed" | "present" | "uninstalled"
//     storePath — RAW ABSOLUTE to <store>/<name>/<version>/ (basis-neutral,
//                 08/ADR-002); the CLI face relativises it for display.
//
// An "upgrade" provisions a NEW <name>/<version>/ dir; the old pin is left in
// place (the store is version-keyed — a project pinning the old version is
// unaffected, ADR-003). Uninstall removes ONLY toolVersionDir(name, version) —
// never a global/PATH/system path (ADR-002/ADR-005 inv. 5). The live `uv venv`+
// install (executing the plan when NOT dryRun) is the @manual path; the
// @executable tests exercise dry-run only, so this command MUST never spawn under
// dryRun.
//
// The command is GLOBAL-STORE oriented: it reads no project files, so it works
// with AOF_GLOBAL_HOME pointing at any dir and needs no real project workspace
// (the CLI face loadWorkspace is best-effort).
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  descriptorFor,
  planProvision,
  uninstall,
  assertSafeToolSegment,
} from "../tool-store.mjs";
import { toolVersionDir } from "../paths.mjs";

export const projectProvisionCommand = {
  id: "project:provision",
  input: {
    type: "object",
    properties: {
      tool: { type: "string" },
      version: { type: "string" },
      force: { type: "boolean" },
      uninstall: { type: "boolean" },
      dryRun: { type: "boolean" },
    },
    required: ["tool"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    // Resolve the tool's frozen descriptor (ADR-002). An explicit --version pins
    // the install to a DIFFERENT version dir than the descriptor's default — an
    // upgrade provisions a NEW <name>/<version>/ dir; we never mutate the frozen
    // descriptor in place, so the old pin's resolution is untouched.
    const baseDescriptor = descriptorFor(input.tool);
    const descriptor = input.version
      ? { ...baseDescriptor, version: input.version }
      : baseDescriptor;
    const { name, provider, version } = descriptor;

    // BOUNDARY GUARD (ADR-005 inv. 5): name + version each become ONE store path
    // segment, and version is untrusted (--version). Reject a traversal/separator/
    // absolute value BEFORE any path is built or any dir is removed — without this
    // a `--version ../../x --uninstall` would rmSync OUTSIDE the store. The frozen
    // descriptors always pass; this only trips a typo or a malicious --version.
    assertSafeToolSegment(name, "tool");
    assertSafeToolSegment(version, "version");

    // env flows through the seam so AOF_GLOBAL_HOME relocates the store for the
    // version-dir geometry (ADR-001 inv. 2). The command reads no project files.
    const env = ctx?.env ?? process.env;

    // ---- UNINSTALL path (ADR-002/ADR-003; ADR-005 inv. 5) -------------------
    // Removal targets ONLY toolVersionDir(name, version) under the store root.
    // Under dryRun we COMPUTE the target but DO NOT remove it (the plan reports
    // what would be removed); a non-dry-run uninstall removes the dir via the
    // store-scoped tool-store.uninstall (the sole removal site).
    if (input.uninstall === true) {
      const target = toolVersionDir(name, version, env);
      if (!input.dryRun) {
        uninstall(descriptor, { env });
      }
      return {
        tool: name,
        provider,
        version,
        storePath: target,
        status: "uninstalled",
        // The plan names the version dir to remove (never a global/PATH path).
        plan: { provider, action: "uninstall", removeDir: target },
      };
    }

    // ---- INSTALL / PLAN path (ADR-002/ADR-003) ------------------------------
    // planProvision dispatches on descriptor.provider to the lane's planner and
    // returns the command list; under dryRun the lane emits the plan WITHOUT
    // spawning (mirrors planFrameworkInstall's dryRun — tool-store.mjs).
    const plan = planProvision(descriptor, {
      dryRun: input.dryRun,
      force: input.force,
      env,
    });

    // storePath is the RAW ABSOLUTE version dir (basis-neutral); the CLI face
    // relativises it for display. The status is the install disposition: a
    // dry-run plan reports "installed" (the planned/fresh install).
    const storePath = toolVersionDir(name, version, env);

    if (input.dryRun) {
      return {
        tool: name,
        provider,
        version,
        storePath,
        status: "installed",
        plan,
      };
    }

    // The live execution path is @manual (a real uv venv is heavy / live-only —
    // RESEARCH §A2/A4). Execute the planned commands HONESTLY when not dryRun.
    // This command provisions the uv-lane store tools; the npx lane installs via the
    // framework installer (`aof packages install`, executeFrameworkInstallPlan), NOT
    // here — so a non-uv provider on the live path is refused rather than silently
    // no-op'd (it would otherwise report "installed" having run nothing).
    if (provider !== "uv") {
      throw provisionError(
        `project:provision executes the uv lane only; "${provider}" tools install via the framework installer.`,
        "provider-not-executable"
      );
    }
    // Each lane owns its OWN exec env (the uv lane is NOT SAFE_NPM_EXEC_ENV —
    // ADR-002). Spawn under the SAME seam env the plan's versionDir was derived from
    // (ctx.env, default process.env) so an AOF_GLOBAL_HOME passed via ctx relocates
    // BOTH the planned target and the uv run. A non-zero exit / spawn error is a
    // structured failure — never a silent "installed" over a failed install.
    for (const [bin, ...rest] of plan.commands ?? []) {
      const result = spawnSync(bin, rest, { stdio: "inherit", env });
      if (result.error || result.status !== 0) {
        throw provisionError(
          `Provisioning ${name} failed: \`${[bin, ...rest].join(" ")}\` exited ${result.status ?? result.error?.code ?? "non-zero"}.`,
          "provision-failed"
        );
      }
    }

    return {
      tool: name,
      provider,
      version,
      storePath,
      status: "installed",
      plan,
    };
  },

  cli: {
    // m42 wave (d) leg d1 (wave-3 tail) — routed (class B): the cli.mjs face
    // copy (projectProvisionCli) is deleted; the generic face is the one door.
    // spec.workspace: false — provision is GLOBAL-STORE oriented and reads no
    // project files (its run never touches ctx.workspace; the retired face's
    // best-effort loadWorkspace was belt-and-braces with no consumer).
    route: ["project", "provision"],
    spec: {
      usage: "aof project provision <tool> [--version V] [--force] [--uninstall] [--dry-run] [--json]",
      workspace: false,
      flags: {
        version: { type: "string", description: "pin a specific version dir" },
        force: { type: "boolean", description: "re-run the provision even when present" },
        uninstall: { type: "boolean", description: "remove exactly this tool version dir" },
        dryRun: { type: "boolean", description: "report the plan without executing" },
      },
    },

    // `aof project provision <tool> [--version V] [--force] [--uninstall]
    //  [--dry-run] [--json]`. Only present fields are set (so the input stays the
    // minimal shape the schema validates).
    argv: (positionals, options = {}) => {
      const input = { tool: positionals[0] };
      if (options.version) input.version = options.version;
      if (options.force) input.force = true;
      if (options.uninstall) input.uninstall = true;
      if (options.dryRun) input.dryRun = true;
      return input;
    },

    // Human render: a one-liner reporting the disposition + the store path.
    render(result) {
      const verb =
        result.status === "uninstalled"
          ? "Removed"
          : result.status === "present"
            ? "Present"
            : "Provisioned";
      return `${verb} ${result.tool} ${result.version} (${result.provider}) at ${result.storePath}`;
    },

    // --json face projection: relativise storePath to process.cwd() (mirrors
    // graph-build's relativisePaths, 08/ADR-002 path-display projection). Every
    // other field is the basis-neutral ProvisionResult verbatim.
    json: (result) => relativisePaths(result),
  },
};

// A structured command error (mirrors commands/errors.mjs commandError) — carries a
// `code` so the CLI --json face emits a single { ok:false, error, code } envelope and
// the non-json face propagates a clear message, never an opaque spawn failure.
function provisionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Relativise storePath to process.cwd() for the CLI --json face (08/ADR-002
// path-display projection). Leaves the plan + every other field untouched.
function relativisePaths(result) {
  const out = { ...result };
  if (typeof out.storePath === "string") out.storePath = path.relative(process.cwd(), out.storePath);
  return out;
}
