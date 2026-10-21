// POSIX + bash/zsh shell lexer. Never throws: unterminated constructs
// close at the end of input. Pure string handling, no platform APIs.

export interface Token {
  kind: "word" | "op" | "heredoc" | "comment";
  text: string;
  quoted: boolean;
  start: number;
  end: number;
}

const SQ = "\u0027"; // single quote char
const DQ = "\u0022"; // double quote char

const OPS: Readonly<Record<string, readonly string[]>> = {
  "<": ["<<<", "<<-", "<<", "<&", "<>", "<"],
  ">": [">>", ">&", ">|", ">"],
  ";": [";;&", ";;", ";&", ";"],
  "&": ["&>>", "&&", "&>", "&"],
  "|": ["||", "|&", "|"],
  "(": ["("],
  ")": [")"],
};

// One byte per ASCII code: ordinary word characters are 1, digits are 2.
// A leading digit still takes the fd-redirection path before joining a word.
const WORD_CHARS = new Uint8Array(128);
WORD_CHARS.fill(1, 65, 91);
WORD_CHARS.fill(1, 97, 123);
WORD_CHARS.fill(2, 48, 58);
for (const code of [45, 46, 47, 58, 95]) WORD_CHARS[code] = 1;

// A backslash right before a newline, or before a CRLF pair, is a line
// continuation: the two lines join and the backslash is not an escape.
function continuationLen(s: string, i: number): number {
  if (s[i] !== "\\") return 0;
  if (s[i + 1] === "\n") return 2;
  if (s[i + 1] === "\r" && s[i + 2] === "\n") return 3;
  return 0;
}

// True when the text read so far can only be the start of a Windows drive
// path, where a backslash separates names rather than escaping the next
// character. Bare cmd and PowerShell words are written that way.
export function winDriveContext(text: string): boolean {
  return /^[A-Za-z]:$/.test(text) || /^[A-Za-z]:[\\/]/.test(text);
}

function isBlank(c: string): boolean {
  return c === " " || c === "\t" || c === "\r";
}
function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}
function isOpChar(c: string): boolean {
  return c === "&" || c === "|" || c === ";" || c === "(" || c === ")" || c === "<" || c === ">";
}
function matchOpAt(s: string, i: number): number {
  const candidates = OPS[s[i]];
  if (!candidates) return 0;
  for (const op of candidates) {
    if (s.startsWith(op, i)) return op.length;
  }
  return 0;
}

function plainTokens(src: string, start: number, toks: Token[]): number {
  let i = start;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (isBlank(c)) { i++; continue; }
    if (c === "\n") {
      toks.push({ kind: "op", text: c, quoted: false, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "(" || c === ")" || (c === "&" && src[i + 1] !== ">")) {
      const end = i + matchOpAt(src, i);
      toks.push({ kind: "op", text: src.slice(i, end), quoted: false, start: i, end });
      i = end;
      continue;
    }
    if (!(WORD_CHARS[src.charCodeAt(i)] > 0)) return i;
    let end = i + 1;
    while (end < n && WORD_CHARS[src.charCodeAt(end)] > 0) end++;
    const next = src[end];
    // Only complete plain words belong here. Adjacent quoting, escapes and
    // substitutions must retain the current word in the full scanner.
    if (end < n && !isBlank(next) && next !== "\n" && !isOpChar(next)) return i;
    if ((next === "<" || next === ">") && (src[end + 1] === "(" || isDigit(c))) return i;
    toks.push({ kind: "word", text: src.slice(i, end), quoted: false, start: i, end });
    i = end;
  }
  return i;
}

// Each scanner returns the end index (exclusive) of the construct it skips.
// All of them are forgiving: unterminated input ends at s.length.
function scanSingle(s: string, i: number): number {
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === SQ) return j + 1;
    j++;
  }
  return s.length;
}
function scanDouble(s: string, i: number): number {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") { j += 2; continue; }
    if (c === DQ) return j + 1;
    j++;
  }
  return s.length;
}
function scanAnsiC(s: string, i: number): number {
  let j = i + 2;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") { j += 2; continue; }
    if (c === SQ) return j + 1;
    j++;
  }
  return s.length;
}
function scanBacktick(s: string, i: number): number {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "`") return j + 1;
    j++;
  }
  return s.length;
}
// Extraction needs a real delimiter rather than scanBacktick's forgiving
// end-of-input convention. A closed backtick command may have its own
// balanced quotes; an unmatched body quote cannot borrow an outer delimiter.
function backtickCloser(s: string, i: number, inDouble: boolean): number {
  let quote: string | null = null;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === "`") return inDouble && quote !== null ? -1 : j;
    if (inDouble && (s[j] === SQ || s[j] === DQ)) {
      if (quote === null) quote = s[j];
      else if (quote === s[j]) quote = null;
    }
  }
  return -1;
}

