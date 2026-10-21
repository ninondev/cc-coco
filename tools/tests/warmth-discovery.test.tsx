import { installM1Words } from './m1-more-data-fixture'
// The public help names warmth; the old affection verb remains accepted for existing users.
import { gapWord } from '../hooks/mod-gaps-words'
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PERSON, P, RECENT, world, settleLegacyStart } from './world'


installM1Words()

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }

describe('warmth command discovery', () => {
  test('help discovers warmth and the affection compatibility alias still changes the setting', async ($, on) => {
    const registrations: Record<string, unknown>[] = []
    // Instrument the fixture's existing command.register responder so there is one responder,
    // with the same behavior as world(), and capture the input the plugin actually registers.
    const baseOn = on as (...args: any[]) => any
    const watchedOn = ((...args: any[]) => {
      if (args[0] === 'command.register' && typeof args[1] === 'function') {
        const handler = args[1]
        return baseOn(args[0], async (...callArgs: any[]) => {
          registrations.push(callArgs[1] as Record<string, unknown>)
          return handler(...callArgs)
        })
      }
      return baseOn(...args)
    }) as On
    const w = world(watchedOn, { store: RECENT })
    await $.session.start(START)
    await settleLegacyStart($,w)

    expect(registrations.find(command => command.name === 'coco')).toEqual({
      name: 'coco',
      description: gapWord('en','cmd.coco'),
      argumentHint: '[voice|warmth|band|lang|vibe|dm|focus|about|companion|icon|more|say|cards] [value]',
    })

    await $.command.run({ command: 'coco', args: 'help', origin: PERSON, presentation: P })
    expect(w.toasts.at(-1)).toContain('warmth warm|clingy')

    await $.command.run({ command: 'coco', args: 'affection clingy', origin: PERSON, presentation: P })
    expect(w.view().affection).toBe('clingy')
  })
})
