import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { bolt, cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, Plugin } from '../types'
import {
  casts,
  dies,
  discardCards,
  discards,
  draws,
  exiled,
  gainLife,
  leaves,
  loseLife,
  onResolve as onResolveEffect,
  trigger,
  triggerOn,
  type CardEffect,
} from './effects'
import { onResolve } from './onResolve'

import {type CardTemplate} from '../newGame'
const knight = (name = 'Knight', token = false) => cardTemplate(name, {
  types: ['Creature'], subtypes: ['Knight'], colors: ['W'], power: 2, toughness: 2, token,
})
const watcher = (effects: CardEffect[]) => cardTemplate('Watcher', { types: ['Enchantment'], effects })
const named = (state: GameState, name: string) => Object.values(state.objects).find((object) => object.name === name)!
const game = (effects: CardEffect[], zones: Parameters<typeof createServerGame>[1] = {}, plugins: Plugin[] = []) =>
  createServerGame(commanderRules, {
    players: 3, battlefield: { p1: [watcher(effects), knight()] }, ...zones,
  }, { random: () => 0.5, cardPlugins: plugins })

const answerTriggerOrder = (server: ReturnType<typeof createServerGame>, state: GameState) => {
  const selection = pendingSelectionFor(state, 'p1')
  return selection?.triggerOrder
    ? ok(server.rules(state, {
      type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose',
      count: selection.count, objectIds: selection.candidates,
    }))
    : state
}

