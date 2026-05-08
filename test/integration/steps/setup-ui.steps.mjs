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

  let match = step.match(/^HTTP response status should be (\d+)$/);
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

  await runSharedCliStep(context, step);
}

function assertLastHttpResponse(context) {
  assert.ok(context.lastHttpResponse, "Expected an HTTP response to assert against.");
}

function valueAtPath(value, pathExpression) {
  return pathExpression.split(".").reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
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
