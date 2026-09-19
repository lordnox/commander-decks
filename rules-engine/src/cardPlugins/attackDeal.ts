import type { GameObject, GameState, PlayerId, Plugin, TargetRef } from '../types'
import { effectsOf } from './cardRules'

const DRAW_ABILITY = 'attackDeal.draw'
const BREAK_ABILITY = 'attackDeal.break'

const dealEffect = (object: GameObject | undefined) =>
  object && effectsOf(object).find((effect) => effect.op === 'playerAuraDeal')

const defendingPlayer = (
  state: GameState,
  target: TargetRef | PlayerId,
) => {
  if (typeof target === 'string') return target
  return target.kind === 'player'
    ? target.player
    : state.objects[target.objectId]?.controller
}

const deals = (state: GameState) =>
  Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield'
    && typeof object.attachedTo === 'string'
    && Boolean(state.players[object.attachedTo])
    && Boolean(dealEffect(object)))

const attackBreaksDeal = (
  state: GameState,
  aura: GameObject,
  event: Extract<Parameters<NonNullable<Plugin['apply']>>[0]['event'], { type: 'declareAttackers' }>,
) => {
  const opponent = aura.attachedTo
  if (!opponent) return false
  return event.attackers.some((declaration) => {
    const defender = defendingPlayer(state, declaration.defender)
    return (
      event.seat === aura.controller && defender === opponent
    ) || (
      event.seat === opponent && defender === aura.controller
    )
  })
}

export const attackDeal: Plugin = {
  id: 'attackDeal',
  sba: ({ draft }) =>
    Object.values(draft.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && Boolean(dealEffect(object))
        && (
          !object.attachedTo
          || !draft.players[object.attachedTo]
          || draft.players[object.attachedTo].lost
          || object.attachedTo === object.controller
        ))
      .map((object) => ({ type: 'move' as const, objectId: object.id, to: 'graveyard' as const })),
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const source = state.objects[event.objectId]
    if (!dealEffect(source)) return
    const target = event.targets?.[0]
    if (
      event.targets?.length !== 1
      || target?.kind !== 'player'
      || target.player === event.seat
      || !state.players[target.player]
      || state.players[target.player].lost
    ) {
      return `${source?.name ?? 'that Aura'} requires one opponent target`
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'resolveTop') {
      const item = state.stack[0]
      const source = item ? draft.object(item.objectId) : undefined
      if (item?.kind === 'spell' && source && dealEffect(source)) {
        const target = item.targets[0]
        if (target?.kind === 'player' && draft.players[target.player] && !draft.players[target.player].lost) {
          source.attachedTo = target.player
          draft.note(`${source.name} enchants ${target.player}`)
        }
        return
      }
      if (item?.abilityId === DRAW_ABILITY) {
        const opponent = typeof item.payload?.opponent === 'string'
          ? item.payload.opponent
          : undefined
        const count = Number(item.payload?.count ?? 0)
        if (opponent && count > 0) {
          draft.enqueue({ type: 'draw', seat: item.controller, count })
          draft.enqueue({ type: 'draw', seat: opponent, count })
        }
        return
      }
      if (item?.abilityId === BREAK_ABILITY && source?.zone === 'battlefield') {
        draft.enqueue({ type: 'move', objectId: source.id, to: 'graveyard' })
      }
      return
    }

    if (event.type === 'custom' && event.name === 'advanceStep' && draft.step === 'end') {
      for (const aura of deals(draft as unknown as GameState)) {
        const effect = dealEffect(aura)
        if (!effect || aura.attachedTo !== draft.active) continue
        draft.addToStack({
          kind: 'ability',
          objectId: aura.id,
          controller: aura.controller,
          name: aura.name,
          targets: [],
          abilityId: DRAW_ABILITY,
          payload: {
            opponent: aura.attachedTo,
            count: effect.drawAtEnchantedEnd,
          },
        })
      }
      return
    }

    if (event.type === 'declareAttackers') {
      for (const aura of deals(state)) {
        const effect = dealEffect(aura)
        if (!effect?.breakOnMutualAttack || !attackBreaksDeal(state, aura, event)) continue
        draft.addToStack({
          kind: 'ability',
          objectId: aura.id,
          controller: aura.controller,
          name: aura.name,
          targets: [],
          abilityId: BREAK_ABILITY,
        })
      }
    }
  },
}
