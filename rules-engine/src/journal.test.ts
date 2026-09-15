import { expect, test } from 'bun:test'
import { commanderRules } from './formats'
import { createJournal, recordAccepted, restoreJournal } from './journal'
import { forest } from './newGame'
import { createServerGame } from './runtime'

test('a kernel journal restores accepted events without storing before/after trees', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [forest()] },
  })
  const land = Object.values(server.state.objects)[0]
  let journal = createJournal(server.state)
  const played = server.rules(server.state, {
    type: 'playLand',
    seat: 'p1',
    objectId: land.id,
  })
  expect(played.ok).toBe(true)
  if (!played.ok) return
  journal = recordAccepted(journal, {
    type: 'playLand',
    seat: 'p1',
    objectId: land.id,
  })

  const restored = restoreJournal(journal, server.rules)
  expect(restored.current().objects[land.id].zone).toBe('battlefield')
  expect(journal.initial.objects[land.id].zone).toBe('hand')
})
