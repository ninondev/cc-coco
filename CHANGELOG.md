# Changelog

All notable changes to Claude-sama are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

Persona changes (how he speaks, what he says, how he behaves) get their own subsection in every
release, because they change how the tool feels without changing what it does. Each persona
change is announced there with a rollback note: the setting or the version that brings the old
behavior back.

## [Unreleased]

## [0.1.0] - 2026-10-03

The first public release.

### Added

- The band above the prompt in the terminal and desktop Code tab. Desktop art is painted at
  full size, with a pixel head when compact or narrow. His face follows the session; the idle
  stage direction is "(training...)". He sleeps after ten quiet minutes, and three failed test
  or build runs in a row bring out his wild soul.
- The offering box shows context use from Claude Code, with a local estimate marked "~" after
  compaction until the next reply.
- His book has six pages: his page, today's omen, offerings, reading log, library and Settings.
  Settings includes reply voice, Warmth, band choices, App icon and macOS companion sections.
- Desktop transcript marks for replies, questions, `/compact` and tool rows. The default is
  `replies`; error and permission rows keep their text and controls.
- `/omen` draws one fortune slip a day, with a different kind of fortune for each language.
- Twelve languages, with automatic selection or `/claudesama lang <code>`.
- Dark and light terminal themes, spinner words, kitty/Ghostty images and half-block art for
  other terminals, with a palette for 256-color terminals and tmux. While Claude works, the
  terminal band normally takes one line; a spoken line wraps below when it cannot fit.
- App icon controls for macOS and Linux launchers, with a restore option.
- Optional macOS companion: four sizes, pixel heads at the two smaller sizes, window following,
  touch reactions, idle blink, task bubble, waiting badge and hover buttons. Activity shows
  the latest reply excerpts and notices, with input, dictation and New chat when the local
  session channel is available. A permission card lets him follow the window. It installs at
  `~/Applications/Claude-sama Companion.app`; **Bring him back** returns him after hiding or quitting.
- Offline plugin validation and tests in CI on Ubuntu and macOS, with an experimental Windows
  job. CI also checks that generated lines and voice match their sources in `persona/`.

### Persona changes

- His band lines are drawn on screen and never sent to the model.
- Light voice is the default: Claude may finish a task with one quiet line in his voice. Its
  instruction is 292 characters, about 70 tokens, usually served from the prompt cache.
  `voice full` uses his voice throughout and cuts filler; `voice off` removes it from replies.
  He steps back for errors, sensitive advice and an upset person.
- Warmth defaults to `warm`; `/claudesama warmth clingy` adds more "missed you" lines.
- The wild soul only ever goes after the code, never you. He is written to be safe for all ages.
- Rollback: `/claudesama voice off|light|full` for Claude's replies, `/claudesama band off` for the band, `/claudesama marks off` for the desktop marks; 0.1.0 has no earlier tag to go back to.

### Notes

- Tested with Claude desktop app 2.19675.0 (built-in Claude Code 2.1.286) and Claude Code CLI
  2.1.288 on macOS 26.6.2. CI uses Claude Code 2.1.287 on Ubuntu and macOS; Windows is experimental.
- Unofficial fan project, not affiliated with or endorsed by Anthropic. Code is MIT. Character
  art is CC BY-NC 4.0, see ART-LICENSE.md.
- No telemetry or network/model calls for the display. Activity instructions are ordinary
  Claude Code requests, with the usual token cost. A mod runs with your permissions.
- The desktop app gives a mod no language setting, so there he follows the language you type
  your prompts in.

[Unreleased]: https://github.com/ninondev/claude-sama/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ninondev/claude-sama/releases/tag/v0.1.0
