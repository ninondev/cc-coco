// tools/c3-algo-core.ts
import { classifyCommand, lex, simpleCommands } from "./algo/guard.ts";
import { recognize, parseResult, record, judge } from "./algo/runs.ts";
import { project, hotness, crossed } from "./algo/pace.ts";

// plugin/hooks-source/more-secrets.ts
var SHAPES = [
  ["anthropic", /\bsk-ant-[A-Za-z0-9][A-Za-z0-9_-]{23,}\b/g],
  ["openai", /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ["aws", /\bAKIA[A-Z0-9]{16}\b/g],
  ["github", /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/g],
  ["slack", /\bxox[abposr]-[A-Za-z0-9-]{20,}\b/g],
  ["google", /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ["stripe", /\b[rs]k_live_[A-Za-z0-9]{20,}\b/g],
  ["pem", /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----|$)/g]
];
function secretHits(text) {
  const hits = [];
  for (const [kind, pattern] of SHAPES) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null)
      hits.push({ kind, start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return hits.sort((a, b) => a.start - b.start || b.end - a.end).filter((hit, index, all) => !all.slice(0, index).some((prior) => prior.start <= hit.start && prior.end >= hit.end));
}

// plugin/hooks-source/c3-secrets.ts
var EXTRA_SHAPES = [
  /\b(?:ASIA[A-Z0-9]{16}|sk-(?:ant-api\d+-)?[A-Za-z0-9_-]{20,}|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,}|(?:glpat-|hf_)[A-Za-z0-9_-]{20,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})(?![A-Za-z0-9_-])/g,
  /\bBearer[ \t]+[A-Za-z0-9._~+\/-]+={0,}/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*(?![A-Za-z0-9_-])/g,
  /\b(?:npm_[A-Za-z0-9]{36}|pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{40,}|xapp-\d-[A-Za-z0-9-]{20,}|xoxe(?:\.xox[bp])?-\d-[A-Za-z0-9-]{20,}|ya29\.[A-Za-z0-9_-]{30,}|do[opr]_v1_[a-f0-9]{64}|xai-[A-Za-z0-9]{40,}|gsk_[A-Za-z0-9]{40,}|[rs]k_test_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{24,})(?![A-Za-z0-9_-])/g,
  /(?<![0-9])\d{8,10}:AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])/g
];
var BASIC = /\bBasic[ \t]+([A-Za-z0-9+\/]{8,}={0,2})(?![A-Za-z0-9+\/=])/gi;
var basicPair = (value) => {
  try {
    return /^[\x20-\x39\x3b-\x7e]+:[\x20-\x7e]+$/.test(atob(value));
  } catch {
    return false;
  }
};
var URL_PASSWORD = /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s\/:@?#"'<>]{0,64}:(?![$<{*]|%[sv]@|(?:password|passwd|pass|pwd|secret|changeme|example|x{3,})@)([^\s\/@?#"'<>]{4,})@(?=[A-Za-z0-9[])/gi;
function credentialRanges(text) {
  const ranges = secretHits(text).map((hit) => ({ start: hit.start, end: hit.end }));
  for (const pattern of EXTRA_SHAPES) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null)
      ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  BASIC.lastIndex = 0;
  for (let match;(match = BASIC.exec(text)) !== null; )
    if (basicPair(match[1]))
      ranges.push({ start: match.index, end: match.index + match[0].length });
  URL_PASSWORD.lastIndex = 0;
  for (let match;(match = URL_PASSWORD.exec(text)) !== null; ) {
    const end = match.index + match[0].length - 1;
    ranges.push({ start: end - match[1].length, end });
  }
  return ranges;
}
var secretPattern = () => /(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|\bsk-(?:ant-api\d+-)?[A-Za-z0-9_-]{20,}|\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|\bxox[baprs]-[A-Za-z0-9-]{20,}|\bAIza[A-Za-z0-9_-]{30,}|\b(?:glpat-|hf_)[A-Za-z0-9_-]{20,}|\b(?:SG\.)[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/;
var assignmentPattern = () => /(?<![A-Za-z0-9])(?:password|passwd|pwd|api[_-]?key|access[_-]?key|account[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|secret)["']?\s*[:=]\s*["']?([A-Za-z0-9_+\/-]{20,})/gi;
var randomSecret = (value) => /[a-z]/.test(value) && /[A-Z0-9]/.test(value) && new Set(value).size >= 10;
function scanStagedSecrets(diff) {
  let file, line = 0, added = false;
  for (const raw of diff.split(`
`)) {
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4).replace(/^b\//, "");
      file = path !== "/dev/null" && !path.startsWith("/") && !path.startsWith("../") ? path : undefined;
      added = false;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      added = true;
      continue;
    }
    if (!file || !added || raw.startsWith("\\"))
      continue;
    if (raw.startsWith("-"))
      continue;
    if (raw.startsWith("+")) {
      const text = raw.slice(1);
      let random = false;
      for (const assignment of text.matchAll(assignmentPattern()))
        if (randomSecret(assignment[1])) {
          random = true;
          break;
        }
      if (credentialRanges(text).length || secretPattern().test(text) || random)
        return { file, line };
    }
    line++;
  }
  return;
}

// tools/c3-algo-core.ts
var PRIORITY = { disk: 0, rm: 1, drop: 2, push: 3, reset: 4, clean: 5, chmod: 6, chown: 7, stash: 8, history: 9, infra: 10 };
function path(value, cwd) {
  const win = /^[A-Za-z]:[\\/]/.test(cwd), prefix = win ? cwd.slice(0, 2) : "", absolute = win ? /^[A-Za-z]:[\\/]/.test(value) : value.startsWith("/");
  const parts = (absolute ? value : cwd + "/" + value).replaceAll("\\", "/").replace(/^[A-Za-z]:/, "").split("/"), out = [];
  for (const part of parts) {
    if (!part || part === ".")
      continue;
    if (part === "..")
      out.pop();
    else
      out.push(part);
  }
  return prefix + "/" + out.join("/");
}
function executeC3Algo(request) {
  if (request.op === "secrets")
    return scanStagedSecrets(request.diff);
  if (request.op === "guard") {
    const { command, context } = request;
    const hits = [];
    const first = classifyCommand(command, context);
    if (first)
      hits.push(first);
    let start = 0;
    for (const token of lex(command))
      if (token.kind === "op" && [";", "&&", "||", "|", "|&", "&", `
`].includes(token.text)) {
        const hit = classifyCommand(command.slice(start, token.start), context);
        if (hit)
          hits.push(hit);
        start = token.end;
      }
    const last = classifyCommand(command.slice(start), context);
    if (last)
      hits.push(last);
    hits.sort((a, b) => (PRIORITY[a.kind] ?? 11) - (PRIORITY[b.kind] ?? 11));
    let commandCwd = context.cwd, commitCwd;
    for (const words of simpleCommands(command)) {
      if (words[0] === "cd" && words[1] && !words[1].startsWith("-")) {
        commandCwd = path(words[1], commandCwd);
        continue;
      }
      if (words[0]?.replace(/^.*[\\/]/, "") !== "git")
        continue;
      let cwd = commandCwd;
      for (let i = 1;i < words.length; i++) {
        if (words[i] === "-C" && words[i + 1]) {
          cwd = path(words[++i], cwd);
          continue;
        }
        if (words[i] === "-c" || words[i] === "--git-dir" || words[i] === "--work-tree") {
          i++;
          continue;
        }
        if (words[i] === "commit") {
          commitCwd = cwd;
          break;
        }
        if (!words[i]?.startsWith("-"))
          break;
      }
    }
    const hit = hits[0];
    return { hit: hit ? { kind: hit.kind, reason: hit.reason, target: hit.target, branch: hit.branch } : undefined, commitCwd };
  }
  if (request.op === "recognize")
    return recognize(request.command);
  if (request.op === "finish") {
    const parsed = parseResult(request.tool, request.output, request.exitCode);
    return { parsed, slowness: judge(request.history, request.key, request.ms), history: record(request.history, request.key, { ms: request.ms, outcome: parsed.outcome }, 9) };
  }
  if (request.op === "pace") {
    const projections = project(request.readings, request.now), hot = hotness(request.previous, projections);
    return { projections, hot };
  }
  if (request.op === "crossed")
    return crossed(request.previous, request.current, request.thresholds);
  return null;
}
export {
  executeC3Algo
};
