# Rules kernel

Pure reducer:

```ts
const result = rules(state, event)
// { ok: true, state } | { ok: false, error, state }
```

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

1. If `state.ended` and the event is not `concede` / `addRule` / `removeRule`, reject.
2. **Replace** — each `RuleInstance` may replace the event once (timestamp order).
   `null` prevents (state unchanged, `ok: true`, `prevented: true`).
   An array folds `rules` left-to-right.
3. **Legal** — first plugin that returns a string rejects.
4. **Apply** — kernel `coreApply`, then each plugin `apply`.
5. **Granted rules** — after a move onto the battlefield, `addRule` for each
   `object.grantedRules`. After leaving, `removeRule` for that `sourceId`.
6. **SBA loop** — collect `sba()` events, apply internally until none, cap 32.

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
| `combat` | attackers, blockers, combat damage |
| `commander` | 21 damage, command zone, tax |
| `manaBurn` | **optional** — leftover mana becomes unpreventable loss of life |

Default `createEngine()` includes everything except `manaBurn`. Tests add it
with `addRule` or a card `grantedRules: ['manaBurn']`.

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
