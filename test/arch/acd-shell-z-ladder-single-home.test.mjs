// Fitness function: acd-shell-z-ladder-single-home (m45 / ADR-005 [Amigos-5], DESIGN DG-45-2) —
//
//   "Stacking order is a CLOSED, DECLARED vocabulary owned by the shell. `z-50` means
//    'the shell's fullscreen occupant' and nothing else; a rung not on the ladder is a
//    GAP whose fix is to add the rung to the ladder first."
//
// EXPECTED RED until milestone 45 / story 03 lands: `ui/src/app/shell-layout.mjs` does not
// exist, and three of the four `z-50` literals below still live in surface components.
//
// WHY THIS IS A RATCHET AND NOT A SCENARIO. Story 45/03's own feature says, in terms, that
// it does NOT assert "no `z-50` literal survives anywhere else in `ui/src`" — a behavioural
// Then cannot make a whole-tree claim without smuggling a source read into it, and QA
// refused to (correctly). So the gap closes in 03 and reopens the moment 46, 47 or 49 adds
// an overlay — and 49 is PRECISELY the milestone that puts a surface fullscreen. That is the
// Nth-instance case the codebase-health rule says to ratchet rather than to re-review.
//
// WHAT DG-45-2 ACTUALLY MEASURED (2026-08-06, re-verified here): `z-50` is currently three
// unrelated things wearing one number —
//   Board.tsx:528              the dispatch toast          → belongs on `toast` (z-40)
//   Board.tsx:568              the milestone switcher      → belongs on `popover` (z-20)
//   BoardLanes.tsx:373         the switcher's listbox      → belongs on `popover` (z-20)
//   FleetTerminalView.tsx:412  the fleet peek's own portal → see the exemption below
// The three `z-10`s (main.tsx:318, Fleet.tsx:281, BoardLanes.tsx:181) and the one `z-20`
// (Fleet.tsx:360) are already on their correct rungs and need no edit — which is why this
// test asserts the RUNG SET as well as the `z-50` home: it must stay green for them today.
//
// THE ONE EXEMPTION IS NAMED, REASONED AND SHRINK-ONLY. FleetTerminalView.tsx:412 is a
// genuine violation of ADR-005's "no per-surface `fixed inset-0` portal" rule — and
// milestone 46 DELETES the file. Forcing 45/03 to re-home a fullscreen overlay inside a
// component that is about to be removed is work done twice. So it is carried explicitly,
// with its reason and its retirement milestone attached, exactly as
// acd-test-suite-registration carries its unregistered baseline. The list may only ever
// shrink: a new entry is a new violation, and the assertion below refuses to grow.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UI_SRC = "ui/src";
const LADDER_MODULE = "ui/src/app/shell-layout.mjs";

// DESIGN DG-45-2 fixes these five rungs and no others. `dock` is reserved for milestone 46's
// docked terminal so that 46 does not have to invent a number under time pressure.
const DECLARED_RUNGS = new Set(["10", "20", "30", "40", "50"]);

// Shrink-only. Keyed by repo-relative path; the value is the reason a reviewer needs.
const FULLSCREEN_RUNG_EXEMPTIONS = new Map([
  [
    "ui/src/fleet/terminal-view/FleetTerminalView.tsx",
    "m45/ADR-005 named exemption: the fleet peek's own `fixed inset-0 z-50` portal. Milestone 46 DELETES this file when it re-homes both terminals onto the one control, so re-homing its overlay in m45 is work done twice. Retires with m46 — and this entry must be REMOVED, not re-pointed, when it does.",
  ],
]);

async function uiSourceFiles() {
  const found = [];
  async function walk(relative) {
    const entries = await readdir(path.join(repoRoot, relative), { withFileTypes: true });
    for (const entry of entries) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(next);
      else if (/\.(tsx?|mjs|css)$/.test(entry.name)) found.push(next);
    }
  }
  await walk(UI_SRC);
  return found.sort();
}

