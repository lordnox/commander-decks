import { describe, expect, test } from 'bun:test'
import { createLongPress } from './longPress'

const fakeTimers = () => {
  let pending: (() => void) | null = null
  return {
    timers: {
      set: (fn: () => void) => {
        pending = fn
        return 1
      },
      clear: () => {
        pending = null
      },
    },
    elapse: () => {
      const fn = pending
      pending = null
      fn?.()
    },
  }
}

describe('long press', () => {
  test('a held card reports the name and swallows the click that follows', () => {
    const names: string[] = []
    const { timers, elapse } = fakeTimers()
    const press = createLongPress(() => names.push('Homer, the Hermit'), { timers })

    press.start(10, 10)
    expect(press.consumedClick()).toBe(false)

    elapse()
    expect(names).toEqual(['Homer, the Hermit'])
    // The release still fires a click, which must not also open the preview.
    press.cancel()
    expect(press.consumedClick()).toBe(true)
  })

  test('a quick tap is left alone for the preview', () => {
    let fired = 0
    const { timers, elapse } = fakeTimers()
    const press = createLongPress(() => { fired += 1 }, { timers })

    press.start(10, 10)
    press.cancel()
    elapse()

    expect(fired).toBe(0)
    expect(press.consumedClick()).toBe(false)
  })

  test('scrolling the board past the slop cancels the hold', () => {
    let fired = 0
    const { timers, elapse } = fakeTimers()
    const press = createLongPress(() => { fired += 1 }, { timers, slopPx: 10 })

    press.start(10, 10)
    press.move(14, 16)
    elapse()
    expect(fired).toBe(1)

    press.start(10, 10)
    press.move(10, 40)
    elapse()
    expect(fired).toBe(1)
    expect(press.consumedClick()).toBe(false)
  })

  test('a new press clears the previous verdict', () => {
    const { timers, elapse } = fakeTimers()
    const press = createLongPress(() => {}, { timers })

    press.start(0, 0)
    elapse()
    expect(press.consumedClick()).toBe(true)

    press.start(0, 0)
    expect(press.consumedClick()).toBe(false)
  })
})
