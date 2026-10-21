import { describe, test, expect } from "bun:test";
import { lex, unquoteWord, unescapeAnsiC, extractSubstitutions, regionEnd } from "../../../plugin/hooks/algo/lexer";
const NL = String.fromCharCode(10);
const TB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const BS = String.fromCharCode(92);
const SQ = String.fromCharCode(39);
const DQ = String.fromCharCode(34);

function texts(src: string): string[] {
  return lex(src).filter(t => t.kind !== "comment").map(t => t.text);
}
function words(src: string): { text: string; quoted: boolean }[] {
  return lex(src).filter(t => t.kind === "word").map(t => ({ text: t.text, quoted: t.quoted }));
}
function ops(src: string): string[] {
  return lex(src).filter(t => t.kind === "op").map(t => t.text);
}

describe("lex basics", () => {
  test("splits words on blanks", () => {
    const t = lex("rm -rf dist");
    expect(t.map(x => x.kind)).toEqual(["word", "word", "word"]);
    expect(t.map(x => x.text)).toEqual(["rm", "-rf", "dist"]);
  });
  test("records start and end offsets", () => {
    const t = lex(" rm  -rf ");
    expect(t[0].start).toBe(1);
    expect(t[0].end).toBe(3);
    expect(t[1].start).toBe(5);
    expect(t[1].end).toBe(8);
  });
  test("tabs and carriage returns separate words", () => {
    expect(texts("a\tb\rc")).toEqual(["a", "b", "c"]);
  });
  test("empty input gives no tokens", () => { expect(lex("")).toEqual([]); });
});

describe("lex quoting", () => {
  test("single quotes keep everything literal", () => {
    const t = words("echo 'rm -rf $HOME / '");
    expect(t[1].text).toBe("'rm -rf $HOME / '");
    expect(t[1].quoted).toBe(true);
  });
  test("double quotes keep one word", () => {
    const t = words("echo \"a b c\"");
    expect(t[1].text).toBe("\"a b c\"");
    expect(t[1].quoted).toBe(true);
  });
  test("adjacent quoted and bare parts form one word", () => {
    const t = words("a'b c'd\"e f\"g");
    expect(t.length).toBe(1);
    expect(t[0].text).toBe("a'b c'd\"e f\"g");
    expect(t[0].quoted).toBe(true);
  });
  test("backslash escapes the next character into the word", () => {
    expect(texts("echo a\\ b\\\\c")).toEqual(["echo", "a\\ b\\\\c"]);
  });
  test("backslash inside double quotes escapes specials", () => {
    const t = words("echo \"a\\\"b\"");
    expect(t[1].text).toBe("\"a\\\"b\"");
  });
  test("empty quotes are a quoted empty word", () => {
    const t = words("cmd ''");
    expect(t[1].text).toBe("''");
    expect(t[1].quoted).toBe(true);
  });
  test("ANSI-C quoted string is one quoted word", () => {
    const t = words("echo $'a b'");
    expect(t[1].text).toBe("$'a b'");
    expect(t[1].quoted).toBe(true);
  });
  test("ANSI-C quote with escapes inside stays one word", () => {
    const q = String.fromCharCode(39);
    expect(words("echo $" + q + "a\\tb\\nc" + q).length).toBe(2);
  });
  test("unterminated single quote closes at end of input", () => {
    const t = lex("echo 'oops");
    expect(t[1].text).toBe("'oops");
    expect(t[1].end).toBe(10);
  });
  test("unterminated double quote closes at end of input", () => {
    expect(words("echo \"x")[1].text).toBe("\"x");
  });
  test("unterminated ANSI-C quote closes at end of input", () => {
    const q = String.fromCharCode(39);
    expect(words("echo $" + q + "x")[1].text).toBe("$" + q + "x");
  });
  test("unterminated backtick closes at end of input", () => {
    expect(words("echo `x")[1].text).toBe("`x");
  });
});

