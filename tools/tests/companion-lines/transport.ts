import { companionFiles, companionKey, companionText } from '../../../source/hooks/companion'
import { initialView } from '../../../source/hooks/mood'
import { installWritten, useWritten, linesFromText } from '../../../source/hooks/line-library'

// Exercise the unrestricted existing text editor, then the production transport boundary.
const folder = process.argv[2]!
const fixtures: Record<string, unknown>[] = []
for (const [name, count, width] of [['129-lines', 129, 12], ['large-book', 15000, 80], ['long-wake', 1, 3000]] as const) {
  const pool = Array.from({ length: count }, (_, i) => `line ${i} ` + '字'.repeat(width))
  const set = linesFromText('[start]\n' + pool.join('\n') + '\n[wake]\n' + pool.join('\n'))
  installWritten('fish', set); useWritten(true, 'only')
  const raw = companionText(companionKey({ ...initialView(), character: 'fish', lang: 'zh' }), name, true, 1000)
  const files = companionFiles(raw)
  if (!files.library) throw Error('missing separate book')
  const legacy = companionFiles('{"session":"old","at":1,"lang":"zh"}')
  if (legacy.library || JSON.parse(legacy.feed).session !== 'old') throw Error('legacy record changed')
  await Bun.write(`${folder}/${name}.raw.json`, raw)
  await Bun.write(`${folder}/${name}.feed.json`, files.feed)
  await Bun.write(`${folder}/${name}.book.json`, files.library.text)
  fixtures.push({ name, count, file: files.library.name })
}
await Bun.write(`${folder}/fixtures.json`, JSON.stringify(fixtures))
