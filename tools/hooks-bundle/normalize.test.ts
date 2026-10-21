import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const compiler = process.env.COCO_TYPESCRIPT
if (!compiler) throw Error('COCO_TYPESCRIPT is required for adapter tests')

function normalize(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'moe-normalize-test-'))
  const original = join(root, 'original.js'), adapted = join(root, 'adapted.js')
  writeFileSync(original, source)
  writeFileSync(adapted, source)
  writeFileSync(join(root, 'graph.json'), JSON.stringify({inputs:{'hooks/register.tsx':{bytes:1}}}))
  const run = spawnSync(process.execPath, ['--no-env-file', join(import.meta.dir,'normalize.ts'), adapted, compiler!, join(root,'graph.json'),join(root,'inputs.txt'),join(root,'receipt.json'),original], {encoding:'utf8'})
  return {root, original, adapted, run}
}

test('binding renames preserve closures, defaults, shorthand keys, methods, templates and function names', async () => {
  const fixture = `// hooks/probe.ts
function record($) { return 'handler'; }
function probe(record) {
  const object = {record, string:'record', regexp:/record/.source};
  const defaults = ({record = 7} = {}) => ({record});
  const renamed = ({record: alias = 9} = {}) => alias;
  class Item { record(record) { return {record, template: \`record \${record}\`}; } }
  const nested = () => { const record = 4; return {record}; };
  const callable = () => { const record = function stableName(){} ; return record.name; };
  return {object,defaults:defaults(),renamed:renamed(),method:new Item().record(3),nested:nested(),callable:callable(),captured:(()=>record)(),name:Item.prototype.record.name,handler:record};
}
var register = (on) => on('probe',()=>probe(2));
export {
  register
};
`
  const f = normalize(fixture)
  try {
    expect(f.run.status).toBe(0)
    const output = readFileSync(f.adapted,'utf8')
    expect(output).toContain('function record($)')
    expect(output).toContain('record(record_probe_local')
    const results = []
    for (const file of [f.original,f.adapted]) {
      const {register} = await import(file)
      register((_event,hook)=>results.push(hook()))
    }
    expect(results[1]).toEqual(results[0])
    expect(results[0]).toEqual({object:{record:2,string:'record',regexp:'record'},defaults:{record:7},renamed:9,method:{record:3,template:'record 3'},nested:{record:4},callable:'stableName',captured:2,name:'record',handler:2})
  } finally { rmSync(f.root,{recursive:true,force:true}) }
})

test('mutable literal matcher is rejected instead of converted to const', () => {
  const f = normalize(`var PANE="pane";\nPANE="changed";\nvar register = on => on('ui.render',{requestId:PANE},()=>{});\nexport {\n  register\n};\n`)
  try { expect(f.run.status).not.toBe(0);expect(f.run.stderr).toContain('mutable matcher binding') }
  finally { rmSync(f.root,{recursive:true,force:true}) }
})

test('object-rest binding keeps the remainder object and shorthand return key', async () => {
  const fixture = `// hooks/probe.ts
function record($) { return 'handler'; }
function probe(input) { const {omitted, ...record} = input; return {record}; }
var register = on => on('probe', () => probe({omitted:0, kept:1, nested:{value:2}}));
export {
  register
};
`
  const f = normalize(fixture)
  try {
    expect(f.run.status).toBe(0)
    const results = []
    for (const file of [f.original, f.adapted]) {
      const {register} = await import(file)
      register((_event, hook) => results.push(hook()))
    }
    expect(results).toEqual([
      {record:{kept:1,nested:{value:2}}},
      {record:{kept:1,nested:{value:2}}},
    ])
  } finally { rmSync(f.root, {recursive:true, force:true}) }
})

function matcherFixture(statement: string) {
  return `var PANE="pane";\n${statement}\nvar register = on => on('ui.render',{requestId:PANE},()=>{});\nexport {\n  register\n};\n`
}

const matcherWrites = [
  ['object shorthand', '({PANE} = {PANE:"changed"});'],
  ['object property', '({value:PANE} = {value:"changed"});'],
  ['nested object and array', '({value:[{name:PANE}]} = {value:[{name:"changed"}]});'],
  ['array element', '[PANE] = ["changed"];'],
  ['array rest', '[...PANE] = ["changed"];'],
  ['object rest', '({...PANE} = {value:"changed"});'],
  ['destructuring default', '({PANE = "changed"} = {});'],
  ['nested default', '[{value:PANE = "changed"} = {}] = [];'],
  ['for-of identifier', 'for (PANE of ["changed"]) {}'],
  ['for-in identifier', 'for (PANE in {changed:true}) {}'],
  ['for-of object', 'for ({value:PANE} of [{value:"changed"}]) {}'],
  ['for-in array', 'for ([PANE] in {changed:true}) {}'],
  ['for-of var declaration', 'for (var PANE of ["changed"]) {}'],
  ['prefix increment', '++PANE;'],
  ['postfix increment', 'PANE++;'],
  ['prefix decrement', '--PANE;'],
  ['postfix decrement', 'PANE--;'],
] as const

for (const [name, statement] of matcherWrites) test(`matcher write through ${name} is rejected before output changes`, () => {
  const fixture = matcherFixture(statement), f = normalize(fixture)
  try {
    expect(f.run.status).not.toBe(0)
    expect(f.run.stderr).toContain('mutable matcher binding')
    expect(readFileSync(f.adapted, 'utf8')).toBe(fixture)
  } finally { rmSync(f.root, {recursive:true, force:true}) }
})

const matcherReads = [
  ['unary reads', 'void [!PANE, ~PANE, +PANE, -PANE, typeof PANE];'],
  ['property assignment and computed keys', 'var holder={}; holder[PANE]="value"; ({[PANE]:holder.value} = {pane:"value"});'],
  ['shadowed writes', 'function local(PANE) { ({PANE}={PANE:"local"}); for (PANE of ["local"]) {} return PANE; } local("input"); for (let PANE of ["local"]) {}'],
] as const

for (const [name, statement] of matcherReads) test(`matcher ${name} preserve registration and allow const conversion`, async () => {
  const f = normalize(matcherFixture(statement))
  try {
    expect(f.run.status).toBe(0)
    expect(readFileSync(f.adapted, 'utf8')).toContain('const PANE="pane";')
    const results = []
    for (const file of [f.original, f.adapted]) {
      const {register} = await import(file)
      register((event, matcher) => results.push({event, matcher}))
    }
    expect(results).toEqual([
      {event:'ui.render', matcher:{requestId:'pane'}},
      {event:'ui.render', matcher:{requestId:'pane'}},
    ])
  } finally { rmSync(f.root, {recursive:true, force:true}) }
})
