// Shared bundle→config synthesis for `aof work init` and `aof work update`
// (milestone 01 / story 01 + 02). Both commands must build an IDENTICAL aof
// `config` from the bundle so init and update render the same desired set; this
// module is the one place that synthesis lives, so the two commands cannot drift.
//
//   ADR-003: init/update synthesize a standard aof `config` from the bundle and
//     delegate the create/update/skip/drift/delete + manifest machinery to the
//     shared engine. This module ONLY does the synthesis (partition by the
//     capability matrix + build the desired-output set); it does NOT classify
//     actions, compare hashes, or decide --force — that stays in render-plan.mjs.
//   ADR-006: cross-runtime mapping is delegated to the CAPABILITIES matrix. The
//     decision is a generic lookup; there is NO `runtime === "codex"`/`"claude"`
//     branch here.
import path from "node:path";
import { createRenderPlan } from "./render-plan.mjs";
import { CAPABILITIES, CAPABILITY_STATUS } from "./model.mjs";
import { renderBundleTemplateOutputs } from "./work-bundle.mjs";
import { packageVersion } from "./work-bundle-manifest.mjs";
import { readConfig, readDelegation, applyDelegationToResources } from "./work-delegation.mjs";

// A member-kind is installable for a runtime iff the capability matrix says so.
// `native` and `mapped` render; `unsupported-fail`/`unsupported-warning`/`future`
// are reported, never force-written. The decision lives ENTIRELY in CAPABILITIES
// (ADR-006) — there is no per-runtime branch here.
const RENDERABLE_STATUSES = new Set([CAPABILITY_STATUS.native, CAPABILITY_STATUS.mapped]);

function capabilityStatus(kind, runtime) {
  return CAPABILITIES[kind]?.[runtime];
}

function isRenderable(kind, runtime) {
  return RENDERABLE_STATUSES.has(capabilityStatus(kind, runtime));
}

// Partition the bundle's resource members against the matrix for the SELECTED
// runtimes. For each selected runtime the matrix is the authority (ADR-006):
//   - matrix renderable (native/mapped) → render the member for that runtime;
//   - matrix NOT renderable (unsupported-*/future) → REPORT the member as
//     not-installable for that runtime (never silently drop, never force-write).
// A member's declared `runtimes` narrows WHERE a renderable member is emitted; it
// never suppresses the unsupported report (so codex commands surface honestly).
// There is deliberately NO `runtime === "codex"`/`"claude"` branch here — the
// decision is a generic CAPABILITIES lookup (acd-capability-delegation).
export function partitionByCapability(resources, runtimes) {
  const installable = [];
  const notInstallable = [];
  for (const resource of resources) {
    const declaredRuntimes = resource.runtimes ?? runtimes;
    const renderRuntimes = [];
    for (const runtime of runtimes) {
      if (!isRenderable(resource.kind, runtime)) {
        notInstallable.push({
          id: resource.id,
          kind: resource.kind,
          runtime,
          status: capabilityStatus(resource.kind, runtime) ?? "unknown"
        });
        continue;
      }
      if (declaredRuntimes.includes(runtime)) renderRuntimes.push(runtime);
    }
    if (renderRuntimes.length > 0) {
      installable.push({ ...resource, runtimes: renderRuntimes });
    }
  }
  return { installable, notInstallable };
}

export function bundleVersion() {
  // The aof package version (ADR-002). Read package.json directly via the shared
  // packageVersion() helper — NOT by re-rendering the whole bundle manifest just
  // to pull one string out of it (that would re-render all 34 members per call).
  return packageVersion();
}

// Build the desired output set: renderable resources (via the unchanged engine)
// plus template outputs (runtime-independent, comment-stamped). Templates are
// rendered to the fixed bundle location once.
export async function planDesiredOutputs(bundle, installableResources, runtimes, targetDir) {
  const config = { resources: installableResources, workflows: [], packages: [] };
  const memberKinds = new Set(["agent", "command", "skill"]);
  const resourceOutputs = (await createRenderPlan(config, { targetDir, runtimes }))
    .filter((output) => memberKinds.has(output.resource?.kind));
  // Output objects carry TWO path conventions intentionally: `path` is the logical
  // repo-relative path with forward slashes (portable, used in the manifest), while
  // `absolutePath` is the OS-separator on-disk path the engine writes to. Both
  // coexist by design — do not collapse one into the other.
  const templateOutputs = renderBundleTemplateOutputs(bundle, { runtimes }).map((output) => ({
    ...output,
    absolutePath: path.join(targetDir, output.path)
  }));
  return [...resourceOutputs, ...templateOutputs];
}

// Partition + plan in one step: the IDENTICAL desired set both init and update
// compute from the bundle for the selected runtimes. Returns the desired outputs
// and the not-installable report (the matrix-surfaced members).
export async function synthesizeBundleConfig(bundle, { runtimes, targetDir }) {
  // Config-aware projection (the ONLY project-config read on the render path): the
  // `work.agents.delegation` toggle drops disable-model-invocation off the codex-*
  // skills when ON, so init/update render them auto-invocable. Absent config ⇒ OFF
  // ⇒ no change (the bundle default). No runtime branch — a generic per-resource map.
  const { config } = await readConfig(targetDir);
  const resources = applyDelegationToResources(bundle.resources, readDelegation(config));
  const { installable, notInstallable } = partitionByCapability(resources, runtimes);
  const desiredOutputs = await planDesiredOutputs(bundle, installable, runtimes, targetDir);
  return { desiredOutputs, notInstallable };
}

export function summarizeActions(actions) {
  const summary = { created: 0, updated: 0, skipped: 0, "drift-warning": 0, deleted: 0 };
  for (const item of actions) {
    if (item.action === "create") summary.created += 1;
    else if (item.action === "update") summary.updated += 1;
    else if (item.action === "skip") summary.skipped += 1;
    else if (item.action === "drift-warning") summary["drift-warning"] += 1;
    else if (item.action === "delete") summary.deleted += 1;
  }
  return summary;
}
