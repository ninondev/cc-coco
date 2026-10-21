from pathlib import Path
from hooks_source import hook_directory
MODULE="type Receipt={component:'Pane'|'AbovePrompt';requestId:string;surface:string;count:number;at:number|null}\ntype Row={receipt:Receipt;token:number}\nconst rows=new Map<string,Row>(),tokens=new Map<number,Row>(),waiters=new Map<number,{wait:Promise<void>;resolve:()=>void}>();let serial=0,timing=false,clockRequests=0,clockErrors=0\nconst key=(component:Receipt['component'],requestId:string,surface:string)=>JSON.stringify([component,requestId,surface])\nexport function noteOwnedReturn(component:Receipt['component'],requestId:string,surface:string):number{\n const id=key(component,requestId,surface),token=++serial,row={receipt:{component,requestId,surface,count:(rows.get(id)?.receipt.count??0)+1,at:null as number|null},token};rows.set(id,row)\n if(timing&&component==='AbovePrompt'){let resolve!:()=>void;const wait=new Promise<void>(done=>{resolve=done});tokens.set(token,row);waiters.set(token,{wait,resolve})}\n return token\n}\nexport const ownedTimingEnabled=()=>timing\nexport const enableOwnedTiming=()=>{timing=true}\nexport const noteOwnedClockRequest=(token:number)=>{if(tokens.has(token))clockRequests++}\nfunction finish(token:number){waiters.get(token)?.resolve();waiters.delete(token);tokens.delete(token)}\nexport function noteOwnedAt(token:number,at:number){const row=tokens.get(token);if(row&&rows.get(key(row.receipt.component,row.receipt.requestId,row.receipt.surface))===row&&Number.isFinite(at))row.receipt.at=at;finish(token)}\nexport function noteOwnedError(token:number){if(tokens.has(token))clockErrors++;finish(token)}\nexport const ownedTiming=()=>({enabled:timing,clockRequests,clockErrors,pending:waiters.size})\nexport const ownedPaneReturns=(requestId:string,surface:string)=>rows.get(key('Pane',requestId,surface))?.receipt.count??0\nexport async function ownedRenderReceipt(component:Receipt['component'],requestId:string|null,surface:string):Promise<Receipt|Receipt[]>{\n for(;;){const selected=requestId===null?[...rows.values()].filter(row=>row.receipt.component===component&&row.receipt.surface===surface):[rows.get(key(component,requestId,surface))].filter((row):row is Row=>row!==undefined),pending=selected.flatMap(row=>waiters.has(row.token)?[waiters.get(row.token)!.wait]:[]);if(pending.length){await Promise.all(pending);continue}return requestId===null?selected.map(row=>({...row.receipt})).sort((a,b)=>a.requestId.localeCompare(b.requestId)):selected[0]?{...selected[0].receipt}:{component,requestId,surface,count:0,at:null}}\n}\n"
REGISTER_IMPORT="import {noteOwnedReturn,ownedTimingEnabled,noteOwnedClockRequest,noteOwnedAt,noteOwnedError,ownedPaneReturns,enableOwnedTiming,ownedTiming,ownedRenderReceipt} from './d1-owned-source-test-counter'\n"
STAMP="\nasync function __fixtureStampOwnedReturn($:Engine,token:number):Promise<void>{\n noteOwnedClockRequest(token)\n const at=await $.clock.now()\n noteOwnedAt(token,at)\n}\n"
COMMANDS="  on('command.run',{command:'d1-fixture-owned-pane-returns'},($,e)=>{const [requestId,surface]=JSON.parse(e.args) as [string,string];return {text:String(ownedPaneReturns(requestId,surface))}})\n  on('command.run',{command:'d1-fixture-owned-render-clock'},($,e)=>{if(e.args==='enable')enableOwnedTiming();return {text:JSON.stringify(ownedTiming())}})\n  on('command.run',{command:'d1-fixture-owned-render-receipt'},async($,e)=>{const [component,requestId,surface]=JSON.parse(e.args) as ['Pane'|'AbovePrompt',string|null,string];return {text:JSON.stringify(await ownedRenderReceipt(component,requestId,surface))}})\n"
def instrument_owned_source(copy):
 root=Path(copy);pages=hook_directory(root)/'pages.tsx';register=hook_directory(root)/'register.tsx'
 if not pages.is_file():return
 if (hook_directory(root)/'d1-owned-source-test-counter.ts').is_file():raise RuntimeError('Owned source instrumentation was already applied')
 source=pages.read_text();start=source.index("  on('ui.render', { component: 'Pane', requestId: BOOK_PANE }, async ($, e, next) => {");end=source.index('\n  })',start);method=source[start:end]
 if source.count("export const BOOK_PANE = 'coco-book'")!=1:raise RuntimeError('Owned Pane identity changed')
 fallback='if(!roomCurrent())return next(e)';replacement="if(!roomCurrent()){const ownedTree=await next(e);noteOwnedReturn('Pane',e.requestId,e.surface);return ownedTree}"
 if method.count(fallback)!=3:raise RuntimeError('Owned Pane early return seams changed')
 method=method.replace(fallback,replacement)
 desktop='return desktopBook($.ui.resolve(e), w, held, data, { source, height, width }, press, columns, e.surface)';terminal='return terminalBook($.ui.resolve(e), w, held, data, press, columns)';final='    return next(e)'
 for before,after in [(desktop,"const ownedTree=desktopBook($.ui.resolve(e), w, held, data, { source, height, width }, press, columns, e.surface);noteOwnedReturn('Pane',e.requestId,e.surface);return ownedTree"),(terminal,"const ownedTree=terminalBook($.ui.resolve(e), w, held, data, press, columns);noteOwnedReturn('Pane',e.requestId,e.surface);return ownedTree"),(final,"    const ownedTree=await next(e);noteOwnedReturn('Pane',e.requestId,e.surface);return ownedTree")]:
  if method.count(before)!=1:raise RuntimeError('Owned Pane return seam changed')
  method=method.replace(before,after,1)
 # M1's More page, Talk tab and folded Settings page return their own trees.
 for before in ("return m1Frame(E,words,e.surface,content)","return foldScripts(E,tree,previews,m1ScriptFolds,view?.lang??'en')"):
  for _ in range(method.count(before)):
   method=method.replace(before,"{const ownedTree="+before[len('return '):]+";noteOwnedReturn('Pane',e.requestId,e.surface);return ownedTree}",1)
 pages.write_text("import {noteOwnedReturn} from './d1-owned-source-test-counter'\n"+source[:start]+method+source[end:])
 source=register.read_text();start=source.index("  on('ui.render', { component:'AbovePrompt' }, ");end=source.index('\n  }).catch(($,e) => {',start);method=source[start:end]
 # The desktop branch's own indentation fixes both return seams (M1 nests them in render()).
 import re
 # Main's band (10-09 play) types the desktop candidate and may take a fresh clock first.
 depth=len(re.search(r'\n( +)const candidate(?:: RenderElement \| Promise<RenderElement>)? = (?:playing\b|renderDesktop\(\$,e\))',method)[1])
 sync=' '*depth+'return candidate';async_return=' '*(depth-2)+'return candidate'
 if method.count(sync)!=1:raise RuntimeError('Owned desktop sync return changed')
 method=method.replace(sync,"      const ownedToken=noteOwnedReturn('AbovePrompt',e.requestId,e.surface)\n      if(ownedTimingEnabled())__fixtureStampOwnedReturn($,ownedToken).catch(()=>noteOwnedError(ownedToken))\n"+sync,1)
 if method.count(async_return)!=2:raise RuntimeError('Owned AbovePrompt return seams changed')
 # The exact four-space line is the terminal promise; preserve original desktop return byte sequence.
 method=method.replace('\n'+async_return,"\n"+' '*(depth-2)+"return candidate.then(tree=>{const ownedToken=noteOwnedReturn('AbovePrompt',e.requestId,e.surface);if(ownedTimingEnabled())__fixtureStampOwnedReturn($,ownedToken).catch(()=>noteOwnedError(ownedToken));return tree})",1)
 instrumented=REGISTER_IMPORT+source[:start]+method+source[end:]+STAMP
 entry='export const register: Register = (on, options) => {'
 if instrumented.count(entry)!=1:raise RuntimeError('Owned fixture register entry changed')
 register.write_text(instrumented.replace(entry,entry+'\n'+COMMANDS,1))
 (hook_directory(root)/'d1-owned-source-test-counter.ts').write_text(MODULE)