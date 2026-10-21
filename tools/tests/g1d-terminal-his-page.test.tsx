import { expect, test } from 'claude-code/testing'
import { LANGS, WORDS } from '../hooks/words'
import { P, PERSON, RECENT, world, settleLegacyStart } from './world'

// G1 fix round: His page on the terminal opens with his crest, the play-script head every page has on every surface
// (BOOK.md head, 0.3 SPEC 195). D1's merge (ab362fa) took the "✻ " off that one page on the terminal with no
// spec line, decision or message behind it; the desktop page kept it.
const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }

for (const page of ['about', 'usage', 'log', 'library', 'settings'] as const) test(`terminal ${page} page: the head starts with his crest and his name`, async ($, on) => {
  const w = world(on, { store: RECENT })
  await $.session.start(START)
  await settleLegacyStart($, w)
  await $.command.run({ command: 'coco', args: page, origin: PERSON, presentation: P })
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE })
  // His page's title is his name; the other pages carry theirs, and all of them carry the crest.
  const heads = (await ui.findAll({ type: 'Text' })).filter((n: any) => n.props?.bold && JSON.stringify(n.children ?? []).includes('✻ '))
  expect(heads.length).toBeGreaterThan(0)
  if (page === 'about') expect(await ui.find({ type: 'Text', text: '✻ ' + WORDS.en.name })).toBeDefined()
  await ui.unmount()
})

for (const lang of LANGS.map(l => l.code)) test(`terminal His page ${lang}: "✻ " and the language's name for him`, async ($, on) => {
  const w = world(on, { store: { ...RECENT, lang }, env: { LANG: LANGS.find(l => l.code === lang)!.locale } })
  await $.session.start(START)
  await settleLegacyStart($, w)
  await $.command.run({ command: 'coco', args: 'about', origin: PERSON, presentation: P })
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: '✻ ' + WORDS[lang as keyof typeof WORDS].name })).toBeDefined()
  await ui.unmount()
})
