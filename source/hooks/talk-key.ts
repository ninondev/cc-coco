import type { EngineInterface, ModelUsage } from 'claude-code'
import { joinPath } from './paths'
import { moreWord, moreFill } from './more-words'

// The plugin's side of the key program (TALK-KEY 3, plugin/talk-key/README.md). The key never passes
// through here: the program reads it from the system's store and prints only kinds, text and usage.

export type KeyPlatform = 'darwin' | 'win32' | 'linux'
export type KeyStore = 'keychain' | 'credential-manager' | 'secret-service' | 'file'
export type KeyKind = 'ok' | 'works' | 'saved' | 'address' | 'removed' | 'invalid' | 'credit' | 'rate' | 'busy' | 'offline' | 'model' | 'refusal'
  | 'daily' | 'cap' | 'other' | 'computer' | 'format' | 'cancelled' | 'noRun'
export type KeyReply = {
  kind: KeyKind
  detail?: string
  status?: number
  retryAfter?: number
  text?: string
  usage?: ModelUsage
  count?: { minute: number; day: number }
  last4?: string
  store?: KeyStore
  /** Where the key is sent and with which model, as the program stored them (never the key). */
  host?: string
  model?: string
}
export type KeyMessage = { role: 'user' | 'assistant'; content: string }
// `kind: 'compact'` is Talk's notes on a long chat, the one send that may ask for up to 1,000 tokens (K4).
// A talk send leaves max_tokens out (owner 10-17: no cap of its own): the program takes the stored model's own limit.
export type KeyRequest = { system?: string; messages: KeyMessage[]; max_tokens?: number; kind?: 'compact' }

const KINDS = new Set<KeyKind>(['ok','works','saved','address','removed','invalid','credit','rate','busy','offline','model','refusal','daily','cap','other','computer','format','cancelled'])
const STORES = new Set<KeyStore>(['keychain','credential-manager','secret-service','file'])
/** The program refuses anything near a typed key; a person pasting into the dialog has ten minutes. */
export const KEY_DIALOG_TIMEOUT = 600000
export const KEY_SEND_TIMEOUT = 30000
/** From this many sends a day the row shows today's count (tk-send-limits, 80 % of 300). */
export const KEY_NEAR_CAP = 240
export const KEY_PER_MINUTE = 6

export type KeyArch = 'x86_64' | 'aarch64'

/** The processor as Windows (PROCESSOR_ARCHITECTURE) or `uname -m` names it; only those with a build. */
export function keyArch(name: string | undefined): KeyArch | undefined {
  return /^(?:arm64|aarch64)$/i.test(name ?? '') ? 'aarch64' : /^(?:amd64|x86_64)$/i.test(name ?? '') ? 'x86_64' : undefined
}

/** The program for this computer, in libexec (never bin/, which is on the Bash tool's PATH): on macOS the signed
 *  build made on a Mac at release (talk-key/ci/release.sh); on Windows and Linux the build for its processor
 *  (tools/build-talk-key-bins.py). A processor without a build has none. */
export function talkKeyPath(root: string, platform: KeyPlatform, arch?: KeyArch): string | undefined {
  if (platform === 'darwin') return joinPath(root, 'libexec', 'talk-key')
  if (!arch) return
  return joinPath(root, 'libexec', platform === 'win32' ? `talk-key-windows-${arch}.exe` : `talk-key-linux-${arch}`)
}

export async function keyPlatform($: Pick<EngineInterface, 'env' | 'fs'>): Promise<KeyPlatform> {
  if (await $.env.get('OS').catch(() => undefined) === 'Windows_NT') return 'win32'
  return await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist').catch(() => false) ? 'darwin' : 'linux'
}

/** The session bus and the display, which secret-tool and the dialogs need; passed through explicitly. */
export async function keyEnvironment($: Pick<EngineInterface, 'env'>): Promise<Record<string, string>> {
  const pairs = await Promise.all([
    $.env.get('DBUS_SESSION_BUS_ADDRESS').then(v => ['DBUS_SESSION_BUS_ADDRESS', v] as const),
    $.env.get('XDG_RUNTIME_DIR').then(v => ['XDG_RUNTIME_DIR', v] as const),
    $.env.get('DISPLAY').then(v => ['DISPLAY', v] as const),
    $.env.get('WAYLAND_DISPLAY').then(v => ['WAYLAND_DISPLAY', v] as const),
  ].map(p => p.catch(() => ['', undefined] as const)))
  const env: Record<string, string> = {}
  for (const [name, value] of pairs) if (name && typeof value === 'string' && value) env[name] = value
  return env
}

