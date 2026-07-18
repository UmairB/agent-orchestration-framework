// Fitness function: acd-minted-token-scoped-single-repo (milestone 38 / ADR-010
// §6.3; SECURITY F6/T9 — REWRITTEN at milestone 38 / story 07, ADR-015 decision 3;
// SECURITY T15, "RE-OPENS T9". Security-owned, spec'd in SECURITY.md's T15 entry;
// armed here against the REAL push-mint module built by story 07 task 02.)
//
// THE REWRITE (verbatim SECURITY.md T15 direction) — a TWO-SEAM detector:
//   (clone) the body deep-equals single-repo `{ contents: "read" }` — VERBATIM the
//   ORIGINAL T9 invariant, PLUS a new plant that a clone body carrying ANY write MUST
//   trip ("never silently widened").
//   (write) single-repo, `permissions` a SUBSET of `{ contents:"write",
//   pull_requests:"write" }` (auto-PR OFF ⇒ EXACTLY `{ contents:"write" }`) — and the
//   write body lives ONLY in the push-mint function (createGithubAppPushMintProvider),
//   never reachable from the clone provider's own exported mintCloneCredential.
//
// Detector shape: locate BOTH functions' OWN balanced bodies by name
// (createGithubAppMintProvider / createGithubAppPushMintProvider — the T15-mandated
// "key each body to its own mint function/export", never a single
// first-`access_tokens`-in-the-file scan, which could no longer disambiguate the two
// seams now that both exist in this file) and validate EACH function's OWN
// `access_tokens` request body/bodies independently.
//
// Non-negotiable plant discipline (this milestone's own hard lesson, carried forward
// verbatim from the pre-rewrite file): the tree is CRLF. Every plant is a SYNTHESIZED
// snippet built with explicit "\n" joins — never a string-replace on a real file. The
// real source is asserted clean FIRST; each plant is asserted to DIFFER from its own
// clean baseline before asserting it trips.
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

// functionBodyByName(source, functionName) — locates `function <functionName>(` and
// returns its balanced BODY text. Depth-aware across the PARAMETER LIST too (`(`/`{`/
// `[` all count) — a naive "find the first { after the name" would stop at a
// destructured/defaulted parameter's OWN brace (e.g. `function f({ a } = {}) {`),
// never reaching the function body at all (a silently-vacuous scan).
function functionBodyByName(source, functionName) {
  const idx = source.indexOf(`function ${functionName}(`);
  if (idx === -1) return null;
  const parenOpen = source.indexOf("(", idx);
  if (parenOpen === -1) return null;
  let depth = 0;
  let i = parenOpen;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0 && ch === ")") break;
    }
  }
  const braceIdx = source.indexOf("{", i + 1);
  if (braceIdx === -1) return null;
  return sliceBalanced(source, braceIdx);
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

// allBalancedObjectLiterals(text) — every TOP-LEVEL `{...}` object literal found in
// `text`, in order (handles both a single plain object AND a ternary of two object
// branches, e.g. `autoPr ? {...} : {...}` — the write mint's real, auto-PR-branching
// permissions value — without needing a JS parser).
function allBalancedObjectLiterals(text) {
  const results = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "{") {
      const inner = sliceBalanced(text, i);
      if (inner == null) break;
      results.push(inner);
      i += inner.length + 2;
    } else {
      i += 1;
    }
  }
  return results;
}

// allAccessTokensBodyLiterals(spanText) — every `body: JSON.stringify({...})` object
// literal (inner text) reachable from an `access_tokens` URL anchor within
// `spanText`, in order. Iterates EVERY call site (the T15 rewrite direction) rather
// than stopping at the first, so a function with more than one exchange call (a
// possible-but-not-required shape) is still fully covered.
function allAccessTokensBodyLiterals(spanText) {
  const bodies = [];
  let searchFrom = 0;
  for (;;) {
    const anchor = spanText.indexOf("access_tokens", searchFrom);
    if (anchor === -1) break;
    searchFrom = anchor + "access_tokens".length;
    const bodyKeyIdx = spanText.indexOf("body:", anchor);
    if (bodyKeyIdx === -1) continue;
    const stringifyIdx = spanText.indexOf("JSON.stringify", bodyKeyIdx);
    if (stringifyIdx === -1) continue;
    const parenOpen = spanText.indexOf("(", stringifyIdx);
    if (parenOpen === -1) continue;
    const argsInside = sliceBalancedParens(spanText, parenOpen);
    if (argsInside == null) continue;
    const braceOpen = argsInside.indexOf("{");
    if (braceOpen === -1) continue;
    const inner = sliceBalanced(argsInside, braceOpen);
    if (inner != null) bodies.push(inner);
  }
  return bodies;
}

