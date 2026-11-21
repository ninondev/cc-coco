# Contributing

Thank you for wanting to help Coco. Bug reports, ideas and pull requests are all welcome. If the change is large, open an issue first so we can agree on it before you spend the time.

## What is in this repository

- `plugin/`: the plugin as Claude Code installs it. `plugin/hooks` is built; do not edit it by hand.
- `source/hooks/`: the source of the hooks. This is where code changes go.
- `source/companion-rs/`, `source/talk-key/`: the Rust source of Coco Pet for Windows and Linux and of the API key helper. See [source/README.md](source/README.md) for how they are built.
- `tools/`: the build scripts and the tests (the kit), in `tools/tests`.
- `scripts/`: the checks that run before a release.
- `docs/`: the web demo that GitHub Pages serves.

Some generators and checks read private sources and are not here; `tools/public-tree.json` lists them, and the test runner reports them as skipped.

## Setting up

You need Python 3, [Bun](https://bun.sh) 1.4.2, TypeScript 5.9.3 and Claude Code. CI pins Claude Code 2.1.317; the versions are at the top of [.github/workflows/ci.yml](.github/workflows/ci.yml).

```bash
mkdir -p ~/.cache/coco-typescript && cd ~/.cache/coco-typescript && bun add typescript@5.9.3
export COCO_TYPESCRIPT=~/.cache/coco-typescript/node_modules/typescript/lib/typescript.js
```

On Windows, also set `PYTHONUTF8=1`.

## Making a change

1. Edit the source in `source/hooks`, and add or update a test in `tools/tests`.
2. Rebuild the hooks the plugin loads:

   ```bash
   python3 tools/build-hooks-graph.py --source source/hooks --output plugin --typescript "$COCO_TYPESCRIPT"
   ```

3. Run the tests for what you touched, by file name:

   ```bash
   python3 tools/run-tests.py --stage kit --test-file numbers-c1.test.tsx
   ```

4. Run the quick checks. CI runs the same ones in its `lint` job:

   ```bash
   python3 scripts/check-version.py
   python3 tools/build-hooks-graph.py --check --source source/hooks --output plugin --typescript "$COCO_TYPESCRIPT"
   shellcheck -s sh -S error -e SC2066 plugin/bin/*.sh plugin/assets/icon/*.sh scripts/*.sh
   claude plugin validate . && claude plugin validate plugin
   ```

The whole kit (`python3 tools/run-tests.py --stage kit`) takes an hour or more. You do not have to run it yourself: CI runs it on Linux, macOS and Windows for every pull request.

## What a pull request needs

- One subject per pull request, and a line in `CHANGELOG.md` under `[Unreleased]` for anything a user would notice.
- No secrets, and no real keys in tests: build key-shaped test strings from parts, the way `tools/tests/m1-bookmark-secrets.test.tsx` does.
- Nothing that makes a network call, calls a model or spends tokens by default. Features that do are off until the user turns them on, and they say what they cost.
- Changes to how Coco, Claudie or DeepSeek-chan talk or act are persona changes. Please open an issue before writing them; they get their own part in the changelog and a way back to the old behaviour.
- New words on screen need all 13 languages. If you cannot write them all, say which ones are missing.

## Things I cannot merge as they are

- A rebuilt `plugin/bin/Coco Pet.app`. The Mac pet is signed with my Developer ID and notarized by Apple, so I rebuild it myself from your source change.
- Art made from someone else's character or work without their permission. The art licence is in [ART-LICENSE.md](ART-LICENSE.md).

## Versions

The plugin's version is in `plugin/.claude-plugin/plugin.json`. The same number is in `.claude-plugin/marketplace.json`, `source/hooks/plugin-version.ts`, `source/hooks/book-text.ts` and the latest heading of `CHANGELOG.md`; `scripts/check-version.py` fails when they disagree. A fourth number, as in 1.1.4514.4, means small changes only.
