// The notices: his spark beside a comment he liked, the margin note under a good commit message,
// Shiori's place in a task list, his shelf, the notes when Claude seems stuck, and a few costume reactions.
// Zero tokens: every piece rides a tool result the plugin already receives; the reading itself runs
// in notice-worker.mjs, never in a hook's path. What was read is never stored: no comment, quote,
// commit message or function name leaves session memory, and the shelf keeps only relative file names.
import { c3Word, loadC3Words } from './c3-words'
import { fill } from './mood'

export type NoticeLine = { key: string; text: string; class: 0 | 1 | 2 | 3; ttl?: number; untilTurn?: boolean; slots?: { value: string; kind: 'path' | 'test' | 'todo' | 'value' | 'label' }[]; button?: { key: string; label: string } }
export type Place = { i: number; n: number; subject: string; dip: number }
export type Costume = { rain?: true; glasses?: true; bow?: true }

export type NoticeCap = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  remove: (key: string) => Promise<void>
  process: (argv: string[], options?: { stdin?: string; timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; isStdoutTruncated?: boolean }>
  now: () => number
  lang: () => string
  localDay: (at: number) => string
  marks: () => Promise<'on' | 'replies' | 'off'>
  settings: () => { notes: boolean; bookmark: boolean }
  root: () => Promise<string | undefined>
  screenReader?: () => Promise<boolean>
  workerPath: string
  readWords: () => Promise<string> // hooks/c3-text.json, where his notice words live
  changed: () => void
  emit?: (line: NoticeLine) => 'shown' | 'queued' | 'dropped'
  dismiss?: (key: string) => void
  react?: (kind: 'praise' | 'praise-long' | 'stuck' | 'hair') => void
  committed?: () => void // a commit landed this session (their vibe check counts them)
  place?: (place: Place | undefined) => void
  costume?: (costume: Costume) => void
  after?: (ms: number, run: () => void) => { cancel: () => void }
  diagnostic?: (code: string) => void
}

export type ToolResultInput = {
  id: string
  tool: string
  input: Record<string, unknown>
  result: Record<string, unknown> | undefined
  text?: string
  failed: boolean
  main: boolean
}

export type SparkRow = { line: number; quote?: string; drawn?: boolean }
export type CommitRow = { quality: 'why' | 'long'; quote?: string }
export type Cause = 'circle' | 'long'
export type NoteRow = { cause: Cause; text: string }
export type ShelfView = { names: string[] } | 'empty' | 'error'

// Chinese has three forms for the long, explained message (写得认真, 说得详细, 交代清楚) in words-0.2.i18n.json,
// in the writer's order. Until he picks, the first ships; this index is the one place to change it.
export const ZH_LONG_FORM = 0

const ROWS = 64
const SPARK_GAP_MS = 20 * 60 * 1000
const SPARK_PER_SESSION = 2
const COMMIT_EVERY = 4
// Their LGTM (lane C, 10-14): at most five a repository, ever; the uwu threat at a lone "fix": at most three a day.
const LGTM_PER_REPO = 5, UWU_PER_DAY = 3
const WORKER_LIMIT = 600_000
const SHELF_DAYS = 30
const SHELF_FILES = 16
const SHELF_TOP = 5
const LONG_LINES = 400
const CIRCLE_MIN_LINES = 1000
const CIRCLE_READS = 4
const CIRCLE_MS = 30 * 60 * 1000
const RAIN_MS = 60_000
const GLASSES_LINES = 2000
const DAY_MS = 86_400_000
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const LONG_EXT = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts|go|rs|java|kt|kts|scala|swift|c|h|cc|cpp|cxx|hpp|hh|m|mm|cs|php|dart|py|pyw|pyi|rb|rake)$/i
const SECRET_NAME = /(?:^|\/)(?:\.env[^/]*|id_rsa[^/]*|[^/]*\.(?:pem|key)|[^/]*(?:secret|credential)[^/]*)$/i

