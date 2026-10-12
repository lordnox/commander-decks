export type ReplacementCategory =
  | 'self'
  | 'entryControl'
  | 'copyAsEntry'
  | 'backFaceEntry'
  | 'general'

export type ReplacementProgramCursor = {
  instructions: readonly import('../cardPlugins/dsl/schema/v1').ReplacementProgramInstruction[]
  index: number
  bindings: Record<string, unknown>
}
