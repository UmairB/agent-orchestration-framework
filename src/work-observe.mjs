// Milestone observability — reconstruct per-agent time/token spend for a work item
// from Claude Code's on-disk session transcripts, and write an opt-in
// `observability/` folder into the milestone.
//
// WHY this exists: an aof milestone is delivered by a fan-out of subagents
// (researcher / architect / qa / developer / …). Claude Code records every one of
// those as a JSONL transcript under `~/.claude/projects/<slug>/<session>/subagents/`,
// each with a `.meta.json` (agentType + task description) and per-turn `usage`
// (token counts) + timestamps. Nothing surfaces that back to the milestone, so a
// slow run is a black box — you cannot see which agent took longest, burned the
// most tokens, or (critically) STALLED. This module mines those transcripts and
// renders the answer.
//
// STALL DETECTION is the load-bearing feature: a subagent that dropped its API
// connection or was interrupted looks identical to a busy one. We flag any
// inter-event gap over a threshold, and report `activeMs` (wall-clock MINUS stall
// gaps) alongside raw duration — so an 8-hour "duration" that was really a 6-minute
// task frozen overnight reads as exactly that.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_STALL_MS = 10 * 60 * 1000; // 10 min idle => flagged as a stall

// Claude Code slugifies the project cwd by replacing every non-[A-Za-z0-9]
// character with "-" (so `C:\Source\voice-vox\voice-vox-web` ->
// `C--Source-voice-vox-voice-vox-web`; existing hyphens are preserved).
export function projectSlug(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, "-");
}

// The `<slug>` directory under Claude Code's projects store. Honours
// CLAUDE_CONFIG_DIR (Claude Code's own override) before falling back to ~/.claude.
export function claudeProjectsDir({ cwd = process.cwd(), home = os.homedir(), env = process.env } = {}) {
  const base = env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : path.join(home, ".claude");
  return path.join(base, "projects", projectSlug(cwd));
}

function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function shortLabel(obj) {
  const c = obj?.message?.content;
  if (Array.isArray(c)) {
    const tools = c.filter((b) => b.type === "tool_use").map((b) => b.name);
    if (tools.length) return `${obj.type} tool:${tools.join(",")}`;
    const text = c.find((b) => b.type === "text" && b.text)?.text;
    if (text) return `${obj.type} “${text.slice(0, 70).replace(/\s+/g, " ")}”`;
    const res = c.find((b) => b.type === "tool_result");
    if (res) return "tool_result";
  } else if (typeof c === "string" && c) {
    return `${obj.type} “${c.slice(0, 70).replace(/\s+/g, " ")}”`;
  }
  return obj?.type ?? "event";
}

// A Bash command that runs the toolchain (tests / typecheck / build / lint) — the
// expensive, repeatable verbs a fix-test-rerun loop cycles on. Broad on purpose:
// JS/TS, Python, Go, Rust, Java, and the yarn/npm/pnpm workspace forms.
const TOOLCHAIN_RE =
  /\b(vitest|jest|mocha|playwright|cypress|pytest|go test|cargo (test|build|clippy)|mvn|gradle|tsc\b|eslint|ruff|flake8|typecheck|type-check|lint\b|npm (run )?(test|build|lint|typecheck)|pnpm (run )?(test|build|lint|typecheck)|yarn (workspace \S+ )?(test|build|lint|typecheck)|npx (vitest|jest|tsc|eslint|playwright))\b/i;

function classifyBash(cmd) {
  return TOOLCHAIN_RE.test(cmd || "") ? "toolchain" : "other";
}

// A stable signature for counting command repetition: strip the leading `cd "…" &&`,
// collapse whitespace, and keep the first ~90 chars — so the SAME suite re-run reads
// as one bucket even when the working-dir prefix differs.
function cmdSignature(cmd) {
  return String(cmd || "")
    .replace(/^cd\s+"[^"]*"\s*&&\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function lastSegments(p, n = 3) {
  return String(p || "?")
    .split(/[\\/]/)
    .filter(Boolean)
    .slice(-n)
    .join("/");
}

// Parse one transcript (main session or subagent) into a stats record + a rich
// `diagnostics` block that explains WHY an agent was slow (toolchain-wait, loop /
// thrash, edit↔test interleaving, model-vs-tool time). Pure over `text`, so it is
// trivially unit-testable with a fixture string.
export function analyzeTranscript(text, { stallMs = DEFAULT_STALL_MS } = {}) {
  const lines = text.split("\n").filter(Boolean);
  const events = [];
  let firstTs = null;
  let lastTs = null;
  let turns = 0;
  let out = 0;
  let inp = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  let model = null;
  const tools = {};

  // Diagnostic collectors.
  const uses = []; // ordered { id, name, ts, kind, cmd, file }
  const results = new Map(); // tool_use_id -> { ts, isError }
  const editCounts = {};
  const readCounts = {};
  const cmdCounts = {}; // signature -> { count, ids: [] }

  for (const line of lines) {
    const o = safeParse(line);
    if (!o) continue;
    const ts = o.timestamp ? Date.parse(o.timestamp) : null;
    if (ts != null && !Number.isNaN(ts)) {
      if (firstTs == null || ts < firstTs) firstTs = ts;
      if (lastTs == null || ts > lastTs) lastTs = ts;
      events.push({ ts, label: shortLabel(o) });
    }
    if (o.type === "assistant" && o.message) {
      const u = o.message.usage;
      if (u) {
        turns += 1;
        out += u.output_tokens || 0;
        inp += u.input_tokens || 0;
        cacheRead += u.cache_read_input_tokens || 0;
        cacheCreate += u.cache_creation_input_tokens || 0;
      }
      if (o.message.model) model = o.message.model;
      const content = o.message.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type !== "tool_use") continue;
          tools[b.name] = (tools[b.name] || 0) + 1;
          let kind = "other";
          let cmd = null;
          let file = null;
          if (b.name === "Bash") {
            cmd = b.input?.command || "";
            kind = classifyBash(cmd) === "toolchain" ? "test" : "bash";
            const sig = cmdSignature(cmd);
            (cmdCounts[sig] ||= { count: 0, kind }).count += 1;
          } else if (b.name === "Edit" || b.name === "Write" || b.name === "NotebookEdit") {
            kind = "edit";
            file = b.input?.file_path || "?";
            editCounts[file] = (editCounts[file] || 0) + 1;
          } else if (b.name === "Read") {
            kind = "read";
            file = b.input?.file_path || "?";
            readCounts[file] = (readCounts[file] || 0) + 1;
          }
          uses.push({ id: b.id, name: b.name, ts, kind, cmd, file });
        }
      }
    }
    if (o.type === "user" && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type !== "tool_result") continue;
        const content = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        const isError = Boolean(b.is_error) || /(^|\W)(error|fail(ed|ure)?|✕|✗|not ok|Exception|Traceback)(\W|$)/i.test(content.slice(0, 400));
        if (ts != null) results.set(b.tool_use_id, { ts, isError });
      }
    }
  }

  events.sort((a, b) => a.ts - b.ts);
  const stalls = [];
  let stalledMs = 0;
  // Split the agent's lifetime into ACTIVE intervals — maximal runs of events whose
  // consecutive gap stays under the stall threshold. A gap >= threshold both closes
  // the current active interval and is recorded as a stall.
  const activeIntervals = [];
  let runStart = events.length ? events[0].ts : null;
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].ts - events[i - 1].ts;
    if (gap >= stallMs) {
      stalledMs += gap;
      stalls.push({ gapMs: gap, at: events[i - 1].ts, before: events[i - 1].label, after: events[i].label });
      activeIntervals.push([runStart, events[i - 1].ts]);
      runStart = events[i].ts;
    }
  }
  if (runStart != null) activeIntervals.push([runStart, events.length ? events[events.length - 1].ts : runStart]);
  stalls.sort((a, b) => b.gapMs - a.gapMs);

  const durationMs = firstTs != null && lastTs != null ? lastTs - firstTs : 0;
  const activeMs = durationMs - stalledMs;
  const diagnostics = computeDiagnostics({ uses, results, editCounts, readCounts, cmdCounts, activeMs, stallMs });

  return {
    firstTs,
    lastTs,
    durationMs,
    activeMs,
    stalledMs,
    activeIntervals,
    turns,
    tokens: { out, inp, cacheRead, cacheCreate },
    tools,
    model,
    stalls,
    diagnostics,
  };
}

