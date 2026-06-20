// Fitness function for milestone 02 / ADR-001 (marketplace-source superseded by
// ADR-007, the pinned REF superseded again by ADR-008):
// "aof planning init emits, for the recommended set,
//  <runtime> plugin marketplace add https://github.com/phuryn/pm-skills.git#v2.0.0
//  — the marketplace add pins the CLONABLE release tag `#v2.0.0` (an HTTPS git URL
//  with a named branch/tag ref), NEVER a bare 40-hex commit sha (which
//  `claude plugin marketplace add` → `git clone --branch <ref>` cannot resolve,
//  VERIFICATION.md Finding F2) and NEVER the `phuryn/pm-skills@<sha>` shorthand
//  (which Claude clones over SSH and fails HTTPS-only GitHub auth, Finding F1) —
//  then <runtime> plugin install <plugin>@pm-skills (verb `install`, marketplace
//  token `pm-skills`, never `add`/`plugin add`) and performs no network call or
//  spawn (the dry-run previews the real tag with zero process launches)."
//
// Proofs:
//  1. Build the plan; assert the marketplace-add command is the HTTPS `.git#v2.0.0`
//     URL (pins the immutable tag = MARKETPLACE_VERSION), is NOT the SSH-able
//     `owner/repo@<sha>` shorthand (guards the F1 regression), and the emitted
//     `#<ref>` is NOT a bare 40-hex sha (guards the F2 regression — the cheap
//     deterministic catch; the networked proof that the ref actually clones lives
//     in acd-planning-clonable-ref).
//  2. Assert each install command matches the pinned verbs/tokens for the 3 core
//     plugins and that the per-plugin verb is `install`, never `add`.
//  3. Assert the dry-run path makes no spawn — inject a spawn spy and run an actual
//     dry-run through initPlanning; the spy must record zero process launches, and
//     the preview shows the real `#v2.0.0` tag (not a `<sha>` placeholder).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  initPlanning,
  planPlanningInstall,
  CORE_PLUGINS,
  MARKETPLACE_REF
} from "../../src/planning-init.mjs";

const FIXTURE_SHA = "d384f0c9eb81fe74656a4f6da168587836939edb";
// ADR-008: the clonable release tag the marketplace-add `#<ref>` must pin. The real
// upstream git tag is `v2.0.0` (WITH the leading `v`), exported as MARKETPLACE_REF
// (the value the marketplace argv interpolates) — assert against it so the test
// binds to the single exported source of truth, not a literal.
const MARKETPLACE_TAG = MARKETPLACE_REF; // "v2.0.0" → the `#v2.0.0` clone ref
const SHA_REF_RE = /#[0-9a-f]{40}$/; // a bare 40-hex commit sha pinned as the ref — F2

