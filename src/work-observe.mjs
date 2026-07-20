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
export function unionMs(intervals) {
  const valid = intervals.filter((iv) => iv && iv[0] != null && iv[1] != null && iv[1] >= iv[0]);
  if (!valid.length) return 0;
  valid.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = valid[0];
  for (let i = 1; i < valid.length; i++) {
    const [s, e] = valid[i];
    if (s <= curEnd) {
      if (e > curEnd) curEnd = e;
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  total += curEnd - curStart;
  return total;
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

export function renderReportMarkdown({ id, folder, agents, sessions, generatedAt, stallMs }) {
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
  if (stalled.length) {
    L.push("");
    L.push(`> ⚠️ **${stalled.length} agent(s) stalled.** The wall-clock below is dominated by idle gaps, not compute — see "Stalls".`);
  }
  L.push("");
  const grinders = agents.filter((a) => a.diagnostics?.grind?.flagged);
  if (grinders.length) {
    L.push("");
    L.push(`> ⚙️ **${grinders.length} agent(s) grinding** — active time dominated by a fix-test-rerun loop, not the stall/idle. See "Why slow".`);
  }
  L.push("");
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
  const report = renderReportMarkdown({ id, folder, agents, sessions, generatedAt, stallMs });
  const firsts = agents.map((a) => a.firstTs).filter((t) => t != null);
  const lasts = agents.map((a) => a.lastTs).filter((t) => t != null);
  const spanMs = firsts.length ? Math.max(...lasts) - Math.min(...firsts) : 0;
  const activeUnionMs = unionMs(agents.flatMap((a) => a.activeIntervals || []));
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
    },
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

// Read the opt-in flag from a loaded aof config object. Default OFF — the folder is
// only auto-generated when `work.observability.enabled` is true. Explicit `aof work
// observe` invocation bypasses this gate (an operator asked for it directly).
export function observabilityEnabled(config) {
  return Boolean(config?.work?.observability?.enabled);
}
