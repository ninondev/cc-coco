//! One event loop sleeps in poll(2): display events, directory notifications, or the next
//! scheduled picture/gesture deadline. There is no periodic feed or window-position check.
use crate::{
    engine::{Action, Engine},
    epoch_ms,
    reactions::TouchEvent,
    render::Canvas,
    ui::{Key, MenuAction, MenuContext, Surface, UiAction, UiPlatform},
    Error, Options,
};
use std::{
    ffi::CString,
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
};

#[path = "linux_bus.rs"]
mod bus;
pub use bus::a11y as a11y_model;
#[path = "linux_keyboard.rs"]
mod keyboard;
#[path = "linux_text.rs"]
pub mod text;
#[path = "linux_wayland.rs"]
mod wayland;
#[path = "linux_x11.rs"]
mod x11;

#[derive(Debug)]
pub(crate) enum Event {
    Down { x: i32, y: i32, alternate: bool },
    Up,
    Move { x: i32, y: i32 },
    Context,
    Enter,
    Return,
    Expose,
    Closed,
    Activity,
    Escape,
    Tab { reverse: bool },
    KeyEnter,
    Backspace,
    Text(String),
    PickedClass(crate::linux_model::WmClass),
    Away(bool),
    Sleep(bool),
    Unlocked,
    Accessibility(accesskit::ActionRequest),
    KeyInput(Key),
    ImeField(String, usize),
    ImePreedit(String, usize),
    Notification(String),
    MenuAction(MenuAction),
    Appearance(bool, bool),
    Leave,
    Geometry([f64; 2]),
    GeometryBegin([f64; 2]),
    GeometryEnd,
}
pub(super) trait Display {
    fn fd(&self) -> i32;
    fn screen_origin(&self) -> (i32, i32) {
        (0, 0)
    }
    fn screen_origin_known(&self) -> bool {
        true
    }
    fn ui_viewport(&self) -> Option<crate::ui::Rect> {
        None
    }
    fn set_focus(&mut self, _focus: bool) {}
    /// The portal's `contrast` request, for the frame drawn round a window being picked.
    fn set_contrast(&mut self, _on: bool) {}
    fn start_pick(&mut self, _help: &str, _lang: &str) -> bool {
        false
    }
    fn stop_follow(&mut self) {}
    fn restore_follow(&mut self, _instance: &str, _class: &str) {}
    fn following(&self) -> bool {
        false
    }
    fn back_available(&self) -> bool {
        self.following()
    }
    fn back_window(&mut self) {}
    fn away(&self) -> bool {
        false
    }
    fn pointer_line(&mut self, _visible: bool) {}
    fn panel_target(
        &self,
    ) -> Option<(
        crate::motion::ScreenRect,
        crate::motion::ScreenRect,
        crate::motion::PlaceMode,
    )> {
        None
    }
    fn place_panel(&mut self, _frame: crate::motion::ScreenRect) {}
    fn field_input(
        &mut self,
        _enabled: bool,
        _text: &str,
        _cursor: usize,
        _caret: crate::ui::Rect,
    ) {
    }
    fn placement(&self) -> Option<Placement> {
        None
    }
    fn host_rect(&self) -> Option<crate::linux_model::Area> {
        None
    }
    fn host_occlusion(&mut self, _host: Option<crate::linux_model::Area>) {}
    fn live_follow_gesture(&self) -> bool {
        false
    }
    fn shed_context(&self) -> Option<(bool, f64, bool)> {
        None
    }
    fn motion_anchor(&mut self, _anchor: [f64; 2]) {}
    fn finish_drag(&mut self) {}
    fn events(&mut self) -> Result<Vec<Event>, Error>;
    fn present(&mut self, canvas: &Canvas) -> Result<(), Error>;
    fn drag(&mut self, dx: i32, dy: i32) -> Result<(), Error>;
    fn scale(&self) -> f64 {
        1.0
    }
    fn menu(&mut self, _bounds: Option<(i32, i32, u32, u32)>) {}
    fn restore_position(&mut self, _fractions: (f64, f64)) {}
    fn manual_position(&self) -> Option<(f64, f64)> {
        None
    }
    fn prepare_canvas(&mut self, _canvas: &Canvas) -> Result<(), Error> {
        Ok(())
    }
    fn viewport(&self, canvas: &Canvas) -> (i32, i32, u32, u32) {
        (0, 0, canvas.width, canvas.height)
    }
    fn home(&mut self) {}
    fn window_anchor(&self) -> Option<(String, f64, f64)> {
        None
    }
    fn restore_window_anchor(&mut self, _anchor: (String, f64, f64)) {}
}
#[derive(Clone, Copy, Debug)]
pub(super) struct Placement {
    anchor: [f64; 2],
    ledge: bool,
    room: f64,
    horizontal: bool,
    push: f64,
    hidden: f64,
}

