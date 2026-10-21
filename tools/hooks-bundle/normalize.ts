// Build-time engine adapter. Symbol references, not text replacements, are renamed.
import fs from 'node:fs'
const [file, compiler, metafile, graphFile, receiptFile, referenceFile, mode] = process.argv.slice(2)
const ts = await import(compiler).then(m => m.default ?? m)
const original = fs.readFileSync(file, 'utf8')
if (!referenceFile) throw Error('unminified reference required for whitespace qualification')
const reference = fs.readFileSync(referenceFile, 'utf8')
function fingerprint(text) {
  const tree = ts.createSourceFile('comparison.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (tree.parseDiagnostics.length) throw Error('invalid raw bundle syntax')
  function shape(node) {
    const children = []; ts.forEachChild(node, child => { children.push(shape(child)) })
    const literal = ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) || ts.isRegularExpressionLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    // AST children preserve property names, operators, statement order and parentheses.
    // Declaration flags distinguish var/let/const; literal spellings remain byte exact.
    return [node.kind, ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) ? node.operator : null, ts.isVariableDeclarationList(node) ? node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing) : 0, literal ? node.getText(tree) : null, children]
  }
  return JSON.stringify(shape(tree))
}
if (fingerprint(reference) !== fingerprint(original)) throw Error('whitespace-only AST or literal identity changed')
const whitespaceQualification = { astAndLiteralIdentity: true, referenceBytes: Buffer.byteLength(reference), whitespaceBytes: Buffer.byteLength(original), minifyIdentifiers: false, minifySyntax: false }
if (mode === '--identity-only') { fs.writeFileSync(receiptFile, JSON.stringify({ whitespaceQualification }) + '\n'); process.exit(0) }
if (mode) throw Error('unknown normalization mode')
const program = ts.createProgram([file], { allowJs: true, checkJs: false, noLib: true, noResolve: true })
const source = program.getSourceFile(file)
const checker = program.getTypeChecker()
const functionNames = new Set<string>()
function walk(node, fn) { fn(node); ts.forEachChild(node, child => walk(child, fn)) }
walk(source, node => {
  if (ts.isFunctionDeclaration(node) && node.name && node.parameters.some(p => ts.isIdentifier(p.name) && ['$','on'].includes(p.name.text))) functionNames.add(node.name.text)
})
const symbols = new Map()
const renames = []
walk(source, node => {
  if (!(ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) || !ts.isIdentifier(node.name) || !functionNames.has(node.name.text)) return
  if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return
  const symbol = checker.getSymbolAtLocation(node.name)
  if (!symbol) throw Error('unresolved lexical binding')
  const prior = original.slice(0, node.getStart()).match(/^\/\/ (?:plugin\/)?hooks\/([^\n]+)$/gm)?.at(-1) ?? 'local'
  const module = prior.replace(/^\/\/ (?:plugin\/)?hooks\//,'').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9]/g,'_')
  const replacement = `${node.name.text}_${module}_local${renames.length + 1}`
  if (original.includes(replacement)) throw Error('adapter name already exists')
  symbols.set(symbol, replacement)
  renames.push({ name: node.name.text, replacement, line: source.getLineAndCharacterOfPosition(node.name.getStart()).line + 1 })
})
const edits = []
walk(source, node => {
  if (!ts.isIdentifier(node)) return
  const shorthand = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
  const symbol = shorthand ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node)
  const replacement = symbol && symbols.get(symbol)
  if (!replacement) return
  const binding = ts.isBindingElement(node.parent) && node.parent.name === node && !node.parent.propertyName && !node.parent.dotDotDotToken && ts.isObjectBindingPattern(node.parent.parent)
  edits.push({ start: node.getStart(), end: node.end, replacement: shorthand || binding ? `${node.text}: ${replacement}` : replacement })
})
const matcherConstants = new Set()
walk(source, node => {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'on' || !node.arguments[1] || !ts.isObjectLiteralExpression(node.arguments[1])) return
  for (const property of node.arguments[1].properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.initializer)) continue
    for (const declaration of checker.getSymbolAtLocation(property.initializer)?.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent) && declaration.parent.declarations.length === 1 && ts.isVariableStatement(declaration.parent.parent) && ts.isSourceFile(declaration.parent.parent.parent) && declaration.initializer && ts.isStringLiteral(declaration.initializer)) matcherConstants.add(declaration)
    }
  }
})
function writesBinding(target, symbol): boolean {
  if (ts.isIdentifier(target)) {
    const shorthand = ts.isShorthandPropertyAssignment(target.parent) && target.parent.name === target
    return (shorthand ? checker.getShorthandAssignmentValueSymbol(target.parent) : checker.getSymbolAtLocation(target)) === symbol
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
for (const declaration of matcherConstants) {
  const symbol = checker.getSymbolAtLocation(declaration.name)
  walk(source, node => {
    const target = ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment ? node.left
      : ts.isForOfStatement(node) || ts.isForInStatement(node) ? node.initializer
      : (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) ? node.operand
      : undefined
    if (target && writesBinding(target, symbol)) throw Error('mutable matcher binding')
  })
  const start = declaration.parent.getStart()
  const keyword = declaration.parent.getFirstToken(source)
  if (!keyword || keyword.kind !== ts.SyntaxKind.VarKeyword || keyword.getStart(source) !== start) throw Error('unexpected matcher declaration')
  edits.push({ start, end: keyword.end, replacement: 'const' })
}
const exports = source.statements.filter(node => ts.isExportDeclaration(node))
const declarations = source.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'register'))
if (exports.length !== 1 || declarations.length !== 1) throw Error('unexpected Bun register export count')
const exported = exports[0], statement = declarations[0], declaration = statement.declarationList.declarations[0]
if (exported.moduleSpecifier || exported.isTypeOnly || !exported.exportClause || !ts.isNamedExports(exported.exportClause) || exported.exportClause.elements.length !== 1 || exported.exportClause.elements[0].name.text !== 'register' || exported.exportClause.elements[0].propertyName || statement.declarationList.declarations.length !== 1 || !ts.isIdentifier(declaration.name) || declaration.name.text !== 'register' || !declaration.initializer || !ts.isArrowFunction(declaration.initializer) || statement.modifiers?.length) throw Error('unexpected Bun register export shape')
const keyword = statement.declarationList.getFirstToken(source)
if (!keyword || keyword.kind !== ts.SyntaxKind.VarKeyword) throw Error('unexpected register declaration keyword')
edits.push({ start: keyword.getStart(source), end: keyword.end, replacement: 'export const' })
edits.push({ start: exported.getStart(source), end: exported.end, replacement: '' })
let output = original
let boundary = original.length
for (const edit of edits.sort((a,b) => b.start - a.start)) {
  if (edit.end > boundary || edit.start < 0 || edit.end <= edit.start) throw Error('overlapping adapter edits')
  output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end); boundary = edit.start
}
const graph = JSON.parse(fs.readFileSync(metafile, 'utf8'))
const inputs = Object.keys(graph.inputs).sort()
if (!inputs.length || inputs.some(path => !/^hooks\/[A-Za-z0-9_./-]+\.[cm]?[jt]sx?$/.test(path) || path.split('/').includes('..'))) throw Error('unexpected graph input')
fs.writeFileSync(graphFile, inputs.join('\n') + '\n')
fs.writeFileSync(file, output)
fs.writeFileSync(receiptFile, JSON.stringify({ whitespaceQualification, directRegisterExport: true, renames, matcherConstants: [...matcherConstants].map(d => d.name.getText()), referenceEdits: edits.length, bytes: Buffer.byteLength(output), graphInputs: inputs, typescriptVersion: ts.version }, null, 2) + '\n')
