# Rules kernel

Pure reducer:

```ts
const result = rules(state, event)
// { ok: true, state } | { ok: false, error, state }
```

The kernel has no fixed format or player count. `GameFormat` supplies starting
life, runtime plugins, active rule IDs, deck-construction metadata, and optional
per-player state:

```ts
const state = newGame(commanderRules, { players: 3 })
const standard = newGame(standardRules)
const modern = newGame(modernRules, { players: ['alice', 'bob'] })
```

`state.playerOrder` is authoritative for turns and priority. Player IDs are
arbitrary strings; `p1`…`pN` are generated only when a count is supplied.
Commander damage and tax live in Commander-owned `player.data`, not the kernel.

## Authoritative server and replica client

Both runtimes call the same reducer and use the same format rules. They replace
the `hiddenInformation` implementation:

- **Server** owns complete objects and `zoneOrder`, resolves `draw` and
  `shuffleLibrary`, and receives an injectable random source.
- **Client** owns a viewer-specific projection. Libraries and opponents' hands
  contain counts but no object identities. Local draw/shuffle are harmless
  no-ops; hidden data changes only through an `authoritativeSync` from outside.

`projectForViewer` is deliberately outside the kernel: redaction is a security
boundary, not a game rule. Never send authoritative state to a client.

History is also outside the kernel. `createHistory(state, rules)` records
events plus before/after states without recursively placing history in
`GameState`. Server and client may choose different retention policies.

Every `ReduceResult` includes an event-centric `trace`. Enqueued and replacement
events are indented by `depth`; replacement entries name the plugin that acted.
Hooks that return nothing are deliberately absent. Activating Yurlok therefore
shows `activateAbility → payMana / tap / addMana`, but does not emit noise from
unrelated card plugins inspecting the event. `HistoryEntry` retains this trace,
and the live host publishes redacted summaries in the game log.

## Replay conversion

`runReplayRounds(replay, throughRound)` bootstraps an authoritative game from
the replay's final setup snapshot, converts the recorded draws, land plays,
mana taps, casts, resolutions, discards, and step changes into `GameEvent`s,
then runs each event through the normal reducer. Unknown library cards remain
distinct hidden placeholders; revealed draws are placed on top in recorded
order.

`replayComparableState` maps the kernel's per-player-turn counter back to the
replay's table-round counter and returns the fields both systems represent:
active seat, phase, stack, life, poison, library count, and public zones. The
legacy replay's aggregate commander tax and seat-keyed commander damage are
not isomorphic to the kernel's per-commander object-ID maps, so they are not
part of this projection.

## Card plugins

Special Oracle is not compiled. Cards with odd rules are listed in
`rules-engine/src/cardPlugins/cardRules.ts` (Oracle name → composed effects),
which is also where `pluginIds` and `handlerIds` come from. That file is the
readable table of record; later it should split into one lazy module per card
so a game only loads the names it contains. `grantedRulesFor(name)`
attaches **static** plugin ids (for example `manaBurn`) when the object is
created; those RuleInstances exist only while the source is on the battlefield.

Activated abilities use `{ type: 'activateAbility', abilityId, seat, objectId }`.
The ability type does not change the event. Mana vs stack is timing: the host
sets `manaAbility: true` when the activation is a mana ability. The always-on
`abilities` plugin skips the priority check in that case and otherwise requires
priority. The host owns the actual mana-ability window (paying costs, no stack).

Card plugins that handle `activateAbility` are always live (`sourceId: null`).
They no-op unless `abilityId` matches and are listed under `handlerIds` so a
running host can reload newly generated modules. Yurlok of Scorch Thrash grants
`manaBurn` while on the battlefield; `yurlok.mana-rain` is `{1}, {T}` raining
`{B}{R}{G}` and must be sent as a mana ability.

Add a plugin only when a new deck or card needs one. Write a regression test
in the same step. Reuse `whenAbility` / `applyAbility` checks from
`plugins/activateAbility.ts`.

Some `CardInstruction` kinds are declared for card rules but not executed in
`runInstructions.ts`. `addChosenColorMana` is handled by the `tapForMana` event
(`plugins/mana.ts` applies; `cardPlugins/activated.ts` legal hook skips legacy
journal objects that still embed the instruction). `putMilledLandTapped` is
handled in `rules/triggers.ts` when a milled land hits the graveyard from the
library (`handleMilledLandImmediate`). Unknown kinds that reach the end of the
instruction loop are noted in the trace (`unknown instruction: …`).

The live judge may keep a current game moving with `judgeFallback` when exact
Oracle behavior has no plugin yet. The event names the source and missing
capability and contains only ordinary primitive effects. Nested fallbacks and
administrative events are rejected; any illegal child rejects the whole event
without changing state.

## Pipeline

Active rules live **in the game state**. Catalog entries are code. A permanent
that grants an effect does `{ type: 'addRule', pluginId, sourceId }`; leaving
the battlefield does `{ type: 'removeRule', sourceId }`.

Example (fixture, not Oracle Yarok):

```ts
rules(state, { type: 'move', objectId: yarok, to: 'battlefield' })
// kernel installs grantedRules: ['manaBurn']
rules(state, { type: 'move', objectId: yarok, to: 'graveyard' })
// kernel removes every RuleInstance with that sourceId
```

## Event loop

