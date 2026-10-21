import { installM1Words } from './m1-more-data-fixture'
import { installModelServiceFixture } from './m1-model-service-fixture'
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface, ModelUsage } from 'claude-code'
import { MoreRuntime, TALK_CAP, TALK_PERSONA_LIMIT, EXPLAIN_TEXT_LIMIT, talkEstimate } from '../hooks/more-runtime'
import { MorePage, MoreTalk } from '../hooks/more-book'
import type { MoreBookData } from '../hooks/more-book'
import { moreWord, moreFill, MORE_SLOTS } from '../hooks/more-words'
import { KEY_ENDPOINT_SLOTS, KEY_FAILURE_BUTTONS, KEY_NEAR_CAP, keyArch, keyCost, keyMessages, parseKeyReply, runTalkKey, talkKeyPath } from '../hooks/talk-key'
import type { KeyHost, KeyPrice } from '../hooks/talk-key'

// TALK-KEY §6, the plugin's half: the key program is stubbed at $.process.run, so no program, key or network.
installM1Words()
installModelServiceFixture()
const AT = 1791273600000
const ROOT = '/fixture/plugin'
const HOST: KeyHost = { root: ROOT, platform: 'linux', arch: 'x86_64', desktop: false }
const PROGRAM = talkKeyPath(ROOT, 'linux', 'x86_64')!
const CANARY = 'sk-ant-api03-CANARYpluginsideabcdefghijklmnx7Qa'
const PERSONA = 'You are Coco, a small bookish character.'
const PRICE: KeyPrice = { input: 0.1, output: 0.5, read: 0.01, write5m: 0.125, over: { above: 100000, input: 0.5, output: 2.5, read: 0.05, write5m: 0.625 } }
const TOKENS: ModelUsage = { input_tokens: 1200, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ENV: Record<string, string> = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus', XDG_RUNTIME_DIR: '/run/user/1', DISPLAY: ':0' }

type Reply = Record<string, unknown> | 'reject'
function world(options: { replies?: Reply[]; exists?: boolean; complete?: ModelUsage } = {}) {
  const calls: { name: string; args: unknown[] }[] = [], stored: Record<string, unknown> = {}
  const replies = [...(options.replies ?? [])]
  const call = (name: string, ...args: unknown[]) => { calls.push({ name, args }) }
  const engine = {
    plugin: { root: ROOT },
    fs: { read: async () => { throw Error('none') }, write: async () => {}, exists: async (path: string) => { call('fs.exists', path); return options.exists ?? true } },
    store: { get: async (key: string) => stored[key], set: async (key: string, value: unknown) => { call('store.set', key, value); stored[key] = value } },
    ui: { invalidate: () => {}, log: (text: string, options?: unknown) => call('ui.log', text, options), copy: async (request: unknown) => { call('ui.copy', request); return { isCopied: true } } },
    model: { complete: async (request: unknown) => { call('model.complete', request); return { isAnswered: true, text: 'plan reply', usage: options.complete ?? TOKENS } } },
    process: { run: async (argv: string[], init: unknown) => {
      call('process.run', argv, init)
      const next = replies.shift() ?? { kind: 'ok', text: 'key reply', usage: TOKENS, count: { minute: 1, day: 1 } }
      if (next === 'reject') throw Error('refused')
      return { exitCode: next.kind === 'ok' || next.kind === 'works' || next.kind === 'removed' ? 0 : 1, stdout: JSON.stringify(next) + '\n', stderr: '' }
    } },
    env: { get: async (key: string) => ENV[key] },
    session: { messages: async () => [] },
    // His later messages wait on the clock (Talk paces them); these tests read the history, so no timer fires.
    clock: { now: async () => AT, after: () => ({ cancel: () => {} }) },
  } as unknown as EngineInterface
  return { $: engine, calls, stored, count: (name: string) => calls.filter(c => c.name === name).length, runs: () => calls.filter(c => c.name === 'process.run') }
}
function runtime(options: { host?: KeyHost; on?: Record<string, boolean>; persona?: string } = {}) {
  const r = new MoreRuntime({ 'more.model.talk.persona': options.persona ?? PERSONA }, { keyHost: async () => options.host ?? HOST, keyPrice: async () => PRICE })
  r.restore(options.on ?? { talk: true, explain: true }, [], undefined, AT)
  return r
}
async function keyRuntime(f: ReturnType<typeof world>, options: Parameters<typeof runtime>[0] = {}) {
  const r = runtime(options)
  r.restoreKey('key', { last4: 'x7Qa', state: 'works', store: 'file' }, undefined, undefined, AT)
  return r
}
const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...(tree.children ?? []).flatMap(nodes), ...(tree.props?.children ? [tree.props.children].flat().flatMap(nodes) : [])]
const E = { Box: 'Box', Text: 'Text', Button: 'Button', Select: 'Select', Input: 'Input', Markdown: 'Markdown' } as any
const texts = (tree: any) => nodes(tree).filter(n => n.type === 'Text').map(n => [n.children, n.props?.children].flat().filter(c => typeof c === 'string').join(''))
const keyOf = (n: any) => n.props?.key ?? n.key
const keys = (tree: any) => nodes(tree).map(keyOf).filter(Boolean)
const w = (k: string) => moreWord(k, 'en')
const everything = (f: ReturnType<typeof world>) => JSON.stringify(f.calls) + JSON.stringify(f.stored)

