# talk-key

The key program from design/1.0/TALK-KEY.md §3 and its «Changed 10-10, the owner» block. It keeps one API key in the system's store, together with the endpoint and the model it is for, and sends Talk's and Explain's calls with it. The plugin, the chat and the logs never hold the key. The endpoint can be api.anthropic.com or any provider that speaks the Anthropic Messages API.

It ships in the plugin's `libexec/` folder, never in `bin/`, because `bin/` is on the Bash tool's PATH.

- **macOS**: `libexec/talk-key`, built on a Mac at release with `ci/release.sh`. It builds with `--locked`, signs with the hardened runtime (required before the first `add`), checks that no seam or other variable name is in the binary, and copies it to `plugin/libexec/`. It is never committed.
- **Windows and Linux**: four builds made in a cloud session and committed with the plugin (owner's card, 10-17): `libexec/talk-key-windows-x86_64.exe`, `talk-key-windows-aarch64.exe`, `talk-key-linux-x86_64` and `talk-key-linux-aarch64`. `python3 -I tools/build-talk-key-bins.py` builds them and records each in `libexec/builds.json` (bytes, sha256, compiler, the source files read); `--check` says whether they still match their sources. A build that holds a seam or variable name from the `ci/release.sh` list, or a path of the build machine, is refused. The Linux builds are linked against glibc 2.28, so they run on Debian 10, Ubuntu 20.04 and later. The plugin picks the build for the processor: on Windows from `PROCESSOR_ARCHITEW6432` or `PROCESSOR_ARCHITECTURE`, on Linux from `uname -m`.

**Not tried yet on Windows itself or on a Linux desktop with a keyring.** The Windows build was tested under Wine (Credential Manager included, no dialog), the Linux build on a cloud machine without a desktop or keyring, and neither has sent a request to api.anthropic.com. The checks on a real Windows machine and on a Linux desktop are still to run.

## Commands

Each command prints one JSON line on stdout and exits 0 when it worked, 1 when not. Failures carry `kind`, a short machine `detail`, and `status` (HTTP) or `retry_after` (seconds) where they apply. The plugin turns kinds into words; this program has none.

| Command | Stdin | Success |
|---|---|---|
| `add [--base URL] [--model M]` | a terminal (a plain pipe is refused) | `{"kind":"works"\|"saved","last4":"x7Qa","store":"…","host":"…","model":"…"}` |
| `add --dialog --title T --text X --save S --cancel C [--base URL] [--model M]` | not read | same; the words come from the plugin's tables |
| `remove` | not read | `{"kind":"removed"}`, or `computer` with `keyring-unreachable` when the keyring could not be cleared |
| `send` | the request JSON below | `{"kind":"ok","text":"…","usage":{…},"count":{"minute":n,"day":n},"host":"…","model":"…"}` |
| `status` | not read | as `add`, from the stored record |

`store` is `keychain`, `credential-manager`, `secret-service` or `file`. `host` is the stored endpoint's host (with its port when it is not the scheme's default); the key itself is never printed, only its last four characters.

The terminal rule is a speed bump, not a lock: `script(1)` can give a pipe a terminal, so a program that is determined to feed `add` can. A fed key was already in that program's hands.

## The endpoint is bound to the key