describe('shared trigger matching', () => {
  test('death watches another white Knight token using pre-death controller and characteristics', () => {
    const effect = dies({ filter: { other: true, token: true, subtypes: ['Knight'], colors: ['W'], controller: 'you' } }, gainLife(1))
    const server = game([effect], { battlefield: { p1: [watcher([effect])], p2: [knight('Knight', true)] } })
    const state = structuredClone(server.state)
    named(state, 'Knight').controller = 'p1'
    const died = ok(server.rules(state, { type: 'sacrifice', objectId: named(state, 'Knight').id }))
    expect(died.stack).toHaveLength(1)
    expect(named(died, 'Watcher').controller).toBe('p1')
    expect(resolveStack(server.rules, died).players.p1.life).toBe(41)
  })

  test('death excludes artifacts, milling, bounce, exile, and opponent creatures', () => {
    const effect = dies({ filter: { controller: 'you' } }, gainLife(1))
    const server = game([effect], {
      battlefield: { p1: [watcher([effect]), knight(), cardTemplate('Rock', { types: ['Artifact'] })], p2: [knight('Enemy')] },
      libraries: { p1: [knight('Milled')] },
    })
    for (const [name, to] of [['Rock', 'graveyard'], ['Enemy', 'graveyard'], ['Milled', 'graveyard'], ['Knight', 'hand'], ['Knight', 'exile']] as const) {
      expect(ok(server.rules(server.state, { type: 'move', objectId: named(server.state, name).id, to })).stack).toHaveLength(0)
    }
  })

  test('filtered leaves sees bounce, death, and exile and survives source removal', () => {
    const server = game([leaves({ filter: { type: 'Creature' } }, gainLife(1))])
    for (const to of ['hand', 'graveyard', 'exile'] as const) {
      const moved = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Knight').id, to }))
      expect(moved.stack).toHaveLength(1)
      const removed = ok(server.rules(moved, { type: 'move', objectId: named(moved, 'Watcher').id, to: 'graveyard' }))
      expect(resolveStack(server.rules, removed).players.p1.life).toBe(41)
    }
  })

  test('unfiltered dies and leaves still watch only the source', () => {
    const server = game([], { battlefield: { p1: [cardTemplate('Self', {
      types: ['Creature'], effects: [dies(gainLife(1)), leaves(gainLife(2))],
    }), knight()] } })
    const other = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Knight').id, to: 'graveyard' }))
    expect(other.stack).toHaveLength(0)
    const self = ok(server.rules(other, { type: 'move', objectId: named(other, 'Self').id, to: 'graveyard' }))
    expect(resolveStack(server.rules, answerTriggerOrder(server, self)).players.p1.life).toBe(43)
  })

  test('exile filters origin zones, ownership, and types', () => {
    const effect = exiled({ from: ['graveyard', 'library'], filter: { owner: 'you', type: 'Creature' } }, gainLife(1))
    const server = game([effect], { libraries: { p1: [knight('Library Knight')], p2: [knight('Enemy Library')] } })
    const buried = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Knight').id, to: 'graveyard' }))
    const fromGrave = ok(server.rules(buried, { type: 'move', objectId: named(buried, 'Knight').id, to: 'exile' }))
    expect(fromGrave.stack).toHaveLength(1)
    const fromLibrary = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Library Knight').id, to: 'exile' }))
    expect(fromLibrary.stack).toHaveLength(1)
    for (const name of ['Knight', 'Enemy Library']) {
      expect(ok(server.rules(server.state, { type: 'move', objectId: named(server.state, name).id, to: 'exile' })).stack).toHaveLength(0)
    }
  })

  test('self exile looks back, while a from-anywhere watcher must still exist after the move', () => {
    const server = game([], { battlefield: { p1: [cardTemplate('Self', {
      types: ['Creature'], effects: [exiled(gainLife(1)), exiled({ filter: { type: 'Creature' } }, gainLife(10))],
    })] } })
    const moved = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Self').id, to: 'exile' }))
    expect(moved.stack).toHaveLength(1)
    expect(resolveStack(server.rules, moved).players.p1.life).toBe(41)
  })

  test('separate exile abilities keep independent once-per-turn keys', () => {
    const server = game([
      exiled({ from: 'battlefield', filter: { type: 'Creature' }, onceEachTurn: true }, gainLife(1)),
      exiled({ from: 'battlefield', filter: { type: 'Creature' }, onceEachTurn: true }, gainLife(2)),
    ], { hands: { p1: [knight('Second')] } })
    const firstMove = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Knight').id, to: 'exile' }))
    const first = resolveStack(server.rules, answerTriggerOrder(server, firstMove))
    expect(first.players.p1.life).toBe(43)
    const entered = ok(server.rules(first, { type: 'move', objectId: named(first, 'Second').id, to: 'battlefield' }))
    const second = ok(server.rules(entered, { type: 'move', objectId: named(entered, 'Second').id, to: 'exile' }))
    expect(second.stack).toHaveLength(0)
  })

  test('legacy trigger groups expose distinct ordering through reconnect', () => {
    const first = dies({ filter: { type: 'Creature' } }, gainLife(1))
    const second = dies({ filter: { type: 'Creature' } }, gainLife(2))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Legacy Order Watcher', {
          types: ['Enchantment'],
          effects: [first, second],
        }), knight('Legacy Victim')],
      },
    }, { random: () => 0.5 })
    const event = { type: 'move' as const, objectId: named(server.state, 'Legacy Victim').id, to: 'graveyard' as const }
    const opened = ok(server.rules(server.state, event))
    const selection = pendingSelectionFor(opened, 'p1')!
    expect(selection.triggerOrder?.entries).toHaveLength(2)
    expect(new Set(selection.triggerOrder?.entries?.map((entry) => entry.label)).size).toBe(2)

    let journal = createJournal(server.state)
    journal = recordAccepted(journal, event)
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p1')).toEqual(selection)
    const reversed = [...selection.candidates].reverse()
    const ordered = ok(server.rules(restored, {
      type: 'selectCards', seat: 'p1', selectionId: selection.id,
      kind: 'choose', count: selection.count, objectIds: reversed,
    }))
    expect(resolveStack(server.rules, ordered).players.p1.life).toBe(43)
  })

  test('draws watches opponents and their second successful draw, once across draw-three', () => {
    const server = game([draws({ player: { not: { relation: 'you' } }, nthThisTurn: 2 }, gainLife(1))], {
      libraries: { p1: [knight()], p2: [knight('A'), knight('B'), knight('C')] },
    })
    const own = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(own.stack).toHaveLength(0)
    const drawn = ok(server.rules(own, { type: 'draw', seat: 'p2', count: 3 }))
    expect(drawn.stack).toHaveLength(1)
    expect(drawn.players.p1.life).toBe(40)
    expect(resolveStack(server.rules, drawn).players.p1.life).toBe(41)
  })

  test('draw filters the drawn object and does not trigger on an empty library', () => {
    const server = game([draws({ filter: { colors: ['W'], type: 'Creature' } }, gainLife(1))], {
      libraries: { p1: [knight(), cardTemplate('Blue', { types: ['Instant'], colors: ['U'] })] },
    })
    const drawn = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 2 }))
    expect(drawn.stack).toHaveLength(1)
    const settled = resolveStack(server.rules, drawn)
    const empty = ok(server.rules(settled, { type: 'draw', seat: 'p1' }))
    expect(empty.stack).toHaveLength(0)
  })

  test('a prevented draw never triggers', () => {
    const prevent: Plugin = { id: 'preventDraw', replace: ({ event }) => event.type === 'draw' ? null : undefined }
    const server = game([draws({}, gainLife(1))], { libraries: { p1: [knight()] }, builtinRules: [...commanderRules.rules, 'preventDraw'] }, [prevent])
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(state.stack).toHaveLength(0)
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('discard filters the actual discarded card and player, not an ordinary graveyard move', () => {
    const server = game([discards({ player: 'opponent', filter: { type: 'Creature' } }, gainLife(1))], {
      hands: { p1: [knight('Own')], p2: [knight('Enemy'), cardTemplate('Trick', { types: ['Instant'] })] },
    })
    for (const name of ['Own', 'Trick']) {
      const seat = name === 'Own' ? 'p1' : 'p2'
      expect(ok(server.rules(server.state, { type: 'discard', seat, objectId: named(server.state, name).id })).stack).toHaveLength(0)
    }
    const discarded = ok(server.rules(server.state, { type: 'discard', seat: 'p2', objectId: named(server.state, 'Enemy').id }))
    expect(discarded.stack).toHaveLength(1)
    expect(resolveStack(server.rules, discarded).players.p1.life).toBe(41)
    expect(ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Enemy').id, to: 'graveyard' })).stack).toHaveLength(0)
  })

  test('cast filters compose OR, AND, and NOT, queue above the spell, and retain the triggering player', () => {
    const effect = casts({ player: 'any', filter: {
      all: [{ colors: ['W'] }, { any: [{ subtypes: ['Knight'] }, { type: 'Instant' }] }],
      not: { type: 'Artifact' },
    } }, gainLife(1))
    const server = game([effect], { hands: { p1: [knight('Spell')], p2: [knight('Enemy Spell')] } })
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Spell').id }))
    expect(cast.stack.map((item) => item.kind)).toEqual(['ability', 'spell'])
    expect(cast.stack[0].payload?.triggeringPlayer).toBe('p1')
    expect(cast.players.p1.life).toBe(40)
    const removed = ok(server.rules(cast, { type: 'move', objectId: named(cast, 'Watcher').id, to: 'graveyard' }))
    expect(resolveStack(server.rules, removed).players.p1.life).toBe(41)
  })

  test('cast OR, AND, and NOT branches reject a white artifact Knight and a blue creature', () => {
    const server = game([casts({ filter: {
      all: [{ colors: ['W'] }, { any: [{ subtypes: ['Knight'] }, { type: 'Instant' }] }],
      not: { type: 'Artifact' },
    } }, gainLife(1))], { hands: { p1: [
      cardTemplate('Artifact Knight', { types: ['Artifact', 'Creature'], colors: ['W'], subtypes: ['Knight'] }),
      cardTemplate('Blue Knight', { types: ['Creature'], colors: ['U'], subtypes: ['Knight'] }),
    ] } })
    for (const name of ['Artifact Knight', 'Blue Knight']) {
      const state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, name).id }))
      expect(state.stack.map((item) => item.kind)).toEqual(['spell'])
    }
  })

  test('the generic builder shares the same matching and once-per-turn handling', () => {
    const effect = trigger('discard', { player: 'you', filter: { type: 'Creature' }, onceEachTurn: true }, gainLife(1))
    expect(structuredClone(effect)).toEqual(effect)
    const server = game([effect], { hands: { p1: [knight('One'), knight('Two')] } })
    let state = server.state
    for (const name of ['One', 'Two']) {
      state = resolveStack(server.rules, ok(server.rules(state, { type: 'discard', seat: 'p1', objectId: named(state, name).id })))
    }
    expect(state.players.p1.life).toBe(41)
  })
})