describe("lex line continuations", () => {
  test("backslash newline joins lines into one word", () => {
    expect(texts("rm -rf\\\n  dist")).toEqual(["rm", "-rf", "dist"]);
  });
  test("backslash newline inside a word keeps the word open", () => {
    expect(texts("a\\\nb")).toEqual(["ab"]);
  });
  test("many continuations in a row", () => {
    expect(texts("a\\\n\\\n\\\nb")).toEqual(["ab"]);
  });
  test("continuation inside double quotes keeps the word open", () => {
    expect(words("echo \"a\\\nb\"")[1].text).toBe("\"a\\\nb\"");
  });
});

describe("lex comments", () => {
  test("comment at word start runs to end of line", () => {
    const t = lex("rm -rf / # wipe it");
    expect(t[3].kind).toBe("comment");
    expect(t[3].text).toBe("# wipe it");
  });
  test("hash inside a word is not a comment", () => {
    expect(texts("echo a#b")).toEqual(["echo", "a#b"]);
  });
  test("hash right after an operator is a comment", () => {
    const t = lex("a && #c\nb");
    expect(t.some(x => x.kind === "comment" && x.text === "#c")).toBe(true);
  });
  test("hash inside quotes is not a comment", () => {
    expect(texts("echo '#a'")).toEqual(["echo", "'#a'"]);
  });
  test("comment ends at a newline", () => {
    expect(lex("# a\nb").filter(t => t.kind === "word").map(t => t.text)).toEqual(["b"]);
  });
});

describe("lex operators", () => {
  test("every operator", () => {
    const src = "a && b || c ; d | e |& f & g ( h ) { i }\nj";
    expect(ops(src)).toEqual(["&&", "||", ";", "|", "|&", "&", "(", ")", "{", "}", "\n"]);
  });
  test("newline is an operator token", () => { expect(ops("a\nb")).toEqual(["\n"]); });
  test("brace is an operator only at word start", () => {
    expect(texts("a{b}c")).toEqual(["a{b}c"]);
    expect(ops("{ a; }")).toEqual(["{", ";", "}"]);
  });
  test("semicolons of case arms are operators", () => {
    expect(ops("case x in a) b;; esac")).toContain(";;");
  });
});

describe("lex redirections", () => {
  test("output redirect", () => {
    expect(texts("> out")[0]).toBe(">");
    expect(texts(">out")[0]).toBe(">");
  });
  test("append redirect", () => { expect(texts(">> out")[0]).toBe(">>"); });
  test("input redirect", () => { expect(texts("< in")[0]).toBe("<"); });
  test("fd duplication", () => {
    expect(texts("2>&1")[0]).toBe("2>&1");
    expect(texts("cmd 2>&1")[1]).toBe("2>&1");
    expect(texts(">&2")[0]).toBe(">&2");
  });
  test("both redirect", () => { expect(texts("&> f")[0]).toBe("&>"); });
  test("clobber redirect", () => { expect(texts(">| f")[0]).toBe(">|"); });
  test("here string", () => { expect(texts("<<< s")[0]).toBe("<<<"); });
  test("fd number before a redirect belongs to the operator", () => {
    expect(texts("cmd 2> e")[1]).toBe("2>");
    expect(texts("cmd 10>> e")[1]).toBe("10>>");
  });
  test("a bare digit word stays a word", () => { expect(texts("sort 2")[1]).toBe("2"); });
});

