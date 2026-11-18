#!/usr/bin/env python3
"""Apply CC's versioned extension to reviewed upstream SOURCE, never an installed adapter.
No download, install, agent launch, or runtime/package modification is performed.
"""
import argparse,hashlib,json,subprocess
from pathlib import Path

BASE=Path(__file__).resolve().parent

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def safe_path(source,name):
    path=source/name
    if Path(name).is_absolute() or '..'in Path(name).parts or not path.resolve().is_relative_to(source) or any(source.joinpath(*Path(name).parts[:i]).is_symlink() for i in range(1,len(Path(name).parts)+1)):
        raise ValueError('Unsafe source path: '+name)
    return path

def apply(source,check=False):
    source=Path(source).resolve();manifest=json.loads((BASE/'manifest.json').read_text())
    package=json.loads((source/'package.json').read_text())
    if package.get('name')!=manifest['package'] or package.get('version')!=manifest['version']:
        raise ValueError('Wrong upstream adapter package/version; nothing changed')
    patch=BASE/'codex-acp.patch'
    if digest(patch)!=manifest['patch_sha256']:raise ValueError('Extension patch checksum changed')
    for name,hashes in manifest['files'].items():
        path=safe_path(source,name)
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(source) or digest(path)!=hashes['after'if check else'before']:
            raise ValueError('Source/version differs at '+name+'; nothing changed')
    for name,origin in manifest['additions'].items():
        path=safe_path(source,name)
        if check:
            if path.is_symlink() or digest(path)!=digest(BASE/origin):raise ValueError('Extension source differs at '+name)
        elif path.exists()or path.is_symlink():raise ValueError('Extension already exists; inspect instead of overwriting')
    if not check:
        args=['patch','--batch','--forward','--fuzz=0','-p1','-i',str(patch)]
        subprocess.run(args+['--dry-run'],cwd=source,check=True,capture_output=True,timeout=10)
        subprocess.run(args,cwd=source,check=True,capture_output=True,timeout=10)
        for name,origin in manifest['additions'].items():
            path=safe_path(source,name);path.parent.mkdir(parents=True,exist_ok=True)
            with path.open('xb')as stream:stream.write((BASE/origin).read_bytes())
        apply(source,True)
    return manifest['upstream_commit']

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source');parser.add_argument('--check',action='store_true');args=parser.parse_args()
    try:print('Verified CC native-shell extension for upstream '+apply(args.source,args.check))
    except (ValueError,OSError,subprocess.SubprocessError)as error:parser.exit(1,str(error)+'\n')
