import AppKit
import CoreText

/// Its lifecycle is separate from its view: hiding with him preserves the unanswered slip.
struct CardOffer {
    static func shouldOffer(trusted: Bool, offered: String, build: String, visible: Bool) -> Bool {
        !trusted && visible && offered != build
    }
}

@MainActor
final class Card {
    let panel = Panel(clickable: true, shadow: true)
    let view = CardView()
    init() { panel.contentView = view }
    func close() {
        panel.parent?.removeChildWindow(panel)
        panel.orderOut(nil)
        panel.close()
    }
}

final class CardView: NSView {
    static let paper = color(0xFAEEE9), ink = color(0x231B19), vermilion = color(0xC75730)
    private let title = NSTextField(wrappingLabelWithString: "")
    private let body = NSTextField(wrappingLabelWithString: "")
    let primary = CardButton(seal: true)
    let secondary = CardButton(seal: false)
    var contrast = false { didSet { primary.contrast = contrast; secondary.contrast = contrast; needsDisplay = true } }
    private var sparkY: CGFloat = 17
    override var isFlipped: Bool { true }

    static func color(_ hex: Int) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
                blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
    static func text(_ value: String, size: CGFloat, lineHeight: CGFloat, bold: Bool, lang: String) -> NSAttributedString {
        let base = NSFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular)
        let font = base.fontDescriptor.withDesign(.serif).flatMap { NSFont(descriptor: $0, size: size) } ?? base
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = lineHeight
        style.maximumLineHeight = lineHeight
        style.lineBreakMode = .byWordWrapping
        return NSAttributedString(string: value, attributes: [
            .font: font, .foregroundColor: ink, .paragraphStyle: style,
            NSAttributedString.Key(kCTLanguageAttributeName as String): lang,
        ])
    }
    override init(frame: NSRect) {
        super.init(frame: frame)
        for field in [title, body] {
            field.isSelectable = false
            field.isBezeled = false
            field.drawsBackground = false
            field.lineBreakMode = .byWordWrapping
            field.setAccessibilityRole(.staticText)
            addSubview(field)
        }
        body.maximumNumberOfLines = 6
        addSubview(primary)
        addSubview(secondary)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
    }
    convenience init() { self.init(frame: .zero) }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    override func accessibilityChildren() -> [Any]? { [title, body, primary, secondary] }

    func fit(words: Record.Words, lang: String, waiting: Bool, width: CGFloat) -> NSSize {
        let width = max(40, min(264, width))
        let inner = max(16, width - 24)
        let heading = waiting ? words.waitTitle : words.offerTitle
        let prose = waiting ? words.waitBody : words.offerBody
        title.attributedStringValue = Self.text(heading, size: 14, lineHeight: 18, bold: true, lang: lang)
        body.attributedStringValue = Self.text(prose, size: 12.5, lineHeight: 17, bold: false, lang: lang)
        title.setAccessibilityLabel(heading)
        body.setAccessibilityLabel(prose)
        setAccessibilityLabel(heading)
        func height(_ field: NSTextField, width: CGFloat, maximum: CGFloat) -> CGFloat {
            ceil(field.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: width, height: maximum)).height ?? 18)
        }
        let titleHeight = height(title, width: inner - 15, maximum: 180)
        title.frame = NSRect(x: 27, y: 13, width: inner - 15, height: titleHeight)
        sparkY = 17
        let bodyHeight = min(104, height(body, width: inner, maximum: 104))
        body.frame = NSRect(x: 12, y: title.frame.maxY + 5, width: inner, height: bodyHeight)
        primary.configure(waiting ? words.open : words.yes, lang: lang)
        secondary.configure(waiting ? words.close : words.later, lang: lang)
        let firstWidth = min(inner, primary.fittedWidth)
        let secondWidth = min(inner, secondary.fittedWidth)
        let buttonY = body.frame.maxY + 11
        primary.frame = NSRect(x: 12, y: buttonY, width: firstWidth, height: 26)
        let sameRow = firstWidth + 8 + secondWidth <= inner
        secondary.frame = NSRect(x: sameRow ? 12 + firstWidth + 8 : 12, y: sameRow ? buttonY : buttonY + 34,
                                 width: secondWidth, height: 26)
        let size = NSSize(width: width, height: secondary.frame.maxY + 12)
        frame.size = size
        needsDisplay = true
        return size
    }

    override func draw(_ dirtyRect: NSRect) {
        let outline = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 9, yRadius: 9)
        Self.paper.setFill(); outline.fill()
        NSGraphicsContext.saveGraphicsState()
        outline.addClip()
        Self.vermilion.setFill(); NSRect(x: 0, y: 0, width: bounds.width, height: 3).fill()
        NSGraphicsContext.restoreGraphicsState()
        (contrast ? Self.ink : Self.ink.withAlphaComponent(0.16)).setStroke()
        outline.lineWidth = contrast ? 1 : 0.5; outline.stroke()
        // The same vector spark as the book's tool rows, nine points wide.
        let path = NSBezierPath()
        for (a, b) in [(NSPoint(x: 6, y: 5.5), NSPoint(x: 6, y: 14.5)),
                       (NSPoint(x: 1.5, y: 10), NSPoint(x: 10.5, y: 10)),
                       (NSPoint(x: 2.82, y: 6.82), NSPoint(x: 9.18, y: 13.18)),
                       (NSPoint(x: 9.18, y: 6.82), NSPoint(x: 2.82, y: 13.18))] {
            path.move(to: NSPoint(x: 11 + a.x, y: sparkY - 5.5 + a.y))
            path.line(to: NSPoint(x: 11 + b.x, y: sparkY - 5.5 + b.y))
        }
        Self.vermilion.setStroke(); path.lineWidth = 1.5; path.lineCapStyle = .round; path.stroke()
    }
}

