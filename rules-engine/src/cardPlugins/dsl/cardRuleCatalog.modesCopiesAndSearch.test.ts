import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
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
  loadDefinitionSnapshot,
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
  test('lookup is exact card name and pins a compiled snapshot at module load', () => {
    const charm = cardRuleDefinitionSnapshotFor('Esper Charm')
    const reverberate = cardRuleDefinitionSnapshotFor('Reverberate')
    const tutor = cardRuleDefinitionSnapshotFor('Diabolic Tutor')
    expect(charm).toBeDefined()
    expect(reverberate).toBeDefined()
    expect(tutor).toBeDefined()
    expect(cardRuleDefinitionSnapshotFor('esper charm')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Twincast')).toBeDefined()
    expect(cardRuleDefinitionSnapshotFor('Cryptic Command')).toBeDefined()
    expect(cardRuleDefinitionSnapshotFor('Mulldrifter')).toBeUndefined()
    expect(charm).toBe(cardRuleDefinitionSnapshotFor('Esper Charm'))
    expect(charm!.definitionRevision).toMatch(/^v1-[0-9a-f]{16}$/)
    expect(reverberate!.definitionRevision).not.toBe(charm!.definitionRevision)
    expect(tutor!.definitionRevision).not.toBe(reverberate!.definitionRevision)
    expect(loadDefinitionSnapshot(charm!).definitionRevision).toBe(charm!.definitionRevision)
  })

  test('newGame stamps the pinned snapshot and empty effects when the template omits ruleDefinition', () => {
    const charmSnapshot = cardRuleDefinitionSnapshotFor('Esper Charm')!
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [charmCard()] },
    }, { random: () => 0 })
    const charm = named(server.state, 'Esper Charm')
    expect(charm.ruleDefinition).toEqual(charmSnapshot)
    expect(charm.ruleDefinition?.definitionRevision).toBe(charmSnapshot.definitionRevision)
    expect(charm.effects).toEqual([])
    expect(effectsOf(charm)).toEqual([])
    expect(effectsFor('Esper Charm')).toEqual([])
  })

  test('an explicit template ruleDefinition is kept instead of the catalog snapshot', () => {
    const tutorSnapshot = cardRuleDefinitionSnapshotFor('Diabolic Tutor')!
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Esper Charm', {
          types: ['Instant'],
          manaCost: '{0}',
          ruleDefinition: tutorSnapshot,
        })],
      },
    }, { random: () => 0 })
    const charm = named(server.state, 'Esper Charm')
    expect(charm.ruleDefinition).toEqual(tutorSnapshot)
  })

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

  test('a catalog object and an unmigrated CARD_RULES object both work in the same game', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          tutorCard(),
          cardTemplate('Mulldrifter', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
      libraries: {
        p1: ['Mixed Prize', 'Mixed One', 'Mixed Two', 'Mixed Three'].map((name) => cardTemplate(name)),
      },
    }, { random: () => 0 })
    const tutor = named(server.state, 'Diabolic Tutor')
    const mulldrifter = named(server.state, 'Mulldrifter')
    expect(tutor.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Diabolic Tutor'))
    expect(mulldrifter.ruleDefinition).toBeUndefined()
    expect(mulldrifter.effects).toEqual(effectsFor('Mulldrifter'))
    expect(effectsOf(mulldrifter).length).toBeGreaterThan(0)

    const searching = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: tutor.id,
    })))
    const pick = pendingSelectionFor(searching, 'p1')!
    const afterTutor = ok(server.rules(searching, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pick.id,
      kind: 'choose',
      count: 1,
      objectIds: [named(searching, 'Mixed Prize').id],
    }))
    expect(named(afterTutor, 'Mixed Prize').zone).toBe('hand')
    expect(handCount(afterTutor)).toBe(2)

    const liveMulldrifter = named(afterTutor, 'Mulldrifter')
    const afterBoth = resolveStack(server.rules, ok(server.rules(afterTutor, {
      type: 'move',
      objectId: liveMulldrifter.id,
      to: 'battlefield',
    })))
    expect(afterBoth.objects[liveMulldrifter.id].zone).toBe('battlefield')
    expect(afterBoth.objects[liveMulldrifter.id].ruleDefinition).toBeUndefined()
    expect(handCount(afterBoth)).toBe(3)
    expect(named(afterBoth, 'Mixed Prize').zone).toBe('hand')
  })

  test('journal restore keeps the stamped definitionRevision', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [reverberateCard()] },
    }, { random: () => 0 })
    const reverberate = named(server.state, 'Reverberate')
    const revision = reverberate.ruleDefinition!.definitionRevision
    const json = JSON.parse(JSON.stringify(reverberate.ruleDefinition))
    expect(json.definitionRevision).toBe(revision)
    expect(loadDefinitionSnapshot(json).definitionRevision).toBe(revision)
    const restored = restoreJournal(createJournal(server.state), server.rules)
    expect(restored.current().objects[reverberate.id].ruleDefinition?.definitionRevision).toBe(revision)
  })
})
