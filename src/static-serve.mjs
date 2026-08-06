// The rules for serving the built static bundle — ONE home, for BOTH servers
// (milestone 45 / ADR-004). A PURE LEAF: `node:path` and nothing else, no local
// import, so it is loadable by `node:test` with no fixture and importable by any
// origin without dragging a server in behind it.
//
// WHY THIS MODULE EXISTS. `src/setup-ui.mjs` (the board origin — `board-serve.mjs:20`
// delegates to `serveSetupUi` — and the config-editor origin) and
// `src/mesh-ui-serve.mjs` (the fleet origin) each held their OWN copy of two of these
// three rules. Measured 2026-08-06 at `eacbd57`:
//   · `safeStaticPath` — the directory-traversal guard — was BYTE-IDENTICAL in both
//     (`setup-ui.mjs:269-280` == `mesh-ui-serve.mjs:873-884`, `diff` exit 0). Two copies
//     of a traversal guard is the artefact that gets hardened in one place and not the
//     other, and nothing would say so.
//   · `contentType` — the MIME table — had ALREADY DRIFTED (`setup-ui.mjs:262-267` vs
//     `mesh-ui-serve.mjs:861-868`, `diff` exit 1): the fleet copy knew `.json` and
//     `.svg`, the board/config copy answered `application/octet-stream` for both. Latent
//     only because the built bundle is currently `index.html` plus hashed `.js`/`.css`;
//     the first `.svg` vite emits makes it live, presenting as "the icon renders on the
//     fleet and downloads on the board" — a defect nobody would attribute to a helper.
// That pair is the empirical proof of the thesis, not the theory of it: duplicated at
// the same moment, and within one codebase's lifetime one of the two has diverged while
// the other has not YET.
//
// The three rules are named for what they are, and the module is named for what it
// holds. Calling it `spa-fallback.mjs` and then putting a traversal guard and a MIME
// table in it would be the same under-description one layer up.
import path from "node:path";

// The merged MIME table: the UNION of the two drifted copies, i.e. the FLEET's richer
// one (ADR-004 [Amigos-4]). Taking the INTERSECTION would silently regress the fleet
// origin, which serves `.json`/`.svg` correctly today; the union's only effect on the
// board and config origins is that an `.svg` starts rendering instead of downloading and
// a `.json` gets its real type. Neither is a route change and neither can break a
// working deploy. `application/octet-stream` stays the fall-through.
export function contentType(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

// The DIRECTORY-TRAVERSAL GUARD, moved verbatim from the two byte-identical copies:
// map a URL pathname to a file INSIDE the served root, refusing anything that escapes
// it (a malformed percent-escape, an absolute path, or a resolved path outside the
// root) by returning `null`. Behaviour is unchanged from both copies, deliberately —
// the move is a deletion plus an import at each site, with nothing to reconcile.
//
// Its `null` is TERMINAL at every call site (ADR-004 [Amigos-2]): a refused path is a
// 404 and the request STOPS. It must never be handed on to `shouldServeAppShell`, which
// independently accepts several of the same shapes — see that function's own note.
export function safeStaticPath(uiRoot, pathname) {
  let relativePath;
  try {
    relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  if (path.isAbsolute(relativePath)) return null;
  const filePath = path.resolve(uiRoot, relativePath);
  const root = path.resolve(uiRoot);
  return filePath === root || filePath.startsWith(`${root}${path.sep}`) ? filePath : null;
}

// The HISTORY-FALLBACK DISCRIMINATOR: may a pathname that MISSED on disk be answered
// with the app shell (`index.html`, 200, `text/html`) instead of a 404?
//
// THE RULE IS "THE LAST PATH SEGMENT CONTAINS NO `.`" — not `path.extname`, which
// answers "" for `.env` and would hand a dotfile probe the shell. So `/fleet`, `/board`,
// `/config`, `/`, `/board/` and any future `/a/deep/path` fall back; `/assets/index-abc.js`,
// `/index.html`, `/favicon.ico`, `/.env` and `/board.v2` do not. ADR-004 records the two
// rejected alternatives: `Accept: text/html` (it makes one URL answer differently for
// curl, for this repo's headless harnesses and for a browser) and a route-derived
// allowlist (the server would have to learn the client's route table — either `src/`
// imports `ui/src/`, a new and wrong coupling direction, or the list gets a second home
// and drifts the first time milestone 47 or 49 adds a route).
//
// IT READS THE PATH THE SERVER ACTUALLY RESOLVED, NOT THE RAW BYTES. `new URL()` does
// NOT decode `%2E`, so a predicate reading the raw pathname sees no dot in
// `/assets/index-missing%2Ejs`, calls it extension-less, and answers the app shell — the
// asset-masking guard bypassed by an encoding, on the exact request the guard exists to
// keep loud. Decoding first is what closes that (task 02's last scenario). It does not
// weaken the traversal cases: `/%2e%2e%2fetc%2fpasswd` decodes to `../etc/passwd`, whose
// last segment still carries no dot, so this predicate STILL accepts it in isolation —
// which is exactly why the guard runs first and its refusal is terminal.
//
// `/api/` IS REFUSED HERE TOO, AND THAT IS BELT *AND* BRACES. Both servers already
// return the coded not-found envelope for `/api/*` before the static handler is reached
// (`setup-ui.mjs:125-128`, `mesh-ui-serve.mjs:546-549`); this second, independent guard
// means a later refactor that reorders the handler cannot turn an API 404 into an HTML
// 200. Note the prefix is `/api/` WITH the slash: bare `/api` is an unknown path like
// any other and renders the shell's own not-found surface (ADR-002 — ONE not-found
// experience, not two), matching what both servers' own `startsWith("/api/")` guards do.
export function shouldServeAppShell(pathname) {
  if (typeof pathname !== "string" || pathname === "") return false;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed percent-escape is not a client route. `safeStaticPath` refuses it
    // first (its own `decodeURIComponent` throws), so a handler in the pinned order
    // never reaches here for one — this is the braces to that belt.
    return false;
  }
  if (pathname.startsWith("/api/") || decoded.startsWith("/api/")) return false;
  const lastSegment = decoded.slice(decoded.lastIndexOf("/") + 1);
  return !lastSegment.includes(".");
}
