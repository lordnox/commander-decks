import { describe, expect, test } from 'bun:test'
import { projectForViewer } from '../index'
import { pendingSelectionFor } from '../rules/selectCards'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState } from '../types'
import { activated } from './activated'
import { encore as encorePlugin } from './encore'
import { giftCast } from './giftCast'
import { onResolve as onResolvePlugin } from './onResolve'
import { ok } from '../testHelpers'

/** Card-only plugins; `gameRules` (draw, discard, triggers, selectCards) already ship in `commanderRules`. */
const plugins = [onResolvePlugin, giftCast, activated, encorePlugin]

const fromRules = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, extra)

const instant = (name: string) => cardTemplate(name, { types: ['Instant'] })
const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const resolveLootAbility = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  abilityId: string,
  artifactName: string,
) => {
  const artifactId = named(state, artifactName).id
  state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 }
  let current = ok(server.rules(state, {
    type: 'activateAbility',
    seat: 'p1',
    objectId: artifactId,
    abilityId,
  }))
  const fodderId = named(current, 'Hand Fodder').id
  for (let step = 0; step < 8; step += 1) {
    const discardPending = pendingSelectionFor(current, 'p1')
    if (discardPending) {
      current = ok(server.rules(current, {
        type: 'selectCards',
        seat: 'p1',
        kind: discardPending.kind,
        count: discardPending.count,
        objectIds: [fodderId],
      }))
      continue
    }
    if (current.stack.length === 0) break
    if (current.stack[0]?.waiting) break
    current = ok(server.rules(current, { type: 'resolveTop' }))
  }
  return current
}

describe('Dack Party pass-35 cardRules', () => {
  test('Collector\'s Vault loot opens a discard choice then finishes with a Treasure', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [fromRules('Collector\'s Vault', { types: ['Artifact'] })] },
      hands: { p1: [instant('Hand Fodder')] },
      libraries: { p1: [instant('Library Card')] },
    }, { random: () => 0.5, cardPlugins: plugins })
    const resolved = resolveLootAbility(
      server,
      server.state,
      '$.abilities[0]',
      'Collector\'s Vault',
    )
    expect(named(resolved, 'Library Card').zone).toBe('hand')
    expect(resolved.zoneOrder.p1.battlefield.filter((id) =>
      resolved.objects[id].subtypes.includes('Treasure'))).toHaveLength(1)
    expect(projectForViewer(resolved, 'p2').zoneOrder.p1.library).toHaveLength(0)
  })

})
