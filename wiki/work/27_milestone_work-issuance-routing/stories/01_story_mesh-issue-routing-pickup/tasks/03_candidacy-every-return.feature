@cli @work @distribution @executable
Feature: the candidacy lookup applies at EVERY nextWork ready-return — the uat and zero-story driver returns become candidacy-aware, the milestone-accept fallthrough stays blind
  In order to complete the m26/ADR-007 deferral so a directive/lease on a DRIVER ref is honoured (before m27 the uat + zero-story driver returns were candidacy-BLIND and double-offered)
  the unified candidacy lookup guards each of nextWork's ready-returns — the uat driver return (work.mjs:568), the zero-story needs-break-down driver return (:574), AND the existing story-loop returns (:581/590/592) — so a live-peer lease OR a targeted-elsewhere directive on a uat or a zero-story ref is now SKIPPED, a stale-peer lease surfaces reclaimable, while the milestone-accept fallthrough (:598, all stories done) stays deliberately candidacy-blind,
  so that a peer's next no longer double-offers a driver ref another node is working (the m26/ADR-007 fix landed HERE), and a genuinely-done milestone — not a claimable work ref — is still offered for acceptance.

  # ARCHITECTURE ADR-004.3 (the m26/ADR-007 fold-in — the candidacy lookup at EVERY ready-return):
  #   the candidacyView lookup is applied at EACH of nextWork's ready-returns —
  #     - the uat driver return (work.mjs:568) — "run the session";
  #     - the zero-story needs-break-down driver return (work.mjs:574);
  #     - the existing story-loop returns (work.mjs:581/590/592) — already candidacy-aware in m26.
  #   The milestone-ACCEPT fallthrough (work.mjs:598, all stories done) stays candidacy-BLIND —
  #   the m26/ADR-007 carve-out: a genuinely-done milestone is NOT a claimable work ref, so a
  #   lease/directive on it is meaningless (nobody claims a done milestone; accepting it is a
  #   PO act, not a fleet claim). work.mjs imports NO mesh module — the fold-in edits the
  #   ready-returns only (no new import — fitness #5).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #5 (acd-next-candidacy-every-return): SOURCE-analysis of nextWork's body — each
  #    ready-return site (uat / zero-story / story-loop) is guarded by the candidacy lookup, the
  #    accept fallthrough is NOT (the carve-out); the XOR/consistency form (green as the
  #    story-loop-only m26 shape AND green post-fold-in). NOT a scenario here.
  #  - fitness #4 (acd-next-candidacy-injected): work.mjs still imports no mesh module; the
  #    fold-in adds no import — a SOURCE assertion.
  #  - THIS feature asserts the OBSERVABLE walk outcomes at the DRIVER returns: a uat ref and a
  #    zero-story ref are now skipped/reclaimable by candidacy, and the accept fallthrough stays
  #    blind.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the rows stay @executable ONLY if the driver returns
  # accept the SAME hand-built candidacy view the story-loop returns already consume (a Map keyed
  # by the DRIVER's ref — e.g. "27" for a uat/zero-story milestone driver — with the unified
  # verdict + lease state). Open question for the developer wave: is there a CLEAN injection point
  # at each driver return so the lookup wraps `return ready(driver, ...)` uniformly (a shared
  # guard helper), or does each return site need bespoke handling? The ADR asks for a uniform
  # every-return guard; if the uat/zero-story returns cannot take the view by ref the way the
  # story-loop returns take it by story.ref, the developer wave must confirm the driver ref is
  # the key the view is built on. RAISED — do NOT retag; the driver-return candidacy must stay
  # unit-testable with a hand-built view. See VERIFICATION.
  #
  # RESOLVED (developer-amigo): CONFIRMED — a CLEAN, UNIFORM injection point exists; no bespoke
  # per-site handling needed; @executable stands unchanged. Verified against the real `nextWork`
  # body (`src/work.mjs:535-602`):
  #  - the uat return is `if (driver.type === "uat") return ready(driver, meta.status);` (`:568`);
  #  - the zero-story return is `if (stories.length === 0) return ready(driver, meta.status);`
  #    (`:574`);
  #  - the story-loop return is `return ready(story, storyMeta.status);` guarded today by
  #    `leaseView?.get?.(story.ref)` (`:580-592`).
  # All three sites call the SAME `ready(item, status)` helper (`:508-515`) keyed by `item.ref` —
  # `driver.ref` at the first two sites, `story.ref` at the third. The candidacy view is a Map
  # keyed by item ref (task 02's resolution), so `driver.ref` IS the correct, already-matching key
  # — no re-keying, no bespoke logic: the uat/zero-story sites take `candidacyView?.get?.(driver.ref)`
  # via the IDENTICAL optional-chaining guard idiom the story loop already uses for `story.ref`.
  # The uniform shape (confirmed buildable as a shared inline guard, not necessarily a named
  # helper function — either satisfies fitness #5's source-analysis, which checks "guarded by the
  # lookup", not a specific helper name):
  #   const uatCandidacy = candidacyView?.get?.(driver.ref);
  #   if (uatCandidacy?.routed === "elsewhere" || uatCandidacy?.state === "leased-live") { /* fall
  #     through to blocked/next driver — the SAME "not actionable, keep walking" shape the
  #     story-loop's leaseSkipped flag uses */ }
  #   if (uatCandidacy?.state === "leased-stale") return { ...ready(driver, meta.status),
  #     reclaimable: true, leasedBy: uatCandidacy.holder };
  #   return ready(driver, meta.status);
  # — applied verbatim at BOTH the uat (`:568`) and zero-story (`:574`) sites, each substituting
  # its own local `driver`/`meta.status` binding. This is a small, disciplined REPEAT of the
  # story-loop's existing three-way branch (offer / skip / reclaimable), not a new mechanism — so
  # "uniform" is satisfied at the LOOKUP-AND-BRANCH-SHAPE level, which is what fitness #5's
  # source-analysis (ARCHITECTURE.md fitness table row 5) actually asserts. The milestone-accept
  # fallthrough (`:598`, `return ready(driver, meta.status); // all stories done`) is territorially
  # UNTOUCHED — confirmed it takes no candidacy lookup, preserving the ADR-004.3 carve-out exactly
  # as scenario "the milestone-accept fallthrough ignores any candidacy entry" requires. `work.mjs`
  # gains no new import for this fold-in (fitness #4 unperturbed) — the guard reads only the
  # injected `candidacyView` parameter already in scope from the existing `{ leaseView }` →
  # (renamed/widened, task 02) destructure at the function signature.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And candidacy view fixtures I hand-build as plain data (routing verdict folded with lease state), keyed by item ref
    And this node's config.mesh.nodeId is "node-a"

  # THE UAT DRIVER RETURN — NOW CANDIDACY-AWARE (ADR-004.3; work.mjs:568): before m27 the uat
  # driver return offered the uat ref BLIND — a peer's next double-offered it. Now the candidacy
  # lookup guards it: a live-peer lease OR a targeted-elsewhere directive on the uat ref is
  # SKIPPED; a stale-peer lease surfaces it reclaimable; an offer/unleased uat ref is offered as
  # before (byte-identical when no candidacy entry exists).
  Scenario Outline: the uat driver return honours the candidacy view
    Given the next-actionable driver is a uat ref "27" with no blocking depends
    And the candidacy view says "27" is "<candidacy>"
    When next is asked with the candidacy view
    Then the uat driver return outcome is "<outcome>"

    Examples:
      | candidacy                         | outcome                                          |
      | no entry (offer)                  | "27" offered (byte-identical to today)           |
      | targeted-elsewhere                | "27" skipped (another node's work)               |
      | leased-live by peer "node-b"      | "27" skipped exactly as not-actionable           |
      | leased-stale by peer "node-b"     | "27" offered ready + reclaimable, leasedBy node-b |

  # THE ZERO-STORY DRIVER RETURN — NOW CANDIDACY-AWARE (ADR-004.3; work.mjs:574): a milestone with
  # no stories yet (needs break-down) returns the milestone driver as ready. Before m27 this
  # return was candidacy-BLIND. Now the SAME candidacy lookup guards it: targeted-elsewhere or
  # leased-live ⇒ skipped; leased-stale ⇒ reclaimable; offer ⇒ offered.
  Scenario Outline: the zero-story (needs-break-down) driver return honours the candidacy view
    Given the next-actionable driver is a milestone ref "27" with ZERO stories (needs break-down)
    And the candidacy view says "27" is "<candidacy>"
    When next is asked with the candidacy view
    Then the zero-story driver return outcome is "<outcome>"

    Examples:
      | candidacy                         | outcome                                          |
      | no entry (offer)                  | "27" offered as needs-break-down (unchanged)     |
      | targeted-elsewhere                | "27" skipped (another node's work)               |
      | leased-live by peer "node-b"      | "27" skipped exactly as not-actionable           |
      | leased-stale by peer "node-b"     | "27" offered ready + reclaimable, leasedBy node-b |

  # A STALE-PEER LEASE ON A DRIVER REF SURFACES READY + RECLAIMABLE (ADR-004.3 + m26/ADR-005):
  # the driver ready-returns adopt the SAME leased-stale semantics the story-loop return already
  # carries — a stale peer's driver ref is offered in its normal position, annotated
  # { reclaimable: true, leasedBy } (next is a READ; the claim path reclaims). This is the fold-in
  # completing m26/ADR-007 at the driver returns.
  Scenario: a stale-peer lease on a uat driver ref surfaces the ref ready and reclaimable, naming the holder
    Given the next-actionable driver is a uat ref "27"
    And the candidacy view says "27" is leased-stale by peer "node-b"
    When next is asked with the candidacy view
    Then the offered item is "27" (a stale lease never demotes the walk)
    And the result carries reclaimable true and leasedBy "node-b"
    And next wrote nothing (the claim path reclaims, never next)

  # THE MILESTONE-ACCEPT FALLTHROUGH STAYS CANDIDACY-BLIND (ADR-004.3 carve-out; work.mjs:598):
  # when EVERY story of a milestone is done, the walk falls through and offers the MILESTONE for
  # acceptance. This return is DELIBERATELY not candidacy-guarded: a genuinely-done milestone is
  # not a claimable work ref (nobody leases a done milestone; a directive on it is meaningless),
  # so a lease/directive entry for it is ignored and the milestone is still offered for
  # acceptance — the m26/ADR-007 carve-out, preserved verbatim.
  Scenario Outline: the milestone-accept fallthrough ignores any candidacy entry — a done milestone is always offered for acceptance
    Given every story of milestone "27" is done (the accept fallthrough)
    And the candidacy view says "27" is "<candidacy>"
    When next is asked with the candidacy view
    Then milestone "27" is offered for acceptance (the fallthrough is candidacy-blind)

    Examples:
      | candidacy                     |
      | no entry (offer)              |
      | targeted-elsewhere            |
      | leased-live by peer "node-b"  |
      | leased-stale by peer "node-b" |

  # THE END-TO-END DRIVER-RETURN DOUBLE-OFFER FIX (ADR-004.3, the m26/ADR-007 headline): before
  # m27 two peers each ran next against a uat/zero-story driver ref and BOTH offered it (the
  # driver returns were blind). Now, over a shared candidacy view, a live-peer lease on the
  # driver ref makes the peer's next SKIP it — the double-offer is closed at the driver returns,
  # exactly as it already was inside the story loop.
  Scenario: a peer's next no longer double-offers a uat driver ref that a live peer is working
    Given peer "node-b" holds a live lease on the uat driver ref "27"
    And this node "node-a" builds its candidacy view from the shared directive/lease tree
    When node-a's next is asked with that candidacy view
    Then node-a does NOT offer "27" (it is being worked by a live peer — the driver return is no longer blind)
    And before the m27 fold-in this same tree would have double-offered "27" (the closed m26/ADR-007 gap)
