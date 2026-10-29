import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import {pendingPlayerSelectionFor} from '../rules/selectPlayers'
import {pendingDialogFor} from '../pendingDialog'
import { pendingOptionSelection } from '../rules/selectOptions'
import { instructionSpell } from './dsl/instructionTestSupport'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, createToken, may, mill, ref, self, whenever } from './dsl/v1'
import type { TokenDefinition } from './dsl/schema/v2'
import boggartTrawler from '../cards/boggart-trawler'
const millToken = {
  name: 'Mill Scout',
  types: ['Creature'],
  subtypes: ['Scout'],
  power: 1,
  toughness: 1,
  abilities: [whenever(self.attacks, { instructions: [may(mill({ count: 1, targets: ref('controller') }))] })],
} satisfies TokenDefinition

const plainToken = {
  name: 'Plain Scout',
  types: ['Creature'],
  subtypes: ['Scout'],
  power: 1,
  toughness: 1,
} satisfies TokenDefinition

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

const makeToken = (token: TokenDefinition) => {
  const makerRule = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(self.enters, { instructions: [createToken({ count: 1, targets: ref('controller'), token })] }),
  ])))
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      hands: {
        p1: [cardTemplate('Token Maker', { types: ['Creature'], ruleDefinition: makerRule })],
      },
      libraries: {
        p1: [
          cardTemplate('Milled One', { types: ['Instant'] }),
          cardTemplate('Milled Two', { types: ['Instant'] }),
        ],
      },
    },
    { random: () => 0.5 },
  )
  const maker = named(server.state, 'Token Maker').id
  const entered = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'move', objectId: maker, to: 'battlefield',
  })))
  return { server, state: entered, tokenId: named(entered, token.name).id }
}

const resolveMay = (server: ReturnType<typeof createServerGame>, state: GameState, accept: boolean) => {
  const choice = pendingOptionSelection(state, 'p1')!
  return ok(server.rules(state, {
    type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: choice.options[accept ? 0 : 1].id,
  }))
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
    expect(pendingOptionSelection(choosing, 'p1')).toMatchObject({
      seat: 'p1', source: 'Mill Scout', optionalAction: { acceptSlot: 0, declineSlot: 1 },
    })
    expect(pendingOptionSelection(choosing, 'p1')?.options).toHaveLength(2)
  })

  test('declining the mill leaves the library intact', () => {
    const { server, state, tokenId } = makeToken(millToken)
    const choosing = ok(server.rules(ok(server.rules(attackReady(state, tokenId), {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: tokenId, defender: { kind: 'player', player: 'p2' } }],
    })), { type: 'resolveTop' }))
    const declined = resolveMay(server, choosing, false)
    expect(declined.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(named(declined, 'Milled One').zone).toBe('library')
    expect(pendingOptionSelection(declined, 'p1')).toBeUndefined()
  })

  test('accepting mills one card', () => {
    const { server, state, tokenId } = makeToken(millToken)
    const choosing = ok(server.rules(ok(server.rules(attackReady(state, tokenId), {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: tokenId, defender: { kind: 'player', player: 'p2' } }],
    })), { type: 'resolveTop' }))
    const milled = resolveMay(server, choosing, true)
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
    expect(pendingOptionSelection(declared, 'p1')).toBeUndefined()
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
    expect(pendingOptionSelection(choosing, 'p1')?.optionalAction).toBeDefined()
    const restarted = structuredClone(choosing)
    expect(pendingOptionSelection(restarted, 'p1')).toMatchObject({
      seat: 'p1', source: 'Mill Scout', optionalAction: { acceptSlot: 0, declineSlot: 1 },
    })
    const milled = resolveMay(server, restarted, true)
    expect(named(milled, 'Milled One').zone).toBe('graveyard')
  })
})

describe('relocated from kambalManaGraveyards.test.ts → tokenCarriedTriggers.test.ts', () => {
  test('a token copy of Trawler carries its graveyard exile trigger', () => {
      const server = createServerGame(commanderRules, {
        hands: { p1: [instructionSpell({
          instructions: [createToken({
            count: 1,
            targets: ref('controller'),
            token: {
              name: 'Boggart Trawler',
              types: ['Creature'],
              subtypes: ['Goblin'],
              power: 3,
              toughness: 1,
              abilities: boggartTrawler.ruleDefinition.definition.abilities,
            },
          })],
        })] },
      }, { random: () => 0.5 })
      const state = resolveStack(server.rules, ok(server.rules(server.state, {
        type: 'castSpell',
        seat: 'p1',
        objectId: server.state.zoneOrder.p1.hand[0],
      })))
      expect(pendingPlayerSelectionFor(state, 'p1')).toBeDefined()
      expect(pendingDialogFor(state, 'p1')).toBeUndefined()
    })

})
