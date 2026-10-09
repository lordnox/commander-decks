# Rule DSL Part 04 implementation note

Part 04 adds canonical target clauses and whole-item target legality to the
durable Rule DSL spell driver. Target selections are bound before a spell is
put on the stack, under a generated scope ID (`$.abilities[n]`) and an
unchanged clause index. Empty optional clauses remain represented, and flat
target input is rejected when more than one optional partition is possible;
callers can provide `targetClauses` to state the intended grouping.

Player, object-incarnation/zone, and stack-item targets use the shared
selectors and object identity pins. Announcement checks apply shroud,
hexproof, protection from everything, conditional untapped hexproof, and
Flagbearer requirements. Ward remains a targeting trigger and therefore does
not make a target ineligible. Cross-clause `different` constraints are checked
against the pinned identities in the same scope.

Resolution rechecks each pinned recipient by its clause. A spell with no legal
chosen recipients records `didNotResolve:allTargetsIllegal` and skips every
instruction. With some legal recipients, target references expose only legal
slots while retaining their original clause indexes; no retargeting or
last-known target characteristics are introduced. The source's departure is
independent of target legality. Counter instructions report whether the target
stack item was actually removed, including the failure to counter an
uncounterable legal spell, so later instructions continue. The typed result is
recorded for the conditional-instruction support planned in Part 07; Part 04
preflight rejects conditional instruction programs.

The supported canonical capability set for this part is still deliberately
narrow: directly supplied spell, activated, or triggered ability stack items
with supplied execution context and targets, plus `draw`, `gainLife`,
`loseLife`, `damage`, `destroy`, `counter`, and `sequence` instructions.
Modes, payment choices, trigger collection/placement, and the reusable action
catalogue remain owned by later parts. A directly supplied canonical ability
stack item still applies its `interveningIf` gate before the same whole-item
target gate; Part 06 owns collecting such triggers from occurrences. Ward is
created as a trigger stack item with its controller, source, Ward specification,
and target spell identity captured at cast time; payment continues that item
without recasting the spell.

The implementation follows CR 115 target legality and uniqueness, CR 608.2a
intervening-if and CR 608.2b whole-item resolution, plus CR 702.21
ward's triggered treatment. The target binding and resolution tests cover
optional zero targets, ambiguous optional clauses, all-illegal and mixed
legality, source departure, and an uncounterable counter target.
