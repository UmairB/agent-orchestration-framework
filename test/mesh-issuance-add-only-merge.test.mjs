// Traceability wiring for milestone 27 / story 00 — the add-only directive merge
// (task 02, the outsider-verifiable acceptance).
//
// Covers EVERY @executable scenario in
// tasks/02_add-only-directive-merge.feature over TWO real clones of one shared
// bare remote (the m22 transport-task precedent / the m26 story-00
// 02_add-only-run-merge precedent). Each clone writes a directive for the SAME
// item under its OWN issuer partition directly at issuanceDirectivePath (the
// production write is story 01's), and a REAL syncMesh(workspace) tick — NO roots
// argument, the DEFAULT [meshDir] root set (ADR-005.1) — carries them: the merge
// is ADD-ONLY (no content conflict, no wedged MERGING state) and after convergence
// each clone reads the union via readIssuanceDirectives, byte-for-byte.
//
// QA resolutions LOCKED in the feature comments, honoured here:
//   - EOL: the PROVEN m22 harness neutralisation (per-clone core.autocrlf false +
//     core.eol lf + a fixture-level `* -text` .gitattributes) — strictly STRONGER
//     than eol=lf for byte-stability. The REAL production pin
//     (**/.mesh/** text eol=lf) is asserted SEPARATELY by
//     acd-issuance-record-frozen's EOL half against THIS repo's .gitattributes. No
//     content-equality fallback — byte-for-byte assertions stay unweakened.
//   - Spawn discipline (22/R3): every git spawn routes through spawnSyncHardened.
//   - Default root set: syncMesh(workspace) called with NO second argument.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncMesh } from "../src/mesh-sync.mjs";
import { issuanceDirectivePath, meshDir } from "../src/mesh-store.mjs";
import { assembleDirective, readIssuanceDirectives } from "../src/mesh-issuance.mjs";
import { writeText } from "../src/fs.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

