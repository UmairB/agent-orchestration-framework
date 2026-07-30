// Traceability wiring for milestone 09 / story 02 — rendered-faces.
//
// Covers every @executable scenario across the story's two task features against
// the REAL in-process rendering + lock/drift machinery:
//   - src/adapters.mjs renderConfigOutputs / applyConfig (renderedResource for the
//     skill; renderRuntimeConfigOutputs → claudeMcpJson/.mcp.json + codexConfigToml/
//     config.toml for the MCP entry) — ADR-005, NO new render path;
//   - src/render-plan.mjs createRenderPlan/planApplyActions/createLockManifest and
//     src/config-inspect.mjs doctorConfig's `generated-output-drift` check — the
//     existing hash/lock/drift machinery, exercised end-to-end.
//
// The faces themselves are the SHIPPED graphify face fragment authored in
// src/graph-faces.mjs (graphifyFacesConfig) — a config-SHAPED object consumed by
// renderConfigOutputs unchanged (the work-bundle.mjs idiom). Homed there, NOT in
// the frozen ACD src/bundle/ (whose membership is pinned by
// acd-bundle-membership) — see the developer return.
//
// One test object per @executable scenario; Scenario-Outline rows folded into one
// entry (asserting every row). Each name traces to feature + scenario.
//
//   00_skill-face-renders.feature
//     - Outline: the graphify skill renders into each configured runtime
//       (claude, codex)
//     - the rendered skill instructs aof graph, not graphify
//     - an edit to the rendered skill is reported as drift
//   01_mcp-face-renders.feature
//     - Outline: the graphify MCP face renders into each runtime config
//       (claude/.mcp.json, codex/config.toml)
//     - the rendered MCP face launches an aof-fronted server, not graphify's
//     - an edit to the rendered MCP config is reported as drift
//   (the live "agent reaches the graph through the MCP face" end-to-end is story
//    04's @manual — DEFERRED, not tested here.)
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { applyConfig, renderConfigOutputs } from "../src/adapters.mjs";
import { resolveConfig } from "../src/dsl.mjs";
import { doctorConfig } from "../src/config-inspect.mjs";
import { readLock, writeLock } from "../src/lock.mjs";
import {
  createLockManifest,
  createRenderPlan,
  executeApplyActions,
  planApplyActions
} from "../src/render-plan.mjs";
import { workspacePaths } from "../src/workspace.mjs";
import {
  graphifyFacesConfig,
  graphifyMcpServer,
  graphifySkillResource,
  GRAPHIFY_MCP_ID,
  GRAPHIFY_SKILL_ID
} from "../src/graph-faces.mjs";

const FACE_RUNTIMES = ["claude", "codex"];

// Build the resolved config a project gets when it adopts the shipped graphify
// faces — exactly what story 02 ships, spread into a config and resolved through
// the real DSL so renderConfigOutputs sees it unchanged.
async function resolveFacesConfig() {
  return resolveConfig({ name: "demo", ...graphifyFacesConfig() });
}

// Render the faces through the REAL renderConfigOutputs into both runtimes.
async function renderFaces(targetDir) {
  const config = await resolveFacesConfig();
  return renderConfigOutputs(config, { targetDir, runtimes: FACE_RUNTIMES });
}

function normalize(p) {
  return String(p).replaceAll(path.sep, "/").replaceAll("\\", "/");
}

// Find the rendered skill output for a runtime.
function skillOutput(outputs, runtime) {
  return outputs.find(
    (o) => o.runtime === runtime && o.resource?.kind === "skill" && o.resource?.id === GRAPHIFY_SKILL_ID
  );
}

// Find the rendered runtime-config output that carries the MCP entry:
//   claude → .mcp.json ; codex → .codex/config.toml
function mcpConfigOutput(outputs, runtime) {
  if (runtime === "claude") return outputs.find((o) => normalize(o.path).endsWith(".mcp.json"));
  return outputs.find((o) => normalize(o.path).endsWith(".codex/config.toml"));
}