export const archTests = [
  {
    name: "arch/ADR-008: the plan pins the marketplace add at the HTTPS git URL with the immutable TAG as the #<ref>",
    run: async () => {
      const plan = planPlanningInstall({ runtime: "claude", sha: FIXTURE_SHA });
      const marketplace = plan.find((item) => item.kind === "marketplace");
      assert.ok(marketplace, "the plan contains a marketplace add step");
      assert.equal(
        marketplace.command,
        `claude plugin marketplace add https://github.com/phuryn/pm-skills.git#${MARKETPLACE_TAG}`,
        "marketplace add pins the clonable release tag `#v2.0.0` on the HTTPS git URL (= MARKETPLACE_VERSION)"
      );
      assert.ok(
        marketplace.command.endsWith(`#${MARKETPLACE_TAG}`),
        "the marketplace-add command ends with the `#<tag>` clone ref"
      );
      assert.ok(
        marketplace.command.includes("https://github.com/phuryn/pm-skills.git#"),
        "the marketplace source is the HTTPS git URL with a `#<ref>` fragment"
      );
    }
  },
  {
    // F2 regression guard (ADR-008, deterministic/offline): `claude plugin
    // marketplace add <url>#<ref>` runs `git clone --branch <ref>`, which cannot
    // resolve a bare commit sha — so the emitted `#<ref>` must be a NAMED ref
    // (branch/tag), NOT a 40-hex sha. This is the cheap catch; the networked proof
    // the ref actually clones is in acd-planning-clonable-ref.
    name: "arch/ADR-008: the marketplace #<ref> is NOT a bare 40-hex commit sha (guards the F2 unclonable-ref regression)",
    run: async () => {
      for (const sha of [FIXTURE_SHA, "5042ff6169e0df49086c846f69bf7b6cdb67a6de"]) {
        const plan = planPlanningInstall({ runtime: "claude", sha });
        const marketplace = plan.find((item) => item.kind === "marketplace");
        assert.ok(marketplace, "the plan contains a marketplace add step");
        assert.ok(
          !SHA_REF_RE.test(marketplace.command),
          `marketplace #<ref> must be a clonable named ref, never a bare 40-hex sha (F2): ${marketplace.command}`
        );
        const ref = marketplace.command.split("#").pop();
        assert.ok(
          !/^[0-9a-f]{40}$/.test(ref),
          `the emitted ref "${ref}" must not be a bare commit sha (git clone --branch cannot resolve it)`
        );
      }
    }
  },
  {
    name: "arch/ADR-007: the marketplace add is NOT the bare owner/repo shorthand (guards the SSH-clone F1 regression)",
    run: async () => {
      const plan = planPlanningInstall({ runtime: "claude", sha: FIXTURE_SHA });
      const marketplace = plan.find((item) => item.kind === "marketplace");
      assert.ok(marketplace, "the plan contains a marketplace add step");
      assert.ok(
        !marketplace.command.includes(`phuryn/pm-skills@${FIXTURE_SHA}`),
        "the SSH-able `owner/repo@<sha>` shorthand appears nowhere in the marketplace-add command (F1)"
      );
      assert.ok(
        !/\bphuryn\/pm-skills@/.test(marketplace.command),
        "no `phuryn/pm-skills@<ref>` shorthand at all (Claude clones it over SSH — F1)"
      );
      assert.ok(
        marketplace.command.includes("https://github.com/phuryn/pm-skills.git#"),
        "the marketplace source is an HTTPS git URL with a `#<ref>` fragment ref"
      );
    }
  },
  {
    name: "arch/ADR-001: each core plugin is installed with `claude plugin install <plugin>@pm-skills` (verb install, token pm-skills)",
    run: async () => {
      const plan = planPlanningInstall({ runtime: "claude", sha: FIXTURE_SHA });
      const installs = plan.filter((item) => item.kind === "install");
      assert.deepEqual(installs.map((item) => item.plugin), CORE_PLUGINS, "installs the 3 core plugins by default");
      for (const plugin of CORE_PLUGINS) {
        const item = installs.find((entry) => entry.plugin === plugin);
        assert.equal(
          item.command,
          `claude plugin install ${plugin}@pm-skills`,
          `${plugin} install uses verb \`install\` and marketplace token \`pm-skills\``
        );
      }
    }
  },
  {
    name: "arch/ADR-001: the per-plugin verb is `install`, never `add` (no `claude plugin add` in any plan)",
    run: async () => {
      for (const withOptional of [false, true]) {
        const plan = planPlanningInstall({ runtime: "claude", sha: FIXTURE_SHA, withOptional });
        for (const item of plan.filter((entry) => entry.kind === "install")) {
          assert.equal(item.argv[1], "plugin", "argv: <runtime> plugin ...");
          assert.equal(item.argv[2], "install", "argv verb is install");
          assert.ok(!/\bplugin add\b/.test(item.command), "no `plugin add` in an install command");
        }
      }
    }
  },
  {
    name: "arch/ADR-001: every plan command is argv-derived (command === argv.join(' '), no shell string)",
    run: async () => {
      const plan = planPlanningInstall({ runtime: "claude", sha: FIXTURE_SHA, withOptional: true });
      for (const item of plan) {
        assert.ok(Array.isArray(item.argv) && item.argv.length > 0, "each item carries an argv");
        assert.equal(item.command, item.argv.join(" "), "command is the argv joined (spawn discipline is argv-based)");
      }
    }
  },
  {
    name: "arch/ADR-001: the dry-run path makes no process spawn (a spy records zero launches)",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-planning-spawn-"));
      let launches = 0;
      const spawnSpy = (...args) => {
        launches += 1;
        return { status: 0, stdout: "" };
      };
      try {
        await initPlanning({
          targetDir: repo,
          sha: FIXTURE_SHA,
          dryRun: true,
          spawn: spawnSpy,
          log: () => {}
        });
        assert.equal(launches, 0, "the dry-run path launches zero processes");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // ADR-008 side effect: the marketplace TAG (`#v2.0.0`) is statically known
    // (MARKETPLACE_VERSION), so a dry-run with NO injected sha previews the REAL
    // tag — no `<sha>` placeholder, and crucially no live `git ls-remote`. The tag
    // in the preview (rather than a 40-hex sha) is the observable proof the live
    // resolver path was not taken; a regression would resolve a real commit or
    // throw. ADR-001's dry-run-no-network/no-spawn invariant still holds.
    name: "arch/ADR-008: a dry-run with no injected sha previews the real #v2.0.0 tag, resolves nothing live, zero spawn",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-planning-nosha-"));
      let launches = 0;
      const spawnSpy = () => {
        launches += 1;
        return { status: 0, stdout: "" };
      };
      const prevEnv = process.env.AOF_PLANNING_SHA;
      delete process.env.AOF_PLANNING_SHA;
      try {
        const result = await initPlanning({ targetDir: repo, dryRun: true, spawn: spawnSpy, log: () => {} });
        assert.ok(
          result.planCommands.some((command) =>
            command.includes(`phuryn/pm-skills.git#${MARKETPLACE_TAG}`)
          ),
          "the dry-run previews the marketplace add on the real `#v2.0.0` tag (the live git path was not taken)"
        );
        assert.ok(
          !result.planCommands.some((command) => SHA_REF_RE.test(command)),
          "no plan command pins a bare 40-hex sha as the marketplace ref (F2)"
        );
        assert.equal(launches, 0, "the dry-run path launches zero processes even without an injected sha");
      } finally {
        if (prevEnv === undefined) delete process.env.AOF_PLANNING_SHA;
        else process.env.AOF_PLANNING_SHA = prevEnv;
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];
