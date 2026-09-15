import { expect, test } from 'bun:test'
import { holdMessage, priorityModeMessage } from './liveMessages'

test('priority toggles use protocol fields rather than composer text', () => {
  expect(holdMessage('my-turn')).toEqual({
    type: 'hold',
    until: 'my-turn',
  })
  expect(priorityModeMessage(true)).toEqual({
    type: 'priority-mode',
    always: true,
  })
})
