import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'

test('Firdoch Core taps for the chosen mana color', () => {
  const core = cardTemplate('Firdoch Core', {
    types: ['Artifact'],
    oracleText:
      'Changeling (This card is every creature type.)\n'
      + '{T}: Add one mana of any color.\n'
      + '{4}: This artifact becomes a 4/4 artifact creature until end of turn.',
  })
  const server = createServerGame(
    commanderRules,
    { battlefield: { p1: [core] } },
    { random: () => 0, cardPlugins: [] },
  )
  const objectId = server.state.zoneOrder.p1.battlefield[0]
  const result = server.rules(server.state, {
    type: 'tapForMana',
    seat: 'p1',
    objectId,
    mana: 'G',
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.state.players.p1.mana.G).toBe(1)
  expect(result.state.objects[objectId].tapped).toBe(true)
})
