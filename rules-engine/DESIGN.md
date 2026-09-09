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

## Pipeline

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
| `hiddenInformation` | Server resolves hidden zones; client ingests redacted state |
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
| frozen | `DESIGN.md`, `src/types.ts`, `src/catalog.ts`, `src/draft.ts`, `src/kernel.ts`, `src/newGame.ts` |
| A turn | `src/plugins/turnStructure.ts`, `src/plugins/priority.ts`, tests |
| B mana | `src/plugins/mana.ts`, `src/plugins/lands.ts`, `src/plugins/manaBurn.ts`, tests |
| C fight | `src/plugins/spells.ts`, `src/plugins/stateBased.ts`, `src/plugins/combat.ts`, `src/plugins/commander.ts`, tests |
| D wire | `src/plugins/index.ts`, `src/index.ts`, `src/engine.test.ts`, README, package.json scripts |

Style: arrow functions, no semicolons, return types only when inference fails.
Tests: `bun test rules-engine`.
