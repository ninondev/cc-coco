import { installM1Words } from './m1-more-data-fixture'
import { expect, test } from 'claude-code/testing'
import { ModGapsRuntime, GapLimits, WaitSound, closeAllowed, detectScreenReader, textBandMode, voiceDecision, screenReaderLine, hintTail, personBandFocus, focusBook, compactChapter } from '../hooks/mod-gaps'
import { gapWord, gapPool, missingGapKeys, gapCharacterName } from '../hooks/mod-gaps-words'
import { RUN_MARK, modIncenseSvg } from '../hooks/mod-gaps-art'
import { renderClose, renderRunMark, renderTextBand, renderLimitNote } from '../hooks/mod-gaps-render'
import { LineSlot } from '../hooks/line-slot'
import { planPx } from '../hooks/typeset'
installM1Words()
const A=Date.UTC(2026,9,6,12),DAY='2026-10-06'
const CHOICE={voice:'off',marks:'on',band:'on',surface:'desktop',affection:'warm'}
const FIRST=(_key:string,list:readonly string[])=>list[0]

test('MOD 10.2 keyboard discovery records only a successful first person focus in his band',()=>{
 const e={component:'AbovePrompt',plugin:'coco',element:'coco:book:open',origin:{kind:'person'}}
 expect(personBandFocus(e,{},false)).toBe(true)
 for(const change of [{component:'Pane'},{plugin:'another-plugin'},{plugin:undefined},{element:undefined},{origin:{kind:'plugin'}}])expect(personBandFocus({...e,...change},{},false)).toBe(false)
 expect(personBandFocus(e,{deny:'focus refused'},false)).toBe(false)
 expect(personBandFocus(e,{},true)).toBe(false)
})
function ready(end='done',name='Edit'){const r=new ModGapsRuntime();r.startTurn(A);r.toolRan({id:'tool',name});r.append('final',{type:'assistant',content:[{type:'text',text:end}]});return r}
function store(initial:Record<string,unknown>={}){const data={...initial},calls:string[]=[];return {data,calls,get:async(key:string)=>{calls.push('get:'+key);return data[key]},set:async(key:string,value:unknown)=>{calls.push('set:'+key);data[key]=value}}}
const close=(r:ModGapsRuntime,s:ReturnType<typeof store>,at=A+1000,choice=CHOICE)=>r.close({reason:'answer',at,day:DAY,hour:12,lang:'en',choice,store:s,pick:FIRST})
const constructor=(type:string)=>(props:any)=>({type,props,children:props.children??[]})
const E:any={Box:constructor('Box'),Text:constructor('Text'),Button:constructor('Button'),Svg:constructor('Svg')}
function nodes(tree:any,type:string):any[]{return !tree||typeof tree!=='object'?[]:[...(tree.type===type?[tree]:[]),...(Array.isArray(tree.children)?tree.children:[]).flatMap((x:any)=>nodes(x,type))]}
const text=(tree:any)=>nodes(tree,'Text').flatMap(n=>n.children).join('')