const endStepDraw = () => cardTemplate('Sygg, River Cutthroat', {
  types: ['Creature'],
  subtypes: ['Merfolk', 'Rogue'],
  supertypes: ['Legendary'],
  power: 1,
  toughness: 3,
  oracleText:
    'At the beginning of each end step, if an opponent lost 3 or more life this turn, '
    + 'you may draw a card.',
})

const toEndStep = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
) => {
  let current = state
  while (current.step !== 'end') {
    current = ok(server.rules(current, { type: 'advanceStep' }))
  }
  return current
}

const endStepDrawGame = () => createServerGame(
  commanderRules,
  {
    battlefield: { p3: [endStepDraw()] },
    libraries: { p3: [cardTemplate('Island', { types: ['Land'] }), cardTemplate('Swamp', { types: ['Land'] })] },
  },
  { random: () => 0.5 },
)

describe('end-step opponent life-loss draw', () => {
  test('an opponent bleeding three life puts the trigger on the stack before the draw choice', () => {
    const server = endStepDrawGame()
    const bled = ok(server.rules(server.state, {
      type: 'loseLife',
      seat: 'p1',
      amount: 3,
    }))
    const ending = toEndStep(server, bled)
    expect(pendingOptionSelection(ending)).toBeUndefined()
    expect(ending.stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Sygg, River Cutthroat',
      controller: 'p3',
    })
    const offered = resolveStack(server.rules, ending)
    expect(pendingOptionSelection(offered, 'p3')?.optionalAction).toBeDefined()
  })

  test('accepting the trigger draws a card and declining does not', () => {
    const server = endStepDrawGame()
    const bled = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 5 }))
    const ending = resolveStack(server.rules, toEndStep(server, bled))
    const pending = pendingOptionSelection(ending, 'p3')!
    const before = ending.zoneCounts.p3.hand
    const drawn = ok(server.rules(ending, {
      type: 'selectOption',
      seat: 'p3',
      selectionId: pending.id,
      optionId: pending.options[0].id,
    }))
    const declined = ok(server.rules(ending, {
      type: 'selectOption',
      seat: 'p3',
      selectionId: pending.id,
      optionId: pending.options[1].id,
    }))
    expect(drawn.zoneCounts.p3.hand).toBe(before + 1)
    expect(pendingOptionSelection(drawn)).toBeUndefined()
    expect(declined.zoneCounts.p3.hand).toBe(before)
    expect(pendingOptionSelection(declined)).toBeUndefined()
  })

  test('an opponent who died to that life loss still counts', () => {
    const server = endStepDrawGame()
    let current = ok(server.rules(server.state, {
      type: 'loseLife',
      seat: 'p1',
      amount: 60,
    }))
    current = ok(server.rules(current, { type: 'concede', seat: 'p1' }))
    const ending = toEndStep(server, current)
    expect(ending.players.p1.lost).toBe(true)
    expect(ending.stack[0]).toMatchObject({ kind: 'ability', name: 'Sygg, River Cutthroat' })
    expect(pendingOptionSelection(resolveStack(server.rules, ending), 'p3')?.optionalAction).toBeDefined()
  })

  test('two life lost by an opponent is not enough', () => {
    const server = endStepDrawGame()
    const bled = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 2 }))
    const ending = toEndStep(server, bled)
    expect(ending.stack).toHaveLength(0)
    expect(pendingOptionSelection(ending)).toBeUndefined()
  })

  test("the watcher's own life loss does not trigger it", () => {
    const server = endStepDrawGame()
    const bled = ok(server.rules(server.state, { type: 'loseLife', seat: 'p3', amount: 9 }))
    const ending = toEndStep(server, bled)
    expect(ending.stack).toHaveLength(0)
    expect(pendingOptionSelection(ending)).toBeUndefined()
  })

  test('life lost on an earlier turn does not carry over', () => {
    const server = endStepDrawGame()
    const bled = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 6 }))
    let current = resolveStack(server.rules, toEndStep(server, bled))
    const pending = pendingOptionSelection(current, 'p3')!
    current = ok(server.rules(current, {
      type: 'selectOption',
      seat: 'p3',
      selectionId: pending.id,
      optionId: pending.options[1].id,
    }))
    while (current.step !== 'end' || current.turn === bled.turn) {
      current = ok(server.rules(current, { type: 'advanceStep' }))
    }
    expect(current.turn).toBeGreaterThan(bled.turn)
    expect(current.stack).toHaveLength(0)
    expect(pendingOptionSelection(current)).toBeUndefined()
  })
})

