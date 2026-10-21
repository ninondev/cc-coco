import type { ClientModule, ClientPointerEvent } from 'claude-code'

// The terminal's pointer over his picture: drag him a few cells, and a glance when the pointer
// comes onto him, and M1's pat and poke. Standalone on purpose, like every surface module: it imports nothing of the plugin.
export type PlayPost = { t: 'drag'; dx: number } | { t: 'drop'; dx: number } | { t: 'glance'; side: 'left' | 'right' } | { t: 'pat' | 'poke' }
export const DRAG_MAX = 12

export class DragPath {
  private down?: number
  private moved = false
  private dx = 0
  get dragging(): boolean { return this.down !== undefined && this.moved }
  // A press and release without moving is not a drag; two or more cells sideways is.
  pointer(e: ClientPointerEvent, columns: number): PlayPost | undefined {
    if (e.type === 'down') {
      if (e.button === 'left') { this.down = e.x; this.moved = false; this.dx = 0 }
      return undefined
    }
    if (e.type === 'move' && this.down !== undefined) {
      if (!this.moved && Math.abs(e.x - this.down) < 2) return undefined
      this.moved = true
      const dx = Math.max(0, Math.min(DRAG_MAX, e.x - this.down))
      if (dx === this.dx) return undefined
      this.dx = dx
      return { t: 'drag', dx }
    }
    if (e.type === 'up' && this.down !== undefined) {
      const dropped = this.moved ? { t: 'drop' as const, dx: this.dx } : undefined
      this.down = undefined; this.moved = false; this.dx = 0
      return dropped
    }
    if (e.type === 'enter' && this.down === undefined) return { t: 'glance', side: e.x < columns / 2 ? 'left' : 'right' }
    return undefined
  }
}

// M1's pat and poke, read from the same pointer: rubbing six cells within 800 ms is a pat, a press and release
// without moving within 400 ms is a poke; at most one every 600 ms. While a drag is under way nothing is a pat.
export class TouchPath {
 private start?:{x:number;y:number;at:number};private down?:{x:number;y:number;at:number};private distance=0;private moved=false;private last=-Infinity
 pointer(e:ClientPointerEvent,at:number,dragging=false):'pat'|'poke'|undefined {if(e.type==='leave'){this.start=undefined;this.down=undefined;this.distance=0;return}if(e.type==='down'){this.down={x:e.x,y:e.y,at};this.moved=false}if(e.type==='move'){if(this.down&&Math.abs(e.x-this.down.x)+Math.abs(e.y-this.down.y)>1)this.moved=true;if(!this.start||at-this.start.at>800){this.start={x:e.x,y:e.y,at};this.distance=0}else{this.distance+=Math.abs(e.x-this.start.x)+Math.abs(e.y-this.start.y);this.start={...this.start,x:e.x,y:e.y}}if(!dragging&&this.distance>=6&&at-this.last>=600){this.last=at;this.distance=0;this.start=undefined;return 'pat'}}if(e.type==='up'){const down=this.down;this.down=undefined;if(down&&!this.moved&&at-down.at<=400&&at-this.last>=600){this.last=at;return 'poke'}}return}
}

// The desktop band's touch layer (DECISIONS 1017): one client a row over her picture, each reporting a click on her (down and
// up within 400 ms, moving at most one cell) as a poke and every turn of a stroke back and forth (after a run of at least
// one cell) as a turn. The plugin counts the turns of all the rows together: rubbing her is two turns inside 1.5 s, and
// passing over her once is none. A press on one of the band's things is a click there.
export type DesktopPost = { t: 'poke' } | { t: 'turn' } | { t: 'press' } | { t: 'enter' } | { t: 'leave' }
export class TurnPath {
 private down?:{x:number;y:number;at:number};private stroke?:{x:number;dir:number;run:number;last:number}
 pointer(e:ClientPointerEvent,at:number,press=false):DesktopPost|undefined {
  const x=e.fine?.x??e.x
  // enter and leave go to the plugin too: the surface keeps a hover after the pointer has gone, until a redraw drops it
  if(e.type==='enter'||e.type==='leave'){this.stroke=undefined;if(e.type==='leave')this.down=undefined;return {t:e.type}}
  if(e.type==='down'){if(e.button===undefined||e.button==='left')this.down={x:e.x,y:e.y,at};return}
  if(e.type==='up'){const down=this.down;this.down=undefined;if(down&&Math.abs(e.x-down.x)+Math.abs(e.y-down.y)<=1&&(press||at-down.at<=400))return {t:press?'press':'poke'};return}
  if(e.type!=='move'||press)return
  const s=this.stroke
  if(!s||at-s.last>500){this.stroke={x,dir:0,run:0,last:at};return}
  const dx=x-s.x;if(dx===0){s.last=at;return}
  const dir=Math.sign(dx)
  // a wobble of less than a cell is not a turn
  if(s.dir!==0&&dir!==s.dir&&s.run>=1){this.stroke={x,dir,run:Math.abs(dx),last:at};return {t:'turn'}}
  this.stroke={x,dir:s.dir===0||dir===s.dir?dir:s.dir,run:s.dir===0||dir===s.dir?s.run+Math.abs(dx):s.run,last:at}
  return
 }
}

type State = { installed: boolean }
// mode 'desktop' is a row of the desktop band's touch layer, 'press' a thing on its floor; the terminal's (enabled) also
// drags and glances.
const client: ClientModule<{ enabled?: boolean; mode?: 'terminal' | 'desktop' | 'press' }, State> = (props, surface) => {
  const { Box } = surface.elements
  if (props.enabled === false) return Box({})
  if (surface.state?.installed !== true) {
    if (props.mode === 'desktop' || props.mode === 'press') {
      const path = new TurnPath(), press = props.mode === 'press'
      surface.onPointer(e => { const post = path.pointer(e, Date.now(), press); if (post) surface.post(post) })
    } else {
      const path = new DragPath(), touch = new TouchPath()
      surface.onPointer(e => {
        const dragging = path.dragging
        const post = path.pointer(e, surface.columns); if (post) surface.post(post)
        const kind = touch.pointer(e, Date.now(), dragging || path.dragging); if (kind) surface.post({ t: kind })
      })
    }
    surface.setState({ installed: true })
  }
  return Box({ width: surface.columns, height: surface.rows })
}
export default client
