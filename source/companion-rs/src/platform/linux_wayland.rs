use super::{text::argb32, Display, Event};
use crate::{render::Canvas, Error};
use std::{
    fs::File,
    io::Read,
    os::fd::{AsFd, AsRawFd, FromRawFd},
    ptr,
};
use wayland_client::{
    protocol::{
        wl_buffer, wl_compositor, wl_keyboard, wl_output, wl_pointer, wl_region, wl_registry,
        wl_seat, wl_shm, wl_shm_pool, wl_surface,
    },
    Connection, Dispatch, EventQueue, Proxy, QueueHandle, WEnum,
};
use wayland_protocols::ext::idle_notify::v1::client::{
    ext_idle_notification_v1, ext_idle_notifier_v1,
};
use wayland_protocols::wp::text_input::zv3::client::{
    zwp_text_input_manager_v3, zwp_text_input_v3,
};
use wayland_protocols::xdg::shell::client::{xdg_surface, xdg_toplevel, xdg_wm_base};
use wayland_protocols_wlr::layer_shell::v1::client::{zwlr_layer_shell_v1, zwlr_layer_surface_v1};

#[derive(Default)]
struct State {
    compositor: Option<wl_compositor::WlCompositor>,
    shm: Option<wl_shm::WlShm>,
    shell: Option<xdg_wm_base::XdgWmBase>,
    layers: Option<zwlr_layer_shell_v1::ZwlrLayerShellV1>,
    seat: Option<wl_seat::WlSeat>,
    pointer: Option<wl_pointer::WlPointer>,
    keyboard: Option<wl_keyboard::WlKeyboard>,
    keymap: Option<super::keyboard::Keyboard>,
    input_manager: Option<zwp_text_input_manager_v3::ZwpTextInputManagerV3>,
    input: Option<zwp_text_input_v3::ZwpTextInputV3>,
    owned_surface: Option<wl_surface::WlSurface>,
    input_entered: bool,
    input_enabled: bool,
    input_active: bool,
    input_field: String,
    input_cursor: usize,
    input_caret: (i32, i32, i32, i32),
    input_serial: u32,
    input_batch: crate::linux_model::ImeBatch,
    input_cause: bool,
    idle_notifier: Option<ext_idle_notifier_v1::ExtIdleNotifierV1>,
    idle_notification: Option<ext_idle_notification_v1::ExtIdleNotificationV1>,
    away: bool,
    output: Option<wl_output::WlOutput>,
    events: Vec<Event>,
    configured: bool,
    busy: [bool; 2],
    redraw_pending: bool,
    point: (i32, i32),
    serial: u32,
    scale: i32,
    screen: (i32, i32),
    output_origin: (i32, i32),
    margins: (i32, i32),
    pointer_down: bool,
    drag_origin: (i32, i32),
    drag_offset: (i32, i32),
    generation: u64,
    released: Vec<(u64, usize)>,
}
impl Dispatch<wl_registry::WlRegistry, ()> for State {
    fn event(
        state: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global {
            name,
            interface,
            version,
        } = event
        {
            match interface.as_str() {
                "wl_compositor" => {
                    state.compositor = Some(registry.bind(name, version.min(4), qh, ()))
                }
                "ext_idle_notifier_v1" => {
                    state.idle_notifier = Some(registry.bind(name, version.min(1), qh, ()))
                }
                "zwp_text_input_manager_v3" => {
                    state.input_manager = Some(registry.bind(name, version.min(1), qh, ()))
                }
                "wl_shm" => state.shm = Some(registry.bind(name, 1, qh, ())),
                "xdg_wm_base" => state.shell = Some(registry.bind(name, version.min(2), qh, ())),
                "zwlr_layer_shell_v1" => {
                    state.layers = Some(registry.bind(name, version.min(4), qh, ()))
                }
                "wl_seat" if state.seat.is_none() => {
                    state.seat = Some(registry.bind(name, version.min(5), qh, ()))
                }
                "wl_output" if state.output.is_none() => {
                    state.output = Some(registry.bind(name, version.min(3), qh, ()))
                }
                _ => {}
            }
        }
    }
}
impl Dispatch<xdg_wm_base::XdgWmBase, ()> for State {
    fn event(
        _: &mut Self,
        p: &xdg_wm_base::XdgWmBase,
        e: xdg_wm_base::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_wm_base::Event::Ping { serial } = e {
            p.pong(serial);
        }
    }
}
impl Dispatch<xdg_surface::XdgSurface, ()> for State {
    fn event(
        s: &mut Self,
        p: &xdg_surface::XdgSurface,
        e: xdg_surface::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_surface::Event::Configure { serial } = e {
            p.ack_configure(serial);
            s.configured = true;
            s.events.push(Event::Expose);
        }
    }
}
impl Dispatch<xdg_toplevel::XdgToplevel, ()> for State {
    fn event(
        s: &mut Self,
        _: &xdg_toplevel::XdgToplevel,
        e: xdg_toplevel::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_toplevel::Event::Close = e {
            s.events.push(Event::Closed);
        }
    }
}
impl Dispatch<zwlr_layer_surface_v1::ZwlrLayerSurfaceV1, ()> for State {
    fn event(
        s: &mut Self,
        p: &zwlr_layer_surface_v1::ZwlrLayerSurfaceV1,
        e: zwlr_layer_surface_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match e {
            zwlr_layer_surface_v1::Event::Configure { serial, .. } => {
                p.ack_configure(serial);
                s.configured = true;
                s.events.push(Event::Expose);
            }
            zwlr_layer_surface_v1::Event::Closed => s.events.push(Event::Closed),
            _ => {}
        }
    }
}
#[derive(Clone, Copy)]
struct BufferId {
    generation: u64,
    slot: usize,
}
impl Dispatch<wl_buffer::WlBuffer, BufferId> for State {
    fn event(
        s: &mut Self,
        _: &wl_buffer::WlBuffer,
        e: wl_buffer::Event,
        id: &BufferId,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let wl_buffer::Event::Release = e {
            s.released.push((id.generation, id.slot));
            if id.generation != s.generation {
                return;
            }
            s.busy[id.slot] = false;
            if s.redraw_pending {
                s.redraw_pending = false;
                s.events.push(Event::Expose);
            }
        }
    }
}
impl Dispatch<wl_seat::WlSeat, ()> for State {
    fn event(
        s: &mut Self,
        p: &wl_seat::WlSeat,
        e: wl_seat::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let wl_seat::Event::Capabilities {
            capabilities: WEnum::Value(caps),
        } = e
        {
            if caps.contains(wl_seat::Capability::Keyboard) && s.keyboard.is_none() {
                s.keyboard = Some(p.get_keyboard(qh, ()));
                s.keymap = super::keyboard::Keyboard::new().ok();
            }
            if caps.contains(wl_seat::Capability::Pointer) && s.pointer.is_none() {
                s.pointer = Some(p.get_pointer(qh, ()));
            } else if !caps.contains(wl_seat::Capability::Pointer) {
                if let Some(pointer) = s.pointer.take() {
                    pointer.release();
                }
            }
        }
    }
}
impl Dispatch<wl_pointer::WlPointer, ()> for State {
    fn event(
        s: &mut Self,
        _: &wl_pointer::WlPointer,
        e: wl_pointer::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match e {
            wl_pointer::Event::Enter {
                surface_x,
                surface_y,
                ..
            } => {
                s.point = (surface_x as i32 * s.scale, surface_y as i32 * s.scale);
                s.events.push(Event::Enter);
            }
            wl_pointer::Event::Leave { .. } => s.events.push(Event::Leave),
            wl_pointer::Event::Motion {
                surface_x,
                surface_y,
                ..
            } => {
                s.point = (surface_x as i32 * s.scale, surface_y as i32 * s.scale);
                s.events.push(Event::Move {
                    x: s.point.0 + s.drag_offset.0,
                    y: s.point.1 + s.drag_offset.1,
                });
            }
            wl_pointer::Event::Button {
                serial,
                button: 0x110,
                state: WEnum::Value(state),
                ..
            } => {
                s.serial = serial;
                if state == wl_pointer::ButtonState::Pressed {
                    s.pointer_down = true;
                    s.drag_origin = s.point;
                    s.drag_offset = (0, 0);
                    s.events.push(Event::Down {
                        x: s.point.0,
                        y: s.point.1,
                        alternate: false,
                    });
                } else {
                    s.pointer_down = false;
                    s.events.push(Event::Up);
                }
            }
            wl_pointer::Event::Button {
                button: 0x111,
                state: WEnum::Value(wl_pointer::ButtonState::Pressed),
                ..
            } => s.events.push(Event::Context),
            _ => {}
        }
    }
}
impl Dispatch<wl_output::WlOutput, ()> for State {
    fn event(
        s: &mut Self,
        _: &wl_output::WlOutput,
        e: wl_output::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match e {
            wl_output::Event::Geometry { x, y, .. } => {
                s.output_origin = (x, y);
                s.events.push(Event::Expose);
            }
            wl_output::Event::Scale { factor } => {
                s.scale = factor.max(1);
                s.events.push(Event::Expose);
            }
            wl_output::Event::Mode {
                flags: WEnum::Value(flags),
                width,
                height,
                ..
            } if flags.contains(wl_output::Mode::Current) => {
                if s.screen != (width, height) {
                    s.screen = (width, height);
                    s.events.push(Event::Expose);
                }
            }
            _ => {}
        }
    }
}
macro_rules! ignore {($($t:ty),*)=>{$(impl Dispatch<$t,()> for State {
    fn event(_:&mut Self,_:&$t,_:<$t as Proxy>::Event,_:&(),_:&Connection,_:&QueueHandle<Self>) {}
})*};}
ignore!(
    wl_compositor::WlCompositor,
    wl_surface::WlSurface,
    wl_region::WlRegion,
    wl_shm::WlShm,
    wl_shm_pool::WlShmPool,
    zwlr_layer_shell_v1::ZwlrLayerShellV1
);