struct Watch {
    fd: i32,
    folders: Vec<PathBuf>,
    watched: Vec<(i32, PathBuf)>,
}
impl Watch {
    fn new(options: &Options) -> Result<Self, Error> {
        let fd = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let mut folders = vec![options.folder.clone()];
        if let Some(folder) = &options.presence_folder {
            folders.push(folder.clone());
        }
        let mut result = Self {
            fd,
            folders,
            watched: Vec::new(),
        };
        result.rearm()?;
        Ok(result)
    }
    fn rearm(&mut self) -> Result<(), Error> {
        for target in &self.folders {
            // If the feed directory has never existed, watch its closest existing ancestor;
            // each creation advances the watch down the path without a retry timer.
            let Some(parent) = target.ancestors().find(|p| p.is_dir()) else {
                continue;
            };
            if self.watched.iter().any(|(_, p)| p == parent) {
                continue;
            }
            let name = CString::new(parent.as_os_str().as_bytes())?;
            let mask = libc::IN_CLOSE_WRITE
                | libc::IN_MOVED_TO
                | libc::IN_CREATE
                | libc::IN_DELETE
                | libc::IN_DELETE_SELF
                | libc::IN_MOVE_SELF
                | libc::IN_ATTRIB;
            let wd = unsafe { libc::inotify_add_watch(self.fd, name.as_ptr(), mask) };
            if wd < 0 {
                return Err(std::io::Error::last_os_error().into());
            }
            self.watched.push((wd, parent.to_owned()));
        }
        // Stop watching ancestors once the requested directory is available.
        let needed: Vec<PathBuf> = self
            .folders
            .iter()
            .filter_map(|p| p.ancestors().find(|p| p.is_dir()).map(Path::to_owned))
            .collect();
        self.watched.retain(|(wd, p)| {
            if needed.contains(p) {
                true
            } else {
                unsafe {
                    libc::inotify_rm_watch(self.fd, *wd);
                }
                false
            }
        });
        Ok(())
    }
    fn drain(&mut self) -> Result<bool, Error> {
        let mut bytes = [0u8; 8192];
        let mut changed = false;
        loop {
            let count = unsafe { libc::read(self.fd, bytes.as_mut_ptr().cast(), bytes.len()) };
            if count > 0 {
                changed = true;
                let mut at = 0usize;
                while at + std::mem::size_of::<libc::inotify_event>() <= count as usize {
                    let ev = unsafe {
                        std::ptr::read_unaligned(
                            bytes.as_ptr().add(at).cast::<libc::inotify_event>(),
                        )
                    };
                    if ev.mask & libc::IN_IGNORED != 0 {
                        self.watched.retain(|(wd, _)| *wd != ev.wd);
                    }
                    at += std::mem::size_of::<libc::inotify_event>() + ev.len as usize;
                }
            } else if count == 0 {
                break;
            } else {
                let error = std::io::Error::last_os_error();
                if error.kind() == std::io::ErrorKind::WouldBlock {
                    break;
                }
                if error.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error.into());
            }
        }
        if changed {
            self.rearm()?;
        }
        Ok(changed)
    }
}
impl Drop for Watch {
    fn drop(&mut self) {
        unsafe {
            libc::close(self.fd);
        }
    }
}

struct Gesture {
    origin: (i32, i32),
    last: (i32, i32),
    at: u64,
    alternate: bool,
    drag: bool,
    held: bool,
}

/// The window class (and Wayland app id) of Claude's Linux desktop app, measured from its 2.42304.0 beta package.
const CLAUDE_DESKTOP_CLASS: &str = "com.anthropic.Claude";

