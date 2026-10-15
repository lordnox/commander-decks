# Rule DSL coverage ledger

The generated [`rule-dsl-coverage-ledger.json`](rule-dsl-coverage-ledger.json)
inventories every current `CardEffect.op`, `CardInstruction.kind`, `CARD_RULES`
registration, instruction-handler discovery, built-in plugin, specialized
`PendingDialog` kind, and source site that still dispatches by card name,
`custom` event, or direct draft mutation. It does not participate in card
registration or runtime dispatch.

A ledger row records mechanic, registrations, executable test-file evidence,
needed canonical node, compatibility route, and status.
`confirmed-executable-evidence` names a reviewed behavior test.
`candidateEvidence` is lexical only and does not prove behavior.
`registration-only` and `unobserved` are explicit gaps.

Regenerate and verify:

```bash
bun rules-engine/scripts/ruleDslCoverage.ts
bun run check:rule-dsl-coverage
```

Compatibility fixtures under [`compatibility-fixtures/`](compatibility-fixtures/)
pin current command, saved-state, and `rules-engine/v0` journal shapes:

```bash
bun rules-engine/scripts/ruleDslCompatibilityFixtures.ts
bun test rules-engine/src/ruleDslCompatibility.test.ts
```

The generated card-handler reload fixture in `live-runner` is a known non-DSL
failure; see [KNOWN-TEST-FAILURES.md](KNOWN-TEST-FAILURES.md).
