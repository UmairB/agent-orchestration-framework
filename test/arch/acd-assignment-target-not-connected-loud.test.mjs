// Fitness function: acd-assignment-target-not-connected-loud (milestone 35 / ADR-002 /
// 34-ADR-008, fitness #6). "An assign to an unknown/ineligible target — OR a directive
// to a node with no live socket in the WS targeting map — emits a coded,
// operator-visible refusal, never a silent return/drop."
//
// TWO HALVES, one file (coordinated per STORY.md — extend, never duplicate):
//   - CONTROL half (story 00, unchanged below): the `aof mesh assign` verb's
//     assign-time gate.
//   - CHANNEL half (story 01, appended below): the live WS targeting map's
//     sendDirective — a target with NO live socket is the SAME coded
//     assignment-target-not-connected refusal, and writes NO frame anywhere.
//
// Story 00 owns the control-side gate: an assign to an unknown nodeId, or a known node
// that does not hold the workspace's published repo, is refused with a CODED error —
// never a silent success/return. This test asserts:
//  1. Structural — every miss branch in the assign path emits a non-empty `code`
//     literal; no branch returns `{ ok:false }` (or bare `null`/`undefined`) without a
//     code — a silent-refusal shape never appears.
//  2. Behavioural — assigning to an absent/unknown nodeId yields a coded error, no
//     assignment minted.
//  Self-check (m03 non-vacuous): a planted silent-return miss branch (no code emitted)
//  fails the SAME structural detector the real (loud) source passes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assignWork } from "../../src/mesh-assignment.mjs";
import { withMeshAssignFixture, readAssignmentRows } from "../support/mesh-assign-fixture.mjs";
import { sendDirective, buildDirectiveFrame, ASSIGNMENT_TARGET_NOT_CONNECTED } from "../../src/control-stream-server.mjs";
import { createDirectiveChannelFixture } from "../support/mesh-directive-channel-fixture.mjs";


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const assignSourcePath = path.join(repoRoot, "src", "mesh-assignment.mjs");
const controlStreamServerSourcePath = path.join(repoRoot, "src", "control-stream-server.mjs");

// Every `{ ok: false, ... }` object literal in the source must carry a `code` field on
// the SAME literal (never a silent `{ ok:false }` with no code). A brace-balanced scan
// (not a naive `[^}]*` regex) so a nested template-literal `${...}` inside an `error:`
// message does not prematurely close the match.
function findSilentRefusals(source) {
  const silent = [];
  const anchorRe = /\{\s*ok:\s*false\s*,/g;
  let match;
  while ((match = anchorRe.exec(source)) !== null) {
    const start = match.index;
    let depth = 0;
    let end = start;
    let inTemplate = false;
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "`") inTemplate = !inTemplate;
      if (!inTemplate) {
        if (ch === "{") depth += 1;
        if (ch === "}") {
          depth -= 1;
          if (depth === 0) { end = i + 1; break; }
        }
      }
    }
    const literal = source.slice(start, end);
    if (!/\bcode\s*[:,]/.test(literal) && !/\.\.\.\w*[Ee]xtra/.test(literal)) {
      silent.push(literal.replace(/\s+/g, " ").slice(0, 80));
    }
  }
  return silent;
}

