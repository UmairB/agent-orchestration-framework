// Fitness function: acd-shell-bus-single-host (m45 / ADR-005 contract points 3 and 5) —
//
//   "The surface → shell channel has ONE host. `declareShellPresent()` is called exactly
//    once in `ui/src`, by the module that renders the shell root; and no routed surface
//    may import the shell."
//
// EXPECTED GREEN from the moment story 45/03 lands. Unlike this milestone's other four
// ratchets it pins no behaviour that was missing — it pins a property the delivered build
// already has, so that the ONE accident that would silently break it cannot happen.
//
// WHY IT EXISTS — the architect's structural review of 45/03, 2026-08-07. The shell bus
// (`ui/src/app/shell-bus.mjs`) carries a MODULE-SCOPE flag, `shellPresent`, flipped by
// `declareShellPresent()` at `ui/src/app/Shell.tsx`'s module scope — i.e. by IMPORTING the
// shell, not by mounting it. That design was reviewed and ACCEPTED, and the reasoning is
// worth restating because this test exists to protect it rather than to grumble at it:
//
//   - A surface asks `hasShellHost()` while RENDERING its own controls, which happens
//     before any parent effect has run. An effect-time flag would make every surface render
//     its contribution in place on the first pass and then move it — precisely what DESIGN's
//     binding rail 2 ("nothing in the shell moves as you navigate") forbids. Module scope is
//     the only place the answer is available early enough.
//   - The two obvious alternatives are worse HERE, measured rather than assumed: a prop is
//     forbidden by task 00's own scenario ("no surface is passed a route, a shell handle or
//     a mode value it did not receive before"), and a React context is unreachable by
//     `test/support/mini-react.mjs`, which implements the five hooks the production surfaces
//     use and NO context — so a context channel would force a rewrite of the fleet's and the
//     board's existing behavioural suites around a shell they do not mount.
//   - The degraded path is the point, not a fallback: with no shell in the bundle a
//     contribution renders IN PLACE, which is what keeps `withFleetApp` / `withBoardApp`
//     (which mount the surface COMPONENT directly) working with zero harness edits.
//
// THE ONE WAY IT BREAKS, AND IT BREAKS SILENTLY. The flag is write-only and is set by an
// IMPORT. So the day any module under `ui/src/{fleet,board,config}/` imports anything at all
// from `ui/src/app/Shell` — a type, `ShellProps`, a constant — `shellPresent` becomes true
// in that bundle with no shell mounted to receive anything. Every surface then publishes its
// controls to a bus nobody reads and renders NOTHING in place: the fleet's scope control, the
// board's sync button and the board's `serverGone` notice all just vanish. No exception, no
// console line, no failing test — `acd-mesh-ui-scope-visible` drives `<Fleet>` alone and
// stays green, because the source it reads still says `<TopBar>` renders `<ScopeControl>`.
//
// A one-line import causing a control to disappear with every gate green is exactly the
// class of failure a fitness function is for: it is not reachable by review attention, and
// it is trivially greppable. Hence three assertions, all structural, all cheap.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UI_SRC = "ui/src";
const BUS_MODULE = "ui/src/app/shell-bus.mjs";
// The module that renders the shell root, and therefore the ONE module allowed to declare a
// shell present. Named rather than inferred: "whichever file happens to call it" is not an
// invariant, it is a description.
const SHELL_COMPONENT = "ui/src/app/Shell.tsx";
// The routed surfaces' folders. Each mounts INSIDE the shell and must stay ignorant of it —
// they reach the chrome through `ui/src/app/SurfaceSlot.tsx` and the bus, never through the
// component. (ARCHITECTURE §Codebase health finding 2: the shared layer is `ui/src/app/`.)
const SURFACE_DIRS = ["ui/src/fleet", "ui/src/board", "ui/src/config"];

async function uiSourceFiles() {
  const found = [];
  async function walk(relative) {
    const entries = await readdir(path.join(repoRoot, relative), { withFileTypes: true });
    for (const entry of entries) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(next);
      else if (/\.(tsx?|mts|mjs)$/.test(entry.name)) found.push(next);
    }
  }
  await walk(UI_SRC);
  return found.sort();
}