// Turn the raw tool timeline into the "why slow" story: how much wall-clock went to
// toolchain waits vs model generation, which files thrashed, which commands repeated,
// and whether the edit↔test rhythm was a tight fix-test loop or batched. Pure.
function computeDiagnostics({ uses, results, editCounts, readCounts, cmdCounts, activeMs, stallMs }) {
  // Pair each tool_use with its result to get execution wall-time.
  let toolMs = 0;
  let toolchainMs = 0;
  let toolchainRuns = 0;
  let toolchainMax = 0;
  const timed = [];
  for (const u of uses) {
    const r = results.get(u.id);
    const ms = r && r.ts >= u.ts ? Math.min(r.ts - u.ts, stallMs) : 0; // clamp: a stall between use+result isn't tool time
    toolMs += ms;
    if (u.kind === "test") {
      toolchainRuns += 1;
      toolchainMs += ms;
      if (ms > toolchainMax) toolchainMax = ms;
    }
    timed.push({ name: u.name, kind: u.kind, ms, label: u.kind === "test" || u.kind === "bash" ? cmdSignature(u.cmd) : lastSegments(u.file) });
  }
  const modelMs = Math.max(0, activeMs - toolMs);

  const hotEdited = Object.entries(editCounts).map(([file, count]) => ({ file: lastSegments(file), count })).sort((a, b) => b.count - a.count);
  const hotRead = Object.entries(readCounts).map(([file, count]) => ({ file: lastSegments(file), count })).sort((a, b) => b.count - a.count);
  const repeated = Object.entries(cmdCounts)
    .filter(([, v]) => v.count >= 2)
    .map(([cmd, v]) => ({ cmd, count: v.count, kind: v.kind }))
    .sort((a, b) => b.count - a.count);

  // Edit↔test interleaving — the TDD-vs-write-first signal. editsPerTest ~1 with many
  // test runs = "re-verify after nearly every change" (the grind); few test runs =
  // write-first; many edits per test = batched.
  const editActions = Object.values(editCounts).reduce((a, c) => a + c, 0);
  const editsPerTest = toolchainRuns ? +(editActions / toolchainRuns).toFixed(1) : null;
  let pattern = "n/a";
  if (toolchainRuns >= 5 && editsPerTest != null && editsPerTest <= 2) pattern = "tight fix-test loop (re-verifies after ~every edit)";
  else if (toolchainRuns <= 2) pattern = "write-first (verifies rarely)";
  else if (toolchainRuns > 0) pattern = "batched (several edits per verify)";

  const toolErrors = [...results.values()].filter((r) => r.isError).length;
  const toolchainPct = activeMs > 0 ? Math.round((toolchainMs / activeMs) * 100) : 0;
  const topEdit = hotEdited[0];
  const topCmd = repeated[0];

  // Grind flag: an agent stuck fix-test-rerunning rather than making progress.
  const reasons = [];
  if (toolchainPct >= 30) reasons.push(`${toolchainPct}% of active time waiting on toolchain (${toolchainRuns} runs, worst ${Math.round(toolchainMax / 1000)}s)`);
  if (topEdit && topEdit.count >= 8) reasons.push(`${topEdit.file} edited ${topEdit.count}× (thrash)`);
  if (topCmd && topCmd.count >= 8) reasons.push(`re-ran \`${topCmd.cmd}\` ${topCmd.count}×`);
  if (toolchainRuns >= 15) reasons.push(`${toolchainRuns} toolchain runs`);

  return {
    toolMs,
    modelMs,
    toolchain: { runs: toolchainRuns, totalMs: toolchainMs, avgMs: toolchainRuns ? Math.round(toolchainMs / toolchainRuns) : 0, maxMs: toolchainMax, pctOfActive: toolchainPct },
    interleave: { testRuns: toolchainRuns, editActions, editsPerTest, pattern },
    hotFiles: { edited: hotEdited.slice(0, 6), read: hotRead.slice(0, 6) },
    repeatedCommands: repeated.slice(0, 8),
    slowestTools: timed.filter((t) => t.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 6).map((t) => ({ name: t.name, seconds: Math.round(t.ms / 1000), label: t.label })),
    errors: { toolErrors },
    grind: { flagged: reasons.length > 0, reasons },
  };
}

