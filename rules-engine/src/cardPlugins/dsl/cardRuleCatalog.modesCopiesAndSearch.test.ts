import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame, projectForViewer } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { effectsFor, effectsOf } from '../cardRules'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'
import {
  amount,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  damage,
  players,
  ref,
  select,
  spell,
  target,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const handCount = (state: GameState, seat: 'p1' | 'p2' = 'p1') =>
  state.zoneOrder[seat].hand.length

const charmCard = () => cardTemplate('Esper Charm', { types: ['Instant'], manaCost: '{0}' })
const reverberateCard = () => cardTemplate('Reverberate', { types: ['Instant'], manaCost: '{0}' })
const tutorCard = () => cardTemplate('Diabolic Tutor', { types: ['Sorcery'], manaCost: '{0}' })

const copyableBolt = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  spell({
    decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
    instructions: [damage({ amount: amount(3), targets: target(0), source: ref('source') })],
  }),
])))

describe('cardRuleCatalog — modesCopiesAndSearch', () => {
  test('Esper Charm chooses one mode: destroy, draw two, or targeted discard', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [charmCard(), charmCard(), charmCard()],
        p2: [
          cardTemplate('Discard One'),
          cardTemplate('Discard Two'),
          cardTemplate('Discard Keep'),
        ],
      },
      battlefield: {
        p2: [cardTemplate('Target Aura', { types: ['Enchantment'] })],
      },
      libraries: {
        p1: ['Charm One', 'Charm Two', 'Charm Three'].map((name) => cardTemplate(name)),
      },
    }, { random: () => 0 })
    const [destroyCharm, drawCharm, discardCharm] = server.state.zoneOrder.p1.hand
      .map((id) => server.state.objects[id])
      .filter((object) => object.name === 'Esper Charm')
    const aura = named(server.state, 'Target Aura')
    expect(destroyCharm.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Esper Charm'))
    expect(destroyCharm.effects).toEqual([])

    expect(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: destroyCharm.id,
      modeIndices: [0],
      targets: [{ kind: 'player', player: 'p2' }],
    }).ok).toBe(false)
    const destroyed = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: destroyCharm.id,
      modeIndices: [0],
      targets: [{ kind: 'object', objectId: aura.id }],
    })))
    expect(named(destroyed, 'Target Aura').zone).toBe('graveyard')
    expect(destroyed.objects[destroyCharm.id].zone).toBe('graveyard')

    const drawn = resolveStack(server.rules, ok(server.rules(destroyed, {
      type: 'castSpell',
      seat: 'p1',
      objectId: drawCharm.id,
      modeIndices: [1],
    })))
    expect(handCount(drawn)).toBe(3)
    expect(named(drawn, 'Charm One').zone).toBe('hand')
    expect(named(drawn, 'Charm Two').zone).toBe('hand')

    const discardCast = ok(server.rules(drawn, {
      type: 'castSpell',
      seat: 'p1',
      objectId: discardCharm.id,
      modeIndices: [2],
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    const discarding = resolveStack(server.rules, discardCast)
    const pick = pendingSelectionFor(discarding, 'p2')!
    expect(pick.kind).toBe('discard')
    const discarded = ok(server.rules(discarding, {
      type: 'selectCards',
      seat: 'p2',
      selectionId: pick.id,
      kind: 'discard',
      count: 2,
      objectIds: [named(discarding, 'Discard One').id, named(discarding, 'Discard Two').id],
    }))
    expect(named(discarded, 'Discard One').zone).toBe('graveyard')
    expect(named(discarded, 'Discard Two').zone).toBe('graveyard')
    expect(named(discarded, 'Discard Keep').zone).toBe('hand')
    expect(discarded.resolution).toBeUndefined()
  })

  test('Reverberate copies an instant once, keeps targets, and rejects a creature spell', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          reverberateCard(),
          cardTemplate('Boltlet', {
            types: ['Instant'],
            manaCost: '{0}',
            ruleDefinition: copyableBolt(),
          }),
          cardTemplate('Target Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0 })
    const reverberate = named(server.state, 'Reverberate')
    const boltlet = named(server.state, 'Boltlet')
    const bear = named(server.state, 'Target Bear')
    expect(reverberate.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Reverberate'))
    expect(reverberate.effects).toEqual([])
    expect(effectsOf(reverberate)).toEqual([])

    const creatureOnStack = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bear.id,
    }))
    expect(server.rules(creatureOnStack, {
      type: 'castSpell',
      seat: 'p1',
      objectId: reverberate.id,
      targets: [{ kind: 'stackItem', stackId: creatureOnStack.stack[0].id }],
    }).ok).toBe(false)

    const original = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: boltlet.id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    const copied = ok(server.rules(original, {
      type: 'castSpell',
      seat: 'p1',
      objectId: reverberate.id,
      targets: [{ kind: 'stackItem', stackId: original.stack[0].id }],
    }))
    expect(copied.stack).toHaveLength(2)
    const resolvingCopy = resolveStack(server.rules, copied)
    const keep = pendingOptionSelection(resolvingCopy, 'p1')!
    expect(keep.options.some((option) => option.id === 'keep')).toBe(true)
    const kept = ok(server.rules(resolvingCopy, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: keep.id,
      optionId: 'keep',
    }))
    expect(kept.stack.filter((item) => item.copy)).toHaveLength(1)
    const afterCopy = resolveStack(server.rules, kept)
    expect(afterCopy.players.p2.life).toBe(34)
    expect(afterCopy.stack).toHaveLength(0)
    expect(afterCopy.objects[reverberate.id].zone).toBe('graveyard')
  })

  test('Diabolic Tutor searches the library through selectCards and shuffles', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [tutorCard()] },
      libraries: {
        p1: ['Prize', 'Filler A', 'Filler B'].map((name) => cardTemplate(name)),
      },
    }, { random: () => 0 })
    const tutor = named(server.state, 'Diabolic Tutor')
    expect(tutor.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Diabolic Tutor'))
    expect(tutor.effects).toEqual([])
    const searching = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: tutor.id,
    })))
    const pick = pendingSelectionFor(searching, 'p1')!
    expect(pick.kind).toBe('choose')
    expect(pick.fromZone).toBe('library')
    expect(pick.candidates).toEqual([
      named(searching, 'Prize').id,
      named(searching, 'Filler A').id,
      named(searching, 'Filler B').id,
    ])
    expect(pendingSelectionFor(projectForViewer(searching, 'p2'), 'p1')).toBeUndefined()
    expect(Object.values(projectForViewer(searching, 'p2').objects).some(
      (object) => object.name === 'Prize',
    )).toBe(false)

    const found = ok(server.rules(searching, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pick.id,
      kind: 'choose',
      count: 1,
      objectIds: [named(searching, 'Prize').id],
    }))
    expect(named(found, 'Prize').zone).toBe('hand')
    expect(named(found, 'Filler A').zone).toBe('library')
    expect(named(found, 'Filler B').zone).toBe('library')
    expect(found.zoneOrder.p1.library).toEqual([
      named(found, 'Filler B').id,
      named(found, 'Filler A').id,
    ])
    expect(found.objects[tutor.id].zone).toBe('graveyard')
    expect(found.resolution).toBeUndefined()
  })

})

