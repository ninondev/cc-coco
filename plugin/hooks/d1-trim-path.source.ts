export function trimD1Path(path:string,home:string,width=80):string{
 const windows=/^[A-Za-z]:[\\/]/.test(path),separator=windows?'\\':'/',normal=(s:string)=>windows?s.replace(/\\/g,'/').toLowerCase():s
 const cleanHome=home.replace(/[\\/]+$/,''),base=normal(cleanHome),own=normal(path)
 let shown=base&&(own===base||own.startsWith(base+'/'))?'~'+path.slice(cleanHome.length):path
 const parts=shown.split(/[\\/]/);if(shown.length>Math.max(12,width)&&parts.length>3)shown=[parts[0],parts[1],'…',parts[parts.length-1]].join(separator)
 return shown
}
