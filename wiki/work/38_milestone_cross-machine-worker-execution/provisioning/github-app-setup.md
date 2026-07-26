---
doc: provisioning
milestone: 38
title: "GitHub App provisioning — the github-app clone-credential path"
status: in-progress
created: 2026-07-16
updated: 2026-07-16
---
<!--
  A provisioning runbook, NOT a verification record. It exists to get a real external
  resource (a GitHub App) into a state the milestone's deferred soaks (story-01 task 04,
  story-02 task 05) can be run against. Once the soaks actually run, their evidence and
  verdict belong in VERIFICATION.md, not here — this doc only tracks the setup trail.

  Real identifiers (App ID, Client ID, node hostnames, tailnet addresses, org/repo
  names, local file paths) are deliberately NOT recorded in this file — this repo is
  public. They're tracked privately by the operator; this doc keeps the reasoning and
  process, not the specifics.
-->
# GitHub App provisioning — setup runbook

Context: the operator chose to run the milestone's two deferred human soaks now —
**story-01 `tasks/04_private-clone-soak.feature`** and **story-02 `tasks/05_real-app-mint-soak.feature`**
— via the **`github-app`** credential path (over the simpler `env-token` PAT), so the soak exercises
story-02's actual code-enforced closure of SECURITY T4, not just the operator-attested one.

## Target infrastructure (confirmed)

- **Second worker node:** a real second machine, enrolled in the mesh and online over the tailnet, with
  a fresh presence heartbeat — the real second machine the soak needs.
- **Control node:** this machine, with `gh` CLI authenticated.
- **Target repo:** a real private repo, confirmed to exist under the account that owns the target org
  (which holds admin/owner role there). Chosen as the milestone-38 aof/ACD test-ground repo: low-risk,
  private, and not already checked out on the second worker node (the fresh-worker precondition task 04
  requires).
- No SSH access from the control node to the second worker node (key rejected) — on-machine spot-checks
  (`.git/config`, process env, keychain) will need either the operator running them there, or SSH access
  granted to this session.

## App design (operator-approved; created via the GitHub UI — there is no REST "create app" endpoint,
so this step is unavoidably a human browser action)

Create at the target org's `settings/apps/new` page:

- **Name:** operator's choice, globally unique
- **Description:** "Mints short-lived, read-only, single-repo tokens so an aof mesh worker can clone
  this repo when assigned work. Never a standing credential. aof milestone 38 (cross-machine worker
  execution)."
- **Homepage URL:** the target repo's URL (unused, just needs a value)
- **Webhook:** disabled — not needed
- **Identifying and authorizing users (Callback URL / "Expire user authorization tokens" /
  "Request user authorization (OAuth) during installation" / "Enable Device Flow"):** all left
  blank/unchecked — this App only ever authenticates App-to-server (JWT signed by the private key →
  installation access token exchange, `mesh-clone-credential-provider.mjs`'s `defaultSignAppJwt`); it
  never runs a user-to-server OAuth flow, so none of the user-authorization settings apply.
- **Repository permissions → Contents:** Read-only — every other permission left at "No access"
- **Where can this GitHub App be installed?:** "Only on this account"
- **Install on:** the one target repo only, not org-wide

After creation: generate a private key (downloads a `.pem`), note the **App ID**, install it on the one
repo, optionally note the **installation ID** from the post-install URL (the code auto-resolves this if
left blank).

## Governance Q&A (operator's own due-diligence before creating the App)

Recorded here as the reasoning trail behind the SECURITY.md operator attestation (checklist item 1: "the
App is installed least-privilege... key stored appropriately") — this is provisioning reasoning, not a
restatement of SECURITY.md's controls, which live there.

- **Who can call it (act as the App):** only whoever holds the App's RS256 private key can sign a JWT
  and authenticate as it. Per `mesh-clone-credential-provider.mjs`, that key will live only on the
  control node's filesystem and is fitness-pinned (`acd-clone-app-key-not-relayed`, F5) to never cross a
  log, a relayed frame, or an error message — no worker, and nobody else on the mesh, ever sees it.
- **Blast radius even if the key leaked:** bounded three independent ways — the App's own installation
  (one repo only), the App's own permission (`contents:read` only), and the per-mint token's
  code-enforced single-repo/`contents:read` narrowing (`acd-minted-token-scoped-single-repo`, F6/T9) —
  plus GitHub's fixed ~1h token TTL (T11, R8). Worst case: read-only access to one private repo, for up
  to an hour, until noticed.
- **Who can generate/delete its private key:** the target org's owners (confirmed: the operator's
  account holds `admin` role there), plus anyone explicitly granted the App-scoped "GitHub App manager"
  role — nobody else, regardless of their repo access.
- **Revocation levers, all effective immediately:** uninstall the App from the repo; suspend it
  (temporary pause); delete the compromised private key from the App's key list (generating a new key
  does NOT auto-invalidate old ones — an old key must be explicitly deleted to revoke it); delete the
  App entirely.
- **Conclusion (operator):** "so it can be locked down to individuals" — confirmed: App management, key
  generation, and installation are all gated on the App's own admin list, independent of ordinary repo
  collaborator permissions.

## Status

**App created `2026-07-16`.** Installed on the one target repo only. App ID and Client ID recorded
privately (not in this public repo). Private key relocated by the operator to a non-synced location
under the global mesh home (moved out of its original cloud-synced download location — see the incident
note below). Wired into the **GLOBAL** `aof.config.json` (`mesh.repo.credential.provider = "github-app"`
+ `mesh.repo.credential.githubApp.appId` + `.privateKeyPath` pointing at the relocated key) — GLOBAL,
not the `aof` repo's own local config, per the operator's direction ("assume singular apps, but allow
for overrides"): `loadWorkspace` merges the global `mesh` config as the base for every project on this
machine, with each project's own local config able to override it — the correct home for a fleet-wide
singular default. See `stories/03_story_per-org-credential-scoping/STORY.md` for how this composes with
the not-yet-built per-workspace override. (GitHub also offers a Client ID as an alternative to the App
ID for minting — not used; the existing signer/mint code is built around `appId` as a generic JWT `iss`
value and either works, so the numeric App ID was kept to avoid any doubt.)

**Note — a private-key exposure incident during this session, and how it was closed:** an early attempt
to verify the just-added `.claude/settings.json` deny rule ended up calling Read directly on the real
key file (the deny rule had not taken effect yet), so the PEM content briefly entered this conversation's
context. No content was repeated or written anywhere after that point; the deny rule was fixed to a
generic `Read(**/*.pem)`/`Read(**/*.key)` rule (no hardcoded paths); and the key was relocated out of its
cloud-synced folder as an independent hardening step. Recorded here for the audit trail, not as a live
risk — the App's own least-privilege installation (one repo, `contents:read`) bounds the exposure
regardless.

Remaining before the live soak: confirm the fresh-worker precondition on the second worker node (it must
NOT already have the target repo checked out), deploy the m38 build so the running daemon picks up this
config, then run the live soak and record its evidence/verdict in `../VERIFICATION.md`.
