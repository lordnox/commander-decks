import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'

const card = (name: string, types: string[]) => cardTemplate(name, { types })

describe('attack triggers on stack', () => {
  test('Six mills three then opens revealPick after its attack trigger resolves', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [card('Six', ['Creature'])],
        },
        libraries: {
          p1: [
            card('Milled Land', ['Land']),
            card('Milled Two', ['Instant']),
            card('Milled Three', ['Instant']),
            card('Kept', ['Instant']),
          ],
        },
      },
      { random: () => 0.5 },
    )
    const sixId = server.state.zoneOrder.p1.battlefield[0]
    const attacking = ok(server.rules({
      ...server.state,
      step: 'declareAttackers',
      priority: 'p1',
    }, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: sixId, defender: 'p2' }],
    }))
    expect(attacking.stack[0]).toMatchObject({ kind: 'ability', name: 'Six' })
    expect(attacking.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(pendingDialog(attacking)).toBeUndefined()

    const resolved = resolveStack(server.rules, attacking)
    expect(resolved.zoneOrder.p1.graveyard).toHaveLength(3)
    expect(pendingDialog(resolved)).toMatchObject({
      kind: 'reveal-pick',
      source: 'Six',
    })
    expect(resolved.zoneOrder.p1.battlefield.map((id) => resolved.objects[id].name))
      .not.toContain('Milled Land')
  })
})