function scanParen(s: string, i: number): number {
  // s[i] is an opening paren: balanced, quote aware
  let depth = 1;
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === SQ) { j = scanSingle(s, j); continue; }
    if (c === DQ) { j = scanDouble(s, j); continue; }
    if (c === "`") { j = scanBacktick(s, j); continue; }
    if (c === "\\" && j + 1 < s.length) { j += 2; continue; }
    if (c === "$" && s[j + 1] === "(") { depth++; j += 2; continue; }
    if (c === "(") { depth++; j++; continue; }
    if (c === ")") { depth--; j++; if (depth === 0) return j; continue; }
    j++;
  }
  return s.length;
}
function scanDollarParen(s: string, i: number): number {
  // s[i] is $, s[i+1] is (
  return scanParen(s, i + 1);
}
function scanBraceParam(s: string, i: number): number {
  let j = i + 2;
  while (j < s.length) {
    const c = s[j];
    if (c === SQ) { j = scanSingle(s, j); continue; }
    if (c === DQ) { j = scanDouble(s, j); continue; }
    if (c === "`") { j = scanBacktick(s, j); continue; }
    if (c === "\\" && j + 1 < s.length) { j += 2; continue; }
    if (c === "}") return j + 1;
    j++;
  }
  return s.length;
}

interface HeredocPending { delim: string; }

