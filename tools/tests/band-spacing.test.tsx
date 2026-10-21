import { expect, test } from 'claude-code/testing'
import { WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { settleLegacyStart, RECENT, band, world } from './world'

type Node = { type?: string; children?: unknown[] }
function texts(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []
  const n = node as Node
  return [n.type === 'Text' ? (n.children ?? []).filter(c => typeof c === 'string').join('') : '',
    ...(n.children ?? []).flatMap(texts)].filter(Boolean)
}

for (const lang of Object.keys(WORDS) as Lang[]) {
  test(`${lang}: stage direction spacing survives desktop whitespace collapse and terminal layout`, {options:{language:lang}}, async ($, on) => {
    const setupWorld=world(on, { store: { ...RECENT, lang }, settings: { prefersReducedMotion: true } })
    await $.session.start({ cwd: '/tmp/spacing', surface: 'desktop', isInteractive: true }); await settleLegacyStart($,setupWorld);
    const aside = WORDS[lang].aside.idle
    const cjk = ['zh', 'zh-Hant', 'ja', 'ko'].includes(lang)
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const setting of ['on', 'compact'] as const) {
        await $.command.run({ command: 'coco', args: `band ${setting}`,
          origin: { kind: 'composer' }, presentation: { columns: 180, isFullscreen: false } })
        const ui = await $.ui.mount({ surface, ...band(180) })
        // Since 10-19 (owner) a pixel choice changes nothing on the desktop, so its band keeps the picture it is in and
        // that picture's own direction; the terminal still draws the idle aside.
        const shown = texts(await ui.drawn())
        const direction = surface === 'desktop' ? shown.find(t => /[(（].*[)）]$/.test(t)) : shown.find(t => t.endsWith(aside))
        // nowrap CSS collapses an ordinary leading space at the start of a flex leaf.
        // The desktop requires a preserved space; terminal cells keep an ordinary one.
        if (surface === 'desktop') expect(direction?.startsWith(cjk ? '(' : '\u00a0')).toBe(true)
        else expect(direction).toBe(`${cjk ? '' : ' '}${aside}`)
        const painted = surface === 'desktop' ? direction?.replace(/^ +/, '') : direction
        expect(painted?.startsWith(cjk ? '(' : surface === 'desktop' ? '\u00a0' : ' ')).toBe(true)
        await ui.unmount()
      }
    }
  })
}