// --- a real on-disk project that has the faces rendered + locked ---------------
// Writes .aof/aof.config.json with the shipped faces, renders+applies to disk, and
// writes the lock the doctor's drift check reads — the assets-apply path the real
// machinery uses (createRenderPlan → planApplyActions → executeApplyActions →
// createLockManifest → writeLock). Returns the project dir + the rendered outputs.
async function makeLockedProject() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-graph-faces-"));
  const paths = workspacePaths(targetDir);
  await mkdir(paths.workspaceDir, { recursive: true });
  await writeFile(
    paths.configPath,
    `${JSON.stringify({ name: "demo", ...graphifyFacesConfig() }, null, 2)}\n`,
    "utf8"
  );

  const config = await resolveFacesConfig();
  const desired = await createRenderPlan(config, { targetDir, runtimes: FACE_RUNTIMES });
  const actions = await planApplyActions(desired, null, { targetDir });
  await executeApplyActions(actions);
  const manifest = createLockManifest({
    actions,
    desiredOutputs: desired,
    config,
    runtimes: FACE_RUNTIMES
  });
  await writeLock(paths.lockPath, manifest);

  return { targetDir, paths, desired };
}

// The doctor's generated-output-drift check (config-inspect.mjs:271).
function driftCheck(report) {
  return report.checks.find((item) => item.id === "generated-output-drift");
}

// The drift-warning actions the doctor's check is computed from — re-run the SAME
// real machinery (createRenderPlan + planApplyActions against the on-disk lock) the
// check uses, to assert WHICH file drifted (the doctor summary only carries counts).
async function driftActionsFor(targetDir, paths) {
  const config = await resolveFacesConfig();
  const desired = await createRenderPlan(config, { targetDir, runtimes: FACE_RUNTIMES });
  const actions = await planApplyActions(desired, await readLock(paths.lockPath), { targetDir });
  return actions.filter((item) => item.action === "drift-warning");
}

