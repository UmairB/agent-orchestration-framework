// Fitness function: acd-run-retry-classification (milestone 20, ADR-002).
//
// The classification table is CLOSED and the functions are PURE: runtime_offline /
// timeout → retryable; agent_error / unknown / null → non-retryable; shouldRetry is
// true iff the reason is retryable AND attempt < maxAttempts (fails closed at the
// ceiling); isRetryable/shouldRetry read NO clock/fs/config (the 06/ADR-003
// single-pure-resolver discipline). Verdicts are imported + asserted; purity is a
// source-grep of the two function BODIES.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isRetryable, shouldRetry } from "../../src/run-store.mjs";

const RUN_STORE = new URL("../../src/run-store.mjs", import.meta.url);

export const archTests = [
  {
    name: "arch/run-retry-classification: isRetryable is the closed table (infra retryable, agent_error/unknown/null fail closed)",
    async run() {
      // the full closed table — every documented input, exactly the two retryable
      const table = [
        ["runtime_offline", true],
        ["timeout", true],
        ["agent_error", false],
        ["some_other_kind", false],
        [null, false],
        [undefined, false],
        ["", false],
      ];
      for (const [reason, expected] of table) {
        assert.equal(isRetryable(reason), expected, `isRetryable(${JSON.stringify(reason)}) === ${expected}`);
      }
    },
  },
  {
    name: "arch/run-retry-classification: shouldRetry ANDs the verdict with the ceiling and fails closed at attempt >= maxAttempts",
    async run() {
      // a retryable reason retries strictly BELOW the ceiling, halts at/over it
      assert.equal(shouldRetry({ failureReason: "timeout", attempt: 1 }, 3), true, "timeout @1 of 3 → true");
      assert.equal(shouldRetry({ failureReason: "timeout", attempt: 2 }, 3), true, "timeout @2 of 3 → true");
      assert.equal(shouldRetry({ failureReason: "timeout", attempt: 3 }, 3), false, "timeout @3 of 3 → false (ceiling)");
      assert.equal(shouldRetry({ failureReason: "runtime_offline", attempt: 4 }, 3), false, "runtime_offline @4 of 3 → false");
      assert.equal(shouldRetry({ failureReason: "timeout", attempt: 1 }, 1), false, "timeout @1 of 1 → false (ceiling)");
      // a non-retryable reason never retries, ceiling or not
      assert.equal(shouldRetry({ failureReason: "agent_error", attempt: 1 }, 3), false, "agent_error never retries");
      assert.equal(shouldRetry({ failureReason: null, attempt: 1 }, 3), false, "null never retries");
      assert.equal(shouldRetry({ failureReason: "some_other_kind", attempt: 1 }, 3), false, "unknown never retries");
    },
  },
  {
    name: "arch/run-retry-classification: isRetryable and shouldRetry are pure — their bodies read no clock/fs/config",
    async run() {
      const source = stripComments(await readFile(RUN_STORE, "utf8"));
      const forbidden = ["Date", "readFile", "readdir", "writeText", "writeFile", "process", "loadWorkspace", "require", "import("];
      for (const name of ["isRetryable", "shouldRetry"]) {
        const body = functionBody(source, name);
        assert.ok(body.length > 0, `${name} is defined in run-store.mjs`);
        for (const token of forbidden) {
          assert.ok(
            !body.includes(token),
            `${name} body is pure — contains no "${token}" (no clock/fs/config). Body: ${body.trim()}`
          );
        }
      }
    },
  },
  {
    // Basis-neutral discipline (ADR-002/004/006/007 + 08/ADR-002): the store NEVER reads
    // config/workspace — the resolved ceiling (maxAttempts), staleness threshold, and
    // clock (now) are PASSED IN by the command/face edge. This locks that across ALL the
    // new paths (classification, reclaim, dedup, heartbeat), not just the two classifier
    // functions above — so a future edit cannot quietly couple the spine to config.
    name: "arch/run-retry-classification: the run-store module is basis-neutral — it reads no config/workspace seam",
    async run() {
      const code = stripComments(await readFile(RUN_STORE, "utf8"));
      const seams = [
        [/from\s+["']\.\/work\.mjs["']/, "an import of ./work.mjs"],
        [/from\s+["']\.\/workspace\.mjs["']/, "an import of ./workspace.mjs"],
        [/from\s+["']\.\/dsl\.mjs["']/, "an import of ./dsl.mjs"],
        [/\bloadWorkspace\b/, "a loadWorkspace reference"],
        [/process\.env/, "a process.env read"],
        [/\.config\b/, "a .config access"],
      ];
      for (const [seam, label] of seams) {
        assert.ok(
          !seam.test(code),
          `run-store.mjs is basis-neutral — it has no ${label} (the ceiling/threshold/clock are passed in, not read from config)`
        );
      }
    },
  },
];

// --- source-analysis helpers ------------------------------------------------

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Extract a named function's body (balanced braces), comments already stripped.
function functionBody(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!match) return "";
  let depth = 1;
  let out = "";
  for (let i = match.index + match[0].length; i < source.length && depth > 0; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    out += ch;
  }
  return out;
}