const discardDrain = () => cardTemplate('Discard Drain', {
  types: ['Enchantment'],
  manaCost: '{1}{B}',
  oracleText: 'Whenever an opponent discards a card, that player loses 2 life.',
  effects: [
    triggerOn('discard', {
      if: { seat: 'opponent' },
      do: [loseLife(2, 'triggeringPlayer')],
    }),
  ],
})

const discardSpell = () => cardTemplate('Forced Discard', {
  types: ['Sorcery'],
  manaCost: '',
  effects: [onResolveEffect(discardCards(1, 'target'))],
})

const passAll = (server: ReturnType<typeof createServerGame>, state: GameState) => {
  let current = state
  for (const seat of current.playerOrder) {
    current = ok(server.rules(current, { type: 'passPriority', seat }))
  }
  return current
}

const discardDrainGame = () => createServerGame(
  commanderRules,
  {
    battlefield: { p3: [discardDrain()] },
    hands: {
      p1: [cardTemplate('Island', { types: ['Land'] }), cardTemplate('Swamp', { types: ['Land'] })],
      p3: [cardTemplate('Forest', { types: ['Land'] })],
    },
  },
  { random: () => 0.5, cardPlugins: [onResolve] },
)

const discardEvent = (state: GameState, seat: string, objectId: string) => ({
  type: 'discard' as const,
  seat,
  objectId,
})

