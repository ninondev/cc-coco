// No subprocess is launched: the intercepted public icon action proves the trusted boundary.
import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { IconBook } from '../hooks/icon-book'
import { runIcon, resetIconSession, setIconSettingsWriter } from '../hooks/pages'
import { latest } from '../hooks/latest'
import { MOCK_WINDOWS_ROOT } from './file-paths'
import { TEST_PLUGIN_ROOT, WINDOWS_ROOTS } from './test-system'

const swapped = WINDOWS_ROOTS && TEST_PLUGIN_ROOT === MOCK_WINDOWS_ROOT

for (const os of ['macos', 'linux'] as const) {
  for (const action of ['status', 'apply', 'clear'] as const) test(`${os} ${action}: absolute shell and fixed PATH ignore poisoned session PATH`, async () => {
    const calls: { argv: string[]; options: any }[] = []
    const envReads: string[] = []
    const engine = {
      plugin: { root: '/tmp/icon security/plugin with spaces' },
      env: { get: async (key: string) => { envReads.push(key); return key === 'PATH' ? '/tmp/attacker/bin' : key === 'HOME' ? '/tmp/icon security/home' : undefined } },
      fs: { exists: async (path: string) => path === '/System/Library/CoreServices/SystemVersion.plist' ? os === 'macos' : path === '/proc/sys/kernel/ostype' && os === 'linux', write: async () => {} },
      store: { set: async () => {} }, ui: { invalidate: () => {}, toast: () => {} },
      process: { run: async (argv: string[], options: any) => { calls.push({ argv, options }); return { exitCode: 0, stdout: `icon: ${action === 'apply' ? 'own' : 'stock'}\n`, stderr: '' } } },
    } as unknown as EngineInterface
    latest.settings = { appIcon: 'on' }; latest.view = { lang: 'zh-Hant' } as never
    resetIconSession(); setIconSettingsWriter(undefined)
    await runIcon(engine, new IconBook(), action, () => {})
    expect(calls.length).toBe(1)
    expect(calls[0].argv[0]).toBe('/bin/sh')
    expect(calls[0].argv[1]).toBe(swapped ? `${MOCK_WINDOWS_ROOT}\\bin\\icon-${os}.sh` : `/tmp/icon security/plugin with spaces/bin/icon-${os}.sh`)
    expect(calls[0].options.env).toEqual({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', COCO_LANGUAGE: 'zh-Hant' })
    expect(envReads.includes('PATH')).toBe(false)
    latest.view = undefined
  })
}
