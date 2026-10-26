import { describe, expect, test } from 'bun:test'
import { projectForViewer } from '../index'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { ability, handlerIdsFromEffects, ward } from './effects'
import { ward as wardPlugin } from './ward'

import {type CardTemplate} from '../newGame'
import {DIALOG_CHOSEN, pendingDialog, pendingDialogLock} from '../pendingDialog'
import {pendingSelectionFor} from '../rules/selectCards'
import type {GameEvent} from '../types'
import {choiceEffects} from './choiceEffects'
import {exiledWith} from './exiledWith'
import { librarySearch } from './librarySearch'
import {onResolve} from './onResolve'
import {castCosts} from './castCosts'
import {deckCard} from './cirdanCreatureCards'
const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const wurm = () => cardTemplate('Warded Wurm', {
  types: ['Creature'],
  power: 7,
  toughness: 7,
  effects: [ward({ life: 7 })],
})

const bolt = () => cardTemplate('Ward spell fixture', { types: ['Instant'], manaCost: '{R}' })

const poker = () => cardTemplate('Poker', {
  types: ['Creature'],
  effects: [ability({ id: 'poker.poke', targets: 'creature' }, {}, { kind: 'gainLife', count: 1 })],
})

const game = (life = 20) => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [bolt()] },
    battlefield: { p1: [poker(), wurm()], p2: [wurm()] },
  }, { random: () => 0.5, cardPlugins: [wardPlugin, activated] })
  const ready = structuredClone(server.state)
  ready.players.p1.life = life
  ready.players.p1.mana.R = 1
  ready.priority = 'p1'
  return { server, ready }
}

const theirWurm = (state: GameState) =>
  Object.values(state.objects).find((object) =>
    object.name === 'Warded Wurm' && object.controller === 'p2')!

const castBolt = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  target = theirWurm(state),
) => ok(server.rules(state, {
  type: 'castSpell',
  seat: 'p1',
  objectId: named(state, 'Ward spell fixture').id,
  targets: [{ kind: 'object', objectId: target.id }],
}))

const answer = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  optionId: string,
) => server.rules(state, {
  type: 'selectOption',
  seat: 'p1',
  selectionId: pendingOptionSelection(state, 'p1')!.id,
  optionId,
})

