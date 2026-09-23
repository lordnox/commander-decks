import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, projectForViewer } from '../index'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog, pendingDialogLock } from '../pendingDialog'
import { draw as drawPlugin } from '../rules/draw'
import { createServerGame } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import { draw, spree, spreeMode } from './effectBuilders'
import { spreeCast } from './spreeCast'

const MODES = {
  sip: 'Sip one card',
  gulp: 'Gulp two cards',
} as const

const spreeFixture = () => cardTemplate('Spree Fixture Alpha', {
  types: ['Instant'],
  manaCost: '{1}{U}',
  effects: [
    spree([
      spreeMode('sip', MODES.sip, '{1}', [draw(1)]),
      spreeMode('gulp', MODES.gulp, '{2}', [draw(2)]),
    ]),
  ],
})

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const run = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

const plugins = [spreeCast, pendingDialogLock, drawPlugin]

describe('spreeCast', () => {
  test('opens Spree mode choice before paying mana, then casts with selected modes', () => {
    const server = createServerGame(
      commanderRules,
      {
        libraries: {
          p1: [
            cardTemplate('Library One', ['Instant']),
            cardTemplate('Library Two', ['Instant']),
            cardTemplate('Library Three', ['Instant']),
          ],
        },
        hands: { p1: [spreeFixture()] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 3 }
    const spell = ready.zoneOrder.p1.hand[0]
    const opened = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
    }))
    expect(opened.stack).toHaveLength(0)
    expect(opened.players.p1.mana.U).toBe(1)
    expect(pendingDialog(opened)).toMatchObject({
      kind: 'choose-modes',
      source: 'Spree Fixture Alpha',
      options: [MODES.sip, MODES.gulp],
      requirements: { target: { min: 1, max: 2 } },
    })
    const projected = projectForViewer(opened, 'p2')
    expect(pendingDialog(projected)).toBeUndefined()

    const cast = ok(server.rules(opened, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { modes: [MODES.gulp] },
    }))
    expect(pendingDialog(cast)).toBeUndefined()
    expect(cast.stack[0]).toMatchObject({
      name: 'Spree Fixture Alpha',
      spreeModes: ['gulp'],
    })
    expect(cast.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })

    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.stack).toHaveLength(0)
    expect(resolved.objects[spell].zone).toBe('graveyard')
    expect(resolved.zoneCounts.p1.hand).toBeGreaterThan(0)
  })

  test('casting with explicit spreeModes pays combined costs and runs each mode', () => {
    const server = createServerGame(
      commanderRules,
      {
        libraries: {
          p1: [
            cardTemplate('Library One', ['Instant']),
            cardTemplate('Library Two', ['Instant']),
            cardTemplate('Library Three', ['Instant']),
          ],
        },
        hands: { p1: [spreeFixture()] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 4 }
    const spell = ready.zoneOrder.p1.hand[0]
    const cast = run(server, ready, eventsForAvailableAction(ready, 'p1', {
      kind: 'castSpell',
      objectId: spell,
      name: 'Spree Fixture Alpha',
      spreeModes: ['sip', 'gulp'],
    })!)
    expect(cast.stack[0].spreeModes).toEqual(['sip', 'gulp'])
    expect(cast.players.p1.mana.C).toBe(0)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.zoneCounts.p1.hand).toBe(3)
  })

  test('rejects casting with no modes or unknown mode ids', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [spreeFixture()] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 3 }
    const spell = ready.zoneOrder.p1.hand[0]
    const opened = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
    }))
    const emptyModes = server.rules(opened, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { modes: [] },
    })
    expect(emptyModes.ok).toBe(false)
    expect(emptyModes.ok === false && emptyModes.error).toBe('choose at least one Spree mode')

    const illegal = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      spreeModes: ['bogus'],
    })
    expect(illegal.ok).toBe(false)
    expect(illegal.ok === false && illegal.error).toBe('illegal Spree mode')
  })
})
