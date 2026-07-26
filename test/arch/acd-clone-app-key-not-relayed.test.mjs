// Fitness function: acd-clone-app-key-not-relayed (milestone 38 / ADR-010 §6.2;
// SECURITY F5 — security-owned, SPEC in SECURITY.md, ARMED AT BUILD now that the
// `github-app` provider module exists)
//
// THE INVARIANT (SECURITY.md, verbatim): the GitHub App PRIVATE KEY (the PEM /
// configured key material) never (a) crosses the relay — it appears on NO frame
// builder (`buildCloneCredentialFrame` and every `sendDirective`/`ws.send` payload
// carry only the minted TOKEN, never the KEY), and (b) reaches no
// `console.*`/`logger.*`/`warn`/`onWarning`/`Error(...)` message sink. It flows ONLY
// into the JWT signer (`node:crypto` `createSign`/`sign`). EXTENDS story-01's F4 (the
// minted TOKEN) to the KEY (and to the mint-time App JWT, T11).
//
// Detector = F4's LOG_SINK + balancedArgs scanner (test/arch/acd-clone-credential-
// relay-not-logged.test.mjs) widened to a KEY needle (`privateKey`/`appPrivateKey`/
// `pem`/`PRIVATE KEY`) AND — L2 (this review) — the mint-time App JWT bearer
// (`jwt`/`Bearer`, SECURITY T11: F5 "extends to the mint-time App JWT") — PLUS an
// `Error(...)` sink (SECURITY's own invariant names it explicitly) — PLUS a frame/relay
// scanner (any `buildCloneCredentialFrame`/`sendDirective`/`ws.send` call whose
// argument list references the needle). The `jwt`/`Bearer` needle is matched ONLY
// inside those log/error/frame sinks (the SAME scan-scoping the key needle already
// uses), so the legitimate `Authorization: `Bearer ${jwt}`` request-HEADER construction
// (an object literal handed to `httpRequest`/`fetch`, never a sink) does NOT trip — a
// dedicated negative control below pins that.
//
// Scanned across the `github-app` provider module, `src/control-stream-server.mjs`,
// AND — L1 (this review) — `src/mesh-launcher.mjs`, the key's FIRST-materialisation
// site (`resolveGithubAppPrivateKey` reads the raw PEM via `readFileSync` and hands it
// down to the provider) — so a future log/error of the key at the site it is READ, not
// just where it is USED, also fails CI.
//
// Non-negotiable plant discipline (this milestone's own hard lesson): the tree is
// CRLF. Every plant is a SYNTHESIZED snippet built with explicit "\n" joins — never a
// string-replace on a real file. The real source is asserted clean FIRST; each plant
// is asserted to DIFFER from its own clean baseline before asserting it trips.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const providerSourcePath = path.join(repoRoot, "src", "mesh-clone-credential-provider.mjs");
const controlSourcePath = path.join(repoRoot, "src", "control-stream-server.mjs");
// L1 (this review) — the launcher is the key's FIRST-materialisation site: it reads the
// raw PEM (`resolveGithubAppPrivateKey` → `readFileSync`) and passes it into the
// provider. F5 now scans it too, so a leak at the READ site (not only the USE site) trips.
const launcherSourcePath = path.join(repoRoot, "src", "mesh-launcher.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function lf(source) {
  return source.replace(/\r\n/g, "\n");
}

// balancedArgs(source, openParenIndex) — verbatim idiom from
// acd-clone-credential-relay-not-logged.test.mjs.
function balancedArgs(source, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, i);
    }
  }
  return source.slice(openParenIndex + 1);
}

