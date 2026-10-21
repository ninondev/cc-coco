import type { Elements, RenderElement, SessionUsage } from 'claude-code'
import { MORE_GROUPS, MORE_SERVICE_ROWS, MORE_SERVICE_SLOT, capChoices, moreRows, moreRowSupported, moreRowAuthored, moreOn, moreCountText } from './more-state'
import type { MoreId, MorePayer, MoreSnapshot, MoreKeyView, MoreModels } from './more-state'
import { moreModelFor } from './more-models'
import { LANGS } from './words'
import { moreWord, moreFill } from './more-words'
import { numberText } from './numbers'
import type { KeyFailure, KeyPlatform } from './talk-key'
import { KEY_FAILURE_BUTTONS, KEY_NEAR_CAP, KEY_PER_MINUTE, KEY_ENDPOINT_SLOTS, ANTHROPIC_HOST, keyPriced, keyTokens, keyUsd } from './talk-key'
type MoreElements = Elements[keyof Elements]
// Where the key program would run, read only to draw the row: no program runs to draw it (TALK-KEY 6).
export type MoreKeyPlace = { platform: KeyPlatform; noDisplay: boolean; remote: boolean; command: string }
export type MoreBookData = { snapshot: MoreSnapshot; surface: string; usage?: SessionUsage; payer?: MorePayer; place?: MoreKeyPlace; columns?: number }
const NARROW = 24
/** The key's Today line, from each usage at K1's Haiku 5.5 price row. */
export function moreKeyToday(key: MoreKeyView | undefined, lang: string, narrow: boolean): string {
  const t = key?.today
  if (!t || !t.n) return ''
  // Dollars only for a priced Claude model on api.anthropic.com; elsewhere tokens only, never a guess.
  if (!keyPriced(key?.key?.host, key?.key?.model)) return moreFill(moreWord(narrow ? 'talk.today.tokens.short' : 'talk.today.tokens', lang), { n: t.n, k: keyTokens(t.tokens) })
  return moreFill(moreWord(narrow ? 'talk.today.short' : 'talk.today', lang), { n: t.n, k: keyTokens(t.tokens), usd: keyUsd(t.usd) })
}
const elsewhere = (key: MoreKeyView | undefined) => !!key?.key?.host && key.key.host !== ANTHROPIC_HOST
/** Who pays, said once at the top of Talk. */
export function moreTalkPayer(key: MoreKeyView | undefined, payer: MorePayer | undefined, lang: string): string {
  if (key?.payer === 'key' && key.key && elsewhere(key)) {
    // The host is named; without its slot the plain line is followed by the host on its own line.
    const at = moreFill(moreWord('talk.payer.keyAt', lang), { tail: key.key.last4, host: key.key.host! })
    return at || moreFill(moreWord('talk.payer.key', lang), { tail: key.key.last4 }) + '\n' + key.key.host
  }
  if (key?.payer === 'key' && key.key) return moreFill(moreWord('talk.payer.key', lang), { tail: key.key.last4 })
  return moreWord(payer === 'plan' ? 'talk.payer.plan' : 'talk.payer.account', lang)
}
const KEPT: Record<string, string> = { keychain: 'key.kept.mac', 'credential-manager': 'key.kept.win', 'secret-service': 'key.kept.ring', file: 'key.kept.file' }
function keptKey(key: MoreKeyView, place: MoreKeyPlace | undefined): string | undefined {
  // For another host the shipped lines («sends it only to api.anthropic.com») would be false.
  if (elsewhere(key)) return key.key?.store ? KEPT[key.key.store]!.replace('key.kept.', 'key.keptAt.') : undefined
  if (key.key?.store) return KEPT[key.key.store]
  return place?.platform === 'darwin' ? 'key.kept.mac' : place?.platform === 'win32' ? 'key.kept.win' : undefined
}
/** «Who pays for his calls» and, when the key pays, the key row (pictures 01 and 02). */
export function MorePayerRows(E: MoreElements, d: MoreBookData): RenderElement[] {
  const {Box,Text,Button}=E, Select='Select' in E?E.Select:undefined, s=d.snapshot, key=s.key
  if (!key) return []
  const w=(k:string)=>moreWord(k,s.lang), narrow=(d.columns??80)<=NARROW, mobile=d.surface==='mobile'
  const session=w(d.payer==='plan'?'payer.plan':'payer.account')
  const options=[{value:'session',label:session},...(key.noRun?[]:[{value:'key',label:w('payer.key')}])]
  const label=w(narrow?'payer.label.short':'payer.label')
  const rows: RenderElement[] = [
    <Box key="coco:more:payer:row" flexDirection={narrow?'column':'row'} alignItems={narrow?'flex-start':'center'} columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}><Text bold wrap="wrap">{label}</Text></Box>
      {mobile||!Select?<Box flexDirection="row" columnGap={1}>{options.map(o=><Button key={`coco:more:payer:pick:${o.value}`} label={o.label} {...(key.payer===o.value?{variant:'primary' as const}:{})} onPress={()=>{}}/>)}</Box>:<Select key="coco:more:payer" label={label} options={options} value={key.payer} onSelect={()=>{}}/>}
    </Box>,
  ]
  if (key.noRun) { rows.push(<Text key="coco:more:key:noRun" wrap="wrap">{w('key.noRun')}</Text>); return rows }
  if (key.payer !== 'key') return rows
  if (mobile || d.place?.remote) { rows.push(<Text key="coco:more:key:phone" wrap="wrap">{w('key.phone')}</Text>); return rows }
  const command = d.place?.noDisplay && d.place.command ? <Box key="coco:more:key:ssh" flexDirection="column"><Text wrap="wrap">{w('key.ssh')}</Text><Box flexDirection={narrow?'column':'row'} columnGap={1}><Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="wrap">{d.place.command}</Text></Box><Button key="coco:more:key:copy" label={w('key.copy')} onPress={()=>{}}/></Box></Box> : undefined
  if (!key.key) rows.push(command ?? <Box key="coco:more:key:none" flexDirection="row" justifyContent="flex-end"><Button key="coco:more:key:add" variant="primary" label={w('key.add')} onPress={()=>{}}/></Box>)
  else {
    const masked = s.screenReader ? moreFill(w('key.spoken'), { tail: key.key.last4 }) : `sk-ant-…${key.key.last4}`
    const refused = elsewhere(key) ? moreFill(w('key.refusedAt'), { host: key.key.host! }) : w('key.refused')
    const state = key.key.state === 'works' ? <Text color="inactive">{w('key.works')}</Text> : key.key.state === 'unchecked' ? (w('key.unchecked') ? <Text color="inactive">{w('key.unchecked')}</Text> : null) : refused ? <Text color="error" wrap="wrap">{refused}</Text> : null
    rows.push(<Box key="coco:more:key:saved" flexDirection={narrow||key.key.state==='refused'?'column':'row'} columnGap={1}>
      <Box flexDirection="row" columnGap={1} flexGrow={1} flexShrink={1} minWidth={0}><Text>{masked}</Text>{state}</Box>
      <Box flexDirection="row" columnGap={1}>{w('key.check')?<Button key="coco:more:key:check" label={w('key.check')} onPress={()=>{}}/>:null}{command?null:<Button key="coco:more:key:replace" label={w('key.replace')} onPress={()=>{}}/>}<Button key="coco:more:key:remove" label={w('key.remove')} onPress={()=>{}}/></Box>
    </Box>)
    if (command) rows.push(command)
  }
  if (key.notice) rows.push(<Text key="coco:more:key:notice" color="error" wrap="wrap">{key.notice}</Text>)
  const kept = keptKey(key, d.place)
  const keptText = kept ? (narrow && moreWord(`${kept}.short`, s.lang)) || moreFill(w(kept), { host: key.key?.host ?? '' }) : ''
  if (keptText) {
    rows.push(<Text key="coco:more:key:kept" wrap="wrap">{keptText}</Text>)
    if (kept === 'key.kept.file' || kept === 'key.keptAt.file') rows.push(<Text key="coco:more:key:path">~/.config/coco/talk-key</Text>)
  }
  // A base URL and a model for another provider, offered only once every word that needs is written.
  const Input = 'Input' in E ? E.Input : undefined
  if (Input && !mobile && KEY_ENDPOINT_SLOTS.every(slot => w(slot))) {
    rows.push(<Box key="coco:more:key:endpoint" flexDirection="column">
      <Text>{w('key.base.label')}</Text><Input key="coco:more:key:base" placeholder="https://api.anthropic.com" {...(key.base ? { value: key.base } : {})} onInput={()=>{}} onSubmit={()=>{}}/>
      <Text>{w('key.model.label')}</Text><Input key="coco:more:key:model" placeholder="claude-haiku-5-5" {...(key.model ? { value: key.model } : {})} onInput={()=>{}} onSubmit={()=>{}}/>
    </Box>)
  }
  rows.push(<Text key="coco:more:key:limit" wrap="wrap">{moreFill(w('key.limit'), { max: KEY_PER_MINUTE })}</Text>)
  if ((key.today?.day ?? 0) >= KEY_NEAR_CAP) rows.push(<Text key="coco:more:key:nearCap">{moreFill(w('key.limit.nearCap'), { n: key.today!.day })}</Text>)
  rows.push(<Text key="coco:more:key:env" color="inactive" wrap="wrap">{w(narrow?'key.envNote.short':'key.envNote')}</Text>)
  return rows
}
// The model a row runs on (Talk and Explain while the session pays, one pick for both; and the second look): what may be
// picked, the pick, and whether the person's own connection names no model (the row cannot run) or still waits for
// their pick (owner 10-17).
function moreRowModel(s: MoreSnapshot, id: MoreId): { models?: MoreModels; picked?: string; none: boolean; pickFirst: boolean } {
  const models = s.models && (id === 'look' || id === 'lines' || (id === 'talk' || id === 'explain') && s.key?.payer !== 'key') ? s.models : undefined
  if (!models) return { none: false, pickFirst: false }
  const picked = moreModelFor(models, id === 'look' || id === 'lines' ? id : 'talk'), none = !models.choices.length
  return { models, ...(picked ? { picked } : {}), none, pickFirst: !picked && !none }
}
function moreRowReady(s: MoreSnapshot, id: MoreId): boolean { const model = moreRowModel(s, id); return moreRowAuthored(id, s.lang) && !model.none && !model.pickFirst }
export function MoreEntry(E: MoreElements, d: MoreBookData): RenderElement {
  const {Box,Text,Button}=E, s=d.snapshot, w=(key:string)=>moreWord(key,s.lang), rows=moreRows(d.surface)
  return <Box flexDirection="column" hover={{scope:'more:entry'}}><Box flexDirection="row" columnGap={1}><Text bold>{w('entry.label')}</Text><Text color="inactive">{moreFill(w('entry.count'),{on:rows.filter(id=>moreOn(s.values,id)&&moreRowReady(s,id)).length,total:rows.length})}</Text><Button key="coco:more:open" label={w('open')} onPress={()=>{}} /></Box>{d.surface==='mobile'?(s.entryFocused?<Box><Text>{w('entry.help')}</Text></Box>:null):<Box display={s.entryFocused?'flex':'none'} {...(s.entryFocused?{}:{hover:{display:'flex' as const,scope:'more:entry'}})}><Text>{w('entry.help')}</Text></Box>}</Box>
}
// One More row (label, its switch, cost, help on hover or focus, the ask), on the More page and, by kind, in the
// switches page's groups (their itabag, step 2); `tags` is the dim line of marks after the label there, and `payer`
// draws who pays under Talk (the More page only).
export function MoreRow(E: MoreElements, d: MoreBookData, id: MoreId, tags?: string, payer = false): RenderElement {
  const {Box,Text,Button}=E, Select='Select' in E?E.Select:undefined,s=d.snapshot,w=(key:string)=>moreWord(key,s.lang), mobile=d.surface==='mobile'
  const label=w(`${id}.label`)
  const service=MORE_SERVICE_ROWS.has(id)?w(MORE_SERVICE_SLOT):''
  // A row that cannot run here is drawn, «Off», with one line saying why (U6, owner 10-17)
  const model=moreRowModel(s,id),unavailable=!moreRowAuthored(id,s.lang)||model.none
  const reason=unavailable?w(model.none?'model.none':'unavailable'):''
  const on=moreOn(s.values,id)&&!unavailable&&!model.pickFirst,asking=s.asking===id&&!unavailable&&!model.pickFirst
  const help=[w(`${id}.help`),service].filter(Boolean).join('\n')
  const button=id==='plain'?(on?w('plain.stop'):w('plain.use')):(on?w('turnOff'):s.screenReader?moreFill(w('turnOnNamed'),{name:label}):w('turnOn'))
  // «Ask before going past»: the Select where the surface has one, its four buttons everywhere else (BOOK F10)
  const capButtons=id==='cap'&&(mobile||!Select)
  return <Box key={`coco:more:row:${id}`} flexDirection="column" hover={{scope:`more:${id}`}}>
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>{mobile?<Button key={`coco:more:${id}:help`} plain label={label} onPress={()=>{}}/>:<Text bold wrap="wrap">{label}</Text>}</Box>
      {asking?null:on?<Box flexShrink={0}><Text bold>{id==='plain'?w('plain.inUse'):w('on')}</Text></Box>:null}
      {unavailable?<Box flexShrink={0}><Text color="inactive">{w('cap.off')}</Text></Box>:asking||capButtons||model.pickFirst?null:id==='cap'&&Select?<Select key="coco:more:cap" label={label} options={capChoices(s.lang)} value={String(s.values.cap??0)} onSelect={()=>{}}/>:<Button key={`coco:more:${id}:${on?'off':'on'}`} label={button} onPress={()=>{}}/>}
    </Box>
    {tags?<Text color="inactive" wrap="wrap">{tags}</Text>:null}
    <Text color="inactive" wrap="wrap">{w(`${id}.cost`)}</Text>
    {reason?<Text color="inactive" wrap="wrap">{reason}</Text>:null}
    {model.models&&!unavailable&&!asking&&(on||model.pickFirst)?MoreModelChoice(E,d,id,model.models,model.picked,model.pickFirst):null}
    {id==='lines'?MoreLinesState(E,d,on&&!unavailable):null}
    {id==='talk'&&on&&!unavailable?MoreDmState(E,d):null}
    {capButtons&&!unavailable&&!asking?<Box flexDirection="row" flexWrap="wrap" columnGap={1}>{capChoices(s.lang).map(choice=><Button key={`coco:more:cap:pick:${choice.value}`} label={choice.label} onPress={()=>{}}/>)}</Box>:null}
    {mobile?(s.focused===id?<Box><Text wrap="wrap">{help}</Text></Box>:null):<Box display={s.focused===id?'flex':'none'} {...(s.focused===id?{}:{hover:{display:'flex' as const,scope:`more:${id}`}})}><Text wrap="wrap">{help}</Text></Box>}
    {on&&id==='talk'&&s.key?.payer==='key'&&moreKeyToday(s.key,s.lang,(d.columns??80)<=NARROW)?<Text color="inactive" wrap="wrap">{moreKeyToday(s.key,s.lang,(d.columns??80)<=NARROW)}</Text>:on&&moreCountText(s,id)?<Text color="inactive" wrap="wrap">{moreCountText(s,id)}</Text>:null}
    {payer&&id==='talk'&&!unavailable?<Box flexDirection="column" rowGap={0}>{MorePayerRows(E,d)}</Box>:null}
    {asking?<Box flexDirection="column"><Text wrap="wrap">{[moreFill(w(`${id}.ask`)||(id==='plain'?w('plain.help')+'\n'+w('plain.cost'):''),{n:numberText(d.usage?.context.tokens??0,s.lang)}),service].filter(Boolean).join('\n')}</Text><Box flexDirection="row" columnGap={1}><Button key={`coco:more:${id}:ask:no`} label={w('ask.no')} onPress={()=>{}}/><Button key={`coco:more:${id}:ask:yes`} variant="primary" label={w('ask.yes')} onPress={()=>{}}/></Box></Box>:null}
  </Box>
}
// The line library under its row (his 10-17 cards). Coco's shipped lines can be edited and restored with the row on or
// off; with it on, the written set for the character worn: whether it is there, Write (again), Edit, Restore and Let go;
// Coco's mix, and the language the lines are written in. An opened file's place is shown under its set, or, when the
// editor could not open it, where to open it by hand. A control whose words are not written yet is left out.
function MoreLinesState(E: MoreElements, d: MoreBookData, on: boolean): RenderElement | null {
  const {Box,Text,Button}=E, Select='Select' in E?E.Select:undefined, s=d.snapshot, w=(key:string)=>moreWord(key,s.lang), v=s.lines
  if(!v)return null
  const mobile=d.surface==='mobile'||!Select
  const button=(key:string,label:string)=>label?<Button key={`coco:more:lines:${key}`} label={label} onPress={()=>{}}/>:null
  const place=(part:'shipped'|'generated')=>{const path=v.paths?.[part],text=path?moreFill(w(v.editFailed===part?'lines.editFailed':'lines.path'),{path}):'';return text?<Text color="inactive" wrap="wrap">{text}</Text>:null}
  const choice=(key:string,label:string,options:{value:string;label:string}[],value:string)=>mobile
    ?<Box key={`coco:more:lines:${key}:row`} flexDirection="row" flexWrap="wrap" columnGap={1}>{label?<Text>{label}</Text>:null}{options.map(o=><Button key={`coco:more:lines:${key}:${o.value}`} label={o.label} {...(o.value===value?{variant:'primary' as const}:{})} onPress={()=>{}}/>)}</Box>
    :<Select key={`coco:more:lines:${key}`} {...(label?{label}:{})} options={options} value={value} onSelect={()=>{}}/>
  const rows:RenderElement[]=[]
  if(v.character==='coco')rows.push(<Box key="coco:more:lines:shipped" flexDirection="column"><Box flexDirection="row" flexWrap="wrap" columnGap={1}>{w('lines.shipped')?<Text>{w('lines.shipped')}</Text>:null}{button('edit:shipped',w('lines.edit'))}{button('restore:shipped',w('lines.restore'))}</Box>{place('shipped')}</Box>)
  if(on){
    const state=v.state,line=w(state==='ready'?'lines.done':state==='failed'?'lines.failed':state==='busy'?'lines.writing':'')
    rows.push(<Box key="coco:more:lines:generated" flexDirection="column"><Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {w('lines.generated')?<Text>{w('lines.generated')}</Text>:null}
      {state!=='none'&&line?<Text color={state==='failed'?'error':'inactive'} wrap="wrap">{line}</Text>:null}
      {state!=='busy'?button('redo',w(state==='none'?'lines.generate':'lines.redo')):null}
      {state==='ready'?button('edit:generated',w('lines.edit')):null}
      {state==='ready'?button('restore:generated',w('lines.restore')):null}
      {state==='ready'?button('drop',w('lines.drop')):null}
    </Box>{place('generated')}</Box>)
    const only=w('lines.mix.only'),both=w('lines.mix.both')
    if(v.character==='coco'&&only&&both)rows.push(choice('mix',w('lines.mix'),[{value:'only',label:only},{value:'both',label:both}],v.mix))
    rows.push(choice('lang',w('lines.lang'),LANGS.map(l=>({value:l.code,label:l.native})),v.lang))
  }
  return rows.length?<Box key="coco:more:lines:state" flexDirection="column">{rows}</Box>:null
}
// The DM thread's two choices under Talk (owner's cards 10-17 late): her first messages from her lines, or written by the
// model once lane B's instruction is there; and whether a new message notifies. A control whose words are missing is left out.
function MoreDmState(E: MoreElements, d: MoreBookData): RenderElement | null {
  const {Box,Text,Button}=E, Select='Select' in E?E.Select:undefined, s=d.snapshot, w=(key:string)=>moreWord(key,s.lang), v=s.dm
  if(!v)return null
  const mobile=d.surface==='mobile'||!Select
  const choice=(key:string,label:string,options:{value:string;label:string}[],value:string)=>mobile
    ?<Box key={`coco:more:dm:${key}:row`} flexDirection="row" flexWrap="wrap" columnGap={1}>{label?<Text>{label}</Text>:null}{options.map(o=><Button key={`coco:more:dm:${key}:${o.value}`} label={o.label} {...(o.value===value?{variant:'primary' as const}:{})} onPress={()=>{}}/>)}</Box>
    :<Select key={`coco:more:dm:${key}`} {...(label?{label}:{})} options={options} value={value} onSelect={()=>{}}/>
  const rows:RenderElement[]=[]
  const lines=w('dm.first.lines'),model=w('dm.first.model')
  if(v.model&&lines&&model)rows.push(choice('first',w('dm.first.label'),[{value:'lines',label:lines},{value:'model',label:model}],v.first))
  const notifyOn=w('dm.notify.on'),notifyOff=w('dm.notify.off')
  if(notifyOn&&notifyOff)rows.push(choice('notify',w('dm.notify.label'),[{value:'on',label:notifyOn},{value:'off',label:notifyOff}],v.notify?'on':'off'))
  return rows.length?<Box key="coco:more:dm:state" flexDirection="column">{rows}</Box>:null
}
// The models a row may run on: the Select where the surface has one, a button each everywhere else; on the person's own
// connection none is picked until they pick (owner 10-17: 「彻彻底底自选，无默认」).
function MoreModelChoice(E: MoreElements, d: MoreBookData, id: MoreId, models: MoreModels, picked: string | undefined, pickFirst: boolean): RenderElement {
  const {Box,Text,Button}=E, Select='Select' in E?E.Select:undefined, s=d.snapshot, w=(key:string)=>moreWord(key,s.lang)
  const at=models.choices.findIndex(choice=>choice.value===picked), label=w('model.label')
  return <Box key={`coco:more:${id}:models`} flexDirection="column">
    {pickFirst&&w('model.pick')?<Text wrap="wrap">{w('model.pick')}</Text>:null}
    {d.surface==='mobile'||!Select?<Box flexDirection="row" flexWrap="wrap" columnGap={1}>{label?<Text>{label}</Text>:null}{models.choices.map((choice,index)=><Button key={`coco:more:${id}:model:${index}`} label={choice.label} {...(index===at?{variant:'primary' as const}:{})} onPress={()=>{}}/>)}</Box>
      :<Select key={`coco:more:${id}:model`} {...(label?{label}:{})} options={models.choices.map((choice,index)=>({value:String(index),label:choice.label}))} {...(at>=0?{value:String(at)}:{})} onSelect={()=>{}}/>}
  </Box>
}
// O7 (Ask before going past) counts dollars, so it is drawn only where the session is not on a plan.
export function moreRowDrawn(id: MoreId, d: MoreBookData): boolean { return moreRowSupported(id)&&(id!=='cap'||d.payer!=='plan') }
export function MorePage(E: MoreElements,d: MoreBookData): RenderElement {
  const {Box,Text,Button}=E,s=d.snapshot,w=(key:string)=>moreWord(key,s.lang)
  // Who pays for Talk is chosen here, under its row (TALK-KEY 3); the switches page draws the row alone.
  const row=(id:MoreId):RenderElement=>MoreRow(E,d,id,undefined,true)
  const heading=(id:string)=>id==='plan'&&s.key?.payer==='key'?w((d.columns??80)<=NARROW?'payer.group.short':'payer.group'):id==='plan'&&d.payer==='account'?w('group.account'):w(`group.${id}`)
  const drawn=(id:MoreId)=>moreRowDrawn(id,d)
  const body=MORE_GROUPS.flatMap(group=>[<Box key={`coco:more:group:${group.id}`} flexDirection="row" columnGap={1}><Text bold>{heading(group.id)}</Text></Box>,...group.rows.filter(drawn).map(row)])
  return <Box flexDirection="column" rowGap={1}><Button key="coco:more:back" plain label={w('back')} onPress={()=>{}}/><Text bold>{w('title')}</Text><Text wrap="wrap">{w('intro')}</Text><Box key="coco:more:body" flexDirection="column" rowGap={1}>{body.slice(Math.max(0,Math.min(body.length-1,Math.floor(s.reading))))}</Box></Box>
}
// Each of his messages is its own bubble; his name heads a run of them, as a chat does. While he is writing (a call
// running or messages still to come) a still «…» sits where his next one will appear: no words, no motion.
// A failure line stands in place of his reply and is never his voice; `retry` is the message the fallback resends.
export type MoreExchange={side:'person'|'him';text:string;work?:string;failure?:KeyFailure;retry?:string}
export function MoreTalk(E: MoreElements, d: MoreBookData & {exchanges:MoreExchange[];name:string;busy?:boolean;writing?:boolean}):RenderElement {
  const {Box,Text,Button}=E, Input='Input' in E?E.Input:undefined,w=(key:string)=>moreWord(key,d.snapshot.lang)
  const failure=(item:MoreExchange,index:number)=>{
    const buttons=KEY_FAILURE_BUTTONS[item.failure!]
    return <Box key={`coco:talk:message:${index}`} flexDirection="column" alignItems="flex-start"><Text color="error" wrap="wrap">{item.text}</Text>{buttons.settings||buttons.fallback&&item.retry?<Box flexDirection="row" flexWrap="wrap" columnGap={1}>{buttons.settings?<Button key={`coco:talk:openSettings:${index}`} label={w('talk.openSettings')} onPress={()=>{}}/>:null}{buttons.fallback&&item.retry?<Button key={`coco:talk:fallback:${index}`} label={w(d.payer==='plan'?'talk.sendPlan':'talk.sendAccount')} onPress={()=>{}}/>:null}</Box>:null}</Box>
  }
  // A failure line is not his voice: the message after it starts a new run under his name.
  const his=(item?:MoreExchange)=>item?.side==='him'&&!item.failure
  const key=d.snapshot.key,other=key?.payer==='key'&&(elsewhere(key)||!!key.key?.model&&key.key.model!=='claude-haiku-5-5')
  // The person's own key paying Anthropic's Haiku: lane B's line without the plan's half (more.talk.disclosure.key); the
  // usual line until those words are in.
  const disclosure=other?moreFill(w('talk.disclosure.other'),{model:key!.key!.model??''}):key?.payer==='key'&&key.key?(w('talk.disclosure.key')||w('talk.disclosure')):w('talk.disclosure')
  return <Box flexDirection="column" rowGap={1}><Box flexDirection="column"><Text wrap="wrap">{[disclosure,w(MORE_SERVICE_SLOT)].filter(Boolean).join('\n')}</Text>{d.snapshot.key?<Text bold wrap="wrap">{moreTalkPayer(d.snapshot.key,d.payer,d.snapshot.lang)}</Text>:null}</Box>{d.exchanges.map((item,index)=>item.failure?failure(item,index):<Box key={`coco:talk:message:${index}`} flexDirection="column" alignItems={item.side==='person'?'flex-end':'flex-start'}>{item.side==='him'&&!his(d.exchanges[index-1])?<Text bold>{d.name}</Text>:null}<Text wrap="wrap">{item.text}</Text>{item.work?<Button key={`coco:talk:askClaude:${index}`} label={w('talk.askClaude')} onPress={()=>{}}/>:null}</Box>)}{d.writing?<Box key="coco:talk:writing" flexDirection="column" alignItems="flex-start">{!his(d.exchanges[d.exchanges.length-1])?<Text bold>{d.name}</Text>:null}<Text color="inactive">…</Text></Box>:null}{!w(MORE_SERVICE_SLOT)?null:d.surface==='mobile'||!Input?<Text>{w('talk.phone')}</Text>:<Box flexDirection="column"><Input key="coco:talk:input" placeholder={w('talk.placeholder')} onInput={()=>{}} onSubmit={()=>{}}/>{d.busy?null:<Button key="coco:talk:send" label={w('talk.send')} onPress={()=>{}}/>}</Box>}</Box>
}
export function MoreExplanation(E:MoreElements,d:MoreBookData & {text:string}):RenderElement {
  const {Box,Text,Markdown,Button}=E,w=(key:string)=>moreWord(key,d.snapshot.lang)
  return <Box flexDirection="column" rowGap={1}><Text bold>{w('explain.title')}</Text><Markdown text={d.text.slice(0,10000)}/><Button key="coco:explain:copy" label={w('explain.copy')} onPress={()=>{}}/></Box>
}
export function MoreLook(E:MoreElements,d:MoreBookData & {text:string;findingCount?:number}):RenderElement {
  const {Box,Text,Markdown,Button}=E,w=(key:string)=>moreWord(key,d.snapshot.lang)
  const title=d.findingCount===undefined?w('look.label'):d.findingCount>0?moreFill(w('look.found'),{n:d.findingCount}):w('look.clean')
  return <Box flexDirection="column" rowGap={1}><Text bold>{title}</Text><Markdown text={d.text.slice(0,10000)}/><Box flexDirection="row" columnGap={1}><Button key="coco:look:tellClaude" label={w('look.tellClaude')} onPress={()=>{}}/><Button key="coco:look:copy" label={w('explain.copy')} onPress={()=>{}}/></Box></Box>
}
