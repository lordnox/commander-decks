import { describe, expect, test } from 'bun:test'
import { commanderRules } from './formats'
import { bears, bolt, forest } from './newGame'
import { RANDOM_STATE } from './plugins/hiddenInformation'
import { createClientGame, createServerGame } from './runtime'

describe('authoritative and replica runtimes', () => {
  test('server shuffles and draws from its complete library', () => {
    const server = createServerGame(
      commanderRules,
      { libraries: { p1: [forest(), bears(), bolt()] } },
      { random: () => 0 },
    )
    const before = [...server.state.zoneOrder.p1.library]
    const shuffled = server.rules(server.state, { type: 'shuffleLibrary', seat: 'p1' })
    expect(shuffled.ok).toBe(true)
    if (!shuffled.ok) return
    expect(shuffled.state.zoneOrder.p1.library).not.toEqual(before)

    const top = shuffled.state.zoneOrder.p1.library[0]
    const drawn = server.rules(shuffled.state, { type: 'draw', seat: 'p1' })
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    expect(drawn.state.objects[top].zone).toBe('hand')
    expect(drawn.state.zoneCounts.p1.library).toBe(2)
    expect(drawn.state.zoneCounts.p1.hand).toBe(1)
  })

  test('client sees only its hand and no library identities', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [bears()], p2: [bolt()] },
      hands: { p1: [forest()], p2: [bolt()] },
    })
    const p1View = server.project(server.state, 'p1')

    expect(Object.values(server.state.objects).map((object) => object.name)).toContain(
      'Grizzly Bears',
    )
    expect(Object.values(p1View.objects).map((object) => object.name)).toEqual(['Forest'])
    expect(p1View.zoneCounts.p1.library).toBe(1)
    expect(p1View.zoneCounts.p2.library).toBe(1)
    expect(p1View.zoneCounts.p2.hand).toBe(1)
    expect(p1View.zoneOrder.p1.library).toEqual([])
    expect(p1View.zoneOrder.p2.hand).toEqual([])
    expect(server.state.players.p1.data[RANDOM_STATE]).toBeNumber()
    expect(p1View.players.p1.data[RANDOM_STATE]).toBeUndefined()
  })

  test('redacted logs do not reveal drawn card names', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [bears()] },
    })
    const drawn = server.rules(server.state, { type: 'draw', seat: 'p1' })
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return

    const spectator = server.project(drawn.state, null)
    expect(spectator.log.at(-1)).toBe('p1 draws a card')
    expect(JSON.stringify(spectator)).not.toContain('Grizzly Bears')
  })

  test('a reveal names the card to every seat without unhiding the zone', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [bears()] },
    })
    const card = server.state.zoneOrder.p1.library[0]
    const revealed = server.rules(server.state, {
      type: 'reveal',
      seat: 'p1',
      objectIds: [card],
      source: 'Analyze the Pollen',
    })
    expect(revealed.ok).toBe(true)
    if (!revealed.ok) return

    for (const viewer of ['p1', 'p2', null] as const) {
      const view = server.project(revealed.state, viewer)
      expect(view.log.at(-1)).toBe('p1 reveals Grizzly Bears for Analyze the Pollen')
    }
    const opponent = server.project(revealed.state, 'p2')
    expect(opponent.objects[card]).toBeUndefined()
    expect(opponent.zoneOrder.p1.library).toEqual([])
    expect(opponent.players.p1.data.revealed_top).toEqual(['Grizzly Bears'])
  })

  test('a revealed library top stays public after it is drawn into hand', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [bears(), forest()] },
    })
    const card = server.state.zoneOrder.p1.library[0]
    const revealed = server.rules(server.state, {
      type: 'reveal',
      seat: 'p1',
      objectIds: [card],
    })
    expect(revealed.ok).toBe(true)
    if (!revealed.ok) return

    const drawn = server.rules(revealed.state, { type: 'draw', seat: 'p1' })
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return

    const opponent = server.project(drawn.state, 'p2')
    expect(opponent.objects[card]?.name).toBe('Grizzly Bears')
    expect(opponent.zoneOrder.p1.hand).toEqual([card])
    expect(opponent.zoneCounts.p1.hand).toBe(1)
    expect(opponent.players.p1.data.revealed_top).toBeUndefined()
  })

  test('knownTo on a library top exposes revealed_top without leaking order', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [forest(), bears(), bolt()] },
    })
    const top = server.state.zoneOrder.p1.library[0]
    server.state.objects[top].knownTo = server.state.playerOrder

    const view = server.project(server.state, 'p2')
    expect(view.players.p1.data.revealed_top).toEqual(['Forest'])
    expect(view.zoneOrder.p1.library).toEqual([])
    expect(Object.values(view.objects).some((object) => object.zone === 'library')).toBe(false)
  })

  test('a seat cannot reveal cards it does not own', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [bears()] },
    })
    const card = server.state.zoneOrder.p1.library[0]

    expect(server.rules(server.state, {
      type: 'reveal',
      seat: 'p2',
      objectIds: [card],
    })).toMatchObject({ ok: false })
    expect(server.rules(server.state, {
      type: 'reveal',
      seat: 'p1',
      objectIds: [],
    })).toMatchObject({ ok: false })
  })

  test('client waits on hidden actions and accepts a redacted server sync', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [bears(), forest()] },
    })
    const initialView = server.project(server.state, 'p1')
    const client = createClientGame(commanderRules, initialView)

    const localDraw = client.rules(client.state, { type: 'draw', seat: 'p1' })
    expect(localDraw.ok).toBe(true)
    if (!localDraw.ok) return
    expect(localDraw.state.zoneCounts.p1.library).toBe(2)
    expect(localDraw.state.zoneCounts.p1.hand).toBe(0)

    const serverDraw = server.rules(server.state, { type: 'draw', seat: 'p1' })
    expect(serverDraw.ok).toBe(true)
    if (!serverDraw.ok) return
    const nextView = server.project(serverDraw.state, 'p1')
    const synced = client.sync(client.state, nextView)
    expect(synced.ok).toBe(true)
    if (!synced.ok) return
    expect(synced.state.zoneCounts.p1.library).toBe(1)
    expect(synced.state.zoneCounts.p1.hand).toBe(1)
    expect(Object.values(synced.state.objects).map((object) => object.name)).toEqual([
      'Grizzly Bears',
    ])
  })

  test('different viewers receive different redacted projections', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [forest()], p2: [bolt()] },
    })
    const p1 = server.project(server.state, 'p1')
    const p2 = server.project(server.state, 'p2')
    const spectator = server.project(server.state, null)

    expect(Object.values(p1.objects).map((object) => object.name)).toEqual(['Forest'])
    expect(Object.values(p2.objects).map((object) => object.name)).toEqual([
      'Lightning Bolt',
    ])
    expect(Object.values(spectator.objects)).toEqual([])
  })

  test('client advances through draw while waiting for authoritative data', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [bears()] },
    })
    server.state.step = 'upkeep'
    const client = createClientGame(
      commanderRules,
      server.project(server.state, 'p1'),
    )

    const result = client.rules(client.state, { type: 'advanceStep' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.step).toBe('draw')
    expect(result.state.zoneCounts.p1.library).toBe(1)
    expect(result.state.zoneCounts.p1.hand).toBe(0)
  })

  test('client immediately redacts public objects moved into hidden zones', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p2: [bears()] },
    })
    const client = createClientGame(
      commanderRules,
      server.project(server.state, 'p1'),
    )
    const bear = Object.values(client.state.objects)[0]

    const result = client.rules(client.state, {
      type: 'move',
      objectId: bear.id,
      to: 'hand',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[bear.id]).toBeUndefined()
    expect(result.state.zoneOrder.p2.hand).toEqual([])
    expect(result.state.zoneCounts.p2.hand).toBe(1)
  })

  test('a client rejects a snapshot projected for another viewer', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [forest()], p2: [bolt()] },
    })
    const client = createClientGame(
      commanderRules,
      server.project(server.state, 'p1'),
    )
    const result = client.sync(
      client.state,
      server.project(server.state, 'p2'),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('another viewer')
  })

  test('client rejects snapshots that claim replica mode but leak cards', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [bears()] },
      hands: { p2: [bolt()] },
    })
    const leaked = structuredClone(server.state)
    leaked.knowledge = { mode: 'replica', viewer: 'p1' }

    expect(() => createClientGame(commanderRules, leaked)).toThrow('exposes')
  })

  test('sync ignores non-state fields rather than executing them', () => {
    const server = createServerGame(commanderRules)
    const view = server.project(server.state, 'p1')
    const client = createClientGame(commanderRules, view)
    const payload = structuredClone(view) as typeof view & {
      pending: Array<{ type: 'loseLife'; seat: string; amount: number }>
    }
    payload.pending = [{ type: 'loseLife', seat: 'p1', amount: 20 }]

    const result = client.sync(client.state, payload)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p1.life).toBe(40)
  })
})
