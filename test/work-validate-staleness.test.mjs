// Traceability wiring for milestone 40 / story 03 (staleness in validate), task
//   wiki/work/40_milestone_work-item-versioning-upgrade/stories/
//     03_story_validate-staleness/tasks/00_validate-flags-behind-item-naming-upgrade.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the REAL `aof work validate --json` CLI face (spawnCliSync over
// bin/aof.mjs, the same fixture-project idiom milestone 40 / story 02's tests
// use — test/support/work-upgrade-fixture.mjs), over a fixture stream mixing
// a stamped-current baseline item with a variable-schema subject item. Black
// box only: the `--json` bare `[{path, problem}]` array, cross-checked against
// each subject item's own on-disk record-doc path. No source read; the
// fixture is a throwaway temp stream, never the live repo.
import assert from "node:assert/strict";
import path from "node:path";
import { withUpgradeProject, writeItem, runCli, parseJsonOut } from "./support/work-upgrade-fixture.mjs";

// Background: a baseline milestone stamped at the current schema (1),
// otherwise well-formed — every scenario's fixture includes it, and it must
// never itself appear in the findings.
async function buildBaseline(workDir) {
  const baselineDir = path.join(workDir, "00_milestone_baseline");
  return writeItem(baselineDir, { type: "milestone", number: "00", slug: "baseline", stamped: true });
}

// Adds the variable-schema SUBJECT item the scenario is actually about, per
// the Outline's `<schema-frontmatter>` column: `schema: 0` -> { schema: 0 },
// "(no schema key)" -> no schema/stamped option at all, `schema: 1` ->
// { schema: 1 }. Lives at a distinct folder number so it never collides with
// the baseline.
async function buildSubject(workDir, schemaOption) {
  const subjectDir = path.join(workDir, "01_milestone_subject");
  return writeItem(subjectDir, { type: "milestone", number: "01", slug: "subject", ...schemaOption });
}

function findingFor(findings, repo, item) {
  const relPath = path.relative(repo, item.path);
  return findings.find((finding) => finding.path === relPath);
}

const OUTLINE_ROWS = [
  { name: "schema: 0", schemaOption: { schema: 0 }, outcome: "include" },
  { name: "(no schema key)", schemaOption: {}, outcome: "include" },
  { name: "schema: 1", schemaOption: { schema: 1 }, outcome: "do not include" },
];

