import type Draft from '../draft'
import type { GameObject, PlayerId, Plugin } from '../types'
import {
  conditionHolds,
  millLibrary,
  triggerEffects,
  type CardInstruction,
} from './effects'
import { effectsOf } from './cardRules'
import { enteringObjectId, PERMANENT_ENTERED } from './entersTapped'

const tokenDefaults = (): Omit<GameObject, 'id' | 'name' | 'owner' | 'controller'> => ({
  zone: 'battlefield',
  tapped: false,
  summoningSickness: true,
  damageMarked: 0,
  counters: {},
  types: [],
  subtypes: [],
  supertypes: [],
  manaCost: '',
  power: null,
  toughness: null,
  oracleText: '',
  attachedTo: null,
  attacking: null,
  blocking: null,
  grantedRules: [],
  token: true,
  tags: [],
  effects: [],
})

/** Tokens are created by the effect, not by a `move`: no card exists to move. */
export const createToken = (
  draft: Draft,
  controller: PlayerId,
  template: Partial<GameObject> & { name: string },
  emitEntry = true,
) => {
  const id = draft.allocId('tok')
  const token: GameObject = {
    ...tokenDefaults(),
    ...template,
    id,
    owner: controller,
    controller,
    zone: 'battlefield',
    token: true,
    effects: template.effects ?? [],
  }
  draft.objects[id] = token
  draft.zoneOrder[controller].battlefield.push(id)
  draft.zoneCounts[controller].battlefield += 1
  for (const pluginId of token.grantedRules) {
    draft.rules.push({
      instanceId: draft.allocId('rule'),
      pluginId,
      sourceId: id,
      timestamp: draft.allocTs(),
      params: {},
    })
  }
  draft.note(`${controller} creates ${token.name}`)
  if (emitEntry) {
    draft.enqueue({
      type: 'custom',
      name: PERMANENT_ENTERED,
      seat: controller,
      payload: { objectId: id },
    })
  }
  return token
}

/**
 * `stateBased` reads `power` / `toughness` directly, so a +1/+1 counter has to
 * move both the counter map and the printed values or a 0/0 with counters dies
 * as a state-based action. Counters are not layered anywhere in the kernel yet.
 */
export const addPlusCounters = (object: GameObject, amount: number) => {
  if (amount === 0) return
  object.counters['+1/+1'] = (object.counters['+1/+1'] ?? 0) + amount
  if (object.power !== null) object.power += amount
  if (object.toughness !== null) object.toughness += amount
}

const runLandfall = (
  draft: Draft,
  source: GameObject,
  instructions: CardInstruction[],
) => {
  for (const instruction of instructions) {
    if (instruction.kind === 'if') {
      const live = draft.object(source.id) ?? source
      runLandfall(
        draft,
        source,
        conditionHolds(instruction.if, draft, live)
          ? instruction.whenTrue
          : instruction.whenFalse ?? [],
      )
      continue
    }
    if (instruction.kind === 'selfMill') {
      millLibrary(draft, source.controller, instruction.count)
      continue
    }
    if (instruction.kind === 'createToken') {
      createToken(draft, source.controller, {
        name: instruction.token.name,
        types: instruction.token.types,
        subtypes: instruction.token.subtypes ?? [],
        power: instruction.token.power ?? null,
        toughness: instruction.token.toughness ?? null,
        oracleText: instruction.token.oracleText ?? '',
      })
      continue
    }
    if (instruction.kind === 'copySelf') {
      const live = draft.object(source.id) ?? source
      createToken(draft, live.controller, {
        name: live.name,
        types: [...live.types],
        subtypes: [...live.subtypes],
        power: live.power,
        toughness: live.toughness,
        oracleText: live.oracleText,
        effects: live.effects ?? [],
      })
      continue
    }
    if (instruction.kind === 'doublePlusCounters') {
      const live = draft.object(source.id)
      if (!live) continue
      addPlusCounters(live, live.counters['+1/+1'] ?? 0)
      draft.note(`${live.name} doubles to ${live.counters['+1/+1'] ?? 0} +1/+1 counters`)
    }
  }
}

/**
 * One dispatcher for every landfall ability. The land is already on the
 * battlefield when effects run, so "if you control six or more lands" and
 * "this land or another land you control" both count it, as Oracle does.
 */
export const landfall: Plugin = {
  id: 'landfall',
  apply: ({ state, event, draft }) => {
    const objectId = enteringObjectId(event, state)
    if (!objectId) return
    const land = draft.object(objectId)
    if (!land || land.zone !== 'battlefield' || !land.types.includes('Land')) return
    for (const source of draft.zoneOf('battlefield', land.controller)) {
      const effects = triggerEffects(effectsOf(source), 'landfall')
      if (effects.length === 0) continue
      draft.note(`Landfall — ${source.name}`)
      for (const effect of effects) {
        if (!conditionHolds(effect.if, draft, source)) continue
        runLandfall(draft, source, effect.do)
      }
    }
  },
}
