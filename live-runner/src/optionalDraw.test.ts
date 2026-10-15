import { expect, test } from 'bun:test'
import { OPTIONAL_DRAW_MODE, OPTIONAL_DRAW_MODE_MESSAGE } from '../../shared/optionalDraw'
import { createJournal, recordAccepted, restoreJournal } from '../../rules-engine/src/journal'
import { commanderRules } from '../../rules-engine/src/formats'
import { cardTemplate } from '../../rules-engine/src/newGame'
import { createServerGame } from '../../rules-engine/src/runtime'
import { ok, resolveStack } from '../../rules-engine/src/testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, draw, enters, may, whenever } from '../../rules-engine/src/cardPlugins/dsl/v1'
import { applyHostControl, restoreKernelWindow } from './host'
import { applyKernelChoice } from './kernelChoiceApply'
import type { KernelHandle } from './kernelHandle'
import { createLobby, restoreLobby } from './lobby'
import { prepareKernelPendingChoice } from './kernelChoicePrepare'
import { settleKernelPriority } from './kernelSettle'
import { liveSnapshotFromState } from './kernelView'
import { parseInbox } from './protocol'
import { compactLiveWire, expandLiveWire } from '../../site/src/liveCompact'

const handleFor = (rules: KernelHandle['rules'], initial: Parameters<KernelHandle['rules']>[0]) => {
  let journal = createJournal(initial)
  const history = restoreJournal(journal, rules)
  return {
    get journal() { return journal }, history, rules,
    dispatch: (event: Parameters<KernelHandle['dispatch']>[0]) => {
      const result = history.dispatch(event)
      if (result.ok) journal = recordAccepted(journal, event)
      return result
    },
    save: () => {},
  }
}

const setup = () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(enters({ filter: { type: 'Land', controller: 'you' } }), { instructions: [may(draw(1))] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Land', { types: ['Land'] }), cardTemplate('Second land', { types: ['Land'] })] },
    battlefield: { p1: [cardTemplate('Observer', { types: ['Creature'], ruleDefinition: definition })] },
    libraries: { p1: [cardTemplate('First'), cardTemplate('Second')] },
  }, { random: () => 0 })
  const played = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
  const kernel = handleFor(server.rules, resolveStack(server.rules, played))
  const lobby = createLobby()
  lobby.phase = 'play'
  prepareKernelPendingChoice(kernel, lobby)
  return { kernel, lobby }
}

for (const mode of Object.values(OPTIONAL_DRAW_MODE)) {
  test(`optional draw preference ${mode} survives restore and applies through the normal choice ledger`, () => {
    const { kernel, lobby } = setup()
    const decision = lobby.topdeck!
    const offer = decision.optionalDraw!
    expect(offer).toBeDefined()
    // Another seat cannot configure the chooser's offer.
    applyHostControl(lobby, 'p2', { type: OPTIONAL_DRAW_MODE_MESSAGE, key: offer.key, mode })
    expect(lobby.optionalDrawPreferences?.p2).toBeUndefined()
    applyHostControl(lobby, 'p1', { type: OPTIONAL_DRAW_MODE_MESSAGE, key: offer.key, mode })
    const restoredLobby = restoreLobby(JSON.parse(JSON.stringify(lobby)))
    const restored = handleFor(kernel.rules, restoreJournal(kernel.journal, kernel.rules).current())
    restoreKernelWindow(restored, restoredLobby)
    if (mode === OPTIONAL_DRAW_MODE.ASK) {
      expect(restoredLobby.topdeck?.requestId).toBe(decision.requestId)
      expect(restored.history.current().zoneOrder.p1.library).toHaveLength(2)
    } else {
      expect(restoredLobby.topdeck).toBeUndefined()
      expect(restored.history.current().zoneOrder.p1.library).toHaveLength(mode === OPTIONAL_DRAW_MODE.ACCEPT ? 1 : 2)
      expect(restoredLobby.completedInteractions?.[decision.requestId!]).toBeDefined()
      const chosenSlot = mode === OPTIONAL_DRAW_MODE.ACCEPT ? offer.acceptSlot : offer.declineSlot
      const duplicate = {
        type: 'topdeck' as const, requestId: decision.requestId, revision: decision.revision,
        choices: decision.cards.map((card, slot) => ({ card, slot, destination: slot === chosenSlot ? 'target' as const : 'skip' as const })),
      }
      const before = restored.journal.events.length
      expect(applyKernelChoice(restored, restoredLobby, 'p1', duplicate)).toBe(true)
      expect(restored.journal.events).toHaveLength(before)
      // Settings remain editable after the automatic answer closes the dialog.
      applyHostControl(restoredLobby, 'p1', { type: OPTIONAL_DRAW_MODE_MESSAGE, key: offer.key, mode: OPTIONAL_DRAW_MODE.ASK })
      expect(restoredLobby.optionalDrawPreferences?.p1?.[offer.key]?.mode).toBe(OPTIONAL_DRAW_MODE.ASK)
    }
  })
}

