import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { copyTokenTemplate, createToken } from './effects'
import { makeDraft } from '../draft'

const bear = () => cardTemplate('Runeclaw Bear', {
  types: ['Creature'],
  subtypes: ['Bear'],
  manaCost: '{1}{G}',
  manaValue: 2,
  colors: 'G',
  power: 2,
  toughness: 2,
})

const draftWith = (template: ReturnType<typeof bear>) => {
  const server = createServerGame(
    commanderRules,
    { battlefield: { p1: [template] } },
    { random: () => 0.5 },
  )
  const draft = makeDraft(server.state)
  return { draft, copied: draft.object(server.state.zoneOrder.p1.battlefield[0])! }
}

describe('copy token template', () => {
  test('a clone token enters untapped rather than with an undefined tap state', () => {
    const { draft, copied } = draftWith(bear())
    const token = createToken(draft, 'p1', copyTokenTemplate(copied))

    expect(token.tapped).toBe(false)
  })

  test('a copy that asks to be tapped enters tapped', () => {
    const { draft, copied } = draftWith(bear())
    const token = createToken(draft, 'p1', copyTokenTemplate(copied, { tapped: true }))

    expect(token.tapped).toBe(true)
  })

  test('a copy carries the colors and mana value answers key off', () => {
    const { draft, copied } = draftWith(bear())
    const token = createToken(draft, 'p1', copyTokenTemplate(copied))

    expect(token.colors).toBe('G')
    expect(token.manaValue).toBe(2)
  })

  test('a copy token template does not copy legacy effect programs', () => {
    const legacyEffect = { op: 'static' as const, pluginId: 'test.legacyCopyEffect' }
    const { draft, copied } = draftWith(cardTemplate('Legacy source', {
      types: ['Creature'],
      effects: [legacyEffect],
    }))
    const template = copyTokenTemplate(copied)
    const token = createToken(draft, 'p1', template)

    expect(template).not.toHaveProperty('effects')
    expect(token.effects).toEqual([])
  })

  test('a planeswalker copy starts at its printed loyalty', () => {
    const { draft, copied } = draftWith(cardTemplate('Test Walker', {
      types: ['Planeswalker'],
      printedLoyalty: 4,
    }))
    const token = createToken(draft, 'p1', copyTokenTemplate(copied))

    expect(token.counters.loyalty).toBe(4)
  })
})
