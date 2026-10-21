import type { On } from 'claude-code'
import { world, RECENT, PERSON, P, band, desktopPicture, settleLegacyStart } from './world'
import { atomicFeed, PROCESS_OK } from './shared-world'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { RUNTIME_PROMISE_INPUT } from './promises-runtime-input'

export const PROMISE_HOME = '/tmp/p1-runtime-home'
export const PROMISE_PROJECT = '/tmp/p1-runtime-project'
export const PROMISE_FOLDER = PROMISE_HOME + '/Library/Application Support/Coco'
export const PRIVATE = { prompt: 'P1_PRIVATE_PROMPT_483bd', reply: 'P1_PRIVATE_REPLY_762ae', input: 'P1_PRIVATE_TOOL_328ab', file: 'P1_PRIVATE_FILE_7acc1', notice: 'P1_PRIVATE_NOTICE_ceb13' }
export const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
// Each declared registration noun is driven below or emitted by shipping code
// during the sequence. Filter branches, all possible sequences, and other test
// files are outside this fixture's scope.
// model.complete and model.fork are plugin-initiated: only the keep-warm keeper can reach them, and only with its More
// row on (A4). Listing them here is the claim that this fixture, row off, sees neither (f.models stays empty).
export const DRIVEN_HOOKS = ['agent.spawn', 'classic.CwdChanged', 'command.*', 'config.describe', 'ui.press', 'command.run', 'ui.close', 'store.set', 'state.set', 'session.usage', 'session.start', 'session.attach', 'session.detach', 'session.end', 'session.compact', 'session.measure', 'config.set', 'classic.Notification', 'prompt.submit', 'session.append', 'turn.step', 'turn.start', 'tool.call', 'tool.check', 'turn.complete', 'ui.render', 'prompt.compose', 'classic.PreModelSwitch', 'model.complete', 'model.fork']
// M1 (10-09): the always-on gaps and the More page listen to these too; each is driven below with the
// private fixture strings, so the same no-model, no-network and private-payload checks cover them.
export const M1_CLASSIC = ['ConfigChange', 'DirectoryAdded', 'Elicitation', 'ElicitationResult', 'FileChanged', 'PermissionDenied', 'PostCompact', 'PostModelSwitch', 'PostToolBatch', 'PostToolUse', 'PostToolUseFailure', 'SessionStart', 'Setup', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'TaskCompleted', 'TaskCreated', 'TeammateIdle', 'UserPromptSubmit', 'WorktreeCreate', 'WorktreeRemove'] as const
export const M1_DRIVEN_HOOKS = [...M1_CLASSIC.map(name => 'classic.' + name), 'classic.PermissionRequest', 'agent.offer', 'skill.prompt', 'command.describe', 'prompt.edit', 'session.receive', 'session.send', 'ui.focus', 'ui.input', 'ui.message', 'ui.scroll', 'ui.select']
export const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
export const TOOL_CASES = [
  { tool: 'Read', file_path: PROMISE_PROJECT + '/a.ts' },
  { tool: 'Write', file_path: PROMISE_PROJECT + '/out.ts', content: PRIVATE.file },
  { tool: 'Edit', file_path: PROMISE_PROJECT + '/a.ts', old_string: PRIVATE.file, new_string: PRIVATE.input },
  { tool: 'MultiEdit', file_path: PROMISE_PROJECT + '/a.ts', edits: [{ old_string: PRIVATE.file, new_string: PRIVATE.input }] },
  { tool: 'NotebookEdit', notebook_path: PROMISE_PROJECT + '/demo.ipynb', new_source: PRIVATE.file },
  { tool: 'Bash', command: 'printf ' + PRIVATE.input },
  { tool: 'Grep', pattern: PRIVATE.input, path: PROMISE_PROJECT },
  { tool: 'Glob', pattern: '**/' + PRIVATE.input },
  { tool: 'WebSearch', query: PRIVATE.input },
  { tool: 'WebFetch', url: 'https://example.invalid', prompt: PRIVATE.input },
  { tool: 'Agent', prompt: PRIVATE.input, subagent_type: 'general-purpose', description: 'helper' },
  { tool: 'AskUserQuestion', questions: [{ question: PRIVATE.input, header: 'Choice', options: [{ label: 'A', description: 'A' }, { label: 'B', description: 'B' }] }] },
  { tool: 'EnterPlanMode' }, { tool: 'ExitPlanMode' },
  { tool: 'mcp__private_server__inspect_widget', input: PRIVATE.input },
] as const

