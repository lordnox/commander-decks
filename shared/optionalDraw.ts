/** Player-controlled automation for standalone optional draws. */
export const OPTIONAL_DRAW_MODE = {
  ASK: 'ask',
  ACCEPT: 'accept',
  DECLINE: 'decline',
} as const

export type OptionalDrawMode = typeof OPTIONAL_DRAW_MODE[keyof typeof OPTIONAL_DRAW_MODE]
export type OptionalDrawOffer = { key: string; label: string; acceptSlot: number; declineSlot: number }
export type OptionalDrawPreference = { label: string; mode: OptionalDrawMode }
export const OPTIONAL_DRAW_MODE_MESSAGE = 'optional-draw-mode' as const
export const isOptionalDrawMode = (value: unknown): value is OptionalDrawMode =>
  Object.values(OPTIONAL_DRAW_MODE).some((mode) => mode === value)