// Total length of the union of a set of [start,end] intervals — concurrency-aware
// (overlapping intervals counted once). Used to turn per-agent active/idle sums
// (which overstate reality when agents run in parallel) into real wall-clock.
export function mergeIntervals(intervals) {
  const valid = intervals
    .filter((iv) => iv && iv[0] != null && iv[1] != null && iv[1] >= iv[0])
    .map((iv) => [iv[0], iv[1]])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of valid) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) {
      if (e > last[1]) last[1] = e;
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

export function unionMs(intervals) {
  return mergeIntervals(intervals).reduce((a, [s, e]) => a + (e - s), 0);
}

// How much of [start,end] is covered by an ALREADY-MERGED interval set. Used to
// discount a quiet main thread by the agent work happening underneath it — an
// orchestrator silent while a developer builds is idle BY DESIGN, not lost time.
export function overlapMs([start, end], merged) {
  let total = 0;
  for (const [s, e] of merged) {
    const lo = Math.max(start, s);
    const hi = Math.min(end, e);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

// ---- lost time: infra kills + human waits ----------------------------------
//
// WHY: `collectMilestoneAgents` only reads `subagents/**`, so it can see an agent
// stall but never WHY the milestone stopped. The two causes that dominate a slow
// run both live in the PARENT session thread, which nothing was reading:
//
//   1. an infra kill (API session/usage limit, overload) that terminates the
//      orchestrator and every agent under it, and
//   2. the wait that follows, because nothing restarts a dead orchestrator — a
//      human has to notice and type a word.
//
// Measured on voice-vox 348: 3 kills, and the waits behind them were 13 of the
// milestone's 28 calendar hours. An observe report that cannot name that is
// reporting the symptom (idle agents) and hiding the cause.

export const DEFAULT_HUMAN_WAIT_MS = 10 * 60 * 1000; // main thread quiet this long before a human turn => a wait

// The infra failures that kill a run through no fault of the work. Deliberately
// narrow: these are *terminations*, not any mention of an error.
const INFRA_KILL_RE =
  /(?:hit your (?:session|usage) limit|terminated early due to an API error|\brate.?limit(?:ed|s)?\b|overloaded_error|Claude Code is unable to respond)/i;
// "…session limit · resets 8:10pm (Europe/London)" -> "8:10pm (Europe/London)"
const RESETS_RE = /resets\s+(\d{1,2}:\d{2}\s*[ap]?m?(?:\s*\([^)\n]{1,32}\))?)/i;
// A slash-command invocation is a human turn even though it arrives XML-wrapped.
const COMMAND_NAME_RE = /<command-name>([^<]+)<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([^<]*)<\/command-args>/;

// Flatten an event's content to searchable text (assistant prose AND tool_result
// bodies — an agent's death arrives as a tool_result on the parent thread).
function eventText(obj) {
  const c = obj?.message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  const parts = [];
  for (const b of c) {
    if (b.type === "text" && b.text) parts.push(b.text);
    else if (b.type === "tool_result") parts.push(typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""));
  }
  return parts.join("\n");
}

// The text of a genuine HUMAN turn, or null. Tool results, system reminders and
// task notifications are plumbing wearing a `user` type — only real operator
// input counts, plus slash-command invocations (XML-wrapped, but human-typed).
export function humanTurnText(obj) {
  if (obj?.type !== "user") return null;
  const c = obj.message?.content;
  let text = null;
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b.type === "tool_result")) return null;
    text = c.filter((b) => b.type === "text" && b.text).map((b) => b.text).join(" ");
  }
  if (!text) return null;
  const cmd = COMMAND_NAME_RE.exec(text);
  if (cmd) {
    const args = COMMAND_ARGS_RE.exec(text);
    return `${cmd[1].trim()}${args && args[1].trim() ? ` ${args[1].trim()}` : ""}`;
  }
  text = text.trim();
  if (!text || text.startsWith("<")) return null; // system-reminder / task-notification wrapper
  return text;
}

// Parse ONE parent-session transcript for infra kills and human waits, bounded to
// a time window (a session file spans many milestones). Pure over `text`.
export function analyzeSessionThread(text, { windowStart = null, windowEnd = null, humanWaitMs = DEFAULT_HUMAN_WAIT_MS } = {}) {
  const events = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const o = safeParse(line);
    if (!o || o.isSidechain) continue; // MAIN thread only — subagents are collected separately
    // ONLY assistant turns and user rows count as run activity. The bookkeeping
    // rows Claude Code interleaves (`queue-operation`, `attachment`,
    // `file-history-delta`) carry no work — and `queue-operation` is stamped with
    // the SAME second as the human turn it queues, so counting it as activity
    // collapses every wait to zero. That bug hid all 13h of 348's blocked time.
    if (o.type !== "assistant" && o.type !== "user") continue;
    const ts = o.timestamp ? Date.parse(o.timestamp) : null;
    if (ts == null || Number.isNaN(ts)) continue;
    if (windowStart != null && ts < windowStart) continue;
    if (windowEnd != null && ts > windowEnd) continue;
    events.push({ ts, o });
  }
  events.sort((a, b) => a.ts - b.ts);

  const infraKills = [];
  const quietGaps = [];
  const humanTurns = [];
  let prevTs = null;
  for (const { ts, o } of events) {
    const body = eventText(o);
    if (body) {
      const hit = INFRA_KILL_RE.exec(body);
      if (hit) {
        const resets = RESETS_RE.exec(body);
        infraKills.push({
          at: ts,
          phrase: hit[0],
          resets: resets ? resets[1].replace(/\s+/g, " ").trim() : null,
          killedAgent: /terminated early due to an API error/i.test(body),
        });
      }
    }
    const human = humanTurnText(o);
    const trimmed = human ? human.replace(/\s+/g, " ").slice(0, 140) : null;
    if (trimmed) humanTurns.push({ at: ts, text: trimmed });
    // Every quiet stretch on the main thread is lost time — but HOW it ends says
    // what went wrong. Ending in a human turn means the run was waiting to be
    // restarted by hand; ending in the run itself means nobody was driving and
    // nothing noticed (a silent stall — the case a watchdog would close).
    if (prevTs != null && ts - prevTs >= humanWaitMs) {
      quietGaps.push({
        fromTs: prevTs,
        toTs: ts,
        ms: ts - prevTs,
        endedBy: trimmed ? "human" : "run",
        resumedWith: trimmed || shortLabel(o),
      });
    }
    prevTs = ts;
  }
  return { infraKills, quietGaps, humanTurns };
}

