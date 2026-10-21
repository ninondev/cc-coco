import {joinPath} from './paths'
export function scriptArgv(key:string,root:string,iconPlatform?:'macos'|'linux'):readonly string[]|undefined{
 const script=joinPath(root,'bin','companion-macos.sh')
 if(['coco:companion:install','coco:companion:retry','coco:companion:updateButton'].includes(key))return['/bin/sh',script,'install','--report']
 if(key==='coco:companion:trash')return['/bin/sh',script,'uninstall','--report']
 if(key==='coco:companion:summon')return['/usr/bin/open','-g','-b','io.github.ninondev.coco-companion']
 if(iconPlatform&&['coco:icon:apply','coco:icon:clear'].includes(key)){
  const action=key.split(':').at(-1)!
  return['/bin/sh',joinPath(root,'bin',`icon-${iconPlatform}.sh`),action,'--report',...(iconPlatform==='linux'?['--replace-custom']:[])]
 }
}
