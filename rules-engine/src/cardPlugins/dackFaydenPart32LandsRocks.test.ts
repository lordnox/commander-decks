import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { becomeCopyOfTarget } from './becomeCopyOfTarget'
import { cycling } from './cycling'
import { entersTapped } from './entersTapped'
import { librarySearch } from './librarySearch'
import { linkedExile } from './linkedExile'
import { onResolve } from './onResolve'

const plugins = [
  activated,
  becomeCopyOfTarget,
  cycling,
  entersTapped,
  librarySearch,
  linkedExile,
  onResolve,
]

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const plains = () =>
  cardTemplate('Plains', {
    types: ['Land'],
    subtypes: ['Plains'],
    supertypes: ['Basic'],
    tapProduces: { W: 1 },
    oracleText: '({T}: Add {W}.)',
  })

// Pinned audit groups :295 and :331 remain assigned to #403, including their setup.
describe('land-search privacy integrations (#403)', () => {
  test('Expedition Map sacrifices itself and opens a hidden library search', () => {
    const map = cardTemplate('Expedition Map', {
      types: ['Artifact'],
    })
    const found = plains()
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [map] }, libraries: { p1: [found] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const mapId = named(server.state, 'Expedition Map').id
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana.C = 2
    const announced = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: mapId,
    }))
    const opened = resolveStack(server.rules, announced)
    expect(opened.objects[mapId].zone).toBe('graveyard')
    expect(pendingSelectionFor(opened, 'p1')).toMatchObject({ kind: 'choose', min: 0, count: 1, viewLibrary: true })
    expect(projectForViewer(opened, 'p2').zoneOrder.p1.library).toEqual([])
  })

  test("Archaeomancer's Map ETB finds up to two Plains and puts them in hand", () => {
    const map = cardTemplate("Archaeomancer's Map", {
      types: ['Artifact'],
      manaCost: '{2}{W}',
    })
    const p1 = plains()
    const p2 = cardTemplate('Plains Two', {
      types: ['Land'],
      subtypes: ['Plains'],
      supertypes: ['Basic'],
      tapProduces: { W: 1 },
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [map] }, libraries: { p1: [p1, p2, cardTemplate('Island', { types: ['Land'], subtypes: ['Island'] })] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const mapId = server.state.zoneOrder.p1.hand[0]
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 2 }
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: mapId,
    }))
    const resolved = resolveStack(server.rules, cast)
    const pick = pendingSelectionFor(resolved, 'p1')!
    expect(pick).toMatchObject({ kind: 'choose', min: 0, count: 2, viewLibrary: true })
    expect(pick.candidates.map(id => resolved.objects[id].name)).toEqual(['Plains', 'Plains Two'])
    const first = named(resolved, 'Plains').id
    const second = named(resolved, 'Plains Two').id
    const finished = ok(server.rules(resolved, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pick.id,
      kind: 'choose',
      count: 2,
      objectIds: [first, second],
    }))
    expect(finished.zoneOrder.p1.hand).toHaveLength(2)
    expect(projectForViewer(finished, 'p2').zoneOrder.p1.library).toEqual([])
  })
})
