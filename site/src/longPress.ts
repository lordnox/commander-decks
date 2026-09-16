import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

export const LONG_PRESS_MS = 450
/** Finger travel that means the player is scrolling the board, not holding a card. */
export const LONG_PRESS_SLOP = 10

type Timers = {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * A press that is held past the delay without wandering. The gesture remembers
 * that it fired so the click a touch device sends afterwards can be swallowed,
 * otherwise holding a card would also open its preview on release.
 */
export const createLongPress = (
  onLongPress: () => void,
  options: { timers?: Timers; delayMs?: number; slopPx?: number } = {},
) => {
  const timers = options.timers ?? realTimers
  const delayMs = options.delayMs ?? LONG_PRESS_MS
  const slopPx = options.slopPx ?? LONG_PRESS_SLOP

  let handle: unknown = null
  let origin: { x: number; y: number } | null = null
  let fired = false

  const cancel = () => {
    if (handle !== null) timers.clear(handle)
    handle = null
    origin = null
  }

  return {
    start: (x: number, y: number) => {
      cancel()
      fired = false
      origin = { x, y }
      handle = timers.set(() => {
        handle = null
        fired = true
        onLongPress()
      }, delayMs)
    },
    move: (x: number, y: number) => {
      if (!origin) return
      if (Math.abs(x - origin.x) > slopPx || Math.abs(y - origin.y) > slopPx) cancel()
    },
    cancel,
    consumedClick: () => fired,
  }
}

export const useLongPress = (onLongPress?: () => void) => {
  const latest = useRef(onLongPress)
  latest.current = onLongPress

  const gesture = useRef<ReturnType<typeof createLongPress> | null>(null)
  if (!gesture.current) gesture.current = createLongPress(() => latest.current?.())
  const press = gesture.current

  useEffect(() => press.cancel, [press])

  if (!onLongPress) {
    return { longPressProps: {}, consumedClick: () => false }
  }

  return {
    longPressProps: {
      onPointerDown: (event: PointerEvent<HTMLElement>) =>
        press.start(event.clientX, event.clientY),
      onPointerMove: (event: PointerEvent<HTMLElement>) =>
        press.move(event.clientX, event.clientY),
      onPointerUp: () => press.cancel(),
      onPointerLeave: () => press.cancel(),
      onPointerCancel: () => press.cancel(),
      // Touch platforms raise the callout menu from the same gesture.
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (press.consumedClick()) event.preventDefault()
      },
    },
    consumedClick: press.consumedClick,
  }
}
