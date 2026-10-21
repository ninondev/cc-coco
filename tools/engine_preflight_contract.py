import ast


def guarded_checks(source):
    tree = ast.parse(source)
    main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
    claude = [i for i, node in enumerate(main.body) if isinstance(node, ast.Assign)
              and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name)
              and node.value.func.id == 'find_claude']
    dispatch = [i for i, node in enumerate(main.body) if isinstance(node, ast.For)
                and isinstance(node.target, ast.Name) and node.target.id == 'stage']
    candidates = []
    for i, block in enumerate(main.body):
        if not isinstance(block, ast.If):
            continue
        loops = [node for node in block.body if isinstance(node, ast.For)
                 and isinstance(node.target, ast.Name) and node.target.id == 'check'
                 and isinstance(node.iter, ast.Tuple)]
        if loops:
            candidates.append((i, block, loops))
    if len(claude) != 1 or len(dispatch) != 1 or len(candidates) != 1:
        raise ValueError('expected one engine boundary, Claude lookup and stage dispatch')
    position, block, loops = candidates[0]
    if len(loops) != 1 or position >= claude[0] or position >= dispatch[0]:
        raise ValueError('preflight must precede Claude lookup and stage dispatch')
    stages = [ast.literal_eval(node) for node in ast.walk(block.test) if isinstance(node, ast.Tuple)]
    if stages != [('kit', 'kit-2.1.299', 'install', 'webkit')]:
        raise ValueError('every engine boundary must run preflight')
    loop = loops[0]
    if len(loop.body) != 2:
        raise ValueError('guard dispatch and failure propagation must stay paired')
    assignment, failure = loop.body
    if not (isinstance(assignment, ast.Assign) and len(assignment.targets) == 1
            and isinstance(assignment.targets[0], ast.Name) and assignment.targets[0].id == 'checked'
            and isinstance(assignment.value, ast.Call) and isinstance(assignment.value.func, ast.Name)
            and assignment.value.func.id == 'd1_python_preflight'
            and len(assignment.value.args) == 1 and isinstance(assignment.value.args[0], ast.Name)
            and assignment.value.args[0].id == 'check'):
        raise ValueError('named guards must execute through bounded preflight')
    if not (isinstance(failure, ast.If) and isinstance(failure.test, ast.Compare)
            and isinstance(failure.test.left, ast.Name) and failure.test.left.id == 'checked'
            and len(failure.test.ops) == 1 and isinstance(failure.test.ops[0], ast.NotEq)
            and len(failure.test.comparators) == 1 and isinstance(failure.test.comparators[0], ast.Constant)
            and failure.test.comparators[0].value == 0 and len(failure.body) == 1
            and isinstance(failure.body[0], ast.Return) and isinstance(failure.body[0].value, ast.Name)
            and failure.body[0].value.id == 'checked'):
        raise ValueError('guard failures must stop engine dispatch')
    helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'd1_python_preflight')
    calls = [node for node in ast.walk(helper) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Name) and node.func.id == 'observed_run']
    if len(calls) != 1 or not any(keyword.arg == 'cpu_limit' and isinstance(keyword.value, ast.Constant)
                                 and keyword.value.value == 30 for keyword in calls[0].keywords):
        raise ValueError('named preflight CPU cap must remain thirty seconds')
    return set(ast.literal_eval(loop.iter))


def relocate_after_claude(source):
    tree = ast.parse(source)
    main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
    block = next(node for node in main.body if isinstance(node, ast.If)
                 and any(isinstance(child, ast.For) and isinstance(child.target, ast.Name)
                         and child.target.id == 'check' for child in node.body))
    claude = next(node for node in main.body if isinstance(node, ast.Assign)
                  and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name)
                  and node.value.func.id == 'find_claude')
    lines = source.splitlines(keepends=True)
    moved = lines[block.lineno - 1:block.end_lineno]
    return ''.join(lines[:block.lineno - 1] + lines[block.end_lineno:claude.end_lineno]
                   + moved + lines[claude.end_lineno:])


def omit_guard(source, name):
    tree = ast.parse(source)
    main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
    block = next(node for node in main.body if isinstance(node, ast.If)
                 and any(isinstance(child, ast.For) and isinstance(child.target, ast.Name)
                         and child.target.id == 'check' for child in node.body))
    loop = next(node for node in block.body if isinstance(node, ast.For)
                and isinstance(node.target, ast.Name) and node.target.id == 'check')
    lines = source.splitlines(keepends=True)
    original = lines[loop.lineno - 1]
    lines[loop.lineno - 1] = original.replace(repr(name) + ', ', '', 1)
    if lines[loop.lineno - 1] == original:
        raise ValueError('named guard omission mutant did not alter engine boundary')
    return ''.join(lines)
