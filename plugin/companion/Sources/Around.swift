import AppKit
import CoreText

/// Event clocks in seconds. The view arms only the next deadline with OneShot.
struct HoverState {
    enum Surface { case sprite, pill }
    private var sprite = false
    private var pill = false
    private(set) var visible = false
    private(set) var showAt: Double?
    private(set) var hideAt: Double?

    mutating func pointer(_ surface: Surface, inside: Bool, at: Double) {
        switch surface { case .sprite: sprite = inside; case .pill: pill = inside }
        if sprite || pill {
            hideAt = nil
            if !visible && showAt == nil { showAt = at + 0.35 }
        } else {
            showAt = nil
            if visible { hideAt = at + 0.3 }
        }
    }
    mutating func advance(at: Double, carried: Bool = false, card: Bool = false) {
        if carried || card { blocked(carried: carried, card: card); return }
        if let showAt, at >= showAt { visible = sprite || pill; self.showAt = nil }
        if let hideAt, at >= hideAt { visible = false; self.hideAt = nil }
    }
    mutating func blocked(carried: Bool, card: Bool) {
        guard carried || card else { return }
        visible = false; showAt = nil; hideAt = nil
        sprite = false; pill = false
    }
}

/// Shared ink, paper and spark for the two small pills.
class PaperPill: NSView {
    var contrast = false { didSet { needsDisplay = true } }
    var dark: Bool { effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }
    var ink: NSColor { dark ? CardView.paper : CardView.ink }
    var paper: NSColor { dark ? CardView.color(0x2B2220) : CardView.paper }
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: bounds.height / 2, yRadius: bounds.height / 2)
        paper.setFill(); path.fill()
        (contrast ? ink : ink.withAlphaComponent(0.16)).setStroke()
        path.lineWidth = contrast ? 1 : 0.5; path.stroke()
    }
    static func spark(at origin: NSPoint, size: CGFloat = 9) {
        let path = NSBezierPath()
        for angle in [0.0, .pi / 4, .pi / 2, .pi * 3 / 4] {
            let dx = CGFloat(cos(angle)) * size / 2, dy = CGFloat(sin(angle)) * size / 2
            path.move(to: NSPoint(x: origin.x - dx, y: origin.y - dy))
            path.line(to: NSPoint(x: origin.x + dx, y: origin.y + dy))
        }
        CardView.vermilion.setStroke(); path.lineWidth = 1.5; path.lineCapStyle = .round; path.stroke()
    }
}

/// Immediate decisions only: entering another button wins over a late exit from the old one.
struct ButtonLabelState {
    private(set) var pointer: Int?
    private(set) var focus: Int?
    var selection: Int? { pointer ?? focus }
    mutating func pointer(_ index: Int?, inside: Bool) {
        if inside { pointer = index } else if index == nil || pointer == index { pointer = nil }
    }
    mutating func focus(_ index: Int?, inside: Bool) {
        if inside { focus = index } else if index == nil || focus == index { focus = nil }
    }
    mutating func clear() { pointer = nil; focus = nil }
}

enum ButtonLabelPlacement {
    static func frame(button: NSRect, row: NSRect, size: NSSize, visible: NSRect) -> NSRect {
        let width = min(size.width, max(1, visible.width - 4))
        let y = row.maxY + 26 <= visible.maxY ? row.maxY + 4 : row.minY - 24
        return NSRect(x: Place.clamp(button.midX - width / 2, visible.minX + 2, visible.maxX - width - 2),
                      y: Place.clamp(y, visible.minY + 2, visible.maxY - 22), width: width, height: 20)
    }
}

/// The drawing metrics come from the approved AppKit hover-label sheet.
final class ButtonLabelView: PaperPill {
    private(set) var label = NSAttributedString()
    override init(frame: NSRect) { super.init(frame: frame); setAccessibilityElement(false) }
    convenience init() { self.init(frame: .zero) }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    private static func text(_ text: String, lang: String) -> NSAttributedString {
        NSAttributedString(string: text, attributes: [
            .font: SpeechView.font(12), .foregroundColor: CardView.ink,
            NSAttributedString.Key(kCTLanguageAttributeName as String): lang,
        ])
    }
    static func size(_ text: String, lang: String, maxWidth: CGFloat) -> NSSize {
        NSSize(width: min(maxWidth, ceil(Self.text(text, lang: lang).size().width) + 16), height: 20)
    }
    func fit(_ text: String, lang: String, maxWidth: CGFloat) -> NSSize {
        label = Self.text(text, lang: lang)
        frame.size = Self.size(text, lang: lang, maxWidth: maxWidth)
        needsDisplay = true
        return frame.size
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let value = NSMutableAttributedString(attributedString: label)
        value.addAttribute(.foregroundColor, value: ink, range: NSRange(location: 0, length: value.length))
        let size = value.size()
        // PaperPill is flipped; +0.5 in the drawing sheet becomes -0.5 here.
        value.draw(at: NSPoint(x: 8, y: (20 - size.height) / 2 - 0.5))
    }
}

