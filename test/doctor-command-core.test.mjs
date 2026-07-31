// Traceability wiring for milestone 15 / story 00 — the doctor command core.
//
// Covers EVERY @executable scenario across story-00's four task features,
// exercising the REAL in-process registry (src/command-core.mjs + the engine in
// src/work-doctor.mjs) against temp fixture repos — loadWorkspace + invoke, real
// fs, in-process — mirroring command-core-contract.test.mjs's house style. One
// test object per @executable scenario (Scenario-Outline rows folded into one
// entry), each name tracing to feature + scenario.
//
//   00_doctor-command.feature — getCommand resolves work:doctor / invoke →
//        { findings } only / clean→empty / one seeded violation → one finding /
//        scope-as-filter (subtree, out-of-scope, unresolved)
//   01_cli-face.feature       — healthy line / severity:code—message cwd-relative /
//        --json envelope+summary / advisory-by-default / --strict surfaced /
//        scope positional
//   02_board-face.feature     — /api/work/doctor envelope / projectRoot-relative+
//        forward-slashed paths / set == run's / board never gates / scope query
//   03_engine-spine.feature   — snapshot built once / appended group contributes /
//        two groups both contribute / de-dupe / distinct-by-path / injected clock /
//        scope-as-filter
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { getCommand, invoke } from "../src/command-core.mjs";
import { doctorWork } from "../src/work-doctor.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// --- fixture builders (mirrors command-core-contract.test.mjs) ---------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-doctor-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  return { repo, workDir };
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// The recorded `updated` for every fixture item; folder file mtimes are pinned to
// it (below) so the freshness group's mtime-ahead-of-updated check stays inert on a
// fixture meant to be clean — independent of the real wall clock at write time.
// RELATIVE to the real clock, deliberately (fixed en route in m42 wave (d) d5;
// pre-existing at HEAD, verified by stash): the command reads Date.now() at its
// impure edge, so a HARDCODED fixture date ages past the stale window and turns
// every "clean stream" lane red ~a month after it is written. Three days back
// keeps the freshness group inert while staying inside any sane stale window.
const FIXTURE_DATE = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const FIXTURE_MTIME = new Date(Date.parse(FIXTURE_DATE + "T00:00:00Z"));

// Pin every file directly in `dir` back to FIXTURE_MTIME so the snapshot's
// newest-descendant-file mtime never trails the wall clock (story 02's
// mtime-ahead-of-updated would otherwise fire on a freshly written fixture).
async function pinMtimes(dir, names) {
  for (const name of names) {
    try {
      await utimes(path.join(dir, name), FIXTURE_MTIME, FIXTURE_MTIME);
    } catch {
      // best-effort: a missing file is simply not pinned
    }
  }
}

async function milestone(workDir, { number, slug, status = "in-progress", title = "M" }) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPEC.md"),
    frontmatter({ type: "milestone", number, slug, status, title: `"${title}"`, created: FIXTURE_DATE, updated: FIXTURE_DATE }) + `# ${number} · ${title}\n`,
    "utf8"
  );
  // A milestone with stories needs an ARCHITECTURE.md to be lifecycle-complete
  // (story 01's missing-architecture check); always provide one for a clean fixture.
  await writeFile(path.join(dir, "ARCHITECTURE.md"), "# Architecture\n\nADR-000.\n", "utf8");
  await pinMtimes(dir, ["SPEC.md", "ARCHITECTURE.md"]);
  return dir;
}

async function story(workDir, milestoneFolder, { number, slug, status = "in-progress", title = "S", parent }) {
  const dir = path.join(workDir, milestoneFolder, "stories", `${number}_story_${slug}`);
  await mkdir(path.join(dir, "tasks"), { recursive: true });
  await writeFile(
    path.join(dir, "STORY.md"),
    frontmatter({ type: "story", number, slug, status, title: `"${title}"`, parent, created: FIXTURE_DATE, updated: FIXTURE_DATE }) + `# ${number} · ${title}\n`,
    "utf8"
  );
  // A started story needs a non-empty tasks/ to be lifecycle-complete (story 01's
  // started-story-no-tasks check); seed a task file for a clean fixture.
  await writeFile(path.join(dir, "tasks", "00_task.feature"), "@executable\nFeature: fixture\n", "utf8");
  await pinMtimes(dir, ["STORY.md"]);
  await pinMtimes(path.join(dir, "tasks"), ["00_task.feature"]);
  return dir;
}

