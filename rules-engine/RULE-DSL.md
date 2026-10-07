# Configurable rule model

Status: API specification with an implemented first slice. Shared trigger builders,
object filters, player predicates/selectors, and fixed-amount life-loss, life-gain,
and player damage instructions exist. Participant references, object selectors,
amount expressions, replacement builders, and static builders remain proposed.

## Composition rules

A card definition is a list of abilities. An ability binds timing and conditions to
instructions. Instructions describe actions; they emit kernel events rather than
editing game state directly. Event handlers enforce game rules and apply replacements.

Keep four distinct concepts:

- **Selector:** describes players or objects to inspect or affect.
- **Instruction:** describes an action performed during resolution.
- **Ability:** determines when instructions may run: triggered, activated, or spell resolution.
- **Modifier:** changes an event before it occurs (replacement/prevention) or changes
  characteristics continuously (static effect).

All definitions must be typed, serializable data. Builder functions produce that data;
no callbacks, captured objects, arbitrary executable predicates, or card-name checks
belong in saved definitions. Existing helper functions become compatibility wrappers.

## Selectors and references

Object selectors reuse the existing object filter, including `all`, `any`, and `not`.
Player selectors use a separate typed domain; creature types cannot filter a player.

```ts
players({ relation: 'opponent' })
players({ not: { relation: 'you' } })
objects({ zone: 'battlefield', type: 'Creature', controller: 'you' })
objects({ any: [{ subtypes: ['Knight'] }, { subtypes: ['Soldier'] }], token: true })
```

`you` means the ability controller, preserved when the ability is put on the stack.
`opponent` must use the format's opponent relation rather than assume every other seat
is an opponent. In the current free-for-all format these groups coincide. Lost players
are excluded from affected player groups.

A selector identifies **all affected recipients** unless an explicit choice or target
binding requests a subset. Do not interpret a filter as targeting. Targets are chosen
when an ability goes on the stack; choices made during resolution are separate typed
`selectPlayers` / `selectCards` interactions. Target legality is checked again at
resolution. Non-targeted groups do not invoke targeting restrictions.

Named references such as `source`, `triggering.player`, `triggering.object`, and
`target('victim')` bind particular participants. An object reference must include its
zone-change identity, not only its reusable object ID. Event participants are captured
when the event occurs; ordinary recipient selectors are evaluated at resolution.
Departures also preserve last-known characteristics and controller information.

## Parameterized instructions

Use one configurable primitive per game action instead of a helper for every recipient
combination:

```ts
loseLife({ amount: 1, to: players({ relation: 'opponent' }) })
gainLife({ amount: 2, to: players({ relation: 'you' }) })
damage({ amount: 1, to: players({ relation: 'opponent' }), source: ref('source') })
draw({ count: 1, for: ref('triggering.player') })
move({ objects: objects({ type: 'Creature', controller: 'you' }), to: 'exile' })
```

`opponentsLoseLife(1)` becomes a compatibility wrapper for the first example.
Life loss is not damage: damage retains source attribution and interacts with
prevention, lifelink, infect, protection, and format rules. Conversely, losing life
must not dispatch a damage event. Destroy and sacrifice also remain distinct from a
plain move instruction even when their resulting destination is a graveyard.

Amounts should support typed expressions such as constants, event amounts, X, counts,
and referenced characteristics. Define and validate expression nodes explicitly;
do not accept arbitrary string expressions or JavaScript. Fixed numeric amounts are
the initial implementation slice. Every instruction must define whether selected
recipients are affected simultaneously or sequentially; do not assume a loop is
rules-equivalent to a simultaneous action.

## Triggered and activated abilities

The existing trigger builders remain the authoring surface. Their instructions become
parameterized independently from their event filters:

```ts
enters({ filter: { token: true, controller: 'you' }, createdOnly: true },
  loseLife({ amount: 1, to: players({ relation: 'opponent' }) }))

draws({ player: 'opponent', nthThisTurn: 2 },
  damage({ amount: 1, to: ref('triggering.player'), source: ref('source') }))
```

Trigger filters inspect the event participants; instruction selectors inspect the
recipients. These need not be the same group. Each matching occurrence queues its own
ability and retains stable trigger-frequency identity. Intervening-if conditions are
checked at trigger time and again at resolution; conditions that only decide whether
to trigger must have a distinct representation.

Activated abilities continue to declare costs separately from their instructions.
Paying a cost is not an optional resolution action. Mana abilities retain their special
timing rather than become normal stack abilities.

## Replacements, prevention, and static modifiers

Replacement rules match a proposed event and produce a typed transformation. They do
not queue a triggered ability or perform side effects while testing applicability.

```ts
replacement({ event: 'draw', player: 'you' },
  replaceWith([mill({ count: 1, for: ref('event.player') })]))

prevention({ event: 'damage', to: players({ relation: 'you' }) },
  prevent({ amount: 2 }))

staticEffect({ objects: objects({ type: 'Creature', controller: 'you' }) },
  modifyStats({ power: 1, toughness: 1 }))
```

Optional replacements and multiple applicable replacements require the appropriate
player's choice. Re-evaluate applicability after each transformation and prevent the
same replacement from applying repeatedly to the same event. The current kernel's
sorted replacement loop is an implementation constraint, not the proposed semantics
for player-selected replacement order. Prevention shields need duration and remaining
capacity; continuous effects need layer, dependency, duration, and source-lifetime
semantics. These cannot be collapsed into one generic `do` list.

## Implementation sequence and acceptance checks

1. Add typed player selectors and fixed-amount life-loss/life-gain/damage recipients.
   Preserve existing wrappers and verify correct events, source/controller retention,
   source removal, lost players, and non-targeted versus targeted behavior.
2. Add reusable participant references and amount expressions. Test zone changes,
   last-known information, journal replay, and hidden-information projections.
3. Standardize the remaining instructions without erasing destroy/sacrifice or
   simultaneous/sequential distinctions.
4. Add declarative replacement and prevention transformations after implementing
   player-selected replacement ordering. Test replaced events never trigger as if
   they occurred, competing replacements, optional choices, and prevention exhaustion.
5. Consolidate static modifiers around the existing layer machinery.

Use focused integration tests for observable game behavior at each slice. Continue
running the full rules-engine suite and relevant live-runner checks. Card definitions
should remain concise, but a smaller DSL must never change the underlying game action.