pub fn run(mut engine: Engine, options: Options) -> Result<(), Error> {
    let platform = if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        UiPlatform::Wayland
    } else {
        UiPlatform::X11
    };
    // Claude's Linux desktop app (beta, release/1.0/COMPAT.md): on X11 she stands by its window until the person
    // picks another or stops following. Wayland lets no application follow another's window.
    let follow = options.follow_class.clone().or_else(|| {
        (platform == UiPlatform::X11 && engine.follow_unchosen()).then(|| CLAUDE_DESKTOP_CLASS.to_owned())
    });
    let mut display: Box<dyn Display> = if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        if options.follow_class.is_some() {
            eprintln!("Wayland does not allow following another application's window; keeping the companion at a corner or manual position.");
        }
        Box::new(wayland::Native::new()?)
    } else {
        Box::new(x11::Native::new(follow.as_deref())?)
    };
    if let Some((instance, class)) = engine.follow_wm_class() {
        display.restore_follow(&instance, &class);
    }
    if let Some(anchor) = engine.window_anchor() {
        display.restore_window_anchor(anchor);
    }
    if let Some(position) = engine.manual_position() {
        display.restore_position(position);
    }
    let mut watcher = Watch::new(&options)?;
    let mut desktop = bus::Bus::new(&options.assets, engine.record());
    let mut native_away = false;
    let mut notices = crate::linux_model::NoticeGate::default();
    // Resolve native shaping before showing a surface: missing libraries produce a clear error.
    let text = text::Text::new()?;
    engine.ui.context = MenuContext {
        platform,
        back_available: display.back_available(),
        following: display.following(),
        lines_hidden: engine.lines_hidden(),
        size: engine.size(),
        back_app: "Claude".into(), new_chat: crate::new_chat::detect_cached(), login: Some(engine.login()) };
    engine.set_ui_viewport(display.ui_viewport());
    let mut canvas = engine.render_companion(epoch_ms(), display.scale());
    display.prepare_canvas(&canvas)?;
    if let Some((on_ledge, room, bottom_visible)) = display.shed_context() {
        engine.set_native_shed_context(on_ledge, room, bottom_visible);
        canvas = engine.render_companion(epoch_ms(), display.scale());
    }
    let mut gesture: Option<Gesture> = None;
    let mut paint = true;
    let mut missing_line = String::new();
    let mut panel: Option<Box<dyn Display>> = None;
    let mut panel_side = None;
    let mut held_placement: Option<Placement> = None;
    let mut held_host = None;
    let mut departure_host = None;
    let mut relocating = false;

    loop {
        let now = epoch_ms();
        let feed_event = watcher.drain()?;
        if feed_event {
            engine.reload(now)?;
            paint = true;
        }
        let mut native_events: Vec<_> = display.events()?.into_iter().map(|e| (false, e)).collect();
        if let Some(panel) = &mut panel {
            native_events.extend(panel.events()?.into_iter().map(|e| (true, e)));
        }
        let owned_event = feed_event || !native_events.is_empty();
        desktop.menu(
            engine.record(),
            &MenuContext {
                platform,
                back_available: display.back_available(),
                following: display.following(),
                lines_hidden: engine.lines_hidden(),
                size: engine.size(),
                back_app: "Claude".into(), new_chat: crate::new_chat::detect_cached(), login: Some(engine.login()) },
        );
        native_events.extend(desktop.events(owned_event).into_iter().map(|e| (false, e)));
        for (from_panel, event) in native_events {
            match event {
                Event::Closed if from_panel => {
                    engine.ui.close();
                    paint = true;
                }
                Event::Closed => return Ok(()),
                Event::Expose => paint = true,
                Event::Geometry(point) => {
                    engine.geometry_event(point, now);
                    paint = true;
                }
                Event::GeometryBegin(point) => {
                    engine.geometry_begin(point, now);
                    engine.cancel_relocation();
                    relocating = false;
                    paint = true;
                }
                Event::GeometryEnd => {
                    engine.geometry_end(now);
                    paint = true;
                }
                Event::Leave => {
                    engine.pointer_over(false, false, now);
                    engine.ui.hovered = None;
                    engine.ui.pointer(false, now);
                    engine.pointer_near(false, now);
                    paint = true;
                }
                Event::Enter => {
                    engine.ui.pointer(true, now);
                    paint = true;
                }
                Event::Activity => {
                    engine.open_activity(now)?;
                    engine.ui.new_chat = crate::new_chat::detect();
                    paint = true;
                }
                Event::Escape | Event::Tab { .. } | Event::KeyEnter | Event::Backspace => {
                    let key = match event {
                        Event::Escape => Key::Escape,
                        Event::Tab { reverse } => Key::Tab { shift: reverse },
                        Event::KeyEnter => Key::Enter,
                        _ => Key::Backspace,
                    };
                    if let Some(action) = engine.ui.key(key, now) {
                        if apply_ui(&mut engine, &mut *display, platform, action, now)? {
                            return Ok(());
                        }
                    }
                    paint = true;
                }
                Event::Text(value) => {
                    engine.ui.text(&value);
                    paint = true;
                }
                Event::PickedClass(class) => {
                    engine.set_follow_wm_class(class.instance, class.class)?;
                    paint = true;
                }
                Event::Away(value) => {
                    native_away = value;
                    paint = true;
                }
                // The lid: asleep when the system sleeps, awake once he is back (the unlock, or two seconds after).
                Event::Sleep(true) => {
                    engine.system_sleep(now);
                    paint = true;
                }
                Event::Sleep(false) => {
                    engine.system_wake(now, desktop.locked());
                    paint = true;
                }
                Event::Unlocked => {
                    engine.screen_unlocked(now);
                    paint = true;
                }
                Event::Accessibility(request) => {
                    if let Some(action) = crate::accessibility::action(&mut engine.ui, request, now)
                    {
                        if apply_ui(&mut engine, &mut *display, platform, action, now)? {
                            return Ok(());
                        }
                    }
                    paint = true;
                }
                Event::KeyInput(key) => {
                    if let Some(action) = engine.ui.key(key, now) {
                        if apply_ui(&mut engine, &mut *display, platform, action, now)? {
                            return Ok(());
                        }
                    }
                    paint = true;
                }
                Event::ImeField(field, cursor) => {
                    if engine.ui.surface() == Surface::Activity
                        && engine.ui.focus == Some(crate::ui::Control::Field)
                        && engine.ui.enabled(&crate::ui::Control::Field)
                    {
                        engine.ui.field = field;
                        engine.ui.cursor = cursor;
                        paint = true;
                    }
                }
                Event::ImePreedit(text, cursor) => {
                    engine.ui.preedit = text;
                    engine.ui.preedit_cursor = cursor;
                    paint = true;
                }
                Event::Return => {
                    engine.wave(now);
                    paint = true;
                }
                // Her DM's notification opens the thread; a long task's, the session's window.
                Event::Notification(session) if session == bus::DM_NOTICE => {
                    engine.open_dm(now)?;
                    paint = true;
                }
                Event::Notification(session) => {
                    engine.open_activity(now)?;
                    let _ = engine.ui.activate(crate::ui::Control::Row(session), now);
                    if display.following() {
                        display.back_window();
                    }
                    paint = true;
                }
                Event::Context => {
                    let context = MenuContext {
                        platform,
                        back_available: display.back_available(),
                        following: display.following(),
                        lines_hidden: engine.lines_hidden(),
                        size: engine.size(),
                        back_app: "Claude".into(), new_chat: crate::new_chat::detect_cached(), login: Some(engine.login()) };
                    engine.ui.open_menu(context, now);
                    paint = true;
                }
                Event::MenuAction(action) => {
                    if apply_ui(
                        &mut engine,
                        display.as_mut(),
                        platform,
                        UiAction::Menu(action),
                        now,
                    )? {
                        return Ok(());
                    }
                    paint = true;
                }
                Event::Appearance(dark, contrast) => {
                    engine.ui.dark = dark;
                    engine.set_contrast(contrast, None, false, now);
                    display.set_contrast(contrast);
                    paint = true;
                }
                Event::Down { x, y, .. }
                    if from_panel && engine.ui.surface() != Surface::Companion =>
                {
                    let scale = panel.as_ref().map_or(display.scale(), |p| p.scale());
                    if let Some(action) = engine.ui.click(x as f64 / scale, y as f64 / scale, now) {
                        if apply_ui(&mut engine, &mut *display, platform, action, now)? {
                            return Ok(());
                        }
                    }
                    paint = true;
                }
                Event::Down { x, y, alternate } if canvas.hit_test(x, y) => {
                    if let Some(action) = (engine.ui.surface() == Surface::Companion)
                        .then(|| {
                            engine.ui.click(
                                x as f64 / display.scale(),
                                y as f64 / display.scale(),
                                now,
                            )
                        })
                        .flatten()
                    {
                        if apply_ui(&mut engine, &mut *display, platform, action, now)? {
                            return Ok(());
                        }
                        paint = true;
                        continue;
                    }
                    engine.touch(TouchEvent::Press, now);
                    gesture = Some(Gesture {
                        origin: (x, y),
                        last: (x, y),
                        at: now,
                        alternate,
                        drag: false,
                        held: false,
                    });
                    paint = true;
                }
                Event::Down { .. } => {}
                Event::Move { x, y } => {
                    if from_panel && engine.ui.surface() != Surface::Companion {
                        let scale = panel.as_ref().map_or(display.scale(), |p| p.scale());
                        let panel_pointer = (x as f64 / scale, y as f64 / scale);
                        let hovered = engine
                            .ui
                            .elements()
                            .into_iter()
                            .find(|e| {
                                e.enabled && e.bounds.contains(panel_pointer.0, panel_pointer.1)
                            })
                            .map(|e| e.control);
                        if engine.ui.hovered != hovered {
                            engine.ui.hovered = hovered;
                            paint = true;
                        }
                        continue;
                    }
                    engine.ui.pointer(canvas.hit_test(x, y), now);
                    let (sx, sy, w, h) = canvas.sprite_bounds;
                    let dx = (sx - x).max(x - sx - w as i32).max(0) as f64 / display.scale();
                    let dy = (sy - y).max(y - sy - h as i32).max(0) as f64 / display.scale();
                    engine.pointer_distance(dx.hypot(dy), false, now);
                    engine.pointer_over(
                        sx <= x && x < sx + w as i32 && sy <= y && y < sy + h as i32,
                        x > sx + w as i32 / 2,
                        now,
                    );
                    if engine.ui.surface() == Surface::Companion {
                        let hovered = engine
                            .ui
                            .elements()
                            .into_iter()
                            .find(|e| {
                                e.bounds.contains(
                                    x as f64 / display.scale(),
                                    y as f64 / display.scale(),
                                )
                            })
                            .and_then(|e| match e.control {
                                crate::ui::Control::Hover(i) => Some(i),
                                _ => None,
                            });
                        if hovered != engine.ui.hover_index {
                            engine.ui.hover_index = hovered;
                            paint = true;
                        }
                    }
                    if let Some(g) = &mut gesture {
                        if !g.drag
                            && ((x - g.origin.0).pow(2) + (y - g.origin.1).pow(2))
                                > (3.0 * display.scale()).powi(2) as i32
                        {
                            g.drag = true;
                            engine.touch(TouchEvent::DragStart, now);
                            if let Some(p) = display.placement() {
                                engine.geometry_begin([p.anchor[0], -p.anchor[1]], now);
                            }
                        }
                        if g.drag {
                            display.drag(x - g.last.0, y - g.last.1)?;
                            if let Some(p) = display.placement() {
                                engine.geometry_event([p.anchor[0], -p.anchor[1]], now);
                            }
                            paint = true;
                        }
                        g.last = (x, y);
                    }
                }
                Event::Up => {
                    engine.ui.pressed.take();
                    if let Some(g) = gesture.take() {
                        if g.drag {
                            engine.touch(TouchEvent::Drop, now);
                            engine.geometry_end(now);
                            display.finish_drag();
                            if let Some((corner, dx, dy)) = display.window_anchor() {
                                engine.set_window_anchor(&corner, dx, dy)?;
                            } else if let Some((x, y)) = display.manual_position() {
                                engine.set_manual_position(x, y)?;
                            }
                        } else if !g.held {
                            engine.touch(
                                TouchEvent::Click {
                                    alternate: g.alternate,
                                },
                                now,
                            );
                        }
                        paint = true;
                    }
                }
            }
        }
        if let Some(g) = &mut gesture {
            if !g.drag && !g.held && now >= g.at.saturating_add(550) {
                g.held = true;
                engine.touch(TouchEvent::LongPress, now);
                paint = true;
            }
        }
        for action in engine.take_actions() {
            match action {
                Action::Login(on) => {
                    set_login(on)?;
                    engine.record_login_success(on)?;
                }
                // X11 and Wayland cannot keep a window out of screenshots; the Linux pet offers no switch.
                Action::Capture(_) => {}
                Action::Follow => {
                    display.start_pick(&engine.word("pick.help"), &engine.record().lang);
                    paint = true;
                }
                Action::Settings => {
                    let context = MenuContext {
                        platform,
                        back_available: display.back_available(),
                        following: display.following(),
                        lines_hidden: engine.lines_hidden(),
                        size: engine.size(),
                        back_app: "Claude".into(), new_chat: crate::new_chat::detect_cached(), login: Some(engine.login()) };
                    engine.ui.open_menu(context, now);
                    paint = true;
                }
                Action::Summon => {
                    engine.wave(now);
                    paint = true;
                }
                Action::Quit => return Ok(()),
            }
        }
        if paint
            || engine
                .next_deadline_ms(now)
                .is_some_and(|deadline| deadline <= now)
        {
            // Compose the hover row once, after native bubble measurement clears its lane.
            if let Some((on_ledge, room, bottom_visible)) = display.shed_context() {
                engine.set_native_shed_context(on_ledge, room, bottom_visible);
            } else {
                engine.clear_native_shed_context();
            }
            engine.ui.context = MenuContext {
                platform,
                back_available: display.back_available(),
                following: display.following(),
                lines_hidden: engine.lines_hidden(),
                size: engine.size(),
                back_app: "Claude".into(), new_chat: crate::new_chat::detect_cached(), login: Some(engine.login()) };
            // Publish checks/enablement from the action just handled before sleeping.
            desktop.menu(engine.record(), &engine.ui.context);
            engine.ui.tick(now);
            engine.set_ui_viewport(display.ui_viewport());
            canvas = engine.render_companion_without_hover(now, display.scale());
            display.prepare_canvas(&canvas)?;
            if let Some(next) = display.placement() {
                if let Some(old) = held_placement {
                    let moved =
                        (old.anchor[0] - next.anchor[0]).hypot(old.anchor[1] - next.anchor[1]);
                    if moved > 0. || old.ledge != next.ledge {
                        if gesture.as_ref().is_some_and(|g| g.drag) || display.live_follow_gesture()
                        {
                            engine.cancel_relocation();
                            relocating = false;
                        } else if relocating && engine.placement_moving(now) {
                            if engine.relocation_ducking(now) {
                                engine.retarget_relocation(next.anchor, next.ledge, now);
                            } else {
                                engine.track_pop_anchor(next.anchor, now);
                            }
                        } else if moved > 24. || old.ledge != next.ledge {
                            departure_host = old.ledge.then_some(held_host).flatten();
                            engine.relocate(
                                old.anchor,
                                next.anchor,
                                old.ledge,
                                next.ledge,
                                next.hidden,
                                now,
                            );
                            relocating = true;
                        }
                    }
                    if old.room != next.room
                        || old.horizontal != next.horizontal
                        || old.push != next.push
                    {
                        engine.squeeze_contact(next.room, next.horizontal, next.push, now);
                    }
                } else {
                    engine.squeeze_contact(next.room, next.horizontal, next.push, now);
                }
                held_placement = Some(next);
                held_host = display.host_rect();
                if relocating {
                    display.motion_anchor(engine.placement_anchor(now));
                    relocating = engine.placement_moving(now);
                }
                let host = if gesture.as_ref().is_some_and(|g| g.drag) {
                    None
                } else if relocating && engine.relocation_ducking(now) {
                    departure_host
                } else if next.ledge {
                    held_host
                } else {
                    None
                };
                display.host_occlusion(host);
            }
            if let Some(mut run) = canvas.bubble.clone().filter(|_| !canvas.bubble_is_task) {
                let (vx, vy, vw, vh) = display.viewport(&canvas);
                if vw > 0 && vh > 0 {
                    run.width = run.width.min((vw as f64 - 16. * display.scale()).max(1.));
                    let measured = text.measure(
                        &run.text,
                        &run.lang,
                        run.font_size,
                        run.width,
                        (canvas.sprite_bounds.1 as f64 - vy as f64 - 24. * display.scale())
                            .clamp(run.font_size, 160. * display.scale()),
                    )?;
                    run.height = measured.1;
                    run.y = (canvas.sprite_bounds.1 as f64 - run.height - 20. * display.scale())
                        .max(10. * display.scale());
                    run.x = run.x.clamp(
                        vx as f64 + 8. * display.scale(),
                        (vx as f64 + vw as f64 - run.width - 8. * display.scale())
                            .max(vx as f64 + 8. * display.scale()),
                    );
                    run.y = run.y.clamp(
                        vy as f64 + 10. * display.scale(),
                        (vy as f64 + vh as f64 - run.height - 4. * display.scale())
                            .max(vy as f64 + 10. * display.scale()),
                    );
                    // Bubble paper is disjoint from the sprite, so clear only its lane.
                    let top =
                        (canvas.sprite_bounds.1 - (16. * display.scale()) as i32).max(0) as usize;
                    let end = (top * canvas.width as usize * 4).min(canvas.pixels.len());
                    canvas.pixels[..end].fill(0);
                    canvas.paper(run, display.scale());
                    engine.paint_pill_ribbon(&mut canvas, display.scale());
                }
            }
            let ink = canvas.bubble_ink();
            if let Some(run) = &canvas.bubble {
                let missing = text.paint_styled(
                    &mut canvas.pixels,
                    canvas.width,
                    canvas.height,
                    &run.text,
                    &run.lang,
                    run.x,
                    run.y,
                    run.font_size,
                    run.width,
                    run.height,
                    false,
                    ink,
                    canvas.bubble_prefix,
                )?;
                if missing > 0 && missing_line != run.text {
                    let language = if crate::languages::is_supported(&run.lang) { crate::languages::native_name(&run.lang) } else { &run.lang };
                    eprintln!("Linux system fonts are missing {missing} glyphs for language {}; install a font for that script to display the complete line.", language);
                    missing_line = run.text.clone();
                }
            }
            if engine.ui.surface() == Surface::Companion {
                if let Some(mut old) = panel.take() {
                    old.set_focus(false);
                }
                panel_side = None;
                if !engine.is_hidden(now) {
                    engine.ui.paint_hover(&mut canvas, display.scale());
                }
            }
            display.menu(None);
            display.set_focus(false);
            display.pointer_line(canvas.bubble.is_some());
            for (index, run) in canvas.texts.clone().iter().enumerate() {
                let clip = canvas.save_text_clip(index);
                let (bold, color) = canvas
                    .text_styles
                    .get(index)
                    .copied()
                    .unwrap_or((false, [35, 27, 25, 255]));
                text.paint_weight_with_line_height(
                    &mut canvas.pixels,
                    canvas.width,
                    canvas.height,
                    &run.text,
                    &run.lang,
                    run.x,
                    run.y,
                    run.font_size,
                    run.width,
                    run.height,
                    canvas
                        .text_weights
                        .get(index)
                        .copied()
                        .unwrap_or(if bold { 600 } else { 400 }),
                    color,
                    canvas.text_prefixes.get(index).copied().unwrap_or(0),
                    canvas.text_sans.get(index).copied().unwrap_or(false),
                    canvas.text_middle.get(index).copied().unwrap_or(false),
                    run.line_height,
                )?;
                canvas.restore_text_clip(clip);
            }
            let tray = crate::ui::tray_state(engine.sessions(), now as f64);
            desktop.update(
                &options.assets,
                match tray.state {
                    crate::ui::TrayHead::Awake => "awake",
                    crate::ui::TrayHead::Asleep => "asleep",
                    crate::ui::TrayHead::Unseen => "unseen",
                    crate::ui::TrayHead::AsleepUnseen => "asleep-unseen",
                },
                &tray.tooltip,
            );
            for record in engine.sessions().live(now as f64) {
                let candidate = crate::linux_model::Candidate {
                    session: record.session.clone(),
                    done: record.done as u64,
                    busy_since: record.busy_since,
                    enabled: record.notices && record.long_task == "notify",
                    quiet: record.rest
                        && !record
                            .helpers
                            .iter()
                            .any(|h| h.outcome == crate::decor::HelperOutcome::Working),
                    waiting: ["waiting", "question"].contains(&record.mood.as_str()),
                };
                // Gate baselines old files and reads native away only at an eligible quiet completion.
                if notices.observe(&candidate, now, || {
                    native_away || desktop.away() || display.away()
                }) {
                    let seconds = (record.done as u64).saturating_sub(record.busy_since) / 1000;
                    let duration = if seconds < 60 {
                        format!("{seconds}s")
                    } else if seconds < 3600 {
                        format!("{}m {}s", seconds / 60, seconds % 60)
                    } else {
                        format!("{}h {}m", seconds / 3600, seconds / 60 % 60)
                    };
                    let body = record
                        .word("long.notify")
                        .replace("{folder}", &record.project)
                        .replace("{duration}", &duration);
                    desktop.notice(&record.session, &record.name, &body);
                }
            }
            // Her DM that reached the closed thread (the plugin's dm.ts): the system's notification, never while the
            // screen is locked (the owner's card of 10-17 late).
            if let Some(notice) = engine.take_dm_notice(now) {
                if !desktop.locked() {
                    desktop.notice(bus::DM_NOTICE, &notice.title, &notice.body);
                }
            }
            let tree = crate::accessibility::tree(&engine.ui, engine.record());
            desktop.accessible(
                crate::accessibility::native_nodes(&engine.ui, engine.record()),
                tree.focus.0,
                engine.ui.cursor,
                panel
                    .as_ref()
                    .map_or(display.screen_origin(), |p| p.screen_origin()),
                panel
                    .as_ref()
                    .map_or(display.screen_origin_known(), |p| p.screen_origin_known()),
                vec![],
                engine.ui.selection,
                engine.is_hidden(now) && engine.ui.surface() == Surface::Companion,
            );
            display.present(&canvas)?;
            if engine.ui.surface() != Surface::Companion {
                if panel.is_none() {
                    panel = Some(if platform == UiPlatform::Wayland {
                        Box::new(wayland::Native::new()?)
                    } else {
                        Box::new(x11::Native::new(None)?)
                    });
                }
                let panel = panel.as_mut().unwrap();
                let mut paper = engine.ui.render(display.scale());
                let placement = display.panel_target().and_then(|(sprite, visible, mode)| {
                    crate::motion::line_placement(
                        sprite,
                        visible,
                        [
                            paper.width as f64 / display.scale(),
                            paper.height as f64 / display.scale(),
                        ],
                        mode,
                        panel_side,
                        None,
                    )
                });
                if let Some(placed) = placement {
                    panel_side = Some(placed.side);
                    engine.set_speech_side(placed.side);
                    panel.place_panel(placed.frame);
                }
                for (index, run) in paper.texts.clone().iter().enumerate() {
                    let clip = paper.save_text_clip(index);
                    let (bold, color) = paper
                        .text_styles
                        .get(index)
                        .copied()
                        .unwrap_or((false, [35, 27, 25, 255]));
                    text.paint_weight_with_line_height(
                        &mut paper.pixels,
                        paper.width,
                        paper.height,
                        &run.text,
                        &run.lang,
                        run.x,
                        run.y,
                        run.font_size,
                        run.width,
                        run.height,
                        paper.text_weights.get(index).copied().unwrap_or(if bold {
                            600
                        } else {
                            400
                        }),
                        color,
                        paper.text_prefixes.get(index).copied().unwrap_or(0),
                        paper.text_sans.get(index).copied().unwrap_or(false),
                        paper.text_middle.get(index).copied().unwrap_or(false),
                        run.line_height,
                    )?;
                    paper.restore_text_clip(clip);
                }
                panel.menu(Some((0, 0, paper.width, paper.height)));
                // Ordinary GNOME windows have compositor-owned placement. Layer-shell/X11 use Place's exact side choice.
                if placement.is_some() || display.panel_target().is_none() {
                    panel.set_focus(true);
                    let mut geometry = vec![];
                    let field = engine
                        .ui
                        .elements()
                        .into_iter()
                        .find(|e| e.control == crate::ui::Control::Field);
                    if let Some(field) = field {
                        let displayed = engine.ui.field.clone();
                        let glyph_scale = display.scale();
                        let (rects, attrs) = text.character_rects(
                            &displayed,
                            &engine.ui.chosen.lang,
                            12.5 * glyph_scale,
                            (field.bounds.width - 12.).max(1.) * glyph_scale,
                            20. * glyph_scale,
                        )?;
                        let rects = rects
                            .into_iter()
                            .map(|(x, y, w, h)| {
                                (
                                    x / glyph_scale + field.bounds.x + 6.,
                                    y / glyph_scale + field.bounds.y + 5.,
                                    w / glyph_scale,
                                    h / glyph_scale,
                                )
                            })
                            .collect::<Vec<_>>();
                        geometry.push((
                            crate::accessibility::id(&crate::ui::Control::Field).0,
                            rects.clone(),
                            attrs.clone(),
                        ));
                        geometry.push((crate::accessibility::FIELD_TEXT.0, rects, attrs));
                        let mut before = engine
                            .ui
                            .field
                            .chars()
                            .take(engine.ui.cursor)
                            .collect::<String>();
                        before.extend(engine.ui.preedit.chars().take(engine.ui.preedit_cursor));
                        let (w, _) = text.measure(
                            &before,
                            &engine.ui.chosen.lang,
                            12.5 * glyph_scale,
                            (field.bounds.width - 12.).max(1.) * glyph_scale,
                            20. * glyph_scale,
                        )?;
                        let caret = crate::ui::Rect {
                            x: field.bounds.x + 6. + w / glyph_scale,
                            y: field.bounds.y + 5.,
                            width: 1.,
                            height: 20.,
                        };
                        if field.enabled && engine.ui.focus == Some(crate::ui::Control::Field) {
                            let scale = display.scale();
                            let left = (caret.x * scale).round().max(0.) as u32;
                            let top = (caret.y * scale).round().max(0.) as u32;
                            let right = ((caret.x + 1.) * scale)
                                .round()
                                .min((field.bounds.x + field.bounds.width - 6.) * scale)
                                .max(left as f64) as u32;
                            let bottom = ((caret.y + caret.height) * scale)
                                .round()
                                .min(paper.height as f64)
                                as u32;
                            for y in top..bottom {
                                for x in left..right.min(paper.width) {
                                    let at = ((y * paper.width + x) * 4) as usize;
                                    paper.pixels[at..at + 4].copy_from_slice(&[35, 27, 25, 255]);
                                }
                            }
                        }
                        panel.field_input(
                            field.enabled && engine.ui.focus == Some(crate::ui::Control::Field),
                            &engine.ui.field,
                            engine.ui.cursor,
                            caret,
                        );
                    } else {
                        panel.field_input(
                            false,
                            "",
                            0,
                            crate::ui::Rect {
                                x: 0.,
                                y: 0.,
                                width: 0.,
                                height: 0.,
                            },
                        );
                    }
                    panel.prepare_canvas(&paper)?;
                    panel.present(&paper)?;
                    desktop.accessible(
                        crate::accessibility::native_nodes(&engine.ui, engine.record()),
                        crate::accessibility::tree(&engine.ui, engine.record())
                            .focus
                            .0,
                        engine.ui.cursor,
                        panel.screen_origin(),
                        panel.screen_origin_known(),
                        geometry,
                        engine.ui.selection,
                        false,
                    );
                }
            }
            paint = false;
        }
        let now = epoch_ms();
        let deadline = engine
            .next_deadline_ms(now)
            .into_iter()
            .chain(
                gesture
                    .as_ref()
                    .filter(|g| !g.drag && !g.held)
                    .map(|g| g.at.saturating_add(550)),
            )
            .min();
        let timeout = deadline
            .map(|at| at.saturating_sub(now).min(i32::MAX as u64) as i32)
            .unwrap_or(-1);
        let presence_fds = engine.presence_descriptors();
        let mut fds = vec![
            libc::pollfd {
                fd: display.fd(),
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: watcher.fd,
                events: libc::POLLIN,
                revents: 0,
            },
        ];
        fds.extend(presence_fds.into_iter().map(|fd| libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        }));
        let presence_end = fds.len();
        if let Some(panel) = &panel {
            fds.push(libc::pollfd {
                fd: panel.fd(),
                events: libc::POLLIN,
                revents: 0,
            });
        }
        fds.extend(desktop.fds().into_iter().map(|fd| libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        }));
        let result = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, timeout) };
        if result < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            return Err(std::io::Error::last_os_error().into());
        }
        if fds
            .iter()
            .take(presence_end)
            .skip(2)
            .any(|fd| fd.revents != 0)
        {
            engine.presence_event(epoch_ms());
            paint = true;
        }
        if fds[0].revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
            return Err("Linux display connection closed".into());
        }
        if result == 0 {
            paint = true;
        }
    }
}

