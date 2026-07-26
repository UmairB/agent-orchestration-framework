// src/degrade.mjs — "errors are events, not silence" (m42 wave (a), TECH_DEBT
// item 3's sweep). Every former silent catch in src/ now reports here: one coded
// JSONL event into the mesh-log sink family (degrade.log beside the daemons' own
// logs), throttled per code so a hot degrade loop is bounded, and NEVER throwing —
// a degrade reporter that could itself crash the daemon would be worse than the
// silence it replaces.
//
// This module and mesh-log.mjs are the ONLY sanctioned silent-catch homes left
// (the acd-no-new-silent-catch baseline): the sink's own faults have nowhere
// lower to report.
import { createMeshLogSink } from "./mesh-log.mjs";

const THROTTLE_MS = 5000;
const lastByCode = new Map();
let sink = null;
let sinkFactory = null;

// setDegradeSinkForTest(factory) — inject a fake sink factory (undefined resets).
export function setDegradeSinkForTest(factory) {
  sinkFactory = factory;
  sink = null;
  lastByCode.clear();
}

// reportDegrade(code, error, extra) — the ONE degrade event emitter. Best-effort
// by contract: a throttled repeat is dropped (the first event named the class),
// and any fault in the reporter itself is swallowed (the sanctioned floor).
export function reportDegrade(code, error, extra = {}) {
  try {
    const now = Date.now();
    const last = lastByCode.get(code) ?? 0;
    if (now - last < THROTTLE_MS) return;
    lastByCode.set(code, now);
    sink ??= (sinkFactory ?? ((proc) => createMeshLogSink(proc, { env: process.env })))("degrade");
    sink.write({
      level: "degrade",
      code,
      message: String(error?.message ?? error ?? ""),
      ...(typeof extra?.path === "string" ? { path: extra.path } : {}),
    });
  } catch {
    // The reporter must never throw or recurse — this is the sanctioned floor.
  }
}
