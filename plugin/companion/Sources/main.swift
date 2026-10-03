// Claude-sama Companion: puts him beside the Claude desktop app's window, in step with the mod.
//
// A separate little app that stands beside Claude's window the way desktop pets do, never over it;
// Claude.app is never touched. Feed.swift reads the one small file the mod writes, Claude.swift follows the
// window, Pet.swift places and draws him with the mod's own frames (Frames.swift), App.swift wires
// them together and keeps his settings.
//
// Cost: no polling and no timer while idle. It wakes for a change of that file, a window event, a
// click. Two-frame loops run only during a turn while he is visible, inside the window server.
// No network, no keystrokes, no screen contents, no window titles.
//
// Built from source at install by plugin/bin/companion-macos.sh (swiftc, no Xcode project).
// License: MIT. Part of Claude-sama, an unofficial fan skin. Claude is a trademark of Anthropic.

import AppKit

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let companion = Companion(options: Options(CommandLine.arguments))
    app.delegate = companion
    app.run()
    _ = companion // the delegate is weak: this keeps it alive for the run
}
