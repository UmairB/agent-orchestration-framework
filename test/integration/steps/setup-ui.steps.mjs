import assert from "node:assert/strict";
import { requestSetupUi, startSetupUi } from "../support/setup-ui-context.mjs";
import { runSharedCliStep } from "./shared-cli.steps.mjs";

export async function runStep(context, step) {
  if (step === "a running setup UI server") {
    await startSetupUi(context);
    return;
  }

  if (step === "I request setup UI capabilities") {
    await requestSetupUi(context, "GET", "/api/capabilities");
    return;
  }

  if (step === "I save command resource `prime` through the setup UI API") {
    await requestSetupUi(context, "PUT", "/api/config/resources/command/prime", {
      id: "prime",
      kind: "command",
      description: "Prime repository context",
      body: "Inspect the repository.",
      runtimes: ["codex"],
      overrides: {}
    });
    return;
  }

  if (step === "I save expanded sections through the setup UI API") {
    await requestSetupUi(context, "PUT", "/api/config/sections", {
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
    });
    return;
  }

  if (step === "I save invalid expanded sections through the setup UI API") {
    await requestSetupUi(context, "PUT", "/api/config/sections", { settings: "bad" });
    return;
  }

  if (step === "I PUT malformed JSON to `/api/config/resources/command/prime`") {
    await requestSetupUi(context, "PUT", "/api/config/resources/command/prime", "{ bad", { raw: true });
    return;
  }

  if (step === "I save a mismatched resource through the setup UI API") {
    await requestSetupUi(context, "PUT", "/api/config/resources/command/prime", {
      id: "other",
      kind: "command",
      body: "Body",
      runtimes: ["codex"]
    });
    return;
  }

  if (step === "I save an unsupported resource kind through the setup UI API") {
    await requestSetupUi(context, "PUT", "/api/config/resources/unknown/prime", {
      id: "prime",
      kind: "unknown",
      body: "Body",
      runtimes: ["codex"]
    });
    return;
  }

  if (step === "I save adapter warning sections through the setup UI API") {
    await requestSetupUi(context, "PUT", "/api/config/sections", {
      hooks: [
        { id: "notify", event: "PostToolUse", command: "npm test", timeout: 30, runtimes: ["codex"] }
      ]
    });
    return;
  }

  if (step === "I request setup UI config") {
    await requestSetupUi(context, "GET", "/api/config");
    return;
  }

  if (step === "I request setup UI project config") {
    await requestSetupUi(context, "GET", "/api/config/project");
    return;
  }

  if (step === "I request setup UI global config") {
    await requestSetupUi(context, "GET", "/api/config/global");
    return;
  }

  let match = step.match(/^I save global skill `(.+)` through the setup UI API$/);
  if (match) {
    await requestSetupUi(context, "PUT", `/api/config/global/resources/skill/${match[1]}`, {
      id: match[1],
      kind: "skill",
      description: "Global skill",
      body: "Use the helper script.",
      runtimes: ["codex"],
      overrides: {}
    });
    return;
  }

  match = step.match(/^I save global rule `(.+)` through the setup UI API$/);
  if (match) {
    await requestSetupUi(context, "PUT", `/api/config/global/resources/rule/${match[1]}`, {
      id: match[1],
      kind: "rule",
      description: "Global rule",
      body: "Follow team standards.",
      runtimes: ["codex"],
      overrides: {}
    });
    return;
  }

  match = step.match(/^I save global skill `(.+)` with helper file through the setup UI API$/);
  if (match) {
    await requestSetupUi(context, "PUT", `/api/config/global/resources/skill/${match[1]}`, {
      id: match[1],
      kind: "skill",
      description: "Global skill with helper",
      body: "Use the helper script.",
      runtimes: ["codex"],
      files: [
        { path: "search.py", body: "print('search')\n" }
      ],
      overrides: {}
    });
    return;
  }

  match = step.match(/^I save global skill `(.+)` with unsafe helper file through the setup UI API$/);
  if (match) {
    await requestSetupUi(context, "PUT", `/api/config/global/resources/skill/${match[1]}`, {
      id: match[1],
      kind: "skill",
      body: "Unsafe helper.",
      runtimes: ["codex"],
      files: [
        { path: "../escape.py", body: "bad" }
      ],
      overrides: {}
    });
    return;
  }

  match = step.match(/^I add global skill `(.+)` to the project through the setup UI API$/);
  if (match) {
    await requestSetupUi(context, "PUT", `/api/config/project/global-refs/skill/${match[1]}`);
    return;
  }

  match = step.match(/^I remove global skill `(.+)` from the project through the setup UI API$/);
  if (match) {
    await requestSetupUi(context, "DELETE", `/api/config/project/global-refs/skill/${match[1]}`);
    return;
  }

  match = step.match(/^HTTP response status should be (\d+)$/);
  if (match) {
    assertLastHttpResponse(context);
    assert.equal(context.lastHttpResponse.status, Number(match[1]), context.lastHttpResponse.text);
    return;
  }

  match = step.match(/^HTTP response field `(.+)` should equal `(.+)`$/);
  if (match) {
    assertLastHttpResponse(context);
    assert.deepEqual(valueAtPath(context.lastHttpResponse.json, match[1]), expectedValue(match[2]));
    return;
  }

  match = step.match(/^HTTP response diagnostics should include path `(.+)`$/);
  if (match) {
    assertLastHttpResponse(context);
    const diagnostics = context.lastHttpResponse.json?.diagnostics ?? context.lastHttpResponse.json?.config?.diagnostics ?? [];
    assert.ok(diagnostics.some((diagnostic) => diagnostic.path === match[1]), `Expected diagnostics to include ${match[1]}`);
    return;
  }

  match = step.match(/^HTTP response diagnostics should include code `(.+)`$/);
  if (match) {
    assertLastHttpResponse(context);
    const diagnostics = context.lastHttpResponse.json?.diagnostics ?? context.lastHttpResponse.json?.config?.diagnostics ?? [];
    assert.ok(diagnostics.some((diagnostic) => diagnostic.code === match[1]), `Expected diagnostics to include code ${match[1]}`);
    return;
  }

  await runSharedCliStep(context, step);
}

function assertLastHttpResponse(context) {
  assert.ok(context.lastHttpResponse, "Expected an HTTP response to assert against.");
}

function valueAtPath(value, pathExpression) {
  return pathExpression.split(".").reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    if (segment === "length" && Array.isArray(current)) return current.length;
    if (/^\d+$/.test(segment)) return current[Number(segment)];
    return current[segment];
  }, value);
}

function expectedValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
