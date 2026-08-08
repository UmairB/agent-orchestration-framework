# Task feature — the BLOCKER raised at the milestone end gate (`aof:verify 45`,
# 2026-08-07): finding F-45-M-1. Written by the PO at triage, not at refine.
#
# WHAT WAS MEASURED, and where. A real browser (cached ms-playwright Chromium over
# CDP) was pointed at all four ADR-002 paths plus an unmatched one, on all three
# real origins — the LIVE fleet daemon on 127.0.0.1:4181, and `serveBoard` /
# `serveSetupUi` stood up on ephemeral ports. Fourteen of the fifteen cells render
# the shell. ONE does not:
#
#     origin   path      shell?  body    what the operator sees
#     fleet    /board    yes     145 B   the board's OWN error state, in-shell
#     fleet    /config   NO        0 B   a totally blank page
#
# `<App>` fetches `/api/config` and `/api/config/project`. The fleet origin is the
# one origin that does not serve them (mesh-ui-serve answers its coded 404), so the
# 404 envelope lands in `payload`, `payload.resources` is `undefined`, and a
# `useMemo` calls `.filter` on it:
#
#     TypeError: Cannot read properties of undefined (reading 'filter')
#
# React has no error boundary above the mounted surface, so the throw unmounts the
# WHOLE tree — the shell, the top bar, the nav and the way back go with it. The
# operator's only exit is the browser's Back button.
#
# WHY THIS IS THE SHELL'S BUG AND NOT `<App>`'s. The crashing `useMemo` is
# byte-identical to its pre-split original (`git show 1282875^:ui/src/main.tsx:124`)
# — this story MOVED it and did not touch it, and SPEC puts re-skinning `<App>` out
# of scope. What milestone 45 added is the DOOR: `/config` is a path this milestone
# minted, and the shell renders a `Config` nav item advertising it as `available`
# with `href="/config"` on every origin. So the fix belongs where the promise was
# made. `Shell.tsx:91-94` makes it in so many words:
#
#     "Absent means resolvable, which is ADR-002's origin-blind ruling: … every nav
#      link genuinely lands on its surface — one reached on an origin that cannot
#      serve its API DEGRADES THROUGH ITS OWN EXISTING ERROR STATE."
#
# `/board` on the fleet origin honours that sentence exactly. `/config` does not.
# This task makes the sentence true for every surface rather than for three of four.
#
# THE STATE TO DEGRADE INTO ALREADY EXISTS AND IS ALREADY TESTED. `contentStateFor`
# has a `failed` state (`shell-layout.mjs:481-488`) and `Shell.tsx:486`'s
# `SurfaceFailed` renders it — "Could not load the {routeId} view" plus a `⟳ Retry`.
# Nothing feeds it from a RUNTIME throw: `surfaceFailed` is set only by
# `surfaceMountFor`, for a route id the surface map has no entry for. That is the
# entire gap. No new state, no new DESIGN rule, no new token.
#
# NOT IN SCOPE: making `/config` WORK on the fleet origin. Serving `/api/config`
# from the mesh origin is a merge of the origins, which SPEC puts out of scope in
# terms. The contract here is that an unreachable surface degrades visibly and
# recoverably — the same bargain row 7 of `45/04/02` strikes for the board.
#
# LITMUS: every Then is observable from a rendered page — the shell's own chrome
# still standing, a named failed state inside the content region, and a control that
# gets the operator back. A test that only asserts a component did not throw would
# miss the thing that matters, which is that the CHROME SURVIVES.

@executable @bug @finding-F-45-M-1 @ui @work @design
Feature: a surface that throws while rendering takes down itself, never the shell
  In order that an operator who clicks a nav item the app itself marked available is never dropped onto a blank page with no way back
  a surface that throws during render is caught at the shell boundary and rendered as the shell's existing `failed` content state, with the chrome, the navigation and a retry all still there

  Background:
    Given the shell mounts a surface for the route the ONE table names
    And the shell already models a `failed` content state with a retry control

  # THE HEADLINE, and it is the measured defect turned into a row.
  Scenario: the config editor on an origin that cannot serve its API degrades in-shell instead of blanking the page
    Given the fleet origin, which serves no `/api/config`
    When the operator opens `/config` there — or clicks the shell's own `Config` nav item, which advertises it as available
    Then the top bar is still rendered, with the brand, the identity chip and all four nav items
    And the content region holds the shell's `failed` state naming the surface that failed
    And a retry control is present and reachable
    And the page is not blank: the rendered document still carries the shell's regions
    And the address bar still reads `/config` — the failure is not a redirect

  # THE GENERAL RULE the headline is one instance of. Written as an outline so a
  # fifth surface added by milestone 47 or 49 inherits it rather than re-discovering
  # it the way this one was discovered.
  Scenario Outline: any surface that throws while rendering is contained at the shell boundary
    Given the route table names <surface> and its component throws while rendering
    When the shell renders that route
    Then the shell's own chrome and navigation are still rendered
    And the content region shows the `failed` state for <surface>
    And the thrown error does not propagate past the shell's content region
    And no other region is unmounted

    Examples:
      | surface |
      | fleet   |
      | board   |
      | config  |

  # THE CONTAINMENT IS PER-SURFACE, not per-application: recovering must not require
  # the operator to reload, because a reload on the same address reproduces the same
  # throw. Navigating away is the real escape and the nav is what provides it.
  Scenario: the navigation still works from the failed state
    Given a surface has failed and the shell is showing its `failed` state
    When the operator picks a different surface from the navigation
    Then that surface's address is loaded and its own route renders
    And the failed state does not persist onto the new route

  # THE DISTINCTION THAT MUST NOT COLLAPSE — three different content states, three
  # different meanings, and this fix must not blur the first two.
  Scenario Outline: a failed surface, an unmatched path and a landing stay three distinct states
    Given the shell is rendering <situation>
    When the content region is inspected
    Then its state is <state>
    And its treatment is <treatment>
    And a nav item is <active> marked active

    Examples:
      | situation                            | state     | treatment    | active |
      | a surface that threw while rendering | failed    | accent       | is     |
      | a path the route table does not know | not-found | dashed-empty | is not |
      | the `/` landing                      | populated | dashed-empty | is     |

  # NON-VACUITY, stated as a row so the fix cannot be a comment. The gate is that
  # REMOVING the containment reproduces the blank page.
  Scenario: removing the containment reproduces the measured blank page
    Given the shell boundary that catches a rendering surface is removed
    When a surface throws while rendering
    Then the whole tree unmounts and the rendered document carries no shell region
    And that is the state finding F-45-M-1 recorded on the fleet origin at `/config`
