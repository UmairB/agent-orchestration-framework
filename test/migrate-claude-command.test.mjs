// Traceability wiring for story 31 `migrate-claude-command` — the /aof:migrate
// bundle command (the INFERENCE CEILING over the story-29 mechanical CLI).
//
// Covered here:
//   tasks/00_command-body-cli-first-handoff.feature — the two @executable
//        content/shape pins over the AUTHORED body `src/bundle/commands/migrate.md`
//        (grep-able marker facts + character-offset ordering, the proven
//        acd-doctor-validate-keystone idiom). The AUTHORED file is asserted, not
//        the render (the renderer re-emits frontmatter and injects aof-invocation —
//        already covered by the derived arch-tests).
//   tasks/03_bundle-distribution-and-nonregression.feature — every scenario +
//        every Examples row: the descriptor member, the derived-manifest
//        byte-for-byte regeneration (ADR-002), the `aof work update` landing, and
//        the install-state × invocation matrix (never-inited refusal, init landing,
//        idempotent re-run, dry-run pending render, ADR-005 drift preserved /
//        --force restored) — all via the SAME engine seams work-update.test.mjs /
//        work-init.test.mjs use (updateWork bundleOverride, installBase).
//
// Tasks 01/02 are @manual (agent-run at aof:verify): their contract lives IN the
// command body; the hardening pins below keep the body's statements of those
// contracts from silently regressing, but the passes themselves are not run here.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle, readDescriptor, renderBundleOutputs } from "../src/work-bundle.mjs";
import {
  generateBundleManifest,
  serializeBundleManifest,
  readShippedManifest,
  manifestPath
} from "../src/work-bundle-manifest.mjs";
import { hashContent, hashFileIfExists, writeLock } from "../src/lock.mjs";
import { createLockManifest, executeApplyActions, planApplyActions } from "../src/render-plan.mjs";
import { synthesizeBundleConfig } from "../src/work-bundle-synthesis.mjs";
import { updateWork, workLockPath } from "../src/work-update.mjs";
import { initWork } from "../src/work-init.mjs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");
// The runner's assembled `tests` registry — resolved LAZILY inside run() (a
// deferred dynamic import, the acd-roundtrip-registration idiom): scripts/test.mjs
// imports THIS module, so an eager import would cycle; and the runner only
// executes the suite when invoked directly, so importing it is a pure read.
const runnerUrl = new URL("../scripts/test.mjs", import.meta.url).href;

// The authored deliverable (the doc IS the contract) and its rendered install path.
const BODY = "src/bundle/commands/migrate.md";
const MIGRATE_REL = ".claude/commands/aof/migrate.md";

// The CLI-first invocation the body pins: `aof migrate` runs FIRST, --json, flags
// passed through via $ARGUMENTS (the exact token, same as the keystone idiom).
const CLI_INVOCATION = "aof migrate $ARGUMENTS --json";
// The two agent-pass section markers the invocation must PRECEDE (offset ordering).
const INFERENCE_MARKER = "Inference lane — fill ONLY the hand-off seam";
const REVIEW_MARKER = "Architect review of delivered work — at migrate time";

// Whitespace-normalized marker greps: the authored body hard-wraps prose, so a
// marker phrase may span a line break + indentation. Collapse every whitespace
// run to one space on BOTH sides before matching — the pins survive a rewrap
// while still failing when the phrase itself changes.
function flatten(content) {
  return String(content).replace(/\s+/g, " ");
}
// Case-insensitive presence.
function has(content, needle) {
  return flatten(content).toLowerCase().includes(flatten(needle).toLowerCase());
}
// Case-sensitive presence (for pins whose casing is load-bearing).
function hasExact(content, needle) {
  return flatten(content).includes(flatten(needle));
}

