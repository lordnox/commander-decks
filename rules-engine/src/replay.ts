import { commanderRules } from './formats'
import type { CardTemplate } from './newGame'
import { createServerGame } from './runtime'
import type { GameEvent, GameObject, GameState, PlayerId, StepId } from './types'

type ReplayCard = {
  type_line: string
  mana_cost: string
  oracle_text: string
  stats: string
}

type ReplayBattlefieldCard = {
  name: string
  tapped?: boolean
  commander?: boolean
}

type ReplayPlayerState = {
  life: number
  poison: number
  library_count: number
  hand: string[]
  battlefield: ReplayBattlefieldCard[]
  graveyard: string[]
  exile: string[]
  command: string[]
}

type ReplayState = {
  active: PlayerId
  turn: number
  phase: string
  stack: { name: string }[]
  players: Record<PlayerId, ReplayPlayerState>
}

type ReplayEvent = {
  id: number
  turn: number
  phase: string
  seat: PlayerId | null
  kind: string
  summary: string
  state: ReplayState
}

export type TableReplay = {
  starting_life: number
  seats: { id: PlayerId }[]
  catalog: Record<string, ReplayCard>
  events: ReplayEvent[]
}

const CARD_TYPES = [
  'Artifact',
  'Battle',
  'Creature',
  'Enchantment',
  'Instant',
  'Land',
  'Planeswalker',
  'Sorcery',
]

const countNames = (names: string[]) => {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return counts
}

const addedNames = (before: string[], after: string[]) => {
  const remaining = countNames(before)
  return after.filter((name) => {
    const count = remaining.get(name) ?? 0
    if (count === 0) return true
    remaining.set(name, count - 1)
    return false
  })
}

const cardTemplate = (name: string, card?: ReplayCard): CardTemplate => {
  const typeLine = card?.type_line ?? ''
  const types = CARD_TYPES.filter((type) =>
    typeLine.split(' // ').some((face) => face.split(' — ')[0].split(' ').includes(type)),
  )
  const supertypes = typeLine.includes('Legendary') ? ['Legendary'] : []
  const subtypes = typeLine
    .split(' // ')
    .flatMap((face) => face.split(' — ')[1]?.split(' ') ?? [])
  const stats = card?.stats.match(/^(-?\d+)\/(-?\d+)$/)
  const add = card?.oracle_text.match(/Add \{([WUBRGC])\}/)
  const tapProduces = add ? { [add[1]]: 1 } : undefined

  return {
    name,
    types,
    subtypes,
    supertypes,
    manaCost: card?.mana_cost ?? '',
    power: stats ? Number(stats[1]) : null,
    toughness: stats ? Number(stats[2]) : null,
    oracleText: card?.oracle_text ?? '',
    attachedTo: null,
    attacking: null,
    blocking: null,
    grantedRules: [],
    token: false,
    tags: [],
    tapped: false,
    summoningSickness: false,
    damageMarked: 0,
    counters: {},
    ...(tapProduces ? { tapProduces } : {}),
  }
}

const nameInZone = (state: GameState, seat: PlayerId, zone: GameObject['zone'], name: string) =>
  state.zoneOrder[seat][zone]
    .map((id) => state.objects[id])
    .find((object) => object.name === name)

const battlefieldNames = (player: ReplayPlayerState) =>
  player.battlefield.map((object) => object.name)

const drawnName = (events: ReplayEvent[], event: ReplayEvent) => {
  const previous = events[event.id - 1]
  if (!event.seat || !previous) return undefined
  return addedNames(
    previous.state.players[event.seat].hand,
    event.state.players[event.seat].hand,
  )[0]
}

const bootstrapReplay = (replay: TableReplay, throughRound: number) => {
  const setup = replay.events.filter((event) => event.turn === 0).at(-1)
  if (!setup) throw new Error('replay has no setup snapshot')
  const players = replay.seats.map((seat) => seat.id)
  const draws = Object.fromEntries(players.map((seat) => [seat, [] as string[]]))
  for (const event of replay.events) {
    if (event.turn > throughRound) break
    if (event.kind !== 'draw' || !event.seat) continue
    const name = drawnName(replay.events, event)
    if (!name) throw new Error(`cannot identify draw at replay event ${event.id}`)
    draws[event.seat].push(name)
  }

  const templates = (names: string[]) =>
    names.map((name) => cardTemplate(name, replay.catalog[name]))
  const libraries = Object.fromEntries(players.map((seat) => {
    const known = draws[seat]
    const hidden = setup.state.players[seat].library_count - known.length
    const placeholders = Array.from(
      { length: hidden },
      (_, index) => cardTemplate(`Hidden ${seat} ${index + 1}`),
    )
    return [seat, [...templates(known), ...placeholders]]
  }))
  const hands = Object.fromEntries(players.map((seat) => [
    seat,
    templates(setup.state.players[seat].hand),
  ]))
  const command = Object.fromEntries(players.map((seat) => [
    seat,
    templates(setup.state.players[seat].command),
  ]))
  const runtime = createServerGame(
    commanderRules,
    { players, libraries, hands, command },
    { random: () => 0.5 },
  )
  return {
    ...runtime,
    state: { ...runtime.state, step: 'untap' as StepId },
  }
}

