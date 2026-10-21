"""Place fixture commands beside their actual production module state before bundling."""
import hashlib,json
from pathlib import Path
from hooks_source import hook_directory

ENTRY = 'export const register: Register = (on, options) => {'
COMPANION_IMPORT = "import {companionRequestText} from './companion'\n"
COMPANION_COMMAND = " on('command.run',{command:'d1-fixture-companion-request'},($,e)=>{\n  const args=JSON.parse(e.args) as Parameters<typeof companionRequestText>\n  return {text:companionRequestText(...args)}\n })\n"
def state_path(root):return Path(root)/'tests/d1-shared-register-preparation.json'
def source_sha(root):return hashlib.sha256((hook_directory(root)/'register.tsx').read_bytes()).hexdigest()
def state(root):
    path=state_path(root)
    return json.loads(path.read_text()) if path.is_file() else None
def owner_template(raw):
    if raw.count(COMPANION_IMPORT)!=1 or raw.count(COMPANION_COMMAND)!=1:
        raise RuntimeError('Shared companion fixture template changed')
    return raw.replace(COMPANION_IMPORT,'',1).replace(COMPANION_COMMAND,'',1)
def prepare_shared_register(copy,counters=False):
    root=Path(copy);template=root/'tests/d1-owner-test-access.ts'
    if not template.is_file():return
    owner_template(template.read_text())
    register=hook_directory(root)/'register.tsx';prior=state(root)
    if prior and prior['sourceSHA256']!=source_sha(root):
        raise RuntimeError('Canonical fixture source changed after shared command preparation')
    source=register.read_text()
    if source.count(ENTRY)!=1:raise RuntimeError('Canonical register entry changed')
    if not prior:
        if source.count('companionRequestText,')!=1 or 'd1-fixture-companion-request' in source:
            raise RuntimeError('Companion command must use the original imported production binding exactly once')
        register.write_text(source.replace(ENTRY,ENTRY+'\n'+COMPANION_COMMAND,1))
        prior={'companionShared':True,'counters':False}
    if counters and not prior['counters']:
        from d1_event_counter_fixture import instrument_d1_counters
        imported,commands=instrument_d1_counters(root)
        source=register.read_text()
        if source.count(ENTRY)!=1:raise RuntimeError('Counter injection requires canonical register')
        register.write_text(imported+source.replace(ENTRY,ENTRY+'\n'+commands,1))
        prior['counters']=True
    prior['sourceSHA256']=source_sha(root)
    state_path(root).write_text(json.dumps(prior)+'\n')
