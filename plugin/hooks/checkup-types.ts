import type { EngineInterface } from 'claude-code'

export type CheckWords = {
  check: { title: string; ok: string; fix: string; oldSession: string; copied: string }
  settings: {
    now: string; band: { label: string; off: string }
    companion: { label: string; stopped: string; corner: string; update: string }
  }
}
export type CheckCompanion = { running?: boolean; accessibility?: boolean; version?: string }
export type CheckHealth = { version?: string; accessibility?: boolean; protocolGeneration?: string }
export type CheckSession = { session: string; cwd: string; version: string; open: boolean }
export type CheckInput = {
  platform: 'darwin' | 'win32' | 'linux'; surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'
  installed: boolean; companion: CheckCompanion; health: CheckHealth
  version: string; band: string; sessions: readonly CheckSession[]; home?: string
  copied?: readonly string[]; working?: Partial<Record<CheckId, string>>
}
export type CheckId = 'companion' | 'follow' | 'update' | 'band' | 'command:coco' | `session:${string}`
export type CheckFix = 'summon' | 'follow' | 'updateButton' | 'bandOn' | 'reloadPlugins'
export type CheckRow = { id: CheckId; subject: string; state: string; fix: CheckFix | null; after?: string }
export type CheckResult = { title: string; ok: string; placement: 'top' | 'end'; rows: CheckRow[] }
export type CheckFs = Pick<EngineInterface['fs'], 'read' | 'stat'>
export type CheckEngine = { fs: CheckFs }