describe('Ward with a life payment', () => {
  test('the effect is clone-safe and stamps the ward handler', () => {
    expect(structuredClone(ward({ life: 7 }))).toEqual(ward({ life: 7 }))
    expect(handlerIdsFromEffects([ward({ life: 7 })])).toEqual(['ward'])
  })

  test('targeting asks the caster privately; paying loses the life and the spell goes on', () => {
    const { server, ready } = game()
    const warded = castBolt(server, ready)
    expect(warded.stack).toHaveLength(0)
    expect(pendingOptionSelection(warded, 'p1')).toMatchObject({
      source: 'Warded Wurm',
      options: [{ id: 'pay' }, { id: 'decline' }],
      action: { kind: 'ward-life', life: 7 },
    })
    expect(pendingOptionSelection(projectForViewer(warded, 'p2'), 'p1')).toBeUndefined()
    expect(pendingOptionSelection(projectForViewer(warded, 'p1'), 'p1')).toBeDefined()

    const restarted = structuredClone(warded)
    const paid = ok(answer(server, restarted, 'pay'))
    expect(paid.players.p1.life).toBe(13)
    expect(paid.stack[0]).toMatchObject({ kind: 'spell', objectId: named(paid, 'Ward spell fixture').id })
    expect(pendingOptionSelection(paid, 'p1')).toBeUndefined()
    expect(paid.players.p1.data['ward.pendingCast']).toBeUndefined()
  })

  test('declining counters the spell without paying', () => {
    const { server, ready } = game()
    const declined = ok(answer(server, castBolt(server, ready), 'decline'))
    expect(declined.players.p1.life).toBe(20)
    expect(declined.stack).toHaveLength(0)
    expect(named(declined, 'Ward spell fixture').zone).not.toBe('stack')
    expect(pendingOptionSelection(declined, 'p1')).toBeUndefined()
    expect(declined.log.some((line) => line.includes('countered by Ward'))).toBe(true)
  })

  test('a player with less life than the cost cannot pay and the spell is countered', () => {
    const { server, ready } = game(6)
    const state = castBolt(server, ready)
    expect(pendingOptionSelection(state, 'p1')).toBeUndefined()
    expect(state.stack).toHaveLength(0)
    expect(state.players.p1.life).toBe(6)
    expect(state.log.some((line) => line.includes('countered by Ward'))).toBe(true)
  })

  test('a player with exactly enough life may pay it all and loses the game', () => {
    const { server, ready } = game(7)
    const paid = ok(answer(server, castBolt(server, ready), 'pay'))
    expect(paid.players.p1.life).toBe(0)
    expect(paid.players.p1.lost).toBe(true)
  })

  test('rejects unknown options, other seats, and other actions while the choice is open', () => {
    const { server, ready } = game()
    const warded = castBolt(server, ready)
    expect(answer(server, warded, 'bogus').ok).toBe(false)
    expect(server.rules(warded, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: pendingOptionSelection(warded, 'p1')!.id,
      optionId: 'pay',
    }).ok).toBe(false)
    expect(server.rules(warded, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
  })

  test('your own warded permanents are not warded against you', () => {
    const { server, ready } = game()
    const ownWurm = Object.values(ready.objects).find((object) =>
      object.name === 'Warded Wurm' && object.controller === 'p1')!
    const state = castBolt(server, ready, ownWurm)
    expect(pendingOptionSelection(state, 'p1')).toBeUndefined()
    expect(state.stack).toHaveLength(1)
  })

  test('also guards activated abilities, countering them when unpaid', () => {
    const { server, ready } = game()
    const activate = () => ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'poker.poke',
      seat: 'p1',
      objectId: named(ready, 'Poker').id,
      targets: [{ kind: 'object', objectId: theirWurm(ready).id }],
    }))
    const warded = activate()
    expect(pendingOptionSelection(warded, 'p1')).toBeDefined()
    expect(warded.stack).toHaveLength(0)
    const declined = ok(answer(server, warded, 'decline'))
    expect(declined.stack).toHaveLength(0)

    const paid = ok(answer(server, activate(), 'pay'))
    expect(paid.players.p1.life).toBe(13)
    expect(paid.stack[0]).toMatchObject({ kind: 'ability', abilityId: 'poker.poke' })
  })
})

describe('catalog Sire of Seven Deaths ward', () => {
  const setup = () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: { p1: [cardTemplate('Fixture Bolt', { types: ['Instant'], manaCost: '{R}' })] },
      battlefield: {
        p2: [cardTemplate('Sire of Seven Deaths')],
      },
    }, { random: () => 0.5 })
    const state = structuredClone(server.state)
    state.players.p1.mana.R = 1
    state.priority = 'p1'
    return { server, state }
  }

  test('targeting Sire asks only the caster to pay seven life before the spell can resolve', () => {
    const { server, state } = setup()
    const bolt = named(state, 'Fixture Bolt')
    const sire = Object.values(state.objects).find(
      (object) => object.name === 'Sire of Seven Deaths' && object.controller === 'p2',
    )!
    expect(sire.controller).toBe('p2')
    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bolt.id,
      targets: [{ kind: 'object', objectId: sire.id }],
    }))
    const choice = pendingOptionSelection(cast, 'p1')!
    expect(cast.stack).toHaveLength(0)
    expect(choice).toMatchObject({
      source: 'Sire of Seven Deaths',
      options: [{ id: 'pay' }, { id: 'decline' }],
      action: { kind: 'ward-life', life: 7 },
    })
    expect(pendingOptionSelection(projectForViewer(cast, 'p1'), 'p1')?.id).toBe(choice.id)
    for (const viewer of ['p2', 'p3'] as const) {
      expect(pendingOptionSelection(projectForViewer(cast, viewer), 'p1')).toBeUndefined()
    }

    const event: GameEvent = {
      type: 'selectOption',
      seat: 'p1',
      selectionId: choice.id,
      optionId: 'pay',
    }
    const paid = ok(server.rules(cast, event))
    expect(paid.players.p1.life).toBe(33)
    expect(paid.stack[0]).toMatchObject({ kind: 'spell', objectId: bolt.id })
    expect(pendingOptionSelection(paid, 'p1')).toBeUndefined()
  })

  test('a journal restore retains Sire’s pending ward choice and accepts the replayed answer', () => {
    const { server, state } = setup()
    const bolt = named(state, 'Fixture Bolt')
    const sire = named(state, 'Sire of Seven Deaths')
    const castEvent: GameEvent = {
      type: 'castSpell',
      seat: 'p1',
      objectId: bolt.id,
      targets: [{ kind: 'object', objectId: sire.id }],
    }
    const warded = ok(server.rules(state, castEvent))
    const choice = pendingOptionSelection(warded, 'p1')!
    let journal = createJournal(state)
    journal = recordAccepted(journal, castEvent)
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingOptionSelection(restored, 'p1')).toEqual(choice)
    const paid = ok(server.rules(restored, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: choice.id,
      optionId: 'pay',
    }))
    expect(paid.players.p1.life).toBe(33)
    expect(paid.stack[0]).toMatchObject({ kind: 'spell', objectId: bolt.id })
    expect(pendingOptionSelection(paid, 'p1')).toBeUndefined()
  })
})

