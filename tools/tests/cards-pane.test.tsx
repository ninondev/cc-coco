// The skill cards inside Coco, end to end under the engine's test host with Coco's own hooks loaded around them:
// `/coco cards` opens the pane while the other /coco verbs stay Coco's, the deck is dealt, a picked card rides along
// with the person's next message and is named in the band above Coco's own, uses count through Coco's hooks too, and
// the pane speaks Coco's language. The pane's own drawing is checked as the standalone mod checked it.
import { installM1Words } from './m1-more-data-fixture'
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { P, PERSON, RECENT, band, desktopPicture, settleLegacyStart, world } from './world'
import { CARDS_ART_TEXT } from './cards-art-fixture'

installM1Words()

// the test host prints to the terminal; the plugin environment's types leave console out
declare const console: { log: (...parts: unknown[]) => void }

const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-cards' }
const PROPS = { title: 'Skill cards', isFocused: false, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const START = { cwd: '/work', isInteractive: true }

const COMMANDS = [
  { name: 'tidy-notes', description: 'Tidies a notes folder into dated files.\nSecond line.', source: 'user' },
  { name: 'standup', description: 'Writes the daily standup.', source: 'user' },
  { name: 'charts:draw-chart', description: 'Draws a chart from a CSV file.', source: 'plugin', plugin: 'charts' },
  { name: 'clear', description: 'Clear conversation history and free up context', source: 'builtin' },
  { name: '__internal', description: 'Plumbing', source: 'builtin' },
  { name: 'old-name', description: 'Renamed to new-name', source: 'builtin' },
]
const AGENT_FILE = '---\nname: note-taker\ndescription: Takes notes while you work.\ntools: Read\n---\nYou take notes.'
const NO_FILE = { size: 0, mtimeMs: 0, isLink: false }

type Sent = { context?: readonly string[] }

/**
 * Coco's world (world.tsx) and, beneath the plugin, what the cards read: the command list, the person's skills and
 * subagents folders, the skills the context breakdown names, the prompt box, skill prompts and subagent spawns, and
 * Coco's pictures as the plugin ships them (`art` gives the file's text, or undefined for no such file). What reaches
 * the engine of each message goes into `sent`, what is written into the prompt box into `filled`; `claudes()` names
 * the paths in Claude's own folders read so far. `initialState` holds the session's values from before (world.tsx).
 */
function cardsWorld(
  on: On,
  sent: Sent[] = [],
  filled: string[] = [],
  commands: readonly object[] = COMMANDS,
  settings: Record<string, unknown> = {},
  art: () => string | undefined = () => CARDS_ART_TEXT,
  initialState: Record<string, unknown> = {},
) {
  // an empty matcher sets each of these apart from world's own hook on the event, as world.tsx does for session.id
  on('prompt.submit', {}, async ($, e, next) => {
    sent.push({ context: e.context })
    return next(e)
  })
  on('session.usage', {}, async ($, e, next) => {
    const answer = await next(e)
    const usage = (answer as { value: { context: { breakdown?: object } } }).value
    const breakdown = { ...usage.context.breakdown, skills: { skillFrontmatter: [{ name: 'draw-chart', pluginName: 'charts' }] } }
    return { value: { ...usage, context: { ...usage.context, breakdown } } } as never
  })
  const w = world(on, {
    store: RECENT,
    observeStore: true,
    settings,
    initialState,
    env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME: '/home/tester' },
    readText: path =>
      path === '/home/tester/.claude/agents/note-taker.md' ? AGENT_FILE : /[\\/]hooks[\\/]cards-art\.json$/.test(path) ? art() : undefined,
  })
  on('command.list', () => ({ value: commands }) as never)
  // the skills folder holds one skill; the subagents folder a definition file, a stray note and a folder
  const listed: string[] = []
  on('fs.list', async ($, e, next) => {
    listed.push(e.path)
    if (e.path === '/home/tester/.claude/skills') return { value: [{ name: 'tidy-notes', kind: 'other', ...NO_FILE, isLink: true }] } as never
    if (e.path === '/home/tester/.claude/agents')
      return { value: [{ name: 'note-taker.md', kind: 'file', ...NO_FILE, size: 90 }, { name: 'README.txt', kind: 'file', ...NO_FILE, size: 9 }, { name: 'old', kind: 'dir', ...NO_FILE }] } as never
    if (/[\\/]\.claude[\\/](skills|agents)$/.test(e.path)) return { value: [] } as never
    return next(e)
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }) as never)
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length } as never
  })
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('agent.spawn', () => ({ model: 'claude-test' }))
  /** The paths in Claude's own folders the plugin listed or read so far. */
  const claudes = () => [...listed, ...w.fileReads].filter(p => /[\\/]\.claude[\\/]/.test(p))
  return Object.assign(w, { claudes })
}

