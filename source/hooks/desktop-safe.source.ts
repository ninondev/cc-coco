import type { RenderElement } from 'claude-code'
import type { CocoView as View, CostSurfaceSnapshot } from '../types'
import { LANGS } from './words'
import {displaySlots,untrustedDisplaySlot} from './display-slots'

// 2.1.286's serialized desktop tree contract. No engine calls, art imports or
// retained element/handler instances: validation is local to this one answer.
export const DESKTOP_LIMITS = {
  text: 10_000, svg: Math.floor(131_072 * .9), markdownImage: 9_000,
  depth: 32, nodes: 2_048, characters: 262_144,
} as const

export class DesktopTreeError extends Error {
  constructor(code: string) { super(`desktop-tree:${code}`); this.name = 'DesktopTreeError' }
}
function fail(code: string): never { throw new DesktopTreeError(code) }
const controls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/
const allControls = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/
type RecordValue = Record<string, unknown>
type Rule = (value: unknown) => boolean
const finite: Rule = value => typeof value === 'number' && Number.isFinite(value)
const integer: Rule = value => finite(value) && Number.isInteger(value)
const nonnegative: Rule = value => finite(value) && (value as number) >= 0
const bool: Rule = value => typeof value === 'boolean'
const yes: Rule = value => value === true
// Constructors expose these closures until the dispatch serializes their press
// handles. They are not sent to the host; arbitrary function props stay refused.
const callback: Rule = value => typeof value === 'function'
const str: Rule = value => typeof value === 'string' && value.length <= DESKTOP_LIMITS.text && !allControls.test(value)
const textValue: Rule = value => typeof value === 'string' && value.length <= DESKTOP_LIMITS.text && !controls.test(value)
const dimension: Rule = value => nonnegative(value) || str(value)
const oneOf = (...values: string[]): Rule => value => typeof value === 'string' && values.includes(value)
// A Client's props cross to its surface module as JSON: plain data only, at most 100000 characters serialized.
const plainData = (value: unknown, depth: number): boolean => value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)
  || depth < 8 && (Array.isArray(value) ? value.length <= 256 && value.every(item => plainData(item, depth + 1)) : record(value) && Object.keys(value).length <= 64 && Object.values(value).every(item => plainData(item, depth + 1)))
const plain: Rule = value => { try { return plainData(value, 0) && JSON.stringify(value).length <= 100_000 } catch { return false } }
const record = (value: unknown): value is RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
const textStyles: Record<string, Rule> = {
  color: str, backgroundColor: str, dimColor: bool, bold: bool, italic: bool,
  underline: bool, strikethrough: bool, inverse: bool,
}
const boxProps: Record<string, Rule> = {
  key: str, position: oneOf('relative', 'absolute'), top: integer, left: integer, right: integer, bottom: integer,
  flexDirection: oneOf('row', 'column', 'row-reverse', 'column-reverse'), flexGrow: nonnegative, flexShrink: nonnegative,
  flexWrap: oneOf('nowrap', 'wrap', 'wrap-reverse'), alignItems: oneOf('flex-start', 'center', 'flex-end', 'stretch'),
  alignSelf: oneOf('flex-start', 'center', 'flex-end', 'auto'),
  justifyContent: oneOf('flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'),
  gap: nonnegative, columnGap: nonnegative, rowGap: nonnegative,
  width: dimension, height: dimension, minWidth: dimension, minHeight: dimension,
  margin: finite, marginX: finite, marginY: finite, marginTop: finite, marginBottom: finite, marginLeft: finite, marginRight: finite,
  padding: nonnegative, paddingX: nonnegative, paddingY: nonnegative, paddingTop: nonnegative, paddingBottom: nonnegative,
  paddingLeft: nonnegative, paddingRight: nonnegative, borderStyle: str, borderColor: str,
  borderDimColor: bool, backgroundColor: str, overflow: oneOf('visible', 'hidden'), display: oneOf('flex', 'none'),
}
// 2.1.302's Text adds size, weight, mono, tabular and dir; the engine also gives a bold Text with no weight
// weight 'semibold' as the tree crosses
const textProps = {
  ...textStyles, size: oneOf('caption', 'footnote', 'body', 'heading', 'title'), weight: oneOf('regular', 'medium', 'semibold', 'bold'),
  mono: bool, tabular: bool, dir: oneOf('ltr', 'rtl'), wrap: oneOf('wrap', 'end', 'middle', 'truncate', 'truncate-start', 'truncate-middle', 'truncate-end') }
