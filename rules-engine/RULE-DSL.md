# Configurable rule model and client/server contract

Status: staged refactoring target with an implemented first slice. Shared trigger
builders, object filters, player predicates/selectors, and fixed-amount life-loss, life-gain,
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
| Target clause | Indexed requirements for one occurrence of targeting in a program scope, including domain and cardinality. |
| Target binding | The recipients actually chosen for a target clause when the item is announced. |
| Mode | One selectable program block; selecting it repeatedly creates separate occurrences with separate bindings. |
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
  | ({
      kind: 'spell'
      decisions: DecisionsSpec
      costs: Cost[] // Mandatory additions to the spell's metadata mana cost.
    } & ResolutionProgram)
  | ({
      kind: 'activated'
      availableFrom: Zone[]
      timing: ActivationTiming
      decisions: DecisionsSpec
      costs: Cost[]
    } & ResolutionProgram)
  | ({
      kind: 'triggered'
      activeIn: Zone[]
      on: OccurrencePattern
      triggerOnlyIf?: Condition
      interveningIf?: Condition
      frequency?: TriggerFrequency
      decisions: DecisionsSpec
    } & ResolutionProgram)
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

type DecisionsSpec = {
  modes?: ModeSpec
  variables?: VariableSpec[]
  targets: TargetClause[]
  distributions?: DistributionSpec[]
}

type ResolutionProgram =
  | { instructions: Instruction[]; modes?: never }
  | { modes: ModeDefinition[]; instructions?: never }

type ModeSpec = {
  count: Amount
  repeatable: boolean
}

type ModeDefinition = {
  decisions: Omit<DecisionsSpec, 'modes'>
  instructions: Instruction[]
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

The proposed authoring helper for a triggered ability is
`whenever(on, configuration)`. Its first argument is an `OccurrencePattern`, a
declaration of what to watch, not a live event that has already happened. The
second supplies decisions, instructions, and optional trigger conditions/scope.
It produces the serialized `kind: 'triggered'` variant and can describe Oracle
triggers written with "when," "whenever," or "at." This readable helper name
does not change the trigger lifecycle or introduce a different engine ability
kind. Existing implemented trigger helpers remain compatibility APIs.

```ts
type TriggeredAbilityDefinition = Extract<AbilityDefinition, { kind: 'triggered' }>

type WheneverConfiguration = Omit<
  TriggeredAbilityDefinition,
  'kind' | 'on' | 'activeIn' | 'decisions' | 'instructions' | 'modes'
> & {
  activeIn?: Zone[] // Defaults to ['battlefield'].
  decisions?: DecisionsSpec // Defaults to { targets: [] }.
} & ResolutionProgram

type Whenever = (
  on: OccurrencePattern,
  configuration: WheneverConfiguration,
) => TriggeredAbilityDefinition

declare const whenever: Whenever
```

The registry associates a card name with its definition (and can resolve that
name to its Scryfall Oracle ID). No redundant card-definition ID is required.
Card characteristics such as mana cost, types, and printed power/toughness come
from the separate card metadata. Keyword declarations expand through a shared,
typed keyword catalogue; parameterized keywords need explicit typed parameters.

The referenced types are separate closed unions, not arbitrary JSON or strings
that the engine evaluates as code. Optional decision fields are absent when
unused; `targets: []` explicitly means no targeting clauses. Authoring builders
default omitted `decisions` to `{ targets: [] }` and omitted `costs` to `[]`.
This also applies to a mode's omitted decisions. A program supplies either a
plain `instructions` list or selectable `modes` blocks. `decisions.modes` controls
how many blocks to choose and whether repetition is allowed; its options come
from `modes`. The authoring helper `chooseModes({ count: 2 })` defaults
`repeatable` to false and normalizes the numeric count to an `Amount` node.
A spell's `costs` declares mandatory additional payments; its base mana cost comes
from card metadata. An activated ability's `costs` declares its activation payment.
Alternative/optional cost plans, cost increases/reductions, traits, and casting
permissions compose with these declarations through the casting procedure;
they are not resolution instructions or silently inferred alternatives.

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
  | { kind: 'targetRef'; clauseIndex: number }
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
  filter: Selector
  min: Amount
  max: Amount
  distinct: true // within this clause
}