const cardsCommand = { command: 'coco', args: 'cards', origin: PERSON, presentation: P }

for (const surface of ['desktop', 'terminal'] as const) {
  test(`/coco cards deals the deck, and a picked card goes along once, named above Coco's band (${surface})`, async ($, on) => {
    const sent: Sent[] = []
    const filled: string[] = []
    const w = cardsWorld(on, sent, filled)
    await $.session.start({ ...START, surface })
    await settleLegacyStart($, w)

    // `/coco cards` opens the pane; `/coco help` is still Coco's own
    await $.command.run(cardsCommand)
    expect(w.opens.map(o => o.id)).toContain('coco-cards')
    expect(w.toasts.some(t => t.includes('warmth'))).toBe(false)
    await $.command.run({ ...cardsCommand, args: 'help' })
    expect(w.toasts.at(-1)).toContain('warmth')

    const ui = await $.ui.mount({ ...PANE, surface, props: PROPS })
    const bandUi = await $.ui.mount({ surface, ...band(100) })
    // the deck is read in the background after the session starts
    for (let i = 0; i < 50 && !(await ui.find({ key: 'card:skill:tidy-notes' })); i++) await ui.redraw()

    // dealt: a skill by its folder, a plugin skill by the context breakdown, commands; no plumbing
    expect(await ui.find({ key: 'card:skill:tidy-notes' }), 'card:skill:tidy-notes').toBeDefined()
    expect(await ui.find({ key: 'card:skill:charts:draw-chart' }), 'card:skill:charts:draw-chart').toBeDefined()
    expect(await ui.find({ key: 'card:command:clear' }), 'card:command:clear').toBeDefined()
    expect(await ui.find({ key: 'card:command:standup' }), 'card:command:standup').toBeDefined()
    expect(await ui.find({ key: 'card:command:__internal' }), 'card:command:__internal').toBeUndefined()
    expect(await ui.find({ key: 'card:command:old-name' }), 'card:command:old-name').toBeUndefined()
    // the person's own subagent, from its definition file; nothing else in that folder
    expect(await ui.find({ key: 'card:agent:note-taker' }), 'card:agent:note-taker').toBeDefined()
    expect(await ui.find({ text: /Takes notes while you work/ }), '/Takes notes while you work/').toBeDefined()
    expect(await ui.find({ key: 'card:agent:README.txt' }), 'card:agent:README.txt').toBeUndefined()

    // pulled, then into the tray; on the desktop the card comes out of the box toward its column in steps
    await ui.press({ key: 'card:skill:tidy-notes' })
    const shift = async () => Number((await ui.find({ key: 'flight' }))?.props.marginLeft ?? 0)
    if (surface === 'desktop') expect(await shift()).toBeLessThan(0)
    await w.clock.advance(200)
    expect(await shift()).toBe(0)
    expect((await ui.find({ key: 'take:skill:tidy-notes' }))?.text).toContain('Take into next message')
    expect(await bandUi.find({ text: /tidy-notes/ }), '/tidy-notes/').toBeUndefined()
    await ui.press({ key: 'take:skill:tidy-notes' })
    expect(await ui.find({ key: 'untray:skill:tidy-notes' }), 'untray:skill:tidy-notes').toBeDefined()

    // the band names it above Coco's own band until the message goes
    await bandUi.redraw()
    expect(await bandUi.find({ text: /tidy-notes/ }), '/tidy-notes/').toBeDefined()
    expect(await bandUi.find({ text: /Going with the next message/ }), '/Going with the next message/').toBeDefined()
    if (surface === 'desktop') expect(await desktopPicture(bandUi), "Coco's band picture").toBeDefined()
    else expect(JSON.stringify(await bandUi.drawn()).length).toBeGreaterThan(JSON.stringify(await bandUi.find({ key: 'coco-tray' })).length + 200)

    // a task's notification does not carry it; the person's own message does, once
    await $.prompt.submit({ text: 'done', wait: false, origin: { kind: 'task-notification' } } as never)
    expect((sent.at(-1)?.context ?? []).join('\n')).not.toContain('Skill "tidy-notes"')
    await $.prompt.submit({ text: 'tidy my notes', wait: false, origin: PERSON })
    expect((sent.at(-1)?.context ?? []).join('\n')).toContain('Skill "tidy-notes"')
    expect(await ui.find({ key: 'untray:skill:tidy-notes' }), 'untray:skill:tidy-notes').toBeUndefined()
    // the person is told what went, and the band's line goes
    expect(w.toasts.filter(t => t === 'With this message: tidy-notes')).toHaveLength(1)
    await bandUi.redraw()
    expect(await bandUi.find({ text: /tidy-notes/ }), '/tidy-notes/').toBeUndefined()
    await $.prompt.submit({ text: 'and again', wait: false, origin: PERSON })
    expect((sent.at(-1)?.context ?? []).join('\n')).not.toContain('Skill "tidy-notes"')
    expect(w.toasts.filter(t => t.startsWith('With this message'))).toHaveLength(1)

    // a skill's prompt counts for its card
    const used = (id: string) => ((w.cell('cardsUsage')?.value ?? {}) as Record<string, { n: number }>)[id]?.n ?? 0
    await $.skill.prompt({ skill: 'tidy-notes', text: 'body' })
    expect(used('skill:tidy-notes')).toBe(1)

    // the pulled card stamps the count: a picture on the desktop, which carries it as its alt, and text on the terminal
    const shows = async (count: RegExp) => (surface === 'desktop' ? count.test(JSON.stringify(await ui.drawn())) : !!(await ui.find({ text: count })))
    expect(await shows(/Used once/)).toBe(true)
    for (let i = 0; i < 4; i++) await $.skill.prompt({ skill: 'tidy-notes', text: 'body' })
    expect(await shows(/Used 5 times/)).toBe(true)
    // back in the box, the strip prints the rarity beside the name and wears the "+1" flag until the card is pulled
    await ui.press({ key: 'back:' })
    expect(await ui.find({ text: /^R$/ }), '/^R$/').toBeDefined()
    const flagged = async () => (surface === 'desktop' ? !!(await ui.find({ key: 'new' })) : !!(await ui.find({ text: /\+1/ })))
    expect(await flagged()).toBe(true)
    await ui.press({ key: 'card:skill:tidy-notes' })
    expect(await flagged()).toBe(false)
    if (surface === 'desktop') {
      expect(await ui.find({ key: 'peel' }), 'peel').toBeDefined()
      await w.clock.advance(600)
      expect(await ui.find({ key: 'peel' }), 'peel').toBeUndefined()
    }

    // so does the person's own run of a command (a plugin's does not), and a subagent spawned, which Coco's agent.spawn
    // hook passes on to the cards; the counts last past the session in the store
    await $.command.run({ command: 'standup', args: '', origin: PERSON, presentation: P })
    await $.command.run({ command: 'standup', args: '', origin: { kind: 'plugin', name: 'elsewhere' }, presentation: P } as never)
    for (let i = 0; i < 20 && used('command:standup') === 0; i++) await w.clock.advance(0)
    expect(used('command:standup')).toBe(1)
    await $.agent.spawn({ prompt: 'Take notes.', description: 'Notes', subagentType: 'note-taker', provider: { plugin: 'user', tier: 'user' }, parentModel: 'claude-test' } as never)
    for (let i = 0; i < 20 && used('agent:note-taker') === 0; i++) await w.clock.advance(0)
    expect(used('agent:note-taker')).toBe(1)
    expect((w.stored('cards.usage') as Record<string, unknown> | undefined)?.['skill:tidy-notes'], 'stored uses').toBeDefined()

    // a command card is written into the prompt instead of going in the tray
    await ui.press({ key: 'card:command:clear' })
    expect(await ui.find({ key: 'take:command:clear' }), 'take:command:clear').toBeUndefined()
    await ui.press({ key: 'type:command:clear' })
    expect(filled.at(-1)).toBe('/clear ')

    // a divider tab brings its group to the top of the box and leaves the tabs in their order
    const order = async (prefix: string) => [...JSON.stringify(await ui.drawn()).matchAll(new RegExp(`"${prefix}-([^"]+)"`, 'g'))].map(m => m[1])
    const tabs = await order('j')
    const last = (await order('g')).at(-1)!
    expect(tabs.length).toBeGreaterThan(1)
    expect((await order('g'))[0]).not.toBe(last)
    await ui.press({ key: `jump:${last}` })
    expect((await order('g'))[0]).toBe(last)
    expect(await order('j')).toEqual(tabs)
    // on the desktop Coco's moving pictures lie on a layer over the box, never in it (docs/cards/DESKTOP.md), and each
    // box around them takes a minimum width a hair off the last drawing's
    const moving = async (key: string) => JSON.stringify(await ui.find({ key })).includes('"isInteractive":true')
    if (surface === 'desktop') {
      expect([await moving('deck'), await moving('deckroom')]).toEqual([false, true])
      const hair = async () => Number((await ui.find({ key: 'deckroom' }))?.props.minWidth)
      const was = await hair()
      await ui.redraw()
      const now = await hair()
      expect([was !== now, was < 0.01, now < 0.01, (await ui.find({ key: 'deck' }))?.props.minWidth]).toEqual([true, true, true, 0])
    }

    // search: nothing found, then cleared
    await ui.input({ key: 'q', text: 'zzzz', kind: 'change' })
    expect(await ui.find({ text: /Nothing matches/ }), '/Nothing matches/').toBeDefined()
    expect(await ui.find({ key: 'card:skill:tidy-notes' }), 'card:skill:tidy-notes').toBeUndefined()
    await ui.press({ key: 'clearq:' })
    expect(await ui.find({ key: 'card:skill:tidy-notes' }), 'card:skill:tidy-notes').toBeDefined()

    // the book
    await ui.press({ key: 'view:book' })
    expect((await ui.find({ text: /5 cards/ }))?.text).toContain('Used most: tidy-notes')
    if (surface === 'desktop') expect([await moving('binder'), await moving('album')]).toEqual([false, true])
    await ui.press({ key: 'sort:uses' })
    expect(await ui.find({ key: 'sort:uses' }), 'sort:uses').toBeDefined()

    // the motion switch on the desktop: off, its knob goes over at once; on again, it slides over in steps
    if (surface === 'desktop') {
      const knob = async () => Number((await ui.find({ key: 'kl' }))?.props.flexGrow ?? -1)
      expect(await knob()).toBe(1)
      await ui.press({ key: 'motion:' })
      expect(await knob()).toBe(0)
      await ui.press({ key: 'motion:' })
      expect(await knob()).toBeLessThan(1)
      await w.clock.advance(200)
      expect(await knob()).toBe(1)
    }
    await ui.unmount()
    await bandUi.unmount()
  })
}

