// Fitness function: acd-ui-single-route-table (m45 / ADR-001 + ADR-002) —
//
//   "There is ONE route table. The render root selects a surface by asking it, and by
//    no other means; and the application ENTRY imports surfaces, it does not define one."
//
// EXPECTED RED until milestone 45's stories land. This is the house convention: an arch
// test written at refine time is part of the CONTRACT, not a report on the present. It
// fails today for exactly three reasons, all of them the point of the milestone:
//   1. `ui/src/app/routes.mjs` does not exist;
//   2. `ui/src/main.tsx:1261-1266` selects the surface with its own query-param ternary
//      (`?mode` ?? import.meta.env.VITE_AOF_UI_MODE`), and `ui/src/vite-env.d.ts:4`
//      declares the env half of it;
//   3. `ui/src/main.tsx` is 1,267 lines because it IS the config editor — the entry file
//      defines the surface it is supposed to route to (ARCHITECTURE §Codebase health, 1).
//
// WHY A TABLE AND NOT A TERNARY. Today's selector is a single expression in one file, so
// "one home" is true by accident of there being only one place to put it. The moment a
// shell exists, a second selector is free to appear — a surface deciding for itself
// whether it is embedded, a nav element re-deriving the current page, an origin check.
// Each would look local and reasonable. Four milestones (46, 47, 49, 50) add or move a
// surface on top of this, so the rule has to be structural before they arrive rather
// than after.
//
// THE DETECTOR IS DELIBERATELY NARROW. `mode` is an ordinary word — `ui/src/board/runs.mjs:116`
// carries `{ command, ref, mode: "fresh" }`, which has nothing to do with routing. So the
// three LEGACY SELECTOR forms are matched exactly, and nothing else:
//   (a) a `?mode=<surface>` URL literal,  (b) a `.get("mode")` query read,
//   (c) the `VITE_AOF_UI_MODE` build-time env selector.
// Those three forms cover every real occurrence in `ui/src` today (5 of them) and match
// none of the innocent ones.
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UI_SRC = path.join(repoRoot, "ui", "src");

// The ONE route module (m45/ADR-001), and the ONLY files allowed to name the legacy
// selector — because ADR-003 puts the legacy translation there, so it MUST name `mode`.
const ROUTE_MODULE = "ui/src/app/routes.mjs";
const LEGACY_ALLOWED = new Set([ROUTE_MODULE, "ui/src/app/routes.d.mts"]);

// The application entry — the render root (today `ui/src/main.tsx:1263-1266`).
const ENTRY = "ui/src/main.tsx";

