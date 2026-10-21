import AppKit

/// The only key panel. Ordinary pet panels retain their non-activating style.
final class ActivityPanel: NSPanel {
    var escape: () -> Void = {}
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    init() {
        super.init(contentRect: .zero, styleMask: [.borderless], backing: .buffered, defer: true)
        isOpaque = false; backgroundColor = .clear; hasShadow = true
        hidesOnDeactivate = false; isReleasedWhenClosed = false; isRestorable = false
        animationBehavior = .none; level = .floating
        sharingType = Capture.sharing
        collectionBehavior = [.moveToActiveSpace, .fullScreenNone, .ignoresCycle]
    }
    override func cancelOperation(_ sender: Any?) { escape() }
}

/// A native button with the two non-colour cues for unseen work.
final class ActivityRowButton: NSButton {
    let row: ActivityRow
    var contrast = false { didSet { needsDisplay = true } }
    var pressed: () -> Void = {}
    // "project, state", laid out for the row's width (OUTSIDE F2): the state asks for them, so it is never cut; the project
    // is shortened in the middle first, down to eight characters, and only if the state still cannot fit does it take a
    // second line, without its separator (companion-rs ui.rs row_heading).
    private var heading = NSAttributedString()
    private var headingSecond: NSAttributedString?
    private var headingRoom: CGFloat = -1
    private func layoutHeading(room: CGFloat) {
        if room == headingRoom { return }
        headingRoom = room
        let lang = row.record.lang, separator = Clauses.separator(lang)
        func joined(_ project: String) -> NSAttributedString {
            let line = NSMutableAttributedString(attributedString: CardView.text(project, size: 12.5, lineHeight: 17, bold: row.unseen, lang: lang))
            line.append(CardView.text(separator + row.state, size: 12.5, lineHeight: 17, bold: false, lang: lang))
            return line
        }
        let whole = joined(row.project)
        headingSecond = nil
        if whole.size().width <= room { heading = whole; return }
        let chars = Array(row.project)
        if chars.count > 8 {
            for keep in stride(from: chars.count - 1, through: 8, by: -1) {
                let head = keep / 2 + keep % 2, tail = keep - head
                let line = joined(String(chars[..<head]) + "\u{2026}" + String(chars[(chars.count - tail + 1)...]))
                if line.size().width <= room { heading = line; return }
            }
        }
        heading = CardView.text(row.project, size: 12.5, lineHeight: 17, bold: row.unseen, lang: lang)
        headingSecond = CardView.text(row.state, size: 12.5, lineHeight: 17, bold: false, lang: lang)
    }
    private var ribbonGap: CGFloat { row.record.ribbon == nil ? 0 : 10 }
    private var clock = NSAttributedString()
    private var excerpt = NSAttributedString()
    static let formatter: DateFormatter = {
        let value = DateFormatter(); value.locale = Locale(identifier: "en_US_POSIX"); return value
    }()
    init(row: ActivityRow, today: Date = Date()) {
        self.row = row
        super.init(frame: .zero)
        isBordered = false; setButtonType(.momentaryPushIn); target = self; action = #selector(pressRow)
        let date = Date(timeIntervalSince1970: row.at / 1000)
        Self.formatter.dateFormat = Calendar.current.isDate(date, inSameDayAs: today) ? "HH:mm" : "MMM d, HH:mm"
        let time = Self.formatter.string(from: date)
        clock = CardView.text(time, size: 12, lineHeight: 17, bold: false, lang: row.record.lang)
        excerpt = CardView.text(row.excerpt ?? "", size: 12, lineHeight: 16, bold: false, lang: row.record.lang)
        setAccessibilityRole(.button)
        setAccessibilityLabel([row.project, row.state, time + ". " + row.record.words.opens, row.excerpt ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    func fit(width: CGFloat) -> NSSize {
        layoutHeading(room: max(0, width - clock.size().width - 18 - ribbonGap))
        let second: CGFloat = headingSecond == nil ? 0 : 16
        let height = (row.excerpt == nil ? 30.0 : 30 + min(32, ceil(excerpt.boundingRect(with: NSSize(width: width - 12, height: 1000), options: [.usesLineFragmentOrigin]).height)) + 2) + second
        return NSSize(width: width, height: height)
    }
    @objc private func pressRow() { pressed() }
    override func accessibilityPerformPress() -> Bool { pressed(); return true }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 36 || event.keyCode == 76 { pressed() } else { super.keyDown(with: event) }
    }
    override func draw(_ dirtyRect: NSRect) {
        if isHighlighted { CardView.ink.withAlphaComponent(0.06).setFill(); bounds.fill() }
        (contrast ? CardView.ink : CardView.ink.withAlphaComponent(0.18)).setFill(); NSRect(x: 0, y: 0, width: bounds.width, height: 0.5).fill()
        if let ribbon=row.record.ribbon { D1Ribbon.draw(ribbon,in:CGRect(x:0,y:3,width:6,height:22),dark:false) }
        let dot = NSBezierPath(ovalIn: NSRect(x: ribbonGap, y: 11, width: 7, height: 7))
        if row.unseen { CardView.color(0x9E4123).setFill(); dot.fill() }
        else { (contrast ? CardView.ink : CardView.color(0x8E8481)).setStroke(); dot.lineWidth = 1; dot.stroke() }
        let width = clock.size().width
        clock.draw(in: NSRect(x: bounds.width - width, y: 6, width: width, height: 18))
        layoutHeading(room: max(0, bounds.width - width - 18 - ribbonGap))
        heading.draw(in: NSRect(x: 12+ribbonGap, y: 6, width: max(0, bounds.width - width - 18-ribbonGap), height: 18))
        let second: CGFloat = headingSecond == nil ? 0 : 16
        headingSecond?.draw(in: NSRect(x: 12+ribbonGap, y: 22, width: max(0, bounds.width - 12-ribbonGap), height: 18))
        if row.excerpt != nil { excerpt.draw(with: NSRect(x: 12+ribbonGap, y: 25 + second, width: bounds.width - 12-ribbonGap, height: 32), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine]) }
        if window?.firstResponder === self {
            (contrast ? CardView.ink : CardView.vermilion).setStroke(); let focus = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 3, yRadius: 3); focus.lineWidth = contrast ? 2 : 1.5; focus.stroke()
        }
    }
}

