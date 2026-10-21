/**
 * runs.test.ts — cases for runs.ts (bun test).
 *
 * Every case name uses invented names from the allowed word set.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { jestPassHuge } from './fixtures/jest-pass-huge'
import { recognize, parseResult, record, judge } from '../../../plugin/hooks/algo/runs'

const fx = (name: string): string => name === 'jest-pass-huge.txt' ? jestPassHuge() : readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/* ---------------------------------------------------------------- *
 * recognize — the tool table, both ways
 * ---------------------------------------------------------------- */

describe('recognize: JavaScript', () => {
  const cases: Array<[string, string | null, string | null]> = [
    ['npm test', 'test', 'npm'],
    ['pnpm test', 'test', 'pnpm'],
    ['yarn test', 'test', 'yarn'],
    ['bun test', 'test', 'bun'],
    ['npm run test', 'test', 'npm'],
    ['npm run test:ci', 'test', 'npm'],
    ['npm run test-unit', 'test', 'npm'],
    ['npm run spec', 'test', 'npm'],
    ['npm run e2e', 'test', 'npm'],
    ['npm run unit', 'test', 'npm'],
    ['npm run integration', 'test', 'npm'],
    ['yarn test:watch', 'test', 'yarn'],
    ['pnpm integration', 'test', 'pnpm'],
    ['npm run build', 'build', 'npm'],
    ['npm run compile', 'build', 'npm'],
    ['npm run bundle', 'build', 'npm'],
    ['npm run build:prod', 'build', 'npm'],
    ['yarn build', 'build', 'yarn'],
    ['pnpm build', 'build', 'pnpm'],
    ['bun run build', 'build', 'bun'],
    ['jest', 'test', 'jest'],
    ['jest --coverage', 'test', 'jest'],
    ['vitest run', 'test', 'vitest'],
    ['vitest run --coverage', 'test', 'vitest'],
    ['mocha', 'test', 'mocha'],
    ['ava', 'test', 'ava'],
    ['tap', 'test', 'tap'],
    ['node --test', 'test', 'node'],
    ['deno test', 'test', 'deno'],
    ['playwright test', 'test', 'playwright'],
    ['cypress run', 'test', 'cypress'],
    ['karma start --single-run', 'test', 'karma'],
    ['jasmine', 'test', 'jasmine'],
    ['uvu', 'test', 'uvu'],
    ['c8 mocha', 'test', 'mocha'],
    ['nyc mocha', 'test', 'mocha'],
    ['nyc --reporter lcov mocha', 'test', 'mocha'],
    ['tsc', 'build', 'tsc'],
    ['tsc --noEmit', 'build', 'tsc'],
    ['vite build', 'build', 'vite'],
    ['next build', 'build', 'next'],
    ['nuxt build', 'build', 'nuxt'],
    ['astro build', 'build', 'astro'],
    ['svelte-kit build', 'build', 'svelte-kit'],
    ['webpack', 'build', 'webpack'],
    ['webpack --config webpack.prod.js', 'build', 'webpack'],
    ['rollup -c', 'build', 'rollup'],
    ['esbuild src/index.ts --bundle --outfile=dist/index.js', 'build', 'esbuild'],
    ['tsup', 'build', 'tsup'],
    ['tsup src/index.ts --format esm,cjs', 'build', 'tsup'],
    ['parcel build', 'build', 'parcel'],
    ['turbo run test', 'test', 'turbo'],
    ['turbo run build', 'build', 'turbo'],
    ['nx run api:test', 'test', 'nx'],
    ['nx run web:build', 'build', 'nx'],
    ['nx affected -t test', 'test', 'nx'],
    ['nx affected -t build', 'build', 'nx'],
    ['lerna run build', 'build', 'lerna'],
    // near misses
    ['npm install', null, null],
    ['npm i', null, null],
    ['npm run dev', null, null],
    ['npm run lint', null, null],
    ['yarn dev', null, null],
    ['pnpm add left-pad', null, null],
    ['vitest', null, null],
    ['vitest watch', null, null],
    ['jest --watch', null, null],
    ['jest --watchAll', null, null],
    ['tsc --watch', null, null],
    ['tsc -w', null, null],
    ['webpack --watch', null, null],
    ['webpack serve', null, null],
    ['rollup', null, null],
    ['esbuild src/index.ts --minify', null, null],
    ['vite', null, null],
    ['vite dev', null, null],
    ['parcel watch', null, null],
    ['turbo run lint', null, null],
    ['nx run api:lint', null, null],
    ['nx affected -t lint', null, null],
    ['lerna run publish', null, null],
    ['karma start', null, null],
    ['karma start --single-run=false', null, null],
    ['cypress open', null, null],
    ['node server.js', null, null],
  ]
  for (const [cmd, kind, tool] of cases) {
    test(`recognize(${JSON.stringify(cmd)})`, () => {
      const r = recognize(cmd)
      if (kind === null) expect(r).toBeNull()
      else {
        expect(r).not.toBeNull()
        expect(r!.kind).toBe(kind)
        expect(r!.tool).toBe(tool)
      }
    })
  }
})

describe('recognize: Python, Rust, Go, JVM, rest', () => {
  const cases: Array<[string, string | null, string | null]> = [
    ['pytest', 'test', 'pytest'],
    ['py.test', 'test', 'pytest'],
    ['pytest --version', 'test', 'pytest'], // the brief calls this out as still a test command
    ['python -m pytest', 'test', 'pytest'],
    ['python3 -m pytest', 'test', 'pytest'],
    ['python -m unittest', 'test', 'unittest'],
    ['python3 -m unittest', 'test', 'unittest'],
    ['nose2', 'test', 'nose2'],
    ['tox', 'test', 'tox'],
    ['nox', 'test', 'nox'],
    ['coverage run -m pytest', 'test', 'pytest'],
    ['python -m build', 'build', 'build'],
    ['pip wheel', 'build', 'pip'],
    ['cargo test', 'test', 'cargo'],
    ['cargo nextest run', 'test', 'nextest'],
    ['cargo build', 'build', 'cargo'],
    ['cargo build --release', 'build', 'cargo'],
    ['go test', 'test', 'go'],
    ['go build', 'build', 'go'],
    ['go build ./...', 'build', 'go'],
    ['gradle test', 'test', 'gradle'],
    ['gradle check', 'test', 'gradle'],
    ['./gradlew test', 'test', 'gradle'],
    ['./gradlew build', 'build', 'gradle'],
    ['gradlew.bat assemble', 'build', 'gradle'],
    ['gradle clean build', 'build', 'gradle'],
    ['mvn test', 'test', 'mvn'],
    ['mvn verify', 'test', 'mvn'],
    ['./mvnw clean package', 'build', 'mvn'],
    ['mvn install', 'build', 'mvn'],
    ['mvnw verify -DskipITs', 'test', 'mvn'],
    ['sbt test', 'test', 'sbt'],
    ['sbt compile', 'build', 'sbt'],
    ['bazel test //...', 'test', 'bazel'],
    ['bazel build //shop/...', 'build', 'bazel'],
    ['buck2 test //shop:', 'test', 'buck2'],
    ['buck2 build //shop:', 'build', 'buck2'],
    ['dotnet test', 'test', 'dotnet'],
    ['dotnet build', 'build', 'dotnet'],
    ['swift test', 'test', 'swift'],
    ['swift build', 'build', 'swift'],
    ['xcodebuild test -scheme Kiwi', 'test', 'xcodebuild'],
    ['xcodebuild -scheme Kiwi -destination platform=iOS build', 'build', 'xcodebuild'],
    ['rspec', 'test', 'rspec'],
    ['rake test', 'test', 'rake'],
    ['rake spec', 'test', 'rake'],
    ['rake test:units', 'test', 'rake'],
    ['rails test', 'test', 'rails'],
    ['ruby -Itest', 'test', 'ruby'],
    ['ruby -Itest test/unit/parser_test.rb', 'test', 'ruby'],
    ['phpunit', 'test', 'phpunit'],
    ['vendor/bin/phpunit', 'test', 'phpunit'],
    ['./vendor/bin/phpunit', 'test', 'phpunit'],
    ['php vendor/bin/phpunit', 'test', 'phpunit'],
    ['pest', 'test', 'pest'],
    ['composer test', 'test', 'composer'],
    ['mix test', 'test', 'mix'],
    ['mix compile', 'build', 'mix'],
    ['cabal test', 'test', 'cabal'],
    ['cabal build', 'build', 'cabal'],
    ['stack test', 'test', 'stack'],
    ['stack build', 'build', 'stack'],
    ['dart test', 'test', 'dart'],
    ['flutter test', 'test', 'flutter'],
    ['flutter build apk', 'build', 'flutter'],
    ['make', 'build', 'make'],
    ['make -j8', 'build', 'make'],
    ['make all', 'build', 'make'],
    ['make test', 'test', 'make'],
    ['make check', 'test', 'make'],
    ['make -C build test', 'test', 'make'],
    ['cmake --build build', 'build', 'cmake'],
    ['ninja', 'build', 'ninja'],
    ['ninja -C build', 'build', 'ninja'],
    ['meson test', 'test', 'meson'],
    ['ctest', 'test', 'ctest'],
    ['zig build test', 'test', 'zig'],
    ['zig build', 'build', 'zig'],
    // near misses
    ['cargo check', null, null],
    ['cargo clippy', null, null],
    ['cargo fmt', null, null],
    ['go vet', null, null],
    ['go run main.go', null, null],
    ['go fmt ./...', null, null],
    ['gradle clean', null, null],
    ['mvn clean', null, null],
    ['mvn deploy', null, null],
    ['sbt run', null, null],
    ['dotnet publish', null, null],
    ['dotnet restore', null, null],
    ['rake db:migrate', null, null],
    ['rake assets:precompile', null, null],
    ['rails console', null, null],
    ['composer install', null, null],
    ['mix phx.server', null, null],
    ['mix deps.get', null, null],
    ['cabal install', null, null],
    ['stack exec kiwi', null, null],
    ['dart pub get', null, null],
    ['flutter pub get', null, null],
    ['make clean', null, null],
    ['make distclean', null, null],
    ['cmake ..', null, null],
    ['cmake -S . -B build', null, null],
    ['meson setup build', null, null],
    ['zig fmt src', null, null],
    ['pip install', null, null],
    ['python -m pip install requests', null, null],
    ['python script.py', null, null],
  ]
  for (const [cmd, kind, tool] of cases) {
    test(`recognize(${JSON.stringify(cmd)})`, () => {
      const r = recognize(cmd)
      if (kind === null) expect(r).toBeNull()
      else {
        expect(r).not.toBeNull()
        expect(r!.kind).toBe(kind)
        expect(r!.tool).toBe(tool)
      }
    })
  }
})

/* ---------------------------------------------------------------- *
 * recognize — wrappers and runners
 * ---------------------------------------------------------------- */

describe('recognize: wrappers', () => {
  const cases: Array<[string, string, string, string]> = [
    // command, inner tool, expected kind, expected key (wrappers stripped)
    ['sudo npm test', 'npm', 'test', 'npm test'],
    ['CI=true npm test', 'npm', 'test', 'npm test'],
    ['NODE_ENV=test FORCE_COLOR=1 vitest run', 'vitest', 'test', 'vitest run'],
    ['env NODE_ENV=test jest', 'jest', 'test', 'jest'],
    ['time go test ./...', 'go', 'test', 'go test ./...'],
    ['nice -n 5 make test', 'make', 'test', 'make test'],
    ['timeout 30s pytest', 'pytest', 'test', 'pytest'],
    ['timeout 5m cargo build', 'cargo', 'build', 'cargo build'],
    ['timeout --foreground 10s deno test', 'deno', 'test', 'deno test'],
    ['caffeinate -i npm test', 'npm', 'test', 'npm test'],
    ['caffeinate -dims cargo test', 'cargo', 'test', 'cargo test'],
    ['nohup cargo build &', 'cargo', 'build', 'cargo build'],
    ['command jest', 'jest', 'test', 'jest'],
    ['sudo -u bob rspec', 'rspec', 'test', 'rspec'],
    ['env -i make check', 'make', 'test', 'make check'],
    ['time -p flutter test', 'flutter', 'test', 'flutter test'],
  ]
  for (const [cmd, tool, kind, key] of cases) {
    test(`wrapper ${JSON.stringify(cmd)}`, () => {
      const r = recognize(cmd)
      expect(r).not.toBeNull()
      expect(r!.tool).toBe(tool)
      expect(r!.kind).toBe(kind)
      expect(r!.key).toBe(key)
    })
  }
  test('command -v jest is not a run', () => {
    expect(recognize('command -v jest')).toBeNull()
  })
})

describe('recognize: runner unwrapping', () => {
  const cases: Array<[string, string, string, string]> = [
    ['npx jest', 'jest', 'test', 'jest'],
    ['npx -y playwright test', 'playwright', 'test', 'playwright test'],
    ['npx vitest run', 'vitest', 'test', 'vitest run'],
    ['pnpm exec vitest run', 'vitest', 'test', 'vitest run'],
    ['pnpm exec tsc', 'tsc', 'build', 'tsc'],
    ['pnpm dlx jest', 'jest', 'test', 'jest'],
    ['yarn dlx vitest run', 'vitest', 'test', 'vitest run'],
    ['bunx mocha', 'mocha', 'test', 'mocha'],
    ['uv run pytest', 'pytest', 'test', 'pytest'],
    ['uv run --no-sync pytest', 'pytest', 'test', 'pytest'],
    ['poetry run pytest', 'pytest', 'test', 'pytest'],
    ['pdm run pytest', 'pytest', 'test', 'pytest'],
    ['hatch run pytest', 'pytest', 'test', 'pytest'],
    ['pipenv run pytest', 'pytest', 'test', 'pytest'],
    ['rye run pytest', 'pytest', 'test', 'pytest'],
    ['bundle exec rspec', 'rspec', 'test', 'rspec'],
    ['dotenv -- mocha', 'mocha', 'test', 'mocha'],
    ['dotenv -e .env -- jest', 'jest', 'test', 'jest'],
    ['cross-env NODE_ENV=test jest', 'jest', 'test', 'jest'],
    ['cross-env CI=1 vitest run', 'vitest', 'test', 'vitest run'],
    ['./node_modules/.bin/jest', 'jest', 'test', 'jest'],
    ['./node_modules/.bin/vitest run', 'vitest', 'test', 'vitest run'],
    ['node_modules/.bin/tsc --noEmit', 'tsc', 'build', 'tsc --noEmit'],
    ['node_modules/.bin/mocha', 'mocha', 'test', 'mocha'],
    ['sudo timeout 30s npx vitest run', 'vitest', 'test', 'vitest run'],
    ['CI=1 npx --yes c8 mocha', 'mocha', 'test', 'c8 mocha'],
  ]
  for (const [cmd, tool, kind, key] of cases) {
    test(`runner ${JSON.stringify(cmd)}`, () => {
      const r = recognize(cmd)
      expect(r).not.toBeNull()
      expect(r!.tool).toBe(tool)
      expect(r!.kind).toBe(kind)
      expect(r!.key).toBe(key)
    })
  }
})

describe('recognize: chains', () => {
  const cases: Array<[string, string]> = [
    ['npm install && npm test', 'npm'],
    ['npm install && npm run build', 'npm'],
    ['npm run lint; vitest run', 'vitest'],
    ['npm run dev || npm run test:e2e', 'npm'],
    ['cargo build && cargo test', 'cargo'],
    ['cargo test && cargo build', 'cargo'],
    ['echo linting\nmake test', 'make'],
    ['git pull && go test ./... && go vet', 'go'],
    ['pip install -e . && pytest | tee out.log', 'pytest'],
    ['cd web && npm run build', 'npm'],
    ['pnpm build || pnpm test', 'pnpm'],
  ]
  for (const [cmd, tool] of cases) {
    test(`chain ${JSON.stringify(cmd)}`, () => {
      const r = recognize(cmd)
      expect(r).not.toBeNull()
      expect(r!.tool).toBe(tool)
    })
  }
  test('chain picks the first matching part, not the first part', () => {
    expect(recognize('cargo test && cargo build')!.kind).toBe('test')
    expect(recognize('cargo build && cargo test')!.kind).toBe('build')
  })
  test('a chain of nothing recognisable is null', () => {
    expect(recognize('echo hi && ls -la')).toBeNull()
    expect(recognize('git status || true')).toBeNull()
  })
  test('quoted separators inside arguments do not split the chain', () => {
    const r = recognize('pytest -k "fast or slow" --tb=short')
    expect(r!.filtered).toBe(true)
    expect(r!.key).toBe('pytest -k fast or slow --tb=short')
  })
})

