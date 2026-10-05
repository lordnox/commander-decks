import { effectsOf } from '../cardPlugins/cardRules'
import { activateEffect } from '../cardPlugins/effects'
import type { GameEvent, GameState, Plugin } from '../types'

/** The permanent a `tapForMana` event or a `{T}` mana ability taps, if any. */
const tappedForMana = (state: GameState, event: GameEvent) => {
  if (event.type === 'tapForMana') return event.objectId
  if (event.type !== 'activateAbility' || !event.manaAbility) return
  const source = state.objects[event.objectId]
  return source && activateEffect(effectsOf(source), event.abilityId)?.costs.tap
    ? source.id
    : undefined
}

/**
 * Wild Growth / Utopia Sprawl: whenever the permanent this Aura enchants is
 * tapped for mana, its controller adds one more mana, either a fixed color or
 * the color the Aura stored as it entered.
 */
export const enchantedManaBoost: Plugin = {
  id: 'enchantedManaBoost',
  apply: ({ state, event, draft, rule }) => {
    const tappedId = tappedForMana(state, event)
    const aura = rule.sourceId ? draft.object(rule.sourceId) : undefined
    if (!tappedId || !aura || aura.zone !== 'battlefield' || aura.attachedTo !== tappedId) return
    const boost = effectsOf(aura).find((effect) =>
      effect.op === 'static' && effect.enchantedManaBoost)
    const spec = boost?.op === 'static' ? boost.enchantedManaBoost : undefined
    const color = spec && ('chosenColor' in spec ? aura.chosenColor : spec.mana)
    const land = draft.object(tappedId)
    if (!color || !land) return
    draft.enqueue({ type: 'addMana', seat: land.controller, mana: { [color]: 1 } })
    draft.note(`${land.controller} adds {${color}} from ${aura.name}`)
  },
}
