---
description: Put Claude-sama beside the Claude desktop app's window (macOS): install, start, stop, status, uninstall
argument-hint: install [--login] | start | stop | status | uninstall
disable-model-invocation: true
---

The person asked to manage the Claude-sama companion, a small separate app that stands beside the Claude desktop app's window and follows what the band shows. Action: "$ARGUMENTS" (if empty, use status). His book's Settings page has the same controls as buttons, on the desktop and in the terminal.

The companion has Activity with a field that sends an instruction to the session; his book has its controls.

The action must be exactly one of `install`, `install --login`, `start`, `stop`, `status` or `uninstall`. If it is anything else, run nothing: say which actions exist and stop. Never pass any other text to the script.

Use exactly one Bash tool call so the person sees and approves the command:

- macOS: `sh "${CLAUDE_PLUGIN_ROOT}/bin/companion-macos.sh" <action>`
- Any other system: run nothing and say the companion is for macOS only; the band inside Claude Code works everywhere.

Before install, say in one sentence what it does: it builds the companion from the plugin's Swift source with Swift 5.9 or newer (Xcode 15 Command Line Tools or later) into `~/Applications/Claude-sama Companion.app` and starts it, keeps his data in `~/Library/Application Support/Claude-sama/`, and with `--login` also starts it at login; nothing is downloaded and Claude.app itself is not changed. Before uninstall, say it stops the companion, moves the app and his data to the Trash, removes the login agent, and clears his own Accessibility permission.

**Bring him back** on his book's Settings page wakes him through the feed. After a quit, it starts him where Claude Code can open apps, asking permission first where needed. Cmd+Space and a search for Claude-sama, Launchpad, and `/claudesama:companion start` always work on this Mac. Each clears the hide and brings him back with a short wave. A start at login keeps a hide that has not ended yet. If he cannot follow the window, use **Let him follow the window** in the book or his card; `/claudesama:companion status` keeps the text instructions.

After the command, report its output in at most four lines. If it says Accessibility is not allowed, pass on the one line about where to switch it on. Do nothing else.
