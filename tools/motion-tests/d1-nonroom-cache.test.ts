import {test,expect} from 'bun:test'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {d1Art,loadD1Art} from '../../plugin/hooks/d1-art-data.source'
import * as ribbonCore from '../../plugin/hooks/d1-ribbon-core.source'
const pluginRoot=process.env.D1_REVIEW_PLUGIN??resolve(import.meta.dir,'../../plugin')
async function instrument(file:string,point:string){
 const original=readFileSync(resolve(pluginRoot,'hooks',file.replace(/\.ts$/,'.source.ts')),'utf8')
 expect(original.split(point).length).toBe(2)
 const kind=file==='d1-ribbon.ts'?'ribbon':'helpers'
 await loadD1Art(kind,path=>Promise.resolve(readFileSync(resolve(pluginRoot,path),'utf8')))
 const dependencies=file==='d1-ribbon.ts'
  ? ["import { d1Art } from './d1-art-data'\n","import { RIBBON_PALETTE, EMPTY_12x1, validRibbon, ribbonTerminal } from './d1-ribbon-core'\n"]
  : ["import { d1Art } from './d1-art-data'\n"]
 let source=original
 for(const dependency of dependencies){expect(source.split(dependency).length).toBe(2);source=source.replace(dependency,'')}
 const code='let __constructionCount=0;\n'+source.replace(point,'__constructionCount++;'+point)
 const js=new Bun.Transpiler({loader:'ts',target:'bun'}).transformSync(code).replace(/^export\s+/gm,'')
 return new Function('d1Art','RIBBON_PALETTE','EMPTY_12x1','validRibbon','ribbonTerminal',js+';return {ribbonSvg:typeof ribbonSvg==="function"?ribbonSvg:undefined,scrollSvg:typeof scrollSvg==="function"?scrollSvg:undefined,bundleSvg:typeof bundleSvg==="function"?bundleSvg:undefined,count:()=>__constructionCount}')(d1Art,ribbonCore.RIBBON_PALETTE,ribbonCore.EMPTY_12x1,ribbonCore.validRibbon,ribbonCore.ribbonTerminal)
}
test('D1 ribbon repeated identical effective input constructs once and changed input constructs once',async()=>{
 const m=await instrument('d1-ribbon.ts','const [light,dark]=')
 const a=m.ribbonSvg(1,50,true,12,120)
 expect(a).toContain('-120ms')
 expect(m.ribbonSvg(1,50,true,12,120)).toBe(a);expect(m.ribbonSvg(1,50,true,12,120.9)).toBe(a);expect(m.count()).toBe(1)
 const b=m.ribbonSvg(8,28,false,12,0);expect(b).not.toBe(a);expect(m.count()).toBe(2)
 expect(m.ribbonSvg(8,28,false,12,0)).toBe(b);expect(m.ribbonSvg(1,50,true,12,120)).toBe(a);expect(m.count()).toBe(2)
})
for(const method of ['scrollSvg','bundleSvg'] as const)test(`D1 ${method} repeated identical input constructs once and changed input constructs once`,async()=>{
 const m=await instrument('d1-pieces.ts','v=value();')
 const a=m[method]({arrivalDelay:900,elapsed:120,reduced:false})
 expect(a).toContain('780ms');expect(m[method]({arrivalDelay:900,elapsed:120,reduced:false})).toBe(a);expect(m.count()).toBe(1)
 const b=m[method]({leave:'done',elapsed:20,reduced:false});expect(b).toContain('-20ms');expect(b).not.toBe(a);expect(m.count()).toBe(2)
 expect(m[method]({leave:'done',elapsed:20,reduced:false})).toBe(b);expect(m[method]({arrivalDelay:900,elapsed:120,reduced:false})).toBe(a);expect(m.count()).toBe(2)
})
