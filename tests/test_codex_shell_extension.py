"""Versioned source patch guards. Full replay uses an explicitly supplied upstream checkout."""
import importlib.util,json,os,shutil,subprocess,tempfile,unittest,sys
from pathlib import Path
ROOT=Path(__file__).parents[1]
SPEC=importlib.util.spec_from_file_location('codex_shell_patch',ROOT/'adapters/codex-native-shell/apply.py')
PATCH=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(PATCH)
MANIFEST=json.loads((PATCH.BASE/'manifest.json').read_text())

class PatchGuards(unittest.TestCase):
    def test_wrong_package_version_is_rejected_without_mutation(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);p=root/'package.json';p.write_text(json.dumps({'name':MANIFEST['package'],'version':'wrong'}));before=p.read_bytes()
            with self.assertRaisesRegex(ValueError,'version'):PATCH.apply(root)
            self.assertEqual(before,p.read_bytes());self.assertEqual(['package.json'],[p.name for p in root.iterdir()])

    def test_real_harness_check_requires_explicit_scope_flag_before_any_setup(self):
        result=subprocess.run([sys.executable,str(PATCH.BASE/'live_check.py'),'/does-not-exist'],capture_output=True,text=True,timeout=5)
        self.assertEqual(2,result.returncode)
        self.assertIn('Explicit human scope required',result.stderr)

    def test_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory()as folder,tempfile.TemporaryDirectory()as outside:
            root=Path(folder);(root/'src').symlink_to(outside,target_is_directory=True)
            with self.assertRaisesRegex(ValueError,'Unsafe'):PATCH.safe_path(root,'src/escape.ts')
            self.assertEqual([],list(Path(outside).iterdir()))

    @unittest.skipUnless(os.environ.get('CC_CODEX_ADAPTER_SOURCE'),'Set CC_CODEX_ADAPTER_SOURCE to the reviewed patched source for full patch replay')
    def test_exact_upstream_replay_duplicate_and_changed_source_guards(self):
        source=Path(os.environ['CC_CODEX_ADAPTER_SOURCE']);PATCH.apply(source,True)
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);shutil.copyfile(source/'package.json',root/'package.json')
            for name in MANIFEST['files']:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/name,p)
            subprocess.run(['patch','--batch','--reverse','--fuzz=0','-p1','-i',str(PATCH.BASE/'codex-acp.patch')],cwd=root,check=True,capture_output=True)
            # Altered upstream source rejects before any other source is touched.
            first=next(iter(MANIFEST['files']));p=root/first;original=p.read_bytes();p.write_bytes(original+b'\nchanged')
            snapshots={name:(root/name).read_bytes()for name in MANIFEST['files']}
            with self.assertRaisesRegex(ValueError,'differs'):PATCH.apply(root)
            self.assertEqual(snapshots,{name:(root/name).read_bytes()for name in MANIFEST['files']})
            p.write_bytes(original);PATCH.apply(root);PATCH.apply(root,True)
            with self.assertRaises(ValueError):PATCH.apply(root)