// Collapse the burst of near-simultaneous kill lines one limit produces (the
// orchestrator's own message plus one `terminated early` per dying agent) into a
// single event carrying how many agents it took down.
export function clusterInfraKills(kills, { windowMs = 2 * 60 * 1000 } = {}) {
  const sorted = [...kills].sort((a, b) => a.at - b.at);
  const out = [];
  for (const k of sorted) {
    const last = out[out.length - 1];
    if (last && k.at - last.at <= windowMs) {
      last.agentsKilled += k.killedAgent ? 1 : 0;
      last.resets ||= k.resets;
      last.lastAt = k.at;
      continue;
    }
    out.push({ at: k.at, lastAt: k.at, phrase: k.phrase, resets: k.resets, agentsKilled: k.killedAgent ? 1 : 0 });
  }
  return out;
}

// Read every parent session behind a milestone and derive the lost-time picture:
// what killed the run, how long it then sat waiting for a human, and how much of
// that wait is attributable to a kill rather than to ordinary think-time.
export async function collectSessionSignals({ projectsDir, sessions = [], windowStart = null, windowEnd = null, humanWaitMs = DEFAULT_HUMAN_WAIT_MS, agentActive = [] } = {}) {
  const rawKills = [];
  const quietGaps = [];
  const humanTurns = [];
  for (const sessionId of sessions) {
    let text;
    try {
      text = await fsp.readFile(path.join(projectsDir, `${sessionId}.jsonl`), "utf8");
    } catch {
      continue;
    }
    const r = analyzeSessionThread(text, { windowStart, windowEnd, humanWaitMs });
    rawKills.push(...r.infraKills);
    quietGaps.push(...r.quietGaps.map((g) => ({ ...g, sessionId })));
    humanTurns.push(...r.humanTurns.map((t) => ({ ...t, sessionId })));
  }
  const infraKills = clusterInfraKills(rawKills);
  humanTurns.sort((a, b) => a.at - b.at);

  // Discount every gap by the agent work happening underneath it. A quiet main
  // thread while a developer builds for two hours is idle BY DESIGN — counting it
  // as lost time would drown the real signal. What remains (`unattendedMs`) is
  // wall-clock where NOTHING at all was running.
  const merged = mergeIntervals(agentActive);
  for (const g of quietGaps) {
    g.agentActiveMs = overlapMs([g.fromTs, g.toTs], merged);
    g.unattendedMs = Math.max(0, g.ms - g.agentActiveMs);
    // A gap is attributed to a kill when the kill lands inside it (or just before
    // it opens) — the run stopped because of the kill and stayed stopped.
    const cause = infraKills.find((k) => k.at >= g.fromTs - 5 * 60 * 1000 && k.at <= g.toTs);
    if (cause) {
      g.afterInfraKill = true;
      g.resets = cause.resets || null;
    }
  }
  // Only gaps that were genuinely unattended for the threshold survive.
  const real = quietGaps.filter((g) => g.unattendedMs >= humanWaitMs).sort((a, b) => b.unattendedMs - a.unattendedMs);
  const humanWaits = real.filter((g) => g.endedBy === "human");
  const deadAir = real.filter((g) => g.endedBy === "run");
  const blockedOnHumanMs = humanWaits.reduce((a, g) => a + g.unattendedMs, 0);
  const deadAirMs = deadAir.reduce((a, g) => a + g.unattendedMs, 0);
  const blockedAfterInfraKillMs = real.filter((g) => g.afterInfraKill).reduce((a, g) => a + g.unattendedMs, 0);
  return { infraKills, quietGaps: real, humanWaits, deadAir, humanTurns, blockedOnHumanMs, deadAirMs, blockedAfterInfraKillMs };
}

// ---- concurrency: waves and serial chains ----------------------------------
//
// WHY: `activeUnionMs` already prices parallelism in aggregate, but it cannot say
// WHICH work was needlessly serialized. Stories forced through one at a time (a
// shared working tree, a `depends` edge added for build order) read as a role
// whose agents never overlap — and the wall-clock that ordering cost is
// sum(durations) - longest, recoverable in full if they could have run together.

// Group agents into waves and measure, per role, how much of that role's work was
// needlessly serialized. Pure over the agent records.
//
// Everything here runs on ACTIVE intervals, never lifetimes. A stalled agent's
// lifetime can span half a day, so lifetime-overlap would report a role as
// "concurrent" purely because one of its members sat frozen across the others.
export function analyzeWaves(agents = []) {
  const runs = agents
    .filter((a) => (a.activeIntervals || []).length)
    .map((a) => {
      const merged = mergeIntervals(a.activeIntervals);
      return {
        id: a.id,
        role: a.agentType,
        desc: a.description,
        merged,
        start: merged[0][0],
        end: merged[merged.length - 1][1],
        activeMs: a.activeMs,
      };
    })
    .sort((a, b) => a.start - b.start);

  const waves = mergeIntervals(runs.flatMap((r) => r.merged)).map((iv, i) => ({
    index: i + 1,
    startTs: iv[0],
    endTs: iv[1],
    spanMs: iv[1] - iv[0],
    agentCount: runs.filter((r) => overlapMs(iv, r.merged) > 0).length,
  }));

  const byRole = {};
  for (const r of runs) (byRole[r.role] ||= []).push(r);
  const roles = [];
  for (const [role, list] of Object.entries(byRole)) {
    if (list.length < 2) continue;
    const sumActiveMs = list.reduce((a, r) => a + r.activeMs, 0);
    const unionActiveMs = unionMs(list.flatMap((r) => r.merged));
    const longestActiveMs = Math.max(...list.map((r) => r.activeMs));

    // The longest set of runs that never once overlapped each other — greedy by
    // earliest finish (activity selection), which is optimal for intervals and
    // good enough for the fragmented sets a stall produces.
    const chain = [];
    for (const r of [...list].sort((a, b) => a.end - b.end)) {
      if (chain.every((c) => overlapMs([r.start, r.end], c.merged) === 0)) chain.push(r);
    }
    // Link duration is ACTIVE work, not the span. A link that stalled for twelve
    // hours did not cost twelve hours of serialization — that is the stall's bill,
    // reported separately, and charging it here too would double-count it.
    const chainSumMs = chain.reduce((a, r) => a + r.activeMs, 0);
    const chainLongestMs = chain.length ? Math.max(...chain.map((r) => r.activeMs)) : 0;

    roles.push({
      role,
      count: list.length,
      sumActiveMs,
      unionActiveMs,
      // 1.0 = strictly one-at-a-time; 3.0 = three agents working at once on average.
      concurrency: unionActiveMs ? +(sumActiveMs / unionActiveMs).toFixed(2) : 0,
      serialChain: {
        count: chain.length,
        sumMs: chainSumMs,
        longestMs: chainLongestMs,
        // Wall-clock a parallel run of that chain would have returned.
        costMs: Math.max(0, chainSumMs - chainLongestMs),
        members: chain
          .slice()
          .sort((a, b) => a.start - b.start)
          .map((r) => ({ id: r.id, desc: r.desc, ms: r.activeMs })),
      },
      longestActiveMs,
    });
  }
  roles.sort((a, b) => b.serialChain.costMs - a.serialChain.costMs);

  return {
    waves,
    roles,
    // Roles worth calling out: three or more runs that never overlapped.
    serialChains: roles.filter((r) => r.serialChain.count >= 3).map((r) => ({ role: r.role, ...r.serialChain })),
  };
}

