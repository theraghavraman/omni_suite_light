import io
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import omni_security_primitives as p

class SecurityPrimitiveTests(unittest.TestCase):
    def test_host_ipv6(self):
        self.assertTrue(p.parse_local_authority('[::1]:8765',8765))
        self.assertTrue(p.parse_local_authority('127.0.0.1:8765',8765))
        for name in ('evil.com:8765','[::1]:9000','localhost:8765@evil.test','localhost:bad','127.0.0.1:8765/a'):
            self.assertFalse(p.parse_local_authority(name, 8765), name)

    def test_db_pragma_writes_blocked_and_select_works(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'db.sqlite'
            with sqlite3.connect(path) as c:
                c.execute('CREATE TABLE t(x INTEGER)')
                c.execute('INSERT INTO t VALUES (42)')
                before = c.execute('PRAGMA user_version').fetchone()[0]
            self.assertEqual(p.read_sqlite_only(path, 'SELECT x FROM t')['rows'][0]['x'],42)
            with self.assertRaises(ValueError):
                p.read_sqlite_only(path, 'PRAGMA user_version=31337')
            with self.assertRaises(ValueError):
                p.read_sqlite_only(path, 'WITH changed AS (DELETE FROM t RETURNING x) SELECT * FROM changed')
            with sqlite3.connect(path) as c:
                self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0], before)
                self.assertEqual(c.execute('SELECT COUNT(*) FROM t').fetchone()[0], 1)

    def test_sql_bounds(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'db.sqlite'
            with sqlite3.connect(path) as c:
                c.execute('CREATE TABLE t(x)')
                c.executemany('INSERT INTO t VALUES (?)',[(i,) for i in range(3)])
            result=p.read_sqlite_only(path,'SELECT x FROM t',max_rows=2)
            self.assertEqual(result['row_count'],2)
            self.assertTrue(result['truncated'])

    def test_bounded_read_and_upload_cleanup(self):
        with self.assertRaises(ValueError): p.bounded_stream_read(io.BytesIO(b'hello'), 4)
        self.assertEqual(p.bounded_stream_read(io.BytesIO(b'hi'),4),b'hi')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'private'
            result=p.atomic_stream_upload(io.BytesIO(b'data'),root,4)
            self.assertEqual(result.read_bytes(),b'data')
            with self.assertRaises(ValueError): p.atomic_stream_upload(io.BytesIO(b'short'),root,100)
            self.assertEqual([x.suffix for x in root.iterdir()],['.upload'])

    def test_archive_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/'valid.txt').write_text('hello')
            self.assertEqual(list(p.iter_archive_plain_files(root))[0][1], 'valid.txt')
            if hasattr(os,'symlink'):
                try: os.symlink(root/'valid.txt',root/'evil')
                except OSError: return
                with self.assertRaises(ValueError): list(p.iter_archive_plain_files(root))

    def test_csv_neutralization(self):
        for evil in ['=HYPERLINK("a","b")','\t=1+1',' +SUM(A1)','@foo','-cmd']:
            self.assertTrue(p.csv_safe_value(evil).startswith("'"), evil)
        for okay in ['-12','-12.50','a+b']:
            self.assertEqual(p.csv_safe_value(okay),okay)

    def test_resource_signature(self):
        secret=b'X'*32
        exp=int(time.time())+30
        sig=p.sign_resource(secret,'/api/download/abc','user',exp)
        self.assertTrue(p.verify_resource(secret,'/api/download/abc','user',exp,sig))
        self.assertFalse(p.verify_resource(secret,'/api/download/abc','someone-else',exp,sig))
        self.assertFalse(p.verify_resource(secret,'/api/download/bad','user',exp,sig))

if __name__ == '__main__': unittest.main()
