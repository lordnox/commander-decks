import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { cardTemplate, newGame } from '../newGame'
import { DIALOG_CHOSEN, dialogCandidates, pendingDialog, pendingDialogLock } from '../pendingDialog'
import type { GameState, ReduceResult } from '../types'
import { mana } from '../plugins/mana'
import { lands } from '../plugins/lands'
import { PIT_LINK_EXILED, pitOfOfferings } from './pit-of-offerings'

const catalog = createCatalog([lands, mana, pendingDialogLock, pitOfOfferings])

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const setup = () => {
  const pit = cardTemplate('Pit of Offerings', {
    types: ['Land'],
    oracleText: 'This land enters tapped.\n'
      + 'When this land enters, exile up to three target cards from graveyards.\n'
      + '{T}: Add {C}.\n'
      + "{T}: Add one mana of any of the exiled cards' colors.",
  })
  const state = newGame(commanderRules, {
    builtinRules: ['lands', 'mana', 'pendingDialog', 'pit-of-offerings'],
    hands: {
      p1: [pit],
      p2: [
        cardTemplate('Blue Card', { colors: ['U'] }),
        cardTemplate('Black Card', { colors: ['B'] }),
      ],
    },
  })
  for (const name of ['Blue Card', 'Black Card']) {
    const card = named(state, name)
    state.zoneOrder.p2.hand = state.zoneOrder.p2.hand.filter((id) => id !== card.id)
    state.zoneOrder.p2.graveyard.push(card.id)
    card.zone = 'graveyard'
  }
  return state
}

describe('Pit of Offerings', () => {
  test('tracks exactly which graveyard cards it exiled and produces their colors', () => {
    const state = setup()
    const pitId = named(state, 'Pit of Offerings').id
    const entered = ok(rules(state, { type: 'playLand', seat: 'p1', objectId: pitId }, catalog))
    const dialog = pendingDialog(entered)!

    expect(dialog.kind).toBe('exile-graveyards')
    expect(dialogCandidates(entered, dialog).map((card) => card.name)).toEqual([
      'Blue Card',
      'Black Card',
    ])

    const blueId = named(entered, 'Blue Card').id
    const targeted = ok(rules(entered, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { objectIds: [blueId] },
    }, catalog))

    expect(targeted.stack[0]).toMatchObject({
      name: 'Pit of Offerings — Exile graveyard cards',
      targets: [{ kind: 'object', objectId: blueId }],
    })
    expect(targeted.objects[blueId].zone).toBe('graveyard')
    expect(pendingDialog(targeted)).toBeUndefined()

    const chosen = ok(rules(targeted, { type: 'resolveTop' }, catalog))
    expect(chosen.objects[pitId].exiledCards).toEqual([blueId])
    expect(chosen.objects[blueId]).toMatchObject({ zone: 'exile', exiledWith: pitId })

    chosen.objects[pitId].tapped = false
    const blue = ok(rules(chosen, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: pitId,
      mana: 'U',
    }, catalog))
    expect(blue.players.p1.mana.U).toBe(1)

    chosen.objects[pitId].tapped = false
    const black = rules(chosen, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: pitId,
      mana: 'B',
    }, catalog)
    expect(black.ok).toBe(false)
  })

  test('adopts cards a game imported from a replay already has in exile', () => {
    const state = setup()
    const pitId = named(state, 'Pit of Offerings').id
    const blueId = named(state, 'Blue Card').id
    const pit = state.objects[pitId]
    pit.zone = 'battlefield'
    state.zoneOrder.p1.hand = []
    state.zoneOrder.p1.battlefield = [pitId]
    const blue = state.objects[blueId]
    blue.zone = 'exile'
    state.zoneOrder.p2.graveyard = state.zoneOrder.p2.graveyard.filter((id) => id !== blueId)
    state.zoneOrder.p2.exile = [blueId]

    const linked = ok(rules(state, {
      type: 'custom',
      name: PIT_LINK_EXILED,
      seat: 'p1',
      payload: { sourceId: pitId, objectIds: [blueId] },
    }, catalog))

    // The trigger is history; adopting the cards must not ask for new targets.
    expect(pendingDialog(linked)).toBeUndefined()
    expect(linked.objects[pitId].exiledCards).toEqual([blueId])
    expect(ok(rules(linked, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: pitId,
      mana: 'U',
    }, catalog)).players.p1.mana.U).toBe(1)
  })
})