// VS Code's panel places nothing absolutely: there the pane is the terminal's, in words, with its buttons drawn in the
// flow, and none of the desktop's layered pictures or laid-over press targets (his screenshot, 10-19)
// Everywhere but the desktop a pulled card opens right under its own strip, its buttons with it (owner 10-19:
// 「就地展开」); VS Code and the terminal draw the pane in words, the phone the desktop's papers and pictures in one flow
for (const surface of ['terminal', 'vscode', 'mobile'] as const) for (const cols of [39, 110]) test(`on ${surface} at ${cols} columns a pulled card opens under its strip`, async ($, on) => {
  const w = cardsWorld(on)
  await $.session.start({ ...START, surface })
  await settleLegacyStart($, w)
  await $.command.run(cardsCommand)
  const ui = await $.ui.mount({ ...PANE, surface, props: { ...PROPS, bodyColumns: cols } })
  for (let i = 0; i < 50 && !(await ui.find({ key: 'card:skill:tidy-notes' })); i++) await ui.redraw()
  const flat = async () => {
    if (surface === 'terminal') return
    expect((await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute')).toEqual([])
    // no blank press target laid over a drawing
    expect((await ui.findAll({ type: 'Button' })).filter(b => String(b.props.label ?? '').includes('\u2003'))).toEqual([])
  }
  /** The keys of the buttons in drawing order. */
  const order = async () => (await ui.findAll({ type: 'Button' })).map(b => String(b.key))
  const svgs = async () => (surface === 'terminal' ? [] : await ui.findAll({ type: 'Svg' }))
  expect(await ui.find({ type: 'Button', key: 'card:skill:tidy-notes' })).toBeDefined()
  if (surface === 'mobile') {
    const coco = (await svgs()).filter(p => String(p.props.alt).startsWith('Coco. '))
    expect(coco.length).toBe(1)
    const source = String(coco[0]!.props.source)
    expect(source).toContain('<foreignObject')
    expect(source).not.toMatch(/[};]svg\{/)
  } else expect(await svgs()).toEqual([])
  await flat()
  // in words the tray shows only once a card is in it, without its hints (owner 10-19: 「纯文字版把这些去掉」)
  const words = surface !== 'mobile'
  const hints = async () => [await ui.find({ text: /Nothing in the tray/ }), await ui.find({ text: /Once it is sent/ })].filter(Boolean).length
  expect(await hints()).toBe(words ? 0 : 2)
  expect(!!(await ui.find({ text: /Going with the next message/ }))).toBe(!words)
  expect(!!(await ui.find({ key: 'motion:' }))).toBe(!words)
  await ui.press({ key: 'card:agent:note-taker' })
  await w.clock.advance(1000)
  // the face's buttons come right after the pulled card's own and before the next card's
  const keys = await order()
  const at = keys.indexOf('card:agent:note-taker')
  expect(keys.slice(at + 1, at + 3)).toEqual(['take:agent:note-taker', 'back:'])
  await ui.press({ key: 'take:agent:note-taker' })
  await w.clock.advance(1000)
  expect(await ui.find({ key: 'untray:agent:note-taker' })).toBeDefined()
  expect(await ui.find({ text: /Going with the next message/ })).toBeDefined()
  expect(await hints()).toBe(words ? 0 : 1)
  await flat()
  // a second press puts it back
  await ui.press({ key: 'card:agent:note-taker' })
  await w.clock.advance(1000)
  expect(await ui.find({ key: 'back:' })).toBeUndefined()
  await ui.press({ key: 'view:book' })
  await w.clock.advance(1000)
  await ui.press({ key: 'card:agent:note-taker' })
  await w.clock.advance(1000)
  expect(await ui.find({ key: 'back:' })).toBeDefined()
  if (surface === 'mobile') expect((await svgs()).filter(p => String(p.props.source).includes('/*album*/')).length).toBe(1)
  else expect(await svgs()).toEqual([])
  await flat()
})

test("the pane speaks Coco's language", { options: { language: 'auto', resolvedLanguage: 'en' } }, async ($, on) => {
  const w = cardsWorld(on, [], [], COMMANDS, { language: 'Japanese' })
  await $.session.start({ ...START, surface: 'desktop' })
  await settleLegacyStart($, w)
  await $.command.run(cardsCommand)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: PROPS })
  for (let i = 0; i < 50 && !(await ui.find({ key: 'card:skill:tidy-notes' })); i++) await ui.redraw()
  expect(await ui.find({ text: /SKILLカード/ }), '/SKILLカード/').toBeDefined()
})

