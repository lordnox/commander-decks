export type RuleDslDiagnostic = {
  path: string
  code: string
  message: string
}

export class RuleDslValidationError extends Error {
  readonly diagnostics: readonly RuleDslDiagnostic[]

  constructor(diagnostics: readonly RuleDslDiagnostic[]) {
    super(diagnostics.map(({ path, message }) => `${path}: ${message}`).join('\n'))
    this.name = 'RuleDslValidationError'
    this.diagnostics = diagnostics
  }
}

export class RuleDslEvaluationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleDslEvaluationError'
  }
}
