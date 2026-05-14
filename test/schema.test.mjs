import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RESOURCE_KINDS,
  WORKFLOW_KIND,
  supportedGlobalRefKinds,
  supportedHookEvents,
  supportedHookTypes,
  supportedMcpTransports,
  supportedProjectDocTargets,
  supportedResourceKinds,
  supportedRuntimes,
  supportedTrustModes
} from "../src/model.mjs";

export const schemaTests = [
  {
    name: "schema runtime and resource enums align with model",
    run: schemaEnumsAlignWithModel
  },
  {
    name: "schema keeps high-value config fields aligned",
    run: schemaFieldsAlign
  }
];

async function loadSchema() {
  return JSON.parse(await readFile(new URL("../schemas/aof.schema.json", import.meta.url), "utf8"));
}

async function schemaEnumsAlignWithModel() {
  const schema = await loadSchema();
  const resource = schema.$defs.resource;
  assert.deepEqual(resource.properties.kind.enum.sort(), supportedResourceKinds().sort());
  assert.deepEqual(resource.properties.runtimes.items.enum.sort(), supportedRuntimes().sort());
  assert.deepEqual(schema.properties.runtimes.items.enum.sort(), supportedRuntimes().sort());
  assert.deepEqual(schema.properties.packages.items.properties.runtimes.items.enum.sort(), supportedRuntimes().sort());
  assert.deepEqual(Object.keys(resource.properties.overrides.properties).sort(), supportedRuntimes().sort());
  assert.deepEqual(schema.$defs.mcpServer.properties.transport.enum.sort(), supportedMcpTransports().sort());
  assert.deepEqual(schema.$defs.hook.properties.event.enum.sort(), supportedHookEvents().sort());
  assert.deepEqual(schema.$defs.hook.properties.type.enum.sort(), supportedHookTypes().sort());
  assert.deepEqual(schema.$defs.projectDoc.properties.targets.items.enum.sort(), supportedProjectDocTargets().sort());
  assert.deepEqual(schema.$defs.settings.properties.trust.enum.sort(), supportedTrustModes().sort());
}

async function schemaFieldsAlign() {
  const schema = await loadSchema();
  const resource = schema.$defs.resource;
  for (const field of ["resources", "workflows", "globalRefs", "packages", "mcpServers", "hooks", "projectDocs", "settings", "items", "runtimes"]) {
    assert.ok(schema.properties[field], `Missing config field ${field}`);
  }
  assert.deepEqual(schema.$defs.globalRef.properties.kind.enum.sort(), supportedGlobalRefKinds().sort());
  assert.equal(schema.$defs.workflow.properties.path.type, "string");
  assert.equal(WORKFLOW_KIND.defaultBodyFile, "WORKFLOW.md");
  for (const field of ["kind", "id", "name", "description", "body", "prompt", "instructions", "path", "model", "tools", "paths", "workflow", "argumentHint", "arguments", "argumentOverrides", "files", "overrides"]) {
    assert.ok(resource.properties[field], `Missing resource field ${field}`);
  }
  for (const kind of supportedResourceKinds()) {
    assert.ok(RESOURCE_KINDS[kind].defaultBodyFile, `Missing default body file for ${kind}`);
  }
  assert.equal(resource.additionalProperties, true);
  assert.equal(schema.properties.packages.items.additionalProperties, true);
  assert.equal(schema.$defs.runtimeOverride.oneOf[1].additionalProperties, true);
}
