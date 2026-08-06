// wiki/work/43_milestone_mesh-artifact-authority/reference/staging-mutations.mjs
//
// THE MUTATION HARNESS BEHIND STORY 06's TWO STAGING CLAIMS (m43 / ADR-016/G9).
//
//   node wiki/work/43_milestone_mesh-artifact-authority/reference/staging-mutations.mjs
//
// (No arguments. It manages its own hermetic AOF_GLOBAL_HOME, so it does not need — and must
// not be given — the real one. Run it from the repo root.)
//
// WHY IT IS CHECKED IN. ADR-005 stages story 06's migration: stage 0 builds the read seam and
// moves NOTHING, stage 1 moves the `resolve` chokepoint, stages 2-3 move the leaves. Two Thens
// in the task contracts are conditioned on an EARLIER stage than the one this story delivers —
// task 00's "a fresh `aof work find 02 --json` still resolves nothing (no call site has moved
// at stage 0)" and task 02's zero-blast-radius scenario — and a single tree cannot be at stage
// 0 and at stage 3 at once. `test/cache-read-seam.test.mjs` therefore asserts the form that is
// TRUE of the delivered build and DECLARES the deviation in its header, and the ordering claim
// is proved HERE instead, by mutation.
//
// ADR-016/G9's condition, in its own words: **"a mutation nobody can re-run is an assertion."**
// So this is the harness, not a transcript of one. It:
//   · edits ONE line of production source per mutation, aborting loudly if the target text is
//     not found (a mutation that silently did nothing produces a green run proving the
//     opposite of what it claims);
//   · runs the probe in a CHILD process, so no module cache can serve the pre-mutation source;
//   · restores the file byte-for-byte in a `finally` and VERIFIES the restore by sha256;
//   · prints the UNMUTATED baseline beside every mutant, because "the command answers nothing"
//     is only evidence next to "…and with the call site moved, it answers".
//
// THE FIXTURE is the story's own (`test/support/cache-read-fixture.mjs`) — a real workspace
// whose disk holds milestones 00 and 01, and a real projection cache that additionally holds
// **02**, reported by another node. "02" is therefore a ref this node has never held a folder
// for, which is precisely the ref the staging Thens are written about.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
const SELF = fileURLToPath(import.meta.url);
const sha = (text) => createHash("sha256").update(text).digest("hex");

// ---------------------------------------------------------------- the mutations ----
//
// Each reverts ONE migrated call site to the disk reader it used before its stage, by the
// smallest edit that is still the real thing (a dynamic import of `work.mjs`'s own reader,
// called with the arguments it actually takes — never a stub).
const MUTATIONS = {
  // Task 00's claim. `work:find` is a STAGE-2 leaf; with its call site un-moved the command is
  // at stage 0 for this ref, whatever the seam beside it can do.
  "stage0-leaf-find": {
    file: path.join(REPO, "src", "commands", "find.mjs"),
    find: "    const rows = await findWorkCacheFirst(ctx.workspace, input.query, {",
    replace: "    const rows = await (await import(\"../work.mjs\")).findWork(ctx.workspace.workDir, input.query, {",
    claim: "task 00: at stage 0 no call site has moved, so `aof work find 02 --json` resolves NOTHING",
  },
  // Task 02's claim, and the sharper one: at stage 1 the CHOKEPOINT has moved and the LEAVES
  // have not. `work:list` is a leaf; `work:doc` reaches the cache through `resolve`.
  "stage1-leaves-unmoved": {
    file: path.join(REPO, "src", "commands", "list.mjs"),
    find: "    const rows = await listStreamCacheFirst(ctx.workspace, {",
    replace: "    const rows = await (await import(\"../work.mjs\")).listStream(ctx.workspace.workDir, {",
    claim: "task 02: at stage 1 the leaves have NOT moved — `work list` misses 02 while the chokepoint's `work doc 02` already answers",
  },
};

