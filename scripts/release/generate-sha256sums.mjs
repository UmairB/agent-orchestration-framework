// milestone 28 / story 01 (ADR-005/ADR-006) — the SHA256SUMS manifest
// generator, the @executable heart of this story.
//
// Given a directory of STAGED release assets (every per-OS/arch binary +
// every node-pty sidecar, ADR-002/ADR-006), emits a `SHA256SUMS` manifest
// covering EVERY file, byte-exact:
//
//   <sha256>  <relative-filename>\n     (lowercase 64-hex, TWO spaces, LF)
//
// This is the FORMAT SEAM Story 02's installer parses (`aof_manifest_line` /
// Get-AofManifestEntry — both split on the two-space separator and expect
// LF-joined lines). LF is pinned regardless of host OS (the m01/R2 EOL
// lesson — a CRLF from a Windows runner would shift both the POSIX
// `sha256sum -c` parse AND the hash-over-manifest the .asc signs).
//
// Also exports `validateManifest`, the malformed-manifest rejection matrix
// QA authored in 02_checksum-manifest.feature's Scenario Outline — shared by
// this generator's own self-check and any future consumer, so the two
// stories' tolerance for corruption cannot silently drift (the QA
// feasibility flag in the feature file). Story 02's installer.sh/.ps1 already
// have their OWN independent parse/refuse logic (the soft-contract format,
// not a shared code import — greenfield/file-disjoint stories, ARCHITECTURE
// §Story break-down rationale point 3); this module is the Story 01 side of
// that same tolerance, exercised here and NOT wired into install.sh/.ps1
// (out of this story's ownership).
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HEX64_RE = /^[0-9a-f]{64}$/;

// sha256hex(filePath) -> lowercase 64-hex digest of the file's bytes.
function sha256hex(filePath) {
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

// listReleaseFiles(dir) -> sorted, POSIX-relative file list under `dir`
// (recursive — a staged release dir is normally flat, but this walks
// subdirectories defensively so a nested sidecar layout is covered too).
function listReleaseFiles(dir) {
  const out = [];
  function recurse(current) {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) recurse(full);
      else if (st.isFile()) out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  }
  recurse(dir);
  return out.sort();
}

