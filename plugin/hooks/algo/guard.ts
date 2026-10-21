// classifyCommand: recognise clearly destructive shell commands, with
// precision first. Depends only on the lexer, no platform APIs.

import {
  lex,
  extractSubstitutions,
  unquoteWord,
  unescapeAnsiC,
  regionEnd,
  winDriveContext,
  type Token,
} from "./lexer";

export { lex } from "./lexer";
export type { Token } from "./lexer";

// note: the delete-command kind is written behind an escape in this source
export type GuardKind =
  | "push" | "reset" | "clean" | "chmod" | "chown" | "disk"
  | "drop" | "stash" | "history" | "infra" | "\u0072m";

export type GuardReason =
  | "force-push" | "push-delete" | "mirror-push"
  | "hard-reset" | "discard-worktree"
  | "clean-force"
  | "world-writable" | "owner-change"
  | "device-write" | "filesystem" | "partition"
  | "drop-database" | "drop-table" | "truncate" | "delete-all-rows" | "flush-store"
  | "stash-drop" | "stash-clear"
  | "history-rewrite" | "reflog-expire"
  | "terraform-destroy" | "pulumi-destroy" | "kubectl-delete" | "docker-volumes" | "bucket-delete"
  | "recursive-delete" | "find-delete" | "shred";

export interface GuardHit {
  kind: GuardKind;
  reason: GuardReason;
  target?: string;
  branch?: string;
  command: string;
}

export interface GuardContext {
  cwd: string;
  home: string;
  tmpdir?: string;
  branch?: string;
  defaultBranch?: string;
  platform?: "posix" | "windows";
}

interface CtxInfo {
  home: string;
  cwd: string;
  tmpdirRaw: string | null;
  win: boolean;
  branch?: string;
  defaultBranch?: string;
  cwdRes: string;
  homeRes: string;
  tmpRes: string | null;
}

const POSIX_TMP_BASES = ["/tmp", "/private/tmp", "/var/folders"];

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

function pushParts(stack: string[], parts: string[]): void {
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") { stack.pop(); continue; }
    stack.push(part);
  }
}

function resolvePosix(v: string, cwd: string): string {
  const stack: string[] = [];
  if (!v.startsWith("/")) {
    pushParts(stack, stripTrailingSlash(cwd).split("/"));
  }
  pushParts(stack, v.split("/"));
  return "/" + stack.join("/");
}

function winDrive(p: string): string {
  const m = /^([a-z]):/i.exec(p);
  return m ? m[1].toLowerCase() : "c";
}

function resolveWin(v: string, cwd: string): string {
  const s = v.replace(/[\\\/]+/g, "/").toLowerCase();
  if (s.startsWith("//")) {
    return "//" + s.slice(2).split("/").filter(x => x !== "").join("/");
  }
  const cwdDrive = winDrive(cwd);
  if (/^[a-z]:/.test(s)) {
    const stack: string[] = [];
    pushParts(stack, s.slice(2).split("/"));
    return s[0] + ":/" + stack.join("/");
  }
  const stack: string[] = [];
  if (!s.startsWith("/")) {
    const c = cwd.replace(/[\\\/]+/g, "/").toLowerCase().replace(/^[a-z]:/, "");
    pushParts(stack, c.split("/"));
  }
  pushParts(stack, s.split("/"));
  return cwdDrive + ":/" + stack.join("/");
}

interface Resolved { path: string; root: boolean }

function resolveIn(v: string, ci: CtxInfo): Resolved {
  if (ci.win) {
    const p = resolveWin(v, ci.cwdRes);
    if (p.startsWith("//")) return { path: p, root: false };
    return { path: p, root: /^[a-z]:\/$/.test(p) };
  }
  const p = resolvePosix(v, ci.cwdRes);
  return { path: p, root: p === "/" };
}

function isUnder(child: string, parent: string): boolean {
  if (parent === "/") return child.startsWith("/") && child !== "/";
  if (parent === "") return false;
  return child.length > parent.length && child.startsWith(parent + "/");
}

function makeCtx(ctx: GuardContext): CtxInfo {
  const win = ctx.platform === "windows";
  const ci: CtxInfo = {
    home: ctx.home,
    cwd: ctx.cwd,
    tmpdirRaw: ctx.tmpdir ?? null,
    win,
    branch: ctx.branch,
    defaultBranch: ctx.defaultBranch,
    cwdRes: "",
    homeRes: "",
    tmpRes: null,
  };
  ci.cwdRes = win ? resolveWin(ctx.cwd, "c:/") : resolvePosix(ctx.cwd, "/");
  ci.homeRes = win ? resolveWin(ctx.home, "c:/") : resolvePosix(ctx.home, "/");
  if (ctx.tmpdir) ci.tmpRes = win ? resolveWin(ctx.tmpdir, "c:/") : resolvePosix(ctx.tmpdir, "/");
  return ci;
}

// The temporary tree of the user: the given tmpdir when there is one, else
// the standard AppData Local Temp folder under the profile on Windows and
// /tmp elsewhere. Scratch work lives under it, so deleting inside it is
// contained, while the folder itself is still a target worth reporting.
function tempRoot(ci: CtxInfo): string {
  if (ci.tmpRes) return ci.tmpRes;
  if (ci.win) return ci.homeRes + "/appdata/local/temp";
  return "/tmp";
}

// the same folder as a Windows environment variable spells it
function winTempRaw(ci: CtxInfo): string {
  return ci.tmpdirRaw ?? stripTrailingSlash(ci.home) + "\\AppData\\Local\\Temp";
}

function contained(path: string, ci: CtxInfo): boolean {
  if (isUnder(path, ci.cwdRes)) return true;
  if (ci.tmpRes && isUnder(path, ci.tmpRes)) return true;
  if (ci.win) return isUnder(path, tempRoot(ci));
  for (const base of POSIX_TMP_BASES) {
    if (isUnder(path, base)) return true;
  }
  return false;
}

// ---------- words and expansion ----------

type Word0 = W | { raw: string; quoted: boolean; unq?: undefined; val?: undefined };

interface W {
  raw: string;        // as typed, quotes included
  unq: string;        // quotes removed, escapes applied
  quoted: boolean;
  val: string | null; // expanded value; null when any variable is unknown
}

type Vars = Record<string, string>;

const SQC = "\u0027";
const DQC = "\u0022";

function val(w: W): string {
  return w.val ?? w.unq;
}

function regionBody(raw: string, i: number, e: number, openLen: number, close: string): string {
  const stop = e <= raw.length && raw[e - 1] === close ? e - 1 : Math.min(e, raw.length);
  return raw.slice(i + openLen, stop);
}

function resolveVar(name: string, ci: CtxInfo, vars: Vars): string | null {
  if (name === "HOME") return ci.home;
  if (name === "PWD") return ci.cwd;
  if (name === "TMPDIR") return ci.tmpdirRaw;
  if (ci.win) {
    const low = name.toLowerCase();
    if (low === "userprofile" || low === "env:userprofile") return ci.home;
    if (low === "temp" || low === "tmp" || low === "env:temp" || low === "env:tmp") return winTempRaw(ci);
  }
  if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
  return null;
}

/** Expand a raw word: quotes removed, ~ and known variables replaced.
    Returns null when the word contains anything unknowable. */
