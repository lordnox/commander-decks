import type { GameState, PlayerId, Plugin } from '../types'

export const SACRIFICE_LAND_FOR_BLACK = 'sacrificeLandMana.black'

export const canSacrificeLandForBlack = (state: GameState, seat: PlayerId) =>
  state.rules.some(
    (rule) =>
      rule.pluginId === 'sacrificeLandMana'
      && rule.params.controller === seat,
  )

export const sacrificeLandMana: Plugin = {
  id: 'sacrificeLandMana',
  legal: ({ state, event }) => {
    if (event.type !== 'activateAbility' || event.abilityId !== SACRIFICE_LAND_FOR_BLACK) return
    const object = state.objects[event.objectId]
    if (
      !object
      || object.zone !== 'battlefield'
      || object.controller !== event.seat
      || !object.types.includes('Land')
    ) {
      return 'Rain of Filth requires a land you control'
    }
    if (!canSacrificeLandForBlack(state, event.seat)) {
      return 'lands do not currently have Rain of Filth mana abilities'
    }
    if (!event.manaAbility) return 'Rain of Filth grants a mana ability'
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'activateAbility' || event.abilityId !== SACRIFICE_LAND_FOR_BLACK) return
    draft.enqueue({ type: 'move', objectId: event.objectId, to: 'graveyard' })
    draft.enqueue({ type: 'addMana', seat: event.seat, mana: { B: 1 } })
    draft.note(`${event.seat} sacrifices a land for {B}`)
  },
}