// generateManifestText(dir) -> the SHA256SUMS file's exact string content —
// one `<sha256>  <filename>` line per file under `dir`, LF-joined, LF-
// terminated. Pure string construction: no CRLF can leak in regardless of
// host OS (the string never contains "\r").
export function generateManifestText(dir) {
  const files = listReleaseFiles(dir);
  const lines = files.map((rel) => `${sha256hex(path.join(dir, rel))}  ${rel}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

// generateManifest(dir, outPath) -> writes SHA256SUMS to outPath (LF, utf8,
// no BOM) and returns its text. writeFileSync with a plain "\n"-joined
// string never introduces CRLF, independent of process.platform / any git
// autocrlf setting on the runner (the manifest is generated content, not a
// checked-out file, so .gitattributes does not apply to it — this function
// is the actual LF guarantee).
export function generateManifest(dir, outPath) {
  const text = generateManifestText(dir);
  writeFileSync(outPath, text, { encoding: "utf8" });
  return text;
}

// parseManifestLines(text) -> raw non-empty lines, CR stripped defensively
// (so a manifest that somehow arrived with CRLF is still parseable — the
// EMITTED manifest never has CR — see generateManifestText/generateManifest,
// which are LF-pure and never introduce one; this defensive strip applies
// ONLY to READING an arbitrary/possibly-malformed manifest, e.g. a
// CRLF-corrupted download or a crafted malformed-fixture test — the WRITER
// stays untouched, LF-purity is the contract, not a parser-side fix-up).
// A trailing \r (from a CRLF line ending) is stripped from each line BEFORE
// the two-space-separator / hash / filename parse below, so a CRLF-mangled
// manifest reports the SAME honest malformed-line/malformed-hash/etc.
// classification a real corruption of that shape would get, rather than a
// misleading one from an un-stripped \r silently riding along inside the
// hash or filename field.
function splitLines(text) {
  return text
    .split("\n")
    .filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""))
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

// validateManifest(manifestText, releasedFiles, fileHashes) -> { ok, errors }
//
//   releasedFiles — the SET of filenames that were actually released (for
//     the "no phantom line" / "no unlisted release file" checks).
//   fileHashes    — a Map<filename, sha256hex> of the REAL on-disk hash for
//     every released file (for the "hash matches the file's actual sha256"
//     / checksum-mismatch checks). A filename absent from fileHashes but
//     present in releasedFiles means "released but missing from disk" is
//     asserted by the caller, not this function (see the Scenario Outline's
//     "missing-file" row, handled by checkCoverage below).
//
// Returns a rejection with a `code` matching the Scenario Outline's <error>
// column: malformed-line | duplicate-entry | checksum-mismatch | malformed-hash | missing-file.
export function validateManifest(manifestText, releasedFiles, fileHashes) {
  const errors = [];
  const seenNames = new Set();
  const lines = splitLines(manifestText);

  for (const [index, rawLine] of lines.entries()) {
    const lineNo = index + 1;

    if (rawLine.trim() === "") {
      errors.push({ code: "malformed-line", line: lineNo, message: "blank line" });
      continue;
    }

    // The pinned shape is EXACTLY "<64-hex><TWO spaces><filename>". A
    // single-space separator, or no separator at all, is malformed-line —
    // not a mis-parsed filename.
    const twoSpaceIdx = rawLine.indexOf("  ");
    if (twoSpaceIdx === -1) {
      errors.push({ code: "malformed-line", line: lineNo, message: `no two-space separator: ${JSON.stringify(rawLine)}` });
      continue;
    }
    const hash = rawLine.slice(0, twoSpaceIdx);
    const name = rawLine.slice(twoSpaceIdx + 2);
    // A single-space separator would make `name` start with a leading
    // space if truncation left an odd count — guard explicitly rather than
    // silently trimming it away.
    if (name.startsWith(" ")) {
      errors.push({ code: "malformed-line", line: lineNo, message: `more than two spaces before filename: ${JSON.stringify(rawLine)}` });
      continue;
    }
    if (name.trim() === "") {
      errors.push({ code: "malformed-line", line: lineNo, message: "empty filename" });
      continue;
    }

    if (!HEX64_RE.test(hash)) {
      errors.push({ code: "malformed-hash", line: lineNo, message: `hash is not lowercase 64-hex: ${JSON.stringify(hash)}` });
      continue;
    }

    if (seenNames.has(name)) {
      errors.push({ code: "duplicate-entry", line: lineNo, message: `duplicate entry for ${name}` });
      continue;
    }
    seenNames.add(name);

    if (!releasedFiles.has(name)) {
      errors.push({ code: "unlisted-file", line: lineNo, message: `${name} was not released` });
      continue;
    }

    const actual = fileHashes.get(name);
    if (actual === undefined) {
      errors.push({ code: "missing-file", line: lineNo, message: `${name} is listed but missing from disk` });
      continue;
    }
    if (actual !== hash) {
      errors.push({ code: "checksum-mismatch", line: lineNo, message: `${name}: manifest hash ${hash} does not match actual ${actual}` });
    }
  }

  for (const released of releasedFiles) {
    if (!seenNames.has(released)) {
      errors.push({ code: "missing-entry", line: null, message: `${released} was released but has no SHA256SUMS line` });
    }
  }

  return { ok: errors.length === 0, errors };
}

// buildFileHashes(dir, releasedFiles) -> Map<relativeName, sha256hex> for
// every file under `dir` that IS in releasedFiles (used by callers building
// the fileHashes argument to validateManifest from a real staged directory).
export function buildFileHashes(dir, releasedFiles) {
  const map = new Map();
  for (const name of releasedFiles) {
    const full = path.join(dir, ...name.split("/"));
    try {
      map.set(name, sha256hex(full));
    } catch {
      // absent from disk — deliberately NOT set, so validateManifest's
      // missing-file check can fire.
    }
  }
  return map;
}

function step(label, fn) {
  console.log(`\n=== ${label} ===`);
  const result = fn();
  console.log(`--- done: ${label} ---`);
  return result;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && argv[i + 1]) {
      options.dir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--out" && argv[i + 1]) {
      options.out = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  if (!options.dir) {
    throw new Error("generate-sha256sums.mjs requires --dir <staged-release-assets-dir>");
  }
  if (!options.out) {
    options.out = path.join(options.dir, "SHA256SUMS");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const text = step(`generate SHA256SUMS over ${options.dir}`, () => generateManifest(options.dir, options.out));
  const lineCount = text.split("\n").filter(Boolean).length;
  console.log(`\nSHA256SUMS written: ${options.out} (${lineCount} lines)`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
