export const FINDING_CODE = {
  LEGACY_CARD_REGISTRATION: 'legacy-card-registration',
  LEGACY_BEHAVIOR_PAYLOAD: 'legacy-behavior-payload',
  CUSTOM_PICKER_EVENT: 'custom-picker-event',
  LEGACY_RUNTIME_USE: 'legacy-runtime-use',
  LITERAL_NAME_DISPATCH: 'literal-name-dispatch',
} as const

export const FINDING_MESSAGE = {
  [FINDING_CODE.LEGACY_CARD_REGISTRATION]: 'Legacy card registration',
  [FINDING_CODE.LEGACY_BEHAVIOR_PAYLOAD]: 'Legacy behavior payload',
  [FINDING_CODE.CUSTOM_PICKER_EVENT]: 'Custom picker event',
  [FINDING_CODE.LEGACY_RUNTIME_USE]: 'Legacy runtime use',
  [FINDING_CODE.LITERAL_NAME_DISPATCH]: 'Literal name dispatch',
} as const
