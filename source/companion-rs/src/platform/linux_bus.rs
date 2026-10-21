//! Native, optional desktop integration. libdbus waits on the same poll(2) loop;
//! a missing session bus or StatusNotifierWatcher never changes the companion.
use super::{text::Library, Event};
use crate::{render::Image, Error};
use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    ptr,
};
#[path = "linux_a11y.rs"]
pub mod a11y;
type Conn = *mut c_void;
type Msg = *mut c_void;
#[repr(C)]
struct Iter([u64; 16]);
impl Default for Iter {
    fn default() -> Self {
        Self([0; 16])
    }
}
pub(crate) struct Api {
    _lib: Library,
    bus: unsafe extern "C" fn(c_int, *mut c_void) -> Conn,
    name: unsafe extern "C" fn(Conn, *const c_char, c_uint, *mut c_void) -> c_int,
    unix_fd: unsafe extern "C" fn(Conn, *mut c_int) -> c_int,
    exit: unsafe extern "C" fn(Conn, c_int),
    connected: unsafe extern "C" fn(Conn) -> c_int,
    unref_conn: unsafe extern "C" fn(Conn),
    close_connection: unsafe extern "C" fn(Conn),
    open_connection: unsafe extern "C" fn(*const c_char, *mut c_void) -> Conn,
    register: unsafe extern "C" fn(Conn, *mut c_void) -> c_int,
    unique: unsafe extern "C" fn(Conn) -> *const c_char,
    read: unsafe extern "C" fn(Conn, c_int) -> c_int,
    pop: unsafe extern "C" fn(Conn) -> Msg,
    send: unsafe extern "C" fn(Conn, Msg, *mut u32) -> c_int,
    flush: unsafe extern "C" fn(Conn),
    call: unsafe extern "C" fn(*const c_char, *const c_char, *const c_char, *const c_char) -> Msg,
    reply: unsafe extern "C" fn(Msg) -> Msg,
    error: unsafe extern "C" fn(Msg, *const c_char, *const c_char) -> Msg,
    signal: unsafe extern "C" fn(*const c_char, *const c_char, *const c_char) -> Msg,
    unref: unsafe extern "C" fn(Msg),
    member: unsafe extern "C" fn(Msg) -> *const c_char,
    interface: unsafe extern "C" fn(Msg) -> *const c_char,
    path: unsafe extern "C" fn(Msg) -> *const c_char,
    kind: unsafe extern "C" fn(Msg) -> c_int,
    reply_serial: unsafe extern "C" fn(Msg) -> u32,
    init: unsafe extern "C" fn(Msg, *mut Iter) -> c_int,
    append_init: unsafe extern "C" fn(Msg, *mut Iter),
    typ: unsafe extern "C" fn(*mut Iter) -> c_int,
    basic: unsafe extern "C" fn(*mut Iter, *mut c_void),
    next: unsafe extern "C" fn(*mut Iter) -> c_int,
    recurse: unsafe extern "C" fn(*mut Iter, *mut Iter),
    append: unsafe extern "C" fn(*mut Iter, c_int, *const c_void) -> c_int,
    open: unsafe extern "C" fn(*mut Iter, c_int, *const c_char, *mut Iter) -> c_int,
    close: unsafe extern "C" fn(*mut Iter, *mut Iter) -> c_int,
}
use std::ffi::c_uint;
/// The session a DM's notification answers to (the plugin's dm.ts): no session of Claude's is named so, and a click on
/// it opens the DM thread.
pub const DM_NOTICE: &str = "dm";
impl Api {
    fn new() -> Result<Self, Error> {
        let l = Library::open("libdbus-1.so.3")?;
        unsafe {
            Ok(Self {
                bus: l.symbol("dbus_bus_get_private")?,
                name: l.symbol("dbus_bus_request_name")?,
                unix_fd: l.symbol("dbus_connection_get_unix_fd")?,
                exit: l.symbol("dbus_connection_set_exit_on_disconnect")?,
                connected: l.symbol("dbus_connection_get_is_connected")?,
                unref_conn: l.symbol("dbus_connection_unref")?,
                close_connection: l.symbol("dbus_connection_close")?,
                open_connection: l.symbol("dbus_connection_open_private")?,
                register: l.symbol("dbus_bus_register")?,
                unique: l.symbol("dbus_bus_get_unique_name")?,
                read: l.symbol("dbus_connection_read_write")?,
                pop: l.symbol("dbus_connection_pop_message")?,
                send: l.symbol("dbus_connection_send")?,
                flush: l.symbol("dbus_connection_flush")?,
                call: l.symbol("dbus_message_new_method_call")?,
                reply: l.symbol("dbus_message_new_method_return")?,
                error: l.symbol("dbus_message_new_error")?,
                signal: l.symbol("dbus_message_new_signal")?,
                unref: l.symbol("dbus_message_unref")?,
                member: l.symbol("dbus_message_get_member")?,
                interface: l.symbol("dbus_message_get_interface")?,
                path: l.symbol("dbus_message_get_path")?,
                kind: l.symbol("dbus_message_get_type")?,
                reply_serial: l.symbol("dbus_message_get_reply_serial")?,
                init: l.symbol("dbus_message_iter_init")?,
                append_init: l.symbol("dbus_message_iter_init_append")?,
                typ: l.symbol("dbus_message_iter_get_arg_type")?,
                basic: l.symbol("dbus_message_iter_get_basic")?,
                next: l.symbol("dbus_message_iter_next")?,
                recurse: l.symbol("dbus_message_iter_recurse")?,
                append: l.symbol("dbus_message_iter_append_basic")?,
                open: l.symbol("dbus_message_iter_open_container")?,
                close: l.symbol("dbus_message_iter_close_container")?,
                _lib: l,
            })
        }
    }
    fn connection(&self, system: bool) -> Conn {
        unsafe {
            let c = (self.bus)(if system { 1 } else { 0 }, ptr::null_mut());
            if !c.is_null() {
                (self.exit)(c, 0);
            }
            c
        }
    }
    fn strings(&self, msg: Msg) -> Vec<String> {
        let mut i = Iter::default();
        unsafe {
            if (self.init)(msg, &mut i) == 0 {
                return vec![];
            }
            let mut out = vec![];
            loop {
                if (self.typ)(&mut i) == b's' as i32 || (self.typ)(&mut i) == b'o' as i32 {
                    let mut s: *const c_char = ptr::null();
                    (self.basic)(&mut i, (&mut s as *mut *const c_char).cast());
                    if !s.is_null() {
                        out.push(CStr::from_ptr(s).to_string_lossy().into_owned());
                    }
                }
                if (self.next)(&mut i) == 0 {
                    break;
                }
            }
            out
        }
    }
    fn strings_deep(&self, msg: Msg) -> Vec<String> {
        fn walk(api: &Api, i: &mut Iter, out: &mut Vec<String>) {
            unsafe {
                loop {
                    let kind = (api.typ)(i);
                    match kind {
                        115 | 111 => {
                            let mut p: *const c_char = ptr::null();
                            (api.basic)(i, (&mut p as *mut *const c_char).cast());
                            out.push(value(p));
                        }
                        97 | 114 | 118 | 101 => {
                            let mut child = Iter::default();
                            (api.recurse)(i, &mut child);
                            walk(api, &mut child, out);
                        }
                        _ => {}
                    }
                    if (api.next)(i) == 0 {
                        break;
                    }
                }
            }
        }
        let mut i = Iter::default();
        let mut out = vec![];
        unsafe {
            if (self.init)(msg, &mut i) != 0 {
                walk(self, &mut i, &mut out);
            }
        }
        out
    }
    fn integers(&self, msg: Msg) -> Vec<i32> {
        let mut i = Iter::default();
        let mut out = vec![];
        unsafe {
            if (self.init)(msg, &mut i) != 0 {
                loop {
                    if [105, 117].contains(&(self.typ)(&mut i)) {
                        let mut n = 0i32;
                        (self.basic)(&mut i, (&mut n as *mut i32).cast());
                        out.push(n);
                    }
                    if (self.next)(&mut i) == 0 {
                        break;
                    }
                }
            }
        }
        out
    }
    fn setting_value(&self, msg: Msg) -> Option<u32> {
        unsafe fn walk(api: &Api, i: &mut Iter, depth: usize) -> Option<u32> {
            if depth > 4 {
                return None;
            }
            loop {
                let typ = unsafe { (api.typ)(i) };
                if typ == b'u' as i32 {
                    let mut value = 0u32;
                    unsafe {
                        (api.basic)(i, (&mut value as *mut u32).cast());
                    }
                    return Some(value);
                }
                if typ == b'v' as i32 {
                    let mut child = Iter::default();
                    unsafe {
                        (api.recurse)(i, &mut child);
                    }
                    if let Some(value) = unsafe { walk(api, &mut child, depth + 1) } {
                        return Some(value);
                    }
                }
                if unsafe { (api.next)(i) } == 0 {
                    return None;
                }
            }
        }
        let mut i = Iter::default();
        unsafe {
            ((self.init)(msg, &mut i) != 0)
                .then(|| walk(self, &mut i, 0))
                .flatten()
        }
    }
    fn menu_ids(&self, msg: Msg) -> Vec<i32> {
        let mut i = Iter::default();
        let mut ids = vec![];
        unsafe {
            if (self.init)(msg, &mut i) == 0 || (self.typ)(&mut i) != b'a' as i32 {
                return ids;
            }
            let mut child = Iter::default();
            (self.recurse)(&mut i, &mut child);
            while (self.typ)(&mut child) == b'i' as i32 && ids.len() < 128 {
                let mut id = 0i32;
                (self.basic)(&mut child, (&mut id as *mut i32).cast());
                ids.push(id);
                if (self.next)(&mut child) == 0 {
                    break;
                }
            }
        }
        ids
    }
    fn menu_events(&self, msg: Msg) -> Vec<(i32, String)> {
        let mut i = Iter::default();
        let mut events = vec![];
        unsafe {
            if (self.init)(msg, &mut i) == 0 || (self.typ)(&mut i) != b'a' as i32 {
                return events;
            }
            let mut array = Iter::default();
            (self.recurse)(&mut i, &mut array);
            while (self.typ)(&mut array) == b'r' as i32 && events.len() < 128 {
                let mut entry = Iter::default();
                (self.recurse)(&mut array, &mut entry);
                if (self.typ)(&mut entry) == b'i' as i32 {
                    let mut id = 0i32;
                    (self.basic)(&mut entry, (&mut id as *mut i32).cast());
                    if (self.next)(&mut entry) != 0 && (self.typ)(&mut entry) == b's' as i32 {
                        let mut name: *const c_char = ptr::null();
                        (self.basic)(&mut entry, (&mut name as *mut *const c_char).cast());
                        events.push((id, value(name)));
                    }
                }
                if (self.next)(&mut array) == 0 {
                    break;
                }
            }
        }
        events
    }
    fn string(&self, i: &mut Iter, s: &str, kind: u8) {
        let s = CString::new(s.replace('\0', " ")).unwrap();
        let raw = s.as_ptr();
        unsafe {
            (self.append)(i, kind as i32, (&raw as *const *const c_char).cast());
        }
    }
    fn number<T>(&self, i: &mut Iter, n: T, kind: u8) {
        unsafe {
            (self.append)(i, kind as i32, (&n as *const T).cast());
        }
    }
    fn container(
        &self,
        i: &mut Iter,
        kind: u8,
        signature: Option<&str>,
        f: impl FnOnce(&mut Iter),
    ) {
        let mut child = Iter::default();
        let sig = signature.map(|s| CString::new(s).unwrap());
        unsafe {
            if (self.open)(
                i,
                kind as i32,
                sig.as_ref().map_or(ptr::null(), |s| s.as_ptr()),
                &mut child,
            ) == 0
            {
                return;
            }
        }
        f(&mut child);
        unsafe {
            (self.close)(i, &mut child);
        }
    }
    fn send(&self, c: Conn, msg: Msg) {
        if msg.is_null() {
            return;
        }
        if c.is_null() {
            unsafe {
                (self.unref)(msg);
            }
            return;
        }
        unsafe {
            (self.send)(c, msg, ptr::null_mut());
            (self.unref)(msg);
            (self.flush)(c);
        }
    }
    fn call(
        &self,
        c: Conn,
        dest: &str,
        path: &str,
        interface: &str,
        method: &str,
        f: impl FnOnce(&mut Iter),
    ) {
        let (d, p, i, m) = (
            CString::new(dest).unwrap(),
            CString::new(path).unwrap(),
            CString::new(interface).unwrap(),
            CString::new(method).unwrap(),
        );
        unsafe {
            let msg = (self.call)(d.as_ptr(), p.as_ptr(), i.as_ptr(), m.as_ptr());
            if msg.is_null() {
                return;
            }
            let mut it = Iter::default();
            (self.append_init)(msg, &mut it);
            f(&mut it);
            self.send(c, msg);
        }
    }
    fn call_tracked(
        &self,
        c: Conn,
        dest: &str,
        path: &str,
        interface: &str,
        method: &str,
        f: impl FnOnce(&mut Iter),
    ) -> u32 {
        if c.is_null() {
            return 0;
        }
        let (d, p, i, m) = (
            CString::new(dest).unwrap(),
            CString::new(path).unwrap(),
            CString::new(interface).unwrap(),
            CString::new(method).unwrap(),
        );
        unsafe {
            let msg = (self.call)(d.as_ptr(), p.as_ptr(), i.as_ptr(), m.as_ptr());
            if msg.is_null() {
                return 0;
            }
            let mut it = Iter::default();
            (self.append_init)(msg, &mut it);
            f(&mut it);
            let mut serial = 0;
            (self.send)(c, msg, &mut serial);
            (self.unref)(msg);
            (self.flush)(c);
            serial
        }
    }
}
fn value(p: *const c_char) -> String {
    if p.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
    }
}
#[derive(Default)]
pub(super) struct Bus {
    api: Option<Api>,
    session: Conn,
    system: Conn,
    icons: Vec<(i32, i32, Vec<u8>)>,
    tip: String,
    state: String,
    notice_icon: String,
    session_path: Option<String>,
    locked: bool,
    idle: bool,
    a11y: a11y::Bridge,
    notices: crate::linux_model::NoticeIds,
    registration: crate::linux_model::TrayRegistration,
    socket_watch: Option<SocketWatch>,
    system_watch: Option<SocketWatch>,
    menu: crate::linux_menu::MenuTree<crate::ui::MenuAction>,
    menu_lang: String,
    appearance: crate::linux_model::Appearance,
    appearance_reads: [u32; 2],
}
impl Bus {
    pub fn new(assets: &Path, record: &crate::feed::Record) -> Self {
        let Ok(api) = Api::new() else {
            return Self::default();
        };
        let session = api.connection(false);
        let system = api.connection(true);
        let appearance_reads = if !session.is_null() {
            Self::setup_session(&api, session)
        } else {
            [0; 2]
        };
        if !system.is_null() {
            Self::setup_system(&api, system);
        }
        let mut bus = Self::default();
        bus.api = Some(api);
        bus.session = session;
        bus.system = system;
        bus.appearance_reads = appearance_reads;
        bus.socket_watch = SocketWatch::new().ok();
        bus.system_watch =
            SocketWatch::for_socket(PathBuf::from("/run/dbus/system_bus_socket")).ok();
        if !session.is_null() {
            bus.registration.connected();
        }
        bus.update(assets, "awake", &crate::platform_words::initial_tray_tooltip(record));
        if let Some(api) = &bus.api {
            bus.a11y.request(api, session);
        }
        bus
    }
    fn setup_session(api: &Api, session: Conn) -> [u32; 2] {
        api.call(session,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","AddMatch",|i|api.string(i,"type='signal',sender='org.freedesktop.Notifications',interface='org.freedesktop.Notifications'",b's'));
        api.call(session,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","AddMatch",|i|api.string(i,"type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.kde.StatusNotifierWatcher'",b's'));
        api.call(session,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","AddMatch",|i|api.string(i,"type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.a11y.Bus'",b's'));
        api.call(session,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","AddMatch",|i|api.string(i,"type='signal',sender='org.freedesktop.portal.Desktop',interface='org.freedesktop.portal.Settings',member='SettingChanged'",b's'));
        api.call(session,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","AddMatch",|i|api.string(i,"type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.freedesktop.portal.Desktop'",b's'));
        unsafe {
            (api.name)(
                session,
                c"org.kde.StatusNotifierItem.Coco".as_ptr(),
                4,
                ptr::null_mut(),
            );
        }
        Self::register_tray(api, session);
        Self::read_appearance(api, session)
    }
    fn read_appearance(api: &Api, session: Conn) -> [u32; 2] {
        ["color-scheme", "contrast"].map(|key| {
            api.call_tracked(
                session,
                "org.freedesktop.portal.Desktop",
                "/org/freedesktop/portal/desktop",
                "org.freedesktop.portal.Settings",
                "Read",
                |i| {
                    api.string(i, "org.freedesktop.appearance", b's');
                    api.string(i, key, b's');
                },
            )
        })
    }
    fn register_tray(api: &Api, session: Conn) {
        api.call(
            session,
            "org.kde.StatusNotifierWatcher",
            "/StatusNotifierWatcher",
            "org.kde.StatusNotifierWatcher",
            "RegisterStatusNotifierItem",
            |i| api.string(i, "org.kde.StatusNotifierItem.Coco", b's'),
        );
    }
    fn setup_system(api: &Api, system: Conn) {
        Self::request_session(api, system);
        api.call(system,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","AddMatch",|i|api.string(i,"type='signal',sender='org.freedesktop.login1',path_namespace='/org/freedesktop/login1/session'",b's'));
        // The lid: logind says PrepareForSleep(true) before the system sleeps and (false) after it woke.
        api.call(system,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","AddMatch",|i|api.string(i,"type='signal',sender='org.freedesktop.login1',interface='org.freedesktop.login1.Manager',member='PrepareForSleep'",b's'));
        api.call(system,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","AddMatch",|i|api.string(i,"type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.freedesktop.login1'",b's'));
    }
    fn request_session(api: &Api, system: Conn) {
        api.call(
            system,
            "org.freedesktop.login1",
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
            "GetSessionByPID",
            |i| api.number(i, std::process::id(), b'u'),
        );
    }
    pub fn fds(&self) -> Vec<i32> {
        let Some(api) = &self.api else {
            return vec![];
        };
        let mut fds: Vec<_> = [self.session, self.system]
            .into_iter()
            .filter(|c| !c.is_null())
            .filter_map(|c| {
                let mut fd = -1;
                unsafe {
                    if (api.unix_fd)(c, &mut fd) != 0 {
                        Some(fd)
                    } else {
                        None
                    }
                }
            })
            .collect();
        fds.extend(self.a11y.fd(api));
        fds.extend(self.socket_watch.as_ref().map(|w| w.fd));
        fds.extend(self.system_watch.as_ref().map(|w| w.fd));
        fds
    }
    pub fn accessible(
        &mut self,
        nodes: Vec<crate::accessibility::NativeNode>,
        focus: u64,
        cursor: usize,
        origin: (i32, i32),
        origin_known: bool,
        geometry: Vec<(u64, Vec<(f64, f64, f64, f64)>, Vec<u32>)>,
        selection: Option<(usize, usize)>,
        hidden: bool,
    ) {
        if let Some(api) = &self.api {
            self.a11y.update(
                api,
                nodes,
                focus,
                cursor,
                origin,
                origin_known,
                geometry,
                selection,
                hidden,
            );
        }
    }
    pub fn away(&self) -> bool {
        self.locked || self.idle
    }
    pub fn locked(&self) -> bool {
        self.locked
    }
    pub fn menu(&mut self, record: &crate::feed::Record, context: &crate::ui::MenuContext) {
        use crate::{linux_menu::MenuNode, render::Size, ui::MenuAction};
        let mut root = MenuNode::root();
        for (index, row) in crate::ui::menu_rows(record, context)
            .into_iter()
            .enumerate()
        {
            if row.separator {
                root.children.push(MenuNode::separator(100 + index as i32));
                continue;
            }
            let reading = index == 0 && record.quota.is_some();
            let (id, action, enabled) = if reading {
                (1, Some(MenuAction::Activity), true)
            } else {
                let id = match row.action {
                    Some(MenuAction::Activity) => 10,
                    Some(MenuAction::Dm) => 15,
                    Some(MenuAction::Back) => 20,
                    Some(MenuAction::ToggleLines) => 30,
                    Some(MenuAction::BeginFollow) => 40,
                    Some(MenuAction::StopFollow) => 50,
                    Some(MenuAction::Hide) => 60,
                    Some(MenuAction::HideUntilCalled) => 65,
                    Some(MenuAction::NewChat(face)) => 16 + face as i32,
                    Some(MenuAction::Pat) => 21,
                    Some(MenuAction::Wave) => 22,
                    Some(MenuAction::Hug) => 23,
                    Some(MenuAction::Fluster) => 24,
                    Some(MenuAction::ToggleLogin) => 75,
                    Some(MenuAction::Home) => 70,
                    Some(MenuAction::SizeMenu) => 80,
                    Some(MenuAction::Quit) => 90,
                    _ => continue,
                };
                (id, row.action, row.enabled)
            };
            let mut node = MenuNode::item(id, &row.label, enabled, action);
            node.checked = row.checked;
            if id == 80 {
                for (offset, (size, key)) in Size::ALL
                    .into_iter()
                    .map(|size| (size, size.key()))
                    .enumerate()
                {
                    node.children.push(MenuNode::radio(
                        81 + offset as i32,
                        &record.word(key),
                        size == context.size,
                        MenuAction::Size(size),
                    ));
                }
            }
            root.children.push(node);
        }
        self.menu_lang = record.lang.clone();
        if self.menu.update(root) {
            if let Some(api) = &self.api {
                unsafe {
                    let signal = (api.signal)(
                        c"/Menu".as_ptr(),
                        c"com.canonical.dbusmenu".as_ptr(),
                        c"LayoutUpdated".as_ptr(),
                    );
                    if !signal.is_null() {
                        let mut i = Iter::default();
                        (api.append_init)(signal, &mut i);
                        api.number(&mut i, self.menu.revision, b'u');
                        api.number(&mut i, 0i32, b'i');
                        api.send(self.session, signal);
                    }
                }
            }
        }
    }
    pub fn update(&mut self, assets: &Path, state: &str, tip: &str) {
        if self.state == state && self.tip == tip {
            return;
        }
        self.state = state.into();
        self.tip = tip.into();
        self.icons.clear();
        let owned = crate::paths::fallback_assets();
        let assets = if assets.join("icons").is_dir() {
            assets
        } else {
            &owned
        };
        self.notice_icon = assets
            .join("icons/tray-32-awake.png")
            .to_string_lossy()
            .into_owned();
        for (size, linux_grid) in [
            (16, false),
            (22, false),
            (24, false),
            (32, true),
            (44, true),
            (48, true),
        ] {
            if let Ok(f) = Image::load(&assets.join("icons").join(if linux_grid {
                format!("tray-linux-{size}-{state}.png")
            } else {
                format!("tray-{size}-{state}.png")
            })) {
                let pixels = f
                    .pixels
                    .chunks_exact(4)
                    .flat_map(|c| [c[3], c[0], c[1], c[2]])
                    .collect();
                self.icons.push((f.width as i32, f.height as i32, pixels));
            }
        }
        if let Some(api) = &self.api {
            for name in ["NewIcon", "NewToolTip"] {
                let n = CString::new(name).unwrap();
                unsafe {
                    api.send(
                        self.session,
                        (api.signal)(
                            c"/StatusNotifierItem".as_ptr(),
                            c"org.kde.StatusNotifierItem".as_ptr(),
                            n.as_ptr(),
                        ),
                    );
                }
            }
        }
    }
    pub fn notice(&mut self, session: &str, summary: &str, body: &str) {
        let Some(api) = &self.api else {
            return;
        };
        let serial = api.call_tracked(
            self.session,
            "org.freedesktop.Notifications",
            "/org/freedesktop/Notifications",
            "org.freedesktop.Notifications",
            "Notify",
            |i| {
                api.string(i, "Coco Pet", b's');
                api.number(i, 0u32, b'u');
                api.string(i, &self.notice_icon, b's');
                api.string(i, summary, b's');
                api.string(i, body, b's');
                api.container(i, b'a', Some("s"), |a| {
                    api.string(a, "default", b's');
                    api.string(a, "", b's');
                });
                api.container(i, b'a', Some("{sv}"), |a| {
                    api.container(a, b'e', None, |e| {
                        api.string(e, "suppress-sound", b's');
                        api.container(e, b'v', Some("b"), |v| api.number(v, 1u32, b'b'));
                    })
                });
                api.number(i, -1i32, b'i');
            },
        );
        self.notices.request(serial, session);
    }
    fn property(&self, name: &str, i: &mut Iter) -> bool {
        let api = self.api.as_ref().unwrap();
        match name {
            "Category" | "Id" | "Title" | "Status" | "IconName" => {
                let s = match name {
                    "Category" => "ApplicationStatus",
                    "Id" => "coco-companion",
                    "Title" => "Coco Pet",
                    "Status" => "Active",
                    _ => "",
                };
                api.container(i, b'v', Some("s"), |v| api.string(v, s, b's'));
            }
            "WindowId" => api.container(i, b'v', Some("u"), |v| api.number(v, 0u32, b'u')),
            "ItemIsMenu" => api.container(i, b'v', Some("b"), |v| api.number(v, 0u32, b'b')),
            "Menu" => api.container(i, b'v', Some("o"), |v| api.string(v, "/Menu", b'o')),
            "IconPixmap" => api.container(i, b'v', Some("a(iiay)"), |v| self.pixmaps(v)),
            "ToolTip" => api.container(i, b'v', Some("(sa(iiay)ss)"), |v| {
                api.container(v, b'r', None, |t| {
                    api.string(t, "", b's');
                    self.pixmaps(t);
                    api.string(t, &self.tip, b's');
                    api.string(t, "", b's');
                })
            }),
            _ => return false,
        }
        true
    }
    fn pixmaps(&self, i: &mut Iter) {
        let api = self.api.as_ref().unwrap();
        api.container(i, b'a', Some("(iiay)"), |a| {
            for (w, h, pixels) in &self.icons {
                api.container(a, b'r', None, |s| {
                    api.number(s, *w, b'i');
                    api.number(s, *h, b'i');
                    api.container(s, b'a', Some("y"), |a| {
                        for p in pixels {
                            api.number(a, *p, b'y');
                        }
                    });
                });
            }
        });
    }
    fn menu_property(&self, api: &Api, name: &str, i: &mut Iter) -> bool {
        match name {
            "Version" => api.container(i, b'v', Some("u"), |v| api.number(v, 3u32, b'u')),
            "Status" => api.container(i, b'v', Some("s"), |v| api.string(v, "normal", b's')),
            "TextDirection" => api.container(i, b'v', Some("s"), |v| {
                api.string(
                    v,
                    if ["ar", "fa", "he", "ur"]
                        .contains(&self.menu_lang.split('-').next().unwrap_or("en"))
                    {
                        "rtl"
                    } else {
                        "ltr"
                    },
                    b's',
                )
            }),
            "IconThemePath" => api.container(i, b'v', Some("as"), |v| {
                api.container(v, b'a', Some("s"), |_| {})
            }),
            _ => return false,
        }
        true
    }
    fn menu_value(api: &Api, i: &mut Iter, value: &crate::linux_menu::MenuProperty) {
        use crate::linux_menu::MenuProperty;
        match value {
            MenuProperty::Text(s) => api.container(i, b'v', Some("s"), |v| api.string(v, s, b's')),
            MenuProperty::Bool(b) => {
                api.container(i, b'v', Some("b"), |v| api.number(v, u32::from(*b), b'b'))
            }
            MenuProperty::Int(n) => api.container(i, b'v', Some("i"), |v| api.number(v, *n, b'i')),
        }
    }
    fn menu_node_properties(
        api: &Api,
        node: &crate::linux_menu::MenuNode<crate::ui::MenuAction>,
        names: &[String],
        i: &mut Iter,
    ) {
        api.container(i, b'a', Some("{sv}"), |properties| {
            for (name, value) in node.properties(names) {
                api.container(properties, b'e', None, |entry| {
                    api.string(entry, name, b's');
                    Self::menu_value(api, entry, &value);
                });
            }
        });
    }
    fn menu_layout(
        &self,
        api: &Api,
        node: &crate::linux_menu::MenuNode<crate::ui::MenuAction>,
        names: &[String],
        i: &mut Iter,
    ) {
        api.container(i, b'r', None, |layout| {
            api.number(layout, node.id, b'i');
            // Depth limits truncate children, never the item's actual submenu property.
            Self::menu_node_properties(api, self.menu.node(node.id).unwrap_or(node), names, layout);
            api.container(layout, b'a', Some("v"), |children| {
                for child in &node.children {
                    api.container(children, b'v', Some("(ia{sv}av)"), |value| {
                        self.menu_layout(api, child, names, value)
                    });
                }
            });
        });
    }
    fn menu_message(
        &self,
        api: &Api,
        c: Conn,
        msg: Msg,
        interface: &str,
        method: &str,
        events: &mut Vec<Event>,
    ) {
        let strings = api.strings(msg);
        let ints = api.integers(msg);
        unsafe {
            let reply = (api.reply)(msg);
            if reply.is_null() {
                return;
            }
            let mut i = Iter::default();
            (api.append_init)(reply, &mut i);
            let mut handled = true;
            match (interface, method) {
                ("com.canonical.dbusmenu", "GetLayout") => {
                    if let Some(layout) = self.menu.layout(
                        ints.first().copied().unwrap_or(0),
                        ints.get(1).copied().unwrap_or(-1),
                    ) {
                        api.number(&mut i, self.menu.revision, b'u');
                        self.menu_layout(api, &layout, &api.strings_deep(msg), &mut i);
                    } else {
                        handled = false;
                    }
                }
                ("com.canonical.dbusmenu", "GetGroupProperties") => {
                    let names = api.strings_deep(msg);
                    api.container(&mut i, b'a', Some("(ia{sv})"), |groups| {
                        for id in api.menu_ids(msg) {
                            if let Some(node) = self.menu.node(id) {
                                api.container(groups, b'r', None, |group| {
                                    api.number(group, id, b'i');
                                    Self::menu_node_properties(api, node, &names, group);
                                });
                            }
                        }
                    });
                }
                ("com.canonical.dbusmenu", "GetProperty") => {
                    let value = self
                        .menu
                        .node(ints.first().copied().unwrap_or(-1))
                        .and_then(|node| {
                            strings.first().and_then(|name| {
                                node.properties(std::slice::from_ref(name))
                                    .into_iter()
                                    .next()
                            })
                        });
                    if let Some((_, value)) = value {
                        Self::menu_value(api, &mut i, &value);
                    } else {
                        handled = false;
                    }
                }
                ("com.canonical.dbusmenu", "Event") => {
                    if let Some(action) = self.menu.activate(
                        ints.first().copied().unwrap_or(-1),
                        strings.first().map_or("", String::as_str),
                    ) {
                        events.push(Event::MenuAction(action));
                    }
                }
                ("com.canonical.dbusmenu", "EventGroup") => {
                    let mut errors = vec![];
                    for (id, event) in api.menu_events(msg) {
                        if self.menu.node(id).is_none() {
                            errors.push(id);
                        } else if let Some(action) = self.menu.activate(id, &event) {
                            events.push(Event::MenuAction(action));
                        }
                    }
                    api.container(&mut i, b'a', Some("i"), |array| {
                        for id in errors {
                            api.number(array, id, b'i');
                        }
                    });
                }
                ("com.canonical.dbusmenu", "AboutToShow") => api.number(&mut i, 0u32, b'b'),
                ("com.canonical.dbusmenu", "AboutToShowGroup") => {
                    api.container(&mut i, b'a', Some("i"), |_| {});
                    api.container(&mut i, b'a', Some("i"), |array| {
                        for id in api.menu_ids(msg) {
                            if self.menu.node(id).is_none() {
                                api.number(array, id, b'i');
                            }
                        }
                    });
                }
                ("org.freedesktop.DBus.Properties", "Get") => {
                    handled = strings
                        .get(1)
                        .is_some_and(|name| self.menu_property(api, name, &mut i))
                }
                ("org.freedesktop.DBus.Properties", "GetAll") => {
                    api.container(&mut i, b'a', Some("{sv}"), |properties| {
                        for name in ["Version", "Status", "TextDirection", "IconThemePath"] {
                            api.container(properties, b'e', None, |entry| {
                                api.string(entry, name, b's');
                                self.menu_property(api, name, entry);
                            });
                        }
                    })
                }
                ("org.freedesktop.DBus.Introspectable", "Introspect") => {
                    api.string(&mut i, MENU_INTROSPECTION, b's')
                }
                ("org.freedesktop.DBus.Peer", "Ping") => {}
                _ => handled = false,
            }
            if handled {
                api.send(c, reply);
            } else {
                (api.unref)(reply);
                api.send(
                    c,
                    (api.error)(
                        msg,
                        c"org.freedesktop.DBus.Error.InvalidArgs".as_ptr(),
                        c"Unknown menu item, property, or method".as_ptr(),
                    ),
                );
            }
        }
    }
    pub fn events(&mut self, owned_event: bool) -> Vec<Event> {
        let mut events = vec![];
        let was_locked = self.locked;
        let Some(api) = &self.api else {
            return events;
        };
        let socket_event = self.socket_watch.as_mut().is_some_and(SocketWatch::drain);
        let system_event = self.system_watch.as_mut().is_some_and(SocketWatch::drain);
        // Abstract Unix sockets do not have a filesystem creation event. A real
        // companion input or feed event also permits recovery, without polling.
        if self.system.is_null() && (system_event || owned_event) {
            self.system = api.connection(true);
            if !self.system.is_null() {
                Self::setup_system(api, self.system);
                events.push(Event::Expose);
            }
        }
        if self.session.is_null() && (socket_event || owned_event) {
            self.session = api.connection(false);
            if !self.session.is_null() {
                self.appearance_reads = Self::setup_session(api, self.session);
                self.registration.connected();
                self.a11y.request(api, self.session);
                events.push(Event::Expose);
            }
        }
        for c in [self.session, self.system] {
            if c.is_null() {
                continue;
            }
            unsafe {
                (api.read)(c, 0);
                loop {
                    let msg = (api.pop)(c);
                    if msg.is_null() {
                        break;
                    }
                    let member = value((api.member)(msg));
                    let interface = value((api.interface)(msg));
                    let path = value((api.path)(msg));
                    let kind = (api.kind)(msg);
                    if kind == 4
                        && interface == "org.freedesktop.DBus"
                        && member == "NameOwnerChanged"
                    {
                        let args = api.strings(msg);
                        if c == self.session
                            && args
                                .first()
                                .is_some_and(|n| n == "org.kde.StatusNotifierWatcher")
                            && args
                                .get(2)
                                .is_some_and(|owner| self.registration.owner_changed(owner))
                        {
                            Self::register_tray(api, c);
                        }
                        if c == self.session && args.first().is_some_and(|n| n == "org.a11y.Bus") {
                            self.a11y.close(api);
                            if args.get(2).is_some_and(|owner| !owner.is_empty()) {
                                self.a11y.request(api, c);
                            }
                        }
                        if c == self.session
                            && args
                                .first()
                                .is_some_and(|n| n == "org.freedesktop.portal.Desktop")
                        {
                            if let Some((dark, contrast)) = self.appearance.reset() {
                                events.push(Event::Appearance(dark, contrast));
                            }
                            self.appearance_reads =
                                if args.get(2).is_some_and(|owner| !owner.is_empty()) {
                                    Self::read_appearance(api, c)
                                } else {
                                    [0; 2]
                                };
                        }
                        if c == self.system
                            && args.first().is_some_and(|n| n == "org.freedesktop.login1")
                        {
                            self.session_path = None;
                            self.locked = false;
                            self.idle = false;
                            if args.get(2).is_some_and(|owner| !owner.is_empty()) {
                                Self::request_session(api, c);
                            }
                        }
                    } else if c == self.session
                        && kind == 4
                        && interface == "org.freedesktop.portal.Settings"
                        && member == "SettingChanged"
                    {
                        let args = api.strings(msg);
                        if let (Some(namespace), Some(key), Some(value)) =
                            (args.first(), args.get(1), api.setting_value(msg))
                        {
                            if namespace == "org.freedesktop.appearance" {
                                if let Some(index) = ["color-scheme", "contrast"]
                                    .iter()
                                    .position(|name| *name == key.as_str())
                                {
                                    // A newer signal supersedes its outstanding startup read.
                                    self.appearance_reads[index] = 0;
                                }
                            }
                            if let Some((dark, contrast)) =
                                self.appearance.setting(namespace, key, value)
                            {
                                events.push(Event::Appearance(dark, contrast));
                            }
                        }
                    } else if c == self.session
                        && [2, 3].contains(&kind)
                        && self
                            .appearance_reads
                            .iter()
                            .any(|serial| *serial != 0 && *serial == (api.reply_serial)(msg))
                    {
                        let index = self
                            .appearance_reads
                            .iter()
                            .position(|serial| *serial == (api.reply_serial)(msg))
                            .unwrap();
                        self.appearance_reads[index] = 0;
                        if kind == 2 {
                            if let Some(value) = api.setting_value(msg) {
                                if let Some((dark, contrast)) = self.appearance.setting(
                                    "org.freedesktop.appearance",
                                    ["color-scheme", "contrast"][index],
                                    value,
                                ) {
                                    events.push(Event::Appearance(dark, contrast));
                                }
                            }
                        }
                    } else if c == self.system
                        && kind == 4
                        && interface == "org.freedesktop.login1.Manager"
                        && member == "PrepareForSleep"
                    {
                        let mut i = Iter::default();
                        if (api.init)(msg, &mut i) != 0 && (api.typ)(&mut i) == b'b' as i32 {
                            let mut sleeping = 0u32;
                            (api.basic)(&mut i, (&mut sleeping as *mut u32).cast());
                            events.push(Event::Sleep(sleeping != 0));
                        }
                    } else if c == self.system {
                        if kind == 2 {
                            if let Some(p) = api
                                .strings(msg)
                                .into_iter()
                                .find(|s| s.starts_with("/org/freedesktop/login1/session/"))
                            {
                                self.session_path = Some(p.clone());
                                api.call(
                                    c,
                                    "org.freedesktop.login1",
                                    &p,
                                    "org.freedesktop.DBus.Properties",
                                    "GetAll",
                                    |i| api.string(i, "org.freedesktop.login1.Session", b's'),
                                );
                            }
                        }
                        if kind == 2 && self.session_path.is_some() {
                            let mut i = Iter::default();
                            if (api.init)(msg, &mut i) != 0 {
                                Self::read_session_properties(
                                    api,
                                    &mut i,
                                    &mut self.locked,
                                    &mut self.idle,
                                );
                            }
                        }
                        if self.session_path.as_ref().is_some_and(|p| p == &path) {
                            match member.as_str() {
                                "Lock" => self.locked = true,
                                "Unlock" => self.locked = false,
                                "PropertiesChanged" => {
                                    let mut i = Iter::default();
                                    if (api.init)(msg, &mut i) != 0 {
                                        (api.next)(&mut i);
                                        Self::read_session_properties(
                                            api,
                                            &mut i,
                                            &mut self.locked,
                                            &mut self.idle,
                                        );
                                    }
                                }
                                _ => {
                                    if kind == 2 {
                                        let mut i = Iter::default();
                                        if (api.init)(msg, &mut i) != 0 {
                                            Self::read_session_properties(
                                                api,
                                                &mut i,
                                                &mut self.locked,
                                                &mut self.idle,
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    } else if kind == 2 {
                        if let Some(id) = api.integers(msg).first() {
                            self.notices.reply((api.reply_serial)(msg), *id as u32);
                        }
                        if let Some(address) = api
                            .strings(msg)
                            .into_iter()
                            .find(|s| s.starts_with("unix:") || s.starts_with("tcp:"))
                        {
                            self.a11y.connect(api, &address);
                        }
                    } else if kind == 3 {
                        self.notices.reply((api.reply_serial)(msg), 0);
                    } else if kind == 4
                        && interface == "org.freedesktop.Notifications"
                        && member == "NotificationClosed"
                    {
                        if let Some(id) = api.integers(msg).first() {
                            self.notices.closed(*id as u32);
                        }
                    } else if kind == 4
                        && interface == "org.freedesktop.Notifications"
                        && member == "ActionInvoked"
                    {
                        if let (Some(id), Some(action)) =
                            (api.integers(msg).first(), api.strings(msg).first())
                        {
                            if let Some(session) = self.notices.activate(*id as u32, action) {
                                events.push(Event::Notification(session));
                            }
                        }
                    } else if kind == 1 {
                        if c == self.session && path == "/Menu" {
                            self.menu_message(api, c, msg, &interface, &member, &mut events);
                            (api.unref)(msg);
                            continue;
                        }
                        let reply = (api.reply)(msg);
                        let mut i = Iter::default();
                        (api.append_init)(reply, &mut i);
                        let args = api.strings(msg);
                        let mut handled = true;
                        match (interface.as_str(), member.as_str()) {
                            ("org.kde.StatusNotifierItem", "Activate" | "SecondaryActivate") => {
                                events.push(Event::Activity)
                            }
                            ("org.kde.StatusNotifierItem", "ContextMenu") => {
                                // Menu is drawn by the panel; the companion keeps its drawn right-click menu.
                            }
                            ("org.freedesktop.DBus.Properties", "Get") => {
                                handled =
                                    args.get(1).is_some_and(|name| self.property(name, &mut i));
                            }
                            ("org.freedesktop.DBus.Properties", "GetAll") => {
                                api.container(&mut i, b'a', Some("{sv}"), |a| {
                                    for name in [
                                        "Category",
                                        "Id",
                                        "Title",
                                        "Status",
                                        "WindowId",
                                        "ItemIsMenu",
                                        "Menu",
                                        "IconName",
                                        "IconPixmap",
                                        "ToolTip",
                                    ] {
                                        api.container(a, b'e', None, |entry| {
                                            api.string(entry, name, b's');
                                            self.property(name, entry);
                                        });
                                    }
                                });
                            }
                            ("org.freedesktop.DBus.Introspectable", "Introspect") => {
                                api.string(&mut i, INTROSPECTION, b's')
                            }
                            ("org.freedesktop.DBus.Peer", "Ping") => {}
                            _ => handled = false,
                        }
                        if handled {
                            api.send(c, reply);
                        } else {
                            (api.unref)(reply);
                            api.send(
                                c,
                                (api.error)(
                                    msg,
                                    c"org.freedesktop.DBus.Error.UnknownMethod".as_ptr(),
                                    c"Unknown method or property".as_ptr(),
                                ),
                            );
                        }
                    }
                    (api.unref)(msg);
                }
                if c == self.session && (api.connected)(c) == 0 {
                    self.a11y.close(api);
                    (api.close_connection)(c);
                    (api.unref_conn)(c);
                    self.session = ptr::null_mut();
                    self.registration.disconnected();
                    self.notices = Default::default();
                    self.appearance_reads = [0; 2];
                    if let Some((dark, contrast)) = self.appearance.reset() {
                        events.push(Event::Appearance(dark, contrast));
                    }
                    // The disconnect itself is an event: try once now, then wait for a socket directory event.
                    self.session = api.connection(false);
                    if !self.session.is_null() {
                        self.appearance_reads = Self::setup_session(api, self.session);
                        self.registration.connected();
                        self.a11y.request(api, self.session);
                        events.push(Event::Expose);
                    }
                } else if c == self.system && (api.connected)(c) == 0 {
                    (api.close_connection)(c);
                    (api.unref_conn)(c);
                    self.system = ptr::null_mut();
                    self.session_path = None;
                    self.locked = false;
                    self.idle = false;
                    self.system = api.connection(true);
                    if !self.system.is_null() {
                        Self::setup_system(api, self.system);
                        events.push(Event::Expose);
                    }
                }
            }
        }
        events.extend(self.a11y.events(api));
        if was_locked && !self.locked {
            events.push(Event::Unlocked);
        }
        events
    }
    fn read_session_properties(api: &Api, i: &mut Iter, locked: &mut bool, idle: &mut bool) {
        if unsafe { (api.typ)(i) } != b'a' as i32 {
            return;
        }
        let mut array = Iter::default();
        unsafe {
            (api.recurse)(i, &mut array);
            loop {
                if (api.typ)(&mut array) == 0 {
                    break;
                }
                let mut entry = Iter::default();
                (api.recurse)(&mut array, &mut entry);
                let mut key: *const c_char = ptr::null();
                (api.basic)(&mut entry, (&mut key as *mut *const c_char).cast());
                (api.next)(&mut entry);
                let mut val = Iter::default();
                (api.recurse)(&mut entry, &mut val);
                if (api.typ)(&mut val) == b'b' as i32 {
                    let mut b = 0u32;
                    (api.basic)(&mut val, (&mut b as *mut u32).cast());
                    match value(key).as_str() {
                        "LockedHint" => *locked = b != 0,
                        "IdleHint" => *idle = b != 0,
                        _ => {}
                    }
                }
                if (api.next)(&mut array) == 0 {
                    break;
                }
            }
        }
    }
}
struct SocketWatch {
    fd: c_int,
    wd: c_int,
    parent: PathBuf,
}
impl SocketWatch {
    fn new() -> Result<Self, Error> {
        let address = std::env::var("DBUS_SESSION_BUS_ADDRESS").unwrap_or_default();
        let socket = address
            .split(';')
            .find_map(|a| {
                a.strip_prefix("unix:").and_then(|a| {
                    a.split(',')
                        .find_map(|p| p.strip_prefix("path=").map(PathBuf::from))
                })
            })
            .or_else(|| std::env::var_os("XDG_RUNTIME_DIR").map(|p| PathBuf::from(p).join("bus")))
            .ok_or("Session bus exposes no filesystem socket to watch")?;
        Self::for_socket(socket)
    }
    fn for_socket(socket: PathBuf) -> Result<Self, Error> {
        let parent = socket
            .parent()
            .ok_or("Session bus socket has no parent")?
            .to_owned();
        let fd = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let mut watch = Self { fd, wd: -1, parent };
        watch.rearm()?;
        Ok(watch)
    }
    fn rearm(&mut self) -> Result<(), Error> {
        let mut folder = self.parent.as_path();
        while !folder.is_dir() {
            folder = folder
                .parent()
                .ok_or("Session socket directory has no existing ancestor")?;
        }
        let path = CString::new(folder.as_os_str().as_bytes())?;
        let wd = unsafe {
            libc::inotify_add_watch(
                self.fd,
                path.as_ptr(),
                libc::IN_CREATE
                    | libc::IN_MOVED_TO
                    | libc::IN_DELETE
                    | libc::IN_MOVED_FROM
                    | libc::IN_ATTRIB
                    | libc::IN_DELETE_SELF
                    | libc::IN_MOVE_SELF,
            )
        };
        if wd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        if self.wd >= 0 && self.wd != wd {
            unsafe {
                libc::inotify_rm_watch(self.fd, self.wd);
            }
        }
        self.wd = wd;
        Ok(())
    }
    fn drain(&mut self) -> bool {
        let mut bytes = [0u8; 4096];
        let mut changed = false;
        loop {
            let n = unsafe { libc::read(self.fd, bytes.as_mut_ptr().cast(), bytes.len()) };
            if n <= 0 {
                break;
            }
            changed = true;
        }
        if changed {
            let _ = self.rearm();
        }
        changed
    }
}
impl Drop for SocketWatch {
    fn drop(&mut self) {
        unsafe {
            libc::close(self.fd);
        }
    }
}
impl Drop for Bus {
    fn drop(&mut self) {
        if let Some(api) = &self.api {
            self.a11y.close(api);
            for c in [self.session, self.system] {
                if !c.is_null() {
                    unsafe {
                        (api.close_connection)(c);
                        (api.unref_conn)(c);
                    }
                }
            }
        }
    }
}
const INTROSPECTION: &str = r#"<node><interface name="org.kde.StatusNotifierItem"><method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method><method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method><property name="Category" type="s" access="read"/><property name="Id" type="s" access="read"/><property name="Title" type="s" access="read"/><property name="Status" type="s" access="read"/><property name="WindowId" type="u" access="read"/><property name="Menu" type="o" access="read"/><property name="ItemIsMenu" type="b" access="read"/><property name="IconPixmap" type="a(iiay)" access="read"/><property name="ToolTip" type="(sa(iiay)ss)" access="read"/><signal name="NewIcon"/><signal name="NewToolTip"/></interface><interface name="org.freedesktop.DBus.Properties"><method name="Get"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method><method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method></interface></node>"#;
const MENU_INTROSPECTION: &str = r#"<node>
<interface name="com.canonical.dbusmenu">
<property name="Version" type="u" access="read"/><property name="TextDirection" type="s" access="read"/><property name="Status" type="s" access="read"/><property name="IconThemePath" type="as" access="read"/>
<method name="GetLayout"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/><arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/></method>
<method name="GetGroupProperties"><arg type="ai" direction="in"/><arg type="as" direction="in"/><arg type="a(ia{sv})" direction="out"/></method>
<method name="GetProperty"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
<method name="Event"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="u" direction="in"/></method>
<method name="EventGroup"><arg type="a(isvu)" direction="in"/><arg type="ai" direction="out"/></method>
<method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
<method name="AboutToShowGroup"><arg type="ai" direction="in"/><arg type="ai" direction="out"/><arg type="ai" direction="out"/></method>
<signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
</interface><interface name="org.freedesktop.DBus.Properties">
<method name="Get"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
<method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method>
</interface><interface name="org.freedesktop.DBus.Introspectable"><method name="Introspect"><arg type="s" direction="out"/></method></interface>
</node>"#;