describe("lex heredocs", () => {
  test("plain heredoc body is one token", () => {
    const t = lex("cat <<EOF\nbody\nEOF");
    expect(t[1].kind).toBe("op");
    expect(t[1].text).toBe("<<EOF");
    expect(t[3].kind).toBe("heredoc");
    expect(t[3].text).toBe("body");
  });
  test("dash form keeps the tabs of the body", () => {
    const t = lex("cat <<-EOF\n\tbody\n\tmore\nEOF");
    expect(t[3].kind).toBe("heredoc");
    expect(t[3].text).toBe("\tbody\n\tmore");
  });
  test("single quoted delimiter keeps the body literal", () => {
    const t = lex("cat <<\x27EOF\x27\n$b `c` $(d)\nEOF");
    expect(t[3].text).toBe("$b `c` $(d)");
  });
  test("double quoted delimiter keeps the body as typed", () => {
    const t = lex("cat <<\"EOF\"\n$b\nEOF");
    expect(t[3].text).toBe("$b");
  });
  test("two heredocs on one line keep their order", () => {
    const t = lex("cat <<A <<B\nfirst\nA\nsecond\nB");
    const bodies = t.filter(x => x.kind === "heredoc").map(x => x.text);
    expect(bodies).toEqual(["first", "second"]);
  });
  test("heredoc after other words", () => {
    const t = lex("cmd arg <<EOF\nbody\nEOF");
    expect(t.map(x => x.kind)).toEqual(["word", "word", "op", "op", "heredoc"]);
  });
  test("delimiter with an escaped character", () => {
    const t = lex("cat <<\\E\nbody\nE");
    expect(t[1].text).toBe("<<\\E");
    expect(t[3].text).toBe("body");
  });
  test("unterminated heredoc takes the rest of the input", () => {
    const t = lex("wc <<EOF\nunterminated");
    expect(t[3].text).toBe("unterminated");
  });
  test("heredoc body stops at a line that is only the delimiter", () => {
    const t = lex("cat <<EOF\nEOFx\nEOF\nafter");
    expect(t[3].text).toBe("EOFx");
  });
});

describe("lex substitutions", () => {
  test("command substitution stays in the word", () => {
    const t = words("echo $(rm -rf /)");
    expect(t[1].text).toBe("$(rm -rf /)");
    expect(t[1].quoted).toBe(false);
  });
  test("nested command substitution stays whole", () => {
    expect(words("echo $(a $(b) c)").length).toBe(2);
    expect(words("echo $(a $(b) c)")[1].text).toBe("$(a $(b) c)");
  });
  test("substitution inside double quotes stays in the word", () => {
    expect(words("echo \"pre $(x) post\"").length).toBe(2);
  });
  test("backticks stay in the word", () => {
    expect(words("echo `rm -rf /`")[1].text).toBe("`rm -rf /`");
  });
  test("escaped backticks do not open a substitution", () => {
    const bt = String.fromCharCode(96);
    const src = "echo " + BS + bt + "a " + BS + bt + "b" + BS + bt + " c" + BS + bt;
    expect(words(src).length).toBe(4);
    expect(words(src)[1].text).toBe(BS + bt + "a");
  });
  test("quotes inside a substitution do not end the word", () => {
    expect(words("echo $(echo \x27a b\x27)").length).toBe(2);
  });
  test("process substitution is part of the word", () => {
    expect(words("diff <(sort a) <(sort b)").length).toBe(3);
    expect(words("diff <(sort a) <(sort b)")[1].text).toBe("<(sort a)");
  });
  test("output process substitution", () => {
    expect(words("tee >(gzip > x.gz)").length).toBe(2);
  });
  test("unterminated substitution closes at end of input", () => {
    expect(words("echo $(x").length).toBe(2);
    expect(words("echo $(x $(y")[1].text).toBe("$(x $(y");
  });
  test("dollar brace parameter", () => { expect(words("echo ${HOME}x").length).toBe(2); });
  test("adjacent substitutions form one word", () => {
    expect(words("a$(b)c`d`").length).toBe(1);
  });
});