function git(cwd, args) {
  const result = spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
  return { status: typeof result.status === "number" ? result.status : 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function configIdentity(repo) {
  git(repo, ["config", "user.email", "fixture@aof.local"]);
  git(repo, ["config", "user.name", "aof fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  // Pin line endings so git does not renormalize record bytes on Windows (the
  // m22/R3 lesson) — byte-for-byte assertions must pin EOL.
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "core.eol", "lf"]);
  // The headline scenario IS a divergent pull (B commits its own directive, then
  // pulls A's) — pin merge (never rebase) so the add-only union is deterministic.
  git(repo, ["config", "pull.rebase", "false"]);
}

function cloneView(cloneRoot) {
  const workDir = path.join(cloneRoot, "wiki", "work");
  return { root: cloneRoot, workDir, workspace: { workDir, projectRoot: cloneRoot } };
}

// syncMesh(workspace) with NO second argument — the DEFAULT [meshDir] root set
// (ADR-005.1). No runs pathspec; this is deliberately the plain two-argument-free
// call every existing single-node caller already rides.
const syncTick = (view) => syncMesh(view.workspace);

const NOW = "2026-07-03T10:00:00.000Z";

// A shared bare remote + two aof installs ("clone A" / "clone B"), each cloned
// from it over the same work stream, plus the `* -text` EOL neutralisation.
async function buildFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-issuance-add-only-"));
  const bare = path.join(tmp, "remote.git");
  await mkdir(bare, { recursive: true });
  let r = git(bare, ["init", "--bare", "-q", "-b", "main"]);
  if (r.error || r.status !== 0) {
    git(bare, ["init", "--bare", "-q"]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }

  // Clone A carries the baseline commit up.
  r = git(tmp, ["clone", "-q", bare, "clone-a"]);
  if (r.status !== 0) throw new Error(`clone A failed: ${r.stderr}`);
  const a = cloneView(path.join(tmp, "clone-a"));
  configIdentity(a.root);
  git(a.root, ["checkout", "-q", "-b", "main"]);
  await mkdir(a.workDir, { recursive: true });
  await mkdir(path.join(meshDir(a.workspace), "issuance"), { recursive: true });
  await writeFile(path.join(a.root, ".gitattributes"), "* -text\n", "utf8");
  await writeFile(path.join(a.workDir, "README.md"), "fixture\n", "utf8");
  git(a.root, ["add", "-A"]);
  git(a.root, ["commit", "-q", "-m", "baseline: the shared work item"]);
  git(a.root, ["push", "-q", "-u", "origin", "main"]);

  // Clone B starts from the SAME baseline.
  r = git(tmp, ["clone", "-q", bare, "clone-b"]);
  if (r.status !== 0) throw new Error(`clone B failed: ${r.stderr}`);
  const b = cloneView(path.join(tmp, "clone-b"));
  configIdentity(b.root);
  git(b.root, ["checkout", "-q", "main"]);

  return { tmp, bare, a, b };
}

// The Background: clone A writes its directive under issuance/node-a/ and syncs
// (committed + pushed); clone B writes its own under issuance/node-b/ for the SAME
// item BEFORE any sync brought A's directive to B — the pre-convergence race the
// per-issuer partition makes safe.
async function background(fx) {
  const directiveA = assembleDirective({ itemRef: "27/00", issuer: "node-a", target: { kind: "any" }, issuedAt: NOW, aofVersion: "0.1.0" });
  await writeText(issuanceDirectivePath(fx.a.workspace, "node-a", "27/00"), JSON.stringify(directiveA, null, 2));
  const tickA = await syncTick(fx.a);
  assert.equal(tickA.committed, true, "background: clone A committed its directive");
  assert.notEqual(tickA.synced, false, "background: clone A's sync pushed cleanly");

  const directiveB = assembleDirective({ itemRef: "27/00", issuer: "node-b", target: { kind: "capability", value: "codex" }, issuedAt: NOW, aofVersion: "0.1.0" });
  await writeText(issuanceDirectivePath(fx.b.workspace, "node-b", "27/00"), JSON.stringify(directiveB, null, 2));

  return {
    directiveA,
    directiveB,
    aBytes: await readFile(issuanceDirectivePath(fx.a.workspace, "node-a", "27/00"), "utf8"),
    bBytes: await readFile(issuanceDirectivePath(fx.b.workspace, "node-b", "27/00"), "utf8"),
  };
}

const rel = (repoRoot, abs) => path.relative(repoRoot, abs).split(path.sep).join("/");

function remoteShow(bare, relPath) {
  const r = git(bare, ["show", `main:${relPath}`]);
  return r.status === 0 ? r.stdout : null;
}

const cleanup = (fx) => rm(fx.tmp, { recursive: true, force: true });

export const meshIssuanceAddOnlyMergeTests = [
  // ── Scenario: clone B's sync merges the two issuers' directives add-only with no conflict and no MERGING state ──
  {
    name: "issuance-add-only-merge/02 clone B's sync merges the two issuers' directives add-only — no conflict, no wedged MERGING state, both byte-identical to what their owners wrote, both on the remote tip",
    run: async () => {
      const fx = await buildFixture();
      try {
        const { aBytes, bBytes } = await background(fx);

        const tick = await syncTick(fx.b);

        assert.notEqual(tick.synced, false, `the tick succeeds (got reason ${tick.reason})`);
        assert.equal(tick.committed, true, "clone B committed its own directive");

        // No merge is left in progress (no wedged MERGING state).
        assert.ok(!existsSync(path.join(fx.b.root, ".git", "MERGE_HEAD")), "no MERGE_HEAD remains (no merge in progress)");
        assert.equal(git(fx.b.root, ["diff", "--name-only", "--diff-filter=U"]).stdout.trim(), "", "no unmerged/conflicted paths in clone B's tree");

        // Clone B's tree holds A's directive at issuance/node-a/ and its own at
        // issuance/node-b/ — two distinct issuer paths for the one item.
        const aInB = issuanceDirectivePath(fx.b.workspace, "node-a", "27/00");
        const bInB = issuanceDirectivePath(fx.b.workspace, "node-b", "27/00");
        assert.ok(existsSync(aInB), "clone B's tree holds A's directive under issuance/node-a/");
        assert.ok(existsSync(bInB), "clone B's tree holds its own directive under issuance/node-b/");
        const aInBBytes = await readFile(aInB, "utf8");
        assert.equal(aInBBytes, aBytes, "A's directive in clone B's tree is byte-identical to what clone A wrote (never content-merged)");
        assert.ok(!aInBBytes.includes("<<<<<<<"), "A's directive carries no conflict markers");
        assert.equal(await readFile(bInB, "utf8"), bBytes, "clone B's own directive is byte-identical to what clone B wrote");

        // The shared remote's branch tip carries BOTH directives.
        assert.equal(remoteShow(fx.bare, rel(fx.b.root, aInB)), aBytes, "the remote branch tip carries A's directive");
        assert.equal(remoteShow(fx.bare, rel(fx.b.root, bInB)), bBytes, "the remote branch tip carries B's directive");
      } finally {
        await cleanup(fx);
      }
    },
  },

  // ── Scenario: clone A's second sync converges it on the union without touching its own directive ──
  {
    name: "issuance-add-only-merge/02 clone A's second sync converges it on the union — B's directive arrives (reported in pulled) and A's own directive is byte-identical to before the tick",
    run: async () => {
      const fx = await buildFixture();
      try {
        const { bBytes } = await background(fx);
        // Given: clone B's directive has reached the shared remote.
        const tickB = await syncTick(fx.b);
        assert.notEqual(tickB.synced, false, "precondition: clone B's directive reached the shared remote");

        // I record the on-disk bytes of clone A's own directive.
        const aOwnPath = issuanceDirectivePath(fx.a.workspace, "node-a", "27/00");
        const aOwnBefore = await readFile(aOwnPath, "utf8");

        const tick = await syncTick(fx.a);

        assert.notEqual(tick.synced, false, `the tick succeeds (got reason ${tick.reason})`);
        const bInA = issuanceDirectivePath(fx.a.workspace, "node-b", "27/00");
        assert.ok(existsSync(bInA), "clone B's directive is present in clone A's tree under issuance/node-b/");
        assert.equal(await readFile(bInA, "utf8"), bBytes, "clone B's directive arrived byte-for-byte");
        assert.ok(
          tick.pulled.map((p) => p.replace(/\\/g, "/")).includes(rel(fx.a.root, bInA)),
          `the envelope's pulled names include clone B's directive path (got ${JSON.stringify(tick.pulled)})`
        );
        assert.equal(await readFile(aOwnPath, "utf8"), aOwnBefore, "clone A's own directive is byte-identical to before the tick (the pull did not touch it)");
      } finally {
        await cleanup(fx);
      }
    },
  },

  // ── Scenario: after convergence both clones read one identical union of both issuers' directives for the item ──
  {
    name: "issuance-add-only-merge/02 after convergence both clones read one identical union of both issuers' directives for the item — two directives, node-a + node-b, agreeing directive-for-directive byte-for-byte",
    run: async () => {
      const fx = await buildFixture();
      try {
        await background(fx);
        // Given: both clones have synced to convergence (each tree carries both).
        assert.notEqual((await syncTick(fx.b)).synced, false, "precondition: clone B synced");
        assert.notEqual((await syncTick(fx.a)).synced, false, "precondition: clone A synced");

        const directivesA = await readIssuanceDirectives(fx.a.workspace);
        const directivesB = await readIssuanceDirectives(fx.b.workspace);

        for (const [label, directives] of [["clone A", directivesA], ["clone B", directivesB]]) {
          assert.equal(directives.length, 2, `${label}'s read returns exactly two directives for the item`);
          assert.deepEqual(directives.map((d) => d.issuer).sort(), ["node-a", "node-b"], `${label}: one carries issuer node-a and the other node-b`);
        }

        // Each directive lives at its own distinct issuer path.
        assert.ok(existsSync(issuanceDirectivePath(fx.a.workspace, "node-a", "27/00")));
        assert.ok(existsSync(issuanceDirectivePath(fx.a.workspace, "node-b", "27/00")));
        assert.ok(existsSync(issuanceDirectivePath(fx.b.workspace, "node-a", "27/00")));
        assert.ok(existsSync(issuanceDirectivePath(fx.b.workspace, "node-b", "27/00")));

        // The two clones' reads agree directive-for-directive, byte-for-byte.
        const sortByIssuer = (list) => [...list].sort((x, y) => x.issuer.localeCompare(y.issuer));
        assert.deepEqual(sortByIssuer(directivesA), sortByIssuer(directivesB), "the two clones' reads agree directive-for-directive");
        for (const node of ["node-a", "node-b"]) {
          assert.equal(
            await readFile(issuanceDirectivePath(fx.a.workspace, node, "27/00"), "utf8"),
            await readFile(issuanceDirectivePath(fx.b.workspace, node, "27/00"), "utf8"),
            `the ${node} directive's bytes agree across the two clones`
          );
        }
      } finally {
        await cleanup(fx);
      }
    },
  },

  // ── Scenario: two issuers issuing the same item produce two directive files at distinct paths that both survive the merge ──
  {
    name: "issuance-add-only-merge/02 two issuers issuing the same item produce two directive files at distinct paths that both survive the merge (the partition invariant held strictly)",
    run: async () => {
      const fx = await buildFixture();
      try {
        await background(fx);
        assert.notEqual((await syncTick(fx.b)).synced, false, "clone B synced");
        assert.notEqual((await syncTick(fx.a)).synced, false, "clone A synced");

        // The converged tree holds exactly two directive files for item 27/00 at
        // the distinct paths issuance/node-a/ and issuance/node-b/.
        const aPath = issuanceDirectivePath(fx.a.workspace, "node-a", "27/00");
        const bPath = issuanceDirectivePath(fx.a.workspace, "node-b", "27/00");
        assert.ok(existsSync(aPath), "issuance/node-a/27-00.json (flatLeaf'd ref) survives");
        assert.ok(existsSync(bPath), "issuance/node-b/27-00.json (flatLeaf'd ref) survives");
        assert.notEqual(aPath, bPath, "the two issuers' directives live at distinct paths");

        // Neither issuer's directive file was overwritten or content-merged by the
        // other — no conflict markers, no wedged MERGING state on either clone.
        const aOnDisk = await readFile(aPath, "utf8");
        const bOnDisk = await readFile(bPath, "utf8");
        assert.ok(!aOnDisk.includes("<<<<<<<") && !bOnDisk.includes("<<<<<<<"), "no conflict markers in either directive");
        assert.ok(!existsSync(path.join(fx.a.root, ".git", "MERGE_HEAD")), "clone A: no wedged MERGING state");
        assert.ok(!existsSync(path.join(fx.b.root, ".git", "MERGE_HEAD")), "clone B: no wedged MERGING state");
      } finally {
        await cleanup(fx);
      }
    },
  },
];
