# Rule DSL Part 06 implementation note

Status: implementation in progress on `agent/gpt56luna-rule-dsl-part06`.

## Architecture

Part 06 keeps actual event reduction and trigger placement separate. Applied
occurrences are matched while their before/after state is available, and each
match stores a durable pending ability instance with its source snapshot,
controller, triggering participants, occurrence context, and pinned canonical
definition when the source uses Rule DSL v1. Pending instances remain private
authoritative state.

The checkpoint owns CR 117.5 maintenance and CR 603.3b placement. It first
stabilizes simultaneous SBAs, then performs the non-ability-triggering pass and
the ability-triggering pass in APNAP order. Controller ordering and trigger
announcement choices are represented by a serializable cursor; a pending target,
mode, or ordering choice suspends that cursor and resumes it after the typed
answer. No nested event application grants priority or places ordinary triggers.

## Progress

- [x] Rebased onto the documented Part 05 head `1b94378a`.
- [x] Added private serializable trigger-placement state and canonical pending
  trigger metadata types.
- [x] Match canonical DSL occurrence patterns and preserve look-back context
  for enters/dies/draw, including source LKI and occurrence snapshots.
- [x] Implement two-pass APNAP placement and typed controller ordering for
  every controller group. Canonical and legacy entries use the same durable
  ordering cursor; legacy entries carry distinguishable labels when a source
  has different triggered abilities, while repeated equivalent instances keep
  their deterministic order because there is no semantic distinction to show.
- [x] Bind canonical trigger modes and target shapes before ordinary priority
  for modal programs, optional/impossible clauses, mixed player/object clauses,
  repeated same-object clauses, selected-mode-local clauses, base ability
  targets, and stack-item targets. Each clause keeps its own bounds and pinned
  identity. Each selected mode occurrence now has a distinct execution scope,
  so repeated modes retain local `targetRef` indices and mode-local constraints
  while base-program bindings remain in the base scope.
- [x] Add conformance tests for three simultaneous canonical deaths, pinned
  source departure, OR matching, draw-three collection, canonical player target
  offers, modal mode announcement/resolution, selected mode-local targets,
  false-at-capture intervening-if, canonical permanent-spell entry, resolving
  canonical draw-three, and host-facing trigger ordering.
- [x] Complete the remaining legacy one-controller ordering path, including
  distinct host-facing labels and journal/reconnect coverage. Existing repeated
  equivalent legacy instances retain their deterministic order.
- [x] Evaluate canonical enters and draw predicates against the relevant
  post-event state while retaining the pre-event state for first-draw history
  and designated departure lookback conditions. Canonical frequency history is
  recorded on the mutable source object so simultaneous SBA captures share
  once-each-turn state without sharing frozen pre-event objects.
- [x] Rerun full rules validation after the final review fixes: 2,237 tests and
  7,171 assertions pass. The live/codec baseline remains 216 passing tests,
  1,008 assertions, and the one documented generated-handler fixture failure;
  no new failure is treated as baseline without a fresh result.

## Rules references

The implementation follows the official 2026-08-19 Comprehensive Rules text:
117.5, 603.2c/g, 603.3b-d, 603.4, 603.6/603.10, and 704.3-4. The local
baseline and the generated-handler fixture limitation are recorded in
`KNOWN-TEST-FAILURES.md`; no new failure is treated as baseline without a fresh
test result.