describe("lex helpers", () => {
  test("unquoteWord removes single quotes", () => {
    expect(unquoteWord("\x27a b\x27")).toBe("a b");
  });
  test("unquoteWord applies backslash escapes", () => {
    expect(unquoteWord("a\\ b\\\\c")).toBe("a b\\c");
  });
  test("unquoteWord keeps $ as typed", () => {
    expect(unquoteWord("\x27$HOME\x27")).toBe("$HOME");
    expect(unquoteWord("\"$HOME\"")).toBe("$HOME");
  });
  test("unquoteWord unescapes ANSI-C quotes", () => {
    expect(unquoteWord("$\x27a\\tb\x27")).toBe("a\tb");
  });
  test("unescapeAnsiC handles the common escapes", () => {
    expect(unescapeAnsiC("a" + BS + "nb" + BS + "tc" + BS + "r")).toBe("a" + NL + "b" + TB + "c" + CR);
    expect(unescapeAnsiC(BS + "x41" + BS + "102")).toBe("AB");
    expect(unescapeAnsiC(BS + "e[0m")).toBe(String.fromCharCode(27) + "[0m");
    expect(unescapeAnsiC(BS + BS + DQ + SQ)).toBe(BS + DQ + SQ);
    expect(unescapeAnsiC(BS + "cA")).toBe(String.fromCharCode(1));
  });
  });
  test("unescapeAnsiC never throws on junk", () => {
    expect(() => unescapeAnsiC("\\x\\c\\q\\8\\\\")).not.toThrow();
  });
  test("extractSubstitutions finds command substitutions", () => {
    expect(extractSubstitutions("$(rm -rf /)")).toEqual(["rm -rf /"]);
    expect(extractSubstitutions("a`b`c")).toEqual(["b"]);
  });
  test("extractSubstitutions finds process substitutions", () => {
    expect(extractSubstitutions("<(sort a) >(b)")).toEqual(["sort a", "b"]);
  });
  test("extractSubstitutions skips quoted regions", () => {
    expect(extractSubstitutions("\x27$(a)\x27")).toEqual([]);
  });
  test("extractSubstitutions nests", () => {
    expect(extractSubstitutions("$(a $(b))")).toEqual(["a $(b)"]);
  });
  test("regionEnd of a quoted region", () => {
    expect(regionEnd("\x27ab\x27cd", 0)).toBe(4);
    expect(regionEnd("\"a\\\"b\" c", 0)).toBe(6);
  });

describe("lex never throws", () => {
  test("hostile quoting", () => { expect(() => lex("\x27\x27\x27\"\"\"$((")).not.toThrow(); });
  test("lone surrogates and control characters", () => {
    expect(() => lex("a\\ud800b\\u0000c")).not.toThrow();
  });
  test("very long input", () => { expect(() => lex("a ".repeat(50000))).not.toThrow(); });
});


// the same deterministic generator shape the guard tests use, so both corpora are stable
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const Q = String.fromCharCode(39);
const D = String.fromCharCode(34);
const B = String.fromCharCode(92);
const GR = String.fromCharCode(96);
const SHELLISH = ("rm -rf / " + Q + D + B + "$(){}<>|&;#~*?." + String.fromCharCode(9, 10, 13) + "abc019").split("");

function corpus(count: number, seed: number): string[] {
  const r = prng(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const kind = r();
    if (kind < 0.2) {
      let s = "";
      const n = 1 + Math.floor(r() * 40);
      for (let j = 0; j < n; j++) {
        const c = r() < 0.1 ? Math.floor(r() * 0x800) + 0xd800 : Math.floor(r() * 0x110000);
        s += String.fromCodePoint(c);
      }
      out.push(s);
    } else if (kind < 0.7) {
      let s = "";
      const n = 1 + Math.floor(r() * 120);
      for (let j = 0; j < n; j++) s += SHELLISH[Math.floor(r() * SHELLISH.length)];
      out.push(s);
    } else if (kind < 0.85) {
      out.push("echo hi <<EOF " + B + NL + "body ".repeat(1 + Math.floor(r() * 500)));
    } else {
      const bits = ["rm", "-rf", Q, D, "$(", ")", GR, "<<", "<<-", "EOF", "$" + Q, ";", "#", "$HOME", "|", "&&", ">|", "<<<", "&>", "2>&1", "<(", ">("];
      let s = "";
      const n = 1 + Math.floor(r() * 30);
      for (let j = 0; j < n; j++) s += bits[Math.floor(r() * bits.length)];
      out.push(s);
    }
  }
  return out;
}

