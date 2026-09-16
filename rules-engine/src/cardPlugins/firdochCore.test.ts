import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { activate } from './effects'

const staleFirdochEffect = activate({
  id: 'anyMana.firdoch',
  manaAbility: true,
  costs: { tap: true },
  do: [{ kind: 'addChosenColorMana' }],
})

test.each([
  ['a newly created object', undefined],
  ['an older journal with its embedded activation', [staleFirdochEffect]],
])('Firdoch Core taps for the chosen mana color from %s', (_, effects) => {
  const core = cardTemplate('Firdoch Core', {
    types: ['Artifact'],
    oracleText:
      'Changeling (This card is every creature type.)\n'
      + '{T}: Add one mana of any color.\n'
      + '{4}: This artifact becomes a 4/4 artifact creature until end of turn.',
    effects,
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
