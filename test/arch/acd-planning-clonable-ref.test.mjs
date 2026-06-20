// Fitness function for milestone 02 / ADR-008 — the STANDING clone-smoke guard.
//
// The string-only blind spot that let F1 then F2 reach the verify gate:
// `acd-planning-install-commands` asserts the marketplace-add command *string*, not
// that the emitted `#<ref>` would actually CLONE. `claude plugin marketplace add
// <url>#<ref>` runs `git clone --branch <ref>`, which resolves only a real branch or
// tag name upstream. A pinned ref that looks right as a string but is not a clonable
// branch/tag (F1: SSH shorthand; F2: a bare 40-hex commit sha) passes the string
// test and STILL fails the live install. This test closes that gap: it builds the
// real plan, extracts the `#<ref>` the marketplace-add command actually emits, and
// proves that ref resolves to a real branch/tag upstream via
// `git ls-remote --exit-code`.
//
// Tri-state on the ls-remote exit code (NEVER silently pass, NEVER fail on infra):
//   0            → PASS  (the emitted ref resolves to a real clonable branch/tag)
//   2            → FAIL  (`--exit-code` + no matching ref: the emitted ref is NOT a
//                         clonable branch/tag upstream — F1/F2 regression)
//   any other    → LOUD SKIP (network/infra error — e.g. offline, DNS, git missing):
//                  print `# SMOKE SKIPPED (offline)…` and return without throwing.
//
// This is a NETWORKED test. It is imported into both runners (scripts/test.mjs and
// scripts/test-unit.mjs) and loud-skips when the network is unreachable, so a green
// run offline is honest (skip), not a false pass.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { planPlanningInstall, MARKETPLACE_GIT_URL } from "../../src/planning-init.mjs";

const FIXTURE_SHA = "d384f0c9eb81fe74656a4f6da168587836939edb";

// Pull the `#<ref>` fragment out of the actually-emitted marketplace-add command.
function emittedMarketplaceRef(plan) {
  const marketplace = plan.find((item) => item.kind === "marketplace");
  assert.ok(marketplace, "the plan contains a marketplace add step");
  const source = marketplace.argv[marketplace.argv.length - 1]; // the `<url>#<ref>` token
  const hash = source.lastIndexOf("#");
  assert.ok(hash !== -1, `marketplace source carries a #<ref> fragment: ${source}`);
  const ref = source.slice(hash + 1);
  assert.ok(ref.length > 0, `marketplace #<ref> is non-empty: ${source}`);
  return ref;
}

export const archTests = [
  {
    // The standing guard that the REAL emitted command actually clones (ADR-008).
    name: "arch/ADR-008: the emitted marketplace #<ref> resolves to a real clonable branch/tag upstream (clone-smoke)",
    run: async () => {
      const plan = planPlanningInstall({ runtime: "claude", sha: FIXTURE_SHA });
      const ref = emittedMarketplaceRef(plan);

      const result = spawnSync(
        "git",
        ["ls-remote", "--exit-code", MARKETPLACE_GIT_URL, `refs/tags/${ref}`, `refs/heads/${ref}`],
        { encoding: "utf8", shell: process.platform === "win32" }
      );

      // git not on PATH / could not even launch → infra, loud-skip.
      if (result.error || typeof result.status !== "number") {
        console.log(
          `# SMOKE SKIPPED (offline): git ls-remote could not launch for ${MARKETPLACE_GIT_URL} (${result.error?.message ?? "no exit status"})`
        );
        return;
      }

      const status = result.status;
      if (status === 0) {
        // PASS: the emitted ref matched a real branch/tag upstream.
        return;
      }
      if (status === 2) {
        // FAIL: `--exit-code` reports "ref(s) requested but none matched" — the
        // emitted ref is not a clonable branch/tag upstream (the F1/F2 failure mode).
        assert.fail(
          `the emitted marketplace ref \`${ref}\` is not a clonable branch/tag upstream (F2 regression): ` +
            `\`git clone --branch ${ref}\` would fail. Pin the immutable release tag (ADR-008), not a bare sha.`
        );
      }
      // Any other non-zero exit (network/DNS/auth/infra) → LOUD SKIP, never fail.
      console.log(
        `# SMOKE SKIPPED (offline): git ls-remote could not reach ${MARKETPLACE_GIT_URL} (exit ${status})`
      );
    }
  }
];