// permissionsProblems(valueText) — the CLONE rule (T9, VERBATIM): permissions is a
// single, non-ternary object literal with EXACTLY one key, `contents: "read"`.
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

// writePermissionsValueProblems(valueText, label) — the WRITE rule (T15): the value
// may be a SINGLE object literal OR a ternary of TWO object-literal branches
// (auto-PR OFF/ON) — every branch found must independently satisfy: `contents:
// "write"` present and correct, `pull_requests` — when present — EXACTLY "write",
// and NO OTHER key (no administration, no org-wide key).
function writePermissionsValueProblems(valueText, label) {
  const objects = allBalancedObjectLiterals(valueText);
  if (objects.length === 0) {
    return [`${label}: permissions value has no recognizable object literal (expected an inline {…} or a ternary of two inline {…} branches)`];
  }
  const allowedKeys = new Set(["contents", "pull_requests"]);
  const problems = [];
  for (const inner of objects) {
    const entries = topLevelKeyValueEntries(inner);
    for (const entry of entries) {
      if (!allowedKeys.has(entry.key)) {
        problems.push(`${label}: permissions has a disallowed key "${entry.key}" — the write scope permits ONLY contents/pull_requests, never administration/org-wide`);
      }
    }
    const contentsEntry = entries.find((e) => e.key === "contents");
    if (contentsEntry == null) {
      problems.push(`${label}: permissions is missing the contents key`);
    } else if (!/^["'`]write["'`]$/.test(contentsEntry.value.trim())) {
      problems.push(`${label}: permissions.contents is \`${contentsEntry.value}\` — expected EXACTLY "write"`);
    }
    const prEntry = entries.find((e) => e.key === "pull_requests");
    if (prEntry != null && !/^["'`]write["'`]$/.test(prEntry.value.trim())) {
      problems.push(`${label}: permissions.pull_requests is \`${prEntry.value}\` — expected EXACTLY "write" when present`);
    }
  }
  return problems;
}

// repositoriesProblems(entries, label) — the SINGLE-repo rule, shared by both seams:
// `repositories`/`repository_ids` present, holding EXACTLY one element.
function repositoriesProblems(entries, label) {
  const problems = [];
  const reposEntry = entries.find((e) => e.key === "repositories" || e.key === "repository_ids");
  if (reposEntry == null) {
    problems.push(`${label}: the access_tokens body OMITS repositories/repository_ids — the token would scope to EVERY installation repo`);
    return problems;
  }
  const count = arrayElementCount(reposEntry.value);
  if (count == null) {
    problems.push(`${label}: ${reposEntry.key} is not a literal array`);
  } else if (count !== 1) {
    problems.push(`${label}: ${reposEntry.key} names ${count} repo(s) — expected EXACTLY one`);
  }
  return problems;
}

// cloneSeamProblems(source, label) — locates createGithubAppMintProvider's OWN span
// and validates every access_tokens body found within it against the T9 clone rule,
// PLUS a defense-in-depth scan for ANY contents:"write" value anywhere in that span
// (attack (c): "the clone credential is never silently widened" — catches a stray
// write mention even outside a formally-recognized access_tokens call).
function cloneSeamProblems(source, label) {
  const span = functionBodyByName(source, "createGithubAppMintProvider");
  if (span == null) {
    return [`${label}: could not locate createGithubAppMintProvider's function body`];
  }
  const problems = [];
  const bodies = allAccessTokensBodyLiterals(span);
  if (bodies.length === 0) {
    problems.push(`${label}: no access_tokens request body found in the clone-mint function`);
  }
  for (const objectBody of bodies) {
    const entries = topLevelKeyValueEntries(objectBody);
    problems.push(...repositoriesProblems(entries, label));
    const permsEntry = entries.find((e) => e.key === "permissions");
    if (permsEntry == null) {
      problems.push(`${label}: the clone access_tokens body OMITS permissions — the token would inherit the installation's FULL granted scope`);
    } else {
      problems.push(...permissionsProblems(permsEntry.value).map((p) => `${label}: ${p}`));
    }
  }
  if (/contents\s*:\s*["'`]write["'`]/.test(span)) {
    problems.push(`${label}: the clone-mint span contains a contents:"write" value somewhere — the clone credential must NEVER be silently widened to write`);
  }
  return problems;
}

// writeSeamProblems(source, label) — locates createGithubAppPushMintProvider's OWN
// span and validates every access_tokens body found within it against the T15 write
// rule. The write body living ONLY here (never inside createGithubAppMintProvider's
// span) is enforced structurally BY THIS SPLIT ITSELF — cloneSeamProblems above never
// looks inside this function, and this function never looks inside the clone's.
function writeSeamProblems(source, label) {
  const span = functionBodyByName(source, "createGithubAppPushMintProvider");
  if (span == null) {
    return [`${label}: could not locate createGithubAppPushMintProvider's function body`];
  }
  const problems = [];
  const bodies = allAccessTokensBodyLiterals(span);
  if (bodies.length === 0) {
    problems.push(`${label}: no access_tokens request body found in the push-mint function`);
  }
  for (const objectBody of bodies) {
    const entries = topLevelKeyValueEntries(objectBody);
    problems.push(...repositoriesProblems(entries, label));
    const permsEntry = entries.find((e) => e.key === "permissions");
    if (permsEntry == null) {
      problems.push(`${label}: the write access_tokens body OMITS permissions — the token would inherit the installation's FULL granted scope`);
    } else {
      problems.push(...writePermissionsValueProblems(permsEntry.value, label));
    }
  }
  return problems;
}

function twoSeamProblems(source) {
  return [...cloneSeamProblems(source, "clone"), ...writeSeamProblems(source, "write")];
}

// synthesizeAccessTokensCall(bodyObjectText) — a minimal snippet carrying ONLY the
// anchor shapes the detector keys on (`access_tokens`, `body:`, `JSON.stringify(`) —
// preserved verbatim from the pre-rewrite file for the single-seam self-check row.
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

const CLONE_CLEAN_BODY = "{ repositories: [repo], permissions: { contents: \"read\" } }";
const WRITE_CLEAN_BODY = "{ repositories: [repo], permissions: { contents: \"write\" } }";

// synthesizeTwoSeamModule({ cloneBody, writeBody }) — a minimal TWO-FUNCTION snippet
// carrying the two REAL function-name anchors the detector keys on
// (createGithubAppMintProvider / createGithubAppPushMintProvider), each with its OWN
// access_tokens exchange call — the plant plumbing for the Scenario Outline below.
function synthesizeTwoSeamModule({ cloneBody = CLONE_CLEAN_BODY, writeBody = WRITE_CLEAN_BODY } = {}) {
  return [
    "export function createGithubAppMintProvider(deps) {",
    "  const mintCloneCredential = async function mintCloneCredential(workspaceId) {",
    "    return httpRequest(`${apiBaseUrl}/app/installations/${installationId}/access_tokens`, {",
    "      method: \"POST\",",
    `      body: JSON.stringify(${cloneBody}),`,
    "    });",
    "  };",
    "  return mintCloneCredential;",
    "}",
    "",
    "export function createGithubAppPushMintProvider(deps) {",
    "  const mintWriteCredential = async function mintWriteCredential(workspaceId) {",
    "    return httpRequest(`${apiBaseUrl}/app/installations/${installationId}/access_tokens`, {",
    "      method: \"POST\",",
    `      body: JSON.stringify(${writeBody}),`,
    "    });",
    "  };",
    "  return mintWriteCredential;",
    "}",
  ].join("\n");
}

export const archTests = [
  {
    name: "arch/38 ADR-015/T15 (acd-minted-token-scoped-single-repo, REWRITTEN two-seam): the REAL github-app clone mint stays single-repo, contents:read — VERBATIM the T9 invariant",
    run: async () => {
      const source = lf(await readFile(providerSourcePath, "utf8"));
      assert.deepEqual(cloneSeamProblems(source, "clone"), [], "the real clone-mint access_tokens body is single-repo, read-only, never widened");
    },
  },
  {
    name: "arch/38 ADR-015/T15 (acd-minted-token-scoped-single-repo, REWRITTEN two-seam): the REAL github-app push (write) mint is single-repo, permissions ⊆ { contents:\"write\", pull_requests:\"write\" } — and lives ONLY in createGithubAppPushMintProvider",
    run: async () => {
      const source = lf(await readFile(providerSourcePath, "utf8"));
      assert.deepEqual(writeSeamProblems(source, "write"), [], "the real write-mint access_tokens body(ies) are single-repo, write-scoped, never broader");
      // The write body lives ONLY in the push-mint function — the clone provider's
      // OWN span (already asserted clean above) never contains it either.
      assert.deepEqual(cloneSeamProblems(source, "clone"), [], "sanity re-check: the clone span still carries no write body");
    },
  },
  {
    name: "arch/38 ADR-015/T15 (acd-minted-token-scoped-single-repo, REWRITTEN two-seam): self-check (single-seam legacy shapes) — an omitted repositories key, a multi-repo array, a write permission, a broader permission set, and an omitted permissions key on the CLONE seam ALL trip; the single-repo read-only body stays clean",
    run: async () => {
      const clean = synthesizeAccessTokensCall(CLONE_CLEAN_BODY);
      const cleanModule = `export function createGithubAppMintProvider(deps) {\n${clean}\n}`;
      assert.deepEqual(cloneSeamProblems(cleanModule, "clean"), [], "sanity: the synthesized clean shape is single-repo, read-only");

      const plantBodies = [
        ["{ permissions: { contents: \"read\" } }", "omit repositories/repository_ids"],
        ["{ repositories: [repoA, repoB], permissions: { contents: \"read\" } }", "multi-repo"],
        ["{ repositories: [repo], permissions: { contents: \"write\" } }", "contents:write permission"],
        ["{ repositories: [repo], permissions: { contents: \"read\", administration: \"read\" } }", "a BROADER permission set"],
        ["{ repositories: [repo] }", "omit permissions entirely"],
      ];
      for (const [bodyText, note] of plantBodies) {
        const plantedModule = `export function createGithubAppMintProvider(deps) {\n${synthesizeAccessTokensCall(bodyText)}\n}`;
        assert.notEqual(plantedModule, cleanModule, `[${note}] the plant actually differs from the clean synthesized shape`);
        assert.ok(cloneSeamProblems(plantedModule, "p").length > 0, `[${note}] trips the detector`);
      }
    },
  },
  {
    name: "arch/38 ADR-015/T15 (acd-minted-token-scoped-single-repo, REWRITTEN two-seam): Scenario Outline — the plants that MUST trip (or stay clean under) the rewritten two-seam detector in CI (11 rows)",
    run: async () => {
      const cleanModule = synthesizeTwoSeamModule();
      assert.deepEqual(twoSeamProblems(cleanModule), [], "sanity: the clean synthesized two-seam module is clean under both seams");

      const rows = [
        { seam: "clone", plantBody: "{ repositories: [repo], permissions: { contents: \"write\" } }", verdict: "TRIPS", note: "clone silently widened to write — attack (c)" },
        { seam: "clone", plantBody: "{ repositories: [repoA, repoB], permissions: { contents: \"read\" } }", verdict: "TRIPS", note: "multi-repo clone" },
        { seam: "clone", plantBody: "{ permissions: { contents: \"read\" } }", verdict: "TRIPS", note: "repositories OMITTED — all installation repos" },
        { seam: "clone", plantBody: "{ repositories: [repo], permissions: { contents: \"read\", administration: \"read\" } }", verdict: "TRIPS", note: "org-wide/administration key on clone" },
        { seam: "write", plantBody: "{ permissions: { contents: \"write\" } }", verdict: "TRIPS", note: "repositories OMITTED — all-repo WRITE (worst)" },
        { seam: "write", plantBody: "{ repositories: [repoA, repoB], permissions: { contents: \"write\" } }", verdict: "TRIPS", note: "multi-repo write" },
        { seam: "write", plantBody: "{ repositories: [repo], permissions: { contents: \"write\", administration: \"write\" } }", verdict: "TRIPS", note: "org-wide/administration key on write" },
        { seam: "write", plantBody: "{ repositories: [repo] }", verdict: "TRIPS", note: "permissions OMITTED — full installation scope" },
        { seam: "clone", plantBody: "{ repositories: [repo], permissions: { contents: \"read\" } }", verdict: "CLEAN", note: "correct clone seam — T9 verbatim" },
        { seam: "write", plantBody: "{ repositories: [repo], permissions: { contents: \"write\" } }", verdict: "CLEAN", note: "correct write seam — auto-PR OFF" },
        { seam: "write", plantBody: "{ repositories: [repo], permissions: { contents: \"write\", pull_requests: \"write\" } }", verdict: "CLEAN", note: "correct write seam — auto-PR ON" },
      ];

      for (const row of rows) {
        const planted = row.seam === "clone"
          ? synthesizeTwoSeamModule({ cloneBody: row.plantBody })
          : synthesizeTwoSeamModule({ writeBody: row.plantBody });
        const problems = twoSeamProblems(planted);
        if (row.verdict === "TRIPS") {
          assert.notEqual(planted, cleanModule, `[${row.seam}/${row.note}] the plant actually differs from the clean synthesized shape`);
          assert.ok(problems.length > 0, `[${row.seam}/${row.note}] MUST trip the detector`);
        } else {
          assert.deepEqual(problems, [], `[${row.seam}/${row.note}] MUST stay clean under the detector: ${JSON.stringify(problems)}`);
        }
      }
    },
  },
];