// A clean, coherent stream (no orphan folder, no duplicate driver number) under
// milestone 07 — the seeded-violation tests add the incoherence themselves.
async function cleanStream(workDir) {
  await milestone(workDir, { number: "07", slug: "alpha" });
  await story(workDir, "07_milestone_alpha", { number: "00", slug: "spine", parent: "7" });
}

// Seed an `orphan-folder` (warn) under milestone 07 — a typo'd story folder.
async function seedOrphan(workDir, milestoneFolder = "07_milestone_alpha") {
  await mkdir(path.join(workDir, milestoneFolder, "stories", "not-a-valid-folder"), { recursive: true });
}

// Seed a `duplicate-driver-number` (error) — a second top-level driver at 07. It is
// `not-started` with no stories so it adds ONLY the duplicate-driver error (a started
// story-less milestone would also trip story 01's milestone-no-stories warn).
async function seedDuplicate(workDir) {
  await milestone(workDir, { number: "07", slug: "beta", status: "not-started" }); // 07 already exists as alpha
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// --- a board stand-up (mirrors acd-work-command-route-coverage) --------------

let serveSetupUi;
async function loadBoard() {
  if (!serveSetupUi) ({ serveSetupUi } = await import("../src/setup-ui.mjs"));
  return serveSetupUi;
}

export const doctorCommandCoreTests = [
  // ════════════════════════ 00_doctor-command.feature ═══════════════════════
  {
    name: "doctor/00 getCommand resolves work:doctor to a registered command",
    async run() {
      const command = getCommand("work:doctor");
      assert.ok(command, "getCommand returns a command");
      assert.equal(command.id, "work:doctor", "the command has the id work:doctor");
      assert.ok(command.input && typeof command.input === "object", "has an input schema");
      assert.equal(command.run.constructor.name, "AsyncFunction", "run is an async function");
      assert.ok(command.cli && typeof command.cli === "object", "has a cli adapter");
    },
  },
  {
    name: "doctor/00 invoke over the workspace returns the { findings } envelope (no other field)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await cleanStream(workDir);
        const result = await invoke("work:doctor", {}, await ctxFor(repo));
        assert.ok(Array.isArray(result.findings), "the result carries a findings array");
        assert.deepEqual(Object.keys(result), ["findings"], "the result carries no other top-level field");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/00 a coherent fixture yields empty findings (healthy is silent)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await cleanStream(workDir);
        const result = await invoke("work:doctor", {}, await ctxFor(repo));
        assert.deepEqual(result.findings, [], "a clean stream is an empty findings array");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/00 one seeded cross-item violation yields exactly one finding naming the cross-item fact",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await cleanStream(workDir);
        await seedOrphan(workDir); // exactly one cross-item incoherence
        const result = await invoke("work:doctor", {}, await ctxFor(repo));
        assert.equal(result.findings.length, 1, "exactly one finding");
        const finding = result.findings[0];
        assert.ok(typeof finding.code === "string" && finding.code.length > 0, "the finding carries a non-empty code");
        assert.ok(typeof finding.message === "string" && finding.message.length > 0, "the message names the cross-item fact");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/00 scope filters the findings to a subtree; an unresolved scope is empty without error",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // Seed an incoherence under milestone 07 (an orphan story folder). Milestone
        // 08 is not-started + story-less so it stays clean (no milestone-no-stories).
        await cleanStream(workDir);
        await milestone(workDir, { number: "08", slug: "bravo", status: "not-started" });
        await seedOrphan(workDir, "07_milestone_alpha");
        const ctx = await ctxFor(repo);

        // scope "07" (seeded-ref 07) → only that subtree's findings (one)
        const scoped07 = await invoke("work:doctor", { scope: "07" }, ctx);
        assert.equal(scoped07.findings.length, 1, "scope 07 returns the seeded subtree finding");
        assert.ok(scoped07.findings[0].path.includes("07_milestone_alpha"), "the finding is under 07");

        // scope "08" (out-of-scope subtree) → empty
        const scoped08 = await invoke("work:doctor", { scope: "08" }, ctx);
        assert.deepEqual(scoped08.findings, [], "an out-of-scope subtree is empty");

        // scope "99/no-such" (unresolved) → empty, no throw
        let threw = false;
        let unresolved;
        try {
          unresolved = await invoke("work:doctor", { scope: "99/no-such" }, ctx);
        } catch {
          threw = true;
        }
        assert.equal(threw, false, "an unresolved scope does not raise");
        assert.deepEqual(unresolved.findings, [], "an unresolved scope matches nothing");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  {
    name: "doctor/00 a stream-level (workDir-anchored) finding is reported even under a narrow item scope",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // Seed a duplicate-driver-number (error, anchored at the stream root) AND an
        // item-anchored orphan under milestone 07. A narrow scope to story 07/00 must
        // still surface the stream-level duplicate (a stream-integrity fact is not
        // scoped away — matching validateWork's workDir-anchored `depends cycle`),
        // while dropping the out-of-subtree item-anchored orphan.
        await cleanStream(workDir);
        await seedDuplicate(workDir); // duplicate-driver-number → path === workDir
        await seedOrphan(workDir, "07_milestone_alpha"); // orphan under 07's stories/
        const ctx = await ctxFor(repo);

        // Scope to the spine story 07/00 — a folder that contains NEITHER the orphan
        // (sibling stories/ folder) NOR the stream root.
        const scoped = await invoke("work:doctor", { scope: "07/00" }, ctx);
        const codes = scoped.findings.map((f) => f.code);
        assert.ok(codes.includes("duplicate-driver-number"), "the stream-level finding survives the narrow scope");
        const dup = scoped.findings.find((f) => f.code === "duplicate-driver-number");
        assert.equal(dup.path, workDir, "the stream-level finding stays anchored at the stream root");
        assert.ok(!codes.includes("orphan-folder"), "the out-of-subtree item-anchored finding is scoped away");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ════════════════════════ 01_cli-face.feature ═════════════════════════════
  {
    name: "doctor/01 a clean stream renders the healthy line and lists no finding lines",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await cleanStream(workDir);
        const result = runCli(repo, ["work", "doctor"]);
        assert.equal(result.status, 0, `clean stream exits 0 (stderr: ${result.stderr})`);
        assert.match(result.stdout, /healthy/, "the output contains a healthy line");
        assert.ok(!/^(warn|error):/m.test(result.stdout), "no finding lines listed");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/01 each finding renders a severity-coded line with a cwd-relative path",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // A duplicate driver number is an error-severity finding.
        await cleanStream(workDir);
        await seedDuplicate(workDir);
        const result = runCli(repo, ["work", "doctor"]);
        // the line is of the form "severity: code — message (path)"
        const line = result.stdout.split(/\r?\n/).find((l) => /^error: duplicate-driver-number — /.test(l));
        assert.ok(line, `a severity-coded line is rendered (stdout: ${result.stdout})`);
        // path shown relative to cwd (the repo root), not absolute
        const pathMatch = line.match(/\(([^)]+)\)\s*$/);
        assert.ok(pathMatch, "the line carries a parenthesised path");
        const shown = pathMatch[1];
        assert.ok(!path.isAbsolute(shown), `the shown path is not absolute (got ${shown})`);
        assert.ok(shown.startsWith("wiki"), "the path is cwd-relative (begins under wiki/work)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/01 --json emits the canonical envelope plus the { healthy, strict, errors, warnings, findings } summary",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // one warn (orphan) + one error (duplicate driver)
        await cleanStream(workDir);
        await seedOrphan(workDir);
        await seedDuplicate(workDir);
        const result = runCli(repo, ["work", "doctor", "--json"]);
        const parsed = JSON.parse(result.stdout);
        assert.ok(Array.isArray(parsed.findings), "findings is an array");
        for (const finding of parsed.findings) {
          for (const key of ["code", "severity", "path", "message"]) {
            assert.ok(key in finding, `each finding carries ${key}`);
          }
          assert.ok(!path.isAbsolute(finding.path), `finding path is cwd-relative, not absolute (got ${finding.path})`);
        }
        assert.equal(typeof parsed.healthy, "boolean", "healthy is a boolean");
        assert.equal(typeof parsed.strict, "boolean", "strict is a boolean");
        assert.equal(parsed.errors, 1, "errors count is 1");
        assert.equal(parsed.warnings, 1, "warnings count is 1");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/01 a warn-only stream is advisory (healthy) by default",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await cleanStream(workDir);
        await seedOrphan(workDir); // warn findings only
        const result = runCli(repo, ["work", "doctor", "--json"]);
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.strict, false, "strict is false without the flag");
        assert.equal(parsed.healthy, true, "warn-only is healthy by default");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/01 --strict is accepted and surfaced, leaving the reported finding set intact",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await cleanStream(workDir);
        await seedOrphan(workDir); // warn findings only
        const without = JSON.parse(runCli(repo, ["work", "doctor", "--json"]).stdout);
        const withStrict = JSON.parse(runCli(repo, ["work", "doctor", "--strict", "--json"]).stdout);

        // | (no flag) | strict=false | healthy=true  |
        assert.equal(without.strict, false);
        assert.equal(without.healthy, true);
        // | --strict   | strict=true  | healthy=false |
        assert.equal(withStrict.strict, true);
        assert.equal(withStrict.healthy, false);
        // the same warn finding set is still reported (the flag is a face concern)
        assert.deepEqual(
          withStrict.findings.map((f) => f.code).sort(),
          without.findings.map((f) => f.code).sort(),
          "--strict leaves the findings list intact"
        );
        assert.ok(without.findings.length >= 1, "the warn finding is listed");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/01 a scope positional filters the rendered findings to that subtree",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // findings under milestone 07 (orphan), none under milestone 08 (08 is
        // not-started + story-less so the doctor reports it clean)
        await cleanStream(workDir);
        await milestone(workDir, { number: "08", slug: "bravo", status: "not-started" });
        await seedOrphan(workDir, "07_milestone_alpha");
        const result = runCli(repo, ["work", "doctor", "08"]);
        assert.equal(result.status, 0, `scoped clean subtree exits 0 (stderr: ${result.stderr})`);
        assert.match(result.stdout, /healthy/, "scoping to a clean subtree renders the healthy line");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ════════════════════════ 02_board-face.feature ═══════════════════════════
  {
    name: "doctor/02 GET /api/work/doctor answers a JSON findings envelope",
    async run() {
      const serve = await loadBoard();
      const { repo, workDir } = await makeRepo();
      await cleanStream(workDir);
      const { server, url } = await serve(null, { projectDir: repo, port: 0 });
      try {
        const response = await fetch(new URL("/api/work/doctor", url));
        assert.equal(response.status, 200, "the route answers 200");
        assert.ok(response.headers.get("content-type")?.includes("application/json"), "JSON content type");
        const body = await response.json();
        assert.ok(Array.isArray(body.findings), "the body carries a findings array");
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/02 each finding path is projectRoot-relative and forward-slashed",
    async run() {
      const serve = await loadBoard();
      const { repo, workDir } = await makeRepo();
      await cleanStream(workDir);
      await seedOrphan(workDir); // a seeded finding
      const { server, url } = await serve(null, { projectDir: repo, port: 0 });
      try {
        const body = await (await fetch(new URL("/api/work/doctor", url))).json();
        assert.ok(body.findings.length >= 1, "the seeded finding is served");
        for (const finding of body.findings) {
          assert.ok(!path.isAbsolute(finding.path), `path is not an absolute OS path (got ${finding.path})`);
          assert.ok(!finding.path.includes("\\"), "path uses forward slashes, no backslashes");
          assert.ok(finding.path.startsWith("wiki/"), "path is relative to the project root");
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/02 the served finding set equals the command's run, only path-projected",
    async run() {
      const serve = await loadBoard();
      const { repo, workDir } = await makeRepo();
      await cleanStream(workDir);
      await seedOrphan(workDir);
      await seedDuplicate(workDir); // seeded findings (multiple)
      const { server, url } = await serve(null, { projectDir: repo, port: 0 });
      try {
        const body = await (await fetch(new URL("/api/work/doctor", url))).json();
        const run = await invoke("work:doctor", {}, await ctxFor(repo));
        // codes + messages match one-for-one
        const wire = body.findings.map((f) => `${f.code}|${f.message}`).sort();
        const raw = run.findings.map((f) => `${f.code}|${f.message}`).sort();
        assert.deepEqual(wire, raw, "the board set's codes+messages match run's one-for-one");
        // only the paths differ — wire is projected, run is raw absolute
        for (const finding of body.findings) {
          assert.ok(!path.isAbsolute(finding.path), "the board path is projected, not raw absolute");
        }
        for (const finding of run.findings) {
          assert.ok(path.isAbsolute(finding.path), "the run path is a raw absolute");
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/02 the board never gates — a strict query param does not change the answer",
    async run() {
      const serve = await loadBoard();
      const { repo, workDir } = await makeRepo();
      await cleanStream(workDir);
      await seedOrphan(workDir); // warn findings only
      const { server, url } = await serve(null, { projectDir: repo, port: 0 });
      try {
        for (const query of ["", "?strict=1"]) {
          const response = await fetch(new URL(`/api/work/doctor${query}`, url));
          assert.equal(response.status, 200, `${query || "(no query)"} answers 200`);
          assert.ok(response.headers.get("content-type")?.includes("application/json"), "JSON content type");
          const body = await response.json();
          assert.ok(body.findings.every((f) => f.severity === "warn"), "the same warn findings are served");
          assert.ok(!("exitCode" in body) && !("gate" in body) && !("healthy" in body) && !("strict" in body), "no exit-code or gate field");
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/02 a scope query filters the served findings; an unresolved scope is empty, not an error",
    async run() {
      const serve = await loadBoard();
      const { repo, workDir } = await makeRepo();
      await cleanStream(workDir);
      await milestone(workDir, { number: "08", slug: "bravo", status: "not-started" });
      await seedOrphan(workDir, "07_milestone_alpha"); // seeded under milestone 07
      const { server, url } = await serve(null, { projectDir: repo, port: 0 });
      try {
        // scope 07 → only the subtree's findings
        const s07 = await (await fetch(new URL("/api/work/doctor?scope=07", url))).json();
        assert.ok(s07.findings.length >= 1 && s07.findings.every((f) => f.path.includes("07_milestone_alpha")), "scope 07 returns only the subtree");
        // scope 08 → empty (out of scope)
        const r08 = await fetch(new URL("/api/work/doctor?scope=08", url));
        assert.equal(r08.status, 200, "scope 08 answers 200, not an error");
        assert.deepEqual((await r08.json()).findings, [], "out-of-scope subtree is empty");
        // scope 99/no-such → empty, not an error
        const r99 = await fetch(new URL("/api/work/doctor?scope=99/no-such", url));
        assert.equal(r99.status, 200, "an unresolved scope answers 200, not an error");
        assert.deepEqual((await r99.json()).findings, [], "an unresolved scope is empty");
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ════════════════════════ 03_engine-spine.feature ═════════════════════════
  {
    name: "doctor/03 the engine builds a single item snapshot from the shared model",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // 3 enumerable items: milestone 07 + two stories.
        await milestone(workDir, { number: "07", slug: "alpha" });
        await story(workDir, "07_milestone_alpha", { number: "00", slug: "one", parent: "7" });
        await story(workDir, "07_milestone_alpha", { number: "01", slug: "two", parent: "7" });
        const { config } = await loadWorkspace(repo);

        let seenSnapshot = null;
        const oneFindingPerItem = (snapshot) => {
          seenSnapshot = snapshot;
          return snapshot.items.map((item) => ({ code: "per-item", severity: "warn", path: item.dir, message: `item ${item.ref}` }));
        };
        const findings = await doctorWork(workDir, config, undefined, { now: 0, groups: [oneFindingPerItem] });
        assert.equal(findings.length, 3, "exactly 3 findings (one per enumerated item)");
        assert.equal(seenSnapshot.items.length, 3, "the snapshot lists exactly the 3 enumerated items");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/03 a group appended to the registry contributes its findings",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await cleanStream(workDir);
        const { config } = await loadWorkspace(repo);
        const stub = () => [{ code: "stub-probe", severity: "warn", path: workDir, message: "probe" }];
        const findings = await doctorWork(workDir, config, undefined, { now: 0, groups: [stub] });
        assert.ok(findings.some((f) => f.code === "stub-probe"), "the appended group's finding appears");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/03 two appended groups both contribute their findings",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await cleanStream(workDir);
        const { config } = await loadWorkspace(repo);
        const groupA = () => [{ code: "group-a", severity: "warn", path: workDir, message: "a" }];
        const groupB = () => [{ code: "group-b", severity: "warn", path: workDir, message: "b" }];
        const findings = await doctorWork(workDir, config, undefined, { now: 0, groups: [groupA, groupB] });
        assert.ok(findings.some((f) => f.code === "group-a"), "group A contributes");
        assert.ok(findings.some((f) => f.code === "group-b"), "group B contributes");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/03 identical code+path+message findings from different groups de-dupe to one",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await cleanStream(workDir);
        const { config } = await loadWorkspace(repo);
        const P = path.join(workDir, "P");
        const groupA = () => [{ code: "dup", severity: "warn", path: P, message: "M" }];
        const groupB = () => [{ code: "dup", severity: "warn", path: P, message: "M" }];
        const findings = await doctorWork(workDir, config, undefined, { now: 0, groups: [groupA, groupB] });
        const dups = findings.filter((f) => f.code === "dup" && f.path === P);
        assert.equal(dups.length, 1, "the identical finding collapses to one");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/03 findings differing in path are kept distinct",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await cleanStream(workDir);
        const { config } = await loadWorkspace(repo);
        const P1 = path.join(workDir, "P1");
        const P2 = path.join(workDir, "P2");
        const groupA = () => [{ code: "dup", severity: "warn", path: P1, message: "M" }];
        const groupB = () => [{ code: "dup", severity: "warn", path: P2, message: "M" }];
        const findings = await doctorWork(workDir, config, undefined, { now: 0, groups: [groupA, groupB] });
        assert.equal(findings.filter((f) => f.code === "dup").length, 2, "two findings with code dup (distinct paths)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/03 a group receives now and staleWindow through ctx and acts on them",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // one item with a recorded date of 2026-06-18
        await milestone(workDir, { number: "07", slug: "alpha" });
        const recorded = Date.parse("2026-06-18");
        const { config } = await loadWorkspace(repo);

        // A now-sensitive stub: emit only when (now - recorded) > staleWindow.
        const nowSensitive = (snapshot, ctx) =>
          snapshot.items
            .filter(() => ctx.now - recorded > ctx.staleWindow)
            .map((item) => ({ code: "stale", severity: "warn", path: item.dir, message: "stale" }));

        const day = 24 * 60 * 60 * 1000;
        // | 2026-06-25 | 7d    | includes | (now - 2026-06-18 = 7d, > ... actually 7d window; use older now)
        const includes = await doctorWork(workDir, config, undefined, {
          now: Date.parse("2026-06-30"), staleWindow: 7 * day, groups: [nowSensitive],
        });
        assert.ok(includes.some((f) => f.code === "stale"), "includes the now-sensitive finding when older than the window");

        // | 2020-01-01 | 7d    | omits | (now is BEFORE recorded → not stale)
        const omitsPast = await doctorWork(workDir, config, undefined, {
          now: Date.parse("2020-01-01"), staleWindow: 7 * day, groups: [nowSensitive],
        });
        assert.ok(!omitsPast.some((f) => f.code === "stale"), "omits when now is before the recorded date");

        // | 2026-06-25 | 9999d | omits | (window too large to be stale)
        const omitsWide = await doctorWork(workDir, config, undefined, {
          now: Date.parse("2026-06-25"), staleWindow: 9999 * day, groups: [nowSensitive],
        });
        assert.ok(!omitsWide.some((f) => f.code === "stale"), "omits when the window is wider than the gap");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "doctor/03 scope filters the engine result; an unresolved scope is empty without throwing",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await milestone(workDir, { number: "07", slug: "alpha" });
        await story(workDir, "07_milestone_alpha", { number: "00", slug: "one", parent: "7" });
        await milestone(workDir, { number: "08", slug: "bravo" });
        const { config } = await loadWorkspace(repo);
        const onePerItem = (snapshot) => snapshot.items.map((item) => ({ code: "per-item", severity: "warn", path: item.dir, message: item.ref }));

        // scope 07 → only that subtree's findings (milestone 07 + its story = 2)
        const s07 = await doctorWork(workDir, config, "07", { now: 0, groups: [onePerItem] });
        assert.ok(s07.length >= 1 && s07.every((f) => f.path.includes("07_milestone_alpha")), "scope 07 returns only that subtree");

        // scope 99/no-such → empty, no throw
        let threw = false;
        let unresolved;
        try {
          unresolved = await doctorWork(workDir, config, "99/no-such", { now: 0, groups: [onePerItem] });
        } catch {
          threw = true;
        }
        assert.equal(threw, false, "doctorWork does not throw on an unresolved scope");
        assert.deepEqual(unresolved, [], "an unresolved scope is empty");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
