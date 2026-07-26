// src/mesh-log.mjs — the daemons' durable log sink (milestone 42 wave (a), TECH_DEBT
// item 2: "daemons have nowhere to log").
//
// THE DEFECT, measured live: the long-running processes wrote diagnostics with
// console.error, and when supervised by the desktop app that output went NOWHERE —
// the newest file in ~/.aof/mesh/logs/ was eight days stale while the daemon ran
// continuously, and a dead run's post-mortem took SSH archaeology on two machines.
//
// THE SHAPE: one JSONL line per event, appended to <globalMeshRoot>/logs/<proc>.log
// (AOF_GLOBAL_HOME-honouring), size-rotated to a single .1 sibling. The sink TEES
// beside the existing console.error (a hand-launched daemon keeps its live stderr);
// it never replaces it. A sink fault must never crash or slow the daemon — the
// append is best-effort, the console line still carries the event.
import { appendFileSync, mkdirSync, renameSync, statSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { globalMeshPaths } from "./workspace.mjs";

export const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024;

// meshLogPath(proc, options) — the ONE path rule: <meshRoot>/logs/<proc>.log.
export function meshLogPath(proc, options = {}) {
  const paths = options.paths ?? globalMeshPaths(options);
  return path.join(paths.meshRoot, "logs", `${proc}.log`);
}

// createMeshLogSink(proc, options) → { path, write(entry) }. `write` appends one
// JSONL line ({ at, proc, level, code, message, … }) and rotates the file to
// `<file>.1` when it would exceed maxBytes (one previous generation is kept —
// bounded disk, no unbounded growth, no reclaim job needed).
export function createMeshLogSink(proc, options = {}) {
  const filePath = meshLogPath(proc, options);
  const maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  mkdirSync(path.dirname(filePath), { recursive: true });
  let size = 0;
  try {
    size = statSync(filePath).size;
  } catch {
    size = 0; // absent file — first write creates it
  }
  const write = (entry) => {
    try {
      const line = `${JSON.stringify({ at: now(), proc, ...entry })}\n`;
      if (size + line.length > maxBytes) {
        try {
          renameSync(filePath, `${filePath}.1`);
        } catch (error) {
          // Rotation losing a race (two processes, or a reader holding the file on
          // Windows) is tolerable — the append below still lands in SOME generation.
          void error;
        }
        size = 0;
      }
      appendFileSync(filePath, line, "utf8");
      size += line.length;
    } catch {
      // The sink must never crash or block the daemon (the console tee still
      // carries the event) — but this is bounded silence: one lost line, not a
      // disabled sink; the next write tries again.
    }
  };
  return { path: filePath, write };
}

// readMeshLog(proc, { tail, includeRotated, ...options }) → { path, entries } — the
// reader half (`aof mesh logs`). Parse-tolerant: a torn/garbage line is returned as
// { raw } rather than thrown away silently or crashing the read.
export function readMeshLog(proc, { tail = 200, includeRotated = true, ...options } = {}) {
  const filePath = meshLogPath(proc, options);
  const sources = [];
  if (includeRotated && existsSync(`${filePath}.1`)) sources.push(`${filePath}.1`);
  if (existsSync(filePath)) sources.push(filePath);
  const lines = [];
  for (const source of sources) {
    lines.push(...readFileSync(source, "utf8").split("\n").filter((line) => line.length > 0));
  }
  const entries = lines.slice(-tail).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line }; // torn line: surfaced, never dropped
    }
  });
  return { path: filePath, entries };
}
