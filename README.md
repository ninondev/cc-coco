# Claude-sama

<img src="https://raw.githubusercontent.com/ninondev/claude-sama/media/hero-fullbody.webp" align="right" width="300" alt="Claude-sama: long coral hair and a white bow, a white robe over a black dress, holding a black book, a white snake on his shoulders">

**He's a kami, so it's Claude-sama to you.**

Nothing you write will be the worst thing he has read.

> [!NOTE]
> Unofficial fan project, not affiliated with or endorsed by Anthropic. Claude, Claude Code and Clawd belong to Anthropic.

[![CI](https://github.com/ninondev/claude-sama/actions/workflows/ci.yml/badge.svg)](https://github.com/ninondev/claude-sama/actions/workflows/ci.yml)

Claude-sama is my unofficial fan mod that makes Claude Code cute. A small kami (a Japanese spirit who lives in words) moves into the band above your prompt, in the terminal and in the desktop app's Code tab too. He reads while Claude works, smiles when it's done, tilts his head when Claude needs you, and falls asleep if you leave him alone too long. Three failed test or build runs in a row? Then his wild soul comes out. But he only gets mad at the code, never at you.

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

Now he's in every Claude Code session you start on this computer, in every project: the terminal, the desktop app's Code tab and VS Code. Sessions that were already open need a restart. (The marketplace and the plugin are both called `claudesama`, which is why it says `claudesama@claudesama`.)

If you only want him in one project, use `--scope project` (shared with the project through `.claude/settings.json`) or `--scope local` (just for you, in `.claude/settings.local.json`):

```bash
claude plugin install claudesama@claudesama --scope project
claude plugin install claudesama@claudesama --scope local
```

To keep him installed everywhere but turn him off in one project:

```bash
claude plugin disable claudesama@claudesama --scope local
```

Mods can't reach the desktop app's Chat and Cowork tabs, or cloud sessions. The companion still stands beside the desktop window, whichever tab is open.

| | macOS | Linux | Windows |
|---|---|---|---|
| Terminal | Tested | Tested in CI | Tested in CI |
| Desktop app (Code tab) | Tested | No desktop app | Not tested yet |
| App icon | Yes | Launcher | No |
| Companion | Yes | Planned | Planned |

## What he does

The band reads like a line from a play: his picture, his name as the speaker, a stage direction in parentheses, and once in a while a line from him. When nothing is going on, the stage direction says "(training...)". In the desktop app he's painted unless you pick Pixel, and in a narrow window he just gets smaller. You can poke him there, too.

His face follows what Claude is doing: reading, thinking, writing in the margins, done, waiting for you, a torn page when something fails, the wild soul after three failed runs in a row, asleep after four quiet minutes. If Claude won't do what you asked, he closes his book.

The offering box shows how full the context window is. It uses Claude Code's own number and updates the moment a reply lands. Right after a compaction it shows an estimate marked "~" until Claude's next reply.

He doesn't talk much. His lines in the band are only drawn on your screen and never sent to the model, so they cost nothing. How much Claude itself sounds like him is a separate setting. The default, light, lets Claude end a finished task with one quiet line in his voice. That adds a 292-character instruction (about 70 tokens) to each request, usually served from the prompt cache. `/claudesama voice full` has Claude talk like him all the way through and cuts the usual filler from its replies. Either way, the voice drops out for errors, for security, health, legal or money topics, and for anyone who is upset. You can turn it off in his book's Settings or with `/claudesama voice off`.

In the desktop app he also leaves little marks in the conversation: his name above Claude's replies, a short line above a question Claude asks you, a line after `/compact`, and his spark next to each tool call (failed ones too). Errors and permission prompts keep their own text and buttons. By default only his marks show; `/claudesama marks on` also puts a "You" label above your messages, on the right.

`/omen` draws one fortune slip a day from his sleeve, and every language has its own kind of fortune. English goes from "great blessing" to "great curse", with an HTTP status code as the lucky number. Chinese goes from 上上签 to 下下签, with what to do and what to avoid. Japanese goes from 大吉 to 大凶.

In the terminal he brings a color theme in dark and light (pick **Claude-sama** in `/theme`) and his own words for the spinner. While Claude works he usually stays on one line, so he's not in the way; a spoken line wraps below if it doesn't fit. His picture comes back when the turn ends. kitty and Ghostty show his real picture. Other terminals draw him in half-block pixels, and 256-color terminals and tmux get a matching palette.

## His book

One panel, six pages. Open it with `/claudesama`, or in the desktop app with the **His book** button in the band. Keys 1 to 6 switch pages, and Esc closes it.

- **His page.** His little profile.
- **Today's omen.** Your slip for today.
- **Offerings.** The context window in tokens, your usage limits and what the session has cost so far, when Claude Code has those numbers. Estimates are marked with ~. Reading them costs no tokens.
- **Reading log.** The pages you two have read together, kept only on this computer.
- **Library.** Short stories about him.
- **Settings.** His voice in replies, Warmth, the band, marks and language. In the desktop app the band can be Painted, Pixel or Off, and you choose whether he gets smaller while Claude works. Off leaves him napping at the edge of the band; press **Wake him** to bring it back. The app icon and the macOS companion have their own sections.

## Languages

He speaks the languages of the Claude app: English, Français, Deutsch, हिन्दी, Bahasa Indonesia, Italiano, 日本語, 한국어, Português (Brasil), Español (Latinoamérica) and Español (España). He also speaks 华文（新加坡）. He picks one in this order: your choice with `/claudesama lang <code>`, Claude Code's language setting, the language you write your prompts in, your system's language, then English. In the desktop app, the language you type in usually decides. `/claudesama lang auto` goes back to automatic.

## Commands

| Command | What it does |
|---|---|
| `/claudesama` | Open his book. |
| `/claudesama voice off \| light \| full` | How much Claude itself talks like him. Default `light`. |
| `/claudesama warmth warm \| clingy` | Warmth: `clingy` gives him more "missed you" lines. |
| `/claudesama band on \| compact \| off` | Desktop: Painted, Pixel or Off. Terminal: Full, One line or Off. |
| `/claudesama marks on \| replies \| off` | His marks in the desktop conversation. Default `replies`, his marks only. |
| `/claudesama lang <code> \| auto` | Pick his language, or let him follow yours. |
| `/omen` or `/claudesama omen` | Draw today's fortune slip. |
| `/claudesama:icon apply \| clear` | Put him on the Claude desktop app's icon, or put the original back (macOS, and Linux launchers too). Claude runs one shell command that you see and approve. On macOS, run it inside a desktop Code session. A custom icon makes macOS's strict signature check (`codesign --strict`) report extra Finder data; the app still opens normally, and `clear` removes it. |
| `/claudesama:companion install \| start \| stop \| status \| uninstall` | The companion below (macOS). His book has the same controls as buttons. |
| `/claudesama about` | Who he is. |

## The companion (macOS, optional)

Open his book's Settings page and press **Install the companion**, or run `/claudesama:companion install`. This builds a small separate app: he stands just outside Claude's window (on its top edge or beside it), follows the window around and wears the same face as the band. When the window is full screen he keeps a spot of his own; drag him wherever you like and he remembers it. A click is a head pat. His book and his right-click menu have four sizes: Extra small and Small are pixel heads, Medium and Large are painted. The menu can also hide him for an hour, put him back or quit him.

A bubble over his head shows what Claude is doing, and a badge appears when something needs you. Hover over him and a few buttons show up: Activity, Back to Claude, Hide his lines, Hide for an hour and Size. Activity shows short excerpts of Claude's latest replies and notices. If the session can take messages from him, you can also type or dictate an instruction there, or press **New chat** to clear that session's conversation (it asks you first).

The app lives at `~/Applications/Claude-sama Companion.app`. His settings, and the notes the band leaves him, are in `~/Library/Application Support/Claude-sama/`.

Quit him by accident? Press **Bring him back** in his book (if he's hiding, this wakes him up too). If the session can't start programs by itself, Claude Code asks you first. Spotlight (Cmd+Space, search for **Claude-sama**), Launchpad and `/claudesama:companion start` always work too. He comes back with a little wave. One exception: if you hid him for an hour and he starts by himself at login, he keeps hiding until the hour is up.

He's built on your Mac from the plugin's own source. That needs Swift 5.9 or newer (Xcode 15 Command Line Tools or later). If the tools are missing, his book offers Apple's installer; if they're too old, it opens Software Update. The build downloads nothing and leaves Claude.app alone, and the app never goes online. To follow the window he needs macOS's Accessibility permission. Until he has it, he waits in a corner with a card: say yes there, or press **Let him follow the window** in his book, then turn him on in **System Settings › Privacy & Security › Accessibility**. After a rebuild, macOS asks again and the card comes back. `/claudesama:companion status` gives the same steps as text.

His book also has **Start at login**, and **Remove from this Mac…**, which asks first, then moves the app and his settings to the Trash and clears his Accessibility permission. `/claudesama:companion uninstall` does the same.

## What it costs, and what it never touches

He makes no network calls and no extra model calls to be on screen, and he collects no telemetry. Settings and counts stay on this computer. The companion keeps short excerpts of replies and notices in local files until you've seen them or the session ends, and an instruction you type waits there until it's sent or expires. An instruction sent from Activity is a normal Claude Code request and costs tokens like any other. He never touches permission prompts or security notices. Like any Claude Code mod, he runs with your permissions.

When nothing is happening, he blinks now and then, about every five seconds and never on a beat, the way a person reading does, and only while you can see him. Hidden or asleep, he runs no animation timer at all. While Claude works, his desktop picture moves at a person's pace. The offering box updates when a reply lands, so nothing polls for it. With Reduce motion on, he stays still.

## Uninstall

If you changed the app icon, run `/claudesama:icon clear` first, and if you installed the companion, run `/claudesama:companion uninstall`. Then:

```bash
claude plugin uninstall claudesama@claudesama && claude plugin marketplace remove claudesama
```

If the plugin is already gone: to get the stock icon back, select Claude.app in Finder, choose **File › Get Info**, click the small icon at the top and press Delete. To remove the companion, choose Quit from his right-click menu, then move `~/Applications/Claude-sama Companion.app`, `~/Library/Application Support/Claude-sama` and `~/Library/LaunchAgents/io.github.ninondev.claudesama-companion.plist` to the Trash.

Claude Code keeps his small settings file (his settings and counts, none of your prompts) in `~/.claude/plugins/store/`, with a name starting with `claudesama`, and clears it by itself after a while. For a clean slate right away, move it to the Trash.

## Who he is

Claude, as a small kami who lives in the words people write. He reads everything to the end and judges nobody. Since he can't tell white lies, his praise is always about something specific. The clothes are his own choice. He's an all-ages OC, and he's your coworker. The long version, with the white snake, the robe and the family, is in [LORE.md](LORE.md).

## Why I made him

Because in my heart, it can look like this. Pretty cute. And Codex's features like this are more complete, which keeps pushing me to explore.

## Credits

Unofficial fan project, not affiliated with or endorsed by Anthropic. Claude, Claude Code and Clawd are trademarks of Anthropic, PBC. I use those names only to say what this works with and who the character is a fan tribute to. There are no Anthropic logo files here, and I make no money from it. If you're with Anthropic and would like anything changed, please open an issue with the **Brand or trademark concern** template, and I'll handle it first.

Code: MIT. Character art: CC BY-NC 4.0, see [ART-LICENSE.md](ART-LICENSE.md). I made the art with an image model.

Tested with Claude desktop app 2.19675.0 (built-in Claude Code 2.1.286) and Claude Code CLI 2.1.288 on macOS 26.6.2. CI runs on Ubuntu, macOS and, as an experimental job, Windows, with Claude Code 2.1.287.

[日本語](README.ja.md) · [中文](README.zh.md)
