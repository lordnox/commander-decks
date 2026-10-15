/** Validation diagnostics for explicit optional instruction choices. */
export const OPTIONAL_ACTION_DIAGNOSTIC_CODE = {
  MARKER: 'optional-action-marker',
  OPTIONS: 'optional-action-options',
} as const

export const OPTIONAL_ACTION_DIAGNOSTIC_MESSAGE = {
  MARKER: 'optional action marker must be true',
  OPTIONS: 'optional actions require an accept program followed by an empty decline program',
} as const
