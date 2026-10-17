import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { ok } from '../testHelpers'
import { deckCard, named } from './cirdanCreatureCards'
import { shuffleIntoLibraryInstead } from './shuffleIntoLibraryInstead'
import { targetedResolve } from './targetedResolve'

const COLOSSI = ['Blightsteel Colossus', 'Darksteel Colossus'] as const

const plugins = [shuffleIntoLibraryInstead, targetedResolve]

const filler = (count = 3) =>
  Array.from({ length: count }, (_, index) =>
    cardTemplate(`Library Card ${index + 1}`, { types: ['Instant'] }))

const game = (zones: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(
    commanderRules,
    { players: 3, libraries: { p1: filler(), p2: filler() }, ...zones },
    { random: () => 0.5, cardPlugins: plugins },
  )

for (const colossusName of COLOSSI) {
  describe(`${colossusName} never reaches a graveyard`, () => {
    test('the reveal ends with the shuffle: nobody can see the card in the library afterwards', () => {
      const server = game({ battlefield: { p1: [deckCard(colossusName)] } })
      const id = named(server.state, colossusName).id
      const state = ok(server.rules(server.state, { type: 'sacrifice', objectId: id }))
      expect(state.objects[id].knownTo).toBeUndefined()
      for (const viewer of ['p1', 'p2', 'p3'] as const) {
        expect(projectForViewer(state, viewer).objects[id]).toBeUndefined()
      }
    })
  })
}