describe('opponent discard life loss', () => {
  test('a discard spell waits, then the drain trigger stacks after the chosen discard', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p3: [discardDrain()] },
        hands: {
          p1: [discardSpell()],
          p2: [cardTemplate('Victim Card', { types: ['Instant'] })],
        },
        players: 4,
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    const spellId = server.state.zoneOrder.p1.hand[0]
    const victimCard = server.state.zoneOrder.p2.hand[0]
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spellId,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    expect(cast.stack).toHaveLength(1)
    expect(cast.stack[0].name).toBe('Forced Discard')
    const afterSpell = passAll(server, cast)
    expect(afterSpell.stack).toHaveLength(1)
    expect(afterSpell.stack[0]).toMatchObject({ kind: 'spell', name: 'Forced Discard' })
    expect(pendingSelectionFor(afterSpell, 'p2')).toMatchObject({ kind: 'discard', count: 1 })
    expect(afterSpell.players.p2.life).toBe(commanderRules.startingLife)
    const continued = ok(server.rules(afterSpell, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'discard',
      count: 1,
      objectIds: [victimCard],
    }))
    expect(continued.objects[victimCard].zone).toBe('graveyard')
    expect(continued.players.p2.life).toBe(commanderRules.startingLife)
    expect(continued.stack).toHaveLength(1)
    expect(continued.stack[0]).toMatchObject({
      kind: 'ability',
      controller: 'p3',
      name: 'Discard Drain',
    })
    const drained = ok(server.rules(continued, { type: 'resolveTop' }))
    expect(drained.players.p2.life).toBe(commanderRules.startingLife - 2)
    expect(drained.stack).toHaveLength(0)
  })

  test('an opponent discarding puts the drain on the stack before life loss', () => {
    const server = discardDrainGame()
    const objectId = server.state.zoneOrder.p1.hand[0]
    const afterDiscard = ok(server.rules(server.state, discardEvent(server.state, 'p1', objectId)))
    expect(afterDiscard.players.p1.life).toBe(commanderRules.startingLife)
    expect(afterDiscard.stack).toHaveLength(1)
    expect(afterDiscard.stack[0]).toMatchObject({
      kind: 'ability',
      controller: 'p3',
      name: 'Discard Drain',
    })
    expect(afterDiscard.objects[objectId].zone).toBe('graveyard')
    const resolved = ok(server.rules(afterDiscard, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife - 2)
    expect(resolved.stack).toHaveLength(0)
  })

  test('each discarded card triggers separately', () => {
    const server = discardDrainGame()
    let current = server.state
    for (const objectId of server.state.zoneOrder.p1.hand) {
      current = ok(server.rules(current, discardEvent(current, 'p1', objectId)))
      expect(current.stack.length).toBeGreaterThan(0)
      current = ok(server.rules(current, { type: 'resolveTop' }))
    }
    expect(current.players.p1.life).toBe(commanderRules.startingLife - 4)
  })

  test('the controller discarding is not an opponent', () => {
    const server = discardDrainGame()
    const objectId = server.state.zoneOrder.p3.hand[0]
    const discarded = ok(server.rules(server.state, discardEvent(server.state, 'p3', objectId)))
    expect(discarded.stack).toHaveLength(0)
    expect(discarded.players.p3.life).toBe(commanderRules.startingLife)
  })

  test('a drain source that has left the battlefield drains nobody', () => {
    const server = discardDrainGame()
    const source = Object.values(server.state.objects)
      .find((object) => object.name === 'Discard Drain')!
    const gone = ok(server.rules(server.state, {
      type: 'move',
      objectId: source.id,
      to: 'graveyard',
    }))
    const objectId = server.state.zoneOrder.p1.hand[0]
    const discarded = ok(server.rules(gone, discardEvent(gone, 'p1', objectId)))
    expect(discarded.stack).toHaveLength(0)
    expect(discarded.players.p1.life).toBe(commanderRules.startingLife)
  })

  test('players can respond to the drain trigger before life loss', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p3: [discardDrain()] },
        hands: {
          p1: [cardTemplate('Island', { types: ['Land'] })],
          p3: [bolt()],
        },
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    const discardedId = server.state.zoneOrder.p1.hand[0]
    const boltId = server.state.zoneOrder.p3.hand[0]
    const afterDiscard = ok(server.rules(server.state, discardEvent(server.state, 'p1', discardedId)))
    expect(afterDiscard.players.p1.life).toBe(commanderRules.startingLife)
    expect(afterDiscard.stack).toHaveLength(1)
    const ready = structuredClone(afterDiscard)
    ready.priority = 'p3'
    ready.players.p3.mana.R = 1
    const bolted = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p3',
      objectId: boltId,
      targets: [{ kind: 'player', player: 'p1' }],
    }))
    expect(bolted.stack).toHaveLength(2)
    expect(bolted.stack[0].name).toBe('Lightning Bolt')
    expect(bolted.players.p1.life).toBe(commanderRules.startingLife)
    const afterBolt = ok(server.rules(bolted, { type: 'resolveTop' }))
    expect(afterBolt.players.p1.life).toBe(commanderRules.startingLife - 3)
    expect(afterBolt.stack).toHaveLength(1)
    const afterDrain = ok(server.rules(afterBolt, { type: 'resolveTop' }))
    expect(afterDrain.players.p1.life).toBe(commanderRules.startingLife - 5)
  })

  test('two drain sources trigger in APNAP order', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p2: [discardDrain()],
          p3: [discardDrain()],
        },
        hands: {
          p1: [cardTemplate('Island', { types: ['Land'] })],
        },
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    const objectId = server.state.zoneOrder.p1.hand[0]
    const afterDiscard = ok(server.rules(server.state, discardEvent(server.state, 'p1', objectId)))
    expect(afterDiscard.stack).toHaveLength(2)
    expect(afterDiscard.stack[0].controller).toBe('p3')
    expect(afterDiscard.stack[1].controller).toBe('p2')
    const once = ok(server.rules(afterDiscard, { type: 'resolveTop' }))
    expect(once.players.p1.life).toBe(commanderRules.startingLife - 2)
    const twice = ok(server.rules(once, { type: 'resolveTop' }))
    expect(twice.players.p1.life).toBe(commanderRules.startingLife - 4)
  })
})

