# Configurable rule model and client/server contract

Status: API specification with an implemented first slice. Shared trigger builders,
object filters, player predicates/selectors, and fixed-amount life-loss, life-gain,
and player damage instructions exist. General participant references, object
selectors, amount expressions, unified target clauses, the interaction envelope,
replacement transformations, and consolidated static builders below are proposed.
This document specifies desired behavior; it does not claim the current kernel
already implements every lifecycle rule.

Examples marked **current API** use existing builders; explicitly identified
existing-event examples retain their current wire shape. Other schemas and
examples are **proposed DSL**: illustrative authoring syntax for typed, serializable
nodes, not imports that can be used today. Names are the intended vocabulary;
implementation slices must define concrete discriminated unions and validation.

## 1. Purpose and boundaries

A card describes rules. The server executes those rules against authoritative
state. A human client or an agent supplies decisions; it does not supply arbitrary
effects or decide whether its own decisions are legal.

For a fully specified cast or activation, the server receives the targets, modes,
X, and cost-payment decisions and runs without an interactive target picker.
However, it still needs the target **requirements** to validate those supplied
targets and check them again at resolution. For a triggered ability or a decision
encountered during resolution, the server can return a typed request and suspend.
A headless driver answers the same requests as the browser.

Keep four distinct concepts:

- **Selector:** describes players or objects to inspect or affect.
- **Instruction:** describes an action during resolution.
- **Ability:** describes how a card's rules function, including static abilities.
- **Modifier:** transforms a proposed event (replacement/prevention) or continuously
  changes characteristics or rules (static effect).

Definitions must be typed, versioned, serializable data. Builders produce that
data; callbacks, captured runtime objects, arbitrary executable predicates, and
hard-coded card-name dispatch checks do not belong in saved definitions.
Oracle wording that explicitly names a card may use a typed name predicate.
Existing helpers become compatibility wrappers.

## 2. Vocabulary

| Term | Meaning in this DSL |
| --- | --- |
| Card definition | Versioned ability declarations for one card, separate from its live instances and Oracle metadata. |
| Source | The object from which an ability or modifier originates; retain identity and relevant last-known information. |
| Owner / controller | Owner is the player who owns the object; controller can change. An ability has its own controller. |
| Ability definition | Reusable declaration of how a card rule functions and which effects it creates or instructions it executes. |
| Spell program | Instructions of a resolving spell; part of that spell, not a new triggered ability. |
| Proposed event | A game action that is about to happen and can still be replaced or prevented. |
| Occurrence | What actually happened, with before/after information; used for trigger matching. |
| Trigger | A pattern matching an occurrence or specified game condition, creating a pending ability instance. |
| Pending trigger | Captured ability instance waiting for the next time a player would receive priority. |
| Stack item | One independently resolvable spell or non-mana activated/triggered ability. |
| Priority | Permission to take ordinary instant-speed actions, subject to their restrictions. |
| Filter | Typed predicate over one domain; it does not request a choice or imply targeting. |
| Selector | A query returning the matching group at its defined evaluation time. |
| Reference | A binding to a particular player, object incarnation, stack item, event participant, or earlier choice. |
| Target clause | Named requirements for one occurrence of targeting, including domain and cardinality. |
| Target binding | The recipients actually chosen for a target clause when the item is announced. |
| Choice | A player decision; only choices explicitly declared as targets use targeting rules. |
| Cost | Something paid while casting/activating, or an explicitly offered payment during resolution. |
| Instruction | A typed action or structured control-flow node, interpreted by the server. |
| Replacement | A transformation applied before an event occurs; the replaced event does not happen. |
| Prevention | A damage-specific modifier, often with a duration and a consumable shield. |
| Static effect | A continuously applicable modifier, using layers/dependencies and source lifetime. |
| Continuation | Serializable server state recording exactly where execution resumes after a decision. |
| State-based action (SBA) | Rules maintenance checked at designated checkpoints, such as a creature dying from lethal damage. |
| APNAP | Active player, then nonactive players in turn order; each orders their own waiting triggers. |

A **trigger triggers an ability instance**, not its instructions immediately.
That ability normally enters the stack later and executes its instructions only
when it resolves. Replacement and static effects do not create stack items merely
by applying.

## 3. Definition structure

The proposed serialized root is:

```ts
type CardRuleDefinition = {
  schemaVersion: 1
  abilities: AbilityDefinition[]
}

type AbilityDefinition = (
  | {
      kind: 'spell'
      announcement: AnnouncementSpec
      instructions: Instruction[]
    }
  | {
      kind: 'activated'
      availableFrom: Zone[]
      timing: ActivationTiming
      announcement: AnnouncementSpec
      costs: Cost[]
      instructions: Instruction[]
    }
  | {
      kind: 'triggered'
      activeIn: Zone[]
      on: OccurrencePattern
      triggerOnlyIf?: Condition
      interveningIf?: Condition
      frequency?: TriggerFrequency
      announcement: AnnouncementSpec
      instructions: Instruction[]
    }
  | {
      kind: 'static'
      activeIn: Zone[]
      effects: ContinuousEffectDefinition[]
    }
  | {
      kind: 'keyword'
      keyword: Keyword
    }
) & { id?: string } // Optional author label; the compiler supplies internal identity.

type AnnouncementSpec = {
  modes?: ModeSpec
  variables?: VariableSpec[]
  targets: TargetClause[]
  distributions?: DistributionSpec[]
}

type ContinuousEffectDefinition =
  | CharacteristicModifierDefinition
  | RuleRestrictionDefinition
  | ReplacementDefinition
  | PreventionDefinition

type ActivationFilter = {
  abilitySource?: ObjectFilter
  ability?: ActivatedAbilityFilter
  activator?: PlayerFilter
}

type RuleRestrictionDefinition = {
  kind: 'prohibitActivation'
  filter: ActivationFilter
}
```

The authored definition has one abilities list: static abilities are abilities
too. A static ability generates continuous effects; a triggered or activated
ability normally executes instructions when it resolves. Replacement and
prevention describe effect behavior, not additional top-level ability kinds.
The engine may compile these declarations into separate internal execution lists.

The registry associates a card name with its definition (and can resolve that
name to its Scryfall Oracle ID). No redundant card-definition ID is required.
Card characteristics such as mana cost, types, and printed power/toughness come
from the separate card metadata. Keyword declarations expand through a shared,
typed keyword catalogue; parameterized keywords need explicit typed parameters.

The referenced types are separate closed unions, not arbitrary JSON or strings
that the engine evaluates as code. Optional announcement fields are absent when
unused; `targets: []` explicitly means no targeting clauses. Spell casting costs,
alternative/additional costs, traits, and casting permissions belong to casting
metadata composed with the spell program; they are not resolution instructions.

