// Fitness function for milestone 10 / ADR-003:
// "`claude-cli` is classified HONESTLY and never a silent network default:
//  classifyEgress('claude-cli') === 'docs-media' (the doc/media hop ran) and
//  isNetworkBackend('claude-cli') === true (it crosses the network — billed-to-plan
//  is NOT on-box), and that network classification is BY KNOWLEDGE
//  (isKnownNetworkBackend('claude-cli') === true), not the unknown-name fall-through.
//  `ollama` stays the ONLY data-local backend (isNetworkBackend('ollama') === false)
//  yet still egresses 'docs-media' (the hop ran). The graphify backend SURFACES the
//  chosen extraction backend + its honest egress label in `status` — the selection is
//  visible, never silent."
//
// Pure-function test over the REAL exported classifiers in src/commands/graph-build.mjs
// (no live binary — the classifiers are pure functions of the backend name) PLUS a
// behavioural read of the graphify backend's `status` surface (it reaches NO binary
// over an isolated, empty projectRoot). The live `--backend claude-cli` build itself
// is @manual (evidenced in this milestone's VERIFICATION.md, story 00's reindex run);
// CI asserts only the aof-side classification + surfacing.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import {
  classifyEgress,
  isNetworkBackend,
  isKnownNetworkBackend,
} from "../../src/commands/graph-build.mjs";
import graphifyBackend, {
  GRAPHIFY_EXTRACTION_BACKEND,
  GRAPHIFY_EXTRACTION_EGRESS,
} from "../../src/memory/graphify-backend.mjs";

async function freshProjectRoot() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-arch-classified-"));
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  return projectRoot;
}

export const archTests = [
  {
    name: "arch/graphify-backend-classified: claude-cli is network-by-knowledge and egresses docs-media; ollama stays data-local yet still docs-media",
    run: () => {
      // claude-cli CROSSES the network (the prose is sent to Anthropic for inference);
      // billed-to-plan ≠ on-box. And it is network BY KNOWLEDGE, not fall-through.
      assert.equal(isNetworkBackend("claude-cli"), true, 'isNetworkBackend("claude-cli") === true (it crosses the network)');
      assert.equal(isKnownNetworkBackend("claude-cli"), true, 'isKnownNetworkBackend("claude-cli") === true (by enumeration, not fall-through)');
      // The doc/media hop RAN — egress is docs-media (exactly as for claude/ollama).
      assert.equal(classifyEgress("claude-cli"), "docs-media", 'classifyEgress("claude-cli") === "docs-media" (the hop ran)');

      // ollama is the ONLY data-local (on-box) backend — isNetworkBackend false …
      assert.equal(isNetworkBackend("ollama"), false, 'isNetworkBackend("ollama") === false (data-local, on-box)');
      assert.equal(isKnownNetworkBackend("ollama"), false, 'isKnownNetworkBackend("ollama") === false (not in the network set)');
      // … yet its egress is STILL docs-media (the hop ran even though it ran on-box;
      // locality is a SEPARATE privacy property, never folded into the egress field).
      assert.equal(classifyEgress("ollama"), "docs-media", 'classifyEgress("ollama") === "docs-media" — the hop ran; locality is not the egress field');

      // The 09 baseline still holds (the classification grew by KNOWLEDGE, did not break):
      // no backend → egress none (code/AST only); a known remote → docs-media.
      assert.equal(classifyEgress(null), "none", "no backend ⇒ egress none (code/AST only)");
      assert.equal(classifyEgress("claude"), "docs-media", "a network backend ⇒ docs-media");
    },
  },
  {
    name: "arch/graphify-backend-classified: claude-cli's classification is BY KNOWLEDGE — distinct from the unknown-name fail-closed default",
    run: () => {
      // The contract's force: an UNKNOWN name also fails CLOSED to network
      // (isNetworkBackend true), but it is NOT a known network backend. claude-cli
      // must be the KNOWN kind — so its classification is a deliberate fact, not a
      // fall-through that would silently flip the moment the unknown-name default
      // ever changes. This distinguishes the two (a non-tautological assertion).
      assert.equal(isNetworkBackend("totally-made-up-backend"), true, "an unknown name fails closed to network");
      assert.equal(isKnownNetworkBackend("totally-made-up-backend"), false, "but an unknown name is NOT a known network backend");
      // Therefore claude-cli being isKnownNetworkBackend === true is meaningful: it is
      // classified by enumeration, not incidentally by the same fail-closed path.
      assert.notEqual(
        isKnownNetworkBackend("claude-cli"),
        isKnownNetworkBackend("totally-made-up-backend"),
        "claude-cli (known) and an unknown name (fail-closed) are classified DIFFERENTLY by knowledge"
      );
    },
  },
  {
    name: "arch/graphify-backend-classified: the graphify backend's static egress label equals the live classifier (the surfaced label is honest, not invented)",
    run: () => {
      // The backend surfaces a STATIC egress label (GRAPHIFY_EXTRACTION_EGRESS) without
      // importing the graph:build command / driver (the via-command boundary). This
      // guard pins that the static label is the SAME value the live classifier yields —
      // so a future drift in graph-build.mjs's classification would surface here, and
      // the backend never surfaces an egress label that disagrees with the source of truth.
      assert.equal(GRAPHIFY_EXTRACTION_BACKEND, "claude-cli", "the chosen extraction backend is claude-cli (ADR-003 default)");
      assert.equal(
        GRAPHIFY_EXTRACTION_EGRESS,
        classifyEgress(GRAPHIFY_EXTRACTION_BACKEND),
        "the backend's surfaced egress label equals classifyEgress(claude-cli) — honest, not a hard-coded disagreement"
      );
      assert.equal(GRAPHIFY_EXTRACTION_EGRESS, "docs-media", "the surfaced label is docs-media");
    },
  },
  {
    name: "arch/graphify-backend-classified: status surfaces the chosen extraction backend + its honest egress label (never a silent network default)",
    run: async () => {
      // The selection is VISIBLE: status reports the extraction backend it will use and
      // its egress — so an operator sees that graph-grounded recall runs a network hop,
      // never a silent default. Read over an isolated, empty projectRoot (no binary, no store).
      const projectRoot = await freshProjectRoot();
      const status = await graphifyBackend.status({
        workDir: path.join(projectRoot, "wiki", "work"),
        projectRoot,
        configMemory: { backend: "graphify" },
      });
      assert.equal(status.backend, "graphify", "status reports the graphify backend");
      assert.equal(status.extractionBackend, "claude-cli", "status surfaces the chosen extraction backend (claude-cli)");
      assert.equal(status.extractionEgress, "docs-media", "status surfaces the honest egress label (docs-media)");
      // The surfaced label agrees with the live classifier — not a frozen lie.
      assert.equal(status.extractionEgress, classifyEgress(status.extractionBackend), "the surfaced egress label equals classifyEgress(the surfaced backend)");
    },
  },
];
