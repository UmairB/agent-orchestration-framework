import { normalizeId } from "./fs.mjs";
import { supportedResourceKinds, supportedRuntimes } from "./model.mjs";

const VALID_RUNTIMES = new Set(supportedRuntimes());
const VALID_RESOURCE_KINDS = new Set(supportedResourceKinds());
const VALID_SOURCE_TYPES = new Set(["npm", "git", "file"]);

export function normalizePackages(packages = []) {
  if (!Array.isArray(packages)) {
    throw new Error("packages must be an array when provided.");
  }
  return packages.map((pkg, index) => normalizePackage(pkg, index));
}

export function normalizePackage(pkg, index = 0) {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    throw new Error(`packages[${index}] must be an object.`);
  }

  const id = normalizeId(pkg.id);
  const namespace = normalizeNamespace(pkg.namespace, index);
  const { source, sourceDescriptor } = normalizePackageSource(pkg.source, index);

  const runtimes = normalizePackageRuntimes(pkg.runtimes, index);
  return {
    ...pkg,
    id,
    namespace,
    source,
    sourceDescriptor,
    runtimes,
    dependencies: normalizePackageDependencies(pkg.dependencies ?? pkg.dependsOn ?? pkg.depends_on, index),
    resources: normalizePackageResources(pkg.resources, index, runtimes)
  };
}

export function normalizePackageSource(source, index = 0) {
  if (typeof source === "string") {
    return normalizeStringSource(source, index);
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`packages[${index}].source must be a source string or object.`);
  }

  const type = source.type;
  if (!VALID_SOURCE_TYPES.has(type)) {
    throw new Error(`packages[${index}].source.type must be npm, git, or file.`);
  }

  if (type === "npm") {
    const packageName = source.package ?? source.name;
    if (typeof packageName !== "string" || packageName.trim() === "") {
      throw new Error(`packages[${index}].source.package is required for npm sources.`);
    }
    const version = source.version ?? source.tag ?? source.range;
    const descriptor = {
      type,
      package: packageName.trim()
    };
    if (version !== undefined) descriptor.version = String(version);
    return {
      source: `npm:${descriptor.package}${descriptor.version ? `@${descriptor.version}` : ""}`,
      sourceDescriptor: descriptor
    };
  }

  if (type === "git") {
    if (typeof source.url !== "string" || source.url.trim() === "") {
      throw new Error(`packages[${index}].source.url is required for git sources.`);
    }
    const descriptor = {
      type,
      url: source.url.trim()
    };
    if (source.ref !== undefined) descriptor.ref = String(source.ref);
    return {
      source: `git:${descriptor.url}${descriptor.ref ? `#${descriptor.ref}` : ""}`,
      sourceDescriptor: descriptor
    };
  }

  if (typeof source.path !== "string" || source.path.trim() === "") {
    throw new Error(`packages[${index}].source.path is required for file sources.`);
  }
  const descriptor = {
    type,
    path: source.path.trim()
  };
  return {
    source: `file:${descriptor.path}`,
    sourceDescriptor: descriptor
  };
}

export function normalizePackageDependencies(dependencies, index = 0) {
  if (dependencies === undefined) return [];
  if (!Array.isArray(dependencies)) {
    throw new Error(`packages[${index}].dependencies must be an array when provided.`);
  }

  return dependencies.map((dependency, dependencyIndex) => {
    if (typeof dependency === "string") {
      return normalizeId(dependency);
    }
    if (dependency && typeof dependency === "object" && !Array.isArray(dependency)) {
      return {
        ...dependency,
        id: normalizeId(dependency.id),
        namespace: dependency.namespace === undefined ? undefined : normalizeNamespace(dependency.namespace, index)
      };
    }
    throw new Error(`packages[${index}].dependencies[${dependencyIndex}] must be a string or object.`);
  });
}

export function packageInstallSpec(pkg) {
  const descriptor = pkg.sourceDescriptor ?? normalizePackageSource(pkg.source).sourceDescriptor;
  if (descriptor.type === "npm") {
    return `${descriptor.package}${descriptor.version ? `@${descriptor.version}` : ""}`;
  }
  if (descriptor.type === "git") {
    return `${descriptor.url}${descriptor.ref ? `#${descriptor.ref}` : ""}`;
  }
  return descriptor.path;
}

export function resolvedPackageEntry(pkg) {
  const descriptor = pkg.sourceDescriptor ?? normalizePackageSource(pkg.source).sourceDescriptor;
  return {
    id: pkg.id,
    namespace: pkg.namespace,
    source: pkg.source,
    sourceDescriptor: descriptor,
    dependencies: pkg.dependencies ?? [],
    resolution: resolutionForSource(descriptor)
  };
}

export function packageSourceLabel(pkg) {
  return pkg.source ?? normalizePackageSource(pkg.source).source;
}