const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const base = (path: string): string => path.replaceAll('\\', '/').split('/').pop() || path
const bound = <K, V>(map: Map<K, V>, size = ROWS): void => { while (map.size > size) map.delete(map.keys().next().value!) }
const trim = <V>(record: Record<string, V>): void => { while (Object.keys(record).length > ROWS) delete record[Object.keys(record)[0]!] }

function hash(value: string): number {
  let h = 5381
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h) ^ value.charCodeAt(i)
  return h >>> 0
}

// The path inside the folder's root, with forward slashes; nothing outside it.
export function relativeTo(path: string, root: string | undefined): string | undefined {
  if (!root) return undefined
  const a = path.replaceAll('\\', '/'), b = root.replaceAll('\\', '/').replace(/\/+$/, '')
  const win = /^[A-Za-z]:\//.test(b)
  const [x, y] = win ? [a.toLowerCase(), b.toLowerCase()] : [a, b]
  if (!x.startsWith(y + '/')) return undefined
  const rel = a.slice(b.length + 1)
  return rel && !rel.split('/').includes('..') ? rel : undefined
}

// A name too long for a line is cut in the middle and keeps its extension: token-r…test.ts.
const SHELF_NAME = 36
function cutName(name: string): string {
  const chars = [...name]
  if (chars.length <= SHELF_NAME) return name
  const dot = name.lastIndexOf('.'), extension = dot > 0 && name.length - dot <= 8 ? [...name.slice(dot)].length : 0
  const room = SHELF_NAME - 1 - extension, front = Math.ceil(room / 2), back = room - front
  return chars.slice(0, front).join('') + '…' + chars.slice(chars.length - extension - back).join('')
}

// Two names alike get their nearest parent: api/index.ts and web/index.ts.
export function shelfNames(paths: string[]): string[] {
  const names = paths.map(base)
  return paths.map((path, i) => {
    if (names.filter(name => name === names[i]).length < 2) return names[i]!
    const parts = path.split('/')
    for (let depth = 2; depth <= parts.length; depth++) {
      const tail = parts.slice(-depth).join('/')
      if (paths.filter(other => other.split('/').slice(-depth).join('/') === tail).length < 2) return tail
    }
    return path
  })
}

type ShelfFile = [path: string, days: [day: string, n: number][]]
const latestDay = (file: ShelfFile): string => file[1].reduce((day, [d]) => (d > day ? d : day), '')

