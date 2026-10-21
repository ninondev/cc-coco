# source

Source code the plugin does not load. It is here so it stays public; none of it is installed with the plugin.

- `hooks/`: the source of the plugin's hooks. `plugin/hooks` is built from it.
- `companion-rs/`: Coco Pet for Windows and Linux, in Rust. The four programs built from it are in `plugin/companion-rs/bin`, and the pictures and words they read are in `plugin/companion-rs/assets`; the words built into them are in `assets/words` here. To build it, put this folder back as `plugin/companion-rs`, together with those two folders: the build reads the plugin's manifest and pictures from there.
- `talk-key/`: the small program behind Talk on your own API key. It keeps the key in your system's password store and sends Talk's requests with it. The Windows and Linux programs are in `plugin/libexec`; the macOS one is built and signed on a Mac for each release.