// The CLI-first ordering pins — ONE predicate shared by the real scenario test
// and the self-test, so the self-test exercises the exact logic the pin uses
// (never a re-derivation that can drift). Offsets are computed over the
// whitespace-NORMALIZED text: an innocent rewrap of any marker across a line
// break never trips the pin; removing the invocation or hoisting an agent-pass
// section above it does. Throws (assert) on the first violation.
function assertCliFirst(text) {
  const flat = flatten(text);
  const cliAt = flat.indexOf(flatten(CLI_INVOCATION));
  const inferenceAt = flat.indexOf(flatten(INFERENCE_MARKER));
  const reviewAt = flat.indexOf(flatten(REVIEW_MARKER));
  assert.ok(cliAt !== -1, "the body invokes `aof migrate $ARGUMENTS --json` (flags pass through to the CLI)");
  assert.ok(inferenceAt !== -1, "the body has the inference-lane section");
  assert.ok(reviewAt !== -1, "the body has the architect-review section");
  assert.ok(cliAt < inferenceAt, `the CLI invocation (offset ${cliAt}) precedes the inference lane (offset ${inferenceAt})`);
  assert.ok(cliAt < reviewAt, `the CLI invocation (offset ${cliAt}) precedes the architect review (offset ${reviewAt})`);
}

// The authored file's leading `---`…`---` frontmatter block (raw text — the
// AUTHORED frontmatter is the observable; the renderer re-derives its own).
function frontmatterBlock(raw) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  return match ? match[1] : "";
}

async function tempRepo(prefix = "aof-migrate-cmd-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function p(dir, ...rel) {
  return path.join(dir, ...rel);
}

function fwd(filePath) {
  return String(filePath).replaceAll("\\", "/");
}

function classOf(result, relPath) {
  const item = result.actions.find((entry) => fwd(entry.path) === relPath);
  return item ? item.action : undefined;
}

// A bundle WITHOUT the migrate command member — the "install predates the migrate
// member" fixture (the fixture-added-member precedent, inverted: the REAL shipped
// member is the added one).
function bundleWithoutMigrate(bundle = loadBundle()) {
  return { ...bundle, resources: bundle.resources.filter((r) => r.id !== "migrate") };
}

// Build a base install of `bundle` into `repo`, reusing the SAME engine path init
// uses (synthesize → planApplyActions(null) → executeApplyActions →
// createLockManifest → writeLock) — the work-update.test.mjs installBase precedent,
// NOT a second drift engine.
async function installBase(repo, bundle, runtimes = ["claude"], version = "1.0.0") {
  const { desiredOutputs } = await synthesizeBundleConfig(bundle, { runtimes, targetDir: repo });
  const actions = await planApplyActions(desiredOutputs, null, { force: false, targetDir: repo });
  await executeApplyActions(actions);
  const base = createLockManifest({ actions, desiredOutputs, previousLock: null, config: { packages: [] }, runtimes });
  const work = {
    generatedAt: base.generatedAt,
    bundle: { version },
    runtimes,
    files: base.files.map((entry) => ({ ...entry, path: fwd(entry.path) })),
    packages: base.packages,
    frameworks: base.frameworks,
    frameworkInstallAttempts: base.frameworkInstallAttempts
  };
  await writeLock(workLockPath(repo), { work });
  return work;
}

// The shipped manifest's entry for the rendered migrate command.
function shippedMigrateEntry() {
  const entry = readShippedManifest().entries.find((e) => e.resource.id === "migrate");
  assert.ok(entry, "the shipped manifest carries an entry for the migrate command");
  return entry;
}