export function promiseWorld(on: On, options: { voice?: 'off' | 'light' | 'full'; companion?: boolean; pictures?: boolean; onRender?: (component: string) => void; toolCheck?: () => { decision: 'allow' | 'ask' | 'deny'; reason?: string }; permissionResult?: () => unknown } = {}) {
  // SPEC0.3:536-548 adds the actual helper spawn event to the audited event set.
  on('agent.spawn', () => ({ agentId: 'p1-runtime-helper', model: 'fixture' }))
  on('classic.CwdChanged', () => ({}))
  for (const name of M1_CLASSIC) on(('classic.' + name) as 'classic.Stop', () => ({}))
  on('classic.PreModelSwitch', () => ({}))
  const models: string[] = [], network: unknown[] = [], stores: { key: string; value: unknown }[] = []
  const fs: { name: string; path: string; root: string }[] = [], writes: { path: string; text: string }[] = []
  const modelChannels: { name: string; event: unknown }[] = []
  const appended: { door: string; uuid: string }[] = [], unsupportedAppend: string[] = [], unsupportedM1: string[] = []
  const appendOutcomes: ({ door: string; uuid: string } & ({ status: 'returned'; result: unknown } | { status: 'unsupported'; reason: string }))[] = []
  // The host noun is http.fetch. These seams never allow a real network/model/tool action.
  on('http.*', ($, e) => { network.push(e); return { value: { ok: false, status: 0, headers: {}, text: '' } } as never })
  on('model.*', ($, e, next) => { const fork = next.is('model.fork', e); models.push(fork ? 'model.fork' : 'model.complete'); return { value: fork ? { isAnswered: false, reason: 'nothing-to-fork' } : { isAnswered: false, reason: 'aborted', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as never })
  on('prompt.*', async ($, e, next) => { if (next.is('prompt.submit', e) && next.origin.plugin === 'coco') modelChannels.push({ name: 'prompt.submit', event: e }); return next(e) })
  on('tool.*', async ($, e, next) => { if (next.is('tool.call', e) && next.origin.plugin === 'coco') modelChannels.push({ name: 'tool.call', event: e }); return next(e) })
  on('store.*', async ($, e, next) => { if (next.is('store.set', e)) stores.push({ key: e.key, value: e.value }); return next(e) })
  on('fs.*', async ($, e, next) => {
    const names = ['exists', 'read', 'write', 'stat', 'list', 'remove', 'mkdir', 'rename', 'ancestors']
    const name = names.find(n => next.is(('fs.' + n) as never, e)) ?? 'other'
    // This observer's $.plugin.root is the kit's test plugin, so ownership uses
    // the runner's exact copied shipping plugin root, never the observer's root.
    for (const field of ['path', 'from', 'to', 'below']) if (typeof (e as any)[field] === 'string') fs.push({ name, path: (e as any)[field], root: RUNTIME_PROMISE_INPUT.pluginRoot })
    if (next.is('fs.write', e)) writes.push({ path: e.path, text: e.text })
    return next(e)
  })
  const w = world(on, { store: { ...RECENT, bandSettings: { voice: options.voice ?? 'off', voiceChosen: true, guard: true, bookmark: true, notes: true } },
    // The event picture audit covers reduced-motion normal and compact stills.
    // The caller separately checks the raw prebuilt-motion constructor seam.
    settings: options.pictures ? { prefersReducedMotion: true, mouse: true } : undefined,
    env: { HOME: PROMISE_HOME, LANG: 'en_US.UTF-8', TERM: options.pictures ? 'xterm-kitty' : 'xterm-256color', ...(options.pictures ? { KITTY_WINDOW_ID: '1' } : {}) },
    surfaces: [...SURFACES], sessionRoot: PROMISE_PROJECT, engineRows: true, stepText: PRIVATE.reply, onRender: options.onRender, toolCheck: options.toolCheck,
    toolResult: tool => tool === 'Read' ? { result: PRIVATE.file, text: PRIVATE.file } : undefined,
    readText: path => path.endsWith('c3-text.json') ? C3_WORDS_RAW : path.endsWith('frame-manifest.json') ? JSON.stringify(C3_HEAD_MANIFEST) : options.companion && path.endsWith('/companion.json') ? JSON.stringify({ running: false, version: '0.1.2', targets: ['claude', 'vscode'] }) : undefined })
  on('fs.exists', ($, e) => ({ value: e.path === '/System/Library/CoreServices/SystemVersion.plist' || !!options.companion && e.path === PROMISE_FOLDER }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 2, mtimeMs: 0, isLink: false } }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', ($, e) => { const feed = atomicFeed(e.argv, e.init?.stdin); if (feed) writes.push(feed); return { value: PROCESS_OK } })
  on('process.spawn', async function* () { throw Error('no child process in runtime promise fixture') })
  on('session.end', () => ({ sessionId: 'fixture-session' }))
  on('session.detach', ($, e) => ({ clientId: e.clientId }))
  on('classic.Notification', () => ({}))
  on('classic.PermissionRequest', () => (options.permissionResult?.() ?? {}) as never)
  // Observe the pre-next paths and retain each host result or specific missing-bottom error.
  on('session.append', ($, e, next) => { appended.push({ door: e.door, uuid: e.uuid }); return next(e) })
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('ui.scroll', () => ({ value: { isScrolled: true } } as never))
  on('ui.notice', () => ({ value: undefined }))
  const inspect = { tree: (_tree: unknown, _surface: string, _component: string) => {}, mainPicture: (_source: unknown) => {} }
  return { w, models, network, stores, fs, writes, modelChannels, inspect, appended, unsupportedAppend, unsupportedM1, appendOutcomes, pictures: !!options.pictures }
}

export async function drivePromiseEvents($: any, f: ReturnType<typeof promiseWorld>) {
  const append = async (event: any) => {
    try {
      const result = await $.session.append(event)
      f.appendOutcomes.push({ door: event.door, uuid: event.uuid, status: 'returned', result })
    } catch (error) {
      const reason = String(error)
      if (!reason.includes('no implementation for session.append')) throw error
      f.unsupportedAppend.push(event.door)
      f.appendOutcomes.push({ door: event.door, uuid: event.uuid, status: 'unsupported', reason })
    }
  }
  await $.session.start({ cwd: PROMISE_PROJECT, surface: 'terminal', isInteractive: true }); await settleLegacyStart($, f.w)
  await $.classic.CwdChanged({ old_cwd: PROMISE_PROJECT, new_cwd: PROMISE_PROJECT })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 400 })
  const switched = { from_model: 'fixture-a', to_model: 'fixture-b', requested_model: 'fixture-b', source: 'command' as const, context_tokens: 0, prompt_cache_warm: false, estimated_cache_write_usd: 0, pricing: 'catalog' as const, cache_ttl: '5m' as const }
  await $.classic.PreModelSwitch(switched)
  await $.classic.PostModelSwitch(switched)
  await $.classic.Stop({ stop_hook_active: false, session_crons: [] })
  await $.classic.StopFailure({ error: 'rate_limit' } as never)
  await $.agent.spawn({ prompt: PRIVATE.input, description: 'fixture helper', subagentType: 'general-purpose' })
  await $.session.attach({ surface: 'desktop', clientId: 'p1-desktop' })
  await $.session.detach({ surface: 'desktop', clientId: 'p1-desktop' })
  await $.prompt.submit({ text: PRIVATE.prompt, wait: false, origin: PERSON })
  await append({ door: 'prompt', uuid: 'p1-user-row', origin: PERSON, message: { type: 'user', role: 'user', content: [{ type: 'text', text: PRIVATE.prompt }], isMeta: false } })
  await $.turn.start({ text: PRIVATE.prompt, turnId: 'p1-turn' })
  for await (const _ of $.turn.step({ turnId: 'p1-turn', index: 0, model: 'test', messageCount: 1 })) {}
  await append({ door: 'response', uuid: 'p1-answer-row', origin: { kind: 'model', model: 'test' }, message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: PRIVATE.reply }] } })
  for (const input of TOOL_CASES) { await $.tool.check({ tool: input.tool, input, tool_use_id: 'p1-' + input.tool }); await $.tool.call(input) }
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: PRIVATE.input }, permission_suggestions: [] })
  await driveM1Events($, f)
  await $.turn.complete({ answer: PRIVATE.reply.repeat(16), durationMs: 3000, isAborted: false, turnId: 'p1-turn', reason: 'answer' })
  await $.classic.Notification({ message: PRIVATE.notice.repeat(16), notification_type: 'idle_prompt' })
  await $.session.measure({ context: { window: 200000, tokens: 40000, percent: 20 }, rateLimits: [], changed: ['context'] })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: PRIVATE.prompt, toolUses: [] }] })
  await $.config.set({ key: 'theme', value: 'light' })
  await $.config.describe({ key: 'coco.band', label: 'Coco', description: '', isHidden: false, provider: { plugin: 'coco', tier: 'user' } })
  await $.prompt.compose({ model: 'claude', promptModel: 'claude', tools: [], outputStyle: null, traits: [], surfaces: [...SURFACES] })
  for (const command of ['model', 'rewind', 'omen']) await $.command.run({ command, args: '', origin: PERSON, presentation: P })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...band(100) }); f.inspect.tree(await ui.drawn(), surface, 'AbovePrompt')
    if (f.pictures && surface === 'desktop') f.inspect.mainPicture(await desktopPicture(ui))
    await ui.unmount()
    if (f.pictures && surface === 'terminal') {
      // The terminal's pointer client posts to the plugin's ui.message hook (a fullscreen band, the mouse on, his picture).
      const fullscreen = await $.ui.mount({ surface, ...band(100), viewport: { columns: 100, rows: 48, isFullscreen: true } })
      await fullscreen.post({ t: 'glance', side: 'left' })
      await fullscreen.unmount()
    }
    const answer = await $.ui.mount({ surface, plugin: 'coco', component: 'AssistantMessage', props: { text: PRIVATE.reply, isFirstOfReply: true } }); f.inspect.tree(await answer.drawn(), surface, 'AssistantMessage'); await answer.unmount()
    const ask = await $.ui.mount({ surface, plugin: 'coco', component: 'AskUserQuestion', props: TOOL_CASES[11] }); f.inspect.tree(await ask.drawn(), surface, 'AskUserQuestion'); await ask.unmount()
    const user = await $.ui.mount({ surface, plugin: 'coco', component: 'UserMessage', props: { text: PRIVATE.prompt, origin: PERSON, isExpanded: true } }); f.inspect.tree(await user.drawn(), surface, 'UserMessage'); await user.unmount()
    const change = { tool_use_id: 'p1-change', tool: 'Edit', input: { file_path: PROMISE_PROJECT + '/a.ts', old_string: PRIVATE.file, new_string: PRIVATE.input }, isRunning: false, isErrored: false, isInterrupted: false, output: 'Applied' }
    const tool = await $.ui.mount({ surface, plugin: 'coco', component: 'ToolUse', props: change }); f.inspect.tree(await tool.drawn(), surface, 'ToolUse'); await tool.unmount()
    const group = await $.ui.mount({ surface, plugin: 'coco', component: 'ToolGroup', props: { calls: [change], isActive: false, isExpanded: true } }); f.inspect.tree(await group.drawn(), surface, 'ToolGroup'); await group.unmount()
    const compact = await $.ui.mount({ surface, plugin: 'coco', component: 'CommandOutput', props: { command: 'compact', args: '', text: 'Compacted.', isErrored: false } }); f.inspect.tree(await compact.drawn(), surface, 'CommandOutput'); await compact.unmount()
    const spinner = await $.ui.mount({ surface, plugin: 'coco', component: 'Spinner', props: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' } }); f.inspect.tree(await spinner.drawn(), surface, 'Spinner'); await spinner.unmount()
    if (surface === 'desktop') {
      const mode = await $.ui.mount({ surface, plugin: 'coco', component: 'SessionMode', props: { modes: ['focus'] } }); f.inspect.tree(await mode.drawn(), surface, 'SessionMode'); await mode.unmount()
    }
    for (const page of ['him', 'vibe', 'usage', 'log', 'library', 'settings']) {
      await $.command.run({ command: 'coco', args: page, origin: PERSON, presentation: P })
      const book = await $.ui.mount({ surface, ...PANE }); f.inspect.tree(await book.drawn(), surface, 'Pane')
      if (page === 'settings') {
        await book.press({ key: 'coco:book:tab:settings' }); f.inspect.tree(await book.drawn(), surface, 'Pane')
      }
      await book.unmount()
    }
  }
  await $.command.run({ command: 'p1-fixture-close', args: '', origin: PERSON, presentation: P })
  await f.w.clock.advance(60000)
  await $.command.run({ command: 'clear', args: '', origin: PERSON, presentation: P })
  await $.session.end({ reason: 'clear' }); await settleLegacyStart($, f.w)
}

