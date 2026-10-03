---
description: Give the Claude desktop app the Claude-sama icon (macOS, Linux), or take it off
argument-hint: apply | clear | status
disable-model-invocation: true
---

The person asked to give the Claude desktop app the Claude-sama icon, or to take it off. Action: "$ARGUMENTS" (if empty, use status).

The action must be exactly one of `apply`, `clear` or `status`, optionally followed by `--refresh-dock` or `--dry-run`. If it is anything else, run nothing: say which actions exist and stop. Never pass any other text to the script.

Use exactly one Bash tool call so the person sees and approves the command:

- macOS: `sh "${CLAUDE_PLUGIN_ROOT}/bin/icon-macos.sh" <action>`
- Linux: `sh "${CLAUDE_PLUGIN_ROOT}/bin/icon-linux.sh" <action>`
- Any other system: run nothing and say this works on macOS and Linux only.

Before apply or clear, say in one sentence what it does: it sets only the app's icon, and `clear` puts the stock icon back. After the command, report its output in at most two lines. Do nothing else.
