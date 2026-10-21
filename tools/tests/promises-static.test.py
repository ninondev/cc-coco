#!/usr/bin/env python3
"""Offline source contracts for A4, B1/B2/B8, C11 and F2/F3.

--root selects a throwaway source copy for development mutation checks.
No shipped source is executed by these checks.
"""
import argparse
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from languages import LANGUAGE_CODES
from hooks_source import hook_directory
SCOPES = ('plugin/hooks', 'plugin/bin', 'plugin/companion/Sources', 'plugin/companion-rs/src')
SUFFIXES = {'.ts', '.tsx', '.js', '.mjs', '.sh', '.c', '.h', '.swift', '.rs'}
NETWORK = re.compile(r'\b(?:fetch|XMLHttpRequest|WebSocket|URLSession|URLRequest|NWConnection|CFSocket|curl|wget|nc|socket|socketpair|getaddrinfo|sendBeacon|Sentry|OpenTelemetry)\b|std\s*::\s*net|\$\s*\.\s*(?:net|network|http)\b|\b(?:require|from)\s*\(?\s*[\'\"](?:node:)?(?:net|http|https|tls|dgram)[\'\"]')
FOREIGN = re.compile(r'Claude\.app|Application Support[/\\]Claude(?!-sama)|(?:~/|\$HOME/|[\'\"])(?:\.claude(?:/|\.json|[\'\"])|\.vscode/extensions|\.vscode-insiders/extensions)|[/\\](?:Code|Code - Insiders)[/\\]User|(?:dconf|kdeglobals)')
SOCKET_CRATES = {'reqwest', 'hyper', 'socket2', 'mio', 'ureq', 'surf', 'curl', 'tungstenite', 'tokio-tungstenite', 'async-std', 'attohttpc', 'isahc', 'tiny_http', 'axum', 'actix-web'}
ABSOLUTE_RIGHT_TRANSLATIONS = (
    'vous avez absolument raison', 'vous avez tout à fait raison', 'tu as absolument raison', 'tu as tout à fait raison',
    'du hast absolut recht', 'du hast vollkommen recht', 'sie haben absolut recht',
    'आप बिल्कुल सही हैं', 'तुम बिल्कुल सही हो', 'kamu benar sekali', 'anda benar sekali',
    'hai assolutamente ragione', 'ha assolutamente ragione', 'あなたは完全に正しい', 'まったくそのとおり', 'まったくその通り',
    '전적으로 맞아요', '당신 말이 완전히 맞습니다', 'você está absolutamente certo', 'você está absolutamente certa',
    'tienes toda la razón', 'tienes absolutamente razón', 'tiene toda la razón',
    '你说得完全对', '你说得完全正确', '你完全正确',
    '你說得完全對', '你說得完全正確', '你完全正確',
)


def hooks(root):
    # M1 ships plugin/hooks as a generated static graph (facades and minified m1-compiled chunks) built from
    # plugin/hooks-source; build-hooks-graph.py --check proves those bytes derive from it, so the canonical
    # source is what these contracts read. Paths keep their shipped plugin/hooks/ names.
    return hook_directory(root / 'plugin')


def shipped(root, path):
    rel = path.relative_to(root).as_posix()
    source = hooks(root).relative_to(root).as_posix() + '/'
    return 'plugin/hooks/' + rel[len(source):] if rel.startswith(source) else rel


def sources(root):
    scopes = [hooks(root) if scope == 'plugin/hooks' else root / scope for scope in SCOPES]
    return sorted(p for scope in scopes for p in scope.rglob('*') if p.is_file() and p.suffix in SUFFIXES)


def violations(root, pattern, category):
    allow = json.loads((root / 'tools/promises-network-allowlist.json').read_text())['lines']
    approved = {(a['category'], a['path'], a['text']): a['reason'] for a in allow}
    assert len(approved) == len(allow), 'Duplicate allow-list line'
    assert all(isinstance(reason, str) and reason.strip() for reason in approved.values()), 'Every exact line needs a reason'
    found, used = [], set()
    for path in sources(root):
        rel = shipped(root, path)
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if pattern.search(line):
                key = category, rel, line
                if key not in approved:
                    found.append(f'{rel}:{number}: {line[:240]}')
                else:
                    used.add(key)
    stale = [key for key in approved if key[0] == category and key not in used]
    return found + [f'Stale allow-list: {key[1]}: {key[2][:160]}' for key in stale]