// (a) `?mode=fleet` / `&mode=board` / `mode=assets` — a legacy URL selector literal.
// (b) `.get("mode")` — the query read at the render root.
// (c) the build-time env selector, retired by ADR-002.
const LEGACY_SELECTOR_FORMS = [
  { name: "a `?mode=<surface>` URL literal", re: /[?&]mode=(fleet|board|assets)\b/ },
  { name: 'a `.get("mode")` query read', re: /\.get\(\s*["']mode["']\s*\)/ },
  { name: "the `VITE_AOF_UI_MODE` build-time selector", re: /\bVITE_AOF_UI_MODE\b/ },
];

// Strip comments WITHOUT eating URLs. A naive /\/\/[^\n]*/ stripper deletes from the
// `//` in `href="http://127.0.0.1:4181/?mode=fleet"` onward — i.e. it would hide the
// exact violations this file exists to find. Guarding on "not preceded by a colon"
// keeps `http://`, `ws://` and `wss://` intact while still removing real line comments
// (which are preceded by start-of-line or whitespace).
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const SCANNED_EXT = new Set([".ts", ".tsx", ".mjs", ".mts", ".js", ".jsx"]);

async function uiSourceFiles(dir = UI_SRC, out = []) {
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) {
      await uiSourceFiles(full, out);
    } else if (SCANNED_EXT.has(path.extname(entry))) {
      out.push(path.relative(repoRoot, full).replaceAll("\\", "/"));
    }
  }
  return out;
}

function legacySelectorHits(source) {
  const code = stripComments(source);
  return LEGACY_SELECTOR_FORMS.filter((form) => form.re.test(code)).map((form) => form.name);
}

export const archTests = [
  {
    name: "arch/45 ADR-001 (acd-ui-single-route-table): the ONE route module exists at ui/src/app/routes.mjs and exports routeFor + legacyRedirectFor",
    run: async () => {
      let source;
      try {
        source = await readFile(path.join(repoRoot, ROUTE_MODULE), "utf8");
      } catch {
        assert.fail(
          `${ROUTE_MODULE} does not exist. m45/ADR-001: the router is a hand-rolled pure route table in a framework-free .mjs module — not react-router, and not a ternary at the render root. It lives in ui/src/app/ (NOT in ui/src/board/ or ui/src/fleet/) because the shell and the router are shared by construction; putting a shared primitive inside one surface's folder is TECH_DEBT item 18a, which this milestone is the first to have a reason to start paying.`,
        );
      }
      const code = stripComments(source);
      for (const name of ["routeFor", "legacyRedirectFor"]) {
        assert.match(
          code,
          new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b|export\\s+(?:const|let)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`),
          `${ROUTE_MODULE} exports \`${name}\` — the named surface m45/ADR-001 pins, because the fitness functions and milestones 46/47/49 all bind to it`,
        );
      }
    },
  },

  {
    name: "arch/45 ADR-002 (acd-ui-single-route-table): NO second surface selector anywhere in ui/src — the legacy `?mode=` vocabulary is named ONLY by the route module",
    run: async () => {
      const files = await uiSourceFiles();
      // Non-vacuity: the walker genuinely reached the UI tree (54 source files today).
      assert.ok(files.length > 30, `the ui/src tree was actually walked (non-vacuous): ${files.length} source files`);
      assert.ok(files.includes(ENTRY), `the walker reaches the render root (${ENTRY})`);

      const violations = [];
      for (const rel of files) {
        if (LEGACY_ALLOWED.has(rel)) continue;
        const hits = legacySelectorHits(await readFile(path.join(repoRoot, rel), "utf8"));
        if (hits.length > 0) violations.push(`${rel} → ${hits.join(", ")}`);
      }

      assert.deepEqual(
        violations,
        [],
        `these ui/src modules select a surface (or declare the selector) outside the ONE route table (m45/ADR-002; ADR-003 puts the legacy translation in ${ROUTE_MODULE} and nowhere else):\n  ${violations.join("\n  ")}\nA second selector is how two URL vocabularies start disagreeing — the route module owns \`mode\`, translates it away once at the entry, and every other module navigates by PATH.`,
      );
    },
  },

  {
    name: "arch/45 ADR-001 (acd-ui-single-route-table): the render root REACHES the route table — a deny-list alone would pass an entry that hard-codes one surface and routes nothing",
    run: async () => {
      const code = stripComments(await readFile(path.join(repoRoot, ENTRY), "utf8"));
      assert.match(
        code,
        /from\s+["'](?:\.\/app\/routes\.mjs|@\/app\/routes\.mjs)["']/,
        `${ENTRY} must import ${ROUTE_MODULE} — the render root selects a surface by asking the ONE table (m45/ADR-001), never by its own branch`,
      );
    },
  },

  {
    name: "arch/45 ADR-002 (acd-ui-single-route-table): the ENTRY imports surfaces and DEFINES none — a 1,267-line render root that is itself a surface cannot credibly route to one",
    run: async () => {
      const code = stripComments(await readFile(path.join(repoRoot, ENTRY), "utf8"));

      // `<App>` — the config editor — moves to ui/src/config/App.tsx (ADR-002; ARCHITECTURE
      // §Codebase health finding 1). This is a MOVE, not a re-skin, so SPEC's "re-skinning
      // the config editor is out of scope" is honoured exactly.
      const definedSurfaces = ["App", "Board", "Fleet", "Shell"].filter((name) =>
        new RegExp(`\\bfunction\\s+${name}\\s*\\(|\\bconst\\s+${name}\\s*[:=][^=]`).test(code),
      );
      assert.deepEqual(
        definedSurfaces,
        [],
        `${ENTRY} DEFINES ${definedSurfaces.join(", ")} — the application entry must import every surface and declare none (m45/ADR-002). Today the entry is 1,267 lines because the config editor lives inside it and the render root is its last six lines; with a router that stops being untidy and becomes structurally wrong.`,
      );
    },
  },

  {
    name: "arch/45 (acd-ui-single-route-table): self-check — the detector fires on the REAL pre-45 selector and on each in-app `?mode=` link, and stays silent on the innocent `mode:` key in board/runs.mjs (non-vacuous)",
    run: async () => {
      // The real pre-45 render root (ui/src/main.tsx:1261-1266, verbatim).
      const preM45 = 'const uiMode = new URLSearchParams(location.search).get("mode") ?? import.meta.env.VITE_AOF_UI_MODE;';
      assert.deepEqual(
        legacySelectorHits(preM45).length,
        2,
        "the detector catches BOTH halves of the pre-45 selector (the query read and the env fallback)",
      );

      // The real in-app cross-links (Board.tsx:416 / DetailPanel.tsx:270 / Fleet.tsx:1398).
      // These live INSIDE `http://` URLs — the case a naive comment stripper destroys.
      for (const link of [
        '<a className="underline" href="http://127.0.0.1:4181/?mode=fleet">',
        'href="http://127.0.0.1:4181/?mode=fleet&scope=global"',
        'href="/?mode=board"',
      ]) {
        assert.ok(legacySelectorHits(link).length > 0, `the detector catches the in-app link \`${link}\` (the URL survives comment-stripping)`);
      }

      // …and does NOT fire on an ordinary `mode` property, nor on a real line comment.
      assert.deepEqual(legacySelectorHits('return { command: "work:run-start", ref, mode: "fresh" };'), [], "an ordinary `mode:` property is not a route selector (ui/src/board/runs.mjs:116)");
      assert.deepEqual(legacySelectorHits('// this yields e.g. http://127.0.0.1:PORT/?mode=board'), [], "a line COMMENT naming the legacy form is history, not code");
    },
  },
];
