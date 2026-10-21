// NOTICES 1.2: the message is read from the command the transcript shows, never from .git.
import { describe, expect, test } from 'bun:test'
import { executeNoticeAlgo } from '../../notice-core'
import { commitMessage } from '../../notice/gitmsg'

describe('what a command says about its message', () => {
  test.each([
    ['one -m', 'git commit -m "Fix the thing"', 'Fix the thing'],
    ['several -m are joined by blank lines, as git joins them', 'git commit -m "Subject" -m "Body para"', 'Subject\n\nBody para'],
    ['-am', 'git commit -am "all of it"', 'all of it'],
    ['--message=', 'git commit --message="long form"', 'long form'],
    ['single quotes', "git commit -m 'single quoted'", 'single quoted'],
    ['after git add', 'git add -A && git commit -m "x y z"', 'x y z'],
    ['git -C dir', 'git -C repo commit -m "in repo"', 'in repo'],
    ['a trailing comment', 'git commit -m "Retry once" # note', 'Retry once'],
    ['a newline inside the quotes', 'git commit -m "line one\nline two"', 'line one\nline two'],
    ['Claude Code\'s own cat heredoc', 'git commit -m "$(cat <<\'EOF\'\nSubject line\n\nBody (with an unbalanced paren\nmore\nEOF\n)"', 'Subject line\n\nBody (with an unbalanced paren\nmore'],
    ['-F - with a heredoc', 'git commit -F - <<\'EOF\'\nHeredoc subject\n\nHeredoc body\nEOF', 'Heredoc subject\n\nHeredoc body'],
    ['--file=- with a heredoc', 'git commit --file=- <<EOF\nA subject\n\nA body\nEOF', 'A subject\n\nA body'],
  ])('%s', (_, command, message) => expect(commitMessage(command)).toBe(message))

  test.each([
    ['-F <path>', 'git commit -F msg.txt'],
    ['--no-edit', 'git commit --no-edit'],
    ['--amend alone keeps the old message', 'git commit --amend'],
    ['-C reuses a message', 'git commit -C HEAD'],
    ['two commits in one command', 'git commit -m "a" && git commit -m "b"'],
    ['not a commit', 'git status'],
    ['a string that mentions one', 'echo "git commit -m nope"'],
    ['a merge', 'git merge feature -m "merge it"'],
    ['a cherry-pick', 'git cherry-pick abc1234'],
  ])('%s gives nothing', (_, command) => expect(commitMessage(command)).toBeUndefined())
})

describe('the worker op reads the command', () => {
  const body = 'The refresh call fails when the laptop wakes from sleep because the network is not up yet, so people were logged out mid-draft.'
  test('a good message in a heredoc gets its quality and quote; a bad one gets null', () => {
    const good = `git commit -m "$(cat <<'EOF'\nRetry the token refresh once\n\n${body}\nEOF\n)"`
    expect(executeNoticeAlgo({ op: 'commit', command: good })).toEqual({ quality: 'why', quote: 'because the network is not up yet' })
    expect(executeNoticeAlgo({ op: 'commit', command: 'git commit -m "wip"' })).toBeNull()
    expect(executeNoticeAlgo({ op: 'commit', command: 'git commit --no-edit' })).toBeNull()
    expect(executeNoticeAlgo({ op: 'commit' })).toBeNull()
  })
})

describe('the bare op: a lone fix and a message Claude wrote (lane C, 10-14)', () => {
  test('a lone "fix" in any case, with a stop or a bang, is the uwu threat; anything more is not', () => {
    for (const c of ['git commit -m "fix"', "git commit -am 'Fix.'", 'git commit -m "FIX!"']) expect(executeNoticeAlgo({ op: 'bare', command: c })).toEqual({ fix: true, claude: false })
    for (const c of ['git commit -m "fix typo"', 'git commit -m "fixed"', 'git commit -m "fix: nothing"']) expect((executeNoticeAlgo({ op: 'bare', command: c }) as any).fix).toBe(false)
  })
  test("Claude's trailer or its generated line marks the message as Claude's", () => {
    expect((executeNoticeAlgo({ op: 'bare', command: 'git commit -m "Retry once" -m "Co-Authored-By: Claude Opus <noreply@anthropic.com>"' }) as any).claude).toBe(true)
    expect((executeNoticeAlgo({ op: 'bare', command: 'git commit -m "Retry once" -m "Generated with [Claude Code](https://claude.com/claude-code)"' }) as any).claude).toBe(true)
    expect((executeNoticeAlgo({ op: 'bare', command: 'git commit -m "Retry once" -m "Thanks to Claude for the idea"' }) as any).claude).toBe(false)
  })
  test('no message, no answer; nothing of the text comes back', () => {
    expect(executeNoticeAlgo({ op: 'bare', command: 'git status' })).toBeNull()
    expect(Object.keys(executeNoticeAlgo({ op: 'bare', command: 'git commit -m "fix"' }) as object).sort()).toEqual(['claude', 'fix'])
  })
})
