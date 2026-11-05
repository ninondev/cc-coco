// The 401 and 402 band lines (package D): Coco's own words when a provider that is not
// Anthropic's own endpoint refuses the key or says the balance is out. Never an imitation
// of the engine's interface, and never switched on by anything but this check (DECISIONS 1058).
//
// What each signal is: 401 arrives as StopFailure error "authentication_failed" with
// "Please run /login" advice in last_assistant_message (wrong for another provider; measured on
// DeepSeek, evidence deepseek-wrong-key-1027.md, and on a loopback mock, api-error-pty.sh), so
// the line corrects it. 402 is unmeasured on real DeepSeek: matched on the status text in
// last_assistant_message ("API Error: 402", "Insufficient Balance") or on StopFailure error
// billing_error, never on the 401 wording.
import type { LineRequest } from './line-slot'

// The host of a base URL, lowercased, without port, userinfo, path or query. Undefined when the
// value is absent or not a URL: no provider claim is made then.
export function baseHost(baseUrl: string | undefined): string | undefined {
  if (typeof baseUrl !== 'string' || baseUrl === '') return undefined
  try {
    const url = new URL(baseUrl)
    return url.hostname.toLowerCase() || undefined
  } catch {
    return undefined
  }
}

// The lines speak only when the endpoint is not Anthropic's own; its 401 advice fits it.
export function otherProvider(baseUrl: string | undefined): boolean {
  const host = baseHost(baseUrl)
  return host !== undefined && host !== 'api.anthropic.com'
}

export type ApiFailureKind = 'api401' | 'api402'

export function apiFailureKind(input: { error: string; lastAssistantMessage?: string }): ApiFailureKind | undefined {
  const message = input.lastAssistantMessage ?? ''
  if (/API Error: 402/.test(message) || /Insufficient Balance/i.test(message) || input.error === 'billing_error') return 'api402'
  if (input.error === 'authentication_failed' || /API Error: 401/.test(message)) return 'api401'
  return undefined
}

// The line request for a stop failure the engine already reported. The early 401 signal reuses
// the same words with its own validity closure.
export function apiFailureLine(input: { kind: ApiFailureKind; lang: string; word: (lang: string, key: string) => string; at: number; ttl: number; valid: () => boolean }): LineRequest {
  return { key: input.kind, class: 1, text: input.word(input.lang, input.kind), ttl: input.ttl, untilPrompt: true, valid: input.valid }
}