`kind: 'spell'` is a DSL carrier for spell instructions. It is not a Magic
triggered ability called "when this resolves." Permanent spells normally use the
kernel's permanent-resolution procedure; their entry triggers are separate
abilities. A targeted entry trigger therefore does not make the creature spell
itself targeted. Aura spells and keyword-defined targeting are exceptions that
need casting target clauses.

Activated and triggered mana abilities retain their CR 605 classification and
special execution path. The compiler must validate mana-ability eligibility;
"contains addMana" alone is insufficient. Mana abilities do not enter the stack
and cannot be responded to or countered.

### Serialized nodes and authoring builders

Builder calls are conveniences over a canonical data tree. For example,
`players({ relation: 'opponent' })` produces a player-selector node rather than a
function that queries the current game. A minimal part of the proposed tree is:

```ts
type Selector =
  | { kind: 'players'; filter: PlayerFilter }
  | { kind: 'objects'; filter: ObjectFilter }
  | { kind: 'stackItems'; filter: StackItemFilter }

type Reference =
  | { kind: 'contextRef'; name: ContextBinding }
  | { kind: 'targetRef'; clauseId: string }
  | { kind: 'choiceRef'; choiceId: string }
  | { kind: 'resultRef'; resultId: string; field: ResultField }

type Amount =
  | { kind: 'constant'; value: number }
  | { kind: 'variable'; name: 'X' }
  | { kind: 'eventAmount' }
  | { kind: 'count'; of: Selector }
  | { kind: 'characteristic'; of: Reference; characteristic: NumericCharacteristic;
      information: 'current' | 'currentOrLastKnown' }

type TargetClause = {
  id: string
  candidates: Selector
  min: number
  max: number
  distinct: true // within this clause
}

type TargetBinding = {
  clauseId: string
  recipients: BoundRecipient[]
}

type BoundRecipient =
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'object'; objectId: string; incarnation: number; zone: Zone }
  | { kind: 'stackItem'; stackId: string }

type Instruction =
  | { kind: 'loseLife'; amount: Amount; to: Reference | PlayerSelector }
  | { kind: 'draw'; count: Amount; for: Reference | PlayerSelector }
  | { kind: 'destroy'; objects: Reference | ObjectSelector;
      execution: 'simultaneous' }
  | { kind: 'counter'; item: Reference; bindResult?: string }
  | { kind: 'sequence'; instructions: Instruction[] }
  | { kind: 'if'; condition: Condition; then: Instruction[]; otherwise: Instruction[] }
  // Extend with separately specified action and choice node variants.
```

This is a vocabulary slice, not the exhaustive instruction union. `PlayerSelector`
and `ObjectSelector` narrow `Selector` by domain. `ContextBinding` is an enumerated,
validated binding vocabulary (controller, source, triggering/event participants);
it is not an arbitrary property-access string. Arithmetic extensions need explicit
nodes, rounding, and validation, not expression strings. Cross-clause target
constraints and variable/mode-dependent bounds need further typed variants.

For example, the untargeted loss instruction serializes as:

```json
{
  "kind": "loseLife",
  "amount": { "kind": "constant", "value": 1 },
  "to": { "kind": "players", "filter": { "relation": "opponent" } }
}
```

That instruction contains neither selected seats nor game state. The server
evaluates its selector later in the ability's execution context. By contrast, an
announced target binding is runtime data containing specific recipient identities.

### Stable identity and execution context

Handwritten ability/effect IDs are optional author labels. The compiler gives
every declaration an internal identity, for example a path within an immutable,
versioned definition. A registry card name, a declaration identity, and a runtime
instance identity serve different purposes; none substitutes for a timestamp.
Target, choice, and result binding labels remain explicit where referenced.

Each active effect or ability instance records its source/incarnation, controller,
and a distinct runtime instance identity. This lets two copies coexist and lets
source-bound effects be removed independently. Trigger instances also retain the
originating occurrence. Frequency limits use the specified ability instance and
rule, not every ability with the same display text.

A printed static ability's effect inherits its source's rules timestamp
(CR 613.7a), subject to the granted-ability rules there; effects created during
resolution receive a timestamp when created (CR 613.7b). Use logical rules ordering
rather than wall-clock time, preserve timestamps when recomputing effects, and
apply the rules for new source timestamps, simultaneous timestamps, and
dependencies (CR 613.7–8). Merely adding an effect back to a derived list must not
give it a fresh timestamp.

A stack item's execution context retains:

- The program/definition version and ability ID, source reference and snapshots.
- The controller captured when the ability triggered or was activated; putting a
  waiting trigger on the stack must not overwrite its earlier controller.
- Selected modes, X, cost records, target bindings, and announcement distributions.
- Trigger participants and amounts, instruction results, and resolution choices.

Removing or changing control of a source does not remove its already triggered
or activated ability. The source can still be attributed as dealing damage using
the applicable last-known information (CR 113.7a).

### References, filters, selectors, and amounts

```ts
players({ relation: 'opponent' })
objects({ zone: 'battlefield', type: 'Creature', controller: 'you' })
objects({ any: [{ subtypes: ['Knight'] }, { subtypes: ['Soldier'] }], token: true })

ref('source')
ref('triggering.player')
ref('triggering.object.before')
ref('triggering.object.after')
target('victim')
choice('discarded')
result('payment', 'paid')

amount(2)
variable('X')
eventAmount()
count(objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }))
characteristic(ref('source'), 'power', { information: 'currentOrLastKnown' })
```

`you` is relative to the executing ability's controller. `opponent` uses the
format's opponent relation; other seats are opponents in the current free-for-all
formats. Lost players are excluded from ordinary affected player groups.

Object and player predicates are separate domains. Fields combine with AND;
`all`, `any`, and `not` compose predicates. A selector identifies **all matching
recipients**, unless an explicit choice or target clause requests a subset.

Object references contain `objectId` plus a zone-change incarnation, not just the
reusable ID. A creature that leaves and returns is a new target candidate, not the
original target. Before/after references support explicit zone-change exceptions
under CR 400.7; a general reference must not follow a card forever.

Trigger participants are captured at the occurrence. Ordinary group selectors
and unsnapshotted amount expressions are evaluated when their instruction runs,
after preceding instructions have taken effect. Values that must stay fixed
are explicitly bound at announcement, trigger time, or an earlier instruction.
Hidden characteristics can be read by the server when rules permit, but are not
automatically disclosed to clients.

## 4. Execution lifecycle

The authoritative driver runs until it reaches a player decision, a priority
window, or the end of the game:

```text
announce spell/activation, or collect a pending trigger
    -> complete its modes, targets, distributions, and required costs
    -> finish casting/activation, or put the trigger on the stack
    -> priority checkpoint: SBAs and waiting triggers, then priority
    -> players act or pass
    -> everyone passes in succession: begin resolving the top item
    -> intervening-if check, then whole-item target legality check
    -> instructions -> proposed events -> replacements/prevention -> occurrences
    -> finish resolution and dispose of the spell/ability
    -> priority checkpoint: SBAs and waiting triggers, then priority
```