final class ActivityField: NSTextField {
    var send: () -> Void = {}
    var changed: () -> Void = {}
    override func textDidChange(_ notification: Notification) {
        super.textDidChange(notification); changed()
    }
    override func textDidEndEditing(_ notification: Notification) {
        super.textDidEndEditing(notification)
        if (notification.userInfo?["NSTextMovement"] as? Int) == NSReturnTextMovement { send() }
    }
}

/// One message of the DM thread (DmThread.swift): hers on a paper tint, the person's in the send seal's colour; under
/// Increase Contrast hers is outlined in ink and theirs is ink. Read by VoiceOver, never pressed.
final class DmBubbleView: NSView {
    let line: DmThread.Line
    private let label = NSTextField(wrappingLabelWithString: "")
    var contrast = false { didSet { restyle() } }
    override var isFlipped: Bool { true }
    init(line: DmThread.Line, name: String, lang: String) {
        self.line = line
        super.init(frame: .zero)
        label.attributedStringValue = Self.text(line.text, lang: lang)
        label.isSelectable = true; label.drawsBackground = false; label.isBordered = false
        addSubview(label)
        setAccessibilityElement(true); setAccessibilityRole(.staticText)
        setAccessibilityLabel(line.mine ? line.text : "\(name): \(line.text)")
        label.setAccessibilityElement(false)
        restyle()
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    static func text(_ value: String, lang: String) -> NSAttributedString {
        CardView.text(value, size: CGFloat(DmLayout.textSize), lineHeight: 17, bold: false, lang: lang)
    }
    /// The text's size wrapped at `width`, for DmLayout. Measured with the label's own kind of cell, whose padding
    /// a bare text measure leaves out: that cut the last character to a hidden second line (his report 10-20).
    static func measure(_ value: String, width: Double, lang: String) -> (width: Double, height: Double) {
        let cell = NSTextFieldCell(textCell: ""); cell.wraps = true; cell.isSelectable = true
        cell.attributedStringValue = text(value, lang: lang)
        let size = cell.cellSize(forBounds: NSRect(x: 0, y: 0, width: width, height: 10_000))
        return (Double(ceil(min(size.width, width))), Double(ceil(size.height)))
    }
    private func restyle() {
        let value = NSMutableAttributedString(attributedString: label.attributedStringValue)
        value.addAttribute(.foregroundColor, value: line.mine ? CardView.paper : CardView.ink, range: NSRange(location: 0, length: value.length))
        label.attributedStringValue = value
        needsDisplay = true
    }
    override func layout() {
        super.layout()
        label.frame = bounds.insetBy(dx: CGFloat(DmLayout.padX), dy: CGFloat(DmLayout.padY))
    }
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10)
        if line.mine {
            (contrast ? CardView.ink : CardView.color(0x9E4123)).setFill(); path.fill()
        } else {
            (contrast ? CardView.color(0xFFFAF7) : CardView.color(0xF2E5DB)).setFill(); path.fill()
            if contrast { CardView.ink.setStroke(); path.lineWidth = 1; path.stroke() }
        }
    }
}