// Tailwind stacking utilities as they appear in a class string: `z-10`, `md:z-20`,
// `group-hover:z-50`. Deliberately NOT matching `z-[9999]` — an arbitrary-value rung is
// caught by the rung-set assertion below with a message of its own.
function stackingRungs(source) {
  return [...source.matchAll(/(^|[\s"'`:])z-(\d+)\b/g)].map((match) => match[2]);
}

function arbitraryRungs(source) {
  return [...source.matchAll(/(^|[\s"'`:])z-\[([^\]]+)\]/g)].map((match) => match[2]);
}

export const archTests = [
  {
    name: "arch/45 ADR-005 [Amigos-5] (acd-shell-z-ladder-single-home): the z-ladder is DECLARED in ui/src/app/shell-layout.mjs beside the region names — a rung typed as a class literal in a surface is a rung nobody can find",
    run: async () => {
      let ladder;
      try {
        ladder = await import(new URL(`../../${LADDER_MODULE}`, import.meta.url).href);
      } catch (error) {
        assert.fail(
          `${LADDER_MODULE} is not loadable by plain node (${error.code ?? error.message}). m45/ADR-005: the stacking ladder is layout vocabulary and belongs in the same framework-free module as the region names — for the same reason, that this repo has no React test harness and a constant only a bundler can read is a constant no test can check.`,
        );
      }

      const exported = Object.entries(ladder).find(([name]) => /^(Z_LADDER|Z_INDEX|zLadder|STACKING)$/.test(name));
      assert.ok(
        exported,
        `${LADDER_MODULE} exports no stacking ladder. m45/ADR-005 [Amigos-5]: DESIGN DG-45-2's five rungs — sticky chrome, popover, dock (reserved for m46), toast, fullscreen — must be importable names, not numbers retyped per surface.`,
      );

      const rungs = new Set(Object.values(exported[1]).map((value) => String(value).replace(/^z-/, "")));
      assert.deepEqual(
        [...rungs].sort(),
        [...DECLARED_RUNGS].sort(),
        `${LADDER_MODULE}'s ladder declares rungs ${[...rungs].sort().join(", ")}; DESIGN DG-45-2 fixes exactly ${[...DECLARED_RUNGS].sort().join(", ")}. The closure rule is the point: "an element that needs a rung not on this list is a GAP whose fix is to add the rung HERE first."`,
      );
    },
  },

  {
    name: "arch/45 ADR-005 [Amigos-5] (acd-shell-z-ladder-single-home): `z-50` appears NOWHERE in ui/src outside the ladder module — it means the shell's fullscreen occupant and nothing else (one named, shrink-only exemption, retiring with m46)",
    run: async () => {
      const offenders = [];
      for (const file of await uiSourceFiles()) {
        if (file === LADDER_MODULE) continue;
        const source = await readFile(path.join(repoRoot, file), "utf8");
        if (stackingRungs(source).includes("50")) offenders.push(file);
      }

      const unexpected = offenders.filter((file) => !FULLSCREEN_RUNG_EXEMPTIONS.has(file));
      assert.deepEqual(
        unexpected,
        [],
        `these files carry a bare \`z-50\` outside the ladder: ${unexpected.join(", ")}. m45/ADR-005 [Amigos-5] / DESIGN DG-45-2: \`z-50\` is the shell's fullscreen occupant ALONE. Measured at m45 refine, \`z-50\` was three unrelated things — a dispatch toast (belongs on \`toast\`), a switcher disclosure and its listbox (both \`popover\`). Import the rung from ${LADDER_MODULE} instead of retyping the number.`,
      );

      // Shrink-only: an exemption that no longer fires must be DELETED, or the list rots into
      // a permission slip. This is what makes m46's deletion of FleetTerminalView.tsx visible
      // here rather than silently leaving a stale entry behind.
      const stale = [...FULLSCREEN_RUNG_EXEMPTIONS.keys()].filter((file) => !offenders.includes(file));
      assert.deepEqual(
        stale,
        [],
        `these z-50 exemptions no longer fire and must be REMOVED from FULLSCREEN_RUNG_EXEMPTIONS: ${stale.join(", ")}. The list may only ever shrink — a spent exemption left standing is how the next violation gets waved through.`,
      );
    },
  },

  {
    name: "arch/45 ADR-005 [Amigos-5] (acd-shell-z-ladder-single-home): every stacking utility in ui/src sits on a rung the ladder DECLARES — no arbitrary z-[…] values, no rung invented at the call site",
    run: async () => {
      const undeclared = [];
      const arbitrary = [];
      for (const file of await uiSourceFiles()) {
        const source = await readFile(path.join(repoRoot, file), "utf8");
        for (const rung of stackingRungs(source)) {
          if (!DECLARED_RUNGS.has(rung)) undeclared.push(`${file} → z-${rung}`);
        }
        for (const value of arbitraryRungs(source)) {
          if (file !== LADDER_MODULE) arbitrary.push(`${file} → z-[${value}]`);
        }
      }

      assert.deepEqual(
        undeclared,
        [],
        `these stacking utilities use a rung DESIGN DG-45-2 does not declare: ${undeclared.join(", ")}. The fix is to add the rung to ${LADDER_MODULE} with a stated meaning FIRST — the ladder is closed by design, and a number chosen at the call site is how two overlays end up fighting.`,
      );

      assert.deepEqual(
        arbitrary,
        [],
        `these use an arbitrary-value stacking utility: ${arbitrary.join(", ")}. An arbitrary z-index is a rung with no name and no home — it is the exact failure DG-45-2 records, one escape hatch further along.`,
      );
    },
  },
];