/* ---------------------------------------------------------------- *
 * recognize — key normalisation
 * ---------------------------------------------------------------- */

describe('recognize: key normalisation', () => {
  const cases: Array<[string, string]> = [
    ['pytest', 'pytest'],
    ['pytest --color', 'pytest'],
    ['pytest --colors', 'pytest'],
    ['pytest --color=yes', 'pytest'],
    ['pytest --no-color', 'pytest'],
    ['jest --ci', 'jest'],
    ['jest --silent', 'jest'],
    ['jest -q', 'jest'],
    ['jest --quiet', 'jest'],
    ['mocha --reporter spec', 'mocha'],
    ['mocha --reporter=spec', 'mocha'],
    ['mocha --progress=bar', 'mocha'],
    ['vitest run --reporter dot --silent --color', 'vitest run'],
    ['npm   test', 'npm test'],
    ['npm\ttest', 'npm test'],
    ['cargo build   --release', 'cargo build --release'],
    ['go test -count=1 ./...', 'go test -count=1 ./...'],
  ]
  for (const [cmd, key] of cases) {
    test(`key of ${JSON.stringify(cmd)} is ${JSON.stringify(key)}`, () => {
      expect(recognize(cmd)!.key).toBe(key)
    })
  }
  test('work-changing flags stay in the key', () => {
    expect(recognize('vitest run --coverage')!.key).toBe('vitest run --coverage')
    expect(recognize('pytest -v')!.key).toBe('pytest -v')
    expect(recognize('cargo build --release')!.key).toBe('cargo build --release')
    expect(recognize('go test -race ./...')!.key).toBe('go test -race ./...')
  })
  test('same work keeps one key across wrapper noise', () => {
    const a = recognize('pytest')!.key
    const b = recognize('CI=1 uv run --no-sync pytest')!.key
    const c = recognize('nice -n 5 pytest')!.key
    expect(a).toBe(b)
    expect(a).toBe(c)
  })
  test('filtered runs keep their own key', () => {
    expect(recognize('pytest tests/test_billing.py')!.key).toBe('pytest tests/test_billing.py')
    expect(recognize('pytest')!.key).toBe('pytest')
  })
})

/* ---------------------------------------------------------------- *
 * recognize — filtered
 * ---------------------------------------------------------------- */

describe('recognize: filtered', () => {
  const filteredCases: string[] = [
    'pytest tests/test_billing.py',
    'pytest tests/api',
    'pytest -k invoice',
    'pytest -k "invoice or tax"',
    'jest -t totals',
    'jest --testNamePattern totals',
    'jest src/orders/billing.test.js',
    'mocha --grep invoice',
    'mocha test/writer.spec.js',
    'vitest run src/writer.test.ts',
    'bun test src/calc.test.ts',
    'go test -run TestParser ./...',
    'go test ./pkg/wren/...',
    'cargo test orders::tests::computes_totals',
    'cargo test --test integration',
    'deno test --filter wren',
    'swift test --filter ParserTests',
    'dotnet test --filter FullyQualifiedName~ParserTests',
    'rspec spec/wren/parser_spec.rb',
    'node --test test/orders.mjs',
    'playwright test tests/shop.spec.ts',
    'cypress run --spec cypress/e2e/login.cy.js',
    'python -m unittest tests.test_billing',
    'python -m unittest test_billing.TestCalculator.test_add',
    'mix test test/finch/parser_test.exs',
    'ctest -R wren',
    'dart test --plain-name writes',
    'flutter test test/parser_test.dart',
    'gradle test --tests com.shop.BillingServiceTest',
    'nx run api:test',
    'turbo run test --filter=web',
    'ava test/billing.js',
    'uvu test/',
    'tap test/wren.test.js',
    'jasmine test/parser.spec.js',
    'pest tests/Unit --group=parser',
    'phpunit tests/Unit/BillingTest.php',
    'karma start --single-run --grep invoice',
  ]
  for (const cmd of filteredCases) {
    test(`${JSON.stringify(cmd)} is filtered`, () => {
      const r = recognize(cmd)
      expect(r).not.toBeNull()
      expect(r!.filtered).toBe(true)
    })
  }
  const unfilteredCases: string[] = [
    'pytest',
    'jest',
    'mocha',
    'vitest run',
    'bun test',
    'go test',
    'go test ./...',
    'cargo test',
    'deno test',
    'swift test',
    'dotnet test',
    'rspec',
    'node --test',
    'playwright test',
    'cypress run',
    'python -m unittest',
    'python -m unittest discover',
    'mix test',
    'ctest',
    'dart test',
    'flutter test',
    'gradle test',
    'turbo run test',
    'make test',
    'npm test',
    'karma start --single-run',
  ]
  for (const cmd of unfilteredCases) {
    test(`${JSON.stringify(cmd)} is not filtered`, () => {
      const r = recognize(cmd)
      expect(r).not.toBeNull()
      expect(r!.filtered).toBe(false)
    })
  }
  test('go test ./... is the whole suite, one package is a subset', () => {
    expect(recognize('go test ./...')!.filtered).toBe(false)
    expect(recognize('go test ./orders/...')!.filtered).toBe(true)
  })
})

/* ---------------------------------------------------------------- *
 * parseResult — every fixture format
 * ---------------------------------------------------------------- */

describe('parseResult: fixtures', () => {
  const cases: Array<{
    file: string
    tool: string
    code: number | null
    expect: Partial<{ outcome: string; firstFailing: string | undefined; failed: number | undefined; passed: number | undefined }>
  }> = [
    { file: 'jest-pass.txt', tool: 'jest', code: 0, expect: { outcome: 'pass', failed: 0, passed: 3 } },
    { file: 'jest-fail-ansi.txt', tool: 'jest', code: 1, expect: { outcome: 'fail', firstFailing: 'Calculator › totals an invoice', failed: 1, passed: 2 } },
    { file: 'vitest-fail.txt', tool: 'vitest', code: 1, expect: { outcome: 'fail', firstFailing: 'writer > flushes the buffer', failed: 1, passed: 4 } },
    { file: 'vitest-pass.txt', tool: 'vitest', code: 0, expect: { outcome: 'pass', failed: 0, passed: 5 } },
    { file: 'mocha-pass.txt', tool: 'mocha', code: 0, expect: { outcome: 'pass', failed: 0, passed: 3 } },
    { file: 'mocha-fail-crlf.txt', tool: 'mocha', code: 1, expect: { outcome: 'fail', firstFailing: 'Wren parser writes nested output', failed: 1 } },
    { file: 'ava-fail.txt', tool: 'ava', code: 1, expect: { outcome: 'fail', firstFailing: 'billing > rounds totals to cents', failed: 1 } },
    { file: 'tap-fail.txt', tool: 'tap', code: 1, expect: { outcome: 'fail', firstFailing: 'rejects an empty body', failed: 1, passed: 2 } },
    { file: 'node-test-fail.txt', tool: 'node', code: 1, expect: { outcome: 'fail', firstFailing: 'cancels an order', failed: 1, passed: 2 } },
    { file: 'node-test-pass.txt', tool: 'node', code: 0, expect: { outcome: 'pass', failed: 0, passed: 2 } },
    { file: 'deno-fail.txt', tool: 'deno', code: 1, expect: { outcome: 'fail', firstFailing: 'creates a user with a valid payload', failed: 1, passed: 2 } },
    { file: 'bun-test-fail.txt', tool: 'bun', code: 1, expect: { outcome: 'fail', firstFailing: 'Calculator > multiplies by zero', failed: 1, passed: 87 } },
    { file: 'bun-test-pass.txt', tool: 'bun', code: 0, expect: { outcome: 'pass', failed: 0, passed: 87 } },
    { file: 'playwright-fail.txt', tool: 'playwright', code: 1, expect: { outcome: 'fail', firstFailing: 'checkout › totals the basket', failed: 1, passed: 11 } },
    { file: 'cypress-fail.txt', tool: 'cypress', code: 1, expect: { outcome: 'fail', firstFailing: 'login flow rejects a bad password', failed: 1, passed: 3 } },
    { file: 'karma-fail.txt', tool: 'karma', code: 1, expect: { outcome: 'fail', firstFailing: 'kiwi parser should read a header', failed: 1, passed: 4 } },
    { file: 'uvu-pass.txt', tool: 'uvu', code: 0, expect: { outcome: 'pass', passed: 2, failed: 0 } },
    { file: 'jasmine-pass.txt', tool: 'jasmine', code: 0, expect: { outcome: 'pass', failed: 0, passed: 3 } },
    { file: 'jasmine-fail.txt', tool: 'jasmine', code: 1, expect: { outcome: 'fail', firstFailing: 'kiwi parser reads a nested list', failed: 1, passed: 2 } },
    { file: 'pytest-fail.txt', tool: 'pytest', code: 1, expect: { outcome: 'fail', firstFailing: 'tests/test_billing.py::TestBilling::test_totals_invoice', failed: 2, passed: 45 } },
    { file: 'pytest-fail-crlf.txt', tool: 'pytest', code: 1, expect: { outcome: 'fail', firstFailing: 'tests/test_billing.py::TestBilling::test_totals_invoice', failed: 1, passed: 8 } },
    { file: 'pytest-pass.txt', tool: 'pytest', code: 0, expect: { outcome: 'pass', passed: 31 } },
    { file: 'pytest-error.txt', tool: 'pytest', code: 1, expect: { outcome: 'fail', firstFailing: 'tests/test_users.py::test_fetch_user_by_id', failed: 1, passed: 1 } },
    { file: 'unittest-fail.txt', tool: 'unittest', code: 1, expect: { outcome: 'fail', firstFailing: 'test_billing.TestCalculator.test_add', failed: 1, passed: 2 } },
    { file: 'cargo-fail.txt', tool: 'cargo', code: 1, expect: { outcome: 'fail', firstFailing: 'orders::tests::computes_totals', failed: 1, passed: 11 } },
    { file: 'cargo-pass.txt', tool: 'cargo', code: 0, expect: { outcome: 'pass', failed: 0, passed: 30 } },
    { file: 'nextest-fail.txt', tool: 'nextest', code: 1, expect: { outcome: 'fail', firstFailing: 'orders::tests::computes_totals', failed: 1, passed: 11 } },
    { file: 'go-fail.txt', tool: 'go', code: 1, expect: { outcome: 'fail', firstFailing: 'TestParserNested/empty_body', failed: 2, passed: 3 } },
    { file: 'go-json-fail.txt', tool: 'go', code: 1, expect: { outcome: 'fail', firstFailing: 'TestParserNested/empty_body', failed: 1, passed: 2 } },
    { file: 'go-pass.txt', tool: 'go', code: null, expect: { outcome: 'pass' } },
    { file: 'gradle-fail.txt', tool: 'gradle', code: 1, expect: { outcome: 'fail', firstFailing: 'BillingServiceTest > computes invoice totals()', failed: 1, passed: 11 } },
    { file: 'gradle-fail-ansi.txt', tool: 'gradle', code: 1, expect: { outcome: 'fail', firstFailing: 'BillingServiceTest > computes invoice totals()', failed: 1, passed: 2 } },
    { file: 'gradle-pass.txt', tool: 'gradle', code: null, expect: { outcome: 'pass' } },
    { file: 'maven-fail.txt', tool: 'mvn', code: 1, expect: { outcome: 'fail', firstFailing: 'BillingServiceTest.testTotals', failed: 1, passed: 7 } },
    { file: 'sbt-fail.txt', tool: 'sbt', code: 1, expect: { outcome: 'fail', firstFailing: 'writes nested output', failed: 1, passed: 2 } },
    { file: 'dotnet-fail.txt', tool: 'dotnet', code: 1, expect: { outcome: 'fail', firstFailing: 'Kiwi.Parser.Tests.ParserTests.ParsesHeader', failed: 1, passed: 2 } },
    { file: 'dotnet-pass.txt', tool: 'dotnet', code: 0, expect: { outcome: 'pass', failed: 0, passed: 2 } },
    { file: 'xcodebuild-fail.txt', tool: 'xcodebuild', code: 1, expect: { outcome: 'fail', firstFailing: 'ParserTests.testParsesHeader', failed: 1, passed: 1 } },
    { file: 'xcodebuild-pass.txt', tool: 'xcodebuild', code: 0, expect: { outcome: 'pass', failed: 0, passed: 2 } },
    { file: 'swift-testing-fail.txt', tool: 'swift', code: 1, expect: { outcome: 'fail', firstFailing: 'writes nested output()', failed: 1, passed: 2 } },
    { file: 'swift-testing-pass.txt', tool: 'swift', code: 0, expect: { outcome: 'pass', failed: 0, passed: 3 } },
    { file: 'rspec-fail.txt', tool: 'rspec', code: 1, expect: { outcome: 'fail', firstFailing: 'Wren parser reads a nested list', failed: 1, passed: 2 } },
    { file: 'minitest-fail.txt', tool: 'rake', code: 1, expect: { outcome: 'fail', firstFailing: 'BillingTest#test_totals_invoice', failed: 1, passed: 2 } },
    { file: 'minitest-fail.txt', tool: 'ruby', code: 1, expect: { outcome: 'fail', firstFailing: 'BillingTest#test_totals_invoice', failed: 1, passed: 2 } },
    { file: 'phpunit-fail.txt', tool: 'phpunit', code: 1, expect: { outcome: 'fail', firstFailing: 'Tests\\Unit\\BillingTest::test_totals_invoice', failed: 1, passed: 7 } },
    { file: 'phpunit-pass.txt', tool: 'phpunit', code: 0, expect: { outcome: 'pass', passed: 8 } },
    { file: 'pest-fail.txt', tool: 'pest', code: 1, expect: { outcome: 'fail', firstFailing: 'Tests\\Unit\\ParserTest::test_writes_nested_output', failed: 1, passed: 2 } },
    { file: 'mix-fail.txt', tool: 'mix', code: 1, expect: { outcome: 'fail', firstFailing: 'Finch.ParserTest: test writes nested output', failed: 1, passed: 2 } }, // 3 tests, 1 failure
    { file: 'mix-pass.txt', tool: 'mix', code: 0, expect: { outcome: 'pass', failed: 0, passed: 3 } },
    { file: 'ctest-fail.txt', tool: 'ctest', code: 1, expect: { outcome: 'fail', firstFailing: 'wren.parser.nested', failed: 1, passed: 2 } },
    { file: 'dart-fail.txt', tool: 'dart', code: 1, expect: { outcome: 'fail', firstFailing: 'wren parser writes nested output', failed: 1, passed: 2 } },
    { file: 'flutter-fail.txt', tool: 'flutter', code: 1, expect: { outcome: 'fail', firstFailing: 'wren parser writes nested output', failed: 1, passed: 2 } },
    { file: 'crash.txt', tool: 'deno', code: 139, expect: { outcome: 'fail' } },
    { file: 'crash.txt', tool: 'deno', code: null, expect: { outcome: 'unknown' } },
    { file: 'tsc-fail.txt', tool: 'tsc', code: 2, expect: { outcome: 'fail' } },
    { file: 'cargo-build-fail.txt', tool: 'cargo', code: 101, expect: { outcome: 'fail' } },
  ]
  for (const c of cases) {
    test(`${c.file} via ${c.tool} (exit ${c.code})`, () => {
      const r = parseResult(c.tool, fx(c.file), c.code)
      expect(r.outcome).toBe(c.expect.outcome)
      if ('firstFailing' in c.expect) {
        if (c.expect.firstFailing === undefined) expect(r.firstFailing).toBeUndefined()
        else expect(r.firstFailing).toBe(c.expect.firstFailing)
      }
      if (c.expect.failed !== undefined) expect(r.failed).toBe(c.expect.failed)
      if (c.expect.passed !== undefined) expect(r.passed).toBe(c.expect.passed)
    })
  }
  test('a crash before any summary has no name and no counts', () => {
    const r = parseResult('deno', fx('crash.txt'), 139)
    expect(r.firstFailing).toBeUndefined()
    expect(r.failed).toBeUndefined()
    expect(r.passed).toBeUndefined()
  })
  test('build failures carry no test name', () => {
    const r = parseResult('tsc', fx('tsc-fail.txt'), 2)
    expect(r.outcome).toBe('fail')
    expect(r.firstFailing).toBeUndefined()
  })
})

