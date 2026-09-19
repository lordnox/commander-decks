import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'

test("Bender's Waterskin uses generic mana and extra-untap rules", () => {
  const waterskin = cardTemplate("Bender's Waterskin", {
    types: ['Artifact'],
    oracleText: "Untap this artifact during each other player's untap step.\n"
      + '{T}: Add one mana of any color.',
  })
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [waterskin] },
  })
  const objectId = Object.values(server.state.objects)
    .find((object) => object.name === "Bender's Waterskin")!.id
  const tapped = ok(server.rules(server.state, {
    type: 'tapForMana',
    seat: 'p1',
    objectId,
    mana: 'G',
  }))

  expect(tapped.players.p1.mana.G).toBe(1)
  expect(tapped.objects[objectId].tapped).toBe(true)

  const nextTurn = ok(server.rules(
    { ...tapped, step: 'cleanup' },
    { type: 'advanceStep' },
  ))
  expect(nextTurn.active).toBe('p2')
  expect(nextTurn.step).toBe('untap')
  expect(nextTurn.objects[objectId].tapped).toBe(false)
})
