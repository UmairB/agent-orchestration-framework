// Fitness function: acd-spa-fallback-never-masks (m45 / ADR-004) —
//
//   "ONE shared module holds ALL THREE static-serving rules for BOTH servers: the history
//    fallback never shadows /api/* and never masks a missing asset, the traversal guard
//    and the MIME table each have exactly one definition, and the guard is decided BEFORE
//    the fallback so a refused path can never be answered with the app shell."
//
// EXPECTED RED until milestone 45's stories land: `src/static-serve.mjs` does not exist,
// neither server imports it, `safeStaticPath` and `contentType` are each defined twice, and
// `GET /fleet` on a setup/board origin 404s today.
//
// FOUR FINDINGS, NOT ONE — measured at source 2026-08-06 (`eacbd57`); (b) and (d) were added
// by the Three Amigos pass (Amigos-4 and Amigos-2 in ARCHITECTURE.md):
//
//   (a) `src/setup-ui.mjs` has NO fallback at all. `safeStaticPath` (:269) is a literal
//       file lookup and the handler (:130-140) is readFile().catch(404). That one handler
//       backs BOTH the board origin and the config origin, because `src/board-serve.mjs:20`
//       imports `serveSetupUi` and `serveBoard` (:60) points it at ui/dist. (Established by
//       GREP: the codebase graph's TSX/entry coverage did not reach setup-ui.mjs, so its
//       coupling is UNKNOWN to the graph — recording it as "no coupling" is exactly the
//       mistake the grounding step exists to prevent, so it was read at source instead.)
//
//   (b) `safeStaticPath` — the DIRECTORY-TRAVERSAL guard in front of both static roots (a
//       path.isAbsolute refusal plus a resolved-prefix containment check) — is defined TWICE
//       and the copies are BYTE-IDENTICAL: setup-ui.mjs:269-280 and mesh-ui-serve.mjs:873-884
//       (verified by `diff`, exit 0). Two copies of a traversal guard is the artefact that
//       gets hardened in one place and not the other, and nothing would say so. It sits on
//       the exact lines ADR-004 already edits, which is why de-duplicating it is in scope
//       rather than scope creep (ARCHITECTURE §Codebase health, finding 3).
//
//   (b2) `contentType` is a SECOND duplicated helper on the SAME lines — and unlike (b) the
//       copies have ALREADY DRIFTED: setup-ui.mjs:262-267 vs mesh-ui-serve.mjs:861-868
//       (`diff` exit 1). The fleet copy knows `.json` -> application/json and `.svg` ->
//       image/svg+xml; the board/config copy answers application/octet-stream for both.
//       Latent only because the built bundle is currently index.html plus hashed .js/.css;
//       live the first `.svg` vite emits, presenting as "the icon renders on the fleet and
//       downloads on the board". This is empirical proof of ADR-004's thesis: the pair was
//       duplicated at the same moment and one has already diverged while the other has not
//       YET. The merged table is the UNION (the fleet's richer one) — the intersection would
//       silently regress the origin that is currently correct.
//
//   (c) `src/mesh-ui-serve.mjs:558-568` falls back UNCONDITIONALLY. SPEC asks that the fleet
//       server's fallback be pinned by a test rather than assumed — but pinning it AS IS
//       would ratify a defect: a missing `/assets/index-abc.js` is answered with index.html
//       and `Content-Type: text/html`, so a broken deploy surfaces in the browser console as
//       `Uncaught SyntaxError: Unexpected token '<'`, arbitrarily far from its cause. That is
//       precisely the failure the fallback rule exists to prevent — it simply already exists
//       on the origin nobody was worried about. ADR-004 therefore TIGHTENS the fleet server
//       with the same predicate rather than pinning it.
//
//   (d) THE ORDER OF (a) AND (b) IS UNSTATED, AND IT IS SECURITY-ADJACENT. Both servers
//       happen to return at the traversal guard today (setup-ui.mjs:131-134,
//       mesh-ui-serve.mjs:554-557), but nothing said they must — and adding a fallback is
//       exactly the change that makes wiring it in the wrong place attractive
//       (`if (!filePath) -> fall back` is the tidy-looking refactor). Measured 2026-08-06:
//       four traversal encodings survive WHATWG URL parsing INTACT and end in a segment with
//       no `.` in it, so `safeStaticPath` returns null AND `shouldServeAppShell` independently
//       returns true for each. A handler that treats "guard refused" as "file missing"
//       answers 200 text/html to an attempted directory escape. It leaks no file, but it
//       converts a refusal into a success — the opposite of this repo's "a refusal must name
//       its own cause" rule — and it does so silently.
//
// WHY A SHARED MODULE AND NOT TWO CONDITIONS. A rule copied into two servers is a rule that
// is true in one of them — (b2) is the PROOF, not the theory: same duplication moment, and
// one of the pair has already diverged. `src/static-serve.mjs` is a pure leaf holding all
// three rules; both servers import all three and re-derive none. It is named for what it
// holds: calling it `spa-fallback.mjs` and then putting a traversal guard and a MIME table in
// it would be the same under-description one layer up.
//
// WHY THE DISCRIMINATOR IS "NO FILE EXTENSION" (ADR-004 records the two rejections):
//   - `Accept: text/html` was REJECTED — it makes one URL answer differently depending on a
//     request header, so curl, this repo's headless harnesses and a browser get different
//     bodies for the same address.
//   - A route-derived allowlist was REJECTED — the server would have to learn the client's
//     route table, which means either `src/` imports `ui/src/` (a new and wrong coupling
//     direction) or the list is duplicated (two homes for one fact). It would also split the
//     not-found experience in two: a deep-linked typo would get a plain-text server 404 while
//     the same typo reached by in-app navigation gets the shell's 404 surface (ADR-002).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveSetupUi } from "../../src/setup-ui.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATIC_SERVE_MODULE = "src/static-serve.mjs";
const SERVERS = [
  { file: "src/setup-ui.mjs", what: "the setup/board/config origin (board-serve.mjs:20 delegates here, so ONE fix covers both)" },
  { file: "src/mesh-ui-serve.mjs", what: "the fleet origin — TIGHTENED by the same predicate, not pinned as-is (its :558-568 fallback is unconditional today)" },
];

