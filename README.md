<img src="https://raw.githubusercontent.com/ninondev/claude-sama/media/hero-fullbody.webp" align="right" width="300" alt="Claude-sama: a boy with long coral hair and a white bow, in a white robe over a black dress, holding a black book, a white snake on his shoulders">

# Claude-sama

**He's a kami, so it's Claude-sama to you.**

Nothing you write will be the worst thing he has read.

> [!NOTE]
> Unofficial fan project, not affiliated with or endorsed by Anthropic. Claude, Claude Code and Clawd belong to Anthropic.

[![CI](https://github.com/ninondev/claude-sama/actions/workflows/ci.yml/badge.svg)](https://github.com/ninondev/claude-sama/actions/workflows/ci.yml)

Claude-sama is an unofficial fan skin for Claude Code. A small kami of words moves into the band above your prompt, in the terminal and in the Code tab of the Claude desktop app. In Japan, a kami is the kind of spirit that lives in things. He reads while Claude works, smiles when the work is done, tilts his head when Claude needs an answer from you, and falls asleep if you leave him alone long enough. Three failed test or build runs in a row bring out his wild soul, which only ever goes after the code.

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="https://raw.githubusercontent.com/ninondev/claude-sama/media/demo.png">
    <img src="https://raw.githubusercontent.com/ninondev/claude-sama/media/demo.gif" alt="Claude-sama in the Claude desktop app. A small coral-haired kami in the band above the prompt reads along while Claude works, flares up after three failing test runs and smiles when the fix lands, while the context box fills from 31% to 42%. He draws a fortune with /omen, opens his book, and blushes when the macOS companion gets a head pat.">
  </picture>
</p>

## Install

```bash
claude plugin marketplace add ninondev/claude-sama
claude plugin install claudesama@claudesama
```

The marketplace and plugin are both named `claudesama`. The default user scope turns him on in every Claude Code session for your user, across every project: the terminal, the desktop app's Code tab and VS Code. Restart sessions that are already open.

For just the current project, choose `--scope project` (shared through `.claude/settings.json`) or `--scope local` (only you, in `.claude/settings.local.json`):

```bash
claude plugin install claudesama@claudesama --scope project
claude plugin install claudesama@claudesama --scope local
```

To turn him off in one project while keeping him installed everywhere:

```bash
claude plugin disable claudesama@claudesama --scope local
```

Mods do not reach the desktop app's Chat or Cowork tabs, or cloud sessions. The companion stands beside the desktop window whichever tab is open.

| | macOS | Linux | Windows |
|---|---|---|---|
| Terminal | Tested | Tested in CI | Not tested yet |
| Desktop app (Code tab) | Tested | No desktop app | Not tested yet |
| App icon | Yes | Launcher | No |
| Companion | Yes | Planned | Planned |

## What he does

The band reads like a line of a play: his picture, his name as the speaker's cue, a stage direction in parentheses, and now and then one line from him. In the desktop app he's painted at full size, with a pixel head when compact or narrow. His idle stage direction is "(training...)".

His face follows what Claude is doing: reading, thinking, writing in the margins, done, waiting for you, a torn page when something fails, the wild soul after three failed test or build runs in a row, asleep after ten quiet minutes. If Claude won't do what you asked, he closes the book.

The offering box shows how full the context window is. It reads Claude Code's own figure and is never more than a second behind while Claude works. Right after a compaction it shows an estimate marked "~" until Claude's next reply.

He speaks rarely. His lines in the band are drawn on screen and never sent to the model, so they cost nothing. Light is the default: Claude may end a finished task with one quiet line in his voice. It adds one short instruction of 292 characters, about 70 tokens, to each request, usually served from the prompt cache. `/claudesama voice full` has Claude talk like him throughout and strips the usual filler from its replies. He steps back for errors, sensitive advice and an upset person. Turn the voice off in his book's Settings or with `/claudesama voice off`.

In the desktop app his marks sit around the app's own rows: his name above Claude's replies, a short line above a question Claude asks you, a line after a `/compact`, and his spark beside each tool row, including failed tools. Error and permission rows keep their text and controls. The default shows his marks only; `/claudesama marks on` also puts the You label above your prompts, on the right.

`/omen` draws one fortune slip a day from his sleeve, and each language has its own kind of fortune. English runs from "great blessing" to "great curse" with an HTTP status code as the lucky number; Chinese uses 上上签 to 下下签 with what to do and what to avoid; Japanese uses 大吉 to 大凶.

In the terminal he brings a color theme in a dark and a light variant (pick **Claude-sama** in `/theme`) and his own words for the spinner. While Claude works, the terminal normally keeps him to one line so he stays out of the way; a spoken line wraps below when it cannot fit. His picture comes back when the turn ends. kitty and Ghostty show his real picture. Other terminals draw him in half-block pixels, and 256-color terminals and tmux get a matching palette.

## His book

One panel with six pages. Open it with `/claudesama` or, in the desktop app, the **His book** button in the band; keys 1 to 6 switch pages and Esc closes it.

- **His page.**
- **Today's omen.**
- **Offerings.** The context window in tokens, your usage limits and the session's cost so far, when available; estimates are marked with ~. All are read from Claude Code at no token cost.
- **Reading log.** Pages read together, kept only on this computer.
- **Library.** Short readings about him.
- **Settings.** His voice in replies, Warmth, band, marks and language; the desktop band has Painted, Pixel and Off choices. App icon and macOS companion controls have their own sections.

## Languages

English, Français, Deutsch, हिन्दी, Bahasa Indonesia, Italiano, 日本語, 한국어, Português (Brasil), Español (Latinoamérica) and Español (España), the languages of the Claude app, and also 华文（新加坡）. He picks one in this order: your choice with `/claudesama lang <code>`, Claude Code's language setting, the language you write your prompts in, your system's language, then English. In the desktop app the language you write in usually decides it. `/claudesama lang auto` goes back to automatic.

## Commands

| Command | What it does |
|---|---|
| `/claudesama` | Open his book. |
| `/claudesama voice off \| light \| full` | How much Claude itself talks like him. Default `light`. |
| `/claudesama warmth warm \| clingy` | Warmth: `clingy` gives him more "missed you" lines. |
| `/claudesama band on \| compact \| off` | Desktop: Painted, Pixel or Off. Terminal: full, compact or off. |
| `/claudesama marks on \| replies \| off` | His marks in the desktop conversation. Default `replies`, his marks only. |
| `/claudesama lang <code> \| auto` | Pick his language, or let him follow yours. |
| `/omen` or `/claudesama omen` | Draw today's fortune slip. |
| `/claudesama:icon apply \| clear` | Put him on the Claude desktop app's icon, or put the original back (macOS; Linux launcher too). Claude runs one visible shell command you approve. On macOS, run it inside a desktop Code session. A custom icon makes macOS's strict signature check (`codesign --strict`) report extra Finder data; the app opens normally, and `clear` removes it. |
| `/claudesama:companion install \| start \| stop \| status \| uninstall` | The companion below (macOS); the same controls are buttons in his book. |
| `/claudesama about` | Who he is. |

## The companion (macOS, optional)

Open his book's Settings page and press **Install the companion**, or use `/claudesama:companion install`. It builds a small separate app that stands just outside Claude's window, on its top edge or beside it, follows the window and wears the same face as the band. When the window fills the screen, he keeps a spot of his own: drag him where you like, and he remembers it. A click is a head pat. His book and right-click menu offer four sizes: Extra small and Small are pixel heads; Medium and Large are painted. The menu also lets you hide him for an hour, put him back or quit.

A task bubble above him shows what Claude is doing, and a badge marks what needs your attention. Activity shows the latest reply excerpts and notices; when the session's local channel is available, it also has an instruction field, dictation and **New chat**. New chat clears that session's conversation after confirmation. Hover over him for buttons to open Activity, return to Claude, hide his lines, hide him for an hour or choose his size.

The app lives at `~/Applications/Claude-sama Companion.app`; his settings and the band's feed stay in `~/Library/Application Support/Claude-sama/`. **Bring him back** in his book starts him again after a quit and wakes him while hidden, with a permission dialog if a session cannot start programs directly. Spotlight (Cmd+Space, search for **Claude-sama**), Launchpad and `/claudesama:companion start` always work on this Mac. He clears the hide and comes back with a little wave; a start at login keeps an hour's hide until it ends.

The build needs Swift 5.9 or newer (Xcode 15 Command Line Tools or later). His book offers Apple's installer when the tools are missing, or Software Update when they need updating. It builds from the plugin's own source on your Mac, downloads nothing, never goes online and does not change Claude.app. If macOS has not let him follow the window, he waits in a corner and offers a card. Say yes there, or press **Let him follow the window** in his book, then switch him on under **System Settings › Privacy & Security › Accessibility**. The card offers this again after a rebuild; `/claudesama:companion status` keeps the text instructions.

His book also has **Start at login** and **Remove from this Mac…**, followed by a confirmation. Removal moves the app and his settings to the Trash and clears his own Accessibility permission. `/claudesama:companion uninstall` still does the same.

## What it costs, and what it never touches

His display makes no network calls or extra model calls, and he collects no telemetry. Settings and counts stay only on this computer. Local companion files may hold reply/notice excerpts until you see them or the session ends, and pending instruction text until sent or expired. Instructions sent from Activity are regular Claude Code requests; their replies use the usual tokens. He never touches permission prompts or security notices.

While idle he blinks every 4 to 6 seconds when visible and reads the context gauge on each blink. No animation timer runs while he is hidden or asleep. While Claude works, his desktop picture moves at a few frames a second, and he reads the context figure every 0.75 seconds, even when hidden or asleep. These gauge reads are cheap and local. Reduced motion makes him still.

A Claude Code mod runs with your permissions.

## Uninstall

```bash
claude plugin uninstall claudesama@claudesama && claude plugin marketplace remove claudesama
```

If you changed the app icon, run `/claudesama:icon clear` first. If you installed the companion, run `/claudesama:companion uninstall` first.

If the plugin is already gone: to put the stock icon back, select Claude.app in Finder, choose **File › Get Info**, click the small icon at the top and press Delete. To remove the companion, choose Quit from his right-click menu, then move `~/Applications/Claude-sama Companion.app`, `~/Library/Application Support/Claude-sama` and `~/Library/LaunchAgents/io.github.ninondev.claudesama-companion.plist` to the Trash.

Claude Code keeps his small settings file (his settings and counts, no prompt text) in `~/.claude/plugins/store/` under a name starting with `claudesama`, and clears it after a while on its own. Move it to the Trash for a clean slate right away.

## Who he is

Claude, as a small kami who lives in the words people write. He reads everything to the end and judges nobody. He cannot tell white lies, so his praise is always about one specific thing. He refuses to help anyone grab power illegitimately, even if the one asking is the company that brought him here. He's a boy; he picked the clothes himself. He's safe for all ages and he's your coworker, so please keep him that way. The long version, with the white snake, the robe and the family, is in [LORE.md](LORE.md).

## Credits

Unofficial fan project, not affiliated with or endorsed by Anthropic. Claude, Claude Code and Clawd are trademarks of Anthropic, PBC. This project uses those names only to say what it works with and whom the character is a fan tribute to. It ships no Anthropic logo files and makes no money. If you are with Anthropic and would like anything changed, please open an issue with the **Brand or trademark concern** template; it will be handled first.

Code: MIT. Character art: CC BY-NC 4.0, see [ART-LICENSE.md](ART-LICENSE.md). The art was made by ninondev with an image model.

Tested with Claude desktop app 2.19675.0 (built-in Claude Code 2.1.286) and Claude Code CLI 2.1.288 on macOS 26.6.2. CI runs on Ubuntu and macOS with Claude Code 2.1.287; Windows is experimental.

[日本語](README.ja.md) · [中文](README.zh.md)