export const archTests = [
  {
    name: "arch/35 ADR-002/34-ADR-008 (acd-assignment-target-not-connected-loud, control half): every ok:false miss branch in the assign path carries a non-empty code (structural)",
    run: async () => {
      const source = await readFile(assignSourcePath, "utf8");
      const silent = findSilentRefusals(source);
      assert.deepEqual(silent, [], `silent (codeless) ok:false refusal literals found: ${JSON.stringify(silent)}`);

      // Every named code literal used at a miss branch is non-empty and stable.
      const codes = [...source.matchAll(/code:\s*["']([\w-]+)["']/g)].map((m) => m[1]);
      assert.ok(codes.includes("assignment-target-unknown"), "the unknown-target refusal code is present");
      assert.ok(codes.includes("assignment-repo-unavailable"), "the repo-unavailable refusal code is present");
      assert.ok(codes.includes("assignment-already-active"), "the already-active refusal code is present");
      assert.ok(codes.includes("ref-not-found"), "the ref-not-found refusal code is present");
      assert.ok(codes.every((code) => code.length > 0), "every code literal is non-empty");
    },
  },
  {
    name: "arch/35 ADR-002/34-ADR-008 (acd-assignment-target-not-connected-loud, control half): assigning to an absent/unknown nodeId yields a coded error, no assignment minted (behavioural)",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home }) => {
      const result = await assignWork(workspace, "35/00", "nobody-home", { ...ctx, now: "2026-07-08T10:00:00.000Z" });
      assert.equal(result.ok, false);
      assert.ok(typeof result.code === "string" && result.code.length > 0, "a coded refusal is emitted, never a silent return");
      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 0, "no assignment is minted");
    }),
  },
  {
    name: "arch/35 ADR-002/34-ADR-008 (acd-assignment-target-not-connected-loud, control half): self-check — a planted silent ok:false literal trips the SAME structural detector the real (loud) source passes",
    run: async () => {
      const source = await readFile(assignSourcePath, "utf8");
      assert.deepEqual(findSilentRefusals(source), [], "the real source is clean");

      const plantedSilent = `${source}\nfunction silentMiss() { return { ok: false, error: "nope" }; }\n`;
      assert.ok(findSilentRefusals(plantedSilent).length > 0, "a planted codeless ok:false literal trips the detector");
    },
  },
  // ---- CHANNEL half (story 01): the live WS targeting map's "not connected" miss.
  {
    name: "arch/35 ADR-002/34-ADR-008 (acd-assignment-target-not-connected-loud, channel half): sendDirective to a node with no live socket is a coded refusal, no frame written anywhere (behavioural)",
    run: async () => {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      // no connection for "worker-b" at all — the targeting map has no entry.
      const result = sendDirective(channel.targets, "worker-b", buildDirectiveFrame("worker-b", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: "2026-07-09T10:00:00.000Z" }));
      assert.equal(result.sent, false);
      assert.equal(result.code, ASSIGNMENT_TARGET_NOT_CONNECTED, "the SAME coded refusal the control-side gate uses");
      assert.equal(workerA.frames.length, 0, "no directive frame is written to any socket");
    },
  },
  {
    name: "arch/35 ADR-002/34-ADR-008 (acd-assignment-target-not-connected-loud, channel half): a target whose connection has closed is the same coded refusal, never a silent drop (behavioural)",
    run: async () => {
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      channel.disconnectWorker("worker-a", { via: "close" });
      const result = sendDirective(channel.targets, "worker-a", buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: "2026-07-09T10:00:00.000Z" }));
      assert.equal(result.sent, false);
      assert.equal(result.code, ASSIGNMENT_TARGET_NOT_CONNECTED);
    },
  },
  {
    name: "arch/35 ADR-002/34-ADR-008 (acd-assignment-target-not-connected-loud, channel half): structural — sendDirective's miss branch always returns the coded literal, never a bare falsy/silent return",
    run: async () => {
      const source = await readFile(controlStreamServerSourcePath, "utf8");
      const fn = source.match(/export function sendDirective\([^)]*\)\s*\{[\s\S]*?\n\}/);
      assert.ok(fn, "sendDirective is defined");
      assert.ok(
        /ASSIGNMENT_TARGET_NOT_CONNECTED/.test(fn[0]) && /return\s*\{\s*sent:\s*false/.test(fn[0]),
        "the miss branch returns a structured { sent:false, code:... } — never a bare return/undefined",
      );
      assert.ok(!/return;\s*\}\s*$/.test(fn[0].split("if")[1] ?? ""), "no silent bare-return miss branch");
    },
  },
  {
    name: "arch/35 ADR-002/34-ADR-008 (acd-assignment-target-not-connected-loud, channel half): self-check — a planted silent-return miss branch (no code emitted) fails the structural detector",
    run: async () => {
      const plantedSilent = `
export function sendDirectiveSilentMiss(targets, nodeId, directive) {
  const ws = targets.get(nodeId);
  if (ws == null) {
    return; // silent drop — the defect this fitness catches
  }
  ws.send(JSON.stringify(directive));
}
`;
      const fn = plantedSilent.match(/export function sendDirectiveSilentMiss\([^)]*\)\s*\{[\s\S]*?\n\}/);
      assert.ok(fn, "the planted function parses");
      const isLoud = /ASSIGNMENT_TARGET_NOT_CONNECTED/.test(fn[0]) && /return\s*\{\s*sent:\s*false/.test(fn[0]);
      assert.equal(isLoud, false, "the planted silent-return miss trips the detector (fails the loud-shape check)");
    },
  },
];
