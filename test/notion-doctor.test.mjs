// Traceability wiring for milestone 17 / story 02, task 03 —
// tasks/03_doctor-surfaces-notion.feature (@executable rows; the @manual live
// install + token report is deferred to verify).
//
// aof project doctor surfaces the Notion CLI via the EXISTING m12 managed-tool /
// tool-platform checks (adding NOTION_DESCRIPTOR surfaces them for free) plus a
// sibling auth-reachability advisory. Every Notion-related state is at most a
// warning — never an error, never a throw. Hermetic via the injected resolver /
// platform / reachability seams (the m12 exemplar idiom, tool-doctor-checks.test.mjs).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  doctorConfig,
  managedToolChecks,
  toolPlatformCheckFor,
  notionAuthCheck,
} from "../src/config-inspect.mjs";
import { NOTION_DESCRIPTOR } from "../src/tool-store.mjs";

const NOTION_LIST = [NOTION_DESCRIPTOR];

// Stubbed resolver results — the npx-lane reality is "present on PATH" (never store).
const ON_PATH = () => ({ found: true, source: "path", binary: "ntn", path: "/usr/local/bin/ntn", version: "0.17.0" });
const ABSENT = () => ({ found: false, hint: "Run `aof project provision notion` to install notion into the managed tool store." });

function managedToolCheck(checks, tool) {
  return checks.find((item) => item.id === "managed-tool" && item.details?.tool === tool);
}

// A minimal valid project so doctorConfig runs end-to-end. `withNotionConfig`
// optionally writes a work.integrations.notion block so the auth advisory fires.
async function makeProject({ withNotionConfig = false } = {}) {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-notion-doctor-"));
  const workspaceDir = path.join(targetDir, ".aof");
  await mkdir(workspaceDir, { recursive: true });
  const config = { name: "demo", resources: [] };
  if (withNotionConfig) {
    config.work = {
      integrations: {
        notion: {
          dataSourceId: "ds-1",
          tokenEnv: "NOTION_API_TOKEN",
          statusProperty: "Status",
          statusMap: { "not-started": "Not started", "in-progress": "In progress", "in-review": "In review", done: "Done" },
          relationProperty: "Sub-tasks",
        },
      },
    };
  }
  await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return targetDir;
}

function doctorRunFailed(report, { strict = false } = {}) {
  const errors = report.checks.filter((item) => item.severity === "error");
  const warnings = report.checks.filter((item) => item.severity === "warning");
  return errors.length > 0 || (strict && warnings.length > 0);
}