describe('parseResult: null exit codes decide from the summary', () => {
  test('jest summary with failures is fail', () => {
    expect(parseResult('jest', fx('jest-fail-ansi.txt'), null).outcome).toBe('fail')
  })
  test('pytest summary of passes is pass', () => {
    expect(parseResult('pytest', fx('pytest-pass.txt'), null).outcome).toBe('pass')
  })
  test('cargo ok summary is pass', () => {
    expect(parseResult('cargo', fx('cargo-pass.txt'), null).outcome).toBe('pass')
  })
  test('cargo FAILED summary is fail', () => {
    expect(parseResult('cargo', fx('cargo-fail.txt'), null).outcome).toBe('fail')
  })
  test('gradle BUILD SUCCESSFUL is pass', () => {
    expect(parseResult('gradle', fx('gradle-pass.txt'), null).outcome).toBe('pass')
  })
  test('gradle BUILD FAILED is fail', () => {
    expect(parseResult('gradle', fx('gradle-fail.txt'), null).outcome).toBe('fail')
  })
  test('maven BUILD SUCCESS is pass', () => {
    const out = '[INFO] Tests run: 8, Failures: 0, Errors: 0, Skipped: 0\n[INFO] BUILD SUCCESS\n'
    expect(parseResult('mvn', out, null).outcome).toBe('pass')
  })
  test('rspec zero failures is pass', () => {
    expect(parseResult('rspec', '3 examples, 0 failures\n', null).outcome).toBe('pass')
  })
  test('dart all passed is pass', () => {
    expect(parseResult('dart', fx('dart-pass.txt'), null).outcome).toBe('pass')
  })
  test('empty output with null exit is unknown', () => {
    expect(parseResult('jest', '', null)).toEqual({ outcome: 'unknown' })
  })
  test('partial output with no summary is unknown', () => {
    const r = parseResult('pytest', 'collected 47 items\ntests/test_billing.py ..', null)
    expect(r.outcome).toBe('unknown')
  })
})

describe('parseResult: exit code precedence', () => {
  const text = fx('pytest-fail.txt')
  test('exit 0 overrides failure text (the code is authoritative)', () => {
    const r = parseResult('pytest', text, 0)
    expect(r.outcome).toBe('pass')
  })
  test('a non-zero code marks fail even on a passing summary', () => {
    const r = parseResult('pytest', fx('pytest-pass.txt'), 5)
    expect(r.outcome).toBe('fail')
  })
  test('firstFailing only appears on fail', () => {
    expect(parseResult('pytest', text, 0).firstFailing).toBeUndefined()
    expect(parseResult('pytest', text, 1).firstFailing).toBeDefined()
  })
  test('counts are read regardless of exit code', () => {
    expect(parseResult('pytest', text, 0).passed).toBe(45)
  })
})

/* ---------------------------------------------------------------- *
 * parseResult — the 64 KB / 192 KB window
 * ---------------------------------------------------------------- */

describe('parseResult: long output window', () => {
  const filler = (n: number) => 'filler line that no parser should care about\n'.repeat(n)
  test('a summary in the last 192 KB is read', () => {
    const out = filler(3000) + 'Tests:       2 failed, 47 passed, 49 total\n'
    const r = parseResult('jest', out, 1)
    expect(r.failed).toBe(2)
    expect(r.passed).toBe(47)
  })
  test('a failure name in the head window is read', () => {
    const out = '  ● Calculator › totals an invoice\n' + filler(20000)
    const r = parseResult('jest', out, 1)
    expect(r.firstFailing).toBe('Calculator › totals an invoice')
  })
  test('a failure name far outside both windows is lost, the tail still decides the outcome', () => {
    // head covers the first 64 KB, tail the last 192 KB; this name sits at ~100 KB
    const out = filler(2600) + '  ● Calculator › totals an invoice\n' + filler(8000) + 'Tests:       1 failed, 2 passed\n'
    const r = parseResult('jest', out, null)
    expect(r.firstFailing).toBeUndefined()
    expect(r.outcome).toBe('fail')
    expect(r.failed).toBe(1)
  })
  test('output just under the limit is read whole', () => {
    const out = filler(3000) + 'FAILED tests/test_billing.py::TestBilling::test_totals_invoice - assert 4199 == 4200\n'
    expect(parseResult('pytest', out, 1).firstFailing).toBe('tests/test_billing.py::TestBilling::test_totals_invoice')
  })
})

/* ---------------------------------------------------------------- *
 * record
 * ---------------------------------------------------------------- */

describe('record', () => {
  test('appends and returns a new history', () => {
    const h: Record<string, Array<{ ms: number; outcome: string }>> = {}
    const a = record(h, 'pytest', { ms: 1200, outcome: 'pass' })
    expect(a['pytest']).toEqual([{ ms: 1200, outcome: 'pass' }])
    expect(a).not.toBe(h)
  })
  test('never mutates the input', () => {
    const h = { 'cargo test': [{ ms: 900, outcome: 'pass' }] }
    const frozen = JSON.stringify(h)
    record(h, 'cargo test', { ms: 1000, outcome: 'pass' })
    record(h, 'pytest', { ms: 10, outcome: 'fail' })
    expect(JSON.stringify(h)).toBe(frozen)
  })
  test('the previous array is copied, not extended', () => {
    const arr = [{ ms: 1, outcome: 'pass' } as const]
    const h = { pytest: [...arr] }
    const a = record(h, 'pytest', { ms: 2, outcome: 'pass' })
    expect(a['pytest']).not.toBe(h['pytest'])
    expect(h['pytest'].length).toBe(1)
    expect(a['pytest'].length).toBe(2)
  })
  test('caps at 20 by default', () => {
    let h: Record<string, Array<{ ms: number; outcome: string }>> = {}
    for (let i = 0; i < 30; i++) h = record(h, 'jest', { ms: i, outcome: 'pass' })
    expect(h['jest'].length).toBe(20)
    expect(h['jest'][0].ms).toBe(10)
    expect(h['jest'][19].ms).toBe(29)
  })
  test('honours a custom cap', () => {
    let h: Record<string, Array<{ ms: number; outcome: string }>> = {}
    for (let i = 0; i < 10; i++) h = record(h, 'go test ./...', { ms: i, outcome: 'pass' }, 3)
    expect(h['go test ./...'].length).toBe(3)
  })
  test('other keys are carried over untouched', () => {
    const h = { pytest: [{ ms: 5, outcome: 'pass' }], jest: [{ ms: 6, outcome: 'fail' }] }
    const a = record(h, 'pytest', { ms: 7, outcome: 'pass' })
    expect(a['jest']).toBe(h['jest'])
    expect(a['pytest'].length).toBe(2)
  })
  test('empty history works', () => {
    const a = record({}, 'mix test', { ms: 3000, outcome: 'unknown' })
    expect(a['mix test']).toEqual([{ ms: 3000, outcome: 'unknown' }])
  })
})

/* ---------------------------------------------------------------- *
 * judge — robust statistics
 * ---------------------------------------------------------------- */

describe('judge', () => {
  const hist = (times: number[], outcome: 'pass' | 'fail' | 'unknown' = 'pass') =>
    ({ pytest: times.map((ms) => ({ ms, outcome })) })

  test('fewer than 3 passing samples says nothing', () => {
    expect(judge(hist([5000, 5000]), 'pytest', 60000)).toEqual({ slow: false })
    expect(judge(hist([]), 'pytest', 60000)).toEqual({ slow: false })
    expect(judge(hist([1]), 'pytest', 60000)).toEqual({ slow: false })
  })
  test('a clean suite at 3x the median is slow', () => {
    const h = hist([10000, 10000, 10000])
    expect(judge(h, 'pytest', 30000)).toEqual({ slow: true, usualMs: 10000, ratio: 3 })
  })
  test('median of 4999 ms is below the floor', () => {
    const h = hist([4999, 4999, 4999])
    const r = judge(h, 'pytest', 60000)
    expect(r.slow).toBe(false)
    expect(r.usualMs).toBe(4999)
    expect(r.ratio).toBe(12) // still reported: the suite is just too fast to judge
  })
  test('exactly twice the median is slow when the spread is tight', () => {
    const h = hist([10000, 10000, 10000])
    expect(judge(h, 'pytest', 20000).slow).toBe(true)
  })
  test('a noisy suite does not cry wolf at twice the median', () => {
    const h = hist([6000, 10000, 14000]) // median 10000, MAD 4000
    const r = judge(h, 'pytest', 20000)
    expect(r.slow).toBe(false)
    expect(r.ratio).toBe(2)
  })
  test('a noisy suite needs m + 4*max(d, 0.05m)', () => {
    const h = hist([6000, 10000, 14000]) // threshold 10000 + 16000 = 26000
    expect(judge(h, 'pytest', 25999).slow).toBe(false)
    expect(judge(h, 'pytest', 26000).slow).toBe(true)
  })
  test('the 5% floor of spread applies to a suspiciously clean suite', () => {
    const h = hist([10000, 10000, 10001]) // d = 0? median 10001? -> median 10001? sorted [10000,10001,10001]? no:
    const h2 = hist([9999, 10000, 10001]) // median 10000, MAD 1 -> floor 500 -> threshold 12000
    expect(judge(h2, 'pytest', 19999).slow).toBe(false)
    expect(judge(h2, 'pytest', 20000).slow).toBe(true)
    expect(h).toBeTruthy()
  })
  test('failed and unknown samples are ignored', () => {
    const h = {
      pytest: [
        { ms: 10000, outcome: 'fail' },
        { ms: 10000, outcome: 'unknown' },
        { ms: 10000, outcome: 'pass' },
        { ms: 10000, outcome: 'pass' },
      ],
    }
    expect(judge(h, 'pytest', 30000)).toEqual({ slow: false })
  })
  test('a slow run against an unknown key is not slow', () => {
    expect(judge(hist([10000, 10000, 10000]), 'cargo test', 100000)).toEqual({ slow: false })
  })
  test('ratio is rounded to two decimals', () => {
    const h = hist([3, 7, 3]) // median 3
    const r = judge(h, 'pytest', 4)
    expect(r.ratio).toBe(1.33)
  })
  test('usualMs is the median rounded', () => {
    const h = hist([5000.4, 5000.4, 5000.4])
    expect(judge(h, 'pytest', 20000).usualMs).toBe(5000)
  })
  test('an even count averages the two middle samples', () => {
    const h = hist([8000, 10000, 12000, 20000]) // median (10000+12000)/2 = 11000
    const r = judge(h, 'pytest', 22000)
    expect(r.usualMs).toBe(11000)
    expect(r.slow).toBe(true) // 2x exactly, spread small enough
  })
  test('only the passing history of the same key is used', () => {
    const h = { pytest: hist([6000, 6000, 6000]).pytest as any, 'cargo test': [{ ms: 99999, outcome: 'pass' }] }
    const r = judge(h, 'pytest', 11999) // below twice 6000, and no other key's time leaks in
    expect(r.slow).toBe(false)
    expect(judge(h, 'cargo test', 11999)).toEqual({ slow: false })
  })
})

/* ---------------------------------------------------------------- *
 * never throw — robustness and fuzz
 * ---------------------------------------------------------------- */

describe('never throws', () => {
  const weird = [
    '',
    ' ',
    '\n\n\n',
    '\u0000\u0001\u0002',
    '🎉 add 你好 😀',
    String.fromCharCode(0xd800), // lone surrogate
    String.fromCharCode(0xdfff),
    'a'.repeat(500000),
    '-'.repeat(10000),
    '\u001b]0;title\u0007'.repeat(1000),
  ]
  for (const [i, s] of weird.entries()) {
    test(`recognize weird input #${i}`, () => {
      expect(() => recognize(s)).not.toThrow()
    })
    test(`parseResult weird input #${i}`, () => {
      expect(() => parseResult('jest', s, i % 3 === 0 ? null : i % 3 === 1 ? 1 : 0)).not.toThrow()
    })
  }
  test('binary junk never throws and yields a valid result', () => {
    const r = parseResult('pytest', fx('binary-junk.bin'), 1)
    expect(['pass', 'fail', 'unknown']).toContain(r.outcome)
  })
  test('NaN exit code behaves like a failing exit', () => {
    const r = parseResult('pytest', '3 passed in 0.1s', Number.NaN)
    expect(r.outcome).toBe('fail')
  })
  test('NaN sample times are ignored by judge', () => {
    const h = { pytest: [{ ms: Number.NaN, outcome: 'pass' }, { ms: 10000, outcome: 'pass' }, { ms: 10000, outcome: 'pass' }] }
    expect(() => judge(h, 'pytest', 50000)).not.toThrow()
    expect(judge(h, 'pytest', 50000).slow).toBe(false)
  })
  test('huge output parses in well under 50 ms', () => {
    const out = fx('jest-pass-huge.txt')
    expect(out.length).toBeGreaterThan(2_000_000)
    // best of three, so scheduler noise does not fake a budget breach
    let best = Number.POSITIVE_INFINITY
    let r: ReturnType<typeof parseResult> = { outcome: 'unknown' }
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      r = parseResult('jest', out, 0)
      best = Math.min(best, performance.now() - t0)
    }
    expect(r.outcome).toBe('pass')
    expect(r.passed).toBe(30400)
    expect(best).toBeLessThan(50)
  })
})

describe('fuzz (fixed seed)', () => {
  // mulberry32: small, deterministic PRNG
  function rng(seed: number) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const CODE_POINTS = [0x0a, 0x20, 0x41, 0x2d, 0x3e, 0x27, 0x22, 0x26, 0x7c, 0x3b, 0xd800, 0xdfff, 0x1f600, 0x4f60, 0x597d, 0x9, 0x1b, 0x0, 0x2028, 0x2029]
  function randomString(rand: () => number, maxLen: number): string {
    const n = Math.floor(rand() * maxLen)
    let s = ''
    for (let i = 0; i < n; i++) {
      const cp = CODE_POINTS[Math.floor(rand() * CODE_POINTS.length)]
      s += String.fromCharCode(cp)
    }
    return s
  }
  const TOOLS = ['jest', 'pytest', 'cargo', 'go', 'gradle', 'mvn', 'xcodebuild', 'swift', 'rspec', 'mix', 'ctest', 'dart', 'npm', '', 'unknown-tool']
  test('recognize: 2000 pseudo-random inputs', () => {
    const rand = rng(0xcafe)
    for (let i = 0; i < 2000; i++) {
      const s = randomString(rand, 400)
      expect(() => recognize(s)).not.toThrow()
      const r = recognize(s)
      if (r !== null) {
        expect(['test', 'build']).toContain(r.kind)
        expect(typeof r.tool).toBe('string')
        expect(typeof r.key).toBe('string')
        expect(typeof r.filtered).toBe('boolean')
      }
    }
  })
  test('parseResult: 2000 pseudo-random inputs', () => {
    const rand = rng(0xbeef)
    for (let i = 0; i < 2000; i++) {
      const tool = TOOLS[Math.floor(rand() * TOOLS.length)]
      const out = randomString(rand, 5000)
      const code = [null, 0, 1, 127, 255][Math.floor(rand() * 5)]
      expect(() => parseResult(tool, out, code)).not.toThrow()
      const r = parseResult(tool, out, code)
      expect(['pass', 'fail', 'unknown']).toContain(r.outcome)
    }
  })
  test('record: 2000 pseudo-random inputs', () => {
    const rand = rng(0xf00d)
    let h: Record<string, Array<{ ms: number; outcome: string }>> = {}
    const snap = JSON.stringify(h)
    for (let i = 0; i < 2000; i++) {
      const key = randomString(rand, 30)
      const sample = { ms: rand() * 100000 - 50000, outcome: (['pass', 'fail', 'unknown'] as const)[Math.floor(rand() * 3)] }
      const cap = Math.floor(rand() * 50) - 5
      expect(() => record(h, key, sample, cap)).not.toThrow()
      h = record(h, key, sample)
    }
    expect(JSON.stringify({})).toBe(snap) // the initial history object stayed empty
  })
  test('judge: 2000 pseudo-random inputs', () => {
    const rand = rng(0x5eed)
    for (let i = 0; i < 2000; i++) {
      const key = randomString(rand, 10)
      const times: Array<{ ms: number; outcome: string }> = []
      for (let j = 0; j < Math.floor(rand() * 8); j++) {
        times.push({ ms: rand() * 200000, outcome: (['pass', 'fail', 'unknown'] as const)[Math.floor(rand() * 3)] })
      }
      const h: Record<string, Array<{ ms: number; outcome: string }>> = { [key]: times }
      expect(() => judge(h, key, rand() * 400000 - 100000)).not.toThrow()
      const r = judge(h, key, rand() * 400000)
      expect(typeof r.slow).toBe('boolean')
    }
  })
})

/* ---------------------------------------------------------------- *
 * red team — unusual but real commands people actually type
 * ---------------------------------------------------------------- */

