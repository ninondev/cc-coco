import { expect, test } from 'claude-code/testing'
import { terminalBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { LANGS } from '../hooks/words'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { world } from './world'

const corpus = JSON.parse(C3_WORDS_RAW)
const target = '~/Claude/Projects/atlas/plugin/assets/generated/build'
const file = 'plugin/hooks/very-long-project-settings/subsystem/runtime/config.ts'
const lineNumber = '17'
const warningPoints = {
  en: ['deletes', 'secret'], fr: ['vide', 'secret'], de: ['löscht', 'geheimen Schlüssel'],
  hi: ['मिटा देगा', 'गोपनीय जानकारी'], id: ['menghapus', 'rahasia'], it: ['svuota', 'segreto'],
  ja: ['消します', '秘密の鍵'], ko: ['삭제합니다', '비밀 정보가'],
  'pt-BR': ['apaga', 'segredo'], 'es-419': ['elimina', 'secreto'], 'es-ES': ['elimina', 'secreto'],
  zh: ['删掉', '密钥'], 'zh-Hant': ['刪掉', '金鑰'],
} as const
const lineLabels = {
  en: 'line 17', fr: 'ligne 17', de: 'Zeile 17', hi: 'पंक्ति 17', id: 'baris 17', it: 'riga 17',
  ja: '17行目', ko: '17행', 'pt-BR': 'linha 17', 'es-419': 'línea 17', 'es-ES': 'línea 17',
  zh: '第17行', 'zh-Hant': '第17行',
} as const
const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim()
const text = (node: any): string => typeof node === 'string' || typeof node === 'number'
  ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.children ?? []) : ''
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(nodes) : [node, ...(node.children ?? []).flatMap(nodes)]
const speechRoots = (node: any): any[] => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(speechRoots)
  : node.type === 'Text' ? !node.props?.bold && node.props?.wrap && node.props?.color !== 'inactive' ? [node] : []
  : (node.children ?? []).flatMap(speechRoots)

test('W4 part3 terminal warning inventory covers all 13 canonical languages', () => {
  expect(LANGS.map(({ code }) => code).sort()).toEqual(Object.keys(warningPoints).sort())
  expect(Object.keys(warningPoints).length).toBe(13)
})

for (const { code: lang } of LANGS) for (const [key, pointIndex] of [['guard.rm', 0], ['guard.secretAfter', 1]] as const)
  for (const columns of [24, 60, 80]) test(`W4 part3 terminal ${columns} ${lang}/${key} retains its warning before path and line`, async ($, on) => {
    const source = corpus[key][lang].replace('{target}', target).replace('{file}', file).replace('{line}', lineNumber)
    const requiredPoint = warningPoints[lang][pointIndex]
    expect(source.includes(requiredPoint)).toBe(true)
    const slots = key === 'guard.rm'
      ? [{ kind: 'path' as const, value: target }]
      : [{ kind: 'path' as const, value: file }, { kind: 'value' as const, value: lineNumber }]
    const view = {
      ...initialView(), lang, context: 56, band: 'on' as const, workSize: 'smaller' as const,
      quota: { rateLimits: [{ kind: 'five_hour', percentUsed: 72 }, { kind: 'seven_day', percentUsed: 41 }], costUSD: 1.84, at: Date.UTC(2026, 9, 2, 9) },
      line: { id: key, key, text: source, class: 3 as const, slots, expiresAt: 14000 },
    }
    const requestId = 'w4-terminal-warning'
    on('ui.render', { component: 'Pane', requestId }, ($, event) => terminalBand($.ui.resolve(event) as any, view, { columns, maxRows: 30, screenRows: 48, isWorking: true }))
    world(on)
    const ui = await $.ui.mount({ surface: 'terminal', plugin: 'coco', component: 'Pane', requestId, props: { title: 'W4 terminal warning', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    const tree = await ui.drawn(), all = nodes(tree), roots = speechRoots(tree)
    expect(roots.length).toBeLessThanOrEqual(1)
    const actualRenderedText = normalize(roots.map(text).join(' '))
    for (const node of all.filter(node => node.type === 'Text')) expect(normalize(text(node)) === '…').toBe(false)
    if (columns === 24 && actualRenderedText === '') {
      expect(all.some(node => node.type === 'Text' && /config\.ts|\/build/u.test(text(node)))).toBe(false)
      expect(all.some(node => node.type === 'Text' && node.props?.bold && normalize(text(node)) === lineNumber)).toBe(false)
    } else {
      expect({ actualRenderedText, requiredPoint, pointRetained: actualRenderedText.includes(requiredPoint) })
        .toEqual({ actualRenderedText, requiredPoint, pointRetained: true })
    }
    if (key === 'guard.secretAfter' && actualRenderedText.includes(lineNumber)) {
      const requiredLabel = lineLabels[lang]
      expect(source.includes(requiredLabel)).toBe(true)
      expect({ actualRenderedText, requiredLabel, labelRetained: actualRenderedText.includes(requiredLabel) })
        .toEqual({ actualRenderedText, requiredLabel, labelRetained: true })
      const numeric = all.filter(node => node.type === 'Text' && node.props?.bold && normalize(text(node)) === lineNumber)
      expect(numeric.length).toBe(1)
      expect(numeric[0]!.props.wrap).toBe('truncate-end')
    }
    await ui.unmount()
  })