/// One lazy, non-key child panel per surface; it never participates in hit testing.
final class ButtonLabel {
    private(set) var panel: Panel?
    private(set) var view: ButtonLabelView?
    func show(text: String, lang: String, button: NSRect, row: NSRect, visible: NSRect,
              parent: NSWindow, contrast: Bool) {
        guard parent.isVisible else { hide(); return }
        if panel == nil {
            let panel = Panel(clickable: false, shadow: true), view = ButtonLabelView()
            panel.contentView = view; self.panel = panel; self.view = view
        }
        guard let panel, let view else { return }
        view.appearance = parent.effectiveAppearance; view.contrast = contrast
        let size = view.fit(text, lang: lang, maxWidth: max(1, visible.width - 4))
        panel.level = parent.level
        panel.setFrame(ButtonLabelPlacement.frame(button: button, row: row, size: size, visible: visible), display: true)
        if panel.parent !== parent {
            panel.parent?.removeChildWindow(panel); parent.addChildWindow(panel, ordered: .above)
        }
        if !panel.isVisible { panel.order(.above, relativeTo: parent.windowNumber) }
    }
    func hide() { panel?.orderOut(nil) }
}

final class BubbleView: PaperPill {
    private var label = NSAttributedString()
    override init(frame: NSRect) { super.init(frame: frame); setAccessibilityElement(true); setAccessibilityRole(.staticText) }
    convenience init() { self.init(frame: .zero) }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    func fit(project: String, task: String, lang: String, maxWidth: CGFloat = 260) -> NSSize {
        let value = NSMutableAttributedString(attributedString: CardView.text(project, size: 12, lineHeight: 16, bold: true, lang: lang))
        value.append(CardView.text(" · " + task, size: 12, lineHeight: 16, bold: false, lang: lang))
        label = value
        let size = NSSize(width: min(maxWidth, ceil(label.size().width) + 32), height: 22)
        frame.size = size; needsDisplay = true
        setAccessibilityLabel(project + " · " + task)
        return size
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        Self.spark(at: NSPoint(x: 12.5, y: 11))
        let value = NSMutableAttributedString(attributedString: label)
        let style = NSMutableParagraphStyle(); style.lineBreakMode = .byTruncatingTail
        value.addAttributes([.foregroundColor: ink, .paragraphStyle: style], range: NSRange(location: 0, length: value.length))
        value.draw(in: NSRect(x: 22, y: 3, width: bounds.width - 32, height: 17))
    }
}

final class SymbolButton: NSButton {
    var pressed: () -> Void = {}
    var seal = false
    var stroke = false { didSet { needsDisplay = true } }
    var dot = false
    var dotRect: NSRect { NSRect(x: bounds.width - 8, y: 3, width: 5, height: 5) }
    var quietBorder = false
    var keyboardFocusable = false
    let symbolName: String
    var pointerChanged: (Bool) -> Void = { _ in }
    var focusChanged: (Bool) -> Void = { _ in }
    var labelChanged: () -> Void = {}
    private(set) var hovered = false
    private var tracking: NSTrackingArea?
    override var acceptsFirstResponder: Bool { keyboardFocusable }
    init(symbol: String) {
        symbolName = symbol
        super.init(frame: .zero)
        image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: 13, weight: .regular))
        imagePosition = .imageOnly; isBordered = false
        setButtonType(.momentaryPushIn); target = self; action = #selector(pressButton)
        setAccessibilityRole(.button)
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    func name(_ text: String) { toolTip = nil; setAccessibilityLabel(text); labelChanged() }
    @objc private func pressButton() { pressed() }
    override func accessibilityPerformPress() -> Bool { pressed(); return true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let next = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(next); tracking = next
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; needsDisplay = true; pointerChanged(true) }
    override func mouseExited(with event: NSEvent) { hovered = false; needsDisplay = true; pointerChanged(false) }
    func clearHover() { hovered = false; needsDisplay = true }
    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted { focusChanged(true); needsDisplay = true }
        return accepted
    }
    override func resignFirstResponder() -> Bool {
        let accepted = super.resignFirstResponder()
        if accepted { focusChanged(false); needsDisplay = true }
        return accepted
    }
    /// The slash is painted into the glyph, with the button's actual composited ground beneath it.
    func glyph(color: NSColor, ground: NSColor) -> NSImage? {
        guard let base = image else { return nil }
        let tinted = NSImage(size: base.size, flipped: false) { rect in
            base.draw(in: rect); color.set(); rect.fill(using: .sourceAtop); return true
        }
        guard stroke else { return tinted }
        return NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            tinted.draw(in: NSRect(x: (18 - base.size.width) / 2, y: (18 - base.size.height) / 2,
                                  width: base.size.width, height: base.size.height))
            let slash = NSBezierPath(); slash.move(to: NSPoint(x: 2.5, y: 16)); slash.line(to: NSPoint(x: 15.5, y: 2))
            slash.lineCapStyle = .round
            ground.setStroke(); slash.lineWidth = 3.6; slash.stroke()
            color.setStroke(); slash.lineWidth = 1.4; slash.stroke()
            return true
        }
    }
    override func draw(_ dirtyRect: NSRect) {
        let dark = !seal && effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua && superview is PaperPill
        let ink = dark ? CardView.paper : CardView.ink
        var ground = (superview as? PaperPill)?.paper ?? CardView.paper
        let path = NSBezierPath(ovalIn: bounds.insetBy(dx: 0.5, dy: 0.5))
        if seal {
            ground = CardView.color(isHighlighted ? 0x76301A : hovered ? 0x873719 : 0x9E4123)
            ground.setFill(); path.fill()
        } else if hovered || isHighlighted {
            let alpha: CGFloat = dark ? 0.12 : 0.08
            ground = ground.blended(withFraction: alpha, of: ink) ?? ground
            ink.withAlphaComponent(alpha).setFill(); path.fill()
        }
        if quietBorder { CardView.color(0x8E8481).setStroke(); path.lineWidth = 1; path.stroke() }
        contentTintColor = seal ? CardView.paper : hovered ? CardView.vermilion : ink
        if let glyph = glyph(color: contentTintColor ?? ink, ground: ground) {
            glyph.draw(in: NSRect(x: bounds.midX - glyph.size.width / 2, y: bounds.midY - glyph.size.height / 2,
                                 width: glyph.size.width, height: glyph.size.height),
                       from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        }
        if dot { CardView.color(0x9E4123).setFill(); NSBezierPath(ovalIn: dotRect).fill() }
        if window?.firstResponder === self {
            CardView.vermilion.setStroke(); path.lineWidth = 2; path.stroke()
        }
    }
}

