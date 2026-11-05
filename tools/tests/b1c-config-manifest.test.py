#!/usr/bin/env python3
import json
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root/'tools'))
from languages import LANGUAGE_CODES
manifest = Path(sys.argv[1]) if len(sys.argv) > 1 else root/'plugin/.claude-plugin/plugin.json'
config = json.loads(manifest.read_text())['userConfig']
expected = {
 'band': ('Coco above the prompt', "on: Coco's band with pictures. compact: one line. off: put away, with a small door to call Coco back.\non：带画的横条；compact：只留一行；off：收起来，留一扇小门叫她回来。"),
 'language': ("Coco's language", "auto: follows Claude Code's language setting, otherwise your system's.\nauto：跟着 Claude Code 的语言设置，没设就跟系统。"),
}
for field,(title,description) in expected.items():
 assert config[field]['title']==title,(field,'title',config[field]['title'])
 assert config[field]['description']==description,(field,'description',config[field]['description'])
# M1 part 1 (556d4d5) added the text-only band as a fourth choice, between compact and off.
assert config['band']['options']==['on','compact','text','off']
assert config['language']['options']==['auto',*LANGUAGE_CODES]
# D (10-27): resolvedLanguage left userConfig; the settings record carries the language now.
assert list(config)==['band','language']
print('B1c manifest: four exact English strings and all literal choices pass')
