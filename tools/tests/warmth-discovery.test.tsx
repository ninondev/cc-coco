// The public help names warmth; the old affection verb remains accepted for existing users.
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PERSON, P, RECENT, world } from './world'

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

    expect(registrations.find(command => command.name === 'claudesama')).toEqual({
      name: 'claudesama',
      description: 'Claude-sama: his voice, warmth, the band, language, omen, about',
      argumentHint: '[voice|warmth|band|lang|omen|about] [value]',
    })

    await $.command.run({ command: 'claudesama', args: 'help', origin: PERSON, presentation: P })
    expect(w.toasts.at(-1)).toContain('warmth warm|clingy')

    await $.command.run({ command: 'claudesama', args: 'affection clingy', origin: PERSON, presentation: P })
    expect(w.view().affection).toBe('clingy')
  })
})