def imports(text):
    # Anchored declarations exclude dynamic import(), import type and exports of types.
    pattern = r'^\s*import\s+(?!type\b)([\w$*{},\s]+?\bfrom\s*)?[\'\"]([^\'\"]+)[\'\"]'
    def type_only(bindings):
        body = re.fullmatch(r'\s*\{([^}]*)\}\s+from\s*', bindings or '')
        return bool(body) and all(item.strip().startswith('type ') for item in body[1].split(',') if item.strip())
    result = [match[2] for match in re.finditer(pattern, text, re.M) if not type_only(match[1])]
    for match in re.finditer(r'^\s*export\s+(\*(?:\s+as\s+\w+)?\s+from\s*|\{[^}]*\}\s+from\s*)[\'\"]([^\'\"]+)[\'\"]', text, re.M):
        if not type_only(match[1]):
            result.append(match[2])
    return result


def import_graph(root):
    entries = json.loads((root / 'plugin/hooks/hooks.json').read_text())['modules']
    pending = [(hooks(root) / name).resolve() for name in entries]
    seen = set()
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        assert path.is_file() and path.is_relative_to(root.resolve()), f'Import escapes source tree: {path}'
        seen.add(path)
        if path.suffix == '.json':
            continue
        for name in imports(path.read_text()):
            if not name.startswith('.'):
                continue
            base = path.parent / name
            candidates = [base, *(Path(str(base) + suffix) for suffix in ('.ts', '.tsx', '.js', '.mjs', '.json')), *(base / ('index' + suffix) for suffix in ('.ts', '.tsx', '.js', '.mjs'))]
            target = next((p.resolve() for p in candidates if p.is_file()), None)
            assert target, f'Unresolved static import {path}: {name}'
            pending.append(target)
    return sorted(seen)


def regex_may_start(text, i):
    # A slash opens a regular expression where an operand is expected: after an operator, an opening bracket,
    # a separator, the start, or a keyword such as return.
    j = i - 1
    while j >= 0 and text[j] in ' \t\r\n':
        j -= 1
    if j < 0 or text[j] in '(,=:[!&|?{};~+-*%<>^':
        return True
    word = re.search(r'([A-Za-z_$][\w$]*)$', text[:j + 1])
    return bool(word) and word[1] in {'return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do'}


def masked(text):
    # Preserve offsets and newlines while hiding string payloads, regular expression literals and comments.
    # Template literals nest: the code inside ${...} stays visible and may hold templates of its own. (A flat
    # pattern lost its place at a nested template or a backtick inside a regex, and hid the rest of the file.)
    out, i, n, stack = list(text), 0, len(text), []
    def hide(start, end):
        for k in range(start, end):
            if out[k] != '\n':
                out[k] = ' '
    while i < n:
        c = text[i]
        if stack and stack[-1] == 'template':
            start = i
            while i < n and text[i] != '`' and not text.startswith('${', i):
                i += 2 if text[i] == '\\' else 1
            hide(start, min(i, n))
            if i >= n:
                break
            if text[i] == '`':
                out[i] = ' '; stack.pop(); i += 1
            else:
                stack.append('code'); i += 2
            continue
        if text.startswith('//', i):
            end = text.find('\n', i); end = n if end < 0 else end
            hide(i, end); i = end
        elif text.startswith('/*', i):
            end = text.find('*/', i + 2); end = n if end < 0 else end + 2
            hide(i, end); i = end
        elif c in '"\'':
            start, i = i, i + 1
            while i < n and text[i] != c and text[i] != '\n':
                i += 2 if text[i] == '\\' else 1
            i = min(i + 1, n); hide(start, i)
        elif c == '`':
            out[i] = ' '; stack.append('template'); i += 1
        elif c == '/' and regex_may_start(text, i):
            start, i, klass = i, i + 1, False
            while i < n and text[i] != '\n' and (klass or text[i] != '/'):
                if text[i] == '\\':
                    i += 1
                elif text[i] == '[':
                    klass = True
                elif text[i] == ']':
                    klass = False
                i += 1
            i = min(i + 1, n)
            while i < n and text[i].isalpha():
                i += 1
            hide(start, i)
        elif c == '{' and stack:
            stack.append('brace'); i += 1
        elif c == '}' and stack:
            top = stack.pop(); i += 1
            if top == 'code':
                pass
        else:
            i += 1
    return ''.join(out)