"Complete announcement" is a rules transaction, not a response window. The
client may assemble a complete proposal before sending it; the server simulates
and validates the ordered casting/activation procedure atomically. An interactive
announcement can have a serializable provisional frame. Cancellation/invalid
payment must not leave half-paid costs, target triggers, or an unfinished cast
in committed state (CR 601.2, 602.2).

For casting, announce modes, optional/alternative costs and X; choose targets;
announce divisions among targets; check legality; determine and lock total cost;
activate permitted mana abilities; pay costs; complete the cast. Casting and
activation can generate occurrences while they are being performed, but their
waiting non-mana triggers do not interrupt announcement.

### Trigger collection and putting abilities on the stack

1. Observe an actual occurrence and match all relevant trigger definitions.
   Entry normally uses resulting information; leaves-the-battlefield and other
   look-back triggers use the relevant before-state (CR 603.6, 603.10).
2. Check `triggerOnlyIf` once. Check `interveningIf` now, and retain it for a
   second check at resolution. These are distinct representations.
3. Capture the source/controller and participants in a pending instance.
4. At the next priority checkpoint, finish applicable SBAs first. Put waiting
   triggers on the stack in CR 603.3b APNAP order, including its separate pass for
   abilities triggered by another ability triggering. Each player chooses the
   order of their own applicable abilities.
5. Choose modes and targets as each trigger is put on the stack. If a required
   legal choice is impossible, remove that ability without executing its program
   (CR 603.3d). Optional zero-target clauses can still be satisfied.
6. Repeat checkpoint processing until stable, then grant priority.

A "may" in an effect usually gives a decision **during resolution**, not permission
to ignore the trigger. Optional triggers still enter the stack and require any
mandatory targets. Only expressly trigger-limited wording affects collection.

Triggers generated during a resolving spell wait until it finishes. Drawing
three cards produces three individual draws and can create three pending
triggers; it does not create three response windows. Triggered mana abilities
are the CR 605 exception.

### Priority is distinct from a choice pause

After a player casts or activates while holding priority, that player receives
priority again after the checkpoint. After resolution, the active player receives
priority after the checkpoint (CR 117.3). Taking a new action breaks the consecutive
pass sequence. When all living players pass in succession, resolve only the top
item; if the stack is empty, advance the appropriate step/phase.

A prompt while announcing, stacking triggers, paying a cost, applying a
replacement, or resolving an instruction does **not** grant ordinary priority.
Do not allow a counterspell merely because the UI displays a dialog. A permitted
mana payment may allow mana abilities; an instruction explicitly permitting
casting can open a nested casting procedure. Neither gives everyone priority
during the parent resolution.

## 5. Targeting and other choices

### Target clauses

Targeting belongs to announcement metadata, separately from instructions:

```ts
targetClause('victim', {
  candidates: objects({ zone: 'battlefield', type: 'Creature' }),
  min: 1,
  max: 1,
})

targetClause('recipients', {
  candidates: objects({ zone: 'battlefield', type: 'Creature' }),
  min: 0,
  max: 2,
})
```

The first means "target creature"; the second means "up to two target creatures."
Each clause represents one occurrence of targeting in the rules text or keyword
definition. Its recipients are distinct within that clause. Separate clauses
may select the same recipient when the text allows it; explicit "another" or
"different" constraints impose cross-clause restrictions. Do not globally reject
every repeated ID across the entire spell.

Candidate filtering is only part of legality. The server checks targeting
restrictions such as shroud, hexproof, protection, and any requirements about
what must be targeted. Ward usually **allows** targeting, then creates a triggered
ability; it is not a candidate exclusion.

Target bindings may refer to players, object incarnations in permitted zones, or
stack items. A counterspell targets a spell on the stack; it does not target the
spell's controller. A stack ability is not a spell. A spell cannot target itself.

Modes determine which target clauses exist. A variable number of targets is
announced and remains fixed; an announcement-time distribution is stored with the
chosen targets. Target-changing effects and copies have their own legal retarget
procedures; instructions do not quietly choose replacements for missing targets.

### When does the client ask?

| Situation | Decision time | Ordinary response window at the picker? |
| --- | --- | --- |
| Targeted instant, sorcery, or Aura spell | During casting, before cost payment completes | No; players can respond after casting/checkpoints. |
| Targeted activated ability | During activation, before cost payment completes | No; players can respond after activation/checkpoints. |
| Targeted triggered ability | When the waiting trigger is put on the stack | No; players can respond after checkpoint processing. |
| "Each opponent loses 1 life" | No choice; evaluate the group at resolution | No picker. |
| "Choose a creature you control" without targeting | When that instruction resolves | No. |
| Discard, sacrifice, search, scry, or optional payment | At the cost/instruction that calls for it | No. |
| Competing or optional replacement effects | Immediately before the affected event | No. |
| Change targets or copy with new targets | During the relevant effect's resolution | No; later priority allows responses to remaining items. |
| Reflexive "when you do" ability | New targets when that new trigger enters the stack | A response window follows the parent resolution/checkpoint. |

An instruction's selector is not a target clause. "Destroy all creatures" does not
ask for targets and is not stopped by hexproof/shroud. Protection may still matter
for a non-targeted action such as damage; bypassing targeting restrictions does
not bypass every protection rule.

Existing `targetOnResolve` / `targetsOnResolve` names describe effects on targets
at resolution. They must not be read as permission to select those targets then.
Existing `onResolve` stores a legacy trigger-shaped node; its spell program must
not produce a second "resolution trigger" with another response window.

## 6. Counterspells, illegal targets, and resolution outcomes

Countering is an instruction directed at a stack item. A counterspell is first
cast with a legal target, gets its own stack item, and can itself be responded to
or countered. When it resolves, check its targets, then attempt to counter the
bound item. Countering removes that item without executing its instructions;
a countered spell normally goes to its owner's graveyard (subject to rules,
replacement effects, and explicit destination changes). Paid costs stay paid.

A "counter target spell" filter excludes activated/triggered abilities. An effect
that counters an ability uses a different stack filter. Mana abilities are absent
from the stack and cannot be targets for either.

An uncounterable spell is normally still a legal target for a counterspell.
The counter instruction fails, but independent later instructions can still
happen. For "Counter target spell. Draw a card," the draw happens if the targeted
uncounterable spell remains legal. For "If that spell is countered this way,"
branch on the counter action's typed result instead.

### The whole-item legality gate

At the start of resolution, check an intervening-if condition first, then all
chosen targets across every active target clause (CR 608.2a–b).

