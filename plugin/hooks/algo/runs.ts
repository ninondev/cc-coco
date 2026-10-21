import {untrustedDisplaySlot} from '../display-slot-text'
/**
 * runs.ts — recognise test/build commands, parse their output, judge slowness.
 *
 * Pure ES2023: no platform APIs, no I/O, never throws.
 */

export type RunKind = 'test' | 'build'

export interface Recognized {
  kind: RunKind
  tool: string
  key: string
  filtered: boolean
}

export interface RunResult {
  outcome: 'pass' | 'fail' | 'unknown'
  firstFailing?: string
  failed?: number
  passed?: number
}

export interface Sample {
  ms: number
  outcome: 'pass' | 'fail' | 'unknown'
}

export type History = Record<string, Sample[]>

export interface Slowness {
  slow: boolean
  usualMs?: number
  ratio?: number
}

/* ------------------------------------------------------------------ *
 * Shell text utilities
 * ------------------------------------------------------------------ */

/** Split a command line into chain parts on && || ; | and newlines,
 *  respecting single and double quotes. */
function splitChain(command: string): string[] {
  const parts: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  const push = () => {
    const t = cur.trim()
    if (t.length > 0) parts.push(t)
    cur = ''
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (escaped) {
      cur += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      cur += ch
      escaped = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '\n' || ch === ';') {
      push()
      continue
    }
    if (ch === '&' && command[i + 1] === '&') {
      push()
      i++
      continue
    }
    if (ch === '|' && command[i + 1] === '|') {
      push()
      i++
      continue
    }
    if (ch === '|') {
      push()
      continue
    }
    cur += ch
  }
  push()
  return parts
}

/** Split one chain part into words, dropping shell redirections. */
function tokenize(part: string): string[] {
  const words: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  const push = () => {
    if (cur.length > 0) words.push(cur)
    cur = ''
  }
  /** consume a redirection: > >> 2> &> 2>&1 >file "> file" */
  const swallowRedirect = (i: number): number => {
    if (cur === '1' || cur === '2') cur = '' // the fd digit of 2>&1
    else push()
    if (part[i + 1] === '>') i++
    if (part[i + 1] === '&') {
      i++
      if (/[0-9]/.test(part[i + 1] ?? '')) i++
    }
    i++
    while (part[i] === ' ' || part[i] === '\t') i++
    if (!/[\s;|&<>]/.test(part[i] ?? '')) {
      while (part[i] && part[i] !== ' ' && part[i] !== '\t' && part[i] !== ';') i++
      i--
    }
    return i
  }
  for (let i = 0; i < part.length; i++) {
    const ch = part[i]
    if (escaped) {
      cur += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      push()
      continue
    }
    if (ch === '>' || (ch === '&' && part[i + 1] === '>')) {
      i = swallowRedirect(i)
      continue
    }
    if (ch === '<') {
      if (cur === '0') cur = ''
      else push()
      while (part[i + 1] === ' ') i++
      while (part[i + 1] && part[i + 1] !== ' ' && part[i + 1] !== ';') i++
      continue
    }
    cur += ch
  }
  push()
  return words.filter((w) => w !== '&')
}

function isAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

const DURATION = /^(?:\d*\.?\d+(?:ms|s|m|h|d)?)+$/

/** flags of each wrapper that consume a separate value; every other
 *  flag is boolean. */
const WRAPPER_VALUE_FLAGS: Record<string, string[]> = {
  sudo: ['-u', '-g', '-p', '-C', '-r', '-t', '--user', '--group', '--role', '--type', '--prompt', '--close-from'],
  env: ['-u', '-S', '--unset', '--split-string'],
  time: ['-o', '-f', '-a', '--output', '--format', '--append'],
  nice: ['-n', '--adjustment'],
  timeout: ['-k', '-s', '--kill-after', '--signal'],
  caffeinate: ['-t', '-w', '--timeout', '--wait'],
  nohup: [],
  command: [],
}