export const workValidateStalenessTests = [
  // Scenario Outline: an item whose schema is below the current
  // WORK_ITEM_SCHEMA_VERSION is flagged; an item at the current schema is not.
  ...OUTLINE_ROWS.map(({ name, schemaOption, outcome }) => ({
    name: `work-validate-staleness/outline: subject frontmatter "${name}" -> findings ${outcome} a staleness entry naming aof upgrade`,
    run: () =>
      withUpgradeProject(
        async ({ workDir }) => {
          await buildBaseline(workDir);
        },
        async ({ repo, workDir }) => {
          const subject = await buildSubject(workDir, schemaOption);

          // A non-empty findings list is a non-zero CLI exit (cli.mjs
          // workValidateCommand) — expect status 1 when a finding is due,
          // status 0 when the stream is clean. Either way the process must
          // have genuinely run (status is a number, not a spawn failure).
          const result = runCli(repo, ["work", "validate", "--json"]);
          assert.equal(typeof result.status, "number", `aof work validate --json produced a real exit (stderr: ${result.stderr})`);
          const findings = parseJsonOut(result);

          const finding = findingFor(findings, repo, subject);
          if (outcome === "include") {
            assert.equal(result.status, 1, `aof work validate --json exits 1 when a finding is present (stderr: ${result.stderr})`);
            assert.ok(finding, `expected a staleness finding on ${subject.path} (findings: ${JSON.stringify(findings)})`);
            assert.match(finding.problem, /aof upgrade/, `finding problem should name "aof upgrade" (got ${JSON.stringify(finding.problem)})`);
          } else {
            assert.equal(result.status, 0, `aof work validate --json exits 0 on a clean stream (stderr: ${result.stderr})`);
            assert.equal(finding, undefined, `expected NO finding on ${subject.path} (findings: ${JSON.stringify(findings)})`);
          }
        },
      ),
  })),

  // The remedy is a STRING LITERAL naming aof upgrade, and the message
  // self-identifies the item as behind the current schema.
  {
    name: "work-validate-staleness/remedy: an unstamped item's finding names aof upgrade and identifies it as behind the current schema",
    run: () =>
      withUpgradeProject(
        async ({ workDir }) => {
          await buildBaseline(workDir);
        },
        async ({ repo, workDir }) => {
          const subject = await buildSubject(workDir, {});

          const result = runCli(repo, ["work", "validate", "--json"]);
          assert.equal(result.status, 1, `aof work validate --json exits 1 when a finding is present (stderr: ${result.stderr})`);
          const findings = parseJsonOut(result);

          const finding = findingFor(findings, repo, subject);
          assert.ok(finding, `expected a staleness finding on ${subject.path} (findings: ${JSON.stringify(findings)})`);
          assert.match(finding.problem, /aof upgrade/, "the problem string contains the literal aof upgrade");
          assert.match(
            finding.problem,
            /behind the current schema/,
            `the problem string identifies the item as behind the current schema (got ${JSON.stringify(finding.problem)})`,
          );
        },
      ),
  },

  // A stream whose every item is stamped at the current schema produces no
  // staleness finding — silence for the right reason.
  {
    name: "work-validate-staleness/clean: a stream whose every item is stamped at the current schema produces no staleness finding",
    run: () =>
      withUpgradeProject(
        async ({ workDir }) => {
          await buildBaseline(workDir);
        },
        async ({ repo }) => {
          const result = runCli(repo, ["work", "validate", "--json"]);
          assert.equal(result.status, 0, `aof work validate --json exits 0 (stderr: ${result.stderr})`);
          const findings = parseJsonOut(result);

          assert.ok(
            findings.every((finding) => !/aof upgrade/.test(finding.problem)),
            `no finding should name aof upgrade (findings: ${JSON.stringify(findings)})`,
          );
          assert.deepEqual(findings, [], "the --json findings are empty across the fixture stream");
        },
      ),
  },

  // Determinism / dep-01-only: the staleness finding is byte-identical across
  // two runs, names the command without enumerating pending transforms, and
  // never names `aof upgrade --dry-run` (that is story 02's --dry-run face).
  {
    name: "work-validate-staleness/deterministic: the staleness finding is byte-identical across two runs and names the command without enumerating pending transforms",
    run: () =>
      withUpgradeProject(
        async ({ workDir }) => {
          await buildBaseline(workDir);
        },
        async ({ repo, workDir }) => {
          const subject = await buildSubject(workDir, {});

          const first = runCli(repo, ["work", "validate", "--json"]);
          const second = runCli(repo, ["work", "validate", "--json"]);
          assert.equal(first.status, 1, `first aof work validate --json exits 1 when a finding is present (stderr: ${first.stderr})`);
          assert.equal(second.status, 1, `second aof work validate --json exits 1 when a finding is present (stderr: ${second.stderr})`);
          assert.equal(first.stdout, second.stdout, "both runs emit byte-identical --json findings");

          const findings = parseJsonOut(first);
          const finding = findingFor(findings, repo, subject);
          assert.ok(finding, `expected a staleness finding on ${subject.path} (findings: ${JSON.stringify(findings)})`);
          assert.match(finding.problem, /aof upgrade/, "the problem string names aof upgrade");
          assert.doesNotMatch(finding.problem, /\d+\s+(pending|transform)/i, "the problem string carries no count of pending transforms");
          assert.doesNotMatch(finding.problem, /\[|\]/, "the problem string carries no list of pending transforms");
          assert.doesNotMatch(finding.problem, /\bid\s*[:=]/i, "the problem string carries no transform id");
          assert.doesNotMatch(finding.problem, /aof upgrade --dry-run/, "no finding names aof upgrade --dry-run");
        },
      ),
  },
];
