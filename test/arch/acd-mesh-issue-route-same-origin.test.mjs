// Security fitness function: acd-mesh-issue-route-same-origin (milestone 27 /
// story 02; SECURITY T1 / S-1; ARCHITECTURE 27/ADR-006 — the POST /api/mesh/issue
// write route, the FIRST inbound mutation on the loopback fleet face).
//
// THE THREAT (T1 — CSRF against the loopback write route). A malicious web page the
// operator visits can POST http://127.0.0.1:<port>/api/mesh/issue from the
// operator's own browser. Loopback bind does NOT stop it (the browser IS on
// loopback); CORS blocks the RESPONSE read, not the SEND, and the side effect (a
// directive issued → a peer runs attacker-influenced work) is the whole attack. A
// GET read route (m25) is exempt; the first WRITE route is not.
//
// THE CONTROL (both halves required). When src/mesh-ui-serve.mjs gains its
// POST /api/mesh/issue handler, that handler MUST:
//   (a) reject a cross-origin request — a present-and-foreign Origin / Sec-Fetch-Site
//       guard (browser-attached, un-forgeable by page JS), and
//   (b) require content-type: application/json (forces a preflight for any
//       cross-origin fetch AND refuses the bare HTML-<form> CSRF vector, which can
//       only send text/plain/urlencoded/multipart),
// BEFORE it reaches invoke("mesh:issue").
//
// XOR / SPECIFY-at-build posture (the codebase idiom — the route does not exist on
// today's m25 read-only tree). This gate is GREEN in BOTH valid states:
//   - the current tree: src/mesh-ui-serve.mjs declares NO /api/mesh/issue route
//     (vacuously satisfied — there is no write route to forge yet), OR
//   - post-story-02: the /api/mesh/issue route is present AND its handler carries
//     BOTH the same-origin guard and the content-type requirement, reaching
//     invoke("mesh:issue") only past them.
// It is RED only in the broken half: a write route that reaches invoke("mesh:issue")
// with NO Origin/content-type guard (T1 left open). It flips its satisfied side when
// story 02 lands the route.
//
// Per the m03 lesson, each assertion pairs the accepted form with a non-vacuous
// planted-violation self-check (the detector demonstrably fires on a guardless route
// and stays quiet on the guarded form).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Does the (comment-stripped) source declare a POST /api/mesh/issue write route?
// The route is recognised by its pathname literal — the same shape the sibling
// acd-mesh-ui-write-isolation gate matches (pathname === "/api/mesh/issue").
function declaresIssueRoute(code) {
  return /["']\/api\/mesh\/issue["']/.test(code);
}

// The same-origin guard: the handler reads a browser-attached origin signal. Either
// the `Origin` request header or `Sec-Fetch-Site` — both un-forgeable by page JS. A
// header read is `request.headers.origin` / `request.headers["sec-fetch-site"]` (or a
// `.origin`/`sec-fetch` reference in the routing source).
function hasSameOriginGuard(code) {
  return /headers\s*(\.\s*origin|\[\s*["']origin["']\s*\])/i.test(code)
    || /sec-fetch-site|sec-fetch/i.test(code)
    || /\borigin\b[^;\n]*127\.0\.0\.1|127\.0\.0\.1[^;\n]*\borigin\b/i.test(code);
}

// The non-simple-content-type requirement: the handler checks content-type is
// application/json (forces preflight + refuses a form POST).
function hasContentTypeRequirement(code) {
  return /content-type/i.test(code) && /application\/json/i.test(code);
}

export const archTests = [
  {
    name: "arch/27 S-1 (T1 CSRF): the POST /api/mesh/issue write route carries a same-origin + application/json guard before invoke — or does not exist yet (XOR, vacuous-safe)",
    async run() {
      const code = stripComments(await readFile(MESH_UI_SERVE, "utf8"));

      if (!declaresIssueRoute(code)) {
        // The current m25 read-only tree: no write route to forge — vacuously safe.
        // (Confirm the vacuity is real: the face genuinely has no /api/mesh/issue
        // route, not a grep miss on a renamed literal.)
        assert.ok(
          !declaresIssueRoute(code),
          "no POST /api/mesh/issue route on the fleet face yet — T1 has no surface (the m25 read-only state)"
        );
      } else {
        // Story 02 landed the route: BOTH guards MUST be present in the face source.
        assert.ok(
          hasSameOriginGuard(code),
          "the /api/mesh/issue route reads a same-origin signal (Origin / Sec-Fetch-Site) — a cross-origin CSRF POST is rejected (T1 half a)"
        );
        assert.ok(
          hasContentTypeRequirement(code),
          "the /api/mesh/issue route requires content-type: application/json — a bare HTML-form CSRF POST is refused (T1 half b)"
        );
        // And the guard must sit IN FRONT of the mutation: the face reaches the
        // mutation via invoke("mesh:issue"), and the origin/content-type reads must
        // both be present in the same face module (the request-validation-then-invoke
        // shape). (The bounded-write flip 27/#7 owns "reaches only via invoke"; this
        // gate owns "guarded before it does".)
        assert.ok(
          /invoke\s*\(\s*["']mesh:issue["']/.test(code),
          "the /api/mesh/issue route reaches the mutation via invoke(\"mesh:issue\") (guarded, then invoked)"
        );
      }

      // --- non-vacuous planted-violation self-checks (m03) ---
      // A guardless route (the broken half T1 must catch): declares the route +
      // invokes, with NO origin/content-type guard.
      const guardless = stripComments(`
        if (pathname === "/api/mesh/issue" && request.method === "POST") {
          const body = await readJsonBody(request);
          const result = await invoke("mesh:issue", body, { workspace });
          sendJson(response, 200, result);
        }
      `);
      assert.ok(declaresIssueRoute(guardless), "self-check: the detector sees a planted /api/mesh/issue route");
      assert.ok(
        !hasSameOriginGuard(guardless),
        "self-check: the same-origin detector FIRES on a guardless route (no Origin/Sec-Fetch read)"
      );
      assert.ok(
        !hasContentTypeRequirement(guardless),
        "self-check: the content-type detector FIRES on a guardless route (no application/json requirement)"
      );
      // The accepted guarded form: the detector stays quiet.
      const guarded = stripComments(`
        if (pathname === "/api/mesh/issue" && request.method === "POST") {
          const origin = request.headers.origin;
          if (origin && origin !== "http://127.0.0.1:" + address.port) {
            sendApiError(response, 403, "Cross-origin request refused.", "cross-origin");
            return;
          }
          if (!/application\\/json/.test(request.headers["content-type"] || "")) {
            sendApiError(response, 415, "content-type: application/json required.", "unsupported-media-type");
            return;
          }
          const result = await invoke("mesh:issue", body, { workspace });
          sendJson(response, 200, result);
        }
      `);
      assert.ok(hasSameOriginGuard(guarded), "self-check: the same-origin detector ACCEPTS the guarded Origin-check form");
      assert.ok(hasContentTypeRequirement(guarded), "self-check: the content-type detector ACCEPTS the application/json-required form");
    },
  },
];