/** Drop wrapper commands that only launch another command. */
function stripWrappers(words: string[]): string[] {
  for (;;) {
    const head = words[0]
    if (!head) return words
    if (isAssignment(head)) {
      words = words.slice(1)
      continue
    }
    const name = head.replace(/^.*\//, '')
    if (!(name in WRAPPER_VALUE_FLAGS)) return words
    words = words.slice(1)
    // skip the wrapper's own flags (and their values)
    const valueFlags = WRAPPER_VALUE_FLAGS[name]
    while (words.length > 0) {
      const w = words[0]
      if (w === '--') {
        words = words.slice(1) // timeout 10 -- npm test
        continue
      }
      if (name === 'command' && (w === '-v' || w === '-V' || w === '-p')) return ['-v'] // a lookup, not a launch
      if (w.startsWith('--')) {
        words = words.slice(valueFlags.includes(w) ? 2 : 1)
        continue
      }
      if (w.startsWith('-') && w.length > 1) {
        words = words.slice(valueFlags.includes(w) ? 2 : 1)
        continue
      }
      if (isAssignment(w)) {
        words = words.slice(1)
        continue
      }
      if (name === 'timeout' && DURATION.test(w)) {
        words = words.slice(1)
        continue
      }
      break
    }
  }
}

/** Runner prefixes that only launch another command. */
function stripRunners(words: string[]): string[] {
  const w0 = words[0] ?? ''
  const bin = w0.replace(/^.*\//, '')
  const rest = words.slice(1)
  if (w0 === 'npx' || w0 === 'bunx') return skipFlags(rest)
  if (w0 === 'cross-env') {
    let out = rest
    while (out.length && isAssignment(out[0])) out = out.slice(1)
    return out
  }
  if (w0 === 'dotenv') {
    let i = 0
    while (i < rest.length) {
      const w = rest[i]
      if (w === '--') {
        i++
        break
      }
      if (w === '-e' || w === '-o' || w === '--envfile' || w === '--overload') {
        i += 2
        continue
      }
      if (w.startsWith('-') && w.length > 1) {
        i++
        continue
      }
      break
    }
    return rest.slice(i)
  }
  if (bin === 'pnpm' && (rest[0] === 'exec' || rest[0] === 'dlx')) return skipFlags(rest.slice(1))
  if (bin === 'yarn' && rest[0] === 'dlx') return skipFlags(rest.slice(1))
  if (
    (w0 === 'uv' || w0 === 'poetry' || w0 === 'pdm' || w0 === 'pipenv' || w0 === 'rye') &&
    rest[0] === 'run'
  ) {
    return skipFlags(rest.slice(1))
  }
  if (w0 === 'hatch' && rest[0] === 'run') return skipFlags(rest.slice(1))
  if (w0 === 'bundle' && rest[0] === 'exec') return skipFlags(rest.slice(1))
  if (w0 === 'git' && rest[0] === 'bisect' && rest[1] === 'run') return stripRunners(rest.slice(2))
  if (w0 === 'rustup' && rest[0] === 'run') return stripRunners(rest.slice(2))
  if (w0 === 'docker') {
    if (rest[0] === 'compose' && (rest[1] === 'run' || rest[1] === 'exec')) return dropPositional(rest.slice(2))
    if (rest[0] === 'run' || rest[0] === 'exec') return dropPositional(rest.slice(1))
  }
  const m = /^(?:\.\.\/|\.\/)?(?:node_modules\/\.bin\/)(.+)$/.exec(w0)
  if (m) return [m[1], ...rest]
  return words
}

/** Skip a command's own leading flags, stopping before the subcommand. */
function skipLeadingFlags(words: string[]): string[] {
  let i = 0
  while (i < words.length) {
    const w = words[i]
    if (w === '--') return words.slice(i)
    if (w.startsWith('--')) {
      if (/^--(prefix|workspace|cwd|dir|filter|since|scope|silent|loglevel|production|frozen-lockfile)$/.test(w)) {
        i += 2
        continue
      }
      i++
      continue
    }
    if (w.startsWith('-') && w.length > 1) {
      i++
      continue
    }
    break
  }
  return words.slice(i)
}

/** Skip leading flags, then drop the first positional (a container name or
 *  image); used for docker run/exec launchers. */
function dropPositional(words: string[]): string[] {
  const VALUE = ['-e', '-v', '-p', '-u', '-w', '--env', '--name', '--mount', '--volume', '--publish', '--user', '--workdir', '--entrypoint', '--network', '--restart', '--env-file', '--health-cmd', '--health-interval', '--health-retries', '--memory', '--cpus', '--label', '--add-host', '--dns', '--hostname', '--platform', '--pull']
  let i = 0
  while (i < words.length) {
    const w = words[i]
    if (w === '--') {
      i++
      break
    }
    if (w.startsWith('--')) {
      if (w.includes('=')) {
        i++
        continue
      }
      i += VALUE.includes(w) ? 2 : 1
      continue
    }
    if (w.startsWith('-') && w.length > 1) {
      i += VALUE.includes(w) ? 2 : 1
      continue
    }
    break
  }
  return words.slice(i + 1)
}

function skipFlags(words: string[]): string[] {
  let i = 0
  while (i < words.length) {
    const w = words[i]
    if (w === '--') return words.slice(i + 1)
    if (w.startsWith('--')) {
      if (w.includes('=')) {
        i++
        continue
      }
      if (/^--(package|call|group|with|python|dir|file|env|env-file|reporter|require|output-dir)$/.test(w)) {
        i += 2
        continue
      }
      i++
      continue
    }
    if (w.startsWith('-') && w.length > 1) {
      if (/^-[pc]$/.test(w)) {
        i += 2
        continue
      }
      i++
      continue
    }
    break
  }
  return words.slice(i)
}

/* ------------------------------------------------------------------ *
 * 2. Key normalisation
 * ------------------------------------------------------------------ */

const NOISE_FLAGS = new Set(['--color', '--colors', '--no-color', '--no-colors', '--ci', '--silent', '-q', '--quiet'])
const NOISE_PREFIXES = ['--color=', '--progress=', '--reporter=']
const NOISE_VALUE_FLAGS = ['--reporter', '--progress']

/** History key: whitespace collapsed, work-neutral flags removed. */
function makeKey(words: string[]): string {
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (NOISE_FLAGS.has(w)) continue
    if (NOISE_PREFIXES.some((p) => w.startsWith(p))) continue
    if (NOISE_VALUE_FLAGS.includes(w)) {
      i++
      continue
    }
    out.push(w)
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------------ *
 * 3. Tool table
 * ------------------------------------------------------------------ */

interface Match {
  kind: RunKind
  tool: string
  filtered: boolean
  /** words the history key is built from, when they differ from the whole
   *  command (a package manager delegating to a local runner binary) */
  keyWords?: string[]
}

function isTestScriptName(s: string): boolean {
  return (
    s === 'test' ||
    s.startsWith('test:') ||
    s.startsWith('test-') ||
    s === 'spec' ||
    s === 'e2e' ||
    s === 'unit' ||
    s === 'integration'
  )
}

function isBuildScriptName(s: string): boolean {
  return s === 'build' || s === 'compile' || s === 'bundle' || s.startsWith('build:')
}

const JEST_VALUE_FLAGS = ['--config', '--maxWorkers', '--max-workers', '--cacheDirectory', '--coverageDirectory', '--testEnvironment', '--reporter', '--coverageReporters', '--json', '--outputFile', '--collectCoverageFrom', '--roots', '--testMatch', '--testPathIgnorePatterns', '--moduleDirectories']

const MOCHA_VALUE_FLAGS = ['--reporter', '-R', '--require', '-r', '--config', '--timeout', '-t', '--slow', '-s', '--ui', '-u', '--file', '--opts', '--extension', '--reporter-option', '--reporter-options', '--retries', '--jobs']
const VITEST_VALUE_FLAGS = ['--reporter', '--config', '--outputFile', '--browser', '--pool', '--poolOptions', '--workspace', '--root', '--dir', '--coverageThreshold']
const FILTER_FLAGS = ['-k', '-t', '--testNamePattern', '--testPathPattern', '--grep', '-g', '-run', '--filter', '--tests', '--spec', '--suite', '--tests-regex', '--test-name-pattern', '--plain-name', '-E', '--only', '--findRelatedTests', '--changedSince', '--lastCommit', '--onlyChanged', '--changed']

/** Flags that change reporting, not selection: they never narrow a
 *  run, wherever they appear on the line. */
const BENIGN_VALUE = new Set(['--browser', '--pool', '--poolOptions', '--workers', '--reporter-option', '--reporter-options', '--reporter', '--reporters', '-R', '-r', '--require', '--outputFile', '--output-file', '-o', '--out', '--config', '-c', '--progress', '--log-level', '--coverageDirectory', '--coverage-directory', '--timeout', '--testTimeout', '--maxWorkers', '--max-workers', '--cacheDirectory'])
const BENIGN_BOOL = new Set(['--run', '--coverage', '--cover', '--code-coverage', '--color', '--colors', '--colour', '--no-color', '--no-colors', '--ci', '--silent', '-q', '--quiet', '--verbose', '-v', '-V', '--json', '--no-summary', '--summary', '--debug', '--bail', '-b', '--fail-fast', '--no-watch', '--watch=false', '--watchAll=false', '--single-run', '--expand', '--noStackTrace', '--listTests', '--showConfig', '--runInBand', '--detectOpenHandles', '--passWithNoTests'])
const BENIGN_PREFIX = ['--color=', '--colour=', '--progress=', '--reporter=', '--reporters=', '--coverage.', '--log-level=', '--outputFile=', '--verbose=', '--summary=', '--silent=']

function isBenignFlag(w: string): boolean {
  if (BENIGN_BOOL.has(w) || BENIGN_VALUE.has(w)) return true
  return BENIGN_PREFIX.some((p) => w.startsWith(p))
}

/** Does the command narrow the run: a filter flag or a positional
 *  test file / directory / name pattern? Reporting flags never do. */
function hasSubsetArg(words: string[], valueFlags: string[], filterFlags: string[], from = 0, passthrough = false): boolean {
  for (let i = from; i < words.length; i++) {
    const w = words[i]
    if (w === '--') {
      passthrough = true // after -- the words belong to the inner runner
      continue
    }
    if (w.startsWith('--') || (w.startsWith('-') && w.length > 1)) {
      const values = passthrough ? [] : valueFlags
      if (w.includes('=')) {
        if (filterFlags.some((f) => w.startsWith(f + '='))) return true
        continue // --coverage=... and friends never narrow a run
      }
      if (values.includes(w)) {
        i++
        continue
      }
      if (filterFlags.includes(w)) return true
      if (/^-[A-Za-z]+=/.test(w) && filterFlags.some((f) => w.startsWith(f + '='))) return true
      if (BENIGN_VALUE.has(w)) {
        i++
        continue
      }
      if (isBenignFlag(w)) continue
      continue // an unknown flag never narrows the run
    }
    // a bare number or a key=value word is the value of the flag before it
    // (mocha --retries 2, --reporter-options reportDir=dist): not a selection
    if (/^\d+(?:\.\d+)?$/.test(w)) continue
    if (/^[^=\s]+=/.test(w)) continue
    return true // a positional selects a subset
  }
  return false
}

/** A package manager hands everything after the script name straight to
 *  the inner runner, so only the runner filters (or a test path) narrow
 *  the run: npm test -- -t parse. */
function subsetArgPassthrough(words: string[]): boolean {
  return hasSubsetArg(words, [], FILTER_FLAGS)
}

const GO_ALL = new Set(['.', './...', '...', './'])

function matchTool(w: string[], depth: number): Match | null {
  if (depth > 6 || w.length === 0) return null
  const head = w[0]
  const bin = head.replace(/^.*\//, '')
  const rest = w.slice(1)

  /* ---------- package managers and their scripts ---------- */
  if (bin === 'npm' || bin === 'pnpm' || bin === 'yarn' || bin === 'bun') {
    const stripped = skipLeadingFlags(rest) // tolerate --silent and friends before the subcommand
    let script: string | null = null
    let args: string[]
    let ws = stripped
    if (bin === 'yarn' && ws[0] === 'workspace') {
      // yarn workspace <name> [run] <script>
      ws = ws.slice(2)
      if (ws[0] === 'run') ws = ws.slice(1)
    }
    if (ws[0] === 'run' || ws[0] === 'run-script') {
      script = ws[1] ?? null
      args = ws.slice(2)
    } else if (ws[0] === 't' && bin === 'npm') {
      script = 'test'
      args = ws.slice(1)
    } else {
      script = ws[0] ?? null
      args = ws.slice(1)
    }
    if (script !== null && isTestScriptName(script)) {
      // everything past the script name goes to the runner the script starts,
      // so only that runner own filters narrow the run
      return { kind: 'test', tool: bin, filtered: subsetArgPassthrough(args) }
    }
    if (script !== null && isBuildScriptName(script)) {
      return { kind: 'build', tool: bin, filtered: false }
    }
    // yarn and pnpm also run node_modules/.bin binaries directly:
    // yarn vitest run, pnpm jest --coverage
    if (script !== null && (bin === 'yarn' || bin === 'pnpm')) {
      const inner = ws[0] === 'run' || ws[0] === 'run-script' ? ws.slice(1) : ws
      const m = matchTool(inner, depth + 1)
      if (m) return { ...m, keyWords: inner }
    }
    return null
  }

  /* ---------- JavaScript test runners ---------- */
  if (bin === 'jest') {
    // --watch=false and --watchAll=false switch watching off: still a run
    if (w.some((x) => x === '--watch' || x === '--watchAll' || x === '--watch-all' || /^--watch(All)?=true$/.test(x))) return null
    return { kind: 'test', tool: 'jest', filtered: hasSubsetArg(rest, JEST_VALUE_FLAGS, FILTER_FLAGS) }
  }
  if (bin === 'vitest') {
    if (w.some((x) => x === '--watch' || x === '--watchAll' || x === '--watch-all' || /^--watch(All)?=true$/.test(x))) return null
    const firstPos = rest.find((x) => !x.startsWith('-')) ?? ''
    const watchOff = w.some((x) => /^--watch(All)?=false$/.test(x) || x === '--no-watch' || x === '--run')
    if (firstPos !== 'run' && !watchOff) return null // plain vitest is watch mode
    const at = firstPos === 'run' ? rest.indexOf(firstPos) + 1 : 1
    return { kind: 'test', tool: 'vitest', filtered: hasSubsetArg(rest, VITEST_VALUE_FLAGS, FILTER_FLAGS, at) }
  }
  if (bin === 'mocha' || bin === 'ava' || bin === 'jasmine' || bin === 'uvu' || bin === 'tap') {
    return { kind: 'test', tool: bin, filtered: hasSubsetArg(rest, MOCHA_VALUE_FLAGS, FILTER_FLAGS) }
  }
  if (bin === 'node' && rest.includes('--test')) {
    const at = rest.indexOf('--test')
    return { kind: 'test', tool: 'node', filtered: hasSubsetArg(rest, ['--test-reporter', '--test-reporter-destination', '--import', '--experimental-test-coverage'], FILTER_FLAGS, at + 1) }
  }
  if (bin === 'deno') {
    if (rest[0] === 'test') {
      return { kind: 'test', tool: 'deno', filtered: hasSubsetArg(rest, ['--allow-', '--location', '--config', '-c'], ['--filter'], 1) }
    }
    if (rest[0] === 'task') {
      const script = rest[1] ?? ''
      if (isTestScriptName(script)) return { kind: 'test', tool: 'deno', filtered: hasSubsetArg(rest, [], FILTER_FLAGS, 2) }
      if (isBuildScriptName(script)) return { kind: 'build', tool: 'deno', filtered: false }
    }
    return null
  }
  if (bin === 'playwright' && rest[0] === 'test') {
    return { kind: 'test', tool: 'playwright', filtered: hasSubsetArg(rest, ['--config', '--project', '--reporter', '--retries', '--browser', '--workers', '--max-failures', '--timeout'], [...FILTER_FLAGS, '--grep'], 1) }
  }
  if (bin === 'cypress' && rest[0] === 'run') {
    return { kind: 'test', tool: 'cypress', filtered: hasSubsetArg(rest, ['--browser', '--config', '--reporter'], ['--spec'], 1) }
  }
  if (bin === 'karma' && rest[0] === 'start') {
    if (!w.includes('--single-run') || w.includes('--single-run=false')) return null
    return { kind: 'test', tool: 'karma', filtered: hasSubsetArg(rest, MOCHA_VALUE_FLAGS, FILTER_FLAGS, 1) }
  }
  if (bin === 'c8' || bin === 'nyc') {
    return matchTool(skipFlags(rest), depth + 1)
  }

  /* ---------- JavaScript build tools ---------- */
  if (bin === 'tsc') {
    if (w.some((x) => /^--watch/.test(x)) || w.includes('-w')) return null
    return { kind: 'build', tool: 'tsc', filtered: false }
  }
  if ((bin === 'vite' || bin === 'next' || bin === 'nuxt' || bin === 'astro') && rest[0] === 'build') {
    return { kind: 'build', tool: bin, filtered: false }
  }
  if (bin === 'svelte-kit' && rest[0] === 'build') {
    return { kind: 'build', tool: 'svelte-kit', filtered: false }
  }
  if (bin === 'webpack') {
    if (w.some((x) => /^--watch/.test(x)) || rest[0] === 'serve') return null
    return { kind: 'build', tool: 'webpack', filtered: false }
  }
  if (bin === 'rollup') {
    if (w.includes('-c') || w.includes('--config') || w.some((x) => x.startsWith('--config'))) {
      return { kind: 'build', tool: 'rollup', filtered: false }
    }
    return null
  }
  if (bin === 'esbuild') {
    if (w.includes('--bundle')) return { kind: 'build', tool: 'esbuild', filtered: false }
    return null
  }
  if (bin === 'tsup') return { kind: 'build', tool: 'tsup', filtered: false }
  if (bin === 'parcel' && rest[0] === 'build') return { kind: 'build', tool: 'parcel', filtered: false }

  /* ---------- monorepo runners ---------- */
  if (bin === 'turbo') {
    let tasks: string[] = []
    let subset = false
    if (rest[0] === 'run') tasks = rest.slice(1)
    else tasks = rest.slice(0) // `turbo test` is shorthand for `turbo run test`
    const names: string[] = []
    for (const t of tasks) {
      if (t.startsWith('--')) {
        if (t.startsWith('--filter') || t.startsWith('--scope')) subset = true
        continue
      }
      names.push(t)
    }
    if (names.some(isTestScriptName)) return { kind: 'test', tool: 'turbo', filtered: subset }
    if (names.some(isBuildScriptName)) return { kind: 'build', tool: 'turbo', filtered: subset }
    return null
  }
  if (bin === 'nx') {
    let task = ''
    if (rest[0] === 'run' || rest[0] === 'run-many') {
      const spec = rest[1] ?? ''
      task = spec.split(':')[1] ?? spec.split(':')[0]
    } else if (rest[0] === 'affected') {
      for (let i = 1; i < rest.length; i++) {
        const t = rest[i]
        if (t === '-t' || t === '--target' || t === '--targets') {
          task = (rest[i + 1] ?? '').split(',')[0]
          break
        }
        if (t.startsWith('--targets=') || t.startsWith('--target=')) {
          task = t.split('=')[1].split(',')[0]
          break
        }
      }
    } else {
      task = rest[0] ?? ''
    }
    if (!task) return null
    if (isTestScriptName(task)) return { kind: 'test', tool: 'nx', filtered: true }
    if (isBuildScriptName(task)) return { kind: 'build', tool: 'nx', filtered: true }
    return null
  }
  if (bin === 'lerna' && rest[0] === 'run') {
    const script = rest[1] ?? ''
    let subset = false
    for (const t of rest) if (t.startsWith('--scope') || t.startsWith('--since')) subset = true
    if (isBuildScriptName(script)) return { kind: 'build', tool: 'lerna', filtered: subset }
    // The brief lists `lerna run <script>` under build; we classify by the
    // script name so `lerna run test` is a test (see runs.test.ts).
    if (isTestScriptName(script)) return { kind: 'test', tool: 'lerna', filtered: subset }
    return null
  }

  /* ---------- Python ---------- */
  if (bin === 'pytest' || bin === 'py.test' || bin === 'pytest.exe') {
    return { kind: 'test', tool: 'pytest', filtered: hasSubsetArg(rest, ['--maxfail', '--tb', '-m', '--cov', '--timeout', '--durations', '-W', '--pythonwarnings'], FILTER_FLAGS) }
  }
  if (/^python\d*(\.\d+)?$/.test(bin)) {
    if (rest[0] === '-m') return matchPythonModule(rest.slice(1), depth)
    return null
  }
  if (bin === 'nose2' || bin === 'tox' || bin === 'nox') return { kind: 'test', tool: bin, filtered: hasSubsetArg(rest, ['--envlist', '--default-env'], ['-e', '--session', '-s']) }
  if (bin === 'coverage' && rest[0] === 'run') {
    const inner = rest.slice(1)
    if (inner[0] === '-m') return matchPythonModule(inner.slice(1), depth)
    return matchTool(inner, depth + 1)
  }
  if (bin === 'pip' && rest[0] === 'wheel') return { kind: 'build', tool: 'pip', filtered: false }
  if (bin === 'php') {
    let i = 0
    while (i < rest.length && (rest[i] === '-d' || rest[i] === '-n')) i += rest[i] === '-d' ? 2 : 1
    if (/phpunit$/.test(rest[i] ?? '')) return { kind: 'test', tool: 'phpunit', filtered: hasSubsetArg(rest.slice(i + 1), ['--configuration', '-c', '--log-junit', '--coverage-filter'], ['--filter']) }
    if (/pest$/.test(rest[i] ?? '')) return { kind: 'test', tool: 'pest', filtered: hasSubsetArg(rest.slice(i + 1), ['--configuration', '-c'], ['--filter', '--group']) }
  }

  /* ---------- Rust ---------- */
  if (bin === 'cargo') {
    const rest2 = rest[0]?.startsWith('+') ? rest.slice(1) : rest
    if (rest2[0] === 'test') {
      const pos = hasSubsetArg(rest2, ['--jobs', '-j', '--exclude', '--features'], ['-k', '--exact', '--test', '--lib', '--bin', '--skip', '-run', '--filter'], 1)
      return { kind: 'test', tool: 'cargo', filtered: pos }
    }
    if (rest2[0] === 'nextest' && (rest2[1] === 'run' || rest2[1] === undefined)) {
      return { kind: 'test', tool: 'nextest', filtered: hasSubsetArg(rest2, ['--profile', '--workspace', '-j'], ['-E', '--filter'], 1) }
    }
    if (rest2[0] === 'build') return { kind: 'build', tool: 'cargo', filtered: false }
    return null
  }

  /* ---------- Go ---------- */
  if (bin === 'go') {
    if (rest[0] === 'test') {
      let filterFlag = false
      const pos: string[] = []
      for (let i = 1; i < rest.length; i++) {
        const t = rest[i]
        if (t === '-run' || t === '--run' || t.startsWith('-run=') || t.startsWith('--run=')) filterFlag = true
        else if (!t.startsWith('-')) pos.push(t)
      }
      const subsetPos = pos.some((p) => !GO_ALL.has(p))
      return { kind: 'test', tool: 'go', filtered: filterFlag || subsetPos }
    }
    if (rest[0] === 'build') return { kind: 'build', tool: 'go', filtered: false }
    return null
  }

  /* ---------- JVM ---------- */
  if (/^(?:\.\/)?gradlew(?:\.bat)?$/.test(head) || bin === 'gradle') {
    const tasks: string[] = []
    let subset = false
    for (const t of rest) {
      if (t.startsWith('--tests') || t.startsWith('-Ptest') || t.startsWith('-Dtest')) subset = true
      if (t.startsWith('-')) continue
      if (t.includes('=') && !t.includes(':')) continue
      tasks.push(t.split(':').pop() ?? t)
    }
    if (tasks.includes('test') || tasks.includes('check')) return { kind: 'test', tool: 'gradle', filtered: subset }
    if (tasks.includes('build') || tasks.includes('assemble')) return { kind: 'build', tool: 'gradle', filtered: false }
    return null
  }
  if (/^(?:\.\/)?mvnw?$/.test(head)) {
    const phases: string[] = []
    let subset = false
    for (const t of rest) {
      if (t.startsWith('-')) {
        if (t.startsWith('-Dtest')) subset = true
        continue
      }
      if (t.includes('=')) continue
      if (t === 'clean' || t === 'deploy') continue // install is a build phase per the brief
      phases.push(t)
    }
    if (phases.includes('test') || phases.includes('verify')) return { kind: 'test', tool: 'mvn', filtered: subset }
    if (phases.includes('package') || phases.includes('install')) return { kind: 'build', tool: 'mvn', filtered: false }
    return null
  }
  if (bin === 'sbt') {
    const task = rest[0] ?? ''
    if (task === 'test' || task.startsWith('testOnly') || task.startsWith('testQuick')) {
      // a plain test run executes everything; testOnly narrows, and so do
      // extra non-flag arguments such as a suite filter
      const narrowed = task !== 'test' || rest.slice(1).some((x) => !x.startsWith('-'))
      return { kind: 'test', tool: 'sbt', filtered: narrowed }
    }
    if (task === 'compile') return { kind: 'build', tool: 'sbt', filtered: false }
    return null
  }
  if ((bin === 'bazel' || bin === 'buck2') && (rest[0] === 'test' || rest[0] === 'build')) {
    const kind = rest[0] === 'test' ? 'test' : 'build'
    const pos = rest.slice(1).filter((t) => !t.startsWith('-'))
    const subset = pos.length > 0 && !pos.every((p) => p === '...' || p === '//...' || p === './...' || p.startsWith('//...'))
    return { kind, tool: bin, filtered: kind === 'test' ? subset : false }
  }

  /* ---------- .NET / Apple / Ruby / PHP / Elixir / Haskell / Dart ---------- */
  if (bin === 'dotnet') {
    if (rest[0] === 'test') {
      return { kind: 'test', tool: 'dotnet', filtered: hasSubsetArg(rest, ['--logger', '--configuration', '--framework', '--collect'], ['--filter'], 1) }
    }
    if (rest[0] === 'build') return { kind: 'build', tool: 'dotnet', filtered: false }
    return null
  }
  if (bin === 'swift') {
    if (rest[0] === 'test') return { kind: 'test', tool: 'swift', filtered: hasSubsetArg(rest, [], ['--filter'], 1) }
    if (rest[0] === 'build') return { kind: 'build', tool: 'swift', filtered: false }
    return null
  }
  if (bin === 'xcodebuild') {
    let kind: RunKind | null = null
    let subset = false
    for (const t of rest) {
      if (t === 'test') kind = 'test'
      else if (t === 'build') kind = kind ?? 'build'
      if (t.startsWith('-only-testing')) subset = true
    }
    if (!kind) return null
    return { kind, tool: 'xcodebuild', filtered: kind === 'test' ? subset : false }
  }
  if (bin === 'rspec') {
    if (w.includes('--init') || w.includes('--version')) return null
    return { kind: 'test', tool: 'rspec', filtered: hasSubsetArg(rest, ['--format', '-f', '--require', '-r', '--options', '--default-path'], ['--example', '-e', '--tag', '-n', '--pattern'], 0) }
  }
  if (bin === 'rake') {
    const task = rest.find((t) => !t.startsWith('-')) ?? ''
    if (task === 'test' || task === 'spec' || task.startsWith('test:') || task.startsWith('spec:')) {
      return { kind: 'test', tool: 'rake', filtered: false }
    }
    return null
  }
  if (bin === 'rails') {
    const sub = rest[0] ?? ''
    if (sub === 'test' || sub.startsWith('test:')) return { kind: 'test', tool: 'rails', filtered: rest.length > 1 }
    return null
  }
  if (bin === 'ruby') {
    if (w.includes('-Itest') || w.includes('-Ilib:test')) {
      return { kind: 'test', tool: 'ruby', filtered: rest.some((t) => !t.startsWith('-')) }
    }
    return null
  }
  if (bin === 'phpunit' || bin === 'pest') {
    return { kind: 'test', tool: bin, filtered: hasSubsetArg(rest, ['--configuration', '-c', '--log-junit', '--coverage-filter'], ['--filter'], 0) }
  }
  if (bin === 'composer' && rest[0] === 'test') return { kind: 'test', tool: 'composer', filtered: false }
  if (bin === 'mix') {
    if (rest[0] === 'test') {
      return { kind: 'test', tool: 'mix', filtered: hasSubsetArg(rest, ['--max-failures', '--seed', '--trace'], ['--only', '--exclude'], 1) }
    }
    if (rest[0] === 'compile') return { kind: 'build', tool: 'mix', filtered: false }
    return null
  }
  if (bin === 'cabal' || bin === 'stack') {
    if (rest[0] === 'test') return { kind: 'test', tool: bin, filtered: rest.length > 1 && !rest.slice(1).every((t) => t.startsWith('-')) }
    if (rest[0] === 'build') return { kind: 'build', tool: bin, filtered: false }
    return null
  }
  if (bin === 'dart' && rest[0] === 'test') {
    return { kind: 'test', tool: 'dart', filtered: hasSubsetArg(rest, ['--reporter', '-r', '--concurrency'], ['--plain-name', '-N', '-n', '--name'], 1) }
  }
  if (bin === 'flutter') {
    if (rest[0] === 'test') return { kind: 'test', tool: 'flutter', filtered: hasSubsetArg(rest, ['--reporter', '-r', '--device-id', '-d'], ['--plain-name', '-N', '-n', '--name', '--grep'], 1) }
    if (rest[0] === 'build') return { kind: 'build', tool: 'flutter', filtered: false }
    return null
  }

  /* ---------- C / C++ / Zig ---------- */
  if (bin === 'make' || bin === 'gmake' || bin === 'mingw32-make') {
    const targets: string[] = []
    for (const t of rest) {
      if (t.startsWith('-')) continue
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue // make VAR=value
      if (t === '-C' || t === '-f') continue
      targets.push(t)
    }
    if (targets.includes('test') || targets.includes('check')) return { kind: 'test', tool: 'make', filtered: false }
    if (targets.some((t) => /^(clean|distclean|mrproper|mostlyclean|maintainer-clean|tidy)$/.test(t))) return null
    return { kind: 'build', tool: 'make', filtered: false }
  }
  if (bin === 'cmake' && rest[0] === '--build') return { kind: 'build', tool: 'cmake', filtered: false }
  if (bin === 'ninja') return { kind: 'build', tool: 'ninja', filtered: false }
  if (bin === 'meson' && rest[0] === 'test') {
    return { kind: 'test', tool: 'meson', filtered: hasSubsetArg(rest, ['--print-errorlogs', '--repeat', '--timeout'], ['--suite', '--no-suite'], 1) }
  }
  if (bin === 'ctest') {
    return { kind: 'test', tool: 'ctest', filtered: hasSubsetArg(rest, ['--output-on-failure', '--timeout', '-j'], ['-R', '--tests-regex', '-I', '-L', '--label-regex'], 0) }
  }
  if (bin === 'zig' && rest[0] === 'build') {
    if (rest[1] === 'test') return { kind: 'test', tool: 'zig', filtered: rest.length > 2 && !rest.slice(2).every((t) => t.startsWith('-')) }
    return { kind: 'build', tool: 'zig', filtered: false }
  }

  return null
}

function matchPythonModule(words: string[], depth: number): Match | null {
  if (depth > 6 || words.length === 0) return null
  const mod = words[0]
  const args = words.slice(1)
  if (mod === 'pytest' || mod === 'py.test') {
    return { kind: 'test', tool: 'pytest', filtered: hasSubsetArg(args, ['--maxfail', '--tb', '-m', '--cov', '--timeout', '--durations', '-W'], FILTER_FLAGS) }
  }
  if (mod === 'unittest') {
    let filtered = false
    const pos = args.filter((t) => !t.startsWith('-'))
    if (pos.length > 0 && !(pos.length === 1 && pos[0] === 'discover')) filtered = true
    if (pos[0] === 'discover' && (args.includes('-s') || args.includes('--start-dir'))) filtered = true
    return { kind: 'test', tool: 'unittest', filtered }
  }
  if (mod === 'build') return { kind: 'build', tool: 'build', filtered: false }
  if (mod === 'pip' && args[0] === 'wheel') return { kind: 'build', tool: 'pip', filtered: false }
  if (mod === 'nose2') return { kind: 'test', tool: 'nose2', filtered: false }
  return null
}

/* ------------------------------------------------------------------ *
 * 4. recognize
 * ------------------------------------------------------------------ */

export function recognize(command: string): Recognized | null {
  try {
    if (typeof command !== 'string') return null
    for (const part of splitChain(command)) {
      let words = tokenize(part)
      if (words.length === 0) continue
      // unwrap wrappers and launchers to a fixpoint (sudo npx docker run ... cmd)
      for (let round = 0; round < 6; round++) {
        const next = stripWrappers(stripRunners(stripWrappers(words)))
        if (next.length === 0 || next.join(' ') === words.join(' ')) {
          words = next.length === 0 ? next : words
          break
        }
        words = next
      }
      if (words.length === 0) continue
      const m = matchTool(words, 0)
      if (m) return { kind: m.kind, tool: m.tool, key: makeKey(m.keyWords ?? words), filtered: m.filtered }
    }
    return null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 5. Output parsing
 * ------------------------------------------------------------------ */

const HEAD_LIMIT = 64 * 1024
const TAIL_LIMIT = 192 * 1024

/** Remove ANSI escape sequences (CSI, OSC and friends) and carriage returns. */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;:?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[P^_][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b./g, '')
    .replace(/\r/g, '')
}

/** Very long outputs: keep the first 64 KB and the last 192 KB. */
function window(text: string): string {
  if (text.length <= HEAD_LIMIT + TAIL_LIMIT) return text
  return text.slice(0, HEAD_LIMIT) + '\n' + text.slice(text.length - TAIL_LIMIT)
}

interface Info {
  name?: string
  failed?: number
  passed?: number
  failSignal?: boolean
  passSignal?: boolean
}

function re(re: RegExp, lines: string[], group = 1): string | undefined {
  for (const line of lines) {
    const m = re.exec(line)
    if (m) return m[group]
  }
  return undefined
}

function count(pattern: RegExp, text: string): number | undefined {
  const m = pattern.exec(text)
  return m ? parseInt(m[1], 10) : undefined
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Collapse a captured title and drop the decorations runners append:
 *  timing suffixes and trailing box-drawing rules. */
function cleanTestName(s: string): string {
  return collapse(s)
    .replace(/[ \t]*\[[ \t]*[\d.]+[ \t]*(?:ms|s|m|h)?[ \t]*\]$/, '')
    .replace(/[ \t]*\([\d.]+(?:ms|s|m|h)\)$/, '')
    .replace(/[ \t]*[\u2500\u2501\u2550]+[ \t]*$/, '')
    .replace(/[ \t]*\d+(?:\.\d+)?(?:ms|s)$/, '')
    .trim()
}

/** A failing name is reported as one trimmed non-empty line, or not at all. */
function sanitizeName(name: string | undefined): string | undefined {
  if (typeof name !== 'string') return undefined
  const oneLine = name
    .replace(/\r/g, ' ')
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(' ')
  const cleaned = cleanTestName(oneLine)
  if (!cleaned || !/\p{L}|\p{N}/u.test(cleaned)) return undefined
  return untrustedDisplaySlot(cleaned)
}

/** mocha / cypress style numbered failure list, one level per line:
 *    1) Suite
 *         nested suite
 *           test name:  */
function numberedColonName(lines: string[]): string | undefined {
  // The failure list is printed at two spaces of indent; a deeper N) line is
  // live progress inside a suite tree, so a two-space block always wins.
  const heads: Array<{ i: number; indent: number; head: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)(\d+)\)[ \t]+(.+)$/.exec(lines[i])
    if (m) heads.push({ i, indent: m[1].length, head: m[3] })
  }
  if (heads.length === 0) return undefined
  const preferred = heads.filter((h) => h.indent === 2)
  const ordered = preferred.length > 0 ? preferred : heads
  for (const h of ordered) {
    const parts: string[] = [collapse(h.head)]
    for (let j = h.i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim() === '') break // the block ends at a blank line
      const nm = /^[ \t]{2,}(.+?):[ \t]*$/.exec(line)
      if (nm && !isFailureProse(nm[1])) {
        parts.push(collapse(nm[1])) // the test name carries the trailing colon
        break
      }
      const sm = /^[ \t]{2,}(.+)$/.exec(line)
      if (sm && !isFailureProse(sm[1]) && collapse(sm[1]).length <= 120) {
        parts.push(collapse(sm[1])) // an enclosing suite, one level deeper
        continue
      }
      break
    }
    const name = parts.filter((p) => p.length > 0).join(' ').replace(/:$/,'').trim()
    if (name.length > 0) return name
  }
  return undefined
}

/** Error prose printed under a failure block, never a title. */
function isFailureProse(s: string): boolean {
  return /error|expected|assert|actual|at |stack|throw|exception|traceback|\u203A|\u2500/i.test(s)
}

/** XCTest identifies a test as -[Module.Class test]: the module is dropped. */
function xctestNameOf(id: string): string {
  const parts = id.split(' ')
  const cls = parts[0].split('.').pop() // the module prefix is dropped
  return (cls || parts[0]) + '.' + parts.slice(1).join(' ')
}

/** XCTest announces a failure twice: a Test Case '-[Module.Class test]'
 *  failed (…) line and, before it, a <path>:<line>: error: -[Module.Class
 *  test] : <message> line. Either form names the first failing test. */
function xctestFailureName(lines: string[]): string | undefined {
  for (const line of lines) {
    const tc = /^[ \t]*(?:\d{4}-\d{2}-\d{2}[ \t][\d:.]+[ \t])?(?:xctest\[\d+(?::\d+)*\][ \t])?Test Case[ \t]+'-\[([^']+)\]'[ \t]+failed/.exec(line)
    if (tc) return xctestNameOf(tc[1])
    const er = /error:[ \t]*-\[([^[\]]+)\]/.exec(line)
    if (er) return xctestNameOf(er[1])
  }
  return undefined
}