export function lex(src: string): Token[] {
  const toks: Token[] = [];
  const n = src.length;
  let i = 0;
  let pending: HeredocPending[] = [];

  let wtext = "";
  let wstart = -1;
  let wquoted = false;
  const flush = (): void => {
    if (wstart >= 0) {
      toks.push({ kind: "word", text: wtext, quoted: wquoted, start: wstart, end: i });
    }
    wstart = -1;
    wtext = "";
    wquoted = false;
  };

  const pushOp = (text: string, start: number, end: number): void => {
    toks.push({ kind: "op", text, quoted: false, start, end });
  };

  // consume a redirection starting at i: optional fd digits, then the operator,
  // then an absorbed fd for duplications (2>&1, >&2, <&-)
  const consumeRedirect = (): void => {
    let d = i;
    while (d < n && isDigit(src[d])) d++;
    const opLen = matchOpAt(src, d);
    let end = d + (opLen > 0 ? opLen : 1);
    let text = src.slice(i, end);
    const core = src.slice(d, end);
    if (core === "<&" || core === ">&" || core === "&>" || core === "&>>") {
      let e = end;
      while (e < n && (isDigit(src[e]) || src[e] === "-")) e++;
      if (e > end) { text = src.slice(i, e); end = e; }
    }
    if (text === "<<" || text === "<<-") {
      const h = parseHeredocDelimiter(src, end);
      if (h) { pending.push({ delim: h.delim }); text = text + h.raw; end = h.next; }
    }
    pushOp(text, i, end);
    i = end;
  };

  const readHeredocBody = (h: HeredocPending): void => {
    const bodyStart = i;
    let j = i;
    let found = false;
    while (j < n) {
      const k = src.indexOf("\n", j);
      const lineEnd = k < 0 ? n : k;
      const line = src.slice(j, lineEnd);
      const cmp = line.replace(/^[\t ]*/, "");
      if (cmp === h.delim) { found = true; break; }
      if (k < 0) { j = n; break; }
      j = k + 1;
    }
    let bodyText: string;
    let endPos: number;
    if (found) {
      endPos = j;
      bodyText = src.slice(bodyStart, j);
      const k = src.indexOf("\n", j);
      i = k < 0 ? n : k + 1;
    } else {
      endPos = n;
      bodyText = src.slice(bodyStart, n);
      i = n;
    }
    if (bodyText.endsWith("\n")) bodyText = bodyText.slice(0, -1);
    toks.push({ kind: "heredoc", text: bodyText, quoted: true, start: bodyStart, end: endPos });
  };

  while (i < n) {
    if (wstart < 0 && pending.length === 0) {
      i = plainTokens(src, i, toks);
      if (i >= n) break;
    }
    const c = src[i];

    const firstClass = WORD_CHARS[src.charCodeAt(i)];
    if (firstClass === 1 || (wstart >= 0 && firstClass === 2)) {
      if (wstart < 0) { wstart = i; wtext = ""; }
      let end = i + 1;
      while (end < n) {
        if (WORD_CHARS[src.charCodeAt(end)] > 0) end++;
        else break;
      }
      wtext += src.slice(i, end);
      i = end;
      continue;
    }

    if (isBlank(c)) { flush(); i++; continue; }

    if (c === "\n") {
      flush();
      pushOp("\n", i, i + 1);
      i++;
      while (pending.length > 0) {
        const h = pending.shift() as HeredocPending;
        readHeredocBody(h);
      }
      continue;
    }

    const cont = continuationLen(src, i);
    if (cont > 0) {
      // line continuation: dropped from the token text, and it never opens a
      // word of its own, so no empty token appears between the two lines
      i += cont;
      continue;
    }

    if (c === "\\" && i + 1 < n) {
      // outside quotes a backslash escapes any next character, including
      // blanks, operators and a hash, into the current word
      if (wstart < 0) { wstart = i; wtext = ""; }
      if (winDriveContext(wtext)) {
        // inside a bare drive path it is a separator, not an escape
        wtext += c;
        i++;
        continue;
      }
      wtext += src.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (c === "#") {
      // comment only at the start of a word, outside quotes
      if (wstart < 0) {
        flush();
        let k = src.indexOf("\n", i);
        if (k < 0) k = n;
        toks.push({ kind: "comment", text: src.slice(i, k), quoted: true, start: i, end: k });
        i = k;
        continue;
      }
      wtext += c; i++; continue;
    }

    if (wstart < 0 && isDigit(c)) {
      let d = i;
      while (d < n && isDigit(src[d])) d++;
      if (d < n && (src[d] === "<" || src[d] === ">")) {
        flush();
        consumeRedirect();
        continue;
      }
    }

    if ((c === "<" || c === ">") && src[i + 1] === "(") {
      // process substitution: part of the current word
      if (wstart < 0) { wstart = i; wtext = ""; }
      const e = scanParen(src, i + 1);
      wtext += src.slice(i, e);
      i = e;
      continue;
    }

    if (isOpChar(c)) {
      flush();
      if (c === "<" || c === ">") { consumeRedirect(); continue; }
      const opLen = matchOpAt(src, i);
      const end = i + (opLen > 0 ? opLen : 1);
      const text = src.slice(i, end);
      pushOp(text, i, end);
      i = end;
      continue;
    }

    if ((c === "{" || c === "}") && wstart < 0) {
      const nx = src[i + 1];
      if (nx === undefined || isBlank(nx) || nx === "\n" || isOpChar(nx)) {
        flush();
        pushOp(c, i, i + 1);
        i++;
        continue;
      }
    }

    if (c === "`") {
      if (wstart < 0) { wstart = i; wtext = ""; }
      const e = scanBacktick(src, i);
      wtext += src.slice(i, e);
      i = e;
      continue;
    }

    if (c === "$") {
      if (src[i + 1] === "(") {
        if (wstart < 0) { wstart = i; wtext = ""; }
        const e = scanDollarParen(src, i);
        wtext += src.slice(i, e);
        i = e;
        continue;
      }
      if (src[i + 1] === SQ) {
        if (wstart < 0) { wstart = i; wtext = ""; }
        const e = scanAnsiC(src, i);
        wtext += src.slice(i, e);
        wquoted = true;
        i = e;
        continue;
      }
      if (src[i + 1] === "{") {
        if (wstart < 0) { wstart = i; wtext = ""; }
        const e = scanBraceParam(src, i);
        wtext += src.slice(i, e);
        i = e;
        continue;
      }
      if (wstart < 0) { wstart = i; wtext = ""; }
      wtext += c;
      i++;
      continue;
    }

    if (c === SQ) {
      if (wstart < 0) { wstart = i; wtext = ""; }
      const e = scanSingle(src, i);
      wtext += src.slice(i, e);
      wquoted = true;
      i = e;
      continue;
    }
    if (c === DQ) {
      if (wstart < 0) { wstart = i; wtext = ""; }
      const e = scanDouble(src, i);
      wtext += src.slice(i, e);
      wquoted = true;
      i = e;
      continue;
    }

    if (wstart < 0) { wstart = i; wtext = ""; }
    // All syntax-bearing characters above keep their existing paths. Copy the
    // following ordinary ASCII run together instead of revisiting every branch.
    let end = i + 1;
    while (end < n) {
      const code = src.charCodeAt(end);
      if ((code >= 97 && code <= 122) || (code >= 65 && code <= 90) ||
          (code >= 48 && code <= 57) || code === 95 || code === 46 ||
          code === 47 || code === 58 || code === 45) end++;
      else break;
    }
    wtext += src.slice(i, end);
    i = end;
  }
  flush();
  while (pending.length > 0) {
    const h = pending.shift() as HeredocPending;
    readHeredocBody(h);
  }
  return toks;
}

function parseHeredocDelimiter(src: string, i: number): { delim: string; raw: string; next: number } | null {
  const n = src.length;
  let k = i;
  while (k < n && isBlank(src[k])) k++;
  if (k >= n) return null;
  const c = src[k];
  let end = -1;
  let delim = "";
  if (c === SQ) { end = scanSingle(src, k); delim = src.slice(k + 1, end - 1); }
  else if (c === DQ) { end = scanDouble(src, k); delim = src.slice(k + 1, end - 1); }
  else if (c === "\\" && src[k + 1] !== undefined && src[k + 1] !== "\n") { end = k + 2; delim = src[k + 1]; }
  else {
    let j = k;
    while (j < n && !isBlank(src[j]) && src[j] !== "\n" && !isOpChar(src[j]) && src[j] !== "`") j++;
    if (j === k) return null;
    end = j;
    delim = src.slice(k, j);
  }
  return { delim, raw: src.slice(k, end), next: end };
}

/** Inner command texts of $(...) and `...` regions inside a raw word text. */
export function extractSubstitutions(text: string): string[] {
  const out: string[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === SQ) { i = scanSingle(text, i); continue; }
    if (c === DQ) { i = scanDoubleBody(text, i, out); continue; }
    if ((c === "<" || c === ">") && text[i + 1] === "(") {
      const e = scanParen(text, i + 1);
      if (e > i + 3 && text[e - 1] === ")") out.push(text.slice(i + 2, e - 1));
      i = e;
      continue;
    }
    if (c === "\\" && i + 1 < n) { i += 2; continue; }
    if (c === "`") {
      const close = backtickCloser(text, i, false);
      if (close > i + 1) out.push(text.slice(i + 1, close));
      i = close < 0 ? n : close + 1;
      continue;
    }
    if (c === "$" && text[i + 1] === "(") {
      const e = scanDollarParen(text, i);
      if (e > i + 3 && text[e - 1] === ")") out.push(text.slice(i + 2, e - 1));
      i = e;
      continue;
    }
    if (c === "$" && text[i + 1] === SQ) { i = scanAnsiC(text, i); continue; }
    i++;
  }
  return out;
}