const scope: Rule = value => typeof value === 'string' && value.length >= 1 && value.length <= 64 && !allControls.test(value)
const textHover = { ...textStyles, scope }
const boxHover = { scope, borderStyle: str, borderColor: str, borderDimColor: bool, backgroundColor: str, display: oneOf('flex'), top: integer, left: integer, right: integer, bottom: integer }
const schemas: Record<string, Record<string, Rule>> = {
  Box: boxProps, Text: textProps,
  Button: { key: str, label: str, hotkey: value => typeof value === 'string' && /^[a-z0-9]$/.test(value), action: str, plain: yes, dimColor: bool, variant: oneOf('primary', 'secondary'), role: oneOf('dismiss'), autoFocus: yes },
  Input: { key: str, label: str, placeholder: str, value: str, submitLabel: str, autoFocus: yes },
  Select: { key: str, label: str, options: Array.isArray, value: str, autoFocus: yes },
  Link: { href: str, label: str },
  Code: { source: textValue, language: str, path: str, startLine: value => integer(value) && (value as number) >= 1, format: oneOf('source', 'diff'), wrap: oneOf('wrap', 'truncate-end') },
  Markdown: { key: str, text: textValue, dimColor: bool, pressableLinks: Array.isArray },
  Svg: { source: value => typeof value === 'string', alt: str, width: nonnegative, height: nonnegative, isInteractive: bool },
  // 2.1.299's surface module region: the band's touch layer over her picture (10-18)
  Client: { key: str, module: value => typeof value === 'string' && /^(?:\.\/|hooks\/)[a-z0-9-]+\.(?:tsx?|jsx?|mjs)$/.test(value), props: plain, width: dimension, height: dimension, flexGrow: nonnegative },
}

// Reads only own data properties. Accessors/proxies are outside RenderElement's
// plain-data contract; errors here are caught by the caller's fallback ladder.
function fields(value: RecordValue, allowed: Record<string, Rule>): void {
  const keys = Object.keys(value)
  if (keys.length > 64) fail('props-count')
  for (const key of keys) {
    const own = Object.getOwnPropertyDescriptor(value, key)
    if (!own || !('value' in own)) fail('accessor')
    if (own.value !== undefined && (!Object.hasOwn(allowed, key) || !allowed[key]!(own.value))) fail('prop:' + key + ':' + typeof own.value)
  }
}
function handle(value: unknown): void {
  if (!record(value)) fail('press')
  fields(value, { plugin: str, handle: nonnegative })
  if (typeof value.plugin !== 'string' || !integer(value.handle)) fail('press')
}

