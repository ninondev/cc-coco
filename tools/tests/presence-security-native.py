#!/usr/bin/env python3
"""Attack fixture files only; pass a source-built PRESENCE_SECURITY_FIXTURE helper."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
BINARY = str(Path(sys.argv.pop(1)).resolve()) if len(sys.argv) > 1 else None
class NativeFiles(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='s2-presence-security-', dir=os.environ.get('TMPDIR'))
        self.root = Path(self.temp.name).resolve()
        self.folder = self.root / 'presence'; self.folder.mkdir(mode=0o700)
        self.outside = self.root / 'outside'; self.outside.write_bytes(b'unchanged')
    def tearDown(self): self.temp.cleanup()
    def call(self, operation, folder, leaf):
        return subprocess.run([BINARY, operation, str(folder), leaf], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2).returncode
    def test_links_cannot_redirect_any_presence_leaf(self):
        leaves = ['snapshot.json','presence.jsonl','.presence-flock','.presence-flock-owner',
                  '.presence-registration-owned','.presence-follow-owned.jsonl','.presence-deadline-owned.jsonl']
        for leaf in leaves:
            with self.subTest(leaf=leaf):
                target = self.folder / leaf; target.symlink_to(self.outside)
                operation = 'security-open' if leaf == '.presence-flock' else 'security-write'
                self.assertNotEqual(self.call(operation,self.folder,leaf),0)
                self.assertEqual(self.outside.read_bytes(),b'unchanged'); self.assertTrue(target.is_symlink())
                target.unlink(); stage=self.folder/'.security-stage'
                if stage.exists(): stage.unlink()
    def test_fifo_is_refused_without_blocking(self):
        target=self.folder/'presence.jsonl'; os.mkfifo(target,0o600)
        self.assertNotEqual(self.call('security-read',self.folder,target.name),0)
        self.assertNotEqual(self.call('security-open',self.folder,target.name),0)
        self.assertNotEqual(self.call('security-write',self.folder,target.name),0)
        self.assertEqual(self.outside.read_bytes(),b'unchanged')
    def test_fifo_send_refuses_replacements_and_accepts_only_owned_fifo(self):
        transaction=self.folder/'.presence-owned'; transaction.mkdir(mode=0o700)
        target=transaction/'commit'
        def send(prefix=(), identity=None):
            if identity is None:
                info=target.stat() if target.exists() else self.folder.stat(); identity=(info.st_dev,info.st_ino)
            return subprocess.run([BINARY,*prefix,str(self.folder),'fifo-send',str(target),str(identity[0]),str(identity[1]),'record\n'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=7).returncode
        target.write_text('regular')
        self.assertNotEqual(send(),0); self.assertEqual(target.read_text(),'regular'); target.unlink()
        target.symlink_to(self.outside)
        self.assertNotEqual(send(),0); self.assertEqual(self.outside.read_bytes(),b'unchanged'); target.unlink()
        os.link(self.outside,target)
        self.assertNotEqual(send(),0); self.assertEqual(self.outside.read_bytes(),b'unchanged'); target.unlink()
        os.mkfifo(target,0o600); receiver=os.open(target,os.O_RDWR|os.O_NONBLOCK)
        try:
            self.assertEqual(send(),0); self.assertEqual(os.read(receiver,100),b'record\n')
            self.assertNotEqual(send(identity=(target.stat().st_dev,target.stat().st_ino+1)),0)
            with self.assertRaises(BlockingIOError): os.read(receiver,100)
            self.assertNotEqual(send(('security-foreign',str(target.stat().st_ino))),0)
            with self.assertRaises(BlockingIOError): os.read(receiver,100)
            alias=transaction/'extra-link'; os.link(target,alias)
            self.assertNotEqual(send(),0)
            with self.assertRaises(BlockingIOError): os.read(receiver,100)
            alias.unlink()
            old=(target.stat().st_dev,target.stat().st_ino); target.unlink(); os.mkfifo(target,0o600)
            replacement=os.open(target,os.O_RDWR|os.O_NONBLOCK)
            try:
                self.assertNotEqual(send(identity=old),0)
                with self.assertRaises(BlockingIOError): os.read(replacement,100)
            finally: os.close(replacement)
        finally: os.close(receiver)
        target.unlink()
        # A directory link must not let a valid leaf escape the verified parent traversal.
        transaction.rmdir(); transaction.symlink_to(self.root,target_is_directory=True)
        self.assertNotEqual(send(),0); self.assertFalse((self.root/'commit').exists())
    @unittest.skipUnless(os.environ.get('PRESENCE_SECURITY_SHARED') == '1', 'portable shared output modes are Linux-specific')
    def test_linux_shared_outputs_are_bounded_atomic_and_refuse_links(self):
        def command(operation, data, *args):
            return subprocess.run([BINARY,operation,str(self.folder),*args],input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=3).returncode
        view=self.folder/'view.json'; view.write_bytes(b'previous'); before=view.stat().st_ino
        self.assertEqual(command('write-shared',b'view','view.json'),0)
        self.assertEqual(view.read_bytes(),b'view'); self.assertNotEqual(view.stat().st_ino,before)
        self.assertNotEqual(command('write-shared',b'x'*1048577,'view.json'),0)
        self.assertEqual(view.read_bytes(),b'view')
        for link in ('symlink','hardlink'):
            view.unlink()
            if link=='symlink': view.symlink_to(self.outside)
            else: os.link(self.outside,view)
            self.assertNotEqual(command('write-shared',b'unsafe','view.json'),0)
            self.assertEqual(self.outside.read_bytes(),b'unchanged')
        view.unlink()
        self.assertEqual(command('diagnostic-append',b'ignored\n'),0)
        log=self.folder/'diagnostics.log'; self.assertFalse(log.exists())
        flag=self.folder/'diagnostics'; flag.write_bytes(b'')
        self.assertEqual(command('diagnostic-append',b'first\n'),0)
        self.assertEqual(log.read_bytes(),b'first\n')
        inode=log.stat().st_ino
        self.assertEqual(command('diagnostic-append',b'second\n'),0)
        self.assertEqual(log.read_bytes(),b'first\nsecond\n'); self.assertNotEqual(log.stat().st_ino,inode)
        log.write_bytes(b'x'*204799)
        self.assertEqual(command('diagnostic-append',b'new\n'),0)
        self.assertEqual(log.read_bytes(),b'new\n'); self.assertEqual((self.folder/'diagnostics.log.1').stat().st_size,204799)
        self.assertEqual(command('diagnostic-append',b'spoof\nrow\n'),0); self.assertEqual(log.read_bytes(),b'new\n')
        log.unlink(); log.symlink_to(self.outside)
        self.assertNotEqual(command('diagnostic-append',b'unsafe\n'),0); self.assertEqual(self.outside.read_bytes(),b'unchanged')
    def test_stage_replacement_is_refused_and_not_removed_by_cleanup(self):
        target=self.folder/'snapshot.json'; target.write_bytes(b'previous')
        result=subprocess.run([BINARY,'security-stage-swap',str(self.folder),target.name,str(self.outside)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=2)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(target.read_bytes(),b'previous'); self.assertEqual(self.outside.read_bytes(),b'unchanged')
        stages=list(self.folder.glob('.presence-stage-*'))
        self.assertEqual(len(stages),1); self.assertTrue(stages[0].is_symlink()); self.assertEqual(stages[0].readlink(),self.outside)
    def test_generic_rename_rejects_replaced_owned_regular_stage(self):
        target=self.folder/'snapshot.json'; target.write_bytes(b'previous')
        result=subprocess.run([BINARY,'security-rename-swap',str(self.folder),target.name,'rename'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=2)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(target.read_bytes(),b'previous')
        self.assertEqual((self.folder/'.security-swap-stage').read_bytes(),b'replacement\n')
        self.assertEqual(self.outside.read_bytes(),b'unchanged')
    def test_stage_cleanup_leaves_replaced_owned_regular_file(self):
        target=self.folder/'snapshot.json'; target.write_bytes(b'previous')
        result=subprocess.run([BINARY,'security-rename-swap',str(self.folder),target.name,'cleanup'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=2)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual((self.folder/'.security-swap-stage').read_bytes(),b'replacement\n')
        self.assertEqual(target.read_bytes(),b'previous'); self.assertEqual(self.outside.read_bytes(),b'unchanged')
    def test_cleanup_refuses_hardlinked_fifo(self):
        target=self.folder/'commit'; alias=self.folder/'commit-alias'
        os.mkfifo(target,0o600); os.link(target,alias)
        self.assertNotEqual(self.call('security-unlink',self.folder,target.name),0)
        self.assertTrue(target.exists()); self.assertTrue(alias.exists())
        self.assertEqual(target.stat().st_ino,alias.stat().st_ino)
    def test_hardlinks_are_refused(self):
        target=self.folder/'presence.jsonl'; os.link(self.outside,target)
        self.assertNotEqual(self.call('security-write',self.folder,target.name),0)
        self.assertEqual(self.outside.read_bytes(),b'unchanged')
    def test_parent_link_is_refused(self):
        alias=self.root/'alias'; alias.symlink_to(self.folder,target_is_directory=True)
        self.assertNotEqual(self.call('security-write',alias,'snapshot.json'),0)
        self.assertFalse((self.folder/'snapshot.json').exists())
    def test_owned_leaf_replaces_atomically(self):
        target=self.folder/'snapshot.json'; target.write_text('previous')
        self.assertEqual(self.call('security-read',self.folder,target.name),0)
        before=target.stat().st_ino
        self.assertEqual(self.call('security-write',self.folder,target.name),0)
        self.assertEqual(target.read_text(),'owned\n'); self.assertNotEqual(target.stat().st_ino,before)
        self.assertEqual(target.stat().st_mode & 0o777,0o600)
    def test_foreign_owner_metadata_is_refused_at_every_leaf(self):
        for leaf in ['snapshot.json','presence.jsonl','.presence-flock','.presence-flock-owner','.presence-registration-owned','.presence-follow-owned.jsonl','.presence-deadline-owned.jsonl']:
            with self.subTest(leaf=leaf):
                target=self.folder/leaf; target.write_text('foreign-fixture')
                command=[BINARY,'security-foreign',str(target.stat().st_ino),'security-open' if leaf=='.presence-flock' else 'security-write',str(self.folder),leaf]
                self.assertNotEqual(subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=2).returncode,0)
                self.assertEqual(target.read_text(),'foreign-fixture'); target.unlink()
                stage=self.folder/'.security-stage'
                if stage.exists(): stage.unlink()
    def test_registration_requires_the_complete_metadata_record(self):
        target=self.folder/'.presence-registration-owned'
        good=f'44\t22\tdarwin:1:2\t{os.getuid()}\t/fixture/helper\towned\n'
        target.write_text(good)
        self.assertEqual(self.call('security-registration',self.folder,'owned'),0)
        for bad in [good.replace('44\t','45\t',1),good.replace('/fixture/helper','/fixture/other'),good.replace('darwin:1:2','darwin:1:3'),good.replace('\towned','\tforeign'),good.replace(f'\t{os.getuid()}\t',f'\t{os.getuid()+1}\t')]:
            target.write_text(bad); self.assertNotEqual(self.call('security-registration',self.folder,'owned'),0)
    @unittest.skipUnless(os.geteuid() == 0, 'requires an external privileged fixture runner to plant foreign UID files')
    def test_foreign_parent_is_refused_before_writing_or_creating(self):
        parent=self.root/'foreign-parent'; parent.mkdir(mode=0o777); parent.chmod(0o777)
        target=parent/'snapshot.json'; target.write_bytes(b'unchanged')
        os.chown(parent,1,-1)
        self.assertNotEqual(self.call('security-write',parent,target.name),0)
        self.assertEqual(target.read_bytes(),b'unchanged')
        created=parent/'must-not-create'
        result=subprocess.run([BINARY,str(created),'follow','owned'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=2)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(created.exists())
    @unittest.skipUnless(os.geteuid() == 0, 'requires an external privileged fixture runner to plant foreign UID files')
    def test_foreign_files_are_refused(self):
        for leaf in ['snapshot.json','presence.jsonl','.presence-flock','.presence-flock-owner','.presence-registration-owned','.presence-follow-owned.jsonl','.presence-deadline-owned.jsonl']:
            target=self.folder/leaf; target.write_text('foreign'); os.chown(target,1,-1)
            self.assertNotEqual(self.call('security-open' if leaf=='.presence-flock' else 'security-write',self.folder,leaf),0)
            self.assertEqual(target.read_text(),'foreign'); target.unlink()
            stage=self.folder/'.security-stage'
            if stage.exists(): stage.unlink()
if __name__=='__main__':
    if BINARY is None: raise SystemExit('pass a source-built PRESENCE_SECURITY_FIXTURE binary')
    unittest.main()