/// Native NSButton tracking and accessibility with the slip's two button treatments.
final class CardButton: NSButton {
    let seal: Bool
    var pressed: () -> Void = {}
    var contrast = false { didSet { needsDisplay = true } }
    private var hovered = false
    private var tracking: NSTrackingArea?
    private var label = NSAttributedString()
    var fittedWidth: CGFloat { ceil(label.size().width) + 24 }
    var keyboardFocusable = false
    var borderlessQuiet = false
    override var acceptsFirstResponder: Bool { keyboardFocusable }
    init(seal: Bool) {
        self.seal = seal
        super.init(frame: .zero)
        isBordered = false
        focusRingType = .none
        setButtonType(.momentaryPushIn)
        target = self
        action = #selector(pressCardButton)
        setAccessibilityRole(.button)
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    func configure(_ text: String, lang: String) {
        title = text
        label = CardView.text(text, size: 13, lineHeight: 17, bold: seal, lang: lang)
        let ink = NSMutableAttributedString(attributedString: label)
        ink.addAttribute(.foregroundColor, value: seal ? CardView.paper : CardView.ink, range: NSRange(location: 0, length: ink.length))
        label = ink
        setAccessibilityLabel(text)
        needsDisplay = true
    }
    @objc private func pressCardButton() { pressed() }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func accessibilityPerformPress() -> Bool { pressed(); return true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let next = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(next); tracking = next
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovered = false; needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 6, yRadius: 6)
        if seal {
            CardView.color(isHighlighted ? 0x76301A : hovered ? 0x873719 : 0x9E4123).setFill(); path.fill()
        } else {
            if hovered || isHighlighted { CardView.color(isHighlighted ? 0xE4D9D4 : 0xEDE1DD).setFill(); path.fill() }
            if !borderlessQuiet {
                (contrast ? CardView.ink : CardView.color(0x8E8481)).setStroke(); path.lineWidth = 1; path.stroke()
            }
        }
        let size = label.size()
        let iconWidth: CGFloat = image == nil ? 0 : 18
        image?.draw(in: NSRect(x: 12, y: (bounds.height - 13) / 2, width: 13, height: 13))
        label.draw(in: NSRect(x: 12 + iconWidth, y: (bounds.height - size.height) / 2, width: bounds.width - 24 - iconWidth, height: size.height))
        if keyboardFocusable, window?.firstResponder === self {
            CardView.vermilion.setStroke(); path.lineWidth = 2; path.stroke()
        }
    }
}
