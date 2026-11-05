"""Stage current companion resources for isolated native fixtures."""
from pathlib import Path
import shutil


def stage_assets(root: Path, scratch: Path) -> Path:
    assets = scratch / 'assets'
    shutil.copytree(root / 'plugin/assets', assets,
                    ignore=shutil.ignore_patterns('desktop', 'pixel', 'patches'))
    shutil.copytree(root / 'plugin/companion-rs/assets/coco', assets / 'coco', dirs_exist_ok=True)
    for outfit in ('A', 'B'):
        for suffix in ('json', 'bin'):
            path = assets / 'coco' / f'band-{outfit}.{suffix}'
            if not path.is_file() or not path.stat().st_size:
                raise ValueError(f'Missing current Coco fixture resource: {path}')
    for path in (assets / 'coco').glob('*.json'):
        paired = path.with_suffix('.bin')
        if not paired.is_file() or not paired.stat().st_size:
            raise ValueError(f'Missing Coco sidecar: {paired}')
    return assets


def expose_pet(source: Path) -> None:
    with source.open('a') as output:
        output.write('\n@MainActor extension Pet {\n    var fixtureTouchKey: String? { touchKey }\n    var fixtureCocoAction: String? { coco?.current?.action }\n    var fixtureCocoImage: CGImage? { lookView.coco.contents.map { $0 as! CGImage } }\n}\n')