// Claude's own folders (.claude/skills and .claude/agents) are read once the person opens the cards, never before
// (promise B8). Until then a run of the person's own command waits: it may be a skill hidden from the model, which only
// its folder tells apart. Opening the cards counts the command's runs and drops the skill's, which its prompt counted.
test("Claude's folders wait for /coco cards, and the person's commands run before it count once it opens", async ($, on) => {
  const w = cardsWorld(on)
  await $.session.start({ ...START, surface: 'desktop' })
  await settleLegacyStart($, w)
  const cell = (key: string) => (w.cell(key)?.value ?? {}) as Record<string, unknown>
  const used = (id: string) => (cell('cardsUsage')[id] as { n: number } | undefined)?.n ?? 0
  // each count lands before the next is made: world.tsx keeps the value of a write that missed its version, so two
  // counts in the same tick would lose one there (the engine keeps both)
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 50 && !done(); i++) await w.clock.advance(0)
  }
  await until(() => cell('cardsCatalog').status === 'ready')
  expect(cell('cardsCatalog').status).toBe('ready')

  // a command of the person's own, twice, and a skill hidden from the model typed as /name, whose prompt counts it
  for (const n of [1, 2]) {
    await $.command.run({ command: 'standup', args: '', origin: PERSON, presentation: P })
    await until(() => used('run:standup') === n)
  }
  await $.command.run({ command: 'tidy-notes', args: '', origin: PERSON, presentation: P })
  await until(() => used('run:tidy-notes') === 1)
  await $.skill.prompt({ skill: 'tidy-notes', text: 'body' })
  await until(() => used('skill:tidy-notes') === 1)
  expect([used('run:standup'), used('run:tidy-notes'), used('command:standup'), used('skill:tidy-notes')]).toEqual([2, 1, 0, 1])
  expect(w.claudes()).toEqual([])

  await $.command.run(cardsCommand)
  expect(w.claudes()).toContain('/home/tester/.claude/skills')
  expect(w.claudes()).toContain('/home/tester/.claude/agents/note-taker.md')
  await until(() => used('command:standup') === 2)
  expect([used('command:standup'), used('skill:tidy-notes'), used('command:tidy-notes')]).toEqual([2, 1, 0])
  expect(Object.keys(cell('cardsUsage')).filter(id => id.startsWith('run:'))).toEqual([])
  expect(Object.keys((w.stored('cards.usage') ?? {}) as object).filter(id => id.startsWith('run:'))).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: PROPS })
  expect(await ui.find({ key: 'card:skill:tidy-notes' }), 'card:skill:tidy-notes').toBeDefined()
  expect(await ui.find({ key: 'card:agent:note-taker' }), 'card:agent:note-taker').toBeDefined()
  await ui.unmount()
})