struct Pixels {
    ptr: *mut u8,
    len: usize,
    _file: File,
    pool: wl_shm_pool::WlShmPool,
    buffers: [wl_buffer::WlBuffer; 2],
    size: (u32, u32),
    generation: u64,
}
impl Drop for Pixels {
    fn drop(&mut self) {
        for buffer in &self.buffers {
            buffer.destroy();
        }
        self.pool.destroy();
        unsafe {
            libc::munmap(self.ptr.cast(), self.len);
        }
    }
}

pub(super) struct Native {
    connection: Connection,
    queue: EventQueue<State>,
    state: State,
    surface: wl_surface::WlSurface,
    layer: Option<zwlr_layer_surface_v1::ZwlrLayerSurfaceV1>,
    _xdg: Option<xdg_surface::XdgSurface>,
    toplevel: Option<xdg_toplevel::XdgToplevel>,
    pixels: Option<Pixels>,
    old_pixels: Vec<(Pixels, [bool; 2])>,
    moved: bool,
    menu: Option<(i32, i32, u32, u32)>,
    manual: Option<(f64, f64)>,
    sprite: (i32, i32, u32, u32),
    size: (u32, u32),
    panel_frame: Option<crate::motion::ScreenRect>,
    focused: bool,
    rest_margins: (i32, i32),
}
impl Native {
    pub fn new() -> Result<Self, Error> {
        let connection = Connection::connect_to_env()?;
        let mut queue = connection.new_event_queue();
        let qh = queue.handle();
        connection.display().get_registry(&qh, ());
        let mut state = State {
            scale: 1,
            margins: (12, 12),
            ..State::default()
        };
        queue.roundtrip(&mut state)?;
        queue.roundtrip(&mut state)?;
        if let (Some(notifier), Some(seat)) = (&state.idle_notifier, &state.seat) {
            state.idle_notification = Some(notifier.get_idle_notification(60_000, seat, &qh, ()));
        }
        let compositor = state
            .compositor
            .as_ref()
            .ok_or("Wayland compositor has no wl_compositor")?;
        if state.shm.is_none() {
            return Err("Wayland compositor has no shared-memory presentation support".into());
        }
        let surface = compositor.create_surface(&qh, ());
        state.owned_surface = Some(surface.clone());
        if let (Some(manager), Some(seat)) = (&state.input_manager, &state.seat) {
            state.input = Some(manager.get_text_input(seat, &qh, ()));
        }
        let (layer, xdg, toplevel) = if let Some(shell) = &state.layers {
            let layer = shell.get_layer_surface(
                &surface,
                state.output.as_ref(),
                zwlr_layer_shell_v1::Layer::Top,
                "coco-companion".into(),
                &qh,
                (),
            );
            layer.set_anchor(
                zwlr_layer_surface_v1::Anchor::Bottom | zwlr_layer_surface_v1::Anchor::Right,
            );
            layer.set_keyboard_interactivity(zwlr_layer_surface_v1::KeyboardInteractivity::None);
            layer.set_exclusive_zone(0);
            layer.set_margin(0, 12, 12, 0);
            layer.set_size(320, 256);
            (Some(layer), None, None)
        } else {
            let shell = state
                .shell
                .as_ref()
                .ok_or("Wayland compositor supports neither layer-shell nor xdg-shell")?;
            let xdg = shell.get_xdg_surface(&surface, &qh, ());
            let top = xdg.get_toplevel(&qh, ());
            top.set_title("Coco Pet".into());
            top.set_app_id("coco-companion".into());
            eprintln!("This Wayland compositor has no layer-shell. It chooses the initial position, stacking, decorations and focus of the transparent xdg window; drag it to the corner you prefer.");
            (None, Some(xdg), Some(top))
        };
        surface.commit();
        queue.roundtrip(&mut state)?;
        Ok(Self {
            connection,
            queue,
            state,
            surface,
            layer,
            _xdg: xdg,
            toplevel,
            pixels: None,
            old_pixels: Vec::new(),
            moved: false,
            menu: None,
            manual: None,
            sprite: (0, 0, 1, 1),
            size: (320, 256),
            panel_frame: None,
            focused: false,
            rest_margins: (12, 12),
        })
    }
    fn allocate(&self, size: (u32, u32)) -> Result<Pixels, Error> {
        let bytes = size.0 as usize * size.1 as usize * 4;
        let len = bytes.checked_mul(2).ok_or("Wayland picture is too large")?;
        let fd = unsafe {
            libc::memfd_create(c"coco-companion-pixels".as_ptr(), libc::MFD_CLOEXEC)
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let file = unsafe { File::from_raw_fd(fd) };
        if unsafe { libc::ftruncate(fd, len as libc::off_t) } < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let mapping = unsafe {
            libc::mmap(
                ptr::null_mut(),
                len,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                fd,
                0,
            )
        };
        if mapping == libc::MAP_FAILED {
            return Err(std::io::Error::last_os_error().into());
        }
        let qh = self.queue.handle();
        let pool = self
            .state
            .shm
            .as_ref()
            .unwrap()
            .create_pool(file.as_fd(), len as i32, &qh, ());
        let buffers = [0usize, 1].map(|slot| {
            pool.create_buffer(
                (slot * bytes) as i32,
                size.0 as i32,
                size.1 as i32,
                size.0 as i32 * 4,
                wl_shm::Format::Argb8888,
                &qh,
                BufferId {
                    generation: self.state.generation,
                    slot,
                },
            )
        });
        Ok(Pixels {
            ptr: mapping.cast(),
            len,
            _file: file,
            pool,
            buffers,
            size,
            generation: self.state.generation,
        })
    }
}
impl Display for Native {
    fn shed_context(&self) -> Option<(bool, f64, bool)> {
        if self.layer.is_none() || self.sprite.2 <= 1 || self.sprite.3 <= 1 {
            return None;
        }
        let scale = self.state.scale as f64;
        let (sx, sy, w, h) = self.sprite;
        let (x, y) = self.screen_origin();
        let right = self.state.output_origin.0 as f64 + self.state.screen.0 as f64 / scale;
        let bottom = self.state.output_origin.1 as f64 + self.state.screen.1 as f64 / scale;
        let sprite_right = x as f64 + (sx as f64 + w as f64) / scale;
        let sprite_bottom = y as f64 + (sy as f64 + h as f64) / scale;
        Some((
            false,
            (right - sprite_right).max(0.),
            sprite_bottom <= bottom && sprite_bottom > self.state.output_origin.1 as f64,
        ))
    }
    fn placement(&self) -> Option<super::Placement> {
        if self.layer.is_none() || self.panel_frame.is_some() {
            return None;
        }
        let scale = self.state.scale as f64;
        let (sx, sy, w, h) = self.sprite;
        let px = self.state.screen.0 as f64 / scale
            - self.size.0 as f64 / scale
            - self.rest_margins.0 as f64;
        let py = self.state.screen.1 as f64 / scale
            - self.size.1 as f64 / scale
            - self.rest_margins.1 as f64;
        Some(super::Placement {
            anchor: [
                self.state.output_origin.0 as f64 + px + sx as f64 / scale + w as f64 / scale / 2.,
                self.state.output_origin.1 as f64 + py + sy as f64 / scale + h as f64 / scale,
            ],
            ledge: false,
            room: 1.,
            horizontal: false,
            push: 0.,
            hidden: 0.,
        })
    }
    fn motion_anchor(&mut self, anchor: [f64; 2]) {
        if let Some(layer) = &self.layer {
            let scale = self.state.scale as f64;
            let (sx, sy, w, h) = self.sprite;
            let x = anchor[0]
                - self.state.output_origin.0 as f64
                - w as f64 / scale / 2.
                - sx as f64 / scale;
            let y = anchor[1] - self.state.output_origin.1 as f64 - (sy as f64 + h as f64) / scale;
            self.state.margins = (
                (self.state.screen.0 as f64 / scale - x - self.size.0 as f64 / scale).round()
                    as i32,
                (self.state.screen.1 as f64 / scale - y - self.size.1 as f64 / scale).round()
                    as i32,
            );
            layer.set_margin(0, self.state.margins.0, self.state.margins.1, 0);
            self.surface.commit();
        }
    }
    fn fd(&self) -> i32 {
        self.connection.backend().poll_fd().as_raw_fd()
    }
    fn scale(&self) -> f64 {
        self.state.scale as f64
    }
    fn events(&mut self) -> Result<Vec<Event>, Error> {
        self.queue.dispatch_pending(&mut self.state)?;
        self.connection.flush()?;
        // This is a nonblocking drain of already-delivered display events. The outer loop
        // performs the only wait and arms no periodic display/window-position check.
        if let Some(guard) = self.queue.prepare_read() {
            let mut fd = libc::pollfd {
                fd: self.fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            if unsafe { libc::poll(&mut fd, 1, 0) } > 0 {
                guard.read()?;
            }
        }
        self.queue.dispatch_pending(&mut self.state)?;
        for (generation, slot) in std::mem::take(&mut self.state.released) {
            for (pixels, busy) in &mut self.old_pixels {
                if pixels.generation == generation {
                    busy[slot] = false;
                }
            }
        }
        self.old_pixels.retain(|(_, busy)| busy.iter().any(|b| *b));
        if !self.state.pointer_down {
            self.moved = false;
        }
        Ok(std::mem::take(&mut self.state.events))
    }
    fn present(&mut self, canvas: &Canvas) -> Result<(), Error> {
        if !self.state.configured {
            self.state.redraw_pending = true;
            return Ok(());
        }
        if self
            .pixels
            .as_ref()
            .is_none_or(|p| p.size != (canvas.width, canvas.height))
        {
            let pixels = {
                self.state.generation += 1;
                self.allocate((canvas.width, canvas.height))?
            };
            if let Some(old) = self.pixels.replace(pixels) {
                // Keep mappings owned by the compositor until every attached old buffer
                // receives release; a new generation cannot clear a new buffer's busy bit.
                self.old_pixels.push((old, self.state.busy));
            }
            self.state.busy = [false; 2];
            self.surface.set_buffer_scale(self.state.scale);
            if let Some(layer) = &self.layer {
                layer.set_size(
                    canvas.width / self.state.scale as u32,
                    canvas.height / self.state.scale as u32,
                );
            }
            if let Some(top) = &self.toplevel {
                top.set_min_size(
                    (canvas.width / self.state.scale as u32) as i32,
                    (canvas.height / self.state.scale as u32) as i32,
                );
                top.set_max_size(
                    (canvas.width / self.state.scale as u32) as i32,
                    (canvas.height / self.state.scale as u32) as i32,
                );
            }
        }
        let Some(slot) = self.state.busy.iter().position(|busy| !*busy) else {
            self.state.redraw_pending = true;
            return Ok(());
        };
        let pixels = self.pixels.as_ref().unwrap();
        let bytes = argb32(&canvas.pixels);
        unsafe {
            ptr::copy_nonoverlapping(
                bytes.as_ptr(),
                pixels.ptr.add(slot * bytes.len()),
                bytes.len(),
            );
        }
        let qh = self.queue.handle();
        let region = self
            .state
            .compositor
            .as_ref()
            .unwrap()
            .create_region(&qh, ());
        let scale = self.state.scale;
        for y in 0..canvas.height as i32 / scale {
            let mut x = 0;
            while x < canvas.width as i32 / scale {
                if !canvas.hit_test(x * scale, y * scale) {
                    x += 1;
                    continue;
                }
                let start = x;
                while x < canvas.width as i32 / scale && canvas.hit_test(x * scale, y * scale) {
                    x += 1;
                }
                region.add(start, y, x - start, 1);
            }
        }
        if let Some((x, y, w, h)) = self.menu {
            region.add(x / scale, y / scale, w as i32 / scale, h as i32 / scale);
        }
        self.surface.set_input_region(Some(&region));
        region.destroy();
        self.surface.attach(Some(&pixels.buffers[slot]), 0, 0);
        self.surface
            .damage_buffer(0, 0, canvas.width as i32, canvas.height as i32);
        self.surface.commit();
        self.state.busy[slot] = true;
        self.connection.flush()?;
        Ok(())
    }
    fn drag(&mut self, dx: i32, dy: i32) -> Result<(), Error> {
        if let Some(layer) = &self.layer {
            let scale = self.state.scale;
            let (sx, sy, sw, sh) = self.sprite;
            let (w, h) = (self.size.0 as i32, self.size.1 as i32);
            let (extra_x, extra_y) = ((w - sx - sw as i32) / scale, (h - sy - sh as i32) / scale);
            self.state.margins.0 = (self.state.margins.0 - dx / scale).clamp(
                -extra_x,
                (self.state.screen.0 / scale - sw as i32 / scale - extra_x).max(-extra_x),
            );
            self.state.margins.1 = (self.state.margins.1 - dy / scale).clamp(
                -extra_y,
                (self.state.screen.1 / scale - sh as i32 / scale - extra_y).max(-extra_y),
            );
            self.state.drag_offset.0 += dx;
            self.state.drag_offset.1 += dy;
            layer.set_margin(0, self.state.margins.0, self.state.margins.1, 0);
            self.surface.commit();
        } else if !self.moved {
            if let (Some(top), Some(seat)) = (&self.toplevel, &self.state.seat) {
                top._move(seat, self.state.serial);
                self.moved = true;
            }
        }
        self.manual = self.manual_position();
        self.rest_margins = self.state.margins;
        self.connection.flush()?;
        Ok(())
    }
    fn away(&self) -> bool {
        self.state.away
    }
    fn set_focus(&mut self, focus: bool) {
        if self.focused == focus {
            return;
        }
        self.focused = focus;
        if let Some(layer) = &self.layer {
            layer.set_keyboard_interactivity(if focus {
                zwlr_layer_surface_v1::KeyboardInteractivity::OnDemand
            } else {
                zwlr_layer_surface_v1::KeyboardInteractivity::None
            });
            self.surface.commit();
        }
    }
    fn field_input(&mut self, enabled: bool, text: &str, cursor: usize, caret: crate::ui::Rect) {
        let rectangle = (
            caret.x.round() as i32,
            caret.y.round() as i32,
            caret.width.round() as i32,
            caret.height.round() as i32,
        );
        if self.state.input_enabled == enabled
            && self.state.input_field == text
            && self.state.input_cursor == cursor
            && self.state.input_caret == rectangle
        {
            return;
        }
        self.state.input_enabled = enabled;
        self.state.input_field = text.into();
        self.state.input_cursor = cursor;
        self.state.input_caret = rectangle;
        self.state.update_input();
    }
    fn screen_origin(&self) -> (i32, i32) {
        if self.layer.is_none() {
            return (0, 0);
        }
        let scale = self.state.scale;
        (
            self.state.output_origin.0
                + (self.state.screen.0 - self.size.0 as i32 - self.state.margins.0 * scale) / scale,
            self.state.output_origin.1
                + (self.state.screen.1 - self.size.1 as i32 - self.state.margins.1 * scale) / scale,
        )
    }
    fn screen_origin_known(&self) -> bool {
        // Layer-shell and xdg-shell do not report actual global surface coordinates.
        // Reserved compositor zones can offset an anchored layer from the predicted origin.
        false
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
        if self.layer.is_none() {
            return None;
        }
        use crate::motion::{PlaceMode, ScreenRect};
        let scale = self.state.scale as f64;
        let (x, y) = self.screen_origin();
        let (sx, sy, w, h) = self.sprite;
        Some((
            ScreenRect {
                x: x as f64 + sx as f64 / scale,
                y: y as f64 + sy as f64 / scale,
                width: w as f64 / scale,
                height: h as f64 / scale,
            },
            ScreenRect {
                x: self.state.output_origin.0 as f64,
                y: self.state.output_origin.1 as f64,
                width: self.state.screen.0 as f64 / scale,
                height: self.state.screen.1 as f64 / scale,
            },
            if self.manual.is_some() {
                PlaceMode::Manual
            } else {
                PlaceMode::Corner
            },
        ))
    }
    fn menu(&mut self, bounds: Option<(i32, i32, u32, u32)>) {
        self.menu = bounds;
    }
    fn manual_position(&self) -> Option<(f64, f64)> {
        if self.layer.is_none() || self.state.screen.0 <= 0 {
            return None;
        }
        let scale = self.state.scale as f64;
        let (sx, sy, w, h) = self.sprite;
        let extra_x = (self.size.0 as f64 - sx as f64 - w as f64) / scale;
        let extra_y = (self.size.1 as f64 - sy as f64 - h as f64) / scale;
        Some((
            1. - (self.state.margins.0 as f64 + extra_x)
                / ((self.state.screen.0 as f64 - w as f64) / scale).max(1.),
            1. - (self.state.margins.1 as f64 + extra_y)
                / ((self.state.screen.1 as f64 - h as f64) / scale).max(1.),
        ))
    }
    fn home(&mut self) {
        self.manual = None;
    }
    fn restore_position(&mut self, fractions: (f64, f64)) {
        self.manual = Some(fractions);
    }
    fn prepare_canvas(&mut self, canvas: &Canvas) -> Result<(), Error> {
        self.size = (canvas.width, canvas.height);
        if canvas.sprite_bounds.2 > 0 {
            self.sprite = canvas.sprite_bounds;
        }
        if let Some(layer) = &self.layer {
            let scale = self.state.scale as f64;
            if let Some(frame) = self.panel_frame {
                let margins = (
                    (self.state.output_origin.0 as f64 + self.state.screen.0 as f64 / scale
                        - frame.x
                        - canvas.width as f64 / scale) as i32,
                    (self.state.output_origin.1 as f64 + self.state.screen.1 as f64 / scale
                        - frame.y
                        - canvas.height as f64 / scale) as i32,
                );
                if self.state.margins != margins {
                    self.state.margins = margins;
                    layer.set_margin(0, margins.0, margins.1, 0);
                }
                return Ok(());
            }
            let (sx, sy, w, h) = self.sprite;
            let extra_x = (canvas.width as f64 - sx as f64 - w as f64) / scale;
            let extra_y = (canvas.height as f64 - sy as f64 - h as f64) / scale;
            let margins = if let Some((x, y)) = self.manual {
                (
                    ((1. - x) * (self.state.screen.0 as f64 - w as f64) / scale - extra_x) as i32,
                    ((1. - y) * (self.state.screen.1 as f64 - h as f64) / scale - extra_y) as i32,
                )
            } else {
                ((12. - extra_x) as i32, (12. - extra_y) as i32)
            };
            self.rest_margins = margins;
            if self.state.margins != margins {
                self.state.margins = margins;
                layer.set_margin(0, margins.0, margins.1, 0);
            }
        }
        Ok(())
    }
    fn viewport(&self, canvas: &Canvas) -> (i32, i32, u32, u32) {
        if self.layer.is_none() || self.state.screen.0 <= 0 {
            return (0, 0, canvas.width, canvas.height);
        }
        let scale = self.state.scale;
        let px = self.state.screen.0 - canvas.width as i32 - self.state.margins.0 * scale;
        let py = self.state.screen.1 - canvas.height as i32 - self.state.margins.1 * scale;
        let (x, y) = ((-px).max(0), (-py).max(0));
        let right = (self.state.screen.0 - px).min(canvas.width as i32);
        let bottom = (self.state.screen.1 - py).min(canvas.height as i32);
        (x, y, (right - x).max(0) as u32, (bottom - y).max(0) as u32)
    }
}

impl Dispatch<wl_keyboard::WlKeyboard, ()> for State {
    fn event(
        s: &mut Self,
        _: &wl_keyboard::WlKeyboard,
        e: wl_keyboard::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match e {
            wl_keyboard::Event::Keymap {
                format: WEnum::Value(wl_keyboard::KeymapFormat::XkbV1),
                fd,
                size,
            } => {
                let mut file = File::from(fd);
                let mut bytes = vec![];
                if file
                    .by_ref()
                    .take(size as u64)
                    .read_to_end(&mut bytes)
                    .is_ok()
                {
                    if let (Some(k), Ok(text)) = (&mut s.keymap, std::str::from_utf8(&bytes)) {
                        k.keymap(text);
                    }
                }
            }
            wl_keyboard::Event::Modifiers {
                mods_depressed,
                mods_latched,
                mods_locked,
                group,
                ..
            } => {
                if let Some(k) = &mut s.keymap {
                    k.modifiers(mods_depressed, mods_latched, mods_locked, group);
                }
            }
            wl_keyboard::Event::Key {
                key,
                state: WEnum::Value(wl_keyboard::KeyState::Pressed),
                ..
            } => {
                if let Some(k) = &mut s.keymap {
                    if let Some(event) = k.key(key) {
                        if !s.input_batch.composing {
                            s.events.push(event);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}
impl Dispatch<ext_idle_notifier_v1::ExtIdleNotifierV1, ()> for State {
    fn event(
        _: &mut Self,
        _: &ext_idle_notifier_v1::ExtIdleNotifierV1,
        _: ext_idle_notifier_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}
impl Dispatch<ext_idle_notification_v1::ExtIdleNotificationV1, ()> for State {
    fn event(
        s: &mut Self,
        _: &ext_idle_notification_v1::ExtIdleNotificationV1,
        e: ext_idle_notification_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match e {
            ext_idle_notification_v1::Event::Idled => {
                s.away = true;
                s.events.push(Event::Away(true));
            }
            ext_idle_notification_v1::Event::Resumed => {
                s.away = false;
                s.events.push(Event::Away(false));
            }
            _ => {}
        }
    }
}
impl State {
    fn update_input(&mut self) {
        let Some(input) = &self.input else {
            return;
        };
        let enabled = self.input_entered && self.input_enabled;
        if enabled {
            if !self.input_active {
                input.enable();
            }
            let cursor = self
                .input_field
                .char_indices()
                .nth(self.input_cursor)
                .map(|(i, _)| i)
                .unwrap_or(self.input_field.len());
            let mut start = cursor.saturating_sub(2000);
            while !self.input_field.is_char_boundary(start) {
                start += 1;
            }
            let mut end = (cursor + 2000).min(self.input_field.len());
            while !self.input_field.is_char_boundary(end) {
                end -= 1;
            }
            input.set_surrounding_text(
                self.input_field[start..end].into(),
                (cursor - start) as i32,
                (cursor - start) as i32,
            );
            input.set_text_change_cause(if self.input_cause {
                zwp_text_input_v3::ChangeCause::InputMethod
            } else {
                zwp_text_input_v3::ChangeCause::Other
            });
            input.set_content_type(
                zwp_text_input_v3::ContentHint::None,
                zwp_text_input_v3::ContentPurpose::Normal,
            );
            let (x, y, w, h) = self.input_caret;
            input.set_cursor_rectangle(x, y, w, h);
        } else if self.input_active {
            input.disable();
            self.input_batch = Default::default();
            self.events.push(Event::ImePreedit(String::new(), 0));
        }
        if enabled || self.input_active {
            input.commit();
            self.input_serial = self.input_serial.wrapping_add(1);
        }
        self.input_active = enabled;
        self.input_cause = false;
    }
}
impl Dispatch<zwp_text_input_manager_v3::ZwpTextInputManagerV3, ()> for State {
    fn event(
        _: &mut Self,
        _: &zwp_text_input_manager_v3::ZwpTextInputManagerV3,
        _: zwp_text_input_manager_v3::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}
impl Dispatch<zwp_text_input_v3::ZwpTextInputV3, ()> for State {
    fn event(
        s: &mut Self,
        _: &zwp_text_input_v3::ZwpTextInputV3,
        e: zwp_text_input_v3::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match e {
            zwp_text_input_v3::Event::Enter { surface } => {
                s.input_entered = s.owned_surface.as_ref() == Some(&surface);
                s.update_input();
            }
            zwp_text_input_v3::Event::Leave { .. } => {
                s.input_entered = false;
                s.update_input();
            }
            zwp_text_input_v3::Event::PreeditString {
                text, cursor_end, ..
            } => {
                let text = text.unwrap_or_default();
                let byte = (cursor_end.max(0) as usize).min(text.len());
                s.input_batch.preedit_cursor = text.get(..byte).map_or(0, |p| p.chars().count());
                s.input_batch.preedit = Some(text);
            }
            zwp_text_input_v3::Event::CommitString { text } => {
                s.input_batch.commit = Some(text.unwrap_or_default())
            }
            zwp_text_input_v3::Event::DeleteSurroundingText {
                before_length,
                after_length,
            } => s.input_batch.delete = (before_length, after_length),
            zwp_text_input_v3::Event::Done { serial } => {
                if s.input_active {
                    let preedit = (serial == s.input_serial)
                        .then(|| {
                            s.input_batch
                                .preedit
                                .clone()
                                .or_else(|| s.input_batch.commit.as_ref().map(|_| String::new()))
                        })
                        .flatten();
                    if let Some((field, cursor)) =
                        s.input_batch
                            .done(&s.input_field, s.input_cursor, s.input_serial, serial)
                    {
                        if field != s.input_field || cursor != s.input_cursor {
                            s.input_cause = true;
                            s.events.push(Event::ImeField(field, cursor));
                        }
                    }
                    if let Some(text) = preedit {
                        s.events
                            .push(Event::ImePreedit(text, s.input_batch.preedit_cursor));
                    }
                } else {
                    s.input_batch = Default::default();
                    s.events.push(Event::ImePreedit(String::new(), 0));
                }
            }
            _ => {}
        }
    }
}
