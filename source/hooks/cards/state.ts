// The engine's atom, read and update, written over $.state here: Coco's build lets no chunk import 'claude-code' at
// run time (tools/hooks-bundle/split-graph.ts refuses it), so the cards cannot take the engine's own helpers.
import type { EngineInterface, PluginState } from 'claude-code'

type Key = 'cardsCatalog' | 'cardsUsage' | 'cardsTray' | 'cardsPane' | 'cardsCoco'
type Value<K extends Key> = PluginState['coco'][K]
type Held = { value?: unknown; version: number }
type State = Pick<EngineInterface, 'state'>

/** One of the cards' values in Coco's state, read as `initial` while nothing is written. */
export type Atom<K extends Key> = { readonly ref: { readonly plugin: 'coco'; readonly key: K }; readonly initial: Value<K> }

export function atom<K extends Key>(ref: { readonly plugin: 'coco'; readonly key: K }, initial: Value<K>): Atom<K> {
  return { ref, initial }
}

// `claude plugin validate` lists what a module reads and writes, so $.state takes only references spelled out in this
// file: each key gets its own call.
const CATALOG = { plugin: 'coco', key: 'cardsCatalog' } as const
const USAGE = { plugin: 'coco', key: 'cardsUsage' } as const
const TRAY = { plugin: 'coco', key: 'cardsTray' } as const
const PANE = { plugin: 'coco', key: 'cardsPane' } as const
const COCO = { plugin: 'coco', key: 'cardsCoco' } as const

function get($: State, key: Key): Promise<Held> {
  switch (key) {
    case 'cardsCatalog': return $.state.get(CATALOG)
    case 'cardsUsage': return $.state.get(USAGE)
    case 'cardsTray': return $.state.get(TRAY)
    case 'cardsPane': return $.state.get(PANE)
    case 'cardsCoco': return $.state.get(COCO)
  }
}

function set($: State, key: Key, value: unknown, ifVersion: number): Promise<{ isSet: boolean }> {
  switch (key) {
    case 'cardsCatalog': return $.state.set(CATALOG, value as Value<'cardsCatalog'>, { ifVersion })
    case 'cardsUsage': return $.state.set(USAGE, value as Value<'cardsUsage'>, { ifVersion })
    case 'cardsTray': return $.state.set(TRAY, value as Value<'cardsTray'>, { ifVersion })
    case 'cardsPane': return $.state.set(PANE, value as Value<'cardsPane'>, { ifVersion })
    case 'cardsCoco': return $.state.set(COCO, value as Value<'cardsCoco'>, { ifVersion })
  }
}

/** The value, or the initial while none is written. Read while a drawing is made, it draws that again on a write. */
export async function read<K extends Key>($: State, a: Atom<K>): Promise<Value<K>> {
  return ((await get($, a.ref.key)).value ?? a.initial) as Value<K>
}

/** Applies `change` and writes the result at the version it read, trying again on a miss; resolves what it wrote. */
export async function update<K extends Key>($: State, a: Atom<K>, change: (value: Value<K>) => Value<K>): Promise<Value<K>> {
  for (;;) {
    const held = await get($, a.ref.key)
    const value = change((held.value ?? a.initial) as Value<K>)
    if ((await set($, a.ref.key, value, held.version)).isSet) return value
  }
}

/** How many cards the deck holds once dealt, for the button at the top of the bag (owner 10-19); undefined until then. */
export async function dealtCards($: State): Promise<number | undefined> {
  const c = (await get($, 'cardsCatalog')).value as Value<'cardsCatalog'> | undefined
  return c?.status === 'ready' ? c.cards.length : undefined
}
