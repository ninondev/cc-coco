import {readFile,writeFile,readdir,mkdir,rm,lstat} from 'node:fs/promises'
import {dirname,join,basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const workIndex=process.argv.indexOf('--work');if(workIndex<0)throw Error('Explicit --work required')
const here=process.argv[workIndex+1]
const standalone='M1_STANDALONE_TOUCH_CLIENT_74B08'
const index=process.argv.indexOf('--typescript');if(index<0)throw Error('Explicit --typescript compiler required')
const ts=await import(process.argv[index+1]).then(m=>m.default??m)
const manifest=JSON.parse(await readFile(join(here,'manifest.json'),'utf8'))
const plugin=join(here,'plugin'),entry=join(plugin,'hooks','register.tsx')
async function mirrorFile(root:string,path:string,missing=false){
 const parts=path.split('/')
 if(parts.some(part=>part===''||part==='.'||part==='..')||parts[0]!=='hooks'||!path.endsWith('.ts')&&!path.endsWith('.tsx'))throw Error('Invalid canonical mirror path: '+path)
 if(!(await lstat(root)).isDirectory())throw Error('Canonical mirror root is not a regular directory')
 let current=root
 for(let index=0;index<parts.length;index++){
  current=join(current,parts[index])
  let info
  try{info=await lstat(current)}catch(error){if(missing&&(error as {code?:string}).code==='ENOENT')return;throw error}
  if(index===parts.length-1?!info.isFile():!info.isDirectory())throw Error('Canonical mirror requires regular paths: '+path)
 }
}
const hash=(input:string|Uint8Array)=>createHash('sha256').update(input).digest('hex')
const source=await readFile(join(here,'authored','plugin','hooks','register.tsx'),'utf8')
const tree=ts.createSourceFile('register.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const placeholder='M1_WHOLE_GRAPH_PRESERVED_CLIENT_91C24'
if(source.includes(placeholder))throw Error('Placeholder collides with authored source')
const candidates:any[]=[]
function walk(n:any,fn:(n:any)=>void){fn(n);ts.forEachChild(n,(child:any)=>walk(child,fn))}
walk(tree,n=>{
 if((ts.isJsxSelfClosingElement(n)||ts.isJsxOpeningElement(n))&&n.tagName.getText(tree)==='Client'){
  let root=n
  while(root.parent&&(ts.isJsxElement(root.parent)||ts.isJsxFragment(root.parent)||ts.isJsxExpression(root.parent)))root=root.parent
  if(ts.isJsxExpression(root))throw Error('Unexpected Client root')
  candidates.push(root)
 }
})
// Each Client is one JSX root, kept byte-exact through the bundler: the terminal's touch-client.ts and play-client.ts, and
// the desktop band's touch rows and press, both play-client.ts (DECISIONS 1017).
const CLIENT_MODULES=['./touch-client.ts','./play-client.ts'],CLIENT_ROOTS=4
if(candidates.length<1||candidates.length>CLIENT_ROOTS)throw Error('One Client JSX expression per client use required')
const clients=candidates.map((client:any,index:number)=>({client,start:client.getStart(tree),source:source.slice(client.getStart(tree),client.end),marker:placeholder+'_'+index,names:[] as string[]}))
function reference(n:any):boolean{
 if(!ts.isIdentifier(n))return false
 const p=n.parent
 if(ts.isPropertyAccessExpression(p)&&p.name===n)return false
 if((ts.isPropertyAssignment(p)||ts.isMethodDeclaration(p))&&p.name===n)return false
 if(ts.isJsxAttribute(p)&&p.name===n)return false
 return true
}
for(const c of clients)walk(c.client,n=>{if(reference(n)&&!c.names.includes(n.text))c.names.push(n.text)})

const inputDir=join(here,'entrypoints'),rawDir=join(here,'raw-chunks'),outputDir=join(plugin,'hooks','m1-compiled')
// These two directories contain only this candidate's reproducible output.
await rm(rawDir,{recursive:true,force:true});await rm(outputDir,{recursive:true,force:true})
await mkdir(inputDir,{recursive:true});await mkdir(rawDir,{recursive:true});await mkdir(outputDir,{recursive:true})
for(const [path,expected]of Object.entries(manifest.sourceInputs) as [string,any][]){
 if((manifest.canonicalMirrors??[]).includes(path)){await mirrorFile(join(here,'authored','plugin'),path);await mirrorFile(plugin,path)}
 if(hash(await readFile(join(here,'authored','plugin',path)))!==expected.sha256)throw Error('Authored source identity changed: '+path)
 if(path!=='hooks/register.tsx'&&hash(await readFile(join(plugin,path)))!==expected.sha256)throw Error('Candidate dependency identity changed: '+path)
}
const sourceProgram=ts.createProgram(Object.keys(manifest.sourceInputs).map(path=>join(here,'authored','plugin',path)),{noLib:true,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,target:ts.ScriptTarget.Latest,jsx:ts.JsxEmit.React})
const sourceChecker=sourceProgram.getTypeChecker(),publicTypes:any={},sourceLocations:any={}
for(const path of Object.keys(manifest.sourceInputs)){
 // Generated runtime JavaScript (the D1 compiled modules) is bundled byte-for-byte; it has no authored types.
 if(path.endsWith('.js')){publicTypes[path]=[];sourceLocations[path]={};continue}
 const original=await readFile(join(here,'authored','plugin',path),'utf8')
 const originalTree=sourceProgram.getSourceFile(join(here,'authored','plugin',path))
 if(!originalTree||originalTree.parseDiagnostics.length)throw Error('Authored source parse failed: '+path)
 walk(originalTree,n=>{
  if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword){
   const line=originalTree.getLineAndCharacterOfPosition(n.getStart(originalTree)).line+1
   throw Error('Authored runtime dynamic import is forbidden: '+path+':'+line)
  }
 })
 const module=sourceChecker.getSymbolAtLocation(originalTree)
 const symbols=module?sourceChecker.getExportsOfModule(module):[]
 publicTypes[path]=symbols.filter(symbol=>{const resolved=symbol.flags&ts.SymbolFlags.Alias?sourceChecker.getAliasedSymbol(symbol):symbol;return (resolved.flags&ts.SymbolFlags.Type)&&!(resolved.flags&ts.SymbolFlags.Value)}).map(symbol=>symbol.name).sort()
 sourceLocations[path]=Object.fromEntries(symbols.map(symbol=>[symbol.name,(symbol.declarations?.[0]?originalTree.getLineAndCharacterOfPosition(symbol.declarations[0].getStart(originalTree)).line+1:1)]))
 if(path==='hooks/touch-client.ts')continue
 const replacements:any[]=[]
 for(const statement of originalTree.statements){
  if(!(ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement))||!statement.moduleSpecifier||!ts.isStringLiteral(statement.moduleSpecifier))continue
  const spec=statement.moduleSpecifier.text
  if(spec==='./touch-client'||spec==='./touch-client.ts')replacements.push({start:statement.moduleSpecifier.getStart(originalTree),end:statement.moduleSpecifier.end,text:JSON.stringify(standalone)})
 }
 let text=original
 for(const edit of replacements.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.text+text.slice(edit.end)
 if(path==='hooks/register.tsx'){
  // Preserve the exact JSX fragment while externalizing only the actual module import.
  const replacedTree=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),jsxNodes:any[]=[]
  walk(replacedTree,n=>{if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(replacedTree)==='Client'){let root=n;while(root.parent&&(ts.isJsxElement(root.parent)||ts.isJsxFragment(root.parent)||ts.isJsxExpression(root.parent)))root=root.parent;jsxNodes.push(root)}})
  if(jsxNodes.length!==clients.length)throw Error('Standalone Client JSX inventory changed')
  for(let i=jsxNodes.length-1;i>=0;i--)text=text.slice(0,jsxNodes[i].getStart(replacedTree))+clients[i].marker+'('+clients[i].names.join(',')+')'+text.slice(jsxNodes[i].end)
 }
 await writeFile(join(plugin,path),text)
}
const publicAliases:any={},groupEntries:string[]=[]
const jsx={compilerOptions:{jsx:'react',jsxFactory:'h',jsxFragmentFactory:'Fragment'}}
for(const [group,paths]of Object.entries(manifest.groups) as [string,string[]][]){
 const exports:string[]=[]
 for(const path of paths){
  const original=await readFile(join(here,'authored','plugin',path),'utf8')
  if(hash(original)!==manifest.sourceInputs[path].sha256)throw Error('Original grouped source changed: '+path)
  const transpiler=new Bun.Transpiler({loader:path.endsWith('.tsx')?'tsx':'ts',tsconfig:jsx})
  const names=[...transpiler.scan(transpiler.transformSync(original)).exports].sort()
  const stem=basename(path).replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_]/g,'_')
  const aliases:any={};for(const name of names){aliases[name]=stem+'__'+name}
  exports.push(names.length?'export { '+names.map(name=>name+' as '+aliases[name]).join(', ')+' } from '+JSON.stringify('../plugin/'+path):'import '+JSON.stringify('../plugin/'+path))
  publicAliases[path]={group,aliases}
 }
 const file=join(inputDir,group+'.ts');await writeFile(file,exports.join('\n')+'\n');groupEntries.push('../entrypoints/'+group+'.ts')
}
async function child(argv:string[]){
 const process=Bun.spawn(argv,{cwd:plugin,stdout:'pipe',stderr:'pipe'})
 const [stdout,stderr,exit]=await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited])
 await writeFile(join(here,'compile.log'),stdout+'\n'+stderr)
 if(exit)throw Error('Split compiler exited '+exit+'; see retained compile.log')
}
try{
 await child([process.execPath,'--no-env-file','build','--target=browser','--format=esm','--external=claude-code','--external='+standalone,'--keep-names','--splitting','--minify-whitespace','--jsx-runtime=classic','--jsx-factory=h','--jsx-fragment=Fragment','--outdir='+rawDir,'--entry-naming=[name].js','--chunk-naming=chunk-[hash].js','--metafile='+join(here,'graph.json'),'hooks/register.tsx',...groupEntries])
 const graph=JSON.parse(await readFile(join(here,'graph.json'),'utf8'))
 const actualInputs=Object.keys(graph.inputs).filter(path=>!path.startsWith('../entrypoints/')).sort()
 const expectedInputs=Object.keys(manifest.sourceInputs).filter(path=>path!=='hooks/touch-client.ts'&&!(manifest.canonicalMirrors??[]).includes(path)).sort()
 if(JSON.stringify(actualInputs)!==JSON.stringify(expectedInputs))throw Error('Runtime source graph changed: '+JSON.stringify({actualInputs,expectedInputs}))
 const files=(await readdir(rawDir)).filter(file=>file.endsWith('.js')).map(file=>join(rawDir,file)).sort()
 if(files.length<groupEntries.length+1)throw Error('Split output entry inventory incomplete')
 const program=ts.createProgram(files,{allowJs:true,noLib:true,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,target:ts.ScriptTarget.Latest})
 const checker=program.getTypeChecker(),trees=files.map(file=>program.getSourceFile(file))
 if(trees.some(tree=>!tree||tree.parseDiagnostics.length))throw Error('Generated split graph parse failed')
 const helperNames=new Set<string>()
 for(const tree of trees)walk(tree,n=>{if(ts.isFunctionDeclaration(n)&&n.name&&n.parameters.some((p:any)=>ts.isIdentifier(p.name)&&['$','on'].includes(p.name.text)))helperNames.add(n.name.text)})
 const symbolRenames=new Map<any,string>(),renames:any[]=[]
 for(const tree of trees)walk(tree,n=>{
  if(!(ts.isVariableDeclaration(n)||ts.isParameter(n)||ts.isBindingElement(n))||!ts.isIdentifier(n.name)||!helperNames.has(n.name.text))return
  if(n.initializer&&(ts.isArrowFunction(n.initializer)||ts.isFunctionExpression(n.initializer)))return
  const symbol=checker.getSymbolAtLocation(n.name);if(!symbol)throw Error('Unresolved SDK helper shadow binding')
  const replacement=n.name.text+'_m1split_local'+(renames.length+1)
  if(trees.some(t=>t.text.includes(replacement)))throw Error('SDK shadow replacement collision')
  symbolRenames.set(symbol,replacement);renames.push({chunk:basename(tree.fileName),name:n.name.text,replacement})
 })
 function resolvedSymbol(n:any):any{
  let symbol=checker.getSymbolAtLocation(n)
  if(symbol&&(symbol.flags&ts.SymbolFlags.Alias))symbol=checker.getAliasedSymbol(symbol)
  return symbol
 }
 const matcherDeclarations=new Set<any>()
 for(const tree of trees)walk(tree,n=>{
  if(!ts.isCallExpression(n)||!ts.isIdentifier(n.expression)||n.expression.text!=='on'||!n.arguments[1]||!ts.isObjectLiteralExpression(n.arguments[1]))return
  for(const property of n.arguments[1].properties){
   if(!ts.isPropertyAssignment(property)||!ts.isIdentifier(property.initializer))continue
   for(const declaration of resolvedSymbol(property.initializer)?.declarations??[]){
    if(ts.isVariableDeclaration(declaration)&&ts.isVariableDeclarationList(declaration.parent)&&ts.isVariableStatement(declaration.parent.parent)&&ts.isSourceFile(declaration.parent.parent.parent)&&declaration.initializer&&ts.isStringLiteral(declaration.initializer))matcherDeclarations.add(declaration)
   }
  }
 })
function writesBinding(target, symbol): boolean {
  if (ts.isIdentifier(target)) {
    const shorthand = ts.isShorthandPropertyAssignment(target.parent) && target.parent.name === target
    let binding = shorthand ? checker.getShorthandAssignmentValueSymbol(target.parent) : checker.getSymbolAtLocation(target)
    if(binding&&(binding.flags&ts.SymbolFlags.Alias))binding=checker.getAliasedSymbol(binding)
    return binding === symbol
  }
  if (ts.isParenthesizedExpression(target)) return writesBinding(target.expression, symbol)
  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) return writesBinding(target.left, symbol)
  if (ts.isArrayLiteralExpression(target) || ts.isArrayBindingPattern(target)) return target.elements.some(element => writesBinding(element, symbol))
  if (ts.isObjectLiteralExpression(target)) return target.properties.some(property => {
    if (ts.isShorthandPropertyAssignment(property)) return writesBinding(property.name, symbol)
    if (ts.isPropertyAssignment(property)) return writesBinding(property.initializer, symbol)
    return ts.isSpreadAssignment(property) && writesBinding(property.expression, symbol)
  })
  if (ts.isObjectBindingPattern(target)) return target.elements.some(element => writesBinding(element.name, symbol))
  if (ts.isBindingElement(target)) return writesBinding(target.name, symbol)
  if (ts.isSpreadElement(target)) return writesBinding(target.expression, symbol)
  if (ts.isVariableDeclarationList(target)) return target.declarations.some(declaration => writesBinding(declaration.name, symbol))
  // Assigning an object's property reads its base/key; it does not replace either binding.
  return false
}
 const editMap=new Map<any,any[]>(trees.map(tree=>[tree,[]]))
 for(const tree of trees)walk(tree,n=>{
  if(!ts.isIdentifier(n))return
  const shorthand=ts.isShorthandPropertyAssignment(n.parent)&&n.parent.name===n
  const symbol=shorthand?checker.getShorthandAssignmentValueSymbol(n.parent):checker.getSymbolAtLocation(n)
  const replacement=symbol&&symbolRenames.get(symbol);if(!replacement)return
  const binding=ts.isBindingElement(n.parent)&&n.parent.name===n&&!n.parent.propertyName&&!n.parent.dotDotDotToken&&ts.isObjectBindingPattern(n.parent.parent)
  editMap.get(tree)!.push({start:n.getStart(tree),end:n.end,text:shorthand||binding?n.text+': '+replacement:replacement})
 })
 for(const declaration of matcherDeclarations){
  if(declaration.parent.declarations.length!==1)throw Error('Split compiler merged matcher binding; explicit split required')
  const symbol=checker.getSymbolAtLocation(declaration.name)
  for(const tree of trees)walk(tree,n=>{
   const target=ts.isBinaryExpression(n)&&n.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&n.operatorToken.kind<=ts.SyntaxKind.LastAssignment?n.left
    :ts.isForOfStatement(n)||ts.isForInStatement(n)?n.initializer
    :(ts.isPrefixUnaryExpression(n)||ts.isPostfixUnaryExpression(n))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(n.operator)?n.operand:undefined
   if(target&&writesBinding(target,symbol))throw Error('Mutable literal matcher binding')
  })
  const tree=declaration.getSourceFile(),start=declaration.parent.getStart(tree)
  if(tree.text.slice(start,start+3)==='var')editMap.get(tree)!.push({start,end:start+3,text:'const'})
 }
 const registerFile=join(rawDir,'register.js'),registerTree=program.getSourceFile(registerFile)
 if(!registerTree)throw Error('Direct register output missing')
 let declarations=0,exports=0
 for(const statement of registerTree.statements){
  if(ts.isVariableStatement(statement)&&statement.declarationList.declarations.some((d:any)=>ts.isIdentifier(d.name)&&d.name.text==='register')){
   if(statement.declarationList.declarations.length!==1)throw Error('Split register declaration merged')
   // Keyword-only edits preserve SDK shadow reference edits inside the initializer.
   const start=statement.declarationList.getStart(registerTree)
   if(registerTree.text.slice(start,start+3)!=='var')throw Error('Unexpected split register declaration kind')
   editMap.get(registerTree)!.push({start,end:start+3,text:'export const'});declarations++
  }
  if(ts.isExportDeclaration(statement)&&statement.exportClause&&ts.isNamedExports(statement.exportClause)&&statement.exportClause.elements.some((e:any)=>e.name.text==='register')){
   if(statement.exportClause.elements.length!==1)throw Error('Split register unexpectedly has public helpers')
   editMap.get(registerTree)!.push({start:statement.getStart(registerTree),end:statement.end,text:''});exports++
  }
 }
 if(declarations!==1||exports!==1)throw Error('Split register must own one direct declaration/export')
 for(const group of Object.keys(manifest.groups)){
  const groupTree=program.getSourceFile(join(rawDir,group+'.js'));if(!groupTree)throw Error('Public group missing')
  const names=[...new Bun.Transpiler({loader:'js'}).scan(groupTree.text).exports].sort()
  const expected=Object.values(publicAliases).filter((m:any)=>m.group===group).flatMap((m:any)=>Object.values(m.aliases)).sort()
  if(JSON.stringify(names)!==JSON.stringify(expected))throw Error('Group public export inventory changed: '+group)
 }
 const normalized=new Map<string,string>()
 for(const tree of trees){
  let text=tree.text;const before=new Bun.Transpiler({loader:'js'}).scan(text)
  const edits=editMap.get(tree)!.sort((a,b)=>b.start-a.start)
  for(let i=1;i<edits.length;i++)if(edits[i-1].start<edits[i].end)throw Error('Overlapping SDK normalization edits')
  for(const edit of edits)text=text.slice(0,edit.start)+edit.text+text.slice(edit.end)
  const after=new Bun.Transpiler({loader:'js'}).scan(text)
  if(JSON.stringify([...before.exports].sort())!==JSON.stringify([...after.exports].sort()))throw Error('Chunk public exports changed during SDK normalization')
  normalized.set(basename(tree.fileName),text)
 }
 let code=normalized.get('register.js')!
 const mapping=new Map<string,string>()
 let clientIdentifierEdits=0
 for(const c of [...clients].reverse()){
  const finalTree=ts.createSourceFile('register.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),calls:any[]=[]
  walk(finalTree,n=>{if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text===c.marker)calls.push(n)})
  if(calls.length!==1||calls[0].arguments.length!==c.names.length)throw Error('Split Client binding call changed')
  const local=new Map<string,string>()
  for(let i=0;i<c.names.length;i++){const argument=calls[0].arguments[i];if(!ts.isIdentifier(argument))throw Error('Complex Client binding requires review: '+c.names[i]);local.set(c.names[i],argument.text);if(mapping.has(c.names[i])&&mapping.get(c.names[i])!==argument.text)throw Error('Split Client bindings disagree: '+c.names[i]);mapping.set(c.names[i],argument.text)}
  const clientEdits:any[]=[]
  walk(c.client,n=>{if(reference(n)&&local.get(n.text)!==n.text)clientEdits.push({start:n.getStart(tree)-c.start,end:n.end-c.start,text:local.get(n.text)})})
  clientIdentifierEdits+=clientEdits.length
  let restored=c.source;for(const edit of clientEdits.sort((a,b)=>b.start-a.start))restored=restored.slice(0,edit.start)+edit.text+restored.slice(edit.end)
  code=code.slice(0,calls[0].getStart(finalTree))+restored+code.slice(calls[0].end)
 }
 // Public register remains alongside touch-client; static chunk imports move into m1-compiled.
 const restoredTree=ts.createSourceFile('register.tsx',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),importEdits:any[]=[]
 const clientTags:any[]=[]
 walk(restoredTree,n=>{if((ts.isJsxSelfClosingElement(n)||ts.isJsxOpeningElement(n))&&n.tagName.getText(restoredTree)===mapping.get('Client'))clientTags.push(n)})
 if(clientTags.length!==clients.length)throw Error('Restored split Client tag inventory changed')
 const restoredModules=clientTags.map((tag:any)=>{const clientModule=tag.attributes.properties.find((p:any)=>ts.isJsxAttribute(p)&&p.name.text==='module');if(!clientModule||!ts.isStringLiteral(clientModule.initializer)||!CLIENT_MODULES.includes(clientModule.initializer.text))throw Error('Restored split Client module path changed');return clientModule.initializer.text})
 if(restoredModules.filter(path=>path!=='./play-client.ts').length>1)throw Error('Restored split Client module path changed')
 for(const statement of restoredTree.statements)if(ts.isImportDeclaration(statement)){
  const path=statement.moduleSpecifier.text
  if(path===standalone){importEdits.push({start:statement.moduleSpecifier.getStart(restoredTree),end:statement.moduleSpecifier.end,text:JSON.stringify('./touch-client.ts')});continue}
  if(!path.startsWith('./')||!normalized.has(path.slice(2)))throw Error('Unexpected split register module edge')
  importEdits.push({start:statement.moduleSpecifier.getStart(restoredTree),end:statement.moduleSpecifier.end,text:JSON.stringify('./m1-compiled/'+path.slice(2))})
 }
 for(const edit of importEdits.sort((a,b)=>b.start-a.start))code=code.slice(0,edit.start)+edit.text+code.slice(edit.end)
 normalized.set('register.js',code)
 const sizes:any={}
 const header='// @ts-nocheck\n// Generated static split hook graph; SDK normalized.\n'
 for(const [name,original]of normalized){
  let text=original
  if(name!=='register.js'){
   const tree=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits:any[]=[]
   for(const statement of tree.statements)if(ts.isImportDeclaration(statement)&&statement.moduleSpecifier.text===standalone)edits.push({start:statement.moduleSpecifier.getStart(tree),end:statement.moduleSpecifier.end,text:JSON.stringify('../touch-client.ts')})
   for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.text+text.slice(edit.end)
   normalized.set(name,text)
  }
  if(text.includes(placeholder)||text.includes(standalone)||/\b(?:require|eval)\s*\(|\bimport\s*\(/.test(text)||text.includes(here)||text.includes(manifest.sourcePlugin))throw Error('Forbidden runtime construct/path in '+name)
  const checked=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,name==='register.js'?ts.ScriptKind.TSX:ts.ScriptKind.JS)
  if(checked.parseDiagnostics.length)throw Error('Normalized chunk parse failed: '+name)
  const scan=new Bun.Transpiler({loader:name==='register.js'?'tsx':'js',tsconfig:jsx}).scan(text)
  for(const dependency of scan.imports){const path=dependency.path.replace('./m1-compiled/','./');if(path===(name==='register.js'?'./touch-client.ts':'../touch-client.ts'))continue;if(!path.startsWith('./')||!normalized.has(path.slice(2)))throw Error('Chunk imports outside compiled graph')}
  sizes[name]=Buffer.byteLength(header+text+'\n');if(sizes[name]>=1048576)throw Error('Chunk exceeds engine module limit')
 }
 for(const [name,text]of normalized)if(name!=='register.js')await writeFile(join(outputDir,name),header+text+'\n')
 await writeFile(entry,header+normalized.get('register.js')+'\n')
 const canonicalMirrors:string[]=manifest.canonicalMirrors??[]
 for(const path of canonicalMirrors){
  if(canonicalMirrors.indexOf(path)!==canonicalMirrors.lastIndexOf(path)||path==='hooks/register.tsx'||path==='hooks/touch-client.ts'||publicAliases[path]||!manifest.sourceInputs[path])throw Error('Canonical mirror overlaps compiled ownership: '+path)
  await mirrorFile(join(here,'authored','plugin'),path)
  await mirrorFile(plugin,path,true)
  const bytes=await readFile(join(here,'authored','plugin',path))
  if(hash(bytes)!==manifest.sourceInputs[path].sha256)throw Error('Canonical mirror source identity changed: '+path)
  await writeFile(join(plugin,path),bytes)
 }
 const ownedPaths=['hooks/register.tsx','hooks/touch-client.ts',...Object.keys(publicAliases),...canonicalMirrors,...([...normalized.keys()].filter(name=>name!=='register.js').map(name=>'hooks/m1-compiled/'+name))]
 const maps:any={}
 for(const [path,metadata]of Object.entries(publicAliases)as [string,any][]){
  const sourcePath=path.replace(/^hooks\//,'hooks-source/'),module=sourcePath.replace(/\.tsx?$/,''),pairs=Object.entries(metadata.aliases)
  // A facade in a subfolder (main's hooks/cost/) reaches the chunks and the source through as many parents as it is deep.
  const up=path.split('/').length-2,here=up?'../'.repeat(up):'./'
  const facade='// Generated live public facade. Authoritative implementation: '+sourcePath+'\nexport {'+pairs.map(([name,alias])=>String(alias)+' as '+name).join(',')+"} from '"+here+"m1-compiled/"+metadata.group+".js'\n"+(publicTypes[path].length?"export type {"+publicTypes[path].join(',')+"} from '../"+'../'.repeat(up)+module+"'\n":'')
  await writeFile(join(plugin,path),facade)
  maps[sourcePath]={publicPath:path,group:'hooks/m1-compiled/'+metadata.group+'.js',aliases:metadata.aliases,exportLines:sourceLocations[path]}
 }
 for(const group of Object.keys(manifest.groups)){
  let declarations='// Generated declarations reexport the exact canonical type/value API.\n'
  for(const [path,metadata]of Object.entries(publicAliases)as [string,any][])if(metadata.group===group){const module=path.replace(/^hooks\//,'../../hooks-source/').replace(/\.tsx?$/,'');declarations+='export {'+Object.entries(metadata.aliases).map(([name,alias])=>name+' as '+String(alias)).join(',')+"} from '"+module+"'\n"}
  await writeFile(join(outputDir,group+'.d.ts'),declarations);ownedPaths.push('hooks/m1-compiled/'+group+'.d.ts')
 }
 ownedPaths.push('hooks/m1-compiled/manifest.json')
 const outputManifest={version:1,policy:'Static four-group graph with live public reexports; canonical authored sources remain strict checked; touch-client remains standalone; existing first-use data boundary unchanged.',groups:manifest.groups,sourceInputs:Object.fromEntries(Object.entries(manifest.sourceInputs).map(([path,value])=>[path.replace(/^hooks\//,'hooks-source/'),value])),publicMap:maps,register:{source:'hooks-source/register.tsx',publicPath:'hooks/register.tsx'},standalone:['hooks/touch-client.ts'],canonicalMirrors,ownedPaths:ownedPaths.sort(),chunkBytes:sizes}
 await writeFile(join(outputDir,'manifest.json'),JSON.stringify(outputManifest,null,2)+'\n')
 await writeFile(join(here,'build-result.json'),JSON.stringify({policy:manifest.policy,chunkBytes:sizes,largestChunkBytes:Math.max(...Object.values(sizes) as number[]),totalBytes:Object.values(sizes).reduce((a:any,b:any)=>a+b,0),publicAliases,sdkHelperRenames:renames,matcherConstants:[...matcherDeclarations].map((d:any)=>({chunk:basename(d.getSourceFile().fileName),name:d.name.text})),clientIdentifierMappings:Object.fromEntries(mapping),clientIdentifierEdits,ownedPaths:ownedPaths.sort(),minify:{whitespace:true,syntax:false,identifiers:false}},null,2)+'\n')
 console.log(JSON.stringify({chunks:normalized.size,largestChunkBytes:Math.max(...Object.values(sizes) as number[]),totalBytes:Object.values(sizes).reduce((a:any,b:any)=>a+b,0),helperRenames:renames.length,matcherConstants:matcherDeclarations.size,clientIdentifierEdits}))
}catch(error){await writeFile(entry,source);throw error}
