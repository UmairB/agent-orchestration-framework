// Fitness function for milestone 04 / ADR-002 (+ ADR-003 agent-stub clause):
// "The proof drives the SHIPPED code paths. The round-trip harness imports the real
//  entry points — `initWork` (src/work-init.mjs), `loadBundle` (src/work-bundle.mjs),
//  and the `findWork`/`listStream`/`validateWork`/`nextWork` verbs (src/work.mjs) —
//  and contains NO re-implementation of install / render-lock / the work-stream
//  traversal, and NO scripted stand-in for the agent-driven refine/continue/verify
//  loop presented as an automated assertion."
//
// WHY structural: the milestone exists to validate aof's OWN machinery; if the proof
// hand-builds the install (copies bundle files) or re-implements `next`/`validate`,
// it proves the fake, not the product (ADR-002). And ADR-003 forbids dressing up the
// irreducibly agent-driven loop as an automated assertion — the harness must expose
// only the deterministic spine; the agent half is proven once as @manual/@uat with
// captured evidence, never faked here.
//
// EXPECTED RED until the round-trip harness exists (the harness story builds
// test/support/roundtrip-harness.mjs against the frozen contract, ADR-005, importing
// the real shipped functions). The test FILE imports only node: builtins + the
// shipped src/ entry points at top level (those exist today) and resolves the harness
// LAZILY inside run(), so a missing harness is a clean assertion red — not an import
// crash of the whole file.
//
// Two proofs:
//  1. Source — the harness imports from src/work-init.mjs, src/work-bundle.mjs,
//     src/work.mjs; it does NOT carry a second install copy-loop, a private
//     create/update/skip classifier, or a fabricated refine/continue/verify result
//     object presented as proof.
//  2. Behavioural — the harness install result is byte-identical to a direct
//     `initWork` call on the same isolated repo (it really delegates, not reimplements).
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initWork } from "../../src/work-init.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const harnessPath = path.join(repoRoot, "test", "support", "roundtrip-harness.mjs");
const harnessUrl = new URL("../support/roundtrip-harness.mjs", import.meta.url).href;

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadHarness() {
  if (!(await exists(harnessPath))) {
    assert.fail("round-trip harness not found yet at test/support/roundtrip-harness.mjs — EXPECTED RED until the harness story builds it (ADR-002/005)");
  }
  return import(harnessUrl);
}

// Compare the install manifest's files[] ({path, runtime, resource}) modulo the
// per-run `generatedAt`/`hash`-of-timestamp noise — the SET of installed members
// must match a direct initWork call exactly (the harness delegates, not reimplements).
function memberKeys(result) {
  const files = result?.manifest?.files ?? result?.actions?.map((a) => ({ path: String(a.path).replaceAll("\\", "/"), resource: a.resource })) ?? [];
  return files
    .map((f) => `${String(f.path).replaceAll("\\", "/")}|${f.resource?.id ?? ""}|${f.resource?.kind ?? ""}`)
    .sort();
}

export const archTests = [
  {
    name: "arch/ADR-002: the harness source imports the shipped entry points and contains no re-implementation or agent stub",
    run: async () => {
      if (!(await exists(harnessPath))) {
        assert.fail("round-trip harness not found yet — EXPECTED RED until the harness story builds it (ADR-002/003/005)");
      }
      const raw = await readFile(harnessPath, "utf8");
      const code = stripComments(raw);

      // Imports the REAL shipped surfaces — the install, the bundle loader, the verbs.
      assert.ok(/from\s+["'][^"']*work-init\.mjs["']/.test(code), "harness imports the real initWork from src/work-init.mjs");
      assert.ok(/from\s+["'][^"']*work-bundle\.mjs["']/.test(code), "harness imports the real loadBundle from src/work-bundle.mjs");
      assert.ok(/from\s+["'][^"']*work\.mjs["']/.test(code), "harness imports the real work verbs from src/work.mjs");
      assert.ok(/\binitWork\b/.test(code), "harness calls the shipped initWork (no hand-rolled install)");

      // No fabricated agent-loop "result" masquerading as an automated assertion
      // (ADR-003): the harness exposes only the deterministic spine. A scripted
      // refine/continue/verify return value would violate ADR-002 and ADR-003.
      assert.ok(!/\b(fakeRefine|stubRefine|simulateLoop|mockAgent|fakeContinue|fakeVerify)\b/.test(code),
        "harness carries no scripted stand-in for the agent-driven refine/continue/verify loop");
    }
  },
  {
    name: "arch/ADR-002: the harness install result matches a direct initWork call — it delegates, not reimplements",
    run: async () => {
      const harness = await loadHarness();

      const directRepo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-rt-direct-"));
      let harnessRepo;
      try {
        // Direct shipped install (the ground truth).
        const direct = await initWork({ targetDir: directRepo, runtimes: ["claude"] });

        // Harness install into its own isolated repo.
        harnessRepo = await harness.createRoundTripRepo();
        const viaHarness = await harness.installBundle(harnessRepo.dir, { runtimes: ["claude"] });

        // Same member SET — the harness ran the real engine, not a private copy.
        assert.deepEqual(
          memberKeys(viaHarness),
          memberKeys(direct),
          "the harness install renders exactly the members the shipped initWork does"
        );
        assert.ok(memberKeys(direct).length > 0, "the install actually rendered members");
      } finally {
        await rm(directRepo, { recursive: true, force: true });
        if (harnessRepo && typeof harnessRepo.cleanup === "function") await harnessRepo.cleanup();
      }
    }
  }
];