/** No window can open: a Linux session without a display, or any SSH session. */
export async function keyNoDisplay($: Pick<EngineInterface, 'env'>, platform: KeyPlatform): Promise<boolean> {
  if (platform === 'win32') return false
  const get = (p: Promise<string | undefined>) => p.catch(() => undefined)
  if (await get($.env.get('SSH_CONNECTION'))) return true
  if (platform === 'darwin') return false
  return !(await get($.env.get('DISPLAY'))) && !(await get($.env.get('WAYLAND_DISPLAY')))
}

export function parseKeyReply(stdout: string): KeyReply {
  const line = stdout.trim().split('\n').at(-1) ?? ''
  let data: Record<string, unknown>
  try { data = JSON.parse(line) } catch { return { kind: 'computer', detail: 'noProgram' } }
  if (!data || typeof data !== 'object' || !KINDS.has(data.kind as KeyKind)) return { kind: 'computer', detail: 'noProgram' }
  const reply: KeyReply = { kind: data.kind as KeyKind }
  if (typeof data.detail === 'string') reply.detail = data.detail
  if (typeof data.status === 'number') reply.status = data.status
  if (typeof data.retry_after === 'number') reply.retryAfter = data.retry_after
  if (typeof data.text === 'string') reply.text = data.text
  if (typeof data.last4 === 'string' && /^[A-Za-z0-9_-]{4}$/.test(data.last4)) reply.last4 = data.last4
  if (STORES.has(data.store as KeyStore)) reply.store = data.store as KeyStore
  if (typeof data.host === 'string' && /^[A-Za-z0-9.:\[\]-]{1,260}$/.test(data.host)) reply.host = data.host
  if (typeof data.model === 'string' && /^[A-Za-z0-9._:\/@+-]{1,200}$/.test(data.model)) reply.model = data.model
  const usage = data.usage as Record<string, unknown> | null
  if (usage && typeof usage === 'object') {
    const n = (k: string) => typeof usage[k] === 'number' ? usage[k] as number : 0
    reply.usage = { input_tokens: n('input_tokens'), output_tokens: n('output_tokens'), cache_read_input_tokens: n('cache_read_input_tokens'), cache_creation_input_tokens: n('cache_creation_input_tokens') }
  }
  const count = data.count as Record<string, unknown> | undefined
  if (count && typeof count.minute === 'number' && typeof count.day === 'number') reply.count = { minute: count.minute, day: count.day }
  return reply
}

export type KeyHost = { root: string; platform: KeyPlatform; arch?: KeyArch; desktop: boolean }

/**
 * Runs the program with `args`. A missing program is `computer`; a program that exists but cannot be run
 * is `noRun` in the desktop app (where `process.run` may be refused) and `computer` elsewhere.
 */
export async function runTalkKey($: Pick<EngineInterface, 'env' | 'fs' | 'process'>, host: KeyHost, args: string[], init: { stdin?: string; timeoutMs?: number } = {}): Promise<KeyReply> {
  const path = talkKeyPath(host.root, host.platform, host.arch)
  if (!path || !await $.fs.exists(path).catch(() => false)) return { kind: 'computer', detail: 'noProgram' }
  const env = await keyEnvironment($)
  try {
    const result = await $.process.run([path, ...args], { env, timeoutMs: init.timeoutMs ?? KEY_SEND_TIMEOUT, ...(init.stdin === undefined ? {} : { stdin: init.stdin }) })
    return parseKeyReply(result.stdout)
  } catch {
    return host.desktop ? { kind: 'noRun' } : { kind: 'computer', detail: 'noProgram' }
  }
}

/** Alternating turns from user to user, as the program requires; same-side neighbours are joined. */
export function keyMessages(history: { side: 'person' | 'him'; text: string }[], text: string): KeyMessage[] {
  const messages: KeyMessage[] = []
  for (const item of [...history, { side: 'person' as const, text }]) {
    const role = item.side === 'person' ? 'user' : 'assistant'
    const last = messages.at(-1)
    if (!last && role === 'assistant') continue
    if (last?.role === role) last.content += '\n' + item.text
    else messages.push({ role, content: item.text })
  }
  return messages
}

