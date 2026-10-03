// Shipping source is supplied by the runner; the engine kit cannot inspect files itself.
import { describe, expect, test } from 'claude-code/testing'
import { PLUGIN_SOURCES } from './plugin-sources'
import { pathPattern, samePath } from './file-paths'

function slashJoins(source: string): string[] {
  const found: string[] = []
  for (const [index, line] of source.split('\n').entries()) {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue
    // A template beginning at a path root, including properties and root aliases.
    for (const match of line.matchAll(/`\$\{([^}]+)\}\//g)) {
      // This constant is a relative asset fragment, never an engine or OS root.
      if (match[1] !== 'COMPANION_DIR') found.push(`${index + 1}: ${match[0]}`)
    }
    for (const match of line.matchAll(/(?:\$\.plugin\.root|\b(?:\w*[Rr]oot|\w*[Hh]ome|\w*[Ff]older))\s*\+\s*['"]\//g)) found.push(`${index + 1}: ${match[0]}`)
  }
  return found
}

describe('engine and OS path joins', () => {
  test('fixture normalization accepts a host drive only for POSIX expectations', () => {
    expect(samePath('C:\\tmp\\book', '/tmp/book')).toBe(true)
    expect(samePath('C:\\tmp\\book', 'C:/tmp/book')).toBe(true)
    expect(samePath('D:\\tmp\\book', 'C:/tmp/book')).toBe(false)
    expect(pathPattern('/tmp/book').test('C:\\tmp\\book')).toBe(true)
    expect(pathPattern('C:/tmp/book').test('D:\\tmp\\book')).toBe(false)
  })
  test('the guard detects template and concatenation mutations but permits relative assets', () => {
    for (const source of ['const p = `${$.plugin.root}/book/en.json`', 'const p = `${home}/Library`', 'const p = `${this.folder}/requests.jsonl`', 'const p = root + "/book/en.json"']) expect(slashJoins(source).length).toBe(1)
    expect(slashJoins('const p = `assets/${folder}/idle.png`')).toEqual([])
  })
  test('engine and OS roots are joined only through hooks/paths.ts', () => {
    const found = Object.entries(PLUGIN_SOURCES).flatMap(([file, source]) => file === 'hooks/paths.ts' ? [] : slashJoins(source).map(line => `${file}:${line}`))
    expect(found).toEqual([])
  })
})
