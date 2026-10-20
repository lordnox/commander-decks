import { everybodyLives } from '../plugins/advancedCombatPrevention'
import { openCardSelection } from '../rules/selectCards'
import type Draft from '../draft'
import type { GameObject, Plugin, StackItem } from '../types'
import { basicLand } from './effects'

const supported = new Set([
  'Everybody Lives!',
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

    if (source.name === 'Everybody Lives!') {
      draft.enqueue({
        type: 'addRule',
        pluginId: 'advancedCombatPrevention',
        params: { mode: 'everybodyLives', untilCleanup: true },
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