| State at the legality gate | Outcome |
| --- | --- |
| At least one target was chosen, and every chosen target is illegal | The entire spell/ability does not resolve; none of its instructions run. |
| At least one chosen target is legal | Resolve; illegal targets are not affected for the clauses for which they are illegal, and required information about them is unavailable. |
| Zero targets were legally chosen for optional clauses | Resolve normally; there is no all-illegal-target failure. |
| No target clauses exist | No target failure gate; instructions can still be impossible. |
| Intervening-if condition is false | Remove the triggered ability without executing instructions. |

"Fizzle" is an informal client label for the all-illegal-target case. Represent it
as `didNotResolve: allTargetsIllegal`, separately from `countered`. Current rules
say such an item does not resolve; this is not a successful counter action, and
"can't be countered" does not prevent this outcome. Spells normally go to their
owner's graveyard; apply relevant destination rules/replacements.

Legality is checked for the item, not independently as an excuse to skip entire
instruction blocks. With one legal target remaining, execute independent
instructions and follow the text's dependencies. Preserve per-clause validity:
one object can be legal for one clause and illegal for another. Do not read an
illegal target's old characteristics to invent information CR 608.2b withholds.

Do not open a new picker to rescue illegal targets. Only an explicit retargeting
effect can change them. Leaving a zone and returning does not restore the original
target's legality. Source removal alone does not make an ability fail.

### Failure to perform an action is different

If the target creature is still legal but indestructible, "Destroy target creature.
Draw a card" resolves and draws. If the sole target left the battlefield before
resolution, the spell does not resolve and does not draw. Damage being prevented
also does not mean a spell failed to resolve.

Follow instructions in order and do as much as possible. `then` denotes sequence,
not an automatic success dependency. `if you do` and `when you do` need explicit,
action-specific success/payment semantics; do not infer them from a count of
cards that reached a zone. A replaced cost event can still count as paying the
cost. A reflexive `when you do` creates a separate triggered ability, whereas
`if you do` normally controls the continuing resolution.

A copied spell normally is not cast and therefore does not create cast triggers.
Copies preserve modes, X, and target bindings unless the copying effect permits
changes. "Choose new targets" may retain unchanged targets that have since become
illegal; any new targets must satisfy the CR 115.7 procedure. A card copy that is
explicitly cast does use the normal casting lifecycle.

## 7. Instructions and event processing

Use one configurable primitive per game action rather than one helper per
recipient combination:

```ts
loseLife({ amount: 1, to: players({ relation: 'opponent' }) })
gainLife({ amount: 2, to: players({ relation: 'you' }) })
damage({ amount: 1, to: target('victim'), source: ref('source') })
draw({ count: 1, for: ref('triggering.player') })
move({ objects: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), to: 'exile' })
destroy({ objects: target('victim') })
sacrifice({ objects: choice('offering'), by: ref('controller') })
counter({ item: target('spell'), bindResult: 'counterResult' })
```

Instructions propose semantic actions, not direct state edits. Handlers enforce
rules, expand actions into appropriate events, apply modifiers, commit state, and
produce occurrences. Damage keeps its source and uses prevention, lifelink,
infect, protection, and format rules. Life loss does not dispatch a damage event.
Destroy and sacrifice remain distinct from a plain move to the graveyard.

Each instruction contract defines recipient timing, amount evaluation, result
bindings, and **simultaneous versus sequential** behavior. Do not use an ordinary
loop to approximate destroying all creatures simultaneously. Resolve preceding
events before evaluating a later instruction that depends on their results.

Drawing several cards has a parent draw instruction and individual draw events.
Apply applicable count-level replacements before per-card processing (CR 121.2a,
616.1g); process each actual draw separately. If several players draw, use CR
121.2c turn order. Pending draw triggers wait until the enclosing resolution ends.

### Resolution frame and checkpoints

Execution uses a serializable resolution frame: current item, instruction cursor,
nested control-flow frames, choices/results, pending event, and any continuation.
While a decision is pending, the server stops at that point. It does not rerun the
whole instruction list, replay already-paid costs, or dispose of the resolving
spell early.

Commit game events in their rules order, but defer ordinary SBA processing and
stacking non-mana triggers until the relevant priority checkpoint. A creature
temporarily at 0 toughness can survive if a later instruction raises its toughness
before that checkpoint; lethal damage similarly does not cause an immediate SBA
between sentences. Explicit instructions such as sacrifice still execute at their
written position. A choice suspension is still inside the same resolution.

Do not counter a partly resolving item through a new priority action. If it
leaves the stack after beginning a legal resolution, it can still finish resolving
under CR 608.2m. Normal spell completion, countering, and failing to resolve each
use their own disposal procedure; an Aura with an illegal target is not put onto
the battlefield.

## 8. Replacement, prevention, and static modifiers

### Replacement pipeline

For each semantic event that is about to happen:

1. Construct the proposal with participants, source/controller, amount, destination,
   simultaneity grouping, and an event lineage ID.
2. Discover applicable replacement/prevention instances without changing state.
   Entry proposals must use the CR 614.12 prospective characteristics when needed.
3. Apply the CR 616 precedence categories: self-replacements first, then applicable
   entry-control, copy-as-entry, and back-face entry replacements before the general
   category. These are rules categories, not timestamp ordering.
4. If a choice exists, ask the affected player or affected object's controller
   (owner if it has no controller), or the chooser explicitly required by the rule.
   For simultaneous decisions, use APNAP. The replacement's controller is not
   automatically the chooser.
5. Apply one typed transformation. Record that replacement instance as used for
   this event and any modified events descended from it. Re-evaluate applicability.
6. When settled, commit the final event(s), preserving required simultaneity, and
   collect triggers from actual occurrences. No ordinary priority opens here.

A replacement can modify fields, substitute a typed action program, redirect an
event, or suppress it. Its applicability predicate is pure; any payment/selection
belongs to its declared application procedure. Optional application asks at this
point, not when a replacement source entered the battlefield. Repeated discovery
must not re-prompt an already settled optional decision for the same opportunity.

A replaced or fully prevented event did not occur. Do not fire "whenever you draw"
for a draw replaced with milling, or "dies" for a battlefield-to-graveyard move
replaced with exile. Replacement-generated actions can themselves be replaced and
generate triggers from what actually happens. Replacements may apply to events
caused by other replacements, but the same instance cannot invoke itself repeatedly
on that event or its modified descendants (CR 614.5).

Separate semantic event lineage from diagnostic low-level event expansion. A
damage action that updates life is not permission to apply a damage replacement
twice or observe two damage occurrences. Trace proposed/replaced/prevented/applied
stages for debugging, but only completed rules occurrences feed ordinary triggers.
Genuinely new independent actions get their own replacement opportunities.

Record parent semantic actions separately from replaceable component events. A
sacrifice with a replaced graveyard destination can still be a sacrifice and a
paid cost, while not being a death. Similarly, countering can succeed when the
countered spell's destination is replaced with exile. Do not equate every parent
action's success with whether its original component move occurred.

