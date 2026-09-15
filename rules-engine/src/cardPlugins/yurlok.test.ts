import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { newGame, yurlokFixture } from '../testGame'
import { grantedRulesFor, missingCardPlugins } from './index'
import { yurlok, YURLOK_MANA_RAIN } from './yurlok'

const catalog = createCatalog([...commanderRules.plugins, yurlok])

const yurlokOnBoard = () => {
  const state = newGame({
    players: 2,
    battlefield: { p1: [yurlokFixture()] },
  })
  const yurlokId = Object.values(state.objects).find((object) => object.name.includes('Yurlok'))!.id
  state.objects[yurlokId].summoningSickness = false
  state.players.p1.mana.C = 1
  return { state, yurlokId }
}

describe('Yurlok of Scorch Thrash', () => {
  test('the overlay grants manaBurn while Yurlok is on the battlefield', () => {
    expect(grantedRulesFor('Yurlok of Scorch Thrash')).toEqual(['manaBurn'])
    expect(missingCardPlugins(['Sol Ring', 'Yurlok of Scorch Thrash'])).toEqual(['Sol Ring'])
    const { state, yurlokId } = yurlokOnBoard()
    expect(state.objects[yurlokId].grantedRules).toEqual(['manaBurn'])
    expect(state.rules.some((rule) => rule.pluginId === 'manaBurn' && rule.sourceId === yurlokId))
      .toBe(true)
    expect(state.rules.some((rule) => rule.pluginId === 'yurlok' && rule.sourceId === null))
      .toBe(true)
  })

  test('activating the mana ability rains {B}{R}{G}, then leftover mana burns', () => {
    const { state, yurlokId } = yurlokOnBoard()
    const activated = rules(
      state,
      {
        type: 'activateAbility',
        abilityId: YURLOK_MANA_RAIN,
        seat: 'p1',
        objectId: yurlokId,
        manaAbility: true,
      },
      catalog,
    )
    expect(activated.ok).toBe(true)
    if (!activated.ok) return
    expect(activated.state.objects[yurlokId].tapped).toBe(true)
    expect(activated.state.players.p1.mana).toEqual({ W: 0, U: 0, B: 1, R: 1, G: 1, C: 0 })
    expect(activated.state.players.p2.mana).toEqual({ W: 0, U: 0, B: 1, R: 1, G: 1, C: 0 })
    expect(activated.trace.map(({ depth, event }) => [depth, event.type])).toEqual([
      [0, 'activateAbility'],
      [1, 'payMana'],
      [1, 'tap'],
      [1, 'addMana'],
      [1, 'addMana'],
    ])

    const burned = rules(activated.state, { type: 'emptyManaPools' }, catalog)
    expect(burned.ok).toBe(true)
    if (!burned.ok) return
    expect(burned.state.players.p1.life).toBe(37)
    expect(burned.state.players.p2.life).toBe(37)
    expect(burned.state.players.p1.mana.B).toBe(0)
    expect(burned.trace.map(({ depth, event, pluginId }) => [
      depth,
      event.type === 'custom' ? event.name : event.type,
      pluginId,
    ])).toEqual([
      [0, 'emptyManaPools', 'manaBurn'],
      [1, 'loseLife', undefined],
      [1, 'loseLife', undefined],
      [1, 'clearMana', undefined],
    ])
  })

  test('the rain cannot be activated as a stack ability', () => {
    const { state, yurlokId } = yurlokOnBoard()
    const activated = rules(
      state,
      {
        type: 'activateAbility',
        abilityId: YURLOK_MANA_RAIN,
        seat: 'p1',
        objectId: yurlokId,
      },
      catalog,
    )
    expect(activated.ok).toBe(false)
    if (activated.ok) return
    expect(activated.error).toContain('mana ability')
  })
})
