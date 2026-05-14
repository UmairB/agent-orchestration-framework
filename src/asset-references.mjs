import { normalizeId } from "./fs.mjs";
import { RUNTIMES, supportedRuntimes } from "./model.mjs";

const VALID_NAMESPACES = new Set(["skills", "workflows"]);
const UNSUPPORTED_NAMESPACES = new Set(["skill", "workflow", "command", "commands"]);

export function createAssetReferenceIndex(resources = [], workflows = []) {
  const index = { skill: new Map(), workflow: new Map() };
  for (const resource of resources ?? []) {
    if (resource?.kind !== "skill" || typeof resource.id !== "string") continue;
    try {
      const id = normalizeId(resource.id);
      index.skill.set(id, { kind: "skill", id, runtimes: effectiveRuntimes(resource) });
    } catch {
      // Invalid ids are reported by schema validation.
    }
  }
  for (const workflow of workflows ?? []) {
    if (typeof workflow?.id !== "string") continue;
    try {
      const id = normalizeId(workflow.id);
      index.workflow.set(id, { kind: "workflow", id, runtimes: effectiveRuntimes(workflow) });
    } catch {
      // Invalid ids are reported by workflow validation.
    }
  }
  return index;
}

export function extractAssetReferencePlaceholders(text) {
  const references = [];
  const pattern = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\.([^}]*?)\s*\}\}/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    const namespace = match[1];
    const rawId = match[2].trim();
    if (!VALID_NAMESPACES.has(namespace)) continue;
    try {
      references.push(referenceFromParts(namespace, rawId, match[0]));
    } catch {
      // Invalid placeholders are reported by extractInvalidAssetReferencePlaceholders().
    }
  }
  return references;
}

export function extractInvalidAssetReferencePlaceholders(text) {
  const invalid = [];
  const pattern = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\.([^}]*?)\s*\}\}/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    const namespace = match[1];
    const rawId = match[2].trim();
    if (VALID_NAMESPACES.has(namespace)) {
      try {
        normalizeId(rawId);
      } catch (error) {
        invalid.push({ raw: match[0], namespace, rawId, message: error.message, code: "invalid-asset-reference" });
      }
      continue;
    }
    if (UNSUPPORTED_NAMESPACES.has(namespace)) {
      invalid.push({
        raw: match[0],
        namespace,
        rawId,
        message: `Unsupported asset reference namespace "${namespace}". Use {{skills.<id>}} or {{workflows.<id>}}.`,
        code: "invalid-asset-reference"
      });
    }
  }
  return invalid;
}

export function expandAssetReferences(content, runtime, index) {
  if (typeof content !== "string" || !/\{\{\s*(skills|workflows)\./.test(content)) return content;
  return content.replace(/\{\{\s*(skills|workflows)\.([^}]+?)\s*\}\}/g, (match, namespace, rawId) => {
    const reference = referenceFromParts(namespace, rawId.trim(), match);
    const target = getAssetReference(index, reference);
    if (!target) {
      throw new Error(`Missing asset reference for ${runtime}: ${match}`);
    }
    if (!target.runtimes.includes(runtime)) {
      throw new Error(`Asset reference ${match} does not target runtime "${runtime}".`);
    }
    return assetRuntimePath(reference.kind, reference.id, runtime);
  });
}

export function getAssetReference(index, reference) {
  return index?.[reference.kind]?.get(reference.id) ?? null;
}

export function assetRuntimePath(kind, id, runtime) {
  const root = RUNTIMES[runtime]?.localRoot?.replaceAll("\\", "/") ?? `.${runtime}`;
  if (kind === "skill") return `${root}/skills/${id}/SKILL.md`;
  if (kind === "workflow") return `${root}/aof/workflows/${id}.md`;
  throw new Error(`Unsupported asset reference kind "${kind}".`);
}

export function effectiveRuntimes(item) {
  return Array.isArray(item?.runtimes) && item.runtimes.length > 0 ? item.runtimes : supportedRuntimes();
}

function referenceFromParts(namespace, rawId, raw) {
  return {
    raw,
    namespace,
    kind: namespace === "skills" ? "skill" : "workflow",
    id: normalizeId(rawId)
  };
}
