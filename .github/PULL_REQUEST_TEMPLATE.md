## What changes

<!-- What a user would notice, in a sentence or two. Link the issue if there is one. -->

## How it was checked

<!-- The test files you ran, and anything you tried on a real machine (which app, which system). -->

## Checklist

- [ ] The change is in `source/hooks` (not only in `plugin/hooks`), and the hooks are rebuilt
- [ ] A test in `tools/tests` covers it
- [ ] `CHANGELOG.md` has a line under `[Unreleased]` if a user would notice
- [ ] Nothing new calls a model, goes online or spends tokens by default
- [ ] New words on screen are in all 13 languages, or the missing ones are listed above
- [ ] No keys, tokens or private files