export const graphRenderedFacesTests = [
  // ═══════════════════════ 00_skill-face-renders.feature ═══════════════════════

  {
    // @executable Scenario Outline: a graphify skill asset is written for runtime
    // "claude" AND "codex" — rendered by renderConfigOutputs through the existing
    // renderedResource machinery (no new render path). (both Examples rows.)
    name: "graph-faces/00 the graphify skill renders into each configured runtime (claude, codex)",
    async run() {
      const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-graph-faces-"));
      try {
        // The skill is a real shipped resource (the home decision).
        const skill = graphifySkillResource();
        assert.equal(skill.kind, "skill", "the graphify face is declared as a skill resource");
        assert.deepEqual([...skill.runtimes].sort(), [...FACE_RUNTIMES].sort());

        // Render through the REAL machinery, and also actually write to disk so the
        // "a graphify skill asset is WRITTEN for runtime <x>" assertion is literal.
        const config = await resolveFacesConfig();
        await applyConfig(config, { targetDir, runtimes: FACE_RUNTIMES });

        for (const runtime of FACE_RUNTIMES) {
          const filePath = path.join(targetDir, `.${runtime}`, "skills", GRAPHIFY_SKILL_ID, "SKILL.md");
          const body = await readFile(filePath, "utf8");
          assert.match(body, /aof-generated: true/, `${runtime}: rendered skill carries the aof stamp`);
          assert.match(body, /aof graph build/, `${runtime}: rendered skill names aof graph build`);
          assert.match(body, /aof graph build \./, `${runtime}: rendered skill builds the whole project root`);
          assert.match(body, /replaces|evicts/, `${runtime}: rendered skill warns that subset builds replace the graph`);
        }

        // And the rendered output objects exist for both runtimes (the render seam).
        const outputs = renderConfigOutputs(config, { targetDir, runtimes: FACE_RUNTIMES });
        assert.ok(skillOutput(outputs, "claude"), "a graphify skill output exists for claude");
        assert.ok(skillOutput(outputs, "codex"), "a graphify skill output exists for codex");
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    }
  },

  {
    // @executable: the rendered skill body references "aof graph build"/"query"/
    // "triage", does NOT reference the "/graphify" slash-form, and does NOT instruct
    // calling the graphify binary directly.
    name: "graph-faces/00 the rendered skill instructs aof graph, not graphify",
    async run() {
      const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-graph-faces-"));
      try {
        const outputs = await renderFaces(targetDir);
        for (const runtime of FACE_RUNTIMES) {
          const body = skillOutput(outputs, runtime).content;

          // References the three aof CLI graph verbs (the single source of truth).
          assert.ok(body.includes("aof graph build"), `${runtime}: references aof graph build`);
          assert.ok(body.includes("aof graph query"), `${runtime}: references aof graph query`);
          assert.ok(body.includes("aof graph triage"), `${runtime}: references aof graph triage`);

          // Does NOT reference graphify's binary-divergent slash-form (RESEARCH §A).
          assert.equal(
            body.includes("/graphify"),
            false,
            `${runtime}: rendered skill must NOT reference the /graphify slash-form`
          );

          // Does NOT instruct calling the graphify binary directly: no bare
          // `graphify <verb>` invocation form and none of graphify's own CLI verbs,
          // and not graphify's own MCP launch. (The body MAY name "graphify" as the
          // tool in a "do NOT call it directly" prohibition — that is the point.)
          assert.equal(
            /`graphify\s+\w/.test(body),
            false,
            `${runtime}: rendered skill must NOT show a bare graphify-binary invocation`
          );
          assert.equal(
            /graphify\s+(extract|query|path|explain|prs|watch|add)\b/.test(body),
            false,
            `${runtime}: rendered skill must NOT instruct graphify's own CLI verbs`
          );
          assert.equal(
            body.includes("python -m graphify.serve"),
            false,
            `${runtime}: rendered skill must NOT point at graphify's own MCP server`
          );
        }
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    }
  },

  {
    // @executable: with the config outputs rendered and locked, an out-of-band edit
    // to the rendered graphify skill is reported by the generated-output-drift
    // doctor check — wired against the REAL lock/drift machinery (createRenderPlan +
    // planApplyActions + doctorConfig).
    name: "graph-faces/00 an out-of-band edit to the rendered skill is reported as drift",
    async run() {
      const { targetDir, paths } = await makeLockedProject();
      try {
        // No drift before the edit (a freshly applied + locked project is clean).
        const before = driftCheck(await doctorConfig(targetDir, { runtimes: FACE_RUNTIMES }));
        assert.ok(before, "doctor surfaces a generated-output-drift check");
        assert.equal(before.severity, "ok", "a freshly applied+locked project reports no drift");

        // Edit the rendered graphify skill out of band (claude runtime).
        const skillPath = path.join(targetDir, ".claude", "skills", GRAPHIFY_SKILL_ID, "SKILL.md");
        const original = await readFile(skillPath, "utf8");
        await writeFile(skillPath, `${original}\n<!-- hand-edited out of band -->\n`, "utf8");

        // The doctor check now reports drift (a warning).
        const after = driftCheck(await doctorConfig(targetDir, { runtimes: FACE_RUNTIMES }));
        assert.equal(after.severity, "warning", "an out-of-band edit makes drift a warning");

        // And the SAME real machinery the check is computed from flags the graphify
        // skill file specifically as the drifted output (per-file granularity).
        const drifted = await driftActionsFor(targetDir, paths);
        assert.ok(
          drifted.some((a) => normalize(a.path).endsWith(`.claude/skills/${GRAPHIFY_SKILL_ID}/SKILL.md`)),
          `the graphify skill is the drifted output: ${drifted.map((a) => normalize(a.path)).join(", ")}`
        );
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    }
  },

  // ═══════════════════════ 01_mcp-face-renders.feature ═════════════════════════

  {
    // @executable Scenario Outline: the graphify MCP server appears in
    // ".mcp.json" for claude AND in "config.toml" for codex — rendered through the
    // existing renderRuntimeConfigOutputs machinery. (both Examples rows.)
    name: "graph-faces/01 the graphify MCP face renders into each runtime config (.mcp.json, config.toml)",
    async run() {
      const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-graph-faces-"));
      try {
        const server = graphifyMcpServer();
        assert.equal(server.id, GRAPHIFY_MCP_ID, "the MCP face is declared in mcpServers");
        assert.deepEqual([...server.runtimes].sort(), [...FACE_RUNTIMES].sort());

        const config = await resolveFacesConfig();
        await applyConfig(config, { targetDir, runtimes: FACE_RUNTIMES });

        // claude → .mcp.json names the graphify server.
        const claudeMcp = await readFile(path.join(targetDir, ".mcp.json"), "utf8");
        assert.match(claudeMcp, /"graphify"/, "graphify MCP server appears in .mcp.json (claude)");

        // codex → config.toml carries the [mcp_servers.graphify] table.
        const codexConfig = await readFile(path.join(targetDir, ".codex", "config.toml"), "utf8");
        assert.match(codexConfig, /\[mcp_servers\.graphify\]/, "graphify MCP server appears in config.toml (codex)");
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    }
  },

  {
    // @executable: the rendered MCP face's command/args invoke the aof graph
    // commands (the aof-fronted `aof graph serve` server, story 04), and it does
    // NOT launch "python -m graphify.serve".
    name: "graph-faces/01 the rendered MCP face launches an aof-fronted server, not graphify's",
    async run() {
      const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-graph-faces-"));
      try {
        const outputs = await renderFaces(targetDir);

        // claude .mcp.json — parse and assert the command/args launch aof graph serve.
        const claudeMcp = JSON.parse(mcpConfigOutput(outputs, "claude").content);
        const claudeEntry = claudeMcp.mcpServers.graphify;
        assert.ok(claudeEntry, "the graphify entry exists in .mcp.json");
        const claudeLaunch = [claudeEntry.command, ...(claudeEntry.args ?? [])].join(" ");
        assert.ok(
          /\baof\b/.test(claudeEntry.command) && claudeLaunch.includes("graph") && claudeLaunch.includes("serve"),
          `claude command/args launch aof graph serve — got: ${claudeLaunch}`
        );
        assert.equal(
          claudeLaunch.includes("python -m graphify.serve"),
          false,
          "claude entry must NOT launch python -m graphify.serve"
        );
        assert.equal(
          claudeEntry.command === "python" && (claudeEntry.args ?? []).join(" ").includes("graphify"),
          false,
          "claude entry must NOT launch graphify's own python server"
        );

        // codex config.toml — the rendered table launches aof graph serve too.
        const codexToml = mcpConfigOutput(outputs, "codex").content;
        assert.match(codexToml, /\[mcp_servers\.graphify\]/, "codex carries the graphify mcp table");
        assert.match(codexToml, /command = "aof"/, "codex graphify entry launches the aof CLI");
        assert.match(codexToml, /args = \["graph", "serve"\]/, "codex graphify entry args are graph serve");
        assert.equal(
          codexToml.includes("python -m graphify.serve"),
          false,
          "codex entry must NOT launch python -m graphify.serve"
        );
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    }
  },

  {
    // @executable: with the config outputs rendered and locked, an out-of-band edit
    // to the rendered graphify MCP config is reported by the generated-output-drift
    // doctor check — wired against the REAL lock/drift machinery.
    name: "graph-faces/01 an out-of-band edit to the rendered MCP config is reported as drift",
    async run() {
      const { targetDir, paths } = await makeLockedProject();
      try {
        const before = driftCheck(await doctorConfig(targetDir, { runtimes: FACE_RUNTIMES }));
        assert.equal(before.severity, "ok", "a freshly applied+locked project reports no drift");

        // Edit the rendered claude .mcp.json out of band (a hand-tweak of the entry).
        const mcpPath = path.join(targetDir, ".mcp.json");
        const parsed = JSON.parse(await readFile(mcpPath, "utf8"));
        parsed.mcpServers.graphify.args = ["graph", "serve", "--hand-edited"];
        await writeFile(mcpPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

        const after = driftCheck(await doctorConfig(targetDir, { runtimes: FACE_RUNTIMES }));
        assert.equal(after.severity, "warning", "an out-of-band edit makes drift a warning");

        // The same real machinery flags the .mcp.json (the graphify MCP config) as
        // the drifted output specifically.
        const drifted = await driftActionsFor(targetDir, paths);
        assert.ok(
          drifted.some((a) => normalize(a.path).endsWith(".mcp.json")),
          `the graphify MCP config is the drifted output: ${drifted.map((a) => normalize(a.path)).join(", ")}`
        );
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    }
  }
];