describe('red team: recognize', () => {
  const cases: Array<[string, string | null, string | null]> = [
    // launchers on top of launchers, env noise, redirects and pipelines
    ['CI=true NODE_OPTIONS=--max-old-space-size=8192 npx jest', 'test', 'jest'],
    ['FLASK_ENV=test poetry run pytest -q', 'test', 'pytest'],
    ['git bisect run npm test', 'test', 'npm'],
    ['git bisect run make test', 'test', 'make'],
    ['docker compose run --rm api npx vitest run', 'test', 'vitest'],
    ['docker run --rm -e CI=1 shop/api:latest npm test', 'test', 'npm'],
    ['docker exec kiwi_web make test', 'test', 'make'],
    ['pytest 2>&1 | tee /tmp/pytest.log', 'test', 'pytest'],
    ['mocha --reporter spec > results.txt', 'test', 'mocha'],
    ['cargo test -- --exact wren::parser 2>&1', 'test', 'cargo'],
    ['nohup vitest run &', 'test', 'vitest'],
    ['cd web && npm run build && npm test', 'build', 'npm'],
    // package managers with workspace/filter flags and odd scripts
    ['pnpm --filter @shop/api test', 'test', 'pnpm'],
    ['yarn workspace @shop/api test', 'test', 'yarn'],
    ['yarn workspace @shop/api run build', 'build', 'yarn'],
    ['npm --workspace api test', 'test', 'npm'],
    ['npm run test -- --runInBand', 'test', 'npm'],
    ['npm test -- --grep wren', 'test', 'npm'],
    ['pnpm -r run test', 'test', 'pnpm'],
    ['npm run-script test:unit', 'test', 'npm'],
    // toolchains, toolchain files, nightly everything
    ['cargo +nightly test', 'test', 'cargo'],
    ['cargo +stable build', 'build', 'cargo'],
    ['cargo test --no-fail-fast', 'test', 'cargo'],
    ['cargo nextest run -E "test(computes)"', 'test', 'nextest'],
    ['rustup run stable cargo test', 'test', 'cargo'],
    // quoting, subcommand order, unusual flags
    ['node --test-reporter tap --test', 'test', 'node'],
    ['xcodebuild -project Kiwi.xcodeproj -scheme Kiwi -destination "platform=iOS Simulator,name=iPad" test', 'test', 'xcodebuild'],
    ['swift test --skip-build', 'test', 'swift'],
    ['sbt "testOnly wren.ParserSpec"', 'test', 'sbt'],
    ['gradle :api:test', 'test', 'gradle'],
    ['./gradlew :app:check --tests "*.ParserTest"', 'test', 'gradle'],
    ['mvn -pl api test', 'test', 'mvn'],
    ['mvn test -Dtest=ParserTest', 'test', 'mvn'],
    ['tox -e py312', 'test', 'tox'],
    ['make test TESTS=test_parser', 'test', 'make'],
    ['cmake --build . --config Release', 'build', 'cmake'],
    ['zig build test --summary none', 'test', 'zig'],
    ['deno task build', 'build', 'deno'],
    ['deno test --allow-read', 'test', 'deno'],
    ['php -d memory_limit=1G vendor/bin/phpunit tests/Unit', 'test', 'phpunit'],
    ['php vendor/bin/pest tests/Unit --group=parser', 'test', 'pest'],
    ['flutter test --update-goldens', 'test', 'flutter'],
    ['rails test test/models/user_test.rb', 'test', 'rails'],
    ['rake test TESTOPTS="-v"', 'test', 'rake'],
    ['npx turbo run test --filter=web', 'test', 'turbo'],
    ['npx tsc --noEmit', 'build', 'tsc'],
    ['bunx tsup src/index.ts', 'build', 'tsup'],
    // things that must stay null
    ['npm run dev:test', null, null], // not a test: prefix (checked separately below)
    ['npx prisma migrate dev', null, null],
    ['npx husky install', null, null],
    ['docker build -t shop/api .', null, null],
    ['watch npm test', null, null],
    ['echo npm test', null, null],
    ['alias zt="vitest run"', null, null],
    ['npm pkg set scripts.test=jest', null, null],
    ['curl -fsSL https://example.com/install.sh | bash', null, null],
    ['python -m http.server', null, null],
    ['python -m venv .venv', null, null],
    ['go mod tidy', null, null],
    ['gradle wrapper', null, null],
    ['cargo install cargo-nextest', null, null],
    ['mix test.env', null, null],
    ['dart format .', null, null],
    ['flutter analyze', null, null],
    ['bundle install', null, null],
    ['rspec --init', null, null],
    ['npx eslint .', null, null],
    ['npx prettier --check .', null, null],
    ['node --watch server.js', null, null],
    ['vitest --watch run', null, null],
  ]
  for (const [cmd, kind, tool] of cases) {
    test(`red team ${JSON.stringify(cmd)}`, () => {
      const r = recognize(cmd)
      if (kind === null) expect(r).toBeNull()
      else {
        expect(r).not.toBeNull()
        expect(r!.kind).toBe(kind)
        expect(r!.tool).toBe(tool)
      }
    })
  }
  test('npm run test:dev is a test (test: prefix)', () => {
    expect(recognize('npm run test:dev')!.kind).toBe('test')
  })
  test('aliases are not resolved and stay null', () => {
    expect(recognize('zt')).toBeNull()
  })
  test('rustup run unwraps to the managed toolchain command', () => {
    // rustup is another launcher: run <toolchain> <cmd>
    expect(recognize('rustup run stable cargo test')!.tool).toBe('cargo')
  })
})

describe('red team: parseResult', () => {
  test('pytest with xdist workers summary', () => {
    const out = '==================================== test session starts ====================================\ncreated: 8/8 workers\n8 workers [47 items]\n.........F......................................                                    [100%]\n============= 2 failed, 45 passed, 1 skipped, 1 xfailed in 12.31s ============='
    const r = parseResult('pytest', out, 1)
    expect(r.failed).toBe(2)
    expect(r.passed).toBe(45)
    expect(r.outcome).toBe('fail')
  })
  test('pytest "no tests ran" with null exit stays unknown', () => {
    const r = parseResult('pytest', 'no tests ran in 0.01s', null)
    expect(r.outcome).toBe('unknown')
  })
  test('jest with a wrapped failure title', () => {
    const out = '  ● Shop orders › applies a very long coupon code that spans\n      two lines\nTests:       1 failed, 0 passed, 1 total'
    const r = parseResult('jest', out, 1)
    expect(r.firstFailing).toBe('Shop orders › applies a very long coupon code that spans')
  })
  test('vitest with only the tree marker, no FAIL block', () => {
    const out = ' ❯ src/writer.test.ts (2 tests | 1 failed)\n × writer > flushes the buffer\nTests  1 failed | 1 passed'
    const r = parseResult('vitest', out, 1)
    expect(r.firstFailing).toBe('writer > flushes the buffer')
  })
  test('mocha with pending and zero passing', () => {
    const out = '  1 pending\n  0 passing (1ms)\n  1 failing\n\n  1) Wren parser\n       writes nested output:\n'
    const r = parseResult('mocha', out, 1)
    expect(r.failed).toBe(1)
    expect(r.passed).toBe(0)
    expect(r.firstFailing).toBe('Wren parser writes nested output')
  })
  test('TAP bailing out', () => {
    const out = 'TAP version 13\nnot ok 1 - wren parses\nBail out! system error\n1..1'
    const r = parseResult('tap', out, 1)
    expect(r.firstFailing).toBe('wren parses')
  })
  test('TAP with zero tests', () => {
    const out = 'TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0'
    const r = parseResult('tap', out, 0)
    expect(r.outcome).toBe('pass')
  })
  test('cargo with several binaries is summed', () => {
    const out = ['unit', 'integration', 'doc'].map((n) => `     Running ${n}\ntest result: ok. 10 passed; 0 failed; 0 ignored`).join('\n\n')
    const r = parseResult('cargo', out, 0)
    expect(r.passed).toBe(30)
    expect(r.failed).toBe(0)
  })
  test('cargo with ANSI colours around the FAILED line', () => {
    const out = '\u001b[31mtest\u001b[0m orders::tests::computes_totals ... \u001b[31;1mFAILED\u001b[0m\ntest result: FAILED. 0 passed; 1 failed;'
    const r = parseResult('cargo', out, 1)
    expect(r.firstFailing).toBe('orders::tests::computes_totals')
  })
  test('go with CRLF line endings', () => {
    const out = '=== RUN   TestParser\r\n--- FAIL: TestParser (0.00s)\r\nFAIL\r\nFAIL\tgithub.com/user/lark\t0.1s\r\n'
    const r = parseResult('go', out, 1)
    expect(r.firstFailing).toBe('TestParser')
    expect(r.outcome).toBe('fail')
  })
  test('gradle with a failing task and no test listing', () => {
    const out = '> Task :api:test FAILED\n\nFAILURE: Build failed with an exception.\nBUILD FAILED in 3s'
    const r = parseResult('gradle', out, 1)
    expect(r.outcome).toBe('fail')
    expect(r.firstFailing).toBeUndefined()
  })
  test('maven multi-module Results blocks are summed once per module', () => {
    const out = [
      '[INFO] Running com.shop.api.ApiTest\n[ERROR] Tests run: 4, Failures: 1, Errors: 0, Skipped: 0',
      '[INFO] Results:\n[ERROR] Tests run: 4, Failures: 1, Errors: 0, Skipped: 0',
      '[INFO] Running com.shop.web.WebTest\n[INFO] Tests run: 6, Failures: 0, Errors: 0, Skipped: 0',
      '[INFO] Results:\n[INFO] Tests run: 6, Failures: 0, Errors: 0, Skipped: 0',
    ].join('\n')
    const r = parseResult('mvn', out, 1)
    expect(r.failed).toBe(1)
    expect(r.passed).toBe(9)
  })
  test('dotnet legacy summary', () => {
    const out = 'Total tests: 49. Passed: 47. Failed: 2. Skipped: 0.'
    const r = parseResult('dotnet', out, 1)
    expect(r.failed).toBe(2)
    expect(r.passed).toBe(47)
  })
  test('xcodebuild parallel destination noise', () => {
    const out = `Test session results, code coverage, and logs:
\t/Users/user/Library/Developer/Xcode/DerivedData/Kiwi-*/Logs/Test/*.xcresult
Test Case '-[KiwiTests.ParserTests testParsesHeader]' failed (0.021 seconds).
Executed 5 tests, with 2 failures (0 expectations) in 0.9 (1.1) seconds
** TEST FAILED **`
    const r = parseResult('xcodebuild', out, 1)
    expect(r.firstFailing).toBe('ParserTests.testParsesHeader')
    expect(r.failed).toBe(2)
    expect(r.passed).toBe(3)
  })
  test('rspec with pending', () => {
    const out = '5 examples, 2 failures, 1 pending\n\nrspec ./spec/wren/parser_spec.rb:12 # Wren parser reads a nested list'
    const r = parseResult('rspec', out, 1)
    expect(r.failed).toBe(2)
    expect(r.passed).toBe(3)
    expect(r.firstFailing).toBe('Wren parser reads a nested list')
  })
  test('playwright with flaky tests', () => {
    const out = '  ✓  1 [chromium] › shop.spec.ts:11:5 › cart › adds an item\n\n  2 flaky\n  1 failed\n  9 passed (1.0m)\n\n  1) [webkit] › shop.spec.ts:25:5 › checkout › totals the basket\n'
    const r = parseResult('playwright', out, 1)
    expect(r.failed).toBe(1)
    expect(r.passed).toBe(9)
    expect(r.firstFailing).toBe('checkout › totals the basket')
  })
  test('deno with file:// URLs', () => {
    const out = 'ERRORS\n\ncreates a user => file:///home/user/src/api/users_test.ts:18:5\n\nerror: Test failed'
    const r = parseResult('deno', out, 1)
    expect(r.firstFailing).toBe('creates a user')
  })
  test('bun test failure with file prefix', () => {
    const out = 'src/calc.test.ts:\n(fail) Calculator > multiplies by zero\n 1 fail\n 87 pass'
    const r = parseResult('bun', out, 1)
    expect(r.firstFailing).toBe('Calculator > multiplies by zero')
  })
  test('empty output with a failing exit code', () => {
    expect(parseResult('jest', '', 1)).toEqual({ outcome: 'fail' })
  })
  test('empty output with exit zero', () => {
    expect(parseResult('jest', '', 0)).toEqual({ outcome: 'pass' })
  })
  test('karma success total', () => {
    const out = 'Chrome 129.0.0.0 (Mac OS): Executed 5 of 5 SUCCESS (0.3 secs)\nTOTAL: 5 SUCCESS'
    const r = parseResult('karma', out, 0)
    expect(r.outcome).toBe('pass')
  })
  test('unittest with errors only', () => {
    const out = 'test_fetch (test_users.UserTest.test_fetch) ... ERROR\n\n======================================================================\nERROR: test_fetch (test_users.UserTest.test_fetch)\n----------------------------------------------------------------------\nTraceback (most recent call last):\n  File "t.py", line 9, in test_fetch\n    raise RuntimeError("db")\nRuntimeError: db\n\n----------------------------------------------------------------------\nRan 1 test in 0.001s\n\nFAILED (errors=1)'
    const r = parseResult('unittest', out, 1)
    expect(r.firstFailing).toBe('test_users.UserTest.test_fetch')
    expect(r.failed).toBe(1)
    expect(r.passed).toBe(0)
  })
  test('phpunit with warnings-only header', () => {
    const out = 'WARNINGS!\nTests: 8, Assertions: 31, Warnings: 1, Failures: 0.\n'
    const r = parseResult('phpunit', out, null)
    expect(r.outcome).toBe('pass')
    expect(r.passed).toBe(8)
  })
  test('nextest with the stats-breakdown summary', () => {
    const out = '        FAIL [  0.500s] finch orders::tests::computes_totals\nStats breakdown: 12 tests run: 11 passed, 1 failed'
    const r = parseResult('nextest', out, 1)
    expect(r.firstFailing).toBe('orders::tests::computes_totals')
    expect(r.failed).toBe(1)
    expect(r.passed).toBe(11)
  })
  test('npm test running jest underneath (wrapper scan)', () => {
    const out = '> kiwi@1.0.0 test\n> jest\n\nPASS src/calc.test.ts\n  ● Calculator › totals an invoice\nTests:       2 failed, 47 passed, 49 total'
    const r = parseResult('npm', out, 1)
    expect(r.outcome).toBe('fail')
    expect(r.firstFailing).toBe('Calculator › totals an invoice')
    expect(r.failed).toBe(2)
  })
  test('make with no test output', () => {
    const r = parseResult('make', 'gcc -c parser.c -o parser.o\nar rcs libwren.a parser.o', 0)
    expect(r.outcome).toBe('pass')
  })
  test('a failing build through npm run build', () => {
    const out = '> kiwi@1.0.0 build\n> tsc\n\nsrc/orders.ts:12:7 - error TS2322: Type \'number\' is not assignable to type \'string\'.'
    const r = parseResult('npm', out, 2)
    expect(r.outcome).toBe('fail')
  })
})

/* ---------------------------------------------------------------- *
 * last edges from the brief, spelled out one by one
 * ---------------------------------------------------------------- */

describe('brief edges', () => {
  test('compound timeout durations still unwrap', () => {
    expect(recognize('timeout 2h30m make test')).toEqual({ kind: 'test', tool: 'make', key: 'make test', filtered: false })
    expect(recognize('timeout 90s vitest run')!.key).toBe('vitest run')
  })
  test('patch-level python interpreters', () => {
    expect(recognize('python3.12 -m pytest')!.tool).toBe('pytest')
    expect(recognize('python3.13 -m unittest')!.tool).toBe('unittest')
  })
  test('python -m pip wheel is a build', () => {
    expect(recognize('python -m pip wheel')!.kind).toBe('build')
  })
  test('deno task scripts classify like npm scripts', () => {
    expect(recognize('deno task test')!.kind).toBe('test')
    expect(recognize('deno task build')!.kind).toBe('build')
    expect(recognize('deno task dev')).toBeNull()
  })
  test('lerna run test: the brief lists lerna run under build, we classify by script name', () => {
    // The brief marks `lerna run <script>` (build); `lerna run build` is a build
    // as specified, and `lerna run test` would be semantically wrong as a
    // build, so the script name decides (documented reading).
    expect(recognize('lerna run build')!.kind).toBe('build')
    expect(recognize('lerna run test')!.kind).toBe('test')
    expect(recognize('lerna run lint')).toBeNull()
  })
  test('unittest discover narrows with -s', () => {
    expect(recognize('python -m unittest discover')!.filtered).toBe(false)
    expect(recognize('python -m unittest discover -s tests/sub')!.filtered).toBe(true)
  })
  test('cargo test accepts a bare name filter', () => {
    expect(recognize('cargo test parser::')!.filtered).toBe(true)
    expect(recognize('cargo test')!.filtered).toBe(false)
  })
  test('record with cap 0 keeps nothing', () => {
    const a = record({}, 'pytest', { ms: 10, outcome: 'pass' }, 0)
    expect(a['pytest']).toEqual([])
  })
  test('judge at exactly the 5000 ms floor', () => {
    const h = { pytest: [{ ms: 5000, outcome: 'pass' }, { ms: 5000, outcome: 'pass' }, { ms: 5000, outcome: 'pass' }] }
    const r = judge(h, 'pytest', 10000)
    expect(r.slow).toBe(true)
    expect(r.usualMs).toBe(5000)
    expect(r.ratio).toBe(2)
  })
  test('judge: a single outlier in the history widens the spread', () => {
    const h = { jest: [{ ms: 10000, outcome: 'pass' }, { ms: 10000, outcome: 'pass' }, { ms: 40000, outcome: 'pass' }] }
    // median 10000, MAD 0 -> floor 500 -> needs >= 12000 AND >= 20000
    expect(judge(h, 'jest', 19999).slow).toBe(false)
    expect(judge(h, 'jest', 20000).slow).toBe(true)
  })
  test('the API surface is exactly the one in the brief', async () => {
    const mod = await import('../../../plugin/hooks/algo/runs')
    expect(Object.keys(mod).sort()).toEqual(['judge', 'parseResult', 'record', 'recognize'].sort())
  })
})