final class BadgeView: NSButton {
    var pressed: () -> Void = {}
    private var label = NSAttributedString()
    init() {
        super.init(frame: .zero); isBordered = false; target = self; action = #selector(pressBadge)
        setAccessibilityRole(.button)
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    override var acceptsFirstResponder: Bool { false }
    func fit(count: Int, words: Record.Words, lang: String) -> NSSize {
        let value = NSMutableAttributedString(attributedString: CardView.text(count >= 10 ? "9+" : String(count), size: 11.5, lineHeight: 15, bold: true, lang: lang))
        value.addAttribute(.foregroundColor, value: CardView.paper, range: NSRange(location: 0, length: value.length)); label = value
        setAccessibilityLabel(words.badge.replacingOccurrences(of: "{n}", with: String(count)))
        needsDisplay = true
        return NSSize(width: max(20, ceil(label.size().width) + 10), height: 20)
    }
    @objc private func pressBadge() { pressed() }
    override func accessibilityPerformPress() -> Bool { pressed(); return true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.75, dy: 0.75), xRadius: 10, yRadius: 10)
        CardView.color(0x9E4123).setFill(); path.fill(); CardView.paper.setStroke(); path.lineWidth = 1.5; path.stroke()
        let size = label.size(); label.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2))
    }
}

final class HoverView: PaperPill {
    let buttons = ["bell", "macwindow", "text.bubble", "moon.zzz", "square.resize"].map { SymbolButton(symbol: $0) }
    var pointer: (Bool) -> Void = { _ in }
    private(set) var labelState = ButtonLabelState()
    var labelChanged: () -> Void = {}
    var hoveredButton: SymbolButton? { labelState.selection.map { buttons[$0] } }
    private var tracking: NSTrackingArea?
    override init(frame: NSRect) {
        super.init(frame: frame)
        for (index, button) in buttons.enumerated() {
            button.frame = NSRect(x: 4 + index * 28, y: 4, width: 24, height: 24); addSubview(button)
            button.pointerChanged = { [weak self] inside in
                self?.labelState.pointer(index, inside: inside); self?.labelChanged()
            }
            button.labelChanged = { [weak self] in self?.labelChanged() }
        }
        self.frame.size = NSSize(width: 144, height: 32)
        setAccessibilityElement(false)
    }
    convenience init() { self.init(frame: .zero) }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    static func names(words: Record.Words, hidden: Bool) -> [String] {
        [words.activity, words.back, hidden ? words.showLines : words.hideLines, words.hide, words.size]
    }
    static func labelWidths(words: Record.Words, lang: String, visibleWidth: CGFloat) -> [CGFloat] {
        zip(names(words: words, hidden: false), names(words: words, hidden: true)).map {
            max(ButtonLabelView.size($0.0, lang: lang, maxWidth: max(1, visibleWidth - 4)).width,
                ButtonLabelView.size($0.1, lang: lang, maxWidth: max(1, visibleWidth - 4)).width)
        }
    }
    func configure(words: Record.Words, hidden: Bool, unseen: Int) {
        for (button, name) in zip(buttons, Self.names(words: words, hidden: hidden)) { button.name(name) }
        buttons[0].dot = unseen > 0; buttons[2].stroke = !hidden
        buttons.forEach { $0.needsDisplay = true }
    }
    func clearLabel() { labelState.clear(); buttons.forEach { $0.clearHover() }; labelChanged() }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let next = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(next); tracking = next
    }
    override func mouseEntered(with event: NSEvent) { pointer(true) }
    override func mouseExited(with event: NSEvent) { clearLabel(); pointer(false) }
}
