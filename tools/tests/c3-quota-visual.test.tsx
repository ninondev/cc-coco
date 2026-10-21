import { expect, test } from 'claude-code/testing'
import * as quota from '../hooks/quota'
import { loadC3Words, resetC3Words } from '../hooks/c3-words'

const windows=[{kind:'five_hour',percentUsed:72},{kind:'seven_day',percentUsed:41}]
test('incense alt states pace in words using the exact author key',async()=>{
 resetC3Words()
 await loadC3Words(async()=>JSON.stringify({'alt.incense.pace':{en:'out in about {t}'}}))
 const incenseAlt=(quota as unknown as {incenseAlt:(lang:string,windows:typeof windows,options?:{pace?:{kind:string;t:string}[];neighbour?:boolean})=>string}).incenseAlt
 expect(incenseAlt('en',windows,{pace:[{kind:'five_hour',t:'~1h 2m'}]})).toBe('5-hour window 72% used, out in about 1h 2m; 7-day window 41% used')
 expect(incenseAlt('en',windows,{pace:[{kind:'seven_day',t:'2d 3h'}]})).toBe('5-hour window 72% used; 7-day window 41% used, out in about 2d 3h')
 expect(incenseAlt('en',windows)).toBe('5-hour window 72% used, 7-day window 41% used')
 expect(incenseAlt('en',windows,{pace:[{kind:'five_hour',t:'~1h 2m'}],neighbour:true})).toBe('5-hour window 72% used, 7-day window 41% used')
 expect(incenseAlt('en',[{kind:'five_hour',percentUsed:NaN}],{pace:[{kind:'five_hour',t:'1h'}]})).toBe('')
 resetC3Words()
})
