import { describe, expect, test } from 'claude-code/testing'
import { bookIncenseSvg } from '../hooks/book-art'
import { PLUGIN_VERSION } from '../hooks/book-text'
import { world, RECENT, PERSON, P } from './world'
import { BAG_TEXT_RAW } from './bag-text-fixture'
// her desktop companion stands on her page once lane B has named its group there (bag step 2), else on the switches page
const COMPANION_PAGE = JSON.parse(BAG_TEXT_RAW).en.himGroups ? 'him' : 'settings'

const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: false, bodyColumns: 42, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 24 }, view: {} } }
const START = { cwd: '/tmp/project', surface: 'vscode' as const, isInteractive: true }

describe('his remote book', () => {
  test('one usage window has its own fixed-colour stick, hot ember and empty ash stub', () => {
    const fresh = bookIncenseSvg(0), hot = bookIncenseSvg(85), empty = bookIncenseSvg(100)
    expect(fresh).toContain('viewBox="0 0 12 26"')
    expect(fresh).toContain('width="12" height="26"')
    expect(fresh).toContain('M6 21.4V2.6')
    expect(fresh).toContain('stroke="#9A7458" stroke-width="2"')
    expect(fresh).toContain('r="1.45" fill="#E8643A"')
    expect(fresh).toContain('x="1.5" y="21" width="9" height="3.6" rx="1.6" fill="#AA5E47"')
    expect(fresh).not.toContain('smoke')
    expect(fresh).not.toContain('<style')
    expect(fresh).not.toContain('preserveAspectRatio="none"')
    expect(hot).toContain('r="1.45" fill="#C7361C"')
    expect(empty).toContain('M6 21.4v-1')
    expect(empty).not.toContain('<circle')
    expect(bookIncenseSvg(110)).toBe(empty)
  })
  test('a missing usage reading while the book is open keeps the no-reading page', async ($, on) => {
    on('session.usage', { breakdown: 'summary' }, () => ({ value: undefined }))
    world(on, { store: RECENT })
    await $.session.start(START)
    await $.command.run({ command: 'coco', args: 'usage', origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    await $.turn.start({ text: 'read it', turnId: 'usage-empty' })
    await $.tool.call({ tool: 'Read', file_path: '/tmp/x' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'No limit readings yet.' })).toBeDefined() // under the book's heading or lane B's group name
  })
  for (const surface of ['vscode', 'mobile'] as const) {
    test(`${surface}: all seven pages use their declared elements and native buttons`, async ($, on) => {
      const live = world(on, { store: RECENT })
      on('session.surfaces', () => ({ value: [surface] }))
      await $.session.start(START)
      await $.command.run({ command: 'coco', args: '', origin: PERSON, presentation: P })
      expect(live.opens.at(-1)?.rows).toBe(surface === 'mobile' ? 18 : 24)
      const ui = await $.ui.mount({ surface, ...PANE })
      // her itabag's seven pages (lane C, 10-14)
      for (const page of ['him', 'offerings', 'omen', 'socks', 'log', 'library', 'settings']) {
        await ui.press({ key: `coco:book:tab:${page}` }); await ui.redraw()
        expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('coco:book:tab:')).length).toBe(7)
        expect(await ui.find({ type: 'Svg' })).toBeDefined()
        expect(await ui.findAll({ type: 'Client' })).toEqual([])
        expect(await ui.findAll({ type: 'Input' })).toEqual([])
        expect(await ui.findAll({ type: 'Select' })).toEqual([])
      }
    })
    test(`${surface}: only settings that act here, languages fold after choosing or leaving`, async ($, on) => {
      world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
      on('session.surfaces', () => ({ value: [surface] }))
      await $.session.start(START)
      await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface, ...PANE })
      for (const prefix of ['band', 'workSize']) expect((await ui.findAll({ type: 'Button' })).some(b => b.key?.startsWith(`coco:set:${prefix}:`))).toBe(false)
      expect(await ui.find({ type: 'Text', text: 'App icon' })).toBeUndefined()
      expect(await ui.find({ type: 'Button', key: 'coco:set:marks:off' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'coco:set:lang:ja' })).toBeUndefined()
      await ui.press({ key: 'coco:set:lang:open' }); await ui.redraw()
      expect(await ui.find({ type: 'Button', key: 'coco:set:lang:ja' })).toBeDefined()
      await ui.press({ key: 'coco:set:lang:ja' }); await ui.redraw()
      expect(await ui.find({ type: 'Button', key: 'coco:set:lang:ja' })).toBeUndefined()
      await ui.press({ key: 'coco:set:lang:open' }); await ui.redraw()
      await ui.press({ key: 'coco:book:tab:him' }); await ui.redraw()
      await ui.press({ key: 'coco:book:tab:settings' }); await ui.redraw()
      expect(await ui.find({ type: 'Button', key: 'coco:set:lang:ja' })).toBeUndefined()
    })
  }
  test('VS Code companion target uses the chosen app in the diagram and app slots', async ($, on) => {
    world(on, { store: RECENT, env: { HOME: '/tmp/book-remote-fixture' }, readText: path => path.endsWith('companion.json') ? JSON.stringify({ running: true, accessibility: true, version: PLUGIN_VERSION, targets: ['claude', 'vscode'] }) : undefined })
    on('session.surfaces', () => ({ value: ['vscode'] }))
    on('fs.exists', { path: /SystemVersion\.plist|Coco/ }, () => ({ value: true }))
    on('fs.read', { path: /companion\.json$/ }, () => ({ value: JSON.stringify({ running: true, accessibility: true, version: PLUGIN_VERSION, targets: ['claude', 'vscode'] }) }))
    await $.session.start(START)
    await $.command.run({ command: 'coco', args: COMPANION_PAGE, origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface: 'vscode', ...PANE })
    await ui.redraw()
    expect(await ui.find({ type: 'Button', key: 'coco:set:companionTarget:auto' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Automatic\u00a0\(VS\u00a0Code\)/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Svg' })).some(e => String(e.props.alt).includes('VS\u00a0Code'))).toBe(true)
    await ui.press({ key: 'coco:set:companionTarget:claude' })
    expect(await ui.find({ type: 'Text', text: /Now:\u00a0Claude/ })).toBeDefined()
  })
  test('the open automatic target follows attached surfaces without a prompt', async ($, on) => {
    let surfaces: ('vscode' | 'desktop')[] = ['vscode']
    on('session.detach', ($, e) => ({ clientId: e.clientId }))
    world(on, { store: RECENT, env: { HOME: '/tmp/book-remote-fixture' }, readText: path => path.endsWith('companion.json') ? JSON.stringify({ running: true, accessibility: true, version: PLUGIN_VERSION, targets: ['claude', 'vscode'] }) : undefined })
    on('session.surfaces', () => ({ value: surfaces }))
    on('fs.exists', { path: /SystemVersion\.plist|Coco/ }, () => ({ value: true }))
    on('fs.read', { path: /companion\.json$/ }, () => ({ value: JSON.stringify({ running: true, accessibility: true, version: PLUGIN_VERSION, targets: ['claude', 'vscode'] }) }))
    await $.session.start(START)
    await $.command.run({ command: 'coco', args: COMPANION_PAGE, origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface: 'vscode', ...PANE })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Automatic\u00a0\(VS\u00a0Code\)/ })).toBeDefined()
    surfaces = ['vscode', 'desktop']
    await $.session.attach({ clientId: 'desktop-1', surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /Automatic\u00a0\(Claude/ })).toBeDefined()
    surfaces = ['vscode']
    await $.session.detach({ clientId: 'desktop-1', surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /Automatic\u00a0\(VS\u00a0Code\)/ })).toBeDefined()
  })
  test('mobile never exposes companion controls even on a Mac', async ($, on) => {
    world(on, { store: RECENT })
    on('fs.exists', { path: /SystemVersion\.plist|Coco/ }, () => ({ value: true }))
    on('fs.read', { path: /companion\.json$/ }, () => ({ value: JSON.stringify({ running: true, accessibility: true, version: PLUGIN_VERSION, targets: ['claude', 'vscode'] }) }))
    await $.session.start(START)
    await $.command.run({ command: 'coco', args: COMPANION_PAGE, origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface: 'mobile', ...PANE })
    expect((await ui.findAll({ type: 'Button' })).some(b => b.key?.startsWith('coco:companion:') || b.key?.startsWith('coco:set:companionTarget:'))).toBe(false)
  })
  // 10-15 (owner): page 3 is her vibe check; /coco vibe opens it and draws no slip (/omen is gone, 10-16)
  test('/coco vibe on VS Code alone opens the vibe check page without command output', async ($, on) => {
    world(on, { store: RECENT })
    on('session.surfaces', () => ({ value: ['vscode'] }))
    await $.session.start(START)
    expect(await $.command.run({ command: 'coco', args: 'vibe', origin: PERSON, presentation: P })).toEqual({})
    const ui = await $.ui.mount({ surface: 'vscode', ...PANE })
    expect(await ui.find({ type: 'Button', key: 'coco:book:tab:omen' })).toHaveProperty('props.variant', 'primary')
    expect((await ui.findAll({ type: 'Svg' })).some(s => String(s.props.alt).startsWith('fortune slip: '))).toBe(false)
  })
})
