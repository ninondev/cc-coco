import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { jestPassHuge } from './fixtures/jest-pass-huge'

test('generated huge Jest fixture equals the accepted 2349376 source bytes', () => {
  const bytes = Buffer.from(jestPassHuge(), 'utf8')
  expect(bytes.length).toBe(2349376)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('8e1e31236e9a2cbde1acbd53c50e0c8e47b03439b1bca4e008d5842b9a1d7398')
})