// ---- token split: build vs governance --------------------------------------
//
// WHY: a milestone that spends most of its generation on contract authoring and
// review is making a depth trade the operator never got to price. Splitting the
// output tokens by role turns "it took all day" into "40% of it was governance".

// The roles that WRITE the product. Everything else (contract authoring, review,
// design, research, compliance) is governance around that build.
export const BUILD_ROLES = new Set(["aof-developer"]);

export function tokenSplit(agents = []) {
  let buildOut = 0;
  let governanceOut = 0;
  const byRole = {};
  for (const a of agents) {
    const out = a.tokens?.out || 0;
    const role = a.agentType || "unknown";
    byRole[role] = (byRole[role] || 0) + out;
    if (BUILD_ROLES.has(role)) buildOut += out;
    else governanceOut += out;
  }
  const totalOut = buildOut + governanceOut;
  return {
    buildOut,
    governanceOut,
    totalOut,
    governancePct: totalOut ? Math.round((governanceOut / totalOut) * 100) : 0,
    byRole: Object.entries(byRole)
      .map(([role, out]) => ({ role, out, pct: totalOut ? Math.round((out / totalOut) * 100) : 0 }))
      .sort((a, b) => b.out - a.out),
  };
}

// Does a subagent's meta/prompt reference this milestone? We match the milestone
// id (numeric) or its folder slug in the task description OR the agent's opening
// prompt — robust to either the coordinator naming "346" or passing the folder path.
function agentMatchesMilestone({ meta, firstUserText }, { id, slug }) {
  const idRe = new RegExp(`(^|[^0-9])0*${id}([^0-9]|$)`);
  const hay = `${meta?.description || ""}\n${firstUserText || ""}`;
  if (idRe.test(meta?.description || "")) return true;
  if (slug && hay.includes(slug)) return true;
  if (idRe.test(firstUserText || "")) return true;
  return false;
}

function firstUserText(text) {
  for (const line of text.split("\n")) {
    if (!line) continue;
    const o = safeParse(line);
    if (o?.type === "user") {
      const c = o.message?.content;
      if (typeof c === "string") return c.slice(0, 4000);
      if (Array.isArray(c)) {
        const t = c.find((b) => b.type === "text")?.text;
        if (t) return t.slice(0, 4000);
      }
    }
  }
  return "";
}

// Walk every session in the projects dir, collect the subagents that touched this
// milestone, and analyze each. Returns agents (sorted by activeMs desc) plus the
// set of parent sessions involved (so the caller can attribute orchestrator spend).
export async function collectMilestoneAgents({ projectsDir, id, slug, stallMs = DEFAULT_STALL_MS } = {}) {
  const agents = [];
  const sessions = new Set();
  let entries;
  try {
    entries = await fsp.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return { agents, sessions: [], projectsDir, found: false };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subDir = path.join(projectsDir, entry.name, "subagents");
    let metas;
    try {
      metas = (await fsp.readdir(subDir)).filter((f) => f.endsWith(".meta.json"));
    } catch {
      continue;
    }
    for (const mf of metas) {
      let meta;
      try {
        meta = JSON.parse(await fsp.readFile(path.join(subDir, mf), "utf8"));
      } catch {
        continue;
      }
      const agentId = mf.replace(/\.meta\.json$/, "");
      const jsonl = path.join(subDir, `${agentId}.jsonl`);
      let text;
      try {
        text = await fsp.readFile(jsonl, "utf8");
      } catch {
        continue;
      }
      const prompt = firstUserText(text);
      if (!agentMatchesMilestone({ meta, firstUserText: prompt }, { id, slug })) continue;
      const stats = analyzeTranscript(text, { stallMs });
      agents.push({
        id: agentId.replace(/^agent-/, "").slice(0, 8),
        agentType: meta.agentType || "unknown",
        description: meta.description || "",
        sessionId: entry.name,
        ...stats,
      });
      sessions.add(entry.name);
    }
  }
  agents.sort((a, b) => b.activeMs - a.activeMs);
  return { agents, sessions: [...sessions], projectsDir, found: true };
}

// ---- rendering -------------------------------------------------------------