describe('relocated from rankle.test.ts → generalizedTriggers.test.ts', () => {
  const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
    cardTemplate(name, { types, ...extra })

  const creature = (name: string, extra: Partial<CardTemplate> = {}) =>
    card(name, ['Creature'], { power: 1, toughness: 1, ...extra })

  const rankleCard = () => creature('Rankle, Master of Pranks', {
    supertypes: ['Legendary'],
    subtypes: ['Faerie', 'Rogue'],
    power: 3,
    toughness: 3,
  })

  const game = (extra: { caress?: boolean } = {}) => createServerGame(
    commanderRules,
    {
      battlefield: {
        p1: [rankleCard(), creature('Gravedigger'), ...(extra.caress
          ? [card("Liliana's Caress", ['Enchantment'])]
          : [])],
        p2: [creature('Lone Hydra', { power: 9, toughness: 9 })],
      },
      hands: {
        p1: [card('Swamp', ['Land'])],
        p2: [card('Island', ['Land']), card('Forest', ['Land'])],
      },
      libraries: {
        p1: [card('Mountain', ['Land'])],
        p2: [card('Plains', ['Land'])],
      },
    },
    { random: () => 0.5 },
  )

  const connect = (server: ReturnType<typeof createServerGame>, state = server.state) => {
    const source = Object.values(state.objects)
      .find((object) => object.name === 'Rankle, Master of Pranks')!
    return ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: source.id,
      target: { kind: 'player', player: 'p2' },
      amount: 3,
    }))
  }

  const pickModes = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    indices: number[],
  ) => {
    let current = state
    for (const index of indices) {
      const pending = pendingOptionSelection(current, 'p1')!
      current = ok(server.rules(current, {
        type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: `mode:${index}`,
      }))
    }
    const pending = pendingOptionSelection(current, 'p1')
    if (pending?.options.some(option => option.id === 'done')) {
      current = ok(server.rules(current, {
        type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: 'done',
      }))
    }
    return current
  }

  test('the discard mode drains through Liliana\'s Caress', () => {
    const server = game({ caress: true })
    const asked = resolveStack(server.rules, pickModes(server, connect(server), [0]))
    const swamp = Object.values(asked.objects).find((object) => object.name === 'Swamp')!
    const afterP1 = ok(server.rules(asked, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [swamp.id],
    }))
    const island = Object.values(afterP1.objects).find((object) => object.name === 'Island')!
    const discarded = ok(server.rules(afterP1, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [island.id],
    }))

    expect(discarded.objects[island.id].zone).toBe('graveyard')
    expect(discarded.players.p2.life).toBe(commanderRules.startingLife - 3)
    expect(discarded.stack[0]).toMatchObject({
      kind: 'ability',
      name: "Liliana's Caress",
    })

    const resolved = ok(server.rules(discarded, { type: 'resolveTop' }))
    expect(resolved.players.p2.life).toBe(commanderRules.startingLife - 5)
  })

})
