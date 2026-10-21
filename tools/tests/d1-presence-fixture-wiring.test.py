#!/usr/bin/env python3
import argparse,ast,json,re,tempfile,unittest
from pathlib import Path
REQUIRED={'d1-presence-fixture-events.test.tsx','d1-denial-fixture-event.test.tsx'}
def functions(source):
    return {n.name:n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef)}
def load_helper(source):
    node=functions(source).get('denial_initial_source')
    if node is None:raise AssertionError('missing denial initializer source generator')
    namespace={'Path':Path,'re':re}
    exec(compile(ast.Module(body=[node],type_ignores=[]),'<reviewed local runner helper>','exec'),namespace)
    return namespace['denial_initial_source']
def selected(source):
    node=functions(source)['windows_roots']
    items=[n for n in ast.walk(node) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='selected' for t in n.targets)]
    if len(items)!=1:raise AssertionError('Windows filename inventory is ambiguous')
    return ast.literal_eval(items[0].value)
def require_windows(source):
    missing=REQUIRED-selected(source)
    if missing:raise AssertionError('Windows stage drops '+', '.join(sorted(missing)))
def require_generation(source):
    body=functions(source)
    calls=[n for n in ast.walk(body['source_files']) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='denial_initial_source']
    if len(calls)!=1:raise AssertionError('source_files must generate the exact denial initializer once')
    main=body['main'];ordered=[(n.lineno,n.func.id) for n in ast.walk(main) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id in ('source_files','windows_roots')]
    ordered.sort()
    if [name for _,name in ordered]!=['source_files','windows_roots']:raise AssertionError('source extraction must precede Windows retention')
class Wiring(unittest.TestCase):
    def test_exact_source_initializer_is_extracted_without_a_handwritten_copy(self):
        raw=DENIAL.read_text();expected=re.findall(r'^\s*const transport=transportFixture\((\{[^\n]+\})\)\s*$',raw,re.MULTILINE)
        self.assertEqual(len(expected),1)
        with tempfile.TemporaryDirectory(prefix='d1-initializer-source-') as folder:
            root=Path(folder);tests=root/'tests';tests.mkdir();(tests/'d1-denial-fixture-event.test.tsx').write_text('');(tests/'d1-notify-denial.test.tsx').write_text(raw)
            load_helper(RUNNER.read_text())(root)
            self.assertEqual((tests/'d1-denial-initial-source-fixture.ts').read_text(),"import {MORNING} from './world'\nexport const D1_DENIAL_INITIAL="+expected[0]+'\n')
    def test_source_mutation_changes_generated_initializer_and_cannot_leave_a_stale_literal(self):
        raw=DENIAL.read_text();changed=raw.replace("kind:'initial'","kind:'activity'",1)
        self.assertNotEqual(raw,changed)
        with tempfile.TemporaryDirectory(prefix='d1-initializer-mutation-') as folder:
            root=Path(folder);tests=root/'tests';tests.mkdir();(tests/'d1-denial-fixture-event.test.tsx').write_text('');source=tests/'d1-notify-denial.test.tsx';source.write_text(raw);helper=load_helper(RUNNER.read_text());helper(root);first=(tests/'d1-denial-initial-source-fixture.ts').read_text();source.write_text(changed);helper(root);second=(tests/'d1-denial-initial-source-fixture.ts').read_text()
            self.assertNotEqual(first,second);self.assertIn("kind:'activity'",second)
    def test_missing_or_duplicate_initializer_rejects_before_overwriting_existing_fixture(self):
        raw=DENIAL.read_text();line=next(line for line in raw.splitlines() if 'const transport=transportFixture(' in line)
        with tempfile.TemporaryDirectory(prefix='d1-initializer-reject-') as folder:
            root=Path(folder);tests=root/'tests';tests.mkdir();(tests/'d1-denial-fixture-event.test.tsx').write_text('');source=tests/'d1-notify-denial.test.tsx';generated=tests/'d1-denial-initial-source-fixture.ts';generated.write_text('retained')
            for bad in (raw.replace(line,''),raw+'\n'+line+'\n'):
                source.write_text(bad)
                with self.assertRaisesRegex(RuntimeError,'one exact initializer'):load_helper(RUNNER.read_text())(root)
                self.assertEqual(generated.read_text(),'retained')
    def test_all_preparation_consumers_generate_before_selection_and_missing_call_is_rejected(self):
        source=RUNNER.read_text();require_generation(source)
        tree=ast.parse(source);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='source_files');node.body=[n for n in node.body if not (isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='denial_initial_source')]
        with self.assertRaisesRegex(AssertionError,'must generate'):require_generation(ast.unparse(tree))
    def test_both_parser_guards_survive_windows_and_each_omission_is_rejected(self):
        source=RUNNER.read_text();require_windows(source)
        for name in REQUIRED:
            tree=ast.parse(source);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='windows_roots');assignment=next(n for n in ast.walk(node) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='selected' for t in n.targets));assignment.value=ast.parse(repr(selected(source)-{name}),mode='eval').body
            with self.assertRaisesRegex(AssertionError,'Windows stage drops '+re.escape(name)):require_windows(ast.unparse(tree))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--runner',type=Path,default=Path(__file__).resolve().parents[1]/'run-tests.py');parser.add_argument('--denial',type=Path,default=Path(__file__).resolve().parent/'d1-notify-denial.test.tsx');args,remaining=parser.parse_known_args();RUNNER,DENIAL=args.runner,args.denial
    unittest.main(argv=[__file__,*remaining])