/** TAP / node:test: the first failing test, descending into subtests. */
function tapName(lines: string[], marker: 'tap' | 'cross'): string | undefined {
  const reT = marker === 'tap' ? /^([ \t]*)not ok \d+(?: - )?(.*)$/ : /^([ \t]*)[✖xX✗×][ \t]+(.*)$/
  let best: { name: string; indent: number } | null = null
  for (const line of lines) {
    const m = reT.exec(line)
    if (!m) continue
    const indent = m[1].length
    let name = m[2]
    if (marker === 'cross') name = name.replace(/[ \t]*\([\d.]+m?s\)[ \t]*$/, '')
    if (!name) continue
    if (!best || indent > best.indent) best = { name: collapse(name), indent }
  }
  return best?.name
}

function parseCountsGeneric(text: string): { failed?: number; passed?: number } {
  const failed = count(/(\d+) ?(?:failed|failures?|failing)/i, text)
  const passed = count(/(\d+) (?:passed|passing|pass\b)/i, text)
  const out: { failed?: number; passed?: number } = {}
  if (failed !== undefined) out.failed = failed
  if (passed !== undefined) out.passed = passed
  return out
}

function toolInfo(tool: string, lines: string[], text: string): Info {
  const info: Info = {}
  const t = tool.toLowerCase()
  const numFailed = count(/(\d+)[ \t]+fail(?:ed|ures?|ing)?/i, text)
  const numPassed = count(/(\d+)[ \t]+pass(?:ed|ing)?/i, text)

  switch (t) {
    case 'jest': {
      // a ● Console block holds captured console output, not a failing test
      const bullet = lines
        .map((l) => /^[ \t]*●[ \t]+(.+)$/.exec(l)?.[1])
        .find((t) => t !== undefined && collapse(t).toLowerCase() !== 'console')
      info.name = collapse(bullet ?? '')
      const testsLine = /^[ \t]*Tests:[ \t]*(.*)$/m.exec(text)?.[1] ?? ''
      const suitesLine = /^[ \t]*Test Suites:[ \t]*(.*)$/m.exec(text)?.[1] ?? ''
      const f = count(/(\d+) failed/, testsLine)
      const p = count(/(\d+) passed/, testsLine) ?? count(/(\d+) passed/, suitesLine)
      if (f !== undefined) info.failed = f
      else if (p !== undefined && testsLine) info.failed = 0
      if (p !== undefined) info.passed = p
      info.failSignal = /\d+ failed/.test(text) && /(Tests|Test Suites):/.test(text)
      info.passSignal = /Test Suites:[^\n]*\d+ passed/.test(text) || (info.failed === 0 && !!/Tests:/.test(text))
      break
    }
    case 'vitest': {
      // FAIL <file> > [suite >] name: everything after the file is the title,
      // so a top-level failure is named by the test name alone
      let failName: string | undefined
      for (const line of lines) {
        const fm = /^[ \t]*FAIL[ \t]+(.+)$/.exec(line)
        if (!fm) continue
        const parts = fm[1].split(/[ \t]*>[ \t]*/)
        if (parts.length < 2) continue // a file-only FAIL block header
        const cand = cleanTestName(parts.slice(1).join(' > '))
        if (cand) {
          failName = cand
          break
        }
      }
      const cross = tapName(lines, 'cross')
      info.name = failName !== undefined ? failName : cross !== undefined ? cleanTestName(cross) : undefined
      // a failed-only summary (Tests  1 failed (1)) carries no passed part
      const m = /^[ \t]*Tests:?[ \t]+(\d+) failed(?:[ \t]*\|[ \t]*(\d+) passed)?/m.exec(text)
      if (m) {
        info.failed = parseInt(m[1], 10)
        if (m[2] !== undefined) info.passed = parseInt(m[2], 10)
      } else {
        const p = /^[ \t]*Tests:?[ \t]+(\d+) passed/m.exec(text)
        if (p) {
          info.failed = 0
          info.passed = parseInt(p[1], 10)
        }
      }
      // only the summary decides: a killed run shows failing marks, no totals
      info.failSignal = (info.failed ?? 0) > 0
      info.passSignal = (info.failed ?? 0) === 0 && /^[ \t]*Tests:?[ \t]+\d+ passed/m.test(text)
      break
    }
    case 'mocha':
    case 'cypress':
    case 'karma': {
      if (t === 'karma') {
        // karma prefixes failures with the browser, e.g.
        // "Chrome 129.0.0.0 (Mac OS) kiwi parser should read a header FAILED"
        const k = /^[ \t]*(?:\S+ [^(]*\([^)]*\)[ \t]*)?(.+?)[ \t]+FAILED[ \t]*$/m.exec(text)
        info.name = k ? collapse(k[1]) : numberedColonName(lines)
      } else {
        info.name = numberedColonName(lines)
      }
      const box = text.match(/Tests:[ \t]*(\d+)[ \t]+failed:[ \t]*(\d+)[ \t]+passed:[ \t]*(\d+)/)
      const karmaTotal = text.match(/TOTAL:[ \t]*(\d+) FAILED,[ \t]*(\d+) SUCCESS/)
      const p = box ? parseInt(box[3], 10) : karmaTotal ? parseInt(karmaTotal[2], 10) : count(/(\d+) passing/, text)
      const f = box ? parseInt(box[2], 10) : karmaTotal ? parseInt(karmaTotal[1], 10) : count(/(\d+) failing/, text)
      if (f !== undefined) info.failed = f
      else if (p !== undefined) info.failed = 0
      if (p !== undefined) info.passed = p
      info.failSignal = (f ?? 0) > 0 // only a totals line proves the run finished
      info.passSignal = /\d+ passing/.test(text) || (box ? parseInt(box[2], 10) === 0 : false)
      break
    }
    case 'ava': {
      const n = re(/^[ \t]*✘[ \t]*(?:\[fail\]:[ \t]*)?(.+?)[ \t]*(?:\[[\d:.]+\])?$/, lines)
      info.name = n ? collapse(n) : undefined
      const f = count(/(\d+) tests? failed/, text)
      const p = count(/(\d+) (?:tests? )?passed/, text)
      if (f !== undefined) info.failed = f
      if (p !== undefined) info.passed = p
      info.failSignal = /\d+ tests? failed/.test(text)
      info.passSignal = /passed/.test(text)
      break
    }
    case 'uvu':
    case 'jasmine': {
      if (t === 'jasmine') {
        info.name = collapse(re(/^[ \t]*(\d+)\)[ \t]+(.+)$/, lines, 2) ?? '')
        const f = count(/(\d+) failures?/, text)
        const tot = count(/(\d+) specs?/, text)
        if (f !== undefined) info.failed = f
        if (tot !== undefined && f !== undefined) info.passed = Math.max(0, tot - f)
      } else {
        info.name = collapse(re(/^[ \t]*✘[ \t]+(.+)$/, lines) ?? '')
        // (n/m) lines are live progress; only the totals block ends a run
        const totals = /Σ Total: \((\d+)\/(\d+)\)/.exec(text)
        const p = count(/Passed:[ \t]*(\d+)/, text) ?? (totals ? parseInt(totals[1], 10) : undefined)
        const f = count(/Failed:[ \t]*(\d+)/, text) ?? (totals ? parseInt(totals[1], 10) - parseInt(totals[2], 10) : undefined)
        if (f !== undefined) info.failed = f
        if (p !== undefined) info.passed = p
      }
      info.failSignal = (info.failed ?? 0) > 0
      info.passSignal = /Σ Total:|Passed:[ \t]*\d+/.test(text) && (info.failed ?? 0) === 0
      break
    }
    case 'tap':
    case 'node': {
      const asJson = /"Action":\s*"fail"/.test(text)
      if (t === 'node' && asJson) {
        for (const line of lines) {
          if (!line.startsWith('{')) continue
          if (!/"Action":\s*"fail"/.test(line)) continue
          const tm = /"Test":\s*"([^"]+)"/.exec(line)
          if (tm) {
            info.name = tm[1]
            break
          }
        }
        let failed = 0
        let passed = 0
        for (const line of lines) {
          if (!line.startsWith('{')) continue
          if (/"Parent":\s*"/.test(line) || !/"Test":\s*"/.test(line)) continue
          if (/"Action":\s*"pass"/.test(line)) passed++
          else if (/"Action":\s*"fail"/.test(line)) failed++
        }
        info.failed = failed
        info.passed = passed
        info.failSignal = failed > 0
        info.passSignal = failed === 0 && passed > 0
        break
      }
      info.name = tapName(lines, 'tap') ?? (t === 'node' ? tapName(lines, 'cross') : undefined)
      const tests = count(/^[ \t]*# tests (\d+)$/m, text) ?? count(/^[ℹ \t]*tests (\d+)$/m, text)
      const f = count(/^[ \t]*# fail (\d+)$/m, text) ?? count(/^[ℹ \t]*fail (\d+)$/m, text)
      const p = count(/^[ \t]*# pass (\d+)$/m, text) ?? count(/^[ℹ \t]*pass (\d+)$/m, text)
      if (f !== undefined) info.failed = f
      if (p !== undefined) info.passed = p
      if (tests !== undefined && f === undefined && p !== undefined) info.passed = p
      // the fail count line is printed last in the summary block: without it
      // the run has not finished, whatever the pass count already says
      info.failSignal = (f ?? 0) > 0 || /Bail out!/.test(text)
      info.passSignal = f !== undefined && f === 0
      break
    }
    case 'deno': {
      const inErrors = text.includes('ERRORS')
      if (inErrors) {
        info.name = collapse(re(/^(.+?) => \S+:\d+$/, lines) ?? '')
      }
      const f = count(/(\d+) failed/, text)
      const p = count(/(\d+) passed/, text)
      if (f !== undefined) info.failed = f
      if (p !== undefined) info.passed = p
      info.failSignal = (f ?? 0) > 0 || /^error\(s\)|^fail/m.test(text)
      info.passSignal = /ok \|\s*\d+ passed/.test(text) || ((f ?? 0) === 0 && /\d+ passed/.test(text))
      break
    }
    case 'bun': {
      const n = re(/^\(fail\)[ \t]+(.+)$/, lines)
      info.name = n ? collapse(n).replace(/[ \t]*\[[\d.]+ms\]$/, '') : undefined
      const p = count(/(\d+)[ \t]+pass\b/i, text)
      const f = count(/(\d+)[ \t]+fail(?:ed)?\b/i, text)
      if (p !== undefined) info.passed = p
      if (f !== undefined) info.failed = f
      info.failSignal = (f ?? 0) > 0
      info.passSignal = /\d+ pass/.test(text) && (f ?? 0) === 0
      break
    }
    case 'playwright': {
      // 1) [project] › path/file.spec.ts:12:5 › suite › name ------
      const m = /^[ \t]*\d+\)[ \t]+(.+)$/m.exec(text)
      if (m) {
        const seg = cleanTestName(m[1]).split(/[ \t]*›[ \t]*/)
        while (seg.length > 1) {
          const s = seg[0].trim()
          if (/^\[[^\]]*\]$/.test(s) || /:\d+:\d+$/.test(s)) seg.shift() // project, location
          else break
        }
        info.name = seg.join(' › ')
      }
      const f = count(/^[ \t]*(\d+) failed/m, text)
      const p = count(/^[ \t]*(\d+) passed/m, text)
      if (f !== undefined) info.failed = f
      if (p !== undefined) info.passed = p
      info.failSignal = (f ?? 0) > 0
      info.passSignal = /\d+ passed/.test(text) && (f ?? 0) === 0
      break
    }
    case 'pytest': {
      const line = lines.find((l) => /^(FAILED|ERROR)[ \t]/.test(l))
      if (line) {
        const kind = line.startsWith('FAILED') ? 'FAILED' : 'ERROR'
        let rest = line.slice(kind.length).trim()
        const cut = rest.indexOf(' - ')
        const node = cut >= 0 ? rest.slice(0, cut) : rest.split(/\s+-\s/)[0]
        info.name = collapse(node || rest)
      }
      const f = count(/(\d+) failed/, text)
      const e = count(/(\d+) errors?/, text)
      const p = count(/(\d+) passed/, text)
      if (f !== undefined || e !== undefined) info.failed = (f ?? 0) + (e ?? 0)
      if (p !== undefined) info.passed = p
      info.failSignal = (info.failed ?? 0) > 0 || /^FAILED/m.test(text)
      info.passSignal = (info.failed ?? 0) === 0 && /\d+ passed/.test(text)
      break
    }
    case 'unittest': {
      const m = /^[ \t]*(FAIL|ERROR):[ \t]+(.+?)[ \t]+\((.+)\)$/m.exec(text)
      if (m) info.name = collapse(m[3])
      const ran = count(/Ran (\d+) tests?/, text)
      const fails = count(/failures=(\d+)/, text)
      const errs = count(/errors=(\d+)/, text)
      const failed = (fails ?? 0) + (errs ?? 0)
      if (ran !== undefined) {
        info.passed = Math.max(0, ran - failed)
        info.failed = failed
      }
      info.failSignal = /^FAILED|failures=[1-9]|errors=[1-9]/m.test(text)
      info.passSignal = /^OK\b/m.test(text)
      break
    }
    case 'cargo': {
      info.name = collapse(re(/^test (.+?)\s*\.\.\.\s*FAILED\s*$/, lines) ?? '')
      let passed = 0
      let failed = 0
      let seen = false
      for (const m of text.matchAll(/test result: (ok|FAILED|failed)\. (\d+) passed; (\d+) failed/g)) {
        seen = true
        passed += parseInt(m[2], 10)
        failed += parseInt(m[3], 10)
      }
      if (seen) {
        info.passed = passed
        info.failed = failed
      }
      info.failSignal = /test result: FAILED|error\[|^error:/m.test(text)
      info.passSignal = /test result: ok/.test(text) && !/test result: FAILED/.test(text)
      break
    }
    case 'nextest': {
      const m = /^[ \t]*FAIL \[[^\]]*\][ \t]+(\S+)[ \t]+(.+)$/m.exec(text)
      if (m) info.name = collapse(m[2])
      const f = count(/(?:failed|Failed):[ \t]*(\d+)/, text) ?? count(/(\d+) failed/, text)
      const p = count(/(?:passed|Passed):[ \t]*(\d+)/, text) ?? count(/(\d+) passed/, text)
      const run = count(/(?:run|Run):[ \t]*(\d+)/, text) ?? count(/(\d+) tests run/, text)
      if (f !== undefined) info.failed = f
      if (p !== undefined) info.passed = p
      if (p === undefined && run !== undefined && f !== undefined) info.passed = Math.max(0, run - f)
      info.failSignal = (f ?? 0) > 0 || /^error: test run failed/m.test(text)
      info.passSignal = /^Summary/m.test(text) && (f ?? 0) === 0
      break
    }
    case 'go': {
      // a package level fail event (no Test field) ends a -json run: a summary
      let jsonPkgFailed = false
      for (const line of lines) {
        if (!line.startsWith('{')) continue
        if (!/"Test":/.test(line) && /"Action":.*fail/.test(line)) jsonPkgFailed = true
      }
      if (/"Action":\s*"fail"/.test(text)) {
        for (const line of lines) {
          if (!line.startsWith('{')) continue
          if (!/"Action":\s*"fail"/.test(line)) continue
          const tm = /"Test":\s*"([^"]+)"/.exec(line)
          if (tm) {
            info.name = tm[1]
            break
          }
        }
        let failed = 0
        let passed = 0
        for (const line of lines) {
          if (!line.startsWith('{')) continue
          if (/"Parent":\s*"/.test(line) || !/"Test":\s*"/.test(line)) continue
          if (/"Action":\s*"pass"/.test(line)) passed++
          else if (/"Action":\s*"fail"/.test(line)) failed++
        }
        info.failed = failed
        info.passed = passed
      } else {
        info.name = collapse(re(/^--- FAIL: (\S+)/, lines) ?? '')
        // per-test FAIL marks are live output; counts are only trusted when a
        // package result line (ok/FAIL) closed the run
        if (/^(?:ok|FAIL)\b/m.test(text)) {
          const fails = (text.match(/^--- FAIL:/gm) ?? []).length
          const passes = (text.match(/^--- PASS:/gm) ?? []).length
          info.failed = fails
          if (passes > 0) info.passed = passes
        }
      }
      info.failSignal = /^FAIL\b/m.test(text) || jsonPkgFailed
      info.passSignal = /^ok[ \t]/m.test(text) && !info.failSignal
      break
    }
    case 'gradle': {
      const m = /^[ \t]*(\S+) > (.+?)[ \t]+FAILED$/m.exec(text)
      if (m) info.name = `${collapse(m[1])} > ${collapse(m[2])}`
      const c = /(\d+) tests completed, (\d+) failed/m.exec(text)
      if (c) {
        info.passed = parseInt(c[1], 10) - parseInt(c[2], 10)
        info.failed = parseInt(c[2], 10)
      }
      info.failSignal = /BUILD FAILED|> Task .*FAILED/.test(text)
      info.passSignal = /BUILD SUCCESSFUL/.test(text)
      break
    }
    case 'mvn': {
      // [ERROR]   ClassName.testName:12 message; the Failures: and
      // Tests in error: headers must not become the name
      const m = /^[ \t]*\[ERROR\][ \t]+(\S+?):\d+(?:[ \t]|$)/m.exec(text)
      if (m && /\./.test(m[1]) && !/[\\/]/.test(m[1])) info.name = collapse(m[1])
      else {
        // surefire 2.x lists failures as testName(ClassName)  <<< FAILURE!
        const old = /^[ \t]*\[ERROR\][ \t]+(\S+?)\(([\w.$]+)\)[ \t]+Time elapsed/m.exec(text)
        if (old && !/[\\/=]/.test(old[1])) info.name = collapse(old[2] + '.' + old[1])
      }
      let run = 0
      let fails = 0
      let errors = 0
      let skipped = 0
      let seen = false
      const parts = text.split(/Results:/)
      const blocks = parts.length > 1 ? parts.slice(1) : [text]
      for (const block of blocks) {
        for (const mm of block.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/g)) {
          seen = true
          run += parseInt(mm[1], 10)
          fails += parseInt(mm[2], 10)
          errors += parseInt(mm[3], 10)
          skipped += parseInt(mm[4], 10)
          break // one total per Results section
        }
      }
      if (seen) {
        info.failed = fails + errors
        info.passed = Math.max(0, run - fails - errors - skipped)
      }
      info.failSignal = /BUILD FAILURE|Tests run:[^\n]*(?:Failures|Errors): [1-9]/.test(text)
      info.passSignal = /BUILD SUCCESS/.test(text)
      break
    }
    case 'sbt': {
      const m = /^[ \t]*(?:\[info\][ \t]*)?-[ \t]+(.+?)[ \t]*\*\*\* FAILED \*\*\*$/m.exec(text)
      if (m) info.name = collapse(m[1])
      const c = /Total number of tests run: (\d+), Failures: (\d+), Errors: (\d+)/m.exec(text)
      if (c) {
        const f = parseInt(c[2], 10) + parseInt(c[3], 10)
        info.failed = f
        info.passed = Math.max(0, parseInt(c[1], 10) - f)
      } else {
        const st = /Tests: succeeded (\d+), failed (\d+)/m.exec(text)
        const tot = /Total number of tests run: (\d+)/m.exec(text)
        if (st) {
          info.failed = parseInt(st[2], 10)
          info.passed = parseInt(st[1], 10)
        }
        if (tot && info.failed === undefined) info.passed = parseInt(tot[1], 10)
      }
      info.failSignal = (info.failed ?? 0) > 0 || /\*\*\* \d+ TESTS? FAILED \*\*\*/.test(text)
      info.passSignal = /\[success\]|Total number of tests run/.test(text) && !/\*\*\* FAILED \*\*\*/.test(text)
      break
    }
    case 'dotnet': {
      const m = /^[ \t]*(?:Failed|Failed!)[ \t]+(\S+?)[ \t]*\[/m.exec(text)
      if (!m) {
        const alt = /^[ \t]*Failed[ \t]+(\S+)[ \t]*\[/m.exec(text)
        if (alt) info.name = collapse(alt[1])
      } else info.name = collapse(m[1])
      const failed = count(/Failed:[ \t]*(\d+)/, text)
      const passed = count(/Passed:[ \t]*(\d+)/, text)
      const failed2 = count(/[ \t](\d+) failed/m, text)
      const passed2 = count(/[ \t](\d+) passed/m, text)
      if (failed !== undefined || failed2 !== undefined) info.failed = failed ?? failed2
      if (passed !== undefined || passed2 !== undefined) info.passed = passed ?? passed2
      if (info.failed === undefined && info.passed !== undefined && /Passed!|Test Run Successful/.test(text)) info.failed = 0
      info.failSignal = (info.failed ?? 0) > 0 || /Failed!|Test Run Failed/.test(text)
      info.passSignal = /Passed!|Build succeeded/.test(text)
      break
    }
    case 'xcodebuild': {
      // Test Case '-[Module.ClassName testName]' failed (0.012 seconds), or the
      // earlier <path>:<line>: error: -[Module.ClassName testName] line
      info.name = xctestFailureName(lines)
      const c = /Executed (\d+) tests?, with (\d+) failures?/m.exec(text)
      if (c) {
        info.failed = parseInt(c[2], 10)
        info.passed = Math.max(0, parseInt(c[1], 10) - parseInt(c[2], 10))
      }
      info.failSignal = /\*\* TEST FAILED \*\*|with [1-9]\d* failures?/.test(text)
      info.passSignal = /\*\* TEST SUCCEEDED \*\*/.test(text) || /with 0 failures/.test(text)
      break
    }
    case 'swift': {
      // `swift test` prints XCTest output as readily as swift-testing output;
      // a Test Case '…' failed or error: -[Module.Class test] line is XCTest
      const xt = xctestFailureName(lines)
      if (xt !== undefined) info.name = xt
      else {
        const m = /^[ \t]*✘[ \t]+Test[ \t]+(.+?)(?:[ \t]+recorded an issue.*)?$/m.exec(text)
        if (m) info.name = collapse(m[1])
        else {
          const sm = /^[ \t]*✘[ \t]+(.+)$/m.exec(text)
          if (sm && !/^Test run/.test(sm[1])) info.name = collapse(sm[1])
        }
      }
      const exec = /Executed (\d+) tests?, with (\d+) failures?/m.exec(text)
      if (exec) {
        // XCTest totals win when the run prints them
        info.failed = parseInt(exec[2], 10)
        info.passed = Math.max(0, parseInt(exec[1], 10) - parseInt(exec[2], 10))
      } else {
        const summary = /: (\d+) tests? failed/.exec(text)
        const distinct = new Set<string>()
        for (const m of text.matchAll(/^[ \t]*✘[ \t]+(?!Test run )(.*?)(?:[ \t]+recorded an issue.*)?$/gm)) {
          if (m[1].trim()) distinct.add(collapse(m[1]))
        }
        const total = count(/Test run with (\d+) tests?/, text)
        let failed = summary ? parseInt(summary[1], 10) : undefined
        // marks are only counted when the run reached its own total line
        if (failed === undefined && total !== undefined) failed = distinct.size
        if (failed !== undefined) info.failed = failed
        if (total !== undefined && failed !== undefined) info.passed = Math.max(0, total - failed)
      }
      info.failSignal = /Test run with \d+ tests? failed/.test(text) || (info.failed ?? 0) > 0 || /\*\* TEST FAILED \*\*/.test(text)
      info.passSignal = /Test run with \d+ tests? passed/.test(text) || /with 0 failures/.test(text)
      break
    }
    case 'rspec': {
      const m = /^rspec (\S+?):\d+(?:#\d+)?[ \t]+#[ \t]*(.+)$/m.exec(text)
      if (m) info.name = collapse(m[2])
      const c = /(\d+) examples?, (\d+) failures?/m.exec(text)
      if (c) {
        info.failed = parseInt(c[2], 10)
        info.passed = Math.max(0, parseInt(c[1], 10) - parseInt(c[2], 10))
      }
      info.failSignal = (info.failed ?? 0) > 0
      info.passSignal = /examples?, 0 failures/.test(text)
      break
    }
    case 'ruby': // minitest through `ruby -Itest`
    case 'rake':
    case 'rails': {
      const idx = lines.findIndex((l) => /^[ \t]*(?:\d+\)[ \t]*)?(Failure|Error):?[ \t]*$/.test(l))
      if (idx >= 0) {
        for (let j = idx + 1; j < Math.min(idx + 3, lines.length); j++) {
          const nm = /^[ \t]*(\S+#[A-Za-z0-9_]+)/.exec(lines[j])
          if (nm) {
            info.name = collapse(nm[1])
            break
          }
        }
      }
      const runs = count(/(\d+) runs/, text)
      const fails = count(/(\d+) failures/, text)
      const errs = count(/(\d+) errors/, text)
      if (fails !== undefined || errs !== undefined) info.failed = (fails ?? 0) + (errs ?? 0)
      if (runs !== undefined) info.passed = Math.max(0, runs - ((info.failed ?? 0)))
      info.failSignal = (info.failed ?? 0) > 0
      info.passSignal = /\d+ runs/.test(text) && (info.failed ?? 0) === 0
      break
    }
    case 'phpunit':
    case 'pest': {
      const m = /^[ \t]*(\d+)\)[ \t]+(\S+?)(?:\(\))?$/m.exec(text)
      if (m) info.name = collapse(m[2])
      const pest = /Tests:[ \t]*(\d+) failed,[ \t]*(\d+) passed/m.exec(text)
      if (pest) {
        info.failed = parseInt(pest[1], 10)
        info.passed = parseInt(pest[2], 10)
      }
      const tot = count(/Tests: (\d+)/, text)
      const fails = count(/Failures: (\d+)/, text)
      const errs = count(/Errors: (\d+)/, text)
      const skipped = count(/Skipped: (\d+)/, text)
      if (fails !== undefined || errs !== undefined) info.failed = (fails ?? 0) + (errs ?? 0)
      if (tot !== undefined) info.passed = Math.max(0, tot - (info.failed ?? 0) - (skipped ?? 0))
      if (tot === undefined) {
        const ok = count(/OK \((\d+) tests?,/, text)
        if (ok !== undefined) info.passed = ok
      }
      info.failSignal = /FAILURES!|ERRORS!|Failures: [1-9]|Errors: [1-9]/.test(text)
      info.passSignal = /^OK \(|^WARNINGS!/m.test(text)
      break
    }
    case 'mix': {
      const m = /^[ \t]*(\d+)\)[ \t]+(.+?)[ \t]+\((.+)\)$/m.exec(text)
      if (m) info.name = `${collapse(m[3])}: ${collapse(m[2])}`
      const c = /(\d+) tests?, (\d+) failures?/m.exec(text)
      if (c) {
        info.failed = parseInt(c[2], 10)
        info.passed = Math.max(0, parseInt(c[1], 10) - parseInt(c[2], 10))
      }
      info.failSignal = (info.failed ?? 0) > 0
      info.passSignal = /\d+ tests?, 0 failures/.test(text)
      break
    }
    case 'ctest': {
      const m = /^[ \t]*(\d+) - (\S+) \((?:Failed|Timeout|Not Run)\)/m.exec(text)
      if (m) info.name = collapse(m[2])
      const c = /(\d+) tests? failed out of (\d+)/m.exec(text)
      if (c) {
        info.failed = parseInt(c[1], 10)
        info.passed = Math.max(0, parseInt(c[2], 10) - parseInt(c[1], 10))
      }
      info.failSignal = /tests? failed/.test(text)
      info.passSignal = /tests? passed/.test(text)
      break
    }
    case 'dart':
    case 'flutter': {
      const stripDart = (s: string) => s.replace(/^\d\d:\d\d(?:\.\d+)?(?: \+\d+(?: -\d+)?)?: /, '')
      for (const line of lines) {
        if (!/\[E\][ \t]*$/.test(line)) continue
        const title = stripDart(line)
          .replace(/\[E\][ \t]*$/, '')
          .replace(/^[ \t]*[✖xX]?[ \t]*/, '')
          .replace(/^\[E\][ \t]*/, '')
        if (title.trim()) {
          info.name = collapse(title)
          break
        }
      }
      // the +N counter ticks on every live progress line; only the closing
      // sentence proves the run reached its end
      const lastLine = [...text.matchAll(/\+(\d+)(?:[ \t]+-(\d+))?/g)].pop()
      if (lastLine && /Some tests failed|All tests passed!/.test(text)) {
        info.passed = parseInt(lastLine[1], 10)
        if (lastLine[2] !== undefined) info.failed = parseInt(lastLine[2], 10)
      }
      info.failSignal = (info.failed ?? 0) > 0 || /Some tests failed/.test(text)
      info.passSignal = /All tests passed!/.test(text)
      break
    }
    default: {
      // wrappers (npm/pnpm/yarn/bun/composer/turbo/nx/...) run an inner tool:
      // scan every known name format, most specific first.
      info.name =
        numberedColonName(lines) ??
        collapse(re(/^[ \t]*●[ \t]+(.+)$/, lines) ?? '') ??
        (text.match(/^[ \t]*FAIL[ \t]+\S+[ \t]*>[ \t]*(.+)$/m)?.[1]
          ? collapse((text.match(/^[ \t]*FAIL[ \t]+\S+[ \t]*>[ \t]*(.+)$/m) ?? [])[1])
          : undefined) ??
        tapName(lines, 'tap') ??
        tapName(lines, 'cross') ??
        collapse(re(/^test (.+?)\s*\.\.\.\s*FAILED\s*$/, lines) ?? '') ??
        collapse(re(/^--- FAIL: (\S+)/, lines) ?? '') ??
        (text.match(/^[ \t]*FAIL \[[^\]]*\][ \t]+\S+[ \t]+(.+)$/m)?.[1] ?? undefined) ??
        collapse(re(/^rspec (\S+?):\d+(?:#\d+)?[ \t]+#[ \t]*(.+)$/, lines, 2) ?? '') ??
        undefined
      const generic = parseCountsGeneric(text)
      info.failed = generic.failed
      info.passed = generic.passed
      info.failSignal = (generic.failed ?? 0) > 0
      info.passSignal = (generic.failed ?? 0) === 0 && (generic.passed ?? 0) > 0
      break
    }
  }

  // build tools: outcome from the build's own success/failure wording.
  // Only build-only tools: dual test/build tools (cargo, go, make, zig, mix,
  // sbt, bazel, buck2) must not claim fail from bare error words — a panicked
  // test run that was killed says "error:" with no verdict line, and a run
  // with no summary and a null exit is unknown, not fail.
  if (!info.failSignal && !info.passSignal) {
    if (/(^|[ \t✖●])(error|ERROR)([ \t:]| in )/.test(text) && /(tsc|webpack|vite|rollup|esbuild|tsup|parcel|next|nuxt|astro|svelte|cmake|ninja|pip|build)/.test(t)) {
      info.failSignal = true
    }
    if (/(built in|Build finished|compiled successfully|BUILD SUCCESSFUL|BUILD SUCCESS|build succeeded|✓ built|Done in)/i.test(text)) {
      info.passSignal = true
    }
  }
  // every reported name is one trimmed, non-empty line without decorations,
  // whatever branch produced it
  info.name = sanitizeName(info.name)
  return info
}

export function parseResult(tool: string, output: string, exitCode: number | null): RunResult {
  try {
    const raw = typeof output === 'string' ? output : ''
    const text = window(stripAnsi(raw))
    const lines = text.split('\n')
    const info = toolInfo(String(tool ?? ''), lines, text)
    let outcome: RunResult['outcome']
    if (typeof exitCode === 'number') {
      outcome = exitCode === 0 ? 'pass' : 'fail'
    } else {
      outcome = info.failSignal ? 'fail' : info.passSignal ? 'pass' : 'unknown'
    }
    const result: RunResult = { outcome }
    if (outcome === 'fail' && info.name) result.firstFailing = info.name
    if (info.failed !== undefined) result.failed = info.failed
    if (info.passed !== undefined) result.passed = info.passed
    return result
  } catch {
    return { outcome: 'unknown' }
  }
}

/* ------------------------------------------------------------------ *
 * 6. History
 * ------------------------------------------------------------------ */

export function record(history: History, key: string, sample: Sample, cap?: number): History {
  try {
    const limit = typeof cap === 'number' && isFinite(cap) ? Math.max(0, Math.floor(cap)) : 20
    const source = history && typeof history === 'object' ? history : {}
    const out: History = {}
    for (const k of Object.keys(source)) out[k] = source[k]
    const prev = Array.isArray(source[key]) ? source[key] : []
    const next = limit > 0 ? [...prev, sample].slice(-limit) : []
    out[key] = next
    return out
  } catch {
    return {}
  }
}

function median(sorted: number[]): number {
  const n = sorted.length
  const mid = Math.floor(n / 2)
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function judge(history: History, key: string, ms: number): Slowness {
  try {
    const samples = (history && typeof history === 'object' && Array.isArray(history[key]) ? history[key] : []).filter(
      (s) => s && s.outcome === 'pass' && typeof s.ms === 'number' && isFinite(s.ms),
    )
    if (samples.length < 3) return { slow: false }
    const times = samples.map((s) => s.ms).sort((a, b) => a - b)
    const m = median(times)
    const d = median(times.map((x) => Math.abs(x - m)).sort((a, b) => a - b))
    if (!isFinite(m) || m <= 0) return { slow: false, usualMs: Math.round(m) || undefined }
    const ratio = Math.round((ms / m) * 100) / 100
    const slow = m >= 5000 && ms >= 2 * m && ms >= m + 4 * Math.max(d, 0.05 * m)
    return { slow, usualMs: Math.round(m), ratio: isFinite(ratio) ? ratio : undefined }
  } catch {
    return { slow: false }
  }
}