### Proposed continuous-effect forms

Static abilities declare effects that apply while the ability functions. A spell
or activated/triggered ability can instead create a continuous effect during
resolution, with its own explicit duration. These examples are proposed builders:

```ts
staticAbility(
  replacement({
    event: { kind: 'draw', player: 'you' }, // one proposed card draw
    optional: true,
  }, replaceWith([
    mill({ count: 1, for: ref('event.player') }),
  ])),
)

staticAbility(
  replacement({
    event: { kind: 'enterBattlefield', object: ref('source') },
  }, modifyEvent({ tapped: true })),
)

createEffect({
  duration: 'untilEndOfTurn',
  effect: prevention({
    to: players({ relation: 'you' }),
    capacity: 2,
  }, preventDamage()),
})

staticAbility(
  modifyStats({
    objects: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }),
    power: 1,
    toughness: 1,
  }),
)
```

The primitive's contract determines its rules category and, for characteristic
changes, its layer/sublayer. For example, `modifyStats` adds a power/toughness
modifier, while `prohibitActivation` supplies an action-legality restriction.
Authors do not repeat a redundant `category` field. Operations with materially
different semantics need distinct typed variants; the engine must not infer them
from card names or prose.

For a printed static ability, its effect lifetime follows the ability. The
authoring builder defaults `activeIn` to `['battlefield']` and expands that default
in serialized data. This is semantic scope, not an optimization; overrides are
needed when a source ability functions in another zone. Self-entry replacements
are also considered prospectively under CR 614.12, before entry is committed.

For effects created during resolution, the proposed duration vocabulary begins
with `untilEndOfTurn`, `untilSourceLeaves`, and `indefinite`, plus typed player/turn/
step deadlines. Specify the exact expiration checkpoint and source incarnation;
`indefinite` means no duration-based expiry, not persistence between games.
Do not require `duration: 'whileSourceActive'` on every printed static ability.

An "as this enters, choose a color" replacement asks before entry is committed,
stores the choice, and lets the permanent enter with that information. It is not
an entry trigger, and nobody can respond between that choice and entry. By
contrast, "when this enters, choose a color" creates a normal triggered ability.

Prevention shields have remaining capacity and duration. Preventing 2 of 3 damage
leaves a 1-damage occurrence. Two damage instances consume the same shield according
to the applicable rules. For simultaneous sources, the appropriate player chooses
shield allocation. Unpreventable damage does not consume a shield; applicable
prevention effects can still have additional effects under CR 615.12.

Static modifiers continuously recompute characteristics/rules using layers,
timestamps, dependencies, and exceptions such as characteristic-defining
abilities. They do not enqueue a pump instruction on each event. A source-based
static bonus normally ends when its source is no longer active; an already created
"until end of turn" effect can outlive its source. Replacement/prevention/static
declarations cannot be collapsed into one generic `do` list.

## 9. Client/server interaction protocol

The browser needs declarative choice information, not card-specific guesses about
Oracle text. It may use the public DSL to preview an announcement form, but the
authoritative server/host provides current legal candidates, constraints, and the
reason execution is waiting. Never infer hidden candidates from projected state.

### Proposed interaction envelope

```ts
type InteractionRequest = {
  id: string
  revision: number
  chooser: PlayerId
  source: PublicSourceLabel
  phase: 'announcement' | 'triggerPlacement' | 'resolution' | 'replacement'
  purpose: 'target' | 'choice' | 'cost' | 'order' | 'replacement' | 'optional'
  cancellation: 'cancelProposal' | 'mustAnswer'
  selection: SelectionOffer
}

type SelectionOffer =
  | { kind: 'selectCards'; bindingId: string; candidates: VisibleObjectRef[];
      min: number; max: number; distinct: boolean }
  | { kind: 'selectPlayers'; bindingId: string; candidates: PlayerId[];
      min: number; max: number; distinct: boolean }
  | { kind: 'selectTargets'; clauses: TargetClauseOffer[];
      constraints: TargetConstraintOffer[] }
  | { kind: 'selectOptions'; options: OptionOffer[]; min: number; max: number }
  | { kind: 'order'; entries: PublicEntryRef[] }
  | { kind: 'allocate'; entries: AllocationEntry[]; total: number; minEach: number }

type DriverOutcome =
  | { kind: 'needsInput'; request: InteractionRequest }
  | { kind: 'priority'; holder: PlayerId; actions: PublicActionOffer[] }
  | { kind: 'ended'; result: GameResult }
```

These are proposed transport contracts, not current event type declarations.
`VisibleObjectRef` carries an authorized identity/incarnation and only information
the chooser may see; hidden objects can use opaque handles where appropriate.
The server-owned continuation is not an executable payload accepted from the
client. Presentation labels can be localized; binding/option IDs are stable.

`selectTargets` is a proposed heterogeneous envelope for players, objects, and
stack items. Card picking must use typed `selectCards` events, and player picking
uses typed `selectPlayers` events, including target choices when adapted to these
existing paths. Do not encode a card picker as `custom`. A future typed stack/mixed
target response requires its own validated schema; until implemented, use explicit
adapters to existing command paths, not arbitrary events from the browser.

The `purpose` field distinguishes a target picker from an untargeted card choice
even when both use the same card-selection UI. `phase` distinguishes pre-stack
binding from a suspended resolution. None of these requests constitutes priority.
The existing implementation sometimes stores a chooser in `state.priority`;
the host must honor pending-choice state first. The proposed protocol makes
"who must answer" and "who has ordinary priority" separate facts.

### Cast/activate flow with supplied targets

1. The user selects an available action. The client displays mode/X/target/payment
   requirements using the definition and a server-provided offer.
2. If desired, `prepareAction` is a proposed read-only server call that evaluates
   the partial proposal and returns the next requirements and candidates.
   It does not publish a cast, spend mana, or give opponents a response opportunity.
3. The client submits one complete `castSpell` / `activateAbility` proposal with
   bound decisions. Existing commands use target arrays; a future adapter maps
   named clauses to those positions. Do not silently change wire formats.
4. The server validates timing, modes, candidates, cross-clause constraints,
   distributions, costs, and object incarnations against authoritative state.
   Reject stale/illegal proposals without partially applying them.
5. After a successful announcement/checkpoint, publish the stack and priority
   outcome. Clients now enable response actions for the priority holder.

A submitted complete proposal needs no target-selection round trip. Automatically
choosing the sole legal recipient is acceptable when no alternative exists.
Optional zero-or-one targets, may payments, and trigger/replacement ordering remain
decisions even if one recipient is available.

### Trigger/resolution/replacement choice flow

1. Execution reaches a required unsupplied choice. Persist its continuation and
   expose `needsInput` to the chooser; other seats receive a waiting indicator.
2. Only that seat's UI opens the picker. Show the permitted candidates, cardinality,
   allocation/order requirements, and whether this is targeting or another choice.