test('bounded-library catalog programs compose typed choices, remainder routing, and canonical token abilities', () => {
  for (const name of ["Animist's Awakening", 'Malevolent Rumble', 'Planar Genesis', 'Satyr Wayfinder', 'Silverback Elder']) {
    const snapshot = cardRuleDefinitionSnapshotFor(name)!
    expect(snapshot).toBeDefined()
    expect(effectsFor(name)).toEqual([])
    const ability = snapshot.definition.abilities[0]!
    switch (name) {
      case 'Silverback Elder':
        if (ability.kind !== 'triggered' || !ability.modes) throw new Error('expected modal trigger')
        expect(ability.on).toEqual({ kind: 'cast', filter: { type: 'Creature', controller: 'you' } })
        expect(ability.modes).toHaveLength(3)
        expect(ability.modes[1]!.instructions[0]).toEqual({ kind: 'inspectTop', player: { kind: 'contextRef', name: 'controller' }, count: { kind: 'constant', value: 5 }, bindChoice: 'top', visibility: 'private' })
        break
      default: {
        if (!('instructions' in ability) || !ability.instructions) throw new Error('expected instruction program')
        const inspection = ability.instructions[0]!
        expect(inspection).toEqual(expect.objectContaining({ kind: 'inspectTop', bindChoice: 'top', visibility: name === 'Planar Genesis' ? 'private' : 'public' }))
        if (name === 'Malevolent Rumble') {
          const token = ability.instructions.at(-1)!
          if (token.kind !== 'createToken') throw new Error('expected token creation')
          expect(token.token).toEqual(expect.objectContaining({ power: 0, toughness: 1, subtypes: ['Eldrazi', 'Spawn'] }))
          expect(token.token.abilities?.[0]).toEqual(expect.objectContaining({ kind: 'activated', costs: [expect.objectContaining({ kind: 'sacrifice' })], instructions: [{ kind: 'addMana', targets: { kind: 'contextRef', name: 'controller' }, amount: { C: { kind: 'constant', value: 1 } } }] }))
        }
        if (name === "Animist's Awakening") {
          expect(inspection).toEqual(expect.objectContaining({ count: { kind: 'variable', name: 'X' } }))
          expect(ability.instructions[1]).toEqual(expect.objectContaining({ kind: 'move', to: 'battlefield', tapped: true, bindChoice: 'lands' }))
          expect(ability.instructions.at(-1)?.kind).toBe('if')
        }
      }
    }
  }
})

