import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok } from '../testHelpers'
import type { GameState, ManaPool } from '../types'

const spell = (name: string, manaCost: string) =>
  cardTemplate(name, { types: ['Instant'], manaCost })

const creature = (name: string, controllerPower = 2) =>
  cardTemplate(name, {
    types: ['Creature'],
    power: controllerPower,
    toughness: controllerPower,
  })

const basic = (name: string, subtype: string) =>
  cardTemplate(name, {
    types: ['Land'],
    supertypes: ['Basic'],
    subtypes: [subtype],
  })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const mana = (extra: Partial<ManaPool>): ManaPool => ({
  W: 0,
  U: 0,
  B: 0,
  R: 0,
  G: 0,
  C: 0,
  ...extra,
})

describe('Lady Evangela advanced combat prevention cards', () => {
  test('Settle exiles attackers and resumes a private typed basic-land search after restart', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell('Settle the Wreckage', '{2}{W}{W}')] },
        battlefield: {
          p2: [creature('Attacker One'), creature('Attacker Two')],
        },
        libraries: {
          p2: [
            basic('Plains', 'Plains'),
            basic('Island', 'Island'),
            cardTemplate('Guildgate', { types: ['Land'] }),
          ],
        },
      },
      { random: () => 0.5 },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = mana({ W: 2, C: 2 })
    for (const attacker of ready.zoneOrder.p2.battlefield) {
      ready.objects[attacker].attacking = { kind: 'player', player: 'p1' }
    }
    named(ready, 'Attacker Two').tags = ['commander']
    const noTarget = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Settle the Wreckage').id,
    })
    expect(noTarget.ok).toBe(false)

    const castEvent = {
      type: 'castSpell' as const,
      seat: 'p1',
      objectId: named(ready, 'Settle the Wreckage').id,
      targets: [{ kind: 'player' as const, player: 'p2' }],
    }
    const cast = ok(server.rules(ready, castEvent))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(named(resolved, 'Attacker One').zone).toBe('exile')
    expect(named(resolved, 'Attacker Two').zone).toBe('command')
    const selection = pendingSelectionFor(resolved, 'p2')!
    expect(selection.candidates).toHaveLength(2)
    expect(selection.count).toBe(1)

    const p2View = projectForViewer(resolved, 'p2')
    const p1View = projectForViewer(resolved, 'p1')
    expect(selection.candidates.every((id) => Boolean(p2View.objects[id]))).toBe(true)
    expect(selection.candidates.every((id) => !p1View.objects[id])).toBe(true)

    let journal = createJournal(ready)
    journal = recordAccepted(journal, castEvent)
    journal = recordAccepted(journal, { type: 'resolveTop' })
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p2')?.id).toBe(selection.id)

    const illegal = server.rules(restored, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: selection.count,
      objectIds: [named(restored, 'Guildgate').id],
    })
    expect(illegal.ok).toBe(false)
    const chosen = selection.candidates[0]
    const finished = ok(server.rules(restored, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: selection.count,
      objectIds: [chosen],
    }))
    expect(finished.objects[chosen].zone).toBe('battlefield')
    expect(finished.objects[chosen].tapped).toBe(true)
    expect(pendingSelectionFor(finished, 'p2')).toBeUndefined()
  })
})
