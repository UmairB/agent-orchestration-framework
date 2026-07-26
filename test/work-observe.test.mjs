// Milestone observability engine — unit tests over the pure transcript analysers.
// No aof config / global-home touched: this exercises analyzeTranscript / unionMs /
// projectSlug / resolveMilestoneFolder against fixtures + a temp dir only.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzeTranscript,
  unionMs,
  projectSlug,
  claudeProjectsDir,
  resolveMilestoneFolder,
  observeMilestone,
  observabilityEnabled,
} from "../src/work-observe.mjs";

const T0 = Date.parse("2026-07-19T01:00:00.000Z");
const iso = (offsetMs) => new Date(T0 + offsetMs).toISOString();

// A fixture transcript: 3 assistant turns then an 8h idle gap before a final turn.
function fixtureTranscript() {
  const min = 60 * 1000;
  const hr = 60 * min;
  const lines = [
    { type: "user", timestamp: iso(0), message: { role: "user", content: "You are the researcher for milestone 346 ..." } },
    {
      type: "assistant",
      timestamp: iso(1 * min),
      message: { model: "claude-opus-4-8", content: [{ type: "text", text: "working" }], usage: { output_tokens: 100, input_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } },
    },
    {
      type: "assistant",
      timestamp: iso(3 * min),
      message: { model: "claude-opus-4-8", content: [{ type: "tool_use", name: "Bash", input: {} }], usage: { output_tokens: 50, input_tokens: 2, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 } },
    },
    { type: "user", timestamp: iso(3 * min + 10 * 1000), message: { content: [{ type: "tool_result", content: "ok" }] } },
    // 8h idle gap here (machine off) — a stall
    {
      type: "assistant",
      timestamp: iso(3 * min + 10 * 1000 + 8 * hr),
      message: { model: "claude-opus-4-8", content: [{ type: "text", text: "done" }], usage: { output_tokens: 30, input_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } },
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

test("analyzeTranscript sums tokens, counts turns, and isolates the stall", () => {
  const a = analyzeTranscript(fixtureTranscript());
  assert.equal(a.turns, 3, "three assistant turns");
  assert.equal(a.tokens.out, 180, "output tokens summed (100+50+30)");
  assert.equal(a.tokens.cacheRead, 1600);
  assert.equal(a.tools.Bash, 1);
  assert.equal(a.stalls.length, 1, "one stall detected");
  assert.equal(a.stalls[0].gapMs, 8 * 60 * 60 * 1000, "stall is 8h");
  assert.match(a.stalls[0].before, /tool_result/);
  // wall-clock ~= 8h + 3m10s; active = wall minus the 8h stall (~3m10s)
  assert.ok(a.stalledMs === 8 * 60 * 60 * 1000);
  assert.ok(a.activeMs < 5 * 60 * 1000, `active work is a few minutes, got ${a.activeMs}ms`);
  assert.ok(a.durationMs > 8 * 60 * 60 * 1000);
});

test("analyzeTranscript with no stall reports zero stalled time and one active interval", () => {
  const a = analyzeTranscript(fixtureTranscript(), { stallMs: 9 * 60 * 60 * 1000 });
  assert.equal(a.stalls.length, 0);
  assert.equal(a.stalledMs, 0);
  assert.equal(a.activeIntervals.length, 1);
});

test("unionMs counts overlapping (parallel) intervals once", () => {
  // Two agents that ran concurrently 0–10 and 5–15 => union is 0–15 = 15, not 20.
  assert.equal(unionMs([[0, 10], [5, 15]]), 15);
  // Disjoint intervals add up.
  assert.equal(unionMs([[0, 10], [20, 25]]), 15);
  assert.equal(unionMs([]), 0);
});

test("projectSlug matches Claude Code's cwd slugification", () => {
  assert.equal(projectSlug("C:\\Source\\voice-vox\\voice-vox-web"), "C--Source-voice-vox-voice-vox-web");
  assert.equal(projectSlug("c:\\Source\\umair\\aof"), "c--Source-umair-aof");
});

test("claudeProjectsDir honours CLAUDE_CONFIG_DIR override", () => {
  const dir = claudeProjectsDir({ cwd: "c:\\Source\\umair\\aof", env: { CLAUDE_CONFIG_DIR: "/custom/cc" } });
  assert.equal(dir, path.join("/custom/cc", "projects", "c--Source-umair-aof"));
});

test("resolveMilestoneFolder matches by numeric id, exact name, and substring", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "aof-obs-"));
  try {
    await mkdir(path.join(cwd, "wiki", "work", "346_milestone_google-federated-oauth-cutover"), { recursive: true });
    await mkdir(path.join(cwd, "wiki", "work", "07_milestone_other"), { recursive: true });
    assert.deepEqual(await resolveMilestoneFolder({ cwd, ref: "346" }), {
      folder: "346_milestone_google-federated-oauth-cutover",
      id: "346",
    });
    assert.equal((await resolveMilestoneFolder({ cwd, ref: "7" })).folder, "07_milestone_other");
    assert.equal((await resolveMilestoneFolder({ cwd, ref: "google-federated" })).folder, "346_milestone_google-federated-oauth-cutover");
    assert.equal(await resolveMilestoneFolder({ cwd, ref: "999" }), null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("observeMilestone writes report.md + agents.json when --write and matches agents by id", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "aof-obs-"));
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-home-"));
  try {
    await mkdir(path.join(cwd, "wiki", "work", "346_milestone_x"), { recursive: true });
    // Lay down a fake Claude Code transcript store for this cwd.
    const slug = projectSlug(cwd);
    const subDir = path.join(home, ".claude", "projects", slug, "sess-1", "subagents");
    await mkdir(subDir, { recursive: true });
    await writeFile(path.join(subDir, "agent-abc.meta.json"), JSON.stringify({ agentType: "aof-researcher", description: "Author RESEARCH.md for 346" }));
    await writeFile(path.join(subDir, "agent-abc.jsonl"), fixtureTranscript());
    // An unrelated agent that must NOT be attributed to milestone 346.
    await writeFile(path.join(subDir, "agent-zzz.meta.json"), JSON.stringify({ agentType: "aof-qa", description: "Author 999 contracts" }));
    await writeFile(path.join(subDir, "agent-zzz.jsonl"), fixtureTranscript().replace("346", "999"));

    const res = await observeMilestone({ cwd, ref: "346", home, env: {}, generatedAt: T0, write: true });
    assert.equal(res.found, true);
    assert.equal(res.agents.length, 1, "only the milestone-346 agent is attributed");
    assert.equal(res.agents[0].agentType, "aof-researcher");
    assert.equal(res.json.summary.stalledAgents, 1);

    const report = await readFile(res.written.reportPath, "utf8");
    assert.match(report, /Observability — milestone 346/);
    assert.match(report, /agent\(s\) stalled/);
    const parsed = JSON.parse(await readFile(res.written.jsonPath, "utf8"));
    assert.equal(parsed.milestone, "346");
    assert.equal(parsed.agents[0].tokens.out, 180);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("observabilityEnabled reads the opt-in flag, default off", () => {
  assert.equal(observabilityEnabled(undefined), false);
  assert.equal(observabilityEnabled({ work: {} }), false);
  assert.equal(observabilityEnabled({ work: { observability: { enabled: true } } }), true);
});

// A programmatic fix-test-rerun fixture: `cycles` of [edit router.ts → run the same
// vitest suite (result 30s later, first ones failing)], to exercise the diagnostics.
function fixtureGrind(cycles = 6) {
  const sec = 1000;
  const lines = [{ type: "user", timestamp: iso(0), message: { role: "user", content: "Build story 346/01 ..." } }];
  let t = 5 * sec;
  for (let i = 0; i < cycles; i++) {
    const eid = `e${i}`;
    const tid = `t${i}`;
    lines.push({ type: "assistant", timestamp: iso(t), message: { model: "claude-sonnet-5", content: [{ type: "tool_use", id: eid, name: "Edit", input: { file_path: "c:/app/src/interactions/router.ts" } }], usage: { output_tokens: 200 } } });
    lines.push({ type: "user", timestamp: iso(t + 2 * sec), message: { content: [{ type: "tool_result", tool_use_id: eid, content: "ok" }] } });
    t += 20 * sec;
    lines.push({ type: "assistant", timestamp: iso(t), message: { model: "claude-sonnet-5", content: [{ type: "tool_use", id: tid, name: "Bash", input: { command: 'cd "c:/app" && npx vitest run tests/bdd/federation.spec.ts' } }], usage: { output_tokens: 50 } } });
    const failed = i < cycles - 1;
    lines.push({ type: "user", timestamp: iso(t + 30 * sec), message: { content: [{ type: "tool_result", tool_use_id: tid, is_error: failed, content: failed ? "1 test failed" : "all pass" }] } });
    t += 40 * sec;
  }
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

test("diagnostics: toolchain wait, thrash, interleave rhythm, and errors are computed", () => {
  const { diagnostics: d } = analyzeTranscript(fixtureGrind(6));
  assert.equal(d.toolchain.runs, 6, "six toolchain runs classified");
  assert.ok(d.toolchain.totalMs >= 6 * 30 * 1000, "toolchain wait ~= 6×30s");
  assert.equal(d.interleave.testRuns, 6);
  assert.equal(d.interleave.editActions, 6);
  assert.equal(d.interleave.editsPerTest, 1);
  assert.match(d.interleave.pattern, /tight fix-test loop/);
  assert.equal(d.hotFiles.edited[0].file, "src/interactions/router.ts");
  assert.equal(d.hotFiles.edited[0].count, 6);
  assert.equal(d.repeatedCommands[0].count, 6, "the same vitest suite re-run 6×");
  assert.equal(d.errors.toolErrors, 5, "five failing runs before the green one");
  assert.ok(d.toolMs > 0 && d.modelMs >= 0);
});

test("diagnostics: a toolchain command classifies as a test run; a plain command does not", () => {
  const mk = (cmd) => JSON.stringify({ type: "assistant", timestamp: iso(0), message: { content: [{ type: "tool_use", id: "x", name: "Bash", input: { command: cmd } }], usage: { output_tokens: 1 } } }) + "\n";
  assert.equal(analyzeTranscript(mk('cd "x" && yarn workspace @app/identity typecheck')).diagnostics.toolchain.runs, 1);
  assert.equal(analyzeTranscript(mk('cd "x" && npx vitest run foo.spec.ts')).diagnostics.toolchain.runs, 1);
  assert.equal(analyzeTranscript(mk('git status')).diagnostics.toolchain.runs, 0);
  assert.equal(analyzeTranscript(mk('grep -n foo bar.ts')).diagnostics.toolchain.runs, 0);
});

test("diagnostics: write-first pattern when tests run rarely", () => {
  const { diagnostics: d } = analyzeTranscript(fixtureGrind(1));
  assert.match(d.interleave.pattern, /write-first/);
});
