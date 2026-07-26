# 38 · Cross-machine worker execution & session presence — Outcome

<!--
  OUTCOME.md — what this item now delivers, the assumptions that delivery rests on, and the gaps it
  declared but did not fill. Authored EXCLUSIVELY by aof:verify at Accept (ADR-004). States product
  STATE ("the system now IS X"), never motive (that reasoning lives in RETROSPECTIVE.md). An
  ADDITIONAL artifact: it carries no identity frontmatter and is never this item's record doc.
-->

## Delivered

### Assistant-session presence
A node with a live coding-assistant session reads `working · <repo> (session)` in the fleet, fed by an assistant-agnostic `aof session start|ping|end` CLI writing one record per `(node, workspace, assistant)` tuple.

- **Hooks are wired per workspace** — the record exists only where `.claude/settings.json` calls the `session` verbs; an editor that reports nothing stays `idle`.
- **Identity is derived from the hook's `cwd`** — the payload carries no aof concepts, so the workspace and repo are resolved from the directory the assistant is open on.
- **The installed binary is the one that must carry the verb** — a hook wired against an older installed build refuses with `session-arg-missing-workspace` and writes no record.

### TTL liveness (never a stuck `working`)
A session that dies without an `end` self-expires after 120 seconds (`DEFAULT_SESSION_TTL_SECONDS`) through the same `isStale` predicate presence staleness uses, leaving the node `idle` with the record still on disk.

- **Liveness is a ping cadence, not an event pair** — a session pinged less often than the TTL reads as idle even while the assistant is open.

### Cross-workspace presence aggregation
Presence is assembled over **every** workspace registered to the node in the machine-wide store (`global_node_workspaces` joined to `global_workspace_descriptors`), so a node working two repos shows both and a daemon launched from a non-repo directory still reports every repo's work.

- **Each row's work dir resolves against its own `project_root`** — an absolute descriptor path, never the reader's `process.cwd()`; a workspace whose resolved dir is absent is skipped loudly, not silently.
- **A run subsumes only its own workspace's session** — `activeRuns` carries no workspace attribution, so subsumption happens in the publisher where the attribution exists, and the wire record is already reconciled.

### Presence carried verbatim across the fabric (ingestion)
A remote node's five-key presence record survives ingestion on the control node — `applyPresenceFrame` carries `sessions` through unchanged in ADR-001 key order, with the worker as the single TTL-filtering authority.

- **The sender is the filtering authority** — the control re-derives nothing and holds no session records of its own; a dead worker's whole record is gated stale.

### Worker repo checkout on demand
A worker assigned work for a repo it does not have clones it from `config.mesh.repo.cloneUrl` into the scoped `meshCheckoutPath(workspaceId)`, registers the workspace, and falls through to the unchanged worktree-and-run flow — no manual pre-setup on that machine.

- **The clone URL is fleet-shared and committed** — it is read from the assigned workspace's own config, never from the worker's request frame.
- **The checkout root is a single seam** — a resolved path that escapes the mesh-checkouts root is refused rather than traversed.
- **Git's ambient credential helper is disabled for the clone** — `-c credential.helper=` plus `GIT_TERMINAL_PROMPT=0`, without which a configured OS helper wins over `GIT_ASKPASS` and persists a token to the keychain.

### Automatic clone-credential mint
The control node mints each clone credential on demand from a configured provider — a GitHub App installation token, short-lived, `contents:read`, scoped to exactly the assigned repo — and delivers it to the worker over the already-open stream at the moment it hits a clone miss.

- **The App private key never leaves the control node** — only the minted token crosses the mesh, and neither is written to logs.
- **The mint is scoped to the assignment's own workspace** — never the requester's claimed one — and refuses for any assignment not in an active state.
- **The credential is pull-only** — nothing persists it to `.git/config`, process env, or disk on the worker.

### Per-org credential scoping
Each org's clone credential is minted by that org's **own** GitHub App — appId, installationId and private key resolved per assigned workspace, with keys coexisting as distinct files under the code-enforced `<meshRoot>/credentials/github-app-<appId>.pem`.

- **Every org's config names its own App identity** — a workspace with no well-formed App identity produces a loud coded mint failure, not a fallback to another org's App.

### UI-driven assignment
A milestone or story is assigned to a worker node from the fleet/board UI through `POST /api/mesh/assign` — the read-only fleet face's single mutation route — with no CLI touched, and the affordance acknowledges the call with a held `Sent` state plus one silent re-load that lands the assignment chip.

- **The wire carries `{ref, nodeId, workspaceId}`, all required** — the item's own workspace is resolved through the sanctioned status→projectRoot→loadWorkspace seam, and a missing id is a coded refusal rather than a fallback to the daemon's own project dir.
- **The target workspace must be local to the control node** — a non-local or unknown workspace is refused (`workspace-not-local` / `workspace-not-found`).
- **The acknowledgment reports the CALL, not the outcome** — a dispatch can be `Sent` and then fail; the assignment's own state arrives on the poll.
- **The assignment carries a validated lifecycle phase** — refine, continue or verify, chosen at dispatch.