/// Layout stays native, including Tab order, a real field editor and the responder-chain dictation.
final class ActivityView: NSView {
    let field = ActivityField()
    let target = NSPopUpButton(frame: .zero, pullsDown: false)
    let mic = SymbolButton(symbol: "mic")
    let send = SymbolButton(symbol: "arrow.up")
    /// «Close» as a word, not `xmark`, which is a cross (SPEC 0.4 6.5).
    let close = SymbolButton.spoken()
    /// New chat (NewChat.swift): shown only when this Mac has a face of Claude Code to open one in.
    let newChat = SymbolButton(symbol: "square.and.pencil")
    var newChatFaces: [NewChat] = []
    /// The DM thread (DmThread.swift): its switch, with a dot while something of hers is unread, and the way back.
    let dms = SymbolButton(symbol: "bubble.left.and.bubble.right")
    let sessionsButton = SymbolButton(symbol: "list.bullet")
    private var bubbles: [DmBubbleView] = []
    private let title = NSTextField(labelWithString: "")
    private let message = NSTextField(wrappingLabelWithString: "")
    private var rowButtons: [ActivityRowButton] = []
    private var inputControls: [NSView] = []
    /// The quota foot (0.4 SPEC 5.6, drawn with the band's battery and power bank since 10-14): one row a window
    /// under a hairline, its words a label so VoiceOver reads them; the pictures are drawn in draw(_:).
    private var footRows: [(window: QuotaWindow, label: NSTextField)] = []
    private var footTop: CGFloat?
    var rowPressed: (String) -> Void = { _ in }
    var targetPicked: (String) -> Void = { _ in }
    var labelChanged: () -> Void = {}
    private(set) var labelState = ButtonLabelState()
    private(set) var labelLanguage = "en"
    private var fitting = false
    var contrast = false { didSet {
        for button in [mic, send, close, newChat, dms, sessionsButton] { button.contrast = contrast }
        rowButtons.forEach { $0.contrast = contrast }
        bubbles.forEach { $0.contrast = contrast }
        if let placeholder = field.placeholderAttributedString {
            let value = NSMutableAttributedString(attributedString: placeholder)
            value.addAttribute(.foregroundColor, value: CardView.color(contrast ? 0x5A504C : 0x6B605C), range: NSRange(location: 0, length: value.length))
            field.placeholderAttributedString = value
        }
        needsDisplay = true
    } }
    var labelButton: SymbolButton? {
        guard let index = labelState.selection, labelButtons.indices.contains(index) else { return nil }
        let button = labelButtons[index]
        // A spoken button already shows its name.
        return button.isHidden || button.spoken ? nil : button
    }
    private var labelButtons: [SymbolButton] { [mic, send, close, newChat, dms, sessionsButton] }
    override var isFlipped: Bool { true }
    override func accessibilityChildren() -> [Any]? {
        var children: [NSView] = [title]
        children += rowButtons
        children += bubbles
        children += [message].filter { !$0.isHidden }
        children += inputControls
        children += footRows.map { $0.label }
        children += [dms, sessionsButton, newChat].filter { !$0.isHidden }
        return children + [close]
    }
    init() {
        super.init(frame: .zero)
        for view in [title, message, field, target, mic, send, newChat, dms, sessionsButton, close] { addSubview(view) }
        for button in [mic, send, close, newChat, dms, sessionsButton] { button.keyboardFocusable = true }
        for (index, button) in labelButtons.enumerated() {
            button.pointerChanged = { [weak self] inside in self?.pointerLabel(index, inside: inside) }
            button.focusChanged = { [weak self] inside in self?.focusLabel(index, inside: inside) }
            button.labelChanged = { [weak self] in self?.refreshLabel() }
        }
        send.seal = true; mic.quietBorder = true
        // This slip keeps cream paper in both themes, including the native field editor.
        appearance = NSAppearance(named: .aqua)
        field.font = SpeechView.font(12.5); field.textColor = CardView.ink
        field.backgroundColor = CardView.color(0xFFFAF7); field.isBezeled = true; field.bezelStyle = .roundedBezel
        field.focusRingType = .default; field.usesSingleLineMode = true
        target.font = SpeechView.font(12); target.target = self; target.action = #selector(pickTarget)
        setAccessibilityElement(true); setAccessibilityRole(.group)
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    @objc private func pickTarget() {
        if let id = target.selectedItem?.representedObject as? String { targetPicked(id) }
    }
    func pointerLabel(_ index: Int?, inside: Bool) {
        labelState.pointer(index, inside: inside); refreshLabel()
    }
    func focusLabel(_ index: Int?, inside: Bool) {
        labelState.focus(index, inside: inside); refreshLabel()
    }
    func clearLabels() {
        labelState.clear(); labelButtons.forEach { $0.clearHover() }; refreshLabel()
    }
    private func refreshLabel() { if !fitting { labelChanged() } }
    private func discardHiddenLabels() {
        for (index, button) in labelButtons.enumerated() where button.isHidden {
            labelState.pointer(index, inside: false)
            labelState.focus(index, inside: false)
            button.clearHover()
        }
    }
    func fit(rows: [ActivityRow], sessions: [Record], chosen: Record,
             status: String?, pending: Bool, retryKind: RequestKind? = nil, expired: Bool = false, width: CGFloat = 300,
             dmOpen: Bool = false) -> NSSize {
        fitting = true
        defer { fitting = false; discardHiddenLabels(); refreshLabel() }
        labelLanguage = chosen.lang
        let focusedRow = (window?.firstResponder as? ActivityRowButton)?.row.session
        let width = min(300, width), inner = width - 24, words = chosen.words, lang = chosen.lang
        let dm = chosen.dm, thread = dmOpen ? dm : nil
        // The DM thread is titled with her name, as a chat app names the person in it.
        title.attributedStringValue = CardView.text(thread != nil ? chosen.name : words.activity, size: 14, lineHeight: 18, bold: true, lang: lang)
        newChat.isHidden = newChatFaces.isEmpty || thread != nil
        dms.isHidden = dm == nil || thread != nil
        sessionsButton.isHidden = thread == nil
        dms.dot = (dm?.unread ?? 0) > 0
        let headerButtons = [newChat, dms, sessionsButton].filter { !$0.isHidden }
        let closeWidth = close.say(words.close, lang: lang)
        close.frame = NSRect(x: width - 12 - closeWidth, y: 11, width: closeWidth, height: 22)
        title.frame = NSRect(x: 27, y: 13, width: max(0, close.frame.minX - 30 - CGFloat(28 * headerButtons.count)), height: 20)
        setAccessibilityLabel(thread != nil ? chosen.name : words.activity)
        for (index, button) in headerButtons.enumerated() {
            button.frame = NSRect(x: close.frame.minX - 28 - CGFloat(28 * index), y: 12, width: 20, height: 20)
        }
        newChat.name(words.newChat)
        if let dm { dms.name(dm.unread > 0 ? "\(dm.label), \(dm.unread)" : dm.label) }
        sessionsButton.name(words.activity)
        rowButtons.forEach { $0.removeFromSuperview() }; rowButtons.removeAll()
        bubbles.forEach { $0.removeFromSuperview() }; bubbles.removeAll()
        var y: CGFloat = 39
        if let thread {
            let laid = DmLayout.bubbles(thread.thread, left: 12, right: Double(width - 12), top: 39) { text, wrap in
                DmBubbleView.measure(text, width: wrap, lang: lang)
            }
            for bubble in laid {
                let view = DmBubbleView(line: thread.thread[bubble.index], name: chosen.name, lang: lang)
                view.contrast = contrast
                view.frame = NSRect(x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height)
                addSubview(view); bubbles.append(view)
            }
            y = CGFloat(laid.last.map { $0.bottom + DmLayout.gap } ?? 39)
        } else {
            for row in rows.prefix(6) {
                let button = ActivityRowButton(row: row)
                button.contrast = contrast
                button.pressed = { [weak self] in self?.rowPressed(row.session) }
                button.frame = NSRect(origin: NSPoint(x: 12, y: y), size: button.fit(width: inner))
                y = button.frame.maxY; addSubview(button); rowButtons.append(button)
            }
        }
        let showMessage = thread == nil ? rows.isEmpty || status != nil : status != nil
        message.isHidden = !showMessage
        if showMessage {
            message.attributedStringValue = CardView.text(status ?? words.empty, size: 12.5, lineHeight: 17, bold: false, lang: lang)
            let height = ceil(message.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: inner, height: 100)).height ?? 17)
            message.frame = NSRect(x: 12, y: y + 6, width: inner, height: height); y = message.frame.maxY + 7
        }
        let channel = chosen.channel && !chosen.session.isEmpty
        for view in [field, target, mic, send] { view.isHidden = !channel }
        if channel {
            target.removeAllItems()
            for session in sessions {
                target.addItem(withTitle: session.project)
                target.lastItem?.representedObject = session.session
                if session.session == chosen.session { target.select(target.lastItem) }
            }
            target.isHidden = sessions.count < 2 || thread != nil
            // The picker names its project whole, up to 45 percent of the row, then a middle ellipsis; the field keeps
            // the rest (OUTSIDE F3, companion-rs ui.rs).
            let projectWidth = (chosen.project as NSString).size(withAttributes: [.font: SpeechView.font(12)]).width
            let menuWidth = target.isHidden ? 0 : min(max(84, ceil(projectWidth) + 32), floor(inner * 0.45))
            (target.cell as? NSPopUpButtonCell)?.lineBreakMode = .byTruncatingMiddle
            let fieldWidth = inner - 68 - (target.isHidden ? 0 : menuWidth + 6)
            let singleRow = fieldWidth >= 96
            let inputY = y + 8
            field.frame = NSRect(x: singleRow && !target.isHidden ? 12 + menuWidth + 6 : 12,
                                 y: inputY, width: singleRow ? fieldWidth : inner, height: 28)
            let controlsY = singleRow ? inputY : field.frame.maxY + 6
            if !target.isHidden {
                target.frame = NSRect(x: 12, y: controlsY, width: menuWidth, height: 28)
                target.setAccessibilityLabel(chosen.project)
            }
            let hint = (thread ?? dm)?.placeholder ?? words.placeholder.replacingOccurrences(of: "{project}", with: chosen.project)
            let placeholder = NSMutableAttributedString(attributedString: CardView.text(hint, size: 12.5, lineHeight: 17, bold: false, lang: lang))
            placeholder.addAttribute(.foregroundColor, value: CardView.color(contrast ? 0x5A504C : 0x6B605C), range: NSRange(location: 0, length: placeholder.length))
            field.placeholderAttributedString = placeholder
            field.setAccessibilityLabel(hint)
            mic.name(words.dictate); send.name(retryKind?.written == true ? words.retry : words.send)
            send.frame = NSRect(x: width - 40, y: controlsY, width: 28, height: 28)
            mic.frame = NSRect(x: send.frame.minX - 34, y: controlsY, width: 28, height: 28)
            send.keyEquivalent = "" // Return is handled by the field editor.
            for control in [field, target, mic, send] { control.isEnabled = !pending }
            if expired && retryKind?.written == true { send.isEnabled = false }
            send.alphaValue = send.isEnabled ? 1 : 0.45
            y = send.frame.maxY
        }
        inputControls = channel ? (target.isHidden ? [field, mic, send] : [field, target, mic, send]) : []
        var controls: [NSView] = rowButtons + inputControls
        controls += [dms, sessionsButton, newChat].filter { !$0.isHidden }
        controls.append(close)
        for (index, view) in controls.enumerated() { view.nextKeyView = controls[(index + 1) % controls.count] }
        if let focusedRow {
            let replacement = rowButtons.first(where: { $0.row.session == focusedRow }) ?? controls.first
            window?.makeFirstResponder(replacement)
        }
        // The DM thread leaves the quota foot to the sessions' view.
        let height = fitFoot(thread != nil ? [] : chosen.quota ?? [], lang: lang, top: y + 12) ?? y + 12
        frame.size = NSSize(width: width, height: height); needsDisplay = true
        return frame.size
    }
    /// Lays out the foot's rows from `top` and returns the panel's height, or nil with no reading: the window's name
    /// bold, then how much is used, the pace while hot and the reset, joined by the language's comma (the Rust pet's
    /// ui.rs quota_foot_rows: words from x 46, 242 points wide, after the 26-point battery).
    private func fitFoot(_ windows: [QuotaWindow], lang: String, top: CGFloat, now: Date = Date()) -> CGFloat? {
        footRows.forEach { $0.label.removeFromSuperview() }; footRows.removeAll(); footTop = nil
        guard !windows.isEmpty else { return nil }
        let words = QuotaWords(lang: lang, table: QuotaWords.bundled.table, languages: QuotaWords.bundled.languages)
        var rowY = top + 5
        for window in windows {
            let (name, parts) = words.parts(window, now: now.timeIntervalSince1970 * 1000, lang: lang)
            let whole = parts.joined(separator: Clauses.separator(lang))
            let text = NSMutableAttributedString(attributedString: CardView.text(name, size: 12.5, lineHeight: 17, bold: true, lang: lang))
            text.append(CardView.text(String(whole.dropFirst(name.count)), size: 12.5, lineHeight: 17, bold: false, lang: lang))
            let label = NSTextField(labelWithAttributedString: text)
            label.lineBreakMode = .byWordWrapping; label.maximumNumberOfLines = 0; label.isSelectable = false
            label.setAccessibilityRole(.staticText)
            let measured = label.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: 242, height: 1000)).height ?? 17
            let height = max(20, ceil(measured))
            label.frame = NSRect(x: 46, y: rowY, width: 242, height: height)
            addSubview(label); footRows.append((window, label))
            rowY += height + (height > 32 ? 10 : 2)
        }
        footTop = top
        return rowY + 3
    }
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 9, yRadius: 9)
        CardView.paper.setFill(); path.fill()
        NSGraphicsContext.saveGraphicsState(); path.addClip()
        CardView.vermilion.setFill(); NSRect(x: 0, y: 0, width: bounds.width, height: 3).fill()
        if let top = footTop {
            // The foot's paper #F5E4DC and its hairline: ink at 18 %, full ink under Increase Contrast (HIGH-CONTRAST 2.2).
            CardView.color(0xF5E4DC).setFill(); NSRect(x: 0, y: top, width: bounds.width, height: bounds.height - top).fill()
            (contrast ? CardView.ink : CardView.ink.withAlphaComponent(0.18)).setFill()
            NSRect(x: 12, y: top, width: bounds.width - 24, height: 0.5).fill()
            // The pictures, one point an art pixel on the row's first line; this slip stays cream, so the outline
            // never needs the dark ground's colour, and high contrast leaves pictures as they are (section 5).
            for (window, label) in footRows {
                guard let rows = QuotaPixels.forWindow(kind: window.kind, used: window.used) else { continue }
                for cell in QuotaPixels.cells(rows, darkGround: false) {
                    CardView.color(cell.rgb).setFill()
                    NSRect(x: 12 + CGFloat(cell.x), y: label.frame.minY + 4 + CGFloat(cell.y), width: 1, height: 1).fill()
                }
            }
        }
        NSGraphicsContext.restoreGraphicsState()
        (contrast ? CardView.ink : CardView.ink.withAlphaComponent(0.16)).setStroke(); path.lineWidth = contrast ? 1 : 0.5; path.stroke()
        PaperPill.spark(at: NSPoint(x: 17, y: 21))
    }
}

