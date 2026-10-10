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
  canonical trigger groups; legacy groups retain stable ordering while their
  target semantics migrate.
- [x] Bind canonical trigger modes and target shapes before ordinary priority
  for modal programs, optional/impossible one-clause targets, and homogeneous
  multi-clause player/object targets. Stack-item target offers and mixed player/object
  clauses remain explicitly unsupported by the current typed picker and are tracked
  for the next target-surface slice.
- [x] Add conformance tests for three simultaneous canonical deaths, pinned
  source departure, OR matching, draw-three collection, canonical player target
  offers, modal mode announcement/resolution, false-at-capture intervening-if,
  and host-facing trigger ordering. Existing driver tests cover resolution-time
  intervening-if and optional target binding; the established draw-resolution
  regression covers multiple instructions without an intermediate priority window.
- [ ] Rerun focused/full validation, inspect the diff, and update ready PR #343
  against the Part 05 branch. The pre-review baseline was 2,224 rules tests /
  7,137 assertions and 216 live+codec tests / 1 documented generated-handler
  fixture failure / 1,008 assertions. The coverage-ledger check is stale on the
  Part 05 base and would rewrite unrelated line evidence, so that generated file
  remains intentionally unchanged.

## Rules references

The implementation follows the official 2026-08-19 Comprehensive Rules text:
117.5, 603.2c/g, 603.3b-d, 603.4, 603.6/603.10, and 704.3-4. The local
baseline and the generated-handler fixture limitation are recorded in
`KNOWN-TEST-FAILURES.md`; no new failure is treated as baseline without a fresh
test result.