type Cost =
  | { kind: 'discard'; filter: ObjectSelector; count: Amount }
  | { kind: 'sacrifice'; filter: ObjectSelector; count: Amount }
  | { kind: 'life'; amount: Amount }
  | { kind: 'mana'; amount: ManaCost }
  // Extend with typed tap, exile, counter-removal, and other payment variants.

type TargetBinding = {
  scopeId: string // Engine-generated program or selected mode-occurrence identity.
  clauseIndex: number
  recipients: BoundRecipient[]
}

type ModeOccurrence = {
  scopeId: string
  modeIndex: number
  repetitionIndex: number
  targets: TargetBinding[]
}

type BoundRecipient =
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'object'; objectId: string; incarnation: number; zone: Zone }
  | { kind: 'stackItem'; stackId: string }

type Instruction =
  | { kind: 'loseLife'; amount: Amount; targets: Reference | PlayerSelector }
  | { kind: 'damage'; amount: Amount; targets: Reference | ObjectSelector | PlayerSelector;
      source: Reference }
  | { kind: 'draw'; count: Amount; targets: Reference | PlayerSelector }
  | { kind: 'destroy'; targets: Reference | ObjectSelector }
  | { kind: 'counter'; targets: Reference; bindResult?: string }
  | { kind: 'sequence'; instructions: Instruction[] }
  | { kind: 'if'; condition: Condition; then: Instruction[]; otherwise: Instruction[] }
  // Extend with separately specified action and choice node variants.
```

This is a vocabulary slice, not the exhaustive instruction union. `PlayerSelector`
and `ObjectSelector` narrow `Selector` by domain. `ContextBinding` is an enumerated,
validated binding vocabulary (controller, source, triggering/event participants);
it is not an arbitrary property-access string. Arithmetic extensions need explicit
nodes, rounding, and validation, not expression strings. Cross-clause target
constraints need further typed variants; modal scopes are represented separately.

The shared `filter` field describes eligibility for targets, object cost payments,
and card choices. It takes a domain-tagged selector such as `objects(...)` or
`players(...)`; that selector contains the domain's predicate. In a selection
context this query only supplies eligible recipients, not a chosen binding. An
instruction using `objects(...)` directly instead acts on the matching group.
The field `kind` describes the cost action; discard and sacrifice are not selectors.
`selectCards` names an actual selection request. An instruction's `targets` field
contains its recipients, expressed as a bound reference or a selector; it does not
declare Magic targeting by itself. Only clauses in `decisions.targets` do that.
For example, `discard({ targets: choice('discarded') })` acts on an already chosen,
untargeted binding, while `damage({ targets: objects(...) })` affects a queried group.
An action's destination, such as `move({ targets: ..., to: 'exile' })`, remains `to`.

Authoring builders accept numeric literals as shorthand for constant `Amount`
nodes. For an exact target or card-choice count, `count: 6` or
`count: variable('X')` expands to
equal `min`/`max` expressions. Use either `count` or a `min`/`max` pair, never both.
Evaluate target bounds during announcement and store the chosen bindings;
resolution rechecks their legality without requiring that many remain legal.

For example, the untargeted loss instruction serializes as:

```json
{
  "kind": "loseLife",
  "amount": { "kind": "constant", "value": 1 },
  "targets": { "kind": "players", "filter": { "relation": "opponent" } }
}
```

That instruction contains neither selected seats nor game state. The server
evaluates its selector later in the ability's execution context. By contrast, an
announced target binding is runtime data containing specific recipient identities.

### Stable identity and execution context

Handwritten ability/effect IDs are optional labels for diagnostics and tracing.
Ordinary card examples omit them; an ID does not make a trigger function or
determine its lifetime/timestamp. The compiler gives every declaration an
internal identity, for example a path within an immutable,
versioned definition. A registry card name, a declaration identity, and a runtime
instance identity serve different purposes; none substitutes for a timestamp.
Target references use indices within their program scope; choice and result
binding labels remain explicit where referenced.

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
target(0)
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

### Decisions before execution

`decisions` declares decisions that must be bound while casting, activating,
or putting a triggered ability on the stack. It is not an executable client
command. The server validates supplied decisions and creates typed requests for
any required decisions that remain missing; the client renders those requests.
"Announcement" remains the rules term for that procedure, rather than the name
of the authored field.

| Field | Decision |
| --- | --- |
| `modes` | Which modes of a modal spell or ability are selected. |
| `variables` | Announcement-time values such as X, when the rules require a choice now. |
| `targets` | The recipients chosen for each target clause. |
| `distributions` | Amounts divided among targets, such as damage or counters. |

Modes can change which targets are required, so process these decisions in rules
order rather than opening independent pickers for every field. `costs` supplies
payment requirements; explicit cost plans supply optional/alternative choices.
Decisions that belong during resolution, such as discarding after drawing or
accepting a may payment, are instructions rather than pre-execution fields.

For [Blood Artist](https://scryfall.com/card/soc/209/blood-artist), `decisions`
only needs one player target; its instructions
then perform life loss and life gain. Instructions are the resolution program:
game actions plus typed choices, conditions, and sequencing. They are not the
pre-stack announcement procedure.

### Target clauses

Targeting belongs to `decisions`, separately from instructions:

```ts
select({
  filter: objects({ zone: 'battlefield', type: 'Creature' }),
  count: 1,
})

