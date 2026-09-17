import { describe, expect, test } from 'bun:test'
import { freezeDraft, makeDraft } from './draft'
import { bears, newGame } from './testGame'
import type { StackItem } from './types'

describe('StackItem and draft stack helpers', () => {
  test('action StackItem supports waiting state with stable id', () => {
    const action: StackItem = {
      id: 'stack99',
      kind: 'action',
      objectId: 'obj1',
      controller: 'p2',
      name: 'Discard',
      targets: [],
      actionId: 'discard',
      waiting: 'choice',
      payload: { seat: 'p2', count: 1 },
    }
    expect(action.waiting).toBe('choice')
    expect(action.actionId).toBe('discard')
    expect(action.payload).toEqual({ seat: 'p2', count: 1 })
  })

  test('addToStack allocates stack id and unshifts onto draft.stack', () => {
    const state = newGame()
    const draft = makeDraft(state)
    const existing: StackItem = {
      id: 'stack0',
      kind: 'spell',
      objectId: 'obj0',
      controller: 'p1',
      name: 'Lightning Bolt',
      targets: [],
    }
    draft.stack = [existing]

    const pushed = draft.addToStack({
      kind: 'action',
      objectId: 'obj1',
      controller: 'p2',
      name: 'Discard',
      targets: [],
      actionId: 'discard',
    })

    expect(pushed.id).toMatch(/^stack\d+$/)
    expect(draft.stack[0]).toBe(pushed)
    expect(draft.stack[1]).toBe(existing)
  })

  test('addToStack preserves an existing id', () => {
    const draft = makeDraft(newGame())
    const pushed = draft.addToStack({
      id: 'stack-fixed',
      kind: 'spell',
      objectId: 'obj1',
      controller: 'p1',
      name: 'Bolt',
      targets: [],
    })
    expect(pushed.id).toBe('stack-fixed')
    expect(draft.stack[0].id).toBe('stack-fixed')
  })

  test('addTriggeredAbility pushes ability with instructions in payload', () => {
    const state = newGame({ hands: { p1: [bears()] } })
    const source = Object.values(state.objects).find((o) => o.name === 'Grizzly Bears')!
    const draft = makeDraft(state)
    const instructions = [{ kind: 'draw', count: 1 }]

    const item = draft.addTriggeredAbility(source, instructions, { abilityId: 'draw-trigger' })

    expect(item.kind).toBe('ability')
    expect(item.objectId).toBe(source.id)
    expect(item.controller).toBe(source.controller)
    expect(item.name).toBe(source.name)
    expect(item.targets).toEqual([])
    expect(item.abilityId).toBe('draw-trigger')
    expect(item.payload).toEqual({ instructions })
    expect(draft.stack[0]).toBe(item)
  })

  test('freezeDraft strips draft-only methods', () => {
    const draft = makeDraft(newGame())
    const frozen = freezeDraft(draft)

    expect('addToStack' in frozen).toBe(false)
    expect('addTriggeredAbility' in frozen).toBe(false)
    expect('enqueue' in frozen).toBe(false)
    expect('pending' in frozen).toBe(false)
    expect('allocId' in frozen).toBe(false)
  })
})
