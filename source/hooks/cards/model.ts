// The deck's plain data. The shapes are declared in plugin/types/index.d.ts (the $.state contract the engine checks,
// which must stand alone) under names that say they are the cards'; this module gives them their short names for the
// rest of cards/ and holds the defaults and store keys.
import type { CardsCoco as CocoState, CardsPane as PaneState } from '../../types'

export type {
  CardKind as Kind, CardSource as Source, SkillCard as Card, CardUse as Use, CardUsage as Usage, CardsView as View,
  CardKindFilter as KindFilter, CardsBookSort as BookSort, CardsPane as PaneState, CardsCatalog as Catalog,
  CardsLayer as Layer, CardsCoco as CocoState,
} from '../../types'

export const STORE_USAGE = 'cards.usage'
export const STORE_PREFS = 'cards.prefs'

export const PANE_DEFAULT: PaneState = { view: 'box', kind: 'all', query: '', sort: 'group', pulled: null, isMotionOff: false, fresh: [] }
export const COCO_DEFAULT: CocoState = { restSince: 0, play: 0, move: null, layers: [], queued: [] }