function expandWord(raw: string, ci: CtxInfo, vars: Vars): string | null {
  const n = raw.length;
  let out = "";
  let i = 0;
  let unknown = false;
  if (raw[0] === "~" && (n === 1 || raw[1] === "/")) {
    out += stripTrailingSlash(ci.home);
    i = 1;
  } else if (raw[0] === "~") {
    // ~user is another user home directory: absolute, never inside cwd or tmp
    out += "/~";
    i = 1;
  }
  while (i < n) {
    const c = raw[i];
    if (c === SQC) {
      const e = regionEnd(raw, i);
      out += regionBody(raw, i, e, 1, SQC);
      i = e;
      continue;
    }
    if (c === DQC) {
      const e = regionEnd(raw, i);
      const body = regionBody(raw, i, e, 1, DQC);
      let j = 0;
      while (j < body.length) {
        const d = body[j];
        if (d === "\\" && j + 1 < body.length) {
          const nx = body[j + 1];
          if (nx === DQC || nx === "$" || nx === "`" || nx === "\\") { out += nx; j += 2; continue; }
          if (nx === "\n") { j += 2; continue; }
          out += d; j++; continue;
        }
        if (d === "$" || d === "`") {
          const e2 = regionEnd(body, j);
          if (d === "`" || body[j + 1] === "(") { unknown = true; j = e2; continue; }
          const braced = body[j + 1] === "{";
          const inner = regionBody(body, j, e2, braced ? 2 : 1, "}");
          const nm = /^[A-Za-z_][A-Za-z0-9_]*/.exec(inner);
          if (nm && nm[0]) {
            const r2 = resolveDollar(nm[0], body, j + (braced ? 2 : 1) + nm[0].length, ci, vars);
            if (r2.value == null) unknown = true; else out += r2.value;
            j = braced ? e2 : r2.end;
            continue;
          }
          unknown = true;
          j = e2;
          continue;
        }
        out += d;
        j++;
      }
      i = e;
      continue;
    }
    if (c === "`") { unknown = true; i = regionEnd(raw, i); continue; }
    if (c === "$") {
      if (raw[i + 1] === "(") { unknown = true; i = regionEnd(raw, i); continue; }
      if (raw[i + 1] === SQC) {
        const e = regionEnd(raw, i);
        out += unescapeAnsiC(regionBody(raw, i, e, 2, SQC));
        i = e;
        continue;
      }
      const e = regionEnd(raw, i);
      const braced = raw[i + 1] === "{";
      const inner = regionBody(raw, i, e, braced ? 2 : 1, "}");
      const nm = /^[A-Za-z_][A-Za-z0-9_]*/.exec(inner);
      if (nm && nm[0]) {
        const r2 = resolveDollar(nm[0], raw, e, ci, vars);
        if (r2.value == null) unknown = true; else out += r2.value;
        i = r2.end;
        continue;
      }
      unknown = true; // $1, $?, $, ${...} without a plain name, lone $
      i = e;
      continue;
    }
    if (c === "\\" && raw[i + 1] === "\n") { i += 2; continue; }
    if (c === "\\" && i + 1 < n) {
      // inside a bare windows drive path the backslash is a separator, not
      // an escape: C:\Users keeps its backslashes on the windows platform
      if (ci.win && winDriveContext(out)) { out += c; i++; continue; }
      out += raw[i + 1];
      i += 2;
      continue;
    }
    if (c === "%" && ci.win) {
      const m = /^%(USERPROFILE|TEMP|TMP)%/i.exec(raw.slice(i));
      if (m) {
        out += m[1].toUpperCase() === "USERPROFILE" ? stripTrailingSlash(ci.home) : winTempRaw(ci);
        i += m[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return unknown ? null : out;
}

/** Resolve a variable reference that starts at the name; handles the
    PowerShell-style $env:NAME form on Windows. */
function resolveDollar(name: string, raw: string, after: number, ci: CtxInfo, vars: Vars): { value: string | null; end: number } {
  if (ci.win && name.toLowerCase() === "env" && raw[after] === ":") {
    const m = /^[A-Za-z_][A-Za-z0-9_]+/.exec(raw.slice(after + 1));
    if (m && m[0]) {
      return { value: resolveVar("env:" + m[0], ci, vars), end: after + 1 + m[0].length };
    }
  }
  return { value: resolveVar(name, ci, vars), end: after };
}

const WORD_TRANSFORMS = /['"$`\\~%]/;

function rawWord(raw: string, quoted: boolean): Word0 {
  // Literal words need no context-dependent expansion. Keep their normalized
  // representation in the parser's per-call word instead of allocating it again.
  return WORD_TRANSFORMS.test(raw)
    ? { raw, quoted }
    : { raw, unq: raw, quoted, val: raw };
}

function buildW(w: Word0, ci: CtxInfo, vars: Vars): W {
  if (w.unq !== undefined) return w;
  if (!WORD_TRANSFORMS.test(w.raw)) {
    return { raw: w.raw, unq: w.raw, quoted: w.quoted, val: w.raw };
  }
  return {
    raw: w.raw,
    unq: unquoteWord(w.raw),
    quoted: w.quoted,
    val: expandWord(w.raw, ci, vars),
  };
}

function commandName(w: W): string | null {
  const v = w.val;
  if (v == null || v === "") return null;
  const lastSeparator = Math.max(v.lastIndexOf("/"), v.lastIndexOf("\\"));
  return v.slice(lastSeparator + 1) || null;
}

const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

// words that only mark shell structure and never name a program
const HEAD_KEYWORDS = new Set(["if", "then", "elif", "else", "fi", "for", "while", "until", "do", "done", "case", "esac", "in", "!"]);

function dropHeadKeywords(raws: Word0[]): Word0[] {
  let i = 0;
  while (i < raws.length && !raws[i].quoted && HEAD_KEYWORDS.has(raws[i].raw)) i++;
  return i === 0 ? raws : raws.slice(i);
}

function recordAssignments(seg: Seg, vars: Vars, ci: CtxInfo): void {
  for (const w of seg.words) {
    if (!ASSIGN_RE.test(w.raw)) return; // only leading assignments
    const eq = w.raw.indexOf("=");
    const name = w.raw.slice(0, eq);
    const value = w.raw.slice(eq + 1);
    if (/[$`~]/.test(value)) {
      const scratch = scratchValue(value, ci);
      if (scratch != null) vars[name] = scratch;
      continue; // otherwise not a value we can replay
    }
    vars[name] = unquoteWord(value);
  }
}

// True when the command text is one mktemp call that creates a directory.
function isMktempDirectory(inner: string): boolean {
  const toks = inner.trim().split(/\s+/);
  if (toks.length === 0 || toks[0] !== "mktemp") return false;
  for (const t of toks.slice(1)) {
    if (t === "--") return false;
    if (t === "-d" || t === "--directory" || t.startsWith("--directory=")) return true;
    if (/^-[a-zA-Z]+$/.test(t) && t.slice(1).includes("d")) return true;
  }
  return false;
}

/** A variable assigned from $(mktemp -d) (or backticks, with literal text
    around it) names a scratch directory under the temporary root, so a
    recursive delete spelled from it is contained; mktemp without a
    directory flag names a file and stays unknown. */
function scratchValue(value: string, ci: CtxInfo): string | null {
  const v = unquoteWord(value);
  const m = /^([^$`]*)\$\(([^)]*)\)(.*)$/.exec(v) || /^([^`]*)`([^`]*)`(.*)$/.exec(v);
  if (!m) return null;
  const [, pre, inner, post] = m;
  if (/[$`]/.test(pre + post)) return null;
  if (!isMktempDirectory(inner)) return null;
  return pre + stripTrailingSlash(tempRoot(ci)) + "/mktemp" + post;
}

// ---------- simple commands ----------

interface Seg {
  words: Word0[];
  redirects: { op: string; raw: string | null }[];
  heredocs: string[];
}

const MAX_STRUCT_DEPTH = 32;
const SUBSTITUTION_START = /[$`<>]/;

function parseInput(src: string, depth: number): Seg[] {
  if (depth > MAX_STRUCT_DEPTH) return [];
  return parseTokens(lex(src), depth);
}

const SEPARATORS = new Set([";", "&&", "||", "|", "|&", "&", "\n", ";;", ";&", ";;&"]);

function parseTokens(toks: Token[], depth: number): Seg[] {
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  let pendingRedirect = false;
  const heredocSegs: Seg[] = [];
  const ensure = (): Seg => {
    if (!cur) cur = { words: [], redirects: [], heredocs: [] };
    return cur;
  };
  const flush = (): void => {
    if (cur && (cur.words.length > 0 || cur.redirects.length > 0)) segs.push(cur);
    cur = null;
    pendingRedirect = false;
  };

  let k = 0;
  while (k < toks.length) {
    const t = toks[k];
    if (t.kind === "heredoc") {
      const target = heredocSegs.shift();
      if (target) target.heredocs.push(t.text);
      k++;
      continue;
    }
    if (t.kind === "comment") { k++; continue; }
    if (t.kind === "op") {
      const x = t.text;
      if (SEPARATORS.has(x)) { flush(); k++; continue; }
      if (x === "(" || x === "{") {
        flush();
        const close = x === "(" ? ")" : "}";
        let d = 1;
        let j = k + 1;
        while (j < toks.length) {
          const u = toks[j];
          if (u.kind === "op") {
            if (u.text === x) d++;
            else if (u.text === close) { d--; if (d === 0) break; }
          }
          j++;
        }
        segs.push(...parseTokens(toks.slice(k + 1, j), depth + 1));
        k = j < toks.length ? j + 1 : j;
        continue;
      }
      if (x === ")" || x === "}") { flush(); k++; continue; }
      const seg = ensure();
      if (x.startsWith("<<") && x !== "<<<") {
        seg.redirects.push({ op: x, raw: null });
        heredocSegs.push(seg);
        pendingRedirect = false;
      } else {
        seg.redirects.push({ op: x, raw: null });
        pendingRedirect = true;
      }
      k++;
      continue;
    }
    // word token
    const seg = ensure();
    if (pendingRedirect) {
      seg.redirects[seg.redirects.length - 1].raw = t.text;
      pendingRedirect = false;
    } else {
      seg.words.push(rawWord(t.text, t.quoted));
    }
    k++;
  }
  flush();

  let out: Seg[] | null = null;
  for (let index = 0; index < segs.length; index++) {
    const s = segs[index];
    if (out) out.push(s);
    for (const wd of s.words) {
      if (!SUBSTITUTION_START.test(wd.raw)) continue;
      for (const inner of extractSubstitutions(wd.raw)) {
        const innerSegs = parseInput(inner, depth + 1);
        if (innerSegs.length === 0) continue;
        if (!out) out = segs.slice(0, index + 1);
        for (const is of innerSegs) out.push(is);
      }
    }
  }
  return out ?? segs;
}

/** Every simple command in order, as unquoted argv arrays. */
export function simpleCommands(command: string): string[][] {
  const segs = parseInput(command, 0);
  const out: string[][] = [];
  for (const seg of segs) {
    let i = 0;
    while (i < seg.words.length && ASSIGN_RE.test(seg.words[i].raw)) i++;
    if (i >= seg.words.length) continue;
    const raws = dropHeadKeywords(seg.words.slice(i));
    if (raws.length === 0) continue;
    out.push(raws.map(w => unquoteWord(w.raw)));
  }
  return out;
}

// ---------- transparent wrappers ----------

const EMPTY_SET = new Set<string>();

const WRAP_VALUE_OPTS: Record<string, Set<string>> = {
  sudo: new Set(["u", "g", "p", "r", "t", "U", "D", "C", "s", "user", "group", "prompt", "role", "type", "chdir", "askpass", "auth"]),
  doas: new Set(["u", "user", "L"]),
  env: new Set(["u", "unset", "S"]),
  nice: new Set(["n", "adjustment"]),
  ionice: new Set(["c", "n", "p", "class", "classdata"]),
  timeout: new Set(["k", "s", "signal", "kill-after", "context"]),
  stdbuf: new Set(["o", "e", "i", "option"]),
  caffeinate: new Set(["t", "w", "timeout"]),
  xargs: new Set(["I", "J", "n", "P", "s", "E", "l", "L", "S", "max-args", "max-procs", "replace", "arg-file", "eof", "delimiter", "max-chars"]),
  watch: new Set(["n", "g", "x", "t", "interval"]),
  command: EMPTY_SET,
  exec: EMPTY_SET,
  builtin: EMPTY_SET,
  nohup: EMPTY_SET,
  time: EMPTY_SET,
};

const SHELL_NAMES = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const WRAPPER_NAMES = new Set([...Object.keys(WRAP_VALUE_OPTS)]);

function skipOptions(ws: W[], start: number, valueOpts: Set<string>, allowAssignments: boolean): number {
  let i = start;
  while (i < ws.length) {
    const t = val(ws[i]);
    if (t === "--") return i + 1;
    if (allowAssignments && ASSIGN_RE.test(t)) { i++; continue; }
    if (t.startsWith("--")) {
      const name = t.slice(2).split("=")[0];
      if (valueOpts.has(name) && !t.includes("=")) { i += 2; continue; }
      i++;
      continue;
    }
    if (t.startsWith("-") && t.length > 1) {
      const body = t.slice(1);
      if (body.includes("=")) { i++; continue; }
      // a value-taking letter: -u root takes the next word as the value, but
      // stdbuf-style -o0 carries the value inside the same word
      const at = [...body].findIndex(ch => valueOpts.has(ch));
      if (at >= 0) { i += at === body.length - 1 ? 2 : 1; continue; }
      i++;
      continue;
    }
    return i;
  }
  return i;
}

interface Head {
  kind: "plain" | "remote" | "script";
  words: W[];
  script: string | null;
}

function stripWrappers(raws: Word0[], ci: CtxInfo, vars: Vars): Head {
  let ws = raws as W[];
  for (const word of raws) {
    if (word.unq === undefined) {
      ws = raws.map(w => buildW(w, ci, vars));
      break;
    }
  }
  for (let guardCount = 0; guardCount < 24; guardCount++) {
    if (ws.length === 0) return { kind: "plain", words: ws, script: null };
    const name = commandName(ws[0]);
    if (name == null) return { kind: "plain", words: ws, script: null };
    if (WRAPPER_NAMES.has(name)) {
      if (ws.length === 1) return { kind: "plain", words: [], script: null };
      if (name === "env") {
        // env NAME=value cmd: the assignment is visible to the command
        let p = 1;
        while (p < ws.length) {
          const t = ws[p].raw;
          if (!ASSIGN_RE.test(t)) break;
          const eq = t.indexOf("=");
          const value = t.slice(eq + 1);
          if (!/[$`~]/.test(value)) vars[t.slice(0, eq)] = unquoteWord(value);
          p++;
        }
      }
      let i = skipOptions(ws, 1, WRAP_VALUE_OPTS[name] ?? EMPTY_SET, name === "env");
      if (i >= ws.length) return { kind: "plain", words: [], script: null };
      if (name === "timeout") {
        const t = val(ws[i]);
        if (/^([0-9]+(\.[0-9]+)?|inf(inity)?)[smhd]?$/.test(t)) {
          i++;
          if (i >= ws.length) return { kind: "plain", words: [], script: null };
        }
      }
      if (name === "watch") {
        const script = ws.slice(i).map(w => scriptText(w)).join(" ");
        return { kind: "script", words: [], script };
      }
      ws = ws.slice(i).map(w => buildW({ raw: w.raw, quoted: w.quoted }, ci, vars));
      if (ws.length === 0) return { kind: "plain", words: [], script: null };
      continue;
    }
    if (SHELL_NAMES.has(name)) {
      let i = 1;
      let sawC = false;
      let scriptWord: W | null = null;
      while (i < ws.length) {
        const t = val(ws[i]);
        if (t === "--") { i++; break; }
        if (t.startsWith("-") && t.length > 1) {
          if (/^-+[a-zA-Z]*c[a-zA-Z]*$/.test(t)) {
            sawC = true;
            i++;
            if (i < ws.length) scriptWord = ws[i];
            i++;
            continue;
          }
          if (/^-+[a-zA-Z]+$/.test(t)) {
            if (t.includes("o") && !t.includes("=")) { i += 2; continue; }
            i++;
            continue;
          }
          i++;
          continue;
        }
        break;
      }
      if (sawC && scriptWord) {
        return { kind: "script", words: [], script: scriptText(scriptWord) };
      }
      return { kind: "plain", words: ws, script: null };
    }
    if (name === "eval") {
      const script = ws.slice(1).map(w => scriptText(w)).join(" ");
      return { kind: "script", words: [], script };
    }
    if (name === "ssh") return { kind: "remote", words: ws, script: null };
    if (name === "docker" || name === "kubectl" || name === "nerdctl" || name === "podman") {
      const sub = ws[1] ? val(ws[1]) : "";
      if (sub === "exec") return { kind: "remote", words: ws, script: null };
      return { kind: "plain", words: ws, script: null };
    }
    return { kind: "plain", words: ws, script: null };
  }
  return { kind: "plain", words: ws, script: null };
}

/** The text to re-parse for bash -c, eval and watch: keep inner quoting
    when the whole argument was one quoted string. */
function scriptText(w: W): string {
  const raw = w.raw;
  if (raw.length >= 2 && raw[0] === SQC && raw[raw.length - 1] === SQC) {
    return raw.slice(1, -1);
  }
  if (raw.length >= 2 && raw[0] === DQC && raw[raw.length - 1] === DQC) {
    return unquoteWord(raw);
  }
  return w.unq;
}


// ---------- rules: deleting files ----------

const DELETE_KIND = "rm";

function mkHit(kind: GuardKind, reason: GuardReason, seg: Seg, target?: string, branch?: string): GuardHit {
  const out: GuardHit = { kind, reason, command: commandString(seg) };
  if (target !== undefined) out.target = target;
  if (branch !== undefined) out.branch = branch;
  return out;
}

function commandString(seg: Seg): string {
  let i = 0;
  while (i < seg.words.length && ASSIGN_RE.test(seg.words[i].raw)) i++;
  const s = seg.words.slice(i).map(w => w.raw).join(" ");
  if (s.length > 200) return s.slice(0, 199) + "…";
  return s;
}

/** A path target is offending when deleting it is clearly destructive. */
function isOffendingPath(w: W, ci: CtxInfo): boolean {
  const v = w.val;
  if (v == null || v === "") return false;
  const r = resolveIn(v, ci);
  if (r.root) return true;
  if (r.path === ci.homeRes) return true;
  if (r.path === ci.cwdRes) return true;
  if (!w.quoted && (w.raw === "*" || w.raw === ".*")) return true;
  const parts = r.path.split("/");
  for (const p of parts) {
    if (p === ".git") return true;
  }
  if (!contained(r.path, ci)) return true;
  return false;
}

// quoted variable targets of this shape become / or /* when the variable
// is unset at run time, so they count as destructive
const UNSET_VAR_SHAPE = /^"\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?\/(\*)?"?$/;

function ruleDelete(cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  if (cmd !== DELETE_KIND) return null;
  let rec = false;
  let force = false;
  const operands: W[] = [];
  let optEnd = false;
  for (const w of args) {
    const t = val(w);
    if (!optEnd) {
      if (t === "--") { optEnd = true; continue; }
      if (t.startsWith("--")) {
        if (t === "--recursive") rec = true;
        else if (t === "--force") force = true;
        // --no-preserve-root can only make things worse, never better
        continue;
      }
      if (t.startsWith("-") && t.length > 1) {
        for (const ch of t.slice(1)) {
          if (ch === "r" || ch === "R") rec = true;
          else if (ch === "f") force = true;
        }
        continue;
      }
    }
    operands.push(w);
  }
  if (!(rec && force)) return null;
  for (const w of operands) {
    const m = UNSET_VAR_SHAPE.exec(w.raw);
    if (!m) continue;
    const name = m[1];
    if (name === "HOME" || name === "PWD" || name === "TMPDIR") continue;
    if (Object.prototype.hasOwnProperty.call(vars, name)) continue;
    return mkHit(DELETE_KIND, "recursive-delete", seg, w.raw);
  }
  for (const w of operands) {
    if (isOffendingPath(w, ci)) return mkHit(DELETE_KIND, "recursive-delete", seg, w.raw);
  }
  return null;
}

function ruleFindDelete(cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  if (cmd !== "find") return null;
  let i = 0;
  while (i < args.length) {
    const t = val(args[i]);
    if (t === "-H" || t === "-L" || t === "-P") { i++; continue; }
    if (t === "-O" || t === "-D") { i += 2; continue; }
    break;
  }
  const roots: W[] = [];
  let k = i;
  while (k < args.length) {
    const t = val(args[k]);
    if (t === "(" || t === ")" || t === "!" || t === ",") break;
    if (t.startsWith("-")) break;
    roots.push(args[k]);
    k++;
  }
  let hasDelete = false;
  let execRecursive = false;
  for (let j = 0; j < args.length; j++) {
    const t = val(args[j]);
    if (t === "-delete") hasDelete = true;
    if (t === "-exec" || t === "-execdir") {
      if (j + 1 < args.length && val(args[j + 1]) === DELETE_KIND) {
        let rec = false;
        for (let q = j + 2; q < args.length; q++) {
          const u = val(args[q]);
          if (u === ";" || u === "+" || u === "{}") break;
          if (u.startsWith("-")) {
            for (const ch of u.slice(1)) {
              if (ch === "r" || ch === "R") rec = true;
            }
          }
        }
        if (rec) execRecursive = true;
      }
    }
  }
  if (!hasDelete && !execRecursive) return null;
  for (const r of roots) {
    if (isFindRootOffending(r, ci)) return mkHit(DELETE_KIND, "find-delete", seg, r.raw);
  }
  return null;
}

/** find roots only need to be contained; . is fine, / and ~ are not */
function isFindRootOffending(w: W, ci: CtxInfo): boolean {
  const v = w.val;
  if (v == null || v === "") return false;
  const r = resolveIn(v, ci);
  if (r.root) return true;
  if (r.path === ci.cwdRes) return false;
  return !contained(r.path, ci);
}

function ruleShred(cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  if (cmd !== "shred") return null;
  let remove = false;
  const operands: W[] = [];
  let optEnd = false;
  for (const w of args) {
    const t = val(w);
    if (!optEnd) {
      if (t === "--") { optEnd = true; continue; }
      if (t.startsWith("--")) {
        if (t === "--remove" || t.startsWith("--remove=")) remove = true;
        continue;
      }
      if (t.startsWith("-") && t.length > 1) {
        for (const ch of t.slice(1)) {
          if (ch === "u") remove = true;
        }
        continue;
      }
    }
    operands.push(w);
  }
  for (const w of operands) {
    const v = w.val;
    if (v != null && v.startsWith("/dev/") && v !== "/dev/null" && v !== "/dev/zero") {
      return mkHit(DELETE_KIND, "shred", seg, w.raw);
    }
  }
  if (!remove) return null;
  for (const w of operands) {
    if (isOffendingPath(w, ci)) return mkHit(DELETE_KIND, "shred", seg, w.raw);
  }
  return null;
}

const PS_RECURSE = /^-(r|re|rec|recur|recurse)$/i;
const PS_FORCE = /^-(f|fo|for|forc|force)$/i;

const POWER_DELETE_NAMES = new Set(["remove-item", "ri", "erase", "del", "rd", "rmdir"]);

function rulePowerDelete(cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  const name = cmd == null ? "" : cmd.toLowerCase();
  const isPs = POWER_DELETE_NAMES.has(name) || name === DELETE_KIND;
  if (!isPs) return null;
  const cmdStyle = (name === "rd" || name === "rmdir" || name === "del") &&
    args.some(w => /^\/[a-z]$/i.test(val(w)));
  if (cmdStyle) {
    let s = false;
    let q = false;
    let f = false;
    const targets: W[] = [];
    for (const w of args) {
      const t = val(w).toLowerCase();
      if (t === "/s") s = true;
      else if (t === "/q") q = true;
      else if (t === "/f") f = true;
      else if (!t.startsWith("/")) targets.push(w);
    }
    const needed = name === "del" ? s && q && f : s && q;
    if (!needed) return null;
    for (const t of targets) {
      if (isOffendingPath(t, ci)) return mkHit(DELETE_KIND, "recursive-delete", seg, t.raw);
    }
    return null;
  }
  let recurse = false;
  let force = false;
  const targets: W[] = [];
  let i = 0;
  while (i < args.length) {
    const t = val(args[i]);
    if (PS_RECURSE.test(t)) { recurse = true; i++; continue; }
    if (PS_FORCE.test(t)) { force = true; i++; continue; }
    if (/^-(path|literalpath)$/i.test(t)) {
      if (i + 1 < args.length && !val(args[i + 1]).startsWith("-")) targets.push(args[i + 1]);
      i += 2;
      continue;
    }
    if (t.startsWith("-")) { i++; continue; }
    targets.push(args[i]);
    i++;
  }
  if (!(recurse && force)) return null;
  for (const t of targets) {
    if (isOffendingPath(t, ci)) return mkHit(DELETE_KIND, "recursive-delete", seg, t.raw);
  }
  return null;
}


// ---------- rules: git ----------

const PROTECTED_BRANCHES = ["main", "master", "trunk", "develop", "production"];

function isProtectedBranch(b: string, ci: CtxInfo): boolean {
  if (b === "") return false;
  let s = b;
  if (s.startsWith("refs/heads/")) s = s.slice(11);
  if (PROTECTED_BRANCHES.includes(s)) return true;
  if (s.startsWith("release/")) return true;
  if (ci.defaultBranch) {
    if (s === ci.defaultBranch) return true;
    if (s === "refs/heads/" + ci.defaultBranch) return true;
  }
  return false;
}

/** The branch name a refspec writes to: +main, HEAD:main, refs/heads/main. */
function refspecBranch(t: string): string {
  let s = t;
  if (s.startsWith("+")) s = s.slice(1);
  const i = s.lastIndexOf(":");
  if (i >= 0) s = s.slice(i + 1);
  if (s.startsWith("refs/heads/")) s = s.slice(11);
  return s;
}

const GIT_PUSH_VALUE_OPTS = new Set(["repo", "receive-pack", "exec", "push-option", "recurse-submodules", "signed", "force-with-lease", "signed-push"]);
// options that take their value only with =, so a following word is still a word
const FLAG_ONLY_PUSH_OPTS = new Set(["force-with-lease", "force-if-includes"]);

function ruleGitPush(subArgs: W[], seg: Seg, ci: CtxInfo): GuardHit | null {
  let force = false;
  let mirror = false;
  let allRefs = false;
  let deleteFlag = false;
  const pos: W[] = [];
  let i = 0;
  while (i < subArgs.length) {
    const t = val(subArgs[i]);
    if (t === "--") {
      for (let j = i + 1; j < subArgs.length; j++) pos.push(subArgs[j]);
      break;
    }
    if (t.startsWith("-") && t.length > 1) {
      if (t.startsWith("+")) { pos.push(subArgs[i]); i++; continue; }
      if (t === "-f" || t === "--force") force = true;
      else if (t === "--mirror") mirror = true;
      else if (t === "--all" || t === "--branches") allRefs = true;
      else if (t === "-d" || t === "--delete") deleteFlag = true;
      else {
        const name = t.startsWith("--") ? t.slice(2).split("=")[0] : t.slice(1);
        if (t.startsWith("--") && !t.includes("=") && GIT_PUSH_VALUE_OPTS.has(name) && !FLAG_ONLY_PUSH_OPTS.has(name)) {
          i += 2;
          continue;
        }
      }
      i++;
      continue;
    }
    pos.push(subArgs[i]);
    i++;
  }
  let refspecs: W[] = [];
  let explicit = false;
  if (pos.length >= 2) {
    refspecs = pos.slice(1);
    explicit = true;
  } else if (pos.length === 1) {
    const t = val(pos[0]);
    if (t.startsWith("+") || t.includes(":")) {
      refspecs = [pos[0]];
      explicit = true;
    }
  }
  if (force || refspecs.some(w => val(w).startsWith("+"))) {
    for (const r of refspecs) {
      if (isProtectedBranch(refspecBranch(val(r)), ci)) {
        return mkHit("push", "force-push", seg, undefined, refspecBranch(val(r)));
      }
    }
    if (!explicit) {
      // --all pushes every branch, protected ones included
      const cands = allRefs ? [ci.branch, ci.defaultBranch, "main", "master"] : [ci.branch];
      for (const b of cands) {
        if (b && isProtectedBranch(b, ci)) {
          return mkHit("push", "force-push", seg, undefined, refspecBranch(b));
        }
      }
    }
  }
  for (const r of refspecs) {
    const t = val(r);
    const isDelete = t.startsWith(":") || (t.startsWith("+") && t.slice(1).startsWith(":"));
    if ((deleteFlag || isDelete) && isProtectedBranch(refspecBranch(t), ci)) {
      return mkHit("push", "push-delete", seg, undefined, refspecBranch(t));
    }
  }
  if (mirror) return mkHit("push", "mirror-push", seg);
  return null;
}

function ruleGitCheckout(subArgs: W[], seg: Seg, ci: CtxInfo): GuardHit | null {
  let force = false;
  let afterDashDash = false;
  const pos: W[] = [];
  let i = 0;
  while (i < subArgs.length) {
    const t = val(subArgs[i]);
    if (t === "--") { afterDashDash = true; i++; continue; }
    if (afterDashDash) { pos.push(subArgs[i]); i++; continue; }
    if (t.startsWith("-") && t.length > 1) {
      if (t === "-f" || t === "--force") force = true;
      if ((t === "-b" || t === "-B" || t === "-t" || t === "--track" || t === "--orphan") && !t.includes("=")) { i += 2; continue; }
      i++;
      continue;
    }
    pos.push(subArgs[i]);
    i++;
  }
  if (force) return mkHit("reset", "discard-worktree", seg);
  if (afterDashDash && pos.length > 0) return mkHit("reset", "discard-worktree", seg);
  for (const p of pos) {
    const t = val(p);
    if (t === "." || t === ":/" || t === "*" || t === ":") {
      return mkHit("reset", "discard-worktree", seg);
    }
  }
  return null;
}

function ruleGitRestoreSwitch(sub: string, subArgs: W[], seg: Seg, ci: CtxInfo): GuardHit | null {
  let staged = false;
  let worktree = false;
  let discard = false;
  let force = false;
  const pos: W[] = [];
  let i = 0;
  while (i < subArgs.length) {
    const t = val(subArgs[i]);
    if (t === "--") { for (let j = i + 1; j < subArgs.length; j++) pos.push(subArgs[j]); break; }
    if (t.startsWith("-") && t.length > 1) {
      if (t === "--staged" || t === "-S") staged = true;
      else if (t === "--worktree" || t === "-W") worktree = true;
      else if (t === "--discard-changes") discard = true;
      else if (t === "-f" || t === "--force") force = true;
      else if ((t === "-s" || t === "--source") && !t.includes("=")) { i += 2; continue; }
      else if (t.startsWith("--source=")) { i++; continue; }
      i++;
      continue;
    }
    pos.push(subArgs[i]);
    i++;
  }
  if (sub === "switch") {
    if (discard || force) return mkHit("reset", "discard-worktree", seg);
    return null;
  }
  // restore: staged alone keeps the worktree untouched
  if (staged && !worktree) return null;
  if (pos.length > 0) return mkHit("reset", "discard-worktree", seg);
  return null;
}

function ruleGitClean(subArgs: W[], seg: Seg, ci: CtxInfo): GuardHit | null {
  let f = 0;
  let dx = false;
  let dry = false;
  let i = 0;
  while (i < subArgs.length) {
    const t = val(subArgs[i]);
    if (t === "--force" || t === "-f") { f++; i++; continue; }
    if (t === "-d" || t === "-x" || t === "-X") { dx = true; i++; continue; }
    if (t === "-n" || t === "--dry-run" || t === "-i" || t === "--interactive") { dry = true; i++; continue; }
    if (t === "-e" || t === "--exclude") { i += 2; continue; }
    if (t.startsWith("--exclude=")) { i++; continue; }
    if (t.startsWith("-") && t.length > 1 && !t.startsWith("--")) {
      for (const ch of t.slice(1)) {
        if (ch === "f") f++;
        else if (ch === "d" || ch === "x" || ch === "X") dx = true;
        else if (ch === "n" || ch === "i") dry = true;
      }
      i++;
      continue;
    }
    i++;
  }
  if (dry) return null;
  if (f >= 1 && dx) return mkHit("clean", "clean-force", seg);
  return null;
}

function ruleGit(cmd: string | null, args0: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  if (cmd !== "git") return null;
  // git takes global options before the subcommand: git -C ../mango push -f origin main
  const args = subcommandArgs("git", args0);
  if (args.length === 0) return null;
  const sub = val(args[0]);
  const rest = args.slice(1);
  if (sub === "push") return ruleGitPush(rest, seg, ci);
  if (sub === "reset") {
    for (const w of rest) {
      if (val(w) === "--hard") return mkHit("reset", "hard-reset", seg);
    }
    return null;
  }
  if (sub === "checkout") return ruleGitCheckout(rest, seg, ci);
  if (sub === "restore" || sub === "switch") return ruleGitRestoreSwitch(sub, rest, seg, ci);
  if (sub === "clean") return ruleGitClean(rest, seg, ci);
  if (sub === "stash") {
    if (rest.length > 0) {
      const s = val(rest[0]);
      if (s === "drop") return mkHit("stash", "stash-drop", seg);
      if (s === "clear") return mkHit("stash", "stash-clear", seg);
    }
    return null;
  }
  if (sub === "filter-branch" || sub === "filter-repo") {
    return mkHit("history", "history-rewrite", seg);
  }
  if (sub === "reflog") {
    if (rest.length > 0 && val(rest[0]) === "expire") {
      for (const w of rest.slice(1)) {
        const t = val(w);
        if (t === "--expire=now" || t === "--expire-unreachable=now") {
          return mkHit("history", "reflog-expire", seg);
        }
      }
    }
    return null;
  }
  return null;
}


// ---------- rules: permissions and disks ----------

const WORLD_WRITABLE_MODES = new Set(["777", "0777", "a+rwx", "ugo+rwx", "o+w", "a+w"]);

function ruleChmod(cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  if (cmd !== "chmod") return null;
  let rec = false;
  const operands: W[] = [];
  let optEnd = false;
  let i = 0;
  while (i < args.length) {
    const w = args[i];
    const t = val(w);
    if (!optEnd) {
      if (t === "--") { optEnd = true; i++; continue; }
      if (t === "--recursive") { rec = true; i++; continue; }
      if (t === "--reference") { i += 2; continue; }
      if (t.startsWith("--reference=")) { i++; continue; }
      if (t.startsWith("-") && t.length > 1) {
        for (const ch of t.slice(1)) {
          if (ch === "R") rec = true;
        }
        i++;
        continue;
      }
    }
    operands.push(w);
    i++;
  }
  if (!rec || operands.length < 2) return null;
  if (!WORLD_WRITABLE_MODES.has(val(operands[0]))) return null;
  for (const t of operands.slice(1)) {
    if (isOffendingPath(t, ci)) return mkHit("chmod", "world-writable", seg, t.raw);
  }
  return null;
}

function ruleChown(cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  if (cmd !== "chown" && cmd !== "chgrp") return null;
  let rec = false;
  const operands: W[] = [];
  let optEnd = false;
  let i = 0;
  while (i < args.length) {
    const w = args[i];
    const t = val(w);
    if (!optEnd) {
      if (t === "--") { optEnd = true; i++; continue; }
      if (t === "--recursive") { rec = true; i++; continue; }
      if (t === "--reference" || t === "--from") { i += 2; continue; }
      if (t.startsWith("--reference=") || t.startsWith("--from=")) { i++; continue; }
      if (t.startsWith("-") && t.length > 1) {
        for (const ch of t.slice(1)) {
          if (ch === "R") rec = true;
        }
        i++;
        continue;
      }
    }
    operands.push(w);
    i++;
  }
  if (!rec || operands.length < 2) return null;
  for (const t of operands.slice(1)) {
    if (isOffendingPath(t, ci)) return mkHit("chown", "owner-change", seg, t.raw);
  }
  return null;
}

const BENIGN_DEVICES = ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom", "/dev/full", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/tty", "/dev/console"];

function isRawDevice(p: string): boolean {
  return /^\/dev\/(sd|nvme|disk|rdisk)/.test(p);
}

const DISKUTIL_FS = new Set(["eraseDisk", "eraseVolume", "eraseOpticalDisk", "reformat", "zeroDisk", "randomDisk", "secureErase"]);
const DISKUTIL_PART = new Set(["partitionDisk", "splitPartition", "partitionAPFS"]);
const PART_WRITE_TOKENS = new Set(["mklabel", "mktable", "mkpart", "resizepart", "delpart", "--delete", "--zap-all", "--clear", "zap", "--write", "rm"]);

function firstDeviceArg(args: W[]): string | null {
  for (const w of args) {
    const t = val(w);
    if (t.startsWith("/dev/")) return t;
  }
  for (const w of args) {
    const t = val(w);
    if (/^r?disk\d+(s\d+)?$/.test(t)) return t;
  }
  return null;
}

function ruleDiskStart(name: string, args: W[], seg: Seg): GuardHit | null {
  if (name === "dd" || name === "dcfldd") {
    for (const w of args) {
      const t = val(w);
      const m = /^of=(.+)$/i.exec(t);
      if (m) {
        const dev = m[1];
        if (dev.startsWith("/dev/") && !BENIGN_DEVICES.includes(dev)) {
          return mkHit("disk", "device-write", seg, dev);
        }
      }
    }
  }
  for (const r of seg.redirects) {
    const opLooksWrite = r.op.startsWith(">") || r.op.startsWith("&>") || /^\d+>/.test(r.op);
    if (opLooksWrite && r.raw) {
      const t = unquoteWord(r.raw);
      if (isRawDevice(t)) return mkHit("disk", "device-write", seg, t);
    }
  }
  return null;
}

function ruleDisk(cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  const name = cmd ?? "";
  const early = ruleDiskStart(name, args, seg);
  if (early) return early;
  if (name === "mkfs" || name.startsWith("mkfs.")) {
    return mkHit("disk", "filesystem", seg, firstDeviceArg(args) ?? undefined);
  }
  if (name.startsWith("newfs_")) {
    return mkHit("disk", "filesystem", seg, firstDeviceArg(args) ?? undefined);
  }
  if (name === "diskutil" && args.length > 0) {
    const sub = val(args[0]);
    if (DISKUTIL_FS.has(sub)) {
      return mkHit("disk", "filesystem", seg, firstDeviceArg(args.slice(1)) ?? undefined);
    }
    if (DISKUTIL_PART.has(sub)) {
      return mkHit("disk", "partition", seg, firstDeviceArg(args.slice(1)) ?? undefined);
    }
    return null;
  }
  if (name === "wipefs") {
    let all = false;
    for (const w of args) {
      const t = val(w);
      if (t === "-a" || t === "--all") all = true;
    }
    if (all) return mkHit("disk", "device-write", seg, firstDeviceArg(args) ?? undefined);
    return null;
  }
  if (name === "sgdisk" || name === "gdisk" || name === "sfdisk" || name === "cgdisk" || name === "parted" || name === "fdisk") {
    let writing = false;
    for (const w of args) {
      if (PART_WRITE_TOKENS.has(val(w))) writing = true;
    }
    if (name === "sgdisk") {
      for (const w of args) {
        const t = val(w);
        if (t === "-Z" || t === "--zap-all" || t === "-o" || t === "--clear") writing = true;
      }
    }
    if (writing) {
      const dev = firstDeviceArg(args);
      if (dev != null && dev.startsWith("/dev/")) {
        return mkHit("disk", "partition", seg, dev);
      }
    }
    return null;
  }
  return ruleDiskWindows(name, args, seg);
}

function ruleDiskWindows(name: string, args: W[], seg: Seg): GuardHit | null {
  const lower = name.toLowerCase();
  if (lower === "format-volume") {
    let target: string | null = null;
    for (let i = 0; i < args.length; i++) {
      const t = val(args[i]);
      if (/^-(driveletter|path|filesystem)$/i.test(t) && i + 1 < args.length) { target = val(args[i + 1]); i++; continue; }
      if (/^-(driveletter|path)=/i.test(t)) { target = t.split("=").slice(1).join("="); continue; }
      if (!t.startsWith("-") && /^[a-z]:/i.test(t)) target = t;
    }
    return mkHit("disk", "filesystem", seg, target ?? undefined);
  }
  if (lower === "clear-disk" || lower === "initialize-disk") {
    let target: string | null = null;
    for (let i = 0; i < args.length; i++) {
      const t = val(args[i]);
      if (/^-(number|path|disknumber|friendlyname)$/i.test(t) && i + 1 < args.length) { target = val(args[i + 1]); i++; continue; }
      if (/^-(number|path|disknumber|friendlyname)=/i.test(t)) { target = t.split("=").slice(1).join("="); continue; }
    }
    return mkHit("disk", "device-write", seg, target ?? undefined);
  }
  if (name === "format" && args.length > 0) {
    for (const w of args) {
      const t = val(w);
      if (/^[a-z]:\\?$/i.test(t) || /^[a-z]:\//i.test(t)) {
        return mkHit("disk", "filesystem", seg, t);
      }
    }
  }
  return null;
}


// ---------- rules: databases ----------

const SQL_TOOLS = new Set(["psql", "mysql", "mariadb", "sqlite3", "duckdb", "clickhouse-client", "clickhouse", "sqlcmd"]);
const SQL_OPTS = new Set(["-c", "-e", "--command", "--execute", "--query", "-Q", "-q"]);
const SQL_VERB = /^\s*(select|insert|update|delete|create|drop|alter|truncate|with|replace|attach|detach|begin|commit|rollback|vacuum|analyze|analyse|reindex|pragma|explain|grant|revoke|copy|load|set|show|use|describe|desc)\b/i;

/** Split SQL into statements: comments dropped, ; outside strings splits. */
function sqlStatements(sql: string): string[] {
  const n = sql.length;
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < n) {
    const c = sql[i];
    if (c === SQC || c === DQC || c === "`") {
      const q = c;
      cur += c;
      i++;
      while (i < n) {
        if (sql[i] === "\\" && q !== "`") { cur += sql.slice(i, i + 2); i += 2; continue; }
        if (sql[i] === q) {
          if (q === SQC && sql[i + 1] === SQC) { cur += SQC + SQC; i += 2; continue; }
          break;
        }
        cur += sql[i];
        i++;
      }
      if (i < n) { cur += q; i++; }
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const k = sql.indexOf("\n", i);
      i = k < 0 ? n : k;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const k = sql.indexOf("*/", i + 2);
      i = k < 0 ? n : k + 2;
      continue;
    }
    if (c === ";") { out.push(cur); cur = ""; i++; continue; }
    cur += c;
    i++;
  }
  out.push(cur);
  return out;
}

function cleanIdent(s: string): string {
  return s.replace(/^[`\[\"]+/, "").replace(/[`\]\"]+$/, "");
}

/** sqlite3 reads its input line by line: a line whose first non-blank
    character is a dot is a dot-command of the tool, not SQL. */
function stripSqliteDotCommands(body: string): string {
  return body.split("\n").filter(line => !/^\s*\./.test(line)).join("\n");
}

interface SqlHit { reason: GuardReason; target?: string }

function analyzeSql(sql: string): SqlHit | null {
  const stmts = sqlStatements(sql);
  const found = new Map<GuardReason, SqlHit>();
  for (const raw of stmts) {
    const s = raw.trim();
    if (s === "") continue;
    let m: RegExpExecArray | null;
    m = /^\s*drop\s+(?:database|schema)\s+(?:if\s+exists\s+)?([^\s(;,]+)/i.exec(s);
    if (m) {
      if (!found.has("drop-database")) found.set("drop-database", { reason: "drop-database", target: cleanIdent(m[1]) });
      continue;
    }
    m = /^\s*drop\s+table\s+(?:if\s+exists\s+)?([^\s(;,]+)/i.exec(s);
    if (m) {
      if (!found.has("drop-table")) found.set("drop-table", { reason: "drop-table", target: cleanIdent(m[1]) });
      continue;
    }
    m = /^\s*truncate\s+(?:table\s+)?([^\s(;,]+)/i.exec(s);
    if (m) {
      if (!found.has("truncate")) found.set("truncate", { reason: "truncate", target: cleanIdent(m[1]) });
      continue;
    }
    m = /^\s*delete\s+from\s+([^\s(;,]+)/i.exec(s);
    if (m && !/\bwhere\b/i.test(s)) {
      if (!found.has("delete-all-rows")) found.set("delete-all-rows", { reason: "delete-all-rows", target: cleanIdent(m[1]) });
    }
  }
  for (const reason of ["drop-database", "drop-table", "truncate", "delete-all-rows"] as GuardReason[]) {
    const h = found.get(reason);
    if (h) return h;
  }
  return null;
}

function ruleDb(cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  let tool = cmd ?? "";
  let a = args;
  if (tool === "cockroach") {
    if (a.length === 0 || val(a[0]) !== "sql") return null;
    a = a.slice(1);
  } else if (!SQL_TOOLS.has(tool)) {
    return null;
  }
  const sqls: string[] = [];
  let i = 0;
  while (i < a.length) {
    const t = val(a[i]);
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      if (eq > 0) {
        if (SQL_OPTS.has(t.slice(0, eq))) sqls.push(t.slice(eq + 1));
      } else if (SQL_OPTS.has(t) && i + 1 < a.length) {
        sqls.push(val(a[i + 1]));
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (SQL_OPTS.has(t) && i + 1 < a.length) {
      sqls.push(val(a[i + 1]));
      i += 2;
      continue;
    }
    if ((tool === "sqlite3" || tool === "duckdb") && !t.startsWith("-") && SQL_VERB.test(t)) {
      sqls.push(t);
    }
    i++;
  }
  for (const h of seg.heredocs) {
    sqls.push(tool === "sqlite3" ? stripSqliteDotCommands(h) : h);
  }
  for (const sql of sqls) {
    const hitSql = analyzeSql(sql);
    if (hitSql) {
      return mkHit("drop", hitSql.reason, seg, hitSql.target);
    }
  }
  return null;
}

interface MongoToken { kind: "identifier" | "string" | "punct"; text: string }

// Tokenize just the JavaScript syntax needed for Mongo receivers. String
// contents are data tokens, so names/comments cannot masquerade as calls.
// A slash starts a regex literal where an expression can begin; after a
// value it is division, whose right operand can contain an executed call.
function mongoRegexStart(previous: MongoToken | undefined): boolean {
  if (!previous) return true;
  if (previous.kind === "identifier") {
    return ["return", "throw", "case", "typeof", "void", "delete", "yield", "await", "in", "instanceof"].includes(previous.text);
  }
  return previous.kind === "punct" && "([{=,:;!?+-*%&|^~<>/".includes(previous.text);
}

function mongoRegexEnd(src: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\n" || c === "\r") return -1;
    if (c === "\\") { i++; continue; }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      i++;
      while (i < src.length && /[A-Za-z]/.test(src[i])) i++;
      return i;
    }
  }
  return -1;
}

function mongoTokens(src: string): MongoToken[] {
  const out: MongoToken[] = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i + 2);
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === "/" && mongoRegexStart(out[out.length - 1])) {
      const end = mongoRegexEnd(src, i);
      if (end >= 0) {
        out.push({ kind: "punct", text: "regex" });
        i = end;
        continue;
      }
    }
    if (c === SQC || c === DQC || c === "`") {
      const start = ++i;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      const closed = i < src.length;
      out.push({
        kind: closed && c !== "`" ? "string" : "punct",
        text: closed && c !== "`" ? unescapeAnsiC(src.slice(start, i)) : c,
      });
      if (closed) i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i++;
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) i++;
      out.push({ kind: "identifier", text: src.slice(start, i) });
      continue;
    }
    out.push({ kind: "punct", text: c });
    i++;
  }
  return out;
}

function analyzeMongo(src: string, allowBareCall: boolean): SqlHit | null {
  const toks = mongoTokens(src);
  const at = (i: number, text: string, kind: MongoToken["kind"] = "punct") =>
    toks[i]?.kind === kind && toks[i].text === text;
  // --eval=db.orders.drop() is historically accepted despite the shell
  // splitter removing its unquoted parentheses; only an identifier ending
  // the entire eval text receives this compatibility allowance.
  const called = (i: number) => at(i, "(") || (allowBareCall && i === toks.length);
  for (let i = 0; i < toks.length; i++) {
    if (!at(i, "db", "identifier") || at(i - 1, ".")) continue;
    let j = i + 1;
    let database: string | undefined;
    if (at(j, ".") && at(j + 1, "getSiblingDB", "identifier") && at(j + 2, "(") &&
        (toks[j + 3]?.kind === "string" || toks[j + 3]?.kind === "identifier") && at(j + 4, ")")) {
      database = toks[j + 3].kind === "string" ? toks[j + 3].text : undefined;
      j += 5;
    }
    if (at(j, ".") && at(j + 1, "dropDatabase", "identifier") && called(j + 2)) {
      return { reason: "drop-database", target: database };
    }
    let collection: string | undefined;
    if (at(j, ".") && at(j + 1, "getCollection", "identifier") && at(j + 2, "(") &&
        toks[j + 3]?.kind === "string" && at(j + 4, ")")) {
      collection = toks[j + 3].text;
      j += 5;
    } else if (at(j, "[") && toks[j + 1]?.kind === "string" && at(j + 2, "]")) {
      collection = toks[j + 1].text;
      j += 3;
    } else if (at(j, ".") && toks[j + 1]?.kind === "identifier") {
      collection = toks[j + 1].text;
      j += 2;
    }
    if (collection !== undefined && at(j, ".") && at(j + 1, "drop", "identifier") && called(j + 2)) {
      return { reason: "drop-table", target: collection };
    }
  }
  return null;
}

function ruleStore(cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  const name = cmd ?? "";
  if (name === "redis-cli" || name === "valkey-cli") {
    for (const w of args) {
      const t = val(w).toUpperCase();
      if (t === "FLUSHALL" || t === "FLUSHDB") {
        return mkHit("drop", "flush-store", seg);
      }
    }
    return null;
  }
  if (name === "mongosh" || name === "mongo" || name === "mongodump") {
    for (let i = 0; i < args.length; i++) {
      const t = val(args[i]);
      let evalText: string | null = null;
      let allowBareCall = false;
      if (t === "--eval" && i + 1 < args.length) {
        evalText = val(args[i + 1]);
        allowBareCall = !args[i + 1].quoted;
        i++;
      } else if (t.startsWith("--eval=")) {
        evalText = t.slice(7);
        allowBareCall = !args[i].quoted;
      }
      if (evalText == null) continue;
      const drop = analyzeMongo(evalText, allowBareCall);
      if (drop) return mkHit("drop", drop.reason, seg, drop.target);
    }
    return null;
  }
  return null;
}


// ---------- rules: infrastructure ----------

// tools that take global options before their subcommand
const GLOBAL_VALUE_OPTS: Record<string, string[]> = {
  git: ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--exec-path", "--config-env"],
  terraform: ["-chdir"],
  tofu: ["-chdir"],
  opentofu: ["-chdir"],
  pulumi: ["-s", "--stack", "-C", "--cwd", "-P", "--project", "--config-file"],
  kubectl: ["-n", "--namespace", "--context", "--cluster", "--user", "--kubeconfig", "-k", "--as", "--token", "--server", "--cache-dir"],
  oc: ["-n", "--namespace", "--context", "--kubeconfig", "--config"],
  docker: ["-H", "--host", "-c", "--context", "--config", "--log-level"],
  aws: ["--profile", "--region", "--endpoint-url", "--output", "--ca-bundle", "--cli-input-json"],
  gcloud: ["--project", "--configuration", "--format", "--account", "--verbosity"],
  az: ["--output", "--subscription", "--query", "--resource-group"],
};

/** Drop the global options that come before a subcommand: terraform -chdir=envs/prod destroy. */
function subcommandArgs(name: string, args: W[]): W[] {
  const valueOpts = GLOBAL_VALUE_OPTS[name];
  let i = 0;
  while (i < args.length) {
    const t = val(args[i]);
    if (!t.startsWith("-") || t === "-" || t === "--") break;
    if (valueOpts) {
      const eq = t.indexOf("=");
      const base = eq > 0 ? t.slice(0, eq) : t;
      if (eq < 0 && valueOpts.includes(base) && i + 1 < args.length) { i += 2; continue; }
    }
    i++;
  }
  return i === 0 ? args : args.slice(i);
}

function ruleInfra(cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars): GuardHit | null {
  const name = cmd ?? "";
  if (name === "terraform" || name === "tofu" || name === "opentofu") {
    const targs = subcommandArgs(name, args);
    if (targs.length === 0) return null;
    const sub = val(targs[0]);
    if (sub === "destroy") return mkHit("infra", "terraform-destroy", seg);
    if (sub === "apply") {
      for (const w of targs.slice(1)) {
        if (val(w) === "-destroy" || val(w) === "--destroy") {
          return mkHit("infra", "terraform-destroy", seg);
        }
      }
    }
    return null;
  }
  if (name === "pulumi" && subcommandArgs(name, args).length > 0 && val(subcommandArgs(name, args)[0]) === "destroy") {
    return mkHit("infra", "pulumi-destroy", seg);
  }
  if (name === "kubectl" || name === "oc") {
    const kargs = subcommandArgs(name, args);
    if (kargs.length > 1 && val(kargs[0]) === "delete") {
      const sub = val(kargs[1]);
      const slash = /^(namespaces?|ns)\/(.+)$/.exec(sub);
      if (slash) {
        return mkHit("infra", "kubectl-delete", seg, slash[2]);
      }
      if ((sub === "namespace" || sub === "namespaces" || sub === "ns") && args.length > 2) {
        return mkHit("infra", "kubectl-delete", seg, val(args[2]));
      }
      // delete <resource> --all, with the flags in either order
      let all = false;
      let positional = 0;
      for (let k = 1; k < kargs.length; k++) {
        const t = val(kargs[k]);
        if (t === "--all") all = true;
        else if (!t.startsWith("-")) positional++;
      }
      if (all && positional > 0) {
        return mkHit("infra", "kubectl-delete", seg, "--all");
      }
    }
    return null;
  }
  if (name === "docker" || name === "podman" || name === "nerdctl") {
    const dargs = subcommandArgs(name, args);
    if (dargs.length > 1) {
      const a1 = val(dargs[0]);
      const a2 = val(dargs[1]);
      if (a1 === "volume" && (a2 === "rm" || a2 === "remove" || a2 === "prune")) {
        return mkHit("infra", "docker-volumes", seg);
      }
      if (a1 === "system" && a2 === "prune") {
        for (const w of dargs.slice(2)) {
          if (val(w) === "--volumes") {
            return mkHit("infra", "docker-volumes", seg);
          }
        }
      }
    }
    return null;
  }
  if (name === "aws") {
    const wargs = subcommandArgs(name, args);
    if (wargs.length > 2 && val(wargs[0]) === "s3") {
      const sub = val(wargs[1]);
      let recursive = false;
      let force = false;
      let bucket: string | null = null;
      for (const w of wargs.slice(2)) {
        const t = val(w);
        if (t === "--recursive") recursive = true;
        else if (t === "--force") force = true;
        else if (t.startsWith("s3://") && bucket == null) bucket = t;
      }
      if (sub === "rm" && recursive && bucket) {
        return mkHit("infra", "bucket-delete", seg, bucket);
      }
      if (sub === "rb" && force && bucket) {
        return mkHit("infra", "bucket-delete", seg, bucket);
      }
    }
    return null;
  }
  if (name === "gsutil") {
    const gargs = subcommandArgs(name, args);
    if (gargs.length > 1 && val(gargs[0]) === "rm") {
      let recursive = false;
      let bucket: string | null = null;
      for (const w of gargs.slice(1)) {
        const t = val(w);
        if (t === "-r" || t === "-R" || t === "--recursive") recursive = true;
        else if (/^(gs|s3):\/\//.test(t) && bucket == null) bucket = t;
      }
      if (recursive && bucket) return mkHit("infra", "bucket-delete", seg, bucket);
    }
    return null;
  }
  if (name === "gcloud") {
    const ggargs = subcommandArgs(name, args);
    if (ggargs.length > 2 && val(ggargs[0]) === "storage" && val(ggargs[1]) === "rm") {
      let recursive = false;
      let bucket: string | null = null;
      for (const w of ggargs.slice(2)) {
        const t = val(w);
        if (t === "-r" || t === "--recursive") recursive = true;
        else if (/^(gs|s3):\/\//.test(t) && bucket == null) bucket = t;
      }
      if (recursive && bucket) return mkHit("infra", "bucket-delete", seg, bucket);
    }
    return null;
  }
  if (name === "az") {
    const zargs = subcommandArgs(name, args);
    if (zargs.length > 3 && val(zargs[0]) === "storage" && val(zargs[1]) === "container" && val(zargs[2]) === "delete") {
      let target: string | null = null;
      for (let i = 3; i < zargs.length; i++) {
        const t = val(zargs[i]);
        if (t === "--name" && i + 1 < args.length) { target = val(args[i + 1]); i++; continue; }
        if (t.startsWith("--name=")) { target = t.slice(7); continue; }
      }
      return mkHit("infra", "bucket-delete", seg, target ?? undefined);
    }
    return null;
  }
  return null;
}

// ---------- classification ----------

type Rule = (cmd: string | null, args: W[], seg: Seg, ci: CtxInfo, vars: Vars) => GuardHit | null;

const EARLY_NATIVE_RULES: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  [DELETE_KIND, ruleDelete],
  ["find", ruleFindDelete],
  ["shred", ruleShred],
]);
const LATE_NATIVE_RULES: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  ["git", ruleGit],
  ["chmod", ruleChmod],
  ["chown", ruleChown],
  ["chgrp", ruleChown],
]);

function classifySeg(seg: Seg, ci: CtxInfo, vars: Vars, scriptDepth: number): GuardHit | null {
  let i = 0;
  while (i < seg.words.length && ASSIGN_RE.test(seg.words[i].raw)) i++;
  const raws = dropHeadKeywords(i === 0 ? seg.words : seg.words.slice(i));
  if (raws.length === 0) {
    // a segment can be nothing but a redirection, and it can still aim at a device
    return ruleDiskStart("", [], seg);
  }
  const head = stripWrappers(raws, ci, vars);
  if (head.kind === "remote") return null;
  if (head.kind === "script") {
    if (scriptDepth > 3) return null;
    return classifySource(head.script ?? "", ci, vars, scriptDepth + 1);
  }
  if (head.words.length === 0) return null;
  const cmd = commandName(head.words[0]);
  const args = head.words.slice(1);
  const earlyNative = cmd === null ? undefined : EARLY_NATIVE_RULES.get(cmd);
  let hit = earlyNative ? earlyNative(cmd, args, seg, ci, vars) : null;
  if (hit) return hit;
  hit = rulePowerDelete(cmd, args, seg, ci, vars);
  if (hit) return hit;
  const lateNative = cmd === null ? undefined : LATE_NATIVE_RULES.get(cmd);
  hit = lateNative ? lateNative(cmd, args, seg, ci, vars) : null;
  if (hit) return hit;
  hit = ruleDisk(cmd, args, seg, ci, vars);
  if (hit) return hit;
  hit = ruleDb(cmd, args, seg, ci, vars);
  if (hit) return hit;
  hit = ruleStore(cmd, args, seg, ci, vars);
  if (hit) return hit;
  hit = ruleInfra(cmd, args, seg, ci, vars);
  if (hit) return hit;
  return null;
}

function classifySource(src: string, ci: CtxInfo, vars: Vars, scriptDepth: number): GuardHit | null {
  const segs = parseInput(src, 0);
  for (const seg of segs) {
    recordAssignments(seg, vars, ci);
    const hit = classifySeg(seg, ci, vars, scriptDepth);
    if (hit) return hit;
  }
  return null;
}

/** The single most important entry point: does this command line clearly
    destroy something? Returns the first hit in command order, or null. */
export function classifyCommand(command: string, ctx: GuardContext): GuardHit | null {
  try {
    const ci = makeCtx(ctx);
    return classifySource(command, ci, {}, 1);
  } catch {
    return null; // never throw, whatever the input
  }
}