def eager_art_decoders(text):
    clean = masked(text)
    # Exclude declared function/getter bodies; calls in const initializers remain visible.
    declarations = re.compile(r'\bfunction\s+\w+[^\n{]*\{|\bget\s+[^\n{]*\{|=>\s*\{')
    ranges = []
    for match in declarations.finditer(clean):
        depth = 1
        end = match.end()
        while end < len(clean) and depth:
            depth += (clean[end] == '{') - (clean[end] == '}')
            end += 1
        # Invoked closures execute during import; only uncalled bodies are lazy.
        invoked = re.match(r'[\s)]*(?:\(|\.\s*(?:call|apply)\s*\()', clean[end:])
        if not invoked:
            ranges.append((match.start(), end))
    for start, end in reversed(ranges):
        clean = clean[:start] + ' ' * (end - start) + clean[end:]
    decoder = r'\b(?:JSON\s*\.\s*parse|atob|Buffer\s*\.\s*from|Uint8Array\s*\.\s*from|createImageBitmap|decode\w*|inflate\w*)\s*\(|\bnew\s+(?:Image|PNGDecoder)\s*\('
    return [text.count('\n', 0, match.start()) + 1 for match in re.finditer(decoder, clean, re.I)]


def locale_getters(path):
    pattern = r'\bget\s+"([^"\\]+)"\([^)]*\)[^{]*\{\s*return\s+\w+\("[^"\\]+",\s*("(?:\\.|[^"\\])*")'
    values = {match[1]: json.loads(json.loads(match[2])) for match in re.finditer(pattern, path.read_text())}
    assert values and 'en' in values, f'No shipped locale getters: {path}'
    return values


def strings(tree, prefix=''):
    if isinstance(tree, str):
        yield prefix, tree
    elif isinstance(tree, list):
        for index, value in enumerate(tree):
            yield from strings(value, f'{prefix}[{index}]')
    elif isinstance(tree, dict):
        for key, value in tree.items():
            if not key.startswith('_'):
                yield from strings(value, f'{prefix}.{key}')