test('Dack catalog composes reveal, movement, shuffle, permanent goad, and distinct assignments', () => {
  const snapshot = cardRuleDefinitionSnapshotFor('Dack Fayden, Helping Hand')!
  expect(effectsFor('Dack Fayden, Helping Hand')).toEqual([])
  expect(snapshot.definition.abilities).toMatchObject([{
    kind: 'triggered', activeIn: ['battlefield'], on: { kind: 'enters', filter: { kind: 'contextRef', name: 'source' } },
    instructions: [
      { kind: 'revealUntil', count: { kind: 'count', of: { kind: 'players', filter: { relation: 'opponent' } } }, match: { kind: 'objects', filter: { zone: 'library', type: 'Creature' } }, foundTo: 'library', rest: 'keep', bindFound: 'found' },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'found' }, to: 'battlefield', controller: { kind: 'contextRef', name: 'controller' }, bindChoice: 'entered' },
      { kind: 'shuffle', targets: { kind: 'contextRef', name: 'controller' } },
      { kind: 'createEffect', targets: { kind: 'choiceRef', binding: 'entered' }, effect: { kind: 'goad' }, duration: { kind: 'permanent' } },
      { kind: 'distributeControl', targets: { kind: 'choiceRef', binding: 'entered' }, recipients: { kind: 'players', filter: { relation: 'opponent' } }, distinct: true },
    ],
  }])
})


test('council and pile catalog programs preserve secrecy, complete outcomes, and player scopes', () => {
  const programs = (name: string) => cardRuleDefinitionSnapshotFor(name)!.definition.abilities
  expect(programs('Illusion of Choice')).toMatchObject([{ kind: 'spell', instructions: [{ kind: 'modifyVotes', players: { kind: 'players', filter: {} }, controller: { name: 'controller' }, duration: 'untilEndOfTurn' }, { kind: 'draw' }] }])
  expect(programs('Erestor of the Council')).toMatchObject([{ kind: 'triggered', on: { kind: 'votesFinished', bindResult: 'vote' }, instructions: [{ kind: 'createToken', targets: { filter: { relation: 'opponent', voted: { agreement: 'same' } } } }, { kind: 'scry', count: { kind: 'count', of: { filter: { relation: 'opponent', voted: { agreement: 'different' } } } } }, { kind: 'draw' }] }])
  const council = programs('Círdan the Shipwright')
  expect(council).toMatchObject([{ kind: 'keyword', keyword: 'vigilance' }, { kind: 'triggered', on: { kind: 'enters' }, instructions: [{ kind: 'vote', secret: true }, { kind: 'forEachPlayer', instructions: [{ kind: 'draw' }] }, { kind: 'forEachPlayer', instructions: [{ kind: 'if' }] }] }, { kind: 'triggered', on: { kind: 'attacks' } }])
  expect(programs('Trap the Trespassers')).toMatchObject([{ kind: 'spell', instructions: [{ kind: 'vote', secret: true, bindObjects: 'voted', options: { kind: 'objects', filter: { filter: { type: 'Creature', not: { controller: 'you' } } } } }, { kind: 'forEach', instructions: [{ kind: 'putCounters', counter: 'stun' }, { kind: 'tap' }] }] }])
  expect(programs("Fortune's Favor")).toMatchObject([{ kind: 'spell', decisions: { targets: [{ filter: { kind: 'players', filter: { relation: 'opponent' } } }] }, instructions: [{ kind: 'inspectTop', count: { value: 4 }, visibility: 'private' }, { kind: 'partitionPiles', visibility: 'facedown-faceup' }, { kind: 'move', to: 'hand' }, { kind: 'move', to: 'graveyard' }] }])
  expect(programs('Hostile Negotiations')).toMatchObject([{ kind: 'spell', instructions: [{ kind: 'inspectTop', count: { value: 3 } }, { kind: 'move', to: 'exile', faceDown: true }, { kind: 'inspectTop', count: { value: 3 } }, { kind: 'move', to: 'exile', faceDown: true }, { kind: 'lookAt' }, { kind: 'lookAt' }, { kind: 'choosePile' }, { kind: 'reveal', turnFaceUp: true }, { kind: 'choosePlayer', filter: { filter: { relation: 'opponent' } } }, { kind: 'choosePile' }, { kind: 'move', to: 'hand' }, { kind: 'move', to: 'graveyard' }, { kind: 'loseLife', amount: { value: 3 } }] }])
})
