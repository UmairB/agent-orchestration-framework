@cli @assets @distribution @manual
Feature: The SEA + esbuild→CJS build recipe produces an unsigned self-contained binary that runs with no Node/toolchain prerequisite
  In order to deliver "install anywhere, one tool" — the whole app in one executable an end user runs without installing Node.js or a build toolchain (KR4 minus signing)
  the build recipe esbuild-bundles the ESM app to one CJS SEA main (node-pty + the asset trees externalized), generates the asset manifest, blobs and postjects it, and the resulting binary runs node mode AND relay mode AND a live PTY over its sidecar,
  so that a single artifact carries everything, the dev path is untouched, and Story 01 has a working binary to sign.

  # ARCHITECTURE ADR-001: Node SEA + an esbuild→CJS pre-bundle, targeting Node 22 LTS (ESM SEA entry is
  # Node 25.7+ only). Recipe: esbuild --bundle --platform=node --format=cjs --target=node22 of
  # bin/aof.mjs's import graph into ONE cjs file with node-pty (ADR-002) + the asset trees (ADR-003)
  # externalized → node --experimental-sea-config sea-config.json → sea-prep.blob → copy the runner's
  # own node → postject with the NODE_SEA_FUSE sentinel (--macho-segment-name NODE_SEA on macOS);
  # useCodeCache OFF. The asset-manifest generator walks src/bundle/** (37 files) + ui/dist/** into the
  # assets map (or sidecar). This is the REFERENCE-OS build; the per-OS matrix that instantiates it on
  # all three OSes + signing is Story 01. @yao-pkg/pkg is the documented fallback (ADR-001).
  #
  # @manual (agent-runnable on the reference OS): the build-recipe COMPLETENESS (the generated manifest
  # covers every asset tree file) is the acd/bundle-asset-manifest-complete BUILD-UNIT (fitness #4,
  # @executable) — NOT a scenario here. This feature is the KR4-minus-signing BUILD SMOKE: run the
  # recipe, then run the artifact. The cross-OS + signed variants are Story 01/02 @uat.
  #
  # DEVELOPER-SEAT (feasibility / build-time confirmations, RESEARCH §Decision inputs): (1) confirm a
  # real esbuild→CJS bundle of the ESM graph builds clean (import.meta.url rewrites to a bundler shim —
  # ADR-003's seam substitutes the SEA-safe base exactly there); (2) confirm postject + the fuse sentinel
  # yields a runnable binary on the reference OS; (3) node-pty + the asset trees MUST be externalized
  # (not inlined) or the bundle breaks (a .node can't inline; assets aren't a SEA primitive). Flag if the
  # reference-OS build cannot be produced locally (then this feature's evidence is a CI artifact, @uat).
  Background:
    Given the SEA build recipe (sea-config.json + the esbuild pre-bundle step + the asset-manifest generator)
    And the reference-OS toolchain used to PRODUCE the binary (not required to RUN it)

  # The headline: the recipe emits a single executable that runs with NO Node on PATH. R4: pin the
  # unaffected side — the run does not depend on a system node/npm being installed.
  Scenario: the recipe produces a single self-contained executable that runs with no Node/toolchain present
    When I run the build recipe on the reference OS
    Then it emits one executable artifact (+ the node-pty sidecar dir)
    And running the artifact prints its version with no Node.js or build toolchain on PATH
    And the artifact reads its bundle/UI/version from the packaged asset base (ADR-003), not a src/ tree

  # One binary, two modes — the SAME artifact runs node mode and relay mode (ADR-004). This is the
  # observable half of single-entry (the source invariant is fitness #2, the arch-test).
  Scenario: the one binary runs node mode (aof --version) and relay mode (aof mesh relay)
    Given the built artifact from the recipe
    When I run "aof --version" against the artifact
    Then it responds in node mode (the version string)
    When I run "aof mesh relay --json" against the SAME artifact
    Then it responds in relay mode (the non-blocking relay probe, 23/ADR-001)
    And no second binary and no forked per-mode entry was needed

  # QA: added the EXTERNALIZATION boundary — developer-seat note (3) says node-pty + the asset trees MUST
  # be externalized or the bundle breaks (a .node cannot inline; SEA assets are not a bundler primitive).
  # The recipe must FAIL LOUDLY at build time if the esbuild step tries to inline either, rather than emit
  # a binary that dies at runtime. This is the build-recipe's own error boundary, distinct from a
  # completeness set-equality (fitness #4). Stays @manual — it runs the real esbuild step and inspects the
  # bundle. QA FEASIBILITY FLAG (developer-amigo): can "did esbuild externalize node-pty + the asset trees"
  # be asserted from the bundle output (a metafile / a grep for an inlined require of the .node) so this is
  # a deterministic build check, rather than only observable as a downstream runtime crash?
  Scenario: the recipe keeps node-pty and the asset trees externalized — an inlined native addon is rejected
    When I run the esbuild pre-bundle step
    Then node-pty is marked external (not inlined into the CJS bundle — a .node cannot inline)
    And the src/bundle and ui/dist trees are externalized to the assets map / sidecar (not inlined)
    And a build that attempts to inline the native addon fails at build time, not silently at run time

  # QA: added the DISABLED-SEA-WARNING / fuse-sentinel confirmation — the postject sentinel fuse
  # (NODE_SEA_FUSE_…, --macho-segment-name NODE_SEA on macOS) must be present or the injected blob is not
  # recognized as a SEA and the binary runs as bare node. This pins the "did injection actually take" half
  # that the version-print scenario assumes. R4: pin the unaffected side — a correctly-fused binary reports
  # SEA-mode and the pre-injection `node` copy does not.
  Scenario: the postjected artifact is recognized as a SEA (the fuse sentinel took) and not bare node
    Given the SEA blob was postjected into the copied node binary with the NODE_SEA_FUSE sentinel
    When I run the artifact
    Then it reports itself running as a single-executable application (the fuse is recognized)
    And it runs the bundled app entry, not a bare node REPL

  # A live PTY over the sidecar (ADR-002) — the terminal dock works when the sidecar .node is present.
  # R4: pin the unaffected side — this exercises the sidecar load path in the built binary, distinct
  # from the injected-degrade unit (02_native-addon-sidecar, @executable).
  Scenario: a live PTY session runs over the on-disk node-pty sidecar in the built binary
    Given the built artifact with its node-pty sidecar dir beside it
    When I start a real terminal session through the built binary
    Then node-pty loads from the sidecar via a filesystem require (createRequire under the SEA)
    And the PTY session runs (input echoes, output streams)

  # NOTE (PO triage of QA finding F1): the @yao-pkg/pkg fallback is NOT a story-00 build obligation — it
  # is ADR-001's documented escape hatch (used only IF the SEA asset/addon plumbing proves too heavy). A
  # standing scenario for it would sit red-until-SEA-is-escaped (or pass vacuously), so it is deliberately
  # NOT a scenario here. Its only testable kernel — the asset-base seam + node-pty sidecar are
  # bundler-agnostic (a pkg snapshot resolves __dirname into its virtual FS, the SAME "packaged" branch) —
  # is already exercised carrier-neutrally by 00_asset-base-seam. If SEA is ever escaped, the pkg build is
  # verified then, against these same seams.