function normalizeStringSource(source, index) {
  const sourceText = source.trim();
  if (sourceText === "") {
    throw new Error(`packages[${index}].source must not be empty.`);
  }

  if (sourceText.startsWith("npm:")) {
    const spec = sourceText.slice("npm:".length);
    const { packageName, version } = parseNpmSpec(spec, index);
    const descriptor = { type: "npm", package: packageName };
    if (version !== undefined) descriptor.version = version;
    return { source: sourceText, sourceDescriptor: descriptor };
  }

  if (sourceText.startsWith("git:")) {
    const spec = sourceText.slice("git:".length);
    const [url, ref] = splitOnce(spec, "#");
    if (!url) throw new Error(`packages[${index}].source git url is required.`);
    const descriptor = { type: "git", url };
    if (ref) descriptor.ref = ref;
    return { source: sourceText, sourceDescriptor: descriptor };
  }

  if (sourceText.startsWith("file:")) {
    const sourcePath = sourceText.slice("file:".length);
    if (!sourcePath) throw new Error(`packages[${index}].source file path is required.`);
    return { source: sourceText, sourceDescriptor: { type: "file", path: sourcePath } };
  }

  throw new Error(`packages[${index}].source must start with npm:, git:, or file:.`);
}

function parseNpmSpec(spec, index) {
  if (!spec) {
    throw new Error(`packages[${index}].source npm package is required.`);
  }

  const versionSeparator = spec.startsWith("@") ? spec.lastIndexOf("@") : spec.indexOf("@");
  if (versionSeparator > 0) {
    return {
      packageName: spec.slice(0, versionSeparator),
      version: spec.slice(versionSeparator + 1)
    };
  }

  return { packageName: spec, version: undefined };
}

function normalizeNamespace(namespace, index) {
  if (typeof namespace !== "string" || namespace.trim() === "") {
    throw new Error(`packages[${index}].namespace is required.`);
  }
  return normalizeId(namespace);
}

function normalizePackageRuntimes(runtimes, index) {
  if (runtimes === undefined) return ["claude", "codex"];
  if (!Array.isArray(runtimes) || runtimes.length === 0) {
    throw new Error(`packages[${index}].runtimes must be a non-empty array when provided.`);
  }
  for (const runtime of runtimes) {
    if (!VALID_RUNTIMES.has(runtime)) {
      throw new Error(`packages[${index}].runtimes contains unsupported runtime "${runtime}".`);
    }
  }
  return [...new Set(runtimes)];
}

function normalizePackageResources(resources, index, packageRuntimes) {
  if (resources === undefined) return [];
  if (!Array.isArray(resources)) {
    throw new Error(`packages[${index}].resources must be an array when provided.`);
  }
  return resources.map((resource, resourceIndex) => {
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
      throw new Error(`packages[${index}].resources[${resourceIndex}] must be an object.`);
    }
    if (!VALID_RESOURCE_KINDS.has(resource.kind)) {
      throw new Error(`packages[${index}].resources[${resourceIndex}].kind is unsupported.`);
    }
    return {
      ...resource,
      id: normalizeId(resource.id),
      runtimes: normalizePackageResourceRuntimes(resource.runtimes, packageRuntimes, index, resourceIndex)
    };
  });
}

function normalizePackageResourceRuntimes(runtimes, packageRuntimes, packageIndex, resourceIndex) {
  if (runtimes === undefined) return packageRuntimes;
  if (!Array.isArray(runtimes) || runtimes.length === 0) {
    throw new Error(`packages[${packageIndex}].resources[${resourceIndex}].runtimes must be a non-empty array when provided.`);
  }
  for (const runtime of runtimes) {
    if (!VALID_RUNTIMES.has(runtime)) {
      throw new Error(`packages[${packageIndex}].resources[${resourceIndex}].runtimes contains unsupported runtime "${runtime}".`);
    }
  }
  return [...new Set(runtimes)];
}

function resolutionForSource(descriptor) {
  if (descriptor.type === "npm") {
    return {
      type: "npm",
      package: descriptor.package,
      requested: descriptor.version ?? "latest",
      status: exactNpmVersion(descriptor.version) ? "resolved" : "requested"
    };
  }
  if (descriptor.type === "git") {
    return {
      type: "git",
      url: descriptor.url,
      ref: descriptor.ref ?? null,
      status: descriptor.ref ? "requested" : "unresolved"
    };
  }
  return {
    type: "file",
    path: descriptor.path,
    status: "local"
  };
}

function exactNpmVersion(version) {
  return typeof version === "string" && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(version);
}

function splitOnce(value, separator) {
  const index = value.indexOf(separator);
  if (index === -1) return [value, ""];
  return [value.slice(0, index), value.slice(index + separator.length)];
}
