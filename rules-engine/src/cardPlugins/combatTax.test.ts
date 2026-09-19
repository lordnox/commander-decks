import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { bears, cardTemplate, forest, newGame, planeswalker } from '../newGame'
import { combat } from '../plugins/combat'
import { mana } from '../plugins/mana'
import { handlerIdsForNames } from './cardRules'
import { combatTax } from './combatTax'

const catalog = createCatalog([combat, mana, combatTax])

const taxCreature = (name: string) => cardTemplate(name, {
  types: ['Creature'],
  power: 2,
  toughness: 4,
})

const ready = <T extends ReturnType<typeof newGame>>(state: T, name: string) => {
  const object = Object.values(state.objects).find((candidate) => candidate.name === name)!
  object.summoningSickness = false
  return object
}

describe('combat taxes', () => {
  test('Archangel and Baird register the reusable combat-tax handler', () => {
    expect(handlerIdsForNames([
      'Archangel of Tithes',
      'Baird, Steward of Argive',
    ])).toEqual(['combatTax'])
  })

  test('Baird taxes each creature attacking its controller or their planeswalker', () => {
    const state = newGame(commanderRules, {
      battlefield: {
        p1: [bears()],
        p2: [taxCreature('Baird, Steward of Argive'), planeswalker('Taxed Walker')],
      },
      builtinRules: ['combat', 'mana', 'combatTax'],
    })
    const attacker = ready(state, 'Grizzly Bears')
    const walker = Object.values(state.objects).find((object) => object.name === 'Taxed Walker')!
    state.step = 'declareAttackers'

    const unpaid = rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attacker.id, defender: { kind: 'object', objectId: walker.id } }],
    }, catalog)
    expect(unpaid.ok).toBe(false)
    if (!unpaid.ok) expect(unpaid.error).toContain('requires {1}')

    state.players.p1.mana.C = 1
    const paid = rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attacker.id, defender: 'p2' }],
    }, catalog)
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    expect(paid.state.players.p1.mana.C).toBe(0)
    expect(paid.state.objects[attacker.id].attacking).toEqual({
      kind: 'player',
      player: 'p2',
    })
  })

  test('Baird does not tax a creature attacking another opponent', () => {
    const state = newGame(commanderRules, {
      battlefield: {
        p1: [bears()],
        p2: [taxCreature('Baird, Steward of Argive')],
      },
      builtinRules: ['combat', 'mana', 'combatTax'],
    })
    const attacker = ready(state, 'Grizzly Bears')
    state.step = 'declareAttackers'

    expect(rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attacker.id, defender: 'p3' }],
    }, catalog).ok).toBe(true)
  })

  test('a tapped Archangel does not impose its attack tax', () => {
    const state = newGame(commanderRules, {
      battlefield: {
        p1: [bears()],
        p2: [{ ...taxCreature('Archangel of Tithes'), tapped: true }],
      },
      builtinRules: ['combat', 'mana', 'combatTax'],
    })
    const attacker = ready(state, 'Grizzly Bears')
    state.step = 'declareAttackers'

    expect(rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attacker.id, defender: 'p2' }],
    }, catalog).ok).toBe(true)
  })

  test('an attacking Archangel taxes blocks and a chosen blocker may tap to pay', () => {
    const manaBlocker = {
      ...bears(),
      name: 'Mana Blocker',
      oracleText: '{T}: Add {G}.',
      tapProduces: { G: 1 },
    }
    const state = newGame(commanderRules, {
      battlefield: {
        p1: [taxCreature('Archangel of Tithes')],
        p2: [manaBlocker],
      },
      builtinRules: ['combat', 'mana', 'combatTax'],
    })
    const archangel = ready(state, 'Archangel of Tithes')
    const blocker = ready(state, 'Mana Blocker')
    state.step = 'declareAttackers'
    const attacked = rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: archangel.id, defender: 'p2' }],
    }, catalog)
    if (!attacked.ok) throw new Error(attacked.error)
    attacked.state.step = 'declareBlockers'
    attacked.state.priority = 'p2'

    const unpaid = rules(attacked.state, {
      type: 'declareBlockers',
      seat: 'p2',
      blockers: [{ blockerId: blocker.id, attackerId: archangel.id }],
    }, catalog)
    expect(unpaid.ok).toBe(false)

    const paid = rules(attacked.state, {
      type: 'declareBlockers',
      seat: 'p2',
      blockers: [{ blockerId: blocker.id, attackerId: archangel.id }],
      payment: [{ objectId: blocker.id }],
    }, catalog)
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    expect(paid.state.objects[blocker.id]).toMatchObject({
      blocking: archangel.id,
      tapped: true,
    })
    expect(paid.state.players.p2.mana.G).toBe(0)
  })

  test('an attacker cannot also tap to pay its own attack tax', () => {
    const manaAttacker = {
      ...forest(),
      name: 'Animated Land',
      types: ['Land', 'Creature'],
      power: 2,
      toughness: 2,
      summoningSickness: false,
    }
    const state = newGame(commanderRules, {
      battlefield: {
        p1: [manaAttacker],
        p2: [taxCreature('Baird, Steward of Argive')],
      },
      builtinRules: ['combat', 'mana', 'combatTax'],
    })
    const attacker = ready(state, 'Animated Land')
    state.step = 'declareAttackers'

    const result = rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attacker.id, defender: 'p2' }],
      payment: [{ objectId: attacker.id }],
    }, catalog)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('unavailable mana source')
  })

  test('a vigilance attacker may tap for mana in the attack-cost window', () => {
    const manaAttacker = {
      ...forest(),
      name: 'Vigilant Dryad',
      types: ['Land', 'Creature'],
      power: 2,
      toughness: 2,
      oracleText: 'Vigilance\n{T}: Add {G}.',
      summoningSickness: false,
    }
    const state = newGame(commanderRules, {
      battlefield: {
        p1: [manaAttacker],
        p2: [taxCreature('Baird, Steward of Argive')],
      },
      builtinRules: ['combat', 'mana', 'combatTax'],
    })
    const attacker = ready(state, 'Vigilant Dryad')
    state.step = 'declareAttackers'

    const result = rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attacker.id, defender: 'p2' }],
      payment: [{ objectId: attacker.id }],
    }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[attacker.id]).toMatchObject({
      attacking: { kind: 'player', player: 'p2' },
      tapped: true,
    })
    expect(result.state.players.p1.mana.G).toBe(0)
  })
})
