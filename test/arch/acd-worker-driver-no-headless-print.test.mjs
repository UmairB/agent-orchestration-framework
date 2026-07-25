// Fitness function: acd-worker-driver-no-headless-print (milestone 38 / ADR-013 +
// its 2026-07-19 AMENDMENT, fitness #16) — "the worker driver path emits NO `claude
// -p` + `--output-format json` one-shot; the interactive `claude` launch resolves
// through the `terminal-providers` seam; the command to run is typed into PTY stdin (a
// directive field, not a `-p` prompt argv); `session_id` is captured by a REAL producer
// (a transcript-dir watch, NOT a phantom PTY marker); the `NEEDS_INPUT` sentinel has a
// REAL producer (a worker-scoped `--append-system-prompt` launch arg); a `needs-input`
// outcome takes the retain-worktree branch, never the `done` force-remove."
//
// F-38.05 REWRITE (2026-07-19). The pre-amendment invariant 4 required
// `extractSessionIdFromOutput` + an `AOF_SESSION_ID:` PTY marker, and invariant 3
// asserted `spawnCalls[0].args === []` — i.e. it PINNED the producerless shape F-38.05
// had to remove (the "a fitness function armed at build against an as-built shape can
// LOCK IN a producerless consumer" lesson). This rewrite REQUIRES the producer instead
// of forbidding it:
//   (1) STRUCTURAL — no `claude -p --output-format json` one-shot shape survives for the
//       `claude` driver (UNCHANGED).
//   (2) STRUCTURAL — the interactive launch resolves via `resolveProvider` imported from
//       `./terminal-providers.mjs`, actually CALLED (UNCHANGED).
//   (2b) BEHAVIOURAL — a stubbed-absent provider binary makes NO spawn attempt
//       (UNCHANGED).
//   (3) STRUCTURAL + BEHAVIOURAL — the directive command is typed via `term.write` as
//       exactly ONE write; the launch argv MAY carry `--append-system-prompt
//       <NEEDS_INPUT_INSTRUCTION>` (option C) but NEVER `-p`/`--print`/`--output-format`.
//   (4) STRUCTURAL + BEHAVIOURAL — `session_id` is captured by the TRANSCRIPT-DIR WATCH
//       (`claudeProjectsDir` reused from `./work-observe.mjs` + the
//       `defaultWatchTranscriptSessionId` seam) — NOT a PTY marker — and surfaced on the
//       done + needs-input `sendAssignmentStatus` frames.
//   (5) STRUCTURAL + BEHAVIOURAL — a `needs-input` outcome's branch contains NO
//       `removeWorktree(..., {force:true})` — that call site exists ONLY on the `done`
//       branch (UNCHANGED).
//   (6) STRUCTURAL — the `NEEDS_INPUT` producer EXISTS: `NEEDS_INPUT_INSTRUCTION` embeds
//       `${NEEDS_INPUT_SENTINEL}` and is appended to the interactive launch via
//       `--append-system-prompt`. A revert to "no producer" trips the detector.
//
// Self-check (m03 non-vacuous, CRLF discipline honoured — every plant is a raw substring
// replace, verified via assert.notEqual(planted, source) BEFORE asserting the detector
// trips, per this milestone's own CRLF near-miss; no plant regex is anchored on a literal
// "\n"). NOTE (F-38.05, expected): invariants 3, 4, and 6 pin the NEW producer the
// developer builds NEXT to the corrected ADR — they go GREEN only after that build; until
// then they fail at their PRIMARY assertion (never at a vacuous plant). Invariants 1, 2,
// 2b, 5, the sessionId-surfacing half of 4, and the registration test are GREEN NOW.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driveInteractiveClaudeSession, NEEDS_INPUT_SENTINEL } from "../../src/mesh-worker-execution.mjs";
import { createFakeWhich, createFakePtySpawn } from "../support/mesh-worker-terminal-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DRIVER_SOURCE = path.join(repoRoot, "src", "mesh-worker-execution.mjs");
const TEST_SUITE = path.join(repoRoot, "scripts", "test.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// matchBrace(code, start) — the house-style brace matcher (acd-control-dispatch-
// reclaim-driver-wired's idiom): returns the index of the `}` closing the `{` whose
// body starts at `start`, or -1.
function matchBrace(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

// ---------------------------------------------------------------- invariant 1 ----
// No `claude -p ... --output-format json` one-shot shape for the claude driver.
function hasClaudeHeadlessPrintShape(code) {
  return /bin\s*:\s*["']claude["'][\s\S]{0,120}args\s*:\s*\[[\s\S]{0,160}-p[\s\S]{0,160}--output-format/.test(code);
}

// ---------------------------------------------------------------- invariant 2 ----
// The interactive launch resolves through terminal-providers.mjs's resolveProvider,
// genuinely called (not merely imported-and-unused).
function resolvesThroughTerminalProviders(rawCode, strippedCode) {
  const importsIt = /import\s*\{\s*resolveProvider\s*\}\s*from\s*["']\.\/terminal-providers\.mjs["']/.test(rawCode);
  const callsIt = /resolveProvider\s*\(/.test(strippedCode);
  return importsIt && callsIt;
}

// ---------------------------------------------------------------- invariant 3 ----
// The command is typed via term.write — never baked into the spawn call's argv.
function typesCommandIntoPtyStdin(strippedCode) {
  // SUBMIT with carriage-return `\r` (a real Enter keypress), not line-feed `\n`
  // (VERIFICATION F27b, live soak 2026-07-25 — a trailing `\n` entered the text into
  // claude's TUI input box but never submitted it, and the run went idle).
  return /term\.write\(\s*`\$\{command\}\\r`\s*\)/.test(strippedCode) && /const\s+command\s*=\s*typeof\s+brief\.command/.test(strippedCode);
}

// ---------------------------------------------------------------- invariant 4 ----
// session_id is captured by the TRANSCRIPT-DIR WATCH (the REAL producer) — NOT the
// retired `AOF_SESSION_ID:` PTY-marker scan: `claudeProjectsDir` is reused from
// ./work-observe.mjs (imported AND called), the `defaultWatchTranscriptSessionId` seam
// is defined, and the injected `options.watchTranscriptSessionId` is wired to it.
function capturesSessionIdViaTranscriptWatch(rawCode, strippedCode) {
  const importsProjectsDir = /import\s*\{[^}]*\bclaudeProjectsDir\b[^}]*\}\s*from\s*["']\.\/work-observe\.mjs["']/.test(rawCode);
  const callsProjectsDir = /claudeProjectsDir\s*\(/.test(strippedCode);
  const definesWatchSeam = /function\s+defaultWatchTranscriptSessionId/.test(strippedCode);
  const wiresWatchSeam = /options\.watchTranscriptSessionId\s*\?\?\s*defaultWatchTranscriptSessionId/.test(strippedCode);
  return importsProjectsDir && callsProjectsDir && definesWatchSeam && wiresWatchSeam;
}

// session_id is surfaced on BOTH terminal status frames (this half was always correct —
// the done + needs-input frames already carry sessionId; F-38.05 was the CAPTURE, not the
// SURFACING).
function surfacesSessionIdOnStatusFrames(strippedCode) {
  const onDone = /sendAssignmentStatus\?\.\(\s*assignmentId,\s*["']done["'],\s*\{[^}]*sessionId[^}]*\}\s*\)/.test(strippedCode);
  const onNeedsInput = /sendAssignmentStatus\?\.\(\s*assignmentId,\s*["']running["'],\s*\{[^}]*sessionId[^}]*code:\s*["']needs-input["'][^}]*\}\s*\)/.test(strippedCode);
  return onDone && onNeedsInput;
}

// ---------------------------------------------------------------- invariant 6 ----
// The NEEDS_INPUT producer EXISTS (ADR-013 amendment, option C): a NEEDS_INPUT_INSTRUCTION
// template embedding the sentinel via `${NEEDS_INPUT_SENTINEL}` (so producer + detector
// share one literal), appended to the interactive launch as a `--append-system-prompt`
// arg. This is the crux — remove the producer and this MUST fail.
function hasNeedsInputProducer(strippedCode) {
  const definesInstruction = /const\s+NEEDS_INPUT_INSTRUCTION\s*=/.test(strippedCode);
  const instructionEmbedsSentinel = /NEEDS_INPUT_INSTRUCTION\s*=\s*`[\s\S]*?\$\{\s*NEEDS_INPUT_SENTINEL\s*\}/.test(strippedCode);
  const appendedToLaunch = /["']--append-system-prompt["'][\s\S]{0,40}NEEDS_INPUT_INSTRUCTION/.test(strippedCode);
  return definesInstruction && instructionEmbedsSentinel && appendedToLaunch;
}

// ---------------------------------------------------------------- invariant 5 ----
// The needs-input branch (`if (outcome.outcome === "needs-input") { ... }`) contains
// NO removeWorktree call and NO `force: true` — that call site exists ONLY on the
// done path, textually AFTER this branch has already returned.
function needsInputBranchBody(strippedCode) {
  const gateRe = /if\s*\(\s*outcome\.outcome\s*===\s*["']needs-input["']\s*\)\s*\{/;
  const match = gateRe.exec(strippedCode);
  if (!match) return null;
  const braceStart = strippedCode.indexOf("{", match.index);
  const braceEnd = matchBrace(strippedCode, braceStart + 1);
  if (braceEnd === -1) return null;
  return strippedCode.slice(braceStart + 1, braceEnd);
}

function needsInputRetainsWorktree(strippedCode) {
  const body = needsInputBranchBody(strippedCode);
  if (body == null) return false;
  if (/removeWorktree\s*\(/.test(body)) return false;
  if (/force\s*:\s*true/.test(body)) return false;
  return /return\s*;/.test(body);
}

export const archTests = [
  {
    name: "arch/38 ADR-013 (acd-worker-driver-no-headless-print): invariant 1 — no `claude -p` + `--output-format json` one-shot survives for the claude driver",
    run: async () => {
      const raw = await readFile(DRIVER_SOURCE, "utf8");
      const stripped = stripComments(raw);
      assert.equal(hasClaudeHeadlessPrintShape(stripped), false, "the real source names no claude -p ... --output-format one-shot");

      // Self-check: plant the EXACT pre-story-05 shape back in.
      const planted = `${stripped}\nfunction plantedHeadless() { return { bin: "claude", args: ["-p", prompt, "--output-format", "json"] }; }\n`;
      assert.notEqual(planted, stripped, "the plant actually changed the source text");
      assert.equal(hasClaudeHeadlessPrintShape(planted), true, "a re-introduced claude -p driver trips the detector");
    },
  },
  {
    name: "arch/38 ADR-013 (acd-worker-driver-no-headless-print): invariant 2 — the interactive launch resolves through the terminal-providers seam (imported AND called)",
    run: async () => {
      const raw = await readFile(DRIVER_SOURCE, "utf8");
      const stripped = stripComments(raw);
      assert.equal(resolvesThroughTerminalProviders(raw, stripped), true, "resolveProvider is imported from terminal-providers.mjs and genuinely called");

      // Self-check: strip the import line — the real source's OWN call site remains,
      // but the detector's import-half must independently trip. CRLF-safe: matches
      // the import statement itself without anchoring on a literal "\n" (this tree
      // is CRLF; a raw "\n"-anchored regex would silently no-op the plant).
      const plantedNoImport = raw.replace(/import \{ resolveProvider \} from "\.\/terminal-providers\.mjs";\r?\n/, "");
      assert.notEqual(plantedNoImport, raw, "the plant actually changed the source text");
      assert.equal(resolvesThroughTerminalProviders(plantedNoImport, stripComments(plantedNoImport)), false, "a stripped resolveProvider import trips the detector");

      // Self-check: an import with no call site anywhere in the (stripped) body.
      const plantedNoCall = stripped.replace(/resolveProvider\s*\(/g, "notResolveProvider(");
      assert.notEqual(plantedNoCall, stripped, "the plant actually changed the source text");
      assert.equal(resolvesThroughTerminalProviders(raw, plantedNoCall), false, "an import with no genuine call site trips the detector");
    },
  },
  {
    name: "arch/38 ADR-013 (acd-worker-driver-no-headless-print): invariant 2b — a stubbed-absent provider binary means NO spawn attempt (BEHAVIOURAL, over the real resolveInteractiveDriverLaunch/resolveProvider chain)",
    run: async () => {
      const which = createFakeWhich([]); // nothing on PATH
      const { spawn, spawnCalls } = createFakePtySpawn();
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 38/05 --autonomous" },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => null },
      );
      assert.equal(spawnCalls.length, 0, "no spawn attempt is made when the provider's binary does not resolve");
      assert.equal(result.outcome, "failed");
    },
  },
  {
    name: "arch/38 ADR-013 (acd-worker-driver-no-headless-print): invariant 3 — the directive command is typed into PTY stdin as ONE write; the launch argv may carry --append-system-prompt but NEVER -p/--print/--output-format (structural shape + BEHAVIOURAL)",
    run: async () => {
      const raw = await readFile(DRIVER_SOURCE, "utf8");
      const stripped = stripComments(raw);
      assert.equal(typesCommandIntoPtyStdin(stripped), true, "the real source types brief.command into term.write, not a -p argv");

      const planted = stripped.replace(/term\.write\(\s*`\$\{command\}\\r`\s*\);/, "/* command intentionally not written */");
      assert.notEqual(planted, stripped, "the plant actually changed the source text");
      assert.equal(typesCommandIntoPtyStdin(planted), false, "a driver that never types the command into stdin trips the detector");

      // BEHAVIOURAL — the REAL driver, a distinguishing command string. GREEN AFTER the
      // developer appends the NEEDS_INPUT --append-system-prompt arg (invariant 6): the
      // pre-build launch argv is empty (`spawnCalls[0].args === []`), so the argv shape
      // assertions below fail until the producer is built — by design (F-38.05).
      const which = createFakeWhich(["claude"]);
      const { spawn, spawnCalls, ptys } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const command = "/aof:verify 38/05";
      await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => null },
      );
      const launchArgs = spawnCalls[0].args;
      // The NEEDS_INPUT producer rides the launch argv as a worker-scoped
      // --append-system-prompt (option C) — the command itself NEVER rides the argv.
      // Located by INDEX rather than assumed at [0]: F24 (live soak) prepends
      // `--permission-mode auto` ahead of it, so the append flag is no longer first —
      // its PRESENCE + the instruction it carries is the invariant, not its position.
      const appendIdx = launchArgs.indexOf("--append-system-prompt");
      assert.ok(appendIdx !== -1, "the interactive launch appends the NEEDS_INPUT system-prompt instruction as a worker-scoped launch arg");
      assert.equal(typeof launchArgs[appendIdx + 1], "string", "the appended system-prompt instruction is a string arg");
      assert.ok(launchArgs[appendIdx + 1].includes(NEEDS_INPUT_SENTINEL), "the appended system prompt instructs the agent to emit the NEEDS_INPUT sentinel (producer + detector share the literal)");
      assert.ok(
        !launchArgs.includes("-p") && !launchArgs.includes("--print") && !launchArgs.includes("--output-format"),
        "the launch carries no headless-print flag (-p/--print/--output-format)",
      );
      assert.deepEqual(ptys[0].writes, [`${command}\r`], "the command lands in exactly one pty.write, as a whole carriage-return-terminated line (Enter = \\r, F27b) — never the spawn argv");
    },
  },
  {
    name: "arch/38 ADR-013 amendment (acd-worker-driver-no-headless-print): invariant 4 — session_id is captured by the TRANSCRIPT-DIR WATCH (real producer, not the retired PTY marker) and surfaced on done/needs-input frames (structural shape + BEHAVIOURAL)",
    run: async () => {
      const raw = await readFile(DRIVER_SOURCE, "utf8");
      const stripped = stripComments(raw);

      // PRODUCER half — GREEN AFTER the developer builds the transcript-dir watch
      // (reuses claudeProjectsDir from ./work-observe.mjs + the
      // defaultWatchTranscriptSessionId seam). This is the invariant whose pre-amendment
      // green LOCKED IN the producerless AOF_SESSION_ID: marker (F-38.05).
      assert.equal(
        capturesSessionIdViaTranscriptWatch(raw, stripped),
        true,
        "the real source captures sessionId via the transcript-dir watch: claudeProjectsDir imported from ./work-observe.mjs AND called, the defaultWatchTranscriptSessionId seam defined, and options.watchTranscriptSessionId wired to it",
      );
      // Self-check: sever the injected-seam wiring → the producer detector trips.
      const plantedNoWatch = stripped.replace(/options\.watchTranscriptSessionId\s*\?\?\s*defaultWatchTranscriptSessionId/, "null /* producer removed */");
      assert.notEqual(plantedNoWatch, stripped, "the plant actually changed the source text");
      assert.equal(capturesSessionIdViaTranscriptWatch(raw, plantedNoWatch), false, "a driver that no longer wires the transcript-watch seam trips the detector");

      // SURFACING half — GREEN NOW (the done + needs-input frames already carry sessionId).
      assert.equal(surfacesSessionIdOnStatusFrames(stripped), true, "sessionId is surfaced on BOTH the done and needs-input status frames");
      // Self-check: revert the done frame to the pre-story-05 discard shape.
      const plantedDiscard = stripped.replace(
        /sendAssignmentStatus\?\.\(\s*assignmentId,\s*["']done["'],\s*\{\s*runId:\s*runRecord\.runId,\s*sessionId\s*\}\s*\)/,
        'sendAssignmentStatus?.(assignmentId, "done", { runId: runRecord.runId })',
      );
      assert.notEqual(plantedDiscard, stripped, "the plant actually changed the source text");
      assert.equal(surfacesSessionIdOnStatusFrames(plantedDiscard), false, "a done status frame that discards sessionId trips the detector");

      // BEHAVIOURAL — the REAL driver threads the watch seam's resolved id onto the SAME
      // resolved outcome (the ADR-amendment contract: finish awaits the aborted watch).
      // GREEN AFTER the developer wires the seam; the pre-build driver ignores the
      // injected seam (it reads the retired PTY marker), so result.sessionId is null.
      const which = createFakeWhich(["claude"]);
      const { spawn, ptys } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:continue" },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => "sess-fitness-check" },
      );
      assert.equal(result.outcome, "done");
      assert.equal(result.sessionId, "sess-fitness-check", "the driver's OWN return value carries the session_id resolved by the injected transcript-watch seam — never discarded, never re-derived from PTY bytes");
      assert.equal(ptys[0].writes.length, 1, "sanity: exactly one pty.write happened (the command)");
    },
  },
  {
    name: "arch/38 ADR-013 amendment (acd-worker-driver-no-headless-print): invariant 6 — the NEEDS_INPUT producer EXISTS (NEEDS_INPUT_INSTRUCTION embeds the sentinel and rides a worker-scoped --append-system-prompt launch arg)",
    run: async () => {
      const raw = await readFile(DRIVER_SOURCE, "utf8");
      const stripped = stripComments(raw);

      // GREEN AFTER the developer builds the producer (option C). This is the crux: a
      // revert to "no producer" (an empty interactive launch argv) MUST fail here.
      assert.equal(
        hasNeedsInputProducer(stripped),
        true,
        "the real source defines NEEDS_INPUT_INSTRUCTION embedding ${NEEDS_INPUT_SENTINEL} and appends it to the interactive launch via --append-system-prompt (ADR-013 amendment, option C)",
      );

      // Self-check: remove the launch append → the producer no longer reaches the spawn.
      const plantedNoAppend = stripped.replace(/["']--append-system-prompt["'],\s*NEEDS_INPUT_INSTRUCTION/, "/* NEEDS_INPUT producer removed */");
      assert.notEqual(plantedNoAppend, stripped, "the plant actually changed the source text");
      assert.equal(hasNeedsInputProducer(plantedNoAppend), false, "a launch that no longer appends the NEEDS_INPUT system-prompt instruction trips the detector");
    },
  },
  {
    name: "arch/38 ADR-013 (acd-worker-driver-no-headless-print): invariant 5 — a needs-input outcome's branch calls NO removeWorktree/force:true (structural, block-isolated) — that call site exists ONLY on the done path (BEHAVIOURAL)",
    run: async () => {
      const raw = await readFile(DRIVER_SOURCE, "utf8");
      const stripped = stripComments(raw);
      assert.equal(needsInputRetainsWorktree(stripped), true, "the needs-input branch's own body never calls removeWorktree or names force:true, and returns before reaching the done branch's cleanup");

      // Self-check: plant a force-remove INSIDE the needs-input branch (a direct
      // structural regression of the retention invariant).
      const plantedBody = needsInputBranchBody(stripped);
      assert.ok(plantedBody != null, "the needs-input branch is present in the real source (precondition for the plant)");
      const plantedSource = stripped.replace(plantedBody, `${plantedBody}\n await removeWorktree(ws.projectRoot, assignmentId, { exec, force: true });\n`);
      assert.notEqual(plantedSource, stripped, "the plant actually changed the source text");
      assert.equal(needsInputRetainsWorktree(plantedSource), false, "a needs-input branch that force-removes its worktree trips the detector");

      // BEHAVIOURAL re-proof — the REAL driveInteractiveClaudeSession's own outcome
      // shape for a NEEDS_INPUT-sentinel-ended session (the worktree-removal decision
      // itself is the HANDLER's job, exercised end-to-end in
      // test/mesh-worker-driver-needs-input.test.mjs; here we re-confirm the DRIVER
      // never signals "done" for a sentinel-ended turn, the precondition the
      // handler's retain-branch depends on). The DETECTION mechanism
      // (containsNeedsInputSentinel) is unchanged by the amendment — only the PRODUCER
      // (the --append-system-prompt instruction) is added.
      const which = createFakeWhich(["claude"]);
      const { spawn } = createFakePtySpawn({ onWrite: ({ emitData }) => emitData(`...\n${NEEDS_INPUT_SENTINEL}\n`) });
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 38/05 --autonomous" },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => null },
      );
      assert.equal(result.outcome, "needs-input");
      assert.notEqual(result.outcome, "done");
    },
  },
  {
    name: "arch/38 ADR-013 (acd-worker-driver-no-headless-print): this fitness test and the 4 task-traceability test files are registered in scripts/test.mjs",
    run: async () => {
      const suite = await readFile(TEST_SUITE, "utf8");
      assert.ok(
        suite.includes("test/arch/acd-worker-driver-no-headless-print.test.mjs") && suite.includes("...acdWorkerDriverNoHeadlessPrintTests"),
        "acd-worker-driver-no-headless-print is imported and spread into the registered suite",
      );
      for (const [file, spread] of [
        ["test/mesh-worker-driver-interactive-pty.test.mjs", "...meshWorkerDriverInteractivePtyTests"],
        ["test/mesh-worker-driver-directive-command.test.mjs", "...meshWorkerDriverDirectiveCommandTests"],
        ["test/mesh-worker-driver-needs-input.test.mjs", "...meshWorkerDriverNeedsInputTests"],
        ["test/mesh-worker-driver-session-id.test.mjs", "...meshWorkerDriverSessionIdTests"],
      ]) {
        assert.ok(suite.includes(file) && suite.includes(spread), `${file} is imported and spread into the registered suite`);
      }
    },
  },
];