export function validateDesktopTree(tree: unknown): void {
  const active = new Set<object>(), keys = new Set<string>()
  let count = 0, characters = 0
  function text(value: unknown, max: number = DESKTOP_LIMITS.text): asserts value is string {
    if (typeof value !== 'string' || value.length > max || controls.test(value)) fail('text')
    characters += value.length
    if (characters > DESKTOP_LIMITS.characters) fail('characters')
  }
  function visit(node: unknown, depth: number, inline = false, keyedScope = false): void {
    if (++count > DESKTOP_LIMITS.nodes || depth > DESKTOP_LIMITS.depth) fail('complexity')
    if (typeof node === 'string') { text(node); return }
    if (!record(node) || active.has(node)) fail('node')
    active.add(node)
    try {
      if (node.type === 'engine') {
        fields(node, { type: oneOf('engine'), ref: nonnegative })
        if (!integer(node.ref) || inline) fail('engine')
        return
      }
      if (typeof node.type !== 'string' || !Object.hasOwn(schemas, node.type)) fail('element')
      const type = node.type
      if (inline && type !== 'Text' && type !== 'Link') fail('inline')
      fields(node, {
        type: oneOf(type), props: record, children: Array.isArray,
        ...(type === 'Box' || type === 'Text' || type === 'Button' ? { hover: record } : {}),
        // 2.1.302 stamps each ui.render hook's returned root Box or Text with whose part of the drawing starts there
        ...(type === 'Box' || type === 'Text' ? { group: record, part: record } : {}),
        ...(['Button', 'Input', 'Select', 'Markdown'].includes(type) ? { press: record } : {}),
        // the runtime stamps whose surface module a Client names as the tree leaves the hook
        ...(type === 'Client' ? { client: record } : {}),
        ...(type === 'Button' ? { onPress: callback } : {}),
        // Input's synchronous constructor combines onInput/onSubmit into its
        // private onEvent closure before the dispatcher stamps the handle.
        ...(type === 'Input' ? { onInput: callback, onSubmit: callback, onEvent: callback } : {}),
        ...(type === 'Select' ? { onSelect: callback, onEvent: callback } : {}),
        ...(type === 'Markdown' ? { onLinkPress: callback, onEvent: callback } : {}),
      })
      const props = node.props === undefined && (type === 'Box' || type === 'Text') ? {} : node.props
      if (!record(props)) fail('props')
      fields(props, schemas[type]!)
      if (props.key !== undefined) {
        if (typeof props.key !== 'string' || keys.has(props.key)) fail('key')
        keys.add(props.key)
      }
      const childScope = keyedScope || (type === 'Box' && typeof props.key === 'string' && props.key.length > 0)
      if (node.hover !== undefined) {
        if (!record(node.hover)) fail('hover')
        fields(node.hover, type === 'Box' ? boxHover : textHover)
        if (!childScope && node.hover.scope === undefined) fail('hover-scope')
        if (node.hover.display !== undefined && props.display !== 'none') fail('hover-display')
        if (['top', 'left', 'right', 'bottom'].some(key => node.hover && (node.hover as RecordValue)[key] !== undefined) && props.position !== 'absolute') fail('hover-position')
      }
      if (node.group !== undefined) {
        if (!record(node.group)) fail('group')
        fields(node.group, { plugin: str })
        if (typeof node.group.plugin !== 'string') fail('group')
      }
      if (node.part !== undefined) {
        if (!record(node.part)) fail('part')
        fields(node.part, { plugin: str })
        if (typeof node.part.plugin !== 'string') fail('part')
      }
      if (['Button', 'Input', 'Select'].includes(type)) {
        if (typeof props.key !== 'string' || !props.key.length) fail('key')
        handle(node.press)
      } else if (node.press !== undefined) {
        handle(node.press)
        if (typeof props.key !== 'string' || !props.key.length) fail('key')
      }
      if (type === 'Button' && (props.label !== undefined || !Array.isArray(node.children) || !node.children.length)) text(props.label)
      if (type === 'Client') {
        if (typeof props.key !== 'string' || !props.key.length || typeof props.module !== 'string' || inline) fail('client')
        if (node.client !== undefined) { fields(node.client as RecordValue, { plugin: str }); if (typeof (node.client as RecordValue).plugin !== 'string') fail('client') }
      }
      if (type === 'Select') {
        if (!Array.isArray(props.options) || !props.options.length || props.options.length > 256) fail('options')
        const values = new Set<string>()
        for (const option of props.options) {
          if (!record(option)) fail('option')
          fields(option, { value: str, label: str })
          text(option.value)
          if (values.has(option.value)) fail('option-duplicate')
          values.add(option.value)
          if (option.label !== undefined) text(option.label)
        }
        if (props.value !== undefined && !values.has(props.value as string)) fail('option-value')
      }
      if (type === 'Svg') {
        text(props.source, DESKTOP_LIMITS.svg)
        text(props.alt)
        if (!/^\s*<svg\b[\s\S]*<\/svg>\s*$/.test(props.source) || /data:image\/[a-z+]+;base64,(?:undefined|null)(?:["')\s]|$)/.test(props.source)) fail('svg-source')
      }
      if (type === 'Markdown') {
        text(props.text)
        // Bound the complete image-bearing Markdown string, including the
        // link overlay wrapper, rather than only its encoded data payload.
        if (/!\[[\s\S]*?\]\(/.test(props.text) && props.text.length > DESKTOP_LIMITS.markdownImage) fail('markdown-image')
        if (props.pressableLinks !== undefined) {
          if (!node.press || !Array.isArray(props.pressableLinks) || props.pressableLinks.length > 256) fail('links')
          for (const link of props.pressableLinks) text(link, 2048)
        }
      }
      if (type === 'Code') text(props.source)
      if (type === 'Link') {
        if (typeof props.href !== 'string' || props.href.length > 2048 || /[^\x21-\x7e]|@/.test(props.href)) fail('href')
        const match = /^(https:\/\/[^/?#]+|http:\/\/localhost(?::\d+)?)(?:[/?#]|$)/.exec(props.href)
        if (!match) fail('href')
        try { if (new URL(props.href).href !== props.href) fail('href') } catch { fail('href') }
      }
      if (type === 'Client' && Array.isArray(node.children) && !node.children.length) return
      if (node.children !== undefined) {
        if (!['Box', 'Text', 'Link', 'Button'].includes(type) || !Array.isArray(node.children)) fail('children')
        if (node.children.length > DESKTOP_LIMITS.nodes) fail('complexity')
        // 2.1.299 draws a Button's strings and Text children in place of its label, one press wherever it lands
        if (type === 'Button' && node.children.some(child => typeof child !== 'string' && (!record(child) || child.type !== 'Text'))) fail('button-children')
        if (type === 'Text') {
          const joined = node.children.filter(child => typeof child === 'string').join('')
          if (joined.length > DESKTOP_LIMITS.text) fail('text')
        }
        for (const child of node.children) visit(child, depth + 1, type === 'Text' || type === 'Link' || type === 'Button', childScope)
      }
    } finally { active.delete(node) }
  }
  visit(tree, 0)
}

export function safeDesktopTree(full: () => RenderElement, still: () => RenderElement, name: () => RenderElement): { tree: RenderElement; fallback: 'full' | 'still' | 'name'; validationMs: number } {
  let validationMs = 0
  for (const [fallback, build] of [['full', full], ['still', still], ['name', name]] as const) {
    try {
      const tree = build(), began = Date.now()
      try { validateDesktopTree(tree) } finally { validationMs += Date.now() - began }
      return { tree, fallback, validationMs }
    } catch { /* proceed to the next bounded tier */ }
  }
  // This last defense contains no constructors, state, handlers or I/O. It is
  // regenerated per request; it cannot retain another activation's handles.
  return { tree: { type: 'Text', children: ['Coco'] }, fallback: 'name', validationMs }
}

const moods = ['idle', 'think', 'work', 'happy', 'waiting', 'question', 'error', 'wild', 'refuse', 'flustered', 'sleep', 'wave', 'snake']
const languages = LANGS.map(language => language.code)
const enumValue = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => typeof value === 'string' && values.includes(value as T) ? value as T : fallback
const safeText = (value: unknown, fallback: string): string => typeof value === 'string' ? value.slice(0, DESKTOP_LIMITS.text + 1) : fallback

export function normalizeDesktopSettings(input: unknown): RecordValue {
  if (!record(input)) return {}
  const result: RecordValue = {}
  for (const key of Object.keys(input).slice(0, 64)) {
    const own = Object.getOwnPropertyDescriptor(input, key)
    if (own && 'value' in own) result[key] = own.value
  }
  return result
}

export function normalizeCostSurface(input: unknown): CostSurfaceSnapshot | undefined {
  const data=normalizeDesktopSettings(input),billing=normalizeDesktopSettings(data.billing),cache=normalizeDesktopSettings(data.cache)
  const amount=(n:unknown):n is number=>nonnegative(n)&&(n as number)<=Number.MAX_SAFE_INTEGER
  const count=(n:unknown):n is number=>amount(n)&&Number.isInteger(n)
  const at=(n:unknown):n is number=>amount(n)&&(n as number)<=253402300799999
  const kinds=['plan','credits','api','cloud','gateway','unknown'] as const
  const states=['warm','cooling','cold','kept'] as const
  if(!kinds.includes(billing.kind as never)||!states.includes(cache.state as never)||typeof cache.observed!=='boolean'||typeof data.warmEnabled!=='boolean'||!at(cache.sentAt)||!at(cache.warmUntil)||cache.warmUntil<cache.sentAt||![300000,3600000].includes(cache.ttlMs as number)||!count(cache.prefix))return undefined
  const safe:CostSurfaceSnapshot={billing:{kind:billing.kind as CostSurfaceSnapshot['billing']['kind'],...(billing.organisation===true?{organisation:true}:{}),...(billing.otherMaker===true?{otherMaker:true}:{})},cache:{observed:cache.observed,state:cache.state as CostSurfaceSnapshot['cache']['state'],sentAt:cache.sentAt,warmUntil:cache.warmUntil,ttlMs:cache.ttlMs as number,prefix:cache.prefix,...(typeof cache.shown==='boolean'?{shown:cache.shown}:{})},warmEnabled:data.warmEnabled}
  if(typeof data.model==='string'&&data.model.length<=128&&!allControls.test(data.model))safe.model=data.model
  for(const key of ['warmUSD','coldUSD','deltaUSD'] as const)if(amount(cache[key]))safe.cache[key]=cache[key]
  const kept=normalizeDesktopSettings(cache.kept)
  if(at(kept.since)&&at(kept.stopAt)&&count(kept.pings)&&amount(kept.usd))safe.cache.kept={since:kept.since,stopAt:kept.stopAt,pings:kept.pings,usd:kept.usd}
  if(safe.cache.state==='kept'&&!safe.cache.kept)safe.cache.state='warm'
  if(amount(data.sessionUSD))safe.sessionUSD=data.sessionUSD
  if(typeof data.sessionEstimated==='boolean')safe.sessionEstimated=data.sessionEstimated
  const maker=normalizeDesktopSettings(data.makerEstimate)
  if(amount(maker.turnUSD)||amount(maker.sessionUSD))safe.makerEstimate={...(amount(maker.turnUSD)?{turnUSD:maker.turnUSD}:{}),...(amount(maker.sessionUSD)?{sessionUSD:maker.sessionUSD}:{})}
  const turn=normalizeDesktopSettings(data.lastTurn),window=normalizeDesktopSettings(turn.window)
  if(amount(turn.usd)){
    safe.lastTurn={usd:turn.usd,...(turn.estimated===true?{estimated:true}:{})}
    if((window.kind==='5h'||window.kind==='7d')&&amount(window.from)&&amount(window.to)&&window.from<=100&&window.to<=100)safe.lastTurn.window={kind:window.kind,from:window.from,to:window.to}
  }
  for(const key of ['ownCalls','misses'] as const){const item=normalizeDesktopSettings(data[key]);if(count(item.count)&&amount(item.usd))safe[key]={count:item.count,usd:item.usd}}
  const ledger=normalizeDesktopSettings(data.ledger)
  if(amount(ledger.day)&&amount(ledger.week)&&amount(ledger.month))safe.ledger={day:ledger.day,week:ledger.week,month:ledger.month}
  return safe
}

export function normalizeDesktopView(input: unknown, defaults: View, frameNames: readonly string[]): View {
  const data = normalizeDesktopSettings(input)
  const view: View = {
    ...defaults,
    lang: enumValue(data.lang, languages, defaults.lang),
    mood: enumValue(data.mood, moods as View['mood'][], 'idle'),
    frame: enumValue(data.frame, frameNames as readonly View['frame'][], 'idle-reading'),
    band: enumValue(data.band, ['on', 'compact', 'off', 'text'], defaults.band),
    voice: enumValue(data.voice, ['off', 'light', 'full'], defaults.voice),
    affection: enumValue(data.affection, ['warm', 'clingy'], defaults.affection),
    ...(data.companionTarget !== undefined || defaults.companionTarget !== undefined ?
      { companionTarget: enumValue(data.companionTarget, ['auto', 'claude', 'vscode'] as const, defaults.companionTarget ?? 'auto') } : {}),
    ...(data.neighbours !== undefined || defaults.neighbours !== undefined ?
      { neighbours: typeof data.neighbours === 'boolean' ? data.neighbours : defaults.neighbours ?? false } : {}),
    pictures: enumValue(data.pictures, ['cells', 'kitty'], defaults.pictures),
    colors: enumValue(data.colors, ['truecolor', '256'], defaults.colors),
    workSize: enumValue(data.workSize, ['same', 'smaller'] as const, defaults.workSize ?? 'same'),
    said: data.said === null || data.said === undefined ? null : safeText(data.said, ''),
    context: finite(data.context) ? Math.max(0, Math.min(100, data.context as number)) : null,
    estimate: typeof data.estimate === 'boolean' ? data.estimate : defaults.estimate,
    ...(finite(data.contextTokens) && (data.contextTokens as number) >= 0 ? { contextTokens: data.contextTokens as number } : {}),
    ...(finite(data.contextWindow) && (data.contextWindow as number) > 0 ? { contextWindow: data.contextWindow as number } : {}),
    // The DM thread's unread count for the band's DM entry (lane C, dm.ts): a whole number, at most 999.
    ...(data.dm && typeof data.dm === 'object' && finite((data.dm as { unread?: unknown }).unread) && Number.isInteger((data.dm as { unread: number }).unread) && (data.dm as { unread: number }).unread >= 0 ? { dm: { unread: Math.min(999, (data.dm as { unread: number }).unread) } } : {}),
    verb: safeText(data.verb, defaults.verb), cue: safeText(data.cue, defaults.cue),
  }
  if (typeof data.theme === 'string') view.theme = safeText(data.theme, '')
  else if (data.theme !== undefined) delete view.theme
  const cost=normalizeCostSurface(data.cost)
  if(cost)view.cost=cost
  else delete view.cost
  if (data.bandBeforeOff === 'on' || data.bandBeforeOff === 'compact' || data.bandBeforeOff === 'text') view.bandBeforeOff = data.bandBeforeOff
  if (data.touch === 'poke' || data.touch === 'pat' || data.touch === 'burst') view.touch = data.touch
  else delete view.touch
  const quota = normalizeDesktopSettings(data.quota)
  if (Array.isArray(quota.rateLimits) && finite(quota.at)) {
    const rateLimits: NonNullable<View['quota']>['rateLimits'] = []
    for (const item of quota.rateLimits.slice(0, 32)) {
      const window = normalizeDesktopSettings(item)
      if (str(window.kind) && finite(window.percentUsed)) {
        rateLimits.push({ kind: window.kind as string, percentUsed: Math.max(0, Math.min(100, window.percentUsed as number)), ...(typeof window.resetsAt === 'string' && window.resetsAt.length <= 128 ? { resetsAt: window.resetsAt } : {}) })
      }
    }
    view.quota = { rateLimits, at: quota.at as number, ...(nonnegative(quota.costUSD) ? { costUSD: quota.costUSD as number } : {}), ...(nonnegative(quota.tokens) ? { tokens: quota.tokens as number } : {}) }
  } else delete view.quota
  const line=normalizeDesktopSettings(data.line)
  if(typeof line.text==='string'&&Array.isArray(line.slots)){
    const raw=line.slots.slice(0,12).flatMap(value=>{const slot=normalizeDesktopSettings(value);return typeof slot.value==='string'&&['path','test','todo','value','label'].includes(String(slot.kind))?[{value:slot.value,kind:slot.kind as 'path'|'test'|'todo'|'value'|'label'}]:[]})
    const display=displaySlots(line.text,raw);line.text=display.text;line.slots=display.slots
  }
  if(str(line.id)&&str(line.key)&&textValue(line.text)&&[0,1,2,3].includes(Number(line.class))&&finite(line.expiresAt)) {
    view.line={...(str(line.callId)?{callId:line.callId as string}:{}),id:line.id as string,key:line.key as string,text:line.text as string,class:line.class as 0|1|2|3,expiresAt:line.expiresAt as number}
    if(Array.isArray(line.slots))view.line.slots=line.slots.slice(0,12).flatMap(raw=>{const s=normalizeDesktopSettings(raw);return str(s.value)&&['path','test','todo','value','label'].includes(String(s.kind))?[{value:s.value as string,kind:s.kind as 'path'|'test'|'todo'|'value'|'label'}]:[]})
    const button=normalizeDesktopSettings(line.button)
    if(str(button.key)&&str(button.label))view.line.button={key:button.key as string,label:button.label as string}
    if(Array.isArray(line.buttons))view.line.buttons=line.buttons.slice(0,2).flatMap(raw=>{const button=normalizeDesktopSettings(raw);return str(button.key)&&str(button.label)?[{key:button.key as string,label:button.label as string}]:[]})
  }
  const pose=normalizeDesktopSettings(data.pose)
  if(str(pose.name)&&str(pose.frame)&&str(pose.aside)&&finite(pose.at))view.pose={name:pose.name as string,frame:pose.frame as string,aside:pose.aside as string,at:pose.at as number,...(finite(pose.longAt)?{longAt:pose.longAt as number}:{}),...(finite(pose.celebration)?{celebration:pose.celebration as number}:{})}
  if(Array.isArray(data.moreActions))view.moreActions=data.moreActions.slice(0,3).flatMap(raw=>{const button=normalizeDesktopSettings(raw);return str(button.key)&&str(button.label)?[{key:button.key as string,label:button.label as string}]:[]})
  if(Array.isArray(data.spentWindows))view.spentWindows=data.spentWindows.filter(str).slice(0,32) as string[]
  const spentResets=normalizeDesktopSettings(data.spentResets)
  if(data.spentResets!==undefined)view.spentResets=Object.fromEntries(Object.entries(spentResets).filter(([key,value])=>str(key)&&finite(value)).slice(0,32)) as Record<string,number>
  if(Array.isArray(data.hotWindows))view.hotWindows=data.hotWindows.filter(str).slice(0,2) as string[]
  if(Array.isArray(data.paceDetails))view.paceDetails=data.paceDetails.slice(0,2).flatMap(raw=>{const p=normalizeDesktopSettings(raw);return str(p.kind)&&str(p.wide)&&str(p.narrow)?[{kind:p.kind as string,wide:p.wide as string,narrow:p.narrow as string,t:str(p.t)?p.t as string:''}]:[]})
  const paceRates=normalizeDesktopSettings(data.paceRates)
  if(data.paceRates!==undefined)view.paceRates=Object.fromEntries(Object.entries(paceRates).filter(([key,value])=>str(key)&&finite(value)&&(value as number)>0).slice(0,4)) as Record<string,number>
  if(str(data.neighbourBusyLabel))view.neighbourBusyLabel=data.neighbourBusyLabel as string
  const neighbours=normalizeDesktopSettings(data.neighbourLights)
  if(neighbours.v===1&&neighbours.running===true&&Array.isArray(neighbours.agents))view.neighbourLights={v:1,running:true,agents:neighbours.agents.slice(0,32).flatMap(raw=>{const n=normalizeDesktopSettings(raw);return str(n.id)&&typeof n.label==='string'?[{id:n.id as string,label:untrustedDisplaySlot(n.label),busy:n.busy===true,partial:n.partial===true,...(finite(n.startedAt)?{startedAt:n.startedAt as number}:{}),...(record(n.quota)?{quota:n.quota as NonNullable<View['neighbourLights']>['agents'][number]['quota']}:{})}]:[]})}
  const ribbon=normalizeDesktopSettings(data.ribbon)
  if(integer(ribbon.index)&&(ribbon.index as number)>=1&&(ribbon.index as number)<=14&&str(ribbon.folder)&&bool(ribbon.visible))view.ribbon={index:ribbon.index as number,folder:ribbon.folder as string,visible:ribbon.visible as boolean,...(finite(ribbon.tiedAt)?{tiedAt:ribbon.tiedAt as number}:{}),...(nonnegative(ribbon.elapsed)?{elapsed:ribbon.elapsed as number}:{}),...(str(ribbon.alt)?{alt:ribbon.alt as string}:{})}
  const place=normalizeDesktopSettings(data.place)
  if(integer(place.i)&&integer(place.n)&&integer(place.dip)&&(place.n as number)>=2&&(place.n as number)<=999&&(place.i as number)>=1&&(place.i as number)<=(place.n as number)&&(place.dip as number)>=0&&str(place.subject))
    view.place={i:place.i as number,n:place.n as number,subject:(place.subject as string).slice(0,40),dip:place.dip as number,...(str(place.short)?{short:place.short as string}:{}),...(str(place.text)?{text:place.text as string}:{}),...(str(place.alt)?{alt:place.alt as string}:{})}
  const costume=normalizeDesktopSettings(data.costume)
  if(costume.rain===true||costume.glasses===true||costume.bow===true)view.costume={...(costume.rain===true?{rain:true as const}:{}),...(costume.glasses===true?{glasses:true as const}:{}),...(costume.bow===true?{bow:true as const}:{})}
  for(const key of ['helpersAlt','helpersCountText','stageDirection'] as const)if(str(data[key]))view[key]=data[key] as string
  if(integer(data.helpersCount)&&(data.helpersCount as number)>=0)view.helpersCount=data.helpersCount as number
  if(Array.isArray(data.helpers))view.helpers=data.helpers.slice(0,64).flatMap(raw=>{const h=normalizeDesktopSettings(raw);return str(h.id)&&finite(h.at)&&['running','done','failed','stopped'].includes(String(h.state))?[{id:h.id as string,at:h.at as number,state:h.state as 'running'|'done'|'failed'|'stopped',...(finite(h.arrivalAt)?{arrivalAt:h.arrivalAt as number}:{}),...(finite(h.leavingAt)?{leavingAt:h.leavingAt as number}:{}),...(nonnegative(h.elapsed)?{elapsed:h.elapsed as number}:{})}]:[]})
  if(bool(data.d1ReducedMotion))view.d1ReducedMotion=data.d1ReducedMotion as boolean
  const shed=normalizeDesktopSettings(data.shed)
  if(str(shed.id)&&finite(shed.at)&&['begin','end','skip'].includes(String(shed.phase)))view.shed={id:shed.id as string,at:shed.at as number,phase:shed.phase as 'begin'|'end'|'skip'}
  if(data.outfit==='A'||data.outfit==='B')view.outfit=data.outfit;else delete view.outfit
  if(typeof data.socks==='string'&&/^[a-z]{2,24}$/.test(data.socks))view.socks=data.socks;else delete view.socks
  if(data.claudie==='dake'||data.claudie==='maid')view.claudie=data.claudie;else delete view.claudie
  const act=normalizeDesktopSettings(data.act)
  if(typeof act.key==='string'&&/^[a-z]{2,10}$/.test(act.key)&&finite(act.at))view.act={key:act.key,at:act.at as number};else delete view.act
  const play=normalizeDesktopSettings(data.play),playOut: NonNullable<View['play']> = {}
  if(finite(play.at))playOut.at=play.at as number
  const breath=normalizeDesktopSettings(play.breath)
  if(finite(breath.since))playOut.breath={since:breath.since as number,...(typeof breath.cell==='string'&&breath.cell.length<=2&&str(breath.cell)?{cell:breath.cell}:{}),...(bool(breath.still)?{still:breath.still as boolean}:{})}
  const stick=normalizeDesktopSettings(play.stick)
  if(finite(stick.startedAt)&&finite(stick.endsAt)&&(stick.endsAt as number)>(stick.startedAt as number)&&str(stick.until)&&str(stick.tag))playOut.stick={startedAt:stick.startedAt as number,endsAt:stick.endsAt as number,until:stick.until as string,tag:stick.tag as string,...(finite(stick.endedAt)?{endedAt:stick.endedAt as number}:{})}
  const wait=normalizeDesktopSettings(play.wait)
  if(finite(wait.at)&&str(wait.time))playOut.wait={at:wait.at as number,time:wait.time as string,...(finite(wait.resetsAt)?{resetsAt:wait.resetsAt as number}:{})}
  const relit=normalizeDesktopSettings(play.relit)
  if(finite(relit.at)&&bool(relit.turn))playOut.relit={at:relit.at as number,turn:relit.turn as boolean}
  if(finite(play.out))playOut.out=play.out as number
  const drag=normalizeDesktopSettings(play.drag)
  if(integer(drag.dx)&&(drag.dx as number)>=0&&(drag.dx as number)<=12&&finite(drag.at))playOut.drag={dx:drag.dx as number,at:drag.at as number,...(finite(drag.droppedAt)?{droppedAt:drag.droppedAt as number}:{}),...(drag.sigh===true?{sigh:true}:{})}
  const glance=normalizeDesktopSettings(play.glance)
  if(finite(glance.at)&&(glance.side==='left'||glance.side==='right'))playOut.glance={at:glance.at as number,side:glance.side}
  if(Object.keys(playOut).some(key=>key!=='at'))view.play=playOut
  return view
}
