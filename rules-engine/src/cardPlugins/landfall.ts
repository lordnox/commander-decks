import type Draft from '../draft'
import type { GameObject, PlayerId, Plugin } from '../types'
import { enteringObjectId, PERMANENT_ENTERED } from './entersTapped'

export type LandfallCtx = {
  draft: Draft
  /** The permanent whose landfall ability triggered. */
  source: GameObject
  /** The land that entered. */
  land: GameObject
}

export type LandfallEffect = (ctx: LandfallCtx) => void

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

const controlledLands = (draft: Draft, seat: PlayerId) =>
  draft.zoneOf('battlefield', seat).filter((object) => object.types.includes('Land'))

const insectToken = (name: string) => ({
  name,
  types: ['Creature'],
  subtypes: ['Insect'],
  power: 1,
  toughness: 1,
})

/** Mill from the top of a library as ordinary moves, so hidden info stays in the kernel. */
const mill = (draft: Draft, seat: PlayerId, count: number) => {
  for (const objectId of draft.zoneOrder[seat].library.slice(0, count)) {
    draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
  }
}

/**
 * Landfall abilities whose whole effect is determined: no target, no "may",
 * and no modes. Anything the controller answers needs a pending choice and is
 * deliberately absent.
 */
export const LANDFALL: Record<string, LandfallEffect> = {
  'Mole Man, Moloid Master': ({ draft, source }) => {
    createToken(draft, source.controller, {
      name: 'Moloid',
      types: ['Creature'],
      subtypes: ['Minion'],
      power: 1,
      toughness: 1,
      oracleText: 'Whenever this token attacks, you may mill a card.',
    })
  },
  'Scute Swarm': ({ draft, source }) => {
    const copy = controlledLands(draft, source.controller).length >= 6
    createToken(draft, source.controller, copy
      ? {
          name: source.name,
          types: [...source.types],
          subtypes: [...source.subtypes],
          power: source.power,
          toughness: source.toughness,
          oracleText: source.oracleText,
        }
      : insectToken('Insect'))
  },
  'Mossborn Hydra': ({ draft, source }) => {
    const live = draft.object(source.id)
    if (!live) return
    addPlusCounters(live, live.counters['+1/+1'] ?? 0)
    draft.note(`${live.name} doubles to ${live.counters['+1/+1'] ?? 0} +1/+1 counters`)
  },
  'Icetill Explorer': ({ draft, source }) => {
    mill(draft, source.controller, 1)
  },
  'Field of the Dead': ({ draft, source }) => {
    const names = new Set(
      controlledLands(draft, source.controller).map((land) => land.name),
    )
    if (names.size < 7) return
    createToken(draft, source.controller, {
      name: 'Zombie',
      types: ['Creature'],
      subtypes: ['Zombie'],
      power: 2,
      toughness: 2,
    })
  },
}

/**
 * One dispatcher for every landfall ability. The land is already on the
 * battlefield when effects run, so "if you control six or more lands" and
 * "this land or another land you control" both count it, as Oracle does.
 */
export const landfall: Plugin = {
  id: 'landfall',
  apply: ({ event, draft }) => {
    const objectId = enteringObjectId(event)
    if (!objectId) return
    const land = draft.object(objectId)
    if (!land || land.zone !== 'battlefield' || !land.types.includes('Land')) return
    for (const source of draft.zoneOf('battlefield', land.controller)) {
      const effect = LANDFALL[source.name]
      if (!effect) continue
      draft.note(`Landfall — ${source.name}`)
      effect({ draft, source, land })
    }
  },
}