// Walk a double quoted region collecting the command substitutions in it:
// inside double quotes $( ) and backticks still run, so their inner command
// texts have to be reported like unquoted ones.
function scanDoubleBody(text: string, i: number, out: string[]): number {
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") { j += 2; continue; }
    if (c === DQ) return j + 1;
    if (c === "`") {
      const close = backtickCloser(text, j, true);
      if (close < 0) return scanDouble(text, i);
      if (close > j + 1) out.push(text.slice(j + 1, close));
      j = close + 1;
      continue;
    }
    if (c === "$" && text[j + 1] === "(") {
      const e = scanDollarParen(text, j);
      if (e > j + 3 && text[e - 1] === ")") out.push(text.slice(j + 2, e - 1));
      j = e;
      continue;
    }
    j++;
  }
  return text.length;
}

function bodyEnd(raw: string, i: number, e: number, closer: string): number {
  // end index of the quoted body, tolerating an unterminated quote
  if (e <= raw.length && raw[e - 1] === closer) return e - 1;
  return Math.min(e, raw.length);
}

/** Remove quoting from a raw word: quotes dropped, escapes applied.
    Parameter and command substitutions stay as typed; ANSI-C quotes are
    unescaped. Used for the unquoted argv of simpleCommands. */
export function unquoteWord(raw: string): string {
  const n = raw.length;
  let i = 0;
  let out = "";
  while (i < n) {
    const c = raw[i];
    if (c === SQ) {
      const e = scanSingle(raw, i);
      out += raw.slice(i + 1, bodyEnd(raw, i, e, SQ));
      i = e;
      continue;
    }
    if (c === DQ) {
      const e = scanDouble(raw, i);
      const stop = bodyEnd(raw, i, e, DQ);
      let j = i + 1;
      while (j < stop) {
        const d = raw[j];
        if (d === "\\" && j + 1 <= stop) {
          const nx = raw[j + 1];
          if (nx === DQ || nx === "$" || nx === "`" || nx === "\\" || nx === "\n") { out += nx === "\n" ? "" : nx; j += 2; continue; }
          out += d; j++; continue;
        }
        out += d; j++;
      }
      i = e;
      continue;
    }
    if (c === "$" && raw[i + 1] === SQ) {
      const e = scanAnsiC(raw, i);
      out += unescapeAnsiC(raw.slice(i + 2, bodyEnd(raw, i, e, SQ)));
      i = e;
      continue;
    }
    const cont = continuationLen(raw, i);
    if (cont > 0) { i += cont; continue; }
    if (c === "\\" && i + 1 < n) {
      if (winDriveContext(out)) { out += c; i++; continue; }
      out += raw[i + 1]; i += 2; continue;
    }
    out += c;
    i++;
  }
  return out;
}