export function createNotice(cap: NoticeCap) {
  let interpreter: string | undefined
  let serial = 0
  let live = false
  let rootRead: Promise<string | undefined> | undefined
  let ready: Promise<void> | undefined
  let reader: Promise<boolean> | undefined
  const rows = new Map<string, SparkRow>()
  const seenFiles = new Set<number>(), seenComments = new Set<number>()
  let sparkTurn = false, sparkCount = 0, sparkAt = -Infinity, sparkDirty = false
  let last: { file: string; line: number; quote?: string } | undefined

  const commits = new Map<string, CommitRow>()
  let gap: Record<string, number> = {}, voice: Record<string, { day: string; n: number }> = {}
  let lgtm: Record<string, number> = {}, uwu = { day: '', n: 0 }
  let voicedSession = false

  const todos: { subject: string; status: string }[] = []
  const tasks = new Map<string, { subject: string; status: string }>()
  let placeNow: Place | undefined, dips = 0

  let shelf: Record<string, { files: ShelfFile[] }> = {}
  let shelfDirty = false
  let rootNow = ''
  const turnReads = new Set<string>()

  let notesOff = new Set<Cause>()
  const spoken = new Set<Cause>()
  const noteRows = new Map<string, NoteRow>()
  const ranges = new Map<string, { from: number; to: number; at: number }[]>()
  let notesWas: boolean | undefined
  let costume: Costume = {}
  let rain: { cancel: () => void } | undefined, rainCall: string | undefined

  const diagnose = (code: string): void => cap.diagnostic?.(code)
  const root = (): Promise<string | undefined> => (rootRead ??= cap.root().catch(() => undefined))
  const word = (key: string, slots: Record<string, string | number> = {}): string | undefined =>
    fill(c3Word(cap.lang(), key, key.endsWith('.long') ? ZH_LONG_FORM : 0, typeof slots.m === 'number' ? slots.m : undefined), slots) || undefined
  const save = (key: string, value: unknown): void => { void cap.set(key, value).catch(() => diagnose('notice.store')) }

  async function ensure(): Promise<void> {
    ready ??= (async () => {
      const [stored, g, v, s, off, l, u] = await Promise.all(['sparkRows', 'commitGap', 'commitVoice', 'shelf', 'notesOff', 'commitLgtm', 'commitUwu'].map(key => cap.get(key).catch(() => undefined)))
      if (Array.isArray(stored)) for (const entry of stored.slice(-ROWS)) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && Number.isInteger(entry[1])) rows.set(entry[0], { line: entry[1] as number, drawn: true })
      }
      for (const [name, value] of Object.entries(object(g))) if (Number.isInteger(value)) gap[name] = value as number
      for (const [name, value] of Object.entries(object(v))) { const e = object(value); if (typeof e.day === 'string') voice[name] = { day: e.day, n: Number(e.n) || 1 } }
      for (const [name, value] of Object.entries(object(s))) {
        const files = object(value).files
        shelf[name] = { files: (Array.isArray(files) ? files : []).filter((f): f is ShelfFile => Array.isArray(f) && typeof f[0] === 'string' && Array.isArray(f[1])) }
      }
      if (Array.isArray(off)) notesOff = new Set(off.filter((c): c is Cause => c === 'circle' || c === 'long'))
      for (const [name, value] of Object.entries(object(l))) if (Number.isInteger(value) && (value as number) > 0) lgtm[name] = Math.min(LGTM_PER_REPO, value as number)
      const told = object(u); if (typeof told.day === 'string' && Number.isInteger(told.n)) uwu = { day: told.day, n: told.n as number }
    })()
    await ready
  }

  // One request, one answer: the worker is a fresh process, the text goes in on stdin only.
  async function algorithm(request: Record<string, unknown>): Promise<any> {
    const stdin = JSON.stringify(request)
    if (stdin.length > WORKER_LIMIT) return undefined
    for (const name of interpreter ? [interpreter] : ['node', 'bun']) {
      try {
        const answer = await cap.process([name, cap.workerPath], { stdin, timeoutMs: 30000 })
        if (answer.exitCode !== 0 || answer.isStdoutTruncated) continue
        const envelope = JSON.parse(answer.stdout)
        if (envelope?.ok !== true) continue
        interpreter = name
        return envelope.result
      } catch {}
    }
    diagnose('notice.algorithm.unavailable')
    return undefined
  }

  // ------------------------------------------------------------ the spark

  type Candidate = { abs: string; request: Record<string, unknown> }
  function sparkCandidate(input: Pick<ToolResultInput, 'tool' | 'result'>): Candidate | undefined {
    const r = input.result
    if (!r) return undefined
    if (input.tool === 'Read') {
      const file = object(r.file)
      return r.type === 'text' && text(file.filePath) && text(file.content) !== undefined
        ? { abs: file.filePath as string, request: { mode: 'read', text: file.content, start: Number(file.startLine) || 1 } } : undefined
    }
    if (input.tool === 'NotebookEdit') {
      const path = text(r.notebook_path), source = text(r.new_source)
      const ext: Record<string, string> = { python: 'py', javascript: 'js', typescript: 'ts', r: 'r', julia: 'jl', sql: 'sql' }
      return path && source !== undefined && !r.error && ext[String(r.language).toLowerCase()]
        ? { abs: path, request: { mode: 'cell', text: source, oldText: text(r.old_source) ?? '', pseudo: 'cell.' + ext[String(r.language).toLowerCase()] } } : undefined
    }
    const path = text(r.filePath)
    if (!path) return undefined
    if (input.tool === 'Write' && r.type === 'create' && text(r.content) !== undefined) return { abs: path, request: { mode: 'write', text: r.content } }
    const patch = Array.isArray(r.structuredPatch) ? r.structuredPatch : []
    const hunks = patch.map(h => object(h)).filter(h => Number.isInteger(h.newStart) && Array.isArray(h.lines)).map(h => ({ newStart: h.newStart, lines: h.lines }))
    return hunks.length ? { abs: path, request: { mode: 'edit', hunks } } : undefined
  }

  async function sparkTool(input: ToolResultInput, own: number): Promise<void> {
    if (!FILE_TOOLS.has(input.tool) || sparkTurn || sparkCount >= SPARK_PER_SESSION || cap.now() - sparkAt < SPARK_GAP_MS) return
    const candidate = sparkCandidate(input)
    if (!candidate) return
    const rel = relativeTo(candidate.abs, await root())
    if (!rel) return
    const seen = hash(rel)
    if (seenFiles.has(seen)) return
    const found = await algorithm({ op: 'comment', path: candidate.request.pseudo ?? rel, ...candidate.request })
    if (!found || own !== serial || sparkTurn || sparkCount >= SPARK_PER_SESSION) return
    const mark = hash(rel + '\0' + found.line + '\0' + found.quote)
    if (seenComments.has(mark)) return
    seenFiles.add(seen); seenComments.add(mark)
    sparkTurn = true; sparkCount++; sparkAt = cap.now(); sparkDirty = true
    rows.set(input.id, { line: found.line, quote: found.quote })
    bound(rows)
    last = { file: base(rel), line: found.line, quote: found.quote }
    cap.changed()
  }

  // ------------------------------------------------------------ the commit he marks

  // The engine says a commit was made; older engines say it in the first line of the output.
  function committed(result: Record<string, unknown>): boolean {
    const kind = object(object(result.gitOperation).commit).kind
    if (kind !== undefined) return kind === 'committed' || kind === 'amended'
    return !('gitOperation' in result) && /^\[[^\]\n]+ [0-9a-f]{7,40}\] /.test(String(result.stdout ?? '').trimStart())
  }

  async function commitTool(input: ToolResultInput): Promise<void> {
    const r = input.result, command = text(input.input.command)
    if (input.tool !== 'Bash' || !r || !command || !committed(r)) return
    cap.committed?.()
    const where = (await root()) ?? ''
    const verdict = await algorithm({ op: 'commit', command })
    if (!verdict) {
      if (command.includes('commit')) { gap[where] = (gap[where] ?? COMMIT_EVERY) + 1; trim(gap); save('commitGap', gap) }
      if (uwuLeft()) { const said = await algorithm({ op: 'bare', command }); if (said?.fix === true) tease() }
      return
    }
    const since = gap[where] ?? COMMIT_EVERY
    const worthy = verdict.quality === 'long' || since >= COMMIT_EVERY
    gap[where] = worthy ? 0 : since + 1
    trim(gap); save('commitGap', gap)
    if (!worthy || (await cap.marks()) === 'off') return
    commits.set(input.id, { quality: verdict.quality, quote: verdict.quality === 'long' ? undefined : verdict.quote ?? undefined })
    bound(commits)
    cap.changed()
    if (lgtmLeft(where)) speak(where, verdict, (await algorithm({ op: 'bare', command }))?.claude === true)
  }
  const lgtmLeft = (where: string): boolean => (lgtm[where] ?? 0) < LGTM_PER_REPO
  const uwuLeft = (): boolean => { const day = cap.localDay(cap.now()); return uwu.day !== day || uwu.n < UWU_PER_DAY }

  // A lone "fix": they threaten to uwu it and say they were kidding in the same line (owner 10-14).
  function tease(): void {
    if (!cap.settings().notes || !cap.emit || !uwuLeft()) return
    const line = word('commit.uwu')
    if (!line || cap.emit({ key: 'commit.uwu', text: line, class: 1, ttl: 14000 }) !== 'shown') return
    const day = cap.localDay(cap.now())
    uwu = { day, n: uwu.day === day ? uwu.n + 1 : 1 }
    save('commitUwu', uwu)
  }

  // Their LGTM: once a session and once a folder a day; a long, explained message may speak a second time that day; five a
  // repository in all. A message Claude wrote gets their line about Claude where lane B has written one.
  function speak(where: string, verdict: { quality: 'why' | 'long'; quote?: string | null }, claude = false): void {
    if (voicedSession || !cap.settings().notes || !cap.emit || !lgtmLeft(where)) return
    const day = cap.localDay(cap.now()), held = voice[where]
    if (held?.day === day && (verdict.quality !== 'long' || held.n >= 2)) return
    const quote = verdict.quote ?? undefined
    const line = (claude && word('commit.lgtm.claude')) || (quote && word(`commit.praise.${verdict.quality}`, { quote })) || word(`commit.quality.${verdict.quality}`)
    if (!line) return
    if (cap.emit({ key: 'commit.praise', text: line, class: 1, ttl: 14000, slots: quote ? [{ value: quote, kind: 'value' }] : [] }) !== 'shown') return
    voicedSession = true
    voice[where] = { day, n: held?.day === day ? held.n + 1 : 1 }
    trim(voice); save('commitVoice', voice)
    lgtm[where] = (lgtm[where] ?? 0) + 1
    trim(lgtm); save('commitLgtm', lgtm)
    cap.react?.(verdict.quality === 'long' ? 'praise-long' : 'praise')
  }

  // ------------------------------------------------------------ Shiori keeps the place

  function setPlace(items: { subject: string; status: string }[]): void {
    const open = items.filter(item => item.status !== 'completed')
    const before = placeNow
    if (items.length < 2 || !open.length) placeNow = undefined // the last task is done: they go in and stay in
    else {
      const done = items.length - open.length, current = items.find(item => item.status === 'in_progress') ?? open[0]!
      placeNow = { i: Math.min(done + 1, items.length), n: items.length, subject: current.subject.slice(0, 40), dip: before && done >= before.i ? ++dips : dips }
    }
    if (JSON.stringify(before) !== JSON.stringify(placeNow)) { cap.place?.(placeNow); cap.changed() }
  }

  function placeTool(input: ToolResultInput): void {
    if (input.failed || !input.result) return
    const r = input.result
    if (input.tool === 'TodoWrite') {
      todos.splice(0, todos.length, ...(Array.isArray(r.newTodos) ? r.newTodos : []).map(t => object(t)).filter(t => text(t.content)).map(t => ({ subject: String(t.content), status: String(t.status) })))
      setPlace(todos)
    } else if (input.tool === 'TaskCreate') {
      const task = object(r.task), id = text(task.id), subject = text(task.subject)
      if (id && subject) { tasks.set(id, { subject, status: 'pending' }); setPlace([...tasks.values()]) }
    } else if (input.tool === 'TaskUpdate') {
      const id = text(r.taskId), to = text(object(r.statusChange).to) ?? text(input.input.status)
      if (!id || r.success === false) return
      if (to === 'deleted') tasks.delete(id)
      else if (to && tasks.has(id)) tasks.get(id)!.status = to
      else return
      setPlace([...tasks.values()])
    } else if (input.tool === 'TaskList') {
      tasks.clear()
      for (const t of Array.isArray(r.tasks) ? r.tasks : []) { const task = object(t); if (text(task.id) && text(task.subject)) tasks.set(String(task.id), { subject: String(task.subject), status: String(task.status) }) }
      setPlace([...tasks.values()])
    }
  }

  // ------------------------------------------------------------ his shelf

  // Reads per local day over the last 30 days, 16 files a folder, 64 folders; secret-looking names never.
  function shelfRead(rel: string, at: number): void {
    if (!cap.settings().bookmark || SECRET_NAME.test(rel) || /(?:^|\/)(?:\.git|node_modules)\//.test(rel) || turnReads.has(rel)) return
    turnReads.add(rel)
    const day = cap.localDay(at), oldest = cap.localDay(at - (SHELF_DAYS - 1) * DAY_MS)
    const folder = shelf[rootNow] ?? { files: [] }
    delete shelf[rootNow]; shelf[rootNow] = folder // the least recently used leaves first
    for (const f of folder.files) f[1] = f[1].filter(([d]) => d >= oldest)
    folder.files = folder.files.filter(f => f[1].length)
    let file = folder.files.find(f => f[0] === rel)
    if (!file) {
      if (folder.files.length >= SHELF_FILES) {
        const total = (f: ShelfFile): number => f[1].reduce((n, [, c]) => n + c, 0)
        const out = [...folder.files].sort((a, b) => total(a) - total(b) || latestDay(a).localeCompare(latestDay(b)))[0]!
        folder.files.splice(folder.files.indexOf(out), 1)
      }
      file = [rel, []]; folder.files.push(file)
    }
    const today = file[1].find(([d]) => d === day)
    if (today) today[1]++; else file[1].push([day, 1])
    trim(shelf); shelfDirty = true
  }

  async function shelfOf(): Promise<ShelfView> {
    try {
      await ensure()
      const oldest = cap.localDay(cap.now() - (SHELF_DAYS - 1) * DAY_MS)
      const count = (f: ShelfFile): number => f[1].filter(([d]) => d >= oldest).reduce((n, [, c]) => n + c, 0)
      const files = [...(shelf[(await root()) ?? '']?.files ?? [])].filter(f => count(f) > 0)
      files.sort((a, b) => count(b) - count(a) || latestDay(b).localeCompare(latestDay(a)))
      const top = files.slice(0, SHELF_TOP).map(f => f[0])
      return top.length ? { names: shelfNames(top).map(cutName) } : 'empty'
    } catch { return 'error' }
  }

  // ------------------------------------------------------------ notes when Claude seems stuck

  function say(cause: Cause, id: string, slots: Record<string, string | number>, hint?: string): void {
    if (!cap.settings().notes || notesOff.has(cause) || spoken.has(cause)) return
    const main = word(`stuck.${cause}`, slots), label = word('stuck.button')
    if (!main || !label) return
    const second = hint && word(hint)
    const full = second && [...main + ' ' + second].length <= (/[　-鿿가-힣]/.test(main) ? 50 : 100) ? main + ' ' + second : main
    const slot = String(slots.file ?? slots.function ?? '')
    spoken.add(cause)
    noteRows.set(id, { cause, text: full })
    bound(noteRows)
    cap.emit?.({ key: `stuck.${cause}`, text: full, class: 1, ttl: 90_000, untilTurn: true, slots: slot ? [{ value: slot, kind: 'path' }] : [], button: { key: `coco:stuck:off:${cause}`, label } })
    cap.react?.(cause === 'long' ? 'hair' : 'stuck')
    cap.changed()
  }

  // The fourth read of the same part of one big file, unchanged, within 30 minutes.
  function circleTool(input: ToolResultInput, rel: string, at: number): void {
    const file = object(object(input.result).file)
    const total = Number(file.totalLines), from = Number(file.startLine) || 1, count = Number(file.numLines) || 0
    if (!(total >= CIRCLE_MIN_LINES) || count < 1) return
    const list = (ranges.get(rel) ?? []).filter(r => at - r.at <= CIRCLE_MS)
    const to = from + count - 1
    const same = list.filter(r => Math.max(0, Math.min(r.to, to) - Math.max(r.from, from) + 1) >= count / 2)
    list.push({ from, to, at })
    ranges.delete(rel); ranges.set(rel, list.slice(-8)); bound(ranges)
    if (same.length + 1 >= CIRCLE_READS) say('circle', input.id, { file: base(rel), n: same.length + 1, m: Math.max(1, Math.round((at - same[0]!.at) / 60_000)) }, 'stuck.circle.hint')
  }

  // An edit that left a function past 400 lines and made it longer; the new text comes from the result itself.
  async function longTool(input: ToolResultInput, rel: string, own: number): Promise<void> {
    const r = input.result
    if (!r || (input.tool !== 'Edit' && input.tool !== 'Write') || !LONG_EXT.test(rel) || notesOff.has('long') || spoken.has('long') || !cap.settings().notes) return
    const before = text(r.originalFile) ?? null
    let after = input.tool === 'Write' ? text(r.content) : undefined
    if (input.tool === 'Edit' && before !== null && text(r.oldString) !== undefined && text(r.newString) !== undefined) {
      const from = r.oldString as string, to = r.newString as string
      after = r.replaceAll === true ? before.split(from).join(to) : before.replace(from, () => to)
    }
    if (after === undefined || after.split('\n').length <= LONG_LINES) return
    const touched: number[] = []
    for (const hunk of Array.isArray(r.structuredPatch) ? r.structuredPatch : []) {
      const h = object(hunk)
      let n = Number(h.newStart)
      for (const line of Array.isArray(h.lines) ? h.lines : []) { const l = String(line); if (l[0] === '+') touched.push(n++); else if (l[0] === ' ') n++ }
    }
    if (!touched.length) touched.push(...Array.from({ length: after.split('\n').length }, (_, i) => i + 1))
    const found = await algorithm({ op: 'long', path: rel, limit: LONG_LINES, before, after, touched })
    if (!found || own !== serial) return
    say('long', input.id, { function: found.name, file: base(rel), n: found.lines })
  }

  // ------------------------------------------------------------ small costume reactions

  function dress(next: Costume): void {
    if (JSON.stringify(next) === JSON.stringify(costume)) return
    costume = next
    cap.costume?.(costume)
    cap.changed()
  }
  function undress(item: keyof Costume): void {
    if (!costume[item]) return
    const next = { ...costume }
    delete next[item]
    dress(next)
  }

  // ------------------------------------------------------------ events

  async function toolResult(input: ToolResultInput): Promise<void> {
    if (!live) return
    const own = serial
    await ensure()
    if (input.id === rainCall) { rain?.cancel(); rain = undefined; rainCall = undefined; undress('rain') }
    if (!input.failed && FILE_TOOLS.has(input.tool)) {
      const abs = sparkCandidate({ tool: input.tool, result: input.result })?.abs ?? text(input.result?.filePath) ?? text(input.result?.notebook_path)
      rootNow = (await root()) ?? ''
      const rel = abs ? relativeTo(abs, rootNow) : undefined
      if (rel && input.tool === 'Read') shelfRead(rel, cap.now())
      if (rel && WRITE_TOOLS.has(input.tool)) ranges.delete(rel)
      if (rel && input.main) {
        if (input.tool === 'Read') circleTool(input, rel, cap.now())
        void longTool(input, rel, own).catch(() => diagnose('notice.long'))
        if (input.tool === 'Read' && Number(object(object(input.result).file).totalLines) >= GLASSES_LINES) dress({ ...costume, glasses: true })
      }
    }
    if (!input.main) return
    await words()
    placeTool(input)
    if (input.failed) return
    if ((await cap.marks()) === 'off') return
    await sparkTool(input, own)
    await commitTool(input)
  }

  async function words(): Promise<void> { await loadC3Words(cap.readWords) }

  // A Bash call left running past a minute: rain on the pane behind him until it ends.
  function toolStart(input: { id: string; tool: string; background: boolean; main: boolean }): void {
    if (!input.main) return
    undress('glasses')
    if (input.tool !== 'Bash' || input.background || !cap.after || rain) return
    rainCall = input.id
    rain = cap.after(RAIN_MS, () => { rain = undefined; if (rainCall === input.id) dress({ ...costume, rain: true }) })
  }

  function prompted(promptText: string): void {
    if (/\bultrathink\b/i.test(promptText)) dress({ ...costume, bow: true })
  }

  function turnStart(): void { serial++; live = true; sparkTurn = false; turnReads.clear() }

  async function turnComplete(): Promise<void> {
    live = false; serial++
    rain?.cancel(); rain = undefined; rainCall = undefined
    dress({})
    if (sparkDirty) { sparkDirty = false; save('sparkRows', [...rows].map(([id, row]) => [id, row.line])) }
    if (shelfDirty && cap.settings().bookmark) { shelfDirty = false; save('shelf', shelf) }
  }

  // His notes off silences both kinds and, turned on again, brings every kind back; Bookmark off deletes the shelf.
  async function settingsChanged(): Promise<void> {
    const settings = cap.settings()
    if (!settings.bookmark) {
      shelf = {}; shelfDirty = false
      if (placeNow) { placeNow = undefined; cap.place?.(undefined) }
      await cap.remove('shelf').catch(() => diagnose('notice.store'))
    }
    if (notesWas === false && settings.notes && notesOff.size) { notesOff.clear(); await cap.remove('notesOff').catch(() => diagnose('notice.store')) }
    notesWas = settings.notes
  }

  async function stuckOff(cause: string): Promise<void> {
    if (cause !== 'circle' && cause !== 'long') return
    await ensure()
    notesOff.add(cause)
    save('notesOff', [...notesOff])
    cap.dismiss?.(`stuck.${cause}`)
    for (const [id, row] of noteRows) if (row.cause === cause) noteRows.delete(id)
    cap.changed()
  }

  function sessionStart(): void {
    serial++; live = false; rows.clear(); seenFiles.clear(); seenComments.clear(); commits.clear(); noteRows.clear(); ranges.clear(); spoken.clear(); turnReads.clear()
    sparkTurn = false; sparkCount = 0; sparkAt = -Infinity; sparkDirty = false; last = undefined; voicedSession = false
    todos.length = 0; tasks.clear(); placeNow = undefined
    rain?.cancel(); rain = undefined; rainCall = undefined; costume = {}
    rootRead = undefined; ready = undefined; reader = undefined; gap = {}; voice = {}; shelf = {}; notesOff = new Set(); notesWas = undefined; rootNow = ''
  }

  return {
    toolResult, toolStart, prompted, turnStart, turnComplete, sessionStart, settingsChanged, stuckOff, words, word,
    // A compaction ends the record of what Claude has read.
    compacted: (): void => ranges.clear(),
    spark: (id: string): SparkRow | undefined => rows.get(id),
    commit: (id: string): CommitRow | undefined => commits.get(id),
    note: (id: string): NoteRow | undefined => (cap.settings().notes ? noteRows.get(id) : undefined),
    place: (): Place | undefined => placeNow,
    shelf: shelfOf,
    costume: (): Costume => costume,
    // Rows kept across a resume come back from the store before the first row is drawn.
    ready: (): Promise<void> => ensure().catch(() => diagnose('notice.store')),
    // A mark kept across a resume has no quote yet; read it again from the row's own result.
    async quoteOf(id: string, tool: string, output: unknown): Promise<string | undefined> {
      const row = rows.get(id)
      if (!row || row.quote !== undefined) return row?.quote
      const candidate = sparkCandidate({ tool, result: object(output) })
      const rel = candidate && relativeTo(candidate.abs, await root())
      if (!candidate || !rel) return undefined
      const found = await algorithm({ op: 'comment', path: candidate.request.pseudo ?? rel, ...candidate.request })
      if (found && found.line === row.line) { row.quote = found.quote; cap.changed() }
      return row.quote
    },
    lastSpark: () => last,
    // True once, the first time a row is drawn after its verdict: that draw grows the spark in.
    firstDraw(id: string): boolean {
      const row = rows.get(id)
      if (!row || row.drawn) return false
      row.drawn = true
      return true
    },
    screenReader: (): Promise<boolean> => (reader ??= (cap.screenReader?.() ?? Promise.resolve(false)).catch(() => false)),
  }
}

export type Notice = ReturnType<typeof createNotice>

// The rows in transcript.tsx draw from the one runtime the register module made.
let current: Notice | undefined
export const setNotice = (value: Notice | undefined): void => { current = value }
export const currentNotice = (): Notice | undefined => current
