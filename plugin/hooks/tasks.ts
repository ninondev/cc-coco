// Tool-boundary descriptions only. Never copy command arguments into the companion feed.
export type TaskKey = 'thinking' | 'reading' | 'editing' | 'running' | 'searching' | 'web' | 'helper' | 'planning' | 'using' | 'waitingOK' | 'waitingAnswer'
export type TaskDescription = { key: TaskKey; file?: string; cmd?: string; tool?: string }

export function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}

export function middleCut(text: string, length: number): string {
  const chars = [...text]
  if (chars.length <= length) return text
  const left = Math.ceil((length - 1) / 2)
  return `${chars.slice(0, left).join('')}…${chars.slice(-(length - 1 - left)).join('')}`
}

// A small shell lexer, not a shell evaluator. Quoted words remain single words; operators
// bound a command, including a cd prefix. Expansions are kept literal and never run.
function commandWords(command: string): string[] {
  return command.match(/(?:[^\s'";&|<>]+|'[^']*'|"(?:\\.|[^"\\])*")+|&&|\|\||[;&|<>\n]/g) ?? []
}

function unquote(word: string): string {
  return word.replace(/'([^']*)'|"((?:\\.|[^"\\])*)"/g, (_match, single: string | undefined, double: string | undefined) => single ?? double ?? '')
}

export function bashProgram(command: string): string {
  const tokens = commandWords(command)
  let i = 0
  while (i < tokens.length) {
    const word = unquote(tokens[i] ?? '')
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) { i += 1; continue }
    const name = basename(word)
    if (name === 'cd') {
      const and = tokens.indexOf('&&', i + 1)
      // Without &&, cd itself is the program; do not expose its directory argument.
      if (and < 0 || tokens.slice(i + 1, and).some(token => /^(?:[;&|<>]|\|\|)$/.test(token))) return 'cd'
      i = and + 1
      continue
    }
    if (name === 'sudo' || name === 'time' || name === 'nice') {
      i += 1
      while (i < tokens.length && (tokens[i] ?? '').startsWith('-')) {
        const option = tokens[i++] ?? ''
        if ((name === 'sudo' && /^-(?:u|g|h|p|C|T|r|t)$/.test(option))
            || (name === 'sudo' && /^--(?:user|group|host|prompt|close-from|command-timeout|role|type|chdir|chroot)$/.test(option))
            || (name === 'time' && /^(?:-o|--output|-f|--format)$/.test(option))
            || (name === 'nice' && /^(?:-n|--adjustment)$/.test(option))) i += 1
        if (option === '--') break
      }
      continue
    }
    if (!word || /^(?:&&|\|\||[;&|<>\n])$/.test(word)) return ''
    // A dynamic shell word is not a program name. Do not reveal a substitution's contents.
    if (/[`$]/.test(word)) return ''
    return [...name].slice(0, 16).join('')
  }
  return ''
}

export function taskForTool(input: { tool: string; [key: string]: unknown }): TaskDescription {
  const file = basename(typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : '')
  switch (input.tool) {
    case 'Read': return { key: 'reading', file }
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return { key: 'editing', file }
    case 'Bash': return { key: 'running', cmd: bashProgram(typeof input.command === 'string' ? input.command : '') }
    case 'Glob': case 'Grep': case 'ToolSearch': return { key: 'searching' }
    case 'WebSearch': case 'WebFetch': return { key: 'web' }
    case 'Agent': case 'Task': return { key: 'helper' }
    case 'TodoWrite': case 'EnterPlanMode': case 'ExitPlanMode': return { key: 'planning' }
    case 'AskUserQuestion': return { key: 'waitingAnswer' }
    default: return { key: 'using', tool: input.tool.startsWith('mcp__') ? input.tool.split('__').slice(2).join('__') : input.tool }
  }
}

function withoutLinks(text: string): string {
  // Balance the URL's parentheses; a simple [label](.*?) leaves a trailing ) for URLs
  // such as https://example.org/a_(b). The label's punctuation is retained verbatim.
  let plain = ''
  for (let i = 0; i < text.length; i++) {
    const image = text[i] === '!' && text[i + 1] === '['
    const open = image ? i + 1 : i
    if (text[open] !== '[') { plain += text[i]; continue }
    let close = open + 1
    let brackets = 1
    for (; close < text.length; close++) {
      if (text[close] === '\\') { close++; continue }
      if (text[close] === '[') brackets++
      if (text[close] === ']' && --brackets === 0) break
    }
    if (brackets !== 0 || text[close + 1] !== '(') { plain += text[i]; continue }
    let end = close + 2
    let parentheses = 1
    for (; end < text.length; end++) {
      if (text[end] === '\\') { end++; continue }
      if (text[end] === '(') parentheses++
      if (text[end] === ')' && --parentheses === 0) break
    }
    if (parentheses !== 0) { plain += text[i]; continue }
    plain += text.slice(open + 1, close)
    i = end
  }
  return plain
}

function withoutEmphasis(text: string): string {
  return text
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/\*(?=\S)([^*\r\n]*?\S)\*/g, '$1')
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\r\n]*?\S)_(?![\p{L}\p{N}_])/gu, '$1$2')
}

function protectCode(answer: string): { text: string; restore: (text: string) => string } {
  let marker = '\uE000'
  while (answer.includes(marker)) marker += '\uE000'
  const code: string[] = []
  const keep = (text: string): string => `${marker}${code.push(text) - 1}${marker}`
  const lines = answer.split(/\r?\n|\r/)
  const prose: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const fence = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(lines[i] ?? '')?.[1]
    if (!fence) { prose.push(lines[i] ?? ''); continue }
    const close = new RegExp(`^[ \\t]{0,3}${fence[0]}{${fence.length},}[ \\t]*$`)
    const body: string[] = []
    while (++i < lines.length && !close.test(lines[i] ?? '')) body.push(lines[i] ?? '')
    prose.push(keep(body.join('\n')))
  }
  const text = prose.join('\n')
  let protectedText = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '`') { protectedText += text[i]; continue }
    let length = 1
    while (text[i + length] === '`') length++
    let end = i + length
    let matched = false
    while (end < text.length) {
      if (text[end] !== '`') { end++; continue }
      let closing = 1
      while (text[end + closing] === '`') closing++
      if (closing === length) { matched = true; break }
      end += closing
    }
    if (matched) {
      protectedText += keep(text.slice(i + length, end))
      i = end + length - 1
    } else {
      protectedText += '`'.repeat(length)
      i += length - 1
    }
  }
  return { text: protectedText, restore: plain => plain.replace(new RegExp(`${marker}(\\d+)${marker}`, 'g'), (_token, id) => code[Number(id)] ?? '') }
}

/** Keep the author's words and punctuation, removing only Markdown presentation. */
export function replyExcerpt(answer: string): string {
  const protectedCode = protectCode(answer)
  const prose = withoutLinks(protectedCode.text)
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+[ \t]*)?$/gm, '$1')
    .replace(/^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+|>[ \t]?)/gm, '')
    .replace(/^[ \t]*(?:={3,}|-{3,})[ \t]*$/gm, '')
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, '')
  const plain = protectedCode.restore(withoutEmphasis(prose))
    .replace(/\r?\n|\r/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return [...plain].slice(0, 140).join('')
}
