import { appendFileSync } from 'node:fs'

export const logLine = (path: string | undefined, line: string) => {
  const text = `[${new Date().toISOString()}] ${line}`
  if (path) appendFileSync(path, `${text}\n`)
  console.log(line)
}
