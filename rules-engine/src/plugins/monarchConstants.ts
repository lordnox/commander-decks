export const MONARCH_TRIGGER_NAME = {
  draw: 'Monarch end-step draw',
  transfer: 'Monarch combat-damage transfer',
} as const

export const monarchTransferTriggerName = (creature: string, controller: string) =>
  `${MONARCH_TRIGGER_NAME.transfer}: ${creature} (${controller})`
