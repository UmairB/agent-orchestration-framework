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
  mergeIntervals,
  overlapMs,
  projectSlug,
  claudeProjectsDir,
  resolveMilestoneFolder,
  observeMilestone,
  observabilityEnabled,
  analyzeSessionThread,
  clusterInfraKills,
  humanTurnText,
  analyzeWaves,
  tokenSplit,
  agentMatchesMilestone,
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

test("observabilityEnabled defaults ON, and false is the explicit opt-out", () => {
  // Inverted 2026-08-07 (operator). It shipped opt-in and so never ran once: the
  // 348 post-mortem had to be reconstructed by hand because no milestone in the repo
  // had ever written an observability/ snapshot. A diagnostic that is off by default
  // is one you enable the day AFTER you needed it.
  assert.equal(observabilityEnabled(undefined), true, "no config at all ⇒ on");
  assert.equal(observabilityEnabled({}), true, "an empty config ⇒ on");
  assert.equal(observabilityEnabled({ work: {} }), true, "a config with no observability block ⇒ on");
  assert.equal(observabilityEnabled({ work: { observability: {} } }), true, "an empty observability block ⇒ on");
  assert.equal(observabilityEnabled({ work: { observability: { enabled: true } } }), true, "explicit true ⇒ on");
  // The ONLY way off — and it must be the literal `false`, not any falsy value, so a
  // malformed config fails toward collecting diagnostics rather than silently losing them.
  assert.equal(observabilityEnabled({ work: { observability: { enabled: false } } }), false, "explicit false ⇒ the opt-out");
  assert.equal(observabilityEnabled({ work: { observability: { enabled: null } } }), true, "a null (unset) value is not an opt-out");
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

// ---- lost time / concurrency / token split ---------------------------------
// The four signals added after the voice-vox 348 post-mortem, where the report
// could see idle agents but not the infra kills and hand-restarts behind them.

const minM = 60 * 1000;
const hrM = 60 * minM;

// A parent-session fixture: a kill at +30m, the bookkeeping rows Claude Code
// stamps at the human's own timestamp, and the operator's restart 2h later.
function fixtureSession() {
  const L = (o) => JSON.stringify(o);
  return (
    [
      L({ type: "user", timestamp: iso(0), message: { content: "<command-message>aof:continue</command-message> <command-name>/aof:continue</command-name> <command-args>348</command-args>" } }),
      L({ type: "assistant", timestamp: iso(5 * minM), message: { content: [{ type: "text", text: "Spawning the developer." }], usage: { output_tokens: 10 } } }),
      L({ type: "user", timestamp: iso(30 * minM), message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "failed: Agent terminated early due to an API error: You have hit your session limit · resets 1:10am (Europe/London)" }] } }),
      L({ type: "assistant", timestamp: iso(30 * minM + 1000), message: { content: [{ type: "text", text: "You have hit your session limit · resets 1:10am (Europe/London)" }], usage: { output_tokens: 5 } } }),
      // Stamped at the SAME instant as the human turn below. If these count as
      // run activity the 2h wait collapses to zero — the bug 348 hid behind.
      L({ type: "queue-operation", timestamp: iso(2 * hrM + 30 * minM), message: { content: "" } }),
      L({ type: "attachment", timestamp: iso(2 * hrM + 30 * minM), message: { content: "" } }),
      L({ type: "user", timestamp: iso(2 * hrM + 30 * minM), message: { content: [{ type: "text", text: "continue please" }] } }),
      L({ type: "assistant", timestamp: iso(2 * hrM + 31 * minM), message: { content: [{ type: "text", text: "Resuming on lineage." }], usage: { output_tokens: 20 } } }),
      // Dead air: quiet for 3h, then the RUN wakes itself on a task notification.
      L({ type: "user", timestamp: iso(5 * hrM + 31 * minM), message: { content: "<task-notification>agent done</task-notification>" } }),
    ].join("\n") + "\n"
  );
}

test("analyzeSessionThread finds the infra kill with its reset time", () => {
  const r = analyzeSessionThread(fixtureSession());
  assert.equal(r.infraKills.length, 2, "the tool_result and the assistant line both report the kill");
  assert.equal(r.infraKills[0].resets, "1:10am (Europe/London)");
  assert.equal(r.infraKills[0].killedAgent, true, "the tool_result form names a terminated agent");
});

test("clusterInfraKills collapses one limit's burst into a single event", () => {
  const clustered = clusterInfraKills(analyzeSessionThread(fixtureSession()).infraKills);
  assert.equal(clustered.length, 1, "two lines a second apart are one kill, not two");
  assert.equal(clustered[0].agentsKilled, 1);
  assert.equal(clustered[0].resets, "1:10am (Europe/London)");
});