// Coco's pictures are a file the pane reads the first time it draws them; without it the desktop pane draws in words,
// and the next /coco cards reads it again.
test('a pane whose pictures cannot be read draws in words until it is opened again', async ($, on) => {
  let isShipped = false
  const w = cardsWorld(on, [], [], COMMANDS, {}, () => (isShipped ? CARDS_ART_TEXT : undefined))
  await $.session.start({ ...START, surface: 'desktop' })
  await settleLegacyStart($, w)
  await $.command.run(cardsCommand)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: PROPS })
  for (let i = 0; i < 50 && !(await ui.find({ key: 'card:skill:tidy-notes' })); i++) await ui.redraw()
  expect(await ui.find({ key: 'card:skill:tidy-notes' }), 'card:skill:tidy-notes').toBeDefined()
  expect(await ui.find({ key: 'rest' }), 'Coco at rest, with no pictures').toBeUndefined()
  isShipped = true
  await ui.redraw()
  expect(await ui.find({ key: 'rest' }), 'Coco at rest, before the pane opens again').toBeUndefined()
  await $.command.run(cardsCommand)
  await ui.redraw()
  expect(await ui.find({ key: 'rest' }), 'Coco at rest').toBeDefined()
  await ui.unmount()
})

// The desktop drops a whole pane tree of 262,144 characters or more, 2,000 nodes or depth 32, with no error, and
// keeps the old drawing (docs/cards/DESKTOP.md). A deck the size of a busy machine's must stay under.
/** The drawn tree's characters, nodes and depth, counted the way the desktop's caps count them. */
function measure(tree: unknown): { chars: number; nodes: number; depth: number } {
  let nodes = 0
  let depth = 0
  const walk = (x: unknown, d: number): void => {
    if (Array.isArray(x)) return x.forEach(y => walk(y, d))
    if (!x || typeof x !== 'object') return
    nodes += 1
    depth = Math.max(depth, d)
    const n = x as { props?: { children?: unknown }; children?: unknown }
    walk(n.children ?? n.props?.children, d + 1)
  }
  walk(tree, 1)
  return { chars: JSON.stringify(tree).length, nodes, depth }
}

