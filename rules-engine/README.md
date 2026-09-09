# Rules kernel

Pure Magic reducer for this repo. Policy (LLM / human) proposes events; this
kernel accepts or rejects them and returns a new state.

```ts
import { createEngine, newGame } from './src/index'

const { rules } = createEngine()
let state = newGame()
const result = rules(state, { type: 'passPriority', seat: 'p1' })
if (result.ok) state = result.state
```

Active effects are `RuleInstance`s on the state. Plugin **code** lives in the
catalog. A card that grants an effect lists `grantedRules`; moving it onto the
battlefield `addRule`s those plugins, leaving `removeRule`s them.

```ts
rules(state, { type: 'addRule', pluginId: 'manaBurn' })
rules(state, { type: 'removeRule', pluginId: 'manaBurn' })
```

Yarok fixture: `grantedRules: ['manaBurn']` so ETB/LTB toggles leftover-mana
burn. That is a lifecycle demo, not Oracle Yarok.

## Tests

```bash
bun test rules-engine
```

## Adding a plugin

1. `export const foo: Plugin = { id: 'foo', legal, replace, apply, sba }`
2. Register it on the catalog (`createEngine([..., foo])` or `addPlugin(foo)`).
3. Put it on the table with `addRule` or `grantedRules`.

See `DESIGN.md`.
