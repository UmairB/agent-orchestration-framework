// Traceability wiring for milestone 28 / story 01 (signing-notarization),
// task 02_checksum-manifest.feature — the @executable heart of this story.
//
// Covers EVERY @executable scenario by driving the REAL generator
// (scripts/release/generate-sha256sums.mjs) over fixture files on disk — no
// signing keys, no network.
//
//   02_checksum-manifest.feature
//     - "SHA256SUMS lists every released artifact exactly once and nothing
//       that was not released" (coverage set-equality both directions)
//     - "each manifest line is the `<sha256>  <filename>` shape the installer
//       verifies against" (LF pin, lowercase 64-hex, two-space separator)
//     - "a structurally malformed manifest is rejected, not accepted
//       vacuously" (Scenario Outline, 6 corruption classes)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  generateManifestText,
  generateManifest,
  validateManifest,
  buildFileHashes,
} from "../scripts/release/generate-sha256sums.mjs";

function sha256hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function makeStagedFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aof-sha256sums-"));
  const files = {
    "aof-linux-x64": "fixture binary bytes for linux-x64\n",
    "aof-macos-arm64": "fixture binary bytes for macos-arm64\n",
    "aof-windows-x64.exe": "fixture binary bytes for windows-x64\n",
    "node-pty-linux-x64": "fixture sidecar bytes for linux-x64\n",
    "node-pty-darwin-arm64": "fixture sidecar bytes for darwin-arm64\n",
    "node-pty-win32-x64": "fixture sidecar bytes for win32-x64\n",
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content, "utf8");
  }
  return { dir, files };
}

