// Reconstruct the accepted fixture byte for byte, only when its test requests it.
export function jestPassHuge(): string {
  const suites: string[] = []
  for (let i = 0; i < 760; i++) {
    const tests: string[] = []
    for (let j = 0; j < 40; j++) {
      tests.push(`    \x1b[32m✓\x1b[39m test case ${i}.${j} keeps working under load \x1b[2m(${j % 9 + 1} ms)\x1b[22m\n`)
    }
    suites.push(`\x1b[32mPASS\x1b[39m \x1b[2msrc/suite${String(i).padStart(3, '0')}.test.js\x1b[22m\n  \x1b[1mSuite ${i}\x1b[22m\n${tests.join('')}\n`)
  }
  return suites.join('') + '\x1b[32mTest Suites: \x1b[39m760 passed, 760 total\n\x1b[32mTests:       \x1b[39m30400 passed, 30400 total\nSnapshots:   0 total\nTime:        \x1b[2m211.4 s\x1b[22m\nRan all test suites.\n'
}