// The behavioural contract, stated as a table so it is read as a spec rather than as code.
const SHELL_PATHS = ["/", "/fleet", "/board", "/config", "/fleet/", "/some/future/deep/path", "/typo-not-a-route"];
const ASSET_PATHS = ["/assets/index-BRbnU-Ke.css", "/assets/index-DlTMCGT5.js", "/assets/index-missing.js", "/index.html", "/favicon.ico", "/vite.svg"];
const API_PATHS = ["/api/work/list", "/api/mesh/status", "/api/config", "/api/nope"];

// [Amigos-2] The four traversal shapes that make the ORDER load-bearing. Each was measured in
// node on 2026-08-06 to satisfy ALL THREE of: (i) it survives `new URL(raw, base).pathname`
// unchanged, (ii) safeStaticPath refuses it, (iii) shouldServeAppShell alone would accept it.
// That triple is what makes this list non-vacuous — it is not "some scary-looking URLs", it is
// the exact set for which guard-then-fallback and fallback-then-guard give different answers.
//
// DELIBERATELY EXCLUDED, so a later reader does not "helpfully" add them back:
//   · "/%2e%2e"              — the URL parser normalises it to "/" (it IS a double-dot
//                              segment per the URL spec), so it never reaches the handler.
//   · "/..%2f..%2fetc%2fpasswd" — contains a literal ".", so shouldServeAppShell already
//                              refuses it and the ordering makes no difference.
// Neither discriminates, and a non-discriminating case in this list would make the test look
// stronger than it is.
const TRAVERSAL_PATHS = [
  "/%2e%2e%2fetc%2fpasswd",
  "/%2e%2e%2f%2e%2e%2fetc%2fshadow",
  "/%2e%2e%2froot",
  "/%2f%2fetc%2fpasswd",
];

// [Amigos-4] The MIME table's merged contract: the UNION of the two drifted copies. The last
// two rows are the ones the board/config origin gets WRONG today.
const CONTENT_TYPES = [
  ["/x/index-abc.js", /javascript/],
  ["/x/index-abc.css", /text\/css/],
  ["/x/index.html", /text\/html/],
  ["/x/manifest.json", /application\/json/],
  ["/x/logo.svg", /image\/svg\+xml/],
  ["/x/unknown.bin", /application\/octet-stream/],
];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

