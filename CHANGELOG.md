# Changelog

Everything that changes in Claude-sama goes here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow
[Semantic Versioning](https://semver.org/) with one addition of my own: a fourth number,
like 0.1.0.1, means small fixes only.

When his personality changes (how he talks, what he says, how he acts), I give it its own
"Persona changes" part, because that changes how the mod feels even when it doesn't change
what it does. Each one comes with a way back: the setting, or the version, that brings the
old behavior back.

## [Unreleased]

### Changed

- Windows: the repo keeps Unix line endings now, so his command files can be read there too.
  Windows is still untested.

### Persona changes

- Two of his Chinese lines are reworded: the good-morning one starts with (哈欠)哇... instead
  of 哈欠..., and the one for starting work is 撸起袖子,开工～ instead of 挽起袖子,开工.
  Rollback: 0.1.0.1.

## [0.1.0.1] - 2026-10-03

Small fixes, mostly words. Nothing new to learn.

### Changed

- I rewrote the README in English, Chinese and Japanese in my own words, and there's a new
  part about why I made him. The button and setting names in it now match the app exactly.
- He praises "something specific" now, instead of "one specific thing" (README and LORE).
- The help text for his marks says "tool calls" instead of "tool rows".
- The companion's Activity says "Not sure it arrived" instead of "No confirmation yet", and
  "Timed out" instead of "Confirmation window ended" (its built-in fallback words too).
- The size previews in his book no longer read out "half size" to screen readers.
- Chinese: his about line says 看过更糟的 now, like the README.
- Japanese: one name each for the companion (コンパニオン) and its size (サイズ).
- Reduce motion goes by macOS's own name now in Japanese (視差効果を減らす), French and
  Hindi.
- The plugin and marketplace descriptions are in my words now.

### Persona changes

- None. He talks and acts the same as in 0.1.0.

### Notes

- After you update, his book shows **Update him** for the companion. The rebuilt app needs
  macOS's Accessibility permission once more: say yes on his card, or press **Let him follow
  the window** in his book.

## [0.1.0] - 2026-10-03

The first public release. Here's everything he came with.

### Added

- The band above the prompt, in the terminal and the desktop Code tab. In the desktop app
  he's painted, or a pixel head when you pick Pixel or the window is narrow. His face follows
  what Claude is doing, and when nothing's going on the stage direction says "(training...)".
  After ten quiet minutes he falls asleep, and three failed test or build runs in a row bring
  out his wild soul.
- The offering box: how full your context window is, straight from Claude Code. Right after a
  compaction it shows an estimate marked "~" until the next reply.
- His book, with six pages: his page, today's omen, offerings, reading log, library and
  Settings. Settings covers his voice in replies, Warmth, the band, the app icon and the macOS
  companion.
- His marks in the desktop conversation: above replies and questions, after `/compact` and
  next to tool calls. By default only his own show, and errors and permission prompts keep
  their own text and buttons.
- `/omen`: one fortune slip a day, and every language has its own kind of fortune.
- Twelve languages. He picks one by himself, or you choose with `/claudesama lang <code>`.
- For the terminal: dark and light themes, his own spinner words, his real picture in kitty
  and Ghostty, half-block art everywhere else, and a palette for 256-color terminals and tmux.
  While Claude works he usually takes just one line; a spoken line wraps below if it doesn't
  fit.
- App icon buttons for macOS and Linux launchers, with a way back to the original.
- A macOS companion, if you want one: four sizes (pixel heads at the two small ones). He
  follows the window, reacts when you touch him, blinks while idle, shows what Claude is doing
  in a bubble, wears a badge when something needs you and has buttons when you hover.
  Activity shows short excerpts of Claude's latest replies and notices; if the session can
  take messages from him, you can type or dictate an instruction there or start a new chat. A
  card asks for the Accessibility permission he needs to follow the window. He installs to
  `~/Applications/Claude-sama Companion.app`, and **Bring him back** returns him after you
  hide or quit him.
- Offline plugin checks and tests in CI on Ubuntu and macOS, plus an experimental Windows
  job. His lines and voice ship inside the plugin.

### Persona changes

- His lines in the band are drawn on your screen and never sent to the model.
- Light voice is the default: Claude may end a finished task with one quiet line in his
  voice. That instruction is 292 characters, about 70 tokens, usually served from the prompt
  cache. `voice full` uses his voice all the way through and cuts the filler; `voice off`
  takes it out of replies. The voice drops out for errors, for security, health, legal or
  money topics, and for anyone who is upset.
- Warmth starts at `warm`; `/claudesama warmth clingy` gives you more "missed you" lines.
- The wild soul only ever goes after the code, never you. I wrote him to be safe for all ages.
- Rollback: `/claudesama voice off|light|full` for Claude's replies, `/claudesama band off`
  for the band, `/claudesama marks off` for the desktop marks. 0.1.0 is the first version, so
  there's nothing earlier to go back to.

### Notes

- Tested with Claude desktop app 2.19675.0 (built-in Claude Code 2.1.286) and Claude Code CLI
  2.1.288 on macOS 26.6.2. CI uses Claude Code 2.1.287 on Ubuntu and macOS; Windows is
  experimental.
- Unofficial fan project, not affiliated with or endorsed by Anthropic. Code is MIT; character
  art is CC BY-NC 4.0, see ART-LICENSE.md.
- He makes no network or model calls to be on screen, and there's no telemetry. Instructions
  you send from Activity are normal Claude Code requests and cost tokens as usual. Like any
  mod, he runs with your permissions.
- The desktop app doesn't tell mods your language setting, so there he follows the language
  you type in.

[Unreleased]: https://github.com/ninondev/claude-sama/compare/v0.1.0.1...HEAD
[0.1.0.1]: https://github.com/ninondev/claude-sama/compare/v0.1.0...v0.1.0.1
[0.1.0]: https://github.com/ninondev/claude-sama/releases/tag/v0.1.0
