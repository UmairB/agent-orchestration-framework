// Traceability wiring for milestone 28 / story 01 (signing-notarization),
// task 00_ci-build-matrix.feature + task 01_per-os-signing.feature — the
// CI-config lint rows a build agent CAN assert without a real GitHub Actions
// run (the workflow's declared legs / ordering / no-cross-compile shape from
// the checked-in YAML text). The full cross-OS matrix run itself is @uat
// (00_ci-build-matrix.feature's feature-level tag) — this is a STATIC lint
// over .github/workflows/release.yml, not a live CI execution.
//
// No YAML parser dependency is added for this (none is present in
// node_modules and this story does not introduce a new dependency for a
// lint-only concern) — these are comment-stripped, line-anchored text
// assertions over the checked-in workflow source, mirroring the
// grep-based arch-test convention used throughout test/arch/.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "release.yml");

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

// Strip // and /* */ JS comments (mirrors test/arch's stripComments
// convention) so ordering/content assertions over the release scripts are
// not fooled by an explanatory comment mentioning a term out of code order.
function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readScript(name) {
  return readFileSync(path.join(repoRoot, "scripts", "release", name), "utf8");
}

// Strip YAML `#` comments for assertions that must not be fooled by a
// commented-out example line (e.g. a matcher looking for "runs-on:" should
// not match inside an explanatory comment).
function stripYamlComments(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
}

