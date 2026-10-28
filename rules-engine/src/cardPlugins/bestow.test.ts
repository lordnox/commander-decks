import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest, type CardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { bestow } from './bestow'
import { attachedCopyOrToken, landfall } from './effects'

const creature = (name = 'Grizzly Bears') => cardTemplate(name, {
  types: ['Creature'],
  power: 2,
  toughness: 2,
})

const insectToken = {
  name: 'Insect',
  types: ['Creature'],
  subtypes: ['Insect'],
  power: 1,
  toughness: 1,
}

const springheart = (extra: Partial<CardTemplate> = {}) => cardTemplate(
  'Test Bestower',
  {
    types: ['Enchantment', 'Creature'],
    subtypes: ['Insect', 'Monk'],
    manaCost: '{1}{G}',
    power: 1,
    toughness: 1,
    effects: [
      landfall(attachedCopyOrToken('{1}{G}', insectToken)),
    ],
    ...extra,
  },
)

const game = (options: {
  hand?: CardTemplate[]
  battlefield?: CardTemplate[]
}) => createServerGame(
  commanderRules,
  {
    hands: { p1: options.hand ?? [] },
    battlefield: { p1: options.battlefield ?? [] },
  },
  { random: () => 0.5, cardPlugins: [bestow] },
)

const objectsNamed = (state: GameState, name: string) =>
  Object.values(state.objects).filter((object) => object.name === name)

const attachedGame = () => {
  const server = game({ battlefield: [springheart(), creature()] })
  const spring = objectsNamed(server.state, 'Test Bestower')[0]
  const bear = objectsNamed(server.state, 'Grizzly Bears')[0]
  spring.types = ['Enchantment']
  spring.subtypes = ['Aura']
  spring.power = null
  spring.toughness = null
  spring.attachedTo = bear.id
  bear.power = 3
  bear.toughness = 3
  return { server, spring, bear }
}

describe('attachedCopyOrToken instruction', () => {
  test('landfall copies the attached creature when paid and makes an Insect otherwise', () => {
    const paid = attachedGame()
    paid.server.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
    paid.server.state.zoneOrder.p1.hand.push('land')
    paid.server.state.zoneCounts.p1.hand += 1
    paid.server.state.objects.land = {
      ...forest(),
      id: 'land',
      owner: 'p1',
      controller: 'p1',
      zone: 'hand',
    }
    const triggered = ok(paid.server.rules(paid.server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: 'land',
    }))
    const choosing = ok(paid.server.rules(triggered, { type: 'resolveTop' }))
    expect(pendingDialog(choosing)).toMatchObject({
      kind: 'may-pay-mana',
      cost: '{1}{G}',
      sourceId: paid.spring.id,
    })
    const copied = ok(paid.server.rules(choosing, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    expect(objectsNamed(copied, 'Grizzly Bears')).toHaveLength(2)
    expect(objectsNamed(copied, 'Insect')).toHaveLength(0)
    expect(copied.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })

    const declined = attachedGame()
    declined.server.state.zoneOrder.p1.hand.push('land')
    declined.server.state.zoneCounts.p1.hand += 1
    declined.server.state.objects.land = {
      ...forest(),
      id: 'land',
      owner: 'p1',
      controller: 'p1',
      zone: 'hand',
    }
    const declinedTrigger = ok(declined.server.rules(declined.server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: 'land',
    }))
    const declinedChoice = ok(declined.server.rules(
      declinedTrigger,
      { type: 'resolveTop' },
    ))
    const insect = ok(declined.server.rules(declinedChoice, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: false },
    }))
    expect(objectsNamed(insect, 'Grizzly Bears')).toHaveLength(1)
    expect(objectsNamed(insect, 'Insect')).toHaveLength(1)
  })
})