test('preferences are scoped by source ability and only appear in the owning seat wire snapshot', () => {
  const { kernel, lobby } = setup()
  const offer = lobby.topdeck!.optionalDraw!
  // A preference for a different source cannot answer this one.
  lobby.optionalDrawPreferences = { p1: { other: { label: 'Other ability', mode: OPTIONAL_DRAW_MODE.ACCEPT } } }
  settleKernelPriority(kernel, lobby)
  expect(lobby.topdeck?.optionalDraw?.key).toBe(offer.key)
  const snapshot = liveSnapshotFromState({ state: kernel.history.current(), lobby, viewer: 'p1' })
  const decoded = expandLiveWire(compactLiveWire(snapshot))
  expect(decoded.topdeck?.optionalDraw).toEqual(offer)
  expect(decoded.optionalDrawPreferences).toEqual(lobby.optionalDrawPreferences.p1)
  for (const viewer of ['p2', null] as const) {
    const privateView = liveSnapshotFromState({ state: kernel.history.current(), lobby, viewer })
    expect(privateView.optionalDrawPreferences).toBeUndefined()
    expect(privateView.topdeck).toBeUndefined()
  }
})

test('optional draw controls reject invalid modes and unbounded keys', () => {
  expect(parseInbox(JSON.stringify({ type: OPTIONAL_DRAW_MODE_MESSAGE, key: 'ability', mode: OPTIONAL_DRAW_MODE.DECLINE })))
    .toEqual({ type: OPTIONAL_DRAW_MODE_MESSAGE, key: 'ability', mode: OPTIONAL_DRAW_MODE.DECLINE })
  for (const message of [
    { key: 'ability', mode: 'sometimes' }, { key: '', mode: OPTIONAL_DRAW_MODE.ASK },
    { key: 'x'.repeat(1025), mode: OPTIONAL_DRAW_MODE.ASK },
  ]) expect(parseInbox(JSON.stringify({ type: OPTIONAL_DRAW_MODE_MESSAGE, ...message }))).toBeNull()
})

test('repeated triggers reuse a preference, while a source returning to the battlefield asks again', () => {
  const { kernel, lobby } = setup()
  const offer = lobby.topdeck!.optionalDraw!
  applyHostControl(lobby, 'p1', { type: OPTIONAL_DRAW_MODE_MESSAGE, key: offer.key, mode: OPTIONAL_DRAW_MODE.DECLINE })
  settleKernelPriority(kernel, lobby)
  const current = kernel.history.current()
  const nextLand = Object.values(current.objects).find((object) => object.name === 'Second land')!
  expect(kernel.dispatch({ type: 'move', objectId: nextLand.id, to: 'battlefield' }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
  prepareKernelPendingChoice(kernel, lobby)
  expect(lobby.topdeck?.optionalDraw?.key).toBe(offer.key)
  settleKernelPriority(kernel, lobby)
  expect(lobby.topdeck).toBeUndefined()
  expect(kernel.history.current().zoneOrder.p1.library).toHaveLength(2)
  const observer = Object.values(current.objects).find((object) => object.name === 'Observer')!
  expect(kernel.dispatch({ type: 'move', objectId: observer.id, to: 'graveyard' }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'move', objectId: observer.id, to: 'battlefield' }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'move', objectId: nextLand.id, to: 'hand' }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'move', objectId: nextLand.id, to: 'battlefield' }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
  prepareKernelPendingChoice(kernel, lobby)
  expect(lobby.topdeck?.optionalDraw?.key).not.toBe(offer.key)
  settleKernelPriority(kernel, lobby)
  expect(lobby.topdeck?.optionalDraw).toBeDefined()
})
