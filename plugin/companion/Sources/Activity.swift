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
        collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
    }
    override func cancelOperation(_ sender: Any?) { escape() }
}

/// A native button with the two non-colour cues for unseen work.
final class ActivityRowButton: NSButton {
    let row: ActivityRow
    var pressed: () -> Void = {}
    private var heading = NSAttributedString()
    private var clock = NSAttributedString()
    private var excerpt = NSAttributedString()
    static let formatter: DateFormatter = {
        let value = DateFormatter(); value.locale = Locale(identifier: "en_US_POSIX"); return value
    }()
    init(row: ActivityRow, today: Date = Date()) {
        self.row = row
        super.init(frame: .zero)
        isBordered = false; setButtonType(.momentaryPushIn); target = self; action = #selector(pressRow)
        let head = NSMutableAttributedString(attributedString: CardView.text(row.project, size: 12.5, lineHeight: 17, bold: row.unseen, lang: row.record.lang))
        head.append(CardView.text(" · " + row.state, size: 12.5, lineHeight: 17, bold: false, lang: row.record.lang))
        heading = head
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
        let height = row.excerpt == nil ? 30.0 : 30 + min(32, ceil(excerpt.boundingRect(with: NSSize(width: width - 12, height: 1000), options: [.usesLineFragmentOrigin]).height)) + 2
        return NSSize(width: width, height: height)
    }
    @objc private func pressRow() { pressed() }
    override func accessibilityPerformPress() -> Bool { pressed(); return true }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 36 || event.keyCode == 76 { pressed() } else { super.keyDown(with: event) }
    }
    override func draw(_ dirtyRect: NSRect) {
        if isHighlighted { CardView.ink.withAlphaComponent(0.06).setFill(); bounds.fill() }
        CardView.ink.withAlphaComponent(0.18).setFill(); NSRect(x: 0, y: 0, width: bounds.width, height: 0.5).fill()
        let dot = NSBezierPath(ovalIn: NSRect(x: 0, y: 11, width: 7, height: 7))
        if row.unseen { CardView.color(0x9E4123).setFill(); dot.fill() }
        else { CardView.color(0x8E8481).setStroke(); dot.lineWidth = 1; dot.stroke() }
        let width = clock.size().width
        clock.draw(in: NSRect(x: bounds.width - width, y: 6, width: width, height: 18))
        let head = NSMutableAttributedString(attributedString: heading)
        let style = NSMutableParagraphStyle(); style.lineBreakMode = .byTruncatingTail
        head.addAttribute(.paragraphStyle, value: style, range: NSRange(location: 0, length: head.length))
        head.draw(in: NSRect(x: 12, y: 6, width: max(0, bounds.width - width - 18), height: 18))
        if row.excerpt != nil { excerpt.draw(with: NSRect(x: 12, y: 25, width: bounds.width - 12, height: 32), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine]) }
        if window?.firstResponder === self {
            CardView.vermilion.setStroke(); let focus = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 3, yRadius: 3); focus.lineWidth = 1.5; focus.stroke()
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