class PromisesStatic(unittest.TestCase):
    def test_A4_host_command_delegations_are_classified(self):
        # This finite inventory covers direct $.command.run syntax, not host billing.
        # M1: a companion request is kept as a note and never runs /clear (finding 2), and the chapter button
        # compacts through $.session.compact (mod-gaps.ts compactChapter), so neither is a command delegation.
        classified = {
            ('plugin/hooks/more-runtime.ts', "$.command.run({command:'output-style'})"):
                'Explicit Plain press with no outputStyle setting row opens the host output-style picker; no model call.',
            ('plugin/hooks/more-runtime.ts', "$.command.run({command:'output-style',args:value})"):
                'Explicit Plain press, when the engine has no outputStyle row or refuses the plugin style, runs /output-style with the chosen style (4985060b); no model call.',
            ('plugin/hooks/register.tsx', '$.command.run(...args)'):
                'The More engine adapter passes command.run through; its one caller is the output-style line in more-runtime.ts.',
            ('plugin/hooks/pages.tsx', '$.command.run(...args)'):
                'The book page More engine adapter passes command.run through; its one caller is the output-style line in more-runtime.ts.',
        }
        self.assertTrue(all(reason.strip() for reason in classified.values()))
        found = []
        for path in sources(ROOT):
            text = path.read_text()
            clean = masked(text)
            for match in re.finditer(r'\$\s*\.\s*command\s*\.\s*run\s*\(', clean):
                depth, end = 1, match.end()
                while end < len(clean) and depth:
                    depth += (clean[end] == '(') - (clean[end] == ')')
                    end += 1
                self.assertEqual(depth, 0, f'Unclosed host command delegation: {path}')
                found.append((shipped(ROOT, path), text[match.start():end]))
        self.assertCountEqual(found, classified, 'Unclassified, missing, or duplicate host command delegation')

    def test_B1_B2_no_network_in_shipped_sources(self):
        self.assertEqual(violations(ROOT, NETWORK, 'network'), [])

    def test_B1_no_socket_cargo_dependency(self):
        text = (ROOT / 'plugin/companion-rs/Cargo.toml').read_text()
        dependencies = re.findall(r'^\s*([\w-]+)\s*=', text, re.M)
        aliases = re.findall(r'\bpackage\s*=\s*"([\w-]+)"', text)
        self.assertEqual(sorted(set(dependencies + aliases) & SOCKET_CRATES), [])
        # Feature-bearing generic runtimes can acquire sockets without a new crate name.
        self.assertNotRegex(text, r'"(?:net|network|Win32_Networking[^"\n]*|Win32_NetworkManagement[^"\n]*)"')

    def test_B8_no_foreign_application_paths(self):
        self.assertEqual(violations(ROOT, FOREIGN, 'filesystem'), [])

    def test_C11_static_import_graph_budget(self):
        graph = import_graph(ROOT)
        budget = json.loads((ROOT / 'tools/promises-load-budget.json').read_text())
        actual = {'modules': len(graph), 'sourceBytes': sum(path.stat().st_size for path in graph)}
        self.assertEqual(budget['tolerance'], 0.05)
        for key, value in actual.items():
            self.assertLessEqual(abs(value - budget[key]), budget[key] * budget['tolerance'], f'{key}: {value}, budget {budget[key]} +/- 5%')
        print('C11 import graph: ' + json.dumps(actual, sort_keys=True), flush=True)

    def test_C11_generated_art_not_decoded_at_import(self):
        files = [path for path in hooks(ROOT).glob('*.ts') if ('GENERATED' in path.read_text()[:350].upper() and any(part in path.name for part in ('art', 'frame', 'still', 'motion')))]
        self.assertTrue(files, 'Generated art inventory must not be empty')
        bad = [(path.name, eager_art_decoders(path.read_text())) for path in files if eager_art_decoders(path.read_text())]
        self.assertEqual(bad, [])

    def test_D8_locale_pools_match_shared_language_inventory(self):
        expected = set(LANGUAGE_CODES)
        words_source = (hooks(ROOT) / 'words.ts').read_text()
        declaration = re.search(r'export const LANGS = \[(.*?)\] as const', words_source, re.S)
        self.assertIsNotNone(declaration, 'Shipping language picker must remain inspectable')
        picker = re.findall(r"\bcode: '([^']+)'", declaration[1])
        self.assertEqual(len(picker), len(expected), 'Language picker must have exactly one row per shipped language')
        self.assertEqual(set(picker), expected)
        for name in ('lines.ts', 'words.ts', 'book-text.ts'):
            with self.subTest(module=name):
                pool = locale_getters(hooks(ROOT) / name)
                # The fortunes' words stay in lines.json until lane B takes them out (the omen went, owner 10-15).
                self.assertEqual({code for code in pool if not code.startswith('_') and code != 'omikuji'}, expected)
        self.assertEqual({path.stem for path in (ROOT / 'plugin/book').glob('*.json')}, expected)
        voice_sizes = json.loads((ROOT / 'plugin/hooks/voice-sizes.json').read_text())
        self.assertEqual(set(voice_sizes['languages']), expected)
        for key, pool in json.loads((ROOT / 'plugin/hooks/c3-text.json').read_text()).items():
            with self.subTest(c3_key=key):
                self.assertEqual({code for code in pool if not code.startswith('_')}, expected)

    def test_F2_never_absolutely_right_in_any_locale(self):
        pools = [locale_getters(hooks(ROOT) / name) for name in ('lines.ts', 'words.ts', 'book-text.ts')]
        pools += [json.loads(path.read_text()) for path in sorted((ROOT / 'plugin/book').glob('*.json'))]
        pools += [json.loads((ROOT / 'plugin/hooks/c3-text.json').read_text())]
        banned = re.compile(r'\byou[\'’]re\s+absolutely\s+right\b', re.I)
        bad = [(path, line) for pool in pools for path, line in strings(pool) if banned.search(line) or any(phrase.casefold() in line.casefold() for phrase in ABSOLUTE_RIGHT_TRANSLATIONS)]
        self.assertEqual(bad, [])

    def test_F3_english_speech_is_lowercase(self):
        lines = locale_getters(hooks(ROOT) / 'lines.ts')
        words = locale_getters(hooks(ROOT) / 'words.ts')['en']
        speech = [lines['en'], {key: words[key] for key in ('touch', 'aside', 'spinner', 'again', 'about', 'reply')}]
        self.assertEqual([(path, line) for pool in speech for path, line in strings(pool) if line != line.lower()], [])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--root', type=Path)
    args, remaining = parser.parse_known_args()
    if args.root:
        ROOT = args.root.resolve()
    unittest.main(argv=[sys.argv[0], *remaining], verbosity=2)
