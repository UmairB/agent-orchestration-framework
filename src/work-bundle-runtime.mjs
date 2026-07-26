import { CAPABILITIES, CAPABILITY_STATUS } from "./model.mjs";

export const ACD_BUNDLE_CAPABILITIES = {
  ...CAPABILITIES,
  command: {
    ...CAPABILITIES.command,
    codex: CAPABILITY_STATUS.mapped
  }
};

const RENDERABLE_STATUSES = new Set([CAPABILITY_STATUS.native, CAPABILITY_STATUS.mapped]);

const RESOURCE_MAPPINGS = {
  command: {
    codex: {
      kind: "skill",
      idPrefix: "aof-",
      invocationPrefix: "$aof-",
      sourceInvocationPrefix: "/",
      argumentToken: "$ARGUMENTS"
    }
  }
};

function capabilityStatus(kind, runtime) {
  return ACD_BUNDLE_CAPABILITIES[kind]?.[runtime];
}

function isRenderable(kind, runtime) {
  return RENDERABLE_STATUSES.has(capabilityStatus(kind, runtime));
}

function mappingFor(kind, runtime) {
  return RESOURCE_MAPPINGS[kind]?.[runtime] ?? null;
}

export function partitionByCapability(resources, runtimes) {
  const installable = [];
  const notInstallable = [];
  for (const resource of resources) {
    const declaredRuntimes = resource.runtimes ?? runtimes;
    const renderRuntimes = [];
    for (const runtime of runtimes) {
      const status = capabilityStatus(resource.kind, runtime) ?? "unknown";
      if (!isRenderable(resource.kind, runtime)) {
        notInstallable.push({
          id: resource.id,
          kind: resource.kind,
          runtime,
          status
        });
        continue;
      }

      const mapping = mappingFor(resource.kind, runtime);
      if (mapping) {
        installable.push(mappedResource(resource, runtime, mapping));
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

export function installableBundleResources(resources, runtimes) {
  return partitionByCapability(resources, runtimes).installable;
}

function mappedResource(resource, runtime, mapping) {
  const id = `${mapping.idPrefix ?? ""}${resource.id}`;
  return {
    ...resource,
    id,
    kind: mapping.kind,
    name: id,
    runtimes: [runtime],
    body: mappedBody(resource, mapping),
    _aofMappedFrom: { id: resource.id, kind: resource.kind }
  };
}

function mappedBody(resource, mapping) {
  const invocation = `${mapping.invocationPrefix ?? ""}${resource.id}`;
  const hint = normalizeArgumentHint(resource.argumentHint);
  const sourceInvocation = resource.commandNamespace
    ? `${resource.commandNamespace}:${resource.id}`
    : resource.id;
  return [
    `Use this skill when the user asks for \`${invocation}${hint ? ` ${hint}` : ""}\`, or asks to run the AOF \`${sourceInvocation}\` procedure in Codex.`,
    "",
    `Where this procedure mentions \`${mapping.argumentToken}\`, use the text the user supplied after the skill name.`,
    `Where it mentions Claude slash command \`${mapping.sourceInvocationPrefix ?? ""}${sourceInvocation}\`, treat that as this Codex skill invocation.`,
    "",
    resource.body?.trim() ?? "",
    ""
  ].join("\n");
}

function normalizeArgumentHint(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/^['"]|['"]$/g, "");
}