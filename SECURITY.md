# Security

## Reporting a problem

Please do not put the details of a security problem in a public issue.

Use **Report a vulnerability** on this repository's [Security tab](https://github.com/ninondev/cc-coco/security). If that button is not there, open an issue that says only that you have a security report, with no details, and I will arrange a private way to talk.

Tell me what you found, how to make it happen, and which version of Coco, Claude Code and operating system you used. Coco is a one-person fan project, so I cannot promise a response time, but security reports come before everything else except brand concerns.

## Which versions get fixes

The latest release. Update with `claude plugin update coco@coco`, then start a new session.

## What counts

- Anything that makes Coco send data off the computer, call a model or spend tokens without the user turning that feature on.
- A key, token or password that Coco stores, shows or logs where it should not: the saved API key, sticky notes, the window notes, the session records.
- A way for text in a conversation, a file name or a repository to make Coco run a command, write outside its own folders, or change a permission prompt or security notice.
- A problem in the installer, in Coco Pet, or in the scripts under `plugin/bin`.

Problems in Claude Code itself belong to Anthropic; see [their security page](https://www.anthropic.com/security).

## What Coco does to stay safe

- By default it makes no network calls and no model calls, and collects no telemetry. The tests count network calls and fail on any that are not allowed.
- Your own API key is kept in the system's password store, never in the plugin, the chat or a log.
- Common key shapes are masked before sticky notes and window notes are saved. With the guard switch on, Coco also points out a commit or push that carries one.
- The Mac pet and installer are signed with a Developer ID and notarized by Apple.