async function loadStaticServe() {
  try {
    return await import(new URL(`../../${STATIC_SERVE_MODULE}`, import.meta.url).href);
  } catch (error) {
    assert.fail(
      `${STATIC_SERVE_MODULE} is not loadable (${error.code ?? error.message}). m45/ADR-004: BOTH static-serving rules live ONCE, in a pure leaf with zero imports — shouldServeAppShell(pathname) and safeStaticPath(root, pathname) — because a rule copied into two servers is a rule that is true in one of them, which is exactly what happened to the traversal guard.`,
    );
  }
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

export const archTests = [
  {
    name: "arch/45 ADR-004 (acd-spa-fallback-never-masks): all three static-serving rules have ONE home — src/static-serve.mjs is a pure leaf (no LOCAL imports) exporting shouldServeAppShell, safeStaticPath and contentType",
    run: async () => {
      const module = await loadStaticServe();
      for (const name of ["shouldServeAppShell", "safeStaticPath", "contentType"]) {
        assert.equal(typeof module[name], "function", `${STATIC_SERVE_MODULE} exports ${name} — m45/ADR-004 puts the history-fallback predicate, the directory-traversal guard and the MIME table in the SAME leaf, because they are the three rules for serving the static bundle and both servers need all three`);
      }

      const code = stripComments(await readFile(path.join(repoRoot, STATIC_SERVE_MODULE), "utf8"));
      const imports = [...code.matchAll(/\bimport\s+[^;]*?\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);
      assert.deepEqual(
        imports.filter((spec) => spec.startsWith(".")),
        [],
        `${STATIC_SERVE_MODULE} is a PURE LEAF with no local imports (m45/ADR-004; the ARCHITECTURE §Codebase-health entry that justifies adding a 109th flat root module to src/ rests on it being the cheapest possible shape) — found: ${imports.join(", ")}`,
      );
    },
  },

  {
    name: "arch/45 ADR-004 (acd-spa-fallback-never-masks): the traversal guard AND the MIME table are each defined EXACTLY ONCE in src/ — one pair is byte-identical, the other has already drifted",
    run: async () => {
      const HELPERS = [
        {
          name: "safeStaticPath",
          why: "the path.isAbsolute refusal plus resolved-prefix containment check standing in front of BOTH static roots. Measured 2026-08-06: setup-ui.mjs:269-280 and mesh-ui-serve.mjs:873-884 are BYTE-IDENTICAL (diff exit 0) — so hardening one leaves the other origin unprotected and nothing says so",
        },
        {
          // [Amigos-4] — the empirical half. Same duplication moment, and this one HAS drifted.
          name: "contentType",
          why: "the MIME table. Measured 2026-08-06: setup-ui.mjs:262-267 and mesh-ui-serve.mjs:861-868 have ALREADY DRIFTED (diff exit 1) — the fleet copy knows .json/.svg, the board/config copy answers application/octet-stream for both. Latent only until vite emits its first .svg, then it presents as 'the icon renders on the fleet and downloads on the board'. Merge to the UNION (the fleet's richer table); the intersection would regress the origin that is currently correct",
        },
      ];
      const found = [];
      for (const helper of HELPERS) {
        const definitions = [];
        for (const rel of [STATIC_SERVE_MODULE, "src/setup-ui.mjs", "src/mesh-ui-serve.mjs"]) {
          let source;
          try {
            source = await readFile(path.join(repoRoot, rel), "utf8");
          } catch {
            continue;
          }
          if (new RegExp(`\\bfunction\\s+${helper.name}\\s*\\(`).test(stripComments(source))) definitions.push(rel);
        }
        if (definitions.length !== 1 || definitions[0] !== STATIC_SERVE_MODULE) {
          found.push(`${helper.name} is defined in [${definitions.join(", ")}] — must be exactly [${STATIC_SERVE_MODULE}]. ${helper.why} (m45/ADR-004; ARCHITECTURE §Codebase health, finding 3).`);
        }
      }
      assert.deepEqual(found, [], `\n  ${found.join("\n  ")}`);
    },
  },

  {
    name: "arch/45 ADR-004 [Amigos-4] (acd-spa-fallback-never-masks): the merged MIME table is the UNION of the two drifted copies — .json and .svg are the rows the board/config origin gets wrong today",
    run: async () => {
      const { contentType } = await loadStaticServe();
      for (const [filePath, expected] of CONTENT_TYPES) {
        assert.match(
          contentType(filePath),
          expected,
          `contentType("${filePath}") — the merged table is the UNION of setup-ui.mjs:262-267 and mesh-ui-serve.mjs:861-868, i.e. the FLEET's richer one. Taking the intersection would silently regress the fleet origin, which serves .json/.svg correctly today.`,
        );
      }
    },
  },

  {
    name: "arch/45 ADR-004 (acd-spa-fallback-never-masks): the predicate serves the app shell for extension-less paths, NEVER for an asset request, and NEVER for /api/*",
    run: async () => {
      const { shouldServeAppShell } = await loadStaticServe();

      for (const pathname of SHELL_PATHS) {
        assert.equal(shouldServeAppShell(pathname), true, `${pathname} is a client route (or an unknown path that renders the shell's own 404 surface — ADR-002: ONE not-found experience, not two) and falls back to index.html`);
      }
      for (const pathname of ASSET_PATHS) {
        assert.equal(
          shouldServeAppShell(pathname),
          false,
          `${pathname} is an ASSET request and must 404 when it is missing. Answering it with index.html turns a broken deploy into "Uncaught SyntaxError: Unexpected token '<'" in the browser console — a failure arbitrarily far from its cause. This is the exact defect src/mesh-ui-serve.mjs:558-568 has today.`,
        );
      }
      for (const pathname of API_PATHS) {
        assert.equal(
          shouldServeAppShell(pathname),
          false,
          `${pathname} is an API route. Both servers already 404 /api/* BEFORE the static handler (setup-ui.mjs:125-128, mesh-ui-serve.mjs:546-549) — the predicate refusing it too is belt AND braces, so a later reorder of the handler cannot turn an API 404 into an HTML 200.`,
        );
      }
    },
  },

  {
    name: "arch/45 ADR-004 [Amigos-2] (acd-spa-fallback-never-masks): the ORDER is load-bearing — for four measured traversal shapes the guard REFUSES while the predicate alone would ACCEPT, so guard-then-fallback and fallback-then-guard give different answers",
    run: async () => {
      const { shouldServeAppShell, safeStaticPath } = await loadStaticServe();
      const uiRoot = path.join(os.tmpdir(), "aof-acd-static-root");

      for (const pathname of TRAVERSAL_PATHS) {
        // (i) the shape survives WHATWG URL parsing unchanged — it really does reach the
        //     handler in this form, rather than being normalised away before anyone sees it.
        assert.equal(
          new URL(pathname, "http://127.0.0.1").pathname,
          pathname,
          `${pathname} survives URL parsing intact — if a future node normalises it away this case stops discriminating and must be replaced, not deleted`,
        );
        // (ii) the guard REFUSES it.
        assert.equal(
          safeStaticPath(uiRoot, pathname),
          null,
          `${pathname} is a directory-escape attempt and safeStaticPath must refuse it (null)`,
        );
        // (iii) …and the predicate, ON ITS OWN, would accept it. THIS is the whole finding:
        //       the two rules disagree, so which one runs first decides the response.
        assert.equal(
          shouldServeAppShell(pathname),
          true,
          `${pathname} has no "." in its last segment, so shouldServeAppShell accepts it in isolation. That is not a bug in the predicate — it is why m45/ADR-004 fixes the ORDER: the guard is TERMINAL, and a path it refuses must never be offered to the fallback.`,
        );
      }
    },
  },

  {
    name: "arch/45 ADR-004 (acd-spa-fallback-never-masks): BOTH static servers import the shared predicate — neither re-derives the rule",
    run: async () => {
      const missing = [];
      for (const server of SERVERS) {
        const code = stripComments(await readFile(path.join(repoRoot, server.file), "utf8"));
        assert.ok(code.length > 1000, `${server.file} was actually read (non-vacuous)`);
        if (!/from\s+["']\.\/static-serve\.mjs["']/.test(code)) missing.push(`${server.file} — ${server.what}`);
      }
      assert.deepEqual(
        missing,
        [],
        `these static servers do not import the shared history-fallback predicate (m45/ADR-004):\n  ${missing.join("\n  ")}`,
      );
    },
  },

  {
    name: "arch/45 ADR-004 (acd-spa-fallback-never-masks): driven against the REAL serveSetupUi handler — a deep-linked client path renders, a MISSING asset still 404s, /api/* is untouched, and [Amigos-2] a REFUSED traversal is never answered with the app shell",
    run: async () => {
      const uiRoot = await mkdtemp(path.join(os.tmpdir(), "aof-acd-spa-fallback-"));
      let server;
      try {
        await mkdir(path.join(uiRoot, "assets"), { recursive: true });
        await writeFile(path.join(uiRoot, "index.html"), '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/index-real.js"></script></body></html>');
        await writeFile(path.join(uiRoot, "assets", "index-real.js"), 'export const built = "yes";\n');

        // The REAL production handler — not a copy of its logic. This is the origin the
        // board (board-serve.mjs:20 → serveSetupUi) and the config editor both run on.
        let url;
        ({ server, url } = await serveSetupUi(null, { port: 0, uiRoot, projectDir: uiRoot, recordSessions: false }));

        // 1. A deep-linked CLIENT ROUTE renders the app shell (the gap SPEC names).
        for (const route of ["/fleet", "/board", "/config", "/"]) {
          const response = await fetch(new URL(route, url));
          assert.equal(response.status, 200, `GET ${route} on the setup/board origin renders the app shell instead of 404ing (m45/ADR-004 — the whole point of this milestone's server-side half)`);
          assert.match(response.headers.get("content-type") ?? "", /text\/html/, `GET ${route} is served as HTML`);
          assert.match(await response.text(), /id="root"/, `GET ${route} serves the real index.html body`);
        }

        // 2. A REAL asset is still served as itself.
        const realAsset = await fetch(new URL("/assets/index-real.js", url));
        assert.equal(realAsset.status, 200, "an existing asset is still served");
        assert.match(realAsset.headers.get("content-type") ?? "", /javascript/, "…as JavaScript, not as the shell");

        // 3. A MISSING asset still 404s — the rule that keeps a broken deploy loud.
        const missingAsset = await fetch(new URL("/assets/index-missing.js", url));
        assert.equal(missingAsset.status, 404, "a MISSING asset 404s — it is NEVER answered with index.html, or a broken deploy fails far from its cause");
        assert.doesNotMatch(missingAsset.headers.get("content-type") ?? "", /text\/html/, "…and is not served as HTML");

        // 4. /api/* is untouched: still the coded not-found envelope, never the shell.
        const api = await fetch(new URL("/api/nope", url));
        assert.equal(api.status, 404, "an unknown /api route is still a 404");
        assert.doesNotMatch(api.headers.get("content-type") ?? "", /text\/html/, "an /api route is NEVER shadowed by the app shell");
        assert.equal((await api.json()).code, "not-found", "…and keeps its coded { ok:false, error, code } envelope (setup-ui.mjs:125-128)");

        // 5. [Amigos-2] THE ORDER, proven end-to-end against the real handler. Each of these
        //    is refused by safeStaticPath and accepted by shouldServeAppShell (asserted as a
        //    triple above), so a fallback wired in front of the guard answers 200 text/html
        //    to a directory-escape attempt. It must 404, and it must NOT be HTML.
        for (const traversal of TRAVERSAL_PATHS) {
          const escaped = await fetch(new URL(traversal, url));
          assert.equal(
            escaped.status,
            404,
            `GET ${traversal} — the traversal guard is TERMINAL and runs BEFORE the fallback (m45/ADR-004 [Amigos-2]). A handler that treats "guard refused" as "file missing" answers 200 here, turning a refusal into a success: it leaks no file, but it is silent, and "a refusal must name its own cause" is the rule it breaks.`,
          );
          assert.doesNotMatch(
            escaped.headers.get("content-type") ?? "",
            /text\/html/,
            `GET ${traversal} is never answered with the app shell`,
          );
        }
      } finally {
        if (server) await closeServer(server);
        await rm(uiRoot, { recursive: true, force: true });
      }
    },
  },
];
