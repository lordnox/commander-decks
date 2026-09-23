import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok } from '../testHelpers'
import type { GameState, ManaPool } from '../types'
import { activated } from './activated'
import { becomeCopyOfTarget } from './becomeCopyOfTarget'
import { ability, becomeCopyOfTarget as becomeCopyInstruction } from './effectBuilders'
import { serializableEffects } from './effectRuntime'

const plugins = [activated, becomeCopyOfTarget]

const mana = (extra: Partial<ManaPool>): ManaPool => ({
  W: 0,
  U: 0,
  B: 0,
  R: 0,
  G: 0,
  C: 0,
  ...extra,
})

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const mirrorLandEffects = serializableEffects([
  ability(
    { id: 'fictional.mirror', sorcery: true },
    { tap: true, mana: '{2}' },
    becomeCopyInstruction({
      filter: { zone: 'battlefield', type: 'Land' },
      keepAbility: true,
    }),
  ),
])

const chameleonEffects = serializableEffects([
  ability(
    { id: 'fictional.chameleon', sorcery: true },
    { tap: true },
    becomeCopyInstruction({
      filter: { zone: 'battlefield', type: 'Creature' },
      keepAbility: true,
    }),
  ),
])

const fictionalMirror = () => cardTemplate('Fictional Mirror', {
  types: ['Land'],
  effects: mirrorLandEffects,
})

const fictionalChameleon = () => cardTemplate('Fictional Chameleon', {
  types: ['Creature'],
  power: 1,
  toughness: 1,
  effects: chameleonEffects,
})

const quarryLand = () => cardTemplate('Fictional Quarry', {
  types: ['Land'],
  tapProduces: { G: 1 },
})

const quarryBear = () => cardTemplate('Fictional Bear', {
  types: ['Creature'],
  power: 4,
  toughness: 4,
})

const activateAndResolve = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  sourceName: string,
) => {
  const source = named(state, sourceName)
  const activatedState = ok(server.rules(state, {
    type: 'activateAbility',
    seat: 'p1',
    objectId: source.id,
    abilityId: sourceName === 'Fictional Mirror' ? 'fictional.mirror' : 'fictional.chameleon',
  }))
  return ok(server.rules(activatedState, { type: 'resolveTop' }))
}

describe('becomeCopyOfTarget', () => {
  test('stamped land ability copies mana production and keeps the copy ability', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [fictionalMirror(), quarryLand()],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana = mana({ C: 2 })
    const mirror = named(ready, 'Fictional Mirror')
    const quarry = named(ready, 'Fictional Quarry')
    mirror.tapped = false

    const opened = activateAndResolve(server, ready, 'Fictional Mirror')
    const selection = pendingSelectionFor(opened, 'p1')
    expect(selection).toMatchObject({ kind: 'choose', count: 1 })
    expect(selection?.candidates).toEqual([quarry.id])

    const copied = ok(server.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [quarry.id],
    }))
    expect(copied.objects[mirror.id]).toMatchObject({
      name: 'Fictional Quarry',
      tapProduces: { G: 1 },
    })
    expect(copied.objects[mirror.id].effects?.some((effect) =>
      effect.op === 'activate' && effect.id === 'fictional.mirror')).toBe(true)

    copied.players.p1.mana = mana({ C: 2 })
    copied.objects[mirror.id].tapped = false
    const reactivated = ok(server.rules(copied, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: mirror.id,
      abilityId: 'fictional.mirror',
    }))
    const again = ok(server.rules(reactivated, { type: 'resolveTop' }))
    expect(pendingSelectionFor(again, 'p1')?.candidates).toContain(quarry.id)
  })

  test('stamped creature filter copies power and toughness', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [fictionalChameleon(), quarryBear()],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    const chameleon = named(ready, 'Fictional Chameleon')
    const bear = named(ready, 'Fictional Bear')

    const opened = activateAndResolve(server, ready, 'Fictional Chameleon')
    const finished = ok(server.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [bear.id],
    }))
    expect(finished.objects[chameleon.id]).toMatchObject({
      name: 'Fictional Bear',
      power: 4,
      toughness: 4,
    })
  })

  test('rejects targets outside the stamped filter', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [fictionalMirror(), quarryBear()],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana = mana({ C: 2 })
    const opened = activateAndResolve(server, ready, 'Fictional Mirror')
    const bear = named(opened, 'Fictional Bear')
    const illegal = server.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [bear.id],
    })
    expect(illegal.ok).toBe(false)
  })

  test('effects with becomeCopyOfTarget are clone-safe', () => {
    const cloned = structuredClone(mirrorLandEffects)
    expect(cloned[0].op).toBe('activate')
    expect((cloned[0] as { do: { kind: string }[] }).do[0].kind).toBe('becomeCopyOfTarget')
  })

  test('host restart preserves an open copy target selection', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [fictionalMirror(), quarryLand()],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana = mana({ C: 2 })
    const activateEvent = {
      type: 'activateAbility' as const,
      seat: 'p1' as const,
      objectId: named(ready, 'Fictional Mirror').id,
      abilityId: 'fictional.mirror',
    }
    const activated = ok(server.rules(ready, activateEvent))
    const resolved = ok(server.rules(activated, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(resolved, 'p1')!

    const p1View = projectForViewer(resolved, 'p1')
    expect(selection.candidates.every((id) => Boolean(p1View.objects[id]))).toBe(true)

    let journal = createJournal(ready)
    journal = recordAccepted(journal, activateEvent)
    journal = recordAccepted(journal, { type: 'resolveTop' })
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p1')?.id).toBe(selection.id)

    const quarry = named(restored, 'Fictional Quarry')
    const finished = ok(server.rules(restored, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [quarry.id],
    }))
    expect(finished.objects[selection.sourceId!].tapProduces).toEqual({ G: 1 })
  })
})
