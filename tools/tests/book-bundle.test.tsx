import { expect, test } from 'claude-code/testing'
import { BOOK_TEXT } from '../hooks/book-text'
import { BOOK_FILES } from './book-files'
test('bundled book text equals every shipped JSON word without editing its contents', () => {
  expect(Object.keys(BOOK_TEXT).sort()).toEqual(Object.keys(BOOK_FILES).map(name => name.replace(/\.json$/, '')).sort())
  for (const [name, source] of Object.entries(BOOK_FILES)) {
    expect(BOOK_TEXT[name.replace(/\.json$/, '') as keyof typeof BOOK_TEXT]).toEqual(JSON.parse(source))
  }
})
