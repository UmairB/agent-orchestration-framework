// Fitness function: acd-status-rollback-bounded (milestone 20, ADR-005).
//
// rollbackItemStatus is the FIRST — and ONLY — item-status frontmatter writer, and it
// is bounded HARD: it sets status only FROM in-progress TO not-started|blocked
// (never done/in-review), touches only the status line (body + every other
// frontmatter key byte-identical), and writes through the atomic fs.mjs:writeText.
//
// (a) BEHAVIOURAL: a fixture item in-progress → not-started and → blocked succeed
//     (only the status line changes); → done and a from-state ≠ in-progress are
//     rejected (forbidden-rollback / rollback-not-applicable) writing nothing.
// (b) SOURCE-GREP (per 15/R3 + 10/R2, following the function): over the module family
//     that could write item frontmatter (src/work.mjs + src/commands/run-*.mjs) —
//     rollbackItemStatus's allowed targets are exactly not-started|blocked, it writes
//     through writeText, and the run-* command modules contain NO writeText/writeFile/
//     appendFile of their own (they reach frontmatter only by calling rollbackItemStatus).
//
// Mirrors the stripComments/source-grep style of acd-run-write-scope.test.mjs.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rollbackItemStatus } from "../../src/work.mjs";

const WORK = new URL("../../src/work.mjs", import.meta.url);
const RUN_COMMANDS = ["run-start.mjs", "run-complete.mjs", "run-status.mjs", "run-retry.mjs"].map(
  (name) => new URL(`../../src/commands/${name}`, import.meta.url),
);
const WRITE_VERBS = ["writeText", "writeFile", "appendFile"];

function specDoc(status) {
  return [
    "---",
    "type: milestone",
    "number: 20",
    "slug: autonomous-run-resilience",
    'title: "Autonomous Run Resilience"',
    `status: ${status}`,
    "created: 2026-06-30",
    "updated: 2026-06-30",
    "---",
    "# 20 · Autonomous Run Resilience",
    "",
    "Body — must stay byte-identical.",
    "",
  ].join("\n");
}

async function makeItem(status) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-rollback-bounded-"));
  const dir = path.join(repo, "wiki", "work", "20_milestone_autonomous-run-resilience");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SPEC.md"), specDoc(status), "utf8");
  return { repo, item: { ref: "20", dir, type: "milestone" }, specPath: path.join(dir, "SPEC.md") };
}

