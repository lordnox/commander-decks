import { expect, test } from 'bun:test'
import { cardTemplate } from '../../newGame'
import type { GameState, Plugin } from '../../types'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { gainLife, loseLife, players, ref, resultAmount } from './v1'

const lossReplacement: Plugin = {
  id: 'fixture.lossReplacement',
  replace: ({ event }) => {
    if (event.type !== 'loseLife') return
    switch (event.seat) {
      case 'p2': return null
      case 'p3': return { type: 'loseLife', seat: 'p3', amount: 1, source: event.source }
    }
  },
}

test.each([false, true])('numeric life results total actual losses across every recipient (replacements=%s)', replaced => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [
      loseLife({ targets: players({ relation: 'opponent' }), amount: 5, bindResult: 'lost' }),
      gainLife({ targets: ref('controller'), amount: resultAmount('lost') }),
    ] })] },
  }, { random: () => 0, ...(replaced ? { cardPlugins: [lossReplacement] } : {}) })
  const state = structuredClone(server.state)
  state.players.p2.life = 2 // Loss can exceed the player's life total; it is not damage's gain cap.
  const cast = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0] }))
  const resolved = resolveStack(server.rules, JSON.parse(JSON.stringify(cast)))
  expect(resolved.players.p1.life).toBe(replaced ? 46 : 55)
  expect(resolved.players.p2.life).toBe(replaced ? 2 : -3)
  expect(resolved.players.p3.life).toBe(replaced ? 39 : 35)
  expect(resolved.players.p4.life).toBe(35)
})

test.each([0, 3])('life results bind zero when nothing is lost (amount=%s)', amount => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [
      loseLife({ targets: players({ relation: 'opponent' }), amount, bindResult: 'lost' }),
      gainLife({ targets: ref('controller'), amount: resultAmount('lost') }),
    ] })] },
  }, { random: () => 0, cardPlugins: [{ id: 'fixture.noLoss', replace: ({ event }) => event.type === 'loseLife' ? null : undefined }] })
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })))
  expect(state.players.p1.life).toBe(40)
})


test('redirected life loss to an eliminated player contributes no actual loss', () => {
  const server = createServerGame(commanderRules, {
    players: 3, hands: { p1: [instructionSpell({ instructions: [
      loseLife({ targets: players({ relation: 'opponent' }), amount: 5, bindResult: 'lost' }),
      gainLife({ targets: ref('controller'), amount: resultAmount('lost') }),
    ] })] },
  }, { random: () => 0, cardPlugins: [{ id: 'fixture.redirectLoss', replace: ({ event }) => event.type === 'loseLife' && event.seat === 'p2' ? { ...event, seat: 'p3' } : undefined }] })
  const ready = structuredClone(server.state)
  ready.players.p3.lost = true
  const state = resolveStack(server.rules, ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0] })))
  expect(state.players.p1.life).toBe(40)
  expect(state.players.p2.life).toBe(40)
})

test.each(['Swords to Plowshares', 'Condemn'])('zone-change follow-up pays the captured controller using resolution-time stats (%s)', name => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate(name, { manaCost: '{0}' })] },
    battlefield: { p2: [cardTemplate('Stolen creature', { types: ['Creature'], power: 4, toughness: 5 })] },
    libraries: { p3: [cardTemplate('Top'), cardTemplate('Bottom')] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  const creature = ready.zoneOrder.p2.battlefield[0]!
  ready.objects[creature].owner = 'p3'
  ready.objects[creature].attacking = 'p1'
  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0], targets: [{ kind: 'object', objectId: creature }] }))
  const changed = JSON.parse(JSON.stringify(cast)) as GameState
  changed.objects[creature].power = 7
  changed.objects[creature].toughness = 8
  const state = resolveStack(server.rules, changed)
  expect(state.players.p1.life).toBe(40)
  expect(state.players.p2.life).toBe(name === 'Condemn' ? 48 : 47)
  expect(state.players.p3.life).toBe(40)
  expect(state.objects[creature].zone).toBe(name === 'Condemn' ? 'library' : 'exile')
  if (name === 'Condemn') expect(state.zoneOrder.p3.library.at(-1)).toBe(creature)
})

test.each([-2, 0, 4])('captured power produces nonnegative life gain even for an exiled token (%s)', power => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Swords to Plowshares', { manaCost: '{0}' })] },
    battlefield: { p2: [cardTemplate('Token fixture', { types: ['Creature'], token: true, power, toughness: 5 })] },
  }, { random: () => 0 })
  const ready = server.state
  const creature = ready.zoneOrder.p2.battlefield[0]!
  const state = resolveStack(server.rules, ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0], targets: [{ kind: 'object', objectId: creature }] })))
  expect(state.players.p2.life).toBe(40 + Math.max(0, power))
  expect(state.objects[creature]).toBeUndefined()
})
