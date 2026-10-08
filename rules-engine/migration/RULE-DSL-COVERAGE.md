# Rule DSL Part 00 coverage baseline

This directory is the reproducible migration baseline for Part 00 of
[`RULE-DSL-IMPLEMENTATION-PLAN.md`](../RULE-DSL-IMPLEMENTATION-PLAN.md). It does
not participate in card registration, capability discovery, or runtime dispatch.

The generated [`rule-dsl-coverage-ledger.json`](rule-dsl-coverage-ledger.json)
enumerates every current `CardEffect.op`, every `CardInstruction.kind`, every
`CARD_RULES` registration, instruction-handler discovery, built-in plugins,
specialized `PendingDialog` kinds, embedded token/copy/face/granted rules, and
source sites that still dispatch by card name, `custom` event, or direct draft
mutation. Every migration row records its mechanic, registrations, executable
test-file evidence, needed canonical node, compatibility route, owning plan part,
and current status.

At this baseline the closed surfaces contain 394 card registrations, 21 effect
variants, 194 instruction variants with 194 discovered handlers, 54 unique
built-in plugin IDs, and exactly 28 `PendingDialog.kind` variants. The generated
summary is authoritative for these counts.

`confirmed-executable-evidence` names a reviewed behavior test. `candidateEvidence`
records a total and up to eight lexical test-reference samples with their location
and nearest test title; it is useful for review but does not prove the variant.
The generator can reproduce the full search. `registration-only` and
`unobserved` are explicit gaps. The checker deliberately treats a registration,
handler, or card-name mention as inventory, never proof of behavior.

Regenerate and verify the ledger with:

```bash
bun rules-engine/scripts/ruleDslCoverage.ts
bun run check:rule-dsl-coverage
```

The compatibility fixtures under [`compatibility-fixtures/`](compatibility-fixtures/)
pin current command, saved-state, and `rules-engine/v0` journal shapes. Their test
restores open typed card and player selections, resumes them exactly once, and
replays the legacy resolution-time mode dialog. Regenerate them with:

```bash
bun rules-engine/scripts/ruleDslCompatibilityFixtures.ts
bun test rules-engine/src/ruleDslCompatibility.test.ts
```

## Baseline at `20f6da632c26633aae5eb660fa28d81c3c125f78`

Captured on 2026-10-08 with Bun 1.3.14 and TypeScript 7.0.2:

| Check | Result |
| --- | --- |
| `bun run test:rules` | 2,124 pass, 0 fail across 197 files on the untouched base; 2,127 pass after adding the three Part 00 compatibility tests |
| `bun run test:live-runner` | 181 pass, 1 fail across 16 files |
| `bun run test:site` | 40 pass, 0 fail across 5 files |
| `bun run typecheck` | pass |
| `bun run check:imports` | pass |
| `bun run lint --quiet` | pass |

The live-runner failure is pre-existing and reproducible in isolation:

```text
kernel host journal > loads generated card handlers from the current worktree
Cannot find module .../.live-testHandler-<pid>-2.ts
```

Reproduction:

```bash
bun test live-runner/src/kernelHost.test.ts \
  --test-name-pattern 'loads generated card handlers from the current worktree'
```

This Part 00 branch does not alter `importFresh` or runtime behavior. The failure
is recorded as a regression baseline rather than classified as an intended DSL
rules correction.

The compatibility harness also pins a legacy protocol gap: mode dialogs and the
immediately following generic dialog both use `kernel.pendingDialog.chosen`
without a request ID. Re-submitting the mode answer is therefore accepted as an
answer to the next dialog. The fixture verifies that it does not execute the mode
twice. This is a known correction gap owned by Part 05, whose request IDs must add
freshness and exactly-once consumption while providing an explicit adapter for
this persisted legacy shape; Part 09 then migrates mode selection onto that path.

The fixture generator ran against the unchanged base runtime with a fixed random
function and deterministic object creation. It stores raw authoritative states
for open card and player selections, and a complete `rules-engine/v0` journal for
the legacy mode selection. It does not yet journal card/player answers, host wire
messages, projected client state, or every specialized dialog. Those remain
explicit Part 05/15 compatibility work; these fixtures are representative Part 00
anchors rather than a complete persistence conformance suite.

## Intentional corrections versus regressions

The ledger's `intentionalCorrections` list names the contract changes that later
parts must test as deliberate rules corrections: checkpoint-owned SBAs/triggers,
announcement-time modes, CR 616 replacement choice/lineage, and step-instance
draw history with deferred failed-draw loss. Any other observable difference from
the fixtures or existing suites is a regression until reviewed and classified.
