// Fails on invalid or unused imports anywhere in the TypeScript sources, tests included.
//
// `bun test` does not typecheck and `tsconfig.json` excludes the test files, so a test can
// import a name that does not exist (or forget to import `expect`) and still be committed.
// This type-checks everything but reports only the diagnostics that mean "this import or
// name does not resolve"; other type errors in tests are not this script's concern.
// Unused imports come from oxlint's `no-unused-vars`.

const UNRESOLVED_CODES = new Set([
  'TS1192', // module has no default export
  'TS2300', // duplicate identifier (a name imported twice)
  'TS2304', // cannot find name (e.g. a missing import)
  'TS2305', // module has no exported member
  'TS2306', // file is not a module
  'TS2307', // cannot find module
  'TS2459', // module declares the member locally but does not export it
  'TS2552', // cannot find name, did you mean ...
  'TS2613', // module has no default export, did you mean the named one
  'TS2614', // module has no exported member, did you mean the default one
  'TS2724', // module has no exported member, did you mean ...
])

const run = async (cmd: string[]) => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return out + err
}

const [tscOutput, oxlintOutput] = await Promise.all([
  run(['bunx', 'tsc', '-p', 'tsconfig.imports.json', '--pretty', 'false']),
  run([
    'bunx', 'oxlint', '-A', 'all', '-D', 'no-unused-vars',
    'rules-engine', 'live-runner', 'site/src', 'shared', '.agents/skills',
  ]),
])

const problems: string[] = []

for (const line of tscOutput.split('\n')) {
  const code = /error (TS\d+):/.exec(line)?.[1]
  if (code && UNRESOLVED_CODES.has(code)) problems.push(line)
}

// oxlint prints each diagnostic as "path:line:col: error ... help: ..."; keep the unused imports.
for (const line of oxlintOutput.split('\n')) {
  if (/^\S+:\d+:\d+: /.test(line) && /(imported but never used)/.test(line)) {
    problems.push(line.replace(/ help:.*$/, ''))
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} invalid or unused import(s).`)
  process.exit(1)
}
console.log('No invalid or unused imports.')
