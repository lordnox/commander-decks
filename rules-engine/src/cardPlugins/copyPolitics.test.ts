import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState, Plugin } from '../types'
import { onResolve } from './onResolve'
import { pendingVote, vote } from './vote'
import { pendingOptionSelection } from '../rules/selectOptions'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const creature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

const spell = (name: string, manaCost: string, types = ['Sorcery']) =>
  cardTemplate(name, { types, manaCost })

const ready = (state: GameState, seat = 'p1', amount = 10) => {
  const next = structuredClone(state)
  next.active = seat
  next.priority = seat
  next.step = 'precombatMain'
  next.players[seat].mana = { W: amount, U: amount, B: amount, R: amount, G: amount, C: amount }
  return next
}

const serverWith = (
  options: Parameters<typeof createServerGame>[1],
  cardPlugins: Plugin[],
) => createServerGame(
  commanderRules,
  { players: 4, ...options },
  { random: () => 0.5, cardPlugins },
)

describe('Lady Evangela copy and politics capabilities', () => {
  test("Council's Judgment validates public sequential votes and exiles every tied winner", () => {
    const server = serverWith({
      hands: {
        p1: [
          spell("Council's Judgment", '{1}{W}{W}'),
          spell('Private Answer', '{U}', ['Instant']),
        ],
      },
      battlefield: {
        p1: [creature('P1 Bear')],
        p2: [creature('P2 Bear')],
        p3: [creature('P3 Bear')],
      },
    }, [onResolve, vote])
    let state = ready(server.state)
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, "Council's Judgment").id,
    }))
    const resolved = server.rules(state, { type: 'resolveTop' })
    state = ok(resolved)
    expect(pendingVote(state)).toMatchObject({ owner: 'p1', secret: false })
    expect(pendingOptionSelection(state, 'p1')?.action).toMatchObject({ kind: 'vote', voter: 'p1' })
    const privateAnswerId = named(state, 'Private Answer').id
    const p2View = projectForViewer(state, 'p2')
    expect(pendingVote(p2View)).toBeDefined()
    expect(p2View.objects[privateAnswerId]).toBeUndefined()

    const answer = (seat: string, objectName: string) => {
      const selection = pendingOptionSelection(state, seat)!
      return server.rules(state, {
        type: 'selectOption',
        seat,
        selectionId: selection.id,
        optionId: named(state, objectName).id,
      })
    }
    // The caster's own permanents are never offered, to any voter.
    expect(answer('p1', 'P1 Bear').ok).toBe(false)
    state = ok(answer('p1', 'P2 Bear'))
    expect(answer('p2', 'P1 Bear').ok).toBe(false)
    state = ok(answer('p2', 'P3 Bear'))
    state = ok(answer('p3', 'P2 Bear'))
    const last = answer('p4', 'P3 Bear')
    state = ok(last)
    expect(named(state, 'P2 Bear').zone).toBe('exile')
    expect(named(state, 'P3 Bear').zone).toBe('exile')
    expect(named(state, 'P1 Bear').zone).toBe('battlefield')
    expect(pendingVote(state)).toBeUndefined()
    expect(last.trace.some(({ event }) => event.type === 'votesFinished')).toBe(true)
  })
})