// One call per M1 hook, carrying the private strings where the event has text. An event this kit
// cannot dispatch is recorded, never silently passed.
async function driveM1Events($: any, f: ReturnType<typeof promiseWorld>) {
  const drive = async (name: string, call: () => Promise<unknown>) => {
    try { await call() } catch (error) { if (!String(error).includes('no implementation for')) throw error; f.unsupportedM1.push(name) }
  }
  const tool = { tool_name: 'Bash', tool_input: { command: PRIVATE.input }, tool_use_id: 'p1-m1-tool' }
  const inputs: Record<typeof M1_CLASSIC[number], Record<string, unknown>> = {
    ConfigChange: { source: 'user_settings', file_path: PROMISE_PROJECT + '/settings.json' },
    DirectoryAdded: { directory: PROMISE_PROJECT + '/extra' },
    Elicitation: { mcp_server_name: 'private_server', message: PRIVATE.notice, requested_schema: {} },
    ElicitationResult: { mcp_server_name: 'private_server', action: 'decline' },
    FileChanged: { file_path: PROMISE_PROJECT + '/a.ts', event: 'change' },
    PermissionDenied: { ...tool, reason: PRIVATE.notice },
    PostCompact: { trigger: 'manual', compact_summary: PRIVATE.reply },
    PostModelSwitch: { model: 'fixture-model' },
    PostToolBatch: { tool_calls: [tool] },
    PostToolUse: { ...tool, tool_response: { stdout: PRIVATE.reply, stderr: '', exit_code: 0 }, duration_ms: 1000 },
    PostToolUseFailure: { ...tool, error: PRIVATE.notice },
    SessionStart: { source: 'startup', session_id: 'p1-session', cwd: PROMISE_PROJECT },
    Setup: { trigger: 'init' },
    Stop: { stop_hook_active: false, last_assistant_message: PRIVATE.reply },
    StopFailure: { error: 'server_error', session_id: 'p1-session', cwd: PROMISE_PROJECT },
    SubagentStart: { agent_id: 'p1-agent', agent_type: 'general-purpose' },
    SubagentStop: { agent_id: 'p1-agent', agent_type: 'general-purpose', last_assistant_message: PRIVATE.reply },
    // A task subject is the bookmark's own text (A27, like a todo); it is not one of the private payloads.
    TaskCompleted: { task_id: 'p1-task', task_subject: 'fixture task' },
    TaskCreated: { task_id: 'p1-task', task_subject: 'fixture task' },
    TeammateIdle: { teammate_name: 'p1-teammate', team_name: 'p1-team' },
    UserPromptSubmit: { prompt: PRIVATE.prompt },
    WorktreeCreate: { name: 'p1-worktree' },
    WorktreeRemove: { worktree_path: PROMISE_PROJECT + '/p1-worktree' },
  }
  for (const name of M1_CLASSIC) await drive('classic.' + name, () => $.classic[name](inputs[name]))
  await drive('agent.offer', () => $.agent.offer({ agent: 'coco:second-look' }))
  // the skill cards count a use here (cards/cards.tsx); the prompt's text is the person's and stays out of every record
  await drive('skill.prompt', () => $.skill.prompt({ skill: 'fixture-skill', text: PRIVATE.input }))
  await drive('command.describe', () => $.command.describe({ command: 'coco', description: '', isHidden: false }))
  const edited = PRIVATE.prompt + ' ' + PRIVATE.input
  await drive('prompt.edit', () => $.prompt.edit({ origin: PERSON, text: edited, cursor: edited.length, start: edited.length, end: edited.length, inputText: edited }))
  // A note from another window is shown on the band (finding 2's inbox), as the band's own line; it is not the person's payload.
  await drive('session.receive', () => $.session.receive({ origin: { kind: 'peer' }, text: 'fixture note from another window' }))
  await drive('session.send', () => $.session.send({ to: 'p1-other', text: PRIVATE.notice }))
  await $.command.run({ command: 'coco', args: 'more', origin: PERSON, presentation: P })
  const more = await $.ui.mount({ surface: 'terminal', ...PANE })
  await drive('ui.scroll', () => $.ui.scroll({ component: PANE.component, requestId: PANE.requestId, offset: 1, by: 1, bodyRows: 40, contentRows: 80, origin: { kind: 'person' } }))
  // The cap Select and the Talk input are drawn only once their rows are on; otherwise they are recorded as undispatched.
  if (typeof (more as any).select === 'function' && await more.find({ key: 'coco:more:cap' })) await (more as any).select({ key: 'coco:more:cap', value: '1' }); else f.unsupportedM1.push('ui.select')
  if (await more.find({ type: 'Input', key: 'coco:talk:input' })) await more.input({ key: 'coco:talk:input', text: PRIVATE.prompt, kind: 'change' }); else f.unsupportedM1.push('ui.input')
  await more.unmount()
  await drive('ui.focus', () => $.ui.focus({ component: 'AbovePrompt', plugin: 'coco', element: 'coco:book:open', origin: { kind: 'person' } }))
  // The kit raises ui.message only from a drawn Client; without that seam it is recorded as undispatched.
  if (typeof $.ui.message === 'function') await drive('ui.message', () => $.ui.message({ component: 'AbovePrompt', plugin: 'coco', data: { kind: 'noop' } })); else f.unsupportedM1.push('ui.message')
}
