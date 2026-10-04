import type { Engine } from 'claude-code/testing'
// A background host write has no clock delay. These inert core-command barriers let worker
// messages finish without advancing a timer or triggering a band/companion state change.
export async function drainFeed($: Engine): Promise<void> {
  for (let i = 0; i < 24; i++) await $.command.run({ command: 'feed-barrier', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
}