test("REGRESSION: bookkeeping rows sharing the human's timestamp do not zero the wait", () => {
  const wait = analyzeSessionThread(fixtureSession()).quietGaps.find((g) => g.endedBy === "human");
  assert.ok(wait, "the hand-restart is detected at all");
  // Last real run event was the kill at +30m+1s; the human typed at +2h30m.
  assert.equal(wait.ms, 2 * hrM - 1000, "the wait runs from the last RUN event, not the bookkeeping row");
  assert.equal(wait.resumedWith, "continue please");
});

test("analyzeSessionThread separates a hand-restart from dead air the run woke from itself", () => {
  const r = analyzeSessionThread(fixtureSession());
  const human = r.quietGaps.filter((g) => g.endedBy === "human");
  const dead = r.quietGaps.filter((g) => g.endedBy === "run");
  assert.equal(human.length, 1, "exactly one gap ended with the operator typing");
  assert.equal(human[0].resumedWith, "continue please");
  // The 3h gap before the run woke itself on a task notification. (The other
  // `run` gap is the 25m the orchestrator sat waiting on the agent that died —
  // real dead air in this fixture, which carries no agent activity to discount.)
  assert.ok(
    dead.some((g) => g.ms === 3 * hrM),
    `3h of dead air before the run woke on its own, got ${JSON.stringify(dead.map((g) => g.ms))}`,
  );
});

test("humanTurnText reads a slash-command invocation and rejects plumbing", () => {
  assert.equal(
    humanTurnText({ type: "user", message: { content: "<command-message>x</command-message> <command-name>/aof:continue</command-name> <command-args>348</command-args>" } }),
    "/aof:continue 348",
  );
  assert.equal(humanTurnText({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }), null, "tool results are not human turns");
  assert.equal(humanTurnText({ type: "user", message: { content: "<task-notification>done</task-notification>" } }), null, "task notifications are not human turns");
  assert.equal(humanTurnText({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }), null);
  assert.equal(humanTurnText({ type: "user", message: { content: [{ type: "text", text: "continue please" }] } }), "continue please");
});

test("mergeIntervals + overlapMs discount a quiet main thread by the agent work under it", () => {
  assert.deepEqual(mergeIntervals([[0, 10], [5, 15], [20, 25]]), [[0, 15], [20, 25]]);
  const merged = mergeIntervals([[20, 70]]);
  assert.equal(overlapMs([0, 100], merged), 50, "a 100-long gap with an agent working 20–70 is only 50 unattended");
  assert.equal(overlapMs([80, 100], merged), 0, "no agent work in that window");
  assert.equal(unionMs([[0, 10], [5, 15]]), 15, "unionMs still counts overlap once");
});

const wavesAgent = (id, role, start, end) => ({
  id,
  agentType: role,
  description: id,
  firstTs: start,
  lastTs: end,
  activeMs: end - start,
  activeIntervals: [[start, end]],
});

test("analyzeWaves finds a serial chain on ACTIVE intervals, and spares a role that overlapped", () => {
  const w = analyzeWaves([
    wavesAgent("d1", "aof-developer", 0, 3 * hrM),
    wavesAgent("d2", "aof-developer", 3 * hrM, 5 * hrM),
    wavesAgent("d3", "aof-developer", 5 * hrM, 6 * hrM),
    wavesAgent("q1", "aof-qa", 0, 1 * hrM),
    wavesAgent("q2", "aof-qa", 0, 1 * hrM),
  ]);
  const dev = w.serialChains.find((c) => c.role === "aof-developer");
  assert.ok(dev, "the developer chain is reported");
  assert.equal(dev.count, 3);
  assert.equal(dev.sumMs, 6 * hrM);
  assert.equal(dev.longestMs, 3 * hrM);
  assert.equal(dev.costMs, 3 * hrM, "parallelism would have returned the chain minus its longest link");
  assert.equal(w.serialChains.find((c) => c.role === "aof-qa"), undefined, "a role that overlapped is not a serial chain");
  assert.equal(w.roles.find((r) => r.role === "aof-qa").concurrency, 2, "two QA agents worked at once throughout");
});

test("analyzeWaves prices serialization in active work, never in a stall", () => {
  // s1 worked 10m, froze 12h, worked 10m more — its stall must not be charged here.
  const s1 = {
    id: "s1",
    agentType: "aof-qa",
    description: "review 1",
    firstTs: 0,
    lastTs: 12 * hrM + 20 * minM,
    activeMs: 20 * minM,
    activeIntervals: [[0, 10 * minM], [12 * hrM + 10 * minM, 12 * hrM + 20 * minM]],
  };
  const w = analyzeWaves([
    s1,
    wavesAgent("s2", "aof-qa", 13 * hrM, 13 * hrM + 30 * minM),
    wavesAgent("s3", "aof-qa", 14 * hrM, 14 * hrM + 30 * minM),
  ]);
  const qa = w.serialChains.find((c) => c.role === "aof-qa");
  assert.equal(qa.count, 3);
  assert.equal(qa.sumMs, 20 * minM + 30 * minM + 30 * minM, "links priced in ACTIVE work, not the 12h stall");
  assert.equal(qa.longestMs, 30 * minM);
});

