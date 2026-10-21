// Lock resolution (rule 10): first matching source wins.

import type { LockSignal } from './constants'

const IOREG_RE = /"IOConsoleLocked"\s*=\s*(Yes|No)/

export function resolveLock(i: {
  now: number
  away?: { state: 'locked' | 'display-asleep' | null; since: number } | null
  ioreg?: string | null
  loginctl?: string | null
}): LockSignal {
  const away = i.away
  if (away !== null && away !== undefined && typeof away === 'object') {
    const since: unknown = away.since
    if (typeof since === 'number' && Number.isFinite(since) && since <= i.now && i.now - since < 600000) {
      const st: unknown = away.state
      if (st === 'locked' || st === 'display-asleep') return 'locked'
      if (st === null) return 'unlocked'
    }
  }
  if (typeof i.ioreg === 'string') {
    const m = IOREG_RE.exec(i.ioreg)
    if (m !== null) return m[1] === 'Yes' ? 'locked' : 'unlocked'
  }
  if (typeof i.loginctl === 'string') {
    const v = i.loginctl.trim().toLowerCase()
    if (v === 'yes') return 'locked'
    if (v === 'no') return 'unlocked'
  }
  return 'none'
}
