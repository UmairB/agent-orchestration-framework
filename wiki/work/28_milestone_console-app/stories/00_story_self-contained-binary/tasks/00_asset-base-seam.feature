@cli @assets @distribution @executable
Feature: ONE SEA-safe asset-base seam resolves the runtime asset base — SEA-first, dev-import.meta.url-fallback — and dev behaviour is byte-for-byte unchanged
  In order to ship the app's two directory-asset trees and its version string inside a self-contained binary WITHOUT changing how the dev/npm/test path finds them
  assetBase() in src/asset-base.mjs returns the packaged base (a sidecar dir anchored at process.execPath / a sea.getAsset lookup) inside a SEA and the current import.meta.url path in a dev run, and all 7 root-resolution sites route through it,
  so that a packaged binary reads its bundle/UI/version from the SEA base while `npm run` / `npx aof` / the test suite see NO behavioural change (the SEA branch only activates inside a packaged binary).

  # ARCHITECTURE ADR-003: exactly ONE seam (src/asset-base.mjs, the 12/ADR-001 frozen platform-aware
  # resolver shape) returns the asset base — under a SEA (detected via a `node:sea` isSea sentinel)
  # it resolves sea.getAsset / a sidecar dir anchored at import.meta.dirname (= process.execPath's dir);
  # under a dev/npm run it returns the current import.meta.url path VERBATIM. All 7 sites route through
  # it: work-bundle.mjs:26 (bundleRoot → src/bundle/**), board-serve.mjs:24 + mesh-ui-serve.mjs:48 +
  # setup-ui.mjs:17 (<repoRoot>/ui/dist), work-bundle-manifest.mjs:24 + commands/mesh-identity.mjs:67
  # (../package.json version), cli.mjs:2099 (the dev-only vite re-exec — re-homed for correctness but
  # allow-listed from the "must serve packaged assets" assertion, since a SEA never runs vite).
  #
  # The SOURCE invariant "no module joins an asset path off a bare import.meta.url outside this seam"
  # is the acd-sea-safe-asset-base ARCH-TEST (fitness #1) — NOT a scenario here. This feature asserts
  # the OBSERVABLE resolution: the seam picks the right base per environment, and the dev path is
  # byte-identical. The seam is exercised IN-PROCESS by toggling the SEA sentinel — no real SEA build
  # is needed (the real-SEA read rides the @manual build-smoke, 01_sea-build-recipe).
  #
  # DEVELOPER-SEAT (feasibility): the "am I in a SEA" detection must be a single injectable seam so the
  # SEA branch is reachable in-process without a built binary (mirror how terminal-ws injects its spawn).
  # Confirm node:sea's isSea()/getAsset are import-safe under a plain `node` run (dev) — they must not
  # throw when NOT in a SEA. Flag if the sentinel needs to be an env/DI shim rather than a raw require.
  Background:
    Given a workspace with src/bundle/** and a package.json present on disk
    And src/asset-base.mjs exposes assetBase() with an injectable "in a SEA?" sentinel

  # Dev path unchanged — the load-bearing invariant. With the SEA sentinel OFF (a plain node run),
  # assetBase() resolves to EXACTLY the current import.meta.url-derived path, so every consumer reads
  # the same bytes it does today. R4: pin the UNAFFECTED side — the resolved dev base is byte-identical
  # to the pre-seam resolution (not merely "a valid path").
  Scenario: in a dev run the seam returns the current import.meta.url path verbatim (dev behaviour byte-for-byte)
    Given the "in a SEA?" sentinel reports NOT in a SEA
    When a consumer resolves the bundle base through assetBase()
    Then the resolved base equals the pre-seam import.meta.url-derived bundle root exactly
    And reading src/bundle/bundle.json through the seam returns the same bytes as reading it directly
    And no SEA API (sea.getAsset / getAssetKeys) is called on the dev path

  # Packaged path — with the SEA sentinel ON, assetBase() resolves to the packaged base (the sidecar
  # dir anchored at process.execPath's dir, or a getAsset lookup), NOT a src/ path. Exercised in-process
  # by pointing the sidecar anchor at a temp dir laid out like a packaged install — no real SEA build.
  #
  # QA: extended the asset-class matrix beyond the three top-level classes to cover the DEEP MEMBER files
  # inside the trees — the readdirSync/readFileSync per-file walker (work-bundle.mjs:76,101,131) that
  # ADR-003 says resolves per-file THROUGH the seam (a distinct code path from reading bundle.json at the
  # root), plus a nested ui/dist member (the static serve reaches ui/dist/assets/*), so the packaged read
  # is exercised for a nested path join / key lookup, not only a root-level file.
  Scenario Outline: with the SEA sentinel on, the seam resolves the packaged base for each asset class
    Given the "in a SEA?" sentinel reports IN a SEA
    And a packaged layout under a temp exec dir contains <asset>
    When a consumer resolves <asset-class> through assetBase()
    Then the resolved path is under the packaged exec dir, not a src/ path
    And reading <asset> through the seam returns its packaged bytes

    Examples: the runtime asset classes + the nested-member walker paths
      | asset-class      | asset                          |
      | bundle-root      | bundle/bundle.json             |
      | bundle-member    | bundle/commands/next.md        |
      | bundle-manifest  | bundle/manifest.json           |
      | ui-dist-index    | ui/dist/index.html             |
      | ui-dist-nested   | ui/dist/assets/index.js        |
      | version          | package.json (the version str) |

  # QA: added the getAssetKeys ENUMERATION path — ADR-003 says work-bundle.mjs's directory walk becomes
  # getAssetKeys under a SEA (readdir in dev). The seam must expose "list the members under a base" so the
  # bundle walker enumerates the packaged tree, not just read one known key. This pins the walker's LIST
  # step (distinct from the per-file READ rows above), the case RESEARCH §1 flags as "not a single line".
  # QA FEASIBILITY FLAG (developer-amigo): does the seam's enumeration return the SAME member set whether
  # the class is embedded (getAssetKeys) or a sidecar dir (readdir)? ADR-003 lets the build recipe choose
  # per asset class — confirm the walker sees one uniform member list regardless of the carrier, or the
  # bundle synthesis diverges between an embedded and a sidecar'd bundle.
  Scenario: under a SEA the seam enumerates the packaged bundle members (the walker's directory-list step)
    Given the "in a SEA?" sentinel reports IN a SEA
    And a packaged bundle layout under a temp exec dir with a known set of member files
    When the bundle walker enumerates its members through the seam
    Then it lists exactly the packaged member set (via getAssetKeys / a sidecar readdir), not a src/ listing
    And each listed member reads its packaged bytes through the seam

  # QA: added the ABSENT-asset boundary — a packaged install whose asset is missing must surface a clear,
  # locatable failure, NOT silently fall back to a src/ path that does not exist inside the binary. This is
  # the error-class boundary of the SEA branch (the dev branch has src/ on disk; the SEA branch does not).
  # QA FEASIBILITY FLAG (developer-amigo): does the seam distinguish "getAsset key absent" from "sidecar
  # file ENOENT"? Confirm both missing-modes surface the same locatable error (naming the asset key/path),
  # so a corrupt install is diagnosable regardless of which mechanism carries that class.
  Scenario: under a SEA a missing packaged asset fails with a locatable error, not a silent src/ fallback
    Given the "in a SEA?" sentinel reports IN a SEA
    And the packaged layout is missing the requested asset (neither an embedded key nor a sidecar file)
    When a consumer resolves that asset through assetBase()
    Then it fails with an error naming the missing asset key or path
    And it does NOT fall back to a bare import.meta.url / src-tree path (which does not exist in a binary)

  # All 7 sites go THROUGH the seam — asserted behaviourally: each consumer's read is driven by the
  # seam's returned base, so flipping the sentinel flips where all of them read from in lock-step (the
  # structural "no bare import.meta.url join" is fitness #1, the arch-test).
  Scenario: flipping the sentinel re-homes every consumer's read base in lock-step (one seam, seven sites)
    Given the seam is the sole base resolver for bundleRoot, the three ui/dist resolvers, and the two version reads
    When the "in a SEA?" sentinel flips from off to on
    Then every one of those consumers resolves against the packaged base instead of the src/ base
    And none of them constructs its own base off a bare import.meta.url (that is enforced by acd-sea-safe-asset-base)
