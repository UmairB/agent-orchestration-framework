// Traceability wiring for milestone 10 / story 02 (extraction-posture-and-fallback),
// task 00 — 00_claude-cli-classified-and-surfaced.feature.
//
// Covers EVERY @executable scenario AND every Scenario-Outline Examples row of that
// feature against the REAL pure classifiers in ../src/commands/graph-build.mjs
// (isNetworkBackend / isKnownNetworkBackend / classifyEgress) and the REAL graphify
// backend's `status` surface, driven through the REAL seam (`runMemory`). No live
// graphify binary is touched: the classifiers are pure functions of the backend name,
// and status reads an (absent) store on an isolated projectRoot.
//
//   00_claude-cli-classified-and-surfaced.feature
//     — claude-cli is a network-crossing backend (by KNOWLEDGE, not fall-through)
//     — claude-cli's egress is docs-media (the doc/media hop ran)
//     — ollama is the only data-local backend, yet its egress is still docs-media
//     — Outline: each backend classifies to its honest (isNetwork, egress) pair
//     — status surfaces the chosen extraction backend "claude-cli"
//     — @manual: the live --backend claude-cli build (referenced, not re-run — it is
//       evidenced in this milestone's VERIFICATION.md by story 00's live reindex run)
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import {
  isNetworkBackend,
  isKnownNetworkBackend,
  classifyEgress,
} from "../src/commands/graph-build.mjs";
import { runMemory, resolveConfiguredBackend } from "../src/work-memory.mjs";

// An isolated projectRoot so status reads no real store (recordCount 0, never throws,
// reaches NO graphify binary).
async function freshProjectRoot() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-graphify-posture-"));
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  return projectRoot;
}

// Run `aof work memory status --json` through the REAL registry with graphify selected.
async function runStatusJson() {
  const projectRoot = await freshProjectRoot();
  const lines = [];
  const ctx = { workDir: path.join(projectRoot, "wiki", "work"), projectRoot, configMemory: { backend: "graphify" } };
  const outcome = await runMemory(["status", "--json"], {
    config: { memory: { backend: "graphify" } },
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx,
    log: (l) => lines.push(l),
  });
  return { outcome, parsed: JSON.parse(lines.join("\n")) };
}

