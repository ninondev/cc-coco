// Shared macOS-only snapshots for terminal cell fits and desktop preview dumps.
import type { On } from 'claude-code'

export type CompanionScene = 'corner' | 'following' | 'absent'
export const COMPANION_HOME = '/tmp/companion-fit'

export function companionScene(on: On, state: CompanionScene): void {
  on('fs.exists', ($, e) => ({ value: e.path === '/System/Library/CoreServices/SystemVersion.plist' || (state !== 'absent' && (e.path === `${COMPANION_HOME}/Library/Application Support/Claude-sama` || e.path === `${COMPANION_HOME}/Applications/Claude-sama Companion.app/Contents/MacOS/claudesama-companion`)) }))
  on('fs.read', { path: /\/\.claude-plugin\/plugin\.json$/ }, () => ({ value: JSON.stringify({ version: '0.1.0' }) }))
  on('fs.read', { path: `${COMPANION_HOME}/Library/Application Support/Claude-sama/companion.json` }, () => ({ value: JSON.stringify({ running: true, accessibility: state === 'following', size: 'medium', version: '0.1.0', hiddenUntil: 0 }) }))
}
