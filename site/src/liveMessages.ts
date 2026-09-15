export const priorityModeMessage = (always: boolean) => ({
  type: 'priority-mode',
  always,
})

export const holdMessage = (until: 'my-turn' | 'off') => ({
  type: 'hold',
  until,
})