// What the failure line offers (TALK-KEY 3 «Failures», card 1, tk-failure-lines 10-09). The four computer-side
// failures are one line with «Open Settings»; the fallback sends that one message on the session's payer.
export type KeyFailure = 'invalid' | 'credit' | 'model' | 'rate' | 'daily' | 'busy' | 'offline' | 'refusal' | 'cap' | 'pasted' | 'computer' | 'other'
export const KEY_FAILURE_BUTTONS: Record<KeyFailure, { settings: boolean; fallback: boolean }> = {
  invalid: { settings: true, fallback: true },
  credit: { settings: true, fallback: true },
  model: { settings: true, fallback: true },
  computer: { settings: true, fallback: true },
  daily: { settings: true, fallback: false },
  pasted: { settings: true, fallback: false },
  rate: { settings: false, fallback: false },
  busy: { settings: false, fallback: false },
  offline: { settings: false, fallback: false },
  refusal: { settings: false, fallback: false },
  cap: { settings: false, fallback: false },
  other: { settings: false, fallback: false },
}

export function keyFailure(reply: KeyReply): KeyFailure {
  switch (reply.kind) {
    case 'invalid': case 'credit': case 'model': case 'rate': case 'daily': case 'busy': case 'offline': case 'refusal': case 'cap': case 'other': return reply.kind
    default: return 'computer'
  }
}

export const ANTHROPIC_HOST = 'api.anthropic.com'
export const DEFAULT_KEY_MODEL = 'claude-haiku-5-5'
/** The lines that name Anthropic or Haiku; another host needs its own words (the …At slots). */
const NAMES_ANTHROPIC = new Set<KeyFailure>(['invalid', 'model', 'busy', 'offline', 'refusal'])

/**
 * The failure line. For another host a line that names Anthropic or Haiku would be false: its …At slot is
 * used, and until the words agent writes it, the generic «Sending failed» line, which stays true.
 */
export function keyFailureText(failure: KeyFailure, reply: KeyReply | undefined, lang: string, at?: { host?: string; model?: string }): string {
  const fill = { s: reply?.retryAfter ?? 60, status: reply?.status ?? '-', host: at?.host ?? '', model: at?.model ?? '' }
  if (at?.host && at.host !== ANTHROPIC_HOST && NAMES_ANTHROPIC.has(failure)) {
    return moreFill(moreWord(`talk.fail.${failure}At`, lang) || moreWord('talk.fail.other', lang), fill)
  }
  return moreFill(moreWord(`talk.fail.${failure}`, lang), fill)
}

/** Dollars only for a priced Claude model on api.anthropic.com; anything else is tokens only. */
export function keyPriced(host: string | undefined, model: string | undefined): boolean {
  return (host ?? ANTHROPIC_HOST) === ANTHROPIC_HOST && (model ?? DEFAULT_KEY_MODEL).startsWith('claude-')
}

/** Words another host needs before the row offers a base URL and a model (TALK-KEY «Changed 10-10»). */
export const KEY_ENDPOINT_SLOTS = ['key.base.label', 'key.model.label', 'dialog.textAt', 'talk.payer.keyAt', 'talk.disclosure.other'] as const

export type KeyPrice = { input: number; output: number; read: number; write5m: number; over?: { above: number; input: number; output: number; read: number; write5m: number } }

/** One request at Haiku 5.5's price (K1's row, per million tokens); the whole prompt picks the tier. */
export function keyCost(usage: ModelUsage, row: KeyPrice): number {
  const prompt = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  const p = row.over && prompt > row.over.above ? row.over : row
  return (usage.input_tokens * p.input + usage.output_tokens * p.output + usage.cache_read_input_tokens * p.read + usage.cache_creation_input_tokens * p.write5m) / 1e6
}

export function keyUsd(usd: number): string {
  return '$' + (usd > 0 && usd < 0.001 ? 0.001 : usd).toFixed(3)
}

export function keyTokens(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${Math.round(tokens / 1000)}k`
}
