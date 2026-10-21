//! UI Automation projection of the single AccessKit tree. Requests return to the
//! window's message queue; an assistive technology thread never mutates UI state.
use accesskit::{Action, ActionData, ActionRequest, Node, NodeId, Role, TreeId, TreeUpdate};
#[path = "windows_text.rs"]
mod ranges;
use ranges::{Span, Unit};
use std::{
    collections::BTreeMap,
    ffi::c_void,
    sync::{Arc, Mutex},
};
use windows::{
    core::{implement, IUnknown, Interface, BSTR, PCWSTR, VARIANT},
    Win32::{
        Foundation::*,
        Globalization::{
            ScriptStringAnalyse, ScriptStringCPtoX, ScriptStringFree, SSA_FALLBACK, SSA_GLYPHS,
            SSA_LINK,
        },
        Graphics::Gdi::{ClientToScreen, GetDC, ReleaseDC, ScreenToClient, SelectObject, HGDIOBJ},
        System::{
            Com::SAFEARRAY,
            Ole::*,
            Variant::{VT_I4, VT_R8, VT_UNKNOWN},
        },
        UI::{Accessibility::*, WindowsAndMessaging::*},
    },
};

pub const ACTION_MESSAGE: u32 = WM_APP + 11;
pub const SELECTION_MESSAGE: u32 = WM_APP + 12;
struct Snapshot {
    hwnd: usize,
    root: NodeId,
    focus: NodeId,
    nodes: BTreeMap<NodeId, Node>,
    scale: f64,
    edit: usize,
}
pub struct Bridge {
    snapshot: Arc<Mutex<Snapshot>>,
}
#[derive(Default)]
struct Changes {
    properties: Vec<(NodeId, UIA_PROPERTY_ID)>,
    structures: Vec<NodeId>,
    text: Vec<(NodeId, bool)>,
}
fn changes(old: &BTreeMap<NodeId, Node>, next: &BTreeMap<NodeId, Node>, root: NodeId) -> Changes {
    let mut changes = Changes::default();
    for (id, node) in next {
        let Some(before) = old.get(id) else { continue };
        for (property, changed) in [
            (
                UIA_NamePropertyId,
                before.label().or(before.value()) != node.label().or(node.value()),
            ),
            (
                UIA_HelpTextPropertyId,
                before.state_description().or(before.description())
                    != node.state_description().or(node.description()),
            ),
            (UIA_ValueValuePropertyId, before.value() != node.value()),
            (
                UIA_IsEnabledPropertyId,
                before.is_disabled() != node.is_disabled(),
            ),
            (
                UIA_IsOffscreenPropertyId,
                before.is_hidden() != node.is_hidden(),
            ),
        ] {
            if changed {
                changes.properties.push((*id, property));
            }
        }
        if before.children() != node.children() || before.role() != node.role() {
            changes.structures.push(*id);
        }
        if node.role() == Role::TextInput {
            if before.value() != node.value() {
                changes.text.push((*id, true));
            }
            if before.text_selection() != node.text_selection() {
                changes.text.push((*id, false));
            }
        }
    }
    if old.keys().ne(next.keys()) && !changes.structures.contains(&root) {
        changes.structures.push(root);
    }
    changes
}
fn event_value(node: &Node, property: UIA_PROPERTY_ID) -> VARIANT {
    if property == UIA_NamePropertyId {
        VARIANT::from(node.label().or(node.value()).unwrap_or(""))
    } else if property == UIA_HelpTextPropertyId {
        VARIANT::from(
            node.state_description()
                .or(node.description())
                .unwrap_or(""),
        )
    } else if property == UIA_ValueValuePropertyId {
        VARIANT::from(node.value().unwrap_or(""))
    } else if property == UIA_IsEnabledPropertyId {
        VARIANT::from(!node.is_disabled())
    } else {
        VARIANT::from(node.is_hidden())
    }
}
impl Bridge {
    pub fn new(hwnd: HWND, tree: TreeUpdate) -> Self {
        let root = tree
            .tree
            .as_ref()
            .map(|tree| tree.root)
            .unwrap_or(NodeId(1));
        Self {
            snapshot: Arc::new(Mutex::new(Snapshot {
                hwnd: hwnd.0 as usize,
                root,
                focus: tree.focus,
                nodes: tree.nodes.into_iter().collect(),
                scale: 1.,
                edit: 0,
            })),
        }
    }
    pub unsafe fn update(&self, tree: TreeUpdate) {
        let old_focus;
        let focus = tree.focus;
        let (properties, structures, text_events);
        {
            let mut snapshot = self.snapshot.lock().unwrap();
            old_focus = snapshot.focus;
            if let Some(tree) = tree.tree {
                snapshot.root = tree.root;
            }
            snapshot.focus = focus;
            let nodes: BTreeMap<_, _> = tree.nodes.into_iter().collect();
            let changed = changes(&snapshot.nodes, &nodes, snapshot.root);
            properties = changed
                .properties
                .into_iter()
                .map(|(id, property)| {
                    (
                        id,
                        property,
                        event_value(&snapshot.nodes[&id], property),
                        event_value(&nodes[&id], property),
                    )
                })
                .collect::<Vec<_>>();
            structures = changed.structures;
            text_events = changed.text;
            snapshot.nodes = nodes;
        }
        for (id, property, before, after) in properties {
            let _ = UiaRaiseAutomationPropertyChangedEvent(
                &self.provider(id),
                property,
                &before,
                &after,
            );
        }
        for id in structures {
            let _ = UiaRaiseStructureChangedEvent(
                &self.provider(id),
                StructureChangeType_ChildrenInvalidated,
                std::ptr::null_mut(),
                0,
            );
        }
        for (id, value_changed) in text_events {
            let _ = UiaRaiseAutomationEvent(
                &self.provider(id),
                if value_changed {
                    UIA_Text_TextChangedEventId
                } else {
                    UIA_Text_TextSelectionChangedEventId
                },
            );
        }
        if old_focus != focus {
            let _ = UiaRaiseAutomationPropertyChangedEvent(
                &self.provider(old_focus),
                UIA_HasKeyboardFocusPropertyId,
                &VARIANT::from(true),
                &VARIANT::from(false),
            );
            let _ = UiaRaiseAutomationPropertyChangedEvent(
                &self.provider(focus),
                UIA_HasKeyboardFocusPropertyId,
                &VARIANT::from(false),
                &VARIANT::from(true),
            );
            let provider = self.provider(focus);
            let _ = UiaRaiseAutomationEvent(&provider, UIA_AutomationFocusChangedEventId);
        }
    }
    pub fn set_window(&self, hwnd: HWND, scale: f64) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.hwnd = hwnd.0 as usize;
        snapshot.scale = scale;
    }
    pub fn set_edit(&self, edit: HWND) {
        self.snapshot.lock().unwrap().edit = edit.0 as usize;
    }
    fn provider(&self, node: NodeId) -> IRawElementProviderSimple {
        provider(self.snapshot.clone(), node)
    }
    pub unsafe fn get_object(&self, hwnd: HWND, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        let root = self.snapshot.lock().unwrap().root;
        UiaReturnRawElementProvider(hwnd, wparam, lparam, &self.provider(root))
    }
    pub unsafe fn get_object_for_node(
        &self,
        hwnd: HWND,
        wparam: WPARAM,
        lparam: LPARAM,
        node: NodeId,
    ) -> LRESULT {
        UiaReturnRawElementProvider(hwnd, wparam, lparam, &self.provider(node))
    }
}
#[implement(
    IRawElementProviderSimple,
    IRawElementProviderFragment,
    IRawElementProviderFragmentRoot,
    IInvokeProvider,
    IValueProvider,
    ITextProvider,
    ITextProvider2
)]
struct Provider {
    snapshot: Arc<Mutex<Snapshot>>,
    node: NodeId,
}
// windows-core's generated interface methods express an absent COM interface as
// E_NOINTERFACE. UIA requires S_OK plus a null out-pointer for traversal boundaries,
// absent patterns and a child without a host HWND. These shims preserve that ABI
// without constructing a Rust interface from a null pointer.
unsafe extern "system" fn nullable_navigate(
    this: *mut c_void,
    direction: NavigateDirection,
    out: *mut *mut c_void,
) -> windows::core::HRESULT {
    if out.is_null() {
        return E_POINTER;
    }
    out.write(std::ptr::null_mut());
    let result = (Provider_Impl::VTABLES.1.Navigate)(this, direction, out);
    if result == E_NOINTERFACE {
        windows::core::HRESULT(0)
    } else {
        result
    }
}
unsafe extern "system" fn nullable_pattern(
    this: *mut c_void,
    pattern: UIA_PATTERN_ID,
    out: *mut *mut c_void,
) -> windows::core::HRESULT {
    if out.is_null() {
        return E_POINTER;
    }
    out.write(std::ptr::null_mut());
    let result = (Provider_Impl::VTABLES.0.GetPatternProvider)(this, pattern, out);
    if result == E_NOINTERFACE {
        windows::core::HRESULT(0)
    } else {
        result
    }
}
unsafe extern "system" fn nullable_host(
    this: *mut c_void,
    out: *mut *mut c_void,
) -> windows::core::HRESULT {
    if out.is_null() {
        return E_POINTER;
    }
    out.write(std::ptr::null_mut());
    let result = (Provider_Impl::VTABLES.0.HostRawElementProvider)(this, out);
    if result == E_NOINTERFACE {
        windows::core::HRESULT(0)
    } else {
        result
    }
}
static SIMPLE_VTABLE: IRawElementProviderSimple_Vtbl = {
    let mut table = Provider_Impl::VTABLES.0;
    table.GetPatternProvider = nullable_pattern;
    table.HostRawElementProvider = nullable_host;
    table
};
static FRAGMENT_VTABLE: IRawElementProviderFragment_Vtbl = {
    let mut table = Provider_Impl::VTABLES.1;
    table.Navigate = nullable_navigate;
    table
};
fn provider(snapshot: Arc<Mutex<Snapshot>>, node: NodeId) -> IRawElementProviderSimple {
    let provider: IRawElementProviderSimple = Provider { snapshot, node }.into();
    // At this point the new allocation has exactly one owner and has not escaped
    // to COM. The first interface is at word one after the identity vtable, as
    // specified by windows-core 0.58's implement macro. Replace only its vtable
    // pointers before any interface can be shared with another thread.
    unsafe {
        let implementation = (provider.as_raw() as *mut *const c_void).sub(1) as *mut Provider_Impl;
        (*implementation).vtables.0 = &SIMPLE_VTABLE;
        (*implementation).vtables.1 = &FRAGMENT_VTABLE;
    }
    provider
}
impl Provider {
    fn child(&self, node: NodeId) -> IRawElementProviderFragment {
        let provider = provider(self.snapshot.clone(), node);
        provider.cast().unwrap()
    }
    fn send(&self, action: Action, data: Option<ActionData>) -> windows::core::Result<()> {
        let snapshot = self.snapshot.lock().unwrap();
        let node = snapshot.nodes.get(&self.node).ok_or_else(|| {
            windows::core::Error::from_hresult(windows::core::HRESULT(
                UIA_E_ELEMENTNOTAVAILABLE as i32,
            ))
        })?;
        if node.is_disabled() {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                UIA_E_ELEMENTNOTENABLED as i32,
            )));
        }
        let request = Box::new(ActionRequest {
            action,
            target_tree: TreeId::ROOT,
            target_node: self.node,
            data,
        });
        let raw = Box::into_raw(request);
        unsafe {
            if let Err(error) = PostMessageW(
                HWND(snapshot.hwnd as *mut c_void),
                ACTION_MESSAGE,
                WPARAM(0),
                LPARAM(raw as isize),
            ) {
                drop(Box::from_raw(raw));
                return Err(error);
            }
        }
        Ok(())
    }
}
fn unsupported<T>() -> windows::core::Result<T> {
    Err(windows::core::Error::from_hresult(E_NOINTERFACE))
}
impl IRawElementProviderSimple_Impl for Provider_Impl {
    fn ProviderOptions(&self) -> windows::core::Result<ProviderOptions> {
        Ok(ProviderOptions_ServerSideProvider)
    }
    fn GetPatternProvider(&self, pattern: UIA_PATTERN_ID) -> windows::core::Result<IUnknown> {
        let snapshot = self.snapshot.lock().unwrap();
        let Some(node) = snapshot.nodes.get(&self.node) else {
            return unsupported();
        };
        let provider = provider(self.snapshot.clone(), self.node);
        if pattern == UIA_InvokePatternId && node.supports_action(Action::Click) {
            return provider
                .cast::<IInvokeProvider>()
                .and_then(|provider| provider.cast());
        }
        if pattern == UIA_ValuePatternId && node.role() == Role::TextInput {
            return provider
                .cast::<IValueProvider>()
                .and_then(|provider| provider.cast());
        }
        if node.role() == Role::TextInput
            && (pattern == UIA_TextPatternId || pattern == UIA_TextPattern2Id)
        {
            return if pattern == UIA_TextPattern2Id {
                provider.cast::<ITextProvider2>().and_then(|p| p.cast())
            } else {
                provider.cast::<ITextProvider>().and_then(|p| p.cast())
            };
        }
        unsupported()
    }
    fn GetPropertyValue(&self, property: UIA_PROPERTY_ID) -> windows::core::Result<VARIANT> {
        let snapshot = self.snapshot.lock().unwrap();
        let Some(node) = snapshot.nodes.get(&self.node) else {
            return Ok(VARIANT::default());
        };
        if property == UIA_NamePropertyId {
            return Ok(VARIANT::from(node.label().or(node.value()).unwrap_or("")));
        }
        if property == UIA_ValueValuePropertyId {
            return Ok(VARIANT::from(node.value().unwrap_or("")));
        }
        if property == UIA_HelpTextPropertyId {
            return Ok(VARIANT::from(
                node.state_description()
                    .or_else(|| node.description())
                    .unwrap_or(""),
            ));
        }
        if property == UIA_AutomationIdPropertyId {
            return Ok(VARIANT::from(
                format!("coco-{}", self.node.0).as_str(),
            ));
        }
        if property == UIA_IsEnabledPropertyId {
            return Ok(VARIANT::from(!node.is_disabled()));
        }
        if property == UIA_HasKeyboardFocusPropertyId {
            return Ok(VARIANT::from(snapshot.focus == self.node));
        }
        if property == UIA_IsKeyboardFocusablePropertyId {
            return Ok(VARIANT::from(node.supports_action(Action::Focus)));
        }
        if property == UIA_IsContentElementPropertyId || property == UIA_IsControlElementPropertyId
        {
            return Ok(VARIANT::from(!node.is_hidden()));
        }
        if property == UIA_IsOffscreenPropertyId {
            return Ok(VARIANT::from(node.is_hidden()));
        }
        if property == UIA_ControlTypePropertyId {
            let role = match node.role() {
                Role::Window | Role::Dialog => UIA_WindowControlTypeId,
                Role::Button => UIA_ButtonControlTypeId,
                Role::ComboBox => UIA_ComboBoxControlTypeId,
                Role::TextInput => UIA_EditControlTypeId,
                Role::Menu => UIA_MenuControlTypeId,
                Role::MenuItem => UIA_MenuItemControlTypeId,
                Role::List => UIA_ListControlTypeId,
                Role::ListItem => UIA_ListItemControlTypeId,
                Role::Label | Role::TextRun => UIA_TextControlTypeId,
                _ => UIA_GroupControlTypeId,
            };
            return Ok(VARIANT::from(role.0));
        }
        Ok(VARIANT::default())
    }
    fn HostRawElementProvider(&self) -> windows::core::Result<IRawElementProviderSimple> {
        let snapshot = self.snapshot.lock().unwrap();
        if self.node != snapshot.root {
            return unsupported();
        }
        unsafe { UiaHostProviderFromHwnd(HWND(snapshot.hwnd as *mut c_void)) }
    }
}
impl IRawElementProviderFragment_Impl for Provider_Impl {
    fn Navigate(
        &self,
        direction: NavigateDirection,
    ) -> windows::core::Result<IRawElementProviderFragment> {
        let snapshot = self.snapshot.lock().unwrap();
        let node = snapshot.nodes.get(&self.node);
        let parent = snapshot
            .nodes
            .iter()
            .find(|(_, node)| node.children().contains(&self.node));
        let target = if direction == NavigateDirection_Parent {
            parent.map(|(id, _)| *id)
        } else if direction == NavigateDirection_FirstChild {
            node.and_then(|node| node.children().first().copied())
        } else if direction == NavigateDirection_LastChild {
            node.and_then(|node| node.children().last().copied())
        } else {
            parent.and_then(|(_, parent)| {
                let index = parent.children().iter().position(|id| *id == self.node)?;
                if direction == NavigateDirection_NextSibling {
                    parent.children().get(index + 1).copied()
                } else if direction == NavigateDirection_PreviousSibling {
                    index
                        .checked_sub(1)
                        .and_then(|index| parent.children().get(index).copied())
                } else {
                    None
                }
            })
        };
        drop(snapshot);
        target
            .map(|node| self.child(node))
            .ok_or_else(|| windows::core::Error::from_hresult(E_NOINTERFACE))
    }
    fn GetRuntimeId(&self) -> windows::core::Result<*mut SAFEARRAY> {
        unsafe {
            let values = [
                UiaAppendRuntimeId as i32,
                self.snapshot.lock().unwrap().hwnd as i32,
                self.node.0 as i32,
            ];
            let array = SafeArrayCreateVector(VT_I4, 0, 3);
            if array.is_null() {
                return Err(windows::core::Error::from_hresult(E_OUTOFMEMORY));
            }
            for (index, value) in values.iter().enumerate() {
                SafeArrayPutElement(array, &(index as i32), (value as *const i32).cast())?;
            }
            Ok(array)
        }
    }
    fn BoundingRectangle(&self) -> windows::core::Result<UiaRect> {
        let snapshot = self.snapshot.lock().unwrap();
        let mut origin = POINT::default();
        unsafe {
            let _ = ClientToScreen(HWND(snapshot.hwnd as *mut c_void), &mut origin);
        }
        Ok(snapshot
            .nodes
            .get(&self.node)
            .and_then(Node::bounds)
            .map(|bounds| UiaRect {
                left: bounds.x0 * snapshot.scale + origin.x as f64,
                top: bounds.y0 * snapshot.scale + origin.y as f64,
                width: (bounds.x1 - bounds.x0) * snapshot.scale,
                height: (bounds.y1 - bounds.y0) * snapshot.scale,
            })
            .unwrap_or_default())
    }
    fn GetEmbeddedFragmentRoots(&self) -> windows::core::Result<*mut SAFEARRAY> {
        Ok(std::ptr::null_mut())
    }
    fn SetFocus(&self) -> windows::core::Result<()> {
        self.send(Action::Focus, None)
    }
    fn FragmentRoot(&self) -> windows::core::Result<IRawElementProviderFragmentRoot> {
        let root = self.snapshot.lock().unwrap().root;
        self.child(root).cast()
    }
}
impl IRawElementProviderFragmentRoot_Impl for Provider_Impl {
    fn ElementProviderFromPoint(
        &self,
        x: f64,
        y: f64,
    ) -> windows::core::Result<IRawElementProviderFragment> {
        let snapshot = self.snapshot.lock().unwrap();
        let mut origin = POINT::default();
        unsafe {
            let _ = ClientToScreen(HWND(snapshot.hwnd as *mut c_void), &mut origin);
        }
        let node = snapshot
            .nodes
            .iter()
            .rev()
            .find(|(_, node)| {
                node.bounds().is_some_and(|bounds| {
                    x >= bounds.x0 * snapshot.scale + origin.x as f64
                        && x <= bounds.x1 * snapshot.scale + origin.x as f64
                        && y >= bounds.y0 * snapshot.scale + origin.y as f64
                        && y <= bounds.y1 * snapshot.scale + origin.y as f64
                })
            })
            .map(|(id, _)| *id)
            .unwrap_or(snapshot.root);
        drop(snapshot);
        Ok(self.child(node))
    }
    fn GetFocus(&self) -> windows::core::Result<IRawElementProviderFragment> {
        let focus = self.snapshot.lock().unwrap().focus;
        Ok(self.child(focus))
    }
}
impl IInvokeProvider_Impl for Provider_Impl {
    fn Invoke(&self) -> windows::core::Result<()> {
        self.send(Action::Click, None)
    }
}
impl IValueProvider_Impl for Provider_Impl {
    fn SetValue(&self, value: &PCWSTR) -> windows::core::Result<()> {
        let value = unsafe { value.to_string()? };
        self.send(
            Action::SetValue,
            Some(ActionData::Value(value.into_boxed_str())),
        )
    }
    fn Value(&self) -> windows::core::Result<BSTR> {
        let snapshot = self.snapshot.lock().unwrap();
        Ok(BSTR::from(
            snapshot
                .nodes
                .get(&self.node)
                .and_then(Node::value)
                .unwrap_or(""),
        ))
    }
    fn IsReadOnly(&self) -> windows::core::Result<BOOL> {
        let state = self.snapshot.lock().unwrap();
        let node = state.nodes.get(&self.node).ok_or_else(unavailable)?;
        Ok(BOOL::from(
            node.is_disabled() || !node.supports_action(Action::SetValue),
        ))
    }
}
fn invalid() -> windows::core::Error {
    windows::core::Error::from_hresult(E_INVALIDARG)
}
fn unavailable() -> windows::core::Error {
    windows::core::Error::from_hresult(windows::core::HRESULT(UIA_E_ELEMENTNOTAVAILABLE as i32))
}
fn unit(unit: TextUnit) -> Unit {
    if unit == TextUnit_Character {
        Unit::Character
    } else if unit == TextUnit_Word {
        Unit::Word
    } else {
        Unit::Document
    }
}
fn text_data(
    snapshot: &Arc<Mutex<Snapshot>>,
    node: NodeId,
) -> windows::core::Result<(String, HWND)> {
    let state = snapshot.lock().unwrap();
    let node = state.nodes.get(&node).ok_or_else(unavailable)?;
    if node.role() != Role::TextInput {
        return Err(invalid());
    }
    Ok((
        node.value().unwrap_or("").into(),
        HWND(state.edit as *mut c_void),
    ))
}
unsafe fn range_array(ranges: &[ITextRangeProvider]) -> windows::core::Result<*mut SAFEARRAY> {
    let array = SafeArrayCreateVector(VT_UNKNOWN, 0, ranges.len() as u32);
    if array.is_null() {
        return Err(windows::core::Error::from_hresult(E_OUTOFMEMORY));
    }
    for (i, range) in ranges.iter().enumerate() {
        if let Err(error) = SafeArrayPutElement(array, &(i as i32), range.as_raw()) {
            let _ = SafeArrayDestroy(array);
            return Err(error);
        }
    }
    Ok(array)
}
/// The private EDIT's font and scroll origin shape only its own composer text.
unsafe fn glyph_edges(text: &str, edit: HWND) -> windows::core::Result<Vec<(u32, u32, i32, i32)>> {
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let dc = GetDC(edit);
    if dc.0.is_null() {
        return Err(unavailable());
    }
    let font = SendMessageW(edit, WM_GETFONT, WPARAM(0), LPARAM(0));
    let old = (font.0 != 0).then(|| SelectObject(dc, HGDIOBJ(font.0 as *mut c_void)));
    let mut analysis = std::ptr::null_mut();
    let units = text.encode_utf16().collect::<Vec<_>>();
    let result = (|| {
        ScriptStringAnalyse(
            dc,
            units.as_ptr().cast(),
            units.len() as i32,
            (units.len() * 3 / 2 + 16) as i32,
            -1,
            SSA_GLYPHS | SSA_FALLBACK | SSA_LINK,
            0,
            None,
            None,
            None,
            None,
            std::ptr::null(),
            &mut analysis,
        )?;
        let native = SendMessageW(edit, 0x00D6, WPARAM(0), LPARAM(0)).0 as i16 as i32;
        let first_end = text.chars().next().unwrap().len_utf16() as i32 - 1;
        let leading = ScriptStringCPtoX(analysis, 0, BOOL(0))?;
        let trailing = ScriptStringCPtoX(analysis, first_end, BOOL(1))?;
        // EM_POSFROMCHAR returns the visual upper-left, including RTL glyphs.
        let shift = native - leading.min(trailing);
        let mut start = 0u32;
        let mut out = Vec::new();
        for c in text.chars() {
            let end = start + c.len_utf16() as u32;
            let a = ScriptStringCPtoX(analysis, start as i32, BOOL(0))? + shift;
            let b = ScriptStringCPtoX(analysis, (end - 1) as i32, BOOL(1))? + shift;
            out.push((start, end, a, b));
            start = end;
        }
        Ok(out)
    })();
    if !analysis.is_null() {
        let _ = ScriptStringFree(&mut analysis);
    }
    if let Some(old) = old {
        let _ = SelectObject(dc, old);
    }
    let _ = ReleaseDC(edit, dc);
    result
}
impl Provider_Impl {
    fn text_range(&self, span: Span) -> ITextRangeProvider {
        make_range(self.snapshot.clone(), self.node, span)
    }
    fn text_selection(&self) -> windows::core::Result<Span> {
        let (text, edit) = text_data(&self.snapshot, self.node)?;
        if edit.0.is_null() {
            let state = self.snapshot.lock().unwrap();
            let selection = state.nodes[&self.node].text_selection();
            return Ok(selection
                .map(|s| {
                    Span::new(
                        &text,
                        ranges::scalar_to_utf16(&text, s.anchor.character_index),
                        ranges::scalar_to_utf16(&text, s.focus.character_index),
                    )
                })
                .unwrap_or(Span { start: 0, end: 0 }));
        }
        let (mut start, mut end) = (0u32, 0u32);
        unsafe {
            SendMessageW(
                edit,
                0x00B0,
                WPARAM((&mut start as *mut u32) as usize),
                LPARAM((&mut end as *mut u32) as isize),
            );
        }
        Ok(Span::new(&text, start, end))
    }
}
impl ITextProvider_Impl for Provider_Impl {
    fn GetSelection(&self) -> windows::core::Result<*mut SAFEARRAY> {
        unsafe { range_array(&[self.text_range(self.text_selection()?)]) }
    }
    fn GetVisibleRanges(&self) -> windows::core::Result<*mut SAFEARRAY> {
        let (text, edit) = text_data(&self.snapshot, self.node)?;
        let mut spans = vec![Span::visible(
            &text,
            0,
            (text.encode_utf16().count() as u32).saturating_sub(1),
        )];
        if !edit.0.is_null() {
            unsafe {
                let mut rect = RECT::default();
                GetClientRect(edit, &mut rect)?;
                let glyphs = glyph_edges(&text, edit)?;
                if !glyphs.is_empty() {
                    spans = ranges::visible_spans(&glyphs, rect.left, rect.right);
                }
            }
        }
        let providers = spans
            .into_iter()
            .map(|span| self.text_range(span))
            .collect::<Vec<_>>();
        unsafe { range_array(&providers) }
    }
    fn RangeFromChild(
        &self,
        child: Option<&IRawElementProviderSimple>,
    ) -> windows::core::Result<ITextRangeProvider> {
        let child = child.ok_or_else(invalid)?.cast_object_ref::<Provider>()?;
        if !Arc::ptr_eq(&child.snapshot, &self.snapshot)
            || child.node != crate::accessibility::FIELD_TEXT
        {
            return Err(invalid());
        }
        self.DocumentRange()
    }
    fn RangeFromPoint(&self, point: &UiaPoint) -> windows::core::Result<ITextRangeProvider> {
        let (text, edit) = text_data(&self.snapshot, self.node)?;
        if edit.0.is_null() {
            return Err(unavailable());
        }
        let mut local = POINT {
            x: point.x.round() as i32,
            y: point.y.round() as i32,
        };
        unsafe {
            let _ = ScreenToClient(edit, &mut local);
        }
        let packed = local.x as i16 as u16 as u32 | ((local.y as i16 as u16 as u32) << 16);
        let offset = unsafe {
            SendMessageW(edit, 0x00D7, WPARAM(0), LPARAM(packed as isize)).0 as u32 & 0xffff
        };
        Ok(self.text_range(Span::new(&text, offset, offset)))
    }
    fn DocumentRange(&self) -> windows::core::Result<ITextRangeProvider> {
        let (text, _) = text_data(&self.snapshot, self.node)?;
        Ok(self.text_range(Span::new(&text, 0, text.encode_utf16().count() as u32)))
    }
    fn SupportedTextSelection(&self) -> windows::core::Result<SupportedTextSelection> {
        Ok(SupportedTextSelection_Single)
    }
}
impl ITextProvider2_Impl for Provider_Impl {
    fn RangeFromAnnotation(
        &self,
        _: Option<&IRawElementProviderSimple>,
    ) -> windows::core::Result<ITextRangeProvider> {
        Err(invalid())
    }
    fn GetCaretRange(&self, active: *mut BOOL) -> windows::core::Result<ITextRangeProvider> {
        if active.is_null() {
            return Err(windows::core::Error::from_hresult(E_POINTER));
        }
        let (text, edit) = text_data(&self.snapshot, self.node)?;
        let selection = self.text_selection()?;
        let state = self.snapshot.lock().unwrap();
        let mut offset = state
            .nodes
            .get(&self.node)
            .and_then(Node::text_selection)
            .map(|s| ranges::scalar_to_utf16(&text, s.focus.character_index))
            .unwrap_or(selection.end);
        let mut focused = state.focus == self.node;
        drop(state);
        if !edit.0.is_null() {
            unsafe {
                let thread = GetWindowThreadProcessId(edit, None);
                let mut gui = GUITHREADINFO {
                    cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                    ..Default::default()
                };
                if GetGUIThreadInfo(thread, &mut gui).is_ok() {
                    focused = gui.hwndFocus == edit;
                    if gui.hwndCaret == edit {
                        let point = gui.rcCaret.left as i16 as u16 as u32
                            | ((gui.rcCaret.top as i16 as u16 as u32) << 16);
                        offset = SendMessageW(edit, 0x00D7, WPARAM(0), LPARAM(point as isize)).0
                            as u32
                            & 0xffff;
                    }
                }
            }
        }
        unsafe { *active = BOOL::from(focused) };
        Ok(self.text_range(Span::new(&text, offset, offset)))
    }
}
#[implement(ITextRangeProvider)]
struct TextRange {
    snapshot: Arc<Mutex<Snapshot>>,
    node: NodeId,
    span: Mutex<Span>,
}
unsafe extern "system" fn nullable_find_text(
    this: *mut c_void,
    text: std::mem::MaybeUninit<BSTR>,
    backward: BOOL,
    ignorecase: BOOL,
    out: *mut *mut c_void,
) -> windows::core::HRESULT {
    if out.is_null() {
        return E_POINTER;
    }
    out.write(std::ptr::null_mut());
    let result = (TextRange_Impl::VTABLES.0.FindText)(this, text, backward, ignorecase, out);
    if result == E_NOINTERFACE {
        windows::core::HRESULT(0)
    } else {
        result
    }
}
unsafe extern "system" fn nullable_find_attribute(
    this: *mut c_void,
    attribute: UIA_TEXTATTRIBUTE_ID,
    value: std::mem::MaybeUninit<VARIANT>,
    backward: BOOL,
    out: *mut *mut c_void,
) -> windows::core::HRESULT {
    if out.is_null() {
        return E_POINTER;
    }
    out.write(std::ptr::null_mut());
    let result = (TextRange_Impl::VTABLES.0.FindAttribute)(this, attribute, value, backward, out);
    if result == E_NOINTERFACE {
        windows::core::HRESULT(0)
    } else {
        result
    }
}
static TEXT_RANGE_VTABLE: ITextRangeProvider_Vtbl = {
    let mut table = TextRange_Impl::VTABLES.0;
    table.FindText = nullable_find_text;
    table.FindAttribute = nullable_find_attribute;
    table
};
fn make_range(snapshot: Arc<Mutex<Snapshot>>, node: NodeId, span: Span) -> ITextRangeProvider {
    let range: ITextRangeProvider = TextRange {
        snapshot,
        node,
        span: Mutex::new(span),
    }
    .into();
    // Same pinned windows-core 0.58 layout as the main provider factory, before sharing.
    unsafe {
        let implementation = (range.as_raw() as *mut *const c_void).sub(1) as *mut TextRange_Impl;
        (*implementation).vtables.0 = &TEXT_RANGE_VTABLE;
    }
    range
}
impl TextRange_Impl {
    fn read_only(&self) -> windows::core::Result<bool> {
        let state = self.snapshot.lock().unwrap();
        let node = state.nodes.get(&self.node).ok_or_else(unavailable)?;
        Ok(node.is_disabled() || !node.supports_action(Action::SetValue))
    }
    fn other(&self, other: Option<&ITextRangeProvider>) -> windows::core::Result<Span> {
        let other = other.ok_or_else(invalid)?.cast_object_ref::<TextRange>()?;
        if self.node != other.node || !Arc::ptr_eq(&self.snapshot, &other.snapshot) {
            return Err(invalid());
        }
        let span = *other.span.lock().unwrap();
        Ok(span)
    }
}
impl ITextRangeProvider_Impl for TextRange_Impl {
    fn Clone(&self) -> windows::core::Result<ITextRangeProvider> {
        Ok(make_range(
            self.snapshot.clone(),
            self.node,
            *self.span.lock().unwrap(),
        ))
    }
    fn Compare(&self, other: Option<&ITextRangeProvider>) -> windows::core::Result<BOOL> {
        Ok(BOOL::from(
            self.other(other)
                .is_ok_and(|other| other == *self.span.lock().unwrap()),
        ))
    }
    fn CompareEndpoints(
        &self,
        endpoint: TextPatternRangeEndpoint,
        other: Option<&ITextRangeProvider>,
        target: TextPatternRangeEndpoint,
    ) -> windows::core::Result<i32> {
        let other = self.other(other)?;
        let span = self.span.lock().unwrap();
        Ok((if endpoint == TextPatternRangeEndpoint_Start {
            span.start
        } else {
            span.end
        }) as i32
            - (if target == TextPatternRangeEndpoint_Start {
                other.start
            } else {
                other.end
            }) as i32)
    }
    fn ExpandToEnclosingUnit(&self, requested: TextUnit) -> windows::core::Result<()> {
        let (text, _) = text_data(&self.snapshot, self.node)?;
        self.span.lock().unwrap().expand(&text, unit(requested));
        Ok(())
    }
    fn FindAttribute(
        &self,
        attribute: UIA_TEXTATTRIBUTE_ID,
        value: &VARIANT,
        _: BOOL,
    ) -> windows::core::Result<ITextRangeProvider> {
        let matches = if attribute == UIA_IsReadOnlyAttributeId {
            let read_only = self.read_only()?;
            bool::try_from(value).is_ok_and(|v| v == read_only)
        } else if attribute == UIA_FontNameAttributeId {
            BSTR::try_from(value).is_ok_and(|v| v.to_string() == "Sitka Text")
        } else if attribute == UIA_FontSizeAttributeId {
            f64::try_from(value).is_ok_and(|v| v == 12.)
        } else {
            false
        };
        if matches {
            self.Clone()
        } else {
            unsupported()
        }
    }
    fn FindText(
        &self,
        needle: &BSTR,
        backward: BOOL,
        ignorecase: BOOL,
    ) -> windows::core::Result<ITextRangeProvider> {
        let (text, _) = text_data(&self.snapshot, self.node)?;
        let found = self.span.lock().unwrap().find(
            &text,
            &needle.to_string(),
            backward.as_bool(),
            ignorecase.as_bool(),
        );
        found
            .map(|span| make_range(self.snapshot.clone(), self.node, span))
            .ok_or_else(|| windows::core::Error::from_hresult(E_NOINTERFACE))
    }
    fn GetAttributeValue(&self, attribute: UIA_TEXTATTRIBUTE_ID) -> windows::core::Result<VARIANT> {
        if attribute == UIA_IsReadOnlyAttributeId {
            return Ok(VARIANT::from(self.read_only()?));
        }
        if attribute == UIA_FontNameAttributeId {
            return Ok(VARIANT::from("Sitka Text"));
        }
        if attribute == UIA_FontSizeAttributeId {
            return Ok(VARIANT::from(12.));
        }
        unsafe { Ok(VARIANT::from(UiaGetReservedNotSupportedValue()?)) }
    }
    fn GetBoundingRectangles(&self) -> windows::core::Result<*mut SAFEARRAY> {
        let (text, edit) = text_data(&self.snapshot, self.node)?;
        if edit.0.is_null() {
            return Err(unavailable());
        }
        let current = *self.span.lock().unwrap();
        let span = Span::new(&text, current.start, current.end);
        unsafe {
            let mut client = RECT::default();
            GetClientRect(edit, &mut client)?;
            let glyphs = glyph_edges(&text, edit)?;
            let edges = if span.start == span.end {
                let x = glyphs
                    .iter()
                    .find(|g| g.0 == span.start)
                    .map(|g| g.2)
                    .or_else(|| glyphs.last().map(|g| g.3))
                    .unwrap_or(client.left);
                vec![(x, x.saturating_add(1))]
            } else {
                glyphs
                    .iter()
                    .filter(|g| g.0 < span.end && g.1 > span.start)
                    .map(|g| (g.2, g.3))
                    .collect::<Vec<_>>()
            };
            let extent = ranges::visible_extent(&edges, client.left, client.right);
            let (left, right) = extent.unwrap_or((0, 0));
            let mut origin = POINT { x: 0, y: 0 };
            let _ = ClientToScreen(edit, &mut origin);
            let visible = extent.is_some();
            let array = SafeArrayCreateVector(VT_R8, 0, if visible { 4 } else { 0 });
            if array.is_null() {
                return Err(windows::core::Error::from_hresult(E_OUTOFMEMORY));
            }
            if visible {
                for (i, value) in [
                    (left + origin.x) as f64,
                    (client.top + origin.y) as f64,
                    (right - left) as f64,
                    (client.bottom - client.top) as f64,
                ]
                .iter()
                .enumerate()
                {
                    if let Err(error) =
                        SafeArrayPutElement(array, &(i as i32), (value as *const f64).cast())
                    {
                        let _ = SafeArrayDestroy(array);
                        return Err(error);
                    }
                }
            }
            Ok(array)
        }
    }
    fn GetEnclosingElement(&self) -> windows::core::Result<IRawElementProviderSimple> {
        Ok(provider(self.snapshot.clone(), self.node))
    }
    fn GetText(&self, max: i32) -> windows::core::Result<BSTR> {
        let (text, _) = text_data(&self.snapshot, self.node)?;
        Ok(BSTR::from(
            self.span.lock().unwrap().text(&text, max).as_str(),
        ))
    }
    fn Move(&self, requested: TextUnit, count: i32) -> windows::core::Result<i32> {
        let (text, _) = text_data(&self.snapshot, self.node)?;
        Ok(self
            .span
            .lock()
            .unwrap()
            .move_by(&text, unit(requested), count))
    }
    fn MoveEndpointByUnit(
        &self,
        endpoint: TextPatternRangeEndpoint,
        requested: TextUnit,
        count: i32,
    ) -> windows::core::Result<i32> {
        let (text, _) = text_data(&self.snapshot, self.node)?;
        Ok(self.span.lock().unwrap().move_endpoint(
            &text,
            endpoint == TextPatternRangeEndpoint_Start,
            unit(requested),
            count,
        ))
    }
    fn MoveEndpointByRange(
        &self,
        endpoint: TextPatternRangeEndpoint,
        other: Option<&ITextRangeProvider>,
        target: TextPatternRangeEndpoint,
    ) -> windows::core::Result<()> {
        let other = self.other(other)?;
        let offset = if target == TextPatternRangeEndpoint_Start {
            other.start
        } else {
            other.end
        };
        let mut span = self.span.lock().unwrap();
        if endpoint == TextPatternRangeEndpoint_Start {
            span.start = offset;
            span.end = span.end.max(offset)
        } else {
            span.end = offset;
            span.start = span.start.min(offset)
        }
        Ok(())
    }
    fn Select(&self) -> windows::core::Result<()> {
        let (text, _) = text_data(&self.snapshot, self.node)?;
        let span = *self.span.lock().unwrap();
        let selection = accesskit::TextSelection {
            anchor: accesskit::TextPosition {
                node: crate::accessibility::FIELD_TEXT,
                character_index: ranges::utf16_to_scalar(&text, span.start),
            },
            focus: accesskit::TextPosition {
                node: crate::accessibility::FIELD_TEXT,
                character_index: ranges::utf16_to_scalar(&text, span.end),
            },
        };
        let provider = Provider {
            snapshot: self.snapshot.clone(),
            node: self.node,
        };
        provider.send(
            Action::SetTextSelection,
            Some(ActionData::SetTextSelection(selection)),
        )
    }
    fn AddToSelection(&self) -> windows::core::Result<()> {
        Err(invalid())
    }
    fn RemoveFromSelection(&self) -> windows::core::Result<()> {
        Err(invalid())
    }
    fn ScrollIntoView(&self, align: BOOL) -> windows::core::Result<()> {
        let (_, edit) = text_data(&self.snapshot, self.node)?;
        if edit.0.is_null() {
            return Err(unavailable());
        }
        let span = *self.span.lock().unwrap();
        let offset = if align.as_bool() {
            span.start
        } else {
            span.end
        };
        unsafe {
            let (mut start, mut end) = (0u32, 0u32);
            SendMessageW(
                edit,
                0x00B0,
                WPARAM((&mut start as *mut u32) as usize),
                LPARAM((&mut end as *mut u32) as isize),
            );
            let mut gui = GUITHREADINFO {
                cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                ..Default::default()
            };
            if start != end
                && GetGUIThreadInfo(GetWindowThreadProcessId(edit, None), &mut gui).is_ok()
                && gui.hwndCaret == edit
            {
                let point = gui.rcCaret.left as i16 as u16 as u32
                    | ((gui.rcCaret.top as i16 as u16 as u32) << 16);
                let caret =
                    SendMessageW(edit, 0x00D7, WPARAM(0), LPARAM(point as isize)).0 as u32 & 0xffff;
                if caret <= start {
                    std::mem::swap(&mut start, &mut end);
                }
            }
            SendMessageW(
                edit,
                0x00B1,
                WPARAM(offset as usize),
                LPARAM(offset as isize),
            );
            SendMessageW(edit, 0x00B7, WPARAM(0), LPARAM(0));
            SendMessageW(edit, 0x00B1, WPARAM(start as usize), LPARAM(end as isize));
        }
        Ok(())
    }
    fn GetChildren(&self) -> windows::core::Result<*mut SAFEARRAY> {
        unsafe {
            let array = SafeArrayCreateVector(VT_UNKNOWN, 0, 0);
            if array.is_null() {
                Err(windows::core::Error::from_hresult(E_OUTOFMEMORY))
            } else {
                Ok(array)
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn bridge() -> Bridge {
        let mut root = Node::new(Role::Window);
        root.set_label("Coco");
        root.set_state_description("asleep");
        root.set_children([NodeId(2)]);
        let mut button = Node::new(Role::Button);
        button.set_label("Activity");
        button.add_action(Action::Click);
        button.add_action(Action::Focus);
        Bridge::new(
            HWND::default(),
            TreeUpdate {
                nodes: vec![(NodeId(1), root), (NodeId(2), button)],
                tree: Some(accesskit::Tree::new(NodeId(1))),
                tree_id: TreeId::ROOT,
                focus: NodeId(2),
            },
        )
    }
    #[test]
    fn uia_nullable_abi_preserves_leaf_and_absent_pattern_contract() {
        let bridge = bridge();
        let root = bridge.provider(NodeId(1));
        let fragment: IRawElementProviderFragment = root.cast().unwrap();
        let child = unsafe { fragment.Navigate(NavigateDirection_FirstChild).unwrap() };
        let mut output = 1usize as *mut c_void;
        unsafe {
            let status = (child.vtable().Navigate)(
                child.as_raw(),
                NavigateDirection_NextSibling,
                &mut output,
            );
            assert_eq!(status, windows::core::HRESULT(0));
            assert!(output.is_null());
            let child: IRawElementProviderSimple = child.cast().unwrap();
            output = 1usize as *mut c_void;
            let status =
                (child.vtable().GetPatternProvider)(child.as_raw(), UIA_TextPatternId, &mut output);
            assert_eq!(status, windows::core::HRESULT(0));
            assert!(output.is_null());
            assert!(child.GetPatternProvider(UIA_InvokePatternId).is_ok());
        }
    }
    #[test]
    fn uia_name_state_and_focus_come_from_accesskit() {
        let bridge = bridge();
        let root = bridge.provider(NodeId(1));
        let child = bridge.provider(NodeId(2));
        unsafe {
            assert_eq!(
                BSTR::try_from(&root.GetPropertyValue(UIA_NamePropertyId).unwrap())
                    .unwrap()
                    .to_string(),
                "Coco"
            );
            assert_eq!(
                BSTR::try_from(&root.GetPropertyValue(UIA_HelpTextPropertyId).unwrap())
                    .unwrap()
                    .to_string(),
                "asleep"
            );
            assert!(bool::try_from(
                &child
                    .GetPropertyValue(UIA_HasKeyboardFocusPropertyId)
                    .unwrap()
            )
            .unwrap());
        }
    }
    #[test]
    fn uia_changes_announce_state_enabled_value_and_structure() {
        let bridge = bridge();
        let old = bridge.snapshot.lock().unwrap().nodes.clone();
        let mut next = old.clone();
        let root = next.get_mut(&NodeId(1)).unwrap();
        root.set_state_description("awake");
        root.set_children(vec![NodeId(2), NodeId(3)]);
        let button = next.get_mut(&NodeId(2)).unwrap();
        button.set_label("Send");
        button.set_disabled();
        button.set_value("hello");
        next.insert(NodeId(3), Node::new(Role::Label));
        let changed = changes(&old, &next, NodeId(1));
        for expected in [
            (NodeId(1), UIA_HelpTextPropertyId),
            (NodeId(2), UIA_NamePropertyId),
            (NodeId(2), UIA_IsEnabledPropertyId),
            (NodeId(2), UIA_ValueValuePropertyId),
        ] {
            assert!(changed.properties.contains(&expected));
        }
        assert!(changed.structures.contains(&NodeId(1)));
        let unchanged = changes(&next, &next, NodeId(1));
        assert!(unchanged.properties.is_empty());
        assert!(unchanged.structures.is_empty());
    }
    #[test]
    fn uia_text_document_caret_and_ranges_share_accesskit_field() {
        let bridge = bridge();
        let mut field = Node::new(Role::TextInput);
        field.set_value("a🦊b");
        field.add_action(Action::SetValue);
        field.add_action(Action::SetTextSelection);
        field.set_text_selection(accesskit::TextSelection {
            anchor: accesskit::TextPosition {
                node: crate::accessibility::FIELD_TEXT,
                character_index: 1,
            },
            focus: accesskit::TextPosition {
                node: crate::accessibility::FIELD_TEXT,
                character_index: 2,
            },
        });
        {
            let mut state = bridge.snapshot.lock().unwrap();
            state.nodes.insert(NodeId(3), field);
            state.focus = NodeId(3);
        }
        let raw = bridge.provider(NodeId(3));
        unsafe {
            let text: ITextProvider = raw
                .GetPatternProvider(UIA_TextPatternId)
                .unwrap()
                .cast()
                .unwrap();
            let document = text.DocumentRange().unwrap();
            assert_eq!(document.GetText(-1).unwrap().to_string(), "a🦊b");
            let clone = document.Clone().unwrap();
            clone
                .MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, 1)
                .unwrap();
            assert_eq!(clone.GetText(-1).unwrap().to_string(), "🦊b");
            assert_eq!(document.GetText(-1).unwrap().to_string(), "a🦊b");
            let text2: ITextProvider2 = raw
                .GetPatternProvider(UIA_TextPattern2Id)
                .unwrap()
                .cast()
                .unwrap();
            let mut active = BOOL(0);
            let caret = text2.GetCaretRange(&mut active).unwrap();
            assert!(active.as_bool());
            assert_eq!(
                caret
                    .CompareEndpoints(
                        TextPatternRangeEndpoint_Start,
                        &document,
                        TextPatternRangeEndpoint_Start
                    )
                    .unwrap(),
                3
            );
            let array = text.GetSelection().unwrap();
            let mut selected = std::ptr::null_mut();
            SafeArrayGetElement(array, &0, (&mut selected as *mut *mut c_void).cast()).unwrap();
            let selected = ITextRangeProvider::from_raw(selected);
            assert_eq!(selected.GetText(-1).unwrap().to_string(), "🦊");
            SafeArrayDestroy(array).unwrap();
            let needle = BSTR::from("absent");
            let mut output = 1usize as *mut c_void;
            let status = (document.vtable().FindText)(
                document.as_raw(),
                std::mem::transmute_copy(&needle),
                BOOL(0),
                BOOL(0),
                &mut output,
            );
            assert_eq!(status, windows::core::HRESULT(0));
            assert!(output.is_null());
            assert!(!bool::try_from(
                &document
                    .GetAttributeValue(UIA_IsReadOnlyAttributeId)
                    .unwrap()
            )
            .unwrap());
            let value: IValueProvider = raw.cast().unwrap();
            assert!(!value.IsReadOnly().unwrap().as_bool());
            {
                let mut state = bridge.snapshot.lock().unwrap();
                let field = state.nodes.get_mut(&NodeId(3)).unwrap();
                field.set_disabled();
                field.set_text_selection(accesskit::TextSelection {
                    anchor: accesskit::TextPosition {
                        node: crate::accessibility::FIELD_TEXT,
                        character_index: 2,
                    },
                    focus: accesskit::TextPosition {
                        node: crate::accessibility::FIELD_TEXT,
                        character_index: 1,
                    },
                });
            }
            assert!(bool::try_from(
                &document
                    .GetAttributeValue(UIA_IsReadOnlyAttributeId)
                    .unwrap()
            )
            .unwrap());
            assert!(value.IsReadOnly().unwrap().as_bool());
            assert!(document
                .FindAttribute(UIA_IsReadOnlyAttributeId, &VARIANT::from(true), BOOL(0))
                .is_ok());
            let caret = text2.GetCaretRange(&mut active).unwrap();
            assert_eq!(
                caret
                    .CompareEndpoints(
                        TextPatternRangeEndpoint_Start,
                        &document,
                        TextPatternRangeEndpoint_Start
                    )
                    .unwrap(),
                1
            );
        }
    }
}