export const runReplayRounds = (replay: TableReplay, throughRound: number) => {
  const runtime = bootstrapReplay(replay, throughRound)
  let state = runtime.state
  const events: GameEvent[] = []

  const dispatch = (event: GameEvent) => {
    const result = runtime.rules(state, event)
    if (!result.ok) throw new Error(`${event.type}: ${result.error}`)
    state = result.state
    events.push(event)
  }
  const advance = () => dispatch({ type: 'advanceStep' })
  const advanceToMain = () => {
    let guard = 0
    while (state.step !== 'precombatMain' && guard < 16) {
      advance()
      guard += 1
    }
    if (state.step !== 'precombatMain') throw new Error('could not reach precombat main')
  }
  const advanceToUntap = (seat: PlayerId) => {
    let guard = 0
    while ((state.active !== seat || state.step !== 'untap') && guard < 20) {
      advance()
      guard += 1
    }
    if (state.active !== seat || state.step !== 'untap') {
      throw new Error(`could not reach ${seat}'s untap`)
    }
  }

  for (const replayEvent of replay.events) {
    if (replayEvent.turn === 0) continue
    if (replayEvent.turn > throughRound) break
    const seat = replayEvent.seat
    if (!seat) continue
    const previous = replay.events[replayEvent.id - 1]

    if (replayEvent.phase === 'untap') {
      advanceToUntap(seat)
      continue
    }
    if (replayEvent.kind === 'draw') {
      if (replayEvent.phase === 'draw') {
        if (state.step !== 'untap') throw new Error(`draw ${replayEvent.id} is outside untap`)
        advance()
        advance()
      } else {
        dispatch({ type: 'draw', seat })
      }
      continue
    }
    if (replayEvent.kind === 'play_land') {
      advanceToMain()
      const name = addedNames(
        battlefieldNames(previous.state.players[seat]),
        battlefieldNames(replayEvent.state.players[seat]),
      )[0]
      const land = nameInZone(state, seat, 'hand', name)
      if (!land) throw new Error(`cannot find ${name} in ${seat}'s hand`)
      dispatch({ type: 'playLand', seat, objectId: land.id })
      const expected = replayEvent.state.players[seat].battlefield.find(
        (object) => object.name === name,
      )
      if (expected?.tapped && !state.objects[land.id].tapped) {
        dispatch({ type: 'tap', objectId: land.id })
      }
      continue
    }
    if (replayEvent.kind === 'cast') {
      advanceToMain()
      const expected = replayEvent.state.players[seat]
      const tappedByName = countNames(
        expected.battlefield.filter((object) => object.tapped).map((object) => object.name),
      )
      for (const object of Object.values(state.objects)) {
        if (object.controller !== seat || object.zone !== 'battlefield' || object.tapped) continue
        const needed = tappedByName.get(object.name) ?? 0
        const alreadyTapped = Object.values(state.objects).filter(
          (candidate) =>
            candidate.controller === seat
            && candidate.zone === 'battlefield'
            && candidate.name === object.name
            && candidate.tapped,
        ).length
        if (alreadyTapped < needed && object.tapProduces) {
          dispatch({ type: 'tapForMana', seat, objectId: object.id })
        }
      }
      const name = addedNames(
        battlefieldNames(previous.state.players[seat]),
        battlefieldNames(expected),
      )[0]
      const spell =
        nameInZone(state, seat, 'hand', name)
        ?? nameInZone(state, seat, 'command', name)
      if (!spell) throw new Error(`cannot find ${name} for replay event ${replayEvent.id}`)
      dispatch({ type: 'castSpell', seat, objectId: spell.id })
      dispatch({ type: 'resolveTop' })

      const discarded = addedNames(
        previous.state.players[seat].graveyard,
        expected.graveyard,
      )
      for (const discardedName of discarded) {
        const object = nameInZone(state, seat, 'hand', discardedName)
        if (object) dispatch({ type: 'move', objectId: object.id, to: 'graveyard' })
      }
    }
  }

  return { state, events }
}

const replayPhase = (step: StepId) => {
  if (step === 'precombatMain') return 'main1'
  if (step === 'postcombatMain') return 'main2'
  return step
}

export const replayComparableState = (state: GameState) => ({
  active: state.active,
  turn: Math.floor((state.turn - 1) / state.playerOrder.length) + 1,
  phase: replayPhase(state.step),
  stack: state.stack.map((item) => ({ name: item.name })),
  players: Object.fromEntries(state.playerOrder.map((seat) => {
    const player = state.players[seat]
    const names = (zone: GameObject['zone']) =>
      state.zoneOrder[seat][zone].map((id) => state.objects[id].name)
    return [seat, {
      life: player.life,
      poison: player.poison,
      library_count: state.zoneCounts[seat].library,
      hand: names('hand'),
      battlefield: state.zoneOrder[seat].battlefield.map((id) => {
        const object = state.objects[id]
        return {
          name: object.name,
          tapped: object.tapped,
          ...(object.tags.includes('commander') ? { commander: true } : {}),
        }
      }),
      graveyard: names('graveyard'),
      exile: names('exile'),
      command: names('command'),
    }]
  })),
})

export const replayExpectedState = (replay: TableReplay, throughRound: number) => {
  const event = replay.events.filter((candidate) => candidate.turn <= throughRound).at(-1)
  if (!event) throw new Error(`replay has no events through turn ${throughRound}`)
  return {
    active: event.state.active,
    turn: event.state.turn,
    phase: event.state.phase,
    stack: event.state.stack.map((item) => ({ name: item.name })),
    players: Object.fromEntries(Object.entries(event.state.players).map(([seat, player]) => [
      seat,
      {
        life: player.life,
        poison: player.poison,
        library_count: player.library_count,
        hand: player.hand,
        battlefield: player.battlefield.map((object) => ({
          name: object.name,
          tapped: object.tapped ?? false,
          ...(object.commander ? { commander: true } : {}),
        })),
        graveyard: player.graveyard,
        exile: player.exile,
        command: player.command,
      },
    ])),
  }
}
