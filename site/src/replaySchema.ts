export const LEGACY_REPLAY_SCHEMA = 1 as const
export const CURRENT_REPLAY_SCHEMA = 2 as const

export const unsupportedReplaySchema = (schema: unknown) =>
  `Unsupported replay schema version: ${String(schema)}`

export const assertReplaySchema = (schema: unknown) => {
  switch (schema) {
    case LEGACY_REPLAY_SCHEMA:
    case CURRENT_REPLAY_SCHEMA:
      return schema
    default:
      throw new Error(unsupportedReplaySchema(schema))
  }
}
