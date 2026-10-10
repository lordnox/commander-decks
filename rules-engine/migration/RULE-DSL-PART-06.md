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
  canonical trigger groups, including distinguishable legacy entries when a
  controller has multiple APNAP groups. Legacy one-controller ordering retains
  its established automatic path pending the broader legacy interaction cleanup.
- [x] Bind canonical trigger modes and target shapes before ordinary priority
  for modal programs, optional/impossible clauses, mixed player/object clauses,
  repeated same-object clauses, selected-mode-local clauses, and stack-item
  targets. Each clause keeps its own bounds and pinned identity; explicit
  cross-clause constraints remain enforced by the canonical binder.
- [x] Add conformance tests for three simultaneous canonical deaths, pinned
  source departure, OR matching, draw-three collection, canonical player target
  offers, modal mode announcement/resolution, selected mode-local targets,
  false-at-capture intervening-if, canonical permanent-spell entry, resolving
  canonical draw-three, and host-facing trigger ordering.
- [ ] Complete the remaining legacy one-controller ordering migration without
  changing the established legacy test contract; this is isolated from the
  canonical placement cursor and remains a review item.
- [ ] Rerun full repository validation after the final review fixes. The focused
  Part 06 and parent reproduction suites currently pass; the documented
  generated-handler fixture remains the only accepted live-runner baseline
  failure, and no new failure is treated as baseline without a fresh result.

## Rules references

The implementation follows the official 2026-08-19 Comprehensive Rules text:
117.5, 603.2c/g, 603.3b-d, 603.4, 603.6/603.10, and 704.3-4. The local
baseline and the generated-handler fixture limitation are recorded in
`KNOWN-TEST-FAILURES.md`; no new failure is treated as baseline without a fresh
test result.
