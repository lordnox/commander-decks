import { describe, expect, test } from 'bun:test'
import { commanderRules } from './formats'
import { bears, bolt, forest } from './newGame'
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