describe('TALK-KEY plugin side', () => {
  test('Talk on the key sends through the program with the fixed request and never calls the session model', async () => {
    const f = world(), r = await keyRuntime(f)
    await r.talk(f.$, 'long day. the tests finally pass', AT)
    expect(f.count('model.complete')).toBe(0)
    const [argv, init] = f.runs()[0]!.args as [string[], { stdin: string; env: Record<string, string>; timeoutMs: number }]
    expect(argv).toEqual([PROGRAM, 'send'])
    expect(init.env).toEqual(ENV)
    expect(init.timeoutMs).toBe(30000)
    const request = JSON.parse(init.stdin)
    // no cap of its own (owner 10-17): the program takes the model's own limit
    expect(request).toEqual({ system: PERSONA, messages: [{ role: 'user', content: 'Reply in the language of their message.\nlong day. the tests finally pass' }] })
    expect(r.exchanges.at(-1)).toEqual({ side: 'him', text: 'key reply' })
    expect(r.keyToday).toEqual({ date: r.keyToday.date, n: 1, tokens: 1400, usd: keyCost(TOKENS, PRICE), day: 1 })
    // A typical message: 1,200 in and 200 out is $0.00022 at Haiku 5.5 (TALK-KEY §3).
    expect(Math.round(keyCost(TOKENS, PRICE) * 1e8)).toBe(22000)
    expect(f.stored['more.keyToday']).toEqual(r.keyToday)
  })

  // K4 (lane C 10-17): a long chat on the key writes its notes with the program's compact kind, as the plan path does
  test('over the trigger Talk on the key writes its notes in one compact send of up to 1,000 tokens, then replies', async () => {
    const COMPACT = 'Write short notes about this chat.'
    const f = world({ replies: [{ kind: 'ok', text: 'NOTES: parser; commas.', usage: TOKENS, count: { minute: 1, day: 1 } }] })
    const r = new MoreRuntime({ 'more.model.talk.persona': PERSONA, 'more.model.talk.compact': COMPACT }, { keyHost: async () => HOST, keyPrice: async () => PRICE })
    r.restore({ talk: true }, [], undefined, AT)
    r.restoreKey('key', { last4: 'x7Qa', state: 'works', store: 'file' }, undefined, undefined, AT)
    r.exchanges = Array.from({ length: 100 }, (_, i) => ({ side: i % 2 ? 'him' as const : 'person' as const, text: `exchange ${i} `.padEnd(1000, 'w') }))
    await r.talk(f.$, 'and now?', AT)
    expect(f.count('model.complete')).toBe(0)
    const sent = f.runs().map(run => JSON.parse((run.args[1] as { stdin: string }).stdin))
    expect(sent.length).toBe(2)
    expect(sent[0]).toMatchObject({ kind: 'compact', system: COMPACT, max_tokens: 1000 })
    expect(sent[0].messages).toHaveLength(1)
    expect(sent[0].messages[0].content).toContain('exchange 0 ')
    expect(sent[1].kind).toBeUndefined()
    expect(sent[1].max_tokens).toBeUndefined()
    expect(sent[1].system).toContain('NOTES: parser; commas.')
    expect(JSON.stringify(sent[1].messages)).not.toContain('exchange 0 ')
    // both are sends the program counts; only the person's message is one of theirs
    expect(r.keyToday.n).toBe(2)
    expect(r.today.rows.talk?.n).toBe(1)
  })
  test('the history goes as alternating turns ending on the person, and work and failure lines never ride along', () => {
    expect(keyMessages([{ side: 'him', text: 'hello' }, { side: 'person', text: 'a' }, { side: 'person', text: 'b' }, { side: 'him', text: 'c' }], 'd'))
      .toEqual([{ role: 'user', content: 'Your earlier messages in this chat:\nhello\n\na\nb' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }])
  })

  // 10-21: his Chinese openers were dropped on the key and a short Chinese line got a Japanese reply
  test('his reply is told the language: what they wrote, else their last message heard, else the band; any language', async () => {
    const hear = (text: string) => /[\u4e00-\u9fff]/.test(text) ? { lang: 'zh', confidence: 0.73 } : /^hallo\b/.test(text) ? { lang: 'de', confidence: 0.5 } : undefined
    const keyed = (lang: string) => {
      const r = new MoreRuntime({ 'more.model.talk.persona': PERSONA }, { keyHost: async () => HOST, keyPrice: async () => PRICE, hearLanguage: hear })
      r.restore({ talk: true }, [], undefined, AT)
      r.restoreKey('key', { last4: 'x7Qa', state: 'works', store: 'file' }, undefined, undefined, AT)
      r.configure(lang)
      return r
    }
    const last = (f: ReturnType<typeof world>) => JSON.parse((f.runs().at(-1)!.args[1] as { stdin: string }).stdin).messages.at(-1).content as string
    const f = world(), r = keyed('ja')
    r.exchanges = [{ side: 'him', text: '呼...这波大活,本天才监工得漂亮吧?' }]
    await r.talk(f.$, '我不睡觉了，我喝了American style coffee', AT)
    expect(JSON.parse((f.runs()[0]!.args[1] as { stdin: string }).stdin).messages).toEqual([{ role: 'user', content: 'Your earlier messages in this chat:\n呼...这波大活,本天才监工得漂亮吧?\n\nReply in Chinese (Simplified).\n我不睡觉了，我喝了American style coffee' }])
    await r.talk(f.$, 'ok', AT)
    expect(last(f)).toBe('Reply in Chinese (Simplified).\nok')
    await r.talk(f.$, 'привет, как дела', AT)
    expect(last(f)).toBe('Reply in the language of their message.\nпривет, как дела')
    await r.talk(f.$, 'ok', AT)
    expect(last(f)).toBe('Reply in the language of their messages.\nok')
    // a guess under the band's bar names nothing
    await r.talk(f.$, 'hallo zusammen', AT)
    expect(last(f)).toBe('Reply in the language of their message.\nhallo zusammen')
    const g = world(), fresh = keyed('ja')
    await fresh.talk(g.$, 'ok', AT)
    expect(last(g)).toBe('Reply in Japanese.\nok')
    // on the plan the same line rides before their message
    const h = world(), plan = new MoreRuntime({ 'more.model.talk.persona': PERSONA }, { hearLanguage: hear })
    plan.restore({ talk: true }, [], undefined, AT)
    await plan.talk(h.$, '在吗', AT)
    expect((h.calls.find(c => c.name === 'model.complete')!.args[0] as { prompt: string }).prompt).toBe('Reply in Chinese (Simplified).\nperson: 在吗')
  })

  test('the plan path asks for effort low, for Talk and for Explain', async () => {
    const f = world(), r = runtime()
    await r.talk(f.$, 'hello', AT)
    r.lastAnswer = 'an answer to explain'
    await r.explain(f.$, AT, false)
    const requests = f.calls.filter(c => c.name === 'model.complete').map(c => c.args[0] as { effort?: string })
    expect(requests.length).toBe(2)
    expect(requests.every(q => q.effort === 'low')).toBe(true)
    expect(f.count('process.run')).toBe(0)
  })

  test('a canary key never passes the plugin: not in argv, environment, stdin, the store or a log', async () => {
    const f = world({ replies: [{ kind: 'works', last4: 'x7Qa', store: 'secret-service' }, { kind: 'ok', text: 'hi', usage: TOKENS, count: { minute: 1, day: 1 } }, { kind: 'removed' }] })
    const r = runtime()
    await r.choosePayer(f.$, 'key')
    await r.addKey(f.$)
    const [argv, init] = f.runs()[0]!.args as [string[], { timeoutMs: number }]
    expect(argv).toEqual([PROGRAM, 'add', '--dialog', '--title', w('dialog.title'), '--text', w('dialog.text'), '--save', w('dialog.save'), '--cancel', w('dialog.cancel')])
    // A person is typing: ten minutes, not the 30 s default.
    expect(init.timeoutMs).toBe(600000)
    expect(f.stored['more.key']).toEqual({ last4: 'x7Qa', state: 'works', store: 'secret-service' })
    await r.talk(f.$, 'hi', AT)
    await r.removeKey(f.$)
    expect((f.runs()[2]!.args[0] as string[])).toEqual([PROGRAM, 'remove'])
    expect(f.stored['more.key']).toBe(null)
    expect(everything(f).includes(CANARY)).toBe(false)
    expect(everything(f).includes('sk-ant-api')).toBe(false)
    expect(f.count('ui.log')).toBe(0)
  })

  test('a pasted key in Talk is refused and kept nowhere, on either payer', async () => {
    for (const payer of ['session', 'key'] as const) {
      const f = world(), r = runtime()
      r.restoreKey(payer, { last4: 'x7Qa', state: 'works' }, undefined, undefined, AT)
      r.talkInput = 'my key is ' + CANARY
      await r.talk(f.$, 'my key is ' + CANARY, AT)
      expect(f.count('model.complete') + f.count('process.run')).toBe(0)
      expect(r.exchanges).toEqual([{ side: 'him', text: w('talk.fail.pasted'), failure: 'pasted' }])
      expect(r.talkInput).toBe('')
      expect(JSON.stringify(r.exchanges).includes(CANARY) || everything(f).includes(CANARY)).toBe(false)
    }
  })

  test('each failure kind is its own line with the decided buttons; the four computer-side ones are one line', async () => {
    const cases: [Reply, string][] = [
      [{ kind: 'invalid', status: 401 }, 'invalid'], [{ kind: 'credit', status: 402 }, 'credit'], [{ kind: 'model', status: 404 }, 'model'],
      [{ kind: 'rate', status: 429, retry_after: 20 }, 'rate'], [{ kind: 'daily' }, 'daily'], [{ kind: 'busy', status: 529 }, 'busy'],
      [{ kind: 'offline', detail: 'tls-certificate' }, 'offline'], [{ kind: 'refusal' }, 'refusal'], [{ kind: 'cap' }, 'cap'],
      [{ kind: 'other', status: 413 }, 'other'],
      [{ kind: 'computer', detail: 'keychain-denied' }, 'computer'], [{ kind: 'computer', detail: 'keyring-locked' }, 'computer'],
      [{ kind: 'computer', detail: 'missing' }, 'computer'], ['reject', 'computer'], [{ nonsense: true }, 'computer'],
    ]
    for (const [reply, failure] of cases) {
      const f = world({ replies: [reply] }), r = await keyRuntime(f)
      await r.talk(f.$, 'hello', AT)
      const line = r.exchanges.at(-1)!
      expect(line.failure).toBe(failure as never)
      const fill = { s: 20, status: (reply as { status?: number }).status ?? '-' }
      expect(line.text).toBe(moreFill(w(`talk.fail.${failure}`), fill))
      expect(line.retry).toBe('hello')
      const tree = MoreTalk(E, { snapshot: r.snapshot(), surface: 'terminal', exchanges: r.exchanges, name: 'Coco', payer: 'plan' })
      const buttons = KEY_FAILURE_BUTTONS[failure as keyof typeof KEY_FAILURE_BUTTONS]
      const index = r.exchanges.length - 1
      expect(keys(tree).includes(`coco:talk:openSettings:${index}`)).toBe(buttons.settings)
      expect(keys(tree).includes(`coco:talk:fallback:${index}`)).toBe(buttons.fallback)
      expect(nodes(tree).some(n => n.type === 'Text' && n.props?.color === 'error')).toBe(true)
    }
    // A missing program is the same computer-side line, without running anything.
    const f = world({ exists: false }), r = await keyRuntime(f)
    await r.talk(f.$, 'hello', AT)
    expect(r.exchanges.at(-1)!.failure).toBe('computer')
    expect(f.count('process.run')).toBe(0)
  })

  test('card 1: nothing switches by itself; the fallback press sends that one message on the plan', async () => {
    const f = world({ replies: [{ kind: 'invalid', status: 401 }] }), r = await keyRuntime(f)
    await r.talk(f.$, 'going to make tea', AT)
    expect(f.count('model.complete')).toBe(0)
    expect(r.key?.state).toBe('refused')
    expect(f.stored['more.key']).toEqual({ last4: 'x7Qa', state: 'refused', store: 'file' })
    await r.talkFallback(f.$, r.exchanges.length - 1, AT)
    const sent = f.calls.filter(c => c.name === 'model.complete').map(c => c.args[0] as { prompt: string; effort: string })
    expect(sent.length).toBe(1)
    expect(sent[0]!.prompt.endsWith('person: going to make tea')).toBe(true)
    expect(r.exchanges).toEqual([{ side: 'person', text: 'going to make tea' }, { side: 'him', text: 'plan reply' }])
    expect(r.payer()).toBe('key')
  })

  test('the payer is the person choice; a program the desktop app refuses leaves only the session payer', async () => {
    const f = world({ replies: ['reject'] }), r = runtime({ host: { ...HOST, desktop: true } })
    await r.choosePayer(f.$, 'key')
    expect(f.stored['more.payer']).toBe('key')
    await r.talk(f.$, 'hello', AT)
    expect(r.keyNoRun).toBe(true)
    expect(r.payer()).toBe('session')
    const tree = MorePage(E, { snapshot: { ...r.snapshot(), values: { talk: true } }, surface: 'terminal', payer: 'plan' })
    const select = nodes(tree).find(n => keyOf(n) === 'coco:more:payer')
    expect(select.props.options.map((o: { value: string }) => o.value)).toEqual(['session'])
    expect(texts(tree).includes(w('key.noRun'))).toBe(true)
  })

  test('Talk off: a 50-prompt replay never runs the key program and calls nothing', async () => {
    const f = world(), r = runtime({ on: {} })
    r.restoreKey('key', { last4: 'x7Qa', state: 'works' }, undefined, undefined, AT)
    for (let i = 0; i < 50; i++) {
      expect(r.talkFromPrompt(f.$, i % 2 ? `sama, prompt ${i}` : `小克，第${i}条`, AT)).toBe(false)
      expect(r.talk(f.$, `prompt ${i}`, AT)).toBe(undefined)
    }
    expect(r.explain(f.$, AT, false)).toBe(undefined)
    expect(f.calls).toEqual([])
  })

  test('the cap: 250 calls in both languages and both prompt shapes stay under it; a 1 MB paste and a 200 KB selection send nothing', async () => {
    let seed = 7
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const zh = '今天好累测试终于过了他把书合上', en = 'long day the tests finally pass '
    for (let i = 0; i < 250; i++) {
      const pool = i % 2 ? zh : en, say = (n: number) => Array.from({ length: n }, () => pool[rand(pool.length)]).join('')
      const f = world(), r = i % 4 < 2 ? runtime() : await keyRuntime(f)
      r.exchanges = Array.from({ length: 12 }, (_, k) => ({ side: k % 2 ? 'him' : 'person', text: say(rand(2) ? 150 : 7000) }))
      await r.talk(f.$, say(1 + rand(150)), AT)
      const plan = f.calls.find(c => c.name === 'model.complete')?.args[0] as { system: string; prompt: string } | undefined
      if (plan) expect(talkEstimate(plan.system, plan.prompt)).toBeLessThanOrEqual(TALK_CAP)
      const run = f.runs()[0]
      if (run) {
        const request = JSON.parse((run.args[1] as { stdin: string }).stdin) as { system: string; messages: { content: string }[] }
        expect(talkEstimate(request.system, ...request.messages.map(m => m.content))).toBeLessThanOrEqual(TALK_CAP)
      }
      expect(Number(!!plan) + Number(!!run)).toBe(1)
    }
    const f = world(), r = await keyRuntime(f)
    await r.talk(f.$, 'x'.repeat(1 << 20), AT)
    r.lastAnswer = 'y'.repeat(200 * 1024)
    await r.explain(f.$, AT, false)
    expect(f.count('model.complete') + f.count('process.run')).toBe(0)
  })

  test('Explain refuses over 96,500 bytes and sends the rest on the key with max_tokens 400', async () => {
    const f = world(), r = await keyRuntime(f)
    r.lastAnswer = 'z'.repeat(EXPLAIN_TEXT_LIMIT + 1)
    await r.explain(f.$, AT, false)
    expect(f.count('process.run')).toBe(0)
    r.lastAnswer = 'z'.repeat(EXPLAIN_TEXT_LIMIT - 1000)
    await r.explain(f.$, AT, false)
    const request = JSON.parse((f.runs()[0]!.args[1] as { stdin: string }).stdin)
    expect(request.max_tokens).toBe(400)
    expect(request.messages.length).toBe(1)
    expect(request.system).toBe(undefined)
    expect(r.explanation).toBe('key reply')
  })

  test('the persona is linted at 10,000 bytes: a longer one sends nothing', async () => {
    const f = world(), r = runtime({ persona: '人'.repeat(TALK_PERSONA_LIMIT / 3 + 1) })
    expect(r.talk(f.$, 'hello', AT)).toBe(undefined)
    expect(f.calls).toEqual([])
  })

  test('self-correction: usage over the estimate makes the factor 2 once, and the cap then sheds twice as early', async () => {
    const f = world({ complete: { input_tokens: 50000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }), r = runtime()
    await r.talk(f.$, 'hello', AT)
    expect(r.estimateFactor).toBe(2)
    // with no language heard and no earlier message, the band's: English here
    expect(f.stored['more.estimateFactor']).toEqual({ factor: 2, estimate: talkEstimate(PERSONA, 'Reply in English.\nperson: hello'), usage: 50000 })
    const logged = f.calls.filter(c => c.name === 'ui.log')
    expect(logged.length).toBe(1)
    expect(logged[0]!.args).toEqual([`talk estimate too low (${talkEstimate(PERSONA, 'Reply in English.\nperson: hello')} estimated, 50000 sent); estimates now count double`, { to: 'debug' }])
    r.exchanges = Array.from({ length: 12 }, (_, k) => ({ side: k % 2 ? 'him' : 'person', text: String(k).padEnd(6000, 'w') }))
    await r.talk(f.$, 'again', AT)
    const prompt = (f.calls.filter(c => c.name === 'model.complete').at(-1)!.args[0] as { prompt: string }).prompt
    expect(talkEstimate(PERSONA, prompt) * 2).toBeLessThanOrEqual(TALK_CAP)
    const restored = runtime()
    restored.restoreKey(undefined, undefined, undefined, f.stored['more.estimateFactor'], AT)
    expect(restored.estimateFactor).toBe(2)
  })

  test('the key row: add, works, refused, kept per store, the limits, the env note, and the count only from 240', () => {
    const r = runtime(), base = { surface: 'terminal', payer: 'plan' as const, place: { platform: 'linux' as const, noDisplay: false, remote: false, command: PROGRAM + ' add' } }
    const draw = (patch: Partial<MoreBookData>) => MorePage(E, { ...base, snapshot: { ...r.snapshot(), values: { talk: true } }, ...patch } as MoreBookData)
    r.restoreKey('key', undefined, undefined, undefined, AT)
    expect(keys(draw({}))).toContain('coco:more:key:add')
    r.restoreKey('key', { last4: 'x7Qa', state: 'works', store: 'file' }, { date: '2026-10-07', n: 1, tokens: 1, usd: 0, day: KEY_NEAR_CAP - 1 }, undefined, AT)
    r.keyToday = { date: 'x', n: 14, tokens: 21000, usd: 0.003, day: KEY_NEAR_CAP - 1 }
    let tree = draw({})
    expect(texts(tree)).toContain('sk-ant-…x7Qa')
    expect(texts(tree)).toContain(w('key.works'))
    expect(texts(tree)).toContain(w('key.kept.file'))
    expect(texts(tree)).toContain('~/.config/coco/talk-key')
    expect(texts(tree)).toContain(moreFill(w('key.limit'), { max: 6 }))
    expect(texts(tree).some(t => t.startsWith(moreFill(w('key.limit.nearCap'), { n: KEY_NEAR_CAP - 1 })))).toBe(false)
    const textNode = (t: any, text: string) => nodes(t).find(n => n.type === 'Text' && texts(n)[0] === text)
    expect(textNode(tree, w('key.envNote'))?.props?.color).toBe('inactive')
    expect(texts(tree)).toContain(moreFill(w('talk.today'), { n: 14, k: '21k', usd: '$0.003' }))
    expect(texts(tree)).toContain(w('payer.group'))
    r.keyToday = { ...r.keyToday, day: KEY_NEAR_CAP }
    expect(texts(draw({}))).toContain(moreFill(w('key.limit.nearCap'), { n: KEY_NEAR_CAP }))
    r.restoreKey('key', { last4: 'x7Qa', state: 'refused', store: 'keychain' }, undefined, undefined, AT)
    tree = draw({})
    expect(nodes(tree).find(n => n.type === 'Text' && n.props?.color === 'error')).toBeDefined()
    expect(texts(tree)).toContain(w('key.refused'))
    expect(texts(tree)).toContain(w('key.kept.mac'))
    // A screen reader hears the last four characters only.
    tree = MorePage(E, { ...base, snapshot: { ...r.snapshot(), values: { talk: true }, screenReader: true } } as MoreBookData)
    expect(texts(tree)).toContain(moreFill(w('key.spoken'), { tail: 'x7Qa' }))
  })

  test('no display, the phone and 24 columns', () => {
    const r = runtime()
    r.restoreKey('key', undefined, undefined, undefined, AT)
    const snap = { ...r.snapshot(), values: { talk: true } }
    let tree = MorePage(E, { snapshot: snap, surface: 'terminal', payer: 'plan', place: { platform: 'linux', noDisplay: true, remote: false, command: PROGRAM + ' add' } })
    expect(texts(tree)).toContain(w('key.ssh'))
    expect(texts(tree)).toContain(PROGRAM + ' add')
    expect(keys(tree)).toContain('coco:more:key:copy')
    expect(keys(tree)).not.toContain('coco:more:key:add')
    tree = MorePage(E, { snapshot: snap, surface: 'mobile', payer: 'plan' })
    expect(texts(tree)).toContain(w('key.phone'))
    expect(keys(tree)).not.toContain('coco:more:key:add')
    tree = MorePage(E, { snapshot: snap, surface: 'terminal', payer: 'plan', columns: 24, place: { platform: 'darwin', noDisplay: false, remote: false, command: '' } })
    expect(texts(tree)).toContain(w('payer.label.short'))
    expect(texts(tree)).toContain(w('payer.group.short'))
    expect(texts(tree)).toContain(w('key.kept.mac.short'))
    expect(texts(tree)).toContain(w('key.envNote.short'))
  })

  test('Talk names who pays at the top: the key with its last four, the plan, or the session account', () => {
    const r = runtime()
    r.restoreKey('key', { last4: 'x7Qa', state: 'works' }, undefined, undefined, AT)
    const top = (payer: 'plan' | 'account') => texts(MoreTalk(E, { snapshot: r.snapshot(), surface: 'terminal', exchanges: [], name: 'n', payer }))
    expect(top('plan')).toContain(moreFill(w('talk.payer.key'), { tail: 'x7Qa' }))
    r.restoreKey('session', undefined, undefined, undefined, AT)
    expect(top('plan')).toContain(w('talk.payer.plan'))
    expect(top('account')).toContain(w('talk.payer.account'))
  })

  test('the add answers: format and refused have their lines, cancelled says nothing', async () => {
    for (const [reply, notice] of [[{ kind: 'format', detail: 'admin-key' }, w('key.format')], [{ kind: 'invalid', status: 401 }, w('key.refused')], [{ kind: 'cancelled' }, undefined]] as const) {
      const f = world({ replies: [reply] }), r = runtime()
      await r.addKey(f.$)
      expect(r.keyNotice).toBe(notice)
      expect(r.key).toBe(undefined)
    }
    expect(parseKeyReply('{"kind":"works","last4":"x7Qa\\n<script>","store":"file"}').last4).toBe(undefined)
    // Typed for another host, a refused add names that host; a bad address has its own line.
    for (const [reply, notice] of [[{ kind: 'invalid', status: 401 }, moreFill(w('key.refusedAt'), { host: 'gw.example.com:8443' })], [{ kind: 'address', detail: 'scheme' }, w('key.address')]] as const) {
      const f = world({ replies: [reply] }), r = runtime()
      r.setKeyEndpoint('base', 'https://gw.example.com:8443/v1')
      await r.addKey(f.$)
      expect(r.keyNotice).toBe(notice)
      expect(r.keyNotice).not.toContain('{')
    }
  })

  test('«Check again» runs status alone and takes its answer onto the row', async () => {
    const r = runtime(), base = { surface: 'terminal', payer: 'plan' as const, place: { platform: 'linux' as const, noDisplay: false, remote: false, command: PROGRAM + ' add' } }
    const draw = () => MorePage(E, { ...base, snapshot: { ...r.snapshot(), values: { talk: true } } } as MoreBookData)
    r.restoreKey('key', undefined, undefined, undefined, AT)
    expect(keys(draw())).not.toContain('coco:more:key:check')
    r.restoreKey('key', { ...GW }, undefined, undefined, AT)
    const button = nodes(draw()).find(n => keyOf(n) === 'coco:more:key:check')
    expect(button?.props?.label).toBe(w('key.check'))
    expect(texts(draw())).toContain(w('key.unchecked'))
    // No display: the check needs no dialog, so it stays.
    expect(keys(MorePage(E, { ...base, place: { ...base.place, noDisplay: true }, snapshot: { ...r.snapshot(), values: { talk: true } } } as MoreBookData))).toContain('coco:more:key:check')
    const f = world({ replies: [{ kind: 'works', last4: '6789', store: 'file', host: GW.host, model: GW.model }, { kind: 'invalid', status: 401 }, { kind: 'offline', detail: 'dns' }] })
    await r.checkKey(f.$)
    expect(f.runs()[0]!.args[0]).toEqual([PROGRAM, 'status'])
    expect((f.runs()[0]!.args[1] as { stdin?: string }).stdin).toBe(undefined)
    expect(r.key).toEqual({ ...GW, state: 'works' })
    expect(f.stored['more.key']).toEqual({ ...GW, state: 'works' })
    await r.checkKey(f.$)
    expect(r.key?.state).toBe('refused')
    expect(texts(draw())).toContain(moreFill(w('key.refusedAt'), { host: GW.host }))
    await r.checkKey(f.$)
    expect(r.keyNotice).toBe(moreFill(w('talk.fail.offlineAt'), { host: GW.host, model: GW.model }))
    expect(f.runs().length).toBe(3)
    expect(f.runs().every(c => (c.args[0] as string[])[1] === 'status')).toBe(true)
    // With the slot missing there is no button.
    await withSlots({ 'key.check': '' }, () => { expect(keys(draw())).not.toContain('coco:more:key:check') })
  })

  test('fr shows its own «Ajouter une clé API…» again', () => {
    expect(moreWord('key.add', 'fr')).toBe('Ajouter une clé API…')
  })
})

// TALK-KEY «Changed 10-10, the owner»: another provider's endpoint, bound to the key by the program.
async function withSlots<T>(slots: Record<string, string>, run: () => T | Promise<T>): Promise<T> {
  const old: Record<string, Record<string, string> | undefined> = {}
  for (const [k, v] of Object.entries(slots)) { const key = 'more.' + k; old[key] = MORE_SLOTS[key]; MORE_SLOTS[key] = { en: v } }
  try { return await run() } finally { for (const [key, v] of Object.entries(old)) { if (v) MORE_SLOTS[key] = v; else delete MORE_SLOTS[key] } }
}
const GW = { last4: '6789', state: 'unchecked' as const, store: 'file' as const, host: 'gateway.example.com:8443', model: 'gateway-model-1' }

describe('TALK-KEY another provider', () => {
  test('a gateway key saved unchecked becomes works after the first good send, with no dollar figure', async () => {
    const f = world({ replies: [{ kind: 'saved', last4: '6789', store: 'file', host: GW.host, model: GW.model }, { kind: 'ok', text: 'gw reply', usage: TOKENS, count: { minute: 1, day: 1 }, host: GW.host, model: GW.model }] })
    const prices: string[] = []
    const r = new MoreRuntime({ 'more.model.talk.persona': PERSONA }, { keyHost: async () => HOST, keyPrice: async model => { prices.push(model); return PRICE } })
    r.restore({ talk: true }, [], undefined, AT)
    await r.choosePayer(f.$, 'key')
    r.setKeyEndpoint('base', 'https://gateway.example.com:8443/v')
    r.setKeyEndpoint('model', 'gateway-model-1')
    await withSlots({ 'dialog.textAt': 'Paste a key for {host}.' }, () => r.addKey(f.$))
    const argv = f.runs()[0]!.args[0] as string[]
    expect(argv.slice(-4)).toEqual(['--base', 'https://gateway.example.com:8443/v', '--model', 'gateway-model-1'])
    expect(argv[argv.indexOf('--text') + 1]).toBe('Paste a key for gateway.example.com:8443.')
    expect(r.key).toEqual(GW)
    await r.talk(f.$, 'hello', AT)
    expect(r.key).toEqual({ ...GW, state: 'works' })
    expect(prices).toEqual([])
    expect(r.keyToday.usd).toBe(0)
    expect(r.keyToday.tokens).toBe(1400)
    // Tokens only, never a dollar sign.
    const page = texts(MorePage(E, { snapshot: { ...r.snapshot(), values: { talk: true } }, surface: 'terminal', payer: 'plan' }))
    expect(page).toContain(moreFill(w('talk.today.tokens'), { n: 1, k: '1k' }))
    expect(page.some(t => t.includes('$'))).toBe(false)
  })

  test('a Claude model on api.anthropic.com is priced from its own row', async () => {
    const f = world({ replies: [{ kind: 'ok', text: 'x', usage: TOKENS, count: { minute: 1, day: 1 }, host: 'api.anthropic.com', model: 'claude-sonnet-5' }] })
    const prices: string[] = []
    const r = new MoreRuntime({ 'more.model.talk.persona': PERSONA }, { keyHost: async () => HOST, keyPrice: async model => { prices.push(model); return PRICE } })
    r.restore({ talk: true }, [], undefined, AT)
    r.restoreKey('key', { last4: 'x7Qa', state: 'works', host: 'api.anthropic.com', model: 'claude-sonnet-5' }, undefined, undefined, AT)
    await r.talk(f.$, 'hello', AT)
    expect(prices).toEqual(['claude-sonnet-5'])
    expect(r.keyToday.usd).toBe(keyCost(TOKENS, PRICE))
  })

  test('another host gets its own …At line naming the host or the model, never Anthropic or Haiku', async () => {
    for (const [reply, slot] of [[{ kind: 'invalid', status: 401 }, 'invalidAt'], [{ kind: 'offline', detail: 'dns' }, 'offlineAt'], [{ kind: 'model', status: 404 }, 'modelAt'], [{ kind: 'busy', status: 503 }, 'busyAt'], [{ kind: 'refusal' }, 'refusalAt']] as [Reply, string][]) {
      const f = world({ replies: [reply] }), r = runtime()
      r.restoreKey('key', { ...GW, state: 'works' }, undefined, undefined, AT)
      await r.talk(f.$, 'hello', AT)
      const line = r.exchanges.at(-1)!.text
      expect(w(`talk.fail.${slot}`)).not.toBe('')
      expect(line).toBe(moreFill(w(`talk.fail.${slot}`), { host: GW.host, model: GW.model }))
      expect(line.includes(slot === 'refusalAt' ? GW.model : GW.host)).toBe(true)
      expect(/Anthropic|Haiku|\{/.test(line)).toBe(false)
    }
    // Until a …At slot is written, the generic line stands in: it names no one.
    await withSlots({ 'talk.fail.busyAt': '' }, async () => {
      const f = world({ replies: [{ kind: 'busy', status: 503 }] }), r = runtime()
      r.restoreKey('key', { ...GW, state: 'works' }, undefined, undefined, AT)
      await r.talk(f.$, 'hello', AT)
      expect(r.exchanges.at(-1)!.text).toBe(moreFill(w('talk.fail.other'), { status: 503 }))
    })
    // The rate, daily and computer lines say nothing about the host and stay.
    const f = world({ replies: [{ kind: 'daily' }] }), r = runtime()
    r.restoreKey('key', { ...GW, state: 'works' }, undefined, undefined, AT)
    await r.talk(f.$, 'hello', AT)
    expect(r.exchanges.at(-1)!.text).toBe(w('talk.fail.daily'))
  })

  test('for another host the payer line, the kept line and the disclosure name its host and model, never Anthropic or Haiku', async () => {
    const r = runtime()
    r.restoreKey('key', { ...GW, state: 'works' }, undefined, undefined, AT)
    const talk = texts(MoreTalk(E, { snapshot: r.snapshot(), surface: 'terminal', exchanges: [], name: 'n', payer: 'plan' }))
    expect(talk).toContain(moreFill(w('talk.payer.keyAt'), { tail: '6789', host: GW.host }))
    expect(talk.some(t => t.split('\n').includes(moreFill(w('talk.disclosure.other'), { model: GW.model })))).toBe(true)
    expect(talk.some(t => t.includes(w('talk.disclosure')))).toBe(false)
    const page = texts(MorePage(E, { snapshot: { ...r.snapshot(), values: { talk: true } }, surface: 'terminal', payer: 'plan', place: { platform: 'linux', noDisplay: false, remote: false, command: '' } }))
    expect(page).toContain(moreFill(w('key.keptAt.file'), { host: GW.host }))
    expect(page.some(t => t.includes('api.anthropic.com') || t.includes('{host}'))).toBe(false)
    // Without its slot the plain payer line is followed by the host on its own line.
    await withSlots({ 'talk.payer.keyAt': '' }, () => {
      expect(texts(MoreTalk(E, { snapshot: r.snapshot(), surface: 'terminal', exchanges: [], name: 'n', payer: 'plan' }))).toContain(moreFill(w('talk.payer.key'), { tail: '6789' }) + '\n' + GW.host)
    })
  })

  test('the base URL and model fields show with their labels, and hide while any word they need is missing', async () => {
    const r = runtime()
    r.restoreKey('key', undefined, undefined, undefined, AT)
    const tree = () => MorePage(E, { snapshot: { ...r.snapshot(), values: { talk: true } }, surface: 'terminal', payer: 'plan', place: { platform: 'linux', noDisplay: false, remote: false, command: '' } })
    const draw = () => keys(tree())
    expect(draw()).toContain('coco:more:key:base')
    expect(draw()).toContain('coco:more:key:model')
    expect(texts(tree())).toContain(w('key.base.label'))
    expect(texts(tree())).toContain(w('key.model.label'))
    for (const slot of KEY_ENDPOINT_SLOTS) {
      await withSlots({ [slot]: '' }, () => {
        expect(draw()).not.toContain('coco:more:key:base')
        expect(draw()).not.toContain('coco:more:key:model')
      })
    }
    // On the phone the fields never show.
    expect(keys(MorePage(E, { snapshot: { ...r.snapshot(), values: { talk: true } }, surface: 'mobile', payer: 'plan' }))).not.toContain('coco:more:key:base')
    r.setKeyEndpoint('base', "https://gw.example.com/it's")
    expect(r.addCommand(HOST)).toBe(`${PROGRAM} add --base 'https://gw.example.com/it'\\''s'`)
  })
})

describe('TALK-KEY the build for this computer', () => {
  test('macOS keeps its signed build in libexec; Windows and Linux take the build for their processor', () => {
    expect(talkKeyPath(ROOT, 'darwin')).toBe(ROOT + '/libexec/talk-key')
    expect(talkKeyPath(ROOT, 'linux', 'x86_64')).toBe(ROOT + '/libexec/talk-key-linux-x86_64')
    expect(talkKeyPath(ROOT, 'linux', 'aarch64')).toBe(ROOT + '/libexec/talk-key-linux-aarch64')
    expect(talkKeyPath('C:\\fixture\\plugin', 'win32', 'x86_64')).toMatch(/^C:\\fixture\\plugin[\\/]libexec[\\/]talk-key-windows-x86_64\.exe$/)
    expect(talkKeyPath(ROOT, 'win32', 'aarch64')).toBe(ROOT + '/libexec/talk-key-windows-aarch64.exe')
    expect(talkKeyPath(ROOT, 'linux')).toBeUndefined()
    expect(talkKeyPath(ROOT, 'win32')).toBeUndefined()
    expect(['AMD64', 'x86_64', 'ARM64', 'aarch64', 'arm64', 'x86', 'riscv64', 'armv7l', '', undefined].map(keyArch))
      .toEqual(['x86_64', 'x86_64', 'aarch64', 'aarch64', 'aarch64', undefined, undefined, undefined, undefined, undefined])
  })

  test('a processor without a build runs nothing, offers no command and copies nothing', async () => {
    const f = world(), host: KeyHost = { root: ROOT, platform: 'linux', desktop: false }
    expect(await runTalkKey(f.$, host, ['status'])).toEqual({ kind: 'computer', detail: 'noProgram' })
    expect(f.count('process.run')).toBe(0)
    expect(f.count('fs.exists')).toBe(0)
    const r = runtime({ host })
    expect(r.addCommand(host)).toBe('')
    expect(await r.keyCommand()).toBe('')
    await r.copyAddCommand(f.$)
    expect(f.count('ui.copy')).toBe(0)
    const snap = r.snapshot()
    expect(keys(MorePage(E, { snapshot: snap, surface: 'terminal', payer: 'plan', place: { platform: 'linux', noDisplay: true, remote: false, command: '' } }))).not.toContain('coco:more:key:ssh')
  })

  test('the build that is there runs, and its command is the one copied', async () => {
    const f = world(), r = runtime()
    expect(await runTalkKey(f.$, HOST, ['status'])).toMatchObject({ kind: 'ok' })
    expect(f.runs()[0]!.args[0]).toEqual([PROGRAM, 'status'])
    expect(await r.keyCommand()).toBe(PROGRAM + ' add')
    await r.copyAddCommand(f.$)
    expect(f.calls.filter(c => c.name === 'ui.copy').map(c => c.args[0])).toEqual([{ text: PROGRAM + ' add' }])
  })
})