3. Submit the typed response with request/selection ID, chooser, revision, and
   selected reference/option IDs. IDs, not card names, identify namesakes.
4. The server validates authorization, request freshness, constraints, and relevant
   legality. An invalid answer leaves the pending request and continuation intact.
5. Consume a valid answer exactly once and resume from the stored cursor. Publish
   another request, a priority window, or game completion.

A reconnect receives the same pending request and authorized view. Duplicate
answers cannot pay twice or rerun effects; stale answers are rejected or receive
an idempotent acknowledgement of the recorded outcome. Do not resolve the next
stack item while a choice for the current frame remains open.

Only uncommitted player proposals are cancellable. Once cast/activated, the item
cannot be taken back through the picker. A pending mandatory trigger or resolution
choice is not dismissed by closing a dialog. If declining is legal, offer an
explicit decline/zero-selection decision.

### A concrete player-target prompt

For an entry trigger that targets an opponent, a proposed request might be:

```json
{
  "id": "player-selection-42",
  "revision": 17,
  "chooser": "p1",
  "source": { "name": "Example entry ability" },
  "phase": "triggerPlacement",
  "purpose": "target",
  "cancellation": "mustAnswer",
  "selection": {
    "kind": "selectPlayers",
    "bindingId": "opponent",
    "candidates": ["p2", "p3", "p4"],
    "min": 1,
    "max": 1,
    "distinct": true
  }
}
```

The client renders a player picker for p1 and a waiting indicator for everyone
else. Choosing p3 maps to the existing kernel event shape:

```json
{
  "type": "selectPlayers",
  "seat": "p1",
  "selectionId": "player-selection-42",
  "players": ["p3"]
}
```

The proposed transport wrapper supplies revision/authorization metadata; the
existing `selectPlayers` event does not itself have a `revision` field. The host
adapter validates that wrapper, then submits the typed event. The server binds p3
to `opponent` and continues checkpoint processing. Clients enable counterspell
responses only after receiving a subsequent `priority` outcome.

### Visibility, replay, and agent parity

The server owns hidden hands, library order, random outcomes, and every
continuation. Send each seat only identities it may see: a searching player can
receive eligible library faces while opponents get a waiting message and permitted
public consequences. A private choice does not become public merely because it
appears in a prompt. Public targeting is announced as required by the rules.

Journal definitions/version IDs, authoritative decisions, event lineage, and
random outcomes so a replay resumes deterministically. Redact choices and traces
for each viewer. Public client projections may omit executable context containing
secrets; reconnect restores that context on the server. The browser, bot, and
headless simulation answer the same decision contracts.

## 10. Worked examples

Examples A–I use hypothetical Oracle-style wording. Examples J–K use linked,
verified Oracle text. New builder syntax remains proposed, not implemented card
support.

### A. Token entry causes untargeted life loss

**Current API:**

```ts
enters({ filter: { token: true, controller: 'you' }, createdOnly: true },
  loseLife({ amount: 1, to: players({ relation: 'opponent' }) }))
```

Creating a matching token captures a trigger. At the next checkpoint its controller
puts the ability on the stack; no targets are requested. Players can respond.
On resolution, every current living opponent loses 1 life. Removing the source
does not stop the queued ability or change what `you` means. Damage prevention
does not prevent this life loss.

### B. Entry trigger with a target

**Proposed DSL:** "When this creature enters, destroy target creature."

```ts
triggered({
  id: 'entry-removal',
  on: entersOccurrence({ object: ref('source') }),
  announcement: {
    targets: [targetClause('victim', {
      candidates: objects({ zone: 'battlefield', type: 'Creature' }),
      min: 1, max: 1,
    })],
  },
  instructions: [destroy({ objects: target('victim') })],
})
```

The creature spell needs no target for this ability. It resolves and enters; the
trigger is captured. At the checkpoint the server requests a target, binds it,
and completes trigger placement. Only then is ordinary priority available.
A counterspell that counters spells can stop the creature spell before entry,
but cannot counter this triggered ability. An ability-countering effect can stop
the trigger. If its target later leaves, the trigger does not resolve.

### C. Partial target loss and "fizzle"

**Proposed DSL:** "Destroy up to two target creatures. Draw a card."

```ts
spell({
  id: 'remove-and-draw',
  announcement: {
    targets: [targetClause('victims', {
      candidates: objects({ zone: 'battlefield', type: 'Creature' }),
      min: 0, max: 2,
    })],
  },
  instructions: [
    destroy({ objects: target('victims'), execution: 'simultaneous' }),
    draw({ count: 1, for: ref('controller') }),
  ],
})
```

Choose two creatures during casting. If one leaves, the other is still legal:
attempt to destroy it, then draw. If both leave, no instructions run, including
the draw. Choosing zero targets at casting is legal and still draws. If both are
legal but indestructible, destruction fails and the draw still happens. The
server never asks for replacement targets at resolution.

### D. Counterspell and ward

**Proposed DSL:** "Counter target spell. Draw a card."

```ts
spell({
  id: 'counter-and-draw',
  announcement: {
    targets: [targetClause('spell', {
      candidates: stackItems({ kind: 'spell', other: true }),
      min: 1, max: 1,
    })],
  },
  instructions: [
    counter({ item: target('spell'), bindResult: 'counterResult' }),
    draw({ count: 1, for: ref('controller') }),
  ],
})
```

A casts a removal spell; B casts this targeting it; A can cast another
counterspell targeting B's spell. Resolve the stack from the top as players pass.
If B's spell resolves while its target is still legal, it counters that spell and
draws. If the target is uncounterable, B still draws. If the target has already
left the stack, B's spell has no legal targets and does not resolve or draw.

Ward is a separate case: an opponent's removal targets a ward creature legally.
Ward triggers and is put above the removal at the checkpoint. Players can respond
to ward. When ward resolves, the removal's controller may pay the ward cost,
using permitted mana abilities; other players cannot cast spells in that payment
pause. If unpaid, ward attempts to counter the removal. It cannot counter an
uncounterable removal. Targeting the ward ability with an ability-countering
effect can stop ward itself.

### E. Untargeted choice during resolution

**Proposed DSL:** "Draw a card, then discard a card."

```ts
sequence(
  draw({ count: 1, for: ref('controller') }),
  chooseCards({
    id: 'discarded',
    chooser: ref('controller'),
    from: objects({ zone: 'hand', owner: 'you' }),
    min: 1, max: 1,
    whenInsufficient: 'chooseAvailable',
  }),
  discard({ cards: choice('discarded'), by: ref('controller') }),
)
```

Commit the draw first, including any replacement. Then offer the resulting hand
to its player through `selectCards`. Opponents see a waiting indicator, not that
hand. The server saves the remaining instructions and resumes with the validated
selection. No counterspell can be cast at this discard pause, and pending draw
triggers enter the stack only after the whole spell finishes. If there are no
cards available, carry out as much as possible without an impossible picker.

