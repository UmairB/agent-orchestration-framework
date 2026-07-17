// Fitness function: acd-minted-token-scoped-single-repo (milestone 38 / ADR-010
// §6.3; SECURITY F6 — security-owned, SPEC in SECURITY.md, ARMED AT BUILD now that
// the `github-app` provider module exists)
//
// THE INVARIANT (SECURITY.md, verbatim): the `github-app` mint's installation-token
// request names EXACTLY the ONE assigned repo — a SINGLE-ELEMENT
// `repositories`/`repository_ids` derived from the mint's `workspaceId` arg (never
// omitted, never >1) — and `permissions` EXACTLY `{ contents: "read" }` (never
// omitted, never `write`, never a broader set). The CODE-ENFORCEMENT that closes T4.
//
// Detector parses the request-BODY object literal passed to the installation
// `access_tokens` POST call (structural, source-analysis over the provider module)
// and asserts: `repositories`/`repository_ids` is PRESENT, holds a SINGLE element;
// AND `permissions` deep-equals `{ contents: "read" }` (present, exactly one key,
// exactly that value).
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

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function lf(source) {
  return source.replace(/\r\n/g, "\n");
}

function sliceBalanced(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

function sliceBalancedParens(source, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, i);
    }
  }
  return null;
}

// topLevelKeyValueEntries(objectBody) -> [{ key, value }] — the DEPTH-0 `key: value`
// entries of an object literal's inner text (depth-aware across {}, [], ()).
function topLevelKeyValueEntries(objectBody) {
  const entries = [];
  let depth = 0;
  let segment = "";
  const flush = () => {
    const trimmed = segment.trim();
    segment = "";
    if (trimmed.length === 0) return;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) return;
    entries.push({ key: trimmed.slice(0, colonIdx).trim(), value: trimmed.slice(colonIdx + 1).trim() });
  };
  for (const ch of objectBody) {
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      flush();
      continue;
    }
    segment += ch;
  }
  flush();
  return entries;
}

// arrayElementCount(valueText) -> number|null — the top-level comma-separated
// element count of an array-literal value text (`null` when not an array literal).
function arrayElementCount(valueText) {
  const trimmed = valueText.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return 0;
  let depth = 0;
  let count = 1;
  for (const ch of inner) {
    if (ch === "[" || ch === "{" || ch === "(") depth += 1;
    else if (ch === "]" || ch === "}" || ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) count += 1;
  }
  return count;
}