const MANY = [...COMMANDS, ...Array.from({ length: 130 }, (_, i) => ({
  name: `${i % 3 === 0 ? 'toolkit:' : ''}card-number-${i}`,
  description: `A description long enough to fill the sleeve and then some, as real skills write them (${i}). `.repeat(6),
  source: i % 3 === 0 ? 'plugin' : i % 3 === 1 ? 'user' : 'builtin',
  ...(i % 3 === 0 ? { plugin: 'toolkit' } : {}),
}))]

// The book is the other heavy view for a big deck: every card's sleeve, a card pulled and one in the tray, and Coco
// hugging the album (a state picture stands in for moves, so the hand-over is not drawn there, as in the draft).
test('a full deck in the book stays inside the desktop tree caps', async ($, on) => {
  const w = cardsWorld(on, [], [], MANY)
  await $.session.start({ ...START, surface: 'desktop' })
  await settleLegacyStart($, w)
  await $.command.run(cardsCommand)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: PROPS })
  for (let i = 0; i < 50 && !(await ui.find({ key: 'card:command:card-number-1' })); i++) await ui.redraw()
  await ui.press({ key: 'view:book' })
  await ui.press({ key: 'card:skill:tidy-notes' })
  await ui.press({ key: 'take:skill:tidy-notes' })
  await w.clock.advance(800)
  const tree = await ui.drawn()
  const { chars, nodes, depth } = measure(tree)
  console.log(`full deck in the book: ${chars} characters, ${nodes} nodes, depth ${depth}`)
  expect(JSON.stringify(tree)).toContain('state-album')
  expect(JSON.stringify(tree)).not.toContain('play1p')
  expect(await ui.find({ key: 'untray:skill:tidy-notes' }), 'untray:skill:tidy-notes').toBeDefined()
  expect(await ui.find({ key: 'card:command:card-number-128' }), 'card:command:card-number-128').toBeDefined()
  expect([chars < 262144, nodes < 2000, depth < 32]).toEqual([true, true, true])
})

