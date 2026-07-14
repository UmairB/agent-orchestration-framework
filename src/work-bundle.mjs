// The ACD bundle loader (milestone 01 / story 00).
//
// ADR-001: the built-in ACD bundle is located RELATIVE TO THIS MODULE via
// `import.meta.url` — never `process.cwd()` and never a consumer config value,
// so the installed CLI finds the same bundle from any working directory.
// ADR-003: the loader presents the bundle as a standard aof `config`-shaped
// object so `renderConfigOutputs` / `createRenderPlan` consume it UNCHANGED.
// ADR-006: each member declares its target runtimes per the capability matrix.
// ADR-007: command members carry `commandNamespace: "aof"`, a declared data
// property the (general) adapter rule keys on — not a bundle branch in the engine.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashContent } from "./lock.mjs";
import { renderConfigOutputs } from "./adapters.mjs";

// ADR-005 comment-form stamp: every template-rendered file declares itself
// aof-managed in-band (the comment family, since templates carry no resource
// frontmatter of the renderer's own).
export const TEMPLATE_STAMP = "<!-- aof-generated: bundle -->";

// --- location (ADR-001) -----------------------------------------------------
// Resolved from THIS module's URL. No cwd, no config. `acd-bundle-location`
// greps this file for `process.cwd(` / config lookups on the resolution path.
export function bundleRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "bundle");
}

function descriptorPath() {
  return path.join(bundleRoot(), "bundle.json");
}

// --- descriptor -------------------------------------------------------------
export function readDescriptor() {
  return JSON.parse(readFileSync(descriptorPath(), "utf8"));
}

// Minimal YAML-frontmatter reader for the migrated member files. The bundle's
// agent/command bodies carry a single leading `---`…`---` block of `key: value`
// lines (name/description/tools for agents; description/argument-hint/
// allowed-tools for commands); the body follows.
//
// Assumption: frontmatter is single-line `key: value` only. Value-less keys and
// leading-space (indented/nested) keys are silently DROPPED — these are
// controlled bundle inputs, so the simple per-line parse is sufficient.
function splitFrontmatter(raw) {
  const text = raw.replace(/^﻿/, "");
  if (!text.startsWith("---")) return { frontmatter: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: text };
  const block = text.slice(text.indexOf("\n") + 1, end);
  const afterMarker = text.indexOf("\n", end + 1);
  const body = afterMarker === -1 ? "" : text.slice(afterMarker + 1);
  const frontmatter = {};
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const match = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (!match) continue;
    frontmatter[match[1]] = match[2].trim();
  }
  return { frontmatter, body };
}

// --- loader (ADR-003) -------------------------------------------------------
// Returns a config-shaped object: `resources[]` are the agent + command members
// (consumed by renderConfigOutputs unchanged); `templates[]` are the template
// members (rendered by renderBundleTemplateOutputs to a fixed bundle location).
export function loadBundle() {
  const root = bundleRoot();
  const descriptor = readDescriptor();
  const resources = [];
  const templates = [];

  for (const member of descriptor.members) {
    if (member.kind === "agent" || member.kind === "command" || member.kind === "skill") {
      const raw = readFileSync(path.join(root, member.file), "utf8");
      const { frontmatter, body } = splitFrontmatter(raw);
      const resource = {
        id: member.id,
        kind: member.kind,
        runtimes: member.runtimes,
        name: frontmatter.name ?? member.id,
        description: frontmatter.description ?? "",
        body
      };
      if (frontmatter.model) resource.model = frontmatter.model;
      if (member.kind === "agent" && frontmatter.tools) {
        resource.tools = frontmatter.tools.split(",").map((tool) => tool.trim()).filter(Boolean);
      }
      if (member.kind === "command" && member.commandNamespace) {
        resource.commandNamespace = member.commandNamespace;
      }
      // A skill member MAY declare `disableModelInvocation` in the descriptor: the
      // codex-* delegation skills ship with it TRUE so Claude Code never
      // auto-triggers them — gpt-5.6 is opt-in-on-request (invoke `/<name>`), the
      // deterministic default that pairs with the `work.agents.delegation` toggle.
      if (member.kind === "skill" && member.disableModelInvocation === true) {
        resource.disableModelInvocation = true;
      }
      resources.push(resource);
      continue;
    }
    if (member.kind === "template") {
      templates.push({
        id: member.id,
        kind: "template",
        dir: member.dir,
        files: readdirSync(path.join(root, member.dir)).sort()
      });
      continue;
    }
    throw new Error(`Unknown bundle member kind "${member.kind}" for "${member.id}".`);
  }

  return { resources, templates, descriptor };
}

