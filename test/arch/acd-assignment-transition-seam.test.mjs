// Fitness function: acd-assignment-transition-seam (milestone 42 wave (d) leg d3;
// PRD-command-spine-effects-ledger: "the apply-seam guards (holder,
// terminal-never-regresses) move inside the shared transition so ALL writers
// inherit them").
//
// THE INVARIANT — one transition seam in front of the assignment fact.
// `updateAssignmentState` is guard-free by design; its two invariants used to live
// at ONE of its three call sites (the control stream's apply handler), which is why
// the withdraw verb carried a weaker re-derivation and the reclaim tick carried
// none. This gate pins the cure structurally, the `completeRun` precedent in
// acd-effects-ledger:
//
//   (1) REACHABILITY — `updateAssignmentState` is called only from its own store
//       module and from effects/assignment-transitions.mjs. Any other writer would
//       be a door around the guards.
//   (2) THE GUARDS ARE THE SEAM'S — the apply handler no longer decides them: its
//       body contains no holder comparison against `target_node_id` and no
//       terminal-state branch; it calls the transition instead.
//   (3) THE RULES THEMSELVES still hold, proven by running the pure guard over the
//       matrix rather than by grepping for its text: unknown row, non-holder,
//       every terminal state, the ONE sanctioned resume revival, and the active
//       states that must pass.
//   (4) The settle raises its declared event — `assignment.settled` is in the
//       closed vocabulary with its `control-store` reactor, so the branch record
//       that used to be an inline line at the apply seam is now a ledger entry.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guardAssignmentTransition } from "../../src/effects/assignment-transitions.mjs";
import { EFFECTS } from "../../src/effects/table.mjs";
import { ACTIVE_ASSIGNMENT_STATES, TERMINAL_ASSIGNMENT_STATES } from "../../src/assignment-record.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");

// The ONLY modules that may name the guard-free store writer.
const SANCTIONED_WRITERS = new Set(["assignment-record.mjs", "effects/assignment-transitions.mjs"]);

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function sourcesUnderSrc() {
  const { readdir } = await import("node:fs/promises");
  const out = [];
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else if (entry.name.endsWith(".mjs")) out.push(rel);
    }
  };
  await walk(SRC, "");
  return out;
}

export const archTests = [
  {
    name: "arch/42 wave (d) d3 (acd-assignment-transition-seam): updateAssignmentState( is called only from its own store module and the transition seam",
    run: async () => {
      const offenders = [];
      for (const rel of await sourcesUnderSrc()) {
        if (SANCTIONED_WRITERS.has(rel)) continue;
        const source = stripComments(await readFile(path.join(SRC, rel), "utf8"));
        if (/\bupdateAssignmentState\s*\(/.test(source)) offenders.push(rel);
      }
      assert.deepEqual(
        offenders,
        [],
        `the guard-free assignment writer is reachable only through the transition seam (found direct callers: ${offenders.join(", ")}). ` +
          "Route the write through transitionAssignmentState — the holder and terminal-never-regresses guards live in front of it.",
      );

      // self-check: the detector matches the call form, not a mention.
      assert.ok(/\bupdateAssignmentState\s*\(/.test("const x = updateAssignmentState(store, id, 'done');"));
      assert.ok(!/\bupdateAssignmentState\s*\(/.test(stripComments("// updateAssignmentState(store, id) is the writer")));
    },
  },
  {
    name: "arch/42 wave (d) d3: applyAssignmentStatusFrame decides neither invariant itself — it hands the edge to the transition",
    run: async () => {
      const source = stripComments(await readFile(path.join(SRC, "control-stream-server.mjs"), "utf8"));
      const start = source.indexOf("export async function applyAssignmentStatusFrame");
      assert.ok(start > -1, "applyAssignmentStatusFrame is still the frame door");
      const body = source.slice(start, source.indexOf("\nexport ", start + 10));

      assert.ok(
        /transitionAssignmentState\s*\(/.test(body),
        "the apply handler routes the write through transitionAssignmentState",
      );
      assert.ok(
        !/target_node_id\s*!==/.test(body),
        "the apply handler no longer compares target_node_id itself — the holder guard is the seam's",
      );
      assert.ok(
        !/isActiveAssignmentState\s*\(\s*existing\.state\s*\)/.test(body),
        "the apply handler no longer branches on the row's terminal state — that guard is the seam's",
      );
      assert.ok(
        !/setItemBranch\s*\(/.test(body),
        "the done-branch record is a declared reactor now, not an inline consequence at the frame door",
      );
    },
  },
  {
    name: "arch/42 wave (d) d3: the guard itself refuses unknown/non-holder/terminal and permits ONLY the resume revival (behavioural, over the whole state matrix)",
    run: async () => {
      const holder = "worker-a";
      const row = (state) => ({ state, target_node_id: holder, workspace_id: "ws-1" });

      assert.equal(guardAssignmentTransition(null, "running", {}).code, "assignment-status-unknown-assignment");
      assert.equal(
        guardAssignmentTransition(row("running"), "done", { byNode: "worker-b" }).code,
        "assignment-status-not-holder",
        "a frame on another node's connection can never advance this row",
      );
      // Control-side writers pass no byNode — they are the issuer, not the holder.
      assert.equal(guardAssignmentTransition(row("running"), "withdrawn", {}).ok, true);

      for (const state of ACTIVE_ASSIGNMENT_STATES) {
        assert.equal(guardAssignmentTransition(row(state), "done", { byNode: holder }).ok, true, `${state} → done is allowed`);
      }
      for (const state of TERMINAL_ASSIGNMENT_STATES) {
        const verdict = guardAssignmentTransition(row(state), "failed", { byNode: holder });
        assert.equal(verdict.ok, false, `${state} is terminal — it never regresses`);
        assert.equal(verdict.code, "assignment-status-already-terminal");
        assert.equal(verdict.workspaceId, "ws-1", "the refusal carries the row's workspace, as the seam's callers expect");
      }

      // The ONE exception, and its exact shape.
      assert.equal(
        guardAssignmentTransition(row("failed"), "running", { byNode: holder, code: "resumed" }).ok,
        true,
        "failed → running with the resume code revives (a control-dispatched resume IS a run continuing)",
      );
      assert.equal(
        guardAssignmentTransition(row("failed"), "running", { byNode: holder }).ok,
        false,
        "…but only WITH the resume code — a stale startup-reclaim broadcast carries none",
      );
      assert.equal(
        guardAssignmentTransition(row("done"), "running", { byNode: holder, code: "resumed" }).ok,
        false,
        "…and only from failed — done means done",
      );
      assert.equal(
        guardAssignmentTransition(row("failed"), "running", { byNode: "worker-b", code: "resumed" }).ok,
        false,
        "…and still holder-only",
      );
    },
  },
  {
    name: "arch/42 wave (d) d3: assignment.settled is in the closed vocabulary with its control-store reactor",
    run: async () => {
      const reactors = EFFECTS["assignment.settled"];
      assert.ok(Array.isArray(reactors) && reactors.length > 0, "assignment.settled is declared in EFFECTS");
      const branch = reactors.find((entry) => entry.key === "record-item-branch");
      assert.ok(branch, "the done-branch record is a declared reactor");
      assert.equal(branch.locus, "control-store", "it mutates the authoritative mesh store, so that is its locus");
      assert.equal(typeof branch.apply, "function");
    },
  },
];
