// Fitness function for milestone 11 / ADR-004 + ADR-006 inv. 3 (advisory-only / no
// auto-act):
// "No `graph:*` output from any 11 seam feeds a gate / merge / status-write /
//  work-mutation; the grounding is read-and-inject into agent CONTEXT only. The agent
//  decides; the graph informs. Concretely: the architect/refine/code-review grounding
//  steps inject graph output into the agent's context as a consider/cite instruction;
//  no seam wires graph output into a CI gate, the code-review merge decision
//  (`work.codeReview.autoComplete`), or a STORY.md/SPEC.md/STATE.md status/work write.
//  The triage queue is ranking context for the reviewer, never an auto-block input."
//
// This is the milestone's load-bearing invariant (SPEC §Out of scope). The house
// idiom is source-grep over the BUNDLED seams (markdown read as text). The assertion
// is ROBUST — not one magic word: each seam must carry BOTH the advisory-and-inform
// property (informs/consider/cite + an explicit advisory-only framing) AND the
// no-auto-act property (never auto-fail/auto-block/auto-rewrite; merge gate unchanged;
// no graph output piped into a gate/merge/status-write).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bundleDir = path.join(repoRoot, "src", "bundle");

const SEAMS = {
  architect: path.join(bundleDir, "agents", "aof-architect.md"),
  refine: path.join(bundleDir, "commands", "refine.md"),
  codeReview: path.join(bundleDir, "commands", "code-review.md"),
};

export const archTests = [
  {
    name: "arch/codebase-grounding-advisory: each 11 seam frames the grounding as ADVISORY — the graph informs the agent's judgment, it does not dictate it",
    run: async () => {
      // The advisory-and-inform property: each seam must explicitly carry the
      // advisory-only framing AND the informs-not-dictates / consider-cite shape (the
      // grounding is read-and-inject into the agent's context — the agent decides).
      for (const [label, file] of Object.entries(SEAMS)) {
        const text = await readFile(file, "utf8");
        // (1) an explicit advisory framing — "Advisory only" / "(advisory)".
        assert.match(
          text,
          /advisory only|advisory\)/i,
          `${label} carries an explicit ADVISORY framing on the grounding step`
        );
        // (2) the graph INFORMS / is CONTEXT the agent CONSIDERs and CITEs — it does not
        //     decide. Assert the inform-not-dictate property is present (robust: any of
        //     the consider/cite/informs/context forms, not one magic word).
        assert.match(
          text,
          /\binforms?\b[\s\S]{0,60}?(judgment|it|the partition|never)|\bcite\b|as (ranking )?context|consider the/i,
          `${label} injects the graph as context the agent CONSIDERs / CITEs / is INFORMED by (read-and-inject, not dictate)`
        );
      }
    },
  },
  {
    name: "arch/codebase-grounding-advisory: no 11 seam pipes graph output into a gate / merge / auto-act — the graph never auto-fails, auto-blocks, or auto-rewrites",
    run: async () => {
      // The no-auto-act property, per consumer. architect + refine (graph:query
      // coupling): tight coupling does not auto-fail the review / auto-rewrite the
      // boundary, and no graph output feeds a gate or work-mutation.
      const architect = await readFile(SEAMS.architect, "utf8");
      const refine = await readFile(SEAMS.refine, "utf8");

      assert.match(
        architect,
        /does not auto-fail|never auto-fails?|auto-rewrites? a boundary/i,
        "aof-architect: tight coupling does not auto-fail the review / the graph never auto-rewrites a boundary"
      );
      assert.match(
        architect,
        /no graph\s+output feeds a gate,\s+merge,\s+status-write,\s+or work-mutation/i,
        "aof-architect: no graph output feeds a gate / merge / status-write / work-mutation"
      );
      assert.match(
        refine,
        /never auto-rewrites? it|auto-rewrites? it,? never/i,
        "refine: the graph informs the partition, it never auto-rewrites it"
      );
      assert.match(
        refine,
        /no graph\s+output feeds a gate or\s+work-mutation/i,
        "refine: no graph output feeds a gate or work-mutation"
      );
    },
  },
  {
    name: "arch/codebase-grounding-advisory: the code-review triage queue is RANKING CONTEXT for the reviewer, NEVER an auto-block input — the merge gate stays unchanged",
    run: async () => {
      // The code-review seam (graph:triage) is the highest-temptation surface (a ranked
      // PR queue invites an auto-block). Assert it is explicitly ranking-context, never
      // an auto-block, and the merge gate is unchanged with no wiring into autoComplete.
      const codeReview = await readFile(SEAMS.codeReview, "utf8");

      assert.match(
        codeReview,
        /ranking context/i,
        "code-review: the triage queue is RANKING CONTEXT for the reviewer"
      );
      assert.match(
        codeReview,
        /never[\s\S]{0,40}?auto-block|not[\s\S]{0,20}?an auto-block/i,
        "code-review: the triage is NEVER an auto-block input to the merge"
      );
      assert.match(
        codeReview,
        /merge gate[\s\S]{0,80}?(is \*\*unchanged\*\*|unchanged)/i,
        "code-review: the merge gate (CI-green + no-blocking-finding) is explicitly UNCHANGED"
      );
      // No NEW wiring of graph output into the auto-complete merge decision.
      assert.match(
        codeReview,
        /no wiring into[\s\S]{0,20}?work\.codeReview\.autoComplete|never a separate graph-gate/i,
        "code-review: no graph output is wired into work.codeReview.autoComplete / no separate graph-gate"
      );
    },
  },
  {
    name: "arch/codebase-grounding-advisory: no 11 seam wires graph output into a status/work write (no auto-mutation of STATE.md/STORY.md/SPEC.md from graph findings)",
    run: async () => {
      // ADR-004 forbids a graph finding auto-mutating a work record. The seams may have
      // the agent CITE a graph finding in its prose verdict (human/agent-authored
      // narrative), but no seam pipes `graph:*` output into an automated status/work
      // write. Assert no seam contains a directive that writes a graph finding into a
      // work doc automatically (e.g. "write the graph finding to STATE.md").
      for (const [label, file] of Object.entries(SEAMS)) {
        const text = await readFile(file, "utf8");
        assert.ok(
          !/(auto-?write|automatically write|write the (graph|triage|coupling)[^\n]{0,40}(finding|output|result)[^\n]{0,40}(to|into)[^\n]{0,20}(STATE|STORY|SPEC)\.md)/i.test(text),
          `${label} does not auto-write a graph finding into a STATE.md/STORY.md/SPEC.md work record`
        );
        // And no seam pipes graph output into a CI pass/fail gate token.
        assert.ok(
          !/graph[^\n]{0,40}(output|finding|rank|triage)[^\n]{0,40}(fails? CI|blocks? the merge|sets? (the )?(status|verdict) (to )?(fail|block))/i.test(text),
          `${label} does not pipe graph output into a CI pass/fail gate or an automated block`
        );
      }
    },
  },
];
