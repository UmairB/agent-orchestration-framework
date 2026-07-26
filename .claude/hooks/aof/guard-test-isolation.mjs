#!/usr/bin/env node
// PreToolUse guard (Bash/PowerShell): block running the aof repo's tests WITHOUT
// AOF_GLOBAL_HOME isolation. An unisolated `node scripts/test.mjs` / `node --test` /
// `npm test` falls back to os.homedir()/.aof — the machine's REAL global mesh store,
// shared by every project and every live daemon — and a passing test can silently write
// fixture records (node descriptors, presence, aof.config.json) into it, polluting a live
// fleet/soak. See memory: test-suite-can-corrupt-real-global-config.
//
// Exit 2 => the tool call is BLOCKED and this stderr is shown to Claude, which then re-runs
// the command with the AOF_GLOBAL_HOME prefix. Any other exit (0) => allowed.
import { readFileSync } from "node:fs";

let raw = "";
try {
  raw = readFileSync(0, "utf8");
} catch {
  process.exit(0); // no payload -> don't interfere
}

let cmd = "";
try {
  const payload = JSON.parse(raw);
  cmd = payload?.tool_input?.command ?? "";
} catch {
  process.exit(0); // unparseable -> don't interfere
}

if (typeof cmd !== "string" || cmd.length === 0) process.exit(0);

// A run of THIS repo's test harness. Deliberately narrow: real `aof` inspection commands
// (aof mesh status, work find) legitimately read real state and must NOT be blocked.
const isTestRun =
  /scripts[\\/]+test\.mjs/i.test(cmd) ||
  /\bnode\b[^\n]*\s--test\b/i.test(cmd) ||
  /\bnpm\b\s+(?:run\s+)?test\b/i.test(cmd);

const isIsolated = /AOF_GLOBAL_HOME\s*=/.test(cmd);

if (isTestRun && !isIsolated) {
  process.stderr.write(
    "BLOCKED by aof test-isolation guard.\n" +
      "This runs the aof test suite WITHOUT AOF_GLOBAL_HOME, so an unisolated test can write\n" +
      "fixture records into the REAL ~/.aof global mesh store and pollute the live fleet/soak.\n" +
      "Re-run with a throwaway global home, e.g.:\n" +
      '  AOF_GLOBAL_HOME="$(mktemp -d)" ' + cmd.trim() + "\n",
  );
  process.exit(2);
}

process.exit(0);
