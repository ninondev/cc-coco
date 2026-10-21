//! xkbcommon consumes only this companion's Wayland keyboard events and keymap.
use super::{text::Library, Event};
use crate::Error;
use std::{
    ffi::{c_char, c_void, CString},
    ptr,
};
pub(super) struct Keyboard {
    _lib: Library,
    context: *mut c_void,
    keymap: *mut c_void,
    state: *mut c_void,
    new_map: unsafe extern "C" fn(*mut c_void, *const c_char, u32, u32) -> *mut c_void,
    new_state: unsafe extern "C" fn(*mut c_void) -> *mut c_void,
    unref_map: unsafe extern "C" fn(*mut c_void),
    unref_state: unsafe extern "C" fn(*mut c_void),
    unref_context: unsafe extern "C" fn(*mut c_void),
    symbol: unsafe extern "C" fn(*mut c_void, u32) -> u32,
    utf8: unsafe extern "C" fn(*mut c_void, u32, *mut c_char, usize) -> i32,
    mask: unsafe extern "C" fn(*mut c_void, u32, u32, u32, u32, u32, u32) -> u32,
    active_mod: unsafe extern "C" fn(*mut c_void, *const c_char, u32) -> i32,
}
impl Keyboard {
    pub fn new() -> Result<Self, Error> {
        let l = Library::open("libxkbcommon.so.0")?;
        unsafe {
            let create: unsafe extern "C" fn(u32) -> *mut c_void = l.symbol("xkb_context_new")?;
            let context = create(0);
            if context.is_null() {
                return Err("Cannot create keyboard map context".into());
            }
            Ok(Self {
                context,
                keymap: ptr::null_mut(),
                state: ptr::null_mut(),
                new_map: l.symbol("xkb_keymap_new_from_string")?,
                new_state: l.symbol("xkb_state_new")?,
                unref_map: l.symbol("xkb_keymap_unref")?,
                unref_state: l.symbol("xkb_state_unref")?,
                unref_context: l.symbol("xkb_context_unref")?,
                symbol: l.symbol("xkb_state_key_get_one_sym")?,
                utf8: l.symbol("xkb_state_key_get_utf8")?,
                mask: l.symbol("xkb_state_update_mask")?,
                active_mod: l.symbol("xkb_state_mod_name_is_active")?,
                _lib: l,
            })
        }
    }
    pub fn keymap(&mut self, text: &str) {
        let Ok(s) = CString::new(text.trim_end_matches('\0')) else {
            return;
        };
        unsafe {
            let map = (self.new_map)(self.context, s.as_ptr(), 1, 0);
            if map.is_null() {
                return;
            }
            let state = (self.new_state)(map);
            if state.is_null() {
                (self.unref_map)(map);
                return;
            }
            if !self.state.is_null() {
                (self.unref_state)(self.state);
            }
            if !self.keymap.is_null() {
                (self.unref_map)(self.keymap);
            }
            self.keymap = map;
            self.state = state;
        }
    }
    pub fn modifiers(&mut self, depressed: u32, latched: u32, locked: u32, group: u32) {
        if !self.state.is_null() {
            unsafe {
                (self.mask)(self.state, depressed, latched, locked, 0, 0, group);
            }
        }
    }
    pub fn key(&mut self, key: u32) -> Option<Event> {
        if self.state.is_null() {
            return None;
        }
        unsafe {
            let code = key + 8;
            match (self.symbol)(self.state, code) {
                0xff1b => Some(Event::Escape),
                0xff09 | 0xfe20 => Some(Event::Tab {
                    reverse: (self.active_mod)(self.state, c"Shift".as_ptr(), 1 << 3) != 0,
                }),
                0xff0d | 0xff8d => Some(Event::KeyEnter),
                0xff08 => Some(Event::Backspace),
                0xff51 => Some(Event::KeyInput(crate::ui::Key::Left)),
                0xff53 => Some(Event::KeyInput(crate::ui::Key::Right)),
                0xff50 => Some(Event::KeyInput(crate::ui::Key::Home)),
                0xff57 => Some(Event::KeyInput(crate::ui::Key::End)),
                0xffff => Some(Event::KeyInput(crate::ui::Key::Delete)),
                _ => {
                    let mut b = [0u8; 128];
                    let n = (self.utf8)(self.state, code, b.as_mut_ptr().cast(), b.len());
                    if n > 0 && n < (b.len() as i32) {
                        std::str::from_utf8(&b[..n as usize])
                            .ok()
                            .filter(|s| !s.chars().any(char::is_control))
                            .map(|s| Event::Text(s.into()))
                    } else {
                        None
                    }
                }
            }
        }
    }
}
impl Drop for Keyboard {
    fn drop(&mut self) {
        unsafe {
            if !self.state.is_null() {
                (self.unref_state)(self.state);
            }
            if !self.keymap.is_null() {
                (self.unref_map)(self.keymap);
            }
            (self.unref_context)(self.context);
        }
    }
}