/* ---------------------------------------------------------------- *
 * repair round — behaviours the acceptance run found wrong
 * ---------------------------------------------------------------- */

describe("repair: timeout as a wrapper", () => {
  const cases: Array<[string, string, string, string]> = [
    ["timeout 600 npm test", "npm", "test", "npm test"],
    ["timeout 30 bun test", "bun", "test", "bun test"],
    ["timeout 1.5h vitest run", "vitest", "test", "vitest run"],
    ["timeout 0.5s jest", "jest", "test", "jest"],
    ["timeout 2h30m pnpm test", "pnpm", "test", "pnpm test"],
    ["timeout -s KILL 30 npm test", "npm", "test", "npm test"],
    ["timeout --signal=KILL 5m make test", "make", "test", "make test"],
    ["timeout --signal KILL 5m make check", "make", "test", "make check"],
    ["timeout -k 10 --foreground 600 vitest run", "vitest", "test", "vitest run"],
    ["timeout --kill-after=1m --preserve-status 30 go test ./...", "go", "test", "go test ./..."],
    ["timeout -v 60 cargo test", "cargo", "test", "cargo test"],
    ["timeout --foreground 10s deno test", "deno", "test", "deno test"],
    ["sudo timeout 600 npx vitest run", "vitest", "test", "vitest run"],
  ]
  for (const [cmd, tool, kind, key] of cases) {
    test(`timeout unwrapped: ${JSON.stringify(cmd)}`, () => {
      const r = recognize(cmd)
      expect(r).not.toBeNull()
      expect(r!.tool).toBe(tool)
      expect(r!.kind).toBe(kind)
      expect(r!.key).toBe(key)
      expect(r!.filtered).toBe(false)
    })
  }
  test("timeout with a filter keeps the filter in the key", () => {
    expect(recognize("timeout 600 npm test -- -t parse")).toEqual({
      kind: "test", tool: "npm", key: "npm test -- -t parse", filtered: true,
    })
  })
})

describe("repair: only subset flags make a run filtered", () => {
  const notFiltered: string[] = [
    "vitest run --coverage --reporter dot",
    "vitest run --reporter dot --coverage",
    "vitest run --coverage.enabled --reporter=dot",
    "jest --coverage --reporter=dot",
    "jest --verbose --colors",
    "mocha --reporter dot --colors",
    "mocha --reporter=nyan",
    "npm test -- --coverage --reporter dot",
    "npm test -- --colors",
    "npm test -- --verbose",
    "npm test -- --watch=false",
    "pnpm test -- --coverage",
    "pnpm test -- --reporter=json --outputFile=out.json",
    "yarn test --coverage",
    "bun test --coverage",
    "pytest --cov --verbose",
    "flutter test --coverage",
    "dart test --coverage",
  ]
  for (const cmd of notFiltered) {
    test(`${JSON.stringify(cmd)} is not filtered`, () => {
      const r = recognize(cmd)
      expect(r).not.toBeNull()
      expect(r!.filtered).toBe(false)
    })
  }
  const filtered: string[] = [
    "npm test -- -t parse",
    "npm test -- --grep wren",
    "npm test -- --testNamePattern totals",
    "npm test -- -k parse",
    "npm test -- src/orders/billing.test.js",
    "pnpm test -- -t parse",
    "pnpm test -- -k wren",
    "pnpm test -- src/writer.test.ts",
    "yarn test -t parse",
    "yarn test --grep wren",
    "yarn test src/calc.test.ts",
    "bun test -t parse",
    "bun test src/calc.test.ts",
    "bun test -k totals",
    "flutter test --coverage test/widget_test.dart",
    "jest --testPathPattern=orders",
    "jest --testPathPattern src/orders",
  ]
  for (const cmd of filtered) {
    test(`${JSON.stringify(cmd)} is filtered`, () => {
      const r = recognize(cmd)
      expect(r).not.toBeNull()
      expect(r!.filtered).toBe(true)
    })
  }
  test("watch-off flags are runs and never filter", () => {
    expect(recognize("jest --watch=false")).toEqual({ kind: "test", tool: "jest", key: "jest --watch=false", filtered: false })
    expect(recognize("jest --watchAll=false --coverage")).not.toBeNull()
    expect(recognize("jest --watchAll=false --coverage")!.filtered).toBe(false)
    expect(recognize("vitest run --no-watch")).not.toBeNull()
    expect(recognize("vitest run --no-watch")!.filtered).toBe(false)
    expect(recognize("vitest --watch=false")).toEqual({ kind: "test", tool: "vitest", key: "vitest --watch=false", filtered: false })
  })
  test("the filter after -- stays in the history key", () => {
    expect(recognize("npm test -- -t parse")!.key).toBe("npm test -- -t parse")
    expect(recognize("pnpm test -- -k wren")!.key).toBe("pnpm test -- -k wren")
    expect(recognize("bun test -t parse")!.key).toBe("bun test -t parse")
  })
})

describe("repair: jest console blocks are not failures", () => {
  test("fixture: the first failing test skips the console block", () => {
    const r = parseResult("jest", fx("jest-console-fail.txt"), 1)
    expect(r.outcome).toBe("fail")
    expect(r.firstFailing).toBe("Billing service › totals an invoice")
    expect(r.failed).toBe(2)
    expect(r.passed).toBe(4)
  })
  test("a console block alone is never the name", () => {
    const out = "  ● Console\n    console.log\n      hello from the test\n\n  ● Orders › computes totals\n    expect(received).toBe(2)\n\nTests:       1 failed, 3 passed, 4 total"
    expect(parseResult("jest", out, 1).firstFailing).toBe("Orders › computes totals")
  })
  test("console blocks between two failures do not hide the first one", () => {
    const out = "  ● Console\n    console.log\n      noise\n  ● Alpha › first\n    boom\n  ● Console\n    console.error\n      more noise\n  ● Beta › second\n    boom\nTests:       2 failed, 1 passed, 3 total"
    expect(parseResult("jest", out, 1).firstFailing).toBe("Alpha › first")
  })
  test("an output with only a console block has no name", () => {
    const out = "  ● Console\n    console.log\n      noise\nTests:       3 passed, 3 total"
    expect(parseResult("jest", out, 0).firstFailing).toBeUndefined()
  })
})

describe("repair: vitest top-level failures are named by the test alone", () => {
  test("fixture: no describe in the file", () => {
    const r = parseResult("vitest", fx("vitest-toplevel-fail.txt"), 1)
    expect(r.outcome).toBe("fail")
    expect(r.firstFailing).toBe("adds numbers")
    expect(r.failed).toBe(2)
    expect(r.passed).toBe(3)
  })
  test("the tree marker line drops the trailing duration", () => {
    const out = " ❱ src/calc.test.ts (3 tests | 1 failed) 9ms\n × adds numbers 5ms\n Tests  1 failed | 2 passed"
    expect(parseResult("vitest", out, 1).firstFailing).toBe("adds numbers")
  })
  test("the FAIL summary line drops the bracketed duration", () => {
    const out = "FAIL  src/calc.test.ts > adds numbers [5.00ms]\nError: expected 5 to be 6\n Tests  1 failed | 2 passed"
    expect(parseResult("vitest", out, 1).firstFailing).toBe("adds numbers")
  })
  test("a describe still prefixes the name", () => {
    const out = "FAIL  src/writer.test.ts > Writer > flushes the buffer [21.00ms]\nError: buffer closed\n Tests  1 failed | 2 passed"
    expect(parseResult("vitest", out, 1).firstFailing).toBe("Writer > flushes the buffer")
  })
})

describe("repair: mocha and cypress failure lists join with one space", () => {
  test("fixture: nested mocha suites with colours and CRLF", () => {
    const r = parseResult("mocha", fx("mocha-fail-nested-ansi.txt"), 1)
    expect(r.outcome).toBe("fail")
    expect(r.firstFailing).toBe("Wren parser nested output writes nested output")
    expect(r.failed).toBe(1)
    expect(r.passed).toBe(1)
  })
  test("fixture: cypress suite and name", () => {
    const r = parseResult("cypress", fx("cypress-fail-nested.txt"), 1)
    expect(r.outcome).toBe("fail")
    expect(r.firstFailing).toBe("Shop checkout rejects a bad password")
  })
  test("flat suite and name with five spaces of indent", () => {
    const out = "  1) Orders\n     computes totals:\n\n      AssertionError: expected 3 to equal 2\n\n  1 passing\n  1 failing"
    expect(parseResult("mocha", out, 1).firstFailing).toBe("Orders computes totals")
  })
  test("no blank line before the error text", () => {
    const out = "  1) Orders\n       computes totals:\n     AssertionError: expected 3 to equal 2\n  1 failing"
    expect(parseResult("mocha", out, 1).firstFailing).toBe("Orders computes totals")
  })
  test("three levels of nesting join in order", () => {
    const out = "  1) Shop\n       checkout\n         guest\n           rejects a bad password:\n\n      CypressError: timed out\n  1 failing"
    expect(parseResult("cypress", out, 1).firstFailing).toBe("Shop checkout guest rejects a bad password")
  })
  test("CRLF and colours on the flat form", () => {
    const out = "  \x1b[31m1) Orders\x1b[39m\r\n       \x1b[31mcomputes totals:\x1b[39m\r\n\r\n  1 passing\r\n  1 failing\r\n"
    expect(parseResult("mocha", out, 1).firstFailing).toBe("Orders computes totals")
  })
  test("error prose under the block is never absorbed", () => {
    const out = "  1) Orders\n       computes totals:\n\n      expected 3 to equal 2\n      + expected - actual\n      at Context.<anonymous> (test/orders.spec.js:9:18)\n  1 failing"
    expect(parseResult("mocha", out, 1).firstFailing).toBe("Orders computes totals")
  })
})

describe("repair: playwright numbered failures drop project, location and rule", () => {
  test("fixture: project, file location and trailing rule with colours and CRLF", () => {
    const r = parseResult("playwright", fx("playwright-fail-rule-ansi.txt"), 1)
    expect(r.outcome).toBe("fail")
    expect(r.firstFailing).toBe("Orders › computes totals")
    expect(r.failed).toBe(1)
    expect(r.passed).toBe(11)
  })
  test("no describe gives just the name", () => {
    const out = "  1) [webkit] › src/calc.spec.ts:3:1 › adds numbers on its own ──────────────\n\n  1 failed"
    expect(parseResult("playwright", out, 1).firstFailing).toBe("adds numbers on its own")
  })
  test("no project, no rule", () => {
    const out = "  1) src/shop/orders.spec.ts:12:5 › Orders › computes totals\n\n  1 failed\n  3 passed"
    expect(parseResult("playwright", out, 1).firstFailing).toBe("Orders › computes totals")
  })
  test("a heavier rule variant is dropped too", () => {
    const out = "  2) [Mobile Safari] › e2e/shop.cy.ts:44:7 › basket › totals ━━━━━━━━━━━━━━━━━━\n\n  1 failed"
    expect(parseResult("playwright", out, 1).firstFailing).toBe("basket › totals")
  })
  test("CRLF line ends", () => {
    const out = "  1) [chromium] › test/shop.spec.ts:12:5 › suite › name ──────────────\r\n\r\n  1 failed\r\n  2 passed\r\n"
    expect(parseResult("playwright", out, 1).firstFailing).toBe("suite › name")
  })
})

describe("repair: maven surefire failure names", () => {
  test("fixture: Failures section with CRLF", () => {
    const r = parseResult("mvn", fx("maven-surefire-fail.txt"), 1)
    expect(r.outcome).toBe("fail")
    expect(r.firstFailing).toBe("BillingServiceTest.computeTotals")
    expect(r.failed).toBe(1)
    expect(r.passed).toBe(7)
  })
  test("Tests in error section with the exception arrow", () => {
    const out = "[ERROR] Tests in error:\n[ERROR]   BillingServiceTest.computeTotals:31 » IllegalState wire mock\n[INFO] BUILD FAILURE"
    expect(parseResult("mvn", out, 1).firstFailing).toBe("BillingServiceTest.computeTotals")
  })
  test("colour codes around [ERROR]", () => {
    const out = "\x1b[1;31m[ERROR]\x1b[m Failures:\n\x1b[1;31m[ERROR]\x1b[m   BillingServiceTest.computeTotals:12 expected: <3> but was: <2>\n[INFO] BUILD FAILURE"
    expect(parseResult("mvn", out, 1).firstFailing).toBe("BillingServiceTest.computeTotals")
  })
  test("inner class names survive", () => {
    const out = "[ERROR] Failures:\n[ERROR]   BillingServiceTest$Parser.readsNested:12 expected boom\n[INFO] BUILD FAILURE"
    expect(parseResult("mvn", out, 1).firstFailing).toBe("BillingServiceTest$Parser.readsNested")
  })
})

describe("repair: xctest names drop the module", () => {
  const AQ = String.fromCharCode(39)
  test("fixture: module dropped, first failure wins", () => {
    const r = parseResult("xcodebuild", fx("xctest-fail.txt"), 1)
    expect(r.outcome).toBe("fail")
    expect(r.firstFailing).toBe("BillingTests.testComputeTotals")
    expect(r.failed).toBe(2)
    expect(r.passed).toBe(1)
  })
  test("indented and timestamped lines are still read", () => {
    const a = "Test Case " + AQ + "-[ShopTests.BillingTests testComputeTotals]" + AQ + " failed (0.012 seconds).\nExecuted 3 tests, with 1 failure (0 expectations) in 0.5 (0.5) seconds"
    expect(parseResult("xcodebuild", a, 1).firstFailing).toBe("BillingTests.testComputeTotals")
    const b = "2026-10-05 01:02:03.456 Test Case " + AQ + "-[ShopTests.BillingTests testComputeTotals]" + AQ + " failed (0.012 seconds)."
    expect(parseResult("xcodebuild", b, 1).firstFailing).toBe("BillingTests.testComputeTotals")
    const c = "\t\tTest Case " + AQ + "-[ShopTests.BillingTests testComputeTotals]" + AQ + " failed (0.012 seconds).\n** TEST FAILED **"
    expect(parseResult("xcodebuild", c, null).firstFailing).toBe("BillingTests.testComputeTotals")
  })
  test("a multi-part module keeps every class component", () => {
    const out = "Test Case " + AQ + "-[com.shop.kiwi.BillingTests testComputeTotals]" + AQ + " failed (0.012 seconds).\n** TEST FAILED **"
    expect(parseResult("xcodebuild", out, null).firstFailing).toBe("BillingTests.testComputeTotals")
  })
})