/// Called only after an explicit request in the companion feed, never merely on launch.
pub(crate) fn set_login(on: bool) -> Result<(), Error> {
    set_login_for(on, &std::env::current_exe()?)
}

/// The same login entry for a given program: setup.rs registers the installed pet, not the plugin's copy.
pub(crate) fn set_login_for(on: bool, exe: &std::path::Path) -> Result<(), Error> {
    let home = std::env::var_os("HOME").ok_or("HOME is required for XDG autostart")?;
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| PathBuf::from(home).join(".config"));
    let folder = config.join("autostart");
    let file = folder.join("coco-companion.desktop");
    if !on {
        crate::autostart_file::remove(&file)?;
        return Ok(());
    }
    let raw = exe
        .to_str()
        .ok_or("Autostart executable path is not UTF-8")?;
    let body = crate::os_metadata::checked_autostart_entry(raw)?;
    crate::autostart_file::write(&file, body.as_bytes())?;
    Ok(())
}

fn apply_ui(
    engine: &mut Engine,
    display: &mut dyn Display,
    platform: UiPlatform,
    action: UiAction,
    now: u64,
) -> Result<bool, Error> {
    match action {
        UiAction::Request(request) => engine.submit_ui_request(request, now)?,
        UiAction::SelectRow(_) | UiAction::Close => {}
        // Nothing to show if the system cannot open it: the button was there because the link had a handler.
        UiAction::NewChat(face, folder) => {
            let _ = crate::new_chat::open(face, folder.as_deref());
        }
        UiAction::Menu(action) => match action {
            MenuAction::Activity => {
                engine.open_activity(now)?;
                engine.ui.new_chat = crate::new_chat::detect();
            }
            MenuAction::Dm => {
                engine.open_dm(now)?;
                engine.ui.new_chat = crate::new_chat::detect();
            }
            MenuAction::Back => display.back_window(),
            MenuAction::ToggleLines => {
                engine.toggle_lines()?;
            }
            MenuAction::Hide => engine.hide(now),
            MenuAction::HideUntilCalled => engine.hide_until_called(),
            MenuAction::Pat => engine.touch(TouchEvent::Click { alternate: false }, now),
            MenuAction::Wave => engine.wave(now),
            MenuAction::Hug => engine.touch(TouchEvent::LongPress, now),
            MenuAction::Fluster => engine.touch(TouchEvent::Burst, now),
            MenuAction::ToggleLogin => engine.toggle_login(),
            MenuAction::NewChat(face) => {
                let _ = crate::new_chat::open(face, engine.record().cwd.as_deref());
            }
            MenuAction::Home => {
                engine.clear_manual_position()?;
                display.home();
            }
            MenuAction::Size(size) => engine.set_size(size),
            MenuAction::SizeMenu => {
                engine.ui.open_size_menu(now);
            }
            MenuAction::BeginFollow => {
                if platform == UiPlatform::X11 {
                    display.start_pick(&engine.word("pick.help"), &engine.record().lang);
                }
            }
            MenuAction::StopFollow => {
                display.stop_follow();
                engine.clear_follow_wm_class()?;
            }
            MenuAction::Quit => return Ok(true),
        },
    }
    Ok(false)
}