// The KEY material (T8) PLUS the mint-time App JWT bearer (T11, L2). `jwt`/`Bearer` are
// matched only inside the sinks below (see the module header) — never on the legitimate
// `Bearer ${jwt}` request-header, which is not a sink.
const KEY_NEEDLE = /\b(?:privateKey|appPrivateKey|pem|jwt)\b|PRIVATE KEY|Bearer/;
const LOG_AND_ERROR_SINK = /\b(?:console\.[a-z]+|logger\.[a-z]+|warn|onWarning|Error)\s*\(/g;
const RELAY_SINK = /\b(?:buildCloneCredentialFrame|sendDirective|ws\.send)\s*\(/g;

function keyRelayProblems(code, label) {
  const problems = [];
  let match;
  LOG_AND_ERROR_SINK.lastIndex = 0;
  while ((match = LOG_AND_ERROR_SINK.exec(code)) != null) {
    const openParen = code.indexOf("(", match.index);
    if (openParen === -1) continue;
    const args = balancedArgs(code, openParen);
    if (KEY_NEEDLE.test(args)) {
      problems.push(`${label}: the App private key OR the mint-time App JWT flows into a \`${match[0].trim()}…)\` sink — SECURITY F5/T8+T11: the key must reach ONLY the JWT signer and the JWT ONLY the mint request-header, never a log/warn/error message`);
    }
  }
  RELAY_SINK.lastIndex = 0;
  while ((match = RELAY_SINK.exec(code)) != null) {
    const openParen = code.indexOf("(", match.index);
    if (openParen === -1) continue;
    const args = balancedArgs(code, openParen);
    if (KEY_NEEDLE.test(args)) {
      problems.push(`${label}: the App private key OR the mint-time App JWT flows into a \`${match[0].trim()}…)\` RELAYED FRAME — SECURITY F5/T8+T11: neither the key nor the JWT may EVER cross the relay, only the minted TOKEN may`);
    }
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/38 ADR-010 (acd-clone-app-key-not-relayed): the REAL github-app provider module + control-stream-server.mjs + mesh-launcher.mjs never pass the App private key OR the mint-time App JWT into a log/warn/error sink or a relayed frame",
    run: async () => {
      const provider = stripComments(lf(await readFile(providerSourcePath, "utf8")));
      const control = stripComments(lf(await readFile(controlSourcePath, "utf8")));
      const launcher = stripComments(lf(await readFile(launcherSourcePath, "utf8")));
      const problems = [
        ...keyRelayProblems(provider, "mesh-clone-credential-provider.mjs"),
        ...keyRelayProblems(control, "control-stream-server.mjs"),
        ...keyRelayProblems(launcher, "mesh-launcher.mjs"),
      ];
      assert.deepEqual(problems, [], `key-relay problems: ${JSON.stringify(problems, null, 2)}`);
    },
  },
  {
    name: "arch/38 ADR-010 (acd-clone-app-key-not-relayed): self-check — a console.log/logger.debug of the key, a console.log of the mint-time JWT, a buildCloneCredentialFrame/ws.send carrying the key, an Error(...) embedding the key, and a launcher-side Error embedding the key ALL trip the detector; the real signer call (createSign(...).sign(privateKey)), a frame carrying only the minted TOKEN, and the legitimate `Authorization: Bearer ${jwt}` request-header all stay clean",
    run: async () => {
      const provider = stripComments(lf(await readFile(providerSourcePath, "utf8")));
      const control = stripComments(lf(await readFile(controlSourcePath, "utf8")));
      const launcher = stripComments(lf(await readFile(launcherSourcePath, "utf8")));
      assert.deepEqual(keyRelayProblems(provider, "provider"), [], "sanity: the real provider module is clean");
      assert.deepEqual(keyRelayProblems(control, "control"), [], "sanity: the real control module is clean");
      assert.deepEqual(keyRelayProblems(launcher, "launcher"), [], "sanity: the real launcher module is clean under the widened detector");

      const clean = [
        "function signAppJwt({ appId, privateKey, now }) {",
        "  const signingInput = buildSigningInput(appId, now);",
        "  return signingInput + '.' + createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');",
        "}",
      ].join("\n");
      assert.deepEqual(keyRelayProblems(clean, "clean"), [], "sanity: the synthesized clean signer shape carries no key into a log/frame sink");

      // PLANT 1 — a debug log of the key material.
      const plantedConsole = [
        "function signAppJwt({ appId, privateKey, now }) {",
        "  console.log('signing with ' + privateKey);",
        "  return createSign('RSA-SHA256').sign(privateKey);",
        "}",
      ].join("\n");
      assert.notEqual(plantedConsole, clean, "the console plant differs from the clean baseline");
      assert.ok(keyRelayProblems(plantedConsole, "p1").length > 0, "a console.log of the private key trips the detector");

      const plantedLogger = [
        "function createGithubAppMintProvider({ appId, appPrivateKey }) {",
        "  logger.debug('app key', appPrivateKey);",
        "  return async () => null;",
        "}",
      ].join("\n");
      assert.notEqual(plantedLogger, clean, "the logger plant differs from the clean baseline");
      assert.ok(keyRelayProblems(plantedLogger, "p2").length > 0, "a logger.debug of the App key trips the detector");

      // PLANT 1c (L2 — the mint-time App JWT, T11) — a debug log of the SIGNED JWT
      // (the ≤10-min minting bearer derived from the key). Distinct from the key plants
      // above: it exercises the NEW `jwt` needle, not the key needle.
      const plantedJwtLog = [
        "async function mint(appId, privateKey, now) {",
        "  const jwt = signAppJwt({ appId, privateKey, now });",
        "  console.log('minting with app jwt', jwt);",
        "  return exchange(jwt);",
        "}",
      ].join("\n");
      assert.notEqual(plantedJwtLog, clean, "the jwt-log plant differs from the clean baseline");
      assert.ok(keyRelayProblems(plantedJwtLog, "p2b").length > 0, "a console.log of the mint-time App JWT trips the widened detector (T11)");

      // PLANT 2 — the key smuggled onto a RELAYED frame.
      const plantedFrame = [
        "function replyWithKey(to, privateKey) {",
        "  return buildCloneCredentialFrame(to, { credential: privateKey });",
        "}",
      ].join("\n");
      assert.notEqual(plantedFrame, clean, "the frame plant differs from the clean baseline");
      assert.ok(keyRelayProblems(plantedFrame, "p3").length > 0, "a buildCloneCredentialFrame carrying the key trips the detector");

      const plantedWsSend = [
        "function leakKeyOverWire(ws, privateKey) {",
        "  ws.send(JSON.stringify({ key: privateKey }));",
        "}",
      ].join("\n");
      assert.notEqual(plantedWsSend, clean, "the ws.send plant differs from the clean baseline");
      assert.ok(keyRelayProblems(plantedWsSend, "p4").length > 0, "a ws.send carrying the key trips the detector");

      // PLANT 3 — the key embedded in an error message.
      const plantedError = [
        "function signOrThrow(privateKey) {",
        "  try {",
        "    return createSign('RSA-SHA256').sign(privateKey);",
        "  } catch {",
        "    throw new Error('bad key: ' + privateKey);",
        "  }",
        "}",
      ].join("\n");
      assert.notEqual(plantedError, clean, "the error plant differs from the clean baseline");
      assert.ok(keyRelayProblems(plantedError, "p5").length > 0, "an Error(...) message embedding the key trips the detector");

      // PLANT 3b (L1 — the launcher, the key's FIRST-materialisation site) — a
      // launcher-shaped `resolveGithubAppPrivateKey` that reads the raw PEM and then
      // leaks it into an Error message. Proves the detector trips on a leak at the READ
      // site now that mesh-launcher.mjs is in the scan set (the real launcher is
      // asserted clean above).
      const plantedLauncherKeyError = [
        "function resolveGithubAppPrivateKey(config) {",
        "  const privateKey = readFileSync(config.mesh.repo.credential.githubApp.privateKeyPath, 'utf8');",
        "  if (!privateKey) throw new Error('bad key at rest: ' + privateKey);",
        "  return privateKey;",
        "}",
      ].join("\n");
      assert.notEqual(plantedLauncherKeyError, clean, "the launcher-side error plant differs from the clean baseline");
      assert.ok(keyRelayProblems(plantedLauncherKeyError, "p6").length > 0, "a launcher-side Error(...) embedding the raw PEM trips the detector (L1)");

      // NEGATIVE CONTROLS — the key flowing ONLY into the signer stays clean; a frame
      // carrying only the minted TOKEN (never the key) also stays clean — only the KEY
      // is forbidden, not the token.
      const negativeSigner = "createSign(\"RSA-SHA256\").update(jwt).sign(privateKey);";
      assert.deepEqual(keyRelayProblems(negativeSigner, "neg-signer"), [], "the key flowing ONLY into the signer stays clean");
      const negativeFrame = "buildCloneCredentialFrame(to, { credential: mintedToken });";
      assert.deepEqual(keyRelayProblems(negativeFrame, "neg-frame"), [], "a frame carrying only the minted TOKEN (never the key) stays clean");

      // NEGATIVE CONTROL (L2) — the LEGITIMATE mint request-header. `Bearer ${jwt}` in an
      // object literal handed to `httpRequest`/`fetch` is NOT a log/error/frame sink, so
      // the widened `jwt`/`Bearer` needle must NOT trip on it — the JWT is ALLOWED to ride
      // the mint's own Authorization header (that is how it mints), it is only forbidden
      // from a log/error/relay sink.
      const negativeBearerHeader = [
        "async function exchange(apiBaseUrl, installationId, jwt) {",
        "  const authHeaders = { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' };",
        "  return httpRequest(`${apiBaseUrl}/app/installations/${installationId}/access_tokens`, {",
        "    method: 'POST',",
        "    headers: { ...authHeaders, 'Content-Type': 'application/json' },",
        "  });",
        "}",
      ].join("\n");
      assert.deepEqual(keyRelayProblems(negativeBearerHeader, "neg-bearer"), [], "the legitimate `Authorization: Bearer ${jwt}` request-header (not a sink) stays clean — the jwt/Bearer needle is sink-scoped");
    },
  },
];