export function fmtDur(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}
function fmtK(n) {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
function fmtClock(ms) {
  if (ms == null) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";
}
function shortModel(m) {
  if (!m) return "—";
  const match = /(opus|sonnet|haiku|fable)/i.exec(m);
  return match ? match[1].toLowerCase() : m.replace(/^claude-/, "").slice(0, 8);
}

export function renderReportMarkdown({ id, folder, agents, sessions, generatedAt, stallMs, lostTime = null, concurrency = null, split = null }) {
  const totalOut = agents.reduce((a, x) => a + x.tokens.out, 0);
  const sumActive = agents.reduce((a, x) => a + x.activeMs, 0);
  const stalled = agents.filter((a) => a.stalls.length);
  const gen = generatedAt ? fmtClock(generatedAt) : "(unstamped)";
  // Concurrency-aware wall-clock: the calendar span the milestone occupied, the
  // union of all agents' ACTIVE intervals (parallel work counted once), and the
  // real idle inside that span (span minus active union). These correct the naive
  // per-agent sums, which overstate reality whenever agents overlap.
  const firsts = agents.map((a) => a.firstTs).filter((t) => t != null);
  const lasts = agents.map((a) => a.lastTs).filter((t) => t != null);
  const spanMs = firsts.length ? Math.max(...lasts) - Math.min(...firsts) : 0;
  const activeUnion = unionMs(agents.flatMap((a) => a.activeIntervals || []));
  const realIdle = Math.max(0, spanMs - activeUnion);
  const L = [];
  L.push(`# Observability — milestone ${id}`);
  L.push("");
  L.push(`_Generated ${gen} · stall threshold ${fmtDur(stallMs)} · ${agents.length} agent run(s) across ${sessions.length} session(s)._`);
  L.push("");
  L.push("This folder is auto-derived from Claude Code session transcripts. It is a");
  L.push("diagnostic, not a work record — safe to delete or `.gitignore`.");
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push(`- **Calendar span** (first agent start → last agent end): **${fmtDur(spanMs)}**`);
  L.push(`- **Real active time** (concurrency-aware, excl. stalls): **${fmtDur(activeUnion)}**`);
  L.push(`- **Real idle time** inside the span: **${fmtDur(realIdle)}** ${realIdle >= stallMs ? "⚠️" : ""}`);
  L.push(`- **Sum of per-agent active time** (if run serially): ${fmtDur(sumActive)}`);
  L.push(`- **Total output tokens** (generation): **${fmtK(totalOut)}**`);
  if (lostTime?.blockedOnHumanMs) {
    const pct = spanMs ? Math.round((lostTime.blockedOnHumanMs / spanMs) * 100) : 0;
    L.push(`- **Blocked waiting for a human**: **${fmtDur(lostTime.blockedOnHumanMs)}** (${pct}% of the span)`);
  }
  if (lostTime?.deadAirMs) {
    const pct = spanMs ? Math.round((lostTime.deadAirMs / spanMs) * 100) : 0;
    L.push(`- **Dead air** (main thread quiet, nothing driving, no human asked): **${fmtDur(lostTime.deadAirMs)}** (${pct}% of the span)`);
  }
  if (lostTime?.infraKills?.length) {
    L.push(`- **Infra kills** (API session/usage limit, overload): **${lostTime.infraKills.length}**, costing **${fmtDur(lostTime.blockedAfterInfraKillMs)}** of the wait above`);
  }
  if (stalled.length) {
    L.push("");
    L.push(`> ⚠️ **${stalled.length} agent(s) stalled.** The wall-clock below is dominated by idle gaps, not compute — see "Stalls".`);
  }
  if (lostTime?.blockedAfterInfraKillMs && spanMs && lostTime.blockedAfterInfraKillMs / spanMs >= 0.2) {
    L.push("");
    L.push(
      `> ⛔ **${Math.round((lostTime.blockedAfterInfraKillMs / spanMs) * 100)}% of this milestone's calendar time was a dead run waiting to be restarted by hand.** ` +
        "That is mechanism, not work — see \"Lost time\".",
    );
  }
  L.push("");
  const grinders = agents.filter((a) => a.diagnostics?.grind?.flagged);
  if (grinders.length) {
    L.push("");
    L.push(`> ⚙️ **${grinders.length} agent(s) grinding** — active time dominated by a fix-test-rerun loop, not the stall/idle. See "Why slow".`);
  }
  L.push("");

  // Lost time first — an idle agent is a symptom; the kill and the wait behind it
  // are the cause, and they are usually the largest single line in the report.
  if (lostTime && (lostTime.infraKills.length || lostTime.quietGaps.length)) {
    L.push("## Lost time — why the run stopped");
    L.push("");
    if (lostTime.infraKills.length) {
      L.push("**Infra kills.** The run was terminated by the platform, not by the work. Nothing restarts a");
      L.push("dead orchestrator, so each of these costs whatever it took a human to notice.");
      L.push("");
      L.push("| at | agents killed | resets | gap that followed |");
      L.push("|----|---------------|--------|-------------------|");
      for (const k of lostTime.infraKills) {
        const gap = lostTime.quietGaps.find((g) => g.afterInfraKill && k.at >= g.fromTs - 5 * 60 * 1000 && k.at <= g.toTs);
        L.push(`| ${fmtClock(k.at)} | ${k.agentsKilled || "—"} | ${k.resets || "—"} | ${gap ? `**${fmtDur(gap.unattendedMs)}** (${gap.endedBy === "human" ? "restarted by hand" : "run resumed itself"})` : "resumed promptly"} |`);
      }
      L.push("");
    }
    if (lostTime.humanWaits.length) {
      L.push("**Waits for a human.** The run stopped and stayed stopped until the operator typed. Nothing");
      L.push("here is work — it is the cost of having no way back in without a person.");
      L.push("");
      L.push("| from | nothing running for | after an infra kill? | restarted with |");
      L.push("|------|---------------------|----------------------|----------------|");
      for (const w of lostTime.humanWaits.slice(0, 10)) {
        L.push(`| ${fmtClock(w.fromTs)} | **${fmtDur(w.unattendedMs)}** | ${w.afterInfraKill ? `yes — resets ${w.resets || "?"}` : "no"} | ${w.resumedWith} |`);
      }
      L.push("");
    }
    if (lostTime.deadAir.length) {
      L.push("**Dead air.** The main thread went quiet with no human asked and nothing driving, then the run");
      L.push("woke on its own. Each of these is a window a stall watchdog would have closed.");
      L.push("");
      L.push("| from | nothing running for | woke on |");
      L.push("|------|---------------------|---------|");
      for (const g of lostTime.deadAir.slice(0, 10)) {
        L.push(`| ${fmtClock(g.fromTs)} | **${fmtDur(g.unattendedMs)}** | ${g.resumedWith.replace(/\s+/g, " ").slice(0, 70)} |`);
      }
      L.push("");
    }
  }

  // Concurrency second — what was serialized, and what that ordering cost.
  if (concurrency && (concurrency.serialChains.length || concurrency.waves.length > 1)) {
    L.push("## Concurrency — waves and serial chains");
    L.push("");
    L.push(`- **${concurrency.waves.length} wave(s)** of agent activity across the span.`);
    if (sumActive && activeUnion) {
      L.push(`- **Parallelism factor:** ${(sumActive / activeUnion).toFixed(2)}× (sum of active ÷ wall-clock active). 1.00× means strictly one-at-a-time.`);
    }
    L.push("");
    if (concurrency.roles.length) {
      L.push("**Per role.** `concurrency` is how many of that role's agents worked at once on average.");
      L.push("");
      L.push("| role | runs | active (sum) | active (wall-clock) | concurrency |");
      L.push("|------|------|--------------|---------------------|-------------|");
      for (const r of concurrency.roles) {
        L.push(`| ${r.role} | ${r.count} | ${fmtDur(r.sumActiveMs)} | ${fmtDur(r.unionActiveMs)} | ${r.concurrency.toFixed(2)}× |`);
      }
      L.push("");
    }
    if (concurrency.serialChains.length) {
      L.push("**Serial chains** — runs of one role that never once overlapped, so they went one at a time.");
      L.push("`cost` is the wall-clock a parallel run would have returned (chain total minus its longest link).");
      L.push("");
      L.push("| role | links | chain total | longest link | **cost of serializing** |");
      L.push("|------|-------|-------------|--------------|-------------------------|");
      for (const c of concurrency.serialChains) {
        L.push(`| ${c.role} | ${c.count} | ${fmtDur(c.sumMs)} | ${fmtDur(c.longestMs)} | **${fmtDur(c.costMs)}** |`);
      }
      L.push("");
      for (const c of concurrency.serialChains) {
        L.push(`- **${c.role}:** ${c.members.map((m) => `${m.desc || m.id} (${fmtDur(m.ms)})`).join(" → ")}`);
      }
      L.push("");
    }
  }

  L.push("## Agents (ranked by active work time)");
  L.push("");
  L.push("| active | wall-clock | tool-wait | out tok | turns | model | agent | task |");
  L.push("|--------|-----------|-----------|---------|-------|-------|-------|------|");
  for (const a of agents) {
    const d = a.diagnostics || {};
    const flag = `${a.stalls.length ? " ⚠️" : ""}${d.grind?.flagged ? " ⚙️" : ""}`;
    const tc = d.toolchain || { pctOfActive: 0, runs: 0 };
    const toolWait = tc.runs ? `${tc.pctOfActive}% ${tc.runs}r` : "—";
    L.push(
      `| ${fmtDur(a.activeMs)} | ${fmtDur(a.durationMs)}${flag} | ${toolWait} | ${fmtK(a.tokens.out)} | ${a.turns} | ${shortModel(a.model)} | ${a.agentType} | ${a.description || "—"} |`,
    );
  }
  L.push("");
  // Why-slow diagnostics for agents that did real compute (skip trivial / stalled-only).
  const notable = agents.filter((a) => (a.diagnostics?.toolchain?.runs || 0) >= 3 || a.diagnostics?.grind?.flagged || a.turns >= 40);
  if (notable.length) {
    L.push("## Why slow — per-agent diagnostics");
    L.push("");
    L.push("Where each agent's active time went (model generation vs waiting on the toolchain), and the loop signals behind it.");
    L.push("");
    for (const a of notable) {
      const d = a.diagnostics;
      L.push(`### ${a.agentType} — ${a.description || a.id} ${d.grind?.flagged ? "⚙️" : ""}`);
      L.push(`- **Time split:** model generation ${fmtDur(d.modelMs)} · toolchain wait ${fmtDur(d.toolchain.totalMs)} (${d.toolchain.pctOfActive}% of active)`);
      if (d.toolchain.runs) {
        L.push(`- **Toolchain:** ${d.toolchain.runs} runs · avg ${Math.round(d.toolchain.avgMs / 1000)}s · worst ${Math.round(d.toolchain.maxMs / 1000)}s`);
        L.push(`- **Edit↔test rhythm:** ${d.interleave.pattern} — ${d.interleave.testRuns} test runs, ${d.interleave.editActions} edits (${d.interleave.editsPerTest ?? "—"} edits/run)`);
      }
      if (d.hotFiles.edited.length) {
        L.push(`- **Hot files (edited):** ${d.hotFiles.edited.slice(0, 4).map((f) => `${f.file} ×${f.count}`).join(", ")}`);
      }
      if (d.repeatedCommands.length) {
        L.push(`- **Repeated commands:** ${d.repeatedCommands.slice(0, 3).map((c) => `\`${c.cmd}\` ×${c.count}`).join(" · ")}`);
      }
      if (d.errors.toolErrors) L.push(`- **Error-ish tool results:** ${d.errors.toolErrors}`);
      if (d.grind?.flagged) L.push(`- **⚙️ Grind:** ${d.grind.reasons.join("; ")}`);
      L.push("");
    }
  }
  if (stalled.length) {
    L.push("## Stalls (idle gaps — likely dropped connection / interrupt / machine off)");
    L.push("");
    for (const a of stalled) {
      const top = a.stalls[0];
      L.push(`- **${a.agentType}** (${a.description || a.id}) — idle **${fmtDur(top.gapMs)}** at ${fmtClock(top.at)}`);
      L.push(`  - froze after: \`${top.before}\``);
      L.push(`  - resumed at: \`${top.after}\``);
    }
    L.push("");
  }
  // Build vs governance — the depth trade, priced. A milestone spending most of its
  // generation on contract authoring and review made a choice the operator never saw.
  if (split && split.totalOut) {
    L.push("## Where the generation went — build vs governance");
    L.push("");
    L.push(`- **Build** (${[...BUILD_ROLES].join(", ")}): **${fmtK(split.buildOut)}** (${100 - split.governancePct}%)`);
    L.push(`- **Governance** (contract authoring, review, design, research): **${fmtK(split.governanceOut)}** (**${split.governancePct}%**)`);
    L.push("");
    L.push("| role | out tok | share |");
    L.push("|------|---------|-------|");
    for (const r of split.byRole) L.push(`| ${r.role} | ${fmtK(r.out)} | ${r.pct}% |`);
    L.push("");
    if (split.governancePct >= 40) {
      L.push(`> ⚖️ **Governance took ${split.governancePct}% of the generation.** Worth checking that depth was priced with the operator before the run, not discovered after it.`);
      L.push("");
    }
  }
  L.push("## Token detail");
  L.push("");
  L.push("| agent | out | input | cache-create | cache-read | model |");
  L.push("|-------|-----|-------|--------------|------------|-------|");
  for (const a of agents) {
    L.push(
      `| ${a.agentType} | ${fmtK(a.tokens.out)} | ${fmtK(a.tokens.inp)} | ${fmtK(a.tokens.cacheCreate)} | ${fmtK(a.tokens.cacheRead)} | ${a.model || "—"} |`,
    );
  }
  L.push("");
  L.push(`_Sessions: ${sessions.join(", ") || "none"}_`);
  L.push("");
  return L.join("\n");
}

