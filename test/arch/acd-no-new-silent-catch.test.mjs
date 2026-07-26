// Fitness function: acd-no-new-silent-catch (milestone 42 wave (a), TECH_DEBT item 3
// — "silent catch {} is load-bearing").
//
// "Best-effort must mean 'does not crash', never 'says nothing'." Two silent-catch
// sites were written THE SAME DAY the first two were fixed — the class recurs faster
// than it is paid down, so this gate is a RATCHET: the current sites are enumerated
// as a per-file baseline that may only SHRINK. A NEW silent catch — in a baseline
// file beyond its count, or in any file not listed — fails the build immediately.
// The sweep (emitting coded events into mesh-log.mjs's sink instead) shrinks the
// baseline entry-by-entry until it is empty and the gate becomes an outright ban.
//
// DETECTED (comments stripped first, so a comment-only body counts — a comment is
// documentation, not a runtime signal):
//   - `catch {…}` / `catch (e) {…}` with a statement-empty body
//   - promise-form `.catch(() => {})` with an empty block body
// NOT detected (handled degrades, not silence): `.catch(() => null)` and any catch
// body with at least one statement — those return a value the caller branches on.
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(repoRoot, "src");

// THE SWEEP IS DONE (2026-07-26, same day the ratchet armed): the 2026-07-26
// baseline of 94 sites across 29 files was swept to coded degrade events
// (degrade.mjs's reportDegrade — throttled, never-throwing, into the mesh-log
// sink family). What remains is the SANCTIONED FLOOR — the reporter and the sink
// themselves, whose faults have nowhere lower to report. This gate is now an
// outright ban everywhere else: any new silent catch in src/ fails the build.
const BASELINE = {
  "degrade.mjs": 1,
  "mesh-log.mjs": 1,
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export function countSilentCatches(source) {
  const code = stripComments(source);
  const tryCatch = (code.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/g) ?? []).length;
  const promise = (code.match(/\.catch\s*\(\s*\(\s*[a-zA-Z_$]*\s*\)\s*=>\s*\{\s*\}\s*\)/g) ?? []).length;
  return tryCatch + promise;
}

export const archTests = [
  {
    name: "arch/m42-item-3: no NEW silent catch — every src file is at or below its shrink-only baseline, and unlisted files have none",
    async run() {
      const offenders = [];
      for (const file of walk(srcRoot)) {
        const rel = path.relative(srcRoot, file).split(path.sep).join("/");
        const count = countSilentCatches(await readFile(file, "utf8"));
        const allowed = BASELINE[rel] ?? 0;
        if (count > allowed) offenders.push(`${rel}: ${count} silent catch site(s), baseline ${allowed}`);
      }
      assert.deepEqual(
        offenders,
        [],
        `NEW silent catch site(s) introduced — a degrade path must emit a coded event (mesh-log sink / onWarning), never say nothing:\n  ${offenders.join("\n  ")}`,
      );
    },
  },
  {
    name: "arch/m42-item-3 (non-vacuous self-check): the detector fires on both silent forms and spares handled degrades",
    run: async () => {
      assert.equal(countSilentCatches("try { x(); } catch {}"), 1, "statement-empty catch is detected");
      assert.equal(countSilentCatches("try { x(); } catch (e) { /* tolerated */ }"), 1, "a comment-only body is still runtime silence");
      assert.equal(countSilentCatches("p().catch(() => {});"), 1, "the promise-form empty handler is detected");
      assert.equal(countSilentCatches("try { x(); } catch (e) { report(e); }"), 0, "a body with a statement is handling, not silence");
      assert.equal(countSilentCatches("p().catch(() => null);"), 0, "a sentinel-returning handler is a handled degrade");
      assert.equal(countSilentCatches("const url = 'https://x'; // catch {}"), 0, "comments cannot fabricate a detection");
    },
  },
];
