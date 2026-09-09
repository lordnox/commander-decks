import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { newGame, yurlokFixture } from '../testGame'
import { grantedRulesFor, missingCardPlugins } from './index'
import { yurlok } from './yurlok'

describe('Yurlok of Scorch Thrash', () => {
  test('the card cache overlay grants manaBurn plus the Yurlok plugin', () => {
    expect(grantedRulesFor('Yurlok of Scorch Thrash')).toEqual(['manaBurn', 'yurlok'])
    expect(missingCardPlugins(['Sol Ring', 'Yurlok of Scorch Thrash'])).toEqual(['Sol Ring'])
  })

  test('activating Yurlok rains {B}{R}{G} on every seat, then leftover mana burns', () => {
    const catalog = createCatalog([...commanderRules.plugins, yurlok])
    const state = newGame({
      players: 2,
      battlefield: { p1: [yurlokFixture()] },
    })
    const yurlokId = Object.values(state.objects).find((object) => object.name.includes('Yurlok'))!.id
    state.objects[yurlokId].summoningSickness = false
    state.players.p1.mana.C = 1

    const activated = rules(
      state,
      { type: 'custom', name: 'yurlokThrash', seat: 'p1', payload: { objectId: yurlokId } },
      catalog,
    )
    expect(activated.ok).toBe(true)
    if (!activated.ok) return
    expect(activated.state.objects[yurlokId].tapped).toBe(true)
    expect(activated.state.players.p1.mana).toEqual({ W: 0, U: 0, B: 1, R: 1, G: 1, C: 0 })
    expect(activated.state.players.p2.mana).toEqual({ W: 0, U: 0, B: 1, R: 1, G: 1, C: 0 })

    const burned = rules(activated.state, { type: 'emptyManaPools' }, catalog)
    expect(burned.ok).toBe(true)
    if (!burned.ok) return
    expect(burned.state.players.p1.life).toBe(37)
    expect(burned.state.players.p2.life).toBe(37)
    expect(burned.state.players.p1.mana.B).toBe(0)
  })
})
