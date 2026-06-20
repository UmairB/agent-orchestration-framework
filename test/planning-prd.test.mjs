// Traceability wiring for milestone 02 / story 01 `shatter-consumes-prd`.
//
// These tests prove every @executable scenario/row of the story's task features
// resolves against the LOCKED helpers (`discoverPrd` / `readSeam` in
// ../src/planning-prd.mjs). They author no engine code: each discovery row
// builds a temp-dir workspace whose root contents match the feature's Given
// EXACTLY (seeded from the committed fixtures), then asserts the discovery /
// read-out contract.
//
//   00_discover-prd.feature           — the whole feature is @executable
//   01_seam-readout-and-origin.feature — ONLY the @executable read-out scenarios
//                                        (the @manual shatter/origin scenarios
//                                         and the @uat round-trip are verified
//                                         later at aof:verify, not here)
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPrd, readSeam } from "../src/planning-prd.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(
  here,
  "..",
  "wiki",
  "work",
  "02_milestone_planning-init",
  "stories",
  "01_story_shatter-consumes-prd",
  "fixtures",
);
const PRD_FIXTURE = path.join(FIXTURES, "PRD-acme-notify.md");
const UNPREFIXED_FIXTURE = path.join(FIXTURES, "write-prd-output.md");
const NOTES_FIXTURE = path.join(FIXTURES, "NOTES.md");
// The GENUINE pm-execution create-prd output (8-section template, NO `## Scope`
// / `## Milestones` heading) — the F3 fix seed (milestone 02 ADR-010).
const REAL_FIXTURE = path.join(FIXTURES, "PRD-oncall-compass.real-create-prd.md");

// Seed a temp workspace root from named fixture files so each matrix row's
// "root contents" precondition holds. `extra` lets a row add a second PRD that
// is not itself a committed fixture (PRD-other.md), copied from the PRD body.
async function seedWorkspace(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-prd-"));
  for (const [name, sourcePath] of Object.entries(files)) {
    const body = await readFile(sourcePath, "utf8");
    await writeFile(path.join(root, name), body);
  }
  return root;
}

const base = (p) => path.basename(p);

