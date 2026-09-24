import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { choiceEffects } from './choiceEffects'
import {
  attacks,
  createTokenInstruction,
  enters,
  optionalMill,
} from './effects'

const millToken = {
  name: 'Mill Scout',
  types: ['Creature'],
  subtypes: ['Scout'],
  power: 1,
  toughness: 1,
  effects: [attacks(optionalMill(1))],
}

const plainToken = {
  name: 'Plain Scout',
  types: ['Creature'],
  subtypes: ['Scout'],
  power: 1,
  toughness: 1,
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const attackReady = (state: GameState, objectId: string) => {
  const next = structuredClone(state)
  next.step = 'declareAttackers'
  next.active = 'p1'
  next.priority = 'p1'
  next.objects[objectId].summoningSickness = false
  return next
}

const makeToken = (token: typeof millToken | typeof plainToken) => {
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      hands: {
        p1: [cardTemplate('Token Maker', {
          types: ['Creature'],
          effects: [enters(createTokenInstruction(token))],
        })],
      },
      libraries: {
        p1: [
          cardTemplate('Milled One', { types: ['Instant'] }),
          cardTemplate('Milled Two', { types: ['Instant'] }),
        ],
      },
    },
    { random: () => 0.5, cardPlugins: [choiceEffects] },
  )
  const maker = named(server.state, 'Token Maker').id
  const entered = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'move',
    objectId: maker,
    to: 'battlefield',
  })))
  return { server, state: entered, tokenId: named(entered, token.name).id }
}

describe('token-carried triggered abilities', () => {
  test('a token stamped with optional mill opens a may dialog when it attacks', () => {
    const { server, state, tokenId } = makeToken(millToken)
    const declared = ok(server.rules(attackReady(state, tokenId), {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: tokenId, defender: { kind: 'player', player: 'p2' } }],
    }))
    expect(declared.stack[0]).toMatchObject({ kind: 'ability', name: 'Mill Scout' })
    const choosing = ok(server.rules(declared, { type: 'resolveTop' }))
    expect(pendingDialog(choosing)).toMatchObject({
      kind: 'may',
      seat: 'p1',
      source: 'Mill Scout',
      count: 1,
    })
  })

  test('declining the mill leaves the library intact', () => {
    const { server, state, tokenId } = makeToken(millToken)
    const choosing = ok(server.rules(ok(server.rules(attackReady(state, tokenId), {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: tokenId, defender: { kind: 'player', player: 'p2' } }],
    })), { type: 'resolveTop' }))
    const declined = ok(server.rules(choosing, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: false },
    }))
    expect(declined.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(named(declined, 'Milled One').zone).toBe('library')
    expect(pendingDialog(declined)).toBeUndefined()
  })

  test('accepting mills one card', () => {
    const { server, state, tokenId } = makeToken(millToken)
    const choosing = ok(server.rules(ok(server.rules(attackReady(state, tokenId), {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: tokenId, defender: { kind: 'player', player: 'p2' } }],
    })), { type: 'resolveTop' }))
    const milled = ok(server.rules(choosing, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    expect(named(milled, 'Milled One').zone).toBe('graveyard')
    expect(named(milled, 'Milled Two').zone).toBe('library')
  })

  test('a token without the stamped attack effect does not mill', () => {
    const { server, state, tokenId } = makeToken(plainToken)
    const declared = ok(server.rules(attackReady(state, tokenId), {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: tokenId, defender: { kind: 'player', player: 'p2' } }],
    }))
    expect(declared.stack).toHaveLength(0)
    expect(pendingDialog(declared)).toBeUndefined()
    expect(declared.zoneOrder.p1.graveyard).toHaveLength(0)
  })

  test('declaring attackers outside the attackers step is illegal', () => {
    const { server, state, tokenId } = makeToken(millToken)
    const ready = structuredClone(state)
    ready.objects[tokenId].summoningSickness = false
    const result = server.rules(ready, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: tokenId, defender: { kind: 'player', player: 'p2' } }],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('declare attackers')
  })

  test('host restart keeps the optional mill dialog and still mills on accept', () => {
    const { server, state, tokenId } = makeToken(millToken)
    const choosing = ok(server.rules(ok(server.rules(attackReady(state, tokenId), {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: tokenId, defender: { kind: 'player', player: 'p2' } }],
    })), { type: 'resolveTop' }))
    expect(pendingDialog(choosing)?.kind).toBe('may')
    const restarted = structuredClone(choosing)
    expect(pendingDialog(restarted)).toMatchObject({
      kind: 'may',
      seat: 'p1',
      source: 'Mill Scout',
    })
    const milled = ok(server.rules(restarted, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    expect(named(milled, 'Milled One').zone).toBe('graveyard')
  })
})