describe('relocated from sinFallFinishers.test.ts → wardLife.test.ts', () => {
  const creature = (name: string, manaCost = '{2}{G}', extra: Partial<CardTemplate> = {}) =>
    cardTemplate(name, { types: ['Creature'], manaCost, power: 2, toughness: 2, ...extra })


  const run = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    events: GameEvent[],
  ) => events.reduce((current, event) => ok(server.rules(current, event)), state)

  const named = (state: GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  const finisherPlugins = [
    onResolve,
    choiceEffects,
    librarySearch,
    castCosts,
    wardPlugin,
    exiledWith,
    pendingDialogLock,
  ]

  test('Valgavoth Ward sacrifices three nonlands or counters the spell', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Ward spell fixture', { types: ['Instant'], manaCost: '{R}' })] },
          battlefield: {
            p1: [
              creature('Sac 1', '{1}'),
              creature('Sac 2', '{1}'),
              creature('Sac 3', '{1}'),
            ],
            p2: [creature('Valgavoth, Terror Eater', '{6}{B}{B}')],
          },
        },
        { random: () => 0.5, cardPlugins: finisherPlugins },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana.R = 1
      ready.priority = 'p1'
      const bolt = named(ready, 'Ward spell fixture')
      const valgavoth = named(ready, 'Valgavoth, Terror Eater')

      const warded = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: bolt.id,
        targets: [{ kind: 'object', objectId: valgavoth.id }],
      }))
      expect(pendingSelectionFor(warded, 'p1')).toMatchObject({ kind: 'sacrifice', min: 3 })

      const paid = run(server, warded, [{
        type: 'selectCards',
        seat: 'p1',
        kind: 'sacrifice',
        count: 3,
        objectIds: [
          named(warded, 'Sac 1').id,
          named(warded, 'Sac 2').id,
          named(warded, 'Sac 3').id,
        ],
      }])

      expect(paid.stack.some((item) => item.objectId === bolt.id)).toBe(true)
      expect(named(paid, 'Sac 1').zone).toBe('exile')
    })

  test('Famished Worldsire Ward {3} can be paid with mana', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Ward spell fixture', { types: ['Instant'], manaCost: '{R}' })] },
          battlefield: { p2: [creature('Famished Worldsire', '{8}{G}', { power: 0, toughness: 0 })] },
        },
        { random: () => 0.5, cardPlugins: finisherPlugins },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 3 }
      ready.priority = 'p1'
      const bolt = named(ready, 'Ward spell fixture')
      const worldsire = named(ready, 'Famished Worldsire')

      const warded = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: bolt.id,
        targets: [{ kind: 'object', objectId: worldsire.id }],
      }))
      expect(pendingDialog(warded)?.kind).toBe('ward-pay')

      const paid = run(server, warded, [{
        type: 'custom',
        name: DIALOG_CHOSEN,
        seat: 'p1',
        payload: { accepted: true },
      }])

      expect(paid.players.p1.mana.C).toBe(0)
      expect(paid.stack.some((item) => item.objectId === bolt.id)).toBe(true)
    })

})

