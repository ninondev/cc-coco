import {test,expect} from 'claude-code/testing'
import {EMPTY_12x1,ribbonSvg} from '../hooks/d1-ribbon'
import {validateDesktopTree} from '../hooks/desktop-safe'

test('D1 actual empty ribbon SVG passes the unchanged desktop validator',()=>{
 let violation:string|null=null
 try{validateDesktopTree({type:'Svg',props:{source:EMPTY_12x1,alt:'',width:12,height:1}})}catch(error){violation=(error as Error).message}
 expect(violation).toBe(null)
 expect(ribbonSvg(0,50)).toBe(EMPTY_12x1)
})