export const migrateClaudeCommandTests = [
  // ====================================================================
  // tasks/00_command-body-cli-first-handoff.feature — @executable pins
  // over the AUTHORED src/bundle/commands/migrate.md
  // ====================================================================

  {
    // Scenario: the shipped command body encodes the CLI-first division of labour
    name: "migrate-cmd/body: frontmatter carries description + argument-hint naming the source folder; `aof migrate` (the CLI) runs FIRST — before any agent pass; the --json hand-off resolves the produced item; the lane fills only the not-recoverable seam",
    run: async () => {
      const raw = read(BODY);
      const fm = frontmatterBlock(raw);
      // Then its frontmatter carries a description and an argument-hint naming the source folder
      assert.match(fm, /^description: .+$/m, "frontmatter carries a non-empty description:");
      assert.match(fm, /^argument-hint: .+$/m, "frontmatter carries an argument-hint:");
      const hint = /^argument-hint: (.+)$/m.exec(fm)[1];
      assert.ok(has(hint, "source folder"), `the argument-hint names the source folder: "${hint}"`);

      // And its process runs "aof migrate" (the CLI) as the FIRST act, before any agent pass
      // (the shared presence + offset-ordering predicate — see assertCliFirst).
      assertCliFirst(raw);
      assert.ok(has(raw, "before any agent pass"), "the body states the CLI runs before any agent pass");
      assert.ok(
        hasExact(raw, "Do not pre-read the source or write anything before the CLI has run."),
        "the body forbids pre-reading the source / writing before the CLI has run"
      );

      // And it consumes the CLI's --json result to resolve the produced item it will enrich
      assert.ok(
        hasExact(raw, "Consume the CLI's `--json` result to resolve the produced item"),
        "the body consumes the CLI's --json result to resolve the produced item"
      );
      assert.ok(
        hasExact(raw, "{ milestoneRef, dir, status, storyCount, taskCount, findingCount, ... }"),
        "the body names the real success envelope keys (milestoneRef … findingCount)"
      );

      // And it states the agent lane fills what the CLI marked not recoverable —
      // never re-doing the mechanical floor
      assert.ok(hasExact(raw, "_Not recoverable_"), "the body names the CLI's honest-absence marker as the hand-off seam");
      assert.ok(has(raw, "fills what the CLI marked not recoverable"), "the lane fills what the CLI marked not recoverable");
      assert.ok(has(raw, "never re-doing the mechanical floor"), "the body states the lane never re-does the mechanical floor");
    }
  },
  {
    // Scenario: the shipped command body pins the write boundary and the non-fabrication rule
    name: "migrate-cmd/body: every agent write confined to the produced item's folder under work.dir; the source folder stays byte-untouched; everything written traces to real source content, honest absence standing",
    run: async () => {
      const raw = read(BODY);
      // Then it confines every agent write to the produced item's folder under work.dir
      assert.ok(
        hasExact(raw, "confine every agent write to the produced item's folder under `work.dir`"),
        "the body confines every agent write to the produced item's folder under work.dir"
      );
      // And it states the source folder stays byte-untouched (the CLI's read-only
      // source rule survives into the lane)
      assert.ok(has(raw, "The source folder stays byte-untouched"), "the source folder stays byte-untouched");
      assert.ok(has(raw, "read-only source rule survives into the agent lane"), "the CLI's read-only source rule survives into the lane");
      // And it states everything the agent writes must trace to real source content,
      // honest absence standing when inference finds nothing
      assert.ok(has(raw, "must trace to real source content"), "everything written must trace to real source content");
      assert.ok(has(raw, "honest absence stands"), "honest absence stands when inference finds nothing");
      assert.ok(has(raw, "no line states what the source never stated"), "the non-fabrication rule is absolute");
    }
  },
  {
    // Hardening pins for the @manual contracts (tasks 00-matrix/01/02) the body must
    // STATE — the doc's statements are the executable observable; the agent-run
    // passes themselves are the @manual lanes at aof:verify.
    name: "migrate-cmd/body: hardening pins — terminality (refusal/error/dry-run end the flow), inviolable recovered content, honest-absence placement in STATE.md's preamble, inference targets, mode-branched architect review, validate-after-enrichment",
    run: async () => {
      const raw = read(BODY);
      // Terminality: refusal / source-read error → surface + stop, no agent pass.
      // (The refusal's OBSERVABLE is the envelope's `code` STRING "nothing-recoverable"
      // + exit 1 — the internal 422 status never surfaces, so the body must not
      // send an agent grepping for it.)
      assert.ok(hasExact(raw, "{ ok:false, error, code }"), "the refusal/error envelope is named");
      assert.ok(
        hasExact(raw, 'the envelope\'s `code` is `"nothing-recoverable"`'),
        "the refusal names the envelope's code string nothing-recoverable (the observable)"
      );
      assert.ok(!hasExact(raw, "422"), "the body names no internal-only status (422 never surfaces in the envelope or exit)");
      assert.ok(has(raw, "exit 1"), "the non-zero exit is named");
      assert.ok(has(raw, "no agent pass runs"), "a refusal/error means no agent pass runs");
      // Terminality: a dry-run ends the flow after the preview.
      assert.ok(has(raw, "ends the flow after the preview"), "a --dry-run ends the flow after the preview");
      assert.ok(has(raw, "no agent pass writes anything"), "a dry-run means no agent pass writes anything");
      // The seam: recovered content is inviolable (the README+PRD must-not-overwrite edge).
      assert.ok(has(raw, "never rewriting recovered content"), "recovered content is never rewritten");
      assert.ok(has(raw, "stands byte-verbatim"), "a README-recovered objective stands byte-verbatim even beside a PRD");
      // Honest-absence placement (the story's default decision): STATE.md's migration
      // preamble — never the SPEC, never ## Findings.
      assert.ok(
        has(raw, "appended line to the produced STATE.md's migration preamble"),
        "inference-found-nothing is recorded as an appended line to STATE.md's migration preamble"
      );
      assert.ok(hasExact(raw, "NEVER in the SPEC and NEVER in `## Findings`"), "the placement is never the SPEC and never ## Findings");
      // Inference targets (F29-1/F29-2 territory) + grounding names the source doc.
      assert.ok(hasExact(raw, "docs/*prd*.md"), "PRD docs are an inference target");
      assert.ok(hasExact(raw, ".planning/**"), ".planning/** trees are an inference target");
      assert.ok(hasExact(raw, "ARCHITECTURE.md"), "a plain ARCHITECTURE.md by name is an inference target");
      assert.ok(has(raw, "names its source document"), "grounded content names its source document");
      // Architect review at migrate time, branched on work.agents.mode.
      assert.ok(hasExact(raw, "work.agents.mode"), "the review branches on work.agents.mode");
      assert.ok(hasExact(raw, 'other than `"solo"`'), "anything other than solo → orchestrated");
      assert.ok(hasExact(raw, "spawn `aof-architect`"), "orchestrated spawns aof-architect");
      assert.ok(has(raw, "the main session plays the role inline"), "solo → the main session plays the role inline");
      assert.ok(has(raw, "No delivered work → no review lane runs"), "no delivered work → no review lane runs");
      assert.ok(has(raw, "no findings section is invented to look reviewed"), "no findings section invented to look reviewed");
      assert.ok(has(raw, "upgrade or extend the gap-derived rows"), "architect rows upgrade/extend the gap-derived rows");
      assert.ok(has(raw, "never duplicated, never fabricated"), "findings are never duplicated, never fabricated");
      assert.ok(
        has(raw, "names what is wrong, where in the delivered work it shows, and what addressing it entails"),
        "each finding names the what / where / what-it-entails"
      );
      // The produced item must still pass validate after enrichment.
      assert.ok(has(raw, "must still pass `aof work validate`"), "the produced item must still pass aof work validate");
    }
  },
  {
    // Self-test (the m03 non-vacuous discipline): run the SHARED pin predicate
    // (assertCliFirst — the exact logic the real scenario test runs) against two
    // mutants and prove it FAILS on both. Not a re-derivation: the same function.
    name: "migrate-cmd/body (self-test): assertCliFirst FAILS on both mutants — the CLI invocation removed, and the inference lane relocated before the invocation",
    run: async () => {
      const flat = flatten(read(BODY));
      // Sanity: the real body passes the shared predicate (the mutants below are
      // the only difference).
      assertCliFirst(flat);

      // Mutant A — the CLI invocation removed: the PRESENCE pin must trip.
      const withoutCli = flat.replaceAll(flatten(CLI_INVOCATION), "");
      assert.notEqual(withoutCli, flat, "mutant A actually removed the invocation");
      assert.throws(
        () => assertCliFirst(withoutCli),
        /invokes `aof migrate \$ARGUMENTS --json`/,
        "the shared pin FAILS when the CLI invocation is removed"
      );

      // Mutant B — the inference-lane marker RELOCATED to before the invocation:
      // every presence check still passes (all three markers remain), so ONLY the
      // ORDERING predicate can trip — this exercises `cliAt < inferenceAt` itself.
      const marker = flatten(INFERENCE_MARKER);
      const removedMarker = flat.replace(marker, "");
      assert.notEqual(removedMarker, flat, "mutant B actually removed the marker from its real position");
      const cliAt = removedMarker.indexOf(flatten(CLI_INVOCATION));
      assert.ok(cliAt !== -1, "mutant B keeps the CLI invocation");
      const misordered = `${removedMarker.slice(0, cliAt)}${marker} ${removedMarker.slice(cliAt)}`;
      assert.ok(misordered.includes(marker), "mutant B keeps the inference marker present (before the invocation)");
      assert.throws(
        () => assertCliFirst(misordered),
        /precedes the inference lane/,
        "the shared pin FAILS on the ordering predicate when the inference lane precedes the CLI invocation"
      );
    }
  },

  // ====================================================================
  // tasks/03_bundle-distribution-and-nonregression.feature
  // ====================================================================

  {
    // Scenario: the bundle descriptor lists the migrate command member
    name: "migrate-cmd/distribution: the descriptor lists a migrate member — kind command, body commands/migrate.md, claude runtime, aof namespace",
    run: async () => {
      const member = readDescriptor().members.find((m) => m.id === "migrate");
      assert.ok(member, "the descriptor lists a migrate member");
      assert.equal(member.kind, "command", "kind command");
      assert.equal(member.file, "commands/migrate.md", "body file commands/migrate.md");
      assert.deepEqual(member.runtimes, ["claude"], "renders for the claude runtime");
      assert.equal(member.commandNamespace, "aof", "under the aof command namespace");
    }
  },
  {
    // Scenario: the shipped manifest is regenerated, not hand-edited
    name: "migrate-cmd/distribution: regenerating the manifest reproduces the shipped bytes exactly, with a migrate entry whose hash content-addresses the rendered command",
    run: async () => {
      // When the bundle manifest is regenerated from the descriptor
      const regenerated = serializeBundleManifest(generateBundleManifest());
      // Then the regeneration reproduces the shipped src/bundle/manifest.json byte-for-byte
      const shipped = readFileSync(manifestPath(), "utf8");
      assert.equal(regenerated, shipped, "regeneration reproduces the shipped manifest byte-for-byte (ADR-002: derived, never hand-edited)");
      // And the manifest carries an entry for the rendered migrate command whose
      // hash matches the rendered content
      const entry = shippedMigrateEntry();
      assert.equal(entry.path, MIGRATE_REL, "the entry is the rendered .claude/commands/aof/migrate.md");
      assert.equal(entry.runtime, "claude", "claude runtime");
      assert.equal(entry.resource.kind, "command", "kind command");
      const rendered = renderBundleOutputs(loadBundle(), { runtimes: ["claude"] })
        .find((o) => fwd(o.path) === MIGRATE_REL);
      assert.ok(rendered, "the renderer produces the migrate command output");
      assert.equal(entry.hash, hashContent(rendered.content), "the manifest hash is a true content address of the render");
    }
  },
  {
    // Scenario: work update lands the rendered command in an install
    name: "migrate-cmd/distribution: an install behind the shipped bundle gains .claude/commands/aof/migrate.md on `aof work update`, hash matching the shipped manifest entry",
    run: async () => {
      const repo = await tempRepo();
      try {
        // Given an installed workspace behind the shipped bundle (predates migrate).
        await installBase(repo, bundleWithoutMigrate());
        assert.ok(!existsSync(p(repo, ...MIGRATE_REL.split("/"))), "the render is absent before the update");
        // When I run "aof work update"
        const result = await updateWork({ targetDir: repo, bundleOverride: loadBundle(), bundleVersionOverride: "2.0.0" });
        // Then .claude/commands/aof/migrate.md exists in the install
        assert.equal(classOf(result, MIGRATE_REL), "create", "the migrate render is created");
        assert.ok(existsSync(p(repo, ...MIGRATE_REL.split("/"))), "the rendered command exists in the install");
        // And its content hash matches the shipped manifest's entry for it
        const diskHash = await hashFileIfExists(p(repo, ...MIGRATE_REL.split("/")));
        assert.equal(diskHash, shippedMigrateEntry().hash, "the installed file's hash matches the shipped manifest entry");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // Scenario: the mechanical CLI's observable contract is unchanged — the suite-level
    // half runs as the FULL suite (story-29 tests + both fitness functions, untouched);
    // this guard pins the WIRING half by REGISTRY MEMBERSHIP, not source-grep (the
    // acd-roundtrip-registration idiom): a comment or a kept-import-with-dropped-spread
    // would satisfy a substring grep while the suite silently stops running — name-set
    // membership in the runner's assembled `tests` array cannot be satisfied that way.
    name: "migrate-cmd/non-regression: the runner's assembled suite registers every story-29 migrate test, both story-29 fitness functions, and this story's tests (membership, not source-grep)",
    run: async () => {
      const { tests: assembled } = await import(runnerUrl);
      const registered = new Set(assembled.map((t) => t.name));

      // The story-29 migrate suite — every test, by name.
      const { migrateCommandCoreTests } = await import("./migrate-command-core.test.mjs");
      assert.ok(migrateCommandCoreTests.length > 0, "the story-29 migrate suite is non-empty");
      for (const test of migrateCommandCoreTests) {
        assert.ok(registered.has(test.name), `story-29 test registered in the runner: ${test.name}`);
      }

      // Both story-29 fitness functions — every arch-test, by name.
      const { archTests: bijectionTests } = await import("./arch/acd-migrate-command-cli-bijection.test.mjs");
      const { archTests: readOnlyTests } = await import("./arch/acd-migrate-read-only-source.test.mjs");
      assert.ok(bijectionTests.length > 0 && readOnlyTests.length > 0, "both story-29 fitness functions are non-empty");
      for (const test of [...bijectionTests, ...readOnlyTests]) {
        assert.ok(registered.has(test.name), `story-29 fitness function registered in the runner: ${test.name}`);
      }

      // This story's own tests (the migrate-cmd/ prefix) — every one, by name.
      assert.ok(migrateClaudeCommandTests.length > 0, "this story's suite is non-empty");
      for (const test of migrateClaudeCommandTests) {
        assert.ok(registered.has(test.name), `story-31 test registered in the runner: ${test.name}`);
      }
    }
  },

  // ── Scenario Outline: what lands at .claude/commands/aof/migrate.md follows the
  //    install's state (one test per Examples row) ──
  {
    // Row: never init-ed → update refuses pointing at init; the file does not exist
    name: "migrate-cmd/matrix: never-inited workspace — `aof work update` refuses (non-zero, points at aof work init) and .claude/commands/aof/migrate.md does not exist",
    run: async () => {
      const repo = await tempRepo();
      try {
        assert.ok(!existsSync(workLockPath(repo)), "no work section / no lock present");
        const result = await updateWork({ targetDir: repo });
        assert.equal(result.notInitialized, true, "refused → the CLI maps this to a non-zero exit");
        assert.ok(/aof work init/.test(result.message), "the refusal points at aof work init");
        assert.equal(result.manifestWritten, false, "nothing written");
        assert.ok(!existsSync(p(repo, ...MIGRATE_REL.split("/"))), "the rendered command does not exist");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // Row: no install at all → `aof work init` lands the file, hash matches the manifest
    name: "migrate-cmd/matrix: fresh `aof work init` lands .claude/commands/aof/migrate.md with the shipped manifest's hash",
    run: async () => {
      const repo = await tempRepo();
      try {
        const result = await initWork({ targetDir: repo, runtimes: ["claude"] });
        assert.equal(result.guarded, false, "init not guarded on a clean repo");
        const rendered = p(repo, ...MIGRATE_REL.split("/"));
        assert.ok(existsSync(rendered), "the rendered command exists after init");
        assert.equal(await hashFileIfExists(rendered), shippedMigrateEntry().hash, "its hash matches the shipped manifest's entry");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // Row: install current → the re-run rewrites nothing (byte-identical before/after)
    name: "migrate-cmd/matrix: a current install — the `aof work update` re-run skips the migrate render, byte-identical before and after",
    run: async () => {
      const repo = await tempRepo();
      try {
        await installBase(repo, loadBundle());
        const rendered = p(repo, ...MIGRATE_REL.split("/"));
        const before = await readFile(rendered, "utf8");
        const result = await updateWork({ targetDir: repo, bundleOverride: loadBundle(), bundleVersionOverride: "1.0.0" });
        assert.equal(classOf(result, MIGRATE_REL), "skip", "the current render is skipped (rewritten nothing)");
        assert.equal(await readFile(rendered, "utf8"), before, "the rendered file is byte-identical before and after");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // Row: install predates the member → --dry-run reports the pending render, file stays absent
    name: "migrate-cmd/matrix: an install predating the migrate member — `aof work update --dry-run` reports the pending render and the file still does not exist",
    run: async () => {
      const repo = await tempRepo();
      try {
        await installBase(repo, bundleWithoutMigrate());
        const result = await updateWork({ targetDir: repo, bundleOverride: loadBundle(), bundleVersionOverride: "2.0.0", dryRun: true });
        assert.equal(classOf(result, MIGRATE_REL), "create", "the pending render is reported (create)");
        assert.equal(result.manifestWritten, false, "dry-run writes no manifest");
        assert.ok(!existsSync(p(repo, ...MIGRATE_REL.split("/"))), "the rendered command still does not exist");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // Row: locally-edited render + plain update → preserved, reported as drift (ADR-005)
    name: "migrate-cmd/matrix: a locally-edited migrate.md render is preserved on plain `aof work update` and reported as drift — nothing clobbered",
    run: async () => {
      const repo = await tempRepo();
      try {
        await installBase(repo, loadBundle());
        const rendered = p(repo, ...MIGRATE_REL.split("/"));
        const edited = `${await readFile(rendered, "utf8")}\nLOCAL EDIT\n`;
        await writeFile(rendered, edited, "utf8");
        const result = await updateWork({ targetDir: repo, bundleOverride: loadBundle(), bundleVersionOverride: "1.0.0" });
        assert.equal(classOf(result, MIGRATE_REL), "drift-warning", "the local edit is reported as drift");
        assert.equal(await readFile(rendered, "utf8"), edited, "the local bytes are preserved — nothing clobbered");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // Row: locally-edited render + --force → restored to the shipped manifest's hash
    name: "migrate-cmd/matrix: a locally-edited migrate.md render is restored by `aof work update --force` — its hash matches the shipped manifest's entry again",
    run: async () => {
      const repo = await tempRepo();
      try {
        await installBase(repo, loadBundle());
        const rendered = p(repo, ...MIGRATE_REL.split("/"));
        await writeFile(rendered, `${await readFile(rendered, "utf8")}\nLOCAL EDIT\n`, "utf8");
        const result = await updateWork({ targetDir: repo, bundleOverride: loadBundle(), bundleVersionOverride: "1.0.0", force: true });
        assert.equal(classOf(result, MIGRATE_REL), "update", "the drifted render is overwritten under --force");
        assert.equal(await hashFileIfExists(rendered), shippedMigrateEntry().hash, "the file's hash matches the shipped manifest's entry — the local edit is gone");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];
