use super::{
    text::{argb32, Library},
    Display, Event,
};
use crate::{
    linux_model::{Area, FollowMode, FollowPlacement, Pick, PickDisplay, Rect, WmClass},
    render::Canvas,
    Error,
};
use std::{
    ffi::{c_char, c_int, c_long, c_uint, c_ulong, c_void, CStr, CString},
    ptr,
};
type Dpy = *mut c_void;
type Window = c_ulong;
type GC = *mut c_void;

#[repr(C)]
#[derive(Default)]
struct VisualInfo {
    visual: *mut c_void,
    visualid: c_ulong,
    screen: c_int,
    depth: c_int,
    class: c_int,
    red_mask: c_ulong,
    green_mask: c_ulong,
    blue_mask: c_ulong,
    colormap_size: c_int,
    bits_per_rgb: c_int,
}
#[repr(C)]
#[derive(Default)]
struct Attributes {
    background_pixmap: c_ulong,
    background_pixel: c_ulong,
    border_pixmap: c_ulong,
    border_pixel: c_ulong,
    bit_gravity: c_int,
    win_gravity: c_int,
    backing_store: c_int,
    backing_planes: c_ulong,
    backing_pixel: c_ulong,
    save_under: c_int,
    event_mask: c_long,
    do_not_propagate_mask: c_long,
    override_redirect: c_int,
    colormap: c_ulong,
    cursor: c_ulong,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct AnyEvent {
    kind: c_int,
    serial: c_ulong,
    send_event: c_int,
    display: Dpy,
    window: Window,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct PointerEvent {
    kind: c_int,
    serial: c_ulong,
    send_event: c_int,
    display: Dpy,
    window: Window,
    root: Window,
    subwindow: Window,
    time: c_ulong,
    x: c_int,
    y: c_int,
    root_x: c_int,
    root_y: c_int,
    state: c_uint,
    button: c_uint,
    same_screen: c_int,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct ConfigureEvent {
    kind: c_int,
    serial: c_ulong,
    send_event: c_int,
    display: Dpy,
    event: Window,
    window: Window,
    x: c_int,
    y: c_int,
    width: c_int,
    height: c_int,
    border_width: c_int,
    above: Window,
    override_redirect: c_int,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct PropertyEvent {
    kind: c_int,
    serial: c_ulong,
    send_event: c_int,
    display: Dpy,
    window: Window,
    atom: c_ulong,
    time: c_ulong,
    state: c_int,
}
#[repr(C)]
#[derive(Clone, Copy)]
union XEvent {
    kind: c_int,
    any: AnyEvent,
    pointer: PointerEvent,
    configure: ConfigureEvent,
    property: PropertyEvent,
    pad: [c_long; 24],
}
#[repr(C)]
struct ClassHint {
    name: *mut c_char,
    class: *mut c_char,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Rectangle {
    x: i16,
    y: i16,
    width: u16,
    height: u16,
}
#[repr(C)]
struct RenderFormat {
    id: c_ulong,
    kind: c_int,
    depth: c_int,
    direct: [i16; 8],
    colormap: c_ulong,
}

#[repr(C)]
struct XError {
    display: Dpy,
    resource: c_ulong,
    serial: c_ulong,
    code: u8,
    request: u8,
    minor: u8,
}
unsafe extern "C" fn xerror(_display: Dpy, error: *mut XError) -> c_int {
    if !error.is_null() {
        let e = unsafe { &*error };
        if e.code != 3 {
            eprintln!(
                "X11 request {}:{} failed with error {}",
                e.request, e.minor, e.code
            );
        }
    }
    0
}

struct Api {
    display_width_mm: unsafe extern "C" fn(Dpy, c_int) -> c_int,
    property: unsafe extern "C" fn(
        Dpy,
        Window,
        c_ulong,
        c_long,
        c_long,
        c_int,
        c_ulong,
        *mut c_ulong,
        *mut c_int,
        *mut c_ulong,
        *mut c_ulong,
        *mut *mut u8,
    ) -> c_int,
    _xlib: Library,
    _shape: Library,
    _render: Library,
    close: unsafe extern "C" fn(Dpy) -> c_int,
    fd: unsafe extern "C" fn(Dpy) -> c_int,
    pending: unsafe extern "C" fn(Dpy) -> c_int,
    next: unsafe extern "C" fn(Dpy, *mut XEvent) -> c_int,
    flush: unsafe extern "C" fn(Dpy) -> c_int,
    create_colormap: unsafe extern "C" fn(Dpy, Window, *mut c_void, c_int) -> c_ulong,
    create_window: unsafe extern "C" fn(
        Dpy,
        Window,
        c_int,
        c_int,
        c_uint,
        c_uint,
        c_uint,
        c_int,
        c_uint,
        *mut c_void,
        c_ulong,
        *mut Attributes,
    ) -> Window,
    destroy_window: unsafe extern "C" fn(Dpy, Window) -> c_int,
    free_colormap: unsafe extern "C" fn(Dpy, c_ulong) -> c_int,
    select: unsafe extern "C" fn(Dpy, Window, c_long) -> c_int,
    map: unsafe extern "C" fn(Dpy, Window) -> c_int,
    raise: unsafe extern "C" fn(Dpy, Window) -> c_int,
    move_resize: unsafe extern "C" fn(Dpy, Window, c_int, c_int, c_uint, c_uint) -> c_int,
    create_gc: unsafe extern "C" fn(Dpy, Window, c_ulong, *mut c_void) -> GC,
    free_gc: unsafe extern "C" fn(Dpy, GC) -> c_int,
    create_image: unsafe extern "C" fn(
        Dpy,
        *mut c_void,
        c_uint,
        c_int,
        c_int,
        *mut c_char,
        c_uint,
        c_uint,
        c_int,
        c_int,
    ) -> *mut c_void,
    put_image: unsafe extern "C" fn(
        Dpy,
        Window,
        GC,
        *mut c_void,
        c_int,
        c_int,
        c_int,
        c_int,
        c_uint,
        c_uint,
    ) -> c_int,
    destroy_image: unsafe extern "C" fn(*mut c_void) -> c_int,
    shape:
        unsafe extern "C" fn(Dpy, Window, c_int, c_int, c_int, *mut Rectangle, c_int, c_int, c_int),
    tree: unsafe extern "C" fn(
        Dpy,
        Window,
        *mut Window,
        *mut Window,
        *mut *mut Window,
        *mut c_uint,
    ) -> c_int,
    class: unsafe extern "C" fn(Dpy, Window, *mut ClassHint) -> c_int,
    free: unsafe extern "C" fn(*mut c_void) -> c_int,
    geometry: unsafe extern "C" fn(
        Dpy,
        Window,
        *mut Window,
        *mut c_int,
        *mut c_int,
        *mut c_uint,
        *mut c_uint,
        *mut c_uint,
        *mut c_uint,
    ) -> c_int,
    translate: unsafe extern "C" fn(
        Dpy,
        Window,
        Window,
        c_int,
        c_int,
        *mut c_int,
        *mut c_int,
        *mut Window,
    ) -> c_int,
    grab: unsafe extern "C" fn(
        Dpy,
        Window,
        c_int,
        c_uint,
        c_int,
        c_int,
        Window,
        c_ulong,
        c_ulong,
    ) -> c_int,
    ungrab: unsafe extern "C" fn(Dpy, c_ulong) -> c_int,
    font_cursor: unsafe extern "C" fn(Dpy, c_uint) -> c_ulong,
    free_cursor: unsafe extern "C" fn(Dpy, c_ulong) -> c_int,
    grab_keyboard: unsafe extern "C" fn(Dpy, Window, c_int, c_int, c_int, c_ulong) -> c_int,
    ungrab_keyboard: unsafe extern "C" fn(Dpy, c_ulong) -> c_int,
    lookup: unsafe extern "C" fn(*mut XEvent, c_int) -> c_ulong,
    open_im: unsafe extern "C" fn(Dpy, *mut c_void, *const c_char, *const c_char) -> *mut c_void,
    create_ic: unsafe extern "C" fn(*mut c_void, ...) -> *mut c_void,
    destroy_ic: unsafe extern "C" fn(*mut c_void),
    close_im: unsafe extern "C" fn(*mut c_void) -> c_int,
    ic_focus: unsafe extern "C" fn(*mut c_void),
    ic_unfocus: unsafe extern "C" fn(*mut c_void),
    utf8: unsafe extern "C" fn(
        *mut c_void,
        *mut XEvent,
        *mut c_char,
        c_int,
        *mut c_ulong,
        *mut c_int,
    ) -> c_int,
    filter: unsafe extern "C" fn(*mut XEvent, Window) -> c_int,
    focus: unsafe extern "C" fn(Dpy, Window, c_int, c_ulong) -> c_int,
    send: unsafe extern "C" fn(Dpy, Window, c_int, c_long, *mut XEvent) -> c_int,
    query_pointer: unsafe extern "C" fn(
        Dpy,
        Window,
        *mut Window,
        *mut Window,
        *mut c_int,
        *mut c_int,
        *mut c_int,
        *mut c_int,
        *mut c_uint,
    ) -> c_int,
}

pub(super) struct Native {
    api: Api,
    dpy: Dpy,
    root: Window,
    window: Window,
    gc: GC,
    visual: *mut c_void,
    colormap: c_ulong,
    screen: (u32, u32),
    screen_id: c_int,
    display_scale: f64,
    fallback_dpi: f64,
    resource_atom: c_ulong,
    monitor: Area,
    visible: Area,
    randr: Option<RandR>,
    workarea_atom: c_ulong,
    desktop_atom: c_ulong,
    retained: Option<FollowPlacement>,
    target_gesture: bool,
    occluding_host: Option<Area>,
    size: (u32, u32),
    sprite: (i32, i32, u32, u32),
    position: (i32, i32),
    follow: Option<String>,
    followed: Window,
    active_atom: c_ulong,
    active: bool,
    offset: Option<(i32, i32)>,
    restored_anchor: Option<(String, f64, f64)>,
    manual: Option<(f64, f64)>,
    menu: Option<Rectangle>,
    press: Option<(i32, i32, i32, i32)>,
    alpha: Vec<Rectangle>,
    pick: Pick,
    pick_cursor: c_ulong,
    contrast: bool,
    outline_window: Window,
    tip_window: Window,
    pick_tooltip: crate::linux_model::PickTooltipState,
    pages_window: Window,
    pages_gate: crate::linux_model::FrontPageGate,
    pick_help: String,
    pick_lang: String,
    focused: bool,
    xi: Option<XInput>,
    saver: Option<ScreenSaver>,
    panel_frame: Option<crate::motion::ScreenRect>,
    previous_focus: Window,
    rest_position: (i32, i32),
    place_mode: crate::motion::PlaceMode,
    raw_pointer: bool,
    xim: *mut c_void,
    xic: *mut c_void,
}

impl Native {
    pub fn new(follow: Option<&str>) -> Result<Self, Error> {
        let xlib = Library::open("libX11.so.6")?;
        let shape = Library::open("libXext.so.6")?;
        let render = Library::open("libXrender.so.1")?;
        unsafe {
            let open: unsafe extern "C" fn(*const c_char) -> Dpy = xlib.symbol("XOpenDisplay")?;
            let error_handler: unsafe extern "C" fn(
                Option<unsafe extern "C" fn(Dpy, *mut XError) -> c_int>,
            ) -> *mut c_void = xlib.symbol("XSetErrorHandler")?;
            error_handler(Some(xerror));
            let dpy = open(ptr::null());
            if dpy.is_null() {
                return Err("Cannot connect to X11 DISPLAY".into());
            }
            let default_screen: unsafe extern "C" fn(Dpy) -> c_int =
                xlib.symbol("XDefaultScreen")?;
            let root_window: unsafe extern "C" fn(Dpy, c_int) -> Window =
                xlib.symbol("XRootWindow")?;
            let width: unsafe extern "C" fn(Dpy, c_int) -> c_int = xlib.symbol("XDisplayWidth")?;
            let height: unsafe extern "C" fn(Dpy, c_int) -> c_int =
                xlib.symbol("XDisplayHeight")?;
            let width_mm: unsafe extern "C" fn(Dpy, c_int) -> c_int =
                xlib.symbol("XDisplayWidthMM")?;
            let match_visual: unsafe extern "C" fn(
                Dpy,
                c_int,
                c_int,
                c_int,
                *mut VisualInfo,
            ) -> c_int = xlib.symbol("XMatchVisualInfo")?;
            let find_format: unsafe extern "C" fn(Dpy, *mut c_void) -> *mut RenderFormat =
                render.symbol("XRenderFindVisualFormat")?;
            let screen_id = default_screen(dpy);
            let root = root_window(dpy, screen_id);
            let intern: unsafe extern "C" fn(Dpy, *const c_char, c_int) -> c_ulong =
                xlib.symbol("XInternAtom")?;
            let owner: unsafe extern "C" fn(Dpy, c_ulong) -> Window =
                xlib.symbol("XGetSelectionOwner")?;
            let selection = CString::new(format!("_NET_WM_CM_S{screen_id}"))?;
            if owner(dpy, intern(dpy, selection.as_ptr(), 0)) == 0 {
                return Err(
                    "An X11 compositing window manager is required for transparent drawing".into(),
                );
            }
            let mut info = VisualInfo::default();
            if match_visual(dpy, screen_id, 32, 4, &mut info) == 0 {
                return Err(
                    "X11 server has no 32-bit TrueColor visual for transparent drawing".into(),
                );
            }
            let format = find_format(dpy, info.visual);
            if format.is_null() || (*format).direct[7] == 0 {
                return Err(
                    "X11 visual has no alpha channel; a compositing X11 desktop is required".into(),
                );
            }
            let active_atom = intern(dpy, c"_NET_ACTIVE_WINDOW".as_ptr(), 0);
            let api = Api {
                display_width_mm: width_mm,
                property: xlib.symbol("XGetWindowProperty")?,
                close: xlib.symbol("XCloseDisplay")?,
                fd: xlib.symbol("XConnectionNumber")?,
                pending: xlib.symbol("XPending")?,
                next: xlib.symbol("XNextEvent")?,
                flush: xlib.symbol("XFlush")?,
                create_colormap: xlib.symbol("XCreateColormap")?,
                create_window: xlib.symbol("XCreateWindow")?,
                destroy_window: xlib.symbol("XDestroyWindow")?,
                free_colormap: xlib.symbol("XFreeColormap")?,
                select: xlib.symbol("XSelectInput")?,
                map: xlib.symbol("XMapWindow")?,
                raise: xlib.symbol("XRaiseWindow")?,
                move_resize: xlib.symbol("XMoveResizeWindow")?,
                create_gc: xlib.symbol("XCreateGC")?,
                free_gc: xlib.symbol("XFreeGC")?,
                create_image: xlib.symbol("XCreateImage")?,
                put_image: xlib.symbol("XPutImage")?,
                destroy_image: xlib.symbol("XDestroyImage")?,
                shape: shape.symbol("XShapeCombineRectangles")?,
                tree: xlib.symbol("XQueryTree")?,
                class: xlib.symbol("XGetClassHint")?,
                free: xlib.symbol("XFree")?,
                geometry: xlib.symbol("XGetGeometry")?,
                translate: xlib.symbol("XTranslateCoordinates")?,
                grab: xlib.symbol("XGrabPointer")?,
                ungrab: xlib.symbol("XUngrabPointer")?,
                font_cursor: xlib.symbol("XCreateFontCursor")?,
                free_cursor: xlib.symbol("XFreeCursor")?,
                grab_keyboard: xlib.symbol("XGrabKeyboard")?,
                ungrab_keyboard: xlib.symbol("XUngrabKeyboard")?,
                lookup: xlib.symbol("XLookupKeysym")?,
                open_im: xlib.symbol("XOpenIM")?,
                create_ic: xlib.symbol("XCreateIC")?,
                destroy_ic: xlib.symbol("XDestroyIC")?,
                close_im: xlib.symbol("XCloseIM")?,
                ic_focus: xlib.symbol("XSetICFocus")?,
                ic_unfocus: xlib.symbol("XUnsetICFocus")?,
                utf8: xlib.symbol("Xutf8LookupString")?,
                filter: xlib.symbol("XFilterEvent")?,
                focus: xlib.symbol("XSetInputFocus")?,
                send: xlib.symbol("XSendEvent")?,
                query_pointer: xlib.symbol("XQueryPointer")?,
                _xlib: xlib,
                _shape: shape,
                _render: render,
            };
            let colormap = (api.create_colormap)(dpy, root, info.visual, 0);
            let mut attributes = Attributes {
                colormap,
                override_redirect: 1,
                event_mask: (1 << 0)
                    | (1 << 1)
                    | (1 << 2)
                    | (1 << 3)
                    | (1 << 4)
                    | (1 << 6)
                    | (1 << 15)
                    | (1 << 17),
                ..Attributes::default()
            };
            let window = (api.create_window)(
                dpy,
                root,
                0,
                0,
                1,
                1,
                0,
                32,
                1,
                info.visual,
                (1 << 1) | (1 << 3) | (1 << 9) | (1 << 11) | (1 << 13),
                &mut attributes,
            );
            if window == 0 {
                return Err("Cannot create transparent X11 companion window".into());
            }
            let gc = (api.create_gc)(dpy, window, 0, ptr::null_mut());
            let xim = (api.open_im)(dpy, ptr::null_mut(), ptr::null(), ptr::null());
            let xic = if xim.is_null() {
                ptr::null_mut()
            } else {
                (api.create_ic)(
                    xim,
                    c"inputStyle".as_ptr(),
                    0x0408 as c_ulong,
                    c"clientWindow".as_ptr(),
                    window,
                    c"focusWindow".as_ptr(),
                    window,
                    ptr::null::<c_char>(),
                )
            };
            let mut result = Self {
                api,
                dpy,
                root,
                window,
                gc,
                visual: info.visual,
                colormap,
                screen: (width(dpy, screen_id) as u32, height(dpy, screen_id) as u32),
                screen_id,
                display_scale: 1.,
                fallback_dpi: 96.,
                resource_atom: intern(dpy, c"RESOURCE_MANAGER".as_ptr(), 0),
                monitor: Area::new(
                    0.,
                    0.,
                    width(dpy, screen_id) as f64,
                    height(dpy, screen_id) as f64,
                ),
                visible: Area::new(
                    0.,
                    0.,
                    width(dpy, screen_id) as f64,
                    height(dpy, screen_id) as f64,
                ),
                randr: RandR::new(dpy, root).ok(),
                workarea_atom: intern(dpy, c"_NET_WORKAREA".as_ptr(), 0),
                desktop_atom: intern(dpy, c"_NET_CURRENT_DESKTOP".as_ptr(), 0),
                retained: None,
                target_gesture: false,
                occluding_host: None,
                size: (1, 1),
                sprite: (0, 0, 1, 1),
                position: (0, 0),
                follow: follow.map(str::to_owned),
                followed: 0,
                active_atom,
                active: false,
                offset: None,
                restored_anchor: None,
                manual: None,
                menu: None,
                press: None,
                alpha: Vec::new(),
                pick: Pick::default(),
                pick_cursor: 0,
                contrast: false,
                outline_window: 0,
                tip_window: 0,
                pick_tooltip: Default::default(),
                pages_window: 0,
                pages_gate: Default::default(),
                pick_help: String::new(),
                pick_lang: "en".into(),
                focused: false,
                xi: XInput::new(dpy, root).ok(),
                saver: ScreenSaver::new(dpy, root).ok(),
                raw_pointer: false,
                xim,
                xic,
                panel_frame: None,
                previous_focus: 0,
                rest_position: (0, 0),
                place_mode: crate::motion::PlaceMode::Corner,
            };
            // Root structure events report newly created/mapped windows; selected-window
            // StructureNotify reports only changes to its geometry and lifecycle.
            (result.api.select)(dpy, root, (1 << 19) | (1 << 22));
            result.refresh_physical_dpi();
            result.refresh_scale_and_tooltip();
            result.find_follow();
            result.active = result.is_active();
            Ok(result)
        }
    }
    fn children(&self, window: Window) -> Vec<Window> {
        let (mut root, mut parent, mut list, mut count) = (0, 0, ptr::null_mut(), 0);
        unsafe {
            if (self.api.tree)(
                self.dpy,
                window,
                &mut root,
                &mut parent,
                &mut list,
                &mut count,
            ) == 0
            {
                return Vec::new();
            }
            let out = if list.is_null() {
                Vec::new()
            } else {
                std::slice::from_raw_parts(list, count as usize).to_vec()
            };
            if !list.is_null() {
                (self.api.free)(list.cast());
            }
            out
        }
    }
    fn class_pair(&self, window: Window) -> Option<WmClass> {
        let mut hint = ClassHint {
            name: ptr::null_mut(),
            class: ptr::null_mut(),
        };
        unsafe {
            if (self.api.class)(self.dpy, window, &mut hint) == 0 {
                return None;
            }
            let pair = if hint.name.is_null() || hint.class.is_null() {
                None
            } else {
                Some(WmClass {
                    instance: CStr::from_ptr(hint.name).to_string_lossy().into_owned(),
                    class: CStr::from_ptr(hint.class).to_string_lossy().into_owned(),
                })
            };
            if !hint.name.is_null() {
                (self.api.free)(hint.name.cast());
            }
            if !hint.class.is_null() {
                (self.api.free)(hint.class.cast());
            }
            pair
        }
    }
    fn matches(&self, window: Window, wanted: &str) -> bool {
        if let Some((instance, class)) = wanted.split_once('\0') {
            return self
                .class_pair(window)
                .is_some_and(|p| p.instance == instance && p.class == class);
        }
        let mut class = ClassHint {
            name: ptr::null_mut(),
            class: ptr::null_mut(),
        };
        unsafe {
            if (self.api.class)(self.dpy, window, &mut class) == 0 {
                return false;
            }
            let same = [class.name, class.class]
                .into_iter()
                .any(|p| !p.is_null() && CStr::from_ptr(p).to_bytes() == wanted.as_bytes());
            if !class.name.is_null() {
                (self.api.free)(class.name.cast());
            }
            if !class.class.is_null() {
                (self.api.free)(class.class.cast());
            }
            same
        }
    }
    fn find_follow(&mut self) {
        let Some(wanted) = self.follow.clone() else {
            return;
        };
        let active = self.active_window();
        if active != 0 && self.matches(active, &wanted) {
            if self.followed != active {
                self.retained = None;
                self.target_gesture = false;
            }
            self.followed = active;
            unsafe {
                (self.api.select)(self.dpy, active, 1 << 17);
            }
            self.follow_position();
            return;
        }
        let previous_window = self.followed;
        self.followed = 0;
        let mut nodes = self
            .children(self.root)
            .into_iter()
            .map(|w| (w, 0))
            .collect::<Vec<_>>();
        while let Some((window, depth)) = nodes.pop() {
            if window == self.window
                || window == self.pages_window
                || window == self.outline_window
                || window == self.tip_window
            {
                continue;
            }
            if self.matches(window, &wanted) {
                if previous_window != window {
                    self.retained = None;
                    self.target_gesture = false;
                }
                self.followed = window;
                unsafe {
                    (self.api.select)(self.dpy, window, 1 << 17);
                }
                self.follow_position();
                break;
            }
            if depth < 3 {
                nodes.extend(self.children(window).into_iter().map(|w| (w, depth + 1)));
            }
        }
    }
    fn active_window(&self) -> Window {
        let (mut atom, mut format, mut count, mut after, mut value) = (0, 0, 0, 0, ptr::null_mut());
        unsafe {
            let result = (self.api.property)(
                self.dpy,
                self.root,
                self.active_atom,
                0,
                1,
                0,
                0,
                &mut atom,
                &mut format,
                &mut count,
                &mut after,
                &mut value,
            );
            let active = if result == 0 && format == 32 && count == 1 && !value.is_null() {
                ptr::read_unaligned(value.cast::<c_ulong>())
            } else {
                0
            };
            if !value.is_null() {
                (self.api.free)(value.cast());
            }
            active
        }
    }
    fn is_active(&self) -> bool {
        self.followed != 0 && self.active_window() == self.followed
    }
    fn activation(&mut self, events: &mut Vec<Event>) {
        self.find_follow();
        let active = self.is_active();
        if active && !self.active {
            events.push(Event::Return);
        }
        self.active = active;
    }
    fn followed_rect(&self) -> Option<(i32, i32, u32, u32)> {
        if self.followed == 0 {
            return None;
        }
        let (mut root, mut x, mut y, mut w, mut h, mut border, mut depth) = (0, 0, 0, 0, 0, 0, 0);
        unsafe {
            if (self.api.geometry)(
                self.dpy,
                self.followed,
                &mut root,
                &mut x,
                &mut y,
                &mut w,
                &mut h,
                &mut border,
                &mut depth,
            ) == 0
            {
                return None;
            }
            let mut child = 0;
            if (self.api.translate)(
                self.dpy,
                self.followed,
                self.root,
                0,
                0,
                &mut x,
                &mut y,
                &mut child,
            ) == 0
            {
                return None;
            }
        }
        Some((x, y, w, h))
    }
    fn follow_position(&mut self) {
        if self.manual.is_some() || self.sprite.2 <= 1 || self.sprite.3 <= 1 {
            return;
        }
        if let Some((x, y, w, h)) = self.followed_rect() {
            use crate::motion::PlaceMode;
            self.refresh_area();
            let (sx, sy, pw, ph) = self.sprite;
            let origin = if let Some((corner, dx, dy)) = &self.restored_anchor {
                self.place_mode = PlaceMode::Manual;
                let ax = if corner.ends_with("Right") {
                    x + w as i32
                } else {
                    x
                };
                let ay = if corner.starts_with("bottom") {
                    y + h as i32
                } else {
                    y
                };
                (ax + *dx as i32, ay + *dy as i32)
            } else if let Some((dx, dy)) = self.offset {
                self.place_mode = PlaceMode::Manual;
                (x + w as i32 + dx, y + h as i32 + dy)
            } else {
                let placed = crate::linux_model::follow_spot(
                    Area::new(x as f64, y as f64, w as f64, h as f64),
                    [pw as f64, ph as f64],
                    self.monitor,
                    self.visible,
                    self.retained,
                    self.target_gesture,
                );
                self.place_mode = match placed.mode {
                    FollowMode::Ledge => PlaceMode::Ledge,
                    FollowMode::BesideRight => PlaceMode::BesideRight,
                    FollowMode::BesideLeft => PlaceMode::BesideLeft,
                    FollowMode::Below => PlaceMode::Below,
                    FollowMode::Free => PlaceMode::Free,
                };
                self.retained = Some(placed);
                (placed.frame.x.round() as i32, placed.frame.y.round() as i32)
            };
            self.position = (origin.0 - sx, origin.1 - sy);
            self.place();
        }
    }
    fn place(&mut self) {
        let (sx, sy, w, h) = self.sprite;
        self.refresh_area();
        if self.manual.is_some() || self.followed == 0 {
            let lowx = self.monitor.x as i32 - sx;
            let lowy = self.visible.y as i32 - sy;
            self.position.0 = self.position.0.clamp(
                lowx,
                (self.monitor.right() as i32 - sx - w as i32).max(lowx),
            );
            self.position.1 = self.position.1.clamp(
                lowy,
                (self.monitor.bottom() as i32 - sy - h as i32).max(lowy),
            );
        }
        self.rest_position = self.position;
        unsafe {
            (self.api.move_resize)(
                self.dpy,
                self.window,
                self.position.0,
                self.position.1,
                self.size.0,
                self.size.1,
            );
            (self.api.raise)(self.dpy, self.window);
        }
    }
    fn property_numbers(&self, atom: c_ulong) -> Vec<c_ulong> {
        let (mut actual, mut format, mut count, mut after, mut value) =
            (0, 0, 0, 0, ptr::null_mut());
        unsafe {
            let result = (self.api.property)(
                self.dpy,
                self.root,
                atom,
                0,
                4096,
                0,
                0,
                &mut actual,
                &mut format,
                &mut count,
                &mut after,
                &mut value,
            );
            let out = if result == 0 && format == 32 && !value.is_null() {
                std::slice::from_raw_parts(value.cast::<c_ulong>(), count.min(4096) as usize)
                    .to_vec()
            } else {
                vec![]
            };
            if !value.is_null() {
                (self.api.free)(value.cast());
            }
            out
        }
    }
    fn refresh_physical_dpi(&mut self) {
        let width_mm = unsafe { (self.api.display_width_mm)(self.dpy, self.screen_id) };
        self.fallback_dpi = crate::linux_model::x11_physical_dpi(self.screen.0, width_mm);
    }
    fn refresh_scale_and_tooltip(&mut self) {
        self.refresh_display_scale();
        let scale = self.scale();
        if let Some(point) = self.pick_tooltip.scale_changed(scale) {
            self.tooltip(Some(point));
        }
    }
    fn refresh_display_scale(&mut self) {
        let (mut actual, mut format, mut count, mut after, mut value) =
            (0, 0, 0, 0, ptr::null_mut());
        unsafe {
            let result = (self.api.property)(self.dpy, self.root, self.resource_atom,
                0, 16384, 0, 0, &mut actual, &mut format, &mut count, &mut after, &mut value);
            let resources = if result == 0 && format == 8 && !value.is_null() {
                String::from_utf8_lossy(std::slice::from_raw_parts(value, count.min(65536) as usize)).into_owned()
            } else { String::new() };
            if !value.is_null() { (self.api.free)(value.cast()); }
            self.display_scale = crate::linux_model::x11_display_scale(&resources, self.fallback_dpi);
        }
    }
    fn refresh_area(&mut self) {
        let (mut root, mut x, mut y, mut width, mut height, mut border, mut depth) =
            (0, 0, 0, 0, 0, 0, 0);
        unsafe {
            if (self.api.geometry)(
                self.dpy,
                self.root,
                &mut root,
                &mut x,
                &mut y,
                &mut width,
                &mut height,
                &mut border,
                &mut depth,
            ) != 0
                && width > 0
                && height > 0
            {
                self.screen = (width, height);
            }
        }
        let fallback = Area::new(0., 0., self.screen.0 as f64, self.screen.1 as f64);
        let monitors = self.randr.as_ref().map_or_else(
            || vec![(fallback, true)],
            |r| r.monitors(self.dpy, self.root),
        );
        let (sx, sy, w, h) = self.sprite;
        let target = self
            .followed_rect()
            .filter(|_| self.manual.is_none())
            .map(|(x, y, w, h)| Area::new(x as f64, y as f64, w as f64, h as f64))
            .unwrap_or(Area::new(
                (self.position.0 + sx) as f64,
                (self.position.1 + sy) as f64,
                w as f64,
                h as f64,
            ));
        self.monitor = crate::linux_model::monitor_for(target, &monitors, fallback);
        let desktop = self
            .property_numbers(self.desktop_atom)
            .first()
            .copied()
            .unwrap_or(0) as usize;
        let values = self.property_numbers(self.workarea_atom);
        let work = desktop
            .checked_mul(4)
            .and_then(|at| values.get(at..at + 4))
            .filter(|v| v[2] > 0 && v[3] > 0)
            .map(|v| {
                Area::new(
                    v[0] as i32 as f64,
                    v[1] as i32 as f64,
                    v[2] as f64,
                    v[3] as f64,
                )
            });
        self.visible = crate::linux_model::visible_area(self.monitor, work);
    }
    fn buttons_down(&self) -> bool {
        let (mut root, mut child, mut rx, mut ry, mut x, mut y, mut mask) = (0, 0, 0, 0, 0, 0, 0);
        unsafe {
            (self.api.query_pointer)(
                self.dpy, self.root, &mut root, &mut child, &mut rx, &mut ry, &mut x, &mut y,
                &mut mask,
            ) != 0
                && mask & ((1 << 8) | (1 << 9) | (1 << 10)) != 0
        }
    }
}
impl Display for Native {
    fn scale(&self) -> f64 {
        self.display_scale
    }
    fn host_rect(&self) -> Option<Area> {
        self.followed_rect()
            .map(|(x, y, w, h)| Area::new(x as f64, y as f64, w as f64, h as f64))
    }
    fn host_occlusion(&mut self, host: Option<Area>) {
        self.occluding_host = host;
    }
    fn live_follow_gesture(&self) -> bool {
        self.target_gesture
    }
    fn shed_context(&self) -> Option<(bool, f64, bool)> {
        if self.sprite.2 <= 1 || self.sprite.3 <= 1 {
            return None;
        }
        let sprite = Area::new(
            (self.rest_position.0 + self.sprite.0) as f64,
            (self.rest_position.1 + self.sprite.1) as f64,
            self.sprite.2 as f64,
            self.sprite.3 as f64,
        );
        let on_ledge = self.place_mode == crate::motion::PlaceMode::Ledge;
        let host = self.host_rect();
        let room = if on_ledge {
            host.map_or(self.visible.right(), Area::right)
                .min(self.visible.right())
                - sprite.right()
        } else {
            self.visible.right() - sprite.right()
        };
        let bottom_visible = if on_ledge {
            host.is_some_and(|r| r.y >= self.visible.y && r.y <= self.monitor.bottom())
        } else {
            sprite.bottom() <= self.monitor.bottom() && sprite.bottom() > self.visible.y
        };
        Some((on_ledge, room.max(0.), bottom_visible))
    }
    fn placement(&self) -> Option<super::Placement> {
        if self.panel_frame.is_some() {
            return None;
        }
        use crate::motion::PlaceMode;
        let (sx, sy, w, h) = self.sprite;
        let (px, py) = self.rest_position;
        let bottom = (py + sy + h as i32) as f64;
        if self.manual.is_none() && self.offset.is_none() && self.restored_anchor.is_none() {
            if let Some(retained) = self.retained {
                return Some(super::Placement {
                    anchor: [
                        retained.frame.x + retained.frame.width / 2.,
                        retained.frame.bottom(),
                    ],
                    ledge: retained.mode == FollowMode::Ledge,
                    room: retained.room,
                    horizontal: retained.horizontal,
                    push: retained.push,
                    hidden: retained.hidden,
                });
            }
        }
        let mut room = 1.;
        let mut horizontal = false;
        let mut push = 0.;
        if let Some((x, y, ww, _)) = self.followed_rect() {
            match self.place_mode {
                PlaceMode::Ledge => {
                    room = (bottom - 2.) / (h.max(1) as f64);
                    push = 1.;
                }
                PlaceMode::BesideRight => {
                    horizontal = true;
                    push = 1.;
                    room = if x + ww as i32 + 10 <= self.screen.0 as i32 - 2 - w as i32 {
                        10.
                    } else {
                        (self.screen.0 as f64 - x as f64 - ww as f64 - 2. - 4.) / w.max(1) as f64
                    };
                }
                PlaceMode::BesideLeft => {
                    horizontal = true;
                    push = -1.;
                    room = if x - 10 - w as i32 >= 2 {
                        10.
                    } else {
                        (x as f64 - 2. - 4.) / w.max(1) as f64
                    };
                }
                _ => {
                    let _ = y;
                }
            }
        }
        Some(super::Placement {
            anchor: [(px + sx) as f64 + w as f64 / 2., bottom],
            ledge: self.place_mode == PlaceMode::Ledge,
            room,
            horizontal,
            push,
            hidden: 0.,
        })
    }
    fn motion_anchor(&mut self, anchor: [f64; 2]) {
        let (sx, sy, w, h) = self.sprite;
        self.position = (
            (anchor[0] - w as f64 / 2.) as i32 - sx,
            anchor[1] as i32 - sy - h as i32,
        );
        unsafe {
            (self.api.move_resize)(
                self.dpy,
                self.window,
                self.position.0,
                self.position.1,
                self.size.0,
                self.size.1,
            );
        }
    }
    fn screen_origin(&self) -> (i32, i32) {
        self.position
    }
    fn ui_viewport(&self) -> Option<crate::ui::Rect> {
        let scale = self.scale();
        Some(crate::ui::Rect {
            x: (self.visible.x - self.position.0 as f64) / scale,
            y: (self.visible.y - self.position.1 as f64) / scale,
            width: self.visible.width / scale,
            height: self.visible.height / scale,
        })
    }
    fn fd(&self) -> i32 {
        unsafe { (self.api.fd)(self.dpy) }
    }
    fn events(&mut self) -> Result<Vec<Event>, Error> {
        let mut events = Vec::new();
        unsafe {
            while (self.api.pending)(self.dpy) > 0 {
                let mut ev = XEvent { pad: [0; 24] };
                (self.api.next)(self.dpy, &mut ev);
                if self
                    .randr
                    .as_ref()
                    .is_some_and(|r| ev.kind == r.event || ev.kind == r.event + 1)
                {
                    if let Some(r) = &self.randr {
                        (r.update)(&mut ev);
                    }
                    self.refresh_area();
                    self.refresh_physical_dpi();
                    self.refresh_scale_and_tooltip();
                    self.follow_position();
                    events.push(Event::Expose);
                    continue;
                }
                let route = crate::linux_model::x11_event_route(ev.kind,
                    ev.kind == 28 && ev.any.window == self.root && ev.property.atom == self.resource_atom,
                    self.pick.active());
                if route == crate::linux_model::X11EventRoute::RefreshScale {
                    self.refresh_scale_and_tooltip();
                    self.refresh_area();
                    events.push(Event::Expose);
                    continue;
                }
                if !self.xic.is_null() && (self.api.filter)(&mut ev, 0) != 0 {
                    continue;
                }
                if ev.kind == 35 && (self.raw_pointer || self.target_gesture) {
                    if let Some(xi) = &self.xi {
                        let cookie = &mut ev as *mut XEvent as *mut GenericCookie;
                        if (*cookie).extension == xi.opcode
                            && [16, 17].contains(&(*cookie).evtype)
                            && (xi.get)(self.dpy, cookie) != 0
                        {
                            let (mut root, mut child, mut rx, mut ry, mut x, mut y, mut mask) =
                                (0, 0, 0, 0, 0, 0, 0);
                            (self.api.query_pointer)(
                                self.dpy, self.root, &mut root, &mut child, &mut rx, &mut ry,
                                &mut x, &mut y, &mut mask,
                            );
                            let release = (*cookie).evtype == 16
                                && self.target_gesture
                                && mask & ((1 << 8) | (1 << 9) | (1 << 10)) == 0;
                            (xi.free)(self.dpy, cookie);
                            if release {
                                self.target_gesture = false;
                                xi.select(self.dpy, self.root, self.raw_pointer, false);
                                events.push(Event::GeometryEnd);
                                self.follow_position();
                                events.push(Event::Expose);
                            } else if self.raw_pointer {
                                events.push(Event::Move {
                                    x: rx - self.position.0,
                                    y: ry - self.position.1,
                                });
                            }
                        }
                    }
                }
                if self.saver.as_ref().is_some_and(|s| s.event == ev.kind) {
                    events.push(Event::Away(self.away()));
                }
                if route == crate::linux_model::X11EventRoute::Pick {
                    let mut pick = std::mem::take(&mut self.pick);
                    match ev.kind {
                        6 => pick.motion(self, ev.pointer.root_x, ev.pointer.root_y),
                        4 => {
                            if let Some(class) =
                                pick.click(self, ev.pointer.root_x, ev.pointer.root_y)
                            {
                                self.follow = Some(format!("{}\0{}", class.instance, class.class));
                                self.followed = 0;
                                self.manual = None;
                                self.find_follow();
                                events.push(Event::PickedClass(class));
                            }
                        }
                        2 => {
                            if (self.api.lookup)(&mut ev, 0) == 0xff1b {
                                pick.cancel(self);
                            }
                        }
                        _ => {}
                    }
                    self.pick = pick;
                    continue;
                }
                match ev.kind {
                    2 if ev.any.window == self.window => {
                        let mut symbol = (self.api.lookup)(&mut ev, 0);
                        let mut input = [0u8; 4096];
                        let mut status = 0;
                        let length = if self.xic.is_null() {
                            0
                        } else {
                            (self.api.utf8)(
                                self.xic,
                                &mut ev,
                                input.as_mut_ptr().cast(),
                                input.len() as i32,
                                &mut symbol,
                                &mut status,
                            )
                        };
                        match symbol {
                            0xff1b => events.push(Event::Escape),
                            0xff09 => events.push(Event::Tab {
                                reverse: ev.pointer.state & 1 != 0,
                            }),
                            0xff0d | 0xff8d => events.push(Event::KeyEnter),
                            0xff08 => events.push(Event::Backspace),
                            0xff51 => events.push(Event::KeyInput(crate::ui::Key::Left)),
                            0xff53 => events.push(Event::KeyInput(crate::ui::Key::Right)),
                            0xff50 => events.push(Event::KeyInput(crate::ui::Key::Home)),
                            0xff57 => events.push(Event::KeyInput(crate::ui::Key::End)),
                            0xffff => events.push(Event::KeyInput(crate::ui::Key::Delete)),
                            _ => {
                                if length > 0 && length < input.len() as i32 {
                                    if let Ok(s) = std::str::from_utf8(&input[..length as usize]) {
                                        if !s.chars().any(char::is_control) {
                                            events.push(Event::Text(s.into()));
                                        }
                                    }
                                } else if self.xic.is_null() {
                                    let code = if symbol & 0xff000000 == 0x01000000 {
                                        symbol & 0x00ffffff
                                    } else {
                                        symbol
                                    };
                                    if let Some(ch) =
                                        char::from_u32(code as u32).filter(|c| !c.is_control())
                                    {
                                        events.push(Event::Text(ch.to_string()));
                                    }
                                }
                            }
                        }
                    }
                    4 if ev.any.window == self.window => {
                        let p = ev.pointer;
                        if p.button == 1 {
                            (self.api.grab)(
                                self.dpy,
                                self.window,
                                0,
                                (1 << 3) | (1 << 6),
                                1,
                                1,
                                0,
                                0,
                                p.time,
                            );
                            self.press = Some((p.root_x, p.root_y, p.x, p.y));
                            events.push(Event::Down {
                                x: p.x,
                                y: p.y,
                                alternate: p.state & (1 << 3) != 0,
                            });
                        } else if p.button == 3 {
                            events.push(Event::Context);
                        }
                    }
                    5 if ev.any.window == self.window => {
                        (self.api.ungrab)(self.dpy, ev.pointer.time);
                        self.press = None;
                        events.push(Event::Up);
                    }
                    6 if ev.any.window == self.window => {
                        let p = ev.pointer;
                        let (x, y) = self
                            .press
                            .map(|(rx, ry, x, y)| (x + p.root_x - rx, y + p.root_y - ry))
                            .unwrap_or((p.x, p.y));
                        events.push(Event::Move { x, y });
                    }
                    7 if ev.any.window == self.window => events.push(Event::Enter),
                    8 if ev.any.window == self.window => events.push(Event::Leave),
                    12 if ev.any.window == self.window => events.push(Event::Expose),
                    17 => {
                        if ev.configure.window == self.followed {
                            self.followed = 0;
                            self.offset = None;
                        }
                    }
                    19 | 16 => {
                        self.find_follow();
                        self.activation(&mut events);
                        (self.api.raise)(self.dpy, self.window);
                    }
                    22 if ev.configure.window == self.followed => {
                        let down = self.buttons_down();
                        if down && !self.target_gesture {
                            self.target_gesture = true;
                            if let Some(xi) = &self.xi {
                                xi.select(self.dpy, self.root, self.raw_pointer, true);
                            }
                            let (sx, sy, w, h) = self.sprite;
                            events.push(Event::GeometryBegin([
                                (self.rest_position.0 + sx) as f64 + w as f64 / 2.,
                                -((self.rest_position.1 + sy) as f64 + h as f64),
                            ]));
                        } else if !down && self.target_gesture {
                            self.target_gesture = false;
                            events.push(Event::GeometryEnd);
                        }
                        self.follow_position();
                        events.push(Event::Geometry([
                            self.position.0 as f64
                                + self.sprite.0 as f64
                                + self.sprite.2 as f64 / 2.,
                            -(self.position.1 as f64 + self.sprite.1 as f64 + self.sprite.3 as f64),
                        ]));
                        events.push(Event::Expose);
                    }
                    28 if ev.any.window == self.root && ev.property.atom == self.active_atom => {
                        self.activation(&mut events)
                    }
                    28 if ev.any.window == self.root
                        && [self.workarea_atom, self.desktop_atom].contains(&ev.property.atom) =>
                    {
                        self.refresh_area();
                        self.follow_position();
                        events.push(Event::Expose);
                    }
                    22 if ev.configure.window != self.window
                        && ![self.pages_window, self.outline_window, self.tip_window]
                            .contains(&ev.configure.window) =>
                    {
                        (self.api.raise)(self.dpy, self.window);
                        if self.pages_window != 0 {
                            (self.api.raise)(self.dpy, self.pages_window);
                        }
                    }
                    _ => {}
                }
            }
            (self.api.flush)(self.dpy);
        }
        Ok(events)
    }
    fn present(&mut self, canvas: &Canvas) -> Result<(), Error> {
        self.prepare_canvas(canvas)?;
        let mut bytes = argb32(&canvas.pixels);
        let clip = self.occluding_host.and_then(|host| {
            crate::linux_model::host_clip(
                host,
                [self.position.0 as f64, self.position.1 as f64],
                [canvas.width as f64, canvas.height as f64],
            )
        });
        let visible = |x: i32, y: i32| {
            canvas.hit_test(x, y)
                && !clip.is_some_and(|r| {
                    (x as f64) >= r.x
                        && (x as f64) < r.right()
                        && (y as f64) >= r.y
                        && (y as f64) < r.bottom()
                })
        };
        if let Some(clip) = clip {
            for y in
                clip.y.floor().max(0.) as u32..clip.bottom().ceil().min(canvas.height as f64) as u32
            {
                for x in clip.x.floor().max(0.) as u32
                    ..clip.right().ceil().min(canvas.width as f64) as u32
                {
                    let at = ((y * canvas.width + x) * 4) as usize;
                    bytes[at..at + 4].fill(0);
                }
            }
        }
        unsafe {
            let data = libc::malloc(bytes.len()).cast::<c_char>();
            if data.is_null() {
                return Err("Cannot allocate X11 picture".into());
            }
            ptr::copy_nonoverlapping(bytes.as_ptr(), data.cast(), bytes.len());
            let image = (self.api.create_image)(
                self.dpy,
                self.visual,
                32,
                2,
                0,
                data,
                canvas.width,
                canvas.height,
                32,
                canvas.width as i32 * 4,
            );
            if image.is_null() {
                libc::free(data.cast());
                return Err("Cannot create X11 image".into());
            }
            (self.api.put_image)(
                self.dpy,
                self.window,
                self.gc,
                image,
                0,
                0,
                0,
                0,
                canvas.width,
                canvas.height,
            );
            (self.api.destroy_image)(image);
            self.alpha.clear();
            for y in 0..canvas.height as i32 {
                let mut x = 0;
                while x < canvas.width as i32 {
                    if !visible(x, y) {
                        x += 1;
                        continue;
                    }
                    let start = x;
                    while x < canvas.width as i32 && visible(x, y) {
                        x += 1;
                    }
                    self.alpha.push(Rectangle {
                        x: start as i16,
                        y: y as i16,
                        width: (x - start) as u16,
                        height: 1,
                    });
                }
            }
            if let Some(rect) = self.menu {
                self.alpha.push(rect);
            }
            (self.api.shape)(
                self.dpy,
                self.window,
                2,
                0,
                0,
                self.alpha.as_mut_ptr(),
                self.alpha.len() as i32,
                0,
                0, // Unsorted: the menu rectangle can overlap sprite rows.
            );
            (self.api.map)(self.dpy, self.window);
            self.present_front_pages(canvas, clip)?;
            (self.api.flush)(self.dpy);
        }
        Ok(())
    }
    fn drag(&mut self, dx: i32, dy: i32) -> Result<(), Error> {
        self.place_mode = crate::motion::PlaceMode::Carried;
        self.restored_anchor = None;
        self.offset = None;
        self.position.0 += dx;
        self.position.1 += dy;
        self.refresh_area();
        self.manual = Some((
            ((self.position.0 + self.sprite.0) as f64 - self.monitor.x)
                / (self.monitor.width - self.sprite.2 as f64).max(1.),
            ((self.position.1 + self.sprite.1) as f64 - self.visible.y)
                / (self.monitor.bottom() - self.visible.y - self.sprite.3 as f64).max(1.),
        ));
        self.place();
        if let Some((x, y, w, h)) = self.followed_rect().filter(|(x, y, w, h)| {
            self.position.0 + self.sprite.0 + self.sprite.2 as i32 >= x - 48
                && self.position.0 + self.sprite.0 <= x + *w as i32 + 48
                && self.position.1 + self.sprite.1 + self.sprite.3 as i32 >= y - 48
                && self.position.1 + self.sprite.1 <= y + *h as i32 + 48
        }) {
            self.manual = None;
            self.offset = Some((
                self.position.0 + self.sprite.0 - x - w as i32,
                self.position.1 + self.sprite.1 - y - h as i32,
            ));
        }
        Ok(())
    }
    fn prepare_canvas(&mut self, canvas: &Canvas) -> Result<(), Error> {
        if let Some(frame) = self.panel_frame {
            self.size = (canvas.width, canvas.height);
            self.position = (frame.x as i32, frame.y as i32);
            unsafe {
                (self.api.move_resize)(
                    self.dpy,
                    self.window,
                    self.position.0,
                    self.position.1,
                    canvas.width,
                    canvas.height,
                );
            }
            return Ok(());
        }
        let old_size = self.size;
        self.size = (canvas.width, canvas.height);
        if canvas.sprite_bounds.2 > 0 {
            self.sprite = canvas.sprite_bounds;
        }
        if old_size != self.size {
            self.refresh_area();
            if let Some((x, y)) = self.manual {
                self.position = (
                    (self.monitor.x + x * (self.monitor.width - self.sprite.2 as f64).max(0.))
                        as i32
                        - self.sprite.0,
                    (self.visible.y
                        + y * (self.monitor.bottom() - self.visible.y - self.sprite.3 as f64)
                            .max(0.)) as i32
                        - self.sprite.1,
                );
                self.place();
            } else if self.followed != 0 {
                self.follow_position();
            } else {
                self.position = (
                    self.visible.right() as i32 - self.sprite.0 - self.sprite.2 as i32 - 12,
                    self.visible.bottom() as i32 - self.sprite.1 - self.sprite.3 as i32 - 12,
                );
                self.place();
            }
        }
        Ok(())
    }
    fn viewport(&self, canvas: &Canvas) -> (i32, i32, u32, u32) {
        let x = (self.visible.x as i32 - self.position.0).max(0);
        let y = (self.visible.y as i32 - self.position.1).max(0);
        let right = (self.visible.right() as i32 - self.position.0).min(canvas.width as i32);
        let bottom = (self.visible.bottom() as i32 - self.position.1).min(canvas.height as i32);
        (x, y, (right - x).max(0) as u32, (bottom - y).max(0) as u32)
    }
    fn menu(&mut self, bounds: Option<(i32, i32, u32, u32)>) {
        self.menu = bounds.map(|(x, y, w, h)| Rectangle {
            x: x as i16,
            y: y as i16,
            width: w as u16,
            height: h as u16,
        });
    }
    fn restore_position(&mut self, fractions: (f64, f64)) {
        self.manual = Some(fractions);
    }
    fn manual_position(&self) -> Option<(f64, f64)> {
        self.manual
    }
    fn window_anchor(&self) -> Option<(String, f64, f64)> {
        self.restored_anchor.clone().or_else(|| {
            self.offset
                .map(|(dx, dy)| ("bottomRight".into(), dx as f64, dy as f64))
        })
    }
    fn restore_window_anchor(&mut self, anchor: (String, f64, f64)) {
        self.restored_anchor = Some(anchor);
        self.manual = None;
    }
    fn away(&self) -> bool {
        (self.followed != 0 && !self.is_active())
            || self.saver.as_ref().is_some_and(|s| unsafe {
                let mut info = SaverInfo::default();
                (s.query)(self.dpy, self.root, &mut info) != 0
                    && (info.state == 1 || info.idle >= 60_000)
            })
    }
    fn pointer_line(&mut self, visible: bool) {
        if self.raw_pointer != visible {
            self.raw_pointer = visible;
            if let Some(xi) = &self.xi {
                xi.select(self.dpy, self.root, visible, self.target_gesture);
            }
        }
    }
    fn set_contrast(&mut self, on: bool) {
        self.contrast = on;
    }
    fn set_focus(&mut self, focus: bool) {
        if focus != self.focused {
            self.focused = focus;
            unsafe {
                if focus {
                    self.previous_focus = self.active_window();
                }
                (self.api.focus)(
                    self.dpy,
                    if focus {
                        self.window
                    } else {
                        self.previous_focus.max(1)
                    },
                    1,
                    0,
                );
                if !self.xic.is_null() {
                    if focus {
                        (self.api.ic_focus)(self.xic);
                    } else {
                        (self.api.ic_unfocus)(self.xic);
                    }
                }
            }
        }
    }
    fn place_panel(&mut self, frame: crate::motion::ScreenRect) {
        self.panel_frame = Some(frame);
    }
    fn panel_target(
        &self,
    ) -> Option<(
        crate::motion::ScreenRect,
        crate::motion::ScreenRect,
        crate::motion::PlaceMode,
    )> {
        use crate::motion::{PlaceMode, ScreenRect};
        let (sx, sy, w, h) = self.sprite;
        let sprite = ScreenRect {
            x: (self.position.0 + sx) as f64,
            y: (self.position.1 + sy) as f64,
            width: w as f64,
            height: h as f64,
        };
        let mode = if self.manual.is_some() {
            PlaceMode::Manual
        } else if let Some((x, y, w, h)) = self.followed_rect() {
            if sprite.y + sprite.height <= y as f64 + 5. {
                PlaceMode::Ledge
            } else if sprite.x >= x as f64 + w as f64 {
                PlaceMode::BesideRight
            } else if sprite.x + sprite.width <= x as f64 {
                PlaceMode::BesideLeft
            } else if sprite.y >= y as f64 + h as f64 {
                PlaceMode::Below
            } else {
                PlaceMode::Free
            }
        } else {
            PlaceMode::Corner
        };
        Some((
            sprite,
            ScreenRect {
                x: self.visible.x,
                y: self.visible.y,
                width: self.visible.width,
                height: self.visible.height,
            },
            mode,
        ))
    }
    fn start_pick(&mut self, help: &str, lang: &str) -> bool {
        self.pick_help = help.into();
        self.pick_lang = lang.into();
        let mut pick = std::mem::take(&mut self.pick);
        let started = pick.begin(self);
        self.pick = pick;
        started
    }
    fn restore_follow(&mut self, instance: &str, class: &str) {
        self.follow = Some(format!("{instance}\0{class}"));
        self.followed = 0;
        self.find_follow();
    }
    fn stop_follow(&mut self) {
        let mut pick = std::mem::take(&mut self.pick);
        pick.cancel(self);
        self.pick = pick;
        self.follow = None;
        self.followed = 0;
        self.home();
    }
    fn following(&self) -> bool {
        self.follow.is_some()
    }
    fn back_available(&self) -> bool {
        self.followed != 0
    }
    fn back_window(&mut self) {
        if self.followed == 0 {
            return;
        }
        // EWMH application activation; only an identifier is sent, never a title is read.
        let mut ev = XEvent { pad: [0; 24] };
        unsafe {
            let raw = &mut ev as *mut XEvent as *mut c_long;
            // XClientMessageEvent layout: kind/serial/send/display/window/message_type/format/data.
            let message = raw.cast::<ClientMessage>();
            (*message).kind = 33;
            (*message).display = self.dpy;
            (*message).window = self.followed;
            (*message).message_type = self.active_atom;
            (*message).format = 32;
            (*message).data = [1, 0, 0, 0, 0];
            (self.api.send)(self.dpy, self.root, 0, (1 << 19) | (1 << 20), &mut ev);
            (self.api.flush)(self.dpy);
        }
    }
    fn home(&mut self) {
        self.manual = None;
        self.offset = None;
        self.restored_anchor = None;
        self.retained = None;
        self.target_gesture = false;
        self.refresh_area();
        if self.followed != 0 {
            self.follow_position();
        } else {
            self.place_mode = crate::motion::PlaceMode::Corner;
            self.position = (
                self.visible.right() as i32 - self.sprite.0 - self.sprite.2 as i32 - 12,
                self.visible.bottom() as i32 - self.sprite.1 - self.sprite.3 as i32 - 12,
            );
            self.place();
        }
    }
    fn finish_drag(&mut self) {
        self.place_mode = crate::motion::PlaceMode::Manual;
    }
}
#[repr(C)]
struct MonitorInfo {
    name: c_ulong,
    primary: c_int,
    automatic: c_int,
    noutput: c_int,
    x: c_int,
    y: c_int,
    width: c_int,
    height: c_int,
    mwidth: c_int,
    mheight: c_int,
    outputs: *mut c_ulong,
}
struct RandR {
    _lib: Library,
    event: c_int,
    get: unsafe extern "C" fn(Dpy, Window, c_int, *mut c_int) -> *mut MonitorInfo,
    free: unsafe extern "C" fn(*mut MonitorInfo),
    update: unsafe extern "C" fn(*mut XEvent) -> c_int,
}
impl RandR {
    fn new(dpy: Dpy, root: Window) -> Result<Self, Error> {
        let l = Library::open("libXrandr.so.2")?;
        unsafe {
            let query: unsafe extern "C" fn(Dpy, *mut c_int, *mut c_int) -> c_int =
                l.symbol("XRRQueryExtension")?;
            let version: unsafe extern "C" fn(Dpy, *mut c_int, *mut c_int) -> c_int =
                l.symbol("XRRQueryVersion")?;
            let select: unsafe extern "C" fn(Dpy, Window, c_int) = l.symbol("XRRSelectInput")?;
            let (mut event, mut error, mut major, mut minor) = (0, 0, 0, 0);
            if query(dpy, &mut event, &mut error) == 0
                || version(dpy, &mut major, &mut minor) == 0
                || (major, minor) < (1, 5)
            {
                return Err("RandR monitor API not offered".into());
            }
            select(dpy, root, 1 | 2 | 4 | 8);
            Ok(Self {
                event,
                get: l.symbol("XRRGetMonitors")?,
                free: l.symbol("XRRFreeMonitors")?,
                update: l.symbol("XRRUpdateConfiguration")?,
                _lib: l,
            })
        }
    }
    fn monitors(&self, dpy: Dpy, root: Window) -> Vec<(Area, bool)> {
        unsafe {
            let mut n = 0;
            let p = (self.get)(dpy, root, 1, &mut n);
            if p.is_null() || n <= 0 {
                return vec![];
            }
            let out = std::slice::from_raw_parts(p, n as usize)
                .iter()
                .filter(|m| m.width > 0 && m.height > 0)
                .map(|m| {
                    (
                        Area::new(m.x as f64, m.y as f64, m.width as f64, m.height as f64),
                        m.primary != 0,
                    )
                })
                .collect();
            (self.free)(p);
            out
        }
    }
}
impl Drop for Native {
    fn drop(&mut self) {
        let mut pick = std::mem::take(&mut self.pick);
        pick.cancel(self);
        unsafe {
            self.clear_front_pages();
            if !self.xic.is_null() {
                (self.api.destroy_ic)(self.xic);
            }
            if !self.xim.is_null() {
                (self.api.close_im)(self.xim);
            }
            (self.api.free_gc)(self.dpy, self.gc);
            (self.api.destroy_window)(self.dpy, self.window);
            (self.api.free_colormap)(self.dpy, self.colormap);
            (self.api.close)(self.dpy);
        }
    }
}

#[repr(C)]
struct ClientMessage {
    kind: c_int,
    serial: c_ulong,
    send_event: c_int,
    display: Dpy,
    window: Window,
    message_type: c_ulong,
    format: c_int,
    data: [c_long; 5],
}
impl Native {
    fn clear_front_pages(&mut self) {
        if self.pages_window != 0 {
            unsafe {
                (self.api.destroy_window)(self.dpy, self.pages_window);
            }
            self.pages_window = 0;
        }
    }
    fn present_front_pages(
        &mut self,
        canvas: &Canvas,
        parent_clip: Option<Area>,
    ) -> Result<(), Error> {
        let pixels = (self.followed != 0
            && self.panel_frame.is_none()
            && canvas.pixels.chunks_exact(4).any(|pixel| pixel[3] != 0)
            && self.place_mode == crate::motion::PlaceMode::Ledge)
            .then(|| {
                let pages = canvas.front_pages.as_ref()?;
                if pages.width != canvas.width || pages.height != canvas.height {
                    return None;
                }
                let host = self.host_rect()?;
                let clip = crate::linux_model::host_clip(
                    host,
                    [self.position.0 as f64, self.position.1 as f64],
                    [canvas.width as f64, canvas.height as f64],
                )?
                .intersection(parent_clip?)?;
                crate::linux_model::front_page_pixels(
                    &pages.pixels,
                    canvas.width,
                    canvas.height,
                    clip,
                )
            })
            .flatten();
        let Some(pixels) = pixels else {
            self.pages_gate.ready(false);
            self.clear_front_pages();
            return Ok(());
        };
        if !self.pages_gate.ready(true) {
            return Ok(());
        }
        if self.pages_window == 0 {
            self.pages_window = self.overlay();
            if self.pages_window == 0 {
                self.pages_gate.failed();
                // The approved fallback lets pages pass behind the edge.
                return Ok(());
            }
        }
        let mut pages = canvas.front_pages.as_ref().unwrap().as_ref().clone();
        pages.pixels = pixels;
        if !self.overlay_paint(self.pages_window, &pages, self.position.0, self.position.1) {
            self.pages_gate.failed();
            self.clear_front_pages();
            return Ok(());
        }
        Ok(())
    }
    fn overlay(&self) -> Window {
        let mut attr = Attributes {
            colormap: self.colormap,
            override_redirect: 1,
            ..Default::default()
        };
        unsafe {
            let w = (self.api.create_window)(
                self.dpy,
                self.root,
                0,
                0,
                1,
                1,
                0,
                32,
                1,
                self.visual,
                // ARGB children need explicit transparent background/border;
                // CWOverrideRedirect is bit 9, not the event-mask bit 11.
                (1 << 1) | (1 << 3) | (1 << 9) | (1 << 13),
                &mut attr,
            );
            // ShapeInput with no rectangles makes the whole overlay pass clicks through.
            if w != 0 {
                (self.api.shape)(self.dpy, w, 2, 0, 0, ptr::null_mut(), 0, 0, 0);
            }
            w
        }
    }
    fn overlay_paint(&self, window: Window, canvas: &Canvas, x: i32, y: i32) -> bool {
        let bytes = argb32(&canvas.pixels);
        unsafe {
            (self.api.move_resize)(self.dpy, window, x, y, canvas.width, canvas.height);
            let data = libc::malloc(bytes.len()).cast::<c_char>();
            if data.is_null() {
                return false;
            }
            ptr::copy_nonoverlapping(bytes.as_ptr(), data.cast(), bytes.len());
            let image = (self.api.create_image)(
                self.dpy,
                self.visual,
                32,
                2,
                0,
                data,
                canvas.width,
                canvas.height,
                32,
                canvas.width as i32 * 4,
            );
            if image.is_null() {
                libc::free(data.cast());
                return false;
            }
            let gc = (self.api.create_gc)(self.dpy, window, 0, ptr::null_mut());
            (self.api.map)(self.dpy, window);
            (self.api.raise)(self.dpy, window);
            (self.api.put_image)(
                self.dpy,
                window,
                gc,
                image,
                0,
                0,
                0,
                0,
                canvas.width,
                canvas.height,
            );
            (self.api.destroy_image)(image);
            (self.api.free_gc)(self.dpy, gc);
        }
        true
    }
    fn rect_of(&self, window: Window) -> Option<Rect> {
        let (mut root, mut x, mut y, mut w, mut h, mut border, mut depth) = (0, 0, 0, 0, 0, 0, 0);
        unsafe {
            if (self.api.geometry)(
                self.dpy,
                window,
                &mut root,
                &mut x,
                &mut y,
                &mut w,
                &mut h,
                &mut border,
                &mut depth,
            ) == 0
            {
                return None;
            }
            let mut child = 0;
            (self.api.translate)(
                self.dpy, window, self.root, 0, 0, &mut x, &mut y, &mut child,
            );
        }
        Some(Rect {
            x,
            y,
            width: w,
            height: h,
        })
    }
}
impl PickDisplay for Native {
    fn begin(&mut self) -> bool {
        unsafe {
            self.pick_cursor = (self.api.font_cursor)(self.dpy, 60); // XC_hand2
            if (self.api.grab)(
                self.dpy,
                self.root,
                0,
                (1 << 2) | (1 << 6),
                1,
                1,
                0,
                self.pick_cursor,
                0,
            ) != 0
            {
                (self.api.free_cursor)(self.dpy, self.pick_cursor);
                self.pick_cursor = 0;
                return false;
            }
            if (self.api.grab_keyboard)(self.dpy, self.root, 0, 1, 1, 0) != 0 {
                (self.api.ungrab)(self.dpy, 0);
                (self.api.free_cursor)(self.dpy, self.pick_cursor);
                self.pick_cursor = 0;
                return false;
            }
        }
        true
    }
    fn candidate(&mut self, _x: i32, _y: i32) -> Option<(u64, Rect)> {
        let mut current = self.root;
        for _ in 0..8 {
            let (mut root, mut child, mut rx, mut ry, mut x, mut y, mut mask) =
                (0, 0, 0, 0, 0, 0, 0);
            unsafe {
                if (self.api.query_pointer)(
                    self.dpy, current, &mut root, &mut child, &mut rx, &mut ry, &mut x, &mut y,
                    &mut mask,
                ) == 0
                {
                    return None;
                }
            }
            if child == 0 {
                break;
            }
            if child == self.window {
                return self.rect_of(child).map(|r| (child as u64, r));
            }
            if child == self.outline_window
                || child == self.tip_window
                || child == self.pages_window
            {
                break;
            }
            current = child;
            if self.class_pair(current).is_some() {
                break;
            }
        }
        if current == self.root {
            None
        } else {
            self.rect_of(current).map(|r| (current as u64, r))
        }
    }
    fn is_companion(&self, window: u64) -> bool {
        [
            self.window,
            self.pages_window,
            self.outline_window,
            self.tip_window,
        ]
        .contains(&(window as Window))
    }
    fn wm_class(&mut self, window: u64) -> Option<WmClass> {
        self.class_pair(window as Window)
    }
    fn outline(&mut self, bounds: Option<Rect>) {
        if self.outline_window != 0 {
            unsafe {
                (self.api.destroy_window)(self.dpy, self.outline_window);
            }
            self.outline_window = 0;
        }
        let Some(r) = bounds else {
            return;
        };
        self.outline_window = self.overlay();
        let mut canvas = Canvas::blank(r.width, r.height);
        canvas.pixels = if self.contrast {
            crate::linux_model::outline_pixels_contrast(r.width, r.height)
        } else {
            crate::linux_model::outline_pixels(r.width, r.height)
        };
        self.overlay_paint(self.outline_window, &canvas, r.x, r.y);
    }
    fn tooltip(&mut self, point: Option<(i32, i32)>) {
        let scale = self.scale();
        self.pick_tooltip.update(point, scale);
        if self.tip_window != 0 {
            unsafe {
                (self.api.destroy_window)(self.dpy, self.tip_window);
            }
            self.tip_window = 0;
        }
        let Some((x, y)) = point else {
            return;
        };
        // Fixed typography, paper and spacing are the companion's existing paper label.
        let Ok(text) = super::text::Text::new() else {
            return;
        };
        let (logical_width, logical_height) = crate::linux_model::pick_tooltip_metrics(
            &self.pick_help,
            &self.pick_lang,
            scale,
        );
        let width = logical_width * scale;
        let height = logical_height * scale;
        let mut canvas = crate::linux_model::pick_tooltip_look(
            &self.pick_help,
            &self.pick_lang,
            width / scale,
            height / scale,
            scale,
            crate::contrast::Look::new(self.contrast, None),
        );
        let _ = text.paint(
            &mut canvas.pixels,
            canvas.width,
            canvas.height,
            &self.pick_help,
            &self.pick_lang,
            8. * scale,
            6. * scale,
            13. * scale,
            width,
            height,
        );
        self.tip_window = self.overlay();
        let monitors = self
            .randr
            .as_ref()
            .map_or_else(|| vec![], |r| r.monitors(self.dpy, self.root));
        let monitor = crate::linux_model::monitor_for(
            Area::new(x as f64, y as f64, 1., 1.),
            &monitors,
            Area::new(0., 0., self.screen.0 as f64, self.screen.1 as f64),
        );
        self.overlay_paint(
            self.tip_window,
            &canvas,
            (x + (12. * scale).round() as i32).clamp(
                monitor.x as i32,
                (monitor.right() as i32 - canvas.width as i32).max(monitor.x as i32),
            ),
            (y + (16. * scale).round() as i32).clamp(
                monitor.y as i32,
                (monitor.bottom() as i32 - canvas.height as i32).max(monitor.y as i32),
            ),
        );
    }
    fn end(&mut self) {
        unsafe {
            (self.api.ungrab)(self.dpy, 0);
            (self.api.ungrab_keyboard)(self.dpy, 0);
            if self.pick_cursor != 0 {
                (self.api.free_cursor)(self.dpy, self.pick_cursor);
                self.pick_cursor = 0;
            }
            (self.api.flush)(self.dpy);
        }
    }
}

#[repr(C)]
struct GenericCookie {
    kind: c_int,
    serial: c_ulong,
    send_event: c_int,
    display: Dpy,
    extension: c_int,
    evtype: c_int,
    cookie: c_uint,
    data: *mut c_void,
}
#[repr(C)]
struct XiMask {
    device: c_int,
    len: c_int,
    mask: *mut u8,
}
struct XInput {
    _lib: Library,
    opcode: c_int,
    choose: unsafe extern "C" fn(Dpy, Window, *mut XiMask, c_int) -> c_int,
    get: unsafe extern "C" fn(Dpy, *mut GenericCookie) -> c_int,
    free: unsafe extern "C" fn(Dpy, *mut GenericCookie),
}
impl XInput {
    fn new(dpy: Dpy, _root: Window) -> Result<Self, Error> {
        let l = Library::open("libXi.so.6")?;
        let x = Library::open("libX11.so.6")?;
        unsafe {
            let query: unsafe extern "C" fn(
                Dpy,
                *const c_char,
                *mut c_int,
                *mut c_int,
                *mut c_int,
            ) -> c_int = x.symbol("XQueryExtension")?;
            let (mut opcode, mut event, mut error) = (0, 0, 0);
            if query(
                dpy,
                c"XInputExtension".as_ptr(),
                &mut opcode,
                &mut event,
                &mut error,
            ) == 0
            {
                return Err("XInput2 not offered".into());
            }
            let version: unsafe extern "C" fn(Dpy, *mut c_int, *mut c_int) -> c_int =
                l.symbol("XIQueryVersion")?;
            let (mut major, mut minor) = (2, 0);
            if version(dpy, &mut major, &mut minor) != 0 {
                return Err("XInput2 version unavailable".into());
            }
            Ok(Self {
                opcode,
                choose: l.symbol("XISelectEvents")?,
                get: x.symbol("XGetEventData")?,
                free: x.symbol("XFreeEventData")?,
                _lib: l,
            })
        }
    }
    fn select(&self, dpy: Dpy, root: Window, on: bool, gesture: bool) {
        let mut bytes = [0u8; 3];
        if on {
            bytes[2] = 2;
        }
        if gesture {
            bytes[2] |= 1;
        }
        let mut mask = XiMask {
            device: 1,
            len: 3,
            mask: bytes.as_mut_ptr(),
        };
        unsafe {
            (self.choose)(dpy, root, &mut mask, 1);
        }
    }
}
#[repr(C)]
#[derive(Default)]
struct SaverInfo {
    window: Window,
    state: c_int,
    kind: c_int,
    until: c_ulong,
    idle: c_ulong,
    event_mask: c_ulong,
}
struct ScreenSaver {
    _lib: Library,
    event: c_int,
    query: unsafe extern "C" fn(Dpy, Window, *mut SaverInfo) -> c_int,
}
impl ScreenSaver {
    fn new(dpy: Dpy, root: Window) -> Result<Self, Error> {
        let l = Library::open("libXss.so.1")?;
        unsafe {
            let extension: unsafe extern "C" fn(Dpy, *mut c_int, *mut c_int) -> c_int =
                l.symbol("XScreenSaverQueryExtension")?;
            let (mut event, mut error) = (0, 0);
            if extension(dpy, &mut event, &mut error) == 0 {
                return Err("XScreenSaver not offered".into());
            }
            let select: unsafe extern "C" fn(Dpy, Window, c_ulong) =
                l.symbol("XScreenSaverSelectInput")?;
            select(dpy, root, 1);
            Ok(Self {
                event,
                query: l.symbol("XScreenSaverQueryInfo")?,
                _lib: l,
            })
        }
    }
}
