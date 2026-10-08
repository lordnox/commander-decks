import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState } from '../types'
import { isGoaded } from '../plugins/goad'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok, resolveStack } from '../testHelpers'
import { continuousEffects } from './continuousEffects'
import { draw, enters } from './effects'
import { effectsFor } from './cardRules'
import {
  PENDING_PERMANENT_DONATION,
  permanentControl,
  pendingPermanentDonation,
} from './permanentControl'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { createLobby } from '../../../live-runner/src/lobby'
import {
  applyKernelChoice,
  prepareKernelPendingChoice,
} from '../../../live-runner/src/kernelHost'
import type { KernelHandle } from '../../../live-runner/src/kernelHandle'

const plugins = [permanentControl, continuousEffects]

const creature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

const instant = (name: string) => cardTemplate(name, { types: ['Instant'] })

const fromRules = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { effects: effectsFor(name), ...extra })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const handleFor = (
  rules: (state: GameState, event: Parameters<KernelHandle['dispatch']>[0]) => ReturnType<KernelHandle['dispatch']>,
  initial: GameState,
): KernelHandle => {
  let journal = createJournal(initial)
  const history = restoreJournal(journal, rules)
  return {
    get journal() {
      return journal
    },
    history,
    rules,
    save: () => {},
    dispatch: (event) => {
      const result = history.dispatch(event)
      if (result.ok) journal = recordAccepted(journal, event)
      return result
    },
  }
}

const playDack = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
) => {
  const dackId = named(state, 'Dack Fayden, Helping Hand').id
  let current = ok(server.rules(state, { type: 'move', objectId: dackId, to: 'battlefield' }))
  return resolveStack(server.rules, current)
}

const pickOpponentsInOrder = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  opponents: string[],
) => {
  let current = state
  for (const opponent of opponents) {
    const selection = pendingPlayerSelectionFor(current, 'p1')
    if (!selection) break
    current = ok(server.rules(current, {
      type: 'selectPlayers',
      selectionId: selection.id,
      seat: 'p1',
      players: [opponent],
    }))
  }
  return current
}

const advanceThroughDonations = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
) => {
  let current = state
  for (let step = 0; step < 40; step += 1) {
    const selection = pendingPlayerSelectionFor(current, 'p1')
    if (selection) {
      const opponent = selection.candidates[0]
      current = ok(server.rules(current, {
        type: 'selectPlayers',
        selectionId: selection.id,
        seat: 'p1',
        players: [opponent],
      }))
      continue
    }
    if (current.stack.length > 0 && !current.stack[0]?.waiting) {
      current = ok(server.rules(current, { type: 'resolveTop' }))
      continue
    }
    break
  }
  return current
}

describe('Dack Fayden, Helping Hand', () => {
  test('four-player pod reveals three creatures, goads them, and donates one each', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      hands: {
        p1: [fromRules('Dack Fayden, Helping Hand', { types: ['Creature'] })],
      },
      libraries: {
        p1: [
          instant('Noise'),
          creature('Guest One', { effects: [enters(draw(1))] }),
          instant('Gap'),
          creature('Guest Two'),
          creature('Guest Three'),
          instant('Tail'),
          instant('Drawn Card'),
        ],
      },
    }, { random: () => 0, cardPlugins: plugins })

    const afterEnter = playDack(server, server.state)
    const mid = advanceThroughDonations(server, afterEnter)

    for (const name of ['Guest One', 'Guest Two', 'Guest Three']) {
      const object = named(mid, name)
      expect(object.zone).toBe('battlefield')
      expect(isGoaded(object)).toBe(true)
    }

    const finished = pickOpponentsInOrder(server, mid, ['p2', 'p3', 'p4'])
    expect(pendingPermanentDonation(finished)).toBeUndefined()

    const controllers = ['Guest One', 'Guest Two', 'Guest Three']
      .map((name) => named(finished, name).controller)
    expect(new Set(controllers)).toEqual(new Set(['p2', 'p3', 'p4']))

    const handNames = finished.zoneOrder.p1.hand.map((id) => finished.objects[id].name)
    expect(handNames).toContain('Drawn Card')
  })

  test('two-player pod reveals one creature and donates to the sole opponent', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [fromRules('Dack Fayden, Helping Hand', { types: ['Creature'] })],
      },
      libraries: {
        p1: [instant('Lead'), creature('Solo Guest'), instant('Rest')],
      },
    }, { random: () => 0, cardPlugins: plugins })

    const afterEnter = playDack(server, server.state)
    const finished = pickOpponentsInOrder(server, advanceThroughDonations(server, afterEnter), ['p2'])
    const guest = named(finished, 'Solo Guest')
    expect(guest.controller).toBe('p2')
    expect(isGoaded(guest)).toBe(true)
  })

  test('fewer creatures in library than opponents still shuffles and skips donation when none enter', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      hands: {
        p1: [fromRules('Dack Fayden, Helping Hand', { types: ['Creature'] })],
      },
      libraries: {
        p1: [instant('Only'), instant('Spells')],
      },
    }, { random: () => 0, cardPlugins: plugins })

    const finished = advanceThroughDonations(server, playDack(server, server.state))
    expect(pendingPlayerSelectionFor(finished, 'p1')).toBeUndefined()
    expect(finished.zoneOrder.p1.battlefield.filter((id) =>
      finished.objects[id].name.startsWith('Guest'))).toHaveLength(0)
  })

  test('donation choice survives a host restart during Dack resolution', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      hands: {
        p1: [fromRules('Dack Fayden, Helping Hand', { types: ['Creature'] })],
      },
      libraries: {
        p1: [
          creature('Guest Alpha'),
          creature('Guest Beta'),
          creature('Guest Gamma'),
        ],
      },
    }, { random: () => 0, cardPlugins: plugins })

    let mid = playDack(server, server.state)
    for (let step = 0; step < 40; step += 1) {
      if (pendingPlayerSelectionFor(mid, 'p1')) break
      if (mid.stack.length > 0 && !mid.stack[0]?.waiting) {
        mid = ok(server.rules(mid, { type: 'resolveTop' }))
        continue
      }
      break
    }
    expect(pendingPlayerSelectionFor(mid, 'p1')).toBeDefined()
    expect(mid.players.p1.data[PENDING_PERMANENT_DONATION]).toBeDefined()

    server.state = mid
    server.state.priority = 'p1'
    const kernel = handleFor(server.rules, server.state)
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)

    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, restarted)).toBe(true)
    const selection = pendingPlayerSelectionFor(kernel.history.current(), 'p1')!
    const cards = restarted.topdeck?.cards ?? []
    expect(applyKernelChoice(kernel, restarted, 'p1', {
      type: 'topdeck',
      choices: cards.map((card, slot) => ({
        card,
        slot,
        destination: card === 'p2' ? 'target' : 'skip',
      })),
    })).toBe(true)
    expect(kernel.journal.events).toContainEqual({
      type: 'selectPlayers',
      selectionId: selection.id,
      seat: 'p1',
      players: ['p2'],
    })
    expect(kernel.history.current().players.p1.data[PENDING_PERMANENT_DONATION]).toBeDefined()
  })
})
