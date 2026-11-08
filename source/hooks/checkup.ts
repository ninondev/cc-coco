import type { CheckWords, CheckCompanion, CheckHealth, CheckSession, CheckInput, CheckId, CheckFix, CheckRow, CheckResult, CheckFs, CheckEngine } from './checkup-types'
export type { CheckWords, CheckCompanion, CheckHealth, CheckSession, CheckInput, CheckId, CheckFix, CheckRow, CheckResult } from './checkup-types'
// Settings draws / Fix completions request these reads. No timers, writes or app inspection.
import { joinPath, samePath, windowsPath } from './d1-paths.js'

// Raise this when the shipped pet's code or art changes, independently of plugin-only releases.
export const COMPANION_MIN_VERSION = '1.1.4514.2'
const parseVersion = (v: string | undefined) => v?.match(/^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)

function numericOrder(left: string, right: string): number {
  // Version components can be longer than the exact integer range of a JS number.
  left = left.replace(/^0+(?=\d)/, '')
  right = right.replace(/^0+(?=\d)/, '')
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  return left === right ? 0 : left < right ? -1 : 1
}

// Coco reserves a fourth number for small fixes. A three-part release has patch revision zero.
function compareVersion(found: string | undefined, required: string | undefined): number | undefined {
  const a = parseVersion(found), b = parseVersion(required)
  if (!a || !b) return undefined
  for (let i = 1; i <= 4; i++) {
    const order = numericOrder(a[i] ?? '0', b[i] ?? '0')
    if (order) return order
  }
  if (!a[5] || !b[5]) return a[5] ? -1 : b[5] ? 1 : 0
  const left = a[5].split('.'), right = b[5].split('.')
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i], y = right[i]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y)
    if (xn && yn) {
      const order = numericOrder(x, y)
      if (order) return order
      continue
    }
    if (xn !== yn) return xn ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

export function olderVersion(found: string | undefined, current: string): boolean {
  return compareVersion(found, current) === -1
}

export function atLeastVersion(found: string | undefined, required: string | undefined): boolean {
  const order = compareVersion(found, required)
  return order !== undefined && order >= 0
}

export function checkFolder(cwd: string, home?: string): string {
  if (!home) return cwd
  if (samePath(cwd, home)) return '~'
  const normalize = (path: string) => (windowsPath(path) ? path.replace(/\\/g, '/') : path).replace(/\/+$/, '')
  const path = normalize(cwd), root = normalize(home)
  // Compare the prefix through the shared OS-path policy; a separator boundary
  // keeps sibling names intact. A root home normalizes to an empty prefix.
  if (path.length > root.length && path.charAt(root.length) === '/' && samePath(path.slice(0, root.length + 1), home))
    return `~${path.slice(root.length)}`
  return cwd
}

export function checkup(input: CheckInput, words: CheckWords): CheckResult {
  const rows: CheckRow[] = [], c = words.settings.companion
  const mac = input.platform === 'darwin', running = input.companion.running === true
  if (mac && input.installed && !running) rows.push({ id: 'companion', subject: c.label, state: c.stopped, fix: 'summon' })
  if (mac && running && (input.health.accessibility ?? input.companion.accessibility) === false)
    rows.push({ id: 'follow', subject: c.label, state: c.corner, fix: 'follow' })
  if (mac && input.installed && olderVersion(input.companion.version ?? input.health.version, COMPANION_MIN_VERSION))
    rows.push({ id: 'update', subject: c.label, state: c.update, fix: 'updateButton' })
  if ((input.surface === 'terminal' || input.surface === 'desktop') && input.band === 'off')
    rows.push({ id: 'band', subject: words.settings.band.label, state: words.settings.now.replace('{value}', words.settings.band.off), fix: 'bandOn' })
  const seen = new Set<string>()
  for (const session of input.sessions) {
    if (!session.open || seen.has(session.session) || !olderVersion(session.version, input.version)) continue
    seen.add(session.session)
    rows.push({ id: `session:${session.session}`, subject: checkFolder(session.cwd, input.home), state: words.check.oldSession,
      fix: 'reloadPlugins', ...(input.copied?.includes(session.session) ? { after: words.check.copied } : {}) })
  }
  for (const row of rows) {
    const progress = input.working?.[row.id]
    if (progress !== undefined) { row.state = progress; row.fix = null }
  }
  return { title: words.check.title, ok: words.check.ok, placement: rows.length ? 'top' : 'end', rows }
}



async function record($: CheckEngine, path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file' || stat.isLink || stat.size > 16384) return undefined
    const text = await $.fs.read(path)
    if (text.length > 16384) return undefined
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch { return undefined }
}
export async function readCheckCompanion($: CheckEngine, folder: string, installed: boolean): Promise<{ installed: boolean; companion: CheckCompanion; health: CheckHealth }> {
  // The existing companion snapshot owns installation detection (both its folder and
  // its own app). A leftover settings folder alone does not establish installation.
  if (!installed) return { installed, companion: {}, health: {} }
  const [status, receipt] = await Promise.all([record($, joinPath(folder, 'companion.json')), record($, joinPath(folder, 'health.json'))])
  const companion: CheckCompanion = {}, health: CheckHealth = {}
  if (typeof status?.running === 'boolean') companion.running = status.running
  if (typeof status?.accessibility === 'boolean') companion.accessibility = status.accessibility
  if (typeof status?.version === 'string' && status.version.length <= 64) companion.version = status.version
  if (typeof receipt?.accessibility === 'boolean') health.accessibility = receipt.accessibility
  if (typeof receipt?.version === 'string' && receipt.version.length <= 64) health.version = receipt.version
  if (typeof receipt?.protocolGeneration === 'string' && receipt.protocolGeneration.length <= 64) health.protocolGeneration = receipt.protocolGeneration
  return { installed, companion, health }
}
export async function readCheckSessions($: CheckEngine, paths: readonly { path: string; open: boolean }[]): Promise<CheckSession[]> {
  // Caller passes only this plugin's presence files and current liveness. No directory
  // scans, PID queries or files belonging to another app are needed.
  const rows = await Promise.all(paths.filter(row => row.open).map(async ({ path }) => {
    const value = await record($, path)
    if (typeof value?.session !== 'string' || value.session.length > 256 || typeof value.cwd !== 'string'
        || value.cwd.length > 4096 || typeof value.version !== 'string' || value.version.length > 64) return undefined
    return { session: value.session, cwd: value.cwd, version: value.version, open: true }
  }))
  return rows.filter((row): row is CheckSession => row !== undefined)
}