export const graphifyPostureTests = [
  // ====================================================================
  // 00_claude-cli-classified-and-surfaced.feature
  // ====================================================================
  {
    name: "graphify/posture: claude-cli is a network-crossing backend by KNOWLEDGE, not the unknown-name fall-through",
    run: async () => {
      // isNetworkBackend("claude-cli") is true (billed-to-plan is not on-box).
      assert.equal(isNetworkBackend("claude-cli"), true, 'isNetworkBackend("claude-cli") is true');
      // ...and the classification is BY KNOWLEDGE (registered in NETWORK_BACKENDS), not
      // by the fail-closed fall-through an unknown name would hit (ADR-003 — an
      // unmodelled value is a latent bug the moment the default changes).
      assert.equal(isKnownNetworkBackend("claude-cli"), true, "claude-cli is a KNOWN network backend (enumerated, not fall-through)");
      // Contrast: a genuinely unknown name is network only by the fall-through, NOT by
      // knowledge — proving the claude-cli classification is the deliberate, enumerated one.
      assert.equal(isNetworkBackend("totally-unknown-backend"), true, "an unknown name still falls closed to network");
      assert.equal(isKnownNetworkBackend("totally-unknown-backend"), false, "but an unknown name is NOT known — it is the fall-through path");
    },
  },
  {
    name: 'graphify/posture: claude-cli\'s egress is "docs-media" (the doc/media hop ran)',
    run: async () => {
      assert.equal(classifyEgress("claude-cli"), "docs-media", 'classifyEgress("claude-cli") is "docs-media"');
    },
  },
  {
    name: "graphify/posture: ollama is the only data-local backend, yet its egress is still docs-media",
    run: async () => {
      assert.equal(isNetworkBackend("ollama"), false, 'isNetworkBackend("ollama") is false');
      assert.equal(classifyEgress("ollama"), "docs-media", 'classifyEgress("ollama") is "docs-media" (the hop ran)');
      // ollama remains the ONLY backend for which isNetworkBackend is false: every other
      // KNOWN backend (the network APIs + claude-cli) crosses the network; null is the
      // no-backend floor (false, but it is the absence of a backend, not a local one).
      const KNOWN_BACKENDS = ["claude", "claude-cli", "gemini", "openai", "kimi", "deepseek", "ollama"];
      const localBackends = KNOWN_BACKENDS.filter((b) => isNetworkBackend(b) === false);
      assert.deepEqual(localBackends, ["ollama"], "ollama is the ONLY backend whose isNetworkBackend is false");
    },
  },
  // Scenario Outline: each backend classifies to its honest (isNetwork, egress) pair.
  //   | backend      | isNetwork | egress       |
  //   | "claude-cli" | true      | "docs-media" |
  //   | "ollama"     | false     | "docs-media" |
  //   | "claude"     | true      | "docs-media" |
  //   | null         | false     | "none"       |
  ...[
    { backend: "claude-cli", isNetwork: true, egress: "docs-media" },
    { backend: "ollama", isNetwork: false, egress: "docs-media" },
    { backend: "claude", isNetwork: true, egress: "docs-media" },
    { backend: null, isNetwork: false, egress: "none" },
  ].map((row) => ({
    name: `graphify/posture: outline — backend ${JSON.stringify(row.backend)} classifies to (isNetwork=${row.isNetwork}, egress=${row.egress})`,
    run: async () => {
      assert.equal(isNetworkBackend(row.backend), row.isNetwork, `isNetworkBackend(${JSON.stringify(row.backend)}) is ${row.isNetwork}`);
      assert.equal(classifyEgress(row.backend), row.egress, `classifyEgress(${JSON.stringify(row.backend)}) is "${row.egress}"`);
    },
  })),
  {
    name: 'graphify/posture: status surfaces the chosen extraction backend "claude-cli" (visible, never a silent network default)',
    run: async () => {
      const { outcome, parsed } = await runStatusJson();
      assert.equal(outcome.exitCode, 0, "the command exits 0");
      assert.equal(parsed.backend, "graphify", "status reports backend graphify");
      assert.equal(parsed.extractionBackend, "claude-cli", 'status surfaces the extraction backend "claude-cli"');
      // The honest egress label travels with it (ADR-003): the doc/media hop is "docs-media".
      assert.equal(parsed.extractionEgress, "docs-media", "status surfaces the honest egress label docs-media");
    },
  },
  {
    // @manual — the live, keyless `--backend claude-cli` build. This row REFERENCES the
    // evidence already captured live in this milestone's VERIFICATION.md (story 00's
    // ~27-min reindex run: graphify reported `via claude-cli` / `~claude-cli: $0.0000`
    // with ANTHROPIC_API_KEY unset throughout, egress "docs-media"). It is NOT re-run in
    // CI (it needs the live binary + a logged-in Claude Code session). The aof-side
    // contract — the extraction backend graphify is driven with IS claude-cli, surfaced
    // as the honest docs-media hop — is pinned by the @executable rows above.
    name: "graphify/posture: @manual the live keyless --backend claude-cli build (reference — evidenced in VERIFICATION.md, not re-run)",
    run: async () => {
      // A reference assertion only: the aof-side contract the live row depends on is the
      // extraction backend (claude-cli) + its egress (docs-media) — both pinned above.
      assert.equal(classifyEgress("claude-cli"), "docs-media", "the live row's aof-side contract: claude-cli's hop is docs-media");
      assert.equal(isNetworkBackend("claude-cli"), true, "the live row's aof-side contract: claude-cli crosses the network");
    },
  },
];
