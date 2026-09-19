import { hasKeyword } from '../keywords'
import { everybodyLives } from '../plugins/advancedCombatPrevention'
import { openCardSelection } from '../rules/selectCards'
import type Draft from '../draft'
import type { GameObject, Plugin, StackItem } from '../types'
import { basicLand } from './effects'

const supported = new Set([
  'Batwing Brume',
  'Comeuppance',
  'Energy Arc',
  'Everybody Lives!',
  'Inkshield',
  'Settle the Wreckage',
])

const resolving = (
  state: Parameters<NonNullable<Plugin['apply']>>[0]['state'],
): { item: StackItem; source: GameObject } | undefined => {
  const item = state.stack[0]
  const source = item ? state.objects[item.objectId] : undefined
  if (!item || item.kind !== 'spell' || !source || !supported.has(source.name)) return
  return { item, source }
}

const openSettleSearch = (
  draft: Draft,
  seat: string,
  sourceId: string,
  objectIds: string[],
) => {
  const exiled = objectIds.filter((objectId) => draft.object(objectId)?.zone === 'exile')
  const candidates = draft.zoneOrder[seat].library.filter((objectId) => {
    const object = draft.object(objectId)
    return Boolean(object && basicLand(object))
  })
  if (candidates.length === 0) {
    draft.enqueue({ type: 'shuffleLibrary', seat })
    return
  }
  openCardSelection(draft, {
    seat,
    kind: 'choose',
    count: Math.min(exiled.length, candidates.length),
    min: 0,
    candidates,
    sourceId,
    source: 'Settle the Wreckage',
    prompt: `Search for up to ${exiled.length} basic land card(s). They enter tapped.`,
    destinations: ['library', 'battlefield'],
    fromSeat: seat,
    fromZone: 'library',
    moveSelectedTo: 'battlefield',
    moveSelectedController: seat,
    tapSelected: true,
    after: ['shuffleLibrary'],
  })
}

export const combatPreventionCards: Plugin = {
  id: 'combatPreventionCards',
  legal: ({ state, event }) => {
    if (event.type === 'searchBasicsForExiledAttackers') {
      const source = state.objects[event.sourceId]
      if (source?.name !== 'Settle the Wreckage') return 'invalid Settle search source'
      if (!state.players[event.seat]) return 'invalid Settle search seat'
      if (new Set(event.objectIds).size !== event.objectIds.length) {
        return 'Settle search objects must be distinct'
      }
      return
    }
    if (event.type !== 'castSpell') return
    const source = state.objects[event.objectId]
    if (!source || !supported.has(source.name)) return
    const targets = event.targets ?? []
    if (source.name === 'Energy Arc') {
      const ids = targets.flatMap((target) => target.kind === 'object' ? [target.objectId] : [])
      if (ids.length !== targets.length) return 'Energy Arc requires creature targets'
      if (new Set(ids).size !== ids.length) return 'Energy Arc cannot target a creature twice'
      if (ids.some((id) => {
        const creature = state.objects[id]
        return !creature
          || creature.zone !== 'battlefield'
          || !creature.types.includes('Creature')
          || (
            creature.controller !== event.seat
            && hasKeyword(creature, 'hexproof', state)
          )
      })) {
        return 'illegal target for Energy Arc'
      }
    }
    if (source.name === 'Settle the Wreckage') {
      if (targets.length !== 1 || targets[0].kind !== 'player') {
        return 'Settle the Wreckage requires one player target'
      }
      if (!state.players[targets[0].player] || state.players[targets[0].player].lost) {
        return 'illegal target for Settle the Wreckage'
      }
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'searchBasicsForExiledAttackers') {
      openSettleSearch(draft, event.seat, event.sourceId, event.objectIds)
      return
    }
    if (event.type !== 'resolveTop') return
    const resolution = resolving(state)
    if (!resolution) return
    const { item, source } = resolution

    if (source.name === 'Batwing Brume') {
      if ((item.manaSpent?.W ?? 0) > 0) {
        draft.enqueue({
          type: 'addRule',
          pluginId: 'fog',
          params: { untilCleanup: true },
        })
      }
      if ((item.manaSpent?.B ?? 0) > 0) {
        for (const seat of draft.playerOrder) {
          const attackers = Object.values(draft.objects).filter((object) =>
            object.zone === 'battlefield'
            && object.controller === seat
            && object.attacking !== null).length
          if (attackers > 0) {
            draft.enqueue({ type: 'loseLife', seat, amount: attackers, source: source.id })
          }
        }
      }
      return
    }

    if (source.name === 'Comeuppance') {
      draft.enqueue({
        type: 'addRule',
        pluginId: 'advancedCombatPrevention',
        params: {
          mode: 'comeuppance',
          controller: item.controller,
          cardSourceId: source.id,
          untilCleanup: true,
        },
      })
      return
    }

    if (source.name === 'Energy Arc') {
      const creatureIds = item.targets.flatMap((target) => {
        if (target.kind !== 'object') return []
        const creature = draft.object(target.objectId)
        if (
          !creature
          || creature.zone !== 'battlefield'
          || !creature.types.includes('Creature')
          || (
            creature.controller !== item.controller
            && hasKeyword(creature, 'hexproof', draft)
          )
        ) {
          return []
        }
        draft.enqueue({ type: 'untap', objectId: creature.id })
        return [creature.id]
      })
      if (creatureIds.length > 0) {
        draft.enqueue({
          type: 'addRule',
          pluginId: 'fog',
          params: { creatureIds, untilCleanup: true },
        })
      }
      return
    }

    if (source.name === 'Everybody Lives!') {
      draft.enqueue({
        type: 'addRule',
        pluginId: 'advancedCombatPrevention',
        params: { mode: 'everybodyLives', untilCleanup: true },
      })
      return
    }

    if (source.name === 'Inkshield') {
      draft.enqueue({
        type: 'addRule',
        pluginId: 'advancedCombatPrevention',
        params: {
          mode: 'inkshield',
          controller: item.controller,
          untilCleanup: true,
        },
      })
      return
    }

    const target = item.targets[0]
    if (
      target?.kind !== 'player'
      || state.players[target.player]?.lost
      || (target.player !== item.controller && everybodyLives(state))
    ) {
      return
    }
    const attacking = Object.values(draft.objects).filter((object) =>
      object.zone === 'battlefield'
      && object.controller === target.player
      && object.attacking !== null)
    for (const creature of attacking) {
      draft.enqueue({ type: 'move', objectId: creature.id, to: 'exile' })
    }
    draft.enqueue({
      type: 'searchBasicsForExiledAttackers',
      seat: target.player,
      sourceId: source.id,
      objectIds: attacking.map((creature) => creature.id),
    })
  },
}
