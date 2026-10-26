import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { hasKeyword } from '../../keywords'
import { copyCharacteristics } from '../effectRuntime'
import { instructionSpell } from './instructionTestSupport'
import {
  captureCopy,
  card,
  compileCardRuleDefinition,
  copy,
  createEffect,
  objects,
  select,
  setColorsEffect,
  spell,
  target,
  untilCleanup,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const copiesOf = (state: GameState, name: string) =>
  Object.values(state.objects).filter(object => object.name === name && object.token && object.zone === 'battlefield')

const copySpell = (except?: Parameters<typeof copy>[0]['except']) => instructionSpell({
  decisions: { targets: [select({ filter: objects({ zone: 'battlefield' }), count: 1 })] },
  instructions: [copy({
    targets: target(0),
    ...(except ? { except } : {}),
  })],
})

const resolveCopy = (
  original: Parameters<typeof cardTemplate>[1],
  except?: Parameters<typeof copy>[0]['except'],
  extra: Parameters<typeof createServerGame>[1] = {},
) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [copySpell(except)] },
    battlefield: { p1: [cardTemplate('Copied Original', { types: ['Creature'], power: 2, toughness: 2, ...original })] },
    ...extra,
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  const resolved = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(ready, 'Instruction fixture').id,
    targets: [{ kind: 'object', objectId: named(ready, 'Copied Original').id }],
  })))
  return { server, original: named(resolved, 'Copied Original'), copy: copiesOf(resolved, 'Copied Original')[0]!, resolved }
}

test('copy except strips legendary and adds flying without changing the original', () => {
  const { original, copy: token } = resolveCopy({
    supertypes: ['Legendary'],
    oracleText: 'Vigilance',
  }, { notLegendary: true, keywords: ['flying'] })
  expect(original.supertypes).toEqual(['Legendary'])
  expect(hasKeyword(original, 'flying')).toBe(false)
  expect(token.supertypes).toEqual([])
  expect(hasKeyword(token, 'flying')).toBe(true)
  expect(token.token).toBe(true)
})

test('copy except adds types, subtypes, and removes the mana cost', () => {
  const { copy: token } = resolveCopy({
    subtypes: ['Human'],
    manaCost: '{2}{W}',
    manaValue: 3,
  }, { types: ['Artifact'], subtypes: ['Zombie'], noManaCost: true })
  expect(token.types.toSorted()).toEqual(['Artifact', 'Creature'])
  expect(token.subtypes.toSorted()).toEqual(['Human', 'Zombie'])
  expect(token.manaCost).toBe('')
  expect(token.manaValue).toBe(0)
})

test('copy except can replace colors after copiable values are taken', () => {
  const { copy: token } = resolveCopy({ colors: 'U' }, { colors: 'W' })
  expect(token.colors).toBe('W')
})

test('copy except preserves an explicit colorless override through snapshot restore', () => {
  const { server, copy: token, resolved } = resolveCopy({ colors: 'U' }, { colors: '' })
  expect(token.colors).toBe('')
  expect(copyCharacteristics(token).colors).toBe('')
  const restored = restoreJournal(createJournal(resolved), server.rules).current()
  expect(copiesOf(restored, 'Copied Original')[0]!.colors).toBe('')
})

test('copy keeps copiable colors unless except replaces them', () => {
  const paint = instructionSpell({
    instructions: [createEffect({
      targets: objects({ name: 'Copied Original' }),
      effect: setColorsEffect('B'),
      duration: untilCleanup(),
    })],
  })
  paint.name = 'Paint fixture'
  const copiableCopy = copySpell()
  copiableCopy.name = 'Copiable copy fixture'
  const overriddenCopy = copySpell({ colors: 'W' })
  overriddenCopy.name = 'Overridden copy fixture'
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [paint, copiableCopy, overriddenCopy] },
    battlefield: { p1: [cardTemplate('Copied Original', { types: ['Creature'], colors: 'R', power: 2, toughness: 2 })] },
  }, { random: () => 0 })
  let state = structuredClone(server.state)
  state = resolveStack(server.rules, ok(server.rules(state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, 'Paint fixture').id,
  })))
  expect(named(state, 'Copied Original').colors).toBe('B')
  const copiable = resolveStack(server.rules, ok(server.rules(state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, 'Copiable copy fixture').id,
    targets: [{ kind: 'object', objectId: named(state, 'Copied Original').id }],
  })))
  expect(copiesOf(copiable, 'Copied Original')[0]!.colors).toBe('R')
  const overridden = resolveStack(server.rules, ok(server.rules(copiable, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(copiable, 'Overridden copy fixture').id,
    targets: [{ kind: 'object', objectId: named(copiable, 'Copied Original').id }],
  })))
  const copies = copiesOf(overridden, 'Copied Original')
  expect(copies.map(token => token.colors).toSorted()).toEqual(['R', 'W'])
})

test('copy except applies to a captured snapshot after the original leaves', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield' }), count: 1 })] },
      instructions: [
        captureCopy({ targets: target(0), bindResult: 'copied' }),
        copy({ snapshot: 'copied', except: { notLegendary: true, keywords: ['flying'] } }),
      ],
    })] },
    battlefield: { p1: [cardTemplate('Snapshot Original', {
      types: ['Creature'],
      supertypes: ['Legendary'],
      power: 4,
      toughness: 4,
    })] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  const resolved = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(ready, 'Instruction fixture').id,
    targets: [{ kind: 'object', objectId: named(ready, 'Snapshot Original').id }],
  })))
  const token = copiesOf(resolved, 'Snapshot Original')[0]!
  expect(token.supertypes).toEqual([])
  expect(hasKeyword(token, 'flying')).toBe(true)
})

test('copy except flying does not duplicate a printed flying line', () => {
  const { copy: token } = resolveCopy({ oracleText: 'Flying' }, { keywords: ['flying'] })
  expect(token.oracleText).toBe('Flying')
  expect(hasKeyword(token, 'flying')).toBe(true)
})

test('a restored copy except token keeps flying and stays nonlegendary', () => {
  const { server, resolved } = resolveCopy({
    supertypes: ['Legendary'],
  }, { notLegendary: true, keywords: ['flying'] })
  const restored = restoreJournal(createJournal(resolved), server.rules).current()
  const token = copiesOf(restored, 'Copied Original')[0]!
  expect(token.supertypes).toEqual([])
  expect(hasKeyword(token, 'flying')).toBe(true)
})

test('copy except must name at least one exception and rejects unknown keywords', () => {
  expect(() => compileCardRuleDefinition(card([spell({
    instructions: [copy({ targets: objects({ zone: 'battlefield' }), except: {} })],
  })]))).toThrow()
  expect(() => compileCardRuleDefinition(card([spell({
    instructions: [copy({
      targets: objects({ zone: 'battlefield' }),
      except: { keywords: ['flying high' as 'flying'] },
    })],
  })]))).toThrow()
})