### Terminal-driven worker execution
A worker runs assigned work as interactive `claude` in a PTY on its own subscription, driven by whole directive commands the control node types into that one session — `claude -p` is gone from the worker's execution path, so the driver can be asked a question and the run bills to the subscription.

- **`claude` must be authenticated in a real login session on the worker** — a daemon started over SSH has no session and burns the run.
- **The worker clears the folder-trust dialog and runs `--permission-mode auto`** — a directive typed before the TUI is ready, or submitted with a line-feed instead of a carriage-return, is never executed.
- **Completion is detected from the interactive session, not from process exit** — the run's terminal state comes from the session's own signal.

### Worker terminal streaming into the fleet
The worker's live PTY bytes ride the frozen relay envelope as an opaque `terminal-frame` routed by `(nodeId, sessionId)`, and the control node's fleet renders them in a read-only mirror at the `/ws/terminal-view` carve-out.

- **Each leg rides the bind it fits** — worker→control over the fabric, control→browser over loopback; the relay broker binds loopback only and is unreachable off-host.
- **The mirror is read-only in fact** — no keystroke path back, and neither bridge nor mirror writes a durable record.
- **The join key is reported while the run is live** — the session id reaches the fleet before the run reaches a terminal state, or there is nothing to watch.

### Durable worker pushback
Work done on a worker commits to a real named branch and is pushed home before the assignment's worktree is force-removed, so the output survives the `done` transition and arrives as a reviewable branch.

- **The write credential is a second, distinct mint** — `contents:write`, separate from the read-scoped clone token.
- **`aof mesh recover-push` recovers the stalled case** — a stranded worktree on a terminal or stalled assignment is pushed home under control-node direction.

### Worker-verified memory syncback
Knowledge verified on a worker reaches the control node's memory over **git** — the pushed markdown is pulled and re-ingested with `aof work memory ingest`; no index or knowledge payload crosses the mesh.

- **The graphify index is a local cache** — derived output stays gitignored and is rebuilt on each node from the committed markdown.

## Gaps

### A remote node's session on the desktop fleet
- **Status:** open
- **Discharge condition:** `fabricLivenessFor` carries every additive presence key (not just `activeRuns`/`aofVersion`) off the disk record, pinned by a fitness function that goes RED when an additive key is dropped across the fabric-liveness merge.
`aof mesh status --json` — the desktop app's only fleet-data command — replaces a fabric-Online peer's record with a four-key pseudo record that always wins the merge, so `sessions` is absent and a remote worker reads `idle` on the desktop fleet however actively it is worked on; the web fleet, which reads presence off disk, renders it correctly. Finding **F23**, re-homed in milestone 42 wave (b).

### A node descriptor's workspace list
- **Status:** open
- **Discharge condition:** each node descriptor's `workspaces[]` is derived from `global_node_workspaces` for that node id, and the projection-prune tool covers the descriptors' embedded list.
Every node descriptor's `workspaces[]` is the **publishing** workspace stamped onto the whole roster, so both live node cards advertise one workspace — `C:\WINDOWS\system32`, the macOS worker included — while the store's own membership table correctly holds four per node. Finding **F24**, re-homed in milestone 42 (debt item 4).

### Machine-independent workspace identity
- **Status:** open
- **Discharge condition:** a workspace id that is stable across machines (or a documented control↔worker id mapping), so an assignment's workspaceId resolves to the worker's own checkout by identity.
Workspace ids are path-derived, so the same repo carries a different id on each machine; a worker cannot resolve a control-authored workspaceId to its own checkout by identity alone, and every cross-machine path that needs to must re-derive from the clone URL or the checkout root instead.

### A durable store for the App private key
- **Status:** open
- **Discharge condition:** the App private key is read through an OS keychain or vault-backed seam rather than a plaintext file under the mesh root.
The GitHub App private key sits as plaintext PEM at `<meshRoot>/credentials/github-app-<appId>.pem` on the control node. The mesh transmits only short-lived minted tokens, so nothing at rest crosses the fabric — but the key itself has no secret store, which this milestone declared out of scope and named here instead.

### Sweeping the publish temp files
- **Status:** open
- **Discharge condition:** the presence/node publish sweeps stale `.tmp-*` siblings (or a single writer owns the publish), measured by a store that stays clean across a daemon's lifetime.
The atomic presence and node-record writes leave their temp file behind when the rename loses a race — 39 orphans in `presence/` and 6 in `nodes/` on the live control node, the newest from the running daemon — and nothing removes them. Finding **F26**, re-homed in milestone 42 wave (a).