1. If `state.ended` and the event is not an administrative sync/rule event, reject.
2. **Replace** — each `RuleInstance` may replace the event once (timestamp order).
   `null` prevents (state unchanged, `ok: true`, `prevented: true`).
   An array folds `rules` left-to-right.
3. **Legal** — first plugin that returns a string rejects.
4. **Apply** — kernel `coreApply`, then each plugin `apply`.
5. **Granted rules** — after a move onto the battlefield, `addRule` for each
   `object.grantedRules`. After leaving, `removeRule` for that `sourceId`.
6. **SBA loop** — collect `sba()` events, apply internally until none, cap 32.

Damage is a chain of events, not a custom notification. `assignCombatDamage`
enqueues `combatDamage`. That event applies commander-damage tracking, then
enqueues `dealDamage`, which enqueues `loseLife` for players. A replacement
that returns `null` stops the rest of the chain: Fog ends at `combatDamage`,
Circle-of-Protection-style effects end at `dealDamage`, and “you can’t lose
life” ends at `loseLife`.

Combat defenders use `TargetRef`: a creature attacks either a player or a
planeswalker object that player controls. Commander damage still counts only
combat damage whose target is a player.

## Stack, actions, events, and triggers

Vocabulary (see also `STACK-AND-TRIGGERS-PLAN.md`):

| Term | Meaning |
|------|---------|
| **Spell / ability** | `StackItem` from casting or triggering (CR 405, 601–603) |
| **Action** | Stack item that resolves into events, often after a client choice (CR 608.2, 701.9) |
| **Event** | Input to `rules(state, event)` — atomic state change |
| **Game rule** | Always-on builtin `Plugin` (`sourceId: null`) |
| **Card rule** | `RuleInstance` tied to a permanent |
| **Trigger** | Card rule that puts a triggered ability on the stack (CR 603) |

**Chain:** spell/ability resolves → action(s) on stack → event(s) apply → trigger(s) on stack.

**Client resolver break:** when an action needs a choice, mark the stack item
`waiting`, return state to the host, and do not drain further. The client sends
`continueAction` with `{ stackId, seat, payload }` to resume. Do not use `custom`
for stack continuations. `StackItem.id` is allocated once via
`draft.allocId('stack')` and stays stable through waiting round-trips and replay.

Declarative card triggers use `TriggerBinding` (`on`, `if`, `do`). v1 orders
multiple triggers from one player by timestamp / card-rules order; later phases
may add player-chosen ordering (`orderTriggers` / `continueAction`) without
changing the binding shape.

## Plugin

```ts
type Plugin = {
  id: string
  legal?: (ctx) => string | void
  replace?: (ctx) => GameEvent | GameEvent[] | null | undefined
  apply?: (ctx) => void
  sba?: (ctx) => GameEvent[]
}
```

`ctx` is `{ state, event, draft, rule, catalog }`. `state` is pre-event;
`draft` is mutable next state. Plugins must ignore events they do not handle.

Register code with `catalog.register(plugin)`. Put a live instance in the
state with the `addRule` event (or `grantedRules` on an object).

## Builtin plugin ids

| id | Role |
|---|---|
| `turnStructure` | steps, empty mana pools on step change, turn pass |
| `priority` | pass, stack resolve, auto `advanceStep` |
| `mana` | tap-for-mana, addMana, emptyManaPools (no burn) |
| `lands` | one land per turn, playLand |
| `spells` | castSpell, pay mana, move to stack |
| `stateBased` | 0 life, 0 toughness, lethal damage, tokens, legend |
| `combat` | attackers, blockers, emits `combatDamage` |
| `damage` | `combatDamage` → `dealDamage` → `loseLife` |
| `discard` | CR 701.9 — discard actions and one-card `discard` events (`src/rules/`) |
| `draw` | CR 121.2 — one-card draws; remaining-N stays on the stack |
| `triggers` | CR 603 — put matching triggered abilities on the stack (APNAP) |
| `planeswalker` | starting loyalty and stack-based loyalty abilities |
| `hiddenInformation` | Server resolves hidden zones; client ingests redacted state |
| `judgeFallback` | Audited wrapper for atomically validated primitive effects |
| `fog` | **optional** — prevents `combatDamage` |
| `commander` | Optional format rule: 21 damage, command zone, tax |
| `manaBurn` | **optional** — leftover mana becomes unpreventable loss of life |

`coreRules`, `standardRules`, and `modernRules` omit `commander`.
`commanderRules` adds it and starts players at 40 life. `manaBurn` is registered
but inactive until an `addRule` event or card `grantedRules` enables it.

## Files

Agents must not edit files they do not own.

| Owner | Files |
|---|---|
| frozen | `DESIGN.md`, `src/catalog.ts`, `src/kernel.ts`, `src/newGame.ts` |
| stack/triggers | `src/types.ts`, `src/draft.ts`, `src/rules/` (stack/trigger pipeline) |
| A turn | `src/plugins/turnStructure.ts`, `src/plugins/priority.ts`, tests |
| B mana | `src/plugins/mana.ts`, `src/plugins/lands.ts`, `src/plugins/manaBurn.ts`, tests |
| C fight | `src/plugins/spells.ts`, `src/plugins/stateBased.ts`, `src/plugins/combat.ts`, `src/plugins/commander.ts`, tests |
| D wire | `src/plugins/index.ts`, `src/index.ts`, `src/engine.test.ts`, README, package.json scripts |

Style: arrow functions, no semicolons, return types only when inference fails.
Tests: `bun test rules-engine`.