test('a full deck mid hand-over stays inside the desktop tree caps', async ($, on) => {
  const w = cardsWorld(on, [], [], MANY)
  await $.session.start({ ...START, surface: 'desktop' })
  await settleLegacyStart($, w)
  await $.command.run(cardsCommand)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: PROPS })
  for (let i = 0; i < 50 && !(await ui.find({ key: 'card:command:card-number-1' })); i++) await ui.redraw()
  await ui.press({ key: 'card:command:card-number-1' })
  // a skill card into the tray starts the hand-over; the held clock keeps it on its first part
  await ui.press({ key: 'card:skill:tidy-notes' })
  await ui.press({ key: 'take:skill:tidy-notes' })
  // the worst moment: the hand-over's second part laid over its first (MOVES.hand in hooks/cards-art.json)
  await w.clock.advance(800)
  const tree = await ui.drawn()
  const { chars, nodes, depth } = measure(tree)
  console.log(`full deck mid hand-over: ${chars} characters, ${nodes} nodes, depth ${depth}`)
  expect(JSON.stringify(tree)).toContain('play1p1')
  expect(await ui.find({ text: /card-number-128/ }), '/card-number-128/').toBeDefined()
  expect(await ui.find({ text: /more cards/ }), '/more cards/').toBeUndefined()
  expect([chars < 262144, nodes < 2000, depth < 32]).toEqual([true, true, true])
})

// A narrow pane on the desktop: the tray docks at the window's foot and a pulled card rises over it as the draft's
// sheet, so the sheet's take button also puts the card back.
test('a narrow pane takes a card from its sheet and puts it back, into the docked tray', async ($, on) => {
  const w = cardsWorld(on)
  await $.session.start({ ...START, surface: 'desktop' })
  await settleLegacyStart($, w)
  await $.command.run(cardsCommand)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PROPS, bodyColumns: 62 } })
  for (let i = 0; i < 50 && !(await ui.find({ key: 'card:skill:tidy-notes' })); i++) await ui.redraw()
  await ui.press({ key: 'card:skill:tidy-notes' })
  // the sheet comes up in steps, as the draft's slides up: part of it shows first, all of it 140 ms on
  const showing = async () => Number((await ui.find({ key: 'clip' }))?.props.minHeight ?? 0)
  const first = await showing()
  await w.clock.advance(200)
  expect(first).toBeGreaterThan(0)
  expect(await showing()).toBeGreaterThan(first)
  expect(await ui.find({ key: 'take:skill:tidy-notes' }), 'take:skill:tidy-notes').toBeUndefined()
  await ui.press({ key: 'takeup:skill:tidy-notes' })
  expect(await ui.find({ key: 'untray:skill:tidy-notes' }), 'untray:skill:tidy-notes').toBeDefined()
  // the sheet goes back down in steps, holding the card; a second press on it then does nothing
  expect(await ui.find({ key: 'clip' }), 'clip').toBeDefined()
  await ui.press({ key: 'takeup:skill:tidy-notes' })
  expect(await ui.find({ key: 'untray:skill:tidy-notes' }), 'untray:skill:tidy-notes').toBeDefined()
  await w.clock.advance(200)
  expect(await ui.find({ key: 'takeup:skill:tidy-notes' }), 'takeup:skill:tidy-notes').toBeUndefined()
  expect(await ui.find({ key: 'back:' }), 'back:').toBeUndefined()
  // pulled again, the same press takes it back out of the tray and closes the sheet
  await ui.press({ key: 'card:skill:tidy-notes' })
  await w.clock.advance(200)
  await ui.press({ key: 'takeup:skill:tidy-notes' })
  await w.clock.advance(200)
  expect(await ui.find({ key: 'untray:skill:tidy-notes' }), 'untray:skill:tidy-notes').toBeUndefined()
  expect(await ui.find({ key: 'back:' }), 'back:').toBeUndefined()
})