### F. Reflexive trigger creates a later target decision

**Proposed DSL:** "You may sacrifice a creature. When you do, destroy target creature."

```ts
optionalCost({
  id: 'offering',
  payer: ref('controller'),
  cost: sacrificeCost({ type: 'Creature', controller: 'you', count: 1 }),
  whenPaid: reflexiveTrigger({
    id: 'offering-removal',
    announcement: {
      targets: [targetClause('victim', {
        candidates: objects({ zone: 'battlefield', type: 'Creature' }),
        min: 1, max: 1,
      })],
    },
    instructions: [destroy({ objects: target('victim') })],
  }),
})
```

The original item asks about sacrifice during resolution, without targeting the
offering. Declining creates no reflexive trigger. Paying captures that trigger;
after the parent resolution/checkpoint, choose its destruction target and put it
on the stack. Players can now respond to the new ability. Do not ask for its
target when casting the original spell. A replacement that exiles the sacrificed
permanent instead of sending it to the graveyard does not inherently undo payment
of the sacrifice cost; use the cost's CR payment semantics.

### G. A replaced draw changes which triggers exist

Use the optional draw-to-mill replacement from section 8. During "Draw two cards,"
the first one-card draw proposal pauses for the drawing player's replacement
choice. If accepted, mill one instead. Apply replacements to the resulting
action, then collect any actual mill/zone-change triggers; collect no draw trigger
for that replaced draw. Continue to the second draw proposal. This is another
replacement opportunity. Finish the spell before stacking the pending non-mana
triggers. A counterspell cannot be cast between these replacement decisions.

### H. Competing damage modifiers

Suppose A would take 3 damage, one applicable replacement doubles that damage,
and A has a shield preventing the next 2 damage. In the general CR 616 category,
A chooses which to apply first:

| Chosen order | Settled damage |
| --- | --- |
| Double, then prevent 2 | 6 becomes 4 damage. |
| Prevent 2, then double the remaining 1 | 1 becomes 2 damage. |

Re-evaluate after each application, keep each instance used once for that lineage,
and consume shield capacity only for damage actually prevented. A UI request here
is an order/application choice, not a triggered ability or priority window.
Damage-based effects use the settled damage occurrence. An event-specific
restriction or CR precedence category can remove an otherwise available order.

### I. Entry modifiers precede entry triggers

A permanent has "As this enters, choose a color" and "When this enters, draw a card."
Resolve the permanent spell to an entry proposal. Ask for the color as part of
the replacement application and store it before entry. Commit entry, then capture
the draw trigger using the entering permanent's completed characteristics.
Finish resolution/checkpoints and put that trigger on the stack. If another
replacement prevents entry entirely, there is no entry trigger.

### J. Stony Silence: a static activation restriction