// ------------------------------------------------------------------- the probe ----
//
// Runs in the child. Builds the story's fixture and reports the four observations the two
// claims are written over, as plain data — never a pass/fail of its own, so the ordering
// evidence is readable rather than asserted into a boolean.
async function probe() {
  const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
  const { withCacheReadFixture, plantCacheRow, streamDoc, runCommand, WORKER_NODE, SYNCED_AT } =
    await imp("test/support/cache-read-fixture.mjs");

  await withCacheReadFixture(async (fx) => {
    // The cache holds 02 — a milestone another node authored, which this node's disk has never
    // held — plus a streamed SPEC body for it, so the chokepoint has something to answer with.
    await plantCacheRow(fx, "02", { status: "in-progress", title: "Remote milestone", node: WORKER_NODE, at: SYNCED_AT });
    await streamDoc(fx, { ref: "02", doc: "SPEC", body: "# streamed by the worker\n" });

    const found = await runCommand(fx, "work:find", { query: "02" });
    const listed = await runCommand(fx, "work:list", {});
    const doc = await runCommand(fx, "work:doc", { ref: "02", doc: "SPEC" });
    const foundLocal = await runCommand(fx, "work:find", { query: "01" });

    const out = {
      "work find 02 → rows": found.rows.length,
      "work list → holds 02": listed.some((row) => row.ref === "02"),
      "work doc 02 SPEC → present (the CHOKEPOINT's answer)": doc.present === true,
      "work find 01 → rows (this node's own disk; the command still works)": foundLocal.rows.length,
    };
    for (const [label, value] of Object.entries(out)) console.log(`    ${label}: ${JSON.stringify(value)}`);
  }, { stream: [{ number: "00", stories: [] }, { number: "01", stories: [] }] });
}

// ------------------------------------------------------------------ the driver ----

function runProbeInChild() {
  return new Promise((resolve) => {
    const home = mkdtempSync(path.join(tmpdir(), "aof-staging-mutation-"));
    const child = spawn(process.execPath, [SELF, "--probe"], {
      cwd: REPO,
      stdio: "inherit",
      // Hermetic, per ADR-014's test-isolation rule: never the real ~/.aof.
      env: { ...process.env, AOF_GLOBAL_HOME: home },
    });
    child.on("exit", (code) => {
      try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
      if (code !== 0) console.error(`    (probe exited ${code})`);
      resolve();
    });
  });
}

async function withMutation(name, body) {
  const { file, find, replace } = MUTATIONS[name];
  const original = await readFile(file, "utf8");
  if (!original.includes(find)) {
    console.error(`ABORT — the mutation target for "${name}" is not present in ${path.relative(REPO, file)}:\n  ${find}`);
    console.error("The call site moved. Re-point the mutation at its new home; do NOT delete it (ADR-016/G2).");
    process.exitCode = 2;
    return;
  }
  try {
    await writeFile(file, original.replace(find, replace), "utf8");
    await body();
  } finally {
    await writeFile(file, original, "utf8");
    const restored = await readFile(file, "utf8");
    console.log(`    RESTORE ${path.relative(REPO, file)}: ${sha(restored) === sha(original) ? "byte-identical" : "!!! FAILED — restore by hand before committing !!!"}`);
  }
}

async function main() {
  console.log("BASELINE — the delivered build (stage 3: the chokepoint AND the leaves have moved)");
  await runProbeInChild();

  for (const [name, mutation] of Object.entries(MUTATIONS)) {
    console.log(`\nMUTANT "${name}" — ${path.relative(REPO, mutation.file)}, one call site reverted to work.mjs's disk reader`);
    console.log(`  claim under test — ${mutation.claim}`);
    await withMutation(name, runProbeInChild);
  }

  console.log(`
READING THE OUTPUT.
  · "stage0-leaf-find" is the evidence for task 00's Then: with the call site un-moved,
    \`work find 02\` returns 0 rows (and \`work find 01\` still returns its own disk's row, so the
    command is working rather than broken). At the baseline it returns 1 — that difference IS
    the staging claim, and it is caused by the call site alone.
  · "stage1-leaves-unmoved" is the evidence for task 02's: with the LEAF un-moved,
    \`work list\` no longer holds 02 while \`work doc 02 SPEC\` still answers present — the
    CHOKEPOINT has moved and the leaf has not, which is exactly the stage-1 state task 01
    describes and no single tree can hold alongside stage 3.`);
}

if (process.argv.includes("--probe")) await probe();
else await main();