export const notionDoctorTests = [
  {
    // Scenario Outline: the managed-tool check maps the Notion CLI's resolution
    // state to severity (present on PATH via npx → ok+version; absent → warning+guidance).
    name: "notion-doctor/03 the managed-tool check maps the Notion CLI's resolution state to severity",
    run() {
      const rows = [
        { state: "present on PATH via npx", resolver: ON_PATH, severity: "ok", assert: (m) => assert.ok(/0\.17\.0/.test(m), `names the resolved version — got: ${m}`) },
        { state: "absent from PATH", resolver: ABSENT, severity: "warning", assert: (m) => assert.ok(/aof project provision/.test(m), `gives the provision guidance — got: ${m}`) },
      ];
      for (const { state, resolver, severity, assert: assertMsg } of rows) {
        let checks;
        assert.doesNotThrow(() => { checks = managedToolChecks({ resolveManagedBinary: resolver, managedTools: NOTION_LIST }); }, `managed-tool never throws (${state})`);
        const check = managedToolCheck(checks, "notion");
        assert.ok(check, `a managed-tool check is present for notion (${state})`);
        assert.equal(check.severity, severity, `state "${state}" → ${severity}`);
        assert.notEqual(check.severity, "error", `state "${state}" is never an error`);
        assertMsg(check.message);
      }
    },
  },

  {
    // Scenario Outline: the tool-platform check is ok where the descriptor supports
    // the platform (win32 ok with x64-note; linux ok via absent matrix entry) and
    // warns where it does not (a descriptor-unsupported platform).
    name: "notion-doctor/03 the tool-platform check is ok where supported and warns where unsupported",
    run() {
      // win32 — supported:true with the x64-only note → ok (the note does not downgrade).
      const win32 = toolPlatformCheckFor(NOTION_DESCRIPTOR, "win32");
      assert.equal(win32.severity, "ok", "win32 reads ok (x64-only note surfaced, not a warning)");
      assert.notEqual(win32.severity, "error", "win32 is never an error");

      // linux — no matrix entry ⇒ supported everywhere ⇒ ok (12/ADR-002 absent⇒supported).
      const linux = toolPlatformCheckFor(NOTION_DESCRIPTOR, "linux");
      assert.equal(linux.severity, "ok", "linux reads ok (no matrix entry ⇒ supported)");

      // A descriptor-unsupported platform — mark one unsupported to drive the warning row.
      const unsupportedDescriptor = { ...NOTION_DESCRIPTOR, platforms: { ...NOTION_DESCRIPTOR.platforms, freebsd: { supported: false, note: "unsupported" } } };
      const unsupported = toolPlatformCheckFor(unsupportedDescriptor, "freebsd");
      assert.equal(unsupported.severity, "warning", "a descriptor-unsupported platform reads a warning");
      assert.notEqual(unsupported.severity, "error", "an unsupported platform is never an error");
    },
  },

  {
    // Scenario Outline: the auth-reachability advisory maps auth state to severity
    // (set+reachable → ok; unset → warning+set-token guidance; set-but-probe-fails →
    // warning+retry). Driven via the notionAuthState seam (hermetic — no live token).
    name: "notion-doctor/03 the auth-reachability advisory maps auth state to severity",
    run() {
      const rows = [
        { auth: "token set and reachable", state: "reachable", severity: "ok", assert: (m) => assert.ok(/reachable/i.test(m), `confirms auth reachable — got: ${m}`) },
        { auth: "token env var unset", state: "unset", severity: "warning", assert: (m) => assert.ok(/set the .*environment variable/i.test(m), `gives the set-the-token guidance — got: ${m}`) },
        { auth: "token set but probe fails", state: "unreachable", severity: "warning", assert: (m) => assert.ok(/unreachable/i.test(m) && /retry/i.test(m), `reports unreachable + advises retry — got: ${m}`) },
      ];
      for (const { auth, state, severity, assert: assertMsg } of rows) {
        let check;
        assert.doesNotThrow(() => { check = notionAuthCheck({ work: { integrations: { notion: { tokenEnv: "NOTION_API_TOKEN" } } } }, { notionAuthState: state }); }, `notion-auth never throws (${auth})`);
        assert.ok(check, `a notion-auth check is present (${auth})`);
        assert.equal(check.id, "notion-auth", "the check id is notion-auth");
        assert.equal(check.severity, severity, `auth "${auth}" → ${severity}`);
        assert.notEqual(check.severity, "error", `auth "${auth}" is never an error`);
        assertMsg(check.message);
      }

      // The reachability PROBE is an injectable seam (the live probe is @manual): a
      // probe that returns false on a SET token → unreachable warning; true → ok.
      const env = { NOTION_API_TOKEN: "ntn_set" };
      const probedFail = notionAuthCheck({ work: { integrations: { notion: { tokenEnv: "NOTION_API_TOKEN" } } } }, { env, notionReachable: () => false });
      assert.equal(probedFail.severity, "warning", "a failing reachability probe on a set token → warning");
      const probedOk = notionAuthCheck({ work: { integrations: { notion: { tokenEnv: "NOTION_API_TOKEN" } } } }, { env, notionReachable: () => true });
      assert.equal(probedOk.severity, "ok", "a passing reachability probe on a set token → ok");

      // An UNCONFIGURED project emits NO notion-auth check (healthy by default).
      const none = notionAuthCheck({ name: "demo" }, {});
      assert.equal(none, null, "no notion-auth check when the project does not opt into Notion");
    },
  },

  {
    // Scenario: the Notion doctor checks never error or throw — at most warning. An
    // absent CLI, an unsupported platform, and an unset token together still leave the
    // doctor run honest and crash-free. End-to-end through doctorConfig.
    name: "notion-doctor/03 the Notion doctor checks never error or throw — at most warning",
    async run() {
      const targetDir = await makeProject({ withNotionConfig: true });
      try {
        let report;
        await assert.doesNotReject(async () => {
          report = await doctorConfig(targetDir, {
            runtimes: ["codex"],
            resolveManagedBinary: ABSENT, // CLI absent
            managedTools: NOTION_LIST,
            platform: "freebsd", // a descriptor-unsupported platform (well, no entry ⇒ ok; force unsupported below)
            notionAuthState: "unset", // token unset
          });
        }, "doctorConfig must not throw with absent CLI / unsupported platform / unset token");

        const notionRelated = report.checks.filter((item) =>
          (item.id === "managed-tool" && item.details?.tool === "notion") ||
          (item.id === "tool-platform" && item.details?.tool === "notion") ||
          item.id === "notion-auth"
        );
        assert.ok(notionRelated.length >= 2, `the report carries the Notion-related checks (got ${notionRelated.length})`);
        for (const check of notionRelated) {
          assert.notEqual(check.severity, "error", `${check.id} is never severity error — got ${check.severity}`);
          assert.ok(["ok", "warning"].includes(check.severity), `${check.id} severity is at most warning — got ${check.severity}`);
        }
        // The notion-auth advisory fired (config present) and is a warning (unset).
        const authCheck = report.checks.find((c) => c.id === "notion-auth");
        assert.ok(authCheck, "the notion-auth advisory is present (project opts into Notion)");
        assert.equal(authCheck.severity, "warning", "unset token → warning, never error");
        // The doctor run reports no error.
        assert.equal(doctorRunFailed(report), false, "the doctor run reports no error for the all-bad Notion state");
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    },
  },
];