describe("repair: a run that ends before any summary is unknown", () => {
  const AQ = String.fromCharCode(39)
  // killed or crashed runs: a null exit code and no summary line means the
  // run never finished, so nothing may be claimed about the outcome.
  const cases: Array<[string, string]> = [
    ["jest", "RUNS src/orders/billing.test.js\nconsole.log\n  booting\n"],
    ["vitest", " RUN  v2.1.8 /home/user/src/shop\n ❯ src/calc.test.ts (3 tests | 1 failed) 9ms\n × adds numbers 5ms"],
    ["mocha", "  Orders\n    ✓ computes\n    1) hangs\n"],
    ["cypress", "  Shop checkout\n    1) rejects a bad password\n"],
    ["karma", "Chrome 130 (Mac OS) kiwi parser should read a header FAILED\n"],
    ["tap", "TAP version 13\nnot ok 1 - wren parses\n"],
    ["node", "▶ wren\n  ✖ parses a header\n"],
    ["bun", "src/calc.test.ts:\n(fail) Calculator > multiplies by zero\n"],
    ["pytest", "collected 47 items\ntests/test_billing.py ..F\n"],
    ["unittest", "test_add (test_billing.TestCalculator.test_add) ... FAIL\n"],
    ["go", "=== RUN   TestParser\n--- FAIL: TestParser (0.00s)\n"],
    ["cargo", "running 3 tests\ntest orders::tests::computes_totals ... "],
    ["nextest", "        START finch orders::tests::computes_totals\n        FAIL [  0.500s] finch orders::tests::computes_totals\n"],
    ["mvn", "[INFO] Running com.shop.BillingServiceTest\n[ERROR]   BillingServiceTest.computeTotals:12 expected: <3> but was: <2>\n"],
    ["gradle", "> Task :api:test\ncom.shop.BillingServiceTest > computes() FAILED\n"],
    ["sbt", "FinchParserTest:\n- writes nested output *** FAILED ***\n"],
    ["dotnet", "  Failed Kiwi.Parser.Tests.ParserTests.ParsesHeader [12 ms]\n  Error Message:\n   Assert.Equal failed\n"],
    ["xcodebuild", "Test Case " + AQ + "-[ShopTests.BillingTests testComputeTotals]" + AQ + " started.\n"],
    ["swift", "Test run started.\n Suite ParserTests\n  ✔ parses a header\n  ✘ writes nested output\n"],
    ["rspec", ".F\n"],
    ["phpunit", "F."],
    ["mix", "Finch.ParserTest\n  * test writes nested output [0.001s]\n"],
    ["dart", "00:00 +0: wren parser writes nested output [E]\n"],
    ["deno", "running 3 tests from src/calc.test.ts\nadds numbers ... "],
    ["playwright", "running 6 tests using 2 workers\n"],
    ["npm", "> kiwi@1.0.0 test\n> jest\n\nRUNS src/calc.test.ts\n"],
  ]
  for (const [tool, out] of cases) {
    test(`${tool} truncated with null exit is unknown`, () => {
      const r = parseResult(tool, out, null)
      expect(r.outcome).toBe("unknown")
      expect(r.firstFailing).toBeUndefined()
      expect(r.failed).toBeUndefined()
      expect(r.passed).toBeUndefined()
    })
  }
  test("a real summary with a null exit still decides", () => {
    expect(parseResult("jest", fx("jest-fail-ansi.txt"), null).outcome).toBe("fail")
    expect(parseResult("mocha", fx("mocha-fail-crlf.txt"), null).outcome).toBe("fail")
    expect(parseResult("mvn", fx("maven-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("go", fx("go-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("bun", fx("bun-test-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("tap", fx("tap-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("node", fx("node-test-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("dart", fx("dart-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("karma", fx("karma-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("nextest", fx("nextest-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("xcodebuild", fx("xcodebuild-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("sbt", fx("sbt-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("deno", fx("deno-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("vitest", fx("vitest-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("unittest", fx("unittest-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("playwright", fx("playwright-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("cypress", fx("cypress-fail.txt"), null).outcome).toBe("fail")
  })
})

describe("repair: failing names are always clean", () => {
  test("empty and whitespace-only names are dropped", () => {
    expect(parseResult("jest", "  ●\nTests: 1 failed, 0 passed\n", 1).firstFailing).toBeUndefined()
    expect(parseResult("mocha", "  1)\n       :\n  1 failing\n", 1).firstFailing).toBeUndefined()
  })
  test("a multi-line capture collapses to one line", () => {
    const out = "  1) Orders\n       computes\ntotals:\n  1 failing"
    const n = parseResult("mocha", out, 1).firstFailing
    expect(n).toBeDefined()
    expect(n).not.toMatch(/\\n/)
  })
  test("a trailing box rule is never part of the name", () => {
    const out = "  1) [chromium] › shop.spec.ts:1:1 › suite › name ────────\n  1 failed"
    expect(parseResult("playwright", out, 1).firstFailing).toBe("suite › name")
  })
  test("every fixture that yields a name yields a clean one", () => {
    expect(parseResult('dotnet', 'Passed! - Failed: 0, Passed: 3\n', null).outcome).toBe('pass')
    expect(parseResult('node', '\u2139 tests 2\n\u2139 pass 1\n\u2139 fail 1\n', null).outcome).toBe('fail')
    // every fixture whose expected outcome is fail with a failing name, each
    // parsed through the tool that produces it
    const named: Array<[string, string]> = [
      ["jest-fail-ansi.txt", "jest"],
      ["jest-console-fail.txt", "jest"],
      ["vitest-fail.txt", "vitest"],
      ["vitest-toplevel-fail.txt", "vitest"],
      ["vitest-failed-only.txt", "vitest"],
      ["mocha-fail-crlf.txt", "mocha"],
      ["mocha-fail-nested-ansi.txt", "mocha"],
      ["ava-fail.txt", "ava"],
      ["tap-fail.txt", "tap"],
      ["node-test-fail.txt", "node"],
      ["deno-fail.txt", "deno"],
      ["bun-test-fail.txt", "bun"],
      ["playwright-fail.txt", "playwright"],
      ["playwright-fail-rule-ansi.txt", "playwright"],
      ["cypress-fail.txt", "cypress"],
      ["cypress-fail-nested.txt", "cypress"],
      ["karma-fail.txt", "karma"],
      ["jasmine-fail.txt", "jasmine"],
      ["pytest-fail.txt", "pytest"],
      ["pytest-fail-crlf.txt", "pytest"],
      ["pytest-error.txt", "pytest"],
      ["unittest-fail.txt", "unittest"],
      ["cargo-fail.txt", "cargo"],
      ["nextest-fail.txt", "nextest"],
      ["go-fail.txt", "go"],
      ["go-json-fail.txt", "go"],
      ["gradle-fail.txt", "gradle"],
      ["gradle-fail-ansi.txt", "gradle"],
      ["maven-fail.txt", "mvn"],
      ["maven-surefire-fail.txt", "mvn"],
      ["sbt-fail.txt", "sbt"],
      ["dotnet-fail.txt", "dotnet"],
      ["xcodebuild-fail.txt", "xcodebuild"],
      ["xctest-fail.txt", "xcodebuild"],
      ["swift-xctest-fail.txt", "swift"],
      ["swift-testing-fail.txt", "swift"],
      ["rspec-fail.txt", "rspec"],
      ["minitest-fail.txt", "rake"],
      ["minitest-fail.txt", "ruby"],
      ["phpunit-fail.txt", "phpunit"],
      ["pest-fail.txt", "pest"],
      ["mix-fail.txt", "mix"],
      ["ctest-fail.txt", "ctest"],
      ["dart-fail.txt", "dart"],
      ["flutter-fail.txt", "flutter"],
    ]
    for (const [file, tool] of named) {
      const r = parseResult(tool, fx(file), 1)
      const n = r.firstFailing
      if (typeof n !== "string" || n.length === 0) throw new Error(file + " via " + tool + " has no failing name")
      expect(n).toBe(n.trim())
      expect(n).not.toMatch(/[\r\n]/)
      expect(n).not.toMatch(/\x1b/)
      expect(n).not.toMatch(/[\u2500\u2501\u2550]{2,}$/)
    }
  })
})


/* ---------------------------------------------------------------- *
 * repair round 2 — gaps found by red-teaming the round-1 fixes
 * ---------------------------------------------------------------- */

describe("repair2: watch-off and runner binaries through package managers", () => {
  test("vitest --run is a one-shot run and never filters on its own", () => {
    expect(recognize("vitest --run")).toEqual({ kind: "test", tool: "vitest", key: "vitest --run", filtered: false })
    expect(recognize("vitest --run --coverage")!.filtered).toBe(false)
    expect(recognize("npx vitest --run --reporter dot")!.filtered).toBe(false)
    expect(recognize("timeout 600 vitest --run --coverage")!.filtered).toBe(false)
  })
  test("vitest --run with a filter is filtered", () => {
    expect(recognize("vitest --run test/calc.test.ts")!.filtered).toBe(true)
    expect(recognize("vitest --run -t parse")!.filtered).toBe(true)
  })
  test("yarn runs local runner binaries directly", () => {
    expect(recognize("yarn vitest run --coverage")).toEqual({ kind: "test", tool: "vitest", key: "vitest run --coverage", filtered: false })
    expect(recognize("yarn jest --coverage")!.tool).toBe("jest")
    expect(recognize("yarn mocha test/wren.spec.js")).toEqual({ kind: "test", tool: "mocha", key: "mocha test/wren.spec.js", filtered: true })
    expect(recognize("yarn run vitest run")).toEqual({ kind: "test", tool: "vitest", key: "vitest run", filtered: false })
  })
  test("pnpm also runs local runner binaries directly", () => {
    expect(recognize("pnpm vitest run")!.tool).toBe("vitest")
    expect(recognize("pnpm jest -t parse")!.filtered).toBe(true)
  })
  test("yarn install and yarn nothing stay null", () => {
    expect(recognize("yarn install")).toBeNull()
    expect(recognize("yarn lint")).toBeNull()
  })
})

describe("repair2: flags that narrow by picking related or changed tests", () => {
  test("jest relation flags select a subset", () => {
    expect(recognize("jest --findRelatedTests src/orders/billing.ts")!.filtered).toBe(true)
    expect(recognize("jest --changedSince main")!.filtered).toBe(true)
    expect(recognize("jest --onlyChanged")!.filtered).toBe(true)
  })
  test("vitest --changed selects a subset", () => {
    expect(recognize("vitest run --changed")!.filtered).toBe(true)
    expect(recognize("vitest run --changed HEAD")!.filtered).toBe(true)
  })
})

describe("repair2: a value word after an unknown flag is not a test selection", () => {
  test("bare numbers and key=value words never narrow", () => {
    expect(recognize("mocha --retries 2")!.filtered).toBe(false)
    expect(recognize("mocha --reporter-options reportDir=dist")!.filtered).toBe(false)
    expect(recognize("npm test -- --maxConcurrency 4")!.filtered).toBe(false)
    expect(recognize("dart test --jobs 4")!.filtered).toBe(false)
  })
  test("a real test path still narrows", () => {
    expect(recognize("mocha --retries 2 test/wren.spec.js")!.filtered).toBe(true)
  })
})

describe("repair2: playwright trailing rules of any length", () => {
  const rule = (n: number) => "\u2500".repeat(n)
  for (const n of [1, 2, 3, 12]) {
    test("a trailing rule of " + n + " box chars is dropped", () => {
      const out = "  1) [chromium] \u203a src/shop/orders.spec.ts:12:5 \u203a Orders \u203a computes totals " + rule(n) + "\n  1 failed\n 11 passed"
      expect(parseResult("playwright", out, 1).firstFailing).toBe("Orders \u203a computes totals")
    })
  }
  test("a one-char rule with CRLF and colours", () => {
    const E = String.fromCharCode(27)
    const out = "  " + E + "[31m1" + E + "[39m) [chromium] \u203a e2e/shop.spec.ts:3:1 \u203a checkout \u203a rejects a bad password " + E + "[2m\u2500" + E + "[22m\r\n  1 failed\r\n"
    expect(parseResult("playwright", out, 1).firstFailing).toBe("checkout \u203a rejects a bad password")
  })
})

describe("repair2: xctest lines with the process prefix", () => {
  const AQ = String.fromCharCode(39)
  test("xctest[pid:tid] between timestamp and Test Case is tolerated", () => {
    const out = "2026-10-05 01:02:03.456 xctest[123:456] Test Case " + AQ + "-[ShopTests.BillingTests testComputeTotals]" + AQ + " failed (0.012 seconds).\nExecuted 3 tests, with 1 failure"
    expect(parseResult("xcodebuild", out, 1).firstFailing).toBe("BillingTests.testComputeTotals")
  })
  test("process prefix without a timestamp, and CRLF line ends", () => {
    const a = "xctest[991] Test Case " + AQ + "-[ShopTests.BillingTests testRounds]" + AQ + " failed (0.001 seconds)."
    expect(parseResult("xcodebuild", a, 1).firstFailing).toBe("BillingTests.testRounds")
    const b = "Test Case " + AQ + "-[ShopTests.BillingTests testRounds]" + AQ + " failed (0.001 seconds).\r\n** TEST FAILED **\r\n"
    expect(parseResult("xcodebuild", b, null).firstFailing).toBe("BillingTests.testRounds")
  })
})


describe("repair2: environment flags with values never narrow a run", () => {
  test("browser, pool and worker choices are not test selections", () => {
    expect(recognize("vitest run --browser chromium")!.filtered).toBe(false)
    expect(recognize("vitest run --pool forks")!.filtered).toBe(false)
    expect(recognize("playwright test --browser chromium")!.filtered).toBe(false)
    expect(recognize("playwright test --workers 2")!.filtered).toBe(false)
    expect(recognize("mocha --retries 2")!.filtered).toBe(false)
    expect(recognize("mocha --reporter-options reportDir=dist")!.filtered).toBe(false)
  })
  test("the same flags before a real path still narrow", () => {
    expect(recognize("vitest run --browser chromium test/orders")!.filtered).toBe(true)
    expect(recognize("playwright test --workers 2 e2e/shop.spec.ts")!.filtered).toBe(true)
    expect(recognize("mocha --parallel test/wren.spec.js")!.filtered).toBe(true)
  })
})

describe("repair2: surefire 2.x failure listing", () => {
  test("testName(ClassName) with Time elapsed gives ClassName.testName", () => {
    const out = "[ERROR] Failures: \n[ERROR]   parseHeader(KiwiParserTest)  Time elapsed: 0.01 s  <<< FAILURE!\n[ERROR] Tests run: 3, Failures: 1, Errors: 0, Skipped: 0\n[INFO] BUILD FAILURE"
    const r = parseResult("mvn", out, 1)
    expect(r.firstFailing).toBe("KiwiParserTest.parseHeader")
    expect(r.failed).toBe(1)
    expect(r.outcome).toBe("fail")
  })
})


describe("repair2: uvu live progress is not a summary", () => {
  test("a killed uvu run with only (n/m) progress is unknown", () => {
    const r = parseResult("uvu", "• (0.003ms) wren > parses headers\n(1/1) wren\n", null)
    expect(r.outcome).toBe("unknown")
    expect(r.firstFailing).toBeUndefined()
  })
  test("the totals block still decides", () => {
    expect(parseResult("uvu", fx("uvu-pass.txt"), null)).toEqual({ outcome: "pass", passed: 2, failed: 0 })
    const fail = "• (1ms) wren > parses headers\nΣ Total: (1/2)\nPassed:     1\nFailed:     1\nSkipped:    0\n"
    const r = parseResult("uvu", fail, null)
    expect(r.outcome).toBe("fail")
    expect(r.failed).toBe(1)
  })
})


describe("repair2: node and tap summaries count fail last", () => {
  test("a cut between the pass and fail lines stays unknown", () => {
    const nodePartial = "\u2139 pass 2\n"
    expect(parseResult("node", nodePartial, null).outcome).toBe("unknown")
    const tapPartial = "TAP version 13\nok 1 - wren parses\n1..3\n# tests 3\n# pass 2\n"
    expect(parseResult("tap", tapPartial, null).outcome).toBe("unknown")
  })
  test("whole summaries still decide", () => {
    expect(parseResult("node", fx("node-test-pass.txt"), null).outcome).toBe("pass")
    expect(parseResult("tap", fx("tap-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("tap", "TAP version 13\nnot ok 1 - wren parses\nBail out! system error\n1..1", null).outcome).toBe("fail")
  })
})

/* ---------------------------------------------------------------- *
 * red-team round 2 - realistic cases against the repaired behaviours
 * ---------------------------------------------------------------- */

const E = String.fromCharCode(27)
const RULE = String.fromCharCode(0x2500)
const AQ = String.fromCharCode(39)

describe('redteam2: timeout as a wrapper', () => {
  test('compound, decimal and day durations unwrap', () => {
    expect(recognize('timeout 2m30s npm test')).toEqual({ kind: 'test', tool: 'npm', key: 'npm test', filtered: false })
    expect(recognize('timeout 1.5h yarn test')).toEqual({ kind: 'test', tool: 'yarn', key: 'yarn test', filtered: false })
    expect(recognize('timeout 0.5s bun test')).toEqual({ kind: 'test', tool: 'bun', key: 'bun test', filtered: false })
    expect(recognize('timeout 1d pnpm test')).toEqual({ kind: 'test', tool: 'pnpm', key: 'pnpm test', filtered: false })
    expect(recognize('timeout 100ms vitest run')).toEqual({ kind: 'test', tool: 'vitest', key: 'vitest run', filtered: false })
    expect(recognize('timeout 600 npm test')).toEqual({ kind: 'test', tool: 'npm', key: 'npm test', filtered: false })
  })
  test('every timeout option is unwrapped, alone and combined', () => {
    expect(recognize('timeout -s INT 10 npm test')).toEqual({ kind: 'test', tool: 'npm', key: 'npm test', filtered: false })
    expect(recognize('timeout --signal=KILL 5m npm test').tool).toBe('npm')
    expect(recognize('timeout -k 1 --kill-after=2 600 npm test').tool).toBe('npm')
    expect(recognize('timeout --kill-after 5 30s jest').tool).toBe('jest')
    expect(recognize('timeout --foreground --preserve-status 30s jest').tool).toBe('jest')
    expect(recognize('timeout -v 600 mocha').tool).toBe('mocha')
    expect(recognize('timeout -s KILL -k 10 --foreground --preserve-status -v 600 mocha').tool).toBe('mocha')
  })
  test('timeout with nothing left to launch is not a run', () => {
    expect(recognize('timeout 600')).toBeNull()
    expect(recognize('timeout --foreground')).toBeNull()
    expect(recognize('timeout -v')).toBeNull()
  })
  test('timeout before assignments, launchers and local binaries', () => {
    expect(recognize('CI=1 timeout 600 npm test').tool).toBe('npm')
    expect(recognize('timeout 600 npx jest --coverage').tool).toBe('jest')
    expect(recognize('timeout 600 ./node_modules/.bin/vitest run').tool).toBe('vitest')
    expect(recognize('timeout 600 sudo npm test').tool).toBe('npm')
    expect(recognize('timeout 600 env NODE_ENV=test jest').tool).toBe('jest')
  })
  test('a separator between timeout and the command is dropped', () => {
    expect(recognize('timeout 10 -- npm test')).toEqual({ kind: 'test', tool: 'npm', key: 'npm test', filtered: false })
    expect(recognize('timeout 10s -- ./node_modules/.bin/jest').tool).toBe('jest')
    expect(recognize('sudo -- npm test').tool).toBe('npm')
  })
  test('a filter under timeout stays filtered and stays in the key', () => {
    expect(recognize('timeout 600 npm test -- -t parse')).toEqual({ kind: 'test', tool: 'npm', key: 'npm test -- -t parse', filtered: true })
    expect(recognize('timeout 5m vitest run --coverage').filtered).toBe(false)
    expect(recognize('timeout 5m jest test/calc.test.ts').filtered).toBe(true)
  })
  test('timeout wrapping a build still reads as a build', () => {
    expect(recognize('timeout 600 npm run build').kind).toBe('build')
    expect(recognize('timeout 600 tsc --noEmit').kind).toBe('build')
  })
  test('a timeout duration is not mistaken for a tool or a filter', () => {
    expect(recognize('timeout 30 go test ./...')).toEqual({ kind: 'test', tool: 'go', key: 'go test ./...', filtered: false })
    expect(recognize('timeout 30s go test ./...').filtered).toBe(false)
    expect(recognize('timeout 2h cargo test').filtered).toBe(false)
  })
})

describe('redteam2: benign flags never narrow a run', () => {
  const notFiltered = [
    'vitest run --coverage --reporter dot',
    'vitest run --reporter dot --coverage',
    'vitest --run --coverage --reporter=dot',
    'vitest run --coverage.enabled --coverage.reporter=json',
    'jest --coverage --reporter=default --colors',
    'jest --colors --coverage --silent',
    'mocha --reporter dot --colors',
    'mocha --reporter=dot --no-colors',
    'npm test -- --coverage --reporter dot',
    'npm test --coverage --reporter dot',
    'npm test -- --colors --silent',
    'pnpm test --coverage --reporter=dot',
    'yarn test --coverage',
    'bun test --coverage',
    'cypress run --reporter dot',
    'playwright test --reporter=line',
    'dart test --reporter expanded',
    'flutter test --coverage',
    'pytest --cov --tb=short -q',
    'rspec --format documentation',
    'cargo test --verbose',
    'go test -v ./...',
    'karma start --single-run --reporter progress',
    'deno test --reporter=dot',
    'node --test --test-reporter tap',
  ]
  test('reporter, coverage, colour, verbosity and output flags', () => {
    const offenders = notFiltered.filter((cmd) => { const r = recognize(cmd); return r === null || r!.filtered !== false })
    expect(offenders).toEqual([])
  })
  const alsoNot = [
    'npm test -- --watch=false',
    'npm test -- --runInBand',
    'npm test -- --noStackTrace',
    'npm test -- --passWithNoTests',
    'npm test -- -R dot',
    'npm test -- -r ts-node/register',
    'pnpm test -- --run',
    'yarn test --runInBand',
    'bun test -- --bail',
  ]
  test('watch-off, quiet and reporter shorthands after the separator', () => {
    const offenders = alsoNot.filter((cmd) => { const r = recognize(cmd); return r === null || r!.filtered !== false })
    expect(offenders).toEqual([])
  })
})

describe('redteam2: filters through package managers and in place', () => {
  const filtered = [
    'npm test -- -t parse',
    'npm test -- --testNamePattern parse',
    'npm test -- --testNamePattern=parse',
    'npm test -- -k orders',
    'npm test -- --grep orders',
    'npm test -- test/orders/calc.test.ts',
    'npm test -- src/orders',
    'npm run test -- -t parse',
    'npm t -- -t parse',
    'pnpm test -- -t parse',
    'pnpm test -- --grep orders',
    'pnpm run test -- test/calc.test.ts',
    'yarn test -t parse',
    'yarn test --grep orders',
    'yarn test -- -t parse',
    'yarn test test/calc.test.ts',
    'bun test -t parse',
    'bun test --grep orders',
    'bun test test/calc.test.ts',
    'jest -t parse --coverage',
    'jest --coverage -t parse',
    'vitest run --coverage test/calc.test.ts',
    'mocha --colors test/wren.spec.js',
    'cypress run --spec cypress/e2e/kiwi.cy.js',
    'playwright test --grep checkout',
  ]
  test('subset flags and paths, before or after the separator', () => {
    const missed = filtered.filter((cmd) => { const r = recognize(cmd); return r === null || r!.filtered !== true })
    expect(missed).toEqual([])
  })
  test('the filter stays in the history key', () => {
    expect(recognize('npm test -- -t parse')!.key).toBe('npm test -- -t parse')
    expect(recognize('npm t -- --grep orders')!.key).toBe('npm t -- --grep orders')
    expect(recognize('yarn test -t parse')!.key).toBe('yarn test -t parse')
    expect(recognize('npm test -- test/orders/calc.test.ts')!.key).toBe('npm test -- test/orders/calc.test.ts')
  })
  test('a quoted pattern is one word and still narrows', () => {
    expect(recognize('npm test -- -t ' + AQ + 'parse numbers' + AQ).filtered).toBe(true)
    expect(recognize('yarn test --grep ' + AQ + 'kiwi parser' + AQ).filtered).toBe(true)
  })
  test('values of unknown flags never narrow', () => {
    expect(recognize('mocha --retries 2').filtered).toBe(false)
    expect(recognize('npm test -- --maxConcurrency 4').filtered).toBe(false)
    expect(recognize('mocha --reporter-options reportDir=dist').filtered).toBe(false)
    expect(recognize('dart test --jobs 4').filtered).toBe(false)
    expect(recognize('mocha --retries 2 test/wren.spec.js').filtered).toBe(true)
  })
})

describe('redteam2: jest console blocks never name a failure', () => {
  test('console blocks before, between and after failures', () => {
    const out = [
      'PASS src/users/model.test.js',
      'FAIL src/orders/billing.test.js',
      '  ' + E + '[36m● Console' + E + '[39m',
      '    console.log',
      '      billing run starting',
      '      at src/orders/billing.test.js:12:9',
      '',
      '  ' + E + '[31m● Billing service › totals an invoice' + E + '[39m',
      '    expect(received).toBe(4200)',
      '',
      '  ● Console',
      '    console.warn',
      '      slow query',
      '',
      '  ● Billing service › rounds to cents',
      '    expect(received).toBe(2)',
      '',
      'Test Suites: 1 failed, 2 passed, 3 total',
      'Tests:       2 failed, 4 passed, 6 total',
    ].join('\n')
    const r = parseResult('jest', out, 1)
    expect(r.firstFailing).toBe('Billing service › totals an invoice')
    expect(r.failed).toBe(2)
    expect(r.outcome).toBe('fail')
  })
  test('a run whose only block is Console passes and names nothing', () => {
    const out = 'PASS src/orders/calc.test.js\n  ● Console\n    console.log\n      hi\nTests:       4 passed, 4 total\nTest Suites: 1 passed, 1 total\n'
    const r = parseResult('jest', out, 0)
    expect(r.outcome).toBe('pass')
    expect(r.firstFailing).toBeUndefined()
  })
  test('a suite-level failure block is still found after console output', () => {
    const out = 'FAIL src/orders/billing.test.js\n  ● Console\n    console.error\n      boom\n  ● Billing service\n    Your test suite must contain at least one test.\n\nTest Suites: 1 failed, 1 total\nTests:       0 total\n'
    expect(parseResult('jest', out, 1).firstFailing).toBe('Billing service')
  })
})

describe('redteam2: vitest top-level failures', () => {
  test('no describe means the test name alone', () => {
    const out = 'FAIL  src/calc.test.ts > adds numbers [5.00ms]\nError: expected 5 to be 6\n Tests  1 failed | 2 passed (3)\n'
    const r = parseResult('vitest', out, 1)
    expect(r.firstFailing).toBe('adds numbers')
    expect(r.failed).toBe(1)
  })
  test('a spec file name and a nested describe keep their shape', () => {
    const a = 'FAIL  src/orders/billing.spec.ts > Billing service > totals an invoice [2.34ms]\n Tests  1 failed | 0 passed (1)\n'
    expect(parseResult('vitest', a, 1).firstFailing).toBe('Billing service > totals an invoice')
  })
  test('colours, timing and file paths are not part of the name', () => {
    const out = E + '[31mFAIL' + E + '[39m  src/writer.test.ts > flushes the buffer ' + E + '[2m[21.00ms]' + E + '[22m\n Tests  1 failed | 1 passed (2)\n'
    expect(parseResult('vitest', out, 1).firstFailing).toBe('flushes the buffer')
  })
  test('a killed vitest run without totals is unknown', () => {
    const out = ' RUN  v2.1.8 /src/shop\n ❯ src/calc.test.ts (3 tests | 1 failed) 9ms\n   × adds numbers 5ms\n     → expected 5 to be 6\n'
    const r = parseResult('vitest', out, null)
    expect(r.outcome).toBe('unknown')
    expect(r.firstFailing).toBeUndefined()
  })
})

describe('redteam2: mocha and cypress failure lists', () => {
  test('two-space list with an indented name line', () => {
    const out = '  1) kiwi parser\n       reads a header:\n     AssertionError: expected 1 to be 2\n\n  1 passing\n  1 failing\n'
    expect(parseResult('mocha', out, 1).firstFailing).toBe('kiwi parser reads a header')
  })
  test('nested suites join with one space', () => {
    const out = '  1) shop\n       orders\n         totals an invoice:\n     AssertionError: boom\n\n  1 failing\n'
    expect(parseResult('mocha', out, 1).firstFailing).toBe('shop orders totals an invoice')
  })
  test('cypress list, with colours and CRLF line ends', () => {
    const out = '  1) ' + E + '[31mkiwi' + E + '[39m\r\n       ' + E + '[31mloads the orders page:' + E + '[39m\r\n     CypressError: Timed out retrying\r\n\r\n  0 passing\r\n  1 failing\r\n'
    const r = parseResult('cypress', out, 1)
    expect(r.firstFailing).toBe('kiwi loads the orders page')
    expect(r.failed).toBe(1)
  })
  test('a name carrying a colon keeps everything but the last one', () => {
    const out = '  1) kiwi\n       parses a header: with a colon:\n     AssertionError: nope\n\n  1 failing\n'
    expect(parseResult('mocha', out, 1).firstFailing).toBe('kiwi parses a header: with a colon')
  })
  test('error prose under the block is never absorbed', () => {
    const out = '  1) kiwi parser\n       reads a header:\n     AssertionError: expected 1 to be 2\n        at Context.<anonymous> (test/wren.spec.js:9:18)\n\n  1 failing\n'
    expect(parseResult('mocha', out, 1).firstFailing).toBe('kiwi parser reads a header')
  })
  test('a killed mocha run with only live marks is unknown', () => {
    const out = '  kiwi parser\n    1) reads a header\n'
    expect(parseResult('mocha', out, null).outcome).toBe('unknown')
  })
})

describe('redteam2: playwright numbered failures', () => {
  const ruled = (n: number) => '  1) [chromium] ' + String.fromCharCode(8250) + ' e2e/shop.spec.ts:12:5 ' + String.fromCharCode(8250) + ' checkout ' + String.fromCharCode(8250) + ' totals the basket ' + RULE.repeat(n)
  test('project, location and a long rule are dropped', () => {
    const out = ruled(40) + '\n  1 failed\n 11 passed\n'
    const r = parseResult('playwright', out, 1)
    expect(r.firstFailing).toBe('checkout ' + String.fromCharCode(8250) + ' totals the basket')
    expect(r.outcome).toBe('fail')
  })
  test('no describe means just the name', () => {
    const out = '  1) [webkit] ' + String.fromCharCode(8250) + ' e2e/standalone.spec.ts:1:1 ' + String.fromCharCode(8250) + ' rejects a bad password' + RULE.repeat(3) + '\n  1 failed\n'
    expect(parseResult('playwright', out, 1).firstFailing).toBe('rejects a bad password')
  })
  test('nested describes survive, with colours and CRLF', () => {
    const out = '  ' + E + '[31m1)' + E + '[39m [chromium] ' + String.fromCharCode(8250) + ' src/shop.spec.ts:5:3 ' + String.fromCharCode(8250) + ' cart ' + String.fromCharCode(8250) + ' adds an item ' + E + '[2m' + RULE.repeat(2) + E + '[22m\r\n  1 failed\r\n'
    expect(parseResult('playwright', out, 1).firstFailing).toBe('cart ' + String.fromCharCode(8250) + ' adds an item')
  })
  test('a failure without a rule and without a project still names the test', () => {
    const out = '  1) src/api.spec.ts:9:7 ' + String.fromCharCode(8250) + ' parses a body\n  1 failed\n'
    expect(parseResult('playwright', out, 1).firstFailing).toBe('parses a body')
  })
})

describe('redteam2: maven surefire failure names', () => {
  test('failures section, plain and with a package prefix', () => {
    const out = '[ERROR] Failures: \n[ERROR]   BillingServiceTest.computeTotals:12 expected: <3> but was: <2>\n[INFO] Tests run: 8, Failures: 1, Errors: 0, Skipped: 0\n[INFO] BUILD FAILURE\n'
    expect(parseResult('mvn', out, 1).firstFailing).toBe('BillingServiceTest.computeTotals')
  })
  test('Tests in error section, with CRLF line ends', () => {
    const out = '[ERROR] Tests in error: \n[ERROR]   KiwiParserTest.parseHeader:29 «NullPointer»\r\n[ERROR] Tests run: 4, Failures: 0, Errors: 1, Skipped: 0\r\n[INFO] BUILD FAILURE\r\n'
    const r = parseResult('mvn', out, 1)
    expect(r.firstFailing).toBe('KiwiParserTest.parseHeader')
    expect(r.failed).toBe(1)
  })
  test('section headers and paths never become the name', () => {
    const out = '[ERROR] Failures: \n[ERROR] Tests in error: \n[INFO] BUILD SUCCESS\n'
    expect(parseResult('mvn', out, 0).firstFailing).toBeUndefined()
  })
  test('surefire 2.x testName(ClassName) listing', () => {
    const out = '[ERROR] Failures: \n[ERROR]   parseHeader(KiwiParserTest)  Time elapsed: 0.01 s  <<< FAILURE!\n[ERROR] Tests run: 3, Failures: 1, Errors: 0, Skipped: 0\n'
    expect(parseResult('mvn', out, 1).firstFailing).toBe('KiwiParserTest.parseHeader')
  })
})

describe('redteam2: xctest failure names', () => {
  test('module dropped, with timestamp and process prefix', () => {
    const a = 'Test Case ' + AQ + '-[ShopTests.BillingTests testComputeTotals]' + AQ + ' failed (0.012 seconds).'
    expect(parseResult('xcodebuild', a, 1).firstFailing).toBe('BillingTests.testComputeTotals')
    const b = '2026-10-05 01:02:03.456 xctest[123:456] Test Case ' + AQ + '-[ShopTests.BillingTests testRounds]' + AQ + ' failed (0.001 seconds).'
    expect(parseResult('xcodebuild', b, 1).firstFailing).toBe('BillingTests.testRounds')
    const c = '2026-10-05 01:02:03.456 Test Case ' + AQ + '-[ShopTests.BillingTests testRejectsEmpty]' + AQ + ' failed (0.004 seconds).'
    expect(parseResult('xcodebuild', c, 1).firstFailing).toBe('BillingTests.testRejectsEmpty')
  })
  test('a multi-word test name and CRLF line ends', () => {
    const out = 'Test Case ' + AQ + '-[ShopTests.BillingTests test totals an invoice]' + AQ + ' failed (0.5 seconds).\r\nExecuted 2 tests, with 1 failure (0 expectations)\r\n** TEST FAILED **\r\n'
    const r = parseResult('xcodebuild', out, null)
    expect(r.firstFailing).toBe('BillingTests.test totals an invoice')
    expect(r.outcome).toBe('fail')
  })
  test('a class with no module prefix keeps its own name', () => {
    const out = 'Test Case ' + AQ + '-[BillingTests testRounds]' + AQ + ' failed (0.001 seconds).'
    expect(parseResult('xcodebuild', out, 1).firstFailing).toBe('BillingTests.testRounds')
  })
  test('a passed test case line names nothing', () => {
    const out = 'Test Case ' + AQ + '-[ShopTests.BillingTests testRounds]' + AQ + ' passed (0.001 seconds).\nExecuted 3 tests, with 0 failures\n** TEST SUCCEEDED **\n'
    expect(parseResult('xcodebuild', out, 0).firstFailing).toBeUndefined()
  })
})

describe('redteam2: killed runs stay unknown', () => {
  test('jest cut before the totals', () => {
    const out = 'FAIL src/orders/billing.test.js\n  ● Billing service › totals an invoice\n    expect(received).toBe(4200)\n'
    expect(parseResult('jest', out, null).outcome).toBe('unknown')
  })
  test('a real summary with a null exit still decides', () => {
    expect(parseResult('jest', fx('jest-fail-ansi.txt'), null).outcome).toBe('fail')
    expect(parseResult('mocha', '  1) kiwi\n       reads a header:\n\n  1 failing\n', null).outcome).toBe('fail')
    expect(parseResult('mocha', '  2 passing\n', null).outcome).toBe('pass')
  })
  test('playwright and cypress cut mid-run', () => {
    expect(parseResult('playwright', '  ✘  3 [chromium] › shop.spec.ts:25:5 › checkout › totals\n', null).outcome).toBe('unknown')
    expect(parseResult('cypress', '  kiwi\n    1) loads the orders page\n', null).outcome).toBe('unknown')
  })
  test('maven and xcodebuild cut before the build verdict', () => {
    expect(parseResult('mvn', '[INFO] Building shop 1.0.0\n[INFO] Running com.shop.BillingServiceTest\n', null).outcome).toBe('unknown')
    expect(parseResult('xcodebuild', 'Test Suite ' + AQ + 'All tests' + AQ + ' started at 2026-10-05 01:02:03.456.\n', null).outcome).toBe('unknown')
  })
})

describe('redteam2: every failing name is a clean single line', () => {
  const names: Array<[string, string]> = [
    ['jest', '  ● Suite › name\nTests:       1 failed, 0 passed\n'],
    ['vitest', 'FAIL  a.test.ts > name [5.00ms]\n Tests  1 failed | 0 passed\n'],
    ['mocha', '  1) suite\n       name:\n'],
    ['cypress', '  1) suite\n       name:\n'],
    ['playwright', '  1) [chromium] › a.spec.ts:1:1 › suite › name' + RULE.repeat(30) + '\n  1 failed\n'],
    ['mvn', '[ERROR]   Suite.name:12 message\n[INFO] BUILD FAILURE\n'],
    ['xcodebuild', 'Test Case ' + AQ + '-[Mod.Suite name]' + AQ + ' failed (0.1 seconds).\n** TEST FAILED **\n'],
  ]
  for (const [tool, out] of names) {
    test(tool + ' name hygiene', () => {
      const n = parseResult(tool, out, 1).firstFailing
      expect(n).toBeDefined()
      expect(n!.length).toBeGreaterThan(0)
      expect(n).toBe(n!.trim())
      expect(n!.includes('\n')).toBe(false)
      expect(n!.includes('\r')).toBe(false)
      expect(new RegExp(String.fromCharCode(0x2500) + '{2,}').test(n!)).toBe(false)
    })
  }
})

describe('redteam2: timeout over more tool families', () => {
  const wrapped: Array<[string, string]> = [
    ['timeout 300 make test', 'make'],
    ['timeout 300 ./gradlew test', 'gradle'],
    ['timeout 20 ./mvnw test', 'mvn'],
    ['timeout 300 python -m pytest', 'pytest'],
    ['timeout 1h docker run shop/ci npm test', 'npm'],
    ['timeout 600 npx playwright test --grep checkout', 'playwright'],
    ['timeout 60 rake test', 'rake'],
    ['timeout 120 bundle exec rspec', 'rspec'],
    ['timeout 90 cargo test', 'cargo'],
    ['timeout 90 cargo +stable test', 'cargo'],
    ['timeout 45 swift test', 'swift'],
    ['timeout 45 xcodebuild test', 'xcodebuild'],
    ['timeout 10 -k 2 dart test', 'dart'],
    ['timeout --signal=TERM 15 flutter test', 'flutter'],
  ]
  for (const [cmd, tool] of wrapped) {
    test(cmd + ' unwraps to ' + tool, () => {
      expect(recognize(cmd)!.tool).toBe(tool)
    })
  }
  test('sudo before timeout still unwraps', () => {
    expect(recognize('sudo timeout 600 npm test')!.tool).toBe('npm')
  })
})

describe('redteam2: more filter and benign spellings', () => {
  const narrows = [
    'npm test -- --testPathPattern=orders',
    'npm run test:unit -- -t parse',
    'pnpm test -- -k kiwi',
    'yarn workspace shop test -t parse',
    'bun test --test-name-pattern parse',
    'npm test -- packages/orders',
    'yarn test --lastCommit',
    'npm test -- --findRelatedTests src/orders/billing.ts',
    'vitest run src/calc.test.ts -t adds',
    'jest --changedSince main',
    'mocha --spec test/wren.spec.js',
    'node --test test/calc.test.js',
  ]
  test('these narrow the run', () => {
    const missed = narrows.filter((cmd) => { const r = recognize(cmd); return r === null || r!.filtered !== true })
    expect(missed).toEqual([])
  })
  const plain = [
    'vitest run --reporter=verbose --coverage.reporter=text',
    'jest --ci --coverage --maxWorkers=2',
    'mocha --reporter mochawesome --reporter-options reportDir=dist',
    'cypress run --browser electron',
    'pytest --maxfail=1 --tb=short',
    'cargo test --jobs 4',
    'rspec --require spec_helper --format progress',
    'dotnet test --logger trx',
    'npm test -- --collectCoverageFrom=src/**',
  ]
  test('these keep the whole run', () => {
    const offenders = plain.filter((cmd) => { const r = recognize(cmd); return r === null || r!.filtered !== false })
    expect(offenders).toEqual([])
  })
})

describe('redteam2: killed runs across tool families', () => {
  const cut: Array<[string, string]> = [
    ['bun', '(fail) wren > parses headers\n'],
    ['cargo', 'test orders::compute_totals ... FAILED\n'],
    ['go', '--- FAIL: TestOrders (0.00s)\n    billing_test.go:12: bad total\n'],
    ['deno', 'ERRORS\nwren > parses headers => ./wren.test.ts:8:10\n'],
    ['pytest', 'src/orders/test_billing.py F\n'],
    ['dotnet', '  Failed BillingService.ComputeTotals [12 ms]\n'],
    ['rspec', 'F.\n'],
    ['phpunit', '1) BillingServiceTest::testComputeTotals\n'],
    ['mix', '  1) test computes totals (BillingTest)\n'],
    ['swift', '✘ Test BillingTest.computeTotals() recorded an issue\n'],
    ['gradle', ':test\ncom.shop.BillingServiceTest > computes totals FAILED\n'],
    ['sbt', '- computes totals *** FAILED ***\n'],
    ['tap', 'TAP version 13\nok 1 - wren parses headers\n'],
    ['node', '\u2139 pass 1\n'],
    ['unittest', 'test_computes_totals (billing.BillingTest) ... FAIL\n'],
    ['karma', 'Chrome 129.0 (Mac) kiwi parser reads a header FAILED\n'],
    ['nextest', 'FAIL [ 0.12s] shop::orders::compute_totals\n'],
    ['jest', 'FAIL src/orders/billing.test.js\n  ● Billing service › totals\n'],
    ['mocha', '  kiwi parser\n    1) reads a header\n'],
    ['vitest', ' ❯ src/calc.test.ts (3 tests | 1 failed) 9ms\n   × adds numbers 5ms\n'],
  ]
  for (const [tool, out] of cut) {
    test(tool + ' cut before any summary is unknown', () => {
      const r = parseResult(tool, out, null)
      expect(r.outcome).toBe('unknown')
      expect(r.firstFailing).toBeUndefined()
    })
  }
  test('the same tools still decide on a whole summary', () => {
    expect(parseResult('cargo', 'test result: FAILED. 2 passed; 1 failed\n', null).outcome).toBe('fail')
    expect(parseResult('go', 'FAIL\n', null).outcome).toBe('fail')
    expect(parseResult('go', 'ok  shop/orders 0.5s\n', null).outcome).toBe('pass')
    expect(parseResult('pytest', '2 failed, 3 passed in 0.5s\n', null).outcome).toBe('fail')
    expect(parseResult('rspec', '3 examples, 0 failures\n', null).outcome).toBe('pass')
    expect(parseResult('phpunit', 'OK (3 tests, 5 assertions)\n', null).outcome).toBe('pass')
    expect(parseResult('dotnet', 'Passed! - Failed: 0, Passed: 3\n', null).outcome).toBe('pass')
    expect(parseResult('node', '\u2139 tests 2\n\u2139 pass 1\n\u2139 fail 1\n', null).outcome).toBe('fail')
  })
})

/* ---------------------------------------------------------------- *
 * repair round 3 — the four behaviours the second acceptance run
 * still found wrong: vitest failed-only summaries, swift test XCTest
 * output, killed runs with panic words, and the name-hygiene loop
 * ---------------------------------------------------------------- */

describe("repair3: vitest failed-only summary and bare top-level names", () => {
  test("fixture: top-level failure with a failed-only summary", () => {
    const r = parseResult("vitest", fx("vitest-failed-only.txt"), 1)
    expect(r.outcome).toBe("fail")
    expect(r.firstFailing).toBe("totals an invoice")
    expect(r.failed).toBe(1)
    expect(r.passed).toBeUndefined()
  })
  test("a failed-only summary decides fail on a null exit", () => {
    const out = " FAIL  src/billing.test.ts > totals an invoice [8.00ms]\nAssertionError: expected 4200 to be 4201\n      Tests  1 failed (1)\n"
    const r = parseResult("vitest", out, null)
    expect(r.outcome).toBe("fail")
    expect(r.failed).toBe(1)
    expect(r.passed).toBeUndefined()
    expect(r.firstFailing).toBe("totals an invoice")
  })
  test("one part after the file is the whole name, whatever the file looks like", () => {
    const a = "FAIL  src/billing.spec.ts > totals an invoice [8.00ms]\n Tests  1 failed (1)\n"
    expect(parseResult("vitest", a, 1).firstFailing).toBe("totals an invoice")
    const b = "FAIL  my file.test.ts > adds numbers [5.00ms]\n Tests  1 failed (1)\n"
    expect(parseResult("vitest", b, 1).firstFailing).toBe("adds numbers")
  })
  test("a file-only FAIL block header is skipped for the titled line", () => {
    const out = "FAIL  src/calc.test.ts\n FAIL  src/calc.test.ts > adds numbers [5.00ms]\n Tests  1 failed (1)\n"
    expect(parseResult("vitest", out, 1).firstFailing).toBe("adds numbers")
  })
  test("the pipe form still reads both counts", () => {
    const out = " Tests  2 failed | 3 passed (5)\n"
    const r = parseResult("vitest", out, 1)
    expect(r.failed).toBe(2)
    expect(r.passed).toBe(3)
  })
})

describe("repair3: swift test also prints XCTest output", () => {
  test("fixture: swift test with the error line and the Test Case line", () => {
    const r = parseResult("swift", fx("swift-xctest-fail.txt"), 1)
    expect(r.outcome).toBe("fail")
    expect(r.firstFailing).toBe("BillingTests.testComputeTotals")
    expect(r.failed).toBe(1)
    expect(r.passed).toBe(1)
  })
  test("the same fixture parses through xcodebuild", () => {
    const r = parseResult("xcodebuild", fx("swift-xctest-fail.txt"), 1)
    expect(r.firstFailing).toBe("BillingTests.testComputeTotals")
    expect(r.failed).toBe(1)
    expect(r.passed).toBe(1)
  })
  test("the error line alone names the test, module dropped", () => {
    const out = "/Users/user/Tests/BillingTests.swift:12: error: -[ShopTests.BillingTests testComputeTotals] : XCTAssertEqual failed\n"
    expect(parseResult("swift", out, 1).firstFailing).toBe("BillingTests.testComputeTotals")
    expect(parseResult("xcodebuild", out, 1).firstFailing).toBe("BillingTests.testComputeTotals")
  })
  test("the error line before the Test Case line names the same test", () => {
    const out = "Test Suite 'BillingTests' started.\n/Users/x/Tests/BillingTests.swift:12: error: -[ShopTests.BillingTests testComputeTotals] : failed\nTest Case '-[ShopTests.BillingTests testComputeTotals]' failed (0.012 seconds).\nExecuted 2 tests, with 1 failure (0 expectations)\n"
    const r = parseResult("swift", out, null)
    expect(r.firstFailing).toBe("BillingTests.testComputeTotals")
    expect(r.failed).toBe(1)
    expect(r.outcome).toBe("fail")
  })
  test("a passing XCTest run under swift test is a pass with counts", () => {
    const out = "Test Case '-[ShopTests.BillingTests testRounds]' passed (0.008 seconds).\nExecuted 3 tests, with 0 failures (0 expectations) in 0.5 seconds\n"
    const r = parseResult("swift", out, null)
    expect(r.outcome).toBe("pass")
    expect(r.failed).toBe(0)
    expect(r.passed).toBe(3)
    expect(r.firstFailing).toBeUndefined()
  })
  test("swift-testing output is still read when there is no XCTest line", () => {
    expect(parseResult("swift", fx("swift-testing-fail.txt"), 1).firstFailing).toBe("writes nested output()")
    expect(parseResult("swift", fx("swift-testing-pass.txt"), 0).outcome).toBe("pass")
  })
})

describe("repair3: a killed run with panic or error words stays unknown", () => {
  test("fixture: go test that panicked and was killed", () => {
    const r = parseResult("go", fx("go-panic.txt"), null)
    expect(r.outcome).toBe("unknown")
    expect(r.firstFailing).toBeUndefined()
    expect(r.failed).toBeUndefined()
    expect(r.passed).toBeUndefined()
  })
  test("panic and error words without a verdict line never say fail", () => {
    const out = "=== RUN   TestParser\npanic: runtime error: index out of range [5] with length 3\ngoroutine 19 [running]:\nmake: *** [test] Error 1\n"
    expect(parseResult("go", out, null).outcome).toBe("unknown")
  })
  test("the same words through a package-manager wrapper stay unknown", () => {
    const out = "> finch@1.0.0 test\n> go test ./...\n\npanic: runtime error: index out of range\n"
    expect(parseResult("npm", out, null).outcome).toBe("unknown")
  })
  test("a go run that crashed after the panic still prints FAIL and fails", () => {
    const out = fx("go-panic.txt") + "exit status 2\nFAIL\tgithub.com/user/lark\t0.213s\n"
    expect(parseResult("go", out, 2).outcome).toBe("fail")
    expect(parseResult("go", out, null).outcome).toBe("fail")
  })
  test("a real verdict line still decides on a null exit", () => {
    expect(parseResult("go", fx("go-fail.txt"), null).outcome).toBe("fail")
    expect(parseResult("go", "FAIL\n", null).outcome).toBe("fail")
    expect(parseResult("go", "ok  github.com/user/lark 0.1s\n", null).outcome).toBe("pass")
  })
  test("build-only tools still read their error lines as failure", () => {
    const out = 'src/orders.ts:12:7 - error TS2322: Type \'number\' is not assignable to type \'string\'.'
    expect(parseResult("tsc", out, null).outcome).toBe("fail")
  })
})
