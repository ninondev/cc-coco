import { test, expect } from 'claude-code/testing'
import { HOOK_EVENT_TARGET } from './hook-event-target'
import { HOOK_EVENT_TARGETS } from './hook-event-inventory'
import { promiseWorld, PROMISE_PROJECT, PRIVATE, TOOL_CASES, PANE } from './promises-runtime-world'
import { PERSON, P, band, settleLegacyStart } from './world'

test('P1 isolated hook event CPU envelope target dispatch', async ($, on) => {
  const target = HOOK_EVENT_TARGET as { event: string; component?: string; surface?: string }
  expect(HOOK_EVENT_TARGETS.some((entry: any) => entry.event === target.event && entry.component === target.component), 'target must name an actual shipping registration').toBe(true)
  const f = promiseWorld(on, { companion: true, pictures: target.event === 'ui.message' })
  // Nothing beneath the plugins answers these in the test host; the answers are registered before the first $ call
  if (target.event === 'command.describe') on('command.describe', ($: any, e: any) => ({ description: e.description, isHidden: false }))
  if (target.event === 'prompt.edit') on('prompt.edit', ($: any, e: any) => ({ text: e.text, cursor: e.cursor }))
  if (target.event === 'session.send') on('session.send', () => ({ isDelivered: true as const }))
  if (target.event === 'skill.prompt') on('skill.prompt', ($: any, e: any) => ({ text: e.text }))
  if (target.event === 'ui.focus') on('ui.focus', () => ({}))
  const api = $ as any
  const start = async () => { await $.session.start({ cwd: PROMISE_PROJECT, surface: 'terminal', isInteractive: true }); await settleLegacyStart($, f.w) }
  if (target.event !== 'session.start') await start()
  let hostGap: string | null = null
  let component: string | null = null
  const READ = { file_path: PROMISE_PROJECT + '/a.ts' }
  switch (target.event) {
    case 'session.start': await start(); break
    case 'session.attach': await $.session.attach({ surface: 'desktop', clientId: 'p1-cpu-desktop' }); break
    case 'session.detach': await $.session.detach({ surface: 'desktop', clientId: 'p1-cpu-desktop' }); break
    case 'session.end': await $.session.end({ reason: 'clear' }); break
    case 'session.compact': await $.session.compact({ trigger: 'manual', messages: [] }); break
    case 'session.measure': await $.session.measure({ context: { window: 200000, tokens: 40000, percent: 20 }, rateLimits: [], changed: ['context'] }); break
    case 'prompt.submit': await $.prompt.submit({ text: PRIVATE.prompt, wait: false, origin: PERSON }); break
    case 'prompt.compose': await $.prompt.compose({ model: 'claude', promptModel: 'claude', tools: [], outputStyle: null, traits: [] }); break
    case 'session.append': {
      const append = async (input: any) => {
        try { await api.session.append(input) }
        catch (error) { if (!String(error).includes('no implementation for session.append')) throw error; hostGap = 'kit host cannot retain session.append rows; prompt and response pre-next callback CPU only' }
      }
      await append({ door: 'prompt', uuid: 'p1-cpu-prompt', origin: PERSON, message: { type: 'user', role: 'user', content: [{ type: 'text', text: PRIVATE.prompt }], isMeta: false } })
      await $.turn.start({ text: PRIVATE.prompt, turnId: 'p1-cpu-append-turn' })
      await append({ door: 'response', uuid: 'p1-cpu-response', origin: { kind: 'model', model: 'test' }, message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: PRIVATE.reply }] } })
      expect(f.appended).toEqual([{ door: 'prompt', uuid: 'p1-cpu-prompt' }, { door: 'response', uuid: 'p1-cpu-response' }])
      break
    }
    case 'turn.start': await $.turn.start({ text: PRIVATE.prompt, turnId: 'p1-cpu-turn' }); break
    case 'turn.step': for await (const _ of $.turn.step({ turnId: 'p1-cpu-turn', index: 0, model: 'test', messageCount: 1 })) {} break
    case 'turn.complete': await $.turn.complete({ answer: PRIVATE.reply, durationMs: 3000, isAborted: false, turnId: 'p1-cpu-turn', reason: 'answer' }); break
    case 'tool.call': await $.tool.call(TOOL_CASES[0]); break
    case 'tool.check': await $.tool.check({ tool: 'Read', input: TOOL_CASES[0], tool_use_id: 'p1-cpu-read' }); break
    case 'agent.spawn':
      await $.agent.spawn({ prompt: 'fixture', description: 'fixture helper', subagentType: 'general-purpose' })
      break
    case 'classic.CwdChanged':
      await $.classic.CwdChanged({ old_cwd: PROMISE_PROJECT, new_cwd: PROMISE_PROJECT + '/changed' })
      break
    case 'classic.PreModelSwitch': case 'classic.PostModelSwitch': {
      const switched = { from_model: 'fixture-a', to_model: 'fixture-b', requested_model: 'fixture-b', source: 'command' as const, context_tokens: 0, prompt_cache_warm: false, estimated_cache_write_usd: 0, pricing: 'catalog' as const, cache_ttl: '5m' as const }
      if (target.event === 'classic.PreModelSwitch') await $.classic.PreModelSwitch(switched)
      else await $.classic.PostModelSwitch(switched)
      break
    }
    case 'classic.SessionStart': await api.classic.SessionStart({ source: 'resume', seconds_since_last_response: 400 }); break
    case 'classic.Stop': await $.classic.Stop({ stop_hook_active: false, session_crons: [] }); break
    case 'classic.StopFailure': await api.classic.StopFailure({ error: 'rate_limit' }); break
    case 'ui.message': {
      // The terminal pointer client posts from a fullscreen band with the mouse on and his picture drawn.
      const fullscreen = await api.ui.mount({ surface: 'terminal', ...band(100), viewport: { columns: 100, rows: 48, isFullscreen: true } })
      await fullscreen.post({ t: 'glance', side: 'left' })
      await fullscreen.unmount()
      break
    }
    case 'classic.Notification': await $.classic.Notification({ message: PRIVATE.notice, notification_type: 'idle_prompt' }); break
    case 'config.set': await $.config.set({ key: 'theme', value: 'light' }); break
    case 'config.describe': await $.config.describe({ key: 'coco.band', label: 'Coco', description: '', isHidden: false, provider: { plugin: 'coco', tier: 'user' } }); break
    case 'command.*': case 'command.run': await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P }); break
    case 'ui.press': {
      await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
      const pane = await $.ui.mount({ surface: 'terminal', ...PANE })
      await $.ui.press({ plugin: 'coco', requestId: 'coco-book', surface: 'terminal', key: 'coco:book:tab:settings' })
      await pane.unmount()
      break
    }
    case 'ui.render': {
      component = target.component ?? null
      expect(typeof component).toBe('string')
      const change = { tool_use_id: 'p1-cpu-change', tool: 'Edit', input: TOOL_CASES[2], isRunning: false, isErrored: false, isInterrupted: false, output: 'Applied' }
      const props: Record<string, any> = {
        AbovePrompt: band(100).props, Pane: PANE.props,
        AssistantMessage: { text: PRIVATE.reply, isFirstOfReply: true },
        UserMessage: { text: PRIVATE.prompt, origin: PERSON, isExpanded: true },
        AskUserQuestion: TOOL_CASES[11], ToolUse: change,
        ToolResult: { tool_use_id: 'p1-cpu-result', tool: 'Bash', output: [{ type: 'text', text: 'fixture output' }], isErrored: false },
        ToolGroup: { calls: [change], isActive: false, isExpanded: true },
        CommandOutput: { command: 'compact', args: '', text: 'Compacted.', isErrored: false },
        Spinner: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' },
        SessionMode: { modes: ['focus'] },
        PromptHint: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
        ToolProgress: { tool_use_id: 'p1-cpu-progress', kind: 'background_hint', hint: 'fixture' },
      }
      expect(Object.prototype.hasOwnProperty.call(props, component!)).toBe(true)
      if (component === 'Pane') await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
      const mounted = await api.ui.mount({ plugin: 'coco', surface: target.surface ?? 'desktop', component, props: props[component!], requestId: component === 'Pane' ? 'coco-book' : undefined })
      const tree = await mounted.drawn()
      expect(tree === null || typeof tree === 'object').toBe(true)
      await mounted.unmount()
      break
    }
    case 'session.usage': case 'store.set': case 'state.set': case 'ui.close': case 'model.fork': case 'model.complete': {
      const response = JSON.parse((await $.command.run({ command: 'p1-kit-hook-event-cpu:' + target.event, args: '' })).text ?? 'null')
      expect(response).toEqual({ marker: 'p1-kit-hook-event-cpu-bridge', event: target.event })
      break
    }
    // The targets 1.0's wiring added (M1's always-on hooks, the book's own controls, the skill cards), first measured 10-17
    case 'classic.ConfigChange': await api.classic.ConfigChange({ source: 'user_settings' }); break
    case 'classic.DirectoryAdded': await api.classic.DirectoryAdded({ directory: PROMISE_PROJECT + '/added', source: 'slash_command' }); break
    case 'classic.Elicitation': await api.classic.Elicitation({ mcp_server_name: 'fixture', message: 'fixture question', mode: 'form', requested_schema: {} }); break
    case 'classic.ElicitationResult': await api.classic.ElicitationResult({ mcp_server_name: 'fixture', mode: 'form', action: 'decline' }); break
    case 'classic.FileChanged': await api.classic.FileChanged({ file_path: PROMISE_PROJECT + '/notes.md', event: 'change' }); break
    case 'classic.PermissionDenied': await api.classic.PermissionDenied({ tool_name: 'Read', tool_input: READ, tool_use_id: 'p1-cpu-denied', reason: 'fixture' }); break
    case 'classic.PermissionRequest': await api.classic.PermissionRequest({ tool_name: 'Read', tool_input: READ }); break
    case 'classic.PostCompact': await api.classic.PostCompact({ trigger: 'manual', compact_summary: 'fixture summary' }); break
    case 'classic.PostToolBatch': await api.classic.PostToolBatch({ tool_calls: [{ tool_name: 'Read', tool_input: READ, tool_use_id: 'p1-cpu-batch' }] }); break
    case 'classic.PostToolUse': await api.classic.PostToolUse({ tool_name: 'Read', tool_input: READ, tool_response: 'fixture', tool_use_id: 'p1-cpu-post' }); break
    case 'classic.PostToolUseFailure': await api.classic.PostToolUseFailure({ tool_name: 'Read', tool_input: READ, tool_use_id: 'p1-cpu-failed', error: 'fixture' }); break
    case 'classic.Setup': await api.classic.Setup({ trigger: 'init' }); break
    case 'classic.SubagentStart': await api.classic.SubagentStart({ agent_id: 'p1-cpu-helper', agent_type: 'general-purpose' }); break
    case 'classic.SubagentStop': await api.classic.SubagentStop({ stop_hook_active: false, agent_id: 'p1-cpu-helper', agent_transcript_path: PROMISE_PROJECT + '/helper.jsonl', agent_type: 'general-purpose' }); break
    case 'classic.TaskCreated': await api.classic.TaskCreated({ task_id: 'p1-cpu-task', task_subject: 'fixture task' }); break
    case 'classic.TaskCompleted': await api.classic.TaskCompleted({ task_id: 'p1-cpu-task', task_subject: 'fixture task' }); break
    case 'classic.TeammateIdle': await api.classic.TeammateIdle({ teammate_name: 'fixture', team_name: 'fixture' }); break
    case 'classic.UserPromptSubmit': await api.classic.UserPromptSubmit({ prompt: PRIVATE.prompt, source: 'user' }); break
    case 'classic.WorktreeCreate': await api.classic.WorktreeCreate({ name: 'p1-cpu-tree' }); break
    case 'classic.WorktreeRemove': await api.classic.WorktreeRemove({ worktree_path: PROMISE_PROJECT + '/tree' }); break
    case 'command.describe': await api.command.describe({ command: 'coco', description: '', isHidden: false, immediate: false, provider: { plugin: 'coco', tier: 'user' } }); break
    case 'prompt.edit': { const text = 'fixture draft long enough to edit'; await api.prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: ' and more' + ' words to go' }); break }
    case 'session.send': await api.session.send({ to: 'fixture-peer', text: 'fixture letter', origin: { kind: 'model' } }); break
    case 'session.receive': await api.session.receive({ origin: { kind: 'peer-send-message' }, text: 'fixture note' }); break
    case 'agent.offer': await api.agent.offer({ agent: 'coco:second-look', description: 'fixture', source: 'plugin', provider: { plugin: 'coco', tier: 'user' } }); break
    case 'skill.prompt': await api.skill.prompt({ skill: 'fixture', text: 'fixture skill text' }); break
    case 'ui.input': case 'ui.select': case 'ui.focus': case 'ui.scroll': {
      await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
      const pane = await $.ui.mount({ surface: 'terminal', ...PANE })
      const at = { plugin: 'coco', requestId: 'coco-book', surface: 'terminal' }
      if (target.event === 'ui.input') {
        // the skill cards' search box is the Input drawn without a key or a setting turned on first
        await $.command.run({ command: 'coco', args: 'cards', origin: PERSON, presentation: P })
        const cards = await api.ui.mount({ plugin: 'coco', component: 'Pane', requestId: 'coco-cards', surface: 'terminal', props: PANE.props })
        for (let i = 0; i < 20 && !(await cards.find({ type: 'Input', key: 'q' })); i++) await cards.redraw()
        await cards.input({ key: 'q', text: 'fixture', kind: 'change' })
        await cards.unmount()
      } else if (target.event === 'ui.select') await api.ui.select({ ...at, key: 'coco:more:cap', value: 'off' })
      else if (target.event === 'ui.scroll') await api.ui.scroll({ component: 'Pane', requestId: 'coco-book', offset: 0, by: 1, bodyRows: 30, contentRows: 60, origin: { kind: 'person' } })
      else if (target.component === 'AbovePrompt') { component = 'AbovePrompt'; await api.ui.focus({ component: 'AbovePrompt', requestId: 'p1-cpu-band', plugin: 'coco', origin: { kind: 'person' } }) }
      else await api.ui.focus({ component: 'Pane', requestId: 'coco-book', plugin: 'coco', element: 'coco:more:talk:model', origin: { kind: 'person' } })
      await pane.unmount()
      break
    }
    default: throw Error('registered event has no CPU envelope fixture: ' + target.event)
  }
  expect(f.network).toEqual([])
  // The two model events are plugin-initiated; the scratch bridge makes the one call that is measured, and it stops at the fixture's bottom.
  expect(f.models).toEqual(target.event === 'model.fork' || target.event === 'model.complete' ? [target.event] : [])
  console.log('P1_HOOK_EVENT_ENVELOPE ' + JSON.stringify({ event: target.event, component, surface: target.surface ?? null, dispatched: true, hostGap,
    scope: 'isolated-cli-command-inclusive-cpu', limitations: ['Measured by host wait4 outside the kit; includes CLI startup, fixture setup, mocks and target event.', 'Static registration inventory and this dispatch do not prove every matcher branch or every callback was executed.'] }))
})
