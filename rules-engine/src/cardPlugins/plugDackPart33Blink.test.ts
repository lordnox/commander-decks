import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { alternateCosts } from './alternateCosts'
import { blinkPlugin } from './blink'
import { choiceEffects } from './choiceEffects'
import { giftCast } from './giftCast'
import { linkedExile } from './linkedExile'
import { onResolve as onResolvePlugin } from './onResolve'
import { spreeCast } from './spreeCast'
import { targetedResolve } from './targetedResolve'

const dackBlinkPlugins = [
  targetedResolve,
  blinkPlugin,
  activated,
  linkedExile,
  alternateCosts,
  choiceEffects,
  giftCast,
  spreeCast,
  onResolvePlugin,
]

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const mana = (state: GameState, seat = 'p1') => {
  state.players[seat].mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
  return state
}

const castAndResolve = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  spellName: string,
  targets?: Array<{ kind: 'object'; objectId: string }>,
  extra: { spreeModes?: string[]; giftPromised?: boolean; giftRecipientId?: string } = {},
) => {
  const cast = ok(server.rules(mana(structuredClone(state)), {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, spellName).id,
    ...(targets ? { targets } : {}),
    ...(extra.spreeModes ? { spreeModes: extra.spreeModes } : {}),
    ...(extra.giftPromised
      ? { giftPromised: true, giftRecipient: extra.giftRecipientId ?? 'p2' }
      : {}),
  }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

describe('Dack party blink pass 2', () => {
  test('Cloudshift returns a stolen creature under your control', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Cloudshift')] },
      battlefield: {
        p2: [cardTemplate('Stolen Cat', { types: ['Creature'], power: 1, toughness: 1 })],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const ready = structuredClone(server.state)
    const cat = named(ready, 'Stolen Cat')
    cat.controller = 'p1'
    const resolved = castAndResolve(server, ready, 'Cloudshift', [
      { kind: 'object', objectId: cat.id },
    ])
    expect(resolved.objects[cat.id]).toMatchObject({
      zone: 'battlefield',
      owner: 'p2',
      controller: 'p1',
    })
  })

  test('Flicker of Fate blinks an enchantment immediately under its owner', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Flicker of Fate')] },
      battlefield: {
        p2: [cardTemplate('Borrowed Aura', { types: ['Enchantment'] })],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const ready = structuredClone(server.state)
    const aura = named(ready, 'Borrowed Aura')
    aura.controller = 'p1'
    const resolved = castAndResolve(server, ready, 'Flicker of Fate', [
      { kind: 'object', objectId: aura.id },
    ])
    expect(resolved.objects[aura.id]).toMatchObject({
      zone: 'battlefield',
      owner: 'p2',
      controller: 'p2',
    })
  })

})
