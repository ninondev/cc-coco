from pathlib import Path
from hooks_source import hook_directory

def instrument_d1_counters(copy):
 root=Path(copy);register=hook_directory(root)/'register.tsx';pieces=hook_directory(root)/'d1-pieces.ts'
 canonical=hook_directory(root)/'d1-pieces.source.ts'
 if canonical.is_file():pieces=canonical
 if not register.is_file() or not pieces.is_file():raise RuntimeError('D1 event counters require source hooks')
 module=hook_directory(root)/'d1-event-test-counter.ts'
 module.write_text("const shed:{kind:'begun'|'completed';edge:number;elapsed:number}[]=[];const helper:{kind:'begun'|'completed';deadline:number;elapsed:number}[]=[];let lying=0,desktop=0;export const noteHelper=(kind:'begun'|'completed',deadline:number,elapsed:number)=>{helper.push({kind,deadline,elapsed})};export const helperRecords=()=>helper;export const noteShed=(kind:'begun'|'completed',edge:number,elapsed:number)=>{shed.push({kind,edge,elapsed})};export const noteLying=()=>{lying++};export const shedRecords=()=>shed;export const lyingBuilds=()=>lying;export const noteDesktopReturn=()=>{desktop++};export const desktopReturns=()=>desktop;\n")
 source=register.read_text();start=source.index('function d1ShedDeadline(');end=source.index('\nasync function d1Long(',start);method=source[start:end]
 begin="if(serial!==d1CompactSerial||view.band==='off'||!spriteOnScreen())return;pictureSerial++;";finish='d1ShedDeadline($,serial)})'
 if method.count(begin)!=1 or method.count(finish)!=1:raise RuntimeError('Exact D1 shed callback source seam changed')
 method=method.replace(begin,begin.replace('pictureSerial++;',"noteShed('begun',edge,clockSnapshot-state.at);pictureSerial++;"))
 method=method.replace(finish,"d1ShedDeadline($,serial);noteShed('completed',edge,clockSnapshot-state.at)})")
 helper_start=source.index('function d1HelperDeadline(');helper_end=source.index('\nasync function d1Ribbon(',helper_start);helper_method=source[helper_start:helper_end]
 helper_begin="if(own!==d1Epoch||view.band==='off'||!spriteOnScreen())return;d1?.removeLeaving(clockSnapshot);";helper_finish='await push($);d1HelperDeadline($)})'
 if helper_method.count(helper_begin)!=1 or helper_method.count(helper_finish)!=1:raise RuntimeError('Exact D1 helper callback source seam changed')
 helper_method=helper_method.replace(helper_begin,helper_begin.replace('d1?.removeLeaving(clockSnapshot);',"noteHelper('begun',deadline,clockSnapshot-(deadline-240));d1?.removeLeaving(clockSnapshot);"))
 helper_method=helper_method.replace(helper_finish,"await push($);d1HelperDeadline($);noteHelper('completed',deadline,clockSnapshot-(deadline-240))})")
 source=source[:helper_start]+helper_method+source[helper_end:]
 start=source.index('function d1ShedDeadline(');end=source.index('\nasync function d1Long(',start)
 source="import {noteShed,noteDesktopReturn,noteHelper} from './d1-event-test-counter'\n"+source[:start]+method+source[end:]
 return_point='d1ShedDeadline($,d1CompactSerial);d1HelperDeadline($)\n  return result.tree'
 if source.count(return_point)!=1:raise RuntimeError('Exact desktop returned-tree source seam changed')
 register.write_text(source.replace(return_point,return_point.replace('return result.tree','noteDesktopReturn();return result.tree')))
 source=pieces.read_text();start=source.index('export function lyingScrollSvg(');tick=source.index('`',start);end=source.index('</svg>`',tick)+len('</svg>`');template=source[tick:end]
 if not template.startswith('`<svg') or 'viewBox="0 0 18 9"' not in template:raise RuntimeError('Exact D1 lying constructor source seam changed')
 pieces.write_text("import {noteLying} from './d1-event-test-counter'\n"+source[:tick]+'(noteLying(),'+template+')'+source[end:])
 return "import {shedRecords,lyingBuilds,desktopReturns,helperRecords} from './d1-event-test-counter'\n", " on('command.run',{command:'d1-fixture-helper-callbacks'},()=>({text:JSON.stringify(helperRecords())}))\n on('command.run',{command:'d1-fixture-shed-callbacks'},()=>({text:JSON.stringify(shedRecords())}))\n on('command.run',{command:'d1-fixture-lying-construction-count'},()=>({text:String(lyingBuilds())}))\n on('command.run',{command:'d1-fixture-desktop-returned-trees'},()=>({text:String(desktopReturns())}))\n"
