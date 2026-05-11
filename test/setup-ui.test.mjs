import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveSetupUi } from "../src/setup-ui.mjs";

export const setupUiTests = [
  {
    name: "setup UI exposes capabilities and saves config resources",
    run: savesConfigResourceThroughApi
  },
  {
    name: "setup UI rejects malformed JSON and route mismatches",
    run: rejectsMalformedJsonAndRouteMismatch
  },
  {
    name: "setup UI saves and validates expanded config sections",
    run: savesAndValidatesExpandedSections
  },
  {
    name: "setup UI saves global resources and associated files",
    run: savesGlobalResourcesAndAssociatedFiles
  },
  {
    name: "setup UI manages project global references",
    run: managesProjectGlobalReferences
  },
  {
    name: "setup UI serves adapter warning review payload",
    run: servesAdapterWarningPayload
  },
  {
    name: "setup UI hardens catalog endpoint validation",
    run: hardensCatalogEndpointValidation
  },
  {
    name: "setup UI rejects oversized request bodies",
    run: rejectsOversizedBodies
  },
  {
    name: "setup UI keeps static paths inside ui root",
    run: keepsStaticPathsInsideUiRoot
  }
];

async function savesConfigResourceThroughApi() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const catalog = {
    listItems: () => [],
    upsertItem: () => {}
  };
  const { server, url } = await serveSetupUi(catalog, { port: 0, projectDir: targetDir });
  try {
    const capabilities = await fetchJson(`${url}api/capabilities`);
    assert.equal(capabilities.capabilities.rule.codex, "mapped");

    const save = await fetchJson(`${url}api/config/resources/command/prime`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "prime",
        kind: "command",
        description: "Prime repository context",
        body: "Inspect the repository.",
        runtimes: ["codex"],
        overrides: {}
      })
    });
    assert.equal(save.ok, true);

    const config = JSON.parse(await readFile(path.join(targetDir, ".aof", "aof.config.json"), "utf8"));
    assert.equal(config.resources[0].kind, "command");
    assert.equal(config.resources[0].path, "assets/commands/prime/COMMAND.md");
  } finally {
    server.close();
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function servesAdapterWarningPayload() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const catalog = {
    listItems: () => [],
    upsertItem: () => {}
  };
  const { server, url } = await serveSetupUi(catalog, { port: 0, projectDir: targetDir });
  try {
    const save = await fetchJson(`${url}api/config/sections`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hooks: [
          { id: "notify", event: "PostToolUse", command: "npm test", timeout: 30, runtimes: ["codex"] }
        ]
      })
    });
    assert.equal(save.config.adapterWarnings.length, 1);
    assert.equal(save.config.adapterWarnings[0].code, "adapter.skipped-runtime-output");

    const payload = await fetchJson(`${url}api/config`);
    assert.equal(payload.adapterWarnings.length, 1);
    assert.equal(payload.adapterWarnings[0].runtime, "codex");
  } finally {
    server.close();
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rejectsMalformedJsonAndRouteMismatch() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const catalog = {
    listItems: () => [],
    upsertItem: () => {}
  };
  const { server, url } = await serveSetupUi(catalog, { port: 0, projectDir: targetDir });
  try {
    let response = await fetch(`${url}api/config/resources/command/prime`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{ bad"
    });
    let payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "malformed-json");

    response = await fetch(`${url}api/config/resources/command/prime`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "other", kind: "command", body: "Body", runtimes: ["codex"] })
    });
    payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.code, "route-payload-mismatch");

    response = await fetch(`${url}api/config/resources/unknown/prime`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "prime", kind: "unknown", body: "Body", runtimes: ["codex"] })
    });
    payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.code, "invalid-kind");
  } finally {
    server.close();
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function savesAndValidatesExpandedSections() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const catalog = {
    listItems: () => [],
    upsertItem: () => {}
  };
  const { server, url } = await serveSetupUi(catalog, { port: 0, projectDir: targetDir });
  try {
    let response = await fetch(`${url}api/config/sections`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: "bad" })
    });
    let payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.ok(payload.diagnostics.some((item) => item.path === "settings"));

    response = await fetch(`${url}api/config/sections`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mcpServers: [
          { id: "docs", transport: "http", url: "https://example.test/mcp", runtimes: ["codex"] }
        ],
        hooks: [
          { id: "test-after-write", event: "PostToolUse", command: "npm test", runtimes: ["codex"] }
        ],
        projectDocs: [
          { id: "root", body: "Guidance", targets: ["AGENTS.md"], runtimes: ["codex"] }
        ],
        settings: {
          codex: { approval_policy: "on-request" }
        }
      })
    });
    payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);

    const config = JSON.parse(await readFile(path.join(targetDir, ".aof", "aof.config.json"), "utf8"));
    assert.equal(config.mcpServers[0].id, "docs");
    assert.equal(config.settings.codex.approval_policy, "on-request");
  } finally {
    server.close();
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function savesGlobalResourcesAndAssociatedFiles() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const globalDir = await mkdtemp(path.join(os.tmpdir(), "aof-global-"));
  const catalog = {
    listItems: () => [],
    upsertItem: () => {}
  };
  const { server, url } = await serveSetupUi(catalog, { port: 0, projectDir: targetDir, env: { AOF_GLOBAL_HOME: globalDir } });
  try {
    const emptyGlobal = await fetchJson(`${url}api/config/global`);
    assert.equal(emptyGlobal.scope, "global");
    assert.equal(emptyGlobal.configPath, path.join(globalDir, "aof.config.json"));

    const save = await fetchJson(`${url}api/config/global/resources/skill/research-helper`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "research-helper",
        kind: "skill",
        description: "Research helper",
        body: "Use the helper script.",
        runtimes: ["codex"],
        files: [
          { path: "search.py", body: "print('search')\n" }
        ],
        overrides: {}
      })
    });
    assert.equal(save.ok, true);
    assert.equal(save.config.scope, "global");

    const config = JSON.parse(await readFile(path.join(globalDir, "aof.config.json"), "utf8"));
    assert.equal(config.resources[0].kind, "skill");
    assert.deepEqual(config.resources[0].files, ["search.py"]);
    assert.match(await readFile(path.join(globalDir, "assets", "skills", "research-helper", "files", "search.py"), "utf8"), /print\('search'\)/);

    const unsafeResponse = await fetch(`${url}api/config/global/resources/skill/unsafe`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "unsafe",
        kind: "skill",
        body: "Unsafe",
        runtimes: ["codex"],
        files: [
          { path: "../escape.py", body: "bad" }
        ]
      })
    });
    const unsafe = await unsafeResponse.json();
    assert.equal(unsafeResponse.status, 400);
    assert.ok(unsafe.diagnostics.some((item) => item.code === "associated-file-escape"));

    const commandSave = await fetchJson(`${url}api/config/project/resources/command/prime`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "prime",
        kind: "command",
        body: "Run the helper.",
        runtimes: ["codex"],
        files: [
          { name: "helper.py", body: "print('prime')\n" }
        ],
        overrides: {}
      })
    });
    assert.equal(commandSave.ok, true);
    const projectConfig = JSON.parse(await readFile(path.join(targetDir, ".aof", "aof.config.json"), "utf8"));
    assert.deepEqual(projectConfig.resources[0].files, ["helper.py"]);
    assert.match(await readFile(path.join(targetDir, ".aof", "assets", "commands", "prime", "files", "helper.py"), "utf8"), /print\('prime'\)/);
  } finally {
    server.close();
    await rm(targetDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
}

async function managesProjectGlobalReferences() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const globalDir = await mkdtemp(path.join(os.tmpdir(), "aof-global-"));
  const catalog = {
    listItems: () => [],
    upsertItem: () => {}
  };
  const { server, url } = await serveSetupUi(catalog, { port: 0, projectDir: targetDir, env: { AOF_GLOBAL_HOME: globalDir } });
  try {
    await fetchJson(`${url}api/config/global/resources/skill/shared-review`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "shared-review",
        kind: "skill",
        description: "Shared review",
        body: "Review shared guidance.",
        runtimes: ["codex"],
        overrides: {}
      })
    });

    const add = await fetchJson(`${url}api/config/project/global-refs/skill/shared-review`, { method: "PUT" });
    assert.equal(add.ok, true);
    assert.deepEqual(add.globalRefs, [{ kind: "skill", id: "shared-review" }]);

    const projectConfig = JSON.parse(await readFile(path.join(targetDir, ".aof", "aof.config.json"), "utf8"));
    assert.deepEqual(projectConfig.globalRefs, [{ kind: "skill", id: "shared-review" }]);
    await assert.rejects(readFile(path.join(targetDir, ".aof", "assets", "skills", "shared-review", "SKILL.md"), "utf8"));

    const projectPayload = await fetchJson(`${url}api/config/project`);
    assert.equal(projectPayload.referencedResources[0].source, "global");
    assert.equal(projectPayload.referencedResources[0].readOnly, true);

    const globalPayload = await fetchJson(`${url}api/config/global`);
    assert.equal(globalPayload.resources[0].referencedByProject, true);

    const remove = await fetchJson(`${url}api/config/project/global-refs/skill/shared-review`, { method: "DELETE" });
    assert.equal(remove.ok, true);
    assert.deepEqual(remove.globalRefs, []);
  } finally {
    server.close();
    await rm(targetDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
}

async function hardensCatalogEndpointValidation() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const saved = [];
  const catalog = {
    listItems: () => saved,
    upsertItem: (item) => saved.push(item)
  };
  const { server, url } = await serveSetupUi(catalog, { port: 0, projectDir: targetDir });
  try {
    let response = await fetch(`${url}api/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x", kind: "command" })
    });
    let payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.code, "validation-failed");
    assert.ok(payload.diagnostics.some((item) => item.path === "kind"));

    response = await fetch(`${url}api/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "helper", kind: "skill", name: "Helper", body: "Body", runtimes: ["codex"] })
    });
    payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(saved[0].id, "helper");
  } finally {
    server.close();
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rejectsOversizedBodies() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const catalog = {
    listItems: () => [],
    upsertItem: () => {}
  };
  const { server, url } = await serveSetupUi(catalog, { port: 0, projectDir: targetDir });
  try {
    const response = await fetch(`${url}api/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x", kind: "skill", body: "x".repeat(1_000_001) })
    });
    const payload = await response.json();
    assert.equal(response.status, 413);
    assert.equal(payload.code, "payload-too-large");
  } finally {
    server.close();
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function keepsStaticPathsInsideUiRoot() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const catalog = {
    listItems: () => [],
    upsertItem: () => {}
  };
  const { server, url } = await serveSetupUi(catalog, { port: 0, projectDir: targetDir });
  try {
    let response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /root/);

    response = await fetch(`${url}%2e%2e%5cpackage.json`);
    assert.equal(response.status, 404);

    response = await fetch(`${url}%E0%A4%A`);
    assert.equal(response.status, 404);

    response = await fetch(`${url}missing-file.js`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(payload));
  }
  return payload;
}