const HEX = "0123456789abcdefABCDEF";
const OCT = "01234567";

/** Unescape the body of an ANSI-C quoted string. */
export function unescapeAnsiC(body: string): string {
  const n = body.length;
  let i = 0;
  let out = "";
  while (i < n) {
    const c = body[i];
    if (c !== "\\") { out += c; i++; continue; }
    const d = body[i + 1];
    if (d === undefined) { out += c; break; }
    if (d === "n") { out += "\n"; i += 2; continue; }
    if (d === "t") { out += "\t"; i += 2; continue; }
    if (d === "r") { out += "\r"; i += 2; continue; }
    if (d === "a") { out += "\x07"; i += 2; continue; }
    if (d === "b") { out += "\b"; i += 2; continue; }
    if (d === "f") { out += "\f"; i += 2; continue; }
    if (d === "v") { out += "\v"; i += 2; continue; }
    if (d === "e" || d === "E") { out += "\x1b"; i += 2; continue; }
    if (d === "\\" || d === SQ || d === DQ || d === "`") { out += d; i += 2; continue; }
    if (d === "x") {
      let j = i + 2;
      let hex = "";
      while (j < n && hex.length < 2 && HEX.includes(body[j] ?? " ")) { hex += body[j]; j++; }
      if (hex.length > 0) { out += String.fromCharCode(parseInt(hex, 16)); i = j; continue; }
      out += d; i += 2; continue;
    }
    if (d === "c") {
      const x = body[i + 2];
      if (x !== undefined && x !== "") { out += String.fromCharCode(x.toUpperCase().charCodeAt(0) & 31); i += 3; continue; }
      out += d; i += 2; continue;
    }
    if (OCT.includes(d)) {
      let j = i + 1;
      let oct = "";
      while (j < n && oct.length < 3 && OCT.includes(body[j] ?? " ")) { oct += body[j]; j++; }
      out += String.fromCharCode(parseInt(oct, 8) & 255);
      i = j;
      continue;
    }
    out += d;
    i += 2;
  }
  return out;
}

/** End index of the quoting or substitution region that starts at i:
    single and double quotes, ANSI-C quotes, backticks, $(...), ${...},
    <(...) and >(...). Forgiving on unterminated input. */
export function regionEnd(raw: string, i: number): number {
  const c = raw[i];
  if (c === SQ) return scanSingle(raw, i);
  if (c === DQ) return scanDouble(raw, i);
  if (c === "`") return scanBacktick(raw, i);
  if (c === "$") {
    if (raw[i + 1] === "(") return scanParen(raw, i + 1);
    if (raw[i + 1] === SQ) return scanAnsiC(raw, i);
    if (raw[i + 1] === "{") return scanBraceParam(raw, i);
    const nm = /^[A-Za-z_][A-Za-z0-9_]*/.exec(raw.slice(i + 1));
    if (nm && nm[0]) return i + 1 + nm[0].length;
    return i + 1;
  }
  if ((c === "<" || c === ">") && raw[i + 1] === "(") return scanParen(raw, i + 1);
  return i + 1;
}