// Comments are not code, and this module's own header narrates `declareShellPresent()` in
// prose several times over — a detector that counted those would report the shell declared
// four times from a file that never calls it. LINE COMMENTS FIRST: a line comment containing
// the two characters `/*` (an API glob, a path pattern) opens a phantom block comment under
// the other order and eats the rest of the file. That is not hypothetical — it is what
// blinded `acd-rendered-component-fed-by-route` for a week (TECH_DEBT item 24).
function stripComments(source) {
  return source.replace(/^[ \t]*\/\/.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

// A TYPE DECLARATION IS NOT A CALL SITE. `ui/src/app/shell-bus.d.mts` carries
// `export declare function declareShellPresent(): void;` — the parenthesis is a signature,
// not an invocation, and nothing in a `.d.mts` ever executes. Excluded by construction
// rather than by a special case in the matcher, because the same is true of every one of
// this milestone's five `.d.mts` siblings.
const isTypeDeclaration = (file) => /\.d\.m?ts$/.test(file);

// A CALL, not a mention: `declareShellPresent(` with its parenthesis. The import statement in
// Shell.tsx names the symbol too, and importing it is not declaring anything.
function declareCalls(source) {
  return [...stripComments(source).matchAll(/\bdeclareShellPresent\s*\(/g)].length;
}

// An import of the shell COMPONENT, in any of the shapes this codebase writes:
// `from "./Shell"`, `from "../app/Shell"`, `from "@/app/Shell"`, with or without `type`,
// and `import("…/app/Shell")`.
function importsShellComponent(source) {
  return /(?:from|import)\s*\(?\s*["'][^"']*\/app\/Shell(?:\.tsx?)?["']/.test(stripComments(source));
}

// ─────────────────────────────────────────────────────── the scans, as pure functions ──
//
// Both detectors take `[{ file, source }]` rather than reading the disk themselves, for one
// reason: the self-check lane at the bottom feeds them a PLANTED tree — the real files with
// the violation re-introduced in memory — and proves each assertion can actually fail. A
// fitness function nobody has ever seen go red is a fitness function nobody knows is wired
// up, and this one is expected-green from the day it lands, so it has no red history of its
// own to point at.
function declarersIn(records) {
  const callers = [];
  let total = 0;
  for (const { file, source } of records) {
    if (file === BUS_MODULE || isTypeDeclaration(file)) continue;
    const calls = declareCalls(source);
    if (calls > 0) {
      callers.push(file);
      total += calls;
    }
  }
  return { callers, total };
}

function surfacesImportingShellIn(records) {
  return records
    .filter(({ file }) => SURFACE_DIRS.some((dir) => file.startsWith(`${dir}/`)))
    .filter(({ source }) => importsShellComponent(source))
    .map(({ file }) => file);
}

async function readUiTree() {
  const files = await uiSourceFiles();
  return Promise.all(files.map(async (file) => ({ file, source: await readFile(path.join(repoRoot, file), "utf8") })));
}

export const archTests = [
  {
    name: "arch/45 ADR-005 (acd-shell-bus-single-host): `declareShellPresent()` has exactly ONE call site in ui/src, and it is the module that renders the shell root",
    run: async () => {
      const { callers, total } = declarersIn(await readUiTree());

      assert.deepEqual(
        callers,
        [SHELL_COMPONENT],
        `\`declareShellPresent()\` is called from ${callers.length === 0 ? "NOWHERE" : callers.join(", ")}; it must be called from ${SHELL_COMPONENT} and nowhere else. The flag means "a shell exists in this bundle", so the module that RENDERS the shell root is the only thing entitled to assert it — a second declarer is a bundle claiming two shells, and the bus's host slot is single-writer (last attach wins, silently).`,
      );
      assert.equal(
        total,
        1,
        `\`declareShellPresent()\` is called ${total} times in ${SHELL_COMPONENT}; it must be called exactly once, at MODULE scope. Twice is harmless today and is still wrong tomorrow: it reads as though the declaration were conditional, which is the one thing it must never be — a surface asks \`hasShellHost()\` while rendering, before any effect has run.`,
      );
    },
  },

  {
    name: "arch/45 ADR-005 (acd-shell-bus-single-host): the declaration is at MODULE scope, not inside a component, an effect or a condition",
    run: async () => {
      const source = stripComments(await readFile(path.join(repoRoot, SHELL_COMPONENT), "utf8"));
      const index = source.indexOf("declareShellPresent(");
      assert.ok(index > 0, `${SHELL_COMPONENT} does not call declareShellPresent()`);

      // Module scope = brace depth 0 at the call. Cheap, exact, and it is the whole property:
      // a declaration nested in a component body or an effect runs too late (or not at all),
      // and every surface would then render its contribution in place on the first pass and
      // move it on the second.
      let depth = 0;
      for (let i = 0; i < index; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") depth -= 1;
      }
      assert.equal(
        depth,
        0,
        `\`declareShellPresent()\` in ${SHELL_COMPONENT} sits at brace depth ${depth} — inside a function, an effect or a condition. It must run at MODULE scope, on import: a routed surface asks \`hasShellHost()\` while RENDERING its own controls, which happens before any parent effect has run, so an effect-time flag makes every surface render its contribution in place and then move it — DESIGN's binding rail 2 ("nothing in the shell moves") forbids exactly that.`,
      );
    },
  },

  {
    name: "arch/45 ADR-005 (acd-shell-bus-single-host): no routed surface imports the shell component — importing it would flip the bus flag with no shell mounted, and every contributed control would silently vanish",
    run: async () => {
      const tree = await readUiTree();
      const offenders = surfacesImportingShellIn(tree);

      assert.deepEqual(
        offenders,
        [],
        `these routed-surface modules import ${SHELL_COMPONENT}: ${offenders.join(", ")}. The import ALONE is the defect, whatever it is for (a type, a constant, a lazy reference): ${SHELL_COMPONENT} calls \`declareShellPresent()\` at module scope, so importing it into a surface bundle sets "a shell is present" with NO shell mounted — every contribution then goes to a bus nobody reads and renders nothing in place. The fleet's scope control, the board's sync button and the board's serverGone notice would each disappear with every suite still green, because \`acd-mesh-ui-scope-visible\` mounts <Fleet> alone. A surface reaches the chrome through ui/src/app/SurfaceSlot.tsx and ui/src/app/shell-bus.mjs — never through the component (ARCHITECTURE §Codebase health finding 2: ui/src/app/ is the shared layer, and the dependency runs surface → layer, never surface → shell).`,
      );

      // NON-VACUITY: the detector was actually pointed at files. A rename of the surface
      // folders would otherwise empty the loop and leave a guard that guards nothing.
      const scanned = (await uiSourceFiles()).filter((file) => SURFACE_DIRS.some((dir) => file.startsWith(`${dir}/`)));
      assert.ok(
        scanned.length >= 10,
        `the detector reached only ${scanned.length} surface modules (${SURFACE_DIRS.join(", ")}) — if a folder moved, this guard is silently guarding nothing.`,
      );
      // …and that it can SEE an import of the shell at all: the shell's own consumer proves
      // the matcher is not simply blind.
      assert.equal(
        importsShellComponent(await readFile(path.join(repoRoot, "ui/src/main.tsx"), "utf8")),
        true,
        "the import detector recognises ui/src/main.tsx's own `import { Shell } from \"./app/Shell\"` — if this fails the matcher is blind and the assertion above is vacuous.",
      );
    },
  },

  {
    name: "arch/45 ADR-005 (acd-shell-bus-single-host): self-check — each detector, run over the REAL tree with its violation re-planted in memory, fires; over the real tree it is silent (non-vacuous)",
    run: async () => {
      const tree = await readUiTree();

      // PLANT 1 — a second declarer. This is the "two shells in one bundle" shape: the bus's
      // host slot is single-writer (`attachShellHost` is last-attach-wins), so a second
      // declaring module is a bundle whose contributions silently belong to whichever shell
      // mounted last.
      const secondDeclarer = declarersIn([
        ...tree,
        { file: "ui/src/app/SecondShell.tsx", source: 'import { declareShellPresent } from "./shell-bus.mjs";\ndeclareShellPresent();\n' },
      ]);
      assert.deepEqual(
        secondDeclarer.callers,
        [SHELL_COMPONENT, "ui/src/app/SecondShell.tsx"],
        "the call-site detector reports a SECOND declarer when one is planted",
      );

      // PLANT 2 — the silent killer this whole file exists for: a routed surface importing
      // the shell. Planted in each of the three surface folders, in the three import shapes
      // a real diff would actually use (value, `type`, and a dynamic import), because the
      // whole point is that a TYPE-only import is just as fatal as a value one — TypeScript
      // erases it, but only after the bundler has already followed it and run the module.
      const plantedImports = surfacesImportingShellIn([
        ...tree,
        { file: "ui/src/fleet/Probe.tsx", source: 'import { Shell } from "../app/Shell";\n' },
        { file: "ui/src/board/Probe.tsx", source: 'import type { ShellProps } from "@/app/Shell";\n' },
        { file: "ui/src/config/Probe.tsx", source: 'const lazy = () => import("../app/Shell.tsx");\n' },
      ]);
      assert.deepEqual(
        plantedImports,
        ["ui/src/fleet/Probe.tsx", "ui/src/board/Probe.tsx", "ui/src/config/Probe.tsx"],
        "the import detector fires on a value import, a TYPE-ONLY import and a dynamic import, in all three surface folders — a type-only import is erased by tsc but is still followed by the bundler, so it flips the flag exactly as a value import does",
      );

      // …and over the REAL tree, both are silent. Stated as its own assertion so a future
      // reader sees that the greens above are a measurement and not an empty loop.
      assert.deepEqual(declarersIn(tree).callers, [SHELL_COMPONENT]);
      assert.deepEqual(surfacesImportingShellIn(tree), []);

      // A LOOK-ALIKE THAT MUST NOT FIRE: `ui/src/app/SurfaceSlot.tsx` is the module every
      // surface DOES import, and its header narrates the shell at length. Detecting it would
      // make this test forbid the very seam ADR-005 contract point 5 requires.
      assert.equal(
        importsShellComponent(await readFile(path.join(repoRoot, "ui/src/app/SurfaceSlot.tsx"), "utf8")),
        false,
        "the sanctioned seam (SurfaceSlot → shell-bus) is NOT mistaken for an import of the shell component",
      );
    },
  },
];