async function assertRejectsWithCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected a thrown error with code "${code}"`);
  assert.equal(caught.code, code, `the error carries code "${code}" (got "${caught?.code}")`);
}

export const archTests = [
  // (a) BEHAVIOURAL: the bounded write succeeds to the two legal targets, fails the rest.
  {
    name: "arch/status-rollback-bounded: in-progress → not-started|blocked succeeds (only status changes); → done and a non-in-progress from-state are rejected, writing nothing",
    async run() {
      // → not-started and → blocked each succeed, changing ONLY the status line.
      for (const target of ["not-started", "blocked"]) {
        const { repo, item, specPath } = await makeItem("in-progress");
        try {
          const before = await readFile(specPath, "utf8");
          await rollbackItemStatus(item, target);
          const after = await readFile(specPath, "utf8");
          assert.notEqual(after, before, `→ ${target} wrote the doc`);
          // exactly one line differs, and it is the status line set to the target
          assert.equal(
            after.replace(`status: ${target}`, "status: in-progress"),
            before,
            `→ ${target} changed ONLY the status line`,
          );
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }

      // → done is a forbidden TARGET (rolling forward would accept un-done work).
      {
        const { repo, item, specPath } = await makeItem("in-progress");
        try {
          const before = await readFile(specPath, "utf8");
          await assertRejectsWithCode(() => rollbackItemStatus(item, "done"), "forbidden-rollback");
          assert.equal(await readFile(specPath, "utf8"), before, "→ done wrote nothing");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }

      // a from-state ≠ in-progress is rollback-not-applicable (the narrow seam).
      {
        const { repo, item, specPath } = await makeItem("done");
        try {
          const before = await readFile(specPath, "utf8");
          await assertRejectsWithCode(() => rollbackItemStatus(item, "not-started"), "rollback-not-applicable");
          assert.equal(await readFile(specPath, "utf8"), before, "a non-in-progress from-state wrote nothing");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // (b) SOURCE-GREP: rollbackItemStatus is the ONLY status-frontmatter writer, bounded
  // to not-started|blocked, writing through writeText; and no run-* command writes
  // frontmatter itself.
  {
    name: "arch/status-rollback-bounded: rollbackItemStatus is the only item-status writer — allowed targets exactly not-started|blocked, written via writeText",
    async run() {
      const source = await readFile(WORK, "utf8");
      const code = stripComments(source);

      // rollbackItemStatus is defined in work.mjs (the item-frontmatter authority).
      assert.ok(
        /(?:export\s+)?async\s+function\s+rollbackItemStatus\s*\(/.test(code),
        "rollbackItemStatus is defined in src/work.mjs",
      );

      // Its allowed-target SET is exactly { not-started, blocked } — never done/in-review.
      const targetSet = code.match(/ROLLBACK_TARGETS\s*=\s*new Set\(\s*\[([^\]]*)\]\s*\)/);
      assert.ok(targetSet, "the allowed-target set ROLLBACK_TARGETS is a literal Set");
      const targets = targetSet[1]
        .split(",")
        .map((part) => part.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
        .sort();
      assert.deepEqual(targets, ["blocked", "not-started"], "the allowed targets are exactly not-started|blocked");
      for (const forbidden of ["done", "in-review"]) {
        assert.ok(!targets.includes(forbidden), `${forbidden} is NOT an allowed rollback target`);
      }

      // The rollback's bounding guard rejects a bad target with forbidden-rollback and a
      // non-in-progress from-state with rollback-not-applicable (the two coded bounds).
      assert.ok(/forbidden-rollback/.test(code), "a bad target is rejected forbidden-rollback");
      assert.ok(/rollback-not-applicable/.test(code), "a non-in-progress from-state is rejected rollback-not-applicable");

      // The one write goes through the atomic writeText seam — work.mjs's ONLY write
      // verb is writeText (no raw writeFile/appendFile to a record doc).
      const workWrites = collectCalls(code, WRITE_VERBS);
      assert.ok(workWrites.length >= 1, "work.mjs performs at least one fs write (the rollback)");
      for (const call of workWrites) {
        assert.equal(call.verb, "writeText", `work.mjs writes only via writeText (saw ${call.verb})`);
      }
    },
  },

  {
    name: "arch/status-rollback-bounded: no run-* command writes item frontmatter itself — it reaches it only by calling rollbackItemStatus",
    async run() {
      for (const url of RUN_COMMANDS) {
        const source = await readFile(url, "utf8");
        const code = stripComments(source);
        const name = url.pathname.split("/").pop();

        // The command module contains NO write verb of its own (no writeText/writeFile/
        // appendFile call) — the run store owns runs/ writes; frontmatter is reached
        // ONLY by delegating to work.mjs's rollbackItemStatus.
        const writes = collectCalls(code, WRITE_VERBS);
        assert.deepEqual(
          writes.map((call) => call.verb),
          [],
          `${name} performs no write verb of its own (frontmatter is reached only via rollbackItemStatus)`,
        );

        // The only frontmatter seam a command may touch is rollbackItemStatus.
        // run-start (the restart-reclaim scan) still reaches it by direct call;
        // run-complete reaches it through the EFFECTS LEDGER (m42 wave (d) leg
        // d2): its run raises `run.completed` via transitionRunComplete and the
        // ledger's checkout-locus reactor (src/effects/table.mjs) performs the one
        // bounded rollback — declared, not remembered. The command itself must
        // NOT call the writer directly any more (that would be a second door).
        if (name === "run-start.mjs") {
          assert.ok(
            /rollbackItemStatus\s*\(/.test(code),
            `${name} reaches item frontmatter by calling rollbackItemStatus`,
          );
        }
        if (name === "run-complete.mjs") {
          assert.ok(
            /transitionRunComplete\s*\(/.test(code),
            `${name} completes through the transition seam (transitionRunComplete)`,
          );
          assert.ok(
            !/rollbackItemStatus\s*\(/.test(code),
            `${name} no longer calls rollbackItemStatus directly — the run.completed reactor owns it`,
          );
          const effectsCode = stripComments(await readFile(new URL("../../src/effects/table.mjs", import.meta.url), "utf8"));
          assert.ok(
            /rollbackItemStatus\s*\(/.test(effectsCode),
            "src/effects/table.mjs's run.completed cascade calls rollbackItemStatus (the declared rollback reactor)",
          );
        }
      }
    },
  },
];

// --- source-analysis helpers (mirroring acd-run-write-scope) ----------------

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function collectCalls(code, verbs) {
  const calls = [];
  for (const verb of verbs) {
    const re = new RegExp(`\\b${verb}\\s*\\(`, "g");
    let match;
    while ((match = re.exec(code))) {
      const start = match.index + match[0].length;
      calls.push({ verb, firstArg: firstArgument(code, start) });
    }
  }
  return calls;
}

function firstArgument(code, start) {
  let depth = 0;
  let out = "";
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === "," && depth === 0) break;
    out += ch;
  }
  return out.trim();
}