export const releaseChecksumManifestTests = [
  // ══════ Scenario: SHA256SUMS lists every released artifact exactly once and nothing that was not released ══════
  {
    name: "release-checksum-manifest/00 the manifest covers every released binary AND every released sidecar exactly once, nothing phantom",
    run: async () => {
      const { dir, files } = makeStagedFixture();
      try {
        const text = generateManifestText(dir);
        const lines = text.split("\n").filter(Boolean);
        assert.equal(lines.length, Object.keys(files).length, "one line per released file (binaries + sidecars)");

        const namesInManifest = new Set(lines.map((l) => l.slice(l.indexOf("  ") + 2)));
        for (const name of Object.keys(files)) {
          assert.ok(namesInManifest.has(name), `manifest lists released file ${name}`);
        }
        // Sidecar coverage specifically (QA-added assertion): every sidecar
        // name is present, not just binaries.
        assert.ok(namesInManifest.has("node-pty-linux-x64"), "a released sidecar has a manifest line");
        assert.ok(namesInManifest.has("node-pty-darwin-arm64"), "a released sidecar has a manifest line");
        assert.ok(namesInManifest.has("node-pty-win32-x64"), "a released sidecar has a manifest line");

        // No phantom line naming a file that was not released.
        for (const name of namesInManifest) {
          assert.ok(Object.prototype.hasOwnProperty.call(files, name), `manifest line ${name} corresponds to an actually-released file`);
        }

        // Each line's hash matches the file's actual sha256.
        for (const line of lines) {
          const sepIdx = line.indexOf("  ");
          const hash = line.slice(0, sepIdx);
          const name = line.slice(sepIdx + 2);
          const actual = sha256hex(readFileSync(path.join(dir, name)));
          assert.equal(hash, actual, `manifest hash for ${name} matches the file's real sha256`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  {
    name: "release-checksum-manifest/01 (self-check) a released file with no manifest entry is caught by set-equality (never silently omitted)",
    run: async () => {
      const { dir, files } = makeStagedFixture();
      try {
        const staleText = generateManifestText(dir);
        // Plant a NEW released file AFTER generating the manifest — the
        // manifest must not silently "cover" it.
        writeFileSync(path.join(dir, "aof-linux-arm64"), "planted after generation\n", "utf8");

        const releasedNow = new Set([...Object.keys(files), "aof-linux-arm64"]);
        const hashes = buildFileHashes(dir, releasedNow);
        const result = validateManifest(staleText, releasedNow, hashes);

        assert.equal(result.ok, false, "a released file missing from the (stale) manifest fails validation");
        assert.ok(result.errors.some((e) => e.code === "missing-entry" && e.message.includes("aof-linux-arm64")), "the specific missing entry is named");

        // Converse: regenerating covers it.
        const freshText = generateManifestText(dir);
        const freshResult = validateManifest(freshText, releasedNow, hashes);
        assert.equal(freshResult.ok, true, "a freshly regenerated manifest covers the newly-released file");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ Scenario: each manifest line is the `<sha256>  <filename>` shape ══════
  {
    name: "release-checksum-manifest/02 each line is lowercase 64-hex, two spaces, filename — LF line endings, sha256sum -c compatible",
    run: async () => {
      const { dir } = makeStagedFixture();
      try {
        const text = generateManifestText(dir);

        assert.ok(!text.includes("\r"), "the manifest text contains NO carriage returns (LF only, regardless of host OS)");
        assert.ok(text.endsWith("\n"), "the manifest is LF-terminated");

        const lines = text.split("\n").filter(Boolean);
        assert.ok(lines.length > 0, "at least one line was generated");
        for (const line of lines) {
          const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
          assert.ok(match, `line matches <64-lowercase-hex><TWO spaces><filename>: ${JSON.stringify(line)}`);
          assert.equal(match[1], match[1].toLowerCase(), "hash is lowercase");
          assert.equal(match[1].length, 64, "hash is exactly 64 hex characters");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  {
    name: "release-checksum-manifest/03 generateManifest writes SHA256SUMS to disk with LF-only bytes (the actual file the CI runner would emit)",
    run: async () => {
      const { dir } = makeStagedFixture();
      try {
        const outPath = path.join(dir, "SHA256SUMS");
        const text = generateManifest(dir, outPath);
        const rawBytes = readFileSync(outPath);
        assert.ok(!rawBytes.includes(0x0d), "the written SHA256SUMS file contains no CR byte (0x0d) anywhere — pinned LF regardless of process.platform");
        assert.equal(readFileSync(outPath, "utf8"), text, "the file on disk matches the returned text exactly");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ Scenario Outline: a structurally malformed manifest is rejected, not accepted vacuously ══════
  {
    name: "release-checksum-manifest/04 malformed-manifest rejection matrix (6 corruption classes)",
    run: async () => {
      const { dir, files } = makeStagedFixture();
      try {
        const releasedFiles = new Set(Object.keys(files));
        const hashes = buildFileHashes(dir, releasedFiles);
        const validHashes = {};
        for (const [name, hash] of hashes) validHashes[name] = hash;
        const validLine = (name) => `${validHashes[name]}  ${name}`;

        // Row 1: truncated (a line cut off mid-hash).
        {
          const truncated = validHashes["aof-linux-x64"].slice(0, 20); // cut mid-hash
          const text = `${truncated}  aof-linux-x64\n` + [...releasedFiles].filter((n) => n !== "aof-linux-x64").map(validLine).join("\n") + "\n";
          const result = validateManifest(text, releasedFiles, hashes);
          assert.equal(result.ok, false, "truncated: rejected");
          assert.ok(result.errors.some((e) => e.code === "malformed-hash"), "truncated: reported as malformed-hash (not exactly 64 hex chars)");
        }

        // Row 2: a duplicate line for the same filename.
        {
          const text = [...releasedFiles].map(validLine).join("\n") + "\n" + validLine("aof-linux-x64") + "\n";
          const result = validateManifest(text, releasedFiles, hashes);
          assert.equal(result.ok, false, "duplicate line: rejected");
          assert.ok(result.errors.some((e) => e.code === "duplicate-entry"), "duplicate line: reported as duplicate-entry");
        }

        // Row 3: a line pairing file A's hash with file B's name (a swap a naive parser accepts).
        {
          const swappedLine = `${validHashes["aof-linux-x64"]}  aof-macos-arm64`;
          const text = [...releasedFiles]
            .filter((n) => n !== "aof-macos-arm64")
            .map(validLine)
            .concat([swappedLine])
            .join("\n") + "\n";
          const result = validateManifest(text, releasedFiles, hashes);
          assert.equal(result.ok, false, "hash/name swap: rejected");
          assert.ok(result.errors.some((e) => e.code === "checksum-mismatch" && e.message.includes("aof-macos-arm64")), "hash/name swap: reported as checksum-mismatch on the mis-paired file (B)");
        }

        // Row 4: a hash that is uppercase or not exactly 64 hex chars.
        {
          const upper = validHashes["aof-linux-x64"].toUpperCase();
          const text = `${upper}  aof-linux-x64\n` + [...releasedFiles].filter((n) => n !== "aof-linux-x64").map(validLine).join("\n") + "\n";
          const result = validateManifest(text, releasedFiles, hashes);
          assert.equal(result.ok, false, "uppercase hash: rejected");
          assert.ok(result.errors.some((e) => e.code === "malformed-hash"), "uppercase hash: reported as malformed-hash");
        }

        // Row 5: a blank line or a line with a single-space separator.
        {
          const singleSpace = `${validHashes["aof-linux-x64"]} aof-linux-x64`;
          const text = `${singleSpace}\n` + [...releasedFiles].filter((n) => n !== "aof-linux-x64").map(validLine).join("\n") + "\n";
          const result = validateManifest(text, releasedFiles, hashes);
          assert.equal(result.ok, false, "single-space separator: rejected");
          assert.ok(result.errors.some((e) => e.code === "malformed-line"), "single-space separator: reported as malformed-line");

          const blankLineText = [...releasedFiles].map(validLine).join("\n") + "\n\n";
          const blankResult = validateManifest(blankLineText, releasedFiles, hashes);
          assert.equal(blankResult.ok, false, "blank line: rejected");
          assert.ok(blankResult.errors.some((e) => e.code === "malformed-line"), "blank line: reported as malformed-line");
        }

        // Row 6: a line naming a released file that is missing from disk.
        {
          const missingFileHashes = new Map(hashes);
          missingFileHashes.delete("aof-linux-x64"); // simulate: released but absent from disk
          const text = [...releasedFiles].map(validLine).join("\n") + "\n";
          const result = validateManifest(text, releasedFiles, missingFileHashes);
          assert.equal(result.ok, false, "missing-from-disk file: rejected");
          assert.ok(result.errors.some((e) => e.code === "missing-file" && e.message.includes("aof-linux-x64")), "missing-from-disk file: reported as missing-file");
        }

        // No file is treated as verified on the strength of a malformed line —
        // confirm a fully valid manifest (control case) DOES pass, so the
        // rejections above are not just "always false".
        {
          const validText = [...releasedFiles].map(validLine).join("\n") + "\n";
          const controlResult = validateManifest(validText, releasedFiles, hashes);
          assert.equal(controlResult.ok, true, "control case: a fully well-formed manifest over the real fixture files validates cleanly");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  {
    name: "release-checksum-manifest/05 an unlisted-in-manifest file that WAS released is still flagged (missing-entry, not silently accepted as covered)",
    run: async () => {
      const { dir, files } = makeStagedFixture();
      try {
        const releasedFiles = new Set(Object.keys(files));
        const hashes = buildFileHashes(dir, releasedFiles);
        const validLine = (name) => `${hashes.get(name)}  ${name}`;
        // Omit one released file's line entirely.
        const text = [...releasedFiles]
          .filter((n) => n !== "node-pty-win32-x64")
          .map(validLine)
          .join("\n") + "\n";
        const result = validateManifest(text, releasedFiles, hashes);
        assert.equal(result.ok, false, "a released file with NO line at all fails validation");
        assert.ok(result.errors.some((e) => e.code === "missing-entry" && e.message.includes("node-pty-win32-x64")), "the omitted sidecar is named in the error");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ Craft-review F9: validateManifest's parser defensively strips a CRLF \r before parsing ══════
  // (the WRITER — generateManifestText/generateManifest — stays LF-pure; this
  // only concerns READING an already-CRLF-mangled manifest, e.g. a corrupted
  // download or a crafted fixture.)
  {
    name: "release-checksum-manifest/06 (craft F9) a CRLF-mangled but otherwise well-formed manifest validates cleanly — the \\r is stripped, not left riding along in the hash/filename",
    run: async () => {
      const { dir, files } = makeStagedFixture();
      try {
        const releasedFiles = new Set(Object.keys(files));
        const hashes = buildFileHashes(dir, releasedFiles);
        const validLine = (name) => `${hashes.get(name)}  ${name}`;
        // Build an otherwise-correct manifest, then mangle every line ending
        // to CRLF (as a Windows-touched transport/editor might).
        const lfText = [...releasedFiles].map(validLine).join("\n") + "\n";
        const crlfText = lfText.split("\n").join("\r\n");
        assert.ok(crlfText.includes("\r"), "sanity: the fixture text actually contains CR bytes");

        const result = validateManifest(crlfText, releasedFiles, hashes);
        assert.equal(
          result.ok,
          true,
          `a CRLF-mangled but otherwise well-formed manifest validates cleanly once \\r is stripped (errors: ${JSON.stringify(result.errors)})`
        );

        // Converse / non-vacuous check: an ACTUALLY malformed hash (not just
        // a CRLF artifact) is still correctly rejected as malformed-hash —
        // proving the strip doesn't mask real corruption.
        const brokenHash = `${hashes.get("aof-linux-x64").slice(0, 63)}Z`; // 64 chars, non-hex last char
        const stillBrokenText = ([...releasedFiles].map((n) => (n === "aof-linux-x64" ? `${brokenHash}  ${n}` : validLine(n))).join("\n") + "\n").split("\n").join("\r\n");
        const brokenResult = validateManifest(stillBrokenText, releasedFiles, hashes);
        assert.equal(brokenResult.ok, false, "a genuinely malformed hash is still rejected even inside a CRLF-mangled manifest");
        assert.ok(brokenResult.errors.some((e) => e.code === "malformed-hash"), "the real corruption is reported as malformed-hash, not swallowed by the \\r strip");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];