test('MOD 1.7.1 closing is screen-only, state holds final UUID and store IO is event-owned',async()=>{
 const r=ready(),s=store(),messages=[{uuid:'final',text:'done'}],before=JSON.stringify(messages),mirrors:any[]=[]
 const c=await r.close({reason:'answer',at:A+1000,day:DAY,hour:12,lang:'en',choice:CHOICE,store:s,pick:FIRST,mirror:async(id,value)=>{mirrors.push([id,value])}})
 expect(c?.id).toBe('final');expect(gapPool('en','close.work')).toContain(c!.closing.line);expect(JSON.stringify(messages)).toBe(before)
 expect(s.calls).toEqual(['get:close','set:close','set:closings']);expect(s.data.closings).toEqual([['final',c!.closing]]);expect(mirrors).toEqual([['final',c!.closing]])
 const tree=renderClose(E,{type:'engine'} as any,c!.id,c!.closing.line,true)
 expect(nodes(tree,'engine').length).toBe(1);expect(nodes(tree,'Box').some(n=>n.props.key==='coco:close:final')).toBe(true)
})
test('MOD 1.7.2 closing follows 20 minute gap, six per local day, day rollover',async()=>{
 const s=store();expect(await close(ready(),s)).toBeDefined()
 expect(await close(ready(),s,A+301000)).toBeUndefined()
 expect(await close(ready(),s,A+1261000)).toBeDefined()
 s.data.close={at:A,day:DAY,n:6};expect(await close(ready(),s,A+3600000)).toBeUndefined()
 expect(closeAllowed(s.data.close,A+86400000,'2026-10-07')).toBe(true)
})
test('MOD 1.7.3 closing rejects questions, nonanswers, spoken notes, disabled surfaces and no tools',async()=>{
 for(const end of ['done?','done？'])expect(await close(ready(end),store())).toBeUndefined()
 const note=ready();note.lineShown(1);expect(await close(note,store())).toBeUndefined()
 for(const reason of ['error','refusal','aborted'])expect(ready().closeCandidate(reason,A+1000,CHOICE)).toBe(false)
 for(const choice of [{...CHOICE,voice:'light'},{...CHOICE,marks:'off'},{...CHOICE,surface:'terminal',band:'off'}]){const s=store();expect(await close(ready(),s,A+1000,choice)).toBeUndefined();expect(s.calls).toEqual([])}
 const r=new ModGapsRuntime();r.startTurn(A);r.append('text',{type:'assistant',content:[{type:'text',text:'done'}]});expect(await close(r,store(),A+180000)).toBeUndefined()
})
test('MOD 1.7.4 closing belongs to last assistant text, never a tool-use message',async()=>{
 const r=ready();r.append('tool',{type:'assistant',content:[{type:'tool_use'}]});expect(await close(r,store())).toBeUndefined()
 r.append('second',{type:'assistant',content:[{type:'text',text:'done'}]});expect((await close(r,store()))?.id).toBe('second')
 r.append('sub',{type:'assistant',content:[{type:'text',text:'sub'}]},'agent');expect((await close(r,store()))?.id).toBe('second')
})
test('MOD 1 closing has two pools: late night from 23:00 to 05:00, ordinary otherwise',async()=>{
 for(const [key,r,at,hour,affection]of [['close.late',ready(),A+180000,23,'clingy'],['close.late',ready(),A+1000,0,'warm'],['close.late',ready(),A+1000,4,'clingy'],['close.work',ready(),A+1000,5,'warm'],['close.work',ready(),A+180000,12,'clingy'],['close.work',ready(),A+1000,22,'clingy']] as const){
  const c=await r.close({reason:'answer',at,day:DAY,hour,lang:'zh',choice:{...CHOICE,affection},store:store(),pick:FIRST});expect(c?.closing.key).toBe(key);expect(c?.closing.line).toBe(gapPool('zh',key)[0])
 }
 const committed=ready();committed.toolRan({id:'commit',name:'Bash',command:'git commit -m ok',exitCode:0,committed:true})
 expect((await committed.close({reason:'answer',at:A+180000,day:DAY,hour:0,lang:'zh',choice:CHOICE,store:store(),pick:FIRST}))?.closing.key).toBe('close.late')
 for(const key of ['close.commit','close.long','close.clingy'])expect(gapPool('zh',key)).toEqual([])
 const denied=new ModGapsRuntime();denied.startTurn(A);denied.toolRan({id:'x',name:'Edit',denied:true});denied.append('x',{type:'assistant',content:[{type:'text',text:'done'}]});expect(await close(denied,store(),A+180000)).toBeUndefined()
})
test('MOD 1 closing commit eligibility requires validated successful host metadata, never echoed command text',async()=>{
 const make=(input:Parameters<ModGapsRuntime['toolRan']>[0])=>{const r=new ModGapsRuntime();r.startTurn(A);r.toolRan(input);r.append('final',{type:'assistant',content:[{type:'text',text:'done'}]});return r}
 for(const command of ['echo git commit','git commit -m ok','git -C project commit -m ok'])expect(await close(make({id:'bash',name:'Bash',command,exitCode:0}),store())).toBeUndefined()
 const actual=make({id:'bash',name:'Bash',command:'git -C project commit -m ok',exitCode:0,committed:true})
 expect((await close(actual,store()))?.closing.key).toBe('close.work')
 for(const changes of [{exitCode:1},{denied:true},{interrupted:true},{agentId:'subagent'}])expect(await close(make({id:'bash',name:'Bash',exitCode:0,committed:true,...changes}),store())).toBeUndefined()
})
test('MOD 1.7.6 closing foot aligns with head face or desktop cue',()=>{
 for(const face of [true,false]){const tree=renderClose(E,{type:'engine'} as any,'row','tidy',face);expect(nodes(tree,'Svg')[0]).toBeDefined();expect(nodes(tree,'Svg')[0].props.width).toBe(face?35:Math.round(planPx('✻ ',true)));expect(nodes(tree,'Text')[0]).toBeDefined();expect(nodes(tree,'Text')[0].props).toMatchObject({color:'inactive',wrap:'wrap'});expect(nodes(tree,'Box').find(n=>n.props.minWidth===0)?.props.marginLeft).toBe(face?1:undefined)}
})
test('MOD 1 bounded closing mirror survives reload and evicts oldest at 64',async()=>{
 const r=new ModGapsRuntime();for(let i=0;i<65;i++)r.restoreClosing('id'+i,{line:'tidy',lang:'en',key:'close.work'});expect(r.closings.size).toBe(64);expect(r.closings.has('id0')).toBe(false);expect(r.restoreClosing('id64',undefined)?.line).toBe('tidy')
 const cold=new ModGapsRuntime();cold.restoreClosings(r.snapshotClosings());expect(cold.snapshotClosings()).toEqual(r.snapshotClosings());expect(cold.closings.has('id0')).toBe(false)
 const entries=Array.from({length:100},(_,i)=>['cold'+i,{line:'tidy',lang:'en',key:'close.work'}]);cold.restoreClosings(entries);expect(cold.closings.size).toBe(64);expect(cold.closings.has('cold35')).toBe(false);expect(cold.closings.has('cold36')).toBe(true)
 cold.restoreClosings([['',{}],['invalid',{line:'tidy',lang:'en',key:'unrelated'}],false]);expect(cold.closings.size).toBe(0)
 cold.restoreClosings({final:{line:'tidy',lang:'en',key:'close.work'}});expect(cold.closings.size).toBe(0)
 const s=store(),turn=ready();turn.append('last-text-not-head',{type:'assistant',content:[{type:'text',text:'done'}]});const accepted=await close(turn,s);expect(accepted).toBeDefined();cold.restoreClosings(s.data.closings);expect(cold.closings.get('last-text-not-head')).toEqual(accepted!.closing);expect(cold.closings.has('final')).toBe(false)
 const copy=cold.snapshotClosings();copy[0][1].line='modified';expect(cold.closings.get('last-text-not-head')?.line).toBe(accepted!.closing.line)
})
test('MOD 2.7.1/2 voice migration defaults off and preserves explicit legacy choices',()=>{
 expect(voiceDecision(undefined,undefined)).toEqual({voice:'off',voiceChosen:false,askAgain:false})
 for(const voice of ['off','light','full']as const)expect(voiceDecision(undefined,voice)).toEqual({voice,voiceChosen:true,askAgain:false})
 expect(voiceDecision({voice:'light'},undefined)).toEqual({voice:'off',voiceChosen:false,askAgain:true})
 expect(voiceDecision({voice:'full',voiceChosen:true},undefined)).toEqual({voice:'full',voiceChosen:true,askAgain:false})
})
const WINDOWS=[{kind:'five_hour',percentUsed:100,resetsAt:A+3600000},{kind:'seven_day',percentUsed:55,resetsAt:A+86400000}]
const failure=(r:GapLimits,error='rate_limit',windows=WINDOWS)=>r.failure(error,undefined,windows,A,'en',kind=>kind,'UTC')
test('MOD 3.7.1 known spent window selects tea, full ash, moment slots; unknown and overload differ',()=>{
 const r=new GapLimits(),l=failure(r)!;expect(l).toBeDefined();expect(l.frame).toBe('tea-a');expect(l.request.key).toBe('limit.out');expect(l.request.slots).toEqual([{value:'1:00 PM',kind:'value'},{value:'five_hour',kind:'label'}]);expect(l.out).toBe('five_hour')
 expect(failure(new GapLimits(),'rate_limit',[])?.request.key).toBe('limit.wait')
 const busy=failure(new GapLimits(),'overloaded')!;expect(busy).toBeDefined();expect(busy.frame).toBe('waiting');expect(busy.request.key).toBe('limit.crowded');expect(busy.out).toBeUndefined()
 expect(failure(new GapLimits(),'billing_error')).toBeUndefined()
})
test('MOD 3.7.2 main loop only, and 3.7.3 latest failure has 5 second order window',()=>{
 const r=new GapLimits();expect(r.failure('rate_limit','agent',WINDOWS,A,'en',x=>x)).toBeUndefined();expect(r.out()).toEqual([])
 const one=failure(r);expect(r.recent(A+5000)).toBe(one);expect(r.recent(A+5001)).toBeUndefined();const two=failure(r,'overloaded');expect(r.recent(A+1)).toBe(two)
})
test('MOD 3.7.4 limits survive turn.complete clear and leave at reset or turn start',()=>{
 const r=new GapLimits(),slot=new LineSlot(),l=failure(r)!;expect(l).toBeDefined();slot.offer(l.request,A);slot.clear('turn',A+1);expect(slot.visible(A+1)?.key).toBe('limit.out');slot.advance(A+3600000);expect(slot.visible(A+3600000)).toBeUndefined()
 const second=failure(r)!;expect(second).toBeDefined();slot.offer(second.request,A);r.startTurn();expect(slot.visible(A+1)).toBeUndefined()
})
test('MOD 3 ash leaves only after line gone and next reading below 100',()=>{
 const r=new GapLimits();failure(r);r.visible(undefined);expect(r.out()).toEqual(['five_hour']);r.read([{kind:'five_hour',percentUsed:99}]);expect(r.out()).toEqual([])
 failure(r);r.read([{kind:'five_hour',percentUsed:0}]);expect(r.out()).toEqual(['five_hour']);r.startTurn();expect(r.out()).toEqual([])
})
test('MOD 3.7.5 a spent window draws the stick as at 100 %, with no all-ash drawing, flame, ember or smoke',()=>{
 const svg=modIncenseSvg([{kind:'five_hour',percentUsed:100}],true,{hot:['five_hour'],budget:80})
 expect(svg).not.toContain('class="ash"');expect(svg).not.toContain('stroke-dasharray:1 1.2}.hot');expect(svg).toContain('<path d="M5 5V18" class="g"/><path d="M5 17.00V18" class="hot"/>');expect(svg).not.toContain('class="sm"');expect(svg).not.toContain('class="t"');expect(svg).not.toContain('<ellipse');expect(svg).toContain('forced-color-adjust:none');expect(svg).toContain('(prefers-contrast:more)');expect(svg).toContain('(forced-colors:active)')
 for(const neighbour of [true,false])for(const [a,b]of [[85,10],[10,85]]){
  const mixed=modIncenseSvg([{kind:'five_hour',percentUsed:a},{kind:'seven_day',percentUsed:b}],true,{neighbour})
  const hotX=a>=85?5:11,coolX=a<85?5:11
  expect(mixed).toContain('.t{stroke:#B84936;stroke-width:2}');expect(mixed).toContain(`.t.cool{stroke:${neighbour?'#9C8F86':'#DC755D'}}`)
  expect(mixed).toMatch(new RegExp(`<path d="M${hotX} [^"]+v2" class="t"/>`));expect(mixed).toMatch(new RegExp(`<path d="M${coolX} [^"]+v2" class="t cool"/>`))
  expect(mixed).toContain(`.t.cool{stroke:${neighbour?'#827F79':'#B84936'}}`);if(neighbour)expect(mixed).toContain('.t.cool{stroke:#8E8B85}')
 }
})
test('MOD 3 persistent head note lasts to reset, carries bold slots and retains reset metadata for ash',()=>{
 const r=new GapLimits(),limit=failure(r)!
 expect(limit).toBeDefined();
 expect(r.current(A+6000)).toBe(limit);expect(r.current(A+3600000)).toBeUndefined()
 const note=renderLimitNote(E,limit);expect(nodes(note,'Box')[0]).toBeDefined();expect(nodes(note,'Box')[0].props.marginLeft).toBe(6)
 expect(nodes(note,'Svg')[0]).toBeDefined();expect(nodes(note,'Svg')[0].props).toMatchObject({width:16,height:22,alt:''})
 expect(nodes(note,'Text').filter(n=>n.props.bold).length).toBe(2)
 expect(nodes(note,'Text')[0]).toBeDefined();expect(nodes(note,'Text')[0].props).toMatchObject({color:'inactive',wrap:'wrap'})
 expect(nodes(renderLimitNote(E,limit,true),'Svg')).toEqual([])
 expect(nodes(renderLimitNote(E,failure(new GapLimits(),'overloaded')!),'Svg')).toEqual([])
 r.read([{kind:'five_hour',percentUsed:0}]);expect(r.burned()).toEqual([{kind:'five_hour',resetsAt:A+3600000}])
 r.startTurn();expect(r.current(A+1)).toBeUndefined();expect(r.burned()).toEqual([])
})
test('MOD 3 language and time-zone changes reformat held limit without renewing its identity or lifetime',()=>{
 const r=new GapLimits(),slot=new LineSlot(),limit=failure(r)!;expect(limit).toBeDefined();slot.offer(limit.request,A)
 const before=slot.visible(A)!,zh=r.display(A+6000,'zh',()=> '五小时','Asia/Shanghai')!
 expect(before).toBeDefined();expect(zh).toBeDefined();
 expect(zh.request.text).toContain('五小时');expect(zh.request.text).not.toBe(before.text)
 expect(zh.request.slots?.[0]?.value).not.toBe('1:00 PM');expect(zh.at).toBe(limit.at);expect(zh.epoch).toBe(limit.epoch)
 expect(zh.request.ttl).toBe(limit.request.ttl);expect(zh.request.valid).toBe(limit.request.valid)
 slot.markShown(before.id,A);expect(slot.replaceText(zh.request.key,zh.request.text,zh.request.slots)).toBe(true)
 const after=slot.visible(A+6000)!;expect(after).toBeDefined();expect(after.id).toBe(before.id);expect(after.class).toBe(before.class);expect(after.expiresAt).toBe(before.expiresAt);expect(slot.needsShown(after.id)).toBe(false)
 expect(slot.replaceText(zh.request.key,zh.request.text,zh.request.slots)).toBe(false)
 expect(r.display(A+3600000,'en',x=>x,'UTC')).toBeUndefined();expect(slot.visible(A+3600000)).toBeUndefined()
 for(const error of ['rate_limit','overloaded']){const other=new GapLimits();failure(other,error,[]);const display=other.display(A+1,'zh',x=>x)!;expect(display).toBeDefined();expect(display.request.text).toBe(gapWord('zh',display.request.key))}
})
test('MOD 4.5.1 bookmark offers the whole personal prompt once and never sends it',()=>{
 const r=new ModGapsRuntime(),input={initial:true,turns:0,on:true,bookmark:{at:A-86400000,where:'whole file or to do',kind:'todo' as const},now:A,lang:'en'}
 expect(r.bookmarkSuggestion(input)).toBe("Let's pick up where we stopped: whole file or to do");expect(r.bookmarkSuggestion(input)).toBeUndefined()
 expect(new ModGapsRuntime().bookmarkSuggestion({...input,lang:'zh',bookmark:{...input.bookmark,kind:'file'}})).toBe('接着来,上次在改whole file or to do')
})
test('MOD 4.5.2/3 old, disabled, resumed bookmarks are never offered; false display cannot retry',()=>{
 const input={initial:true,turns:0,on:true,bookmark:{at:A-86400000,where:'todo',kind:'todo' as const},now:A,lang:'en'}
 for(const change of [{turns:1},{initial:false},{on:false},{promptSuggestionEnabled:false},{bookmark:{...input.bookmark,at:A-8*86400000}}])expect(new ModGapsRuntime().bookmarkSuggestion({...input,...change})).toBeUndefined()
 const r=new ModGapsRuntime();r.bookmarkSuggestion(input);expect(r.bookmarkSuggestion(input)).toBeUndefined()
})
test('MOD 6.6.1/5 screen-reader environment precedence and manual terminal text mode',()=>{
 expect(detectScreenReader('1',{})).toBe(true);expect(detectScreenReader('0',{axScreenReader:true})).toBe(false);expect(detectScreenReader(undefined,{axScreenReader:true})).toBe(true)
 expect(textBandMode('terminal','text',false)).toBe(true);expect(textBandMode('terminal','on',true)).toBe(true);expect(textBandMode('desktop','on',true)).toBe(false);expect(textBandMode('terminal','on',false)).toBe(false)
})
test('MOD 6.6.2/3/4 text band reads only useful lines and does not churn with unrelated state',()=>{
 const line:any={id:'asked',key:'asked_twice',class:1,text:'asked before',expiresAt:A+1000,button:{key:'coco:asked:go',label:'Go'}}
 const tree=renderTextBand(E,'小克','zh',line);expect(text(tree)).toBe('小克：asked before');expect(nodes(tree,'Button')[0]).toBeDefined();expect(nodes(tree,'Button')[0].props.key).toBe('coco:asked:go');expect(nodes(tree,'Svg')).toEqual([]);expect(nodes(tree,'Raster')).toEqual([])
 expect(renderTextBand(E,'小克','zh',{...line,frame:'new',mood:'work',readings:[100]})).toEqual(tree)
 expect(text(renderTextBand(E,'Coco','en',{...line,key:'working',class:0}))).toBe('')
 for(const key of ['bookmark','first.hello','close.work'])expect(screenReaderLine({key,class:0})).toBe(true)
 const safety={...line,buttons:[{key:'hide',label:'Hide'},{key:'keep',label:'Keep'}]}
 expect(nodes(renderTextBand(E,'Coco','en',safety),'Button').map(n=>n.props.key)).toEqual(['hide','keep'])
})
test('MOD 7 descriptions preserve exact authored zh/en and fallback missing translations',()=>{
 expect(gapWord('zh','cmd.coco')).toBe('设置:开关、vibe check、用量');expect(gapWord('fixture-absent-language','cmd.coco')).toBe(gapWord('en','cmd.coco'));expect(missingGapKeys('zh')).toEqual([]);expect(missingGapKeys('ja')).toEqual([]);expect(missingGapKeys('fixture-absent-language')).toContain('gaps.cmd.coco')
})
test('MOD 7 fallback greeting uses the dispatch name and keeps engine Claude references intact',()=>{
 const names:Record<string,string>={zh:'小克',ja:'Coco',ko:'코코',hi:'कोको'}
 for(const lang of ['en','zh','ja','ko','de','fr','es-ES','es-419','pt-BR','it','id','hi']){
  const name=names[lang]??'Coco';expect(gapCharacterName(lang)).toBe(name);expect(gapWord(lang,'first.hello')).toContain(name)
  const reading=renderTextBand(E,gapCharacterName(lang),lang,{id:'name',key:'limit.wait',text:'reading',class:1,expiresAt:A+1000});expect(text(reading)).toBe(name+(lang==='zh'||lang==='ja'?'：':': ')+'reading')
  expect(gapPool(lang,'first.hello')[0]).toBe(gapWord(lang,'first.hello'))
  if(lang==='en')expect(gapWord(lang,'first.hello')).toBe(name+', at your side. a question waits in settings.')
  expect(gapWord(lang,'first.voiceAsk')).toContain('Claude');expect(gapWord(lang,'first.voiceAsk')).not.toContain('Claude-sama') // rename-kit:keep (the old name must not come back)
 }
 expect(missingGapKeys('ja')).toEqual([]);expect(missingGapKeys('fixture-absent-language')).toContain('gaps.first.hello')
})
test('MOD 8.2 focus follows successful placement and denial is harmless',async()=>{
 const calls:string[]=[];await focusBook(true,'settings',async key=>{calls.push(key)});expect(calls).toEqual(['coco:book:tab:settings']);await focusBook(false,'him',async key=>{calls.push(key)});expect(calls.length).toBe(1);await focusBook(true,'him',async()=>{throw Error('denied')})
})
test('MOD 9.3 direct compact carries no instruction, skip adds nothing, refusal fills /compact',async()=>{
 const calls:string[]=[];await compactChapter(async()=>{calls.push('compact')},async x=>{calls.push(x)});expect(calls).toEqual(['compact']);await compactChapter(async()=>({skip:'busy'}),async x=>{calls.push(x)});expect(calls).toEqual(['compact']);await compactChapter(async()=>{throw Error('busy')},async x=>{calls.push(x)});expect(calls).toEqual(['compact','/compact'])
})
test('MOD 10.1 passing and failing run marks preserve engine output, terminal indent and SR silence',()=>{
 for(const outcome of ['pass','fail']as const){const tree=renderRunMark(E,{type:'engine'}as any,'run',outcome,'desktop','en',false,'claude');expect(nodes(tree,'engine').length).toBe(1);expect(nodes(tree,'Svg')[0]).toBeDefined();expect(nodes(tree,'Svg')[0].props.source).toContain(outcome==='pass'?'class="p"':'class="o"');expect(nodes(tree,'Box').some(n=>n.props.key==='coco:run:run')).toBe(true)
 const terminal=renderRunMark(E,{type:'engine'}as any,'run',outcome,'terminal','en',false,'claude');expect(text(terminal)).toContain(outcome==='pass'?'✿':'❀');expect(nodes(terminal,'Box').find(n=>n.props.key)?.props.paddingLeft).toBe(5)
 expect(text(renderRunMark(E,{type:'engine'}as any,'run',outcome,'terminal','en',true,'claude'))).toBe(outcome==='pass'?'passed':'failed')}
 const r=ready();r.toolRan({id:'unknown',name:'Bash',recognized:false,outcome:'pass'});expect(r.runVerdicts.has('unknown')).toBe(false)
})
test('MOD 10.1 the flower marks only the run that turns red to green, per command',()=>{
 const r=ready()
 r.toolRan({id:'green-first',name:'Bash',key:'npm test',recognized:true,outcome:'pass'});expect(r.runVerdicts.has('green-first')).toBe(false)
 r.toolRan({id:'red',name:'Bash',key:'npm test',recognized:true,outcome:'fail'});expect(r.runVerdicts.has('red')).toBe(false)
 r.toolRan({id:'other-green',name:'Bash',key:'cargo test',recognized:true,outcome:'pass'});expect(r.runVerdicts.has('other-green')).toBe(false)
 r.toolRan({id:'turned',name:'Bash',key:'npm test',recognized:true,outcome:'pass'});expect(r.runVerdicts.get('turned')).toBe('pass')
 r.toolRan({id:'again',name:'Bash',key:'npm test',recognized:true,outcome:'pass'});expect(r.runVerdicts.has('again')).toBe(false)
 r.toolRan({id:'red-unknown',name:'Bash',key:'npm test',recognized:false,outcome:'fail'});r.toolRan({id:'after-unknown',name:'Bash',key:'npm test',recognized:true,outcome:'pass'});expect(r.runVerdicts.has('after-unknown')).toBe(false)
})
function luminance(hex:string){const values=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return values[0]!*.2126+values[1]!*.7152+values[2]!*.0722}
function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
test('MOD 10.1.4 emitted flower palettes carry contrast block and >=3:1 on required light/dark grounds',()=>{
 const grounds={light:['#F0EEE6','#FFFFFF','#FFFAEF'],dark:['#2B2A27','#000000','#202020','#2D3236']}
 for(const [kind,svg] of Object.entries(RUN_MARK)){expect(svg).toContain('forced-color-adjust:none');expect(svg).toContain('(prefers-contrast:more)');expect(svg).toContain('(forced-colors:active)');const colors=[...svg.matchAll(new RegExp('\\.'+(kind==='pass'?'p':'o')+'\\{(?:fill|stroke):(#[A-Fa-f0-9]{6})\\}','g'))].map(m=>m[1]!);for(let i=0;i<colors.length;i++)for(const ground of (i%4===0||i%4===2?grounds.light:grounds.dark))expect(contrast(colors[i]!,ground)).toBeGreaterThanOrEqual(3)}
})
test('MOD 10.2 hint tail respects draft, work, band, three sessions, and keyboard discovery',()=>{
 const i={surface:'terminal',band:'on',sessions:1,keysUsed:false,isDraft:false,isWorking:false,lang:'en'}
 expect(hintTail(i)).toBe(', '+gapWord('en','hint.tail'));for(const change of [{isDraft:true},{isWorking:true},{sessions:4},{keysUsed:true},{band:'off'},{surface:'desktop'}])expect(hintTail({...i,...change})).toBeUndefined()
})
const CONFIG={on:true,macOS:true,screenReader:false}
function soundPort(initial:Record<string,unknown>={},surfaces=['terminal']){const s=store(initial),calls=s.calls;return {...s,surfaces:async()=>{calls.push('surfaces');return surfaces},play:async()=>{calls.push('play')}}}
test('MOD 11.7.1 off returns with zero reads, process/network/model calls and timers',async()=>{
 const b=new WaitSound(),p=soundPort();b.ask('call');expect(await b.notify({...CONFIG,on:false},'permission_prompt',A,p)).toBe(false);expect(p.calls).toEqual([])
})
test('MOD 11.7.2 waits ring once, duplicate overlapping notices coalesce, settle permits a later wait',async()=>{
 const b=new WaitSound(),p=soundPort();b.ask('call');expect(await Promise.all([b.notify(CONFIG,'permission_prompt',A,p),b.notify(CONFIG,'permission_prompt',A,p)])).toEqual([true,true]);expect(p.calls.filter(x=>x==='play').length).toBe(1);expect(await b.notify(CONFIG,'permission_prompt',A+60000,p)).toBe(false);b.settled('call');b.ask('new');expect(await b.notify(CONFIG,'permission_prompt',A+60000,p)).toBe(true)
})
test('MOD 11.7.3 cooldown is shared store value, 10 seconds blocks and 31 permits',async()=>{
 for(const age of [10000,31000]){const b=new WaitSound(),p=soundPort({waitSoundAt:A-age});b.ask('x');expect(await b.notify(CONFIG,'permission_prompt',A,p)).toBe(age===31000)}
})
test('MOD 11 atomic host claim admits only one session and denied/rejected claims fail closed',async()=>{
 let claimed=false
 const p=soundPort(),claim=async()=>{p.calls.push('claim');if(claimed)return false;claimed=true;return true}
 const a=new WaitSound(),b=new WaitSound();a.ask('a');b.ask('b')
 const result=await Promise.all([a.notify(CONFIG,'permission_prompt',A,{...p,claim}),b.notify(CONFIG,'permission_prompt',A,{...p,claim})])
 expect(result.sort()).toEqual([false,true]);expect(p.calls.filter(x=>x==='play').length).toBe(1);expect(p.calls.filter(x=>x==='set:waitSoundAt').length).toBe(1)
 for(const claim of [async()=>false,async()=>{throw Error('unavailable')}]){const r=new WaitSound(),s=soundPort();r.ask('ask');expect(await r.notify(CONFIG,'permission_prompt',A,{...s,claim})).toBe(false);expect(s.calls.includes('play')).toBe(false);expect(s.calls.some(x=>x.startsWith('set:'))).toBe(false)}
})
test('MOD 11 a superseded pending notice cannot swallow the next wait or sound after it ended',async()=>{
 const r=new WaitSound(),p=soundPort();let release!:()=>void,first=true
 const gate=new Promise<void>(resolve=>{release=resolve})
 const port={...p,surfaces:async()=>{if(first){first=false;await gate}return ['terminal']}}
 r.ask('old');const old=r.notify(CONFIG,'permission_prompt',A,port);r.settled('old');r.ask('new')
 expect(await r.notify(CONFIG,'permission_prompt',A+31000,port)).toBe(true)
 release();expect(await old).toBe(false);expect(p.calls.filter(x=>x==='play').length).toBe(1)
})
test('MOD 11.7.4/5 wrong notices and engine bells/mobile/nonMac never sound',async()=>{
 for(const notice of ['idle_prompt','auth_success','agent_completed','quota_auto_resume_fired','elicitation_complete','elicitation_response']){const b=new WaitSound(),p=soundPort();b.ask('x');expect(await b.notify(CONFIG,notice,A,p)).toBe(false);expect(p.calls).toEqual([])}
 for(const config of [{...CONFIG,screenReader:true},{...CONFIG,preferredNotifChannel:'terminal_bell'},{...CONFIG,preferredNotifChannel:'iterm2_with_bell'},{...CONFIG,macOS:false}]){const b=new WaitSound(),p=soundPort();b.ask('x');expect(await b.notify(config,'permission_prompt',A,p)).toBe(false);expect(p.calls).toEqual([])}
 const b=new WaitSound(),p=soundPort({},['mobile']);b.ask('x');expect(await b.notify(CONFIG,'permission_prompt',A,p)).toBe(false);expect(p.calls).toEqual(['surfaces'])
})
test('MOD 11 elicitation starts at notice and completion ends its once-only wait',async()=>{
 const b=new WaitSound(),p=soundPort();expect(await b.notify(CONFIG,'elicitation_dialog',A,p)).toBe(true);expect(await b.notify(CONFIG,'elicitation_url_dialog',A+60000,p)).toBe(false);await b.notify(CONFIG,'elicitation_response',A+60000,p);expect(await b.notify(CONFIG,'agent_needs_input',A+61000,p)).toBe(true)
})
test('MOD 1 atomic closing claim denies competing, rejected and stale epochs before store writes or UI',async()=>{
 let claimed=false,claims=0;const claim=async()=>{claims++;if(claimed)return false;claimed=true;return true},one=ready(),two=ready(),s1=store(),s2=store()
 const input={reason:'answer',at:A+1000,day:DAY,hour:12,lang:'en',choice:CHOICE,pick:FIRST,claim}
 const results=await Promise.all([one.close({...input,store:s1}),two.close({...input,store:s2})]);expect(results.filter(Boolean).length).toBe(1);expect(claims).toBe(2);expect(s2.calls).toEqual(['get:close']);expect(two.closings.size).toBe(0)
 expect(s1.calls).toEqual(['get:close','set:close','set:closings']);
 const rejected=store();expect(await ready().close({...input,store:rejected,claim:async()=>{throw Error('claim unavailable')}})).toBeUndefined();expect(rejected.calls).toEqual(['get:close'])
 const stale=ready(),s3=store();let release!:(v:boolean)=>void;const pending=new Promise<boolean>(resolve=>{release=resolve});const job=stale.close({...input,store:s3,claim:()=>pending});await Promise.resolve();stale.startTurn(A+2000);release(true);expect(await job).toBeUndefined();expect(s3.calls).toEqual(['get:close']);expect(stale.closings.size).toBe(0)
 const persisting=ready(),s4=store();let releasePersist!:()=>void;const waiting=new Promise<void>(resolve=>{releasePersist=resolve});let persisted!:()=>void;const persistedSignal=new Promise<void>(resolve=>{persisted=resolve});const late= persisting.close({...input,claim:async()=>true,store:{get:s4.get,set:async(key,value)=>{await s4.set(key,value);if(key==='closings'){persisted();await waiting}}}});await persistedSignal;persisting.startTurn(A+2000);releasePersist();expect(await late).toBeUndefined();expect(persisting.closings.size).toBe(0)
 const mirroring=ready(),s5=store();let releaseMirror!:()=>void;const mirrorWait=new Promise<void>(resolve=>{releaseMirror=resolve});let mirrored!:()=>void;const mirrorSignal=new Promise<void>(resolve=>{mirrored=resolve});const mirrorJob=mirroring.close({...input,claim:async()=>true,store:s5,mirror:async()=>{mirrored();await mirrorWait}});await mirrorSignal;mirroring.reset();releaseMirror();expect(await mirrorJob).toBeUndefined();expect(mirroring.closings.size).toBe(0)
})