export const releaseWorkflowLintTests = [
  {
    name: "release-workflow-lint/00 the workflow file exists and is non-empty",
    run: async () => {
      const text = readWorkflow();
      assert.ok(text.length > 0, ".github/workflows/release.yml exists and has content");
    },
  },

  // ══════ 00_ci-build-matrix.feature: "the matrix builds a self-contained artifact on each OS runner" ══════
  {
    name: "release-workflow-lint/01 the matrix declares macOS, Windows, and Linux legs (per-OS runners — SEA cannot cross-compile, ADR-001)",
    run: async () => {
      const text = stripYamlComments(readWorkflow());
      assert.ok(/runs-on:\s*\$\{\{\s*matrix\.runner\s*\}\}/.test(text) || /runs-on:\s*(macos|windows|ubuntu)/.test(text), "at least one job declares a concrete or matrix-driven runs-on");
      assert.ok(/macos-1[34]/.test(text), "a macOS runner (macos-13/14) is declared");
      assert.ok(/windows-latest/.test(text), "a Windows runner (windows-latest) is declared");
      assert.ok(/ubuntu-latest/.test(text), "a Linux x64 runner (ubuntu-latest) is declared");
    },
  },
  {
    name: "release-workflow-lint/02 each OS leg runs Story 00's build-sea.mjs recipe (the matrix instantiates the SAME recipe on every OS, never a bespoke per-OS build)",
    run: async () => {
      const text = stripYamlComments(readWorkflow());
      const buildInvocations = text.match(/node scripts\/build-sea\.mjs/g) ?? [];
      // One per OS build job (macos, windows, linux) — at least 3 invocations.
      assert.ok(buildInvocations.length >= 3, `scripts/build-sea.mjs is invoked at least once per OS leg (found ${buildInvocations.length})`);
    },
  },
  {
    name: "release-workflow-lint/03 no leg builds another OS's artifact under a mismatched runner (no cross-compile flag / QEMU emulation config)",
    run: async () => {
      const text = stripYamlComments(readWorkflow());
      assert.ok(!/qemu|cross-?compile|buildx.*platform=/i.test(text), "the workflow contains no QEMU/cross-compile/buildx multi-platform directive — each leg builds on its own matching OS runner");
    },
  },

  // ══════ 00_ci-build-matrix.feature: "the Linux runner compiles the node-pty .node from source; mac/win use the shipped prebuilts" ══════
  {
    name: "release-workflow-lint/04 the Linux leg compiles node-pty from source (npm ci, no prebuild) and stages + verifies the compiled .node",
    run: async () => {
      const text = stripYamlComments(readWorkflow());
      const linuxJobMatch = text.match(/build-linux:[\s\S]*?(?=\n {2}\S|\Z)/);
      assert.ok(linuxJobMatch, "a build-linux job is declared");
      const linuxJob = linuxJobMatch[0];
      assert.ok(/npm ci/.test(linuxJob), "the Linux job runs npm ci (which compiles node-pty from source — no linux-* prebuild is shipped)");
      assert.ok(/stage-linux-node-pty-prebuild\.mjs/.test(linuxJob), "the Linux job stages the compiled .node into the prebuilds/linux-<arch>/ shape build-sea.mjs expects");
    },
  },
  {
    name: "release-workflow-lint/05 the macOS and Windows legs do NOT attempt to compile node-pty (they consume the package's shipped prebuilds via build-sea.mjs, unchanged)",
    run: async () => {
      const text = stripYamlComments(readWorkflow());
      const macosJobMatch = text.match(/build-macos:[\s\S]*?(?=\n {2}build-windows:)/);
      const windowsJobMatch = text.match(/build-windows:[\s\S]*?(?=\n {2}build-linux:)/);
      assert.ok(macosJobMatch && windowsJobMatch, "both build-macos and build-windows jobs are declared");
      assert.ok(!/node-gyp rebuild|stage-linux-node-pty-prebuild/.test(macosJobMatch[0]), "the macOS job does not invoke a source-compile step for node-pty");
      assert.ok(!/node-gyp rebuild|stage-linux-node-pty-prebuild/.test(windowsJobMatch[0]), "the Windows job does not invoke a source-compile step for node-pty");
    },
  },

  // ══════ 00_ci-build-matrix.feature: "arm64 legs build on a native (non-container) runner" ══════
  {
    name: "release-workflow-lint/06 the Linux arm64 leg runs on a NATIVE runner (ubuntu-24.04-arm), never a Docker/QEMU container image",
    run: async () => {
      const text = stripYamlComments(readWorkflow());
      assert.ok(/ubuntu-24\.04-arm/.test(text), "a native arm64 Linux runner (ubuntu-24.04-arm) is declared for the arm64 leg");
      assert.ok(!/container:\s*\S*arm/i.test(text), "no `container:` directive scopes an arm64 image (which would be a Docker-container leg, corrupting the ELF for dlopen — RESEARCH §6)");
    },
  },
  {
    name: "release-workflow-lint/07 the macOS arm64 leg runs on a native Apple Silicon runner (macos-14), not an x64 runner cross-building arm64",
    run: async () => {
      const text = stripYamlComments(readWorkflow());
      assert.ok(/arch:\s*arm64[\s\S]{0,80}runner:\s*macos-14/.test(text) || /macos-14/.test(text), "a native arm64 macOS runner (macos-14) is declared for the arm64 leg");
    },
  },

  // ══════ 00_ci-build-matrix.feature: "every declared matrix leg emits both a binary and its matching-arch node-pty sidecar" ══════
  {
    name: "release-workflow-lint/08 every declared OS/arch leg stages BOTH a binary and its node-pty sidecar via stage-release-assets.mjs (no leg silently drops the sidecar)",
    run: async () => {
      const text = stripYamlComments(readWorkflow());
      const stageInvocations = text.match(/node scripts\/release\/stage-release-assets\.mjs[^\n]*/g) ?? [];
      assert.ok(stageInvocations.length >= 3, `stage-release-assets.mjs (which stages both the binary AND its sidecar together) is invoked per leg (found ${stageInvocations.length})`);
      for (const invocation of stageInvocations) {
        assert.ok(/--os\s+\S+/.test(invocation), `stage invocation names --os: ${invocation}`);
        assert.ok(/--arch\s+\S+/.test(invocation), `stage invocation names --arch: ${invocation}`);
      }
    },
  },
  {
    name: "release-workflow-lint/09 six OS/arch legs are declared in total, matching the pinned asset-name soft contract (macos arm64+x64, linux x64+arm64, windows x64; windows-arm64 documented as absent, not silently dropped)",
    run: async () => {
      const rawText = readWorkflow(); // keep comments — the windows-arm64 gap note must be present
      const strippedForPairing = stripYamlComments(rawText); // comment-free — so an arch/runner pairing is not broken by an interleaved comment
      // macos: 2 legs (arm64, x64); linux: 2 legs (x64, arm64); windows: 1 leg (x64) + documented arm64 gap.
      assert.ok(/arch:\s*arm64\s*\n\s*runner:\s*macos-14/.test(strippedForPairing), "macos-arm64 leg declared");
      assert.ok(/arch:\s*x64\s*\n\s*runner:\s*macos-13/.test(strippedForPairing), "macos-x64 leg declared");
      assert.ok(/arch:\s*x64\s*\n\s*runner:\s*ubuntu-latest/.test(strippedForPairing), "linux-x64 leg declared");
      assert.ok(/arch:\s*arm64\s*\n\s*runner:\s*ubuntu-24\.04-arm/.test(strippedForPairing), "linux-arm64 leg declared");
      assert.ok(/arch:\s*x64\s*\n\s*runner:\s*windows-latest/.test(strippedForPairing), "windows-x64 leg declared");
      // The windows-arm64 gap must be DOCUMENTED (not silently omitted with no trace).
      assert.ok(/windows-arm64/.test(rawText) && /no hosted windows-arm64/i.test(rawText), "the missing windows-arm64 leg is explicitly documented in the workflow, not silently absent");
    },
  },

  // ══════ 01_per-os-signing.feature: the load-bearing inject-before-codesign ordering ══════
  {
    name: "release-workflow-lint/10 the macOS job's sign step is ORDERED AFTER the build (postject-injection) step — never before",
    run: async () => {
      const text = readWorkflow();
      const macosJobMatch = text.match(/build-macos:[\s\S]*?(?=\n {2}build-windows:)/);
      assert.ok(macosJobMatch, "a build-macos job is declared");
      const job = macosJobMatch[0];
      const buildStepIdx = job.search(/Build self-contained binary[\s\S]*?includes postject injection/);
      const signStepIdx = job.search(/Sign \(codesign/);
      assert.ok(buildStepIdx !== -1, "the macOS job has a 'Build self-contained binary (includes postject injection)' step");
      assert.ok(signStepIdx !== -1, "the macOS job has a 'Sign (codesign...)' step");
      assert.ok(buildStepIdx < signStepIdx, "the build/inject step appears BEFORE the sign step in the macOS job (ADR-005 load-bearing ordering)");
    },
  },
  {
    name: "release-workflow-lint/11 the macOS sign step invokes codesign --options runtime --timestamp -> notarytool submit --wait -> stapler staple (via sign-macos.mjs)",
    run: async () => {
      // Comment-stripped: sign-macos.mjs's file-header PROSE mentions
      // "notarytool"/"staple" ahead of the codesign CALL for narrative
      // reasons — the ordering assertion must read the executable code, not
      // raw byte offsets across the whole file including comments.
      const macosScript = stripJsComments(readScript("sign-macos.mjs"));
      const codesignIdx = macosScript.indexOf('"codesign"');
      const notarytoolIdx = macosScript.indexOf("notarytool");
      const staplerIdx = macosScript.indexOf('"staple"');
      assert.ok(codesignIdx !== -1 && notarytoolIdx !== -1 && staplerIdx !== -1, "sign-macos.mjs invokes codesign, notarytool, and stapler staple");
      assert.ok(codesignIdx < notarytoolIdx, "codesign runs before notarytool submit");
      assert.ok(notarytoolIdx < staplerIdx, "notarytool submit runs before stapler staple");
      assert.ok(/--options["',\s]+["']?runtime/.test(macosScript), "codesign is invoked with the hardened runtime option (--options runtime)");
      assert.ok(/--timestamp/.test(macosScript), "codesign is invoked with --timestamp");
      assert.ok(/--wait/.test(macosScript), "notarytool submit is invoked with --wait");
    },
  },
  {
    name: "release-workflow-lint/12 the Windows sign step uses an HSM/cloud signing tool (AzureSignTool), never a file .pfx (CA/B June-2023 rule)",
    run: async () => {
      const text = readWorkflow();
      assert.ok(/sign-windows\.mjs/.test(text), "the Windows job invokes sign-windows.mjs");
      // Comment-stripped: the file explains IN PROSE why it does NOT use a
      // .pfx (the CA/B rule) — that explanatory mention must not itself trip
      // the "never references a .pfx" assertion, which is about the actual
      // signing INVOCATION, not the file's narrative.
      const windowsScript = stripJsComments(readScript("sign-windows.mjs"));
      assert.ok(/AzureSignTool/.test(windowsScript), "sign-windows.mjs shells out to AzureSignTool (an HSM/cloud signing tool)");
      // The only legitimate ".pfx" mention in executable code is the thrown
      // guidance string explaining what NOT to use — assert there is no
      // actual .pfx FILE ARGUMENT passed to a signing tool (a `-f`/`/f`-style
      // flag immediately followed by a .pfx path, the real CA/B violation).
      assert.ok(!/(-f|\/f)\s+\S*\.pfx/i.test(windowsScript), "sign-windows.mjs never passes a .pfx file as a signing credential argument");
      assert.ok(/-fd["',\s]+["']?sha256/i.test(windowsScript), "signing specifies /fd SHA256 (the digest algorithm)");
      assert.ok(/-tr["',\s]/i.test(windowsScript), "signing specifies a timestamp URL (-tr, RFC-3161)");
      assert.ok(/-td["',\s]+["']?sha256/i.test(windowsScript), "signing specifies /td SHA256 (the timestamp digest algorithm)");
    },
  },
  {
    name: "release-workflow-lint/13 the Linux leg's GPG signature is over the checksum manifest (SHA256SUMS), a detached armored signature",
    run: async () => {
      const text = readWorkflow();
      assert.ok(/gpg-sign-manifest\.mjs/.test(text), "the checksum-and-sign-manifest job invokes gpg-sign-manifest.mjs");
      const gpgScript = readFileSync(path.join(repoRoot, "scripts", "release", "gpg-sign-manifest.mjs"), "utf8");
      assert.ok(/--detach-sign/.test(gpgScript), "gpg-sign-manifest.mjs uses --detach-sign");
      assert.ok(/--armor/.test(gpgScript), "gpg-sign-manifest.mjs uses --armor (ASCII-armored .asc output)");
    },
  },
  {
    name: "release-workflow-lint/14 signing secrets are referenced by NAME only (GitHub Actions ${{ secrets.* }}) — no secret material is embedded in the workflow or scripts",
    run: async () => {
      const text = readWorkflow();
      const secretRefs = text.match(/\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}/g) ?? [];
      assert.ok(secretRefs.length >= 5, `at least the Windows (cloud signing) + macOS (Developer ID/notary) + Linux (GPG) secrets are referenced by name (found ${secretRefs.length})`);
      // No secret literal shape (a long base64/hex blob assigned directly) in the workflow text.
      assert.ok(!/AOF_[A-Z_]+\s*:\s*["'][A-Za-z0-9+/=]{40,}["']/.test(text), "no secret-shaped literal value is hardcoded in the workflow");
      for (const scriptFile of ["sign-windows.mjs", "sign-macos.mjs", "gpg-sign-manifest.mjs"]) {
        const scriptText = readFileSync(path.join(repoRoot, "scripts", "release", scriptFile), "utf8");
        assert.ok(!/-----BEGIN/.test(scriptText), `${scriptFile} contains no embedded key/cert material`);
      }
    },
  },

  // ══════ 02_checksum-manifest.feature: the manifest generation step ══════
  {
    name: "release-workflow-lint/15 the checksum-manifest job runs AFTER all three OS build jobs (needs: build-macos, build-windows, build-linux) and generates + GPG-signs SHA256SUMS",
    run: async () => {
      const text = readWorkflow();
      const manifestJobMatch = text.match(/checksum-and-sign-manifest:[\s\S]*?(?=\n {2}publish:)/);
      assert.ok(manifestJobMatch, "a checksum-and-sign-manifest job is declared");
      const job = manifestJobMatch[0];
      assert.ok(/needs:\s*\[build-macos,\s*build-windows,\s*build-linux\]/.test(job), "the manifest job depends on all three OS build jobs completing first");
      assert.ok(/generate-sha256sums\.mjs/.test(job), "the manifest job runs generate-sha256sums.mjs");
      assert.ok(/gpg-sign-manifest\.mjs/.test(job), "the manifest job runs gpg-sign-manifest.mjs");
      const generateIdx = job.indexOf("generate-sha256sums.mjs");
      const signIdx = job.indexOf("gpg-sign-manifest.mjs");
      assert.ok(generateIdx < signIdx, "the manifest is generated BEFORE it is GPG-signed");
    },
  },

  // ══════ Craft-review F3 (HIGH): install.sh's pinned GPG fingerprint is asserted against the CI signing key ══════
  {
    name: "release-workflow-lint/16 (craft F3) the manifest job asserts install.sh's pinned fingerprint against the CI signing key, AFTER key import and BEFORE the manifest is GPG-signed/published",
    run: async () => {
      const text = readWorkflow();
      const manifestJobMatch = text.match(/checksum-and-sign-manifest:[\s\S]*?(?=\n {2}publish:)/);
      assert.ok(manifestJobMatch, "a checksum-and-sign-manifest job is declared");
      const job = manifestJobMatch[0];

      assert.ok(/assert-fingerprint-pin\.mjs/.test(job), "the manifest job runs assert-fingerprint-pin.mjs");

      const importIdx = job.indexOf("Import the release GPG private key");
      const assertIdx = job.indexOf("assert-fingerprint-pin.mjs");
      const signIdx = job.indexOf("gpg-sign-manifest.mjs");
      assert.ok(importIdx !== -1 && assertIdx !== -1 && signIdx !== -1, "all three steps (import, fingerprint-assert, gpg-sign) are present");
      assert.ok(importIdx < assertIdx, "the fingerprint assert runs AFTER the CI signing key is imported (it needs the key already in the homedir)");
      assert.ok(assertIdx < signIdx, "the fingerprint assert runs BEFORE the manifest is GPG-signed (fail fast, before doing the signing work)");

      // The publish job only runs after `needs: [checksum-and-sign-manifest]`
      // completes successfully — so a thrown/non-zero assert-fingerprint-pin.mjs
      // step here structurally blocks publish, satisfying "before publishing".
      const publishJobMatch = text.match(/publish:[\s\S]*/);
      assert.ok(publishJobMatch, "a publish job is declared");
      assert.ok(/needs:\s*\[checksum-and-sign-manifest\]/.test(publishJobMatch[0]), "publish depends on checksum-and-sign-manifest completing (a failed fingerprint assert blocks publish)");
    },
  },
  {
    name: "release-workflow-lint/17 (craft F3) assert-fingerprint-pin.mjs pins against install.sh's ACTUAL runtime trust-gate variable, not just an embedded key's own fingerprint",
    run: async () => {
      const script = stripJsComments(readScript("assert-fingerprint-pin.mjs"));
      assert.ok(/AOF_RELEASE_GPG_FINGERPRINT/.test(script), "the script reads the AOF_RELEASE_GPG_FINGERPRINT variable install.sh's aof_verify_gpg_signature actually compares against");
      assert.ok(/--list-secret-keys/.test(script), "the script derives the CI-imported key's fingerprint from the real gpg keyring (not a hard-coded value)");
      assert.ok(/FINGERPRINT MISMATCH/.test(script), "a CI-key/install.sh mismatch is reported with a clear, distinct error");
      assert.ok(/SELF-INCONSISTENT/.test(script), "an install.sh whose embedded key and trust-gate variable disagree with EACH OTHER is reported as a distinct, clearly-labelled failure");
    },
  },

  // ══════ Craft-review F13(a): the workflow_dispatch `version` input is consumed, not dead ══════
  {
    name: "release-workflow-lint/18 (craft F13a) the workflow_dispatch `version` input is wired into checkout's ref (not a declared-but-unused input)",
    run: async () => {
      const text = readWorkflow();
      assert.ok(/workflow_dispatch:/.test(text), "workflow_dispatch trigger is declared");
      assert.ok(/version:/.test(text), "a version input is declared under workflow_dispatch.inputs");

      const refUses = text.match(/ref:\s*\$\{\{\s*github\.event\.inputs\.version\s*\|\|\s*github\.ref\s*\}\}/g) ?? [];
      assert.ok(refUses.length > 0, "at least one checkout step consumes github.event.inputs.version via ref: (falling back to github.ref on the push:tags trigger)");

      // Every checkout step in the workflow wires the SAME ref (no leg left
      // silently checking out the default branch on a manual dispatch).
      const checkoutSteps = text.match(/uses: actions\/checkout@v4/g) ?? [];
      assert.equal(refUses.length, checkoutSteps.length, `every actions/checkout@v4 step (${checkoutSteps.length}) wires the same version-aware ref (found ${refUses.length})`);
    },
  },

  // ══════ Craft-review F13(b): the macOS notary key secret is passed via env:, never interpolated into shell source ══════
  {
    name: "release-workflow-lint/19 (craft F13b) the macOS notary key secret is passed via env: and written with printf, never interpolated directly into the shell script source",
    run: async () => {
      const text = readWorkflow();
      const macosJobMatch = text.match(/build-macos:[\s\S]*?(?=\n {2}build-windows:)/);
      assert.ok(macosJobMatch, "a build-macos job is declared");
      const job = macosJobMatch[0];

      assert.ok(/AOF_MACOS_NOTARY_KEY_P8:\s*\$\{\{\s*secrets\.AOF_MACOS_NOTARY_KEY_P8\s*\}\}/.test(job), "the notary key secret is declared under env: (not inlined into run:)");
      assert.ok(!/echo\s+"\$\{\{\s*secrets\.AOF_MACOS_NOTARY_KEY_P8\s*\}\}"/.test(job), "the notary key secret is NOT textually interpolated into the shell script source via echo \"${{ secrets.* }}\"");
      assert.ok(/printf\s+'%s'\s+"\$AOF_MACOS_NOTARY_KEY_P8"\s*>/.test(job), "the notary key is written to disk via printf '%s' \"$VAR\" > file (an env-var read, not a source-substituted literal)");

      // The runner.temp key-path fix (a prior architect NIT) must remain intact.
      assert.ok(/AOF_MACOS_NOTARY_KEY_PATH:\s*\$\{\{\s*runner\.temp\s*\}\}\/notary-key\.p8/.test(job), "the notary key path stays under runner.temp (not reverted)");
    },
  },

  // ══════ Craft-review F13(c): sign-windows.mjs documents the deliberate process-argument secret choice ══════
  {
    name: "release-workflow-lint/20 (craft F13c) sign-windows.mjs documents WHY the client secret is passed as a process argument (a deliberate, ephemeral-runner-scoped choice, not an oversight)",
    run: async () => {
      const script = readScript("sign-windows.mjs"); // keep comments — the documented-choice note itself must be present
      assert.ok(/DELIBERATE CHOICE/.test(script), "the -kvs process-argument choice is explicitly documented as deliberate");
      assert.ok(/ephemeral/i.test(script), "the rationale cites the ephemeral/single-job nature of GitHub-hosted runners");
      assert.ok(/-kvs/.test(script), "the note is anchored to the actual -kvs flag");
    },
  },
];