test("Coco says the next of their lines each time the pane opens, in the box and in the book", async ($, on) => {
  const w = cardsWorld(on)
  await $.session.start({ ...START, surface: 'desktop' })
  await settleLegacyStart($, w)
  const said: string[] = []
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: PROPS })
  for (let i = 0; i < 4; i++) {
    await $.command.run(cardsCommand)
    await ui.redraw()
    for (let j = 0; j < 50 && !(await ui.find({ key: 'card:skill:tidy-notes' })); j++) await ui.redraw()
    said.push(/"alt":"Coco\. ([^"]+)"/.exec(JSON.stringify(await ui.drawn()))?.[1] ?? '')
  }
  expect(said[0]).toBe('forgot a name? flip through, i remember~')
  expect(new Set(said.slice(0, 3)).size).toBe(3)
  expect(said[3]).toBe(said[0])
  // the pocket in the book says the line paired with the box's
  await ui.press({ key: 'view:book' })
  expect(await ui.find({ text: 'page one is mine, obviously. objections?' }), 'page one is mine, obviously. objections?').toBeDefined()
})

// After a reload the module has forgotten the pane's open, and the session's state still holds the deck the person
// opened before it, dealt with Claude's folders; the reload deals it so again.
test('Coco hands the card over when the pane is drawn without /coco cards, as after a reload', async ($, on) => {
  const sent: Sent[] = []
  const w = cardsWorld(on, sent, [], COMMANDS, {}, () => CARDS_ART_TEXT, { cardsCatalog: { status: 'ready', cards: [], hasFolders: true } })
  await $.session.start({ ...START, surface: 'desktop' })
  await settleLegacyStart($, w)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: PROPS })
  for (let i = 0; i < 50 && !(await ui.find({ key: 'card:skill:tidy-notes' })); i++) await ui.redraw()
  const moving = async () => (JSON.stringify(await ui.drawn()).match(/"isInteractive":true/g) ?? []).length
  const atRest = await moving()
  await ui.press({ key: 'card:skill:tidy-notes' })
  await w.clock.advance(400)
  await ui.press({ key: 'take:skill:tidy-notes' })
  await w.clock.advance(100)
  // Coco's frame at rest, and over it the hand-over's first part
  expect(await moving()).toBeGreaterThan(atRest)
  await $.prompt.submit({ text: 'tidy my notes', wait: false, origin: PERSON })
  expect((sent.at(-1)?.context ?? []).join('\n')).toContain('Skill "tidy-notes"')
})

// The top of the bag holds a button into the same pane on every page (owner 10-19), named as the pane is named, in
// Coco's language, with how many cards the deck holds beside the name; page 1 has no second one.
const BAG_PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book' }
for (const [surface, language, page, label, count] of [['desktop', undefined, 'him', 'SKILL cards', / cards?$/], ['terminal', undefined, 'usage', 'SKILL cards', / cards?$/], ['desktop', 'Chinese', 'him', 'SKILL卡片', /已收 \d+ 张/]] as const) {
  test(`the top of the bag opens the cards with one press (${surface}, ${page}${language ? ', ' + language : ''})`, async ($, on) => {
    const w = cardsWorld(on, [], [], COMMANDS, language ? { language } : {})
    await $.session.start({ ...START, surface })
    await settleLegacyStart($, w)
    await $.command.run({ ...cardsCommand, args: page })
    expect(w.opens.map(o => o.id)).toEqual(['coco-book'])
    const bag = await $.ui.mount({ ...BAG_PANE, surface, props: { ...PROPS, title: 'Coco' } })
    for (let i = 0; i < 50 && !(await bag.find({ text: count })); i++) await bag.redraw()
    expect(await bag.findAll({ type: 'Button', key: 'coco:cards:open' })).toHaveLength(1)
    const button = await bag.find({ type: 'Button', key: 'coco:cards:open' })
    expect(button?.props.label).toBe(label)
    expect(await bag.find({ text: count }), String(count)).toBeDefined()
    await bag.press({ key: 'coco:cards:open' })
    expect(w.opens.map(o => o.id)).toEqual(['coco-book', 'coco-cards'])
    const ui = await $.ui.mount({ ...PANE, surface, props: PROPS })
    for (let i = 0; i < 50 && !(await ui.find({ key: 'card:skill:tidy-notes' })); i++) await ui.redraw()
    expect(await ui.find({ key: 'card:skill:tidy-notes' }), 'card:skill:tidy-notes').toBeDefined()
  })
}
