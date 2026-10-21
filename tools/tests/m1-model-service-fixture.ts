import {MORE_SLOTS,installMoreWords} from '../hooks/more-words'
import {M1_MORE_TEXT} from './m1-more-data-fixture'

// Explicit development-only input. Never writes to the approved word bank.
// The model rows need their authored words to turn on: the disclosure, and Talk its persona (a model instruction the
// owner has not signed off yet), so the fixture stands in for both.
const persona=(locales:string[])=>({'more.model.talk.persona':Object.fromEntries(locales.map(lang=>[lang,'fixture talk persona']))})
export function installModelServiceFixture():void {
 const locales=Object.keys(MORE_SLOTS['more.title']??{en:''})
 installMoreWords({'more.modelService.disclosure':Object.fromEntries(locales.map(lang=>[lang,'fixture-model-service-disclosure'])),...persona(locales)})
}

// Explicit JSON seam for the separate shipping hook host's first lazy data read.
// This synthetic slot stays confined to fixtures that opt in to it.
export function modelServiceFixtureText():string {
 const data=JSON.parse(M1_MORE_TEXT) as Record<string,Record<string,string>>
 const locales=Object.keys(data['more.title']??{en:''})
 data['more.modelService.disclosure']=Object.fromEntries(locales.map(lang=>[lang,'fixture-model-service-disclosure']))
 Object.assign(data,persona(locales))
 return JSON.stringify(data)
}