select({
  filter: objects({ zone: 'battlefield', type: 'Creature' }),
  min: 0,
  max: 2,
})
```

The first means "target creature"; the second means "up to two target creatures."
The proposed `select(...)` builder supplies a clause without a handwritten ID.
An instruction's `target(0)` references all chosen recipients of the first clause
in its program scope; it does not mean only the first recipient. Reordering clauses
requires updating their references. Validate index bounds and recipient domains
when loading the definition. Inactive or empty slots are never compacted or
renumbered when recipients become illegal.

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

### Modes and repeated mode occurrences

A modal program puts each mode's decisions and instructions together in `modes`.
`decisions.modes` declares the choice count and whether repetitions are permitted.
Choose modes first, then supply the targets required by each selected occurrence.
Unselected modes contribute no targets or instructions (CR 601.2b–c, 700.2).

Each selection of a mode creates a separate `ModeOccurrence` with its own generated
scope and target bindings. `target(0)` inside that mode resolves its first local
clause. Choosing the same mode twice can bind different recipients or the same
recipient in those two scopes; within one clause, recipients remain distinct.
Three repetitions require three executions, not one execution guarded by a boolean.

Execute selected modes in printed order, with repetitions of a mode in sequence
(CR 608.2c, 700.2d). Bindings remain attached to their occurrences regardless of
selection order or missing recipients. No priority or ordinary SBA checkpoint
appears between modes. Resolution choices, such as proliferate, are performed
separately at each instruction's position; they are not extra casting targets.

Perform the whole-spell target-legality gate once before starting the modal
program, across every selected occurrence's targets. If targets existed and all
are illegal, no mode runs, including untargeted modes. Choosing only untargeted
modes creates no target failure gate. Later instructions still use current state
where their primitive requires it; the mode scopes do not freeze the game state.

### Costs use the same eligibility vocabulary

`costs` is a list of required payment components. Each `kind` selects a payment
operation; object payments use `filter` and an exact `count`:

```ts
costs: [
  {
    kind: 'discard',
    filter: objects({ zone: 'hand', type: 'Creature', owner: 'you' }),
    count: variable('X'),
  },
  { kind: 'life', amount: 2 },
  {
    kind: 'sacrifice',
    filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }),
    count: 1,
  },
]
```

This hypothetical list requires **all three** payments. Alternatives such as
"pay life or sacrifice" require an explicit cost-plan choice, not an ordinary
array. `discardCost(...)` could remain optional sugar returning a `kind: 'discard'`
node; it is not a separate cost model. A resolution `optionalCost` instruction
also uses `costs: Cost[]` and explicitly names its payer.

The action's controller is the payer for cast/activation costs. The server must
check the payment operation's rules as well as the filter: discard from the
payer's hand, sacrifice permanents they control, and have enough life to pay.
Each discard/sacrifice payment chooses distinct objects; an object consumed by
one payment cannot be used again to pay another component.
These choices are untargeted; shroud, hexproof, and ward do not apply. The client
uses typed `selectCards` for missing discard/sacrifice payment bindings, with
`purpose: 'cost'`, and asks for X before dependent counts or mana are evaluated.
The same chosen X supplies the mana cost, target count, and discard count for
Aether Tide; these are not three independent variables.

The list does not prescribe payment order. The server follows CR 601.2f–h,
including cost determination, permitted mana abilities, the payer's legal payment
order, and full payment. Payment actions enter the replacement pipeline; a replaced
discard/sacrifice can still pay its cost (CR 118.11). Store payment records separately
from target bindings and do not choose new payments when the item resolves.

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
loseLife({ amount: 1, targets: players({ relation: 'opponent' }) })
gainLife({ amount: 2, targets: players({ relation: 'you' }) })
damage({ amount: 1, targets: target(0), source: ref('source') })
draw({ count: 1, targets: ref('triggering.player') })
move({ targets: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), to: 'exile' })
destroy({ targets: target(0) })
sacrifice({ targets: choice('offering'), by: ref('controller') })
counter({ targets: target(0), bindResult: 'counterResult' })
```

