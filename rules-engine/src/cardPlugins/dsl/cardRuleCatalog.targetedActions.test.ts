import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { effectsFor, effectsOf } from '../cardRules'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'
import { loadDefinitionSnapshot } from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const handCount = (state: GameState, seat: 'p1' | 'p2' = 'p1') =>
  state.zoneOrder[seat].hand.length

const murderCard = () => cardTemplate('Murder', { types: ['Instant'], manaCost: '{0}' })
const signCard = () => cardTemplate('Sign in Blood', { types: ['Sorcery'], manaCost: '{0}' })
const houndsCard = () => cardTemplate('Vampire Hounds', { types: ['Creature'], power: 2, toughness: 2 })

describe('cardRuleCatalog — targetedActions', () => {
  test('lookup is exact card name and pins a compiled snapshot at module load', () => {
    const murder = cardRuleDefinitionSnapshotFor('Murder')
    const sign = cardRuleDefinitionSnapshotFor('Sign in Blood')
    const hounds = cardRuleDefinitionSnapshotFor('Vampire Hounds')
    expect(murder).toBeDefined()
    expect(sign).toBeDefined()
    expect(hounds).toBeDefined()
    expect(cardRuleDefinitionSnapshotFor('murder')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Lightning Bolt')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Mulldrifter')).toBeUndefined()
    expect(murder).toBe(cardRuleDefinitionSnapshotFor('Murder'))
    expect(murder!.definitionRevision).toMatch(/^v1-[0-9a-f]{16}$/)
    expect(sign!.definitionRevision).not.toBe(murder!.definitionRevision)
    expect(hounds!.definitionRevision).not.toBe(sign!.definitionRevision)
    expect(loadDefinitionSnapshot(murder!).definitionRevision).toBe(murder!.definitionRevision)
  })

  test('newGame stamps the pinned snapshot and empty effects when the template omits ruleDefinition', () => {
    const murderSnapshot = cardRuleDefinitionSnapshotFor('Murder')!
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [murderCard()] },
    }, { random: () => 0 })
    const murder = named(server.state, 'Murder')
    expect(murder.ruleDefinition).toEqual(murderSnapshot)
    expect(murder.ruleDefinition?.definitionRevision).toBe(murderSnapshot.definitionRevision)
    expect(murder.effects).toEqual([])
    expect(effectsOf(murder)).toEqual([])
    expect(effectsFor('Murder')).toEqual([])
  })

  test('an explicit template ruleDefinition is kept instead of the catalog snapshot', () => {
    const houndsSnapshot = cardRuleDefinitionSnapshotFor('Vampire Hounds')!
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Murder', {
          types: ['Instant'],
          manaCost: '{0}',
          ruleDefinition: houndsSnapshot,
        })],
      },
    }, { random: () => 0 })
    const murder = named(server.state, 'Murder')
    expect(murder.ruleDefinition).toEqual(houndsSnapshot)
  })

  test('Murder destroys the chosen creature once and rejects a player target', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [murderCard()] },
      battlefield: {
        p2: [cardTemplate('Target Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0 })
    const murder = named(server.state, 'Murder')
    const bear = named(server.state, 'Target Bear')
    expect(murder.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Murder'))
    expect(murder.effects).toEqual([])
    expect(effectsFor('Murder')).toEqual([])
    expect(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: murder.id,
      targets: [{ kind: 'player', player: 'p2' }],
    }).ok).toBe(false)
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: murder.id,
      targets: [{ kind: 'object', objectId: bear.id }],
    }))
    expect(cast.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.objects[bear.id].zone).toBe('graveyard')
    expect(resolved.objects[murder.id].zone).toBe('graveyard')
  })

  test('Sign in Blood draws two and loses two life for the targeted player once', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [signCard()] },
      libraries: {
        p2: ['Blood One', 'Blood Two', 'Blood Three'].map((name) => cardTemplate(name)),
      },
    }, { random: () => 0 })
    const sign = named(server.state, 'Sign in Blood')
    expect(sign.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Sign in Blood'))
    expect(sign.effects).toEqual([])
    expect(effectsFor('Sign in Blood')).toEqual([])
    expect(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: sign.id,
      targets: [{ kind: 'object', objectId: sign.id }],
    }).ok).toBe(false)
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: sign.id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    expect(cast.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.players.p1.life).toBe(40)
    expect(resolved.players.p2.life).toBe(38)
    expect(handCount(resolved, 'p2')).toBe(2)
    expect(named(resolved, 'Blood One').zone).toBe('hand')
    expect(named(resolved, 'Blood Two').zone).toBe('hand')
    expect(resolved.objects[sign.id].zone).toBe('graveyard')
  })

  test('Vampire Hounds pays a creature-card discard and pumps once', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [houndsCard()] },
      hands: {
        p1: [
          cardTemplate('Fodder', { types: ['Creature'], power: 1, toughness: 1 }),
          cardTemplate('Not a Creature', { types: ['Instant'] }),
        ],
      },
    }, { random: () => 0 })
    const hounds = named(server.state, 'Vampire Hounds')
    const fodder = named(server.state, 'Fodder')
    const instant = named(server.state, 'Not a Creature')
    expect(hounds.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Vampire Hounds'))
    expect(hounds.effects).toEqual([])
    expect(effectsFor('Vampire Hounds')).toEqual([])
    expect(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: hounds.id,
      abilityId: '$.abilities[0]',
    }).ok).toBe(false)
    expect(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: hounds.id,
      abilityId: '$.abilities[0]',
      choices: [instant.id],
    }).ok).toBe(false)
    const activated = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: hounds.id,
      abilityId: '$.abilities[0]',
      choices: [fodder.id],
    }))
    expect(activated.objects[fodder.id].zone).toBe('graveyard')
    expect(activated.stack).toHaveLength(1)
    expect(activated.objects[hounds.id].power).toBe(2)
    const resolved = resolveStack(server.rules, activated)
    expect(resolved.objects[hounds.id].power).toBe(4)
    expect(resolved.objects[hounds.id].toughness).toBe(4)
    expect(resolved.stack).toHaveLength(0)
  })

  test('a catalog object and an unmigrated CARD_RULES object both work in the same game', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          murderCard(),
          cardTemplate('Mulldrifter', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
      battlefield: {
        p2: [cardTemplate('Mixed Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      },
      libraries: {
        p1: ['Mixed One', 'Mixed Two', 'Mixed Three'].map((name) => cardTemplate(name)),
      },
    }, { random: () => 0 })
    const murder = named(server.state, 'Murder')
    const mulldrifter = named(server.state, 'Mulldrifter')
    expect(murder.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Murder'))
    expect(mulldrifter.ruleDefinition).toBeUndefined()
    expect(mulldrifter.effects).toEqual(effectsFor('Mulldrifter'))
    expect(effectsOf(mulldrifter).length).toBeGreaterThan(0)

    const afterMurder = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: murder.id,
      targets: [{ kind: 'object', objectId: named(server.state, 'Mixed Bear').id }],
    })))
    expect(named(afterMurder, 'Mixed Bear').zone).toBe('graveyard')
    expect(handCount(afterMurder)).toBe(1)

    const liveMulldrifter = named(afterMurder, 'Mulldrifter')
    const afterBoth = resolveStack(server.rules, ok(server.rules(afterMurder, {
      type: 'move',
      objectId: liveMulldrifter.id,
      to: 'battlefield',
    })))
    expect(afterBoth.objects[liveMulldrifter.id].zone).toBe('battlefield')
    expect(afterBoth.objects[liveMulldrifter.id].ruleDefinition).toBeUndefined()
    expect(handCount(afterBoth)).toBe(2)
    expect(['Mixed One', 'Mixed Two'].every(
      (name) => named(afterBoth, name).zone === 'hand',
    )).toBe(true)
  })

  test('journal restore keeps the stamped definitionRevision', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [houndsCard()] },
    }, { random: () => 0 })
    const hounds = named(server.state, 'Vampire Hounds')
    const revision = hounds.ruleDefinition!.definitionRevision
    const json = JSON.parse(JSON.stringify(hounds.ruleDefinition))
    expect(json.definitionRevision).toBe(revision)
    expect(loadDefinitionSnapshot(json).definitionRevision).toBe(revision)
    const restored = restoreJournal(createJournal(server.state), server.rules)
    expect(restored.current().objects[hounds.id].ruleDefinition?.definitionRevision).toBe(revision)
  })
})
