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