Proposed instruction recipients consistently use `targets`, including bound
targets, untargeted choices, and group selectors. The presence of this property
does not apply targeting rules; `decisions.targets` is the declaration that does.
Legacy helpers retain their existing signatures, such as `loseLife({ to: ... })`;
adapters translate to the proposed shape instead of silently changing current APIs.

Instructions propose semantic actions, not direct state edits. Handlers enforce
rules, expand actions into appropriate events, apply modifiers, commit state, and
produce occurrences. Damage keeps its source and uses prevention, lifelink,
infect, protection, and format rules. Life loss does not dispatch a damage event.
Destroy and sacrifice remain distinct from a plain move to the graveyard.

### Written order and simultaneity

An `instructions` list executes in written order (CR 608.2c). The spell's resolution
is uninterrupted by ordinary priority, but its instructions are not all one
simultaneous event. For example, drawing and then discarding uses the hand after
the draw. In Ashling's Command, copying an Elemental before dealing damage to your
creatures means the new token is included in that later creature selection.

Each primitive defines recipient timing, amount evaluation, result bindings,
and event grouping. One instruction dealing damage to a group deals that damage
simultaneously; one instruction destroying a group attempts those destructions
simultaneously. Card definitions do not repeat `execution: 'simultaneous'`.
Represent expressly sequential actions as separate instructions or a typed sequence.
Do not use an ordinary object-by-object loop to approximate one simultaneous event.

For each proposed action, evaluate recipients at the appropriate time, apply
replacement/prevention rules, and commit the resulting events before continuing
to the next instruction. Replacement effects can change an event or introduce
additional actions; their CR 614–616 semantics determine those actions' order and
grouping. They do not make the entire instruction list simultaneous. Rules that
require simultaneous player actions use their specified choice/event grouping,
including CR 608.2e.

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

After the whole spell finishes, run the priority checkpoint: repeat applicable
SBAs, put waiting triggers on the stack in the required order, and repeat this
process until stable; only then grant ordinary priority (CR 117.3b, 117.5, 704.4).
Do not insert a response window or an ordinary SBA check after each instruction,
mode, replacement decision, or client choice.

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
    mill({ count: 1, targets: ref('event.player') }),
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
    targets: players({ relation: 'you' }),
    capacity: 2,
  }, preventDamage()),
})