function permissionsProblems(valueText) {
  const trimmed = valueText.trim();
  if (!trimmed.startsWith("{")) return ["permissions is not an object literal"];
  const inner = sliceBalanced(trimmed, 0);
  if (inner == null) return ["permissions object literal could not be balanced"];
  const entries = topLevelKeyValueEntries(inner);
  const problems = [];
  if (entries.length !== 1) {
    problems.push(`permissions has ${entries.length} key(s) — expected EXACTLY one (contents)`);
  }
  const contentsEntry = entries.find((e) => e.key === "contents");
  if (contentsEntry == null) {
    problems.push("permissions is missing the contents key");
  } else if (!/^["'`]read["'`]$/.test(contentsEntry.value.trim())) {
    problems.push(`permissions.contents is \`${contentsEntry.value}\` — expected EXACTLY "read"`);
  }
  return problems;
}

// accessTokensBodyLiteral(source) — locates the FIRST `access_tokens` call site's
// `body: JSON.stringify({...})` argument and returns the object literal's INNER text
// (brace-balanced).
function accessTokensBodyLiteral(source) {
  const code = stripComments(source);
  const anchor = code.indexOf("access_tokens");
  if (anchor === -1) return null;
  const bodyKeyIdx = code.indexOf("body:", anchor);
  if (bodyKeyIdx === -1) return null;
  const stringifyIdx = code.indexOf("JSON.stringify", bodyKeyIdx);
  if (stringifyIdx === -1) return null;
  const parenOpen = code.indexOf("(", stringifyIdx);
  if (parenOpen === -1) return null;
  const argsInside = sliceBalancedParens(code, parenOpen);
  if (argsInside == null) return null;
  const braceOpen = argsInside.indexOf("{");
  if (braceOpen === -1) return null;
  return sliceBalanced(argsInside, braceOpen);
}

function accessTokenScopeProblems(source, label) {
  const objectBody = accessTokensBodyLiteral(source);
  const problems = [];
  if (objectBody == null) {
    problems.push(`${label}: could not locate the access_tokens request body object literal`);
    return problems;
  }
  const entries = topLevelKeyValueEntries(objectBody);
  const reposEntry = entries.find((e) => e.key === "repositories" || e.key === "repository_ids");
  if (reposEntry == null) {
    problems.push(`${label}: the access_tokens body OMITS repositories/repository_ids — the token would scope to EVERY installation repo`);
  } else {
    const count = arrayElementCount(reposEntry.value);
    if (count == null) {
      problems.push(`${label}: ${reposEntry.key} is not a literal array`);
    } else if (count !== 1) {
      problems.push(`${label}: ${reposEntry.key} names ${count} repo(s) — expected EXACTLY one`);
    }
  }
  const permsEntry = entries.find((e) => e.key === "permissions");
  if (permsEntry == null) {
    problems.push(`${label}: the access_tokens body OMITS permissions — the token would inherit the installation's FULL granted scope`);
  } else {
    problems.push(...permissionsProblems(permsEntry.value).map((p) => `${label}: ${p}`));
  }
  return problems;
}

// synthesizeAccessTokensCall(bodyObjectText) — a minimal snippet carrying ONLY the
// anchor shapes the detector keys on (`access_tokens`, `body:`, `JSON.stringify(`).
function synthesizeAccessTokensCall(bodyObjectText) {
  return [
    "async function exchange(apiBaseUrl, installationId, repo, headers) {",
    "  return httpRequest(`${apiBaseUrl}/app/installations/${installationId}/access_tokens`, {",
    "    method: \"POST\",",
    "    headers,",
    `    body: JSON.stringify(${bodyObjectText}),`,
    "  });",
    "}",
  ].join("\n");
}

const CLEAN_BODY = "{ repositories: [repo], permissions: { contents: \"read\" } }";

export const archTests = [
  {
    name: "arch/38 ADR-010 (acd-minted-token-scoped-single-repo): the REAL github-app provider's access_tokens request body names EXACTLY one repo + permissions: { contents: \"read\" }",
    run: async () => {
      const source = lf(await readFile(providerSourcePath, "utf8"));
      assert.deepEqual(accessTokenScopeProblems(source, "provider"), [], "the real access_tokens body is single-repo, read-only");
    },
  },
  {
    name: "arch/38 ADR-010 (acd-minted-token-scoped-single-repo): self-check — an omitted repositories key, a multi-repo array, a write permission, a broader permission set, and an omitted permissions key ALL trip the detector; the single-repo read-only body stays clean",
    run: async () => {
      const source = lf(await readFile(providerSourcePath, "utf8"));
      assert.deepEqual(accessTokenScopeProblems(source, "real"), [], "sanity: the real provider is clean");

      const clean = synthesizeAccessTokensCall(CLEAN_BODY);
      assert.deepEqual(accessTokenScopeProblems(clean, "clean"), [], "sanity: the synthesized clean shape is single-repo, read-only");

      // PLANT 1 — OMIT repositories/repository_ids -> all installation repos.
      const omitRepos = synthesizeAccessTokensCall("{ permissions: { contents: \"read\" } }");
      assert.notEqual(omitRepos, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(accessTokenScopeProblems(omitRepos, "p1").length > 0, "omitting repositories/repository_ids trips the detector");

      // PLANT 2 — multi-repo.
      const multiRepo = synthesizeAccessTokensCall("{ repositories: [repoA, repoB], permissions: { contents: \"read\" } }");
      assert.notEqual(multiRepo, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(accessTokenScopeProblems(multiRepo, "p2").length > 0, "a multi-repo array trips the detector");

      // PLANT 3 — permissions: { contents: "write" }.
      const writePerm = synthesizeAccessTokensCall("{ repositories: [repo], permissions: { contents: \"write\" } }");
      assert.notEqual(writePerm, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(accessTokenScopeProblems(writePerm, "p3").length > 0, "a contents:write permission trips the detector");

      // PLANT 4 — a BROADER permission set.
      const broaderPerm = synthesizeAccessTokensCall("{ repositories: [repo], permissions: { contents: \"read\", administration: \"read\" } }");
      assert.notEqual(broaderPerm, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(accessTokenScopeProblems(broaderPerm, "p4").length > 0, "a broader permission set trips the detector");

      // PLANT 5 — OMIT permissions entirely -> the installation's full granted scope.
      const omitPerms = synthesizeAccessTokensCall("{ repositories: [repo] }");
      assert.notEqual(omitPerms, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(accessTokenScopeProblems(omitPerms, "p5").length > 0, "omitting permissions entirely trips the detector");

      // NEGATIVE CONTROL — the correct single-repo, read-only body stays clean
      // (re-asserted here, alongside every plant, for a single legible self-check).
      assert.deepEqual(accessTokenScopeProblems(clean, "neg"), [], "the single-repo, read-only body stays clean");
    },
  },
];