// --- template rendering (ADR-005, comment-form stamp) -----------------------
// A template member is a directory of plain markdown docs. Each file renders to
// a fixed, project-agnostic location under the tool workspace
// (`.aof/templates/work/<member-id>/<file>`) with the comment-form stamp prepended —
// NOT under `wiki/` (which is one project's own convention, not every project's)
// and NOT a bare top-level `aof/`. The `work/` segment namespaces the work-item
// templates. Each rendered FILE contributes a manifest entry.
function templateOutputPath(member, file) {
  return [".aof", "templates", "work", member.id, file].join("/");
}

export function renderBundleTemplateOutputs(bundle, options = {}) {
  const root = bundleRoot();
  const runtimes = options.runtimes ?? null;
  // Templates are runtime-independent; emit once, tagged with the first selected
  // runtime (or "bundle") purely for manifest shape compatibility.
  const runtime = runtimes && runtimes.length > 0 ? runtimes[0] : "bundle";
  const outputs = [];
  for (const member of bundle.templates) {
    for (const file of member.files) {
      const rawBody = readFileSync(path.join(root, member.dir, file), "utf8").replace(/^﻿/, "");
      const content = `${TEMPLATE_STAMP}\n\n${rawBody}`;
      const relativePath = templateOutputPath(member, file);
      outputs.push({
        path: relativePath,
        runtime,
        resource: { id: member.id, kind: "template", file },
        content,
        body: rawBody,
        hash: hashContent(content)
      });
    }
  }
  return outputs;
}

// --- full bundle render (resources + templates) -----------------------------
// The canonical rendered set used by the manifest generator and the fitness
// functions. Resource outputs come from the UNCHANGED render engine.
export function renderBundleOutputs(bundle, options = {}) {
  const config = { resources: bundle.resources, workflows: [], packages: [] };
  const memberKinds = new Set(["agent", "command", "skill"]);
  const resourceOutputs = renderConfigOutputs(config, {
    runtimes: options.runtimes,
    targetDir: options.targetDir
  }).filter((output) => memberKinds.has(output.resource?.kind));
  const templateOutputs = renderBundleTemplateOutputs(bundle, options);
  return [...resourceOutputs, ...templateOutputs];
}

// --- per-role model override map (story 30) ---------------------------------
// The single config path a project's per-role model override lives under. Both
// the config-aware render pass (below) and the config-inspect validator read
// THIS constant, so the read/merge/validate surfaces never drift (retrospective
// R2/m06: two surfaces on the same config subtree share one accessor). The map
// is `role -> model string`; keys must be one of the 8 frozen ACD roles and are
// validated at `aof project validate` time — the render pass here is permissive
// and applies whatever role→model pairs it is handed.
export const AGENT_MODEL_MAP_PATH = "work.agents.models";

// Extract the raw per-role model override object from a project config, or an
// empty object when `work.agents.models` is absent / not a plain object. This is
// the ONE accessor both render and validation call — do not re-walk the path.
export function agentModelMap(projectConfig) {
  const map = projectConfig?.work?.agents?.models;
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  return map;
}

// --- config-aware bundle render (story 30, task 02a) ------------------------
// renderBundleOutputs is bundle-only: it ignores the project's aof.config.json,
// so the shipped default (task 01) always wins. This variant layers a project's
// `work.agents.models` per-role override ONTO the matching bundle resource's
// `.model` BEFORE the (unchanged) render engine runs, so the override — not the
// shipped default — drives the rendered `model:` line. An un-overridden role is
// passed through untouched and keeps its shipped default. A degenerate override
// equal to the default simply sets the same value, so the render still emits a
// single clean `model:` line (renderResource emits exactly one). The override
// value is rendered VERBATIM (an "inherit" or a pinned id is not reinterpreted).
export function renderBundleOutputsWithConfig(bundle, projectConfig, options = {}) {
  const overrides = agentModelMap(projectConfig);
  const resources = bundle.resources.map((resource) => {
    if (resource.kind !== "agent") return resource;
    if (!Object.prototype.hasOwnProperty.call(overrides, resource.id)) return resource;
    return { ...resource, model: overrides[resource.id] };
  });
  return renderBundleOutputs({ ...bundle, resources }, options);
}
