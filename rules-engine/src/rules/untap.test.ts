import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { turnStructure } from '../plugins/turnStructure'
import { bears, newGame } from '../testGame'
import { ok } from '../testHelpers'
import type { GameState } from '../types'

const catalog = createCatalog([turnStructure])
const builtinRules = ['turnStructure']

const only = (state: GameState) => Object.values(state.objects).find((object) => object.name === bears().name)!

const setup = (patch: Partial<ReturnType<typeof bears>> = {}) =>
  newGame({
    builtinRules,
    battlefield: { p1: [{ ...bears(), tapped: true, ...patch }] },
  })

/** Cleanup of p4 wraps into p1's untap step. */
const intoP1Untap = (state: GameState) =>
  ok(rules({ ...state, step: 'cleanup', active: 'p4' }, { type: 'advanceStep' }, catalog))

describe('stun counters', () => {
  test('an untap event removes one stun counter instead of untapping', () => {
    const stunned = setup({ counters: { stun: 2 } })
    const first = ok(rules(stunned, { type: 'untap', objectId: only(stunned).id }, catalog))
    expect(only(first).tapped).toBe(true)
    expect(only(first).counters.stun).toBe(1)

    const second = ok(rules(first, { type: 'untap', objectId: only(first).id }, catalog))
    expect(only(second).tapped).toBe(true)
    expect(only(second).counters.stun).toBeUndefined()

    const third = ok(rules(second, { type: 'untap', objectId: only(second).id }, catalog))
    expect(only(third).tapped).toBe(false)
  })

  test('an untapped permanent keeps its stun counter', () => {
    const state = setup({ tapped: false, counters: { stun: 1 } })
    const next = ok(rules(state, { type: 'untap', objectId: only(state).id }, catalog))
    expect(only(next).counters.stun).toBe(1)
  })

  test('the untap step spends one counter per turn until the permanent untaps', () => {
    const stunned = setup({ counters: { stun: 2 } })
    const firstTurn = intoP1Untap(stunned)
    expect(firstTurn.step).toBe('untap')
    expect(only(firstTurn).tapped).toBe(true)
    expect(only(firstTurn).counters.stun).toBe(1)

    const secondTurn = intoP1Untap(firstTurn)
    expect(only(secondTurn).tapped).toBe(true)
    expect(only(secondTurn).counters.stun).toBeUndefined()

    const thirdTurn = intoP1Untap(secondTurn)
    expect(only(thirdTurn).tapped).toBe(false)
  })

  test('stun counters on other players permanents wait for their own untap step', () => {
    const base = newGame({
      builtinRules,
      battlefield: { p2: [{ ...bears(), tapped: true, counters: { stun: 1 } }] },
    })
    const next = intoP1Untap(base)
    expect(only(next).tapped).toBe(true)
    expect(only(next).counters.stun).toBe(1)
  })

  test('stun counters and the skip marker are lost when the permanent leaves the battlefield', () => {
    const state = setup({ counters: { stun: 2 }, skipNextUntap: true })
    const gone = ok(rules(state, { type: 'move', objectId: only(state).id, to: 'graveyard' }, catalog))
    expect(only(gone).counters.stun).toBeUndefined()
    expect(only(gone).skipNextUntap).toBeUndefined()
  })
})

describe('skip next untap step', () => {
  test('the marked permanent stays tapped for one untap step and then recovers', () => {
    const marked = setup({ skipNextUntap: true })
    const skipped = intoP1Untap(marked)
    expect(only(skipped).tapped).toBe(true)
    expect(only(skipped).skipNextUntap).toBeUndefined()

    const recovered = intoP1Untap(skipped)
    expect(only(recovered).tapped).toBe(false)
  })

  test('a skipped untap step does not spend a stun counter', () => {
    const marked = setup({ skipNextUntap: true, counters: { stun: 1 } })
    const skipped = intoP1Untap(marked)
    expect(only(skipped).counters.stun).toBe(1)
    const stunned = intoP1Untap(skipped)
    expect(only(stunned).counters.stun).toBeUndefined()
    expect(only(stunned).tapped).toBe(true)
  })

  test('another player untap step leaves the marker in place', () => {
    const base = newGame({
      builtinRules,
      battlefield: { p2: [{ ...bears(), tapped: true, skipNextUntap: true }] },
    })
    const next = intoP1Untap(base)
    expect(only(next).tapped).toBe(true)
    expect(only(next).skipNextUntap).toBe(true)
  })

  test('an explicit untap effect is not blocked by the marker', () => {
    const marked = setup({ skipNextUntap: true })
    const next = ok(rules(marked, { type: 'untap', objectId: only(marked).id }, catalog))
    expect(only(next).tapped).toBe(false)
  })
})