@MainActor
final class Activity: NSObject, NSWindowDelegate {
    let panel = ActivityPanel()
    let view = ActivityView()
    let label = ButtonLabel()
    var closed: () -> Void = {}
    var rowSelected: (String) -> Void = { _ in }
    var requestChanged: () -> Void = {}
    private var previous: NSRunningApplication?
    private let channel: RequestChannel?
    private let now: () -> Double
    private let allowsWindowPresentation: Bool
    private var placement: Place.Target
    private var rows: [ActivityRow]
    private var sessions: [Record]
    private var chosen: Record
    private var pending: PendingRequest?
    private var phase: RequestDecision?
    /// The window shows her DM thread (DmThread.swift) in place of the sessions.
    private(set) var dmOpen = false
    private var dmReadAt = 0.0
    var dmVisible: Bool { dmOpen && panel.isVisible && chosen.dm != nil }
    private var status: String? {
        switch phase {
        case .sending: chosen.words.sending
        case .unconfirmed: chosen.words.unconfirmed
        case .expired: chosen.words.expired
        default: nil
        }
    }
    private var closing = false
    private var layingOut = false
    private let motion = CompanionPanelMotion()
    private var tuning = CompanionTuning.standard
    private var reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    var contrastPreference: () -> Bool = { NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast }
    private(set) var narrowLayoutBlocked = false
    private(set) var narrowOverflowPt = 0.0
    var layoutSide: Place.LineSide? { motion.side }
    private(set) var hasPlacement = false
    private(set) var presentationSuspended = false
    private(set) var presentationRequested = false
    private lazy var timeout = OneShot { [weak self] in self?.checkTimeout() }
    init(rows: [ActivityRow], sessions: [Record], chosen: Record, target: Place.Target, channel: RequestChannel?,
         allowsWindowPresentation: Bool = true,
         now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.rows = rows; self.sessions = sessions; self.chosen = chosen; placement = target; self.channel = channel; self.now = now
        self.allowsWindowPresentation = allowsWindowPresentation
        super.init()
        panel.contentView = view; panel.delegate = self; panel.appearance = view.appearance
        view.labelChanged = { [weak self] in self?.refreshLabel() }
        panel.escape = { [weak self] in self?.close() }
        view.close.pressed = { [weak self] in self?.close() }
        view.newChatFaces = NewChat.available()
        view.newChat.pressed = { [weak self] in self?.newChat() }
        view.dms.pressed = { [weak self] in self?.showDm(true) }
        view.sessionsButton.pressed = { [weak self] in self?.showDm(false) }
        view.rowPressed = { [weak self] id in self?.selectRow(id) }
        view.targetPicked = { [weak self] id in self?.pick(id) }
        view.field.send = { [weak self] in self?.submit() }
        view.field.changed = { [weak self] in self?.layout() }
        view.send.pressed = { [weak self] in self?.submit() }
        view.mic.pressed = { [weak self] in self?.dictate() }
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(displayOptionsChanged),
            name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
    }
    func configure(_ tuning: CompanionTuning, reduceMotion: Bool? = nil) {
        self.tuning = tuning
        if let reduceMotion { reduced = reduceMotion }
        guard !closing else { return }
        layout()
    }
    @objc private func displayOptionsChanged() {
        let next = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let changedMotion = reduced != next
        reduced = next
        if !closing {
            if changedMotion { layout() }
            else { view.contrast = contrastPreference(); label.view?.contrast = view.contrast }
        }
    }
    /// Cut presentation while retaining the controller, request state, and unsent draft.
    /// Set the guard before orderOut so its key-window notification cannot close the draft.
    func suspendPresentation() {
        guard !closing else { return }
        presentationRequested = presentationRequested || panel.isVisible
        presentationSuspended = true; hasPlacement = false
        view.clearLabels(); label.hide(); motion.reset(on: panel); panel.orderOut(nil)
    }
    /// Only selected-target geometry reaches this method. Returning geometry resumes a
    /// previously presented Activity without activating or restoring another application.
    func follow(_ target: Place.Target?, fullScreen: Bool = false) {
        guard !closing else { return }
        guard let target else { suspendPresentation(); return }
        let resume = presentationSuspended && presentationRequested
        presentationSuspended = false
        let delta = CGPoint(x: target.frame.midX - placement.frame.midX, y: target.frame.minY - placement.frame.minY)
        if panel.isVisible { panel.setFrameOrigin(CGPoint(x: panel.frame.minX + delta.x, y: panel.frame.minY + delta.y)) }
        placement = target
        panel.collectionBehavior = fullScreen ? [.moveToActiveSpace, .fullScreenAuxiliary, .ignoresCycle]
            : [.moveToActiveSpace, .fullScreenNone, .ignoresCycle]
        if layout(), resume, allowsWindowPresentation { panel.orderFront(nil) }
    }
    func open() {
        guard !closing, layout() else { return }
        presentationRequested = true
        guard allowsWindowPresentation else { return }
        previous = NSWorkspace.shared.frontmostApplication
        NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(chosen.channel ? view.field : view.close)
        NSAccessibility.post(element: view, notification: .layoutChanged)
    }
    /// Opens on her DM thread.
    func openDm() {
        dmOpen = chosen.dm != nil
        open()
        dmRead()
    }
    /// The thread or the sessions, from the header's switch, the badge or a notification; never while a message is on
    /// its way. A typed draft is not carried across.
    func showDm(_ on: Bool) {
        guard !closing, phase != .sending else { return }
        dmOpen = on && chosen.dm != nil
        pending = nil; phase = nil; view.field.stringValue = ""
        layout()
        panel.makeFirstResponder(chosen.channel ? view.field : view.close)
        NSAccessibility.post(element: view, notification: .layoutChanged)
        dmRead()
    }
    /// The thread on screen reads her messages: the plugin hears it once, then again five seconds on if the record
    /// still says unread (the Rust pet's engine.rs dm_read).
    private func dmRead() {
        let time = now()
        guard dmOpen, panel.isVisible, (chosen.dm?.unread ?? 0) > 0, time >= dmReadAt + 5_000, let channel else { return }
        dmReadAt = time
        _ = try? channel.append(session: chosen.session, kind: .dmSeen, at: time)
        requestChanged()
    }
    @discardableResult private func layout() -> Bool {
        guard !closing, !presentationSuspended else { return false }
        layingOut = true
        defer { layingOut = false; refreshLabel() }
        view.contrast = contrastPreference()
        let retryKind = pending.flatMap { sameRequest($0.request, kind: $0.request.kind) ? $0.request.kind : nil }
        func fit(_ width: CGFloat) -> NSSize {
            view.fit(rows: rows, sessions: sessions, chosen: chosen, status: status,
                     pending: phase == .sending, retryKind: retryKind, expired: phase == .expired, width: width, dmOpen: dmOpen)
        }
        let wide = fit(max(140, placement.visible.width - 16))
        var size = wide
        var selected = Place.linePlacement(for: placement, size: size, current: motion.side, motion: tuning.motion, allowFallback: false)
        narrowLayoutBlocked = false; narrowOverflowPt = 0
        if selected == nil {
            size = fit(Place.lineWidthLimit(for: placement, size: size, motion: tuning.motion))
            // Keep physically insufficient widths out of presentation and try the wider safe placement.
            let overflow = view.subviews.filter { !$0.isHidden }.map { max(0, $0.frame.maxX - (size.width - 12), 12 - $0.frame.minX) }.max() ?? 0
            if overflow > 0 || size.width < 140 {
                narrowLayoutBlocked = true; narrowOverflowPt = Double(overflow)
                size = fit(wide.width)
            }
            selected = Place.linePlacement(for: placement, size: size, current: motion.side, motion: tuning.motion)
        }
        guard var selected else {
            hasPlacement = false
            suspendPresentation()
            return false
        }
        hasPlacement = true
        if Pet.offscreen { selected.frame.origin.x += 30_000 }
        motion.place(panel, placement: selected, reduceMotion: reduced, tuning: tuning.motion)
        return true
    }
    private func refreshLabel() {
        guard !layingOut else { return }
        guard !closing, panel.isVisible, let button = view.labelButton,
              let text = button.accessibilityLabel() else { label.hide(); return }
        let buttonFrame = panel.convertToScreen(button.convert(button.bounds, to: nil))
        var visible = placement.visible
        if Pet.offscreen { visible.origin.x += 30_000 }
        label.show(text: text, lang: view.labelLanguage, button: buttonFrame, row: buttonFrame,
                   visible: visible, parent: panel, contrast: view.contrast, faceKeepOut: offsetFaceKeepOut())
    }
    private func offsetFaceKeepOut() -> CGRect {
        var face = Place.faceKeepOut(for: placement, motion: tuning.motion)
        if Pet.offscreen { face.origin.x += 30_000 }
        return face
    }
    func update(rows: [ActivityRow], sessions: [Record]) {
        // Keep the words just opened long enough to read; new events and ended sessions replace them.
        self.rows = rows.map { current in
            guard let held = self.rows.first(where: { $0.session == current.session }),
                  held.record.done == current.record.done, held.record.waitAt == current.record.waitAt,
                  held.record.mood == current.record.mood, held.record.task == current.record.task,
                  current.record.notice == nil || held.record.notice?.at == current.record.notice?.at else { return current }
            var display = current
            if held.excerpt != nil { display.excerpt = held.excerpt }
            if held.unseen, held.record.notice != nil {
                display.state = held.state
                if display.record.notice == nil { display.record.notice = held.record.notice }
            }
            display.unseen = held.unseen
            return display
        }
        self.sessions = sessions
        if let updated = sessions.first(where: { $0.session == chosen.session }) { chosen = updated }
        else { chosen.channel = false }
        if dmOpen && chosen.dm == nil { dmOpen = false }
        layout()
        dmRead()
    }
    private func pick(_ id: String) {
        guard phase != .sending, let record = sessions.first(where: { $0.session == id }) else { return }
        chosen = record; phase = nil; pending = nil; layout(); panel.makeFirstResponder(view.field)
    }
    private func selectRow(_ id: String) {
        rowSelected(id)
        close()
        NSRunningApplication.runningApplications(withBundleIdentifier: targetBundleID).first?.activate(options: [])
    }
    private func submit() {
        guard !view.field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        // With her DM on, the box writes to her, in the thread or not (his call 10-20); otherwise it is a note to the session.
        send(chosen.dm != nil ? .dm : .submit)
    }
    private func send(_ kind: RequestKind) {
        guard chosen.channel, phase != .sending else { return }
        do {
            guard let channel else { throw RequestChannelError.createFailed }
            let now = now()
            let text = kind.written ? view.field.stringValue : nil
            let request: ChannelRequest
            if let pending, sameRequest(pending.request, kind: kind) {
                request = try channel.retry(pending.request, now: now)
            } else if let held = try channel.outstandingRequest(session: chosen.session, kind: kind, text: text, now: now) {
                request = try channel.retry(held, now: now)
            } else {
                request = try channel.append(session: chosen.session, kind: kind, text: text, at: now)
            }
            pending = PendingRequest(request: request, attemptedAt: now); phase = .sending
            requestChanged(); armTimeout(now: now); layout()
        } catch RequestChannelError.expiredRequest { phase = .expired; requestChanged(); layout() }
        catch { phase = .unconfirmed; requestChanged(); layout() }
    }
    private func sameRequest(_ request: ChannelRequest, kind: RequestKind) -> Bool {
        request.session == chosen.session && request.kind == kind
            && (!kind.written || request.text == view.field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    private func armTimeout(now: Double) {
        guard let pending else { return }
        let next = min(pending.attemptedAt + PendingRequest.timeout, pending.request.at + RequestChannel.lifetime + 1)
        timeout.fire(after: max(0.001, (next - now) / 1000))
    }
    func receive(_ record: Record) {
        // Her reply in the open thread shows as it comes, and is read at once.
        if dmOpen, !closing, record.session == chosen.session, record.dm != chosen.dm, record.dm != nil {
            chosen.dm = record.dm; layout(); dmRead()
        }
        guard let pending, record.session == pending.request.session else { return }
        if pending.decision(ack: record.ack, now: now()) == .acknowledged {
            timeout.cancel()
            // A chat goes on: the window shows the thread for her reply.
            if pending.request.kind == .dm {
                self.pending = nil; phase = nil; view.field.stringValue = ""; dmOpen = chosen.dm != nil
                requestChanged(); layout(); panel.makeFirstResponder(view.field); dmRead()
            } else { close() }
        }
    }
    func checkTimeout() {
        guard let pending else { return }
        let now = now()
        phase = pending.decision(ack: nil, now: now)
        if phase == .unconfirmed {
            timeout.fire(after: max(0.001, (pending.request.at + RequestChannel.lifetime + 1 - now) / 1000))
        } else if phase == .sending { armTimeout(now: now) }
        layout()
        panel.makeFirstResponder(view.field)
        NSAccessibility.post(element: view, notification: .layoutChanged)
    }
    /// His rule (10-16): the only face there is opens at once; with more than one, a menu asks which.
    private func newChat() {
        let faces = view.newChatFaces
        if faces.count == 1 { start(faces[0]); return }
        guard !faces.isEmpty else { return }
        let menu = NSMenu()
        for face in faces {
            let item = NSMenuItem(title: face.word(chosen.words), action: #selector(newChatPicked(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = face.rawValue
            menu.addItem(item)
        }
        // The view is flipped: the menu hangs just below the button.
        _ = menu.popUp(positioning: nil, at: NSPoint(x: view.newChat.frame.minX, y: view.newChat.frame.maxY + 4), in: view)
    }
    @objc private func newChatPicked(_ item: NSMenuItem) {
        guard let raw = item.representedObject as? String, let face = NewChat(rawValue: raw) else { return }
        start(face)
    }
    /// The new conversation takes the focus, so the app that was in front is not brought back.
    private func start(_ face: NewChat) {
        guard let link = face.link(folder: chosen.cwd) else { return }
        close(restorePrevious: false)
        _ = NSWorkspace.shared.open(link)
    }
    private func dictate() {
        panel.makeFirstResponder(view.field)
        NSApp.sendAction(Selector(("startDictation:")), to: nil, from: view.mic)
    }
    func windowDidResignKey(_ notification: Notification) {
        if !presentationSuspended { close() }
    }
    func close(restorePrevious: Bool = true) {
        guard !closing else { return }; closing = true
        hasPlacement = false; presentationRequested = false; presentationSuspended = false
        view.clearLabels(); label.hide()
        timeout.cancel(); motion.reset(on: panel); panel.orderOut(nil); panel.close(); panel.delegate = nil
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        if restorePrevious { previous?.activate(options: []) }
        previous = nil
        closed()
    }
    var targetBundleID = Claude.bundleID

    static func backToClaude() {
        NSRunningApplication.runningApplications(withBundleIdentifier: Claude.bundleID).first?.activate(options: [])
    }
}
