#!/usr/bin/env python3
"""Owned scratch filesystem and process metadata fixtures; no real signals."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get('S2_PLUGIN_SOURCE', ROOT / 'plugin')) / 'bin/companion-control.c'
LABEL = 'io.github.ninondev.coco-companion.plist'

class Security(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='s2-control-', dir=os.environ['TMPDIR'])
        cls.base = Path(cls.scratch.name).resolve()
        cls.binary = cls.base / 'control'
        if not SOURCE.exists():
            cls.compile = None
            return
        cls.compile = subprocess.run(['/usr/bin/xcrun', '--sdk', 'macosx', 'clang', '-std=c11',
            '-Wall', '-Wextra', '-Werror', '-DCOMPANION_CONTROL_FIXTURE', str(SOURCE), '-o', str(cls.binary)],
            capture_output=True, text=True)

    @classmethod
    def tearDownClass(cls): cls.scratch.cleanup()

    def setUp(self):
        self.assertIsNotNone(self.compile, 'secure control helper is missing')
        self.assertEqual(self.compile.returncode, 0, self.compile.stderr)
        self.work = Path(tempfile.mkdtemp(dir=self.base))

    def run_control(self, *args, data=''):
        return subprocess.run([str(self.binary), *map(str,args)], input=data, capture_output=True, text=True)

    def test_agent_atomic_and_bounded(self):
        folder = self.work/'home/Library/LaunchAgents'
        folder.mkdir(parents=True)
        agent = folder/LABEL
        agent.write_text('old'); before=agent.stat().st_ino
        self.assertEqual(self.run_control('write-agent',folder,LABEL,data='new').returncode,0)
        self.assertEqual(agent.read_text(),'new'); self.assertNotEqual(agent.stat().st_ino,before)
        self.assertNotEqual(self.run_control('write-agent',folder,LABEL,data='x'*65537).returncode,0)
        self.assertEqual(agent.read_text(),'new')

    def test_agent_leaf_link_and_hardlink_refused(self):
        folder=self.work/'agents';folder.mkdir()
        outside=self.work/'outside';outside.write_text('untouched')
        agent=folder/LABEL;agent.symlink_to(outside)
        self.assertNotEqual(self.run_control('write-agent',folder,LABEL,data='bad').returncode,0)
        self.assertEqual(outside.read_text(),'untouched');self.assertTrue(agent.is_symlink())
        agent.unlink();os.link(outside,agent)
        self.assertNotEqual(self.run_control('write-agent',folder,LABEL,data='bad').returncode,0)
        self.assertEqual(outside.read_text(),'untouched')

    def test_directory_symlink_refused(self):
        outside=self.work/'outside';outside.mkdir()
        alias=self.work/'home';alias.symlink_to(outside,target_is_directory=True)
        self.assertNotEqual(self.run_control('write-agent',alias/'Library/LaunchAgents',LABEL,data='bad').returncode,0)
        self.assertEqual(list(outside.iterdir()),[])
        self.assertNotEqual(self.run_control('ensure-dir',alias/'data').returncode,0)
        self.assertEqual(list(outside.iterdir()),[])

    def test_foreign_leaf_and_parent_metadata_refused(self):
        folder=self.work/'agents';folder.mkdir();agent=folder/LABEL;agent.write_text('foreign fixture')
        self.assertNotEqual(self.run_control('foreign',agent.stat().st_ino,'write-agent',folder,LABEL,data='bad').returncode,0)
        self.assertEqual(agent.read_text(),'foreign fixture')
        self.assertNotEqual(self.run_control('foreign',folder.stat().st_ino,'ensure-dir',folder/'new').returncode,0)
        self.assertFalse((folder/'new').exists())

    def test_shared_foreign_metadata_refused(self):
        folder=self.work/'shared';folder.mkdir()
        for name,command in [('view.json','write-shared'),('diagnostics.log','diagnostic-append'),('diagnostics','diagnostic-append'),('.shared-diagnostics-lock','diagnostic-append'),('.shared-view-lock','write-shared')]:
            for item in folder.iterdir(): item.unlink()
            (folder/'diagnostics').touch(); target=folder/name;target.write_text('untouched')
            args=['foreign',target.stat().st_ino,command,folder]
            if command=='write-shared':args.append('view.json')
            self.assertNotEqual(self.run_control(*args,data='bad\n').returncode,0,name)
            self.assertEqual(target.read_text(),'untouched',name)

    @unittest.skipUnless(os.geteuid()==0, 'actual foreign UID fixture requires an outside privileged runner')
    def test_actual_foreign_shared_and_agent_leaves(self):
        folder=self.work/'foreign';folder.mkdir()
        for name,command in [(LABEL,'write-agent'),('view.json','write-shared'),('diagnostics','diagnostic-append'),('diagnostics.log','diagnostic-append'),('diagnostics.log.1','diagnostic-append'),('.shared-view-lock','write-shared'),('.shared-diagnostics-lock','diagnostic-append')]:
            for item in folder.iterdir():item.unlink()
            (folder/'diagnostics').touch()
            if name=='diagnostics.log.1':(folder/'diagnostics.log').write_text('x'*204800)
            target=folder/name;target.write_text('untouched');os.chown(target,1,-1)
            args=[command,folder]
            if command in ['write-agent','write-shared']:args.append(name if command=='write-agent' else 'view.json')
            self.assertNotEqual(self.run_control(*args,data='bad\n').returncode,0,name)
            self.assertEqual(target.read_text(),'untouched',name)

    def test_branch_head_only_and_no_follow(self):
        repo=self.work/'repo';git=repo/'.git';git.mkdir(parents=True)
        head=git/'HEAD';head.write_text('ref: refs/heads/feature/安全\n')
        self.assertEqual(self.run_control('branch',repo).stdout,'feature/安全\n')
        outside=self.work/'outside';outside.write_text('ref: refs/heads/secret\n')
        head.unlink();head.symlink_to(outside)
        self.assertNotEqual(self.run_control('branch',repo).returncode,0)
        self.assertEqual(outside.read_text(),'ref: refs/heads/secret\n')
        head.unlink();head.write_text('ref: refs/heads/'+'n'*100000)
        self.assertNotEqual(self.run_control('branch',repo).returncode,0)
        head.write_text('detached fixture\n');self.assertNotEqual(self.run_control('branch',repo).returncode,0)

    def test_pointer_registered_worktree_only(self):
        repo=self.work/'worktree';repo.mkdir();marker=repo/'.git'
        external=self.work/'external';external.mkdir();(external/'HEAD').write_text('ref: refs/heads/outside\n')
        marker.write_text('gitdir: '+str(external)+'\n')
        self.assertNotEqual(self.run_control('branch',repo).returncode,0)
        common=self.work/'main/.git';git=common/'worktrees/s2';git.mkdir(parents=True)
        (git/'HEAD').write_text('ref: refs/heads/s2\n');(git/'commondir').write_text('../..\n')
        (git/'gitdir').write_text(str(marker)+'\n');marker.write_text('gitdir: '+str(git)+'\n')
        self.assertEqual(self.run_control('branch',repo).stdout,'s2\n')
        (git/'gitdir').write_text(str(self.work/'different/.git')+'\n')
        self.assertNotEqual(self.run_control('branch',repo).returncode,0)

    def test_stop_exact_owner_path_and_birth_recheck(self):
        uid=os.getuid();exe='/fixture/Companion.app/Contents/MacOS/companion';old='/fixture/old'
        metadata=self.work/'metadata';metadata.write_text(
            f'11 {uid} 10 20 {exe}\n12 {uid} 10 20 /unrelated/{exe}\n13 {uid+1} 10 20 {exe}\n'
            f'14 {uid} 10 20 {exe}\n14 {uid} 11 20 {exe}\n15 {uid} 10 20 {exe}\n15 {uid} 10 20 /unrelated\n')
        result=self.run_control('fixture',metadata,'stop',exe,old)
        self.assertEqual(result.returncode,0);self.assertEqual(result.stdout,'SIGNAL\t11\n')

if __name__=='__main__':unittest.main()