What the program enforces, in `src/endpoint.rs`, `src/request.rs` and `src/http.rs`:
- **The record.** `add` takes the base URL (default `https://api.anthropic.com`) and the model (default `claude-haiku-5-5`) from its own flags and stores them with the key, as one value in the OS store. `send` and `status` read all three from that value. A key stored before 10-10 (a bare key) is read as the defaults.
- **`send` takes neither from its input.** The input may name `model` and `host` only to equal the stored ones; anything else is `other` with `input:model` or `input:host`. That refusal comes after the send was counted and the record read, and the send stays counted: deliberate (the lead's call, 10-10), so a caller that keeps naming the wrong model still runs into the limits. Any other field (`base_url`, `endpoint`, `url`, …) is refused before anything.
- **The URL.** `https://` to any host, or `http://` to `127.0.0.1`, `[::1]` or `localhost` only. Also: no userinfo, query or fragment; a port from 1 to 65535; a path prefix of `[A-Za-z0-9/-._~]` without `.` or `..` segments; printable ASCII, 512 bytes at most. A refusal is `address` with a `url-*` detail, checked before the key is read.
- **The model.** `[A-Za-z0-9._:/@+-]`, 1 to 200 characters; no `/` on api.anthropic.com. A refusal is `address` with `model`.
- **The key.** On api.anthropic.com (https, port 443, no path prefix) `sk-ant-` and at least 24 letters, digits, `-` or `_` (an `sk-ant-api03-` key, an `sk-ant-usr` key, any kind the Console hands out; owner 10-19), and the save check decides; admin keys and OAuth tokens are `format`. Anywhere else: printable ASCII without spaces, 8 to 512 characters.
- **The request.** `x-api-key` and `anthropic-version: 2023-06-01`. On api.anthropic.com the body adds `thinking: {"type":"disabled"}`; anywhere else it is only `model`, `max_tokens`, `system` and `messages`. Redirects are never followed: a 3xx is `other` with its status.
- **The connection.** https verifies the endpoint's own name against the OS trust store only. Plain http, which only loopback can be, never goes through `HTTPS_PROXY`.
- **The save check** costs no tokens. On api.anthropic.com it is `GET /v1/models/{model}`, and only a 200 saves. Elsewhere it is `GET {base}/v1/models`: a 200 saves as `works`, a 404 or 405 saves as `saved` («saved, not checked yet»), and anything else saves nothing.

What it does not enforce: that the endpoint is honest. Whoever runs it sees the request, as the person chose. That a model elsewhere is what its name says. That an http gateway on loopback is the person's own program. And it can't stop the person from choosing a new endpoint with `add`, which needs the terminal or the dialog.

`send` reads `{"system"?: string, "messages": [{"role","content": string}], "max_tokens"?: 1..64000, "model"?: string, "host"?: string, "kind"?: "talk" | "compact"}`. `"kind": "compact"` (Talk's notes on a long chat) must name `max_tokens`, up to 1,000. A talk send may leave it out (owner 10-17, no cap of its own): on api.anthropic.com the program reads the stored model's own limit from `GET /v1/models/{model}` (`max_tokens`) and sends that, up to the 64,000 Claude Code allows one whole reply; with none read, Claude Code's own 1,024. The kind is never sent, and a compact counts like any send. Roles alternate from `user` and end on `user`. Any other field or a content block is refused, so temperature, thinking, tools and cache_control can't get in. The estimate is the larger of UTF-8 bytes and NFKC bytes for the system text and each message, plus 2,000; over 100,000 is `cap`. Structural checks come before the send is counted and before the record is read.

## Limits and the deadline

- Sends: 6 a minute and 300 a local day. The day moves only forward, so changing TZ buys nothing. A stored day more than a day past the UTC date is dropped, and so are stamps more than 60 s ahead: a clock that was wrong cannot lock Talk out.
- Key checks (`add` and `status`): one a second and 30 an hour. They spend no tokens but use the key, and on macOS they can raise a Keychain prompt. `add` is braked before its dialog opens.
- All limits share one file under a lock. Anyone who can write that file can reset them.
- Each command has one hard deadline of 25 s, under the plugin's 30 s kill. `add`'s deadline starts once the key has been typed. Sockets are shut 1 s before the deadline, so a stuck read answers `offline` with `timeout`. If the command is still stuck at 25 s (secret-tool, a Keychain prompt), a watchdog answers `computer`, `offline` or `other`, each with `deadline`, and exits.
- A send that times out stays counted. It may have reached the provider and been billed. Nothing retries it.

## Kinds

`saved` (add and status only): a key elsewhere whose models list answered 404 or 405. `address`: the base URL or model was refused. `invalid` 401; `credit` 402, or a 400 that says the credit balance is too low; `model` 403 and 404; `rate` 429, the local 6 a minute, or the key-check brake; `busy` 500, 502, 503, 504, 529; `offline` for DNS, connect, timeout, TLS and proxy failures; `refusal` for `stop_reason: refusal`; `daily` for the local 300 a day (it resets at local midnight); `cap`; `other` for any other status, bad input and usage errors; `computer` for the Keychain denied or locked, the keyring locked or unreachable, the key missing, our files or folder unsafe or unreadable, echo that can't be turned off. `add` alone also answers `format` (not an sk-ant- key, an admin key, an OAuth token) and `cancelled`.

## Where things live

| OS | Key | Limits |
|---|---|---|
| macOS | login Keychain, service `coco talk-key`, account `talk-key`; access list naming only this program | `~/Library/Application Support/coco/talk-key-sends` |
| Windows | Credential Manager, generic credential `coco/talk-key` | `%LOCALAPPDATA%\coco\talk-key-sends` (found through the shell API) |
| Linux | Secret Service through `secret-tool` (the key on its stdin), else `~/.config/coco/talk-key` at 0600 | `~/.config/coco/talk-key-sends` |

On Linux the file exists only when the last save went there (a keyring save deletes it), so `load` reads it first. When `remove` cannot reach the keyring, it leaves a tombstone in the file, so the old key is not used even after the bus comes back. The folder is created 0700. If it already exists it must belong to the account, and it is tightened to 0700. The limits file is never opened through a symlink. The plugin should run talk-key with the session bus variables (`DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`, and `DISPLAY` or `WAYLAND_DISPLAY` for the dialog) passed through.

## Environment

Our code reads only the proxy pair: `HTTPS_PROXY` and `NO_PROXY`, or their lowercase forms, with the uppercase one winning. The home folder comes from the account database, not `HOME`. Below our code:
- the C library reads `TZ` (and `/etc/localtime`) for local midnight;
- its resolver reads `RES_OPTIONS`, `LOCALDOMAIN` and `HOSTALIASES`, which is harmless because TLS pins the name;
- Rust's runtime reads `RUST_BACKTRACE` when it reports a panic.

Nothing reads `SSL_CERT_FILE`, `SSL_CERT_DIR`, `ALL_PROXY`, `HTTP_PROXY` or `ANTHROPIC_API_KEY`. Linux trusts the first system bundle that loads from a fixed list; macOS and Windows ask the OS verifier. Helpers it starts (`secret-tool`, the dialogs) inherit the environment.

On unix the program sets its core-file limit to 0, and on Linux it marks itself non-dumpable, which also blocks same-user ptrace. The key buffers are zeroed after use where that is cheap.

## Tests

`python3 tools/tests/talk-key.test.py` runs the suite with and without the test seams, then on the release binary and on the Linux build the plugin ships for this processor, and checks that a release build with the seams refuses to compile. `python3 tools/tests/talk-key-wine.test.py` runs the unit tests built for Windows under Wine (Credential Manager's save, load and remove among them, under test names) and asks the shipped Windows build for ordinary computers what it answers without a key or a network. The Windows ARM build cannot run under Wine on this machine; builds.json is all that checks it. Cases that reach the limits file in a build without seams run under `unshare -m` with a tmpfs over the home. `examples/stand_in.rs` is the local server for the checks run by hand on macOS and Windows.
