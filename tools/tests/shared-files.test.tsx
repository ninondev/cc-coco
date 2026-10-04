import { describe, expect, test } from 'claude-code/testing'
import { safeDiagnosticError } from '../hooks/shared-files'

describe('diagnostic error privacy', () => {
  test('fixed failure messages remain useful', () => {
    for (const message of ['cannot start tail', 'file read failed', 'store read failed', 'cannot read folder', 'first pull failed']) {
      expect(safeDiagnosticError(new Error(message))).toBe(`Error: ${message}`)
    }
    expect(safeDiagnosticError(new Error('environment 12: cannot start tail'))).toBe('Error: cannot start tail')
  })
  test('prompt, reply, file contents and outside paths never pass through', () => {
    for (const message of [
      'SECRET PROMPT please fix my private project', 'SECRET REPLY returned by the model',
      '{"private":"file contents"}', '/Users/owner/private/token.json could not be read',
      'C:\\Users\\owner\\private\\token.json could not be read',
      'cannot start tail /Users/owner/private/token.json',
    ]) expect(safeDiagnosticError(new Error(message))).toBe('Error: [redacted]')
    expect(safeDiagnosticError('SECRET PROMPT')).toBe('Error: [redacted]')
  })
  test('OS codes and standard error classes contain no arbitrary message text', () => {
    expect(safeDiagnosticError(new Error('ENOENT: /Users/owner/secret'))).toBe('Error: ENOENT')
    expect(safeDiagnosticError(new SyntaxError('SECRET FILE CONTENTS'))).toBe('SyntaxError: [redacted]')
    const custom = new Error('SECRET FILE CONTENTS'); custom.name = 'SECRET PROMPT'
    expect(safeDiagnosticError(custom)).toBe('Error: [redacted]')
  })
})