describe("fuzz lex", () => {
  const inputs = corpus(2000, 77117);
  const KINDS = new Set(["word", "op", "heredoc", "comment"]);
  test("2000 seeded inputs never throw", () => {
    for (const s of inputs) expect(() => lex(s)).not.toThrow();
  });
  test("token shape invariants hold", () => {
    for (const s of inputs) {
      let last = 0;
      for (const t of lex(s)) {
        if (!KINDS.has(t.kind)) throw new Error("odd kind " + JSON.stringify(t.kind));
        if (typeof t.text !== "string" || typeof t.quoted !== "boolean") throw new Error("odd fields");
        if (t.start < last || t.end < t.start || t.end > s.length) throw new Error("bad span in " + JSON.stringify(s.slice(0, 60)));
        // a line continuation removed during joining makes the raw span longer than the text
        last = t.end;
      }
    }
  });
  test("no token text is empty", () => {
    for (const s of inputs) {
      for (const t of lex(s)) {
        if (t.kind !== "heredoc" && t.text.length === 0) throw new Error("empty token in " + JSON.stringify(s.slice(0, 60)));
      }
    }
  });
  test("the same seed gives the same corpus", () => {
    expect(corpus(30, 77117)).toEqual(corpus(30, 77117));
  });
});

describe("line continuation joins lines", () => {
  test("a backslash newline is neither a word break nor an operator", () => {
    const toks = lex("rm -rf " + BS + NL + "  /tmp/kiwi");
    expect(toks.filter(t => t.kind === "op")).toEqual([]);
    expect(toks.map(t => t.kind)).toEqual(["word", "word", "word"]);
    expect(toks.map(t => t.text)).toEqual(["rm", "-rf", "/tmp/kiwi"]);
  });
  test("no empty word is invented for a continuation between words", () => {
    expect(words("a b " + BS + NL + " c").map(w => w.text)).toEqual(["a", "b", "c"]);
    expect(words("a " + BS + NL + BS + NL + " b").map(w => w.text)).toEqual(["a", "b"]);
    expect(words("a " + BS + CR + NL + " b").map(w => w.text)).toEqual(["a", "b"]);
  });
  test("a word split across the join is one word as written", () => {
    expect(words("/tmp/ki" + BS + NL + "wi").map(w => w.text)).toEqual(["/tmp/kiwi"]);
    expect(words("rm" + BS + NL + "-rf").map(w => w.text)).toEqual(["rm-rf"]);
  });
  test("the continuation is dropped from the unquoted word", () => {
    expect(unquoteWord("/tmp/ki" + BS + NL + "wi")).toBe("/tmp/kiwi");
    expect(unquoteWord("a" + BS + CR + NL + "b")).toBe("ab");
  });
  test("a continuation inside double quotes joins the text", () => {
    expect(unquoteWord(DQ + "a" + BS + NL + "b" + DQ)).toBe("ab");
  });
  test("a continuation inside single quotes is literal text", () => {
    expect(unquoteWord(SQ + "a" + BS + NL + "b" + SQ)).toBe("a" + BS + NL + "b");
  });
  test("a trailing backslash without a newline stays literal", () => {
    expect(texts("a" + BS)).toEqual(["a" + BS]);
    expect(texts("a " + BS)).toEqual(["a", BS]);
  });
  test("a backslash before a real character still escapes", () => {
    expect(unquoteWord("a\\ b")).toBe("a b");
    expect(texts("echo a\\ b")).toEqual(["echo", "a\\ b"]);
  });
  test("a comment still ends at the newline of a continuation", () => {
    expect(lex("ls " + BS + NL + "# note" + NL + "ls").map(t => t.kind)).toEqual(["word", "comment", "op", "word"]);
    expect(lex("ls \\X# noteNLls").length).toBeGreaterThan(0);
  });
});