describe('relocated from cirdanEldrazi.test.ts → wardLife.test.ts', () => {
  const answer = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    optionId: string,
  ) => server.rules(state, {
    type: 'selectOption',
    seat: 'p1',
    selectionId: pendingOptionSelection(state, 'p1')!.id,
    optionId,
  })

  const boltEvent = (state: GameState, target = 'Sire of Seven Deaths'): GameEvent => ({
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, 'Ward spell fixture').id,
    targets: [{ kind: 'object', objectId: named(state, target).id }],
  })

  const poker = () => cardTemplate('Fixture Poker', {
    types: ['Creature'],
    effects: [ability({ id: 'poker.poke', targets: 'creature' }, {}, { kind: 'gainLife', count: 1 })],
  })

  const bolt = () => cardTemplate('Ward spell fixture', { types: ['Instant'], manaCost: '{R}' })

      const wardGame = (life = 40) => {
        const server = createServerGame(commanderRules, {
          hands: { p1: [bolt()] },
          battlefield: {
            p1: [poker(), deckCard('Sire of Seven Deaths', { name: 'Own Sire' })],
            p2: [deckCard('Sire of Seven Deaths')],
          },
        }, { random: () => 0.5, cardPlugins: [wardPlugin, activated] })
        const ready = structuredClone(server.state)
        ready.players.p1.life = life
        ready.players.p1.mana.R = 1
        ready.priority = 'p1'
        return { server, ready }
      }

      test('declining counters the spell and costs no life', () => {
        const { server, ready } = wardGame()
        const declined = ok(answer(server, ok(server.rules(ready, boltEvent(ready))), 'decline'))
        expect(declined.players.p1.life).toBe(40)
        expect(declined.stack).toHaveLength(0)
        expect(named(declined, 'Ward spell fixture').zone).not.toBe('stack')
        expect(declined.log.some((line) => line.includes('countered by Ward'))).toBe(true)
      })

      test('a caster at 6 life cannot pay seven and the spell is countered with no choice', () => {
        const { server, ready } = wardGame(6)
        const state = ok(server.rules(ready, boltEvent(ready)))
        expect(pendingOptionSelection(state, 'p1')).toBeUndefined()
        expect(state.stack).toHaveLength(0)
        expect(state.players.p1.life).toBe(6)
      })

      test('rejects other seats, unknown options, and moving on while the choice is open', () => {
        const { server, ready } = wardGame()
        const warded = ok(server.rules(ready, boltEvent(ready)))
        expect(answer(server, warded, 'bogus').ok).toBe(false)
        expect(server.rules(warded, {
          type: 'selectOption',
          seat: 'p2',
          selectionId: pendingOptionSelection(warded, 'p1')!.id,
          optionId: 'pay',
        }).ok).toBe(false)
        expect(server.rules(warded, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
      })

      test('its own controller is never warded against, and an activated ability is warded too', () => {
        const { server, ready } = wardGame()
        const own = ok(server.rules(ready, boltEvent(ready, 'Own Sire')))
        expect(pendingOptionSelection(own, 'p1')).toBeUndefined()
        expect(own.stack).toHaveLength(1)

        const poke: GameEvent = {
          type: 'activateAbility',
          abilityId: 'poker.poke',
          seat: 'p1',
          objectId: named(ready, 'Fixture Poker').id,
          targets: [{ kind: 'object', objectId: ready.zoneOrder.p2.battlefield[0] }],
        }
        const warded = ok(server.rules(ready, poke))
        expect(pendingOptionSelection(warded, 'p1')).toBeDefined()
        expect(warded.stack).toHaveLength(0)
        const paid = ok(answer(server, warded, 'pay'))
        expect(paid.players.p1.life).toBe(33)
        expect(paid.stack[0]).toMatchObject({ kind: 'ability', abilityId: 'poker.poke' })
      })
})
