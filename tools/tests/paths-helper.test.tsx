import { describe, expect, test } from 'claude-code/testing'
import { homePath, isWindows, joinPath, samePath, windowsPath } from '../hooks/paths'

describe('portable path helper', () => {
  test('POSIX root and empty roots keep their absolute or relative meaning', () => {
    expect(joinPath('/', 'book', 'en.json')).toBe('/book/en.json')
    expect(joinPath('', 'book', 'en.json')).toBe('book/en.json')
    expect(joinPath('/tmp/plugin files/', '/book/', 'en.json')).toBe('/tmp/plugin files/book/en.json')
    expect(joinPath('/')).toBe('/')
    expect(joinPath('/tmp/project\\name', 'book/en.json')).toBe('/tmp/project\\name/book/en.json')
  })
  test('Windows drives, mixed separators, UNC and spaces keep their root style', () => {
    expect(joinPath('C:\\', 'book/en.json')).toBe('C:\\book\\en.json')
    expect(joinPath('C:/Users/plugin files/', '\\assets\\pixel/', 'idle.png')).toBe('C:\\Users\\plugin files\\assets\\pixel\\idle.png')
    expect(joinPath('\\\\server\\share\\', 'book/en.json')).toBe('\\\\server\\share\\book\\en.json')
    expect(windowsPath('C:\\Users')).toBe(true)
    expect(windowsPath('\\\\server\\share')).toBe(true)
    expect(windowsPath('/tmp/plugin')).toBe(false)
  })
  test('comparisons preserve different drives and POSIX case while accepting Windows case', () => {
    expect(samePath('C:\\Users\\Book\\', 'c:/users/book')).toBe(true)
    expect(samePath('C:\\Users\\Book', 'D:/Users/Book')).toBe(false)
    expect(samePath('/tmp/Book', '/tmp/book')).toBe(false)
    expect(samePath('/tmp/a\\b', '/tmp/a/b')).toBe(false)
    expect(samePath('/tmp/book/', '/tmp/book')).toBe(true)
    expect(samePath('\\\\server\\Share', '//SERVER/share')).toBe(true)
  })
  test('home and Windows facts respect a configured POSIX HOME', () => {
    expect(homePath('/tmp/home', 'C:\\Users\\owner')).toBe('/tmp/home')
    expect(homePath(undefined, 'C:\\Users\\owner')).toBe('C:\\Users\\owner')
    expect(isWindows('Windows_NT', '/tmp/home', undefined)).toBe(true)
    expect(isWindows(undefined, undefined, 'C:\\Users\\owner')).toBe(true)
    expect(isWindows(undefined, '/tmp/home', 'C:\\Users\\owner')).toBe(false)
  })
})