// Resolve a milestone folder under wiki/work by ref: exact folder name, or a
// numeric id matched against the `NN_` prefix, or a substring.
export async function resolveMilestoneFolder({ cwd = process.cwd(), ref } = {}) {
  const workDir = path.join(cwd, "wiki", "work");
  let dirs;
  try {
    dirs = (await fsp.readdir(workDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  if (dirs.includes(ref)) return { folder: ref, id: (ref.match(/^(\d+)_/) || [])[1] || ref };
  const num = String(ref).replace(/^0+/, "");
  const byId = dirs.find((d) => {
    const m = d.match(/^(\d+)_/);
    return m && String(Number(m[1])) === num;
  });
  if (byId) return { folder: byId, id: (byId.match(/^(\d+)_/) || [])[1] };
  const bySub = dirs.find((d) => d.includes(ref));
  if (bySub) return { folder: bySub, id: (bySub.match(/^(\d+)_/) || [])[1] || ref };
  return null;
}

// Top-level: analyze a milestone and (optionally) write its observability folder.
export async function observeMilestone({
  cwd = process.cwd(),
  ref,
  home = os.homedir(),
  env = process.env,
  stallMs = DEFAULT_STALL_MS,
  humanWaitMs = DEFAULT_HUMAN_WAIT_MS,
  generatedAt = null,
  write = false,
} = {}) {
  const resolved = await resolveMilestoneFolder({ cwd, ref });
  if (!resolved) {
    const err = new Error(`No milestone folder under wiki/work matching "${ref}".`);
    err.code = "milestone-not-found";
    throw err;
  }
  const { folder, id } = resolved;
  const projectsDir = claudeProjectsDir({ cwd, home, env });
  const { agents, sessions, found } = await collectMilestoneAgents({ projectsDir, id, slug: folder, stallMs });
  const firsts = agents.map((a) => a.firstTs).filter((t) => t != null);
  const lasts = agents.map((a) => a.lastTs).filter((t) => t != null);
  const spanMs = firsts.length ? Math.max(...lasts) - Math.min(...firsts) : 0;
  const activeUnionMs = unionMs(agents.flatMap((a) => a.activeIntervals || []));

  // The parent-thread pass. Bounded to the milestone's span (± an hour of slack, so
  // the invoking slash command and the closing report are inside the window) —
  // a session file spans many milestones and must not leak another one's waits in.
  const slackMs = 60 * 60 * 1000;
  const lostTime = firsts.length
    ? await collectSessionSignals({
        projectsDir,
        sessions,
        windowStart: Math.min(...firsts) - slackMs,
        windowEnd: Math.max(...lasts) + slackMs,
        humanWaitMs,
        agentActive: agents.flatMap((a) => a.activeIntervals || []),
      })
    : { infraKills: [], quietGaps: [], humanWaits: [], deadAir: [], humanTurns: [], blockedOnHumanMs: 0, deadAirMs: 0, blockedAfterInfraKillMs: 0 };
  const concurrency = analyzeWaves(agents);
  const split = tokenSplit(agents);
  const report = renderReportMarkdown({ id, folder, agents, sessions, generatedAt, stallMs, lostTime, concurrency, split });
  const json = {
    milestone: id,
    folder,
    generatedAt: generatedAt ? new Date(generatedAt).toISOString() : null,
    stallMs,
    transcriptsFound: found,
    projectsDir,
    sessions,
    summary: {
      calendarSpanMs: spanMs,
      activeUnionMs,
      realIdleMs: Math.max(0, spanMs - activeUnionMs),
      sumActiveMs: agents.reduce((a, x) => a + x.activeMs, 0),
      totalOutputTokens: agents.reduce((a, x) => a + x.tokens.out, 0),
      stalledAgents: agents.filter((a) => a.stalls.length).length,
      grindingAgents: agents.filter((a) => a.diagnostics?.grind?.flagged).length,
      agentCount: agents.length,
      blockedOnHumanMs: lostTime.blockedOnHumanMs,
      deadAirMs: lostTime.deadAirMs,
      blockedAfterInfraKillMs: lostTime.blockedAfterInfraKillMs,
      infraKills: lostTime.infraKills.length,
      serializationCostMs: concurrency.serialChains.reduce((a, c) => a + c.costMs, 0),
      governancePct: split.governancePct,
    },
    lostTime: {
      infraKills: lostTime.infraKills.map((k) => ({ at: new Date(k.at).toISOString(), agentsKilled: k.agentsKilled, resets: k.resets, phrase: k.phrase })),
      quietGaps: lostTime.quietGaps.map((g) => ({
        fromTs: new Date(g.fromTs).toISOString(),
        toTs: new Date(g.toTs).toISOString(),
        ms: g.ms,
        unattendedMs: g.unattendedMs,
        agentActiveMs: g.agentActiveMs,
        endedBy: g.endedBy,
        afterInfraKill: Boolean(g.afterInfraKill),
        resets: g.resets || null,
        resumedWith: g.resumedWith,
        sessionId: g.sessionId,
      })),
      blockedOnHumanMs: lostTime.blockedOnHumanMs,
      deadAirMs: lostTime.deadAirMs,
      blockedAfterInfraKillMs: lostTime.blockedAfterInfraKillMs,
    },
    concurrency,
    tokenSplit: split,
    agents: agents.map((a) => ({
      id: a.id,
      agentType: a.agentType,
      description: a.description,
      sessionId: a.sessionId,
      firstTs: a.firstTs ? new Date(a.firstTs).toISOString() : null,
      lastTs: a.lastTs ? new Date(a.lastTs).toISOString() : null,
      durationMs: a.durationMs,
      activeMs: a.activeMs,
      stalledMs: a.stalledMs,
      turns: a.turns,
      tokens: a.tokens,
      tools: a.tools,
      model: a.model,
      stalls: a.stalls,
      diagnostics: a.diagnostics,
    })),
  };
  let written = null;
  if (write) {
    const obsDir = path.join(cwd, "wiki", "work", folder, "observability");
    await fsp.mkdir(obsDir, { recursive: true });
    const reportPath = path.join(obsDir, "report.md");
    const jsonPath = path.join(obsDir, "agents.json");
    await fsp.writeFile(reportPath, report, "utf8");
    await fsp.writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    written = { dir: obsDir, reportPath, jsonPath };
  }
  return { id, folder, projectsDir, found, agents, sessions, report, json, written };
}

// Read the observability flag from a loaded aof config object.
//
// DEFAULT ON (operator, 2026-08-07). It shipped opt-in and therefore never ran: the
// 348 post-mortem had to be done by hand because no milestone in the repo had ever
// written an `observability/` snapshot. A diagnostic that is off by default is a
// diagnostic you only enable AFTER the day you needed it — so the default inverts,
// and `enabled: false` is now the explicit opt-OUT.
//
// The cost is bounded and local: a read of this workspace's own Claude Code session
// transcripts plus two files written into the milestone folder, on lifecycle calls
// that already run. Explicit `aof work observe` bypasses this gate either way (an
// operator asking directly is not a default).
export function observabilityEnabled(config) {
  return config?.work?.observability?.enabled !== false;
}