test("tokenSplit separates build generation from governance", () => {
  const split = tokenSplit([
    { agentType: "aof-developer", tokens: { out: 600 } },
    { agentType: "aof-qa", tokens: { out: 300 } },
    { agentType: "aof-architect", tokens: { out: 100 } },
  ]);
  assert.equal(split.buildOut, 600);
  assert.equal(split.governanceOut, 400);
  assert.equal(split.governancePct, 40);
  assert.equal(split.byRole[0].role, "aof-developer");
  assert.equal(split.byRole[0].pct, 60);
});

// ── agentMatchesMilestone — attribution, and the hex-boundary bug it had ───────
//
// Found at milestone 45's retro (2026-08-08). The id is matched with a leading `0*`
// so "45" also answers to "045"; with a merely non-DIGIT boundary that accepted a hex
// neighbour, and agent prompts routinely cite scratchpad paths containing their own
// session uuid. A milestone-38 agent was attributed to m45 on the substring `-045f`
// inside `…-8098-045f74122131/scratchpad/…`, which took the reported calendar span
// from ~2 days to 477 hours and moved a quarter of the token split under the wrong
// milestone.

test("agentMatchesMilestone: a session uuid containing the id does NOT match (the m45 regression)", () => {
  const prompt =
    "Run `node /c/Users/Umair/AppData/Local/Temp/claude/c--Source-umair-aof/"
    + "1d576ebe-b72b-428e-8098-045f74122131/scratchpad/run-story05.mjs` and report.";
  assert.equal(
    agentMatchesMilestone(
      { meta: { description: "Behavioural review of F-38.05 story-05" }, firstUserText: prompt },
      { id: "45", slug: "ui-app-shell-routing" },
    ),
    false,
    "a hex run that happens to contain the id is not a reference to the milestone",
  );
});

test("agentMatchesMilestone: the id inside any alphanumeric run is not a match", () => {
  const notRefs = [
    "commit 0045fa9e touched it",      // hex sha
    "the a45b identifier",              // embedded in an identifier
    "see 12345 for context",            // inside a longer number
    "issue 450 is unrelated",           // longer number, same prefix
    "workspace 9db1fd84f5895e38",       // the real workspace id
  ];
  for (const text of notRefs) {
    assert.equal(
      agentMatchesMilestone({ meta: { description: "" }, firstUserText: text }, { id: "45", slug: "zzz" }),
      false,
      `must not match: ${text}`,
    );
  }
});

test("agentMatchesMilestone: every legitimate way of naming the milestone still matches", () => {
  const refs = [
    "aof:verify 45",                                  // trailing, end-of-string
    "story 45/03 needs a contract",                   // a work ref
    "wiki/work/45_milestone_ui-app-shell-routing/",   // the folder path
    "milestone 45's shell",                           // possessive
    "see m45 and m46",                                // the m-prefixed form
    "(45) is the one",                                // bracketed
    "refine 045 — the zero-padded form",              // 0*-padded, as the id regex intends
  ];
  for (const text of refs) {
    assert.equal(
      agentMatchesMilestone({ meta: { description: "" }, firstUserText: text }, { id: "45", slug: "zzz" }),
      true,
      `must match: ${text}`,
    );
  }
});

test("agentMatchesMilestone: the folder slug matches on its own, in the description or the prompt", () => {
  const slug = "ui-app-shell-routing";
  assert.equal(
    agentMatchesMilestone({ meta: { description: `Design pass for ${slug}` }, firstUserText: "" }, { id: "99", slug }),
    true,
  );
  assert.equal(
    agentMatchesMilestone({ meta: { description: "" }, firstUserText: `judge ${slug} renders` }, { id: "99", slug }),
    true,
  );
  // …and nothing matches when neither the id nor the slug is present.
  assert.equal(
    agentMatchesMilestone({ meta: { description: "unrelated" }, firstUserText: "also unrelated" }, { id: "99", slug }),
    false,
  );
});

test("agentMatchesMilestone: a short authored description still matches on the bare id", () => {
  // The description is short and deliberate — "Refine 45" is exactly how a coordinator
  // names the target, and it must keep working.
  assert.equal(
    agentMatchesMilestone({ meta: { description: "Refine 45" }, firstUserText: "" }, { id: "45", slug: "zzz" }),
    true,
  );
});