[Stony Silence](https://scryfall.com/card/mm3/25/stony-silence) is an enchantment
costing {1}{W}. Its Oracle text is "Activated abilities of artifacts can't be
activated."

**Proposed authoring DSL:**

```ts
const stonySilence: CardRuleDefinition = {
  schemaVersion: 1,
  abilities: [
    staticAbility(
      prohibitActivation({
        filter: {
          abilitySource: {
            zone: 'battlefield',
            type: 'Artifact',
          },
        },
      }),
    ),
  ],
}

cardRules.set('Stony Silence', stonySilence)
```

The registry supplies card identity; the definition does not duplicate it.
`staticAbility` expands to `{ kind: 'static', activeIn: ['battlefield'], effects: [...] }`.
`prohibitActivation` expands to a typed `{ kind: 'prohibitActivation', filter: ... }`
effect. These are data-producing builders, not callbacks that execute card rules.

Here `abilitySource` is the source of the **attempted activation**, not Stony
Silence. The omitted ability/activator filters mean every activated ability of
every matching permanent, including mana abilities and abilities of your own
artifacts. Narrower restrictions can use `ability` and `activator` predicates
within the same typed activation filter.

This contains enough card-specific information when the shared engine contracts
are implemented:

- `staticAbility` functions on the battlefield by default. Its effects stop when
  that source ability ceases to function, including source departure, phasing out,
  or ability removal. A second copy can still supply its own restriction.
- `prohibitActivation` checks legality **before an activation begins or costs are
  paid**, using the ability source's current characteristics after the applicable
  continuous effects. It does not remove the artifact's abilities.
- All activation paths use that check, including activated mana abilities and
  the current `tapForMana` shortcut. Mana planning cannot count prohibited
  activations as available payment sources.
- The engine supplies source/incarnation references, distinct runtime effect
  identities, and rules timestamps. Recomputing the restriction does not create
  a new timestamp.
- The client's available actions use the same permission results. There is no
  target picker or additional duration field for this card.

Casting Stony Silence is an ordinary untargeted enchantment cast. Players can
respond before it resolves, including activating artifacts while still allowed.
Once it enters, the restriction applies without an entry trigger. Existing
abilities on the stack continue; triggered/static artifact abilities and
activations from other zones, such as cycling from hand, are unaffected.

This is a continuous game-rule restriction, not a replacement/prevention of an
activation event. Its shared primitive rejects prohibited actions rather than
accepting an activation, spending costs, and then suppressing its result.

### K. Duskdale Wurm: a keyword ability

[Duskdale Wurm](https://scryfall.com/card/ima/161/duskdale-wurm) costs {5}{G}{G} and
is a 7/7 Creature — Wurm with Trample. Mana cost, types, and printed stats come
from card metadata; its rule definition declares the keyword.

**Proposed authoring DSL:**

```ts
const duskdaleWurm: CardRuleDefinition = {
  schemaVersion: 1,
  abilities: [
    keywordAbility('trample'),
  ],
}

cardRules.set('Duskdale Wurm', duskdaleWurm)
```

`keywordAbility('trample')` produces `{ kind: 'keyword', keyword: 'trample' }`.
The shared keyword implementation provides Trample's combat-damage assignment
rules and any relevant client decisions. No card-specific targets, trigger, or
resolution program is needed. Casting and resolving the creature use the normal
permanent-spell procedure.

## 11. Validation and development workflow

For an ordinary supported card: declare timing/targets/costs, compose primitives,
and test observable behavior. For a new mechanic: implement reusable semantics
and decision contracts first, then register the card. A shorter definition is
not evidence of complete rules coverage.

Validate definitions at load time and validate player commands at runtime:

- Reject unsupported schema versions, unknown node kinds, duplicate declaration
  labels/internal identities, unresolved bindings, and domain mismatches
  (e.g. destroying a player).
- Check target bounds, mode-dependent clauses, distinctness, and distribution
  requirements. Resolve named references only in contexts where they exist.
- Keep conditions and amount expressions typed, bounded, and deterministic.
  Runtime X/count values differ from fixed literal validation.
- Validate cost and mana-ability semantics independently of resolution programs.
- Require every choice to define its chooser, timing, bounds, insufficient-choice
  behavior, visibility, and a serializable continuation.
- Require every action to define simultaneity/order, replacement entry points,
  source attribution, and typed outcome semantics.
- Fail explicitly on unsupported mechanics; do not silently approximate them
  with arbitrary `custom` events or direct state mutations.

Integration tests must establish whole-item behavior as well as primitive effects:
all versus some illegal targets, zero optional targets, source departure/control
change, intervening-if, ward, uncounterability, costs remaining paid, hidden
selection projection, reconnect/exactly-once continuation, and simultaneous
events. Test that no priority/SBA checkpoint appears between resolution
instructions or choice suspensions where the rules do not permit one.

## 12. Implementation sequence and current-code boundaries

1. **Implemented first slice:** player selectors and fixed-amount life loss, gain,
   and player damage. Preserve existing wrappers and their behavior.
2. **Execution/announcement contract:** formalize stack-item legality, checkpoint
   timing, pending triggers, and a distinct decision/priority outcome. Introduce
   named target clauses through adapters to current commands. Test multi-clause
   whole-item failure and costs atomically committed.
3. **References and expressions:** add incarnation-aware participant references,
   last-known information, amount nodes, and versioned serialization. Test replay
   and hidden-information projection.
4. **Remaining instructions and continuations:** standardize actions and typed
   result/control-flow nodes without erasing destroy/sacrifice, action dependency,
   or simultaneous/sequential distinctions. Unify typed choice suspension across
   cards, players, options, stack targets, ordering, and allocation.
5. **Replacement/prevention transformations:** implement player-selected CR 616
   ordering and persistent event lineage before adding generic builders. Test
   replaced events never triggering as if they occurred, optional/competing
   replacements, descendants, and prevention exhaustion.
6. **Static modifiers:** consolidate around existing layer machinery, including
   dependency, duration, source lifetime, and prospective entry characteristics.

Current modules provide migration starting points:

| Module | Current role / boundary |
| --- | --- |
| `src/cardPlugins/effectDefinitions.ts` | Existing serialized `CardEffect` / `CardInstruction` unions; not the complete proposed schema. |
| `src/cardPlugins/triggers.ts` and `triggers/matching.ts` | Shared trigger builders and event filters. |
| `src/rules/triggers.ts` | Trigger collection and existing pre-stack target-selection paths. |
| `src/cardPlugins/abilities.ts` and `targetedResolve.ts` | Existing announcement/target/effect metadata, with positional target binding. |
| `src/cardPlugins/instructionHandlers/` | Instruction semantics and event production. |
| `src/cardPlugins/runInstructions.ts` | Existing card-choice continuation support; general execution frames need further work. |
| `src/rules/selectCards.ts` / `selectPlayers.ts` | Typed server-owned selections, bounds, IDs, and answer validation. |
| `src/runtime.ts` | Authoritative versus projected state and hidden-information boundary. |
| `src/kernel.ts` | Event reduction, replacement discovery, and SBA handling. |
| `src/plugins/priority.ts` | Pass/resolve progression and existing waiting-stack handling. |
| `../live-runner/src/kernelChoicePrepare*.ts` / `kernelChoiceApply*.ts` | Host adapters from pending kernel choices to UI offers and validated answers. |

In particular, the current kernel sorts replacement rules by timestamp and runs
SBA handling through nested reductions; these are implementation constraints to
audit against this contract, not the desired CR 616 ordering or permission to
insert SBAs inside spell resolution. Existing per-effect target handlers must
not stand in for the proposed whole-item legality gate. Existing internal
`custom` continuation plumbing does not authorize a `custom` card-picker event.

Use focused integration tests at each implementation slice, then run the full
rules-engine suite and relevant live-runner checks for runtime changes. This
document alone does not change engine behavior.

## 13. Rules references

Verified against the [official Wizards Comprehensive Rules download](https://media.wizards.com/2026/downloads/MagicCompRules%2020260819.txt)
linked by [rules-sources](../rules-sources/README.md) (effective 2026-08-07,
file dated 2026-08-19). Definitions here are proposed engineering contracts;
the rules references establish game behavior, not the particular API syntax.

| Topic | Comprehensive Rules |
| --- | --- |
| Ability independence and source information | 113.7a |
| Targeting, optional zero targets, and retargeting | 115.1, 115.6–7, 115.10 |
| Priority, choice pauses, passing, checkpoints | 117.2e, 117.3–5 |
| Draw sequencing and count-level replacement | 121.2 |
| Object identity across zone changes | 400.7 |
| Cost replacement and resolution payments | 118.11–12 |
| Casting and activating | 601.2, 602.2 |
| Trigger collection, APNAP, target placement, intervening-if | 603.1–4 |
| Zone changes, look-back information, reflexive triggers | 603.6, 603.10, 603.12 |
| Mana abilities | 605.1, 605.3–4 |
| Resolution legality, instructions, choices, information, completion | 608.2a–h, 608.2k, 608.2m–n |
| Layers and continuous effects | 611, 613 |
| Static lifetimes, timestamps, dependencies, and game-rule effects | 611.3, 613.7–8, 613.11 |
| Replacement events, identity, entry, self-replacement | 614.5–6, 614.12, 614.15 |
| Prevention shields and unpreventable damage | 615.5–7, 615.12 |
| Competing replacements and applicability | 616.1–2 |
| Countering and paid costs | 701.6 |
| Ward | 702.21a |
| State-based action timing | 704.3–4 |

## 14. Future authoring sugar

A convenience wrapper can supply the schema version without repeating the object
shape or a type annotation on each card:

```ts
const duskdaleWurm = cardRuleDefinition(1, {
  abilities: [
    keywordAbility('trample'),
  ],
})
```

For the current proposed schema, its typed signature could be:

```ts
declare function cardRuleDefinition(
  schemaVersion: 1,
  definition: Omit<CardRuleDefinition, 'schemaVersion'>,
): CardRuleDefinition
```

The wrapper returns the same canonical `{ schemaVersion: 1, abilities: [...] }`
data. Schema validation remains part of the compiler/load contract; the wrapper
does not change game semantics or allocate live effect instances.

A typed keyword catalogue can expose immutable definitions for parameterless
keywords, making the same declaration shorter:

```ts
const duskdaleWurm = cardRuleDefinition(1, {
  abilities: [keyword.trample],
})
```

`keyword.trample` is equivalent to `keywordAbility('trample')`. Parameterized
keywords use typed factory functions rather than constants. Shared keyword
definitions contain no source references, runtime IDs, timestamps, or mutable
game state; the engine creates independent runtime instances from them.
These helpers are proposed authoring conveniences, not implemented exports.
