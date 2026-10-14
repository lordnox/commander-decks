# Rule DSL Part 15 — combined conformance and persistence gate

**Status:** complete / merged to `main`. Landing PRs: [#351](https://github.com/lordnox/commander-decks/pull/351), [#361](https://github.com/lordnox/commander-decks/pull/361), [#363](https://github.com/lordnox/commander-decks/pull/363), [#365](https://github.com/lordnox/commander-decks/pull/365)–[#368](https://github.com/lordnox/commander-decks/pull/368), [#371](https://github.com/lordnox/commander-decks/pull/371), [#372](https://github.com/lordnox/commander-decks/pull/372). This is the combined evidence gate, not a claim that every Magic card is covered.

## Delivered

- Authoritative-driver matrix scenarios A–R (observable state, events, and requests).
- Host envelopes for remaining choice families: authorized request, browser/headless parity, reconnect, private continuation omitted, stale/duplicate/wrong-seat rejected.
- New-format journal/JSON persistence restore: open choices, suspended frames, copies/tokens, pinned in-flight `ruleDefinition` revision.
- Live wire, compact snapshot, and replay consumers reject missing, v0, and unknown versions instead of silently parsing them.
- CI jobs for `test:rules`, `test:live-runner:ci`, and `test:site`.

## Evidence

- `rules-engine/src/cardPlugins/dsl/part15.conformance.test.ts` — scenarios A–R.
- `rules-engine/src/cardPlugins/dsl/part15.persistence.test.ts` — journal/JSON restore, revision pin, ETB `selectCards`, mill/draw frames, copied Elemental.
- `live-runner/src/kernelHost.part15.test.ts` — host envelopes I/B/H/D/O/E.
- `site/src/liveCodec.test.ts`, `site/src/liveCompact.test.ts`, `.agents/skills/render-table-replay/scripts/render-replay.test.ts` — accept current wire/replay, reject old.
- `.github/workflows/ci.yml` — `test:rules`, `test:live-runner:ci`, `test:site`.

## Gaps (intentional)

- CARD_RULES family migrations and removing `legacy.ts` (Part 16).
- Known generated-handler reload fixtures, filtered from `test:live-runner:ci`; see [KNOWN-TEST-FAILURES.md](KNOWN-TEST-FAILURES.md).
- Representative matrix only; unmigrated stored-deck cards still use `CARD_RULES`.