export const planningPrdTests = [
  // ----------------------------------------------------------- discovery ----
  // 00_discover-prd.feature — "a PRD-*.md at the workspace root is auto-discovered"
  {
    name: "discover/00: a single PRD-*.md at root is auto-discovered, no ask",
    run: async () => {
      const root = await seedWorkspace({ "PRD-acme-notify.md": PRD_FIXTURE });
      try {
        const result = await discoverPrd(root);
        assert.equal(result.ask, undefined, "does not ask for a path");
        assert.ok(result.prd, "resolves a PRD");
        assert.equal(base(result.prd), "PRD-acme-notify.md");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // "an explicit path is honoured even when it breaks the convention"
  {
    name: "discover/00: an explicit unprefixed path is honoured (root holds no PRD-*.md), no ask",
    run: async () => {
      // Root holds no PRD-*.md; the explicit path points outside the root at the
      // committed write-prd-output.md fixture (well-formed but unprefixed).
      const root = await seedWorkspace({});
      try {
        const result = await discoverPrd(root, UNPREFIXED_FIXTURE);
        assert.equal(result.ask, undefined, "does not ask for a path");
        assert.ok(result.prd, "resolves the explicit PRD");
        assert.equal(base(result.prd), "write-prd-output.md");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // --- Scenario Outline: discovery resolves a PRD or asks, never guesses -----
  // Each Examples row, with the root contents seeded to match the Given.
  {
    name: 'discover/00 matrix: one "PRD-acme-notify.md" + none → uses PRD-acme-notify.md',
    run: async () => {
      const root = await seedWorkspace({ "PRD-acme-notify.md": PRD_FIXTURE });
      try {
        const result = await discoverPrd(root);
        assert.equal(result.ask, undefined);
        assert.equal(base(result.prd), "PRD-acme-notify.md");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'discover/00 matrix: "PRD-acme-notify.md" + a "NOTES.md" + none → uses PRD-acme-notify.md (decoy ignored)',
    run: async () => {
      const root = await seedWorkspace({
        "PRD-acme-notify.md": PRD_FIXTURE,
        "NOTES.md": NOTES_FIXTURE,
      });
      try {
        const result = await discoverPrd(root);
        assert.equal(result.ask, undefined, "the non-PRD markdown does not force an ask");
        assert.equal(base(result.prd), "PRD-acme-notify.md");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'discover/00 matrix: no "PRD-*.md" + explicit "write-prd-output.md" path → uses write-prd-output.md (explicit wins)',
    run: async () => {
      const root = await seedWorkspace({ "NOTES.md": NOTES_FIXTURE });
      try {
        const result = await discoverPrd(root, UNPREFIXED_FIXTURE);
        assert.equal(result.ask, undefined);
        assert.equal(base(result.prd), "write-prd-output.md");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'discover/00 matrix: only a "NOTES.md", no "PRD-*.md" + none → asks (decoy not picked)',
    run: async () => {
      const root = await seedWorkspace({ "NOTES.md": NOTES_FIXTURE });
      try {
        const result = await discoverPrd(root);
        assert.equal(result.ask, true, "asks for a path");
        assert.deepEqual(result.candidates, [], "no PRD-*.md candidates");
        assert.equal(result.prd, undefined, "the NOTES.md decoy is not selected");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: "discover/00 matrix: empty root + none → asks (nothing to discover)",
    run: async () => {
      const root = await seedWorkspace({});
      try {
        const result = await discoverPrd(root);
        assert.equal(result.ask, true, "asks for a path");
        assert.deepEqual(result.candidates, []);
        assert.equal(result.prd, undefined);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'discover/00 matrix: "PRD-acme-notify.md" and "PRD-other.md" + none → asks/lists (never silently picks)',
    run: async () => {
      const root = await seedWorkspace({
        "PRD-acme-notify.md": PRD_FIXTURE,
        "PRD-other.md": PRD_FIXTURE, // a second, distinct PRD-*.md filename
      });
      try {
        const result = await discoverPrd(root);
        assert.equal(result.ask, true, "does not silently pick among two PRD-*.md");
        assert.equal(result.prd, undefined);
        const names = result.candidates.map(base).sort();
        assert.deepEqual(names, ["PRD-acme-notify.md", "PRD-other.md"], "lists both candidates");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'discover/00 matrix: two PRD-*.md + explicit "PRD-other.md" path → uses PRD-other.md (explicit disambiguates)',
    run: async () => {
      const root = await seedWorkspace({
        "PRD-acme-notify.md": PRD_FIXTURE,
        "PRD-other.md": PRD_FIXTURE,
      });
      try {
        const explicit = path.join(root, "PRD-other.md");
        const result = await discoverPrd(root, explicit);
        assert.equal(result.ask, undefined, "an explicit path disambiguates, no ask");
        assert.equal(base(result.prd), "PRD-other.md");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // "discovery never silently selects a non-PRD markdown file"
  {
    name: "discover/00: never silently selects a non-PRD markdown (only NOTES.md → asks)",
    run: async () => {
      const root = await seedWorkspace({ "NOTES.md": NOTES_FIXTURE });
      try {
        const result = await discoverPrd(root);
        assert.equal(result.ask, true, "asks for a path");
        assert.notEqual(result.prd && base(result.prd), "NOTES.md", "NOTES.md is not selected");
        assert.ok(!result.candidates.some((c) => base(c) === "NOTES.md"), "NOTES.md is not even a candidate");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // --------------------------------------------------------- seam read-out ---
  // 01_seam-readout-and-origin.feature — ONLY the @executable read-out scenarios.
  // "the PRD exposes an objective the read-out can extract"
  {
    name: "readout/01: the read-out yields a non-empty objective statement",
    run: async () => {
      const seam = await readSeam(PRD_FIXTURE);
      assert.equal(typeof seam.objective, "string");
      assert.ok(seam.objective.trim().length > 0, "objective is non-empty");
      // Review fix: a line-wrapped objective is joined into its full sentence, not
      // truncated mid-clause (the fixture's objective wraps across two lines and
      // ends "…can prove a message was delivered.").
      assert.ok(
        /prove a message was delivered/.test(seam.objective),
        "objective is the full sentence, not truncated at the line wrap",
      );
    },
  },

  // "the PRD exposes a scope with both an in-list and an out-list"
  {
    name: "readout/01: the read-out yields a scope with >=1 in-scope and >=1 out-of-scope item",
    run: async () => {
      const seam = await readSeam(PRD_FIXTURE);
      assert.ok(Array.isArray(seam.scope.in), "scope.in is a list");
      assert.ok(Array.isArray(seam.scope.out), "scope.out is a list");
      assert.ok(seam.scope.in.length >= 1, "at least one in-scope item");
      assert.ok(seam.scope.out.length >= 1, "at least one out-of-scope item");
    },
  },

  // "the PRD exposes at least two milestone-sized chunks"
  {
    name: "readout/01: the read-out yields two or more distinct milestone-sized chunks",
    run: async () => {
      const seam = await readSeam(PRD_FIXTURE);
      assert.ok(Array.isArray(seam.milestones), "milestones is a list");
      assert.ok(seam.milestones.length >= 2, "two or more milestone chunks");
      const distinct = new Set(seam.milestones.map((m) => m.toLowerCase()));
      assert.equal(distinct.size, seam.milestones.length, "chunks are distinct");
    },
  },

  // --- Scenario Outline: the seam read-out surfaces each required element ----
  // Each Examples row asserted present and extractable over the fixture.
  {
    name: 'readout/01 matrix: the initiative objective (the "why") is present and extractable',
    run: async () => {
      const seam = await readSeam(PRD_FIXTURE);
      assert.ok(seam.objective && seam.objective.trim().length > 0);
    },
  },
  {
    name: "readout/01 matrix: the in-scope list is present and extractable",
    run: async () => {
      const seam = await readSeam(PRD_FIXTURE);
      assert.ok(seam.scope.in.length >= 1);
    },
  },
  {
    name: "readout/01 matrix: the out-of-scope list is present and extractable",
    run: async () => {
      const seam = await readSeam(PRD_FIXTURE);
      assert.ok(seam.scope.out.length >= 1);
    },
  },
  {
    name: "readout/01 matrix: two or more milestone-sized chunks are present and extractable",
    run: async () => {
      const seam = await readSeam(PRD_FIXTURE);
      assert.ok(seam.milestones.length >= 2);
    },
  },

  // ------------------------------------ real create-prd template (F3) --------
  // 03_real-template-readout.feature — ALL @executable scenarios. The GENUINE
  // 8-section create-prd output has NO `## Scope` / `## Milestones` heading, so
  // these prove readSeam derives the seam read-out from the producer's real
  // shape (Objective / 7.2 Key Features / 8. Release) per ADR-010.
  // "readSeam extracts the objective from the real 8-section create-prd template"
  {
    name: "readout/03 real-template: the objective is the non-empty prose under the Objective section",
    run: async () => {
      const seam = await readSeam(REAL_FIXTURE);
      assert.equal(typeof seam.objective, "string");
      assert.ok(seam.objective.trim().length > 0, "objective is non-empty");
    },
  },

  // "readSeam extracts milestone-sized chunks from the real create-prd template"
  // "… one chunk per key feature (schedule model, rotation engine, notifications,
  //   calendar sync, web UI)"
  {
    name: "readout/03 real-template: milestone chunks are derived from Key Features — non-empty, 5 (one per feature), distinct",
    run: async () => {
      const seam = await readSeam(REAL_FIXTURE);
      assert.ok(Array.isArray(seam.milestones), "milestones is a list");
      assert.ok(seam.milestones.length > 0, "milestone chunks are non-empty");
      assert.equal(seam.milestones.length, 5, "one chunk per key feature the PRD lists");
      const distinct = new Set(seam.milestones.map((m) => m.toLowerCase()));
      assert.equal(distinct.size, seam.milestones.length, "chunks are distinct");
    },
  },

  // "readSeam still extracts in/out scope without a literal '## Scope' heading"
  {
    name: "readout/03 real-template: in/out scope is derived from Release without a literal ## Scope heading",
    run: async () => {
      const seam = await readSeam(REAL_FIXTURE);
      assert.ok(Array.isArray(seam.scope.in), "scope.in is a list");
      assert.ok(Array.isArray(seam.scope.out), "scope.out is a list");
      assert.ok(seam.scope.in.length >= 1, "an in-scope set is derived (first-version capabilities)");
      assert.ok(seam.scope.out.length >= 1, "an out-of-scope set is derived (the deferred / later items)");
    },
  },

  // "the hand-shaped and command-shaped fixtures still read correctly (no regression)"
  // The two existing fixtures keep their objective/scope/milestones — the
  // additive ADR-010 fallbacks never fire on a PRD that HAS ## Scope/## Milestones.
  {
    name: "readout/03 no-regression: the hand-shaped and inline fixtures still yield objective/scope/milestones as before",
    run: async () => {
      const handShaped = await readSeam(PRD_FIXTURE);
      assert.ok(handShaped.objective.trim().length > 0, "hand-shaped: objective non-empty");
      assert.equal(handShaped.scope.in.length, 3, "hand-shaped: 3 in-scope (## Scope path)");
      assert.equal(handShaped.scope.out.length, 3, "hand-shaped: 3 out-of-scope (## Scope path)");
      assert.equal(handShaped.milestones.length, 3, "hand-shaped: 3 chunks (## Milestones path)");

      const inline = await readSeam(UNPREFIXED_FIXTURE);
      assert.ok(inline.objective.trim().length > 0, "inline: objective non-empty");
      assert.equal(inline.scope.in.length, 3, "inline: 3 in-scope (In:/Out: path)");
      assert.equal(inline.scope.out.length, 3, "inline: 3 out-of-scope (In:/Out: path)");
      assert.equal(inline.milestones.length, 3, "inline: 3 chunks (## Milestones path)");
    },
  },

  // "honest-empty, not a fabrication" (ADR-010): a PRD with an Objective but no
  // Scope / Milestones / Key Features / Release section yields empty scope + empty
  // milestones and does NOT throw — locking the no-fabrication guarantee in CI
  // (review gate, QA nit) rather than leaving it probe-only. Also covers a Release
  // whose only item matches neither label → still empty (no fabricated in/out).
  {
    name: "readout/03 honest-empty: a PRD with only an Objective yields empty scope + empty milestones, no throw",
    run: async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-prd-empty-"));
      try {
        const objectiveOnly = path.join(root, "PRD-objective-only.md");
        await writeFile(
          objectiveOnly,
          "# PRD — Sparse\n\n## 4. Objective\n\n**Objective.** Do the one thing well.\n",
        );
        const seam = await readSeam(objectiveOnly);
        assert.ok(seam.objective.trim().length > 0, "objective still extracted");
        assert.deepEqual(seam.scope, { in: [], out: [] }, "no Scope/Release → empty scope, not fabricated");
        assert.deepEqual(seam.milestones, [], "no Milestones/Key Features → empty chunks, not fabricated");

        // A Release section whose only item matches neither in nor out label → still empty.
        const unmatchedRelease = path.join(root, "PRD-unmatched-release.md");
        await writeFile(
          unmatchedRelease,
          "# PRD — Sparse\n\n## 4. Objective\n\n**Objective.** Ship it.\n\n## 8. Release\n\n- Timeframes are relative; no fixed dates.\n",
        );
        const seam2 = await readSeam(unmatchedRelease);
        assert.deepEqual(seam2.scope, { in: [], out: [] }, "Release with only an unmatched item → empty in/out");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