/// Layout stays native, including Tab order, a real field editor and the responder-chain dictation.
final class ActivityView: NSView {
    let field = ActivityField()
    let target = NSPopUpButton(frame: .zero, pullsDown: false)
    let mic = SymbolButton(symbol: "mic")
    let send = SymbolButton(symbol: "arrow.up")
    let close = SymbolButton(symbol: "xmark")
    let newChat = CardButton(seal: false)
    let cancel = CardButton(seal: true)
    let clear = CardButton(seal: false)
    private let title = NSTextField(labelWithString: "")
    private let message = NSTextField(wrappingLabelWithString: "")
    private let question = NSTextField(wrappingLabelWithString: "")
    private var rowButtons: [ActivityRowButton] = []
    var rowPressed: (String) -> Void = { _ in }
    var targetPicked: (String) -> Void = { _ in }
    var labelChanged: () -> Void = {}
    private(set) var labelState = ButtonLabelState()
    private(set) var labelLanguage = "en"
    private var fitting = false
    var contrast = false
    var labelButton: SymbolButton? {
        guard let index = labelState.selection, labelButtons.indices.contains(index) else { return nil }
        let button = labelButtons[index]
        return button.isHidden ? nil : button
    }
    private var labelButtons: [SymbolButton] { [mic, send, close] }
    override var isFlipped: Bool { true }
    init() {
        super.init(frame: .zero)
        for view in [title, message, question, field, target, mic, send, close, newChat, cancel, clear] { addSubview(view) }
        for button in [mic, send, close] { button.keyboardFocusable = true }
        for (index, button) in labelButtons.enumerated() {
            button.pointerChanged = { [weak self] inside in self?.pointerLabel(index, inside: inside) }
            button.focusChanged = { [weak self] inside in self?.focusLabel(index, inside: inside) }
            button.labelChanged = { [weak self] in self?.refreshLabel() }
        }
        for button in [newChat, cancel, clear] { button.keyboardFocusable = true }
        send.seal = true; mic.quietBorder = true
        newChat.borderlessQuiet = true
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
    func fit(rows: [ActivityRow], sessions: [Record], chosen: Record, confirming: Bool,
             status: String?, pending: Bool, retryKind: RequestKind? = nil, expired: Bool = false, width: CGFloat = 300) -> NSSize {
        fitting = true
        defer { fitting = false; discardHiddenLabels(); refreshLabel() }
        labelLanguage = chosen.lang
        let focusedRow = (window?.firstResponder as? ActivityRowButton)?.row.session
        let width = min(300, width), inner = width - 24, words = chosen.words, lang = chosen.lang
        title.attributedStringValue = CardView.text(words.activity, size: 14, lineHeight: 18, bold: true, lang: lang)
        title.frame = NSRect(x: 27, y: 13, width: inner - 40, height: 20)
        setAccessibilityLabel(words.activity)
        close.name(words.close); close.frame = NSRect(x: width - 34, y: 12, width: 20, height: 20)
        rowButtons.forEach { $0.removeFromSuperview() }; rowButtons.removeAll()
        var y: CGFloat = 39
        for row in rows.prefix(6) {
            let button = ActivityRowButton(row: row)
            button.pressed = { [weak self] in self?.rowPressed(row.session) }
            button.frame = NSRect(origin: NSPoint(x: 12, y: y), size: button.fit(width: inner))
            y = button.frame.maxY; addSubview(button); rowButtons.append(button)
        }
        message.isHidden = !rows.isEmpty && status == nil
        if rows.isEmpty || status != nil {
            message.attributedStringValue = CardView.text(status ?? words.empty, size: 12.5, lineHeight: 17, bold: false, lang: lang)
            let height = ceil(message.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: inner, height: 100)).height ?? 17)
            message.frame = NSRect(x: 12, y: y + 6, width: inner, height: height); y = message.frame.maxY + 7
        }
        let channel = chosen.channel && !chosen.session.isEmpty
        for view in [field, target, mic, send, newChat] { view.isHidden = !channel || confirming }
        for view in [question, cancel, clear] { view.isHidden = !channel || !confirming }
        if channel && confirming {
            question.attributedStringValue = CardView.text(words.confirmClear.replacingOccurrences(of: "{project}", with: chosen.project), size: 12.5, lineHeight: 17, bold: false, lang: lang)
            let height = ceil(question.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: inner, height: 100)).height ?? 17)
            question.frame = NSRect(x: 12, y: y + 8, width: inner, height: height)
            cancel.configure(words.cancel, lang: lang); clear.configure(retryKind == .clear ? words.retry : words.clear, lang: lang)
            cancel.frame = NSRect(x: 12, y: question.frame.maxY + 8, width: min(inner, cancel.fittedWidth), height: 26)
            clear.frame = NSRect(x: cancel.frame.maxX + 8, y: cancel.frame.minY, width: min(inner - cancel.frame.width - 8, clear.fittedWidth), height: 26)
            cancel.keyEquivalent = "\r"; clear.keyEquivalent = ""
            cancel.isEnabled = !pending; clear.isEnabled = !pending
            if retryKind == .clear { clear.isEnabled = !pending && !expired }
            y = clear.frame.maxY
        } else if channel {
            target.removeAllItems()
            for session in sessions {
                target.addItem(withTitle: session.project)
                target.lastItem?.representedObject = session.session
                if session.session == chosen.session { target.select(target.lastItem) }
            }
            target.isHidden = sessions.count < 2
            var x: CGFloat = 12
            // A bounded menu before the field still leaves room to type in long project names.
            if !target.isHidden {
                target.frame = NSRect(x: x, y: y + 8, width: min(84, inner * 0.3), height: 28); x = target.frame.maxX + 6
                target.setAccessibilityLabel(chosen.project)
            }
            field.frame = NSRect(x: x, y: y + 8, width: max(20, width - 12 - x - 68), height: 28)
            let placeholder = NSMutableAttributedString(attributedString: CardView.text(words.placeholder.replacingOccurrences(of: "{project}", with: chosen.project), size: 12.5, lineHeight: 17, bold: false, lang: lang))
            placeholder.addAttribute(.foregroundColor, value: CardView.color(0x6B605C), range: NSRange(location: 0, length: placeholder.length))
            field.placeholderAttributedString = placeholder
            field.setAccessibilityLabel(words.placeholder.replacingOccurrences(of: "{project}", with: chosen.project))
            mic.name(words.dictate); send.name(retryKind == .submit ? words.retry : words.send)
            mic.frame = NSRect(x: field.frame.maxX + 6, y: field.frame.minY, width: 28, height: 28)
            send.frame = NSRect(x: mic.frame.maxX + 6, y: field.frame.minY, width: 28, height: 28)
            newChat.configure(retryKind == .clear ? words.retry : words.newChat, lang: lang)
            newChat.image = NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: nil)
            newChat.frame = NSRect(x: 12, y: field.frame.maxY + 8, width: min(inner, newChat.fittedWidth + 18), height: 26)
            cancel.keyEquivalent = ""; send.keyEquivalent = "" // Return is handled by the field editor.
            for control in [field, target, mic, send, newChat] { control.isEnabled = !pending }
            if expired && retryKind == .submit { send.isEnabled = false }
            if expired && retryKind == .clear { newChat.isEnabled = false }
            send.alphaValue = send.isEnabled ? 1 : 0.45
            y = newChat.frame.maxY
        }
        var controls: [NSView] = rowButtons
        if channel { controls += confirming ? [cancel, clear] : (target.isHidden ? [field, mic, send, newChat] : [target, field, mic, send, newChat]) }
        controls.append(close)
        for (index, view) in controls.enumerated() { view.nextKeyView = controls[(index + 1) % controls.count] }
        if let focusedRow {
            let replacement = rowButtons.first(where: { $0.row.session == focusedRow }) ?? controls.first
            window?.makeFirstResponder(replacement)
        }
        for button in [newChat, cancel, clear] { button.contrast = contrast }
        frame.size = NSSize(width: width, height: y + 12); needsDisplay = true
        return frame.size
    }
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 9, yRadius: 9)
        CardView.paper.setFill(); path.fill()
        NSGraphicsContext.saveGraphicsState(); path.addClip()
        CardView.vermilion.setFill(); NSRect(x: 0, y: 0, width: bounds.width, height: 3).fill(); NSGraphicsContext.restoreGraphicsState()
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
    private var placement: Place.Target
    private var rows: [ActivityRow]
    private var sessions: [Record]
    private var chosen: Record
    private var confirming = false
    private var pending: PendingRequest?
    private var phase: RequestDecision?
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
    private lazy var timeout = OneShot { [weak self] in self?.checkTimeout() }
    init(rows: [ActivityRow], sessions: [Record], chosen: Record, target: Place.Target, channel: RequestChannel?,
         now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.rows = rows; self.sessions = sessions; self.chosen = chosen; placement = target; self.channel = channel; self.now = now
        super.init()
        panel.contentView = view; panel.delegate = self; panel.appearance = view.appearance
        view.labelChanged = { [weak self] in self?.refreshLabel() }
        panel.escape = { [weak self] in self?.close() }
        view.close.pressed = { [weak self] in self?.close() }
        view.rowPressed = { [weak self] id in self?.selectRow(id) }
        view.targetPicked = { [weak self] id in self?.pick(id) }
        view.field.send = { [weak self] in self?.submit() }
        view.field.changed = { [weak self] in self?.layout() }
        view.send.pressed = { [weak self] in self?.submit() }
        view.mic.pressed = { [weak self] in self?.dictate() }
        view.newChat.pressed = { [weak self] in
            guard let self else { return }
            if self.pending?.request.kind == .clear { self.send(.clear); return }
            self.confirming = true; self.layout(); self.panel.makeFirstResponder(self.view.cancel)
        }
        view.cancel.pressed = { [weak self] in
            guard let self else { return }; self.confirming = false; self.layout(); self.panel.makeFirstResponder(self.view.field)
        }
        view.clear.pressed = { [weak self] in self?.send(.clear) }
    }
    func open() {
        previous = NSWorkspace.shared.frontmostApplication
        layout()
        NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(chosen.channel ? view.field : view.close)
        NSAccessibility.post(element: view, notification: .layoutChanged)
    }
    private func layout() {
        layingOut = true
        defer { layingOut = false; refreshLabel() }
        view.contrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
        let retryKind = pending.flatMap { sameRequest($0.request, kind: $0.request.kind) ? $0.request.kind : nil }
        let size = view.fit(rows: rows, sessions: sessions, chosen: chosen, confirming: confirming, status: status,
                            pending: phase == .sending, retryKind: retryKind, expired: phase == .expired, width: placement.visible.width - 16)
        let area = placement.visible
        var frame = Place.lineFrame(for: placement, size: size)
        frame.origin.x = Place.clamp(frame.minX, area.minX + 4, area.maxX - frame.width - 4)
        frame.origin.y = Place.clamp(frame.minY, area.minY + 2, area.maxY - frame.height - 2)
        if Pet.offscreen { frame.origin.x += 30_000 }
        panel.setFrame(frame, display: true)
    }
    private func refreshLabel() {
        guard !layingOut else { return }
        guard !closing, panel.isVisible, let button = view.labelButton,
              let text = button.accessibilityLabel() else { label.hide(); return }
        let buttonFrame = panel.convertToScreen(button.convert(button.bounds, to: nil))
        var visible = placement.visible
        if Pet.offscreen { visible.origin.x += 30_000 }
        label.show(text: text, lang: view.labelLanguage, button: buttonFrame, row: buttonFrame,
                   visible: visible, parent: panel, contrast: view.contrast)
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
        layout()
    }
    private func pick(_ id: String) {
        guard phase != .sending, let record = sessions.first(where: { $0.session == id }) else { return }
        chosen = record; phase = nil; pending = nil; confirming = false; layout(); panel.makeFirstResponder(view.field)
    }
    private func selectRow(_ id: String) {
        rowSelected(id)
        close()
        Self.backToClaude()
    }
    private func submit() {
        guard !view.field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        send(.submit)
    }
    private func send(_ kind: RequestKind) {
        guard chosen.channel, phase != .sending else { return }
        do {
            guard let channel else { throw RequestChannelError.createFailed }
            let now = now()
            let text = kind == .submit ? view.field.stringValue : nil
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
            && (kind != .submit || request.text == view.field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    private func armTimeout(now: Double) {
        guard let pending else { return }
        let next = min(pending.attemptedAt + PendingRequest.timeout, pending.request.at + RequestChannel.lifetime + 1)
        timeout.fire(after: max(0.001, (next - now) / 1000))
    }
    func receive(_ record: Record) {
        guard let pending, record.session == pending.request.session else { return }
        if pending.decision(ack: record.ack, now: now()) == .acknowledged {
            timeout.cancel(); close()
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
        if !confirming { panel.makeFirstResponder(view.field) }
        NSAccessibility.post(element: view, notification: .layoutChanged)
    }
    private func dictate() {
        panel.makeFirstResponder(view.field)
        NSApp.sendAction(Selector(("startDictation:")), to: nil, from: view.mic)
    }
    func windowDidResignKey(_ notification: Notification) { close() }
    func close() {
        guard !closing else { return }; closing = true
        view.clearLabels(); label.hide()
        timeout.cancel(); panel.orderOut(nil); panel.close(); panel.delegate = nil
        previous?.activate(options: []); previous = nil
        closed()
    }
    static func backToClaude() {
        NSRunningApplication.runningApplications(withBundleIdentifier: Claude.bundleID).first?.activate(options: [])
    }
}
