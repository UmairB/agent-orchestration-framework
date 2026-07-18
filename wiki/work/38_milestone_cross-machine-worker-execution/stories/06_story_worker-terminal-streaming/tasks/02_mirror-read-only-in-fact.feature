@executable @cli @work @distribution
Feature: The fleet terminal mirror is READ-ONLY IN FACT — no code path forwards a fleet-originated input frame to the worker PTY, and credential MATERIAL never appears in the streamed bytes
  In order that exposing a credentialled agent terminal to the control node is read-only in FACT, not merely in intent
  (SECURITY T14), the fitness `acd-fleet-terminal-mirror-read-only` proves STRUCTURALLY that no source consuming a relay
  terminal-frame or a fleet terminal-VIEW message calls `term.write` / feeds a worker PTY stdin (the stream is
  server→browser ONLY), and the minted token that lives only in the one-shot askpass file never rides the streamed bytes.

  # ARCHITECTURE 38/ADR-014 (invariant 1 — NO mesh→PTY input path: no source that consumes a relay terminal-frame or a fleet
  # terminal-VIEW message calls `term.write`/feeds a worker PTY stdin; the terminal-VIEW WebSocket is server→browser only;
  # read-WRITE keystrokes-from-the-fleet is DEFERRED to Phase 2). SECURITY T14 (read-only IN FACT; credential MATERIAL never
  # streams — the minted token lives ONLY in the one-shot askpass file (T7/R6), the App key/JWT are control-side (T8/F5), so
  # the mirror can leak only what the agent PRINTS on screen). terminal-ws.mjs:257-263 (output `onData`) vs :285 (`term.write`
  # — the INPUT direction the MESH path must never gain a source for).
  #
  # The read-only assertion is STRUCTURAL — the fitness `acd-fleet-terminal-mirror-read-only` fails if an input-forwarding
  # path is ever ADDED, not merely "we did not send input in this test" (the acd-worker-clone-no-credential-persisted
  # source-scan precedent: a synthesized plant trips the check, the real source is asserted clean first). @executable over
  # INJECTED seams + that source-scan fitness. The on-screen-PRINTED-secret residual (an authorized viewer inherently sees
  # what the agent prints) is T14's ACCEPTED residual — its inspection is task 03's @manual soak, not encodable here.

  Background:
    Given the bridge + fleet terminal-VIEW wiring under the fitness `acd-fleet-terminal-mirror-read-only`

  Scenario: STRUCTURAL — no code path forwards a relay/fleet frame onto a worker PTY
    Then no source that consumes a relay terminal-frame calls `term.write` or writes to a worker PTY's stdin
    And the fleet terminal-VIEW WebSocket has no `message` handler that forwards a browser frame toward the worker (send-to-browser only)
    And the fitness TRIPS when a synthesized input-forwarding path (a terminal-VIEW message routed into `term.write`) is planted — so ADDING such a path FAILS CI
    And its self-check confirms the real, read-only wiring is asserted CLEAN first (each plant differs from the clean baseline)

  Scenario: at runtime the mirror is server→browser only — a fleet keystroke reaches no worker PTY
    Given a fake terminal-VIEW client connected to the in-memory mirror
    When the client sends a keystroke / input frame up its socket
    Then the mirror forwards it onto NO relay terminal-input frame and reaches NO worker PTY — there is no such sink
    And the worker's OWN local `/ws/terminal` stays bidirectional (a human logged INTO the worker still types locally) — this invariant governs the MESH/fleet path only

  Scenario: the streamed signal is sourced ONLY from PTY output — credential material never rides it
    Given a scoped clone whose token lives ONLY in the one-shot askpass env, never echoed to the PTY (T7/R6)
    Then the bridge sources its `signal` payload EXCLUSIVELY from the PTY `term.onData` output — it reads no credential env, no askpass file, no mint reply into the signal
    And a secret sentinel present only in the scoped askpass env never appears in the mirrored bytes
    And the App private key / App JWT / mint artefacts (control-side, T8/F5) are never on the worker terminal at all, so they cannot enter the stream