staticAbility(
  modifyStats({
    targets: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }),
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
Here `candidates` contains the actual offered identities after the server evaluates
the definition's `filter` and current legality; it is not another authoring field.
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
   scoped clauses to those positions. Do not silently change wire formats.
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
    "bindingId": "scope-42:0",
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
to target slot 0 in the matching execution scope and continues checkpoint
processing. Clients enable counterspell responses only after receiving a
subsequent `priority` outcome.

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

Examples A–I use hypothetical Oracle-style wording. Examples J–O use linked,
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
whenever(self.enters, {
  decisions: {
    targets: [select({
      filter: objects({ zone: 'battlefield', type: 'Creature' }),
      count: 1,
    })],
  },
  instructions: [destroy({ targets: target(0) })],
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
  decisions: {
    targets: [select({
      filter: objects({ zone: 'battlefield', type: 'Creature' }),
      min: 0, max: 2,
    })],
  },
  instructions: [
    destroy({ targets: target(0) }),
    draw({ count: 1, targets: ref('controller') }),
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
  decisions: {
    targets: [select({
      filter: stackItems({ kind: 'spell', other: true }),
      count: 1,
    })],
  },
  instructions: [
    counter({ targets: target(0), bindResult: 'counterResult' }),
    draw({ count: 1, targets: ref('controller') }),
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
  draw({ count: 1, targets: ref('controller') }),
  chooseCards({
    id: 'discarded',
    chooser: ref('controller'),
    filter: objects({ zone: 'hand', owner: 'you' }),
    count: 1,
    whenInsufficient: 'chooseAvailable',
  }),
  discard({ targets: choice('discarded'), by: ref('controller') }),
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
  payer: ref('controller'),
  costs: [{
    kind: 'sacrifice',
    filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }),
    count: 1,
  }],
  whenPaid: reflexiveTrigger({
    decisions: {
      targets: [select({
        filter: objects({ zone: 'battlefield', type: 'Creature' }),
        count: 1,
      })],
    },
    instructions: [destroy({ targets: target(0) })],
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

### L. Aether Tide: one X for targets, mana, and discard

[Aether Tide](https://scryfall.com/card/exo/27/aether-tide) costs {X}{U}. Casting
requires discarding X creature cards; resolution returns X target creatures to
their owners' hands.

**Proposed authoring DSL:**

```ts
const aetherTide = cardRuleDefinition(1, {
  abilities: [spell({
    decisions: {
      variables: [chooseX()],
      targets: [select({
        filter: objects({ zone: 'battlefield', type: 'Creature' }),
        count: variable('X'),
      })],
    },
    costs: [{
      kind: 'discard',
      filter: objects({ zone: 'hand', type: 'Creature', owner: 'you' }),
      count: variable('X'),
    }],
    instructions: [move({
      targets: target(0),
      to: 'hand',
    })],
  })],
})
```

Choose a nonnegative X once, choose exactly X distinct legal creature targets,
then determine and pay the total cost. The mana component is supplied by metadata;
the `costs` entry adds the creature-card discard. The client uses target and cost
pickers with different purposes; the discard does not target. A fully supplied
proposal needs no additional picker, and the server validates payment in rules
order. Without enough legal targets or payable discards, the cast cannot finish.

When moving to a hand, the shared zone-change operation uses each object's owner,
not necessarily this spell's controller. On resolution, return the remaining
legal targets even if fewer than X remain. If X was positive and all targets are
illegal, the spell does not resolve; if X was zero, it resolves with no targets.
Countering the spell or losing its targets does not refund mana or discarded cards.
A replacement that changes a discard's destination can still count as payment
under CR 118.11; use actual resulting occurrences for any triggers.

### M. Hex: exactly six targets when casting

[Hex](https://scryfall.com/card/otc/136/hex) costs {4}{B}{B} and destroys six target
creatures.

**Proposed authoring DSL:**

```ts
const hex = cardRuleDefinition(1, {
  abilities: [spell({
    decisions: {
      targets: [select({
        filter: objects({ zone: 'battlefield', type: 'Creature' }),
        count: 6,
      })],
    },
    instructions: [destroy({
      targets: target(0),
    })],
  })],
})
```

Casting needs six distinct legal creature targets, including your own creatures
if desired. The server cannot accept fewer, and it cannot count one creature six
times. If some targets become illegal before resolution, destroy the remaining
legal targets; no replacement target selection is offered. If all become illegal,
the spell does not resolve. Indestructible targets are still legal targets;
failure to destroy them does not make the spell fail its target-legality check.

### N. Ashling's Command: local target slots in modal blocks

[Ashling's Command](https://scryfall.com/card/ecl/205/ashlings-command) costs
{3}{U}{R}. Choose two distinct modes: copy an Elemental you control, have a target
player draw two cards, deal 2 damage to each creature a target player controls,
or have a target player create two Treasure tokens.

**Proposed authoring DSL:**

```ts
const ashlingsCommand = cardRuleDefinition(1, {
  abilities: [spell({
    decisions: {
      modes: chooseModes({ count: 2 }),
    },
    modes: [
      {
        decisions: {
          targets: [select({
            filter: objects({
              zone: 'battlefield',
              subtypes: ['Elemental'],
              controller: 'you',
            }),
            count: 1,
          })],
        },
        instructions: [createTokenCopy({
          of: target(0),
          targets: ref('controller'),
        })],
      },
      {
        decisions: {
          targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
        },
        instructions: [draw({ count: 2, targets: target(0) })],
      },
      {
        decisions: {
          targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
        },
        instructions: [damage({
          amount: 2,
          source: ref('source'),
          targets: objects({
            zone: 'battlefield',
            type: 'Creature',
            controller: target(0),
          }),
        })],
      },
      {
        decisions: {
          targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
        },
        instructions: [createToken({ token: 'Treasure', count: 2, targets: target(0) })],
      },
    ],
  })],
})
```

Every `target(0)` is local to its selected mode occurrence. The first mode targets
an Elemental permanent, which need not be a creature. The damage mode targets
only a player; its `targets` selector evaluates that player's creatures during
resolution. `ObjectFilter.controller` accepts a typed player reference in this
proposed form, with domain/cardinality validation and the usual unavailable-target
information rules. This selector does not give those creatures ward triggers or
make shroud/hexproof exclude them from the damage.

If copying and damage are selected, the token is created before the damage group
is evaluated. A damage instruction affects its group simultaneously; the two mode
instructions remain sequential within the same resolution. Counterspells cannot
be cast between them, and ordinary SBAs are deferred until the spell finishes.

### O. Brokers Confluence: repeating a mode with independent bindings

[Brokers Confluence](https://scryfall.com/card/ncc/68/brokers-confluence) costs
{2}{G}{W}{U}. Choose three modes with repetition allowed: proliferate, phase out
a target creature, or counter a target activated or triggered ability.

**Proposed authoring DSL:**

```ts
const brokersConfluence = cardRuleDefinition(1, {
  abilities: [spell({
    decisions: {
      modes: chooseModes({ count: 3, repeatable: true }),
    },
    modes: [
      {
        instructions: [proliferate({ by: ref('controller') })],
      },
      {
        decisions: {
          targets: [select({
            filter: objects({ zone: 'battlefield', type: 'Creature' }),
            count: 1,
          })],
        },
        instructions: [phaseOut({ targets: target(0) })],
      },
      {
        decisions: {
          targets: [select({ filter: stackItems({ kind: 'ability' }), count: 1 })],
        },
        instructions: [counter({ targets: target(0) })],
      },
    ],
  })],
})
```

Choosing the phasing mode twice creates two independent target bindings, each
referenced locally as `target(0)`. The same creature can be chosen for both
occurrences. Phasing changes status rather than moving zones; use a shared phasing
primitive, not a move/exile instruction. A `kind: 'ability'` stack filter matches
activated/triggered stack abilities; mana abilities do not enter the stack.

Proliferate makes untargeted selections during resolution, using the resulting
counters at each repetition. Three proliferates are three sequential instructions,
with separate choices and replacement opportunities, inside one spell resolution.
There is no ordinary priority/SBA checkpoint between them. If selected targeted
modes have targets and all become illegal before resolution, the entire spell
does not resolve, including proliferate. Selecting proliferate three times creates
an untargeted spell and can resolve normally.

## 11. Validation and development workflow

For an ordinary supported card: declare timing/targets/costs, compose primitives,
and test observable behavior. For a new mechanic: implement reusable semantics
and decision contracts first, then register the card. A shorter definition is
not evidence of complete rules coverage.

Validate definitions at load time and validate player commands at runtime:

- Reject unsupported schema versions, unknown node kinds, duplicate declaration
  labels/internal identities, unresolved bindings, and domain mismatches
  (e.g. destroying a player).
- Check target bounds, mode counts/repetition, scoped indices, recipient domains,
  distinctness, and distribution requirements. Validate each selected occurrence's
  bindings and resolve named choice/result references only where they exist.
- Require a modal program and its mode-choice specification together; reject
  mixed root `instructions`/`modes` and nested mode choices in this initial shape.
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

## 12. Refactoring goal, implementation sequence, and current-code boundaries

### Implementation goal

Refactor card definitions, rules execution, and client/headless decision handling
around the contract in this file. Card definitions compile to versioned data;
the authoritative driver interprets that data, validates decisions, and owns
continuations; clients render authorized offers and submit answers. Both human
and agent play use the same decision protocol and game semantics.

The scope includes card registration/builders, casting and activation, triggers,
target binding, instruction execution, modifiers, and the corresponding
`live-runner`/client interactions. Reuse correct combat, mana, layer, projection,
and action implementations. Preserve existing supported card behavior and track
intentional rules corrections with explicit regression cases.

This is the implementation target, with the Comprehensive Rules defining game
behavior. It is not yet an exhaustive executable schema. Before implementing a
slice, close its referenced unions, builder defaults, outcome types, serialization,
and validation rules. In particular, complete filter/reference domains, alternative
and optional cost plans, conditions, and offer/answer variants as their mechanics
are introduced. Unsupported nodes fail explicitly; a shorter definition or a
successful registration is not proof that its gameplay semantics are supported.

Player selectors and fixed-amount life loss, gain, and player damage are the
implemented first slice. Preserve those public wrappers during migration.

### Implementation milestones

1. **Canonical schema and compiler:** implement the supported node unions and
   builders, load-time validation, generated declaration identity, scoped target
   indices, source/incarnation references, and amount expressions. Compile legacy
   authoring helpers to the same data where their semantics are representable.
   Unsupported translations remain explicit, with a recorded migration gap.
2. **Authoritative execution driver:** introduce durable program frames, ordered
   event processing, pending-trigger collection, whole-item target legality, and
   explicit priority/SBA checkpoints. One driver owns each resolving item across
   instructions, modes, and suspended decisions. Verify illegal/partial/zero
   targets, source departure, trigger look-back, and interruption boundaries.
3. **Typed choices and client adapters:** unify choice suspension and continuations
   across cards, players, stack items, options, ordering, and allocation. Keep card
   pickers on `selectCards`; preserve authorized projections and existing command
   adapters. Exercise both browser and headless drivers, stale answers, reconnect,
   and exactly-once resumption before migrating specialized host choice paths.
4. **Casting, costs, modes, and reusable instructions:** implement complete action
   proposals, shared X bindings, full cost payment, announcement-time mode/target
   selection, and repeated mode occurrences with independent scopes. Extend action
   primitives with specified recipient domains, outcomes, and event grouping.
   Test costs remaining paid, reflexive triggers, counterspells/ward, and separate
   untargeted resolution choices.
5. **Replacement/prevention and static effects:** implement player-selected CR 616
   ordering, persistent event lineage, and consumable prevention before migrating
   modifier declarations. Reuse layer machinery with correct timestamps,
   dependencies, source lifetimes, and action-legality restrictions. Cover mana
   activations, replaced occurrences, simultaneous actions, and hidden choices.
6. **Representative card conformance:** implement end-to-end scenarios for Stony
   Silence, Duskdale Wurm, Blood Artist, Aether Tide, Hex, Ashling's Command, and
   Brokers Confluence. Build these cases alongside the relevant milestones, then
   verify the combined server/client path. The examples are acceptance anchors;
   they do not by themselves cover every existing mechanic.
7. **Existing-card migration and consolidation:** inventory existing definitions
   and specialized handlers, migrate by supported mechanic, and compare observable
   behavior with regression fixtures. Add missing reusable semantics before
   translating affected cards. Remove superseded execution/choice paths only after
   their supported behavior is covered; compatibility authoring wrappers may stay
   when they compile to the canonical model.

### Completion criteria

- Existing supported card/mechanic coverage is retained, with deliberate behavior
  corrections documented and tested. No migration gap is silently counted as
  complete support, and no supported card falls through to a judge fallback merely
  because its legacy representation was removed.
- The authoritative execution path owns legality, event/replacement processing,
  continuations, and checkpoints. Client/headless paths consume typed offers rather
  than recreating rules or inspecting card-specific pending payloads.
- The representative scenarios and regression suites establish ordered resolution,
  scoped targets/modes, cost semantics, modifier interaction, authorized visibility,
  and reconnect/idempotency behavior. Run relevant rules-engine, live-runner, client,
  type, import, and lint checks for each implementation slice.
- Command, saved-state, and replay compatibility is preserved through explicit
  adapters or versioned migrations. Active execution frames retain the definition
  version they started with. Remaining legacy wrappers produce the same canonical
  semantics rather than maintaining a competing resolution engine.

### Current-code boundaries

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
The legacy `modalSpell` resolution fallback and its label-based mode selection
also need auditing against announcement-time decisions and repeated occurrences.

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
| Resolution legality, instruction order, simultaneous player actions, choices, completion | 608.2a–h, 608.2k, 608.2m–n |
| Mode-dependent targets and repeated modes | 700.2a–d |
| Proliferate and phasing | 701.34, 702.26 |
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

### Occurrence builders and source shortcuts

The two-argument `whenever` helper separates the event pattern from what the
ability asks and does. In the proposed DSL entry point, `enters` and `dies` build
patterns; their `filter` can match an object predicate or a typed object reference:

```ts
whenever(enters({ filter: ref('self') }), {
  decisions: {
    targets: [select({
      filter: objects({ zone: 'battlefield', type: 'Creature' }),
      count: 1,
    })],
  },
  instructions: [destroy({ targets: target(0) })],
})
```

`ref('self')` is an authoring alias for the canonical `ref('source')` object
binding. A reference in an occurrence filter means "this particular source,"
not all objects sharing its card name. Predicate filters such as
`dies({ filter: { type: 'Creature', controller: 'you' } })` can watch other
matching objects. Filtering occurrences does not target anything.

A shared shorthand can use ordinary TypeScript getters:

```ts
const self = Object.freeze({
  get enters() {
    return enters({ filter: ref('self') })
  },
  get dies() {
    return dies({ filter: ref('self') })
  },
})

whenever(self.enters, {
  instructions: [draw({ count: 1, targets: ref('controller') })],
})

whenever(self.dies, {
  instructions: [draw({ count: 1, targets: ref('controller') })],
})
```

The getters run while building the definition and return immutable, serializable
pattern nodes. They do not capture a live card, perform a query, or run when an
event occurs. The engine binds the symbolic source separately for each ability
instance; it uses the appropriate entry or pre-departure snapshot when matching
zone-change occurrences (CR 603.6, 603.10). Match what actually happened after
replacements: entering tapped still counts as entry, while exile instead of a
death creates no death occurrence. Getter functions and the `self` helper object
are not embedded in the saved definition.

The existing `enters`/`dies` helpers build complete `CardEffect` values, not
standalone patterns. Keep those compatibility exports; the new pattern builders
need a separate DSL entry point or namespace such as `events.enters`/`events.dies`.
Do not infer two different return types for the same legacy call shape. The
short names above assume imports from the proposed DSL entry point.
