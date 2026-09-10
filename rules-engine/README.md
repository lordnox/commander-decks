# Rules kernel

Pure Magic reducer for this repo. Policy (LLM / human) proposes events; this
kernel accepts or rejects them and returns a new state.

```ts
import { commanderRules, createEngine, newGame } from './src/index'

const { rules } = createEngine(commanderRules)
let state = newGame(commanderRules, { players: 3 })
const result = rules(state, { type: 'passPriority', seat: 'p1' })
if (result.ok) state = result.state
```

Formats are ordinary data and plugins:

```ts
import { modernRules, standardRules } from './src/index'

const standard = newGame(standardRules) // two players, 20 life
const modern = newGame(modernRules, { players: ['alice', 'bob'] })
```

`createGame(format, options)` is the fail-closed base and refuses hidden-zone
operations until a runtime profile is selected. A custom format controls player
count, starting life, active rules, plugin implementations, player-specific
data, and deck-construction metadata.

Server and client use the same kernel with different hidden-information plugins:

```ts
const server = createServerGame(commanderRules, options, { random })
const view = server.project(server.state, 'p1')
const client = createClientGame(commanderRules, view)

const drawn = server.rules(server.state, { type: 'draw', seat: 'p1' })
if (drawn.ok) {
  const nextView = server.project(drawn.state, 'p1')
  client.sync(client.state, nextView)
}
```

The server owns full hands, ordered libraries, shuffling, and draws. Client
projections retain hidden-zone counts but omit library and opponent-hand
identities. Hidden actions are client-side no-ops until the server sends a
redacted sync.

History wraps either reducer and stays outside game state:

```ts
const history = createHistory(server.state, server.rules)
history.dispatch(event)
```

Active effects are `RuleInstance`s on the state. Plugin **code** lives in the
catalog. A card that grants an effect lists `grantedRules`; moving it onto the
battlefield `addRule`s those plugins, leaving `removeRule`s them. Activated
ability handlers stay live and match `abilityId` on `activateAbility`.

```ts
rules(state, { type: 'addRule', pluginId: 'manaBurn' })
rules(state, { type: 'removeRule', pluginId: 'manaBurn' })
```

Yarok fixture: `grantedRules: ['manaBurn']` so ETB/LTB toggles leftover-mana
burn. That is a lifecycle demo, not Oracle Yarok.

Damage is a chain: `combatDamage` → `dealDamage` → `loseLife`. Fog replaces
`combatDamage` with nothing. Other effects can replace `dealDamage` or
`loseLife`. Commander damage is recorded on `combatDamage`, so it still
counts if only later steps are prevented.

## Tests

```bash
bun test rules-engine
```

## Adding a plugin

1. `export const foo: Plugin = { id: 'foo', legal, replace, apply, sba }`
2. Include it in `format.plugins`, or register it with `addPlugin(foo)`.
3. Put static effects on the table with `addRule` or `grantedRules`.
   Handle activations with `whenAbility` / `activateAbility`.

See `DESIGN.md`.