describe("substitution extraction inside double quotes", () => {
  test("finds $( ) inside double quotes", () => {
    expect(extractSubstitutions(DQ + "$(rm -rf /)" + DQ)).toEqual(["rm -rf /"]);
  });
  test("finds backticks inside double quotes", () => {
    expect(extractSubstitutions(DQ + "`rm -rf /`" + DQ)).toEqual(["rm -rf /"]);
  });
  test("finds both kinds mixed in one quoted word", () => {
    expect(extractSubstitutions(DQ + "a$(x)y`z`b" + DQ)).toEqual(["x", "z"]);
  });
  test("nested substitutions inside double quotes", () => {
    expect(extractSubstitutions(DQ + "$(echo $(rm -rf /))" + DQ)).toEqual(["echo $(rm -rf /)"]);
  });
  test("single quotes still suppress extraction", () => {
    expect(extractSubstitutions(SQ + "$(rm -rf /)" + SQ)).toEqual([]);
    expect(extractSubstitutions(SQ + "`rm -rf /`" + SQ)).toEqual([]);
  });
  test("an escaped backtick inside double quotes is not a substitution", () => {
    expect(extractSubstitutions(DQ + BS + "`rm -rf /`" + DQ)).toEqual([]);
  });
  test("an escaped dollar inside double quotes is not a substitution", () => {
    expect(extractSubstitutions(DQ + BS + "$(rm -rf /)" + DQ)).toEqual([]);
  });
  test("a quoted region inside the substitution is kept whole", () => {
    expect(extractSubstitutions(DQ + "$(echo " + SQ + "a;rm -rf /" + SQ + ")" + DQ)).toEqual(["echo " + SQ + "a;rm -rf /" + SQ]);
  });
  test("double quotes nested inside the substitution still close", () => {
    expect(extractSubstitutions(DQ + "$(echo " + DQ + "x" + DQ + " rm -rf /)" + DQ)).toEqual(["echo " + DQ + "x" + DQ + " rm -rf /"]);
  });
  test("unquoted substitutions are still found", () => {
    expect(extractSubstitutions("$(a) `b` <(c)")).toEqual(["a", "b", "c"]);
  });
});

describe("windows path words keep their backslashes", () => {
  test("a bare drive path stays one word with its separators", () => {
    expect(texts("rd /s /q C:" + BS + "Users" + BS + "user" + BS + "src")).toEqual(["rd", "/s", "/q", "C:" + BS + "Users" + BS + "user" + BS + "src"]);
  });
  test("unquoteWord keeps the separators of a drive path", () => {
    expect(unquoteWord("C:" + BS + "Users" + BS + "user")).toBe("C:" + BS + "Users" + BS + "user");
  });
  test("a drive path with forward slashes is untouched", () => {
    expect(unquoteWord("C:/Users/user")).toBe("C:/Users/user");
  });
  test("a backslash still escapes outside a drive path", () => {
    expect(unquoteWord("a" + BS + " b")).toBe("a b");
    expect(unquoteWord("a" + BS + " b")).toBe("a b");
    expect(texts("echo a" + BS + " b")).toEqual(["echo", "a" + BS + " b"]);
  });
  test("a quoted windows path is unchanged", () => {
    expect(unquoteWord(DQ + "C:" + BS + "Users" + BS + "user" + DQ)).toBe("C:" + BS + "Users" + BS + "user");
  });
  test("a drive letter alone keeps a trailing backslash", () => {
    expect(unquoteWord("C:" + BS)).toBe("C:" + BS);
  });
});


describe("repair G1: backtick delimiter precision", () => {
  test("an escaped closing backtick and two escaped backticks are literal", () => {
    expect(extractSubstitutions(DQ + "`rm -rf /" + BS + "`" + DQ)).toEqual([]);
    expect(extractSubstitutions(DQ + BS + "`rm -rf /" + BS + "`" + DQ)).toEqual([]);
  });
  test("a backtick cannot borrow its closing delimiter from beyond double quotes", () => {
    expect(extractSubstitutions(DQ + "`rm -rf /" + DQ + " tail`" )).toEqual([]);
  });
  test("empty completed substitutions never produce empty command text", () => {
    expect(extractSubstitutions("`` " + DQ + "``" + DQ + " $() " + DQ + "$()" + DQ + " <() >()")).toEqual([]);
  });
});


describe("repair G1 review: closed backtick command quoting", () => {
  test("closed backticks preserve balanced double quotes in their command body", () => {
    const body = "rm -rf " + DQ + "/etc" + DQ;
    expect(extractSubstitutions(DQ + "`" + body + "`" + DQ)).toEqual([body]);
    expect(extractSubstitutions(DQ + '`echo "hello"`' + DQ)).toEqual(['echo "hello"']);
  });
});
